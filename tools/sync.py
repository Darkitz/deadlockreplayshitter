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
CONFIG = ROOT / "data" / "config.json"
DEFAULT_ACCOUNT = 76800555
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


SALTS_CACHE = ROOT / "data" / "salts.json"
_salts = None


def get_salts(match_id, steam_salts=False):
    """deadlock-api's salts for a match (the only per-match thing we ask it for), cached:
    metadata salts never change; a missing replay salt is asked again after NO_SALT_RECHECK."""
    global _salts
    if _salts is None:
        try:
            _salts = json.loads(SALTS_CACHE.read_text())
        except (OSError, ValueError):
            _salts = {}
    c = _salts.get(str(match_id))
    if c and (c.get("demo_url") or time.time() - c.get("at", 0) < NO_SALT_RECHECK) and not steam_salts:
        return c
    url = f"{API}/v1/matches/{match_id}/salts" + ("" if steam_salts else "?disable_steam=true")
    try:
        got = get_json(url)
    except urllib.error.HTTPError as e:
        got = {"error": f"salts http {e.code}"}
    except urllib.error.URLError as e:
        return {"error": f"salts error {e.reason}"}
    rec = {k: got.get(k) for k in ("metadata_url", "demo_url", "error")}
    rec["at"] = time.time()
    _salts[str(match_id)] = rec
    SALTS_CACHE.parent.mkdir(parents=True, exist_ok=True)
    SALTS_CACHE.write_text(json.dumps(_salts))
    return rec


def fetch_demo(match_id, steam_salts):
    """download the demo from Valve using deadlock-api's salt. returns (path|None, reason)."""
    salts = get_salts(match_id, steam_salts)
    if salts.get("error"):
        return None, salts["error"]
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
        wi = it.get("weapon_info") or {}
        if it.get("type") == "weapon" and wi:
            entry["pellets"] = wi.get("bullets") or 1
            entry["bullet_damage"] = wi.get("bullet_damage")
        wanted = (it.get("type") == "ability" and it.get("hero") in used_heroes) \
            or it["id"] in used_items
        remote = (it.get("shop_image_small_webp") or it.get("image_webp") or it.get("image")
                  or it.get("shop_image_webp"))
        if remote:
            entry["image_remote"] = remote
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

    try:
        modifiers = {m["id"]: m.get("class_name") for m in get_json(f"{API}/v1/assets/modifiers")}
    except (urllib.error.URLError, OSError):
        modifiers = {}
    try:
        accolades = {a["id"]: {"name": a.get("flavor_name") or a.get("class_name"), "stat": a.get("tracked_stat_name")}
                     for a in get_json(f"{API}/v1/assets/accolades")}
    except (urllib.error.URLError, OSError):
        accolades = {}
    (DATA / "assets.json").write_text(json.dumps(
        {"heroes": out_heroes, "items": out_items, "map": game_map, "ranks": sync_ranks(badges),
         "accolades": accolades, "modifiers": modifiers}))
    log(f"assets: {len(out_heroes)} heroes, {len(out_items)} items")


STEAM_CACHE = ROOT / "data" / "steam_profiles.json"
STEAM_TTL = 3600          # re-read a profile at most once an hour
STEAM_MAX_PER_RUN = 60    # Steam answers ~1 profile/s; the rest refresh on later syncs


def _steam_profile(aid):
    """name + avatar from steamcommunity's public XML (no API key needed)."""
    import re
    url = f"https://steamcommunity.com/profiles/{aid + STEAM_ID64_BASE}/?xml=1"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        xml = r.read().decode("utf-8", "replace")
    def tag(name):
        m = re.search(rf"<{name}>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{name}>", xml, re.S)
        return m.group(1).strip() if m else None
    if "<profile>" not in xml:
        raise OSError("no profile")
    return {"name": tag("steamID"), "avatar_src": tag("avatarFull") or tag("avatarMedium"),
            "url": f"https://steamcommunity.com/profiles/{aid + STEAM_ID64_BASE}/"}


