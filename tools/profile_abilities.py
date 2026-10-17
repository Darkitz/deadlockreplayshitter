#!/usr/bin/env python3
"""Profile how every ability / active item behaves in real matches, so the site can score each
one by what it is for (tools/game_assets.py merges the result into assets.json).

  python3 tools/profile_abilities.py [demo JSON files or folders ...]

Default input: web/data/matches/*.json.gz (parsed demos) and any *.json given. For every cast
(ImportantAbilityUsed) it looks at the ability's effects until the next cast of it (max 20 s):
damage, status notifications and modifiers (buffs / debuffs) the caster applied with it, and
who they landed on: an enemy hero, a non-hero (troopers, objectives), an ally hero, the caster
only, or nobody. From that:

  kind     offensive (hurts / debuffs enemies) · support (heals / shields allies)
           · self (buffs, mobility, utility: effects on the caster only, or none)
  window   seconds after the cast within which ~80% of first enemy effects land (traps, fuses
           and slow projectiles need more than the default hit window)

Output: tools/ability_profiles.json  {class_name: {kind, window, casts, enemy, npc, ally, self, none}}
"""
import gzip
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tools" / "ability_profiles.json"
MAX_WINDOW = 20.0
MIN_CASTS = 8


def load(path):
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt") as f:
        return json.load(f)


def files(args):
    paths = [Path(a) for a in args] or [ROOT / "web" / "data" / "matches"]
    for p in paths:
        if p.is_dir():
            yield from sorted(p.glob("*.json.gz"))
            yield from sorted(p.glob("*.json"))
        elif p.exists():
            yield p


def percentile(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def main():
    assets = json.loads((ROOT / "web" / "data" / "assets.json").read_text())
    cls_of = {int(k): v["class_name"] for k, v in assets["items"].items()}
    id_of = {v: k for k, v in cls_of.items()}
    stats = defaultdict(lambda: {"casts": 0, "enemy": 0, "npc": 0, "ally": 0, "self": 0, "none": 0, "delays": []})
    n_files = 0
    for path in files(sys.argv[1:]):
        d = load(path)
        n_files += 1
        team = {p["pawn"]: p["team"] for p in d["players"]}
        effects = defaultdict(list)  # (caster, ability id) -> [(t, target pawn or -1)]
        for x in d.get("damage", []):
            effects[(x[1], x[4])].append((x[0], x[3]))
        for x in d.get("notify", []):
            effects[(x[1], x[3])].append((x[0], x[2]))
        for x in d.get("modifiers", []):
            effects[(x[3], x[5])].append((x[0], x[2] if x[2] in team else -1))
        for v in effects.values():
            v.sort()
        by_ability = defaultdict(list)
        for c in d.get("casts", []):
            by_ability[(c[1], c[2])].append(c[0])
        for (caster, cls), times in by_ability.items():
            aid = id_of.get(cls)
            if aid is None or caster not in team:
                continue
            ev = effects.get((caster, aid), [])
            times.sort()
            for i, t in enumerate(times):
                end = min(t + MAX_WINDOW, times[i + 1] if i + 1 < len(times) else math.inf)
                s = stats[cls]
                s["casts"] += 1
                seen = set()
                first_enemy = None
                for et, tgt in ev:
                    if et < t - 0.05:
                        continue
                    if et > end:
                        break
                    if tgt < 0:
                        seen.add("npc")
                    elif tgt == caster:
                        seen.add("self")
                    elif team.get(tgt) == team[caster]:
                        seen.add("ally")
                    else:
                        seen.add("enemy")
                        if first_enemy is None:
                            first_enemy = et - t
                for k in seen:
                    s[k] += 1
                if not seen:
                    s["none"] += 1
                if first_enemy is not None:
                    s["delays"].append(first_enemy)

    out = {}
    for cls, s in sorted(stats.items()):
        n = s["casts"]
        if n < MIN_CASTS:
            continue
        rate = lambda k: s[k] / n
        # NPC-only tools (Cultist Sacrifice) aren't offensive: hero accuracy means nothing there
        if rate("enemy") >= 0.03 and rate("enemy") + rate("npc") >= 0.15:
            kind = "offensive"
        elif rate("ally") >= 0.15:
            kind = "support"
        else:
            kind = "self"
        p80 = percentile(s["delays"], 0.8)
        window = round(min(15.0, max(1.0, p80 + 0.5)), 1) if p80 is not None else None
        out[cls] = {"kind": kind, "window": window, "casts": n,
                    **{k: round(rate(k), 3) for k in ("enemy", "npc", "ally", "self", "none")}}
    OUT.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    kinds = defaultdict(int)
    for v in out.values():
        kinds[v["kind"]] += 1
    print(f"{len(out)} abilities from {n_files} demos -> {OUT.relative_to(ROOT)}: {dict(kinds)}")


if __name__ == "__main__":
    main()
