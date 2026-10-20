// "Thrown vs hit" analysis, hero/ability agnostic.
//
// Thrown: ImportantAbilityUsed events for the ability (newer demos), falling back to the
//         ability entity's cooldown starting (older demos lack ImportantAbilityUsed).
// Hit:    the first damage / status event from that ability id after the cast, inside the
//         hit window (cut short by the next cast). Enemy hero → "hit", anything else that is
//         not an ally → "other", nothing → "miss".

import { posAt, hpAt } from "./data.js";

/** world units → meters (Source units are inches) */
export const UNIT_M = 0.0254;
/** enemies further away than this are ignored for aim error */
const AIM_MAX_DIST = 80 / UNIT_M;
/** a hero hit "converts" when that victim dies within this many seconds */
export const KILL_WINDOW = 10;

/**
 * smallest horizontal angle (deg) between the cast's aim and an alive enemy hero within range.
 * returns {err, pawn, dist} or null.
 */
export function aimError(m, me, c) {
  if (c.yaw == null || !(c.x || c.y)) return null;
  let best = null;
  for (const p of m.players) {
    if (p.team === me.team) continue;
    const hp = hpAt(m, p.pawn, c.t);
    if (!hp || hp.hp <= 0) continue;
    const pos = posAt(m, p.pawn, c.t);
    if (!pos) continue;
    const dx = pos[0] - c.x, dy = pos[1] - c.y;
    const d = Math.hypot(dx, dy);
    if (d > AIM_MAX_DIST || d < 1) continue;
    let a = (Math.atan2(dy, dx) * 180) / Math.PI - c.yaw;
    a = Math.abs(((a + 540) % 360) - 180);
    // nearly the same line (within 1°): the closer hero is the one a projectile meets first
    const better = !best || a < best.err - 1 || (Math.abs(a - best.err) <= 1 && d * UNIT_M < best.dist);
    if (better) best = { err: a, pawn: p.pawn, dist: d * UNIT_M };
  }
  return best;
}

const cacheKey = (pawn, cls, o) => `${pawn}|${cls}|${o.window}`;

/**
 * @returns {{source: "cast"|"cooldown"|"none", casts: Array<{
 *   t, result, dmg, delay, victims, x, y, yaw, hitX, hitY}>}}
 */
