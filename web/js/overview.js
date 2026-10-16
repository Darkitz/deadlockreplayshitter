// Overview: per-hero ability stats across matches, career stats, match list.

import { loadMatch } from "./data.js";
import { analyzeAbility, counts, pct, aggregate, median, incoming } from "./analysis.js";
import { sparkline, fmtClock } from "./timeline.js";
import {
  $, esc, S, settings, opts, fmtDate, fmtDay, ago, k1, tile, rankChip, controlsHTML,
  wireControls, abilityButtons, histogram, go,
} from "./ui.js";

export async function viewOverview(heroId, params) {
  const app = $("#app");
  const counts_ = new Map();
  for (const m of S.index.matches) {
    const c = counts_.get(m.hero_id) || { n: 0, parsed: 0, last: 0 };
    c.n++; c.parsed += m.parsed; c.last = Math.max(c.last, m.start_time);
    counts_.set(m.hero_id, c);
  }
  heroId = heroId ?? S.index.default_hero;
  const heroes = [...counts_].sort((a, b) => b[1].parsed - a[1].parsed || b[1].n - a[1].n);
  const hero = S.assets.hero(heroId);
  const sigs = S.assets.signatures(heroId);
  const abilityCls = params.get("ability") && sigs.some((s) => s.class_name === params.get("ability"))
    ? params.get("ability")
    : (heroId === 64 ? "drifter_shadow_mark" : sigs[0]?.class_name);
  const ability = S.assets.itemByClass(abilityCls) || sigs[0];

  app.innerHTML = `
    <nav class="hero-tabs">
      ${heroes.map(([hid, c]) => `
        <a class="hero-tab ${hid === heroId ? "on" : ""} ${c.parsed ? "" : "dim"}" href="#/hero/${hid}" title="${esc(S.assets.hero(hid).name)}: ${c.n} matches, ${c.parsed} with demo">
          <img src="${esc(S.assets.hero(hid).icon)}" alt=""><span>${c.parsed}<small>/${c.n}</small></span>
        </a>`).join("")}
    </nav>
    <section class="toolbar">
      <div class="abilities">${abilityButtons(sigs, abilityCls)}</div>
      <div class="controls">${controlsHTML()}</div>
    </section>
    <section class="summary" id="summary"><div class="muted">loading matches…</div></section>
    <section class="charts" id="charts"></section>
    <section class="report" id="report"></section>
    <section id="career"></section>
    <section id="by-hero"></section>
    <h2 class="section-title" id="cards-title" hidden>${esc(hero.name)} matches with demo</h2>
    <section class="cards" id="cards"></section>
    <details class="unparsed" id="unparsed"></details>`;

  for (const b of app.querySelectorAll(".abilities .ab")) {
    b.addEventListener("click", () => go(`#/hero/${heroId}?ability=${b.dataset.ability}`));
  }
  wireControls(app, () => viewOverview(heroId, params));

  const entries = S.index.matches.filter((m) => m.hero_id === heroId).sort((a, b) => b.start_time - a.start_time);
  const parsed = entries.filter((m) => m.parsed);
  const missing = entries.filter((m) => !m.parsed);

  $("#unparsed").innerHTML = missing.length ? `
    <summary>${missing.length} ${esc(hero.name)} matches without demo</summary>
    <p class="muted small">Demos come from the game's replays folder (in-game <b>Download Replay</b>), data/demos/, or deadlock-api replay salts. Valve deletes old demos.</p>
    <table class="plain">
      ${missing.map((m) => `<tr>
        <td><span class="result ${m.won ? "win" : "loss"}">${m.won ? "W" : "L"}</span></td>
        <td><a href="#/match/${m.match_id}">#${m.match_id}</a></td><td>${fmtDate(new Date(m.start_time * 1000))}</td>
        <td>${m.kills}/${m.deaths}/${m.assists}</td><td class="muted">${esc(m.status)}</td></tr>`).join("")}
    </table>` : "";

  renderCareer(heroId, entries);
  renderByHero(heroId);
  if (!parsed.length) {
    $("#summary").innerHTML = `<div class="empty">No demos for ${esc(hero.name)} yet.</div>`;
    return;
  }

  const loaded = await Promise.all(parsed.map(async (e) => {
    try {
      const m = await loadMatch(e.match_id);
      const me = m.player(S.index.account_id);
      if (!me) return null;
      const a = analyzeAbility(m, me.pawn, ability, opts());
      return { entry: e, match: m, me, casts: a.casts, source: a.source };
    } catch (err) {
      console.error(err);
      return null;
    }
  }));
  const list = loaded.filter(Boolean);
  if (S.view !== "overview") return;

  // summary
  let thrown = 0, scored = 0, other = 0, dmg = 0, hits = 0, kills = 0, idleSum = 0, idleN = 0;
  for (const x of list) {
    const c = counts(x.casts, settings.heroesOnly);
    thrown += c.thrown; scored += c.scored; other += c.other; dmg += c.dmg;
    hits += c.hit; kills += c.kills;
    for (const k of x.casts) if (k.idle != null) { idleSum += k.idle; idleN++; }
  }
  const agg = aggregate(list, settings.heroesOnly);
  const avgDelay = agg.delays.length ? agg.delays.reduce((a, b) => a + b, 0) / agg.delays.length : null;
  $("#summary").innerHTML =
    tile("Matches with demo", `${list.length}<small> / ${entries.length}</small>`) +
    tile("Thrown", thrown, "") +
    tile(settings.heroesOnly ? "Hit heroes" : "Hit (any)", scored, "good") +
    tile("Accuracy", thrown ? pct(scored / thrown) : "–", "accent") +
    tile("Per match", list.length ? `${(thrown / list.length).toFixed(1)}<small> thrown</small>` : "–") +
    tile("Avg hit delay", avgDelay != null ? `${avgDelay.toFixed(2)}<small> s</small>` : "–") +
    tile("Avg hit range", agg.dists.length ? `${Math.round(agg.dists.reduce((a, b) => a + b, 0) / agg.dists.length)}<small> m</small>` : "–") +
    tile("Dodge rate", (() => {
      let a = 0, h = 0;
      for (const x of list) { const r = incoming(x.match, x.me.pawn, S.assets, opts()); a += r.aimed; h += r.hit; }
      return a ? `${pct((a - h) / a)}<small> of ${a}</small>` : "–";
    })()) +
    tile("Aim error on misses", agg.aimMiss.length ? `${median(agg.aimMiss).toFixed(1)}<small>° median</small>` : "–") +
    tile("Damage", k1(dmg)) +
    tile("Hits → kills", hits ? `${pct(kills / hits)}<small> ${kills}/${hits}</small>` : "–") +
    tile("Ready → recast", idleN ? `${(idleSum / idleN).toFixed(1)}<small> s</small>` : "–") +
    `<div class="tile" id="bench"><div class="k" title="same hero, other players, any of your parsed demos">Other ${esc(hero.name)}s</div><div class="v muted">…</div></div>`;
  benchmark(heroId, ability, list.length);

  renderCharts(list, agg);
  renderAbilityReport(list, heroId, abilityCls);

  // match cards
  $("#cards-title").hidden = !list.length;
  $("#cards").innerHTML = list.map((x) => {
    const c = counts(x.casts, settings.heroesOnly);
    const d = new Date(x.entry.start_time * 1000);
    return `<a class="card" href="#/match/${x.entry.match_id}?ability=${encodeURIComponent(abilityCls)}">
      <div class="card-top">
        <span class="result ${x.entry.won ? "win" : "loss"}">${x.entry.won ? "WIN" : "LOSS"}</span>
        <span class="muted" title="${esc(d.toString())}">${fmtDate(d)} · ${ago(d)}</span>
        <span class="muted">${fmtClock(x.entry.duration_s)}</span>
        ${rankChip(x.entry)}
      </div>
      ${sparkline(x.casts, x.match.end, settings.heroesOnly)}
      <div class="card-stats">
        <span>KDA <b>${x.entry.kills}/${x.entry.deaths}/${x.entry.assists}</b></span>
        <span>thrown <b>${c.thrown}</b></span>
        <span>hit <b>${c.scored}</b></span>
        <span class="acc">${c.thrown ? pct(c.acc) : "–"}</span>
      </div>
      ${x.source === "cooldown" ? `<div class="small muted">old demo: casts from cooldowns</div>` : ""}
    </a>`;
  }).join("");
}

