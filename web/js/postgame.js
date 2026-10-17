// Match summary: what Deadlock's post-game screens show (MVP, key players, per-player awards,
// scoreboard, graphs), rebuilt from the demo. Most numbers are the players' own live counters
// (sampled every 10 s, so graphs are much finer than the game's); MVP / key players, kill types,
// barriers and souls by source come from Valve's post-game summary, which the server embeds in
// the demo at game end (absent in some demos; those parts then stay hidden).

import { esc, S, k1, itemHelp } from "./ui.js";
import { TEAM_NAMES, statsAt, itemsAt, abilityLevelsAt } from "./data.js";
import { fmtClock } from "./timeline.js";
import { timeSplit } from "./analysis.js";

const SLOT_ORDER = { weapon: 0, vitality: 1, spirit: 2 };

/** per player: final numbers, Valve's summary entry, MVP rank */
export function summaryModel(m) {
  const pg = m.postgame?.match_info;
  const pgBy = new Map((pg?.players || []).map((p) => [p.account_id, p]));
  const rows = m.players.map((p) => {
    const v = pgBy.get(p.account_id);
    const last = v?.stats?.at(-1) || {};
    return {
      p, v,
      mvp: v?.mvp_rank || null,
      souls: p.net_worth, k: p.kills, d: p.deaths, a: p.assists,
      dmg: p.hero_damage ?? last.player_damage ?? 0,
      obj: p.objective_damage ?? 0,
      // the in-game healing column counts barriers given too
      heal: last.player_healing != null ? last.player_healing + (last.player_barriering || 0) : p.hero_healing ?? 0,
      lh: p.last_hits, denies: p.denies,
      streak: p.max_streak || 0,
      // the game's "weapon kills" are gun + melee kills
      headshotKills: last.headshot_kills, meleeKills: last.melee_kills, abilityKills: last.ability_kills,
      weaponKills: last.bullet_kills != null ? last.bullet_kills + (last.melee_kills || 0) : undefined,
    };
  });
  return { rows, pg, winner: m.winning_team };
}

/** stat, label, formatter: the awards the game hands out (in order of prestige) */
const AWARDS = [
  ["k", "kills", String], ["abilityKills", "ability kills", String], ["dmg", "player dmg", k1],
  ["obj", "obj dmg", k1], ["a", "assists", String], ["heal", "healing", k1], ["souls", "souls", k1],
  ["headshotKills", "headshot kills", String], ["weaponKills", "weapon kills", String], ["meleeKills", "melee kills", String],
];
const RANK = ["Most", "Second most", "Third most"];

/**
 * Each player's placements like the game's post-game cards: "Most kills", "Second most healing".
 * Ties share a rank (two players with the second-most kills both get "second most kills").
 * Sorted by rank, then by the stat's prestige. Players without a top-3 placement get their
 * single best-ranked stat without a "most".
 */
export function awards(rows) {
  const out = new Map(rows.map((r) => [r.p.pawn, []]));
  const position = new Map(rows.map((r) => [r.p.pawn, []]));
  AWARDS.forEach(([key, label, fmt], prestige) => {
    for (const r of rows) {
      const v = r[key];
      if (!(v > 0)) continue;
      const rank = rows.filter((o) => (o[key] || 0) > v).length;
      position.get(r.p.pawn).push({ rank, prestige, label, key, value: fmt(v) });
      if (rank < 3) out.get(r.p.pawn).push({ rank, prestige, label, key, value: fmt(v) });
    }
  });
  for (const [pawn, list] of out) {
    list.sort((a, b) => a.rank - b.rank || a.prestige - b.prestige);
    if (!list.length) {
      const best = position.get(pawn).sort((a, b) => a.rank - b.rank || a.prestige - b.prestige)[0];
      if (best) list.push({ ...best, rank: null });
    }
  }
  return out;
}

