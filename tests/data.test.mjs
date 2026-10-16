// Integration checks against parsed demos in web/data (skipped when there are none).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { prepare } from "../web/js/data.js";

const dir = new URL("../web/data/matches/", import.meta.url);
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json.gz")) : [];
const load = (f) => prepare(JSON.parse(gunzipSync(readFileSync(new URL(f, dir))).toString()));

test("cast events and cooldown starts share one clock", { skip: !files.length && "no parsed demos" }, () => {
  for (const f of files) {
    const m = load(f);
    const items = new Map();
    for (const u of m.uses) items.set(`${u[1]}|${u[2]}`, (items.get(`${u[1]}|${u[2]}`) || []).concat(u[0]));
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

test("players, samples and timeline are sane", { skip: !files.length && "no parsed demos" }, () => {
  for (const f of files) {
    const m = load(f);
    assert.equal(m.players.length, 12, `${f}: players`);
    assert.ok(m.end > 300, `${f}: match length ${m.end}`);
    for (const tr of m.samples.tracks) assert.equal(tr.pos.length, tr.hp.length * 2, `${f}: track shape`);
    for (const k of m.kills) assert.ok(k[0] >= 0 && k[0] <= m.duration_s + 1, `${f}: kill time ${k[0]}`);
  }
});