export function analyzeAbility(m, pawn, ability, opts) {
  m._analysis ??= new Map();
  const key = cacheKey(pawn, ability.class_name, opts);
  if (m._analysis.has(key)) return m._analysis.get(key);

  const me = m.byPawn.get(pawn);
  const aid = ability.id;

  let source = "cast";
  let casts = m.casts
    .filter((c) => c[1] === pawn && c[2] === ability.class_name)
    .map((c) => ({ t: c[0], x: c[3], y: c[4], yaw: c[6], pitch: c[7] }));
  if (!casts.length && aid != null) {
    source = "cooldown";
    casts = m.uses.filter((u) => u[1] === pawn && u[2] === aid).map((u) => {
      const p = posAt(m, pawn, u[0]);
      return { t: u[0], x: p?.[0] ?? 0, y: p?.[1] ?? 0, yaw: null, pitch: null };
    });
  }
  if (!casts.length) source = "none";

  // effects: [t, targetPawn|-1, dmg, x, y, "dmg"|"notify"|"mod"]. Modifiers are the buffs /
  // debuffs the ability applied, so debuffs (Slowing Hex), heals and shields count too.
  const hits = [];
  const ids = new Set([aid, ...(ability.childIds || [])]); // recasts count for the parent
  if (aid != null) {
    for (const d of m.damage) {
      if (d[1] !== pawn || !ids.has(d[4]) || d[3] === pawn) continue;
      hits.push([d[0], d[3], d[5], d[7], d[8], "dmg"]);
    }
    for (const n of m.notify) {
      if (n[1] !== pawn || !ids.has(n[3]) || n[2] < 0) continue;
      hits.push([n[0], n[2], 0, null, null, "notify"]);
    }
    for (const x of m.modifiers || []) {
      if (x[3] !== pawn || !ids.has(x[5])) continue;
      hits.push([x[0], m.byPawn.has(x[2]) ? x[2] : -1, 0, null, null, "mod"]);
    }
  }
  hits.sort((a, b) => a[0] - b[0]);
  const kind = ability.kind || "offensive";
  // traps, fuses and slow projectiles land later than the hit window: the measured window wins
  const window = Math.max(opts.window, ability.window || 0);
  // channels / durations keep dealing damage after the first hit: damage counts for the whole effect
  const effect = Math.max(window, (ability.effect || 0) + 0.5);

  let j = 0;
  for (let i = 0; i < casts.length; i++) {
    const c = casts[i];
    const next = i + 1 < casts.length ? casts[i + 1].t : Infinity;
    const end = Math.min(c.t + window, next);
    const dmgEnd = Math.min(c.t + effect, next);
    while (j < hits.length && hits[j][0] < c.t - 0.05) j++;
    let heroHit = null, otherHit = null, dmg = 0, onSelf = false;
    const victims = new Set(), allies = new Set();
    for (let k = j; k < hits.length && hits[k][0] < dmgEnd; k++) {
      const h = hits[k];
      const vic = h[1] >= 0 ? m.byPawn.get(h[1]) : null;
      const inHitWindow = h[0] < end;
      if (vic && vic.team === me?.team) { // ally buff / self
        if (!inHitWindow) continue;
        if (h[1] === pawn) onSelf = true; else allies.add(h[1]);
        continue;
      }
      if (h[5] === "mod" && !vic) continue; // buffs on non-heroes (own summons, ...)
      if (!inHitWindow) { // later ticks of a channel / duration: damage and victims, not the hit itself
        if (vic) victims.add(h[1]);
        dmg += h[2];
        continue;
      }
      if (vic) {
        heroHit ??= h;
        victims.add(h[1]);
      } else {
        otherHit ??= h;
      }
      dmg += h[2];
    }
    const first = heroHit || otherHit;
    // used on a teammate (support, or offensive abilities that can target allies: Grapple Arm,
    // Exploding Uppercut, Air Drop, ...): "ally", kept out of accuracy
    c.result = heroHit ? "hit" : otherHit ? "other" : allies.size ? "ally" : kind !== "offensive" && onSelf ? "self" : "miss";
    c.allies = [...allies];
    c.onSelf = onSelf;
    c.dmg = dmg;
    c.delay = first ? first[0] - c.t : null;
    c.victims = [...victims];
    if (first) {
      // damage origin is often 0,0 for DoT ticks; fall back to the victim's position
      const vp = heroHit ? posAt(m, heroHit[1], heroHit[0]) : null;
      const hasOrigin = first[3] || first[4];
      c.hitX = hasOrigin ? first[3] : vp?.[0] ?? null;
      c.hitY = hasOrigin ? first[4] : vp?.[1] ?? null;
      c.hitT = first[0];
      if (c.hitX != null && (c.x || c.y)) c.dist = Math.hypot(c.hitX - c.x, c.hitY - c.y) * UNIT_M;
    }
  }
  // "next N bullets" abilities (Living Ink, Slam Fire, ...): score every projectile
  if (ability.shots) scoreProjectiles(m, pawn, ability, casts, hits.filter((h) => h[5] === "dmg"));

  // modes (Lycan Curse, Rain of Arrows, Full Auto, ...): what you dealt while it lasted
  if (kind === "mode") {
    const len = ability.effect || 6;
    for (const c of casts) {
      const end = c.t + len;
      let dmg = 0;
      const heroes = new Set();
      for (const d of m.damage) {
        if (d[1] !== pawn || d[0] < c.t || d[0] > end || d[3] < 0) continue;
        if (m.byPawn.get(d[3])?.team === me?.team) continue;
        dmg += d[5]; heroes.add(d[3]);
      }
      c.modeDmg = dmg;
      c.modeHeroes = [...heroes];
      c.modeKills = m.kills.filter((k) => k[0] >= c.t && k[0] <= end + 1 && (k[2] === pawn || (k[4] || []).includes(pawn))).length;
      c.modeLen = len;
      if (c.result === "miss" || c.result === "self") c.result = dmg > 0 ? "hit" : "miss";
      if (dmg > 0 && !c.victims.length) c.victims = c.modeHeroes;
    }
  }

  // the debuff that is the point of the ability (Lurking Terrors: fear): enemy heroes that got it
  if (ability.debuff_modifier_id) {
    for (const c of casts) {
      const end = c.t + effect;
      c.debuffed = [...new Set((m.modifiers || []).filter((x) => x[4] === ability.debuff_modifier_id && x[3] === pawn
        && x[0] >= c.t - 0.05 && x[0] <= end && m.byPawn.get(x[2]) && m.byPawn.get(x[2]).team !== me?.team).map((x) => x[2]))];
    }
  }

  // loadouts (Healing Needles): the ability swaps the gun for another weapon until it's empty or
  // put away. Scored by the shots fired with it and the allies they reached.
  if (kind === "loadout") {
    for (let i = 0; i < casts.length; i++) {
      const c = casts[i];
      const next = i + 1 < casts.length ? casts[i + 1].t : m.end;
      const eq = (m.modifiers || []).find((x) => x[2] === pawn && x[4] === ability.equipped_modifier_id && x[0] >= c.t - 0.5 && x[0] <= c.t + 3);
      const end = Math.min(eq ? eq[1] : c.t + 20, next, m.end);
      c.loadLen = Math.max(0, end - c.t);
      c.loadShots = (m.shots || []).filter((s) => s[1] === pawn && s[2] === ability.weapon_id && s[0] >= c.t && s[0] <= end).reduce((a, s) => a + s[3], 0);
      const reached = (m.modifiers || []).filter((x) => x[3] === pawn && x[4] === ability.ally_modifier_id && x[0] >= c.t && x[0] <= end + 0.5
        && x[2] !== pawn && m.byPawn.get(x[2])?.team === me?.team);
      c.allies = [...new Set([...(c.allies || []), ...reached.map((x) => x[2])])];
      c.result = c.allies.length ? "ally" : "self";
    }
  }

  // self buffs / mobility: was it used in a fight? (enemy hero within 25 m, or hero damage
  // dealt or taken within 3 s)
  if (kind === "self" || kind === "support" || kind === "mode" || kind === "loadout") {
    const heroDmg = m.damage.filter((d) => (d[1] === pawn && d[3] >= 0 && m.byPawn.get(d[3])?.team !== me?.team)
      || (d[3] === pawn && m.byPawn.get(d[1])?.team !== me?.team)).map((d) => d[0]);
    for (const c of casts) {
      const p = posAt(m, pawn, c.t);
      const near = p && m.players.some((o) => o.team !== me?.team && hpAt(m, o.pawn, c.t)?.hp > 0
        && (() => { const q = posAt(m, o.pawn, c.t); return q && Math.hypot(q[0] - p[0], q[1] - p[1]) * UNIT_M <= 25; })());
      c.inFight = !!near || heroDmg.some((t) => Math.abs(t - c.t) <= 3);
    }
  }

  // kill conversion + idle time (how long the ability was ready before this cast)
  const deaths = m.kills.map((k) => [k[0], k[1]]);
  const cds = aid != null ? m.uses.filter((u) => u[1] === pawn && u[2] === aid) : [];
  let prevReady = null;
  for (const c of casts) {
    c.killed = c.result === "hit" && c.victims.some((v) =>
      deaths.some(([dt, dv]) => dv === v && dt >= c.hitT && dt <= c.hitT + KILL_WINDOW));
    // cooldown that started with this cast (within half a second)
    const cd = cds.find((u) => Math.abs(u[0] - c.t) < 0.5);
    c.idle = prevReady != null && c.t > prevReady ? c.t - prevReady : prevReady != null ? 0 : null;
    prevReady = cd && cd[3] > 0 ? c.t + cd[3] : null;
  }
  if (me) {
    for (const c of casts) {
      const a = aimError(m, me, c);
      c.aimErr = a?.err ?? null;
      c.aimPawn = a?.pawn ?? null;
      c.aimDist = a?.dist ?? null;
    }
  }
  const res = { source, casts };
  m._analysis.set(key, res);
  return res;
}