def sync_profiles(account_ids):
    """Steam name/avatar/profile url for every account seen, straight from Steam, cached 1 h.
    Avatars are mirrored to web/assets/avatars/ (re-downloaded only when they change)."""
    try:
        cache = {int(k): v for k, v in json.loads(STEAM_CACHE.read_text()).items()}
    except (OSError, ValueError):
        cache = {}
    now = time.time()
    ids = sorted(a for a in account_ids if a)
    stale = [a for a in ids if now - cache.get(a, {}).get("at", 0) > STEAM_TTL]
    # tracked / recently seen first would be nicer; newest accounts first is a fine proxy
    todo = stale[:STEAM_MAX_PER_RUN]

    def fetch(aid):
        try:
            return aid, _steam_profile(aid)
        except (urllib.error.URLError, OSError, ValueError):
            return aid, None

    with ThreadPoolExecutor(6) as ex:
        for aid, prof in ex.map(fetch, todo):
            old = cache.get(aid, {})
            if prof is None:
                cache[aid] = {**old, "at": now}  # keep what we had, retry in an hour
                continue
            avatar = old.get("avatar")
            if prof["avatar_src"] and (prof["avatar_src"] != old.get("avatar_src") or not avatar):
                dest = ASSET_DIR / "avatars" / f"{aid}.jpg"
                dest.parent.mkdir(parents=True, exist_ok=True)
                try:
                    download(prof["avatar_src"], dest)
                    avatar = f"assets/avatars/{aid}.jpg"
                except (urllib.error.URLError, OSError):
                    avatar = prof["avatar_src"]
            cache[aid] = {**prof, "avatar": avatar, "at": now}
    STEAM_CACHE.parent.mkdir(parents=True, exist_ok=True)
    STEAM_CACHE.write_text(json.dumps(cache))
    out = {aid: {"name": c.get("name"), "url": c.get("url"), "avatar": c.get("avatar")}
           for aid, c in cache.items() if aid in set(ids) and c.get("name")}
    (DATA / "profiles.json").write_text(json.dumps(out))
    log(f"profiles: {len(out)} ({len(todo)} refreshed from Steam, {len(stale) - len(todo)} left for later)")
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


META_DIR = DATA / "meta"
META_MISSING = ROOT / "data" / "meta_missing.json"


DLMETA = ROOT / "parser" / "target" / "release" / "dlmeta"


def fetch_metadata(mid):
    """Valve's .meta file via the metadata salt → JSON (decoded locally with dlmeta)."""
    salts = get_salts(mid)
    url = salts.get("metadata_url")
    if not url:
        return None, salts.get("error") or "no metadata salt"
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "m.meta"
        try:
            download(url, raw, timeout=120)
        except urllib.error.HTTPError as e:
            return None, f"valve http {e.code}"
        if raw.read_bytes()[:3] == b"BZh":  # older matches
            data = bz2.decompress(raw.read_bytes())
            raw.write_bytes(data)
        out = Path(tmp) / "m.json"
        r = subprocess.run([str(DLMETA), str(raw), str(out)], capture_output=True, text=True)
        if r.returncode != 0:
            return None, f"decode failed: {r.stderr.strip()[-200:]}"
        return out.read_bytes(), "ok"


def sync_metadata(match_ids):
    """Valve's full match metadata (objectives, per-player stat timelines, items, deaths,
    damage matrix, 1 Hz position paths, ...) as web/data/meta/<id>.json.gz, downloaded from
    Valve's replay servers with the metadata salt and decoded locally. Misses retry after a day."""
    META_DIR.mkdir(parents=True, exist_ok=True)
    try:
        missing = json.loads(META_MISSING.read_text())
    except (OSError, ValueError):
        missing = {}
    now = time.time()
    todo = [m for m in match_ids
            if not (META_DIR / f"{m}.json.gz").exists() and now - missing.get(str(m), 0) >= 86400]

    def one(mid):
        return mid, *fetch_metadata(mid)

    got = 0
    with ThreadPoolExecutor(4) as ex:
        for mid, raw, why in ex.map(one, todo):
            dest = META_DIR / f"{mid}.json.gz"
            if raw is None:
                missing[str(mid)] = now
                log(f"  metadata {mid}: {why}")
                continue
            with gzip.open(dest.with_name(dest.name + ".part"), "wb", 6) as f:
                f.write(raw)
            dest.with_name(dest.name + ".part").replace(dest)
            missing.pop(str(mid), None)
            got += 1
    META_MISSING.write_text(json.dumps(missing))
    log(f"metadata: {got} new, {len(list(META_DIR.glob('*.json.gz')))} total")


