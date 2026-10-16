// Valve match metadata, digested in the browser: objectives, souls over time, full
// scoreboard, damage matrix (who hurt whom, with what), and per-player detail
// (damage by source, gold sources, item build, deaths, accolades, power-ups).

import { esc, S, k1, tile } from "./ui.js";
import { pct } from "./analysis.js";
import { fmtClock } from "./timeline.js";

const TEAM = (t) => 2 + Number(t); // metadata Team0/Team1 -> demo team numbers (Amber 2, Sapphire 3)

const OBJECTIVES = {
  0: "Patron", 1: "Guardian L1", 2: "Guardian L2", 3: "Guardian L3", 4: "Guardian L4",
  5: "Walker L1", 6: "Walker L2", 7: "Walker L3", 8: "Walker L4", 9: "Patron (Titan)",
  10: "Shrine 1", 11: "Shrine 2", 12: "Base Guardian L1", 13: "Base Guardian L2",
  14: "Base Guardian L3", 15: "Base Guardian L4",
};
const GOLD_SOURCES = {
  1: "Hero kills", 2: "Lane creeps", 3: "Neutrals", 4: "Bosses", 5: "Treasure", 6: "Assists",
  7: "Denies", 8: "Team bonus", 9: "Assassinate", 10: "Trophy Collector", 11: "Cultist Sacrifice",
  12: "Breakables", 13: "Goose Egg",
};

/** raw metadata JSON → structures the views need */
export function digestMeta(raw) {
  const mi = raw.match_info || raw;
  const players = (mi.players || []).map((p) => ({
    slot: p.player_slot, account_id: p.account_id, hero_id: p.hero_id, team: TEAM(p.team),
    kills: p.kills, deaths: p.deaths, assists: p.assists, net_worth: p.net_worth,
    last_hits: p.last_hits, denies: p.denies, level: p.level, mvp_rank: p.mvp_rank,
    final: (p.stats || []).at(-1) || {},
    stats: p.stats || [],
    items: p.items || [],
    deathsList: p.death_details || [],
    accolades: (p.accolades || []).filter((a) => a.accolade_threshold_achieved > 0),
    powerups: p.power_up_buffs || [],
    pings: (p.pings || []).length,
    abandon: p.abandon_match_time_s || 0,
  }));
  const bySlot = new Map(players.map((p) => [p.slot, p]));

  // damage matrix: cumulative arrays per sample; the last value is the match total
  const dm = mi.damage_matrix || {};
  const names = dm.source_details?.source_name || [];
  const types = dm.source_details?.stat_type || [];
  const matrix = new Map(); // `${dealer}|${target}` -> damage
  const bySource = new Map(); // dealer slot -> Map(source name -> damage to heroes)
  const healing = new Map();
  for (const dd of dm.damage_dealers || []) {
    const src = bySource.get(dd.dealer_player_slot) || new Map();
    for (const s of dd.damage_sources || []) {
      const type = types[s.source_details_index];
      const name = names[s.source_details_index] || "?";
      for (const tp of s.damage_to_players || []) {
        const total = (tp.damage || []).at(-1) || 0;
        if (type === 0) {
          const key = `${dd.dealer_player_slot}|${tp.target_player_slot}`;
          matrix.set(key, (matrix.get(key) || 0) + total);
          const dealer = bySlot.get(dd.dealer_player_slot), target = bySlot.get(tp.target_player_slot);
          if (dealer && target && dealer.team !== target.team) src.set(name, (src.get(name) || 0) + total);
        } else if (type === 1) {
          healing.set(dd.dealer_player_slot, (healing.get(dd.dealer_player_slot) || 0) + total);
        }
      }
    }
    bySource.set(dd.dealer_player_slot, src);
  }

  return {
    duration: mi.duration_s,
    winner: mi.winning_team != null ? TEAM(mi.winning_team) : null,
    players, bySlot, matrix, bySource, healing,
    objectives: (mi.objectives || []).filter((o) => o.destroyed_time_s)
      .map((o) => ({ t: o.destroyed_time_s, team: TEAM(o.team), id: o.team_objective_id, name: OBJECTIVES[o.team_objective_id] || `objective ${o.team_objective_id}`, playerDmg: o.player_damage, creepDmg: o.creep_damage }))
      .sort((a, b) => a.t - b.t),
    midBoss: (mi.mid_boss || []).map((b) => ({ t: b.destroyed_time_s, killed: TEAM(b.team_killed), claimed: TEAM(b.team_claimed) })),
    paths: mi.match_paths || null,
    badges: [mi.average_badge_team0, mi.average_badge_team1],
  };
}

