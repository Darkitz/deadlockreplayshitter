#!/usr/bin/env python3
"""Sync a player's matches into web/data.

  1. pull the player's match history from deadlock-api
  2. locate demos: data/demos/, the game's replays folder, or a demo URL from deadlock-api
     salts (only for the selected heroes, downloaded + bz2-decompressed into data/demos)
  3. parse every available demo (in parallel) with parser/target/release/dlparse into
     web/data/matches/<id>.json.gz, reparsing when the parser's format version changed
  4. mirror Steam profiles of everyone in parsed matches, hero/ability/item icons and the
     minimap into web/
  5. write web/data/index.json

usage: python3 tools/sync.py [--account 76561198037066283] [--hero drifter] [--hero all]
                             [--steam-salts] [--reparse] [--no-download] [--jobs N]
"""
import argparse
import bz2
import gzip
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA = WEB / "data"
MATCHES = DATA / "matches"
ASSET_DIR = WEB / "assets"
DEMOS = ROOT / "data" / "demos"
MANIFEST = ROOT / "data" / "parsed.json"
FETCH_CACHE = ROOT / "data" / "fetch_cache.json"
NO_SALT_RECHECK = 6 * 3600  # someone may submit the salt later
PARSER = ROOT / "parser" / "target" / "release" / "dlparse"
GAME_REPLAYS = Path(os.environ.get(
    "DEADLOCK_REPLAYS", "/mnt/d/SteamLibrary/steamapps/common/Deadlock/game/citadel/replays"))
API = "https://api.deadlock-api.com"
STEAM_ID64_BASE = 76561197960265728
UA = {"User-Agent": "deadlock-replay-skill-hitter/0.2"}
# movement abilities kept out of the parser's `uses` (resolved to ids from live assets, so a
# patch that renumbers them doesn't silently flood the data)
NOISY_CLASSES = [
    "citadel_ability_zip_line", "citadel_ability_zipline_boost", "citadel_ability_mantle",
    "citadel_ability_climb_rope", "citadel_ability_jump", "citadel_ability_sprint",
    "citadel_ability_dash", "citadel_ability_slide", "citadel_ability_jump_ratking",
]


def log(*a):
    print(*a, flush=True)