/** projectiles of a cast fly at most this long before their damage arrives (steered ink bullets) */
const PROJECTILE_FLIGHT = 4;

/**
 * For abilities that empower the next N gun shots: the first N weapon shots after each cast
 * (within the ability's duration, until the next cast) are its projectiles. The ability's damage
 * packets, grouped by tick, each claim the latest unclaimed projectile fired before them
 * (within PROJECTILE_FLIGHT s). Sets c.projectiles = [{t, result: hit|other|miss, victims}].
 */
function scoreProjectiles(m, pawn, ability, casts, hits) {
  const shots = [];
  for (const s of m.shots || []) if (s[1] === pawn) for (let k = 0; k < s[3]; k++) shots.push(s[0]);
  const me = m.byPawn.get(pawn);
  let si = 0;
  for (let i = 0; i < casts.length; i++) {
    const c = casts[i];
    const end = Math.min(c.t + (ability.shot_window || 10), i + 1 < casts.length ? casts[i + 1].t : Infinity);
    while (si < shots.length && shots[si] < c.t - 0.05) si++;
    c.projectiles = [];
    for (let k = si; k < shots.length && shots[k] <= end && c.projectiles.length < ability.shots; k++) {
      c.projectiles.push({ t: shots[k], result: "miss", victims: [] });
    }
  }
  // group damage by tick, then FIFO onto projectiles
  const groups = [];
  for (const h of hits) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.t - h[0]) < 0.02) last.list.push(h); else groups.push({ t: h[0], list: [h] });
  }
  const queue = casts.flatMap((c) => c.projectiles);
  for (const g of groups) {
    // the latest unclaimed projectile fired before the damage (ink bullets land in ~0.1-0.5 s)
    let p = null;
    for (const q of queue) if (!q.claimed && q.t <= g.t + 0.05 && g.t - q.t <= PROJECTILE_FLIGHT && (!p || q.t > p.t)) p = q;
    if (!p) continue;
    p.claimed = true;
    for (const h of g.list) {
      const v = h[1] >= 0 ? m.byPawn.get(h[1]) : null;
      if (v && v.team === me?.team) continue;
      if (v) { p.result = "hit"; if (!p.victims.includes(h[1])) p.victims.push(h[1]); } else if (p.result === "miss") p.result = "other";
    }
  }
  for (const q of queue) delete q.claimed;
}

