// hero build codec (share strings) and the demo's cut-off build header
import { test } from "node:test";
import assert from "node:assert/strict";
import { zstdDecompressSync } from "node:zlib";
import { encodeBuildString, zstdStore } from "../web/js/builds/codec.js";
import { decodeHeroBuild, decodeHeroBuildPrefix, encodeHeroBuild } from "../web/js/builds/proto.js";

const decode = (s) => decodeHeroBuild(new Uint8Array(zstdDecompressSync(Buffer.from(s, "base64"))));
const BUILD = {
  hero_build_id: 897781,
  hero_id: 86,
  author_account_id: 93543378,
  name: "Bruiser WIP ✓",
  version: 14,
  details: {
    mod_categories: [{ name: "Early", width: 300, height: 163, mods: [{ ability_id: 2678489038 }, { ability_id: 1342610602, annotation: "rush" }] }],
    ability_order: { currency_changes: [{ ability_id: 1, currency_type: 2, delta: -1 }] },
  },
  tags: [1, 2],
};

test("raw zstd frames decode with a real zstd decoder at every size class", () => {
  for (const n of [0, 1, 255, 256, 1000, 65791, 65792, 200_000, 300_000]) {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
    assert.deepEqual(new Uint8Array(zstdDecompressSync(zstdStore(data))), data);
  }
});

test("share string round-trips a build", () => {
  const back = decode(encodeBuildString(BUILD));
  assert.equal(back.name, BUILD.name);
  assert.equal(back.details.mod_categories[0].mods[1].annotation, "rush");
  assert.equal(back.details.ability_order.currency_changes[0].delta, -1);
  assert.deepEqual(back.tags, [1, 2]);
});

test("a build cut off at its first zero byte (as demos carry it) keeps its complete fields", () => {
  const bytes = encodeHeroBuild(BUILD);
  const cut = bytes.subarray(0, bytes.indexOf(0));
  assert.throws(() => decodeHeroBuild(cut));
  const head = decodeHeroBuildPrefix(cut);
  assert.equal(head.hero_build_id, 897781);
  assert.equal(head.hero_id, 86);
  assert.equal(head.author_account_id, 93543378);
  assert.equal(head.name, BUILD.name);
  assert.equal(head.details, undefined);
});
