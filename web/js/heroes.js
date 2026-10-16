// Heroes: every hero seen in parsed demos, and per hero: ability accuracy across all players
// plus a leaderboard of who lands that hero's skills best.

import { loadMatch } from "./data.js";
import { analyzeAbility, counts, gunStats, pct } from "./analysis.js";
import { $, esc, S, opts, settings, tile, k1, controlsHTML, wireControls } from "./ui.js";

export function viewHeroes() {
  const app = $("#app");
  const by = new Map();
  for (const m of S.matchList) {
    for (const p of m.players) {
      const e = by.get(p.hero_id) || { n: 0, w: 0 };
      e.n++;
      if (m.winner === p.team) e.w++;
      by.set(p.hero_id, e);
    }
  }
  const rows = [...by].sort((a, b) => b[1].n - a[1].n);
  app.innerHTML = `
    <h2 class="section-title">Heroes <span class="muted small">appearances in ${S.matchList.length} parsed demos</span></h2>
    <section class="hero-grid">${rows.map(([hid, e]) => `
      <a class="hero-card" href="#/heroes/${hid}">
        <img src="${esc(S.assets.hero(hid).card || S.assets.hero(hid).icon)}" alt="">
        <b>${esc(S.assets.hero(hid).name)}</b>
        <small class="muted">${e.n} games · ${pct(e.w / e.n)} wins</small>
      </a>`).join("")}</section>`;
}

export async function viewHero(heroId, params) {
  const app = $("#app");
  const hero = S.assets.hero(heroId);
  const apps = [];
  for (const m of S.matchList) for (const p of m.players) if (p.hero_id === heroId) apps.push({ mm: m, p });
  app.innerHTML = `
    <section class="player-head">
      ${hero.card || hero.icon ? `<img class="avatar big" src="${esc(hero.card || hero.icon)}" alt="">` : ""}
      <div><h2>${esc(hero.name)}</h2><p class="muted">${apps.length} appearances in parsed demos</p></div>
      <div class="controls">${controlsHTML()}</div>
    </section>
    <section class="summary" id="h-summary"><div class="muted">loading…</div></section>
    <section class="charts charts-2" id="h-charts"></section>`;
  wireControls(app, () => viewHero(heroId, params));

  const sigs = S.assets.signatures(heroId);
  const perAbility = new Map(sigs.map((ab) => [ab.class_name, { ab, thrown: 0, hit: 0, dmg: 0 }]));
  const perPlayer = new Map();
  let wins = 0, shots = 0, gunHits = 0, hs = 0;
  // load matches 4 at a time, then aggregate in order
  const loaded = new Array(apps.length);
  let next = 0;
  await Promise.all([0, 1, 2, 3].map(async () => {
    while (next < apps.length) {
      const i = next++;
      try { loaded[i] = await loadMatch(apps[i].mm.match_id); } catch { loaded[i] = null; }
    }
  }));
  if (S.view !== "hero") return;
  for (let i = 0; i < apps.length; i++) {
    const { mm, p } = apps[i];
    const m = loaded[i];
    if (!m) continue;
    const me = m.player(p.account_id) || m.players.find((x) => x.hero_id === heroId && x.team === p.team);
    if (!me) continue;
    if (mm.winner === me.team) wins++;
    const pl = perPlayer.get(p.account_id) || { id: p.account_id, name: p.name, games: 0, thrown: 0, hit: 0 };
    pl.games++;
    for (const ab of sigs) {
      const c = counts(analyzeAbility(m, me.pawn, ab, opts()).casts, settings.heroesOnly);
      const a = perAbility.get(ab.class_name);
      a.thrown += c.thrown; a.hit += c.scored; a.dmg += c.dmg;
      if (c.scored + c.other > 0) { pl.thrown += c.thrown; pl.hit += c.scored; }
    }
    perPlayer.set(p.account_id, pl);
    const g = gunStats(m, me.pawn, S.assets);
    shots += g.shots; gunHits += g.heroHits; hs += g.headshots;
  }
  const players = [...perPlayer.values()];
  const thrown = players.reduce((a, p) => a + p.thrown, 0), hit = players.reduce((a, p) => a + p.hit, 0);
  $("#h-summary").innerHTML = [
    tile("Appearances", apps.length), tile("Win rate", apps.length ? pct(wins / apps.length) : "–", "accent"),
    tile("Skill accuracy", thrown ? `${pct(hit / thrown)}<small> ${hit}/${thrown}</small>` : "–", "good"),
    tile("Gun hit rate", shots ? pct(gunHits / shots) : "–"), tile("Headshot %", gunHits ? pct(hs / gunHits) : "–"),
    tile("Players", players.length),
  ].join("");
  const bar = (v) => v == null ? "–" : `<span class="acc-bar"><span style="width:${v * 100}%"></span></span>${pct(v)}`;
  $("#h-charts").innerHTML = `
    <div class="chart-card"><h3>Abilities · all players</h3><table class="report-table">
      <tr><th></th><th>ability</th><th>thrown</th><th>hit</th><th>accuracy</th><th>damage</th></tr>
      ${[...perAbility.values()].map((a) => `<tr><td>${a.ab.image ? `<img src="${esc(a.ab.image)}" alt="">` : ""}</td><td>${esc(a.ab.name)}</td>
        <td>${a.thrown}</td><td>${a.hit}</td><td>${bar(a.thrown ? a.hit / a.thrown : null)}</td><td>${k1(a.dmg)}</td></tr>`).join("")}
    </table></div>
    <div class="chart-card"><h3>Who lands ${esc(hero.name)}'s skills best <span class="muted">(min 15 casts)</span></h3><table class="report-table">
      <tr><th>player</th><th>games</th><th>skill accuracy</th></tr>
      ${players.filter((p) => p.thrown >= 15).sort((a, b) => b.hit / b.thrown - a.hit / a.thrown).map((p) => `<tr>
        <td><a href="#/player/${p.id}">${esc(S.profiles[p.id]?.name || p.name)}</a></td><td>${p.games}</td><td>${bar(p.hit / p.thrown)} <small class="muted">${p.hit}/${p.thrown}</small></td></tr>`).join("") || `<tr><td colspan="3" class="muted">not enough casts</td></tr>`}
    </table></div>`;
}