function renderCharts(list, agg) {
  const el = $("#charts");
  // accuracy per match (chronological)
  const chron = [...list].sort((a, b) => a.entry.start_time - b.entry.start_time);
  const W = 100 / Math.max(chron.length, 1);
  const bars = chron.map((x, i) => {
    const c = counts(x.casts, settings.heroesOnly);
    const h = c.acc * 100;
    return `<a href="#/match/${x.entry.match_id}" class="bar" style="left:${i * W}%;width:${W}%" title="${fmtDay(new Date(x.entry.start_time * 1000))}: ${c.scored}/${c.thrown} (${pct(c.acc)})">
      <span style="height:${Math.max(h, 1)}%"></span></a>`;
  }).join("");
  const overall = list.reduce((a, x) => { const c = counts(x.casts, settings.heroesOnly); a[0] += c.scored; a[1] += c.thrown; return a; }, [0, 0]);
  const avgLine = overall[1] ? (overall[0] / overall[1]) * 100 : 0;

  const phases = agg.phases.map((p) => `
    <div class="hbar"><span class="lbl">${p.label}</span>
      <span class="track"><span style="width:${p.thrown ? (p.scored / p.thrown) * 100 : 0}%"></span></span>
      <span class="val">${p.thrown ? pct(p.scored / p.thrown) : "–"} <small>${p.scored}/${p.thrown}</small></span></div>`).join("");

  const maxV = Math.max(1, ...agg.victims.map((v) => v[1]));
  const victims = agg.victims.slice(0, 8).map(([hid, n]) => `
    <div class="hbar"><span class="lbl"><img src="${esc(S.assets.hero(hid).icon)}" alt="">${esc(S.assets.hero(hid).name)}</span>
      <span class="track"><span style="width:${(n / maxV) * 100}%"></span></span><span class="val">${n}</span></div>`).join("");

  const bins = new Array(10).fill(0);
  for (const d of agg.delays) bins[Math.min(9, Math.floor(d / 0.2))]++;
  const maxB = Math.max(1, ...bins);
  const hist = bins.map((n, i) => `<span class="hb" title="${(i * 0.2).toFixed(1)}–${i === 9 ? "∞" : ((i + 1) * 0.2).toFixed(1)} s: ${n}"><span style="height:${(n / maxB) * 100}%"></span></span>`).join("");

  el.innerHTML = `
    <div class="chart-card wide"><h3>Accuracy per match</h3>
      <div class="bars">${bars}<div class="avgline" style="bottom:${avgLine}%"><span>${Math.round(avgLine)}% avg</span></div></div>
      <div class="bars-axis muted small"><span>${chron.length ? fmtDay(new Date(chron[0].entry.start_time * 1000)) : ""}</span><span>${chron.length ? fmtDay(new Date(chron.at(-1).entry.start_time * 1000)) : ""}</span></div>
    </div>
    <div class="chart-card"><h3>By game phase</h3>${phases}</div>
    <div class="chart-card"><h3>Most hit heroes</h3>${victims || `<p class="muted">no hero hits</p>`}</div>
    <div class="chart-card"><h3>Hit delay</h3><div class="hist">${hist}</div>
      <div class="bars-axis muted small"><span>0 s</span><span>1 s</span><span>2 s+</span></div></div>
    <div class="chart-card"><h3>Aim error on misses</h3><div class="hist">${histogram(agg.aimMiss, 10, 2, "°")}</div>
      <div class="bars-axis muted small"><span>0°</span><span>10°</span><span>20°+</span></div></div>
    <div class="chart-card"><h3>Hit range</h3><div class="hist">${histogram(agg.dists, 10, 5, "m")}</div>
      <div class="bars-axis muted small"><span>0 m</span><span>25 m</span><span>50 m+</span></div></div>`;
}

