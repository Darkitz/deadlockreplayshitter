// Loading + lookup helpers for index/assets/profiles and parsed matches.

export async function loadJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/** fetches a .json.gz; decompresses unless the server already did (Content-Encoding). */
async function loadGzJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
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
    this.byClass = new Map();
    for (const [id, it] of Object.entries(raw.items)) this.byClass.set(it.class_name, { id: Number(id), ...it });
  }
  hero(id) { return this.heroes[id] || { name: `hero ${id}`, icon: "", signatures: [] }; }
  item(id) { return this.items[id]; }
  itemByClass(cls) { return this.byClass.get(cls); }
  abilityName(cls) { return this.byClass.get(cls)?.name || cls; }
  abilityIcon(cls) { return this.byClass.get(cls)?.image || ""; }
  /** signature abilities of a hero, as item entries (with id) */
  signatures(heroId) {
    return (this.hero(heroId).signatures || []).filter(Boolean)
      .map((cls) => this.byClass.get(cls) || { class_name: cls, name: cls });
  }
}

const matchCache = new Map();

/** parsed match with lookup helpers attached */
export async function loadMatch(id) {
  if (!matchCache.has(id)) {
    matchCache.set(id, loadGzJSON(`data/matches/${id}.json.gz`).then(prepare).catch((e) => {
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
