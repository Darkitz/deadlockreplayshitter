#!/usr/bin/env bash
# Health check after a game patch / parser update:
#   1. parse the newest local demo (canary) and fail on parse errors or format warnings;
#      the WebAssembly build must give byte-identical output
#   2. run unit + data tests
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARSER="$ROOT/parser/target/release/dlparse"
REPLAYS="${DEADLOCK_REPLAYS:-/mnt/d/SteamLibrary/steamapps/common/Deadlock/game/citadel/replays}"

newest=$(ls -t "$REPLAYS"/*.dem "$ROOT"/data/demos/*.dem 2>/dev/null | head -1 || true)
if [[ -n "$newest" ]]; then
  echo "canary: $(basename "$newest")"
  out=$(mktemp)
  if ! err=$("$PARSER" "$newest" "$out" "$(basename "$newest" .dem)" 2>&1); then
    echo "PARSE FAILED: $err" >&2
    rm -f "$out"
    exit 1
  fi
  echo "$err" | sed 's/^/  /'
  # the browser build (demo drop-in) must produce exactly the same JSON
  if [[ -f "$ROOT/web/parser/dlparse.wasm" ]]; then
    node "$ROOT/tools/wasm-check.mjs" "$newest" "$out" "$(basename "$newest" .dem)" || { rm -f "$out"; exit 3; }
  fi
  rm -f "$out"
  # warnings on the newest demo mean a field/message the site relies on moved
  if echo "$err" | grep -q '^warning:'; then
    echo "canary has warnings: the newest demo may use a changed format" >&2
    exit 2
  fi
else
  echo "canary: no local demo found, skipping"
fi

echo "unit tests:"
node --test "$ROOT"/tests/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
node --test "$ROOT"/tests/*.test.mjs >/dev/null
python3 -m unittest discover "$ROOT/tests" 2>&1 | tail -1
echo "all good"
