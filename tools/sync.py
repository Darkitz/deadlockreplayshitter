#!/usr/bin/env python3
"""Sync a player's matches on one hero into web/data.

Steps per match:
  1. find the demo: data/demos/<id>.dem, the game's replays folder, or a demo URL from
     deadlock-api salts (downloaded + bz2-decompressed into data/demos)
  2. parse it with parser/target/release/dlparse into web/data/matches/<id>.json
  3. write web/data/index.json with every match (parsed or not, and why)

Also mirrors hero/ability names + icons from the deadlock-api assets into web/data/assets.json
and web/assets/.

usage: python3 tools/sync.py [--account 76800555] [--hero drifter] [--steam-salts] [--reparse]
"""
import argparse
import bz2
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA = WEB / "data"
MATCHES = DATA / "matches"
ASSET_DIR = WEB / "assets"
DEMOS = ROOT / "data" / "demos"
PARSER = ROOT / "parser" / "target" / "release" / "dlparse"
GAME_REPLAYS = Path("/mnt/d/SteamLibrary/steamapps/common/Deadlock/game/citadel/replays")
API = "https://api.deadlock-api.com"
STEAM_ID64_BASE = 76561197960265728
UA = {"User-Agent": "deadlock-replay-skill-hitter/0.1"}


def log(*a):
    print(*a, flush=True)


