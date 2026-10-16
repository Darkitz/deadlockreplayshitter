// Integration checks: parse the newest local demo with the browser build (web/parser/dlparse.wasm)
// and sanity-check the result. Skipped without a demo; set DEADLOCK_REPLAYS to point elsewhere.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { prepare } from "../web/js/data.js";

const dir = process.env.DEADLOCK_REPLAYS || "/mnt/d/SteamLibrary/steamapps/common/Deadlock/game/citadel/replays";
const wasm = new URL("../web/parser/dlparse.wasm", import.meta.url);
const newest = existsSync(dir) && existsSync(wasm)
  ? readdirSync(dir).filter((f) => f.endsWith(".dem")).map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, 1)
  : [];
const files = newest;
const cache = new Map();
async function parse(path) {
  const { instance } = await WebAssembly.instantiate(readFileSync(wasm), { env: { progress() {} } });
  const e = instance.exports;
  const buf = readFileSync(path);
  const ptr = e.dl_alloc(buf.length);
  new Uint8Array(e.memory.buffer, ptr, buf.length).set(buf);
  const status = e.dl_parse(ptr, buf.length, 0);
  const text = new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.dl_result_ptr(), e.dl_result_len()));
  assert.equal(status, 0, text.slice(0, 200));
  return prepare(JSON.parse(text));
}
const load = async (f) => {
  if (!cache.has(f)) cache.set(f, await parse(f));
  return cache.get(f);
};

test("cast events and cooldown starts share one clock", { skip: !files.length && "no local demo" }, async () => {
  for (const f of files) {
    const m = await load(f);
    let matched = 0, total = 0;
    for (const c of m.casts) {
      // ImportantAbilityUsed carries a class name; compare against any cooldown of that caster
      const own = m.uses.filter((u) => u[1] === c[1]);
      if (!own.length) continue;
      total++;
      if (own.some((u) => Math.abs(u[0] - c[0]) < 0.5)) matched++;
    }
    if (total) assert.ok(matched / total > 0.8, `${f}: only ${matched}/${total} casts line up with a cooldown`);
  }
});

test("players, samples and timeline are sane", { skip: !files.length && "no local demo" }, async () => {
  for (const f of files) {
    const m = await load(f);
    assert.equal(m.players.length, 12, `${f}: players`);
    assert.ok(m.end > 300, `${f}: match length ${m.end}`);
    for (const tr of m.samples.tracks) assert.equal(tr.pos.length, tr.hp.length * 2, `${f}: track shape`);
    for (const k of m.kills) assert.ok(k[0] >= 0 && k[0] <= m.duration_s + 1, `${f}: kill time ${k[0]}`);
  }
});
