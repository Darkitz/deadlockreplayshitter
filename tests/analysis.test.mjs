// node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { prepare } from "../web/js/data.js";
import { analyzeAbility, counts, aimError, median } from "../web/js/analysis.js";

const AB = { class_name: "test_skillshot", id: 42 };

/** me at x=2, enemy at x=1000, ally at x=-500, for 100 s (0,0 = unknown position) */
function fixture({ casts = [], damage = [], notify = [], uses = [], enemyX = 1000 } = {}) {
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
    samples: { t0: 0, dt: 0.5, tracks: [track(1, 2), track(2, enemyX), track(3, -500)] },
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

test("incoming: enemy casts aimed at the subject are hit or dodged", async () => {
  const { incoming } = await import("../web/js/analysis.js");
  const ENEMY_AB = { class_name: "enemy_shot", id: 77 };
  // enemy (pawn 2, x=1000) aims back at me (yaw 180) three times, hits once
  const m = fixture({
    casts: [10, 20, 30].map((t) => [t, 2, ENEMY_AB.class_name, 1000, 1, 0, 180, 0]),
    damage: [[20.2, 2, 1, 1, 77, 60, 1, 0, 0]],
  });
  const assets = { signatures: (hid) => (hid === 1 ? [ENEMY_AB] : []) };
  const r = incoming(m, 1, assets, { window: 3 });
  assert.equal(r.aimed, 3);
  assert.equal(r.hit, 1);
  assert.equal(r.dodged, 2);
});

test("kill conversion and ready-idle time", () => {
  const m = fixture({
    casts: [cast(10), cast(40)],
    damage: [dmg(10.2, 2)],
    uses: [[10, 1, AB.id, 20, 0], [40, 1, AB.id, 20, 0]],
  });
  m.kills.push([15, 2, 1, AB.id, []]);
  const { casts } = analyzeAbility(m, 1, AB, { window: 3 });
  assert.equal(casts[0].killed, true);
  assert.equal(casts[0].idle, null);          // nothing known before the first cast
  assert.ok(Math.abs(casts[1].idle - 10) < 1e-9); // ready at 30, recast at 40
  const c = counts(casts);
  assert.equal(c.kills, 1);
  assert.ok(Math.abs(c.idle - 10) < 1e-9);
});

test("gun stats: shots, pellets, hero hits, headshots", async () => {
  const { gunStats, gunAt } = await import("../web/js/analysis.js");
  const m = fixture({
    damage: [
      [10.1, 1, 2, 2, 900, 20, 1, 0, 0, 3, 0], // body hit on enemy
      [10.6, 1, 2, 2, 900, 40, 1, 0, 0, 1, 1], // headshot
      [11.0, 1, 50, -1, 900, 10, 4, 0, 0, 0, 0], // trooper
      [11.2, 1, 3, 3, 900, 10, 1, 0, 0, 0, 0], // ally: ignored
    ],
  });
  m.shots = [[10, 1, 900, 2], [10.5, 1, 900, 1], [11, 1, 900, 3]];
  const assets = { item: (id) => (id === 900 ? { pellets: 3 } : null) };
  const g = gunStats(m, 1, assets);
  assert.equal(g.shots, 6);
  assert.equal(g.bullets, 18);
  assert.equal(g.heroHits, 2);
  assert.equal(g.headshots, 1);
  assert.equal(g.npcHits, 1);
  assert.deepEqual(gunAt(g, 10.55), { shots: 3, hits: 1, hs: 0, npc: 0 });
});

test("fights chain kills within the gap", async () => {
  const { detectFights } = await import("../web/js/analysis.js");
  const m = fixture();
  m.kills.push([100, 2, 1, 0, []], [108, 3, 2, 0, []], [140, 2, 1, 0, []]);
  const f = detectFights(m, 15);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0].byTeam, { 2: 1, 3: 1 }); // enemy (team 3) died -> point for 2; ally died -> point for 3
  assert.equal(f[0].t1, 108);
  assert.equal(f[1].kills.length, 1);
});

