#!/usr/bin/env bash
# Pull the latest haste fork + valveprotos from deadlock-api (they keep them working across
# Deadlock patches), rebuild the parser and run tools/check.sh. If the check passes, run
# tools/sync.py: the parser format version decides whether demos get reparsed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

git clone -q --depth 1 --filter=blob:none --sparse https://github.com/deadlock-api/deadlock-api.git "$TMP/dapi"
git -C "$TMP/dapi" sparse-checkout set haste valveprotos
echo "upstream: $(git -C "$TMP/dapi" log -1 --format='%h %cd' --date=short)"

for d in haste valveprotos; do
  rm -rf "$ROOT/parser/vendor/$d.new"
  cp -r "$TMP/dapi/$d" "$ROOT/parser/vendor/$d.new"
  rm -rf "$ROOT/parser/vendor/$d.old"
  mv "$ROOT/parser/vendor/$d" "$ROOT/parser/vendor/$d.old"
  mv "$ROOT/parser/vendor/$d.new" "$ROOT/parser/vendor/$d"
done

restore() {
  echo "build/check failed, restoring previous vendored parser" >&2
  for d in haste valveprotos; do
    rm -rf "$ROOT/parser/vendor/$d"
    mv "$ROOT/parser/vendor/$d.old" "$ROOT/parser/vendor/$d"
  done
  (cd "$ROOT/parser" && cargo build --release -q) || true
}

if ! (cd "$ROOT/parser" && cargo build --release -q); then restore; exit 1; fi
if ! "$ROOT/tools/check.sh"; then restore; exit 1; fi
rm -rf "$ROOT/parser/vendor/haste.old" "$ROOT/parser/vendor/valveprotos.old"
git -C "$ROOT" status --short parser/vendor | head -20
echo "parser updated; commit parser/vendor and run tools/sync.py"
