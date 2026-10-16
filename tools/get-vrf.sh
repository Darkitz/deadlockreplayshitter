#!/usr/bin/env bash
# fetch Source2Viewer-CLI (ValveResourceFormat) into tools/.vrf; used to read the game's VPKs
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/.vrf"
VER="${VRF_VERSION:-20.1}"
mkdir -p "$DIR"
curl -sSL -o "$DIR/cli.zip" "https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/$VER/cli-linux-x64.zip"
python3 -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$DIR/cli.zip" "$DIR"
rm "$DIR/cli.zip"
chmod +x "$DIR"/Source2Viewer-CLI* 2>/dev/null || true
ls "$DIR"