test("melee: light/heavy swings paired with following damage", async () => {
  const { meleeStats } = await import("../web/js/analysis.js");
  const m = fixture({
    damage: [
      [10.2, 1, 2, 2, 555, 50, 1, 0, 0, 0, 0],     // light hits enemy hero
      [20.3, 1, 70, -1, 555, 120, 4, 0, 0, 0, 0],  // heavy hits a trooper
    ],
  });
  m.melee = [[10, 1, 555, 1], [20, 1, 555, 2], [30, 1, 555, 3]];
  m.parries = [[40, 1, 0], [40.2, 1, 1], [50, 1, 0]];
  const s = meleeStats(m, 1);
  assert.deepEqual([s.light.n, s.light.hero], [1, 1]);
  assert.deepEqual([s.heavy.n, s.heavy.hero, s.heavy.npc], [2, 0, 1]);
  assert.equal(s.parryAttempts, 2);
  assert.equal(s.parrySuccess, 1);
});

test("melee: hero melees (enemy in reach) and parried swings both ways", async () => {
  const { meleeStats, parryLog } = await import("../web/js/analysis.js");
  const m = fixture({ enemyX: 100 }); // 2.5 m apart
  m.melee = [[10, 1, 555, 1], [20, 1, 555, 2], [30, 2, 556, 2]];
  // enemy parries my heavy at 20; I parry the enemy's heavy at 30
  m.parries = [[19.9, 2, 0], [20.05, 2, 1], [29.8, 1, 0], [30.1, 1, 1]];
  const log = parryLog(m);
  assert.deepEqual(log.map((x) => [x.parrier, x.attacker, x.kind]), [[2, 1, "heavy"], [1, 2, "heavy"]]);
  const s = meleeStats(m, 1);
  assert.deepEqual(s.swings.map((x) => x.result), ["miss", "parried"]);
  assert.deepEqual([s.light.near, s.heavy.near, s.heavy.parried], [1, 1, 1]);
  assert.equal(s.swings[1].parriedBy, 2);
  assert.equal(s.parried.length, 1);
  assert.equal(s.parried[0].attacker, 2);

  const far = fixture(); // 25 m apart: nothing in reach, parry can't pair
  far.melee = [[10, 1, 555, 1]];
  far.parries = [[10.05, 2, 1]];
  assert.equal(meleeStats(far, 1).swings[0].near, false);
  assert.equal(parryLog(far)[0].attacker, null);
});

test("melee intent: parser distances win over position samples", async () => {
  const { meleeStats } = await import("../web/js/analysis.js");
  const m = fixture({ enemyX: 100 }); // samples say the enemy is 2.5 m away
  // v12 swings: [t, pawn, id, type, heroDist dm, npcDist dm]; -1 = nothing within 30 m
  m.melee = [[10, 1, 555, 1, -1, 40], [20, 1, 555, 2, -1, -1], [30, 1, 555, 2, 80, 20]];
  const s = meleeStats(m, 1);
  assert.deepEqual(s.swings.map((x) => x.intent), ["npc", "move", "hero"]);
  assert.deepEqual([s.swings[2].heroD, s.swings[0].npcD], [8, 4]);
  assert.equal(s.heavy.move, 1);
});

test("chat log: team / all split and ping placeholders from the voice line", async () => {
  const { S } = await import("../web/js/ui.js");
  const { chatLog } = await import("../web/js/match.js");
  S.assets = {
    heroes: { 1: { class_name: "hero_kelvin", name: "Kelvin" } },
    lanes: { blue: "Broadway" },
    pings: {
      4: { concept: "CITADEL_PING_MISSING", text: "is missing" },
      59: { concept: "CITADEL_PING_DEFEND_WALKER", text: "Defend the Walker", lanes: { blue: "Defend the Broadway Walker" } },
      81: { concept: "CITADEL_PING_GOOD_GAME_ALLCHAT", text: "Good Game!" },
    },
  };
  const lines = chatLog({
    chat: [[10, 1, 0, "hi team"], [5, 2, 1, "glhf"]],
    wheel: [[20, 1, 4, "haze_ping_kelvin_missing_01_ping_2d"], [30, 1, 59, "haze_ping_defend_blue_02_ping_2d"], [40, 2, 81, ""]],
  });
  assert.deepEqual(lines.map((l) => [l.t, l.all, l.text]), [
    [5, true, "glhf"], [10, false, "hi team"], [20, false, "Kelvin is missing"],
    [30, false, "Defend the Broadway Walker"], [40, true, "Good Game!"],
  ]);
});

