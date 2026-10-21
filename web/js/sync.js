// A player's last matches (the player page's Matches tab), synced in the browser. Your own
// account can be remembered in this browser (open #/?account=<SteamID64 or account id>, or
// "this is me" on your player page; #/?account= forgets it). Nothing about it is in the site's
// code or on any server.
//
// Everything runs in the page: the browser asks deadlock-api for the match history and each
// match's salts, and parses demos like dropped files. A page can't read Valve's replay servers
// itself (plain http, no CORS headers), so a demo is downloaded by the browser like any file.
// In Chrome / Edge you can give the page one folder to read (your Downloads, or the game's
// replays folder): demos that land there are picked up and parsed by themselves.

import { esc, S, ago } from "./ui.js";
import { fmtClock } from "./timeline.js";
import { openDemoFiles } from "./local.js";

const API = "https://api.deadlock-api.com/v1";
const KEY = "dldi.account";
const COUNT = 40;
const STEAM64_BASE = 76561197960265728n;

// ------------------------------------------------------------------ the account (this browser only)

export function storedAccount() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

/** remember (or with null forget) your account in this browser */
export function setStoredAccount(id) {
  try {
    if (id == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(id));
  } catch { /* storage blocked */ }
  window.dispatchEvent(new Event("dldi-account"));
}

/** #/?account=… stores (or with an empty value forgets) the account; returns true if it changed */
export function applyAccountParam(params) {
  if (!params.has("account")) return false;
  const raw = params.get("account").trim();
  if (!raw) setStoredAccount(null);
  else if (/^\d{1,20}$/.test(raw)) {
    const n = BigInt(raw);
    setStoredAccount(String(n > 0xffffffffn ? n - STEAM64_BASE : n));
  }
  // keep the id out of the address bar and history
  params.delete("account");
  history.replaceState(null, "", `${location.pathname}${location.search}#/${params.size ? `?${params}` : ""}`);
  return true;
}

// ------------------------------------------------------------------ data

const getJSON = async (url) => {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || `HTTP ${r.status}`), { status: r.status });
  return body;
};

// per match: "checking" | "folder" (demo in the watched folder) | "ready" (Valve URL known) |
// "waiting" (download started, watching the folder) | "none" (no replay salt known) | "gone"
// (Steam had none either) | "busy" | "error"
const state = new Map();
const salts = new Map(); // match id -> demo URL
const note = new Map(); // match id -> status line
const cache = new Map(); // account -> { at, rows }
let busy = false;

async function loadHistory(acc) {
  const hit = cache.get(acc);
  if (hit && Date.now() - hit.at < 120_000) return hit.rows;
  const rows = (await getJSON(`${API}/players/${acc}/match-history`)).slice(0, COUNT);
  cache.set(acc, { at: Date.now(), rows });
  return rows;
}

// ------------------------------------------------------------------ the watched folder (Chrome / Edge)

const canWatch = typeof window.showDirectoryPicker === "function";
const folder = { handle: null, granted: false, files: new Map() }; // files: match id -> file handle

function kv(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("dldi-sync", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      let t, r;
      try {
        t = req.result.transaction("kv", mode);
        r = fn(t.objectStore("kv"));
      } catch (err) {
        reject(err);
        return;
      }
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
    };
  });
}

async function loadFolder() {
  if (!canWatch || folder.handle) return;
  try {
    folder.handle = (await kv("readonly", (s) => s.get("folder"))) || null;
    folder.granted = folder.handle ? (await folder.handle.queryPermission({ mode: "read" })) === "granted" : false;
  } catch { folder.handle = null; }
}

async function pickFolder() {
  try {
    folder.handle = await window.showDirectoryPicker({ id: "dldi-demos", mode: "read", startIn: "downloads" });
    folder.granted = true;
  } catch {
    return; // cancelled
  }
  try { await kv("readwrite", (s) => s.put(folder.handle, "folder")); } catch { /* not remembered: pick again next visit */ }
}

async function allowFolder() {
  try { folder.granted = (await folder.handle.requestPermission({ mode: "read" })) === "granted"; } catch { folder.granted = false; }
}

/** demos in the folder: <id>.dem (the game's replays) or <id>_<salt>.dem.bz2 (Valve's downloads).
 *  Chrome only gives a download its real name once it's complete. */
async function scanFolder() {
  folder.files = new Map();
  if (!folder.handle || !folder.granted) return;
  try {
    for await (const [name, h] of folder.handle.entries()) {
      const m = h.kind === "file" && /^(\d{5,12})(?:_\d+)?\.dem(\.bz2)?$/.exec(name);
      if (m && (!folder.files.has(Number(m[1])) || !m[2])) folder.files.set(Number(m[1]), h);
    }
  } catch { folder.granted = false; }
}