export function counts(casts, heroesOnly = true) {
  let hit = 0, other = 0, dmg = 0;
  for (const c of casts) {
    if (c.result === "hit") hit++;
    else if (c.result === "other") other++;
    dmg += c.dmg;
  }
  const thrown = casts.length;
  const scored = heroesOnly ? hit : hit + other;
  const ally = casts.filter((c) => c.result === "ally" || c.allies?.length).length;
  const allyHeroes = new Set(casts.flatMap((c) => c.allies || [])).size;
  const selfOnly = casts.filter((c) => c.result === "self").length;
  const inFight = casts.filter((c) => c.inFight).length;
  const allyOnly = casts.filter((c) => c.result === "ally").length;
  const heroHits = casts.filter((c) => c.result === "hit");
  const heroesPerHit = heroHits.length ? heroHits.reduce((a, c) => a + Math.max(1, c.victims.length), 0) / heroHits.length : null;
  const modeCasts = casts.filter((c) => c.modeDmg != null);
  const modeDmg = modeCasts.reduce((a, c) => a + c.modeDmg, 0);
  const modeKills = modeCasts.reduce((a, c) => a + c.modeKills, 0);
  const kills = casts.filter((c) => c.killed).length;
  const debuffCasts = casts.filter((c) => c.debuffed);
  const loads = casts.filter((c) => c.loadShots != null);
  const idles = casts.map((c) => c.idle).filter((v) => v != null);
  // projectile abilities: per-bullet numbers too
  const proj = casts.some((c) => c.projectiles) ? casts.flatMap((c) => c.projectiles || []) : null;
  const projHit = proj ? proj.filter((p) => p.result === "hit" || (!heroesOnly && p.result === "other")).length : 0;
  return {
    // uses on teammates aren't attempts to hit enemies: they leave the accuracy denominator
    thrown, hit, other, miss: casts.filter((c) => c.result === "miss").length, scored, dmg,
    acc: thrown - allyOnly > 0 ? scored / (thrown - allyOnly) : 0, allyOnly, heroesPerHit,
    modeDmg: modeCasts.length ? modeDmg : null, modeKills,
    ally, allyHeroes, selfOnly, inFight,
    projectiles: proj ? proj.length : null, projHit, projAcc: proj?.length ? projHit / proj.length : null,
    perShot: proj ? Math.max(...casts.map((c) => c.projectiles?.length || 0), 0) : null,
    kills, idle: idles.length ? idles.reduce((a, b) => a + b, 0) / idles.length : null,
    // debuff abilities: enemy heroes that got the debuff (feared, ...), and casts that landed one
    debuffed: debuffCasts.length ? debuffCasts.reduce((a, c) => a + c.debuffed.length, 0) : null,
    debuffHits: debuffCasts.filter((c) => c.debuffed.length).length,
    // loadouts: shots fired with the swapped-in weapon and time it was out
    loadShots: loads.length ? loads.reduce((a, c) => a + c.loadShots, 0) : null,
    loadTime: loads.reduce((a, c) => a + c.loadLen, 0),
  };
}

export const pct = (x) => `${Math.round(x * 100)}%`;

/** all signature abilities + active items that went on cooldown, with counts */
export function abilityTable(m, pawn, assets, opts) {
  const p = m.byPawn.get(pawn);
  const rows = [];
  for (const ab of assets.signatures(p.hero_id)) {
    const a = analyzeAbility(m, pawn, ab, opts);
    rows.push({ ability: ab, ...counts(a.casts, opts.heroesOnly), source: a.source });
  }
  // everything else that started a cooldown: hero sub-abilities (melee, parry, teleports...)
  // and active items
  const sig = new Set(rows.map((r) => r.ability.id));
  const used = new Map();
  for (const u of m.uses) {
    if (u[1] !== pawn || sig.has(u[2])) continue;
    const it = assets.item(u[2]);
    if (!it || it.type === "weapon") continue;
    used.set(u[2], (used.get(u[2]) || 0) + 1);
  }
  for (const [id, n] of [...used].sort((a, b) => b[1] - a[1])) {
    const it = { id, ...assets.item(id) };
    const a = analyzeAbility(m, pawn, it, opts);
    const kind = it.type === "ability" ? "extra" : "item";
    rows.push({ ability: it, ...counts(a.casts, opts.heroesOnly), source: a.source, item: kind === "item", kind, uses: n });
  }
  return rows;
}

export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

/** casts whose aim was within this many degrees of a hero count as "aimed at" that hero */
export const AIMED_AT_DEG = 15;

/**
 * Enemy signature-ability casts aimed at `pawn` (nearest enemy in the aim direction, within
 * AIMED_AT_DEG): did they connect or did the subject dodge?
 * Only abilities that hit at least one hero in the match count, so buffs/self-casts are skipped.
 */
export function incoming(m, pawn, assets, opts) {
  const me = m.byPawn.get(pawn);
  const rows = [];
  for (const p of m.players) {
    if (p.team === me.team) continue;
    for (const ab of assets.signatures(p.hero_id)) {
      const { casts } = analyzeAbility(m, p.pawn, ab, opts);
      if (!casts.some((c) => c.result === "hit")) continue;
      let aimed = 0, hit = 0;
      const events = [];
      for (const c of casts) {
        if (c.aimPawn !== pawn || c.aimErr == null || c.aimErr > AIMED_AT_DEG) continue;
        aimed++;
        const got = c.victims.includes(pawn);
        if (got) hit++;
        events.push({ t: c.t, hit: got, err: c.aimErr });
      }
      if (aimed) rows.push({ player: p, ability: ab, aimed, hit, events });
    }
  }
  const aimed = rows.reduce((a, r) => a + r.aimed, 0);
  const hit = rows.reduce((a, r) => a + r.hit, 0);
  return { rows: rows.sort((a, b) => b.aimed - a.aimed), aimed, hit, dodged: aimed - hit };
}