const heroOf = (p) => S.assets.hero(p.hero_id);
/** the game's white UI shapes, tinted with currentColor */
const ui = (name, cls = "") => (S.assets.ui?.[name] ? `<i class="ui-mask ${cls}" style="--m:url('${S.assets.ui[name]}')"></i>` : "");
/** award stat -> icon + color, like the game's cards (skull red, heart green, person white …) */
const AWARD_STYLE = {
  k: ["icon_kill", "kill"], abilityKills: ["icon_kill", "kill"], headshotKills: ["icon_kill", "kill"], weaponKills: ["icon_kill", "kill"],
  meleeKills: ["icon_kill", "kill"], a: ["icon_kill", "kill"], dmg: ["icon_playerdmg", "dmg"], obj: ["icon_objdmg", "dmg"],
  heal: ["icon_heal", "heal"], souls: ["icon_souls", "souls"],
};

/** the team's brush logo from the game, tinted in team color (text fallback without assets) */
export function teamLogo(t, cls = "") {
  return S.assets.ui?.[`logo_team${t}`]
    ? `<span class="pg-logo team-${t} ${cls}" role="img" aria-label="${esc(TEAM_NAMES[t])}" title="${esc(TEAM_NAMES[t])}">${ui(`logo_team${t}`, "pg-logo-mask")}</span>`
    : `<span class="pg-logo-text team-${t}">${esc(TEAM_NAMES[t])}</span>`;
}

function awardList(list, n) {
  return `<ul class="aw-list">${list.slice(0, n).map((a) => {
    const [icon, tone] = AWARD_STYLE[a.key] || ["icon_kill", "kill"];
    return `<li class="aw aw-${tone}">${ui(icon, "aw-icon")}<b>${a.value}</b>
      <span>${a.rank != null ? `<small>${RANK[a.rank]}</small>` : ""}${esc(a.label)}</span></li>`;
  }).join("")}</ul>`;
}

/** a slanted portrait card, like the game's team screens */
function card(r, list, badge) {
  const h = heroOf(r.p);
  return `<button class="pg-card team-${r.p.team} ${badge ? `pg-${badge}` : ""}" data-pawn="${r.p.pawn}" title="open ${esc(r.p.name)} in the replay">
    <span class="pg-card-frame">
      ${h.card ? `<img class="pg-art" src="${esc(h.card)}" alt="">` : `<img class="pg-art pg-art-icon" src="${esc(h.icon)}" alt="">`}
      ${badge ? `<span class="pg-badge">${ui(badge === "mvp" ? "mvp_trophy" : "key_trophy", "pg-trophy")}${badge === "mvp" ? "MVP" : "Key"}</span>` : ""}
    </span>
    <span class="pg-card-name">${esc(r.p.name)}</span>
    <span class="pg-card-hero">${esc(h.name)}</span>
    ${awardList(list, badge === "mvp" ? 5 : 2)}
  </button>`;
}

