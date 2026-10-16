#!/usr/bin/env python3
"""Hero / ability / item / modifier / accolade / rank data and icons from the local Deadlock
install (no web API).

  - scripts/*.vdata_c and panorama images are read from game/citadel/pak01_dir.vpk with
    Source2Viewer-CLI (tools/get-vrf.sh)
  - display names come from game/citadel/resource/localization/*/*_english.txt
  - ability / item / modifier ids are Valve string tokens: MurmurHash2(lowercase name, 0x31415926)

build_assets() returns the same structure the site has always used (web/data/assets.json) and
writes icons to web/assets/game/. Results are cached per VPK modification time.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAME = Path(os.environ.get("DEADLOCK_GAME", "/mnt/d/SteamLibrary/steamapps/common/Deadlock/game/citadel"))
VPK = GAME / "pak01_dir.vpk"
LOCALIZATION = GAME / "resource" / "localization"
VRF = ROOT / "tools" / ".vrf" / "Source2Viewer-CLI"
CACHE = ROOT / "data" / "game"
ICON_DIR = ROOT / "web" / "assets" / "game"
SCRIPTS = ["heroes", "abilities", "modifiers", "accolades"]
MAP_RADIUS = 10752  # world units covered by the minimap image (half its width)


def murmur2(data: bytes, seed=0x31415926):
    m, r = 0x5BD1E995, 24
    h = (seed ^ len(data)) & 0xFFFFFFFF
    i, n = 0, len(data)
    while n - i >= 4:
        k = int.from_bytes(data[i:i + 4], "little")
        k = (k * m) & 0xFFFFFFFF
        k ^= k >> r
        k = (k * m) & 0xFFFFFFFF
        h = (h * m) & 0xFFFFFFFF
        h ^= k
        i += 4
    rem = n - i
    if rem == 3:
        h ^= data[i + 2] << 16
    if rem >= 2:
        h ^= data[i + 1] << 8
    if rem >= 1:
        h ^= data[i]
        h = (h * m) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * m) & 0xFFFFFFFF
    h ^= h >> 15
    return h


def token_id(name: str) -> int:
    return murmur2(name.lower().encode())


# ---------------------------------------------------------------- KV3 (text) parser

_TOKEN = re.compile(r'''
    (?P<ws>\s+|//[^\n]*|/\*.*?\*/|<!--.*?-->)
  | (?P<multistr>"""(?:.|\n)*?""")
  | (?P<str>"(?:[^"\\]|\\.)*")
  | (?P<punct>[{}\[\]=,])
  | (?P<prefix>[A-Za-z_][\w]*:(?=\s*["{\[]))
  | (?P<word>[^\s{}\[\]=,"]+)
''', re.S | re.X)


def parse_kv3(text: str):
    tokens = []
    for m in _TOKEN.finditer(text):
        kind = m.lastgroup
        if kind == "ws" or kind == "prefix":  # type prefixes (resource_name:, panorama:) dropped
            continue
        tokens.append((kind, m.group(kind)))
    pos = 0

    def value():
        nonlocal pos
        kind, tok = tokens[pos]
        pos += 1
        if tok == "{":
            obj = {}
            while tokens[pos][1] != "}":
                key = tokens[pos][1].strip('"')
                pos += 1
                assert tokens[pos][1] == "=", f"expected = after {key}"
                pos += 1
                obj[key] = value()
            pos += 1
            return obj
        if tok == "[":
            arr = []
            while tokens[pos][1] != "]":
                if tokens[pos][1] == ",":
                    pos += 1
                    continue
                arr.append(value())
            pos += 1
            return arr
        if kind == "multistr":
            return tok[3:-3]
        if kind == "str":
            return tok[1:-1]
        if tok in ("true", "false"):
            return tok == "true"
        if tok == "null":
            return None
        try:
            return int(tok)
        except ValueError:
            try:
                return float(tok)
            except ValueError:
                return tok

    return value()


# ---------------------------------------------------------------- game files

def _vpk_stamp():
    return int(VPK.stat().st_mtime) if VPK.exists() else 0


def extract_scripts():
    """decompile scripts/*.vdata_c into data/game/scripts (only when the VPK changed)."""
    stamp_file = CACHE / "stamp.json"
    stamp = _vpk_stamp()
    try:
        if json.loads(stamp_file.read_text()).get("vpk") == stamp:
            return
    except (OSError, ValueError):
        pass
    if not VRF.exists():
        sys.exit("Source2Viewer-CLI missing: run tools/get-vrf.sh")
    files = ",".join(f"scripts/{s}.vdata_c" for s in SCRIPTS)
    subprocess.run([str(VRF), "-i", str(VPK), "-d", "-o", str(CACHE), "-f", files],
                   check=True, capture_output=True)
    stamp_file.write_text(json.dumps({"vpk": stamp}))


def load_script(name):
    return parse_kv3((CACHE / "scripts" / f"{name}.vdata").read_text(encoding="utf-8"))


def load_localization(lang="english"):
    """every token from resource/localization/*/*_<lang>.txt; keys lowercased, ':n'-style
    suffixes stripped."""
    tokens = {}
    line = re.compile(r'^\s*"([^"]+)"\s+"((?:[^"\\]|\\.)*)"')
    for f in sorted(LOCALIZATION.glob(f"*/*_{lang}.txt")):
        for raw in f.read_text(encoding="utf-8-sig", errors="replace").splitlines():
            m = line.match(raw)
            if m:
                key = m.group(1).split(":")[0].lower()
                tokens.setdefault(key, m.group(2))
    return tokens


def panorama_path(ref):
    """'file://{images}/heroes/drifter_sm.psd' -> 'panorama/images/heroes/drifter_sm_psd.vtex_c'"""
    if not ref or not isinstance(ref, str) or "{images}" not in ref:
        return None
    p = ref.split("{images}/", 1)[1]
    stem, _, ext = p.rpartition(".")
    if ext not in ("psd", "png", "tga", "jpg"):
        return None
    return f"panorama/images/{stem}_{ext}.vtex_c"


def site_icon(vpk_path):
    """site-relative path of an extracted icon"""
    rel = vpk_path[len("panorama/images/"):].replace(".vtex_c", ".png")
    return f"assets/game/{rel}"


def extract_icons(vpk_paths):
    """extract (and decode to png) every icon not already on disk"""
    todo = sorted({p for p in vpk_paths if p and not (ROOT / "web" / site_icon(p)).exists()})
    if not todo:
        return
    tmp = CACHE / "icons_tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    for i in range(0, len(todo), 200):  # keep the command line reasonable
        subprocess.run([str(VRF), "-i", str(VPK), "-d", "-o", str(tmp), "-f", ",".join(todo[i:i + 200])],
                       capture_output=True)
    for p in todo:
        src = tmp / p.replace(".vtex_c", ".png")
        if src.exists():
            dest = ROOT / "web" / site_icon(p)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(src, dest)
    shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- assets.json

SLOT = {"EItemSlotType_WeaponMod": "weapon", "EItemSlotType_Armor": "vitality", "EItemSlotType_Tech": "spirit"}
TYPE = {"EAbilityType_Item": "upgrade", "EAbilityType_Weapon": "weapon"}


def build_assets(previous=None):
    """assets.json content from the game files. `previous` (the old assets.json) only supplies
    map zipline/objective overlays, which aren't in these scripts."""
    extract_scripts()
    loc = load_localization()
    heroes_kv = load_script("heroes")
    abilities_kv = load_script("abilities")
    modifiers_kv = load_script("modifiers")
    accolades_kv = load_script("accolades")
    icons = set()

    def name_of(key, fallback=None):
        return loc.get(key.lower()) or fallback or key

    heroes, ability_hero = {}, {}
    for key, h in heroes_kv.items():
        if not key.startswith("hero_") or not isinstance(h, dict) or not h.get("m_HeroID"):
            continue
        bound = h.get("m_mapBoundAbilities") or {}
        sigs = [bound.get(f"ESlot_Signature_{i}") for i in range(1, 5)]
        for slot, cls in bound.items():
            if isinstance(cls, str):
                ability_hero.setdefault(cls, h["m_HeroID"])
        imgs = {k: panorama_path(h.get(v)) for k, v in (
            ("icon", "m_strIconImageSmall"), ("card", "m_strIconHeroCard"), ("minimap", "m_strMinimapImage"))}
        icons.update(p for p in imgs.values() if p)
        heroes[h["m_HeroID"]] = {
            "name": name_of(key, key.replace("hero_", "").title()),
            "class_name": key,
            **{k: site_icon(p) if p else None for k, p in imgs.items()},
            "color": None,
            "signatures": sigs,
            "weapon": bound.get("ESlot_Weapon_Primary"),
            "disabled": bool(h.get("m_bDisabled")),
        }

    items = {}
    for key, a in abilities_kv.items():
        if not isinstance(a, dict) or key.startswith("_") or "_class" in a and key.endswith("_base"):
            continue
        atype = a.get("m_eAbilityType")
        if not atype:
            continue
        img = panorama_path(a.get("m_strShopIconLarge") if atype == "EAbilityType_Item" else None) \
            or panorama_path(a.get("m_strAbilityImage"))
        if img:
            icons.add(img)
        entry = {
            "class_name": key,
            "name": name_of(key),
            "type": TYPE.get(atype, "ability"),
            "hero": ability_hero.get(key),
        }
        if atype not in TYPE:
            entry["ability_type"] = atype.replace("EAbilityType_", "").lower()
        if a.get("m_eItemSlotType") in SLOT:
            entry["slot"] = SLOT[a["m_eItemSlotType"]]
        tier = str(a.get("m_iItemTier") or "")
        if tier.startswith("EModTier_"):
            entry["tier"] = int(tier.rsplit("_", 1)[1])
        if atype == "EAbilityType_Weapon":
            infos = a.get("m_mapWeaponInfos") or {}
            primary = infos.get("primary") if isinstance(infos, dict) else None
            weapon = primary if isinstance(primary, dict) else (a.get("m_WeaponInfo") or {})
            entry["pellets"] = weapon.get("m_iBullets") or 1
            entry["bullet_damage"] = weapon.get("m_flBulletDamage")
            if entry["name"] == key and entry["hero"] in heroes:
                # some guns are localized under an older hero codename; name them after the hero
                entry["name"] = f"{heroes[entry['hero']]['name']}'s gun"
        if img:
            entry["image"] = site_icon(img)
        items[token_id(key)] = entry

    modifiers = {token_id(k): k for k in modifiers_kv if isinstance(modifiers_kv[k], dict) and not k.startswith("_")}

    accolades = {}
    for key, a in accolades_kv.items():
        if isinstance(a, dict) and a.get("m_unAccoladeID"):
            flavor = (a.get("m_sFlavorName") or "").lstrip("#").split(":")[0]
            pretty = (a.get("m_sTrackedStatName") or key).replace("_", " ").title()
            accolades[a["m_unAccoladeID"]] = {"name": name_of(flavor, pretty), "stat": a.get("m_sTrackedStatName")}

    ranks = {}
    for tier in range(0, 12):
        tname = loc.get(f"citadel_ranks_{tier}") or f"Rank {tier}"
        for sub in range(0, 7):
            p = (f"panorama/images/ranked/badges/rank{tier}/badge_sm_subrank{sub}_psd.vtex_c" if sub
                 else f"panorama/images/ranked/badges/rank{tier}/badge_sm_psd.vtex_c")
            icons.add(p)
            ranks[tier * 10 + sub] = {"name": f"{tname} {sub}" if sub else tname, "image": site_icon(p)}

    minimap = "panorama/images/minimap/base/minimap_midtown_mid_psd.vtex_c"
    icons.add(minimap)
    old_map = (previous or {}).get("map") or {}
    game_map = {
        "radius": MAP_RADIUS,
        "image": site_icon(minimap),
        "ziplines": old_map.get("ziplines", []),
        "objectives": old_map.get("objectives", {}),
    }

    extract_icons(icons)
    # drop icon paths that failed to extract (keeps the UI's placeholders working)
    for h in heroes.values():
        for k in ("icon", "card", "minimap"):
            if h.get(k) and not (ROOT / "web" / h[k]).exists():
                h[k] = None
    for it in items.values():
        if it.get("image") and not (ROOT / "web" / it["image"]).exists():
            del it["image"]
    for r in ranks.values():
        if not (ROOT / "web" / r["image"]).exists():
            r["image"] = None

    return {"heroes": heroes, "items": items, "map": game_map, "ranks": ranks,
            "accolades": accolades, "modifiers": modifiers, "source": "game files"}


if __name__ == "__main__":
    out = ROOT / "web" / "data" / "assets.json"
    try:
        prev = json.loads(out.read_text())
    except (OSError, ValueError):
        prev = None
    a = build_assets(prev)
    out.write_text(json.dumps(a))
    print(f"{len(a['heroes'])} heroes, {len(a['items'])} abilities/items, {len(a['modifiers'])} modifiers, "
          f"{len(a['accolades'])} accolades -> {out}")
