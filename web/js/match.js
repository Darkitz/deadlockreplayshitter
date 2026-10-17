// Match detail: scoreboard, ability picker, minimap + timeline replay, incoming skillshots.

import {
  loadMatch, statsAt, posAt, hpAt, itemsAt, abilityLevelsAt, modifiersAt, TEAM_NAMES,
} from "./data.js";
import {
  analyzeAbility, counts, pct, abilityTable, incoming, AIMED_AT_DEG, GUN, gunStats, gunAt, damageTaken, detectFights, surroundings, MELEE, MELEE_LIGHT, MELEE_HEAVY, MELEE_REACH_M, meleeStats, meleeModel, timeSplit,
} from "./analysis.js";
import { createTimeline, fmtClock } from "./timeline.js";
import { createMinimap } from "./minimap.js";
import { renderSummary, teamLogo } from "./postgame.js";
import {
  $, esc, S, settings, saveSettings, opts, k1, tile, controlsHTML,
  wireControls, abilityButtons, setParams,
} from "./ui.js";

export async function viewMatch(id, params) {
  const app = $("#app");
  app.innerHTML = `<div class="muted pad">loading match ${id}…</div>`;
  const m = await loadMatch(id);
  if (!m) {
    app.innerHTML = `<div class="empty"><b>Match ${id} isn't in this browser.</b><br>
      Demos stay in the browser they were dropped into. Drop the demo again to open it.
      <p><button class="btn primary" data-pick>open demo</button> <a href="#/">← home</a></p></div>`;
    $("[data-pick]", app).onclick = () => S.pickDemo?.();
    return;
  }
  const info = (S.localMatches || []).find((x) => x.match_id === id);
  // nobody is selected until the viewer picks a player (scoreboard, map or tables): the match
  // overview stays neutral, the per-player parts appear once someone is picked
  const subject = m.byPawn.get(Number(params.get("pawn"))) || null;
  const pawn = subject?.pawn ?? null;
  const sigs = subject ? S.assets.signatures(subject.hero_id) : [];
  // the hero's own melee ability rows are replaced by the light / heavy melee pseudo-abilities
  const isMeleeAb = (c) => /ability_melee_(?!parry)|hold_melee/.test(c || "");
  const fullTable = subject ? abilityTable(m, pawn, S.assets, opts()) : [];
  const table = fullTable.filter((r) => !isMeleeAb(r.ability.class_name));
  const wanted = params.get("ability");
  const row = table.find((r) => r.ability.class_name === wanted) || table.find((r) => r.thrown) || table[0];
  const gunMode = !!subject && wanted === GUN.class_name;
  const MELEES = [MELEE_LIGHT, MELEE_HEAVY];
  const meleeMode = !!subject && (wanted === MELEE.class_name || MELEES.some((x) => x.class_name === wanted));
  const meleeKind = MELEES.find((x) => x.class_name === wanted)?.melee ?? null;
  const meleeAll = subject ? meleeStats(m, pawn) : null;
  const melee = subject ? meleeModel(meleeAll, meleeKind) : null;
  const heroWeapon = subject ? S.assets.hero(subject.hero_id).weapon : null;
  const meleeItem = fullTable.find((r) => isMeleeAb(r.ability.class_name) && r.ability.image)?.ability
    || S.assets.itemByClass(heroWeapon?.replace("citadel_weapon_", "ability_melee_").replace(/_set\d*$/, ""));
  const gun = subject ? gunStats(m, pawn, S.assets) : null;
  const weaponItem = S.assets.itemByClass(heroWeapon);
  const gunAbility = { ...GUN, image: weaponItem?.image };
  const meleeAbilities = MELEES.map((x) => ({ ...x, image: meleeItem?.image }));
  const meleeAbility = meleeAbilities.find((x) => x.melee === meleeKind) || { ...MELEE, image: meleeItem?.image };
  const ability = !subject ? null : gunMode ? gunAbility : meleeMode ? meleeAbility : row?.ability || sigs[0];
  const analysis = !subject ? { source: "nobody", casts: [] }
    : gunMode || meleeMode ? { source: gunMode ? "gun" : "melee", casts: [] } : analyzeAbility(m, pawn, ability, opts());
  const casts = analysis.casts;
  const won = subject && m.winning_team ? m.winning_team === subject.team : null;

  function abStat(ab) {
    if (ab.melee) {
      const k = meleeAll[ab.melee];
      return k.n ? `<span class="ab-stat" title="hero hits / hero melees (enemy hero within ${MELEE_REACH_M} m) · ${k.n} swings">${k.hero}/${k.near}</span>`
        : `<span class="ab-stat muted">–</span>`;
    }
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

  // cast heatmap sources: every ability / active item cast in the match, with positions.
  // ImportantAbilityUsed casts carry the caster's position; abilities that only show up as
  // cooldown starts use the caster's position at that moment.
  const castSources = new Map();
  for (const c of m.casts) {
    const e = castSources.get(c[2]) || { cls: c[2], pts: [] };
    e.pts.push([c[0], c[3], c[4], c[1]]);
    castSources.set(c[2], e);
  }
  for (const u of m.uses) {
    const cls = S.assets.item(u[2])?.class_name;
    if (!cls || (castSources.has(cls) && !castSources.get(cls).fromUses)) continue;
    const p = posAt(m, u[1], u[0]);
    if (!p) continue;
    const e = castSources.get(cls) || { cls, pts: [], fromUses: true };
    e.pts.push([u[0], p[0], p[1], u[1]]);
    castSources.set(cls, e);
  }
  const heatChoices = [...castSources.values()].map((e) => {
    const it = S.assets.itemByClass(e.cls);
    const casters = new Set(e.pts.map((x) => x[3]));
    const heroes = [...new Set([...casters].map((pw) => S.assets.hero(m.byPawn.get(pw)?.hero_id).name))];
    const kind = it?.type === "upgrade" ? "item" : heroes.length === 1 ? heroes[0] : "ability";
    return { ...e, name: it?.name || e.cls, kind };
  }).filter((e) => e.name !== e.cls || !/^upgrade_|_trigger$/.test(e.cls))
    .sort((a, b) => (a.kind === "item") - (b.kind === "item") || a.kind.localeCompare(b.kind) || b.pts.length - a.pts.length);
  if (params.has("castheat")) settings.castHeat = params.get("castheat");

  // Summary (post-game screen) by default; Replay & analysis once a player is picked
  const view = ["summary", "replay"].includes(params.get("view")) ? params.get("view") : subject ? "replay" : "summary";

  // the long per-match sections live in tabs under the replay
  const chatLines = chatLog(m);
  const TABS = [
    ["tracker", "Players"],
    ["incoming", "Incoming"],
    ["time", "Time split"],
    ["laning", "Laning"],
    ["chat", `Chat <small>${chatLines.filter((l) => l.kind === "chat").length}</small>`],
  ];
  let tab = [params.get("tab"), params.get("section"), settings.matchTab].find((x) => TABS.some(([id]) => id === x)) || "tracker";

  app.innerHTML = `
    <div class="match-header">
      <a href="#/" class="back">← home</a>
      <div class="mh-title">
        ${won != null ? `<span class="result ${won ? "win" : "loss"}" title="for ${esc(subject.name)}">${won ? "WIN" : "LOSS"}</span>`
          : m.winning_team ? `<span class="result team-won team-${m.winning_team}">${TEAM_NAMES[m.winning_team]} won</span>` : ""}
        <h2>#${id}</h2>
        <span class="muted">${fmtClock(m.end)}</span>
        ${info ? `<span class="muted small" title="dropped ${esc(new Date(info.parsed_at).toString())}">${esc(info.file)}</span>` : ""}
        ${id < 900000000000 ? `<a class="muted small" target="_blank" rel="noopener" href="https://statlocker.gg/match/${id}">statlocker ↗</a>` : `<span class="chip-s" title="file name has no match id">dropped demo</span>`}
      </div>
    </div>
    <nav class="view-switch" role="tablist">
      <button class="tab ${view === "summary" ? "on" : ""}" data-view="summary">Summary</button>
      <button class="tab ${view === "replay" ? "on" : ""}" data-view="replay">Replay &amp; analysis</button>
    </nav>
    <section id="summary" class="pg" ${view === "summary" ? "" : "hidden"}></section>
    <div id="replay-view" ${view === "replay" ? "" : "hidden"}>
    <section class="scoreboard">
      ${teams.map((t) => `
        <div class="team team-${t}">
          <h3>${teamLogo(t, "pg-logo-sm")}${m.winning_team === t ? `<span class="sb-won">Victorious</span>` : ""}${subject?.team === t ? `<span class="sb-yours">${esc(subject.name)}'s team</span>` : ""}</h3>
          <div class="team-head"><span></span><span>player</span><span style="text-align:right">k/d/a</span><span style="text-align:right">skill%</span><span style="text-align:right">souls</span></div>
          ${teamOf(t).map((p) => {
            return `<div class="sb-row ${p.pawn === pawn ? "on" : ""}" data-pawn="${p.pawn}" role="button" tabindex="0" title="${p.pawn === pawn ? "deselect" : `analyze ${esc(p.name)}`}">
              <img class="sb-hero" src="${esc(S.assets.hero(p.hero_id).icon)}" alt="">
              <span class="sb-name">${esc(p.name || S.assets.hero(p.hero_id).name)}</span>
              <span class="sb-kda">${p.kills}/${p.deaths}/${p.assists}</span>
              ${(() => { const a = skillAcc.get(p.pawn); const v = a.thrown ? a.scored / a.thrown : 0;
                return `<span class="sb-acc ${a.thrown >= 5 && v === bestAcc ? "best" : ""}" title="signature abilities: ${a.scored}/${a.thrown} hit heroes">${a.thrown ? pct(v) : "–"}</span>`; })()}
              <span class="sb-nw">${k1(p.net_worth)}</span>
            </div>`;
          }).join("")}
        </div>`).join("")}
    </section>
    ${subject ? `<section class="toolbar">
      <div class="abilities">${abilityButtons([gunAbility, ...meleeAbilities, ...table.filter((r) => !r.kind).map((r) => r.ability)], ability.class_name, abStat)}</div>
      <div class="controls">${controlsHTML(false)}</div>
    </section>
    ${table.some((r) => r.kind === "extra") ? `<section class="items-row"><span class="muted small">other abilities</span>
      <div class="abilities small-abs">${abilityButtons(table.filter((r) => r.kind === "extra").map((r) => r.ability), ability.class_name, abStat)}</div></section>` : ""}
    ${table.some((r) => r.item) ? `<section class="items-row"><span class="muted small">active items</span>
      <div class="abilities small-abs">${abilityButtons(table.filter((r) => r.item).map((r) => r.ability), ability.class_name, abStat)}</div></section>` : ""}`
    : `<section class="pick-hint"><b>Match overview.</b> Pick a player in the scoreboard, on the map or in the tables below to see their abilities, gun, melee and state.</section>`}
    ${subject && analysis.source === "cooldown" ? `<p class="note">No cast events for ${esc(ability.name)} in this demo; casts are taken from the ability going on cooldown, so there is no aim direction or aim error.</p>` : ""}
    ${m.warnings?.length ? `<p class="note warn">Parser warnings for this demo: ${m.warnings.map(esc).join(" · ")}</p>` : ""}
    ${subject && analysis.source === "none" ? `<p class="note">No casts of ${esc(ability.name)} found for this player.</p>` : ""}
    <section class="stage">
      <div class="map-wrap"><canvas class="minimap"></canvas>
        <div class="map-legend small muted">
          <label class="check"><input type="checkbox" class="show-all" ${settings.showAll ? "checked" : ""}> all casts</label>
          <label class="check"><input type="checkbox" class="show-heat" ${settings.showHeat ? "checked" : ""}> heat</label>
          <label class="check"><input type="checkbox" class="show-deaths" ${settings.showDeaths ? "checked" : ""}> deaths</label>
          <select class="cast-heat" title="glow where one ability or item was cast (${subject ? "by the selected player" : "by everyone"})">
            <option value="">cast heatmap…</option>
            ${heatChoices.filter((e) => !subject || e.pts.some((x) => x[3] === pawn)).map((e) => {
              const n = subject ? e.pts.filter((x) => x[3] === pawn).length : e.pts.length;
              return `<option value="${esc(e.cls)}" ${settings.castHeat === e.cls ? "selected" : ""}>${esc(e.name)} · ${esc(e.kind)} (${n})</option>`;
            }).join("")}
          </select>
          <span class="zoom-btns" ${subject ? "" : "hidden"}>${[1, 2, 3].map((z) => `<button class="chip ${(settings.mapZoom || 1) === z ? "on" : ""}" data-zoom="${z}">${z === 1 ? "full map" : `follow ×${z}`}</button>`).join("")}</span>
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
          <button class="btn csv" title="download casts as CSV" ${subject ? "" : "hidden"}>CSV</button>
          <button class="btn demo-cmd" title="copy a Deadlock console command that jumps the real replay to this moment">in-game ↗</button>
        </div>
        <div class="span-row">
          <span class="seg">
            <button class="chip mode-point" title="numbers = everything up to the playhead">point</button>
            <button class="chip mode-span" title="numbers = only what happened between from and to">span</button>
          </span>
          <span class="span-ctl">
            from <input class="tin t-from" size="5" placeholder="0:00"> to <input class="tin t-to" size="5" placeholder="0:00">
            <input type="range" class="scrub-from" min="0" max="${Math.ceil(m.end)}" step="0.5">
            ${[[0, 600, "0–10"], [600, 1200, "10–20"], [1200, 1800, "20–30"], [1800, Math.ceil(m.end), "30+"]]
              .filter(([a]) => a < m.end).map(([a, b, l]) => `<button class="chip preset" data-from="${a}" data-to="${Math.min(b, Math.ceil(m.end))}">${l} min</button>`).join("")}
          </span>
        </div>
        <div class="fights"></div>
        <div class="readout">
          <div class="tiles"></div>
          <div class="feed-wrap">
            <div class="feed-filter" ${subject ? "" : "hidden"}>
              ${["all", "hit", "miss", "kills", "all kills"].map((f) => `<button class="chip ${settings.feed === f ? "on" : ""}" data-feed="${f}">${f}</button>`).join("")}
            </div>
            <ol class="feed"></ol>
          </div>
        </div>
        <p class="demo-hint small muted"></p>
        <p class="keys small muted">space play · ←/→ 5 s · shift ±30 s · , . previous/next cast · home/end · wheel on timeline zooms ·
          <b>shift+drag</b> on the timeline (or <b>[</b> at the playhead) selects a span, Esc clears</p>
      </div>
    </section>
    <nav class="tabs" role="tablist">
      ${TABS.map(([id, label]) => `<button class="tab" role="tab" data-tab="${id}">${label}</button>`).join("")}
    </nav>
    <section class="chart-card tracker tab-panel" id="tracker"></section>
    <section class="chart-card incoming tab-panel" id="incoming"></section>
    <section class="chart-card time tab-panel" id="time"></section>
    <section class="chart-card laning tab-panel" id="laning"></section>
    <section class="chart-card chat tab-panel" id="chat"></section>
    </div>
`;

  // wiring
  renderSummary($("#summary", app), m, { onPick: (pw) => setParams({ pawn: pw, view: "replay", ability: null }) });
  for (const b of app.querySelectorAll("[data-view]")) b.addEventListener("click", () => setParams({ view: b.dataset.view }));
  for (const b of app.querySelectorAll(".sb-row")) {
    b.addEventListener("click", (ev) => {
      setParams({ pawn: Number(b.dataset.pawn) === pawn ? null : b.dataset.pawn, ability: null });
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
    $("#state", app).hidden = !subject;
    if (!subject) return;
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
    if (death && hp && hp.hp <= 0 && t - death[0] < 120) {
      const dt = damageTaken(m, pawn, death[0]);
      const killer = m.byPawn.get(death[2]);
      recap = `<div class="recap"><b>Killed ${killer ? `by <img src="${esc(S.assets.hero(killer.hero_id).icon)}" alt=""> ${esc(killer.name)}` : ""}</b>
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
          <small>${hp ? (hp.hp > 0 ? `${hp.hp} / ${hp.max} HP` : "dead") : "–"}</small></div>
        <div class="st-num"><b>${st ? k1(st[0]) : "–"}</b><small>souls</small></div>
        <div class="st-num"><b>${st ? st[1] : "–"}</b><small>level</small></div>
      </div>
      <div class="st-abs">${abil}</div>
      <div class="st-items">${items.map((it) => `<img class="slot-${esc(it.slot || "x")}" src="${esc(S.assets.itemIcon(it.id))}" title="${esc(it.name)}${it.tier ? ` · tier ${it.tier}` : ""}" alt="">`).join("") || `<span class="muted small">no items yet</span>`}</div>
      ${`<div class="st-mods">${mods.map((x) => `<span class="mod ${x.enemy ? "debuff" : ""}" title="${esc(x.name)}${x.enemy ? " (from enemy)" : ""}${x.left < 9999 ? ` · ${x.left.toFixed(1)} s left` : ""}">
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
      const aimed = ga.shots - ga.npc;
      return { p, thrown, hit, sAcc: thrown ? hit / thrown : null, ...ga, gAcc: aimed > 0 ? ga.hits / aimed : null };
    });
    const best = (k) => Math.max(...rows.filter((r) => (k === "sAcc" ? r.thrown >= 5 : r.shots >= 20)).map((r) => r[k] ?? 0));
    const bS = best("sAcc"), bG = best("gAcc");
    const cell = (v, n, d, isBest) => v == null ? `<td class="muted">–</td>`
      : `<td class="${isBest ? "best" : ""}"><span class="acc-bar"><span style="width:${v * 100}%"></span></span>${pct(v)} <small class="muted">${n}/${d}</small></td>`;
    const teams = [...new Set(rows.map((r) => r.p.team))].sort();
    // cumulative skill accuracy per player over the whole match (lines start after 5 casts)
    const CW = 1000, CH = 150;
    const cx = (tt) => 30 + (tt / Math.max(m.end, 60)) * (CW - 40);
    const cy = (v) => CH - 14 - v * (CH - 24);
    // metric follows the mode: skills, gun hero accuracy (excl. trooper shots) or melee hit %
    const series = ({ p, skill, gun: g }) => {
      const pts = [];
      if (gunMode) {
        let shots = 0, hits = 0, npc = 0;
        for (const e of g.events) {
          if (e.kind === "shot") shots += e.n; else if (e.kind === "npc") npc++; else hits++;
          if (shots >= 20 && shots - npc > 0) pts.push([e.t, hits / (shots - npc)]);
        }
      } else if (meleeMode) {
        // hero hits / hero melees (swings with an enemy hero in reach)
        let n = 0, h = 0;
        for (const x of meleeModel(meleeStats(m, p.pawn), meleeKind).swings) {
          if (!x.near) continue;
          n++; if (x.result === "hit") h++;
          if (n >= 3) pts.push([x.t, h / n]);
        }
      } else {
        let thrown = 0, hit = 0;
        for (const c of skill) {
          thrown++;
          if (c.result === "hit" || (!settings.heroesOnly && c.result === "other")) hit++;
          if (thrown >= 5) pts.push([c.t, hit / thrown]);
        }
      }
      return pts;
    };
    const accLines = tracked.map((tr) => {
      const pts = series(tr);
      if (!pts.length) return "";
      // thin long series so the path stays light
      const step = Math.max(1, Math.floor(pts.length / 400));
      let d = "";
      for (let i = 0; i < pts.length; i += step) d += `${d ? "L" : "M"}${cx(pts[i][0]).toFixed(1)},${cy(Math.min(1, pts[i][1])).toFixed(1)} `;
      const last = pts.at(-1)[1];
      return `<path class="acc-line team-${tr.p.team} ${tr.p.pawn === pawn ? "subject" : ""}" data-pawn="${tr.p.pawn}" d="${d}"><title>${esc(tr.p.name)}: ${pct(last)}</title></path>`;
    }).join("");
    const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line class="grid" x1="30" x2="${CW - 10}" y1="${cy(v)}" y2="${cy(v)}"/><text class="axis" x="26" y="${cy(v) + 3}" text-anchor="end">${v * 100}%</text>`).join("");
    const span = t0 != null ? `<rect class="acc-span" x="${cx(t0)}" y="4" width="${cx(t) - cx(t0)}" height="${CH - 18}"/>` : "";
    $("#tracker", app).innerHTML = `
      <h3>Accuracy tracker · ${t0 != null ? `${fmtClock(t0)}–${fmtClock(t)}` : `at ${fmtClock(t)}`} <span class="muted">· signature skills that connect + gun, every player</span></h3>
      <div class="small muted">chart: ${gunMode ? "gun hero accuracy (excl. trooper shots)" : meleeMode ? `${meleeKind || "melee"} hero hits / hero melees (enemy within ${MELEE_REACH_M} m)` : "skill accuracy"} over the match</div>
      <svg class="acc-chart" viewBox="0 0 ${CW} ${CH}">${grid}${span}${accLines}<line class="cursor" x1="${cx(t)}" x2="${cx(t)}" y1="4" y2="${CH - 14}"/></svg>
      <table class="report-table tracker-table">
        <tr><th></th><th>player</th><th>HP</th><th>souls</th><th>skills thrown</th><th>skill hit %</th><th>shots</th><th title="hero hits / (shots - shots that hit only troopers/neutrals)">hero accuracy</th><th>hero HS %</th><th title="hero hits / hero melees (swings with an enemy hero within ${MELEE_REACH_M} m); parried">melee → hero <small class="muted">light · heavy · parried</small></th><th>items</th></tr>
        ${teams.map((tm) => rows.filter((r) => r.p.team === tm).map((r) => `
          <tr class="team-row-${tm} ${r.p.pawn === pawn ? "on" : ""}" data-pawn="${r.p.pawn}">
            <td><img src="${esc(S.assets.hero(r.p.hero_id).icon)}" alt=""></td>
            <td>${esc(r.p.name)}</td>
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
            ${cell(r.gAcc, r.hits, r.shots - r.npc, r.shots >= 20 && r.gAcc === bG)}
            <td>${r.hits ? `${pct(r.hs / r.hits)} <small class="muted">${r.hs}</small>` : "–"}</td>
            <td>${(() => {
              const ms = meleeStats(m, r.p.pawn);
              const sw = ms.swings.filter((x) => inSpan(x.t));
              const l = sw.filter((x) => x.kind === "light"), h = sw.filter((x) => x.kind === "heavy");
              const fr = (xs) => `${xs.filter((x) => x.result === "hit").length}/${xs.filter((x) => x.near).length}`;
              return `<small>${fr(l)} · ${fr(h)} · ${sw.filter((x) => x.result === "parried").length}</small>`;
            })()}</td>
            <td class="tr-items">${itemsAt(m, r.p.pawn, t).filter((id) => S.assets.item(id)?.type === "upgrade")
              .map((id) => `<img class="slot-${esc(S.assets.item(id)?.slot || "x")}" src="${esc(S.assets.itemIcon(id))}" title="${esc(S.assets.item(id)?.name)}" alt="">`).join("")}</td>
          </tr>`).join("")).join("")}
      </table>`;
  }
  $("#tracker", app).addEventListener("mouseover", (ev) => {
    const tr = ev.target.closest("tr[data-pawn]");
    for (const l of app.querySelectorAll(".acc-line")) l.classList.toggle("hl", !!tr && l.dataset.pawn === tr.dataset.pawn);
  });
  $("#tracker", app).addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr[data-pawn]");
    if (tr) setParams({ pawn: tr.dataset.pawn });
  });

  // laning phase: the subject's lane at 10:00 (souls, last hits, K/D/A), souls curve 0-10 min
  (() => {
    const el = $("#laning", app);
    const LANE_END = 600;
    const lane = subject ? m.players.filter((p) => p.lane && p.lane === subject.lane) : [];
    if (lane.length < 2) { el.hidden = true; return; }
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
      return `<path class="nw-line team-${p.team} ${p.pawn === pawn ? "subject" : ""}" d="${d}"><title>${esc(p.name)}</title></path>`;
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
                <td>${esc(p.name)}</td><td>${k1(st[0])}</td><td>${st[5]}</td><td>${st[2]}/${st[3]}/${st[4]}</td></tr>`;
            }).join("")}
          </table>
        </div>
        <svg class="lane-chart" viewBox="0 0 ${W} ${H}">${lines}</svg>
      </div>`;
  })();

  // incoming skillshots (defense)
  const inc = subject ? incoming(m, pawn, S.assets, opts()) : null;
  if (!subject) $("#incoming", app).hidden = true;
  else $("#incoming", app).innerHTML = `
    <h3>Incoming skillshots aimed at ${esc(subject.name)}
      <span class="muted">· enemy casts whose aim was within ${AIMED_AT_DEG}° of them</span></h3>
    <div class="summary">
      ${tile("Aimed at", inc.aimed)}${tile("Got hit", inc.hit, "")}${tile("Dodged", inc.dodged, "good")}
      ${tile("Dodge rate", inc.aimed ? pct(inc.dodged / inc.aimed) : "–", "accent")}
    </div>
    <table class="report-table">
      <tr><th></th><th>enemy</th><th>ability</th><th>aimed</th><th>hit</th><th>dodged</th></tr>
      ${inc.rows.map((r) => `<tr>
        <td><img src="${esc(S.assets.hero(r.player.hero_id).icon)}" alt=""></td>
        <td>${esc(r.player.name)}</td>
        <td><span class="inline-ab">${r.ability.image ? `<img src="${esc(r.ability.image)}" alt="">` : ""}${esc(r.ability.name)}</span></td>
        <td>${r.aimed}</td><td>${r.hit}</td>
        <td><span class="acc-bar"><span style="width:${(1 - r.hit / r.aimed) * 100}%"></span></span>${pct(1 - r.hit / r.aimed)}</td></tr>`).join("")}
    </table>
    <p class="small muted">AoE and lock-on abilities count too, so treat this as a rough dodge signal, not exact.</p>`;

  // tabs
  function showTab(id) {
    tab = id;
    for (const b of app.querySelectorAll("[data-tab]")) b.classList.toggle("on", b.dataset.tab === id);
    for (const el of app.querySelectorAll(".tab-panel")) el.classList.toggle("active", el.id === id);
    if (id === "chat") renderChat(t);
    if (id === "tracker") renderTracker(t);
    if (id === "time") renderTime(t);
  }
  // per-player tabs disappear without a selection; fall back to the players tab
  for (const id of ["laning", "incoming"]) {
    if (!$(`#${id}`, app).hidden) continue;
    $(`[data-tab="${id}"]`, app).hidden = true;
    if (tab === id) tab = "tracker";
  }
  for (const b of app.querySelectorAll("[data-tab]")) {
    b.addEventListener("click", () => { settings.matchTab = b.dataset.tab; saveSettings(); showTab(b.dataset.tab); syncUrl(); });
  }

  // time split: combat state and movement per player over the point / span
  const COMBAT = [["hero", "fighting heroes", "c-hero"], ["npc", "fighting troopers / objectives", "c-npc"],
    ["neutral", "farming neutrals", "c-neutral"], ["out", "out of combat", "c-out"]];
  const MOVES = [["zip", "zipline", "m-zip"], ["slide", "slide", "m-slide"], ["dash", "dash", "m-dash"], ["air", "airborne", "m-air"]];
  function renderTime(t) {
    const from = t0 ?? -Infinity;
    const rows = teams.flatMap((tm) => teamOf(tm)).map((p) => ({ p, ts: timeSplit(m, p.pawn, S.assets, from, t) })).filter((r) => r.ts?.total);
    const bar = (parts, group, ts) => parts.map(([k, label, cls]) => {
      const v = ts[group][k];
      return v ? `<span class="${cls}" style="width:${(v / ts.total) * 100}%" data-help="${esc(`${label}: ${fmtClock(v)} (${Math.round((v / ts.total) * 100)}%)`)}"></span>` : "";
    }).join("");
    const legend = (parts) => parts.map(([, label, cls]) => `<span><i class="sw ${cls}"></i>${label}</span>`).join("");
    $("#time", app).innerHTML = `
      <h3>How each player spent ${t0 != null ? `${fmtClock(t0)}–${fmtClock(t)}` : `the match up to ${fmtClock(t)}`}
        <span class="muted">· alive time, from the demo every 0.5 s</span></h3>
      <div class="legend-row small">${legend(COMBAT)}<span class="muted">· right: movement</span>${legend(MOVES)}<span><i class="sw m-ground"></i>on foot</span></div>
      ${rows.map(({ p, ts }) => {
        const c = ts.counts;
        const counts = `jumps ${c.jumps} · dashes ${c.dashes} · slides ${c.slides} · ziplines ${c.ziplines} (boosts ${c.boosts}) · mantles ${c.mantles}`;
        return `<div class="ts-row team-row-${p.team} ${p.pawn === pawn ? "on" : ""}" data-pawn="${p.pawn}" role="button">
          <img src="${esc(S.assets.hero(p.hero_id).icon)}" alt=""><span class="ts-name">${esc(p.name)}</span>
          <span class="ts-bar">${bar(COMBAT, "combat", ts)}</span>
          <span class="ts-bar">${ts.hasMove ? bar(MOVES, "move", ts) : ""}</span>
          <span class="ts-counts small muted" data-help="${esc(counts)}">${c.jumps}↑ ${c.dashes}» ${c.slides}↘ ${c.ziplines}⇢</span>
        </div>`;
      }).join("")}
      ${rows.some((r) => !r.ts.hasMove) ? `<p class="small muted">Movement needs a demo parsed with the current parser; drop it again.</p>` : ""}
      <p class="small muted">Rebuilt from the demo; lands within a few points of Valve's own numbers.
        <a href="#/about?s=time">How it's measured →</a> · Counts: ↑ jumps · » dashes · ↘ slides · ⇢ zipline rides.</p>`;
  }
  $("#time", app).addEventListener("click", (ev) => {
    const row = ev.target.closest(".ts-row[data-pawn]");
    if (row) setParams({ pawn: row.dataset.pawn });
  });

  // chat: team chat of each side and all chat, with chat-wheel pings; future lines are dimmed
  function renderChat(t) {
    const showPings = settings.chatPings !== false;
    const lines = chatLines.filter((l) => showPings || l.kind === "chat");
    const col = (title, cls, xs) => {
      const now = xs.findIndex((l) => l.t > t);
      const items = xs.map((l, i) => {
        const p = m.byPawn.get(l.pawn);
        const hero = p ? S.assets.hero(p.hero_id) : null;
        return `${i === now ? `<li class="chat-now"><span>${fmtClock(t)}</span></li>` : ""}
          <li class="msg ${l.kind} ${l.t > t ? "future" : ""} ${p?.pawn === pawn ? "subject" : ""}" data-t="${l.t}">
            <span class="t">${fmtClock(Math.max(0, l.t))}</span>
            ${hero ? `<img src="${esc(hero.icon)}" alt="" title="${esc(hero.name)}">` : `<span class="noav"></span>`}
            <span class="body"><b class="who team-${p?.team || 0}">${esc(p?.name || "unknown")}</b>
              ${l.kind === "ping" ? `<span class="ping-chip">ping</span> <i>${esc(l.text)}</i>` : esc(l.text)}</span>
          </li>`;
      }).join("");
      return `<div class="chat-col ${cls}"><h4>${title} <small class="muted">${xs.filter((l) => l.kind === "chat").length}</small></h4>
        <ol>${items || `<li class="muted small">nothing said</li>`}${now < 0 && xs.length ? `<li class="chat-now"><span>${fmtClock(t)}</span></li>` : ""}</ol></div>`;
    };
    const team = (n) => lines.filter((l) => !l.all && m.byPawn.get(l.pawn)?.team === n);
    $("#chat", app).innerHTML = `
      <div class="chat-head"><h3>Chat</h3>
        <label class="check small"><input type="checkbox" class="chat-pings" ${showPings ? "checked" : ""}> chat-wheel pings</label>
        <span class="muted small">later lines are dimmed · click a line to jump there</span></div>
      <div class="chat-cols">
        ${col(`${TEAM_NAMES[2]} team`, "team-2", team(2))}
        ${col("All chat", "all", lines.filter((l) => l.all))}
        ${col(`${TEAM_NAMES[3]} team`, "team-3", team(3))}
      </div>`;
  }
  $("#chat", app).addEventListener("click", (ev) => {
    const li = ev.target.closest("li[data-t]");
    if (li) seek(Math.max(0, Number(li.dataset.t) - 2));
  });
  $("#chat", app).addEventListener("change", (ev) => {
    if (!ev.target.classList.contains("chat-pings")) return;
    settings.chatPings = ev.target.checked;
    saveSettings();
    renderChat(t);
  });

  // timeline model
  const lead = [];
  const nRows = Math.max(0, ...m.stats.tracks.map((t) => t.rows.length));
  for (let i = 0; i < nRows; i++) {
    let v = 0;
    for (const tr of m.stats.tracks) {
      const p = m.byPawn.get(tr.pawn);
      const nw = tr.rows[i]?.[0] || 0;
      v += p.team === (subject?.team ?? 2) ? nw : -nw;
    }
    lead.push([m.stats.t0 + i * m.stats.dt, v]);
  }
  const deaths = subject ? m.kills.filter((k) => k[1] === pawn).map((k) => k[0]) : [];
  const kills = (subject ? m.kills.filter((k) => k[2] === pawn || (k[4] || []).includes(pawn)) : m.kills).map((k) => k[0]);

  const timeline = createTimeline($(".timeline", app), {
    end: m.end, casts, heroesOnly: settings.heroesOnly, lead, deaths, kills,
    gun: gunMode ? gun : meleeMode ? melee : null, noChart: !subject,
    gunLabels: meleeMode ? ["swings", "hero hits", meleeKind ? null : "heavy hero hits"] : null,
  }, (t) => seek(t), (a, b) => setSpan(a, b));
  const minimap = createMinimap($(".minimap", app), {
    match: m, assets: S.assets, onPick: (p) => setParams({ pawn: p.pawn, ability: null }),
  });

  if (params.has("zoom")) settings.mapZoom = Number(params.get("zoom")) || 1;
  if (params.has("heat")) settings.showHeat = params.get("heat") === "1";
  if (params.has("deaths")) settings.showDeaths = params.get("deaths") === "1";
  // URL params win over the stored settings the checkboxes were rendered with
  $(".show-heat", app).checked = !!settings.showHeat;
  $(".show-deaths", app).checked = !!settings.showDeaths;
  let t = Number(params.get("t")) || m.end;
  // optional span start: stats then cover [t0, t] instead of [start, t]
  let t0 = params.has("from") ? Number(params.get("from")) : null;
  const inSpan = (tt) => tt <= t && (t0 == null || tt >= t0);
  function setSpan(a, b) {
    t0 = b - a < 1 ? null : a;
    seek(b);
  }
  const parseClock = (v) => {
    const m2 = String(v).trim().match(/^(\d+)(?::(\d{1,2}))?$/);
    return m2 ? Number(m2[1]) * 60 + Number(m2[2] || 0) : null;
  };
  $(".mode-point", app).addEventListener("click", () => { t0 = null; seek(t); });
  $(".mode-span", app).addEventListener("click", () => { if (t0 == null) setSpan(Math.max(0, t - 300), t); });
  $(".t-from", app).addEventListener("change", (ev) => {
    const v = parseClock(ev.target.value);
    if (v != null && v < t) setSpan(v, t);
  });
  $(".t-to", app).addEventListener("change", (ev) => {
    const v = parseClock(ev.target.value);
    if (v != null) setSpan(t0 ?? 0, Math.min(v, m.end));
  });
  $(".scrub-from", app).addEventListener("input", (ev) => {
    const v = Number(ev.target.value);
    setSpan(Math.min(v, t - 1), t);
  });
  for (const b of app.querySelectorAll(".preset")) {
    b.addEventListener("click", () => setSpan(Number(b.dataset.from), Number(b.dataset.to)));
  }
  let urlTimer = null;
  function syncUrl() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      const [path, q] = location.hash.slice(1).split("?");
      const p = new URLSearchParams(q || "");
      p.set("t", Math.round(t));
      if (t0 != null) p.set("from", Math.round(t0)); else p.delete("from");
      p.set("tab", tab);
      if (settings.castHeat && castSources.has(settings.castHeat)) p.set("castheat", settings.castHeat); else p.delete("castheat");
      p.delete("section");
      history.replaceState(null, "", `#${path}?${p}`);
    }, 300);
  }
  let playing = null;
  const scrub = $(".scrub", app);
  scrub.addEventListener("input", () => seek(Number(scrub.value)));
  $(".speed", app).addEventListener("change", (ev) => { settings.speed = Number(ev.target.value); saveSettings(); });
  $(".play", app).addEventListener("click", togglePlay);
  for (const b of app.querySelectorAll("[data-zoom]")) {
    b.addEventListener("click", () => {
      settings.mapZoom = Number(b.dataset.zoom);
      saveSettings();
      for (const o of app.querySelectorAll("[data-zoom]")) o.classList.toggle("on", o === b);
      seek(t);
    });
  }
  for (const [cls, key] of [[".show-heat", "showHeat"], [".show-deaths", "showDeaths"]]) {
    $(cls, app).addEventListener("change", (ev) => { settings[key] = ev.target.checked; saveSettings(); seek(t); });
  }
  $(".cast-heat", app).addEventListener("change", (ev) => {
    settings.castHeat = ev.target.value;
    saveSettings();
    seek(t);
  });
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
    const side = subject?.team ?? 2, other = side === 2 ? 3 : 2;
    const mine = !!subject && f.kills.some((k) => k[1] === pawn || k[2] === pawn || (k[4] || []).includes(pawn));
    const won = subject && f.byTeam[side] > f.byTeam[other];
    const lost = subject && f.byTeam[side] < f.byTeam[other];
    return `<button class="fight ${won ? "won" : lost ? "lost" : ""} ${mine ? "mine" : ""}" data-fight="${i}"
      title="${fmtClock(f.t0)}–${fmtClock(f.t1)} · ${f.kills.length} kills${subject ? (mine ? ` · ${esc(subject.name)} was involved` : "") : ` · ${TEAM_NAMES[2]}–${TEAM_NAMES[3]}`}">
      ${fmtClock(f.t0)} <b>${f.byTeam[side]}–${f.byTeam[other]}</b></button>`;
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
    const spanOn = t0 != null;
    $(".mode-point", app).classList.toggle("on", !spanOn);
    $(".mode-span", app).classList.toggle("on", spanOn);
    $(".span-ctl", app).classList.toggle("off", !spanOn);
    if (document.activeElement !== $(".t-from", app)) $(".t-from", app).value = spanOn ? fmtClock(t0) : "";
    if (document.activeElement !== $(".t-to", app)) $(".t-to", app).value = fmtClock(t);
    $(".scrub-from", app).value = spanOn ? t0 : 0;
    $(".span-info", app).innerHTML = t0 != null
      ? `span ${fmtClock(t0)}–${fmtClock(t)} <button class="chip span-clear" title="clear span (Esc)">×</button>` : "";
    syncUrl();
    const ch = castSources.get(settings.castHeat);
    minimap.update({ t, from: t0 ?? 0, subject: pawn, casts, showAll: settings.showAll, zoom: settings.mapZoom || 1,
      heat: settings.showHeat, deaths: settings.showDeaths,
      castHeat: ch ? (subject ? ch.pts.filter((x) => x[3] === pawn) : ch.pts) : null });
    renderReadout(t);
    if (tab === "tracker") renderTracker(t);
    if (tab === "chat") renderChat(t);
    if (tab === "time") renderTime(t);
    renderState(t);
  }

  function renderGunReadout(t) {
    const g = spanGun(gun);
    const pellets = gun.shots ? gun.bullets / gun.shots : 1;
    const st = spanStats();
    $(".tiles", app).innerHTML =
      tile("Shots fired", g.shots) +
      tile("Bullets", Math.round(g.shots * pellets) + (pellets > 1 ? `<small> ×${pellets.toFixed(0)}</small>` : "")) +
      tile("Shots hit heroes", g.hits, "good") +
      tile("Shots hit troopers", g.npc) +
      tile("Hero accuracy", g.shots - g.npc > 0 ? `${pct(g.hits / (g.shots - g.npc))}<small> ${g.hits}/${g.shots - g.npc}</small>` : "–", "accent") +
      tile("Hit rate (all shots)", g.shots ? pct(g.hits / g.shots) : "–") +
      tile("Headshots", g.hs) +
      tile("Hero headshot %", g.hits ? pct(g.hs / g.hits) : "–") +
      tile("K / D / A", st ? `${st[2]}/${st[3]}/${st[4]}` : "–") +
      tile("Souls", st ? k1(st[0]) : "–");
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

  function renderMeleeReadout(t) {
    const sw = melee.swings.filter((x) => inSpan(x.t));
    const name = (pw) => esc(m.byPawn.get(pw)?.name || "");
    const icon = (pw) => { const p = m.byPawn.get(pw); return p ? `<img src="${esc(S.assets.hero(p.hero_id).icon)}" title="${name(pw)}">` : ""; };
    const n = sw.length, near = sw.filter((x) => x.near).length;
    const hero = sw.filter((x) => x.result === "hit").length;
    const parried = sw.filter((x) => x.result === "parried").length;
    // parries this player made: which enemy swing they caught
    const caught = meleeAll.parried.filter((x) => inSpan(x.t) && (!meleeKind || x.kind === meleeKind));
    const pr = meleeAll.parries.filter((x) => inSpan(x[0]));
    const pa = pr.filter((x) => x[2] === 0).length;
    const rate = (a, b) => (b ? pct(a / b) : "–");
    const label = meleeKind ? `${meleeKind[0].toUpperCase()}${meleeKind.slice(1)}` : "Melee";
    // breakdown: what each swing was for (intent) x what came of it
    const row = (name, xs) => {
      const at = (i) => xs.filter((x) => x.intent === i);
      const H = at("hero"), N = at("npc"), M = at("move");
      const hh = H.filter((x) => x.result === "hit").length, hp = H.filter((x) => x.result === "parried").length;
      const nh = N.filter((x) => x.result === "other").length;
      const cell = (v, d) => `<td>${v}${d ? `<small class="muted"> ${pct(v / d)}</small>` : ""}</td>`;
      return `<tr><th>${name}</th><td>${xs.length}</td>
        ${cell(H.length, xs.length)}<td class="good">${hh}</td><td class="accent">${rate(hh, H.length)}</td><td class="${hp ? "bad" : ""}">${hp}</td><td>${H.length - hh - hp}</td>
        ${cell(N.length, xs.length)}<td>${nh}</td>
        ${cell(M.length, xs.length)}
        <td>${k1(xs.reduce((a, x) => a + x.dmg, 0))}</td></tr>`;
    };
    const kinds = meleeKind ? [[label, sw]] : [["Light", sw.filter((x) => x.kind === "light")], ["Heavy", sw.filter((x) => x.kind === "heavy")], ["All", sw]];
    $(".tiles", app).innerHTML =
      tile(`${label} swings`, n) +
      tile("Hero melees", `${near}<small> enemy ≤ ${MELEE_REACH_M} m</small>`) +
      tile("Hit heroes", hero, "good") +
      tile("Hero melee accuracy", `${rate(hero, near)}<small> ${hero}/${near}</small>`, "accent") +
      tile("Got parried", parried ? `<span class="bad">${parried}</span><small> ${rate(parried, near)} of hero melees</small>` : "0") +
      tile("Parries", `${caught.length}<small> / ${pa} tried${meleeKind ? ` · vs ${meleeKind}` : ""}</small>`) +
      `<div class="tile wide melee-break"><table class="mini">
        <tr><th></th><th>swings</th><th title="enemy hero within ${MELEE_REACH_M} m (or hit / parried)">at heroes</th><th>hit</th><th>acc</th><th>parried</th><th>whiff</th>
          <th title="no hero, but a trooper, neutral, crate, soul orb or objective within ${MELEE_REACH_M} m">at NPCs</th><th>hit</th>
          <th title="nothing to hit within ${MELEE_REACH_M} m: melee used to move">movement</th><th>dmg</th></tr>
        ${kinds.map(([nm, xs]) => row(nm, xs)).join("")}
      </table><a class="small muted" href="#/about?s=melee">how swings are classified →</a></div>`;
    const f = settings.feed || "all";
    const evs = [];
    if (f !== "kills" && f !== "all kills") {
      for (const x of sw) {
        if (f === "hit" ? x.result !== "hit" : f === "miss" ? x.result === "hit" || x.result === "other" : false) continue;
        evs.push({ t: x.t, swing: x });
      }
      if (f !== "miss") for (const x of caught) evs.push({ t: x.t, caught: x });
    }
    evs.sort((a, b) => b.t - a.t);
    $(".feed", app).innerHTML = evs.slice(0, 60).map(({ swing: x, caught: c }) => {
      if (c) {
        return `<li data-t="${c.t}" class="ev-kill"><span class="dot hit"></span><span class="t">${fmtClock(c.t)}</span>
          <span><b>parried</b></span>${c.attacker != null ? `${icon(c.attacker)}<span class="chip-s ${c.kind === "heavy" ? "" : "muted-chip"}">${c.kind}</span>` : `<span class="muted">(no hero swing found)</span>`}</li>`;
      }
      const other = x.target;
      const what = x.result === "hit" ? `hit · ${x.dmg} dmg` : x.result === "other" ? `hit NPC · ${x.dmg} dmg`
        : x.result === "parried" ? `<b class="bad">parried by</b>`
        : x.intent === "hero" ? `whiff · hero ${x.heroD != null ? `${x.heroD.toFixed(0)} m` : "in reach"}`
        : x.intent === "npc" ? `whiff · NPC ${x.npcD != null ? `${x.npcD.toFixed(0)} m` : "near"}` : `<span class="muted">movement</span>`;
      return `<li data-t="${x.t}" data-help="${esc(swingWhy(x))}"><span class="dot ${x.result === "parried" ? "miss" : x.result}"></span><span class="t">${fmtClock(x.t)}</span>
        <span class="chip-s ${x.kind === "heavy" ? "" : "muted-chip"}">${x.kind}</span>
        <span>${what}</span>${x.intent === "hero" ? icon(other) : ""}</li>`;
    }).join("") || `<li class="muted">no swings yet</li>`;
  }

  /** step-by-step reason for a swing's classification (hover text in the melee feed) */
  function swingWhy(x) {
    const nm = (pw) => m.byPawn.get(pw)?.name || "?";
    const d = (v) => (v == null ? "none within 30 m" : `${v.toFixed(1)} m`);
    const lines = [
      `${x.kind === "heavy" ? "Heavy" : "Light"} melee at ${fmtClock(x.t)}.`,
      x.measured ? `Nearest living enemy hero: ${d(x.heroD)}. Nearest NPC / crate / soul orb / objective: ${d(x.npcD)}.`
        : "Distances not measured in this demo (reparse with the current parser); positions every 0.5 s used instead.",
    ];
    if (x.result === "hit") lines.push(`Melee damage on ${x.victims.map(nm).join(", ")} within 0.6 s: ${x.dmg} → hero hit.`);
    else if (x.result === "parried") lines.push(`${nm(x.parriedBy)} parried it (successful parry within 8 m, up to 0.6 s after the swing).`);
    else if (x.result === "other") lines.push(`Melee damage only on NPCs within 0.6 s: ${x.dmg}.`);
    else lines.push("No melee damage within 0.6 s.");
    lines.push(x.intent === "hero" ? `→ hero melee: an enemy hero was within ${MELEE_REACH_M} m${x.result === "hit" || x.result === "parried" ? " (or it connected)" : ""}, so it counts toward hero melee accuracy.`
      : x.intent === "npc" ? `→ at NPCs: no enemy hero within ${MELEE_REACH_M} m, but something farmable was. Not counted toward hero accuracy.`
      : `→ movement: nothing to hit within ${MELEE_REACH_M} m, so it was most likely used to move. Not counted toward hero accuracy.`);
    if (x.speed != null) lines.push(`Speed in the second before: ${x.speed.toFixed(1)} m/s${x.intent === "move" && x.speed >= 7 ? " (already travelling fast, typical for movement melees)" : ""}.`);
    return lines.join("\n");
  }

  /** no player selected: the match at the playhead / in the span, and every kill */
  function renderOverview(t) {
    const ks = m.kills.filter((k) => inSpan(k[0]));
    const teamKills = (tm) => ks.filter((k) => m.byPawn.get(k[1]) && m.byPawn.get(k[1]).team !== tm).length;
    const souls = (tm) => m.players.filter((p) => p.team === tm).reduce((a, p) => a + (statsAt(m, p.pawn, t)?.[0] || 0), 0);
    const lead = souls(2) - souls(3);
    const fightsIn = fights.filter((f) => inSpan(f.t0)).length;
    $(".tiles", app).innerHTML =
      tile(`Kills <small>${TEAM_NAMES[2]} – ${TEAM_NAMES[3]}</small>`, `<span class="amber-txt">${teamKills(2)}</span>–<span class="sapphire-txt">${teamKills(3)}</span>`) +
      tile(`Souls <small>${TEAM_NAMES[2]} – ${TEAM_NAMES[3]}</small>`, `<span class="amber-txt">${k1(souls(2))}</span>–<span class="sapphire-txt">${k1(souls(3))}</span>`, "tight") +
      tile("Souls lead", lead ? `${k1(Math.abs(lead))}<small> ${lead > 0 ? TEAM_NAMES[2] : TEAM_NAMES[3]}</small>` : "even") +
      tile("Fights", fightsIn) +
      tile("Game time", fmtClock(t)) +
      tile("Winner", m.winning_team ? TEAM_NAMES[m.winning_team] : "–");
    $(".feed", app).innerHTML = [...ks].reverse().slice(0, 60).map((k) => {
      const [kt, vic, att, abilityId] = k;
      const v = m.byPawn.get(vic), a = m.byPawn.get(att);
      const kab = S.assets.item(abilityId);
      return `<li data-t="${kt}" class="ev-kill team-${a?.team || 0}"><span class="t">${fmtClock(kt)}</span>
        ${a ? `<img src="${esc(S.assets.hero(a.hero_id).icon)}" title="${esc(a.name)}">` : ""}
        ${kab?.image ? `<img class="kab" src="${esc(kab.image)}" title="${esc(kab.name)}">` : ""}
        <span>→</span>${v ? `<img src="${esc(S.assets.hero(v.hero_id).icon)}" title="${esc(v.name)}">` : ""}
        <span class="muted small">${esc(a?.name || "?")} → ${esc(v?.name || "?")}</span></li>`;
    }).join("") || `<li class="muted">no kills yet</li>`;
  }

  function renderReadout(t) {
    if (!subject) { renderOverview(t); return; }
    if (gunMode) { renderGunReadout(t); return; }
    if (meleeMode) { renderMeleeReadout(t); return; }
    const past = casts.filter((c) => inSpan(c.t));
    const c = counts(past, settings.heroesOnly);
    const st = spanStats();
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
      tile("Ready → recast", c.idle != null ? `${c.idle.toFixed(1)}<small> s</small>` : "–");

    const f = settings.feed || "all";
    const events = [];
    for (const k of past) {
      if (f === "kills" || f === "all kills" || (f === "hit" && k.result === "miss") || (f === "miss" && k.result !== "miss")) continue;
      events.push({ t: k.t, kind: "cast", k });
    }
    for (const k of m.kills) {
      if (!inSpan(k[0]) || f === "hit" || f === "miss") continue;
      if (f === "all kills" || k[1] === pawn || k[2] === pawn || (k[4] || []).includes(pawn)) events.push({ t: k[0], kind: "kill", k });
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
        <span>${died ? "killed" : att === pawn || (ev.k[4] || []).includes(pawn) ? "kill" : "→"}</span>
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
  showTab(tab);
  seek(t);
}

/** typed chat + chat-wheel lines in time order: {t, pawn, all, text, kind: "chat" | "ping"} */
export function chatLog(m) {
  const pings = S.assets.pings || {};
  // the voice line ("<speaker>_ping_kelvin_missing_01_ping_2d", "..._ping_defend_blue_02_ping_2d")
  // names the ping's target hero or lane, which the wheel message leaves as a placeholder
  const heroByCode = new Map(Object.values(S.assets.heroes).map((h) => [h.class_name.replace(/^hero_/, ""), h.name]));
  const LANES = ["yellow", "green", "blue", "purple"];
  const lines = (m.chat || []).map(([t, pawn, all, text]) => ({ t, pawn, all: !!all, text, kind: "chat" }));
  for (const [t, pawn, id, voice] of m.wheel || []) {
    const p = pings[id];
    const rest = voice.includes("_ping_") ? voice.slice(voice.indexOf("_ping_") + 6).replace(/_ping_2d$/, "") : voice;
    const words = rest.split("_").filter((w) => w && !/^\d+$/.test(w) && w !== "alt");
    const target = words.map((w) => heroByCode.get(w)).find(Boolean);
    const lane = words.find((w) => LANES.includes(w));
    let text = (lane && p?.lanes?.[lane]) || p?.text || words.join(" ") || `ping #${id}`;
    if (text.includes("…")) text = text.replace("…", target || "someone");
    else if (/^[a-z]/.test(text)) text = `${target || "someone"} ${text}`;
    const laneName = lane && (S.assets.lanes?.[lane] || lane);
    if (laneName && !p?.lanes?.[lane] && !text.includes(laneName)) text += ` · ${laneName}`;
    lines.push({ t, pawn, all: /_ALLCHAT$/.test(p?.concept || ""), text, kind: "ping" });
  }
  return lines.sort((a, b) => a.t - b.t);
}