/** same hero, same ability, every other player in any parsed demo */
async function benchmark(heroId, ability) {
  const el = $("#bench");
  const ids = S.index.matches.filter((m) => m.parsed).map((m) => m.match_id);
  let thrown = 0, scored = 0;
  const players = new Set();
  for (const id of ids) {
    let m;
    try { m = await loadMatch(id); } catch { continue; }
    for (const p of m.players) {
      if (p.hero_id !== heroId || p.account_id === S.index.account_id) continue;
      const c = counts(analyzeAbility(m, p.pawn, ability, opts()).casts, settings.heroesOnly);
      thrown += c.thrown; scored += c.scored;
      players.add(p.account_id);
    }
  }
  if (!el.isConnected) return;
  el.querySelector(".v").innerHTML = thrown
    ? `${pct(scored / thrown)}<small> ${scored}/${thrown}</small>`
    : `<small>none found</small>`;
  el.querySelector(".v").classList.remove("muted");
  el.title = `${players.size} other player${players.size === 1 ? "" : "s"} on this hero across your parsed demos`;
}

/** end-of-match stats from Valve's metadata: every match of the hero, no demo needed */
function renderCareer(heroId, entries) {
  const el = $("#career");
  const startOf = new Map(entries.map((e) => [e.match_id, e.start_time]));
  const rows = (S.career || []).filter((r) => r.hero_id === heroId && startOf.has(r.match_id))
    .map((r) => ({ ...r, start: startOf.get(r.match_id) }))
    .sort((a, b) => a.start - b.start);
  if (!rows.length) { el.innerHTML = ""; return; }
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const mins = sum("duration_s") / 60;
  const shots = sum("hero_shots"), hits = sum("hero_hits");
  const wins = rows.filter((r) => r.won).length;
  const kda = (sum("kills") + sum("assists")) / Math.max(1, sum("deaths"));

  // per-match series
  const W = 100 / rows.length;
  const accs = rows.map((r) => (r.hero_shots ? r.hero_hits / r.hero_shots : null));
  const dpm = rows.map((r) => r.player_damage / (r.duration_s / 60));
  const maxD = Math.max(1, ...dpm);
  const line = (vals, max) => {
    let d = "";
    vals.forEach((v, i) => {
      if (v == null) return;
      const x = (i + 0.5) * W, y = 100 - (v / max) * 100;
      d += `${d ? "L" : "M"}${x},${y} `;
    });
    return d;
  };
  const maxAcc = Math.max(0.05, ...accs.filter((v) => v != null));
  const buckets = ["10", "20", "30", "40", "50", "75", "100", "Infinite"];
  const ab = buckets.map((b) => rows.reduce((a, r) => a + ((r.ability_dist || {})[b] || 0), 0));
  const abMax = Math.max(1, ...ab);
  const abTotal = ab.reduce((a, b) => a + b, 0) || 1;

  el.innerHTML = `
    <h2 class="section-title">${esc(S.assets.hero(heroId).name)} career · ${rows.length} matches with Valve stats <span class="muted small">(no demo needed)</span></h2>
    <div class="summary">
      ${tile("Win rate", pct(wins / rows.length), "accent")}
      ${tile("KDA ratio", kda.toFixed(2))}
      ${tile("Gun acc. vs heroes", shots ? pct(hits / shots) : "–", "good")}
      ${tile("Headshot rate", hits ? pct(sum("hero_headshots") / hits) : "–")}
      ${tile("Hero dmg / min", Math.round(sum("player_damage") / mins))}
      ${tile("Dmg taken / min", Math.round(sum("player_damage_taken") / mins))}
      ${tile("Ability kills", `${sum("ability_kills")}<small> / ${sum("kills")}</small>`)}
      ${tile("Parry misses", sum("parry_miss"))}
    </div>
    <div class="charts career-charts">
      <div class="chart-card wide"><h3>Gun accuracy vs heroes per match <span class="muted">(line)</span> · hero damage / min <span class="muted">(bars)</span></h3>
        <div class="bars career-bars">
          ${rows.map((r, i) => `<a class="bar ${r.won ? "won" : "lost"}" href="#/match/${r.match_id}" style="left:${i * W}%;width:${W}%"
              title="${fmtDay(new Date(r.start * 1000))} · ${r.won ? "win" : "loss"} · ${Math.round(dpm[i])} dmg/min · gun ${accs[i] != null ? pct(accs[i]) : "–"}">
              <span style="height:${(dpm[i] / maxD) * 100}%"></span></a>`).join("")}
          <svg class="overlay" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${line(accs, maxAcc)}" vector-effect="non-scaling-stroke"/></svg>
        </div>
        <div class="bars-axis muted small"><span>${fmtDay(new Date(rows[0].start * 1000))}</span><span>bars: green win, red loss · line max ${pct(maxAcc)}</span><span>${fmtDay(new Date(rows.at(-1).start * 1000))}</span></div>
      </div>
      <div class="chart-card"><h3>Ability damage by range</h3>
        <div class="hist">${ab.map((v, i) => `<span class="hb" title="≤${buckets[i]} m: ${k1(v)} (${pct(v / abTotal)})"><span style="height:${(v / abMax) * 100}%"></span></span>`).join("")}</div>
        <div class="bars-axis muted small"><span>10 m</span><span>50</span><span>∞</span></div>
      </div>
    </div>`;
}

