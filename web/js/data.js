// Loading + lookup helpers for index/assets/profiles and parsed matches.

export async function loadJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// ---- client cache: compressed match files in IndexedDB, 1 h lifetime -------------------
// (localStorage is ~5 MB per origin; a single match is several MB once unzipped)
const CACHE_DB = "skillhitter";
const CACHE_TTL_MS = 60 * 60 * 1000;

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function cacheGet(key) {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const r = db.transaction("files").objectStore("files").get(key);
      r.onsuccess = () => resolve(r.result && Date.now() - r.result.at < CACHE_TTL_MS ? r.result.buf : null);
      r.onerror = () => resolve(null);
    });
  } catch { return null; }
}
async function cachePut(key, buf) {
  try {
    const db = await idb();
    db.transaction("files", "readwrite").objectStore("files").put({ at: Date.now(), buf }, key);
  } catch { /* private mode / quota: just don't cache */ }
}
export async function clearCache() {
  try { indexedDB.deleteDatabase(CACHE_DB); } catch { /* ignore */ }
}

/** fetches a .json.gz (via the 1 h IndexedDB cache); decompresses unless the server already did. */
async function loadGzJSON(url) {
  let buf = await cacheGet(url);
  if (!buf) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    buf = await r.arrayBuffer();
    cachePut(url, buf);
  }
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

export class Assets {
  constructor(raw) {
    this.heroes = raw.heroes;
    this.items = raw.items;
    this.map = raw.map;
    this.ranks = raw.ranks || {};
    this.accolades = raw.accolades || {};
    this.modifiers = raw.modifiers || {};
    this.byClass = new Map();
    for (const [id, it] of Object.entries(raw.items)) this.byClass.set(it.class_name, { id: Number(id), ...it });
  }
  hero(id) { return this.heroes[id] || { name: `hero ${id}`, icon: "", signatures: [] }; }
  item(id) { return this.items[id]; }
  itemByClass(cls) { return this.byClass.get(cls); }
  abilityName(cls) { return this.byClass.get(cls)?.name || cls; }
  abilityIcon(cls) { return this.byClass.get(cls)?.image || this.byClass.get(cls)?.image_remote || ""; }
  /** local icon if mirrored, else the deadlock-api CDN url */
  itemIcon(id) { const it = this.items[id]; return it?.image || it?.image_remote || ""; }
  /** signature abilities of a hero, as item entries (with id) */
  signatures(heroId) {
    return (this.hero(heroId).signatures || []).filter(Boolean)
      .map((cls) => this.byClass.get(cls) || { class_name: cls, name: cls });
  }
}

const matchCache = new Map();

/** parsed match with lookup helpers attached */
let dataVersion = 0;
/** bump the cache key when the server's parser format changes */
export function setDataVersion(v) { dataVersion = v || 0; }

export async function loadMeta(id) {
  return loadGzJSON(`data/meta/${id}.json.gz`);
}

export async function loadMatch(id) {
  if (!matchCache.has(id)) {
    matchCache.set(id, loadGzJSON(`data/matches/${id}.json.gz?v=${dataVersion}`).then(prepare).catch((e) => {
      matchCache.delete(id);
      throw e;
    }));
  }
  return matchCache.get(id);
}

export function prepare(m) {
  m.end = m.game_over_s ?? m.duration_s;
  m.byPawn = new Map(m.players.map((p) => [p.pawn, p]));
  m.tracks = new Map(m.samples.tracks.map((t) => [t.pawn, t]));
  m.statTracks = new Map(m.stats.tracks.map((t) => [t.pawn, t]));
  m.player = (accountId) => m.players.find((p) => p.account_id === accountId);
  return m;
}

/** interpolated [x, y] of a pawn at game time t (null if unknown / dead / teleporting) */
export function posAt(m, pawn, t) {
  const tr = m.tracks.get(pawn);
  if (!tr) return null;
  const f = (t - m.samples.t0) / m.samples.dt;
  const i = Math.floor(f);
  const n = tr.hp.length;
  if (i < 0 || i >= n) return null;
  const x0 = tr.pos[i * 2], y0 = tr.pos[i * 2 + 1];
  if (x0 === 0 && y0 === 0) return null;
  if (i + 1 >= n) return [x0, y0];
  const x1 = tr.pos[i * 2 + 2], y1 = tr.pos[i * 2 + 3];
  // don't smear teleports / respawns across the map
  if ((x1 === 0 && y1 === 0) || Math.hypot(x1 - x0, y1 - y0) > 1500) return [x0, y0];
  const a = f - i;
  return [x0 + (x1 - x0) * a, y0 + (y1 - y0) * a];
}

export function hpAt(m, pawn, t) {
  const tr = m.tracks.get(pawn);
  if (!tr) return null;
  const i = Math.round((t - m.samples.t0) / m.samples.dt);
  if (i < 0 || i >= tr.hp.length) return null;
  return { hp: tr.hp[i], max: tr.max_hp[i] };
}

/** [net_worth, level, kills, deaths, assists, last_hits] at time t */
export function statsAt(m, pawn, t) {
  const tr = m.statTracks.get(pawn);
  if (!tr || !tr.rows.length) return null;
  const i = Math.min(tr.rows.length - 1, Math.max(0, Math.floor((t - m.stats.t0) / m.stats.dt)));
  return tr.rows[i];
}

export const TEAM_NAMES = { 2: "Amber", 3: "Sapphire" };

/** items a pawn owns at time t (demo item events: +1 bought, -1 sold/consumed) */
export function itemsAt(m, pawn, t) {
  const owned = new Map(); // item id -> count
  for (const it of m.items) {
    if (it[1] !== pawn || it[0] > t) continue;
    owned.set(it[2], (owned.get(it[2]) || 0) + it[3]);
  }
  return [...owned].filter(([, n]) => n > 0).map(([id]) => id);
}

/** upgrade bits (m_nUpgradeInfo) per ability at time t; tier = popcount(bits >> 16) */
export function abilityLevelsAt(m, pawn, t) {
  const lv = new Map();
  for (const u of m.upgrades || []) {
    if (u[1] !== pawn || u[0] > t) continue;
    let bits = Number(BigInt(u[3]) >> 16n), n = 0;
    while (bits) { n += bits & 1; bits >>= 1; }
    lv.set(u[2], n);
  }
  return lv;
}

/** modifiers active on a pawn at time t: [start, end, parent, caster, modifier, ability, stacks] */
export function modifiersAt(m, pawn, t) {
  return (m.modifiers || []).filter((x) => x[2] === pawn && x[0] <= t && x[1] > t);
}
