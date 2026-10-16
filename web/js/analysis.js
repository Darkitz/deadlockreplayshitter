// "Thrown vs hit" analysis, hero/ability agnostic.
//
// Thrown: ImportantAbilityUsed events for the ability (newer demos), falling back to the
//         ability entity's cooldown starting (older demos lack ImportantAbilityUsed).
// Hit:    the first damage / status event from that ability id after the cast, inside the
//         hit window (cut short by the next cast). Enemy hero → "hit", anything else that is
//         not an ally → "other", nothing → "miss".

import { posAt } from "./data.js";

/** world units → meters (Source units are inches) */
export const UNIT_M = 0.0254;

export const PHASES = [
  { key: "lane", label: "0–10 min", from: -Infinity, to: 600 },
  { key: "mid", label: "10–20 min", from: 600, to: 1200 },
  { key: "late", label: "20–30 min", from: 1200, to: 1800 },
  { key: "ot", label: "30+ min", from: 1800, to: Infinity },
];

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

  // [t, victimPawn|-1, dmg, x, y]
  const hits = [];
  if (aid != null) {
    for (const d of m.damage) {
      if (d[1] !== pawn || d[4] !== aid || d[3] === pawn) continue;
      hits.push([d[0], d[3], d[5], d[7], d[8]]);
    }
    for (const n of m.notify) {
      if (n[1] !== pawn || n[3] !== aid || n[2] === pawn || n[2] < 0) continue;
      hits.push([n[0], n[2], 0, null, null]);
    }
  }
  hits.sort((a, b) => a[0] - b[0]);

  let j = 0;
  for (let i = 0; i < casts.length; i++) {
    const c = casts[i];
    const end = Math.min(c.t + opts.window, i + 1 < casts.length ? casts[i + 1].t : Infinity);
    while (j < hits.length && hits[j][0] < c.t) j++;
    let heroHit = null, otherHit = null, dmg = 0;
    const victims = new Set();
    for (let k = j; k < hits.length && hits[k][0] < end; k++) {
      const h = hits[k];
      const vic = h[1] >= 0 ? m.byPawn.get(h[1]) : null;
      if (vic && vic.team === me?.team) continue; // ally buff / self
      if (vic) {
        heroHit ??= h;
        victims.add(h[1]);
      } else {
        otherHit ??= h;
      }
      dmg += h[2];
    }
    const first = heroHit || otherHit;
    c.result = heroHit ? "hit" : otherHit ? "other" : "miss";
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
  const res = { source, casts };
  m._analysis.set(key, res);
  return res;
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
  return { thrown, hit, other, miss: thrown - hit - other, scored, dmg, acc: thrown ? scored / thrown : 0 };
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
  // active items: anything non-ability that started a cooldown
  const itemUses = new Map();
  for (const u of m.uses) {
    if (u[1] !== pawn) continue;
    const it = assets.item(u[2]);
    if (!it || it.type === "ability" || it.type === "weapon") continue;
    itemUses.set(u[2], (itemUses.get(u[2]) || 0) + 1);
  }
  for (const [id, n] of [...itemUses].sort((a, b) => b[1] - a[1])) {
    const it = { id, ...assets.item(id) };
    const a = analyzeAbility(m, pawn, it, opts);
    rows.push({ ability: it, ...counts(a.casts, opts.heroesOnly), source: a.source, item: true, uses: n });
  }
  return rows;
}

/** aggregates over many analyzed matches for the overview charts */
export function aggregate(list, heroesOnly) {
  const phases = PHASES.map((ph) => ({ ...ph, thrown: 0, scored: 0 }));
  const victims = new Map(); // hero_id -> hits
  const delays = [];
  const dists = [];
  for (const { match, casts } of list) {
    for (const c of casts) {
      const ph = phases.find((x) => c.t >= x.from && c.t < x.to);
      ph.thrown++;
      const ok = c.result === "hit" || (!heroesOnly && c.result === "other");
      if (ok) ph.scored++;
      if (c.delay != null && ok) delays.push(c.delay);
      if (c.dist != null && ok) dists.push(c.dist);
      for (const v of c.victims) {
        const hid = match.byPawn.get(v)?.hero_id;
        victims.set(hid, (victims.get(hid) || 0) + 1);
      }
    }
  }
  return { phases, victims: [...victims].sort((a, b) => b[1] - a[1]), delays, dists };
}