export function renderSummary(el, m, { onPick }) {
  const model = summaryModel(m);
  const aw = awards(model.rows);
  const teams = [2, 3];
  const byTeam = (t) => model.rows.filter((r) => r.p.team === t).sort((a, b) => b.souls - a.souls);
  const mvp = model.rows.find((r) => r.mvp === 1);
  const keys = model.rows.filter((r) => r.mvp === 2 || r.mvp === 3).sort((a, b) => a.mvp - b.mvp);
  const best = (key) => Math.max(...model.rows.map((r) => r[key] || 0));
  const cols = [["souls", "souls", k1], ["k", "k", String], ["d", "d", String], ["a", "a", String],
    ["dmg", "plyr dmg", k1], ["obj", "obj dmg", k1], ["heal", "healing", k1], ["lh", "last hits", String]];
  const tops = Object.fromEntries(cols.map(([k]) => [k, best(k)]));
  const started = model.pg?.start_time ? new Date(model.pg.start_time * 1000) : null;
  const when = started ? started.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";
  const teamSouls = (t) => byTeam(t).reduce((s, r) => s + r.souls, 0);

  const scoreboard = (t) => {
    const rs = byTeam(t);
    return `<table class="pg-board team-${t}">
      <tr class="pg-board-head"><th class="pg-team-th" colspan="3">${teamLogo(t, "pg-logo-sm")}${model.winner === t ? `<span class="pg-won">Victorious</span>` : ""}</th>
        ${cols.map(([, label]) => `<th>${label}</th>`).join("")}<th class="pg-items-th">items</th>
        <th class="pg-when">${t === 2 ? `${esc(when)} &nbsp; ${fmtClock(m.end)}` : ""}</th></tr>
      ${rs.map((r) => {
        const items = itemsAt(m, r.p.pawn, m.end).map((id) => ({ id, ...S.assets.item(id) })).filter((it) => it.type === "upgrade")
          .sort((a, b) => (SLOT_ORDER[a.slot] ?? 3) - (SLOT_ORDER[b.slot] ?? 3) || (a.tier || 0) - (b.tier || 0));
        const lv = abilityLevelsAt(m, r.p.pawn, m.end);
        return `<tr data-pawn="${r.p.pawn}" title="open ${esc(r.p.name)} in the replay">
          <td class="pg-icon"><img src="${esc(heroOf(r.p).icon)}" alt=""></td>
          <td class="pg-who"><b>${esc(r.p.name)}</b><small>${esc(heroOf(r.p).name)}</small></td>
          <td class="pg-mvp-cell">${r.mvp ? ui(r.mvp === 1 ? "mvp_trophy" : "key_trophy", "pg-trophy-sm") : ""}</td>
          ${cols.map(([k, , fmt]) => {
            // the game marks the best value of each column, but not deaths
            const top = k !== "d" && r[k] && r[k] === tops[k];
            return `<td class="${top ? "pg-top" : ""} ${k === "d" ? "pg-dim" : ""}">${top ? `${ui("starburst", "pg-burst")}` : ""}<span>${fmt(r[k] || 0)}</span></td>`;
          }).join("")}
          <td class="pg-items">${items.map((it) => `<img class="slot-${esc(it.slot || "x")}" src="${esc(S.assets.itemIcon(it.id))}" data-help="${esc(itemHelp(it))}" alt="${esc(it.name)}">`).join("")}</td>
          <td class="pg-abs">${S.assets.signatures(r.p.hero_id).map((ab) => {
            const n = lv.get(ab.id) ?? 0, tier = Math.max(0, n - 1);
            return `<span title="${esc(ab.name)} · ${n ? `upgrades ${tier}/3` : "not unlocked"}">${ab.image ? `<img src="${esc(ab.image)}" alt="">` : ""}<i>${[1, 2, 3].map((i) => `<em class="${i <= tier ? "on" : ""}"></em>`).join("")}</i></span>`;
          }).join("")}</td>
        </tr>`;
      }).join("")}
      <tr class="pg-total"><td colspan="3"></td><td><span class="pg-pill">${k1(teamSouls(t))}</span></td><td colspan="${cols.length + 2}"></td></tr>
    </table>`;
  };

  el.innerHTML = `
    <section class="pg-banner">
      <div class="pg-banner-team">${model.winner ? `${teamLogo(model.winner, "pg-logo-lg")}<span class="pg-victorious">Victorious</span>` : "<h2>Match over</h2>"}</div>
      <div class="pg-banner-meta"><b>Standard match</b><span>Match ${m.match_id || ""}</span><span>${esc(when)} · ${fmtClock(m.end)}</span></div>
    </section>
    ${mvp ? `<section class="pg-mvp-stage team-${mvp.p.team}">
      <div class="pg-mvp-left" data-pawn="${mvp.p.pawn}">
        <div class="pg-mvp-title">${ui("mvp_trophy", "pg-trophy-lg")}<span>MVP</span></div>
        ${awardList(aw.get(mvp.p.pawn), 5)}
      </div>
      <div class="pg-mvp-hero" data-pawn="${mvp.p.pawn}">
        ${heroOf(mvp.p).card ? `<img src="${esc(heroOf(mvp.p).card)}" alt="">` : ""}
        <span class="pg-mvp-heroname">${esc(heroOf(mvp.p).name)}</span>
        <span class="pg-mvp-player"><small>played by</small>${esc(mvp.p.name)}</span>
      </div>
      <div class="pg-mvp-keys">
        <div class="pg-keys-title">${ui("key_trophy", "pg-trophy")}<span>Key Players</span></div>
        <div class="pg-keys">${keys.map((r) => card(r, aw.get(r.p.pawn), "key")).join("")}</div>
      </div>
    </section>` : ""}
    <section class="pg-teams">
      ${teams.map((t) => `<div class="pg-team team-${t}">
        <div class="pg-team-head">${teamLogo(t, "pg-logo-md")}<span class="pg-team-result">${model.winner === t ? "Victorious" : model.winner ? "Defeated" : ""}</span></div>
        <div class="pg-cards">${(t === 2 ? byTeam(t) : byTeam(t)).map((r) => card(r, aw.get(r.p.pawn), r.mvp === 1 ? "mvp" : r.mvp ? "key" : null)).join("")}</div>
      </div>${t === 2 ? `<div class="pg-divider" aria-hidden="true">
        ${S.assets.ui?.sigil_team2 ? `<img src="${S.assets.ui.sigil_team2}" alt="">` : ""}
        <span class="pg-divider-time">${fmtClock(m.end)}</span>
        ${S.assets.ui?.sigil_team3 ? `<img src="${S.assets.ui.sigil_team3}" alt="">` : ""}
      </div>` : ""}`).join("")}
    </section>
    <section class="pg-scoreboard">${teams.map(scoreboard).join("")}
      <p class="small muted">Starburst = best in the match. Numbers are the game's own counters read from the demo; healing includes barriers given, like the in-game scoreboard.</p>
    </section>
`;

  el.onclick = (ev) => {
    const hit = ev.target.closest("[data-pawn]");
    if (hit && !ev.target.closest("#graphs")) onPick(Number(hit.dataset.pawn));
  };
}

