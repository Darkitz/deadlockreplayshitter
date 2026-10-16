// Home: a drop field for a demo, and the demos already opened in this browser.

import { $, esc, S, ago } from "./ui.js";
import { fmtClock } from "./timeline.js";
import { TEAM_NAMES, forgetMatch } from "./data.js";
import { localDelete } from "./local.js";

export function viewHome() {
  const app = $("#app");
  const list = [...(S.localMatches || [])].sort((a, b) => b.parsed_at - a.parsed_at);
  app.innerHTML = `
    <section class="drop-field" role="button" tabindex="0" data-pick>
      <b>Drop a Deadlock demo here</b>
      <span>or click to pick a file · <code>.dem</code> from <code>Deadlock/game/citadel/replays</code>
        (in-game: match history → <i>Download Replay</i>) or <code>.dem.bz2</code></span>
      <small class="muted">Parsed right here in your browser. Nothing is uploaded.</small>
    </section>
    ${list.length ? `
      <h2 class="section-title">Opened in this browser</h2>
      <section class="match-grid">${list.map(card).join("")}</section>` : ""}`;
  const pick = $("[data-pick]", app);
  pick.addEventListener("click", () => S.pickDemo?.());
  pick.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); S.pickDemo?.(); } });
  $(".match-grid", app)?.addEventListener("click", async (ev) => {
    const del = ev.target.closest("[data-forget]");
    if (!del) return;
    ev.preventDefault();
    const id = Number(del.dataset.forget);
    await localDelete(id);
    forgetMatch(id);
    viewHome();
  });
}

function card(m) {
  return `<a class="match-card" href="#/match/${m.match_id}">
    <div class="mc-top">
      <b>#${m.match_id}</b>
      <span class="muted">${fmtClock(m.duration_s || 0)}</span>
      <span class="muted small" title="${esc(m.file)}">opened ${ago(new Date(m.parsed_at))}</span>
      <button class="chip-s forget" data-forget="${m.match_id}" title="remove from this browser">×</button>
    </div>
    ${[2, 3].map((t) => {
      const ps = m.players.filter((p) => p.team === t);
      return `<div class="mc-team team-${t} ${m.winner === t ? "won" : ""}">
        <span class="mc-team-name">${TEAM_NAMES[t]}${m.winner === t ? " ✓" : ""}</span>
        <span class="mc-heroes">${ps.map((p) => `<img src="${esc(S.assets.hero(p.hero_id).icon)}"
          title="${esc(p.name)} · ${esc(S.assets.hero(p.hero_id).name)} · ${p.k}/${p.d}/${p.a}">`).join("")}</span>
        <span class="muted small">${ps.reduce((a, p) => a + (p.k || 0), 0)} kills</span>
      </div>`;
    }).join("")}
  </a>`;
}
