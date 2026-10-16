// Skill Hitter: router + views.
//   #/                       overview for the default hero
//   #/hero/<id>              overview for a hero
//   #/match/<id>?pawn=&ability=   match detail (minimap + timeline)

import { loadJSON, loadMatch, Assets, statsAt, TEAM_NAMES } from "./data.js";
import { analyzeAbility, counts, pct, abilityTable, aggregate, median, incoming, AIMED_AT_DEG } from "./analysis.js";
import { createTimeline, sparkline, fmtClock } from "./timeline.js";
import { createMinimap } from "./minimap.js";

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ------------------------------------------------------------------ settings

const settings = {
  window: 3,
  heroesOnly: true,
  speed: 30,
  showAll: false,
  ...readStore("skillhitter.settings"),
};
function readStore(k) {
  try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem("skillhitter.settings", JSON.stringify(settings)); } catch { /* private mode */ }
}
const opts = () => ({ window: settings.window, heroesOnly: settings.heroesOnly });

// ------------------------------------------------------------------ time formatting (system tz)

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const fmtDate = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
const fmtDay = (d) => fmtDate(d).slice(0, 10);
const ago = (d) => {
  const s = (Date.now() - d.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 86400 * 60) return rtf.format(-Math.round(s / 86400), "day");
  return rtf.format(-Math.round(s / (86400 * 30)), "month");
};
const k1 = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ------------------------------------------------------------------ state

const S = { index: null, assets: null, profiles: {}, view: null };

async function loadAll() {
  const [index, assets, profiles, career] = await Promise.all([
    loadJSON("data/index.json"),
    loadJSON("data/assets.json"),
    loadJSON("data/profiles.json").catch(() => ({})),
    loadJSON("data/career.json").catch(() => []),
  ]);
  S.career = career;
  S.index = index;
  S.assets = new Assets(assets);
  S.profiles = profiles;
  renderHeader();
}

function renderHeader() {
  const prof = S.index.profile || {};
  const acc = S.index.account_id;
  $("#avatar").src = prof.avatar || "";
  $("#avatar").hidden = !prof.avatar;
  $("#player-name").textContent = prof.name || `account ${acc}`;
  $("#steam-link").href = prof.url || `https://steamcommunity.com/profiles/${BigInt(acc) + 76561197960265728n}/`;
  $("#steam-link").textContent = "steam profile ↗";
  const parsed = S.index.matches.filter((m) => m.parsed).length;
  $("#subtitle").textContent =
    `${S.index.matches.length} matches · ${parsed} with demo · synced ${fmtDate(new Date(S.index.generated * 1000))} (${TZ})`;
}

const entry = (id) => S.index.matches.find((m) => m.match_id === id);

// ------------------------------------------------------------------ shared widgets