// ------------------------------------------------------------------ graphs

const PALETTE = { 2: ["#e8962e", "#f6c96f", "#c9781c", "#ffe0a3", "#a95f17", "#e4844a"],
  3: ["#4f86e8", "#8ab8ff", "#2d64c8", "#b9d3ff", "#3a9fcf", "#7a83ec"] };
const CATS = ["#e5645a", "#4f8fe8", "#5fd38d", "#e0b25a", "#a98bff", "#3ec7c0", "#ff8ad8", "#c9d36a", "#ff9f5a", "#8b919c", "#6fa8ff", "#d98b5f"];

const GRAPHS = [
  { group: "General" },
  { id: "souls", label: "Souls collected", col: 0 },
  { id: "spm", label: "Souls per minute", col: 0, perMin: true },
  { id: "kills", label: "Kills", col: 2 },
  { id: "deaths", label: "Deaths", col: 3 },
  { id: "assists", label: "Assists", col: 4 },
  { id: "pdmg", label: "Player damage", col: 6 },
  { id: "odmg", label: "Objective damage", col: 7 },
  { id: "heal", label: "Healing (without barriers)", col: 8 },
  { id: "lh", label: "Last hits", col: 5 },
  { id: "teamsouls", label: "Team souls" },
  { id: "fighttime", label: "Time fighting heroes", time: true },
  { id: "movetime", label: "Time on ziplines", time: true },
  { id: "actions", label: "Movement actions (jumps, dashes, slides)" },
  { group: "Player" },
  { id: "bytype", label: "Damage dealt by type", player: true },
  { id: "toplayers", label: "Damage to players", player: true },
  { id: "fromplayers", label: "Damage from players", player: true },
  { id: "combatsplit", label: "Time split: combat", player: true },
  { id: "movesplit", label: "Time split: movement", player: true },
  { id: "actionsplit", label: "Movement actions by type", player: true },
  { id: "sources", label: "Souls by source", player: true, needsPg: true },
  { id: "buffs", label: "Permanent buffs", player: true, needsPg: true },
];

let graphState = { id: "souls", pawn: null };

/** the "Simple Graphs" tab: the game's post-game graphs, at demo resolution */
export function renderSimpleGraphs(el, m) {
  el.innerHTML = `<section class="pg-graphs" id="graphs"></section>`;
  renderGraphs(el.querySelector("#graphs"), m, summaryModel(m));
}