VALVE_STATS = DATA / "valve-stats.json"
VALVE_FIELDS = ["shots_hit", "shots_missed", "hero_bullets_hit", "hero_bullets_hit_crit",
                "player_damage", "player_damage_taken", "player_healing", "net_worth", "kills",
                "deaths", "assists", "headshot_kills", "bullet_kills", "ability_kills", "melee_kills"]


def _meta_player_stats(mi, p):
    """final stats + named custom stats of one player from a metadata match_info"""
    names = {c["id"]: c["name"] for c in mi.get("custom_user_stats") or [] if c.get("name")}
    fs = (p.get("stats") or [{}])[-1]
    custom = fs.get("custom_user_stats") or []
    cs = custom if isinstance(custom, dict) else {names.get(c.get("id")): c.get("value") for c in custom}
    return fs, cs


def digest_metadata(accounts):
    """valve-stats.json (every player of every match with metadata) and career-<acc>.json
    (tracked players), computed from the local metadata files."""
    valve, careers = {}, {a: [] for a in accounts}
    for f in sorted(META_DIR.glob("*.json.gz")) if META_DIR.exists() else []:
        try:
            with gzip.open(f, "rt") as fh:
                mi = json.load(fh).get("match_info") or {}
        except (OSError, ValueError):
            continue
        mid = mi.get("match_id") or int(f.name.split(".")[0])
        per = {}
        for p in mi.get("players") or []:
            fs, cs = _meta_player_stats(mi, p)
            rec = {k: fs.get(k) for k in VALVE_FIELDS}
            for k, short in CAREER_CUSTOM.items():
                rec[short] = cs.get(k)
            per[p.get("account_id")] = rec
            if p.get("account_id") in careers:
                c = {
                    "match_id": mid, "hero_id": p.get("hero_id"), "duration_s": mi.get("duration_s"),
                    "won": mi.get("winning_team") == p.get("team"),
                    "kills": p.get("kills"), "deaths": p.get("deaths"), "assists": p.get("assists"),
                    "badge": None, "mode": mi.get("match_mode"),
                }
                for k in CAREER_FIELDS:
                    c[k] = fs.get(k)
                for k, short in CAREER_CUSTOM.items():
                    c[short] = cs.get(k)
                c["ability_dist"] = {k.split("##")[1]: v for k, v in cs.items()
                                     if k and k.startswith("Outgoing Ability Dist##")}
                c["bullet_dist"] = {k.split("##")[1]: v for k, v in cs.items()
                                    if k and k.startswith("Outgoing Bullet Dist##")}
                careers[p["account_id"]].append(c)
        valve[str(mid)] = per
    (DATA / "valve-stats.json").write_text(json.dumps(valve))
    for acc, rows in careers.items():
        (DATA / f"career-{acc}.json").write_text(json.dumps(rows))
    log(f"metadata digest: {len(valve)} matches, career rows {sum(len(r) for r in careers.values())}")


