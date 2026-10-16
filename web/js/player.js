// Player page: one player's performance across every parsed match they appear in.
// Works for any player seen in a demo; tracked players also get hero pages + Valve career.

import { loadMatch } from "./data.js";
import { pct, playerMatchSummary } from "./analysis.js";
import { fmtClock } from "./timeline.js";
import { $, esc, S, opts, fmtDate, ago, k1, tile, settings, controlsHTML, wireControls, rankBadge } from "./ui.js";

export async function viewPlayer(acc, params) {
  const app = $("#app");
  const prof = S.profiles[acc] || {};
  const idx = S.indexes[acc];
  const matches = S.matchList.filter((m) => m.players.some((p) => p.account_id === acc));
  const name = prof.name || matches[0]?.players.find((p) => p.account_id === acc)?.name || `account ${acc}`;
  const lastRanked = idx?.matches.filter((m) => m.badge).sort((a, b) => b.start_time - a.start_time)[0];
  const rank = lastRanked && S.assets.ranks[lastRanked.badge];

  // hero tabs (tracked players: full history; others: heroes seen in demos)
  const heroCounts = new Map();
  if (idx) {
    for (const m of idx.matches) {
      const c = heroCounts.get(m.hero_id) || { n: 0, parsed: 0 };
      c.n++; c.parsed += m.parsed ? 1 : 0;
      heroCounts.set(m.hero_id, c);
    }
  }

  app.innerHTML = `
    <section class="player-head">
      ${prof.avatar ? `<img class="avatar big" src="${esc(prof.avatar)}" alt="">` : ""}
      <div>
        <h2>${esc(name)}</h2>
        <p class="muted">${idx ? `tracked · ${idx.matches.length} matches in history · ` : "not tracked · "}${matches.length} parsed demos
          · <a target="_blank" rel="noopener" href="${esc(prof.url || `https://steamcommunity.com/profiles/${BigInt(acc) + 76561197960265728n}/`)}">steam profile ↗</a></p>
      </div>
      ${rank ? `<span class="rank">${rankBadge(rank, true)}<span>${esc(rank.name)}</span></span>` : ""}
      <div class="controls">${controlsHTML()}</div>
    </section>
    ${idx ? `<nav class="hero-tabs">
      ${[...heroCounts].sort((a, b) => b[1].parsed - a[1].parsed || b[1].n - a[1].n).map(([hid, c]) => `
        <a class="hero-tab ${c.parsed ? "" : "dim"}" href="#/player/${acc}/hero/${hid}" title="${esc(S.assets.hero(hid).name)}: ${c.n} matches, ${c.parsed} with demo">
          <img src="${esc(S.assets.hero(hid).icon)}" alt=""><span>${c.parsed}<small>/${c.n}</small></span></a>`).join("")}
    </nav>` : `<p class="note">Not a tracked player: stats below come only from demos you have. Track them with
      <code>tools/sync.py --add-account ${acc}</code> to pull their full history.</p>`}
    <section class="summary" id="p-summary"><div class="muted">loading ${matches.length} matches…</div></section>
    <section class="charts charts-3" id="p-charts"></section>
    <section id="p-matches"></section>`;
  wireControls(app, () => viewPlayer(acc, params));

  // load in parallel (4 at a time: each file is a few MB once unzipped)
  const rows = [];
  let next = 0;
  const worker = async () => {
    while (next < matches.length) {
      const mm = matches[next++];
      let m;
      try { m = await loadMatch(mm.match_id); } catch { continue; }
      const me = m.player(acc);
      if (me) rows.push({ mm, me, won: mm.winner === me.team, s: playerMatchSummary(m, me.pawn, S.assets, opts()) });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (S.view !== "player") return;
  render(acc, rows);
}

function render(acc, rows) {
  const sum = (k) => rows.reduce((a, r) => a + (r.s[k] || 0), 0);
  const thrown = sum("thrown"), hit = sum("hit"), shots = sum("shots"), gunHits = sum("gunHits"), hs = sum("headshots");
  const aimed = sum("aimedAt"), got = sum("gotHit");
  const wins = rows.filter((r) => r.won).length;
  const k = rows.reduce((a, r) => a + r.me.kills, 0), d = rows.reduce((a, r) => a + r.me.deaths, 0), as = rows.reduce((a, r) => a + r.me.assists, 0);
  $("#p-summary").innerHTML = rows.length ? [
    tile("Parsed matches", rows.length),
    tile("Win rate", pct(wins / rows.length), "accent"),
    tile("KDA ratio", ((k + as) / Math.max(1, d)).toFixed(2)),
    tile("Skill accuracy", thrown ? `${pct(hit / thrown)}<small> ${hit}/${thrown}</small>` : "–", "good"),
    tile("Gun hero accuracy", shots - sum("npcShots") > 0 ? `${pct(gunHits / (shots - sum("npcShots")))}<small> ${gunHits}/${shots - sum("npcShots")}</small>` : "–", "good"),
    tile("Hero headshot %", gunHits ? pct(hs / gunHits) : "–"),
    tile("Dodge rate", aimed ? `${pct((aimed - got) / aimed)}<small> of ${aimed}</small>` : "–"),
    tile("Skill damage", k1(sum("skillDmg"))),
    tile("Isolated deaths", sum("deaths") ? `${pct(sum("isolatedDeaths") / sum("deaths"))}<small> ${sum("isolatedDeaths")}/${sum("deaths")}</small>` : "–"),
  ].join("") : `<div class="empty">No parsed demos with this player.</div>`;

  // per hero
  const byHero = new Map();
  for (const r of rows) {
    const h = byHero.get(r.me.hero_id) || { n: 0, w: 0, thrown: 0, hit: 0, shots: 0, gunHits: 0, hs: 0 };
    h.n++; h.w += r.won ? 1 : 0; h.thrown += r.s.thrown; h.hit += r.s.hit;
    h.shots += r.s.shots; h.gunHits += r.s.gunHits; h.hs += r.s.headshots;
    byHero.set(r.me.hero_id, h);
  }
  const bar = (v) => v == null ? "–" : `<span class="acc-bar"><span style="width:${v * 100}%"></span></span>${pct(v)}`;
  // accuracy trend (chronological)
  const chron = [...rows].sort((a, b) => (a.mm.start_time || 0) - (b.mm.start_time || 0));
  const W = 100 / Math.max(chron.length, 1);
  $("#p-charts").innerHTML = rows.length ? `
    <div class="chart-card"><h3>By hero</h3>
      <table class="report-table">
        <tr><th></th><th>hero</th><th>games</th><th>wins</th><th>skill %</th><th>gun %</th></tr>
        ${[...byHero].sort((a, b) => b[1].n - a[1].n).map(([hid, h]) => `<tr>
          <td><img src="${esc(S.assets.hero(hid).icon)}" alt=""></td><td>${esc(S.assets.hero(hid).name)}</td>
          <td>${h.n}</td><td>${h.w}</td><td>${bar(h.thrown ? h.hit / h.thrown : null)}</td><td>${bar(h.shots ? h.gunHits / h.shots : null)}</td></tr>`).join("")}
      </table></div>
    <div class="chart-card"><h3>Skill accuracy per match <span class="muted">(bars)</span> · gun hit rate <span class="muted">(line)</span></h3>
      <div class="bars career-bars">
        ${chron.map((r, i) => `<a class="bar ${r.won ? "won" : "lost"}" href="#/match/${r.mm.match_id}?pawn=${r.me.pawn}" style="left:${i * W}%;width:${W}%"
          title="${r.mm.start_time ? fmtDate(new Date(r.mm.start_time * 1000)) : ""} · ${esc(S.assets.hero(r.me.hero_id).name)} · skill ${r.s.skillAcc != null ? pct(r.s.skillAcc) : "–"} · gun ${r.s.gunAcc != null ? pct(r.s.gunAcc) : "–"}">
          <span style="height:${(r.s.skillAcc || 0) * 100}%"></span></a>`).join("")}
        <svg class="overlay" viewBox="0 0 100 100" preserveAspectRatio="none"><path vector-effect="non-scaling-stroke"
          d="${chron.map((r, i) => `${i ? "L" : "M"}${(i + 0.5) * W},${100 - (r.s.gunAcc || 0) * 100}`).join(" ")}"/></svg>
      </div>
      <div class="bars-axis muted small"><span>oldest</span><span>green win · red loss · 0–100%</span><span>newest</span></div>
    </div>
    <div class="chart-card"><h3>Teammates & opponents</h3>${peers(acc, rows)}</div>` : "";

  $("#p-matches").innerHTML = rows.length ? `<div class="chart-card"><h3>Matches</h3>
    <table class="report-table">
      <tr><th></th><th>date</th><th>hero</th><th>result</th><th>k/d/a</th><th>skill %</th><th>gun %</th><th>HS</th><th>dodge</th><th>length</th></tr>
      ${[...rows].sort((a, b) => (b.mm.start_time || 0) - (a.mm.start_time || 0)).map((r) => `<tr data-href="#/match/${r.mm.match_id}?pawn=${r.me.pawn}">
        <td><img src="${esc(S.assets.hero(r.me.hero_id).icon)}" alt=""></td>
        <td>${r.mm.start_time ? `${fmtDate(new Date(r.mm.start_time * 1000))} <small class="muted">${ago(new Date(r.mm.start_time * 1000))}</small>` : "–"}</td>
        <td>${esc(S.assets.hero(r.me.hero_id).name)}</td>
        <td><span class="result ${r.won ? "win" : "loss"}">${r.won ? "WIN" : "LOSS"}</span></td>
        <td>${r.me.kills}/${r.me.deaths}/${r.me.assists}</td>
        <td>${bar(r.s.skillAcc)}</td><td>${bar(r.s.gunAcc)}</td><td>${r.s.headshots}</td>
        <td>${r.s.aimedAt ? pct((r.s.aimedAt - r.s.gotHit) / r.s.aimedAt) : "–"}</td>
        <td>${fmtClock(r.mm.duration_s)}</td></tr>`).join("")}
    </table></div>` : "";
  for (const tr of $("#p-matches").querySelectorAll("tr[data-href]")) {
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => { location.hash = tr.dataset.href; });
  }
}

/** players most often seen with / against this player in the parsed demos */
function peers(acc, rows) {
  const seen = new Map();
  for (const r of rows) {
    for (const p of r.mm.players) {
      if (p.account_id === acc || !p.account_id) continue;
      const e = seen.get(p.account_id) || { n: 0, with: 0, wins: 0, name: p.name };
      e.n++;
      if (p.team === r.me.team) { e.with++; if (r.won) e.wins++; }
      seen.set(p.account_id, e);
    }
  }
  const list = [...seen].filter(([, e]) => e.n > 1).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
  if (!list.length) return `<p class="muted">No repeat teammates or opponents in these demos.</p>`;
  return `<table class="report-table"><tr><th>player</th><th>games</th><th>together</th><th>wins together</th></tr>
    ${list.map(([id, e]) => `<tr><td><a href="#/player/${id}">${esc(S.profiles[id]?.name || e.name)}</a></td>
      <td>${e.n}</td><td>${e.with}</td><td>${e.with ? `${e.wins}/${e.with}` : "–"}</td></tr>`).join("")}</table>`;
}