function renderGraphs(el, m, model) {
  const players = model.rows.map((r) => r.p).sort((a, b) => a.team - b.team || b.net_worth - a.net_worth);
  if (graphState.pawn == null || !m.byPawn.has(graphState.pawn)) graphState.pawn = (model.rows.find((r) => r.mvp === 1) || model.rows[0]).p.pawn;
  const g = GRAPHS.find((x) => x.id === graphState.id) || GRAPHS[1];
  const strip = (t) => model.rows.filter((r) => r.p.team === t).sort((a, b) => (t === 2 ? a.souls - b.souls : b.souls - a.souls))
    .map((r) => `<span class="pg-strip-hero team-${t} ${r.p.pawn === graphState.pawn ? "on" : ""}" data-graph-pawn="${r.p.pawn}" title="${esc(r.p.name)}">
      <img src="${esc(heroOf(r.p).icon)}" alt=""><b>${k1(r.souls)}</b></span>`).join("");
  const total = (t) => model.rows.filter((r) => r.p.team === t).reduce((s, r) => s + r.souls, 0);
  el.innerHTML = `
    <div class="pg-strip">
      <div class="pg-strip-team">${strip(2)}</div>
      <div class="pg-strip-totals"><span class="team-2">${k1(total(2))} ${S.assets.ui?.sigil_team2 ? `<img src="${S.assets.ui.sigil_team2}" alt="">` : ""}</span>
        <span class="team-3">${S.assets.ui?.sigil_team3 ? `<img src="${S.assets.ui.sigil_team3}" alt="">` : ""} ${k1(total(3))}</span></div>
      <div class="pg-strip-team">${strip(3)}</div>
    </div>
    <div class="pg-graph-head">
      <label class="pg-graph-type"><small>Graph type</small><select class="pg-graph">${GRAPHS.map((x) => x.group ? `<optgroup label="${x.group}">`
        : x.needsPg && !model.pg ? "" : `<option value="${x.id}" ${x.id === g.id ? "selected" : ""}>${x.label}</option>`).join("")}</select></label>
      <label class="pg-graph-type" ${g.player ? "" : "hidden"}><small>Player</small><select class="pg-player">${players.map((p) => `<option value="${p.pawn}" ${p.pawn === graphState.pawn ? "selected" : ""}>${esc(p.name)} · ${esc(heroOf(p).name)}</option>`).join("")}</select></label>
      <span class="small muted pg-graph-note"></span>
    </div>
    <div class="pg-graph-body"></div>`;
  el.querySelector(".pg-graph").onchange = (ev) => { graphState.id = ev.target.value; renderGraphs(el, m, model); };
  el.querySelector(".pg-player").onchange = (ev) => { graphState.pawn = Number(ev.target.value); renderGraphs(el, m, model); };
  for (const h of el.querySelectorAll("[data-graph-pawn]")) {
    h.onclick = () => {
      graphState.pawn = Number(h.dataset.graphPawn);
      if (!GRAPHS.find((x) => x.id === graphState.id)?.player) graphState.id = "bytype";
      renderGraphs(el, m, model);
    };
  }
  const body = el.querySelector(".pg-graph-body"), note = el.querySelector(".pg-graph-note");
  const data = graphData(g, m, model, graphState.pawn);
  note.textContent = data.note || "";
  if (data.table) { body.innerHTML = data.table; return; }
  lineChart(body, data.series, { end: m.end, fmt: data.fmt || k1, keepOrder: data.keepOrder });
}

/** step series of a stat column (every 10 s) */
function statSeries(m, pawn, col, perMin) {
  const tr = m.statTracks.get(pawn);
  if (!tr) return [];
  return tr.rows.map((row, i) => {
    const t = m.stats.t0 + i * m.stats.dt;
    const v = row[col] || 0;
    return [t, perMin ? (t > 60 ? v / (t / 60) : 0) : v];
  }).filter(([t]) => t >= 0);
}

/** cumulative sums of events [t, value] grouped by key, as series */
function cumulative(events, keyName, colorOf) {
  const groups = new Map();
  for (const [t, key, v] of events) {
    const g = groups.get(key) || { pts: [[0, 0]], sum: 0 };
    g.sum += v;
    g.pts.push([t, g.sum]);
    groups.set(key, g);
  }
  return [...groups.entries()].sort((a, b) => b[1].sum - a[1].sum)
    .map(([key, g], i) => ({ name: keyName(key), color: colorOf ? colorOf(key, i) : CATS[i % CATS.length], pts: g.pts, icon: null, key }));
}