def get_json(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def download(url, dest: Path, timeout=120):
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.replace(dest)


def to_account_id(v: str) -> int:
    n = int(v)
    return n - STEAM_ID64_BASE if n > STEAM_ID64_BASE else n


# ---------------------------------------------------------------- assets

def sync_assets(hero_ids):
    """hero + ability names/icons for every hero seen, mirrored locally."""
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    heroes = get_json(f"{API}/v1/assets/heroes")
    items = get_json(f"{API}/v1/assets/items")

    def mirror(url, sub):
        if not url:
            return None
        name = url.rsplit("/", 1)[-1]
        dest = ASSET_DIR / sub / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            try:
                download(url, dest)
            except (urllib.error.URLError, OSError) as e:
                log(f"  asset fail {url}: {e}")
                return url  # fall back to remote
        return f"assets/{sub}/{name}"

    out_heroes = {}
    for h in heroes:
        img = h.get("images", {})
        full = h["id"] in hero_ids
        out_heroes[h["id"]] = {
            "name": h["name"],
            "class_name": h["class_name"],
            "icon": mirror(img.get("icon_image_small_webp"), "heroes") if full else img.get("icon_image_small_webp"),
            "card": mirror(img.get("icon_hero_card_webp"), "heroes") if full else None,
            "color": (h.get("colors") or {}).get("ui"),
        }

    out_items = {}
    for it in items:
        hero = it.get("hero")
        is_hero_ability = it.get("type") == "ability" and hero in hero_ids
        entry = {
            "class_name": it["class_name"],
            "name": it.get("name") or it["class_name"],
            "type": it.get("type"),
            "ability_type": it.get("ability_type"),
            "hero": hero,
        }
        if is_hero_ability:
            entry["image"] = mirror(it.get("image_webp") or it.get("image"), "abilities")
        out_items[it["id"]] = entry

    # slot order (signature1..4) so the UI can list abilities like the in-game HUD
    order = {}
    for h in heroes:
        if h["id"] in hero_ids:
            order[h["id"]] = [
                (h.get("items") or {}).get(f"signature{i}") for i in range(1, 5)
            ]
    (DATA / "assets.json").write_text(
        json.dumps({"heroes": out_heroes, "items": out_items, "signatures": order})
    )
    log(f"assets: {len(out_heroes)} heroes, {len(out_items)} items")
    return out_heroes


# ---------------------------------------------------------------- demos

def sync_profile(account):
    """steam name, profile url and avatar (mirrored locally)."""
    try:
        rows = get_json(f"{API}/v1/players/steam?account_ids={account}")
    except (urllib.error.URLError, OSError) as e:
        log(f"profile fetch failed: {e}")
        return None
    if not rows:
        return None
    p = rows[0]
    avatar = p.get("avatarfull") or p.get("avatar")
    if avatar:
        dest = ASSET_DIR / "avatars" / f"{account}.jpg"
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            download(avatar, dest)
            avatar = f"assets/avatars/{account}.jpg"
        except (urllib.error.URLError, OSError) as e:
            log(f"avatar download failed: {e}")
    log(f"profile: {p.get('personaname')}")
    return {
        "name": p.get("personaname"),
        "url": p.get("profileurl") or f"https://steamcommunity.com/profiles/{account + STEAM_ID64_BASE}/",
        "avatar": avatar,
        "country": p.get("countrycode"),
        "matches_30d": p.get("matches_played_last_30d"),
    }


def find_local_demo(match_id):
    for p in (DEMOS / f"{match_id}.dem", GAME_REPLAYS / f"{match_id}.dem"):
        if p.exists() and p.stat().st_size > 0:
            return p
    return None


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
        return None, "no demo salt known (download in-game or via GC)"
    DEMOS.mkdir(parents=True, exist_ok=True)
    bz = DEMOS / f"{match_id}.dem.bz2"
    log(f"  downloading {demo_url}")
    try:
        download(demo_url, bz, timeout=600)
    except urllib.error.HTTPError as e:
        return None, f"valve http {e.code} (demo expired?)"
    dem = DEMOS / f"{match_id}.dem"
    with bz2.open(bz, "rb") as src, open(dem, "wb") as dst:
        shutil.copyfileobj(src, dst, 1 << 20)
    bz.unlink()
    return dem, "downloaded"


def parse(match_id, demo: Path, reparse):
    out = MATCHES / f"{match_id}.json"
    if out.exists() and not reparse:
        return True, "cached"
    MATCHES.mkdir(parents=True, exist_ok=True)
    r = subprocess.run([str(PARSER), str(demo), str(out), str(match_id)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return False, f"parse failed: {r.stderr.strip()[-300:]}"
    return True, r.stderr.strip()


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", default="76561198037066283", help="steamid64 or account id")
    ap.add_argument("--hero", default="drifter", help="hero name, class name or id")
    ap.add_argument("--steam-salts", action="store_true",
                    help="let deadlock-api ask Steam for missing salts (10 req / 30 min)")
    ap.add_argument("--reparse", action="store_true")
    ap.add_argument("--no-download", action="store_true")
    args = ap.parse_args()

    if not PARSER.exists():
        sys.exit(f"parser missing: build it with `cargo build --release` in {ROOT / 'parser'}")

    account = to_account_id(args.account)
    heroes = get_json(f"{API}/v1/assets/heroes")
    h = args.hero.lower()
    hero = next((x for x in heroes if str(x["id"]) == h or x["name"].lower() == h
                 or x["class_name"].lower() in (h, f"hero_{h}")), None)
    if not hero:
        sys.exit(f"unknown hero {args.hero}")
    log(f"account {account}, hero {hero['name']} ({hero['id']})")

    try:  # refetch pulls matches newer than deadlock-api's cache (rate limited)
        history = get_json(f"{API}/v1/players/{account}/match-history?force_refetch=true")
    except urllib.error.HTTPError as e:
        log(f"refetch failed ({e.code}), using cached history")
        history = get_json(f"{API}/v1/players/{account}/match-history")
    picks = [m for m in history if m["hero_id"] == hero["id"]]
    log(f"{len(history)} matches in history, {len(picks)} on {hero['name']}")

    entries = []
    seen_heroes = {hero["id"]}
    for m in picks:
        mid = m["match_id"]
        log(f"match {mid}")
        demo = find_local_demo(mid)
        reason = "local demo" if demo else "not downloaded (--no-download)"
        if not demo and not args.no_download:
            demo, reason = fetch_demo(mid, args.steam_salts)
        parsed = False
        if demo:
            parsed, msg = parse(mid, demo, args.reparse)
            reason = f"{reason}; {msg}"
        if parsed:
            pj = json.loads((MATCHES / f"{mid}.json").read_text())
            seen_heroes.update(p["hero_id"] for p in pj["players"])
        log(f"  -> {'OK' if parsed else 'missing'}: {reason}")
        entries.append({
            "match_id": mid,
            "start_time": m["start_time"],
            "duration_s": m["match_duration_s"],
            "hero_id": m["hero_id"],
            "kills": m["player_kills"],
            "deaths": m["player_deaths"],
            "assists": m["player_assists"],
            "net_worth": m["net_worth"],
            "won": m["match_result"] == m["player_team"],
            "parsed": parsed,
            "status": reason,
        })

    sync_assets(seen_heroes)
    profile = sync_profile(account)
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "index.json").write_text(json.dumps({
        "account_id": account,
        "profile": profile,
        "hero_id": hero["id"],
        "generated": int(time.time()),
        "matches": entries,
    }, indent=1))
    ok = sum(e["parsed"] for e in entries)
    log(f"done: {ok}/{len(entries)} matches parsed -> {DATA / 'index.json'}")


if __name__ == "__main__":
    main()