function tile(k, v, cls = "") {
  return `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

function controlsHTML() {
  return `
    <label>Hit window
      <select data-set="window">
        ${[1, 2, 3, 5, 8].map((w) => `<option value="${w}" ${w === settings.window ? "selected" : ""}>${w} s</option>`).join("")}
      </select>
    </label>
    <label class="check"><input type="checkbox" data-set="heroesOnly" ${settings.heroesOnly ? "checked" : ""}> heroes only</label>`;
}

function wireControls(root, onChange) {
  for (const el of root.querySelectorAll("[data-set]")) {
    el.addEventListener("change", () => {
      const k = el.dataset.set;
      settings[k] = el.type === "checkbox" ? el.checked : Number(el.value);
      saveSettings();
      onChange();
    });
  }
}

function abilityButtons(list, selected, extra = () => "") {
  return list.map((ab) => `
    <button class="ab ${ab.class_name === selected ? "on" : ""}" data-ability="${esc(ab.class_name)}" title="${esc(ab.name)}">
      ${ab.image ? `<img src="${esc(ab.image)}" alt="">` : `<span class="ab-ph">${esc((ab.name || "?")[0])}</span>`}
      <span class="ab-name">${esc(ab.name)}</span>${extra(ab)}
    </button>`).join("");
}

// ------------------------------------------------------------------ overview

async function viewOverview(heroId, params) {
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
    <h2 class="section-title">${esc(hero.name)} matches with demo</h2>
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
    tile("Avg ready-idle", idleN ? `${(idleSum / idleN).toFixed(1)}<small> s before recast</small>` : "–") +
    `<div class="tile" id="bench"><div class="k" title="same hero, other players, any of your parsed demos">Other ${esc(hero.name)}s</div><div class="v muted">…</div></div>`;
  benchmark(heroId, ability, list.length);

  renderCharts(list, agg);
  renderAbilityReport(list, heroId, abilityCls);

  // match cards
  $("#cards").innerHTML = list.map((x) => {
    const c = counts(x.casts, settings.heroesOnly);
    const d = new Date(x.entry.start_time * 1000);
    return `<a class="card" href="#/match/${x.entry.match_id}?ability=${encodeURIComponent(abilityCls)}">
      <div class="card-top">
        <span class="result ${x.entry.won ? "win" : "loss"}">${x.entry.won ? "WIN" : "LOSS"}</span>
        <span class="muted" title="${esc(d.toString())}">${fmtDate(d)} · ${ago(d)}</span>
        <span class="muted">${fmtClock(x.entry.duration_s)}</span>
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
    ? `${pct(scored / thrown)}<small> ${scored}/${thrown} · ${players.size} player${players.size === 1 ? "" : "s"}</small>`
    : `<small>none found</small>`;
  el.querySelector(".v").classList.remove("muted");
}

