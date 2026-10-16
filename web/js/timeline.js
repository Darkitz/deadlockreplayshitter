// Multi-lane match timeline (SVG, drawn in real pixels so nothing stretches).
//
// model: {
//   end,                         // match length (s)
//   casts: [{t, result}],        // analyzed casts
//   heroesOnly,
//   hp: [[t, frac]],             // subject health fraction samples
//   lead: [[t, souls]],          // subject team's net worth lead
//   deaths: [t], kills: [t],     // subject deaths / kill participations
//   items: [{t, img, name}],     // purchases
// }

const NS = "http://www.w3.org/2000/svg";
export const fmtClock = (s) => {
  const neg = s < 0;
  s = Math.abs(Math.round(s));
  return `${neg ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function createTimeline(svg, model, onSeek) {
  let geom = null;
  let t = model.end;

  function draw() {
    const W = Math.max(320, Math.round(svg.clientWidth || 800));
    const padL = 36, padR = 12;
    const lanes = { chart: 120, marks: 22, hp: 34, lead: 34, items: 24, axis: 16 };
    let y = 8;
    const L = {};
    for (const [k, h] of Object.entries(lanes)) {
      if (k === "hp" && !model.hp?.length) continue;
      if (k === "lead" && !model.lead?.length) continue;
      if (k === "items" && !model.items?.length) continue;
      L[k] = { y, h };
      y += h + 4;
    }
    const H = y;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", H);
    const dur = Math.max(model.end, 60);
    const x = (tt) => padL + (Math.min(Math.max(tt, 0), dur) / dur) * (W - padL - padR);
    geom = { x, W, H, padL, padR, dur };

    let g = "";
    // grid + axis
    const step = dur > 2400 ? 600 : 300;
    for (let m = 0; m <= dur; m += step) {
      g += `<line class="grid" x1="${x(m)}" x2="${x(m)}" y1="${L.chart.y}" y2="${L.axis.y}"/>`;
      g += `<text class="axis" x="${x(m)}" y="${L.axis.y + 11}" text-anchor="middle">${m / 60}m</text>`;
    }

    // lane: cumulative thrown vs hit
    const { casts } = model;
    const c = L.chart;
    const maxY = Math.max(casts.length, 1);
    const cy = (n) => c.y + c.h - (n / maxY) * (c.h - 4);
    const scored = (k) => k.result === "hit" || (!model.heroesOnly && k.result === "other");
    const stepPath = (filter) => {
      let n = 0, d = `M${x(0)},${cy(0)}`;
      for (const k of casts) {
        if (!filter(k)) continue;
        d += ` H${x(k.t)} V${cy(++n)}`;
      }
      return { d: d + ` H${x(dur)}`, n };
    };
    const thrown = stepPath(() => true), hit = stepPath(scored);
    g += `<path class="area-hit" d="${hit.d} V${cy(0)} H${x(0)} Z"/>`;
    g += `<path class="l-thrown" d="${thrown.d}"/><path class="l-hit" d="${hit.d}"/>`;
    for (const n of [0, maxY]) {
      g += `<text class="axis" x="${padL - 6}" y="${cy(n) + 3}" text-anchor="end">${n}</text>`;
    }
    g += `<text class="lane-label" x="${padL + 4}" y="${c.y + 10}">thrown ${casts.length} · hit ${hit.n}</text>`;

    // lane: cast markers, deaths, kills
    const mk = L.marks, my = mk.y + mk.h / 2;
    g += `<line class="lane-base" x1="${padL}" x2="${W - padR}" y1="${my}" y2="${my}"/>`;
    for (const k of model.kills || []) {
      g += `<path class="m-kill" data-t="${k}" d="M${x(k)},${my - 10} l4,6 h-8 Z"><title>${fmtClock(k)} kill / assist</title></path>`;
    }
    for (const k of model.deaths || []) {
      g += `<path class="m-death" data-t="${k}" d="M${x(k) - 4},${my + 4} l8,8 m0,-8 l-8,8"><title>${fmtClock(k)} died</title></path>`;
    }
    casts.forEach((k, i) => {
      g += `<circle data-i="${i}" data-t="${k.t}" class="m-${k.result}" cx="${x(k.t)}" cy="${my}" r="4.5"><title>${fmtClock(k.t)} ${k.result}${k.dmg ? ` · ${k.dmg} dmg` : ""}</title></circle>`;
    });

    // lane: health
    if (L.hp) {
      const { y: hy, h: hh } = L.hp;
      let d = `M${x(model.hp[0][0])},${hy + hh}`;
      for (const [tt, f] of model.hp) d += ` L${x(tt)},${hy + hh - f * hh}`;
      d += ` L${x(model.hp.at(-1)[0])},${hy + hh} Z`;
      g += `<path class="area-hp" d="${d}"/>`;
      g += `<text class="lane-label" x="${padL + 4}" y="${hy + 10}">health</text>`;
    }

    // lane: team soul lead
    if (L.lead) {
      const { y: ly, h: lh } = L.lead;
      const mid = ly + lh / 2;
      const max = Math.max(1000, ...model.lead.map((p) => Math.abs(p[1])));
      const yy = (v) => mid - (v / max) * (lh / 2);
      let d = `M${x(model.lead[0][0])},${mid}`;
      for (const [tt, v] of model.lead) d += ` L${x(tt)},${yy(v)}`;
      d += ` L${x(model.lead.at(-1)[0])},${mid} Z`;
      g += `<clipPath id="lead-up"><rect x="0" y="${ly}" width="${W}" height="${lh / 2}"/></clipPath>`;
      g += `<clipPath id="lead-dn"><rect x="0" y="${mid}" width="${W}" height="${lh / 2}"/></clipPath>`;
      g += `<path class="area-lead-up" clip-path="url(#lead-up)" d="${d}"/>`;
      g += `<path class="area-lead-dn" clip-path="url(#lead-dn)" d="${d}"/>`;
      g += `<line class="lane-base" x1="${padL}" x2="${W - padR}" y1="${mid}" y2="${mid}"/>`;
      g += `<text class="lane-label" x="${padL + 4}" y="${ly + 10}">team souls lead (±${Math.round(max / 1000)}k)</text>`;
    }

    // lane: item purchases (staggered so icons don't overlap)
    if (L.items) {
      const { y: iy, h: ih } = L.items;
      let lastX = -99, row = 0;
      for (const it of model.items) {
        const ix = x(it.t);
        row = ix - lastX < 18 ? (row + 1) % 2 : 0;
        lastX = ix;
        const sz = 18, yy = iy + (row ? 6 : 0);
        g += it.img
          ? `<image data-t="${it.t}" href="${esc(it.img)}" x="${ix - sz / 2}" y="${yy}" width="${sz}" height="${sz}"><title>${fmtClock(it.t)} ${esc(it.name)}</title></image>`
          : `<rect data-t="${it.t}" class="m-item" x="${ix - 3}" y="${yy + 6}" width="6" height="6"><title>${fmtClock(it.t)} ${esc(it.name)}</title></rect>`;
      }
    }

    g += `<line class="cursor" x1="0" x2="0" y1="4" y2="${L.axis.y}"/>`;
    svg.innerHTML = g;
    setTime(t);
  }

  function setTime(nt) {
    t = nt;
    if (!geom) return;
    const cx = geom.x(t);
    const cur = svg.querySelector(".cursor");
    cur.setAttribute("x1", cx);
    cur.setAttribute("x2", cx);
    for (const el of svg.querySelectorAll("[data-t]")) {
      el.classList.toggle("future", Number(el.dataset.t) > t);
    }
  }

  const fromPointer = (ev) => {
    const r = svg.getBoundingClientRect();
    const { padL, padR, W, dur } = geom;
    const px = ((ev.clientX - r.left) / r.width) * W;
    return Math.min(dur, Math.max(0, ((px - padL) / (W - padL - padR)) * dur));
  };
  let dragging = false;
  svg.addEventListener("pointerdown", (ev) => {
    dragging = true;
    svg.setPointerCapture(ev.pointerId);
    onSeek(fromPointer(ev));
  });
  svg.addEventListener("pointermove", (ev) => dragging && onSeek(fromPointer(ev)));
  svg.addEventListener("pointerup", () => (dragging = false));

  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.round(svg.clientWidth);
    if (w && w !== lastW) { lastW = w; draw(); }
  });
  ro.observe(svg);
  draw();
  return { setTime, redraw: draw, destroy: () => ro.disconnect() };
}

/** tiny static sparkline (cumulative thrown vs hit + result ticks) for match cards */
export function sparkline(casts, end, heroesOnly, w = 260, h = 46) {
  const dur = Math.max(end, 60);
  const x = (t) => 2 + (Math.max(0, t) / dur) * (w - 4);
  const max = Math.max(casts.length, 1);
  const y = (n) => h - 12 - (n / max) * (h - 16);
  let a = `M${x(0)},${y(0)}`, b = a, na = 0, nb = 0, ticks = "";
  for (const c of casts) {
    a += ` H${x(c.t)} V${y(++na)}`;
    if (c.result === "hit" || (!heroesOnly && c.result === "other")) b += ` H${x(c.t)} V${y(++nb)}`;
    ticks += `<rect class="m-${c.result}" x="${x(c.t) - 1}" y="${h - 7}" width="2" height="6"/>`;
  }
  a += ` H${x(dur)}`;
  b += ` H${x(dur)}`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path class="l-thrown" vector-effect="non-scaling-stroke" d="${a}"/><path class="l-hit" vector-effect="non-scaling-stroke" d="${b}"/>${ticks}</svg>`;
}