/** pseudo-ability used by the UI for the hero's gun */
export const GUN = { class_name: "__gun", name: "Gun", id: null };

/**
 * Gun stats for a pawn, straight from the demo, paired per shot:
 *   shots     = trigger pulls (weapon m_nShotNumber), bullets = shots × pellets per shot
 *   each shot is matched with the weapon damage that landed within 0.15 s (bullets are near
 *   instant): it hit an enemy hero, only troopers/neutrals/objectives ("npc"), or nothing.
 *   headshot  = a hero hit on hitgroup 1 / with crit damage
 *   hero accuracy excl. NPC shots = hero shots / (shots - npc shots): shots spent on troopers
 *   are taken out so the rest approximates "shots aimed at heroes".
 * Timeline events: {t, kind: "shot"|"hit"|"hs"|"npc", n}
 */
export function gunStats(m, pawn, assets) {
  m._gun ??= new Map();
  if (m._gun.has(pawn)) return m._gun.get(pawn);
  const me = m.byPawn.get(pawn);
  // weapons that heal (Nurse Harrow's syringes) aren't aiming at enemies: not the gun
  const rows = (m.shots || []).filter((s) => s[1] === pawn && !assets?.item(s[2])?.heal_weapon);
  const weapons = new Set(rows.map((s) => s[2]));
  const dmg = m.damage.filter((d) => d[1] === pawn && weapons.has(d[4]));
  const events = [];
  let shots = 0, bullets = 0, heroShots = 0, npcShots = 0, headshots = 0, heroDmg = 0, dmgTotal = 0;
  const byVictim = new Map();
  // one entry per trigger pull (rows can hold several pulls in one tick)
  const pulls = [];
  for (const [t, , wid, n] of rows) {
    const pellets = assets?.item(wid)?.pellets || 1;
    shots += n;
    bullets += n * pellets;
    events.push({ t, kind: "shot", n });
    for (let k = 0; k < n; k++) pulls.push({ t, hit: null });
  }
  // damage landing in the same tick is one shot's worth (pellets / multiple targets)
  const packets = [];
  for (const d of dmg) {
    const vic = d[3] >= 0 ? m.byPawn.get(d[3]) : null;
    if (vic && vic.team === me.team) continue;
    dmgTotal += d[5];
    let pk = packets.at(-1);
    if (!pk || Math.abs(pk.t - d[0]) > 0.008) {
      pk = { t: d[0], hero: null, npc: false, hs: false };
      packets.push(pk);
    }
    if (vic) {
      pk.hero = d[3];
      heroDmg += d[5];
      if (d[9] === 1 || d[10] === 1) pk.hs = true;
    } else pk.npc = true;
  }
  // FIFO: each packet claims the oldest unclaimed pull fired before it, within travel time
  const TRAVEL = 1.5;
  let q = 0;
  for (const pk of packets) {
    while (q < pulls.length && (pulls[q].hit || pulls[q].t < pk.t - TRAVEL)) q++;
    if (q >= pulls.length || pulls[q].t > pk.t + 0.02) continue;
    pulls[q].hit = pk;
    if (pk.hero != null) {
      heroShots++;
      if (pk.hs) headshots++;
      const hid = m.byPawn.get(pk.hero).hero_id;
      byVictim.set(hid, (byVictim.get(hid) || 0) + 1);
      events.push({ t: pk.t, kind: pk.hs ? "hs" : "hit", n: 1, victim: pk.hero });
    } else {
      npcShots++;
      events.push({ t: pk.t, kind: "npc", n: 1 });
    }
  }
  events.sort((a, b) => a.t - b.t);
  const res = {
    weapons: [...weapons], shots, bullets, heroHits: heroShots, headshots, npcHits: npcShots,
    dmg: dmgTotal, heroDmg, events, byVictim: [...byVictim].sort((a, b) => b[1] - a[1]),
    heroAcc: shots - npcShots > 0 ? heroShots / (shots - npcShots) : null,
  };
  m._gun.set(pawn, res);
  return res;
}

/** gun totals up to time t */
export function gunAt(g, t) {
  let shots = 0, hits = 0, hs = 0, npc = 0;
  for (const e of g.events) {
    if (e.t > t) break;
    if (e.kind === "shot") shots += e.n;
    else if (e.kind === "npc") npc++;
    else { hits++; if (e.kind === "hs") hs++; }
  }
  return { shots, hits, hs, npc };
}

