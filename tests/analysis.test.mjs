// node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { prepare } from "../web/js/data.js";
import { analyzeAbility, counts, aimError, median } from "../web/js/analysis.js";

const AB = { class_name: "test_skillshot", id: 42 };

/** me at x=0, enemy at x=1000, ally at x=-500, for 100 s */
function fixture({ casts = [], damage = [], notify = [], uses = [] } = {}) {
  const n = 200;
  const track = (pawn, x) => ({
    pawn,
    pos: Array.from({ length: n }, () => [x, 0]).flat(),
    hp: new Array(n).fill(1000),
    max_hp: new Array(n).fill(1000),
  });
  return prepare({
    version: 3, match_id: 1, tick_interval: 1 / 64, duration_s: 100, game_over_s: 100,
    players: [
      { pawn: 1, controller: 11, account_id: 7, name: "me", hero_id: 64, team: 2 },
      { pawn: 2, controller: 12, account_id: 8, name: "enemy", hero_id: 1, team: 3 },
      { pawn: 3, controller: 13, account_id: 9, name: "ally", hero_id: 2, team: 2 },
    ],
    casts, uses, damage, notify, kills: [], items: [], upgrades: [],
    samples: { t0: 0, dt: 0.5, tracks: [track(1, 0), track(2, 1000), track(3, -500)] },
    stats: { t0: 0, dt: 10, tracks: [] },
  });
}
// x=1: 0,0 means "position unknown" in the parser output
const cast = (t, yaw = 0) => [t, 1, AB.class_name, 1, 0, 0, yaw, 0];
const dmg = (t, victimPawn, amount = 50, victimEnt = victimPawn) =>
  [t, 1, victimEnt, victimPawn, AB.id, amount, 1, 1000, 0];

test("hit, miss and non-hero hit are classified", () => {
  const m = fixture({
    casts: [cast(10), cast(20), cast(30)],
    damage: [dmg(10.2, 2), dmg(30.5, -1, 20, 999)],
  });
  const { casts, source } = analyzeAbility(m, 1, AB, { window: 3 });
  assert.equal(source, "cast");
  assert.deepEqual(casts.map((c) => c.result), ["hit", "miss", "other"]);
  assert.equal(casts[0].victims[0], 2);
  assert.ok(Math.abs(casts[0].delay - 0.2) < 1e-9);
  const c = counts(casts, true);
  assert.equal(c.thrown, 3);
  assert.equal(c.scored, 1);
  assert.equal(counts(casts, false).scored, 2);
});

test("damage after the window or after the next cast is not credited to the earlier cast", () => {
  const m = fixture({ casts: [cast(10), cast(11)], damage: [dmg(11.5, 2), dmg(20, 2)] });
  const { casts } = analyzeAbility(m, 1, AB, { window: 3 });
  assert.deepEqual(casts.map((c) => c.result), ["miss", "hit"]);
});

test("ally damage / buffs never count as hits", () => {
  const m = fixture({ casts: [cast(10)], damage: [dmg(10.1, 3)], notify: [[10.1, 1, 3, AB.id, 1]] });
  assert.equal(analyzeAbility(m, 1, AB, { window: 3 }).casts[0].result, "miss");
});

test("status notify on an enemy counts as a hit", () => {
  const m = fixture({ casts: [cast(10)], notify: [[10.3, 1, 2, AB.id, 1]] });
  assert.equal(analyzeAbility(m, 1, AB, { window: 3 }).casts[0].result, "hit");
});

test("cooldown fallback when the demo has no cast events", () => {
  const m = fixture({ uses: [[10, 1, AB.id, 20, 0]], damage: [dmg(10.4, 2)] });
  const { casts, source } = analyzeAbility(m, 1, AB, { window: 3 });
  assert.equal(source, "cooldown");
  assert.equal(casts[0].result, "hit");
  assert.equal(casts[0].yaw, null);
});

test("aim error is the horizontal angle to the nearest enemy", () => {
  const m = fixture();
  const me = m.byPawn.get(1);
  assert.ok(aimError(m, me, { t: 10, x: 1, y: 0, yaw: 0 }).err < 0.1);
  assert.ok(Math.abs(aimError(m, me, { t: 10, x: 1, y: 0, yaw: 90 }).err - 90) < 0.1);
  assert.ok(Math.abs(aimError(m, me, { t: 10, x: 1, y: 0, yaw: -170 }).err - 170) < 0.1);
  assert.equal(aimError(m, me, { t: 10, x: 1, y: 0, yaw: null }), null);
});

test("hit range is measured to the damage origin", () => {
  const m = fixture({ casts: [cast(10)], damage: [dmg(10.2, 2)] });
  const c = analyzeAbility(m, 1, AB, { window: 3 }).casts[0];
  assert.ok(Math.abs(c.dist - 999 * 0.0254) < 0.01);
});

test("median", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});