// ------------------------------------------------------------------ view

const synced = (id) => (S.localMatches || []).some((m) => m.match_id === id);
const status = (id) => (synced(id) ? "synced" : folder.files.has(id) && !["busy", "error"].includes(state.get(id)) ? "folder" : state.get(id) || "checking");

/** a player's last matches with sync, into `mount` (the player page's Matches tab) */
export async function renderMatches(mount, acc) {
  mount.classList.add("sync");
  mount.innerHTML = `<p class="muted">Loading match history from deadlock-api…</p>`;
  let rows;
  try {
    [rows] = await Promise.all([loadHistory(acc), loadFolder()]);
    await scanFolder();
  } catch (err) {
    mount.innerHTML = `<p class="bad">Couldn't load the match history from deadlock-api: ${esc(err.message)}</p>`;
    return;
  }
  for (const r of rows) if (!state.has(r.match_id)) state.set(r.match_id, "checking");
  if (!rows.length) { mount.innerHTML = `<p class="muted">deadlock-api has no matches for this player.</p>`; return; }
  const draw = () => { if (mount.isConnected) mount.innerHTML = sectionHTML(rows); };
  draw();
  mount.addEventListener("click", async (ev) => {
    const dl = ev.target.closest("[data-download]");
    if (dl) { // the browser downloads it; watch the folder for it
      state.set(Number(dl.dataset.download), "waiting");
      setTimeout(draw, 0);
      return;
    }
    const b = ev.target.closest("[data-sync], [data-steam], [data-sync-all], [data-pick-folder], [data-allow-folder], [data-pick-demo]");
    if (!b || b.disabled) return;
    ev.preventDefault();
    if (b.dataset.syncAll != null) syncAll(rows, draw);
    else if (b.dataset.sync) sync(Number(b.dataset.sync), draw);
    else if (b.dataset.steam) askSteam(Number(b.dataset.steam), draw);
    else if (b.dataset.pickDemo != null) S.pickDemo?.();
    else {
      if (b.dataset.pickFolder != null) await pickFolder(); else await allowFolder();
      await scanFolder();
      draw();
    }
  });
  // the folder: new demos show up as they finish downloading; started downloads sync by themselves
  const timer = setInterval(async () => {
    if (!mount.isConnected) { clearInterval(timer); return; }
    if (!folder.granted || busy || document.hidden) return;
    const before = folder.files.size;
    await scanFolder();
    const arrived = rows.find((r) => state.get(r.match_id) === "waiting" && folder.files.has(r.match_id) && !synced(r.match_id));
    if (arrived) sync(arrived.match_id, draw);
    else if (folder.files.size !== before) draw();
  }, 2500);
  // which matches have a demo: deadlock-api's stored salts (no Steam requests), a few at a time
  const todo = rows.filter((r) => state.get(r.match_id) === "checking" && !synced(r.match_id));
  const worker = async () => {
    for (let r; (r = todo.shift());) {
      try {
        const s = await getJSON(`${API}/matches/${r.match_id}/salts?disable_steam=true`);
        if (s.demo_url) salts.set(r.match_id, s.demo_url);
        if (state.get(r.match_id) === "checking") state.set(r.match_id, s.demo_url ? "ready" : "none");
      } catch {
        if (state.get(r.match_id) === "checking") state.set(r.match_id, "none");
      }
      draw();
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
}

function folderHTML() {
  if (!canWatch) return `<span class="muted small">Download a demo, then drop it onto the page.</span>`;
  const help = "A folder this page may read&#10;Pick your Downloads folder (where demos land) or the game's replays folder. Demos that show up there are synced by themselves.&#10;Only this page can read it, and only in this browser.";
  if (!folder.handle) return `<button class="btn small" data-pick-folder data-help="${help}">pick your Downloads folder</button>`;
  if (!folder.granted) return `<button class="btn small" data-allow-folder data-help="${help}">allow reading “${esc(folder.handle.name)}”</button>`;
  return `<span class="muted small" data-help="${help}">watching “${esc(folder.handle.name)}”</span><button class="btn small" data-pick-folder>change</button>`;
}

function sectionHTML(rows) {
  const inFolder = rows.filter((r) => status(r.match_id) === "folder");
  const done = rows.filter((r) => synced(r.match_id)).length;
  return `
    <div class="sync-bar">
      <span class="muted small" data-help="Last matches&#10;From deadlock-api's match history. Synced ones are parsed and kept in this browser.">${done} of ${rows.length} synced</span>
      ${inFolder.length ? `<button class="btn primary small" data-sync-all ${busy ? "disabled" : ""}>sync all ${inFolder.length}</button>` : ""}
      ${folderHTML()}
      <button class="drop-strip" data-pick-demo data-help="Drop a demo&#10;Drop a .dem / .dem.bz2 anywhere on the page, or click to pick one.">⤓ drop a demo here</button>
    </div>
    <section class="match-grid sync-grid">${rows.map(cardHTML).join("")}</section>`;
}

function cardHTML(r) {
  const id = r.match_id;
  const hero = S.assets.hero(r.hero_id);
  const won = r.match_result === r.player_team;
  const st = status(id);
  const url = salts.get(id);
  const where = folder.granted ? `lands in “${esc(folder.handle.name)}”, then syncs` : "then drop it onto the page";
  const action = {
    synced: `<a class="btn small" href="#/match/${id}">open</a>`,
    folder: `<button class="btn primary small" data-sync="${id}" ${busy ? "disabled" : ""}>sync</button><small>demo in the folder</small>`,
    ready: `<a class="btn primary small" href="${esc(url)}" target="_blank" rel="noopener" data-download="${id}" data-help="Download the demo&#10;From Valve's replay servers. They're plain http, so your browser may ask before keeping the file.">download demo</a><small>${where}</small>`,
    waiting: `<a class="btn small" href="${esc(url)}" target="_blank" rel="noopener" data-download="${id}">again</a><small>${folder.granted ? `waiting for it in “${esc(folder.handle.name)}”…` : "drop it onto the page when it's done"}</small>`,
    none: `<button class="btn small" data-steam="${id}" data-help="Ask deadlock-api for the demo link&#10;deadlock-api (deadlock-api.com, a community API, not Valve) doesn't have this match's replay salt yet. This asks it to look it up from Steam, which it can only do about 10 times per 30 minutes.">ask deadlock-api</button><small>no demo link known yet</small>`,
    gone: `<small>no demo available</small>`,
    checking: `<small>checking…</small>`,
    busy: `<small>${esc(note.get(id) || "working…")}</small>`,
    error: `${folder.files.has(id) ? `<button class="btn small" data-sync="${id}">retry</button>` : ""}<small class="err">${esc(note.get(id) || "failed")}</small>`,
  }[st];
  return `<div class="match-card sync-card ${st === "synced" ? "is-synced" : ""}" data-mid="${id}" data-state="${st}">
    <div class="mc-top">
      <b>#${id}</b>
      <span class="muted">${fmtClock(r.match_duration_s || 0)}</span>
      <span class="muted small">${r.start_time ? ago(new Date(r.start_time * 1000)) : ""}</span>
    </div>
    <div class="sc-body">
      <img class="sc-hero" src="${esc(hero.icon)}" alt="" data-help="${esc(hero.name)}">
      <div class="sc-line"><b class="${won ? "good" : "bad"}">${won ? "Win" : "Loss"}</b> · ${esc(hero.name)}</div>
      <div class="sc-line muted">${r.player_kills}/${r.player_deaths}/${r.player_assists} · ${(r.net_worth / 1000).toFixed(1)}k souls · lvl ${r.hero_level}</div>
    </div>
    <div class="sc-action">${action}</div>
  </div>`;
}

// ------------------------------------------------------------------ actions

async function askSteam(id, draw) {
  state.set(id, "busy");
  note.set(id, "asking Steam…");
  draw();
  try {
    const s = await getJSON(`${API}/matches/${id}/salts`);
    if (s.demo_url) salts.set(id, s.demo_url);
    state.set(id, s.demo_url ? "ready" : "gone");
  } catch (err) {
    state.set(id, err.status === 429 ? "none" : "error");
    note.set(id, err.message);
    if (err.status === 429) alert("deadlock-api can only look up about 10 demo links per 30 minutes. Try again later.");
  }
  draw();
}

/** read the demo from the folder and parse it like a dropped file */
async function sync(id, draw, { single = true } = {}) {
  if (single && busy) return false;
  if (single) busy = true;
  state.set(id, "busy");
  note.set(id, "reading the demo…");
  draw();
  try {
    const file = await folder.files.get(id).getFile();
    if (await openDemoFiles([file], { navigate: false }) == null) throw new Error("couldn't parse the demo");
    state.set(id, "synced");
    return true;
  } catch (err) {
    state.set(id, "error");
    note.set(id, err.message);
    return false;
  } finally {
    if (single) busy = false;
    draw();
  }
}

async function syncAll(rows, draw) {
  if (busy) return;
  busy = true;
  try {
    for (const r of rows) if (status(r.match_id) === "folder") await sync(r.match_id, draw, { single: false });
  } finally {
    busy = false;
    draw();
  }
}
