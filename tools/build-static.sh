#!/usr/bin/env bash
# Bundles the site into a folder any static host can serve (GitHub Pages, Netlify, a USB stick):
# pages, scripts, the WebAssembly parser and the game assets. People open it and drop their own
# demos; everything is parsed in their browser.
#
#   tools/build-static.sh [out_dir] [--with-matches]
#     --with-matches  also include the matches, metadata and profiles synced here
#
# Game assets (hero/ability names and icons) come from your Deadlock install via tools/sync.py,
# so run a sync once before building.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
[[ "${1:-}" == --* ]] && OUT="$ROOT/dist"
WITH=0
for a in "$@"; do [[ "$a" == "--with-matches" ]] && WITH=1; done

[[ -f "$ROOT/web/data/assets.json" ]] || { echo "web/data/assets.json missing: run tools/sync.py once" >&2; exit 1; }
"$ROOT/tools/build-wasm.sh"
rm -rf "$OUT"
mkdir -p "$OUT/data"
cp -r "$ROOT/web/index.html" "$ROOT/web/style.css" "$ROOT/web/js" "$ROOT/web/parser" "$OUT/"
mkdir -p "$OUT/assets"
cp -r "$ROOT/web/assets/game" "$OUT/assets/"
cp "$ROOT/web/data/assets.json" "$OUT/data/"
if [[ $WITH == 1 ]]; then
  cp -r "$ROOT/web/data/." "$OUT/data/"
  [[ -d "$ROOT/web/assets/avatars" ]] && cp -r "$ROOT/web/assets/avatars" "$OUT/assets/"
fi
touch "$OUT/.nojekyll"  # GitHub Pages: serve folders starting with _ as-is
echo "static site in $OUT ($(du -sh "$OUT" | cut -f1)) · try: python3 -m http.server -d \"$OUT\""
