// deadlock-api.com access + cache policy (from Build Shitter). Only the build pages use it; the
// browser calls the API directly (CORS is open). Item / hero data comes from the game files instead.
import { encodeBuildString } from "./codec.js";
import * as store from "./store.js";

const API = "https://api.deadlock-api.com/v1";
const HOUR = 60 * 60 * 1000;
export const STALE_AFTER = 24 * HOUR; // cached builds/players refetch on their own after this
export const REFRESH_COOLDOWN = HOUR; // manual refresh: once per hour per build/player

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`deadlock-api: HTTP ${res.status}`);
  return res.json();
}

export class Cooldown extends Error {
  constructor(retryAt) {
    super("Refreshed less than an hour ago");
    this.retryAt = retryAt;
  }
}

const inflight = new Map();
const once = (key, fn) => {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
};

// Fresh hit -> serve it. Stale or missing -> fetch, falling back to the stale copy if the API fails.
// force -> fetch anyway, unless fetched within REFRESH_COOLDOWN.
async function cached(key, { force = false, immutable = false, ttl = STALE_AFTER, tag } = {}, fetcher) {
  const hit = await store.get(key);
  const age = hit ? Date.now() - hit.fetchedAt : Infinity;
  if (hit && force && age < REFRESH_COOLDOWN) throw new Cooldown(hit.fetchedAt + REFRESH_COOLDOWN);
  if (hit && !force && (immutable || age < ttl)) return hit;
  try {
    const value = await once(key, () => fetcher(hit?.value));
    if (value == null) return hit ?? null;
    return store.set(key, value, tag?.(value) ?? null);
  } catch (err) {
    if (hit) return hit;
    throw err;
  }
}

export const withMeta = ({ value, fetchedAt }) => ({ ...value, fetched_at: fetchedAt, refresh_at: fetchedAt + REFRESH_COOLDOWN });

// ---------- builds ----------

// API returns nulls for unset fields; the protobuf encoder wants them absent.
const stripNulls = (v) =>
  Array.isArray(v)
    ? v.map(stripNulls)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).filter(([, x]) => x != null).map(([k, x]) => [k, stripNulls(x)]))
      : v;

function toValue(row) {
  const build = stripNulls(row.hero_build);
  return {
    build,
    share: encodeBuildString(build),
    stats: {
      favorites: row.num_favorites ?? 0,
      weekly_favorites: row.num_weekly_favorites ?? 0,
      ignores: row.num_ignores ?? 0,
      reports: row.num_reports ?? 0,
    },
  };
}

async function searchBuild(id, version) {
  const qs = new URLSearchParams({ build_id: id });
  if (version) qs.set("version", version);
  else qs.set("only_latest", "true");
  const rows = (await getJson(`${API}/builds?${qs}`)) ?? [];
  return rows.sort((a, b) => b.hero_build.version - a.hero_build.version)[0] ?? null;
}

const buildTag = (v) => v.build.author_account_id ?? null;

// Latest version: /builds/{hero}/{id} asks Valve directly (hero may be 0, the right hero is faster),
// so it has builds the search index hasn't crawled. Valve sometimes stalls ~20s, so race it against
// the index: prefer the live copy if it's quick, else use the indexed one and cache the live one later.
async function fetchLatestBuild(id, prev, force) {
  const hero = prev?.build.hero_id ?? 0;
  const direct = getJson(`${API}/builds/${hero}/${id}${force ? "?force_refetch=true" : ""}`).catch(() => null);
  const indexed = searchBuild(id).catch(() => null);
  const quick = await Promise.race([direct, new Promise((r) => setTimeout(() => r(undefined), 3000))]);
  let row;
  if (quick !== undefined) row = quick ?? (await indexed);
  else {
    row = await indexed;
    if (row) {
      direct.then((live) => {
        if (live?.hero_build) {
          const v = toValue(live);
          store.set(`build:${id}@latest`, v, buildTag(v));
        }
      });
    } else row = await direct;
  }
  if (!row?.hero_build) return null;
  const value = toValue(row);
  store.set(`build:${id}@v${value.build.version}`, value); // versions never change
  return value;
}

export function getBuild(id, version, force = false) {
  if (version) {
    return cached(`build:${id}@v${version}`, { immutable: true }, async () => {
      const row = await searchBuild(id, version);
      return row && toValue(row);
    });
  }
  return cached(`build:${id}@latest`, { force, tag: buildTag }, (prev) => fetchLatestBuild(id, prev, force));
}

