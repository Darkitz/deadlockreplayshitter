// Parses a demo with the browser build (web/parser/dlparse.wasm) and compares the JSON with the
// native CLI's output. Used by tools/check.sh so a parser update can't break demo drop-in.
//   node tools/wasm-check.mjs <demo> <native.json> [match_id]
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const [demo, nativeJson, matchId = "0"] = process.argv.slice(2);
const wasmPath = fileURLToPath(new URL("../web/parser/dlparse.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { env: { progress() {} } });
const e = instance.exports;
const buf = fs.readFileSync(demo);
const t0 = performance.now();
const ptr = e.dl_alloc(buf.length);
new Uint8Array(e.memory.buffer, ptr, buf.length).set(buf);
const status = e.dl_parse(ptr, buf.length, Number(matchId));
const out = Buffer.from(new Uint8Array(e.memory.buffer, e.dl_result_ptr(), e.dl_result_len()));
if (status !== 0) {
  console.error(`wasm parse failed: ${out.toString()}`);
  process.exit(1);
}
const same = out.equals(fs.readFileSync(nativeJson));
console.log(`  wasm v${e.dl_version()}: ${Math.round(performance.now() - t0)} ms, ${e.memory.buffer.byteLength >> 20} MB, ${same ? "identical to native" : "DIFFERS from native"}`);
process.exit(same ? 0 : 1);
