// Compare two players over their parsed demos, side by side, plus their shared games.

import { $, esc, S, controlsHTML, wireControls, k1 } from "./ui.js";
import { pct } from "./analysis.js";
import { loadPlayerRows, totals } from "./player.js";
import { fmtClock } from "./timeline.js";

const METRICS = [
  ["games", "parsed games", (v) => v],
  ["wins", "wins", (v) => v],
  ["kda", "KDA ratio", (v) => v.toFixed(2)],
  ["skill", "skill accuracy", pct],
  ["gun", "gun hero accuracy", pct],
  ["hs", "hero headshot %", pct],
  ["light", "light melee → hero", pct],
  ["heavy", "heavy melee → hero", pct],
  ["dodge", "dodge rate", pct],
  ["isolated", "isolated deaths", pct, true],
  ["skillDmg", "skill damage", k1],
];

export async function viewCompare(a, b) {
  const app = $("#app");
  const name = (acc) => S.profiles[acc]?.name || `account ${acc}`;
  const av = (acc) => S.profiles[acc]?.avatar ? `<img src="${esc(S.profiles[acc].avatar)}" alt="">` : "";
  app.innerHTML = `
    <section class="toolbar"><h2 class="section-title">Compare</h2><div class="controls">${controlsHTML()}</div></section>
    <div class="chart-card" id="cmp"><p class="muted">loading…</p></div>
    <div class="chart-card" id="shared"></div>`;
  wireControls(app, () => viewCompare(a, b));
  const [ra, rb] = await Promise.all([loadPlayerRows(a), loadPlayerRows(b)]);
  if (S.view !== "compare") return;
  const ta = totals(ra), tb = totals(rb);
  $("#cmp").innerHTML = `<table class="report-table cmp">
    <tr><th></th><th><a class="crumb" href="#/player/${a}">${av(a)}<b>${esc(name(a))}</b></a></th>
      <th><a class="crumb" href="#/player/${b}">${av(b)}<b>${esc(name(b))}</b></a></th></tr>
    ${METRICS.map(([k, label, f, lowerBetter]) => {
      const x = ta[k], y = tb[k];
      const better = x == null || y == null || x === y ? 0 : (x > y) !== !!lowerBetter ? 1 : 2;
      return `<tr><td class="muted">${label}</td><td class="${better === 1 ? "win-cell" : ""}">${x == null ? "–" : f(x)}</td>
        <td class="${better === 2 ? "win-cell" : ""}">${y == null ? "–" : f(y)}</td></tr>`;
    }).join("")}
  </table>`;
  // games both were in
  const ids = new Set(rb.map((r) => r.mm.match_id));
  const shared = ra.filter((r) => ids.has(r.mm.match_id)).sort((x, y) => (y.mm.start_time || 0) - (x.mm.start_time || 0));
  $("#shared").innerHTML = `<h3>Shared games (${shared.length})</h3>` + (shared.length ? `<table class="report-table">
    <tr><th>match</th><th>side</th><th>${esc(name(a))}</th><th>${esc(name(b))}</th><th>length</th></tr>
    ${shared.map((r) => {
      const o = rb.find((x) => x.mm.match_id === r.mm.match_id);
      const cell = (x) => `<img class="hi" src="${esc(S.assets.hero(x.me.hero_id).icon)}" alt=""> ${x.me.kills}/${x.me.deaths}/${x.me.assists} · skill ${x.s.skillAcc != null ? pct(x.s.skillAcc) : "–"} · gun ${x.s.gunAcc != null ? pct(x.s.gunAcc) : "–"}`;
      return `<tr><td><a href="#/match/${r.mm.match_id}">#${r.mm.match_id}</a></td><td>${r.me.team === o.me.team ? "together" : "against"}</td>
        <td class="${r.won ? "w" : "l"}">${cell(r)}</td><td class="${o.won ? "w" : "l"}">${cell(o)}</td><td>${fmtClock(r.mm.duration_s)}</td></tr>`;
    }).join("")}</table>` : `<p class="muted">no shared parsed games</p>`);
}