/** every signature ability of the hero across all loaded matches */
function renderAbilityReport(list, heroId, selected) {
  const rows = S.assets.signatures(heroId).map((ab) => {
    let thrown = 0, scored = 0, other = 0, dmg = 0, matches = 0;
    for (const x of list) {
      const c = counts(analyzeAbility(x.match, x.me.pawn, ab, opts()).casts, settings.heroesOnly);
      thrown += c.thrown; scored += c.scored; other += c.other; dmg += c.dmg;
      if (c.thrown) matches++;
    }
    return { ab, thrown, scored, other, dmg, matches };
  });
  $("#report").innerHTML = `<div class="chart-card"><h3>Ability report · ${list.length} matches</h3>
    <table class="report-table">
      <tr><th></th><th>ability</th><th>thrown</th><th>per match</th><th>${settings.heroesOnly ? "hit heroes" : "hit"}</th><th>non-hero</th><th>accuracy</th><th>damage</th></tr>
      ${rows.map((r) => `<tr class="${r.ab.class_name === selected ? "on" : ""}" data-ability="${esc(r.ab.class_name)}">
        <td>${r.ab.image ? `<img src="${esc(r.ab.image)}" alt="">` : ""}</td><td>${esc(r.ab.name)}</td>
        <td>${r.thrown}</td><td>${list.length ? (r.thrown / list.length).toFixed(1) : "–"}</td>
        <td>${r.scored}</td><td>${r.other}</td>
        <td><span class="acc-bar"><span style="width:${r.thrown ? (r.scored / r.thrown) * 100 : 0}%"></span></span>${r.thrown ? pct(r.scored / r.thrown) : "–"}</td>
        <td>${k1(r.dmg)}</td></tr>`).join("")}
    </table></div>`;
  for (const tr of $("#report").querySelectorAll("tr[data-ability]")) {
    tr.addEventListener("click", () => go(`#/hero/${heroId}?ability=${tr.dataset.ability}`));
  }
}