function histogram(values, bins, width, unit) {
  const b = new Array(bins).fill(0);
  for (const v of values) b[Math.min(bins - 1, Math.floor(v / width))]++;
  const max = Math.max(1, ...b);
  return b.map((n, i) => `<span class="hb" title="${i * width}–${i === bins - 1 ? "∞" : (i + 1) * width} ${unit}: ${n}"><span style="height:${(n / max) * 100}%"></span></span>`).join("");
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

// ------------------------------------------------------------------ match detail

async function viewMatch(id, params) {
  const app = $("#app");
  app.innerHTML = `<div class="muted pad">loading match ${id}…</div>`;
  const e = entry(id);
  let m;
  try {
    m = await loadMatch(id);
  } catch (err) {
    renderNoDemo(app, id, e);
    return;
  }
  const me = m.player(S.index.account_id);
  const pawn = Number(params.get("pawn")) || me?.pawn || m.players[0].pawn;
  const subject = m.byPawn.get(pawn);
  const sigs = S.assets.signatures(subject.hero_id);
  const table = abilityTable(m, pawn, S.assets, opts());
  const wanted = params.get("ability");
  const row = table.find((r) => r.ability.class_name === wanted)
    || table.find((r) => r.ability.class_name === "drifter_shadow_mark")
    || table.find((r) => r.thrown) || table[0];
  const ability = row?.ability || sigs[0];
  const analysis = analyzeAbility(m, pawn, ability, opts());
  const casts = analysis.casts;
  const won = e ? e.won : null;
  const d = e ? new Date(e.start_time * 1000) : null;

  function abStat(ab) {
    const r = table.find((x) => x.ability.class_name === ab.class_name);
    return r && r.thrown ? `<span class="ab-stat">${r.scored}/${r.thrown}</span>` : `<span class="ab-stat muted">–</span>`;
  }
  // signature-ability accuracy of every player (who hits their skills best this match)
  const skillAcc = new Map(m.players.map((p) => {
    let thrown = 0, scored = 0;
    for (const ab of S.assets.signatures(p.hero_id)) {
      const c = counts(analyzeAbility(m, p.pawn, ab, opts()).casts, settings.heroesOnly);
      // abilities that never connect with anything (buffs, movement) would only add noise
      if (c.scored + c.other === 0) continue;
      thrown += c.thrown; scored += c.scored;
    }
    return [p.pawn, { thrown, scored }];
  }));
  const bestAcc = Math.max(...[...skillAcc.values()].map((v) => (v.thrown >= 5 ? v.scored / v.thrown : 0)));
  const teamOf = (t) => m.players.filter((p) => p.team === t).sort((a, b) => b.net_worth - a.net_worth);
  const teams = [...new Set(m.players.map((p) => p.team))].sort();

  app.innerHTML = `
    <div class="match-header">
      <a href="#/hero/${e?.hero_id ?? subject.hero_id}" class="back">← overview</a>
      <div class="mh-title">
        ${won != null ? `<span class="result ${won ? "win" : "loss"}">${won ? "WIN" : "LOSS"}</span>` : ""}
        <h2>#${id}</h2>
        ${d ? `<span class="muted" title="${esc(d.toString())}">${fmtDate(d)} · ${ago(d)}</span>` : ""}
        <span class="muted">${fmtClock(m.end)}</span>
        <a class="muted small" target="_blank" rel="noopener" href="https://statlocker.gg/match/${id}">statlocker ↗</a>
      </div>
    </div>
    <section class="scoreboard">
      ${teams.map((t) => `
        <div class="team team-${t}">
          <h3>${TEAM_NAMES[t] || `Team ${t}`}${me && me.team === t ? " · " + esc(S.profiles[me.account_id]?.name || me.name) + "'s team" : ""}</h3>
          <div class="team-head"><span></span><span></span><span>player</span><span style="text-align:right">k/d/a</span><span style="text-align:right">skill%</span><span style="text-align:right">souls</span></div>
          ${teamOf(t).map((p) => {
            const prof = S.profiles[p.account_id];
            return `<button class="sb-row ${p.pawn === pawn ? "on" : ""}" data-pawn="${p.pawn}" title="analyze ${esc(p.name)}">
              <img class="sb-hero" src="${esc(S.assets.hero(p.hero_id).icon)}" alt="">
              ${prof?.avatar ? `<img class="sb-av" src="${esc(prof.avatar)}" alt="">` : `<span class="sb-av"></span>`}
              <span class="sb-name">${esc(prof?.name || p.name)}</span>
              <span class="sb-kda">${p.kills}/${p.deaths}/${p.assists}</span>
              ${(() => { const a = skillAcc.get(p.pawn); const v = a.thrown ? a.scored / a.thrown : 0;
                return `<span class="sb-acc ${a.thrown >= 5 && v === bestAcc ? "best" : ""}" title="signature abilities: ${a.scored}/${a.thrown} hit heroes">${a.thrown ? pct(v) : "–"}</span>`; })()}
              <span class="sb-nw">${k1(p.net_worth)}</span>
            </button>`;
          }).join("")}
        </div>`).join("")}
    </section>
    <section class="toolbar">
      <div class="abilities">${abilityButtons(table.filter((r) => !r.kind).map((r) => r.ability), ability.class_name, abStat)}</div>
      <div class="controls">${controlsHTML()}</div>
    </section>
    ${table.some((r) => r.kind === "extra") ? `<section class="items-row"><span class="muted small">other abilities</span>
      <div class="abilities small-abs">${abilityButtons(table.filter((r) => r.kind === "extra").map((r) => r.ability), ability.class_name, abStat)}</div></section>` : ""}
    ${table.some((r) => r.item) ? `<section class="items-row"><span class="muted small">active items</span>
      <div class="abilities small-abs">${abilityButtons(table.filter((r) => r.item).map((r) => r.ability), ability.class_name, abStat)}</div></section>` : ""}
    ${analysis.source === "cooldown" ? `<p class="note">No cast events for ${esc(ability.name)} in this demo; casts are taken from the ability going on cooldown, so there is no aim direction or aim error.</p>` : ""}
    ${analysis.source === "none" ? `<p class="note">No casts of ${esc(ability.name)} found for this player.</p>` : ""}
    <section class="stage">
      <div class="map-wrap"><canvas class="minimap"></canvas>
        <div class="map-legend small muted">
          <label class="check"><input type="checkbox" class="show-all" ${settings.showAll ? "checked" : ""}> all casts</label>
          <span>click a hero to analyze them · rays = aim at cast</span>
        </div></div>
      <div class="stage-right">
        <svg class="timeline"></svg>
        <div class="player-row">
          <button class="play" title="play / pause (space)">▶</button>
          <select class="speed" title="playback speed">
            ${[1, 4, 10, 30, 60, 120].map((s) => `<option value="${s}" ${s === settings.speed ? "selected" : ""}>${s}×</option>`).join("")}
          </select>
          <input type="range" class="scrub" min="0" max="${Math.ceil(m.end)}" step="0.5">
          <span class="clock">0:00</span>
          <button class="btn csv" title="download casts as CSV">CSV</button>
        </div>
        <div class="readout">
          <div class="tiles"></div>
          <ol class="feed"></ol>
        </div>
        <p class="keys small muted">space play · ←/→ 5 s · shift ±30 s · , . previous/next cast · home/end · wheel on timeline zooms</p>
      </div>
    </section>
    <section class="chart-card incoming" id="incoming"></section>`;

  // wiring
  for (const b of app.querySelectorAll(".sb-row")) {
    b.addEventListener("click", () => setParams({ pawn: b.dataset.pawn, ability: null }));
  }
  for (const b of app.querySelectorAll(".abilities .ab")) {
    b.addEventListener("click", () => setParams({ ability: b.dataset.ability }));
  }
  wireControls(app, () => viewMatch(id, params));

  // incoming skillshots (defense)
  const inc = incoming(m, pawn, S.assets, opts());
  $("#incoming", app).innerHTML = `
    <h3>Incoming skillshots aimed at ${esc(S.profiles[subject.account_id]?.name || subject.name)}
      <span class="muted">· enemy casts whose aim was within ${AIMED_AT_DEG}° of them</span></h3>
    <div class="summary">
      ${tile("Aimed at", inc.aimed)}${tile("Got hit", inc.hit, "")}${tile("Dodged", inc.dodged, "good")}
      ${tile("Dodge rate", inc.aimed ? pct(inc.dodged / inc.aimed) : "–", "accent")}
    </div>
    <table class="report-table">
      <tr><th></th><th>enemy</th><th>ability</th><th>aimed</th><th>hit</th><th>dodged</th></tr>
      ${inc.rows.map((r) => `<tr>
        <td><img src="${esc(S.assets.hero(r.player.hero_id).icon)}" alt=""></td>
        <td>${esc(S.profiles[r.player.account_id]?.name || r.player.name)}</td>
        <td><span class="inline-ab">${r.ability.image ? `<img src="${esc(r.ability.image)}" alt="">` : ""}${esc(r.ability.name)}</span></td>
        <td>${r.aimed}</td><td>${r.hit}</td>
        <td><span class="acc-bar"><span style="width:${(1 - r.hit / r.aimed) * 100}%"></span></span>${pct(1 - r.hit / r.aimed)}</td></tr>`).join("")}
    </table>
    <p class="small muted">AoE and lock-on abilities count too, so treat this as a rough dodge signal, not exact.</p>`;

  // timeline model
  const hpTrack = m.tracks.get(pawn);
  const hp = [];
  if (hpTrack) {
    for (let i = 0; i < hpTrack.hp.length; i += 4) {
      const mx = hpTrack.max_hp[i];
      hp.push([m.samples.t0 + i * m.samples.dt, mx ? hpTrack.hp[i] / mx : 0]);
    }
  }
  const lead = [];
  const nRows = Math.max(0, ...m.stats.tracks.map((t) => t.rows.length));
  for (let i = 0; i < nRows; i++) {
    let v = 0;
    for (const tr of m.stats.tracks) {
      const p = m.byPawn.get(tr.pawn);
      const nw = tr.rows[i]?.[0] || 0;
      v += p.team === subject.team ? nw : -nw;
    }
    lead.push([m.stats.t0 + i * m.stats.dt, v]);
  }
  const deaths = m.kills.filter((k) => k[1] === pawn).map((k) => k[0]);
  const kills = m.kills.filter((k) => k[2] === pawn || (k[4] || []).includes(pawn)).map((k) => k[0]);
  const items = m.items
    .filter((it) => it[1] === pawn && it[3] === 1 && it[0] > 0)
    .map((it) => {
      const a = S.assets.item(it[2]);
      return a && a.type === "upgrade" ? { t: it[0], img: a.image, name: a.name } : null;
    }).filter(Boolean);

  const timeline = createTimeline($(".timeline", app), {
    end: m.end, casts, heroesOnly: settings.heroesOnly, hp, lead, deaths, kills, items,
  }, (t) => seek(t));
  const minimap = createMinimap($(".minimap", app), {
    match: m, assets: S.assets, onPick: (p) => setParams({ pawn: p.pawn, ability: null }),
  });

  let t = Number(params.get("t")) || m.end;
  let playing = null;
  const scrub = $(".scrub", app);
  scrub.addEventListener("input", () => seek(Number(scrub.value)));
  $(".speed", app).addEventListener("change", (ev) => { settings.speed = Number(ev.target.value); saveSettings(); });
  $(".play", app).addEventListener("click", togglePlay);
  $(".show-all", app).addEventListener("change", (ev) => {
    settings.showAll = ev.target.checked;
    saveSettings();
    seek(t);
  });
  $(".csv", app).addEventListener("click", () => {
    const name = (p) => m.byPawn.get(p)?.name ?? "";
    const rows = [["time_s", "clock", "result", "damage", "delay_s", "range_m", "victims", "x", "y", "yaw"]];
    for (const c of casts) {
      rows.push([c.t.toFixed(2), fmtClock(c.t), c.result, c.dmg, c.delay?.toFixed(3) ?? "",
        c.dist != null ? Math.round(c.dist) : "", c.victims.map(name).join("|"), c.x, c.y, c.yaw?.toFixed(1) ?? ""]);
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${id}_${subject.name}_${ability.class_name}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  function seek(nt) {
    t = Math.max(Math.min(nt, m.end), Math.min(0, m.samples.t0));
    scrub.value = t;
    $(".clock", app).textContent = fmtClock(t);
    timeline.setTime(t);
    minimap.update({ t, subject: pawn, casts, showAll: settings.showAll });
    renderReadout(t);
  }

  function renderReadout(t) {
    const past = casts.filter((c) => c.t <= t);
    const c = counts(past, settings.heroesOnly);
    const st = statsAt(m, pawn, t);
    $(".tiles", app).innerHTML =
      tile("Thrown", c.thrown) +
      tile(settings.heroesOnly ? "Hit heroes" : "Hit", c.scored, "good") +
      tile("Accuracy", c.thrown ? pct(c.acc) : "–", "accent") +
      tile("Missed", c.miss) +
      tile("Damage", k1(c.dmg)) +
      tile("K / D / A", st ? `${st[2]}/${st[3]}/${st[4]}` : "–") +
      tile("Souls", st ? k1(st[0]) : "–") +
      tile("Level", st ? st[1] : "–") +
      tile("Hit non-hero", c.other) +
      tile("Hits → kills", c.hit ? `${c.kills}<small> / ${c.hit}</small>` : "–") +
      tile("Avg ready-idle", c.idle != null ? `${c.idle.toFixed(1)}<small> s</small>` : "–");

    const events = [];
    for (const k of past.slice(-40)) events.push({ t: k.t, kind: "cast", k });
    for (const k of m.kills) {
      if (k[0] > t) continue;
      if (k[1] === pawn || k[2] === pawn || (k[4] || []).includes(pawn)) events.push({ t: k[0], kind: "kill", k });
    }
    events.sort((a, b) => b.t - a.t);
    $(".feed", app).innerHTML = events.slice(0, 40).map((ev) => {
      if (ev.kind === "cast") {
        const k = ev.k;
        const vics = k.victims.map((v) => {
          const p = m.byPawn.get(v);
          return p ? `<img src="${esc(S.assets.hero(p.hero_id).icon)}" title="${esc(p.name)}">` : "";
        }).join("");
        const dist = k.dist != null ? ` · ${Math.round(k.dist)} m` : "";
        const label = k.result === "hit" ? `hit${k.delay != null ? ` +${k.delay.toFixed(2)}s` : ""}${dist} · ${k.dmg} dmg`
          : k.result === "other" ? `hit non-hero${dist} · ${k.dmg} dmg`
          : k.aimErr != null ? `miss · ${k.aimErr.toFixed(0)}° off <img src="${esc(S.assets.hero(m.byPawn.get(k.aimPawn)?.hero_id).icon)}" title="${esc(m.byPawn.get(k.aimPawn)?.name)}"> @ ${Math.round(k.aimDist)} m`
          : "miss · no enemy in range";
        const extra = k.killed ? ` <b class="kill-tag">→ kill</b>` : "";
        return `<li data-t="${k.t}"><span class="dot ${k.result}"></span><span class="t">${fmtClock(k.t)}</span>${vics}<span>${label}${extra}</span></li>`;
      }
      const [kt, vic, att, abilityId] = ev.k;
      const v = m.byPawn.get(vic), a = m.byPawn.get(att);
      const died = vic === pawn;
      const kab = S.assets.item(abilityId);
      return `<li data-t="${kt}" class="${died ? "ev-death" : "ev-kill"}"><span class="t">${fmtClock(kt)}</span>
        ${a ? `<img src="${esc(S.assets.hero(a.hero_id).icon)}" title="${esc(a.name)}">` : ""}
        ${kab?.image ? `<img class="kab" src="${esc(kab.image)}" title="${esc(kab.name)}">` : kab ? `<span class="muted small">${esc(kab.name)}</span>` : ""}
        <span>${died ? "killed" : "kill"}</span>
        ${v ? `<img src="${esc(S.assets.hero(v.hero_id).icon)}" title="${esc(v.name)}">` : ""}</li>`;
    }).join("") || `<li class="muted">nothing yet</li>`;
  }
  $(".feed", app).addEventListener("click", (ev) => {
    const li = ev.target.closest("li[data-t]");
    if (li) seek(Number(li.dataset.t) - 1.5);
  });

  function togglePlay() {
    const btn = $(".play", app);
    if (playing) { cancelAnimationFrame(playing); playing = null; btn.textContent = "▶"; return; }
    if (t >= m.end - 0.5) t = Math.min(0, m.samples.t0);
    btn.textContent = "❚❚";
    let last = performance.now();
    const step = (now) => {
      const nt = Math.min(m.end, t + ((now - last) / 1000) * settings.speed);
      last = now;
      seek(nt);
      if (nt >= m.end) { playing = null; btn.textContent = "▶"; return; }
      playing = requestAnimationFrame(step);
    };
    playing = requestAnimationFrame(step);
  }

  const onKey = (ev) => {
    if (ev.target.closest("input, select, textarea")) return;
    const big = ev.shiftKey ? 30 : 5;
    if (ev.key === " ") { ev.preventDefault(); togglePlay(); }
    else if (ev.key === "ArrowRight") seek(t + big);
    else if (ev.key === "ArrowLeft") seek(t - big);
    else if (ev.key === "Home") seek(0);
    else if (ev.key === "End") seek(m.end);
    else if (ev.key === ".") { const n = casts.find((c) => c.t > t + 0.1); if (n) seek(n.t + 0.6); }
    else if (ev.key === ",") { const p = [...casts].reverse().find((c) => c.t < t - 1.2); if (p) seek(p.t + 0.6); }
    else return;
  };
  document.addEventListener("keydown", onKey);
  S.cleanup = () => {
    document.removeEventListener("keydown", onKey);
    if (playing) cancelAnimationFrame(playing);
    timeline.destroy();
    minimap.destroy();
  };
  seek(t);
}

function renderNoDemo(app, id, e) {
  const c = (S.career || []).find((r) => r.match_id === id);
  const d = e ? new Date(e.start_time * 1000) : null;
  const hero = S.assets.hero(e?.hero_id ?? c?.hero_id);
  const mins = (c?.duration_s || e?.duration_s || 60) / 60;
  app.innerHTML = `
    <div class="match-header">
      <a href="#/hero/${e?.hero_id ?? c?.hero_id ?? ""}" class="back">← overview</a>
      <div class="mh-title">
        ${e ? `<span class="result ${e.won ? "win" : "loss"}">${e.won ? "WIN" : "LOSS"}</span>` : ""}
        <img class="mh-hero" src="${esc(hero.icon)}" alt=""><h2>#${id}</h2>
        ${d ? `<span class="muted">${fmtDate(d)} · ${ago(d)}</span>` : ""}
        ${e ? `<span class="muted">${fmtClock(e.duration_s)}</span>` : ""}
        <a class="muted small" target="_blank" rel="noopener" href="https://statlocker.gg/match/${id}">statlocker ↗</a>
      </div>
    </div>
    <div class="empty">
      <b>No demo for this match</b> — ${esc(e?.status || "unknown")}.<br>
      Open the match in Deadlock and click <b>Download Replay</b>; ${S.syncAvailable ? "the server picks it up automatically" : "then run <code>tools/sync.py</code>"}.
    </div>
    ${c ? `<h2 class="section-title">Valve end-of-match stats</h2>
    <div class="summary">
      ${tile("K / D / A", `${c.kills}/${c.deaths}/${c.assists}`)}
      ${tile("Souls", k1(c.net_worth || 0))}
      ${tile("Gun acc. vs heroes", c.hero_shots ? pct(c.hero_hits / c.hero_shots) : "–", "good")}
      ${tile("Headshots", c.hero_hits ? pct(c.hero_headshots / c.hero_hits) : "–")}
      ${tile("Hero dmg / min", Math.round((c.player_damage || 0) / mins))}
      ${tile("Dmg taken / min", Math.round((c.player_damage_taken || 0) / mins))}
      ${tile("Healing", k1(c.player_healing || 0))}
      ${tile("Ability kills", c.ability_kills ?? "–")}
      ${tile("Parry misses", c.parry_miss ?? "–")}
      ${tile("Avg badge", c.badge ?? "–")}
    </div>` : ""}`;
}

// ------------------------------------------------------------------ router

function go(hash) { location.hash = hash; }

function setParams(patch) {
  const [path, q] = location.hash.slice(1).split("?");
  const p = new URLSearchParams(q || "");
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) p.delete(k); else p.set(k, v);
  }
  location.hash = `${path}?${p}`;
}

async function route() {
  S.cleanup?.();
  S.cleanup = null;
  const [path, q] = location.hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(q || "");
  const parts = (path || "/").split("/").filter(Boolean);
  window.scrollTo({ top: 0 });
  if (parts[0] === "match" && parts[1]) {
    S.view = "match";
    await viewMatch(Number(parts[1]), params);
  } else {
    S.view = "overview";
    await viewOverview(parts[0] === "hero" ? Number(parts[1]) : undefined, params);
  }
}

// ------------------------------------------------------------------ sync button (only with tools/serve.py)

async function initSync() {
  let status;
  try {
    const r = await fetch("api/status");
    if (!r.ok) return;
    status = await r.json();
  } catch { return; }
  const btn = $("#sync");
  const log = $("#sync-log");
  btn.hidden = false;
  S.syncAvailable = true;
  const show = (s) => {
    btn.disabled = s.running;
    btn.textContent = s.running ? "syncing…" : "sync";
    btn.title = s.last_finished ? `last sync ${fmtDate(new Date(s.last_finished * 1000))} (exit ${s.last_exit})` : "";
    log.textContent = (s.log || []).slice(-12).join("\n");
    log.hidden = !s.running;
  };
  show(status);
  let wasRunning = status.running;
  const poll = async () => {
    try {
      const s = await (await fetch("api/status")).json();
      show(s);
      if (wasRunning && !s.running) { await loadAll(); route(); }
      wasRunning = s.running;
    } catch { /* server gone */ }
  };
  setInterval(poll, 2500);
  btn.addEventListener("click", async () => {
    await fetch("api/sync", { method: "POST" });
    wasRunning = true;
    poll();
  });
}

async function main() {
  try {
    await loadAll();
  } catch (err) {
    $("#subtitle").textContent = `failed to load data: ${err.message}. Run tools/sync.py first.`;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
  initSync();
}

main();