/** hero damage a pawn took in the `window` seconds before time t, grouped by attacker + ability */
export function damageTaken(m, pawn, t, window = 10) {
  const by = new Map();
  let total = 0;
  for (const d of m.damage) {
    if (d[3] !== pawn || d[0] > t || d[0] < t - window) continue;
    const key = `${d[1]}|${d[4]}`;
    const row = by.get(key) || { attacker: d[1], ability: d[4], dmg: 0, hits: 0, first: d[0] };
    row.dmg += d[5];
    row.hits++;
    by.set(key, row);
    total += d[5];
  }
  return { total, rows: [...by.values()].sort((a, b) => b.dmg - a.dmg) };
}

/**
 * Fights: hero kills chained together when the next kill follows within `gap` seconds.
 * Returns [{t0, t1, kills, byTeam: {2: n, 3: n}}] (kills credited to the killer's team).
 */
export function detectFights(m, gap = 15) {
  const ks = [...m.kills].sort((a, b) => a[0] - b[0]);
  const fights = [];
  let cur = null;
  for (const k of ks) {
    const victim = m.byPawn.get(k[1]);
    if (!victim) continue;
    const team = victim.team === 2 ? 3 : 2;
    if (!cur || k[0] - cur.t1 > gap) {
      cur = { t0: k[0], t1: k[0], kills: [], byTeam: { 2: 0, 3: 0 } };
      fights.push(cur);
    }
    cur.t1 = k[0];
    cur.kills.push(k);
    cur.byTeam[team]++;
  }
  return fights;
}

/** positioning at a moment: distance to the nearest alive ally and enemies within `radius` m */
export function surroundings(m, pawn, t, radius = 30) {
  const me = m.byPawn.get(pawn);
  const p = posAt(m, pawn, t);
  if (!me || !p) return null;
  let ally = Infinity, enemies = 0;
  for (const o of m.players) {
    if (o.pawn === pawn) continue;
    const h = hpAt(m, o.pawn, t);
    if (!h || h.hp <= 0) continue;
    const q = posAt(m, o.pawn, t);
    if (!q) continue;
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]) * UNIT_M;
    if (o.team === me.team) ally = Math.min(ally, d);
    else if (d <= radius) enemies++;
  }
  return { ally: Number.isFinite(ally) ? ally : null, enemies };
}

/** pseudo-abilities for melee in the UI: light and heavy are tracked as separate abilities */
export const MELEE = { class_name: "__melee", name: "Melee", id: null };
export const MELEE_LIGHT = { class_name: "__melee_light", name: "Light melee", id: null, melee: "light" };
export const MELEE_HEAVY = { class_name: "__melee_heavy", name: "Heavy melee", id: null, melee: "heavy" };
export const MELEE_KIND = { 1: "light", 2: "heavy", 3: "heavy" };
/**
 * What a swing was for, from what was around it: an enemy hero within MELEE_REACH_M = "hero"
 * melee, else an NPC / crate / soul orb / objective within reach = "npc" (farming, pushing),
 * else "move" (melee used to move). Swings that connected or got parried count by what they hit.
 */
export const MELEE_REACH_M = 10;
/** a successful parry catches the enemy swing that started up to 0.6 s before (or 0.2 s after) it */
const PARRY_PAIR = [-0.6, 0.2], PARRY_DIST_M = 8;

/**
 * Successful parries of the whole match paired with the enemy swing they caught:
 * [{t, parrier, attacker, swingT, kind}]. Unpaired parries (troopers, missing data) have attacker null.
 */
export function parryLog(m) {
  if (m._parryLog) return m._parryLog;
  const out = [];
  const swings = m.melee || [];
  for (const [t, parrier, ok] of m.parries || []) {
    if (ok !== 1) continue;
    const me = m.byPawn.get(parrier);
    const p = posAt(m, parrier, t);
    let best = null;
    for (const s of swings) {
      const dt = s[0] - t;
      if (dt < PARRY_PAIR[0] || dt > PARRY_PAIR[1]) continue;
      const a = m.byPawn.get(s[1]);
      if (!a || !me || a.team === me.team) continue;
      const q = posAt(m, s[1], s[0]);
      if ((p[0] || p[1]) && (q[0] || q[1]) && Math.hypot(q[0] - p[0], q[1] - p[1]) * UNIT_M > PARRY_DIST_M) continue;
      if (!best || Math.abs(dt) < Math.abs(best[0] - t)) best = s;
    }
    out.push({ t, parrier, attacker: best ? best[1] : null, swingT: best ? best[0] : null, kind: best ? MELEE_KIND[best[3]] || "light" : null });
  }
  m._parryLog = out;
  return out;
}

/**
 * Melee swings (from the melee ability entity) paired with the melee damage that followed
 * within 0.6 s. Each swing: {t, kind, result: hit|other|miss|parried, dmg, victims, near, parriedBy}
 * where near = an enemy hero was within MELEE_REACH_M ("hero melee"). Totals per light/heavy,
 * parries this player made (with the swing they caught) and timeline events
 * ({t, kind: "shot"|"hit"|"hs"|"npc"}, "hs" = heavy that hit a hero).
 */