function graphData(g, m, model, pawn) {
  const players = model.rows.map((r) => r.p);
  const teamIdx = (p) => players.filter((q) => q.team === p.team).sort((a, b) => b.net_worth - a.net_worth).indexOf(p);
  const playerSeries = (col, perMin) => players.map((p) => ({ name: p.name, icon: heroOf(p).icon, color: PALETTE[p.team]?.[teamIdx(p) % 6] || "#999",
    pts: statSeries(m, p.pawn, col, perMin) }));
  if (g.col != null) {
    return { series: playerSeries(g.col, g.perMin), note: "every 10 s, from the players' own counters in the demo" };
  }
  if (g.id === "teamsouls") {
    const series = [2, 3].map((t) => {
      const ps = players.filter((p) => p.team === t);
      const tr = ps.map((p) => statSeries(m, p.pawn, 0));
      const n = Math.max(...tr.map((x) => x.length));
      const pts = [];
      for (let i = 0; i < n; i++) pts.push([tr.find((x) => x[i])?.[i]?.[0] ?? 0, tr.reduce((s, x) => s + (x[i]?.[1] || 0), 0)]);
      return { name: TEAM_NAMES[t], color: PALETTE[t][0], pts };
    });
    return { series };
  }
  // time split (combat / movement state every 0.5 s, rebuilt from the demo)
  const ts = (pw) => timeSplit(m, pw, S.assets);
  const cumulativeBy = (samples, idx, key) => {
    const pts = [[0, 0]]; let sum = 0, last = -1;
    for (const smp of samples) {
      if (smp[idx] !== key) continue;
      sum += m.samples.dt;
      if (smp[0] - last >= 5) { pts.push([smp[0], sum]); last = smp[0]; }
    }
    pts.push([m.end, sum]);
    return pts;
  };
  const countSeries = (times) => { const xs = [...times].sort((a, b) => a - b); return [[0, 0], ...xs.map((t, i) => [t, i + 1]), [m.end, xs.length]]; };
  if (g.id === "fighttime" || g.id === "movetime") {
    const [idx, key] = g.id === "fighttime" ? [1, "hero"] : [2, "zip"];
    return { series: players.map((p) => ({ name: p.name, icon: heroOf(p).icon, color: PALETTE[p.team]?.[teamIdx(p) % 6] || "#999",
      pts: cumulativeBy(ts(p.pawn)?.samples || [], idx, key) })), fmt: (v) => fmtClock(v), note: "alive time, every 0.5 s, rebuilt from the demo" };
  }
  if (g.id === "actions") {
    return { series: players.map((p) => {
      const a = ts(p.pawn)?.actions || {};
      return { name: p.name, icon: heroOf(p).icon, color: PALETTE[p.team]?.[teamIdx(p) % 6] || "#999", pts: countSeries([...(a.jumps || []), ...(a.dashes || []), ...(a.slides || [])]) };
    }), fmt: String, note: "every jump, dash and slide, from the demo" };
  }
  if (g.id === "combatsplit" || g.id === "movesplit") {
    const combat = g.id === "combatsplit";
    const cats = combat
      ? [["hero", "Fighting heroes", "#e5645a"], ["npc", "Fighting troopers / objectives", "#e0b25a"], ["neutral", "Farming neutrals", "#5fd38d"], ["out", "Out of combat", "#6b6f78"]]
      : [["zip", "Zipline", "#4f86e8"], ["slide", "Slide", "#a98bff"], ["dash", "Dash", "#e8962e"], ["air", "Airborne", "#9b9385"], ["ground", "On foot", "#55525a"]];
    const smp = ts(pawn)?.samples || [];
    return { series: cats.map(([key, name, color]) => ({ name, color, pts: cumulativeBy(smp, combat ? 1 : 2, key) })),
      fmt: (v) => fmtClock(v), note: "alive time, every 0.5 s; combat = dealt / took damage around that moment" };
  }
  if (g.id === "actionsplit") {
    const a = ts(pawn)?.actions || {};
    const kinds = [["jumps", "Jumps", "#e0b25a"], ["dashes", "Dashes", "#e8962e"], ["slides", "Slides", "#a98bff"], ["ziplines", "Zipline rides", "#4f86e8"], ["mantles", "Mantles", "#5fd38d"]];
    return { series: kinds.map(([k, name, color]) => ({ name, color, pts: countSeries(a[k] || []) })).filter((s) => s.pts.length > 2), fmt: String };
  }
  const me = m.byPawn.get(pawn);
  if (g.id === "bytype") {
    const ev = m.damage.filter((d) => d[1] === pawn && d[3] >= 0 && m.byPawn.get(d[3])?.team !== me.team).map((d) => [d[0], d[4], d[5]]);
    return { series: cumulative(ev, (id) => S.assets.item(id)?.name || `#${id}`), note: "damage to enemy heroes, every hit" };
  }
  if (g.id === "toplayers" || g.id === "fromplayers") {
    const to = g.id === "toplayers";
    const ev = m.damage.filter((d) => (to ? d[1] === pawn && d[3] >= 0 : d[3] === pawn && d[1] !== pawn) && m.byPawn.get(to ? d[3] : d[1])?.team !== me.team)
      .map((d) => [d[0], to ? d[3] : d[1], d[5]]);
    return {
      series: cumulative(ev, (pw) => m.byPawn.get(pw)?.name || "?", (pw) => {
        const p = m.byPawn.get(pw);
        return PALETTE[p?.team]?.[teamIdx(p) % 6] || "#999";
      }).map((s) => ({ ...s, icon: heroOf(m.byPawn.get(s.key)).icon })),
      note: to ? "hero damage dealt, per enemy" : "hero damage taken, per enemy (troopers and objectives not included)",
    };
  }
  const v = model.rows.find((r) => r.p.pawn === pawn)?.v;
  if (g.id === "sources") {
    const SRC = [["gold_player", "kills"], ["gold_player_orbs", "kill orbs"], ["gold_lane_creep", "troopers"], ["gold_lane_creep_orbs", "trooper orbs"],
      ["gold_neutral_creep", "neutrals"], ["gold_neutral_creep_orbs", "neutral orbs"], ["gold_boss", "objectives"], ["gold_boss_orb", "objective orbs"],
      ["gold_treasure", "crates / treasure"], ["gold_denied", "denies"]];
    const stats = v?.stats || [];
    const series = SRC.map(([k, name], i) => ({ name, color: CATS[i % CATS.length], pts: [[0, 0], ...stats.map((s) => [s.time_stamp_s, s[k] || 0])] }))
      .filter((s) => s.pts.some(([, y]) => y > 0)).sort((a, b) => b.pts.at(-1)[1] - a.pts.at(-1)[1]);
    return { series, note: `Valve's summary: only ${stats.length} snapshots per player, so this one is coarse` };
  }
  if (g.id === "buffs") {
    // like the game's graph: one line per stat counting pickups (all levels), legend = summed bonus
    const STATS = [["hp", "Bonus Health", "flat"], ["bulletresist", "Bullet Resist", "%"], ["wp", "Weapon Damage", "%"],
      ["firerate", "Fire Rate", "%"], ["ammo", "Max Ammo", "%"], ["spirit", "Spirit Power", "flat"], ["cd", "Cooldown Reduction", "%"],
      ["spiritresist", "Spirit Resist", "%"], ["range", "Ability Range", "%"], ["movespeed", "Move Speed", "m"]];
    const picks = new Map();
    for (const b of v?.power_up_buffs || []) {
      if (!b.is_permanent) continue;
      const key = String(b.type).replace(/_permanent_pickup(_lv\d)?$/, "");
      const list = picks.get(key) || [];
      (b.pickup_times_s || []).forEach((t, i) => list.push([t, b.pickup_stat_values?.[i] ?? 0]));
      picks.set(key, list);
    }
    const nice = (x) => String(Math.round(x * 100) / 100);
    const series = STATS.filter(([k]) => picks.get(k)?.length).map(([k, name, unit], i) => {
      const list = picks.get(k).sort((a2, b2) => a2[0] - b2[0]);
      let n = 0, sum = 0;
      const pts = [[0, 0]], vals = [0];
      // steps: flat until a pickup, then up by one
      for (const [t, val] of list) { pts.push([t, n]); vals.push(sum); n++; sum += unit === "m" ? val * 0.0254 : val; pts.push([t, n]); vals.push(sum); }
      pts.push([m.end, n]); vals.push(sum);
      const fmtVal = (x) => unit === "flat" ? `+${nice(x)}` : unit === "m" ? `+${x.toFixed(2)}m` : `+${nice(x)}%`;
      return { name, color: CATS[i % CATS.length], pts, vals, fmtVal };
    });
    return { series, keepOrder: true, fmt: String,
      note: series.length ? "pickups per stat (Sinner's Sacrifice, golden statues, …); legend: total bonus · from Valve's summary" : "no permanent buffs picked up" };
  }
  return { series: [] };
}

