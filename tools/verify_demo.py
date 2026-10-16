#!/usr/bin/env python3
"""Decide whether a demo file someone hands you is the real recording of a match.

  python3 tools/verify_demo.py path/to/<match_id>.dem[.bz2] [--match <id>]

Two independent checks:

1. Byte hash (only for the original .dem.bz2, needs the replay salt): Valve's replay servers
   are Google Cloud Storage buckets and answer a HEAD request with the file's md5
   (x-goog-hash). Deadlock itself saves the *decompressed* .dem, so in-game downloads can't be
   checked this way.
2. Content cross-check (works for any .dem, needs only the metadata salt): parse the demo and
   compare it with Valve's match metadata: the same 12 accounts on the same heroes and teams,
   per-player kills/deaths/assists, the winner and the match length. Forging a demo that agrees
   with Valve on all of that is impractical.

Exit code 0 = verified, 1 = mismatch, 2 = could not check.
"""
import argparse
import base64
import bz2
import gzip
import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sync  # noqa: E402  (salts cache, metadata download, paths)


def md5_b64(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return base64.b64encode(h.digest()).decode()


def valve_md5(url):
    req = urllib.request.Request(url, method="HEAD", headers=sync.UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        for v in r.headers.get_all("x-goog-hash") or []:
            for part in v.split(","):
                k, _, val = part.strip().partition("=")
                if k == "md5":
                    return val
    return None


def load_metadata(mid):
    local = sync.META_DIR / f"{mid}.json.gz"
    if local.exists():
        with gzip.open(local, "rt") as f:
            return json.load(f).get("match_info")
    raw, why = sync.fetch_metadata(mid)
    if raw is None:
        print(f"  metadata unavailable: {why}")
        return None
    return json.loads(raw).get("match_info")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("demo")
    ap.add_argument("--match", type=int, help="match id (default: from the file name)")
    args = ap.parse_args()
    path = Path(args.demo)
    mid = args.match or int(path.name.split(".")[0].split("_")[0])
    print(f"match {mid}: {path}")
    verdicts = []

    # 1. byte hash: against Valve while the file exists, else against what sync recorded
    salts = sync.get_salts(mid)
    try:
        known = json.loads(sync.HASHES.read_text()).get(str(mid), {})
    except (OSError, ValueError):
        known = {}
    if path.suffix != ".bz2" and known.get("dem_sha256"):
        sha = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 22), b""):
                sha.update(chunk)
        same = sha.hexdigest() == known["dem_sha256"]
        print(f"  sha256 vs recorded copy: {'identical' if same else 'DIFFERENT'}")
        verdicts.append(same)
    if path.suffix == ".bz2" and (salts.get("demo_url") or known.get("valve_md5")):
        remote = None
        try:
            remote = valve_md5(salts["demo_url"]) if salts.get("demo_url") else None
        except OSError:
            pass
        remote = remote or known.get("valve_md5")
        local = md5_b64(path)
        same = remote == local
        print(f"  md5 vs Valve: {'identical' if same else 'DIFFERENT'} ({local} / {remote})")
        verdicts.append(same)
    elif path.suffix == ".bz2":
        print("  md5 vs Valve: replay salt unknown, skipped")
    else:
        print("  md5 vs Valve: skipped (decompressed .dem; Valve only hashes the .bz2)")

    # 2. parse and cross-check against the metadata
    meta = load_metadata(mid)
    if meta is None:
        print("  content check: no metadata")
    else:
        with tempfile.TemporaryDirectory() as tmp:
            dem = path
            if path.suffix == ".bz2":
                dem = Path(tmp) / "m.dem"
                with bz2.open(path, "rb") as src, open(dem, "wb") as dst:
                    while chunk := src.read(1 << 20):
                        dst.write(chunk)
            out = Path(tmp) / "m.json"
            r = subprocess.run([str(sync.PARSER), str(dem), str(out), str(mid)], capture_output=True, text=True)
            if r.returncode != 0:
                print(f"  content check: demo does not parse ({r.stderr.strip()[-200:]})")
                verdicts.append(False)
            else:
                d = json.loads(out.read_text())
                problems = compare(d, meta)
                for p in problems:
                    print(f"    - {p}")
                print(f"  content check: {'matches Valve metadata' if not problems else f'{len(problems)} mismatches'}")
                verdicts.append(not problems)

    if not verdicts:
        print("RESULT: could not verify")
        sys.exit(2)
    ok = all(verdicts)
    print(f"RESULT: {'VERIFIED' if ok else 'MISMATCH'}")
    sys.exit(0 if ok else 1)


def compare(d, meta):
    problems = []
    demo = {p["account_id"]: p for p in d["players"]}
    valve = {p["account_id"]: p for p in meta.get("players") or []}
    if set(demo) != set(valve):
        problems.append(f"players differ: demo-only {sorted(set(demo) - set(valve))}, "
                        f"metadata-only {sorted(set(valve) - set(demo))}")
    for acc in set(demo) & set(valve):
        a, b = demo[acc], valve[acc]
        if a["hero_id"] != b.get("hero_id"):
            problems.append(f"{acc}: hero {a['hero_id']} vs {b.get('hero_id')}")
        if a["team"] != 2 + int(b.get("team") or 0):
            problems.append(f"{acc}: team {a['team']} vs {2 + int(b.get('team') or 0)}")
        for k in ("kills", "deaths", "assists"):
            if a.get(k) != b.get(k):
                problems.append(f"{acc}: {k} {a.get(k)} vs {b.get(k)}")
    if meta.get("winning_team") is not None and d.get("winning_team") is not None:
        if d["winning_team"] != 2 + int(meta["winning_team"]):
            problems.append(f"winner {d['winning_team']} vs {2 + int(meta['winning_team'])}")
    length = d.get("game_over_s") or d.get("duration_s")
    if meta.get("duration_s") and length and abs(length - meta["duration_s"]) > 15:
        problems.append(f"length {length:.0f}s vs {meta['duration_s']}s")
    return problems


if __name__ == "__main__":
    main()