export function meleeStats(m, pawn) {
  m._melee ??= new Map();
  if (m._melee.has(pawn)) return m._melee.get(pawn);
  const me = m.byPawn.get(pawn);
  const swings = (m.melee || []).filter((x) => x[1] === pawn);
  const ids = new Set(swings.map((x) => x[2]));
  const dmg = m.damage.filter((d) => d[1] === pawn && ids.has(d[4]));
  const plog = parryLog(m);
  const parriedAt = new Map(plog.filter((x) => x.attacker === pawn).map((x) => [x.swingT, x.parrier]));
  const enemies = m.players.filter((p) => p.team !== me.team);
  const blank = () => ({ n: 0, hero: 0, npc: 0, dmg: 0, near: 0, parried: 0, atNpc: 0, move: 0 });
  const out = { light: blank(), heavy: blank(), events: [], swings: [] };
  let j = 0;
  for (let i = 0; i < swings.length; i++) {
    const [t, , , type] = swings[i];
    const kind = MELEE_KIND[type] || "light";
    const end = Math.min(t + 0.6, i + 1 < swings.length ? swings[i + 1][0] : Infinity);
    while (j < dmg.length && dmg[j][0] < t - 0.05) j++;
    let hero = false, npc = false, total = 0;
    const victims = new Set();
    for (let k = j; k < dmg.length && dmg[k][0] <= end; k++) {
      const v = dmg[k][3] >= 0 ? m.byPawn.get(dmg[k][3]) : null;
      if (v && v.team === me.team) continue;
      if (v) { hero = true; victims.add(dmg[k][3]); } else npc = true;
      total += dmg[k][5];
    }
    const parriedBy = parriedAt.get(t) ?? null;
    // parser (v12+) measured the nearest enemy hero / NPC at swing time in decimeters
    const measured = swings[i].length >= 6;
    const heroD = measured && swings[i][4] >= 0 ? swings[i][4] / 10 : null;
    const npcD = measured && swings[i][5] >= 0 ? swings[i][5] / 10 : null;
    let near = hero || parriedBy != null || (heroD != null && heroD <= MELEE_REACH_M), target = parriedBy;
    if (!near || target == null) {
      const p = posAt(m, pawn, t);
      let bd = Infinity;
      if (p[0] || p[1]) {
        for (const e of enemies) {
          if (!(hpAt(m, e.pawn, t)?.hp > 0)) continue;
          const q = posAt(m, e.pawn, t);
          if (!q[0] && !q[1]) continue;
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]) * UNIT_M;
          if (d <= MELEE_REACH_M + 2 && d < bd) { bd = d; target = e.pawn; if (!measured && d <= MELEE_REACH_M) near = true; }
        }
      }
    }
    const s = out[kind];
    s.n++;
    if (near) s.near++;
    if (parriedBy != null) s.parried++;
    if (hero) s.hero++; else if (npc) s.npc++;
    s.dmg += total;
    const result = parriedBy != null && !hero ? "parried" : hero ? "hit" : npc ? "other" : "miss";
    const intent = near ? "hero" : npc || (npcD != null && npcD <= MELEE_REACH_M) ? "npc" : "move";
    if (intent === "npc") s.atNpc++;
    if (intent === "move") s.move++;
    // how fast the player was moving in the second before the swing (movement melees start fast)
    const p0 = posAt(m, pawn, t - 1), p1 = posAt(m, pawn, t);
    const speed = (p0[0] || p0[1]) && (p1[0] || p1[1]) ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * UNIT_M : null;
    out.swings.push({ t, kind, result, intent, dmg: total, victims: [...victims], near, heroD, npcD, speed, measured,
      target: hero ? [...victims][0] : near ? target : null, parriedBy });
    out.events.push({ t, kind: "shot", n: 1, melee: kind });
    if (hero) out.events.push({ t, kind: kind === "heavy" ? "hs" : "hit", n: 1, victim: [...victims][0], melee: kind });
    else if (npc) out.events.push({ t, kind: "npc", n: 1, melee: kind });
  }
  const parries = (m.parries || []).filter((x) => x[1] === pawn);
  out.parryAttempts = parries.filter((x) => x[2] === 0).length;
  out.parrySuccess = parries.filter((x) => x[2] === 1).length;
  out.parries = parries;
  out.parried = plog.filter((x) => x.parrier === pawn);
  m._melee.set(pawn, out);
  return out;
}

/** melee swings of one kind ("light" / "heavy" / null = both) as a timeline gun model */
export function meleeModel(ms, kind) {
  return kind ? { ...ms, events: ms.events.filter((e) => e.melee === kind), swings: ms.swings.filter((x) => x.kind === kind) } : ms;
}


// ------------------------------------------------------------------ time split

/** victim / attacker classes from the Damage message that count as neutral camps */
const NEUTRAL_CLASSES = new Set([6, 110]);
/**
 * combat state sticks this long around a damage event (seconds before / after). Tuned against
 * Valve's own per-second combat types on 5 matches: about 3-5 points off per category.
 */
