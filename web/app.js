// Skill Hitter: per-match "thrown vs hit" timelines for any hero ability.
// Data: data/index.json (match list), data/matches/<id>.json (parsed demos), data/assets.json.

const $ = (sel, el = document) => el.querySelector(sel);
const fmtTime = (s) => {
  const neg = s < 0; s = Math.abs(Math.round(s));
  return `${neg ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
// system time zone, 24h, unambiguous date: 2026-10-15 23:49
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const fmtDate = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
const ago = (d) => {
  const s = (Date.now() - d.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 86400 * 60) return rtf.format(-Math.round(s / 86400), "day");
  return rtf.format(-Math.round(s / (86400 * 30)), "month");
};
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);

const state = {
  index: null,
  assets: null,
  matches: new Map(), // match_id -> parsed json
  ability: null,      // class_name
  window: 3,
  heroesOnly: true,
  cards: [],
};

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

// ------------------------------------------------------------------ analysis

/** id of an ability/item by class name */
function abilityId(className) {
  for (const [id, it] of Object.entries(state.assets.items)) {
    if (it.class_name === className) return Number(id);
  }
  return null;
}

/**
 * Pair each cast of `className` by `pawn` with the first damage / status hit from that ability
 * inside the hit window (cut short by the next cast).
 * result: "hit" (enemy hero), "other" (non-hero target), "miss".
 */
function analyze(match, pawn, className) {
  const aid = abilityId(className);
  const casts = match.casts.filter((c) => c[1] === pawn && c[2] === className).map((c) => c[0]);
  // [t, victimPawn, victimEnt, dmg]
  const hits = [];
  for (const d of match.damage) {
    if (d[1] === pawn && d[4] === aid && d[3] !== pawn) hits.push([d[0], d[3], d[2], d[5]]);
  }
  for (const n of match.notify) {
    if (n[1] === pawn && n[3] === aid && n[2] !== pawn) hits.push([n[0], n[2], n[2], 0]);
  }
  hits.sort((a, b) => a[0] - b[0]);

  const out = [];
  let j = 0;
  for (let i = 0; i < casts.length; i++) {
    const t = casts[i];
    const end = Math.min(t + state.window, i + 1 < casts.length ? casts[i + 1] : Infinity);
    while (j < hits.length && hits[j][0] < t) j++;
    let k = j, heroHit = null, otherHit = null, dmg = 0;
    const victims = new Set();
    while (k < hits.length && hits[k][0] < end) {
      const h = hits[k];
      const isHero = match.pawnInfo.has(h[1]);
      if (isHero && !heroHit) heroHit = h;
      if (!isHero && !otherHit) otherHit = h;
      if (isHero) victims.add(h[1]);
      dmg += h[3];
      k++;
    }
    const first = heroHit || otherHit;
    const result = heroHit ? "hit" : otherHit ? "other" : "miss";
    out.push({
      t, result, dmg,
      delay: first ? first[0] - t : null,
      victims: [...victims],
    });
  }
  return out;
}

const counts = (casts) => {
  const hit = casts.filter((c) => c.result === "hit").length;
  const other = casts.filter((c) => c.result === "other").length;
  return { thrown: casts.length, hit, other, scored: state.heroesOnly ? hit : hit + other };
};

// ------------------------------------------------------------------ rendering

function heroIcon(heroId) {
  return state.assets.heroes[heroId]?.icon || "";
}

function tile(k, v) {
  return `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

function renderSummary() {
  let thrown = 0, scored = 0, parsed = 0, other = 0;
  for (const card of state.cards) {
    if (!card.casts) continue;
    parsed++;
    const c = counts(card.casts);
    thrown += c.thrown; scored += c.scored; other += c.other;
  }
  const total = state.index.matches.length;
  $("#summary").innerHTML =
    tile("Matches parsed", `${parsed}<small> / ${total}</small>`) +
    tile("Thrown", thrown) +
    tile(state.heroesOnly ? "Hit heroes" : "Hit (any)", scored) +
    tile("Accuracy", `${pct(scored, thrown)}%`) +
    tile("Hit non-heroes", other);
}

function buildCard(entry) {
  const el = $("#match-tpl").content.firstElementChild.cloneNode(true);
  const when = new Date(entry.start_time * 1000);
  $(".result", el).textContent = entry.won ? "WIN" : "LOSS";
  $(".result", el).classList.add(entry.won ? "win" : "loss");
  $(".mid", el).textContent = `#${entry.match_id}`;
  $(".mid", el).href = `https://statlocker.gg/match/${entry.match_id}`;
  $(".when", el).textContent =
    `${fmtDate(when)} · ${ago(when)} · ${fmtTime(entry.duration_s)}`;
  $(".when", el).title = when.toString();
  if (!entry.parsed) {
    el.classList.add("unparsed");
    $(".match-stats", el).innerHTML =
      `<span>${entry.kills}/${entry.deaths}/${entry.assists}</span>`;
    $(".missing", el).textContent = `no demo: ${entry.status || "unknown"}`;
  }
  return { entry, el, casts: null, match: null, me: null, t: 0, playing: null };
}

function prepareMatch(m) {
  m.pawnInfo = new Map(m.players.map((p) => [p.pawn, p]));
  return m;
}

function recompute(card) {
  if (!card.match) return;
  card.casts = analyze(card.match, card.me.pawn, state.ability);
  const c = counts(card.casts);
  const { entry } = card;
  $(".match-stats", card.el).innerHTML =
    `<span>KDA <b>${entry.kills}/${entry.deaths}/${entry.assists}</b></span>` +
    `<span>thrown <b>${c.thrown}</b></span>` +
    `<span>hit <b>${c.scored}</b></span>` +
    `<span><b>${pct(c.scored, c.thrown)}%</b></span>`;
  drawChart(card);
  scrubTo(card, card.t);
}

function drawChart(card) {
  const svg = $(".chart", card.el);
  // draw in real pixels so dots/text never stretch
  const W = Math.max(320, Math.round(svg.clientWidth || 1000));
  const H = 170, padL = 30, padR = 10, padT = 10, laneH = 22, padB = 18;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const dur = Math.max(card.match.duration_s, 60);
  const casts = card.casts;
  const maxY = Math.max(casts.length, 1);
  const plotB = H - padB - laneH;
  const x = (t) => padL + (Math.max(0, t) / dur) * (W - padL - padR);
  const y = (n) => plotB - (n / maxY) * (plotB - padT);
  card.geom = { x, W, H, padL, padR, dur };

  let g = "";
  for (let m = 0; m <= dur; m += 300) {
    g += `<line class="grid" x1="${x(m)}" x2="${x(m)}" y1="${padT}" y2="${H - padB}"/>`;
    g += `<text class="axis" x="${x(m)}" y="${H - 4}" text-anchor="middle">${m / 60}m</text>`;
  }
  for (const n of [0, Math.round(maxY / 2), maxY]) {
    g += `<text class="axis" x="${padL - 6}" y="${y(n) + 3}" text-anchor="end">${n}</text>`;
  }

  // cumulative step lines
  const step = (filter) => {
    let n = 0, d = `M${x(0)},${y(0)}`;
    for (const c of casts) {
      if (!filter(c)) continue;
      d += ` H${x(c.t)} V${y(++n)}`;
    }
    return d + ` H${x(dur)}`;
  };
  const scored = (c) => c.result === "hit" || (!state.heroesOnly && c.result === "other");
  g += `<path class="l-thrown" d="${step(() => true)}"/>`;
  g += `<path class="l-hit" d="${step(scored)}"/>`;

  // marker lane: casts + own deaths
  const laneY = H - padB - laneH / 2;
  g += `<g class="markers">`;
  casts.forEach((c, i) => {
    g += `<circle data-i="${i}" data-t="${c.t}" class="m-${c.result}" cx="${x(c.t)}" cy="${laneY}" r="4.5"><title>${fmtTime(c.t)} ${c.result}</title></circle>`;
  });
  for (const k of card.match.kills) {
    if (k[1] !== card.me.pawn) continue;
    g += `<rect data-t="${k[0]}" class="m-death" x="${x(k[0]) - 3}" y="${laneY - 10}" width="6" height="3"><title>${fmtTime(k[0])} died</title></rect>`;
  }
  g += `</g><line class="cursor" x1="0" x2="0" y1="${padT}" y2="${H - padB}"/>`;
  svg.innerHTML = g;
}

function scrubTo(card, t) {
  card.t = t;
  const { el, casts, match } = card;
  $(".scrub", el).value = t;
  $(".clock", el).textContent = fmtTime(t);
  const { x } = card.geom;
  const cur = $(".cursor", el);
  cur.setAttribute("x1", x(t)); cur.setAttribute("x2", x(t));
  for (const m of el.querySelectorAll(".markers > *")) {
    m.classList.toggle("future", Number(m.dataset.t) > t);
  }

  const past = casts.filter((c) => c.t <= t);
  const c = counts(past);
  const deaths = match.kills.filter((k) => k[1] === card.me.pawn && k[0] <= t).length;
  $(".tiles", el).innerHTML =
    tile("Thrown", c.thrown) +
    tile(state.heroesOnly ? "Hit heroes" : "Hit", c.scored) +
    tile("Accuracy", `${pct(c.scored, c.thrown)}%`) +
    tile("Missed", c.thrown - c.hit - c.other) +
    tile("Hit non-hero", c.other) +
    tile("Deaths", deaths);

  const feed = past.slice(-8).reverse().map((cst) => {
    const vics = cst.victims.map((p) => {
      const pl = match.pawnInfo.get(p);
      return pl ? `<img src="${heroIcon(pl.hero_id)}" title="${pl.name}">` : "";
    }).join("");
    const label = cst.result === "hit" ? `hit${cst.delay != null ? ` +${cst.delay.toFixed(2)}s` : ""} · ${cst.dmg} dmg`
      : cst.result === "other" ? `hit non-hero · ${cst.dmg} dmg` : "miss";
    return `<li><span class="dot ${cst.result}"></span><span class="t">${fmtTime(cst.t)}</span>${vics}<span>${label}</span></li>`;
  }).join("");
  $(".feed", el).innerHTML = feed || `<li class="muted">no casts yet</li>`;
}

function wireCard(card) {
  const { el } = card;
  let lastW = 0;
  new ResizeObserver(() => {
    const w = Math.round($(".chart", el).clientWidth);
    if (w && w !== lastW) { lastW = w; drawChart(card); scrubTo(card, card.t); }
  }).observe($(".chart", el));
  const scrub = $(".scrub", el);
  scrub.addEventListener("input", () => scrubTo(card, Number(scrub.value)));
  const svg = $(".chart", el);
  const fromPointer = (ev) => {
    const r = svg.getBoundingClientRect();
    const { padL, padR, W, dur } = card.geom;
    const px = ((ev.clientX - r.left) / r.width) * W;
    return Math.min(dur, Math.max(0, ((px - padL) / (W - padL - padR)) * dur));
  };
  let dragging = false;
  svg.addEventListener("pointerdown", (ev) => { dragging = true; svg.setPointerCapture(ev.pointerId); scrubTo(card, fromPointer(ev)); });
  svg.addEventListener("pointermove", (ev) => dragging && scrubTo(card, fromPointer(ev)));
  svg.addEventListener("pointerup", () => (dragging = false));
  $(".play", el).addEventListener("click", () => togglePlay(card));
}

function togglePlay(card) {
  const btn = $(".play", card.el);
  if (card.playing) {
    cancelAnimationFrame(card.playing); card.playing = null; btn.textContent = "▶"; return;
  }
  if (card.t >= card.match.duration_s) card.t = 0;
  btn.textContent = "❚❚";
  let last = performance.now();
  const speed = 60; // game seconds per real second
  const tick = (now) => {
    const t = Math.min(card.match.duration_s, card.t + ((now - last) / 1000) * speed);
    last = now;
    scrubTo(card, t);
    if (t >= card.match.duration_s) { card.playing = null; btn.textContent = "▶"; return; }
    card.playing = requestAnimationFrame(tick);
  };
  card.playing = requestAnimationFrame(tick);
}

function fillAbilities() {
  const heroId = state.index.hero_id;
  const sigs = state.assets.signatures[heroId] || [];
  const sel = $("#ability");
  sel.innerHTML = sigs.filter(Boolean).map((cls) => {
    const it = Object.values(state.assets.items).find((i) => i.class_name === cls);
    return `<option value="${cls}">${it?.name || cls}</option>`;
  }).join("");
  const params = new URLSearchParams(location.search);
  const want = params.get("ability") || (heroId === 64 ? "drifter_shadow_mark" : sigs[0]);
  if (want && sigs.includes(want)) sel.value = want;
  state.ability = sel.value;
}

function refreshAll() {
  for (const card of state.cards) recompute(card);
  renderSummary();
}

async function main() {
  [state.index, state.assets] = await Promise.all([
    getJSON("data/index.json"), getJSON("data/assets.json"),
  ]);
  const hero = state.assets.heroes[state.index.hero_id];
  const prof = state.index.profile || {};
  $("#avatar").src = prof.avatar || "";
  $("#avatar").hidden = !prof.avatar;
  $("#player-name").textContent = prof.name || `account ${state.index.account_id}`;
  $("#player-name").href = prof.url || `https://steamcommunity.com/profiles/${BigInt(state.index.account_id) + 76561197960265728n}/`;
  $("#hero-icon").src = hero?.icon || "";
  $("#hero-icon").title = hero?.name || "";
  $("#subtitle").textContent =
    `${hero?.name || "hero " + state.index.hero_id} · ${state.index.matches.length} matches · synced ${fmtDate(new Date(state.index.generated * 1000))} (${TZ})`;
  fillAbilities();

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = `<span><i class="dot hit"></i>hit hero</span><span><i class="dot other"></i>hit non-hero</span><span><i class="dot miss"></i>miss</span><span><i class="dot" style="background:var(--death);border-radius:1px"></i>own death</span><span>lines: cumulative thrown (light) vs hit (green)</span>`;
  $("#summary").after(legend);

  const main = $("#matches");
  const entries = [...state.index.matches].sort((a, b) => b.parsed - a.parsed || b.start_time - a.start_time);
  for (const entry of entries) {
    const card = buildCard(entry);
    state.cards.push(card);
    main.appendChild(card.el);
  }
  await Promise.all(state.cards.filter((c) => c.entry.parsed).map(async (card) => {
    const m = prepareMatch(await getJSON(`data/matches/${card.entry.match_id}.json`));
    card.match = m;
    card.me = m.players.find((p) => p.account_id === state.index.account_id);
    if (!card.me) { card.el.classList.add("unparsed"); $(".missing", card.el).textContent = "player not found in demo"; return; }
    card.t = m.duration_s;
    $(".scrub", card.el).max = Math.ceil(m.duration_s);
    recompute(card);
    wireCard(card);
  }));
  renderSummary();

  $("#ability").addEventListener("change", (e) => { state.ability = e.target.value; refreshAll(); });
  $("#window").addEventListener("change", (e) => { state.window = Number(e.target.value); refreshAll(); });
  $("#heroes-only").addEventListener("change", (e) => { state.heroesOnly = e.target.checked; refreshAll(); });
}

main().catch((e) => {
  $("#subtitle").textContent = `failed to load: ${e.message} — run tools/sync.py first`;
  console.error(e);
});
