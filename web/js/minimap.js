// Canvas minimap: hero positions at time t, subject trail, recent cast rays and hits.

import { posAt, hpAt } from "./data.js";

const TEAM_COLOR = { 2: "#e8a33d", 3: "#4f8fe8" };
const RESULT_COLOR = { hit: "#6fd08c", other: "#e0b25a", miss: "#d9644f" };
const RAY_LEN = 3200;      // world units drawn for a cast's aim line
const RAY_FADE = 5;        // seconds a cast stays visible
const TRAIL = 12;          // seconds of subject trail

const imgCache = new Map();
function img(src, onload) {
  if (!src) return null;
  let im = imgCache.get(src);
  if (!im) {
    im = new Image();
    im.src = src;
    imgCache.set(src, im);
  }
  if (!im.complete) im.addEventListener("load", onload, { once: true });
  return im;
}

export function createMinimap(canvas, { match, assets, onPick }) {
  const R = assets.map?.radius || 10752;
  let state = { t: 0, subject: null, casts: [], showAll: false };
  let dots = [];

  const ctx = canvas.getContext("2d");
  const redraw = () => draw();

  function size() {
    const css = canvas.clientWidth || 400;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(css * dpr)) {
      canvas.width = Math.round(css * dpr);
      canvas.height = Math.round(css * dpr);
    }
    return { S: canvas.width, dpr };
  }

  function draw() {
    const { S, dpr } = size();
    const w2p = (x, y) => [((x + R) / (2 * R)) * S, ((R - y) / (2 * R)) * S];
    const { t, subject, casts } = state;
    ctx.clearRect(0, 0, S, S);

    // ground + building silhouettes (the minimap png is dark buildings on transparent)
    const grd = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.6);
    grd.addColorStop(0, "#2a2e35");
    grd.addColorStop(1, "#15171b");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, S, S);
    const bg = img(assets.map?.image, redraw);
    if (bg?.complete && bg.naturalWidth) ctx.drawImage(bg, 0, 0, S, S);

    // zipline lanes
    for (const z of assets.map?.ziplines || []) {
      if (z.points.length < 2) continue;
      ctx.strokeStyle = z.color || "#888";
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      z.points.forEach(([x, y], i) => {
        const [px, py] = w2p(x, y);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // objectives: team0 = amber (team 2), team1 = sapphire (team 3)
    for (const [name, o] of Object.entries(assets.map?.objectives || {})) {
      const team = name.startsWith("team0") ? 2 : 3;
      const big = /core|titan/.test(name);
      ctx.fillStyle = TEAM_COLOR[team];
      ctx.globalAlpha = 0.55;
      const s = (big ? 5 : 3.5) * dpr;
      const ox = o.left_relative * S, oy = o.top_relative * S;
      ctx.beginPath();
      ctx.moveTo(ox, oy - s); ctx.lineTo(ox + s, oy); ctx.lineTo(ox, oy + s); ctx.lineTo(ox - s, oy);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // subject trail
    if (subject != null) {
      ctx.beginPath();
      let started = false;
      for (let tt = t - TRAIL; tt <= t; tt += 0.5) {
        const p = posAt(match, subject, tt);
        if (!p) { started = false; continue; }
        const [px, py] = w2p(p[0], p[1]);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = "rgba(255,255,255,.55)";
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // whole-match overview of every cast: origin dot, hit ring, connecting line
    if (state.showAll) {
      for (const c of casts) {
        if (!(c.x || c.y)) continue;
        const col = RESULT_COLOR[c.result];
        const [sx, sy] = w2p(c.x, c.y);
        ctx.globalAlpha = c.t <= t ? 0.85 : 0.25;
        if (c.hitX != null) {
          const [hx, hy] = w2p(c.hitX, c.hitY);
          ctx.strokeStyle = col;
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath(); ctx.arc(hx, hy, 4 * dpr, 0, Math.PI * 2); ctx.stroke();
        } else if (c.yaw != null) {
          const a = (c.yaw * Math.PI) / 180;
          const [ex, ey] = w2p(c.x + Math.cos(a) * 900, c.y + Math.sin(a) * 900);
          ctx.strokeStyle = col;
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        }
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(sx, sy, 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // recent casts: aim ray + hit marker
    for (const c of casts) {
      const age = t - c.t;
      if (age < 0 || age > RAY_FADE) continue;
      const alpha = 1 - age / RAY_FADE;
      const col = RESULT_COLOR[c.result];
      if (c.x || c.y) {
        const [sx, sy] = w2p(c.x, c.y);
        ctx.globalAlpha = alpha;
        if (c.yaw != null) {
          const a = (c.yaw * Math.PI) / 180;
          const [ex, ey] = w2p(c.x + Math.cos(a) * RAY_LEN, c.y + Math.sin(a) * RAY_LEN);
          const grad = ctx.createLinearGradient(sx, sy, ex, ey);
          grad.addColorStop(0, col);
          grad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.strokeStyle = grad;
          ctx.lineWidth = 3 * dpr;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        }
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(sx, sy, 3.5 * dpr, 0, Math.PI * 2); ctx.fill();
        if (c.hitX != null && c.hitT <= t) {
          const [hx, hy] = w2p(c.hitX, c.hitY);
          ctx.strokeStyle = col;
          ctx.lineWidth = 2.5 * dpr;
          ctx.beginPath(); ctx.arc(hx, hy, 9 * dpr * (0.6 + 0.4 * alpha), 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([2 * dpr, 3 * dpr]);
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.globalAlpha = 1;
      }
    }

    // recent kills
    for (const k of match.kills) {
      const age = t - k[0];
      if (age < 0 || age > 4) continue;
      const p = posAt(match, k[1], k[0] - 0.5);
      if (!p) continue;
      const [px, py] = w2p(p[0], p[1]);
      const s = 7 * dpr;
      ctx.globalAlpha = 1 - age / 4;
      ctx.strokeStyle = "#ff5a4a";
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); ctx.moveTo(px - s, py - s); ctx.lineTo(px + s, py + s);
      ctx.moveTo(px + s, py - s); ctx.lineTo(px - s, py + s); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // heroes (subject last so it's on top)
    dots = [];
    const order = [...match.players].sort((a, b) => (a.pawn === subject) - (b.pawn === subject));
    for (const p of order) {
      const pos = posAt(match, p.pawn, t);
      const hp = hpAt(match, p.pawn, t);
      if (!pos || !hp || hp.hp <= 0) continue;
      const [px, py] = w2p(pos[0], pos[1]);
      const isSub = p.pawn === subject;
      const r = (isSub ? 15 : 11) * dpr;
      dots.push({ p, px, py, r });
      // ring
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.arc(px, py, r + 3 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = TEAM_COLOR[p.team] || "#999";
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); ctx.arc(px, py, r + 1.5 * dpr, 0, Math.PI * 2); ctx.stroke();
      // health arc
      const f = hp.max ? hp.hp / hp.max : 0;
      ctx.strokeStyle = f > 0.5 ? "#6fd08c" : f > 0.25 ? "#e0b25a" : "#d9644f";
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath(); ctx.arc(px, py, r + 5 * dpr, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
      // icon
      const hero = assets.hero(p.hero_id);
      const icon = img(hero.minimap || hero.icon, redraw);
      ctx.save();
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.clip();
      if (icon?.complete && icon.naturalWidth) ctx.drawImage(icon, px - r, py - r, r * 2, r * 2);
      else { ctx.fillStyle = TEAM_COLOR[p.team]; ctx.fill(); }
      ctx.restore();
      if (isSub) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.arc(px, py, r + 8.5 * dpr, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  canvas.addEventListener("click", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const k = canvas.width / rect.width;
    const mx = (ev.clientX - rect.left) * k, my = (ev.clientY - rect.top) * k;
    const hit = dots.slice().reverse().find((d) => Math.hypot(d.px - mx, d.py - my) <= d.r + 4);
    if (hit) onPick?.(hit.p);
  });
  canvas.addEventListener("mousemove", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const k = canvas.width / rect.width;
    const mx = (ev.clientX - rect.left) * k, my = (ev.clientY - rect.top) * k;
    const hit = dots.slice().reverse().find((d) => Math.hypot(d.px - mx, d.py - my) <= d.r + 4);
    canvas.title = hit ? `${hit.p.name} (${assets.hero(hit.p.hero_id).name})` : "";
    canvas.style.cursor = hit ? "pointer" : "default";
  });
  const ro = new ResizeObserver(redraw);
  ro.observe(canvas);

  return {
    update(next) { state = { ...state, ...next }; draw(); },
    destroy: () => ro.disconnect(),
  };
}
