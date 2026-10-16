// Players directory: everyone who appears in a parsed demo, searchable; leads to player pages.

import { $, esc, S, settings, saveSettings } from "./ui.js";
import { pct } from "./analysis.js";

export function viewPlayers() {
  const app = $("#app");
  const by = new Map();
  for (const m of S.matchList) {
    for (const p of m.players) {
      if (!p.account_id) continue;
      const e = by.get(p.account_id) || { id: p.account_id, name: p.name, games: 0, wins: 0, heroes: new Map(), last: 0 };
      e.games++;
      if (m.winner === p.team) e.wins++;
      e.heroes.set(p.hero_id, (e.heroes.get(p.hero_id) || 0) + 1);
      e.last = Math.max(e.last, m.start_time || 0);
      by.set(p.account_id, e);
    }
  }
  const tracked = new Set(Object.keys(S.indexes).map(Number));
  const all = [...by.values()].sort((a, b) => tracked.has(b.id) - tracked.has(a.id) || b.games - a.games || b.last - a.last);
  app.innerHTML = `
    <section class="toolbar">
      <h2 class="section-title">Players <span class="muted small">${all.length} seen in ${S.matchList.length} parsed demos</span></h2>
      <div class="controls"><label>search<input id="pl-search" type="search" placeholder="name or account id" value="${esc(settings.playersQuery || "")}"></label></div>
    </section>
    <div class="chart-card"><table class="report-table" id="pl-table"></table></div>`;
  const render = () => {
    const q = $("#pl-search").value.trim().toLowerCase();
    const rows = all.filter((e) => !q || String(e.id).includes(q) || (S.profiles[e.id]?.name || e.name || "").toLowerCase().includes(q));
    $("#pl-table").innerHTML = `<tr><th></th><th>player</th><th>demos</th><th>wins</th><th>heroes</th></tr>` +
      rows.slice(0, 300).map((e) => {
        const prof = S.profiles[e.id] || {};
        const heroes = [...e.heroes].sort((a, b) => b[1] - a[1]).slice(0, 6)
          .map(([h, n]) => `<img class="hi" src="${esc(S.assets.hero(h).icon)}" title="${esc(S.assets.hero(h).name)} ×${n}" alt="">`).join("");
        return `<tr data-href="#/player/${e.id}">
          <td>${prof.avatar ? `<img class="av" src="${esc(prof.avatar)}" alt="">` : ""}</td>
          <td><a href="#/player/${e.id}">${esc(prof.name || e.name || e.id)}</a>${tracked.has(e.id) ? ` <span class="chip-s">tracked</span>` : ""}</td>
          <td>${e.games}</td><td>${pct(e.wins / e.games)} <small class="muted">${e.wins}</small></td><td class="heroes-cell">${heroes}</td></tr>`;
      }).join("");
  };
  render();
  $("#pl-search").addEventListener("input", () => { settings.playersQuery = $("#pl-search").value; saveSettings(); render(); });
  $("#pl-table").addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr[data-href]");
    if (tr && !ev.target.closest("a")) location.hash = tr.dataset.href;
  });
}