def write_match_list(indexes):
    """web/data/matches.json: every parsed match (any account) with its 12 players."""
    tracked = {}
    for idx in indexes:
        for e in idx["matches"]:
            tracked.setdefault(e["match_id"], []).append((idx["account_id"], e))
    try:
        old = {m["match_id"]: m for m in json.loads((DATA / "matches.json").read_text())}
    except (OSError, ValueError):
        old = {}
    out = []
    for f in MATCHES.glob("*.json.gz"):
        mid = int(f.name.split(".")[0])
        prev = old.get(mid)
        if prev and prev.get("_mtime") == int(f.stat().st_mtime) and mid not in tracked:
            out.append(prev)
            continue
        pj = read_match(mid)
        players = [{"account_id": p["account_id"], "hero_id": p["hero_id"], "team": p["team"],
                    "name": p["name"], "k": p["kills"], "d": p["deaths"], "a": p["assists"],
                    "nw": p["net_worth"]} for p in pj["players"]]
        rec = {"match_id": mid, "duration_s": round(pj.get("game_over_s") or pj["duration_s"]),
               "start_time": None, "winner": pj.get("winning_team"), "mode": None, "_mtime": int(f.stat().st_mtime),
               "players": players}
        # winner + start time: from a tracked player's history, else Valve metadata
        for acc, e in tracked.get(mid, []):
            me = next((p for p in players if p["account_id"] == acc), None)
            rec["start_time"] = e["start_time"]
            rec["mode"] = e.get("mode")
            if me and rec["winner"] is None:
                rec["winner"] = me["team"] if e["won"] else ({2: 3, 3: 2}.get(me["team"]))
        meta = META_DIR / f"{mid}.json.gz"
        if (rec["winner"] is None or rec["start_time"] is None) and meta.exists():
            with gzip.open(meta, "rt") as fh:
                mi = json.load(fh).get("match_info", {})
            rec["start_time"] = rec["start_time"] or mi.get("start_time")
            if mi.get("winning_team") is not None:
                rec["winner"] = 2 + int(mi["winning_team"])  # Team0 = Amber (2), Team1 = Sapphire (3)
        if prev and rec["start_time"] is None:
            rec["start_time"] = prev.get("start_time")
        out.append(rec)
    out.sort(key=lambda r: -(r["start_time"] or 0))
    (DATA / "matches.json").write_text(json.dumps(out))
    log(f"match list: {len(out)} parsed matches")


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


def load_config():
    try:
        cfg = json.loads(CONFIG.read_text())
    except (OSError, ValueError):
        cfg = {}
    cfg.setdefault("accounts", [DEFAULT_ACCOUNT])
    cfg.setdefault("heroes", ["drifter"])
    return cfg


def save_config(cfg):
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps(cfg, indent=1))


class Ctx:
    """per-run shared state: assets, demos on disk, parse manifest, failed-download cache"""

    def __init__(self, args):
        self.args = args
        self.pver = parser_version()
        self.heroes = get_json(f"{API}/v1/assets/heroes")
        self.items = get_json(f"{API}/v1/assets/items")
        self.ignore_ids = [it["id"] for it in self.items if it.get("class_name") in NOISY_CLASSES]
        if len(self.ignore_ids) != len(NOISY_CLASSES):
            log(f"note: only {len(self.ignore_ids)}/{len(NOISY_CLASSES)} movement abilities found in assets")
        self.selected = resolve_heroes(self.heroes, args.hero)
        self.demos = local_demos()
        self.manifest = load_manifest()
        try:
            self.fetch_cache = json.loads(FETCH_CACHE.read_text())
        except (OSError, ValueError):
            self.fetch_cache = {}
        self.used_heroes, self.used_items, self.accounts = set(), set(), set()
        self.badges = []
        self.meta_ids = set()
        self.all_ids = set()


