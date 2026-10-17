// Deadlock build share string = base64(zstd(CMsgHeroBuild protobuf)).
// Browsers have no zstd compressor, so we write a valid zstd frame made of raw (stored) blocks.
// Any zstd decoder, including the game's, reads it; it's just not compressed.
import { encodeHeroBuild } from "./proto.js";

const MAX_BLOCK = 128 * 1024;

export function zstdStore(data) {
  const n = data.length;
  // Frame header: single segment (no window descriptor), no checksum, no dictionary.
  // Frame_Content_Size width: 1 byte (< 256), 2 bytes (value - 256, < 65792) or 4 bytes.
  const [fcsFlag, fcs] =
    n < 256 ? [0, [n]] : n < 65792 ? [1, [(n - 256) & 0xff, (n - 256) >> 8]] : [2, [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]];
  const out = [0x28, 0xb5, 0x2f, 0xfd, (fcsFlag << 6) | 0x20, ...fcs];

  let pos = 0;
  do {
    const size = Math.min(MAX_BLOCK, n - pos);
    const last = pos + size >= n ? 1 : 0;
    const header = (size << 3) | (0 << 1) | last; // Block_Type 0 = raw
    out.push(header & 0xff, (header >> 8) & 0xff, (header >> 16) & 0xff);
    for (let i = 0; i < size; i++) out.push(data[pos + i]);
    pos += size;
  } while (pos < n);
  return new Uint8Array(out);
}

export function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const encodeBuildString = (build) => toBase64(zstdStore(encodeHeroBuild(build)));
