// Demos dropped onto the page: parsed in the browser (parse-worker.js + WebAssembly), kept in
// IndexedDB so their #/match/<id> links keep working, and listed on the home page.
// Nothing is uploaded anywhere.

import { $, esc, S } from "./ui.js";
import { forgetMatch } from "./data.js";
import { fmtClock } from "./timeline.js";

const DB = "skillhitter-local";

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("matches"); // id -> parsed JSON text
      req.result.createObjectStore("list"); // id -> summary (for the Matches page)
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  }));
}

export async function localList() {
  try {
    return (await tx("list", "readonly", (s) => s.getAll())) || [];
  } catch { return []; }
}
/** parsed match JSON (raw, not prepared) or null */
export async function localGet(id) {
  try {
    const text = await tx("matches", "readonly", (s) => s.get(id));
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}
export async function localDelete(id) {
  await tx("matches", "readwrite", (s) => s.delete(id));
  await tx("list", "readwrite", (s) => s.delete(id));
  S.localMatches = (S.localMatches || []).filter((m) => m.match_id !== id);
}
async function localPut(id, text, summary) {
  await tx("matches", "readwrite", (s) => s.put(text, id));
  await tx("list", "readwrite", (s) => s.put(summary, id));
}

/** Deadlock names replays <match id>.dem; anything else gets a stable id from name + size */
export function matchIdFromFile(file) {
  const m = /^(\d{4,12})(?:_\d+)?\.dem/.exec(file.name);
  if (m) return Number(m[1]);
  let h = 2166136261;
  for (const c of `${file.name}|${file.size}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return 900000000000 + (h % 1000000000);
}

/** what the home page lists */
function summarize(m, file) {
  return {
    match_id: m.match_id, local: true, file: file.name, size: file.size, parsed_at: Date.now(),
    parser_version: m.version, duration_s: m.game_over_s ?? m.duration_s, winner: m.winning_team ?? null,
    warnings: m.warnings || [],
    players: m.players.map((p) => ({
      name: p.name, account_id: p.account_id, hero_id: p.hero_id, team: p.team,
      k: p.kills, d: p.deaths, a: p.assists, net_worth: p.net_worth,
    })),
  };
}

/** parse one file in a worker; onProgress(gameSeconds) */
export function parseFile(file, matchId, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./parse-worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => {
      if (data.type === "progress") onProgress?.(data.t);
      else {
        w.terminate();
        if (data.type === "done") resolve(data.json);
        else reject(new Error(data.message));
      }
    };
    w.onerror = (ev) => { w.terminate(); reject(new Error(ev.message || "worker failed")); };
    w.postMessage({ file, matchId });
  });
}

const looksLikeDemo = (f) => /\.dem(\.bz2)?$/i.test(f.name);

/** parse, store and open dropped / picked files */
export async function openDemoFiles(files) {
  const list = [...files].filter(looksLikeDemo);
  const ov = overlay();
  if (!list.length) {
    ov.show(`<b>That's not a demo.</b><p class="muted">Drop a Deadlock replay: <code>.dem</code> (from
      <code>Deadlock/game/citadel/replays</code>) or <code>.dem.bz2</code> (Valve's replay servers).</p>`, true);
    return;
  }
  let lastId = null;
  for (const [i, file] of list.entries()) {
    const id = matchIdFromFile(file);
    forgetMatch(id);
    const head = `${list.length > 1 ? `${i + 1}/${list.length} · ` : ""}<b>${esc(file.name)}</b> <span class="muted">${(file.size / 1048576).toFixed(0)} MB</span>`;
    ov.show(`${head}<div class="drop-bar"><i style="width:2%"></i></div><p class="muted drop-stage">reading file…</p>`);
    const t0 = performance.now();
    try {
      const json = await parseFile(file, id, (t) => {
        ov.stage(t > 0 ? `parsing · game clock ${fmtClock(t)}` : "parsing · pregame");
        // no total length up front; a typical match is 30-40 min
        ov.bar(Math.min(95, (Math.max(0, t) / 2400) * 95));
      });
      const raw = JSON.parse(json);
      const summary = summarize(raw, file);
      await localPut(id, json, summary);
      S.localMatches = [summary, ...(S.localMatches || []).filter((m) => m.match_id !== id)];
      ov.bar(100);
      ov.stage(`parsed in ${((performance.now() - t0) / 1000).toFixed(1)} s${raw.warnings?.length ? ` · ${raw.warnings.length} warnings` : ""}`);
      lastId = id;
    } catch (err) {
      ov.show(`${head}<p class="bad">Could not parse: ${esc(err.message)}</p>`, true);
      return;
    }
  }
  ov.hide();
  if (lastId != null) {
    // the match view caches loaded matches by id; a re-dropped file must replace the old parse
    forgetMatch(lastId);
    const target = list.length > 1 ? "#/" : `#/match/${lastId}`;
    // already there (re-dropped the open match, or several files from home): re-render
    if (location.hash === target || (target === "#/" && !location.hash.startsWith("#/match"))) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = target;
  }
}

function overlay() {
  let el = $("#drop-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "drop-status";
    el.innerHTML = `<div class="drop-card"><div class="drop-body"></div><button class="btn drop-close" hidden>close</button></div>`;
    document.body.append(el);
    el.querySelector(".drop-close").onclick = () => { el.hidden = true; };
  }
  return {
    show(html, closable = false) {
      el.hidden = false;
      el.querySelector(".drop-body").innerHTML = html;
      el.querySelector(".drop-close").hidden = !closable;
    },
    stage(text) { const s = el.querySelector(".drop-stage"); if (s) s.textContent = text; },
    bar(p) { const b = el.querySelector(".drop-bar i"); if (b) b.style.width = `${p}%`; },
    hide() { el.hidden = true; },
  };
}

/** drag a demo anywhere onto the page, or use the header's "open demo" button */
export function initDropZone() {
  const zone = document.createElement("div");
  zone.id = "drop-zone";
  zone.hidden = true;
  zone.innerHTML = `<div><b>Drop a Deadlock demo</b><span>.dem or .dem.bz2 · parsed right here in your browser, nothing is uploaded</span></div>`;
  document.body.append(zone);
  let depth = 0;
  const hasFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (ev) => { if (!hasFiles(ev)) return; depth++; zone.hidden = false; });
  window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) zone.hidden = true; });
  window.addEventListener("dragover", (ev) => { if (hasFiles(ev)) ev.preventDefault(); });
  window.addEventListener("drop", (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    depth = 0;
    zone.hidden = true;
    openDemoFiles(ev.dataTransfer.files);
  });
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".dem,.bz2";
  input.multiple = true;
  input.hidden = true;
  input.onchange = () => { openDemoFiles(input.files); input.value = ""; };
  document.body.append(input);
  for (const b of document.querySelectorAll("[data-open-demo]")) b.addEventListener("click", () => input.click());
  S.pickDemo = () => input.click();
}