def get_json(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def download(url, dest: Path, timeout=120):
    tmp = dest.with_name(dest.name + ".part")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.replace(dest)


def mirror(url, sub, name=None):
    """download url into web/assets/<sub>/ once; returns the site-relative path (or the url
    itself if the download fails, so the site still works online)."""
    if not url:
        return None
    name = name or url.rsplit("/", 1)[-1].split("?")[0]
    dest = ASSET_DIR / sub / name
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            download(url, dest)
        except (urllib.error.URLError, OSError) as e:
            log(f"  asset fail {url}: {e}")
            return url
    return f"assets/{sub}/{name}"


def to_account_id(v: str) -> int:
    n = int(v)
    return n - STEAM_ID64_BASE if n > STEAM_ID64_BASE else n


def parser_version():
    r = subprocess.run([str(PARSER), "--version"], capture_output=True, text=True)
    return int(r.stdout.strip() or 0)


def manifest_version(entry):
    """manifest entries were plain versions before warnings were tracked"""
    return entry if isinstance(entry, int) else (entry or {}).get("v")


def load_manifest():
    try:
        return json.loads(MANIFEST.read_text())
    except (OSError, ValueError):
        return {}


# ---------------------------------------------------------------- demos

def local_demos():
    """match_id -> demo path for every .dem we can see locally."""
    found = {}
    for d in (DEMOS, GAME_REPLAYS):
        if not d.exists():
            continue
        for p in d.glob("*.dem"):
            if p.stem.isdigit() and p.stat().st_size > 0:
                found.setdefault(int(p.stem), p)
    return found


def fetch_demo(match_id, steam_salts):
    """download via deadlock-api salts. returns (path|None, reason)."""
    url = f"{API}/v1/matches/{match_id}/salts"
    if not steam_salts:
        url += "?disable_steam=true"
    try:
        salts = get_json(url)
    except urllib.error.HTTPError as e:
        return None, f"salts http {e.code}"
    except urllib.error.URLError as e:
        return None, f"salts error {e.reason}"
    demo_url = salts.get("demo_url")
    if not demo_url:
        return None, "no replay salt known"
    DEMOS.mkdir(parents=True, exist_ok=True)
    bz = DEMOS / f"{match_id}.dem.bz2"
    log(f"  {match_id}: downloading {demo_url}")
    try:
        download(demo_url, bz, timeout=900)
    except urllib.error.HTTPError as e:
        return None, f"valve http {e.code} (demo deleted)"
    dem = DEMOS / f"{match_id}.dem"
    with bz2.open(bz, "rb") as src, open(dem, "wb") as dst:
        shutil.copyfileobj(src, dst, 1 << 20)
    bz.unlink()
    return dem, "downloaded"


def parse(match_id, demo: Path, ignore_ids=()):
    """run the parser, gzip its output. returns (ok, message, warnings)."""
    MATCHES.mkdir(parents=True, exist_ok=True)
    out = MATCHES / f"{match_id}.json.gz"
    part = out.with_name(out.name + ".part")
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "m.json"
        cmd = [str(PARSER), str(demo), str(raw), str(match_id)]
        if ignore_ids:
            cmd += ["--ignore-ids", ",".join(map(str, ignore_ids))]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            return False, f"parse failed: {r.stderr.strip()[-300:]}", []
        with open(raw, "rb") as src, gzip.open(part, "wb", 6) as dst:
            shutil.copyfileobj(src, dst)
        part.replace(out)
    (MATCHES / f"{match_id}.json").unlink(missing_ok=True)  # pre-gzip format
    lines = r.stderr.strip().splitlines()
    warnings = [l[len("warning: "):] for l in lines if l.startswith("warning: ")]
    summary = next((l for l in lines if l.startswith("ok:")), "ok")
    return True, summary, warnings


def read_match(match_id):
    with gzip.open(MATCHES / f"{match_id}.json.gz", "rt") as f:
        return json.load(f)


# ---------------------------------------------------------------- assets + profiles

def sync_ranks(badges):
    """rank names + a small image per badge (badge = tier * 10 + subrank)."""
    try:
        ranks = get_json(f"{API}/v1/assets/ranks")
    except (urllib.error.URLError, OSError) as e:
        log(f"ranks fetch failed: {e}")
        return {}
    by_tier = {r["tier"]: r for r in ranks}
    out = {}
    for b in sorted({b for b in badges if b}):
        tier, sub = divmod(b, 10)
        r = by_tier.get(tier)
        if not r:
            continue
        imgs = r.get("images") or {}
        url = imgs.get(f"small_subrank{sub}_webp") or imgs.get(f"small_subrank{sub}") or imgs.get("large_webp")
        out[b] = {"name": f"{r['name']} {sub}" if sub else r["name"],
                  "image": mirror(url, "ranks", f"{b}.webp")}
    return out


def sync_assets(heroes, items, used_heroes, used_items, badges=()):
    out_heroes = {}
    for h in heroes:
        img = h.get("images", {})
        used = h["id"] in used_heroes
        out_heroes[h["id"]] = {
            "name": h["name"],
            "class_name": h["class_name"],
            "icon": mirror(img.get("icon_image_small_webp"), "heroes"),
            "card": mirror(img.get("icon_hero_card_webp"), "heroes") if used else None,
            "minimap": mirror(img.get("minimap_image_webp"), "heroes") if used else None,
            "color": (h.get("colors") or {}).get("ui"),
            "signatures": [(h.get("items") or {}).get(f"signature{i}") for i in range(1, 5)],
            "weapon": (h.get("items") or {}).get("weapon_primary"),
        }
    out_items = {}
    for it in items:
        entry = {
            "class_name": it["class_name"],
            "name": it.get("name") or it["class_name"],
            "type": it.get("type"),
            "hero": it.get("hero"),
        }
        for k_src, k_dst in (("ability_type", "ability_type"), ("item_slot_type", "slot"),
                             ("item_tier", "tier"), ("cost", "cost")):
            if it.get(k_src):
                entry[k_dst] = it[k_src]
        wanted = (it.get("type") == "ability" and it.get("hero") in used_heroes) \
            or it["id"] in used_items
        if wanted:
            entry["image"] = mirror(
                it.get("shop_image_small_webp") or it.get("image_webp") or it.get("image")
                or it.get("shop_image_webp"),
                "abilities" if it.get("type") == "ability" else "items")
        out_items[it["id"]] = entry

    try:
        m = get_json(f"{API}/v1/assets/map")
        ziplines = []
        for z in m.get("zipline_paths") or []:
            ox, oy = z["origin"][0], z["origin"][1]
            ziplines.append({
                "color": z.get("color"),
                "points": [[round(ox + p[0]), round(oy + p[1])] for p in z.get("P0_points", [])],
            })
        game_map = {
            "radius": m.get("radius"),
            "image": mirror(m["images"].get("minimap"), "map"),
            "frame": mirror(m["images"].get("frame"), "map"),
            "ziplines": ziplines,
            # relative image coords (0..1), keys like team0_core / team1_tier2_3
            "objectives": m.get("objective_positions") or {},
        }
    except (urllib.error.URLError, KeyError) as e:
        log(f"map fetch failed: {e}")
        game_map = None

    (DATA / "assets.json").write_text(json.dumps(
        {"heroes": out_heroes, "items": out_items, "map": game_map, "ranks": sync_ranks(badges)}))
    log(f"assets: {len(out_heroes)} heroes, {len(out_items)} items")


def sync_profiles(account_ids):
    """steam name/avatar/profile url for every account seen; avatars mirrored locally."""
    out = {}
    ids = sorted(a for a in account_ids if a)
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        try:
            rows = get_json(f"{API}/v1/players/steam?account_ids={','.join(map(str, chunk))}")
        except (urllib.error.URLError, OSError) as e:
            log(f"profile fetch failed: {e}")
            continue
        for p in rows:
            aid = p["account_id"]
            out[aid] = {
                "name": p.get("personaname"),
                "url": p.get("profileurl")
                or f"https://steamcommunity.com/profiles/{aid + STEAM_ID64_BASE}/",
                "avatar": mirror(p.get("avatarfull") or p.get("avatarmedium") or p.get("avatar"),
                                 "avatars", f"{aid}.jpg"),
                "country": p.get("countrycode"),
                "matches_30d": p.get("matches_played_last_30d"),
            }
    (DATA / "profiles.json").write_text(json.dumps(out))
    log(f"profiles: {len(out)}")
    return out


CAREER_FIELDS = [
    "player_damage", "player_damage_taken", "player_healing", "shots_hit", "shots_missed",
    "hero_bullets_hit", "hero_bullets_hit_crit", "ability_kills", "bullet_kills", "melee_kills",
    "headshot_kills", "creep_kills", "neutral_kills", "boss_damage", "damage_mitigated",
    "heal_prevented", "net_worth", "level", "max_health", "weapon_power", "tech_power",
]
CAREER_CUSTOM = {
    "Enemy Hero Accuracy##Shots": "hero_shots",
    "Enemy Hero Accuracy##Hits": "hero_hits",
    "Enemy Hero Accuracy##Headshots": "hero_headshots",
    "Enemy Hero Accuracy - Incoming##Shots": "in_shots",
    "Enemy Hero Accuracy - Incoming##Hits": "in_hits",
    "Parry Miss": "parry_miss",
}


def sync_career(account):
    """end-of-match stats for every match deadlock-api has metadata for (no demo needed)."""
    url = (f"{API}/v1/matches/metadata?account_ids={account}&only_filtered_players=true"
           "&include_info=true&include_player_info=true&include_player_final_stats=true&limit=5000")
    try:
        rows = get_json(url, timeout=300)
    except (urllib.error.URLError, OSError) as e:
        log(f"career fetch failed: {e}")
        return
    out = []
    for m in rows:
        p = next((x for x in m.get("players", []) if x["account_id"] == account), None)
        if not p or not p.get("final_stats"):
            continue
        fs = p["final_stats"]
        cs = fs.get("custom_user_stats") or {}
        rec = {
            "match_id": m["match_id"],
            "hero_id": p["hero_id"],
            "duration_s": m["duration_s"],
            "won": m.get("winning_team") == p.get("team"),
            "kills": p.get("kills"), "deaths": p.get("deaths"), "assists": p.get("assists"),
            "badge": m.get("average_badge"),
            "mode": m.get("match_mode"),
        }
        for k in CAREER_FIELDS:
            rec[k] = fs.get(k)
        for k, short in CAREER_CUSTOM.items():
            rec[short] = cs.get(k)
        # outgoing ability damage by distance bucket (m): {"10": dmg, ...}
        rec["ability_dist"] = {k.split("##")[1]: v for k, v in cs.items()
                               if k.startswith("Outgoing Ability Dist##")}
        rec["bullet_dist"] = {k.split("##")[1]: v for k, v in cs.items()
                              if k.startswith("Outgoing Bullet Dist##")}
        out.append(rec)
    (DATA / "career.json").write_text(json.dumps(out))
    log(f"career: {len(out)} matches with end-of-match stats")


# ---------------------------------------------------------------- main

def resolve_heroes(heroes, wanted):
    if any(w.lower() == "all" for w in wanted):
        return None  # every hero
    ids = set()
    for w in wanted:
        h = w.lower()
        hero = next((x for x in heroes if str(x["id"]) == h or x["name"].lower() == h
                     or x["class_name"].lower() in (h, f"hero_{h}")), None)
        if not hero:
            sys.exit(f"unknown hero {w}")
        ids.add(hero["id"])
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", default="76561198037066283", help="steamid64 or account id")
    ap.add_argument("--hero", action="append", default=None,
                    help="hero name/class/id to download demos for (repeatable, or 'all')")
    ap.add_argument("--steam-salts", action="store_true",
                    help="let deadlock-api ask Steam for missing salts (10 req / 30 min)")
    ap.add_argument("--reparse", action="store_true")
    ap.add_argument("--no-download", action="store_true")
    ap.add_argument("--no-refetch", action="store_true", help="use deadlock-api's cached history")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    args = ap.parse_args()
    args.hero = args.hero or ["drifter"]

    if not PARSER.exists():
        sys.exit(f"parser missing: run tools/get-protoc.sh && cargo build --release in {ROOT / 'parser'}")
    pver = parser_version()
    account = to_account_id(args.account)
    heroes = get_json(f"{API}/v1/assets/heroes")
    items = get_json(f"{API}/v1/assets/items")
    ignore_ids = [it["id"] for it in items if it.get("class_name") in NOISY_CLASSES]
    if len(ignore_ids) != len(NOISY_CLASSES):
        log(f"note: only {len(ignore_ids)}/{len(NOISY_CLASSES)} movement abilities found in assets")
    selected = resolve_heroes(heroes, args.hero)
    names = "all heroes" if selected is None else ", ".join(
        h["name"] for h in heroes if h["id"] in selected)
    log(f"account {account}, downloading demos for {names}, parser v{pver}")

    hist_url = f"{API}/v1/players/{account}/match-history"
    try:  # refetch pulls matches newer than deadlock-api's cache (rate limited)
        history = get_json(hist_url + ("" if args.no_refetch else "?force_refetch=true"))
    except urllib.error.HTTPError as e:
        log(f"refetch failed ({e.code}), using cached history")
        history = get_json(hist_url)
    log(f"{len(history)} matches in history")

    demos = local_demos()
    manifest = load_manifest()
    status = {}

    # downloads (selected heroes only; sequential to be kind to Valve)
    try:
        fetch_cache = json.loads(FETCH_CACHE.read_text())
    except (OSError, ValueError):
        fetch_cache = {}
    now = time.time()
    for m in history:
        mid = m["match_id"]
        if mid in demos:
            status[mid] = "local demo"
            continue
        if selected is not None and m["hero_id"] not in selected:
            continue
        if args.no_download:
            status[mid] = "not downloaded (--no-download)"
            continue
        cached = fetch_cache.get(str(mid))
        if cached and (cached["dead"] or now - cached["at"] < NO_SALT_RECHECK) and not args.steam_salts:
            status[mid] = cached["why"]
            continue
        dem, why = fetch_demo(mid, args.steam_salts)
        status[mid] = why
        if dem:
            demos[mid] = dem
            fetch_cache.pop(str(mid), None)
        else:
            fetch_cache[str(mid)] = {"why": why, "at": now, "dead": "valve http" in why}
    FETCH_CACHE.parent.mkdir(parents=True, exist_ok=True)
    FETCH_CACHE.write_text(json.dumps(fetch_cache))

    # parse (parallel)
    jobs = []
    for m in history:
        mid = m["match_id"]
        if mid not in demos:
            continue
        have = (MATCHES / f"{mid}.json.gz").exists() and manifest_version(manifest.get(str(mid))) == pver
        if have and not args.reparse:
            status[mid] += "; parsed"
            continue
        jobs.append(mid)
    if jobs:
        log(f"parsing {len(jobs)} demos with {args.jobs} workers")
        with ThreadPoolExecutor(args.jobs) as ex:
            futs = {ex.submit(parse, mid, demos[mid], ignore_ids): mid for mid in jobs}
            for f in as_completed(futs):
                mid = futs[f]
                ok, msg, warnings = f.result()
                log(f"  {mid}: {msg}" + "".join(f"\n    warning: {w}" for w in warnings))
                if ok:
                    manifest[str(mid)] = {"v": pver, "warnings": warnings}
                    status[mid] += "; parsed"
                else:
                    manifest[str(mid)] = {"v": pver, "error": msg}
                    status[mid] += f"; {msg}"
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(json.dumps(manifest))

    # gather what the parsed matches reference
    used_heroes, used_items, accounts = set(), set(), {account}
    for m in history:
        if not (MATCHES / f"{m['match_id']}.json.gz").exists():
            continue
        pj = read_match(m["match_id"])
        for p in pj["players"]:
            used_heroes.add(p["hero_id"])
            accounts.add(p["account_id"])
        used_items.update(i[2] for i in pj.get("items", []))
    if selected:
        used_heroes |= selected

    DATA.mkdir(parents=True, exist_ok=True)
    sync_assets(heroes, items, used_heroes, used_items, [m.get("ranked_display_badge") for m in history])
    profiles = sync_profiles(accounts)
    sync_career(account)

    entries = []
    for m in history:
        mid = m["match_id"]
        man = manifest.get(str(mid))
        entries.append({
            "match_id": mid,
            "start_time": m.get("start_time", 0),
            "duration_s": m.get("match_duration_s", 0),
            "hero_id": m.get("hero_id", 0),
            "kills": m.get("player_kills", 0),
            "deaths": m.get("player_deaths", 0),
            "assists": m.get("player_assists", 0),
            "net_worth": m.get("net_worth", 0),
            "last_hits": m.get("last_hits", 0),
            "level": m.get("hero_level", 0),
            "won": m.get("match_result") == m.get("player_team"),
            "mode": m.get("match_mode"),
            "warnings": (man or {}).get("warnings", []) if isinstance(man, dict) else [],
            "parse_error": (man or {}).get("error") if isinstance(man, dict) else None,
            "badge": m.get("ranked_display_badge"),
            "rank_delta": m.get("ranked_delta"),
            "parsed": (MATCHES / f"{mid}.json.gz").exists(),
            "status": status.get(mid, "not tried (hero not selected)"),
        })
    if selected and len(selected) == 1:
        default_hero = next(iter(selected))
    else:
        default_hero = max(used_heroes or {0}, key=lambda h: sum(
            e["parsed"] and e["hero_id"] == h for e in entries))
    (DATA / "index.json").write_text(json.dumps({
        "account_id": account,
        "profile": profiles.get(account),
        "generated": int(time.time()),
        "parser_version": pver,
        "health": {
            "parsed": sum(1 for e in entries if e["parsed"]),
            "failed": [e["match_id"] for e in entries if e["parse_error"]],
            "warned": [e["match_id"] for e in entries if e["warnings"]],
        },
        "default_hero": default_hero,
        "matches": entries,
    }))
    ok = sum(e["parsed"] for e in entries)
    log(f"done: {ok} parsed matches ({len(entries)} in history) -> {DATA / 'index.json'}")


if __name__ == "__main__":
    main()