/** SVG line chart with a hover readout (values at the cursor, sorted, like the game's) */
function lineChart(el, series, { end, fmt, keepOrder = false }) {
  const W = 1000, H = 300, padL = 54, padR = 12, padT = 10, padB = 24;
  const maxY = Math.max(1, ...series.flatMap((s) => s.pts.map((p) => p[1])));
  const x = (t) => padL + (Math.max(0, t) / end) * (W - padL - padR);
  const y = (v) => H - padB - (v / maxY) * (H - padT - padB);
  const at = (s, t) => { let v = 0; for (const [tt, vv] of s.pts) { if (tt > t) break; v = vv; } return v; };
  // series may carry their own legend value (e.g. summed buff bonus next to the pickup count)
  const label = (s, t) => { if (!s.vals) return fmt(Math.round(at(s, t))); let i = 0; s.pts.forEach(([tt], j) => { if (tt <= t) i = j; }); return s.fmtVal(s.vals[i]); };
  // counts get whole-number ticks; everything else quarters of the max
  const counting = fmt === String;
  const step = counting ? Math.max(1, Math.ceil(maxY / 5)) : 0;
  const ticks = counting ? Array.from({ length: Math.floor(maxY / step) + 1 }, (_, i) => i * step) : [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);
  // the SVG stretches to the box (preserveAspectRatio none), so axis labels are HTML on top
  const pct = (v, total) => `${(v / total) * 100}%`;
  el.innerHTML = `<div class="pg-chart">
    <div class="pg-plot">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${ticks.map((v) => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`).join("")}
      ${series.map((s) => `<path class="pg-line" d="${s.pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("")}" stroke="${s.color}"/>`).join("")}
      <line class="pg-cursor" x1="0" x2="0" y1="${padT}" y2="${H - padB}" visibility="hidden"/>
      <rect class="pg-hover" x="${padL}" y="0" width="${W - padL - padR}" height="${H}" fill="transparent"/>
    </svg>
    ${ticks.map((v) => `<span class="pg-ax pg-ax-y" style="top:${pct(y(v), H)};right:${pct(W - padL + 6, W)}">${fmt(Math.round(v))}</span>`).join("")}
    ${[0, 600, 1200, 1800, 2400, 3000].filter((t) => t <= end).map((t) => `<span class="pg-ax pg-ax-x" style="left:${pct(x(t), W)};top:${pct(H - padB + 4, H)}">${fmtClock(t)}</span>`).join("")}
    </div>
    <ol class="pg-legend"></ol>
  </div>`;
  const svg = el.querySelector("svg"), legend = el.querySelector(".pg-legend"), cursor = el.querySelector(".pg-cursor");
  const show = (t) => {
    const rows = series.map((s) => ({ s, v: at(s, t) }));
    if (!keepOrder) rows.sort((a, b) => b.v - a.v);
    const total = rows.reduce((a, r) => a + r.v, 0);
    const share = series.length > 2 && !series.some((s) => s.icon || s.vals);
    legend.innerHTML = `<li class="pg-legend-t">${fmtClock(t)}</li>` + rows.map(({ s, v }) => `<li>
      <i style="background:${s.color}"></i>${s.icon ? `<img src="${esc(s.icon)}" alt="">` : ""}<span>${esc(s.name)}</span><b>${label(s, t)}</b>${share && !s.vals ? `<small>(${total ? Math.round((v / total) * 100) : 0}%)</small>` : ""}</li>`).join("")
      + (share ? `<li class="pg-legend-total"><span></span><b>${fmt(Math.round(total))}</b></li>` : "");
  };
  svg.addEventListener("mousemove", (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const t = Math.max(0, Math.min(end, ((px - padL) / (W - padL - padR)) * end));
    cursor.setAttribute("x1", x(t)); cursor.setAttribute("x2", x(t)); cursor.setAttribute("visibility", "visible");
    show(t);
  });
  svg.addEventListener("mouseleave", () => { cursor.setAttribute("visibility", "hidden"); show(end); });
  show(end);
}
