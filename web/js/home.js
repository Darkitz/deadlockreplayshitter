// Home: every parsed match (the main entity) plus the tracked players that lead to them.

import { $, esc, S, fmtDate, ago, settings, saveSettings } from "./ui.js";
import { fmtClock } from "./timeline.js";
import { TEAM_NAMES } from "./data.js";

export async function viewHome(params) {
  const app = $("#app");
  const q = params.get("q") ?? settings.homeQuery ?? "";
  const tracked = new Set(Object.keys(S.indexes).map(Number));

  app.innerHTML = `
    <section class="players-strip">
      ${S.accounts.map((a) => {
        const p = S.profiles[a.account_id] || {};
        return `<a class="player-chip" href="#/player/${a.account_id}">
          ${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : `<span class="ph"></span>`}
          <span><b>${esc(p.name || a.name)}</b><small class="muted">${a.parsed} demos · ${a.matches} matches</small></span>
        </a>`;
      }).join("")}
    </section>
    <section class="toolbar">
      <h2 class="section-title">Matches <span class="muted small" id="match-count"></span></h2>
      <div class="controls">
        <label>search
          <input id="match-search" type="search" placeholder="player, hero or match id" value="${esc(q)}">
        </label>
        <label class="check"><input type="checkbox" id="demos-only" ${settings.demosOnly ? "checked" : ""}> with demo only</label>
      </div>
    </section>
    <section class="match-grid" id="match-grid"></section>`;

  // parsed demos plus every history game of tracked players (newest first)
  const parsedIds = new Set(S.matchList.map((m) => m.match_id));
  const fromHistory = new Map();
  for (const idx of Object.values(S.indexes)) {
    for (const e of idx.matches) {
      if (parsedIds.has(e.match_id)) continue;
      const rec = fromHistory.get(e.match_id) || { match_id: e.match_id, start_time: e.start_time, duration_s: e.duration_s, mode: e.mode, nodemo: true, tracked: [] };
      rec.tracked.push({ account_id: idx.account_id, ...e });
      fromHistory.set(e.match_id, rec);
    }
  }
  const all = [...S.matchList, ...fromHistory.values()].sort((a, b) => (b.start_time || 0) - (a.start_time || 0));
  let limit = 60;

  const render = () => {
    const needle = $("#match-search").value.trim().toLowerCase();
    const demosOnly = $("#demos-only").checked;
    const list = all.filter((m) => (!demosOnly || !m.nodemo) && (!needle || String(m.match_id).includes(needle)
      || (m.players || m.tracked).some((p) => (S.profiles[p.account_id]?.name || p.name || "").toLowerCase().includes(needle)
        || S.assets.hero(p.hero_id).name.toLowerCase().includes(needle))));
    $("#match-count").textContent = `${list.length} matches · ${S.matchList.length} with parsed demos`;
    $("#match-grid").innerHTML = list.slice(0, limit).map((m) => (m.nodemo ? noDemoCard(m) : matchCard(m, tracked))).join("") +
      (list.length > limit ? `<button class="btn more" id="more">show more (${list.length - limit})</button>` : "") ||
      `<div class="empty">No matches. Run <code>tools/sync.py</code> or download replays in Deadlock.</div>`;
  };
  render();
  $("#match-grid").addEventListener("click", (ev) => {
    if (ev.target.id === "more") { limit += 60; render(); }
  });
  $("#demos-only").addEventListener("change", () => {
    settings.demosOnly = $("#demos-only").checked;
    saveSettings();
    render();
  });
  $("#match-search").addEventListener("input", () => {
    settings.homeQuery = $("#match-search").value;
    saveSettings();
    render();
  });
}

function matchCard(m, tracked) {
  const d = m.start_time ? new Date(m.start_time * 1000) : null;
  const teams = [2, 3];
  const trackedHere = m.players.filter((p) => tracked.has(p.account_id));
  return `<a class="match-card" href="#/match/${m.match_id}">
    <div class="mc-top">
      <b>#${m.match_id}</b>
      <span class="muted">${d ? `${fmtDate(d)} · ${ago(d)}` : "date unknown"}</span>
      <span class="muted">${fmtClock(m.duration_s)}</span>
      ${m.mode === 4 ? `<span class="chip-s">ranked</span>` : ""}
    </div>
    ${teams.map((t) => {
      const ps = m.players.filter((p) => p.team === t);
      const kills = ps.reduce((a, p) => a + (p.k || 0), 0);
      return `<div class="mc-team team-${t} ${m.winner === t ? "won" : ""}">
        <span class="mc-team-name">${TEAM_NAMES[t]}${m.winner === t ? " ✓" : ""}</span>
        <span class="mc-heroes">${ps.map((p) => `<img class="${tracked.has(p.account_id) ? "tracked" : ""}"
          src="${esc(S.assets.hero(p.hero_id).icon)}" title="${esc(S.profiles[p.account_id]?.name || p.name)} · ${esc(S.assets.hero(p.hero_id).name)} · ${p.k}/${p.d}/${p.a}">`).join("")}</span>
        <span class="muted small">${kills} kills</span>
      </div>`;
    }).join("")}
    ${trackedHere.length ? `<div class="mc-tracked small">${trackedHere.map((p) => {
      const won = m.winner === p.team;
      return `<span class="${won ? "w" : "l"}">${esc(S.profiles[p.account_id]?.name || p.name)} · ${esc(S.assets.hero(p.hero_id).name)} · ${p.k}/${p.d}/${p.a}</span>`;
    }).join("")}</div>` : ""}
  </a>`;
}

/** a tracked player's game we have no demo for */
function noDemoCard(m) {
  const d = m.start_time ? new Date(m.start_time * 1000) : null;
  return `<a class="match-card nodemo" href="#/match/${m.match_id}">
    <div class="mc-top">
      <b>#${m.match_id}</b>
      <span class="muted">${d ? `${fmtDate(d)} · ${ago(d)}` : ""}</span>
      <span class="muted">${fmtClock(m.duration_s || 0)}</span>
      ${m.mode === 4 ? `<span class="chip-s">ranked</span>` : ""}
      <span class="chip-s muted-chip">no demo</span>
    </div>
    <div class="mc-tracked">${m.tracked.map((e) => `<span class="${e.won ? "w" : "l"}">
      <img class="hi" src="${esc(S.assets.hero(e.hero_id).icon)}" alt="">
      ${esc(S.profiles[e.account_id]?.name || "")} · ${esc(S.assets.hero(e.hero_id).name)} · ${e.kills}/${e.deaths}/${e.assists} · ${e.won ? "win" : "loss"}</span>`).join("")}</div>
  </a>`;
}