const COMBAT_BEFORE = 1, COMBAT_AFTER = 0.5;
/** samples this long after a dash / slide ability use count as dashing / sliding */
const DASH_S = 0.4, SLIDE_S = 0.75;

/**
 * How a player spent [from, to]: combat state and movement per 0.5 s sample while alive,
 * like Valve's per-second combat/move types but rebuilt from the demo.
 *   combat: hero (dealt/took enemy-hero damage) > npc (dealt to troopers, objectives, orbs) >
 *           neutral (dealt to neutral camps) > out, each within -1 s / +0.5 s of a damage event
 *   move:   zipline > dash > slide > airborne > ground
 * Returns seconds per category plus counts of movement actions.
 */
export function timeSplit(m, pawn, assets, from = -Infinity, to = Infinity, tune = {}) {
  // npcHits: also count being hit by troopers / neutrals (Valve doesn't, it seems)
  const { before = COMBAT_BEFORE, after = COMBAT_AFTER, npcHits = false } = tune;
  m._timeSplitEv ??= new Map();
  const me = m.byPawn.get(pawn);
  const tr = m.tracks.get(pawn);
  if (!me || !tr) return null;
  if (!m._timeSplitEv.has(pawn)) {
    const hero = [], npc = [], neutral = [];
    for (const d of m.damage) {
      if (d[1] === pawn) {
        const v = d[3] >= 0 ? m.byPawn.get(d[3]) : null;
        if (v) { if (v.team !== me.team) hero.push(d[0]); } else (NEUTRAL_CLASSES.has(d[6]) ? neutral : npc).push(d[0]);
      } else if (d[3] === pawn && m.byPawn.get(d[1])?.team !== me.team) hero.push(d[0]);
    }
    const npcIn = [], neutralIn = [];
    for (const h of m.npc_hits || []) if (h[1] === pawn) (NEUTRAL_CLASSES.has(h[3]) ? neutralIn : npcIn).push(h[0]);
    const cls = (id) => assets?.item(id)?.class_name || "";
    const moves = {};
    for (const [t, p, id] of m.moves || []) {
      if (p !== pawn) continue;
      const k = cls(id).replace(/^citadel_ability_/, "");
      (moves[k] ??= []).push(t);
    }
    for (const xs of [hero, npc, neutral, npcIn, neutralIn]) xs.sort((a, b) => a - b);
    m._timeSplitEv.set(pawn, { hero, npc, neutral, npcIn, neutralIn, moves });
  }
  const ev = m._timeSplitEv.get(pawn);
  // is there an event in [t - before, t + after]? (sorted arrays, binary search)
  const near = (xs, t, before, after) => {
    let lo = 0, hi = xs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < t - before) lo = mid + 1; else hi = mid; }
    return lo < xs.length && xs[lo] <= t + after;
  };
  const dashes = [...(ev.moves.dash || [])].sort((a, b) => a - b);
  const slides = [...(ev.moves.slide || [])].sort((a, b) => a - b);
  const dt = m.samples.dt;
  const r = { total: 0, combat: { hero: 0, npc: 0, neutral: 0, out: 0 }, move: { zip: 0, dash: 0, slide: 0, air: 0, ground: 0 }, samples: [] };
  for (let i = 0; i < tr.hp.length; i++) {
    const t = m.samples.t0 + i * dt;
    if (t < from || t >= to || tr.hp[i] <= 0 || t < 0) continue;
    r.total += dt;
    const c = near(ev.hero, t, before, after) ? "hero"
      : near(ev.npc, t, before, after) || (npcHits && near(ev.npcIn, t, before, after)) ? "npc"
      : near(ev.neutral, t, before, after) || (npcHits && near(ev.neutralIn, t, before, after)) ? "neutral" : "out";
    r.combat[c] += dt;
    r.samples.push([t, c]);
    const mv = tr.mv?.[i] || 0;
    const k = mv & 2 ? "zip" : near(dashes, t, DASH_S, 0) ? "dash" : (mv & 4 || near(slides, t, SLIDE_S, 0)) && !(mv & 1) ? "slide"
      : mv & 1 ? "air" : "ground";
    r.move[k] += dt;
    r.samples[r.samples.length - 1].push(k);
  }
  const inWin = (xs) => (xs || []).filter((t) => t >= from && t < to).length;
  r.counts = {
    jumps: inWin(ev.moves.jump) + inWin(ev.moves.jump_ratking), dashes: inWin(ev.moves.dash), slides: inWin(ev.moves.slide),
    ziplines: inWin(ev.moves.zip_line), boosts: inWin(ev.moves.zipline_boost), mantles: inWin(ev.moves.mantle), ropes: inWin(ev.moves.climb_rope),
  };
  r.hasMove = !!tr.mv;
  // movement actions with their times (for graphs)
  r.actions = { jumps: [...(ev.moves.jump || []), ...(ev.moves.jump_ratking || [])], dashes: ev.moves.dash || [], slides: ev.moves.slide || [],
    ziplines: ev.moves.zip_line || [], mantles: ev.moves.mantle || [] };
  return r;
}
