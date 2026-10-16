#!/usr/bin/env bash
# Builds the browser parser (same Rust code as the dlparse CLI, compiled to WebAssembly) into
# web/parser/dlparse.wasm. The site loads it to parse demos people drop onto the page.
#   needs: rustup target add wasm32-unknown-unknown
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/parser"
rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown || rustup target add wasm32-unknown-unknown
cargo build --release -q -p dlparse --lib --target wasm32-unknown-unknown
mkdir -p "$ROOT/web/parser"
cp target/wasm32-unknown-unknown/release/dlparse.wasm "$ROOT/web/parser/dlparse.wasm"
echo "web/parser/dlparse.wasm: $(( $(stat -c %s "$ROOT/web/parser/dlparse.wasm") / 1024 )) KB"