// ---------- players ----------

const STEAM64_BASE = 76561197960265728n;

// Accepts a SteamID3 account id or a SteamID64; returns the account id as a string.
export function parseAccount(s) {
  if (!/^\d{1,20}$/.test(s)) return null;
  const n = BigInt(s);
  if (n <= 0xffffffffn) return String(n);
  const acc = n - STEAM64_BASE;
  return acc > 0n && acc <= 0xffffffffn ? String(acc) : null;
}

const summarize = ({ build, share, stats }) => ({
  id: build.hero_build_id,
  hero_id: build.hero_id,
  name: build.name ?? "",
  description: build.description ?? "",
  version: build.version,
  updated: build.last_updated_timestamp ?? null,
  favorites: stats.favorites,
  share,
});

async function fetchPlayer(account) {
  const PAGE = 500;
  const rows = [];
  for (let start = 0; start < 5000; start += PAGE) {
    const qs = new URLSearchParams({
      author_id: account,
      only_latest: "true",
      sort_by: "updated_at",
      sort_direction: "desc",
      limit: PAGE,
      start,
    });
    const page = (await getJson(`${API}/builds?${qs}`)) ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { builds: rows.map((r) => summarize(toValue(r))) };
}

export async function getPlayer(account, force = false) {
  const entry = await cached(`player:${account}`, { force }, () => fetchPlayer(account));
  // The search index lags; overlay fresher builds of this author fetched live.
  const builds = new Map(entry.value.builds.map((b) => [b.id, b]));
  for (const { key, value } of await store.byTag(account)) {
    if (!key.endsWith("@latest")) continue;
    const b = summarize(value);
    if (!builds.has(b.id) || builds.get(b.id).version < b.version) builds.set(b.id, b);
  }
  return {
    value: {
      account_id: Number(account),
      steam_id64: String(BigInt(account) + STEAM64_BASE),
      builds: [...builds.values()].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0)),
    },
    fetchedAt: entry.fetchedAt,
  };
}

// ---------- Steam profiles (name + avatar, via deadlock-api; Steam's own API has no CORS) ----------

const PROFILE_TTL = 24 * HOUR;

/** {account id: {name, avatar, avatar_full, url}} for the given ids, cached for a day */
export async function getProfiles(ids) {
  const out = {};
  const missing = [];
  for (const id of new Set(ids.map(String))) {
    const hit = await store.get(`steam:${id}`);
    if (hit && Date.now() - hit.fetchedAt < PROFILE_TTL) out[id] = hit.value;
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    let rows = [];
    try {
      rows = (await getJson(`${API}/players/steam?account_ids=${chunk.join(",")}`)) ?? [];
    } catch {
      continue; // no names this time; the page shows ids
    }
    for (const r of rows) {
      const p = { name: r.personaname || null, avatar: r.avatarmedium || r.avatar || null, avatar_full: r.avatarfull || null, url: r.profileurl || null };
      out[String(r.account_id)] = p;
      store.set(`steam:${r.account_id}`, p);
    }
  }
  return out;
}
export const getProfile = async (id) => (await getProfiles([id]))[String(id)] ?? null;

/** players by Steam name (or vanity / account id), best matches first: [{acc, name, avatar, url, played30}] */
export async function searchPlayers(query, limit = 24) {
  const rows = (await getJson(`${API}/players/steam-search?search_query=${encodeURIComponent(query)}&limit=${limit}`)) ?? [];
  return rows.map((r) => {
    const p = { name: r.personaname || null, avatar: r.avatarmedium || r.avatar || null, avatar_full: r.avatarfull || null, url: r.profileurl || null };
    store.set(`steam:${r.account_id}`, p);
    return { acc: String(r.account_id), played30: r.matches_played_last_30d ?? null, ...p };
  });
}

/** a build from the search index by id (cheap; no Valve request), or null */
export async function findBuild(id) {
  const row = await searchBuild(id).catch(() => null);
  return row?.hero_build ? toValue(row) : null;
}

/** a match's summary (teams, heroes, K/D/A, result) from deadlock-api, or null */
export async function matchInfo(id) {
  const rows = (await getJson(`${API}/matches/metadata?match_ids=${id}&include_info=true&include_player_info=true`)) ?? [];
  return rows.find((r) => String(r.match_id) === String(id)) ?? null;
}
