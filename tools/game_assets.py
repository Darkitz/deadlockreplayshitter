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
SCRIPTS = ["heroes", "abilities", "modifiers", "accolades", "ping_wheel_messages"]
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


# ---------------------------------------------------------------- post-game UI art

# white shapes the site tints in team / stat colors, like the game's post-game screens
UI_FILES = {
    "logo_team2": "panorama/images/hud/core/logo_team1.vsvg_c",   # demo team 2 = "Hidden King"
    "logo_team3": "panorama/images/hud/core/logo_team2.vsvg_c",   # demo team 3 = "Archmother"
    "sigil_team2": "panorama/images/post_game/nav_icon_team1_png.vtex_c",
    "sigil_team3": "panorama/images/post_game/nav_icon_team2_png.vtex_c",
    "starburst": "panorama/images/post_game/starburst_team1.vsvg_c",
    "mvp_trophy": "panorama/images/post_game/mvp_trophy.vsvg_c",
    "key_trophy": "panorama/images/post_game/key_player_trophy.vsvg_c",
    "icon_kill": "panorama/images/post_game/attributes/icon_kill.vsvg_c",
    "icon_heal": "panorama/images/post_game/attributes/icon_heart.vsvg_c",
    "icon_playerdmg": "panorama/images/post_game/attributes/icon_playerdmg.vsvg_c",
    "icon_objdmg": "panorama/images/post_game/attributes/icon_objdmg.vsvg_c",
    "icon_souls": "panorama/images/post_game/attributes/icon_souls.vsvg_c",
}
UI_DIR = ICON_DIR / "ui"
# sounds: Rem's reply when Violet asks him to stop invading her dreams (match start convo 03)
SOUND_FILES = {"rem": "sounds/vo/familiar/familiar_match_start_artist_familiar_convo03_07.vsnd_c"}


def extract_ui():
    """post-game UI art -> web/assets/game/ui/<name>.svg|png; returns {name: site path}"""
    out, todo = {}, {}
    for name, vpk in {**UI_FILES, **SOUND_FILES}.items():
        ext = "svg" if vpk.endswith(".vsvg_c") else "mp3" if vpk.endswith(".vsnd_c") else "png"
        dest = UI_DIR / f"{name}.{ext}"
        out[name] = f"assets/game/ui/{name}.{ext}"
        if not dest.exists():
            todo[name] = (vpk, dest)
    if todo:
        tmp = CACHE / "ui_tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        # one file per call: VRF treats -o as the output *file* when given a single file
        for vpk, _ in todo.values():
            out_file = tmp / vpk.replace(".vsvg_c", ".svg").replace(".vtex_c", ".png").replace(".vsnd_c", ".mp3")
            out_file.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run([str(VRF), "-i", str(VPK), "-d", "-o", str(out_file), "-f", vpk], capture_output=True)
        UI_DIR.mkdir(parents=True, exist_ok=True)
        for name, (vpk, dest) in todo.items():
            src = tmp / vpk.replace(".vsvg_c", ".svg").replace(".vtex_c", ".png").replace(".vsnd_c", ".mp3")
            if src.exists():
                shutil.move(src, dest)
            else:
                out.pop(name)
        shutil.rmtree(tmp, ignore_errors=True)
    return out


# ---------------------------------------------------------------- ability profiles

try:
    PROFILES = json.loads((ROOT / "tools" / "ability_profiles.json").read_text())
except (OSError, ValueError):
    PROFILES = {}
try:
    OVERRIDES = {k: v for k, v in json.loads((ROOT / "tools" / "ability_overrides.json").read_text()).items() if not k.startswith("_")}
except (OSError, ValueError):
    OVERRIDES = {}


# ---------------------------------------------------------------- chat wheel

SERVER_DLL = GAME / "bin" / "win64" / "server.dll"


def ping_concepts():
    """CITADEL_PING_* concept names in enum order, read from the enum's string table in
    server.dll (the names sit back to back in declaration order, starting with ..._NONE)."""
    try:
        blob = SERVER_DLL.read_bytes()
    except OSError:
        return []
    i = blob.find(b"CITADEL_PING_CONCEPT_NONE\0")
    names = []
    while i >= 0:
        j = blob.index(b"\0", i)
        name = blob[i:j].decode("ascii", "replace")
        if not name.startswith("CITADEL_PING_"):
            break
        names.append(name)
        i = j
        while i < len(blob) and blob[i] == 0:  # alignment padding
            i += 1
    return names


LANE_COLORS = ("yellow", "green", "blue", "purple")