/** signature-ability accuracy on every hero that has parsed demos */
async function renderByHero(current) {
  const el = $("#by-hero");
  const byHero = new Map();
  for (const e of S.index.matches.filter((x) => x.parsed)) {
    let m;
    try { m = await loadMatch(e.match_id); } catch { continue; }
    const me = m.player(S.index.account_id);
    if (!me) continue;
    const row = byHero.get(me.hero_id) || { matches: 0, thrown: 0, scored: 0, wins: 0 };
    row.matches++;
    row.wins += e.won ? 1 : 0;
    for (const ab of S.assets.signatures(me.hero_id)) {
      const c = counts(analyzeAbility(m, me.pawn, ab, opts()).casts, settings.heroesOnly);
      if (c.scored + c.other === 0) continue; // never connects: buff / passive
      row.thrown += c.thrown; row.scored += c.scored;
    }
    byHero.set(me.hero_id, row);
  }
  if (!el.isConnected || !byHero.size) return;
  const rows = [...byHero].sort((a, b) => b[1].matches - a[1].matches);
  el.innerHTML = `<div class="chart-card"><h3>Signature skill accuracy by hero · all parsed demos</h3>
    <table class="report-table">
      <tr><th></th><th>hero</th><th>matches</th><th>wins</th><th>thrown</th><th>${settings.heroesOnly ? "hit heroes" : "hit"}</th><th>accuracy</th></tr>
      ${rows.map(([hid, r]) => `<tr class="${hid === current ? "on" : ""}" data-hero="${hid}">
        <td><img src="${esc(S.assets.hero(hid).icon)}" alt=""></td><td>${esc(S.assets.hero(hid).name)}</td>
        <td>${r.matches}</td><td>${r.wins}</td><td>${r.thrown}</td><td>${r.scored}</td>
        <td><span class="acc-bar"><span style="width:${r.thrown ? (r.scored / r.thrown) * 100 : 0}%"></span></span>${r.thrown ? pct(r.scored / r.thrown) : "–"}</td></tr>`).join("")}
    </table>
    <p class="small muted">Only signature abilities that hit something at least once in a match are counted (skips buffs and passives).</p></div>`;
  for (const tr of el.querySelectorAll("tr[data-hero]")) {
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => go(`#/hero/${tr.dataset.hero}`));
  }
}