test("time split: combat priority and movement bits", async () => {
  const { timeSplit } = await import("../web/js/analysis.js");
  const m = fixture({
    damage: [
      [10, 1, 2, 2, 555, 50, 1, 0, 0, 0, 0],      // hero fight at 10 s
      [20, 1, 70, -1, 555, 50, 4, 0, 0, 0, 0],    // trooper at 20 s
      [30, 1, 71, -1, 555, 50, 6, 0, 0, 0, 0],    // neutral camp at 30 s
    ],
  });
  const tr = m.tracks.get(1);
  tr.mv = tr.hp.map((_, i) => (i === 80 ? 2 : i === 81 ? 1 : 0)); // 40 s zipline, 40.5 s airborne
  m.moves = [[50, 1, 999]];
  const ts = timeSplit(m, 1, { item: (id) => (id === 999 ? { class_name: "citadel_ability_dash" } : null) }, 0, 60);
  // -1 s / +0.5 s around each event = 4 samples of 0.5 s
  assert.deepEqual([ts.combat.hero, ts.combat.npc, ts.combat.neutral], [2, 2, 2]);
  assert.equal(ts.total, 60);
  assert.deepEqual([ts.move.zip, ts.move.air, ts.move.dash], [0.5, 0.5, 0.5]);
  assert.equal(ts.counts.dashes, 1);
});

test("service worker precaches every script the site loads", async () => {
  const fs = await import("node:fs");
  const sw = fs.readFileSync(new URL("../web/sw.js", import.meta.url), "utf8");
  for (const f of fs.readdirSync(new URL("../web/js/", import.meta.url))) {
    if (f.endsWith(".js")) assert.ok(sw.includes(`"js/${f}"`), `web/sw.js CORE is missing js/${f}`);
  }
});

test("empowered-bullet abilities: every bullet is scored (Living Ink)", () => {
  const ink = { ...AB, shots: 3, shot_window: 10 };
  const m = fixture({
    casts: [cast(10), cast(30)],
    damage: [
      [10.6, 1, 2, 2, AB.id, 60, 1, 0, 0, 0, 0],   // bullet 1 hits the enemy hero
      [11.7, 1, 2, 2, AB.id, 60, 1, 0, 0, 0, 0],   // bullet 2 hits
      [31.4, 1, 70, -1, AB.id, 40, 4, 0, 0, 0, 0], // second cast: one bullet hits a trooper
    ],
  });
  // gun shots: 3 after the first cast (+1 normal shot later), 3 after the second
  m.shots = [[10.5, 1, 99, 1], [11.6, 1, 99, 1], [12.4, 1, 99, 1], [20, 1, 99, 1], [31.2, 1, 99, 1], [32, 1, 99, 1], [33, 1, 99, 1]];
  const { casts } = analyzeAbility(m, 1, ink, { window: 3 });
  assert.deepEqual(casts.map((c) => c.projectiles.map((p) => p.result)), [["hit", "hit", "miss"], ["other", "miss", "miss"]]);
  const c = counts(casts, true);
  assert.deepEqual([c.projectiles, c.projHit, c.thrown, c.hit, c.miss], [6, 2, 2, 1, 0]);
});

test("ability kinds: debuffs hit, heals reach allies, self buffs count fight usage", () => {
  const m = fixture({ casts: [cast(10), cast(30), cast(50)], enemyX: 100 });
  m.modifiers = [
    [10.1, 12, 2, 1, 777, AB.id, 1], // debuff on the enemy hero (no damage)
    [30.1, 35, 3, 1, 778, AB.id, 1], // buff on the ally
    [50.1, 55, 1, 1, 779, AB.id, 1], // buff on self only
  ];
  const off = analyzeAbility(m, 1, { ...AB, kind: "offensive" }, { window: 3 }).casts.map((c) => c.result);
  assert.deepEqual(off, ["hit", "miss", "miss"]);
  m._analysis = null;
  const sup = analyzeAbility(m, 1, { ...AB, kind: "support" }, { window: 3 }).casts;
  assert.deepEqual(sup.map((c) => c.result), ["hit", "ally", "self"]);
  const c = counts(sup);
  assert.deepEqual([c.ally, c.allyHeroes, c.selfOnly], [1, 1, 1]);
  m._analysis = null;
  const self = analyzeAbility(m, 1, { ...AB, kind: "self" }, { window: 3 }).casts;
  assert.deepEqual(self.map((x) => x.result), ["hit", "miss", "self"]);
  assert.ok(self.every((x) => x.inFight)); // the enemy stands 2.5 m away the whole time
});
