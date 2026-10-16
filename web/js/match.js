// Match detail: scoreboard, ability picker, minimap + timeline replay, incoming skillshots.

import {
  loadMatch, loadMeta, prepare, statsAt, hpAt, itemsAt, abilityLevelsAt, modifiersAt, TEAM_NAMES,
} from "./data.js";
import { digestMeta, renderReport, matchFromMeta } from "./report.js";
import {
  analyzeAbility, counts, pct, abilityTable, incoming, AIMED_AT_DEG, GUN, gunStats, gunAt, damageTaken, detectFights, surroundings,
} from "./analysis.js";
import { createTimeline, fmtClock } from "./timeline.js";
import { createMinimap } from "./minimap.js";
import {
  $, esc, S, settings, saveSettings, opts, fmtDate, ago, k1, tile, rankChip, controlsHTML,
  wireControls, abilityButtons, entry, setParams,
} from "./ui.js";

export async function viewMatch(id, params) {
  const app = $("#app");
  app.innerHTML = `<div class="muted pad">loading match ${id}…</div>`;
  const e = entry(id);
  let m;
  try {
    m = await loadMatch(id);
  } catch (err) {
    // no demo: replay from Valve's 1 Hz match paths if the metadata has them
    try {
      const pseudo = matchFromMeta(await loadMeta(id), id);
      if (pseudo) m = prepare(pseudo);
    } catch { /* no metadata either */ }
    if (!m) {
      renderNoDemo(app, id, e);
      return;
    }
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
  const gunMode = wanted === GUN.class_name;
  const gun = gunStats(m, pawn, S.assets);
  const weaponItem = S.assets.itemByClass(S.assets.hero(subject.hero_id).weapon);
  const gunAbility = { ...GUN, image: weaponItem?.image };
  const ability = gunMode ? gunAbility : row?.ability || sigs[0];
  const analysis = gunMode ? { source: "gun", casts: [] } : analyzeAbility(m, pawn, ability, opts());
  const casts = analysis.casts;
  const valve = (S.valveStats?.[id] || {})[subject.account_id];
  const won = e ? e.won : null;
  const d = e ? new Date(e.start_time * 1000) : null;

  function abStat(ab) {
    if (ab.class_name === GUN.class_name) {
      return gun.shots ? `<span class="ab-stat">${gun.heroHits}/${gun.shots}</span>` : `<span class="ab-stat muted">–</span>`;
    }
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
      <a href="#/" class="back">← matches</a>
      <div class="mh-title">
        ${won != null ? `<span class="result ${won ? "win" : "loss"}">${won ? "WIN" : "LOSS"}</span>` : ""}
        <h2>#${id}</h2>
        ${d ? `<span class="muted" title="${esc(d.toString())}">${fmtDate(d)} · ${ago(d)}</span>` : ""}
        <span class="muted">${fmtClock(m.end)}</span>
        ${rankChip(e)}
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
            return `<div class="sb-row ${p.pawn === pawn ? "on" : ""}" data-pawn="${p.pawn}" role="button" tabindex="0" title="analyze ${esc(p.name)}">
              <img class="sb-hero" src="${esc(S.assets.hero(p.hero_id).icon)}" alt="">
              ${prof?.avatar ? `<img class="sb-av" src="${esc(prof.avatar)}" alt="">` : `<span class="sb-av"></span>`}
              <a class="sb-name" href="#/player/${p.account_id}" title="${esc(prof?.name || p.name || "")}: all matches">${esc(prof?.name || p.name || S.assets.hero(p.hero_id).name)}</a>
              <span class="sb-kda">${p.kills}/${p.deaths}/${p.assists}</span>
              ${(() => { const a = skillAcc.get(p.pawn); const v = a.thrown ? a.scored / a.thrown : 0;
                return `<span class="sb-acc ${a.thrown >= 5 && v === bestAcc ? "best" : ""}" title="signature abilities: ${a.scored}/${a.thrown} hit heroes">${a.thrown ? pct(v) : "–"}</span>`; })()}
              <span class="sb-nw">${k1(p.net_worth)}</span>
            </div>`;
          }).join("")}
        </div>`).join("")}
    </section>
    ${m.fromMeta ? `<p class="note">No demo for this match (${esc(e?.status || "not downloaded")}). This replay uses Valve's match paths:
      positions and health once per second, deaths and objectives. Casts, shots and hits need the demo
      (Deadlock: <b>Download Replay</b>).</p>` : ""}
    <section class="toolbar" ${m.fromMeta ? "hidden" : ""}>
      <div class="abilities">${abilityButtons([gunAbility, ...table.filter((r) => !r.kind).map((r) => r.ability)], ability.class_name, abStat)}</div>
      <div class="controls">${controlsHTML()}</div>
    </section>
    ${!m.fromMeta && table.some((r) => r.kind === "extra") ? `<section class="items-row"><span class="muted small">other abilities</span>
      <div class="abilities small-abs">${abilityButtons(table.filter((r) => r.kind === "extra").map((r) => r.ability), ability.class_name, abStat)}</div></section>` : ""}
    ${!m.fromMeta && table.some((r) => r.item) ? `<section class="items-row"><span class="muted small">active items</span>
      <div class="abilities small-abs">${abilityButtons(table.filter((r) => r.item).map((r) => r.ability), ability.class_name, abStat)}</div></section>` : ""}
    ${!m.fromMeta && analysis.source === "cooldown" ? `<p class="note">No cast events for ${esc(ability.name)} in this demo; casts are taken from the ability going on cooldown, so there is no aim direction or aim error.</p>` : ""}
    ${e?.warnings?.length ? `<p class="note warn">Parser warnings for this demo: ${e.warnings.map(esc).join(" · ")}</p>` : ""}
    ${!m.fromMeta && analysis.source === "none" ? `<p class="note">No casts of ${esc(ability.name)} found for this player.</p>` : ""}
    <section class="stage">
      <div class="map-wrap"><canvas class="minimap"></canvas>
        <div class="map-legend small muted">
          <label class="check"><input type="checkbox" class="show-all" ${settings.showAll ? "checked" : ""}> all casts</label>
          <span>click a hero to analyze them · rays = aim at cast</span>
        </div>
        <div class="state" id="state"></div></div>
      <div class="stage-right">
        <svg class="timeline"></svg>
        <div class="player-row">
          <button class="play" title="play / pause (space)">▶</button>
          <select class="speed" title="playback speed">
            ${[1, 4, 10, 30, 60, 120].map((s) => `<option value="${s}" ${s === settings.speed ? "selected" : ""}>${s}×</option>`).join("")}
          </select>
          <input type="range" class="scrub" min="0" max="${Math.ceil(m.end)}" step="0.5">
          <span class="clock">0:00</span>
          <span class="span-info"></span>
          <button class="btn csv" title="download casts as CSV">CSV</button>
          <button class="btn demo-cmd" title="copy a Deadlock console command that jumps the real replay to this moment">in-game ↗</button>
        </div>
        <div class="fights"></div>
        <div class="readout">
          <div class="tiles"></div>
          <div class="feed-wrap">
            <div class="feed-filter">
              ${["all", "hit", "miss", "kills"].map((f) => `<button class="chip ${settings.feed === f ? "on" : ""}" data-feed="${f}">${f}</button>`).join("")}
            </div>
            <ol class="feed"></ol>
          </div>
        </div>
        <p class="demo-hint small muted"></p>
        <p class="keys small muted">space play · ←/→ 5 s · shift ±30 s · , . previous/next cast · home/end · wheel on timeline zooms ·
          <b>shift+drag</b> on the timeline (or <b>[</b> at the playhead) selects a span, Esc clears</p>
      </div>
    </section>
    <section class="chart-card laning" id="laning"></section>
    <section class="chart-card tracker" id="tracker" ${m.fromMeta ? "hidden" : ""}></section>
    <section class="chart-card incoming" id="incoming" ${m.fromMeta ? "hidden" : ""}></section>
    <section class="report" id="report"><p class="muted">loading Valve match report…</p></section>`;
  showReport($("#report", app), id, subject.account_id);

  // wiring
  for (const b of app.querySelectorAll(".sb-row")) {
    b.addEventListener("click", (ev) => {
      if (ev.target.closest("a")) return; // name links to the player page
      setParams({ pawn: b.dataset.pawn, ability: null });
    });
    b.addEventListener("keydown", (ev) => { if (ev.key === "Enter") b.click(); });
  }
  for (const b of app.querySelectorAll(".abilities .ab")) {
    b.addEventListener("click", () => setParams({ ability: b.dataset.ability }));
  }
  wireControls(app, () => viewMatch(id, params));

  // accuracy tracker: every player's skill + gun accuracy up to the scrub time
  const tracked = m.players.map((p) => {
    const skill = [];
    for (const ab of S.assets.signatures(p.hero_id)) {
      const cs = analyzeAbility(m, p.pawn, ab, opts()).casts;
      if (!cs.some((c) => c.result !== "miss")) continue; // never connects: buff / passive
      skill.push(...cs);
    }
    skill.sort((a, b) => a.t - b.t);
    return { p, skill, gun: gunStats(m, p.pawn, S.assets) };
  });
  // ---- player state at the playhead: health, souls, ability tiers, items, buffs
  const HIDDEN_MODS = /tracker|watcher|hero_upgrade_bonuses|combat_status|_aura_target|modifier_citadel_base/;
  function modName(x) {
    const raw = S.assets.modifiers[x[4]];
    const ab = S.assets.item(x[5]);
    if (raw && HIDDEN_MODS.test(raw)) return null;
    if (ab) return ab.name;
    if (raw) return raw.replace(/^modifier_(citadel_)?/, "").replace(/_/g, " ");
    return null; // unnamed internal modifier
  }
  function renderState(t) {
    const hp = hpAt(m, pawn, t);
    const st = statsAt(m, pawn, t);
    const heroName = S.assets.hero(subject.hero_id).name;
    const lv = abilityLevelsAt(m, pawn, t);
    const abil = S.assets.signatures(subject.hero_id).map((ab) => {
      const n = lv.get(ab.id) ?? 0;
      const tier = Math.max(0, n - 1);
      return `<span class="st-ab ${n ? "" : "locked"}" title="${esc(ab.name)}${n ? ` · upgrades ${tier}/3` : " · not unlocked"}">
        ${ab.image ? `<img src="${esc(ab.image)}" alt="">` : ""}<span class="pips">${[1, 2, 3].map((i) => `<i class="${i <= tier ? "on" : ""}"></i>`).join("")}</span></span>`;
    }).join("");
    const slotOrder = { weapon: 0, vitality: 1, spirit: 2 };
    const items = itemsAt(m, pawn, t).map((id) => ({ id, ...S.assets.item(id) }))
      .filter((it) => it.type === "upgrade")
      .sort((a, b) => (slotOrder[a.slot] ?? 3) - (slotOrder[b.slot] ?? 3) || (a.tier || 0) - (b.tier || 0));
    const mods = [];
    const seen = new Map();
    for (const x of modifiersAt(m, pawn, t)) {
      const name = modName(x);
      if (!name) continue;
      const key = `${name}|${x[3]}`;
      const enemy = x[3] >= 0 && m.byPawn.get(x[3])?.team !== subject.team;
      const left = x[1] - t;
      const prev = seen.get(key);
      if (prev) { prev.n++; prev.left = Math.max(prev.left, left); continue; }
      const row = { name, enemy, left, n: 1, stacks: x[6], icon: S.assets.itemIcon(x[5]) };
      seen.set(key, row);
      mods.push(row);
    }
    mods.sort((a, b) => b.enemy - a.enemy || a.left - b.left);
    const f = hp && hp.max ? hp.hp / hp.max : 0;
    // dead at the playhead: recap of the last death
    let recap = "";
    const death = [...m.kills].reverse().find((k) => k[1] === pawn && k[0] <= t);
    if (death && hp && hp.hp <= 0 && t - death[0] < 120 && !m.fromMeta) {
      const dt = damageTaken(m, pawn, death[0]);
      const killer = m.byPawn.get(death[2]);
      recap = `<div class="recap"><b>Killed ${killer ? `by <img src="${esc(S.assets.hero(killer.hero_id).icon)}" alt=""> ${esc(S.profiles[killer.account_id]?.name || killer.name)}` : ""}</b>
        <span class="muted small"> at ${fmtClock(death[0])} · ${k1(dt.total)} hero damage in the last 10 s</span>
        ${(() => {
          const sr = surroundings(m, pawn, death[0] - 1.5);
          if (!sr) return "";
          const iso = sr.ally == null || sr.ally > 30;
          return `<div class="small ${iso ? "bad" : "muted"}">${sr.ally != null ? `nearest ally ${Math.round(sr.ally)} m` : "no ally alive"} · ${sr.enemies} enem${sr.enemies === 1 ? "y" : "ies"} within 30 m${iso ? " · isolated" : ""}</div>`;
        })()}
        ${dt.rows.slice(0, 8).map((r) => {
          const a = m.byPawn.get(r.attacker);
          const ab = S.assets.item(r.ability);
          return `<div class="hbar"><span class="lbl">${a ? `<img src="${esc(S.assets.hero(a.hero_id).icon)}" alt="">` : ""}${ab?.image ? `<img src="${esc(ab.image)}" alt="">` : ""}${esc(ab?.name || "?")}</span>
            <span class="track"><span style="width:${(r.dmg / Math.max(1, dt.total)) * 100}%;background:var(--miss)"></span></span><span class="val">${r.dmg} <small>×${r.hits}</small></span></div>`;
        }).join("")}</div>`;
    }
    $("#state", app).innerHTML = recap + `
      <div class="st-head">
        <img src="${esc(S.assets.hero(subject.hero_id).icon)}" alt="">
        <div class="st-hp"><div class="st-bar"><span style="width:${f * 100}%;background:${f > 0.5 ? "var(--hit)" : f > 0.25 ? "var(--accent)" : "var(--miss)"}"></span></div>
          <small>${hp ? (hp.hp > 0 ? `${hp.hp} / ${hp.max} HP` : "dead") : "–"}${m.fromMeta ? " (%)" : ""}</small></div>
        <div class="st-num"><b>${st ? k1(st[0]) : "–"}</b><small>souls</small></div>
        <div class="st-num"><b>${st ? st[1] : "–"}</b><small>level</small></div>
      </div>
      ${m.fromMeta ? "" : `<div class="st-abs">${abil}</div>`}
      <div class="st-items">${items.map((it) => `<img class="slot-${esc(it.slot || "x")}" src="${esc(S.assets.itemIcon(it.id))}" title="${esc(it.name)}${it.tier ? ` · tier ${it.tier}` : ""}" alt="">`).join("") || `<span class="muted small">no items yet</span>`}</div>
      ${m.fromMeta ? "" : `<div class="st-mods">${mods.map((x) => `<span class="mod ${x.enemy ? "debuff" : ""}" title="${esc(x.name)}${x.enemy ? " (from enemy)" : ""}${x.left < 9999 ? ` · ${x.left.toFixed(1)} s left` : ""}">
        ${x.icon ? `<img src="${esc(x.icon)}" alt="">` : ""}<span>${esc(x.name)}</span>${x.stacks > 1 ? `<b>×${x.stacks}</b>` : x.n > 1 ? `<b>×${x.n}</b>` : ""}${x.left < 600 ? `<small>${x.left.toFixed(0)}s</small>` : ""}</span>`).join("") || `<span class="muted small">no buffs or debuffs</span>`}</div>`}`;
  }

  /** [souls, level, k, d, a, lh] at t, or gained inside the span (level stays absolute) */
  function spanStats() {
    const end = statsAt(m, pawn, t);
    if (!end || t0 == null) return end;
    const start = statsAt(m, pawn, t0) || [0, 0, 0, 0, 0, 0];
    return end.map((v, i) => (i === 1 ? v : v - start[i]));
  }
  /** gun totals inside the current span */
  function spanGun(g) {
    const end = gunAt(g, t);
    if (t0 == null) return end;
    const start = gunAt(g, t0 - 0.001);
    return { shots: end.shots - start.shots, hits: end.hits - start.hits, hs: end.hs - start.hs, npc: end.npc - start.npc };
  }
  function renderTracker(t) {
    const rows = tracked.map(({ p, skill, gun: g }) => {
      let thrown = 0, hit = 0;
      for (const c of skill) {
        if (c.t > t) break;
        if (t0 != null && c.t < t0) continue;
        thrown++;
        if (c.result === "hit" || (!settings.heroesOnly && c.result === "other")) hit++;
      }
      const ga = spanGun(g);
      return { p, thrown, hit, sAcc: thrown ? hit / thrown : null, ...ga, gAcc: ga.shots ? ga.hits / ga.shots : null };
    });
    const best = (k) => Math.max(...rows.filter((r) => (k === "sAcc" ? r.thrown >= 5 : r.shots >= 20)).map((r) => r[k] ?? 0));
    const bS = best("sAcc"), bG = best("gAcc");
    const cell = (v, n, d, isBest) => v == null ? `<td class="muted">–</td>`
      : `<td class="${isBest ? "best" : ""}"><span class="acc-bar"><span style="width:${v * 100}%"></span></span>${pct(v)} <small class="muted">${n}/${d}</small></td>`;
    const teams = [...new Set(rows.map((r) => r.p.team))].sort();
    $("#tracker", app).innerHTML = `
      <h3>Accuracy tracker · ${t0 != null ? `${fmtClock(t0)}–${fmtClock(t)}` : `at ${fmtClock(t)}`} <span class="muted">· signature skills that connect + gun, every player</span></h3>
      <table class="report-table tracker-table">
        <tr><th></th><th>player</th><th>HP</th><th>souls</th><th>skills thrown</th><th>skill hit %</th><th>shots</th><th>gun hit %</th><th>HS %</th><th>items</th></tr>
        ${teams.map((tm) => rows.filter((r) => r.p.team === tm).map((r) => `
          <tr class="team-row-${tm} ${r.p.pawn === pawn ? "on" : ""}" data-pawn="${r.p.pawn}">
            <td><img src="${esc(S.assets.hero(r.p.hero_id).icon)}" alt=""></td>
            <td><a href="#/player/${r.p.account_id}">${esc(S.profiles[r.p.account_id]?.name || r.p.name)}</a></td>
            <td>${(() => {
              const h = hpAt(m, r.p.pawn, t);
              if (!h) return "–";
              if (h.hp <= 0) return `<span class="bad small">dead</span>`;
              const f = h.max ? h.hp / h.max : 0;
              return `<span class="mini-hp" title="${h.hp} / ${h.max}"><span style="width:${f * 100}%"></span></span>`;
            })()}</td>
            <td>${(() => { const st = statsAt(m, r.p.pawn, t); return st ? k1(st[0]) : "–"; })()}</td>
            <td>${r.thrown}</td>
            ${cell(r.sAcc, r.hit, r.thrown, r.thrown >= 5 && r.sAcc === bS)}
            <td>${r.shots}</td>
            ${cell(r.gAcc, r.hits, r.shots, r.shots >= 20 && r.gAcc === bG)}
            <td>${r.hits ? `${pct(r.hs / r.hits)} <small class="muted">${r.hs}</small>` : "–"}</td>
            <td class="tr-items">${itemsAt(m, r.p.pawn, t).filter((id) => S.assets.item(id)?.type === "upgrade")
              .map((id) => `<img class="slot-${esc(S.assets.item(id)?.slot || "x")}" src="${esc(S.assets.itemIcon(id))}" title="${esc(S.assets.item(id)?.name)}" alt="">`).join("")}</td>
          </tr>`).join("")).join("")}
      </table>`;
  }
  $("#tracker", app).addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr[data-pawn]");
    if (tr) setParams({ pawn: tr.dataset.pawn });
  });

  // laning phase: the subject's lane at 10:00 (souls, last hits, K/D/A), souls curve 0-10 min
  (() => {
    const el = $("#laning", app);
    const LANE_END = 600;
    const lane = m.players.filter((p) => p.lane && p.lane === subject.lane);
    if (lane.length < 2 || m.fromMeta) { el.hidden = true; return; }
    const at = (p, t) => statsAt(m, p.pawn, t) || [0, 0, 0, 0, 0, 0];
    const mine = lane.filter((p) => p.team === subject.team), theirs = lane.filter((p) => p.team !== subject.team);
    const sumNw = (ps, t) => ps.reduce((a, p) => a + at(p, t)[0], 0);
    const diff = sumNw(mine, LANE_END) - sumNw(theirs, LANE_END);
    // souls curve
    const W = 420, H = 120, steps = 20;
    const maxNw = Math.max(1, ...lane.map((p) => at(p, LANE_END)[0]));
    const x = (t) => 6 + (t / LANE_END) * (W - 12), y = (v) => H - 6 - (v / maxNw) * (H - 12);
    const lines = lane.map((p) => {
      let d = "";
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * LANE_END;
        d += `${i ? "L" : "M"}${x(t)},${y(at(p, t)[0])} `;
      }
      return `<path class="nw-line team-${p.team} ${p.pawn === pawn ? "subject" : ""}" d="${d}"><title>${esc(S.profiles[p.account_id]?.name || p.name)}</title></path>`;
    }).join("");
    el.innerHTML = `
      <h3>Laning · first 10 minutes <span class="muted">· lane ${subject.lane}</span></h3>
      <div class="laning-grid">
        <div>
          <div class="summary">${tile("Lane souls diff @10", `${diff >= 0 ? "+" : ""}${k1(diff)}`, diff >= 0 ? "good" : "")}
            ${tile("Lane kills @10", `${mine.reduce((a, p) => a + at(p, LANE_END)[2], 0)}–${theirs.reduce((a, p) => a + at(p, LANE_END)[2], 0)}`)}</div>
          <table class="report-table">
            <tr><th></th><th>player</th><th>souls @10</th><th>last hits</th><th>k/d/a</th></tr>
            ${[...mine, ...theirs].map((p) => {
              const st = at(p, LANE_END);
              return `<tr class="team-row-${p.team} ${p.pawn === pawn ? "on" : ""}"><td><img src="${esc(S.assets.hero(p.hero_id).icon)}" alt=""></td>
                <td>${esc(S.profiles[p.account_id]?.name || p.name)}</td><td>${k1(st[0])}</td><td>${st[5]}</td><td>${st[2]}/${st[3]}/${st[4]}</td></tr>`;
            }).join("")}
          </table>
        </div>
        <svg class="lane-chart" viewBox="0 0 ${W} ${H}">${lines}</svg>
      </div>`;
  })();

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

  const timeline = createTimeline($(".timeline", app), {
    end: m.end, casts, heroesOnly: settings.heroesOnly, lead, deaths, kills,
    gun: gunMode ? gun : null, noChart: !!m.fromMeta,
  }, (t) => seek(t), (a, b) => setSpan(a, b));
  const minimap = createMinimap($(".minimap", app), {
    match: m, assets: S.assets, profiles: S.profiles, onPick: (p) => setParams({ pawn: p.pawn, ability: null }),
  });

  let t = Number(params.get("t")) || m.end;
  // optional span start: stats then cover [t0, t] instead of [start, t]
  let t0 = params.has("from") ? Number(params.get("from")) : null;
  const inSpan = (tt) => tt <= t && (t0 == null || tt >= t0);
  function setSpan(a, b) {
    t0 = b - a < 1 ? null : a;
    seek(b);
  }
  let urlTimer = null;
  function syncUrl() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      const [path, q] = location.hash.slice(1).split("?");
      const p = new URLSearchParams(q || "");
      p.set("t", Math.round(t));
      if (t0 != null) p.set("from", Math.round(t0)); else p.delete("from");
      history.replaceState(null, "", `#${path}?${p}`);
    }, 300);
  }
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
    const rows = gunMode
      ? [["time_s", "clock", "event", "count", "victim"]].concat(gun.events.map((ev) =>
        [ev.t.toFixed(2), fmtClock(ev.t), ev.kind, ev.n, ev.victim != null ? name(ev.victim) : ""]))
      : [["time_s", "clock", "result", "damage", "delay_s", "range_m", "victims", "x", "y", "yaw"]];
    for (const c of gunMode ? [] : casts) {
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

  const demoTick = (tt) => Math.max(0, Math.round(tt / m.tick_interval + (m.demo_tick_offset || 0)));
  $(".demo-cmd", app).hidden = !m.demo_tick_offset;
  $(".demo-cmd", app).addEventListener("click", async () => {
    const cmd = `demo_gototick ${demoTick(t - 3)}`;
    try { await navigator.clipboard.writeText(cmd); } catch { /* insecure context */ }
    $(".demo-hint", app).innerHTML = `Deadlock console: <code>playdemo replays/${id}</code> then <code>${cmd}</code> (copied)`;
  });

  // fights: click one to make it the span
  const fights = detectFights(m).filter((f) => f.kills.length >= 2);
  $(".fights", app).innerHTML = fights.length ? `<span class="muted small">fights</span>` + fights.map((f, i) => {
    const mine = f.kills.some((k) => k[1] === pawn || k[2] === pawn || (k[4] || []).includes(pawn));
    const won = f.byTeam[subject.team] > f.byTeam[subject.team === 2 ? 3 : 2];
    const lost = f.byTeam[subject.team] < f.byTeam[subject.team === 2 ? 3 : 2];
    return `<button class="fight ${won ? "won" : lost ? "lost" : ""} ${mine ? "mine" : ""}" data-fight="${i}"
      title="${fmtClock(f.t0)}–${fmtClock(f.t1)} · ${f.kills.length} kills${mine ? " · you were involved" : ""}">
      ${fmtClock(f.t0)} <b>${f.byTeam[subject.team]}–${f.byTeam[subject.team === 2 ? 3 : 2]}</b></button>`;
  }).join("") : "";
  $(".fights", app).addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-fight]");
    if (!b) return;
    const f = fights[Number(b.dataset.fight)];
    setSpan(Math.max(0, f.t0 - 10), Math.min(m.end, f.t1 + 3));
  });

  function seek(nt) {
    t = Math.max(Math.min(nt, m.end), Math.min(0, m.samples.t0));
    scrub.value = t;
    $(".clock", app).textContent = fmtClock(t);
    if (t0 != null && t0 >= t) t0 = null;
    timeline.setTime(t, t0);
    $(".span-info", app).innerHTML = t0 != null
      ? `span ${fmtClock(t0)}–${fmtClock(t)} <button class="chip span-clear" title="clear span (Esc)">×</button>` : "";
    syncUrl();
    minimap.update({ t, subject: pawn, casts, showAll: settings.showAll });
    renderReadout(t);
    renderTracker(t);
    renderState(t);
  }

  function renderGunReadout(t) {
    const g = spanGun(gun);
    const pellets = gun.shots ? gun.bullets / gun.shots : 1;
    const st = spanStats();
    const vAcc = valve?.hero_shots ? valve.hero_hits / valve.hero_shots : null;
    $(".tiles", app).innerHTML =
      tile("Shots fired", g.shots) +
      tile("Bullets", Math.round(g.shots * pellets) + (pellets > 1 ? `<small> ×${pellets.toFixed(0)}</small>` : "")) +
      tile("Shots hit heroes", g.hits, "good") +
      tile("Hit rate", g.shots ? pct(g.hits / g.shots) : "–", "accent") +
      tile("Headshots", g.hs) +
      tile("Headshot %", g.hits ? pct(g.hs / g.hits) : "–") +
      tile("Trooper/NPC hits", g.npc) +
      tile("K / D / A", st ? `${st[2]}/${st[3]}/${st[4]}` : "–") +
      tile("Souls", st ? k1(st[0]) : "–") +
      (valve ? tile("Valve: hero accuracy", vAcc != null ? `${pct(vAcc)}<small> ${valve.hero_hits}/${valve.hero_shots}</small>` : "–") +
        tile("Valve: headshots", valve.hero_headshots ?? "–") +
        tile("Valve: bullets hit", valve.shots_hit != null ? `${valve.shots_hit}<small> / ${valve.shots_hit + valve.shots_missed}</small>` : "–") : "");
    const f = settings.feed || "all";
    const evs = [];
    for (const ev of gun.events) {
      if (ev.t > t) break;
      if (t0 != null && ev.t < t0) continue;
      if (ev.kind === "hit" || ev.kind === "hs") {
        if (f === "miss" || f === "kills") continue;
        evs.push(ev);
      }
    }
    $(".feed", app).innerHTML = evs.slice(-40).reverse().map((ev) => {
      const p = m.byPawn.get(ev.victim);
      return `<li data-t="${ev.t}"><span class="dot ${ev.kind === "hs" ? "other" : "hit"}"></span><span class="t">${fmtClock(ev.t)}</span>
        ${p ? `<img src="${esc(S.assets.hero(p.hero_id).icon)}" title="${esc(p.name)}">` : ""}<span>${ev.kind === "hs" ? "<b>headshot</b>" : "hit"}</span></li>`;
    }).join("") || `<li class="muted">no hero hits yet</li>`;
  }

  function renderReadout(t) {
    if (gunMode) { renderGunReadout(t); return; }
    if (m.fromMeta) {
      const st = spanStats();
      $(".tiles", app).innerHTML = tile("K / D / A", st ? `${st[2]}/${st[3]}/${st[4]}` : "–") +
        tile("Souls", st ? k1(st[0]) : "–") + tile("Level", st ? st[1] : "–") +
        tile("Last hits", st ? st[5] : "–");
    }
    const past = casts.filter((c) => inSpan(c.t));
    const c = counts(past, settings.heroesOnly);
    const st = spanStats();
    if (!m.fromMeta) $(".tiles", app).innerHTML =
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
      tile("Ready → recast", c.idle != null ? `${c.idle.toFixed(1)}<small> s</small>` : "–");

    const f = settings.feed || "all";
    const events = [];
    for (const k of past) {
      if (f === "kills" || (f === "hit" && k.result === "miss") || (f === "miss" && k.result !== "miss")) continue;
      events.push({ t: k.t, kind: "cast", k });
    }
    for (const k of m.kills) {
      if (!inSpan(k[0]) || f === "hit" || f === "miss") continue;
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
  for (const b of app.querySelectorAll("[data-feed]")) {
    b.addEventListener("click", () => {
      settings.feed = b.dataset.feed;
      saveSettings();
      for (const o of app.querySelectorAll("[data-feed]")) o.classList.toggle("on", o === b);
      renderReadout(t);
    });
  }
  $(".span-info", app).addEventListener("click", (ev) => {
    if (ev.target.closest(".span-clear")) { t0 = null; seek(t); }
  });
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
    else if (ev.key === "[") { t0 = t; seek(t); }
    else if (ev.key === "]") { if (t0 != null) seek(t); }
    else if (ev.key === "Escape") { t0 = null; seek(t); }
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

/** Valve metadata report (independent of the demo) */
function showReport(el, id, account) {
  loadMeta(id)
    .then((raw) => { if (el.isConnected) renderReport(el, digestMeta(raw), account); })
    .catch(() => {
      if (el.isConnected) el.innerHTML = `<p class="note">No Valve match metadata for this match (deadlock-api doesn't have it, or sync hasn't fetched it yet).</p>`;
    });
}

function renderNoDemo(app, id, e) {
  const c = (S.career || []).find((r) => r.match_id === id);
  const d = e ? new Date(e.start_time * 1000) : null;
  const hero = S.assets.hero(e?.hero_id ?? c?.hero_id);
  const mins = (c?.duration_s || e?.duration_s || 60) / 60;
  app.innerHTML = `
    <div class="match-header">
      <a href="#/" class="back">← matches</a>
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
    </div>` : ""}
    <section class="report" id="report"><p class="muted">loading Valve match report…</p></section>`;
  showReport($("#report", app), id, S.index?.account_id);
}
