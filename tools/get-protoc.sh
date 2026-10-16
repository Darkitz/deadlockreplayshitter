#!/usr/bin/env bash
# fetch protoc into parser/.protoc (used by parser/.cargo/config.toml)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/parser/.protoc"
VER=28.3
mkdir -p "$DIR"
curl -sSL -o "$DIR/protoc.zip" "https://github.com/protocolbuffers/protobuf/releases/download/v$VER/protoc-$VER-linux-x86_64.zip"
python3 -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$DIR/protoc.zip" "$DIR"
rm "$DIR/protoc.zip"
chmod +x "$DIR/bin/protoc"
"$DIR/bin/protoc" --version