const heroImg = (hid, title = "") => `<img class="hi" src="${esc(S.assets.hero(hid).icon)}" title="${esc(title || S.assets.hero(hid).name)}" alt="">`;
const pname = (p) => S.profiles[p.account_id]?.name || S.assets.hero(p.hero_id).name;
const sourceLabel = (name) => {
  if (name === "Bullet") return "Bullets";
  const base = name.replace(/_crit$/, "");
  const it = S.assets.itemByClass(base);
  return (it?.name || base) + (name.endsWith("_crit") ? " (crit)" : "");
};

/** full report HTML; `subjectAccount` gets the detail section */
export function renderReport(el, d, subjectAccount) {
  const subject = d.players.find((p) => p.account_id === subjectAccount) || d.players[0];
  const teams = [2, 3];
  const objByTeam = (t) => d.objectives.filter((o) => o.team !== t).length; // objectives a team destroyed (owned by the other)

  // souls over time
  const W = 1000, H = 180, pad = 30;
  const maxT = Math.max(d.duration, 60);
  const maxNw = Math.max(1, ...d.players.map((p) => p.net_worth || 0));
  const x = (t) => pad + (t / maxT) * (W - pad - 8);
  const y = (v) => H - 16 - (v / maxNw) * (H - 26);
  const lines = d.players.map((p) => {
    const pts = [[0, 0], ...p.stats.map((s) => [s.time_stamp_s, s.net_worth])];
    return `<path class="nw-line team-${p.team} ${p === subject ? "subject" : ""}" d="${pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t)},${y(v)}`).join(" ")}"><title>${esc(pname(p))}: ${k1(p.net_worth)}</title></path>`;
  }).join("");
  const objMarks = d.objectives.map((o) => `<line class="obj-line team-${o.team === 2 ? 3 : 2}" x1="${x(o.t)}" x2="${x(o.t)}" y1="6" y2="${H - 16}"><title>${fmtClock(o.t)} ${esc(o.name)} (${o.team === 2 ? "Amber" : "Sapphire"}) destroyed</title></line>`).join("");
  const grid = [0, 600, 1200, 1800, 2400, 3000].filter((t) => t <= maxT)
    .map((t) => `<text class="axis" x="${x(t)}" y="${H - 2}" text-anchor="middle">${t / 60}m</text>`).join("");

  // damage matrix (enemies only), dealer rows by team
  const sorted = [...d.players].sort((a, b) => a.team - b.team || b.net_worth - a.net_worth);
  const maxCell = Math.max(1, ...[...d.matrix.values()]);
  const matrix = `<table class="matrix">
    <tr><th></th>${sorted.map((p) => `<th class="team-${p.team}">${heroImg(p.hero_id, pname(p))}</th>`).join("")}<th>total</th></tr>
    ${sorted.map((a) => {
      let total = 0;
      const cells = sorted.map((b) => {
        if (a.team === b.team) return `<td class="same"></td>`;
        const v = d.matrix.get(`${a.slot}|${b.slot}`) || 0;
        total += v;
        return `<td style="--h:${v / maxCell}" title="${esc(pname(a))} → ${esc(pname(b))}: ${v}">${v ? k1(v) : ""}</td>`;
      }).join("");
      return `<tr class="${a === subject ? "on" : ""}"><th class="team-${a.team}">${heroImg(a.hero_id, pname(a))}</th>${cells}<td class="tot">${k1(total)}</td></tr>`;
    }).join("")}
  </table>`;

  // full scoreboard
  const board = `<table class="report-table board">
    <tr><th></th><th>player</th><th>k/d/a</th><th>souls</th><th>hero dmg</th><th>taken</th><th>healing</th><th>obj dmg</th><th>LH / denies</th><th>gun acc</th><th>MVP</th><th>accolades</th></tr>
    ${sorted.map((p) => {
      const f = p.final;
      return `<tr class="team-row-${p.team} ${p === subject ? "on" : ""}">
        <td>${heroImg(p.hero_id)}</td>
        <td><a href="#/player/${p.account_id}">${esc(pname(p))}</a>${p.abandon ? ` <span class="bad small">left ${fmtClock(p.abandon)}</span>` : ""}</td>
        <td>${p.kills}/${p.deaths}/${p.assists}</td><td>${k1(p.net_worth || 0)}</td>
        <td>${k1(f.player_damage || 0)}</td><td>${k1(f.player_damage_taken || 0)}</td>
        <td>${k1((f.player_healing || 0) + (f.teammate_healing || 0))}</td><td>${k1(f.boss_damage || 0)}</td>
        <td>${p.last_hits} / ${p.denies}</td>
        <td>${f.shots_hit != null ? pct(f.shots_hit / Math.max(1, f.shots_hit + f.shots_missed)) : "–"}</td>
        <td>${p.mvp_rank ? `#${p.mvp_rank}` : ""}</td><td>${p.accolades.length || ""}</td></tr>`;
    }).join("")}
  </table>`;

  // subject detail
  // "Ability" and "Bullets" are Valve's roll-ups of the specific sources; showing both double counts
  const src = [...(d.bySource.get(subject.slot) || new Map())]
    .filter(([n]) => n !== "Ability" && n !== "Bullets")
    .sort((a, b) => b[1] - a[1]).slice(0, 12);
  const srcMax = Math.max(1, ...src.map((s) => s[1]));
  const srcTotal = src.reduce((a, s) => a + s[1], 0) || 1;
  const gold = (subject.final.gold_sources || []).filter((g) => g.gold || g.gold_orbs)
    .map((g) => [GOLD_SOURCES[g.source] || `source ${g.source}`, (g.gold || 0) + (g.gold_orbs || 0)])
    .sort((a, b) => b[1] - a[1]);
  const goldMax = Math.max(1, ...gold.map((g) => g[1]));
  const items = subject.items.filter((it) => S.assets.item(it.item_id)?.type === "upgrade");
  const killer = (slot) => d.bySlot.get(slot);

  el.innerHTML = `
    <h2 class="section-title">Valve match report <span class="muted small">(match metadata, digested in your browser)</span></h2>
    <div class="summary">
      ${teams.map((t) => tile(`${t === 2 ? "Amber" : "Sapphire"}${d.winner === t ? " · won" : ""}`,
        `${objByTeam(t)}<small> objectives · ${d.players.filter((p) => p.team === t).reduce((a, p) => a + p.kills, 0)} kills</small>`, d.winner === t ? "good" : "")).join("")}
      ${tile("Mid boss", d.midBoss.length ? d.midBoss.map((b) => `${fmtClock(b.t)} <small>${b.claimed === 2 ? "Amber" : "Sapphire"}</small>`).join(" ") : "–")}
      ${tile("Avg badge", d.badges.filter(Boolean).map((b) => S.assets.ranks[b]?.name || b).join(" vs ") || "–")}
    </div>
    <div class="chart-card"><h3>Souls over time <span class="muted">· vertical lines: objectives destroyed (colored by the team that took them)</span></h3>
      <svg class="nw-chart" viewBox="0 0 ${W} ${H}">${grid}${objMarks}${lines}</svg>
      <div class="obj-list small">${d.objectives.map((o) => `<span class="team-${o.team === 2 ? 3 : 2}">${fmtClock(o.t)} ${esc(o.name)}</span>`).join("")}</div>
    </div>
    <div class="chart-card"><h3>Scoreboard</h3>${board}</div>
    <div class="charts report-2">
      <div class="chart-card"><h3>Damage matrix <span class="muted">· row = dealer, column = target, whole match</span></h3>${matrix}</div>
      <div class="chart-card"><h3>${heroImg(subject.hero_id)} ${esc(pname(subject))}: hero damage by source</h3>
        ${src.map(([n, v]) => {
          const base = n.replace(/_crit$/, "");
          const icon = S.assets.abilityIcon(base);
          return `<div class="hbar"><span class="lbl">${icon ? `<img src="${esc(icon)}" alt="">` : ""}${esc(sourceLabel(n))}</span>
          <span class="track"><span style="width:${(v / srcMax) * 100}%"></span></span><span class="val">${k1(v)} <small>${pct(v / srcTotal)}</small></span></div>`;
        }).join("") || `<p class="muted">no data</p>`}
      </div>
    </div>
    <div class="charts report-3">
      <div class="chart-card"><h3>Gold sources</h3>
        ${gold.map(([n, v]) => `<div class="hbar"><span class="lbl">${esc(n)}</span><span class="track"><span style="width:${(v / goldMax) * 100}%"></span></span><span class="val">${k1(v)}</span></div>`).join("") || `<p class="muted">no data</p>`}
      </div>
      <div class="chart-card"><h3>Deaths</h3>
        <table class="report-table"><tr><th>time</th><th>killer</th><th>time to kill</th><th>dead for</th></tr>
        ${subject.deathsList.map((x) => {
          const k = killer(x.killer_player_slot);
          return `<tr><td>${fmtClock(x.game_time_s)}</td><td>${k ? `${heroImg(k.hero_id)} ${esc(pname(k))}` : "–"}</td>
            <td>${x.time_to_kill_s != null ? `${x.time_to_kill_s.toFixed(1)} s` : "–"}</td><td>${x.death_duration_s ?? "–"} s</td></tr>`;
        }).join("") || `<tr><td colspan="4" class="muted">no deaths</td></tr>`}</table>
      </div>
      <div class="chart-card"><h3>Accolades & power-ups</h3>
        <div class="tags">${subject.accolades.map((a) => `<span class="tag" title="value ${a.accolade_stat_value}">${esc(S.assets.accolades[a.accolade_id]?.name || `accolade ${a.accolade_id}`)}${a.accolade_threshold_achieved > 1 ? ` ×${a.accolade_threshold_achieved}` : ""}</span>`).join("") || `<span class="muted">none</span>`}</div>
        <div class="tags">${powerups(subject.powerups)}</div>
        <p class="small muted">${subject.pings} pings</p>
      </div>
    </div>
    <div class="chart-card"><h3>Item build</h3>
      <div class="build">${items.map((it) => {
        const a = S.assets.item(it.item_id);
        const icon = S.assets.itemIcon(it.item_id);
        return `<span class="bi ${it.sold_time_s ? "sold" : ""}" title="${esc(a?.name || it.item_id)} · bought ${fmtClock(it.game_time_s)}${it.sold_time_s ? ` · sold ${fmtClock(it.sold_time_s)}` : ""}">
          ${icon ? `<img src="${esc(icon)}" alt="">` : ""}<small>${fmtClock(it.game_time_s)}</small></span>`;
      }).join("") || `<span class="muted">no items</span>`}</div>
    </div>`;
}

/** "spirit_permanent_pickup_lv3" ×2 + "spirit_permanent_pickup_lv2" ×3 → "spirit ×5" */
function powerups(list) {
  const by = new Map();
  for (const b of list) {
    const stat = b.type.split("_")[0];
    const perm = b.is_permanent;
    const key = perm ? stat : `${stat} (temp)`;
    by.set(key, (by.get(key) || 0) + (b.value || 1));
  }
  return [...by].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<span class="tag pu">${esc(k)} ×${n}</span>`).join("") || `<span class="muted">no power-ups</span>`;
}