def build_pings(loc):
    """chat wheel message id (as demos send it) -> {concept, text, lanes: {color: text}}. Demos
    carry the concept's position in the enum minus one (NONE = -1). Lane-specific variants
    ("Headed to York" / "Headed to Broadway") are keyed by lane color; the site picks one from
    the voice line the ping played."""
    def clean(text):
        text = re.sub(r"\{[^}]*\}", "…", text)
        return re.sub(r"<[^>]+>", "", text).replace('\\"', '"').strip()

    by_concept = {}
    for key, msg in load_script("ping_wheel_messages").items():
        if not isinstance(msg, dict) or not msg.get("m_ePingConcept"):
            continue
        toks = [(msg.get(k) or "").lstrip("#").lower() for k in ("m_strMessageToken", "m_strCommsWheelLabelToken")]
        text = next((loc[t] for t in toks if t in loc), key)
        entry = by_concept.setdefault(msg["m_ePingConcept"], {"text": clean(text), "lanes": {}})
        ident = f"{key} {toks[0]}".lower()
        color = next((c for c in LANE_COLORS if c in ident), None)
        if color:
            entry["lanes"].setdefault(color, clean(text))
    out = {}
    for i, concept in enumerate(ping_concepts()):
        if i == 0:
            continue
        nice = concept.removeprefix("CITADEL_PING_").replace("_", " ").capitalize()
        e = by_concept.get(concept, {"text": nice, "lanes": {}})
        out[i - 1] = {"concept": concept, "text": e["text"], **({"lanes": e["lanes"]} if e["lanes"] else {})}
    return out


def lane_names(loc):
    """lane color -> in-game lane name (York, Broadway, ...)"""
    return {c: loc[f"citadel_lanename{c}"] for c in LANE_COLORS if f"citadel_lanename{c}" in loc}


# ---------------------------------------------------------------- assets.json

SLOT = {"EItemSlotType_WeaponMod": "weapon", "EItemSlotType_Armor": "vitality", "EItemSlotType_Tech": "spirit"}
TYPE = {"EAbilityType_Item": "upgrade", "EAbilityType_Weapon": "weapon"}