def sync_account(ctx, account):
    args = ctx.args
    selected = ctx.selected
    names = "all heroes" if selected is None else ", ".join(
        h["name"] for h in ctx.heroes if h["id"] in selected)
    log(f"== account {account}: demos for {names}, parser v{ctx.pver}")

    hist_url = f"{API}/v1/players/{account}/match-history"
    try:  # refetch pulls matches newer than deadlock-api's cache (rate limited)
        history = get_json(hist_url + ("" if args.no_refetch else "?force_refetch=true"))
    except urllib.error.HTTPError as e:
        log(f"refetch failed ({e.code}), using cached history")
        history = get_json(hist_url)
    log(f"{len(history)} matches in history")

    demos, manifest, status = ctx.demos, ctx.manifest, {}

    # downloads (selected heroes only; sequential to be kind to Valve)
    now = time.time()
    for m in history:
        mid = m["match_id"]
        if mid in demos:
            status[mid] = "local demo"
            continue
        if selected is not None and m.get("hero_id") not in selected:
            continue
        if args.no_download:
            status[mid] = "not downloaded (--no-download)"
            continue
        cached = ctx.fetch_cache.get(str(mid))
        if cached and (cached["dead"] or now - cached["at"] < NO_SALT_RECHECK) and not args.steam_salts:
            status[mid] = cached["why"]
            continue
        dem, why = fetch_demo(mid, args.steam_salts)
        status[mid] = why
        if dem:
            demos[mid] = dem
            ctx.fetch_cache.pop(str(mid), None)
        else:
            ctx.fetch_cache[str(mid)] = {"why": why, "at": now, "dead": "valve http" in why}
    FETCH_CACHE.parent.mkdir(parents=True, exist_ok=True)
    FETCH_CACHE.write_text(json.dumps(ctx.fetch_cache))

    # parse (parallel); the manifest is shared, so a demo is parsed once for all accounts
    jobs = []
    for m in history:
        mid = m["match_id"]
        if mid not in demos:
            continue
        have = (MATCHES / f"{mid}.json.gz").exists() and manifest_version(manifest.get(str(mid))) == ctx.pver
        if have and not args.reparse:
            status[mid] += "; parsed"
            continue
        jobs.append(mid)
    if jobs:
        log(f"parsing {len(jobs)} demos with {args.jobs} workers")
        with ThreadPoolExecutor(args.jobs) as ex:
            futs = {ex.submit(parse, mid, demos[mid], ctx.ignore_ids): mid for mid in jobs}
            for f in as_completed(futs):
                mid = futs[f]
                ok, msg, warnings = f.result()
                log(f"  {mid}: {msg}" + "".join(f"\n    warning: {w}" for w in warnings))
                if ok:
                    manifest[str(mid)] = {"v": ctx.pver, "warnings": warnings}
                    status[mid] += "; parsed"
                else:
                    manifest[str(mid)] = {"v": ctx.pver, "error": msg}
                    status[mid] += f"; {msg}"
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(json.dumps(manifest))

    # gather what the parsed matches reference
    hero_parsed = {}
    ctx.accounts.add(account)
    for m in history:
        if not (MATCHES / f"{m['match_id']}.json.gz").exists():
            continue
        pj = read_match(m["match_id"])
        for p in pj["players"]:
            ctx.used_heroes.add(p["hero_id"])
            ctx.accounts.add(p["account_id"])
        ctx.used_items.update(i[2] for i in pj.get("items", []))
        hero_parsed[m.get("hero_id")] = hero_parsed.get(m.get("hero_id"), 0) + 1
    if selected:
        ctx.used_heroes |= selected
    ctx.badges += [m.get("ranked_display_badge") for m in history]
    ctx.all_ids |= {m["match_id"] for m in history}
    ctx.meta_ids |= {m["match_id"] for m in history
                     if (MATCHES / f"{m['match_id']}.json.gz").exists()
                     or selected is None or m.get("hero_id") in selected}


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
    if selected and len(selected) == 1 and hero_parsed.get(next(iter(selected))):
        default_hero = next(iter(selected))
    else:
        default_hero = max(hero_parsed or {0: 0}, key=lambda h: hero_parsed.get(h, 0))
    return {
        "account_id": account,
        "generated": int(time.time()),
        "parser_version": ctx.pver,
        "health": {
            "parsed": sum(1 for e in entries if e["parsed"]),
            "failed": [e["match_id"] for e in entries if e["parse_error"]],
            "warned": [e["match_id"] for e in entries if e["warnings"]],
        },
        "default_hero": default_hero,
        "matches": entries,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", action="append", default=None,
                    help="steamid64 or account id for this run (repeatable); default: data/config.json")
    ap.add_argument("--add-account", action="append", default=[], help="remember an account in data/config.json")
    ap.add_argument("--remove-account", action="append", default=[], help="forget an account")
    ap.add_argument("--hero", action="append", default=None,
                    help="hero name/class/id to download demos for (repeatable, or 'all')")
    ap.add_argument("--steam-salts", action="store_true",
                    help="let deadlock-api ask Steam for missing salts (10 req / 30 min)")
    ap.add_argument("--reparse", action="store_true")
    ap.add_argument("--no-download", action="store_true")
    ap.add_argument("--no-refetch", action="store_true", help="use deadlock-api's cached history")
    ap.add_argument("--no-meta", action="store_true", help="skip Valve match metadata downloads")
    ap.add_argument("--meta-all", action="store_true",
                    help="download metadata for every match in history (career stats for all heroes)")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    args = ap.parse_args()

    cfg = load_config()
    for a in args.add_account:
        if to_account_id(a) not in cfg["accounts"]:
            cfg["accounts"].append(to_account_id(a))
    for a in args.remove_account:
        cfg["accounts"] = [x for x in cfg["accounts"] if x != to_account_id(a)]
    if args.hero:
        cfg["heroes"] = args.hero
    if args.add_account or args.remove_account or args.hero:
        save_config(cfg)
    args.hero = cfg["heroes"]
    accounts = [to_account_id(a) for a in args.account] if args.account else cfg["accounts"]

    if not PARSER.exists():
        sys.exit(f"parser missing: run tools/get-protoc.sh && cargo build --release in {ROOT / 'parser'}")
    DATA.mkdir(parents=True, exist_ok=True)
    ctx = Ctx(args)

    indexes = []
    for acc in accounts:
        idx = sync_account(ctx, acc)
        args.reparse = False  # later accounts reuse what the first run reparsed
        indexes.append(idx)

    # demos parsed for other (not synced now) accounts: keep their format current too
    stale = [int(p.name.split(".")[0]) for p in MATCHES.glob("*.json.gz")
             if manifest_version(ctx.manifest.get(p.name.split(".")[0])) != ctx.pver
             and int(p.name.split(".")[0]) in ctx.demos]
    if stale:
        log(f"reparsing {len(stale)} demos with an outdated format")
        with ThreadPoolExecutor(args.jobs) as ex:
            futs = {ex.submit(parse, mid, ctx.demos[mid], ctx.ignore_ids): mid for mid in stale}
            for f in as_completed(futs):
                mid = futs[f]
                ok, msg, warnings = f.result()
                ctx.manifest[str(mid)] = ({"v": ctx.pver, "warnings": warnings} if ok
                                          else {"v": ctx.pver, "error": msg})
        MANIFEST.write_text(json.dumps(ctx.manifest))

    sync_assets(ctx.heroes, ctx.items, ctx.used_heroes, ctx.used_items, ctx.badges)
    if not args.no_meta:
        parsed_ids = {int(p.name.split(".")[0]) for p in MATCHES.glob("*.json.gz")}
        wanted = ctx.meta_ids | parsed_ids
        if args.meta_all:
            wanted |= ctx.all_ids
        sync_metadata(sorted(wanted, reverse=True))
    digest_metadata([idx["account_id"] for idx in indexes])
    # players from downloaded metadata (matches without a demo) get profiles too
    for f in META_DIR.glob("*.json.gz") if META_DIR.exists() else []:
        try:
            with gzip.open(f, "rt") as fh:
                ctx.accounts.update(p.get("account_id") for p in json.load(fh).get("match_info", {}).get("players", []))
        except (OSError, ValueError):
            continue
    profiles = sync_profiles(ctx.accounts)
    for idx in indexes:
        idx["profile"] = profiles.get(idx["account_id"])
        (DATA / f"index-{idx['account_id']}.json").write_text(json.dumps(idx))

    write_match_list(indexes)

    # the account list the site's switcher shows (everything synced so far, newest run first)
    try:
        known = json.loads((DATA / "accounts.json").read_text())
    except (OSError, ValueError):
        known = []
    listed = {a["account_id"]: a for a in known}
    for idx in indexes:
        listed[idx["account_id"]] = {
            "account_id": idx["account_id"],
            "name": (idx["profile"] or {}).get("name") or str(idx["account_id"]),
            "avatar": (idx["profile"] or {}).get("avatar"),
            "parsed": idx["health"]["parsed"],
            "matches": len(idx["matches"]),
        }
    order = [a for a in cfg["accounts"] if a in listed] + [a for a in listed if a not in cfg["accounts"]]
    (DATA / "accounts.json").write_text(json.dumps([listed[a] for a in order]))
    for idx in indexes:
        log(f"done {idx['account_id']}: {idx['health']['parsed']} parsed matches ({len(idx['matches'])} in history)")


if __name__ == "__main__":
    main()