def build_assets(previous=None):
    """assets.json content from the game files (`previous` is accepted for compatibility)."""
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
        # how to score it (see tools/profile_abilities.py): measured in real matches where we have
        # enough casts, otherwise guessed from the game's own flags
        behaviors = str(a.get("m_AbilityBehaviorsBits", ""))
        activation = str(a.get("m_eAbilityActivation", ""))
        props_all = a.get("m_mapAbilityProperties") or {}
        prof = PROFILES.get(key)
        if activation.endswith("PASSIVE"):
            entry["kind"] = "proc"
        elif prof:
            entry["kind"] = prof["kind"]
            if prof.get("window"):
                entry["window"] = prof["window"]
        else:
            def num(k):
                v = props_all.get(k)
                v = v.get("m_strValue") if isinstance(v, dict) else v
                try:
                    return float(str(v).rstrip("sm"))
                except (TypeError, ValueError):
                    return 0.0
            hurts = any(k for k in props_all if ("Damage" in k or k in ("DPS", "StunDuration", "SlowPercent", "SilenceDuration"))
                        and "Reduction" not in k and "Resist" not in k and "Bonus" not in k and num(k) > 0)
            if "CAN_HEAL_PLAYERS" in behaviors and not hurts:
                entry["kind"] = "support"
            elif hurts:
                entry["kind"] = "offensive"
                dur = min(num("AbilityDuration"), 10.0) + num("AbilityCastDelay")
                if dur > 2:
                    entry["window"] = round(dur + 1, 1)
            else:
                entry["kind"] = "self"
        # "your next N bullets / shots are empowered" abilities (Living Ink, Slam Fire, Hellfire
        # Salvo, ...): the gun fires the projectiles, so the site scores each one
        props = a.get("m_mapAbilityProperties") or {}
        for pk in ("MaxShots", "ShotCount", "DemonShotCount"):
            pv = props.get(pk)
            pv = pv.get("m_strValue") if isinstance(pv, dict) else pv
            try:
                n = int(float(str(pv)))
            except (TypeError, ValueError):
                continue
            if n >= 1:
                entry["shots"] = n
                dur = props.get("AbilityDuration")
                dur = dur.get("m_strValue") if isinstance(dur, dict) else dur
                try:
                    entry["shot_window"] = float(str(dur).rstrip("s")) or 10.0
                except (TypeError, ValueError):
                    entry["shot_window"] = 10.0
                break
        if atype == "EAbilityType_Weapon":
            infos = a.get("m_mapWeaponInfos") or {}
            primary = infos.get("primary") if isinstance(infos, dict) else None
            weapon = primary if isinstance(primary, dict) else (a.get("m_WeaponInfo") or {})
            entry["pellets"] = weapon.get("m_iBullets") or 1
            entry["bullet_damage"] = weapon.get("m_flBulletDamage")
            if entry["name"] == key and entry["hero"] in heroes:
                # some guns are localized under an older hero codename; name them after the hero
                entry["name"] = f"{heroes[entry['hero']]['name']}'s gun"
        # how long its effects last (channels, durations): damage is summed over this
        def numv(k):
            v = props_all.get(k)
            v = v.get("m_strValue") if isinstance(v, dict) else v
            try:
                x = float(str(v).rstrip("sm"))
            except (TypeError, ValueError):
                return 0.0
            return 0.0 if x >= 999 else x
        effect = numv("AbilityCastDelay") + max(numv("AbilityDuration"), numv("AbilityChannelTime"))
        if effect > 0:
            entry["effect"] = round(min(effect, 20.0), 2)
        # hand-reviewed scoring (tools/ability_overrides.json) wins over measured / guessed
        for k, v in (OVERRIDES.get(key) or {}).items():
            if k != "note":
                entry[k] = v
        if img:
            entry["image"] = site_icon(img)
        items[token_id(key)] = entry

    # helper abilities without their own localization ("ability_artist_rollingprojectile_trigger")
    # are named after the ability they belong to: "Flow State (recast)"
    by_class = {e["class_name"]: e for e in items.values()}
    nice_suffix = {"trigger": "recast", "end": "end", "alt": "alt", "activate": "activate"}
    for e in items.values():
        if e["name"] != e["class_name"]:
            continue
        parts = e["class_name"].split("_")
        for cut in range(len(parts) - 1, 1, -1):
            parent = by_class.get("_".join(parts[:cut]))
            if parent and parent["name"] != parent["class_name"]:
                extra = " ".join(nice_suffix.get(w, w) for w in parts[cut:])
                e["name"] = f"{parent['name']} ({extra})"
                e["parent"] = parent["class_name"]
                break

    modifiers = {token_id(k): k for k in modifiers_kv if isinstance(modifiers_kv[k], dict) and not k.startswith("_")}

    accolades = {}
    for key, a in accolades_kv.items():
        if isinstance(a, dict) and a.get("m_unAccoladeID"):
            flavor = (a.get("m_sFlavorName") or "").lstrip("#").split(":")[0]
            pretty = (a.get("m_sTrackedStatName") or key).replace("_", " ").title()
            accolades[a["m_unAccoladeID"]] = {"name": name_of(flavor, pretty), "stat": a.get("m_sTrackedStatName")}

    # current ranked UI (panorama/styles/citadel_ranked_badge.css): one emblem per tier
    # (rankNN_sm/_lg) with the subrank drawn on top as a label; the rankN/badge_*_subrankN
    # frames are the previous system
    ranks = {}
    for tier in range(0, 12):
        tname = loc.get(f"citadel_ranks_{tier}") or f"Rank {tier}"
        sm = f"panorama/images/ranked/badges/rank{tier:02d}_sm_psd.vtex_c"
        lg = f"panorama/images/ranked/badges/rank{tier:02d}_lg_psd.vtex_c"
        icons.update((sm, lg))
        for sub in range(0, 7):
            ranks[tier * 10 + sub] = {"name": f"{tname} {sub}" if sub else tname, "tier": tier,
                                      "subrank": sub, "image": site_icon(sm), "image_lg": site_icon(lg)}

    minimap = "panorama/images/minimap/base/minimap_midtown_mid_psd.vtex_c"
    icons.add(minimap)
    # zipline paths + objective positions aren't in these scripts; a static overlay ships with
    # the repo (tools/map_overlay.json)
    try:
        overlay = json.loads((ROOT / "tools" / "map_overlay.json").read_text())
    except (OSError, ValueError):
        overlay = {}
    game_map = {
        "radius": MAP_RADIUS,
        "image": site_icon(minimap),
        "ziplines": overlay.get("ziplines", []),
        "objectives": overlay.get("objectives", {}),
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
        for k in ("image", "image_lg"):
            if r.get(k) and not (ROOT / "web" / r[k]).exists():
                r[k] = None

    return {"heroes": heroes, "items": items, "map": game_map, "ranks": ranks,
            "accolades": accolades, "modifiers": modifiers, "pings": build_pings(loc), "lanes": lane_names(loc),
            # team 2 / 3 in demos; the in-game names (the post-game graphs use these short forms)
            "teams": {"2": loc.get("citadel_graph_team1", "Amber"), "3": loc.get("citadel_graph_team2", "Sapphire")},
            "ui": extract_ui(),
            "source": "game files"}


if __name__ == "__main__":
    out = ROOT / "web" / "data" / "assets.json"
    try:
        prev = json.loads(out.read_text())
    except (OSError, ValueError):
        prev = None
    a = build_assets(prev)
    out.write_text(json.dumps(a))
    # in-game style tooltips (loaded by the site on first hover)
    from ability_tips import build_tips
    keep = {e["class_name"] for e in a["items"].values() if e.get("hero") or e.get("tier") or e.get("parent")}
    tips = build_tips(load_script("abilities"), load_localization(), keep)
    (out.parent / "tips.json").write_text(json.dumps(tips, separators=(",", ":")))
    print(f"{len(a['heroes'])} heroes, {len(a['items'])} abilities/items, {len(a['modifiers'])} modifiers, "
          f"{len(a['accolades'])} accolades -> {out}")
