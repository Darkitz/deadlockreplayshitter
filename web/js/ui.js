// Shared state, settings, formatting and small widgets used by every view.

export const $ = (sel, el = document) => el.querySelector(sel);
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ------------------------------------------------------------------ settings

export const settings = {
  window: 3,
  heroesOnly: true,
  speed: 30,
  showAll: false,
  feed: "all",
  ...readStore("skillhitter.settings"),
};
export function readStore(k) {
  try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; }
}
export function saveSettings() {
  try { localStorage.setItem("skillhitter.settings", JSON.stringify(settings)); } catch { /* private mode */ }
}
export const opts = () => ({ window: settings.window, heroesOnly: settings.heroesOnly });

/** game-time window applied across matches ([from, to] seconds, or null = whole match) */
export const GAME_WINDOWS = [["", "whole match"], ["0-600", "0–10 min"], ["600-1200", "10–20 min"],
  ["1200-1800", "20–30 min"], ["1800-99999", "30+ min"]];
export const gameWindow = () => {
  const v = settings.gameWindow;
  if (!v) return null;
  const [a, b] = v.split("-").map(Number);
  return [a, b];
};
export const inWindow = (t, w = gameWindow()) => !w || (t >= w[0] && t < w[1]);

// ------------------------------------------------------------------ time formatting (system tz)

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const fmtDate = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
export const fmtDay = (d) => fmtDate(d).slice(0, 10);
export const ago = (d) => {
  const s = (Date.now() - d.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 86400 * 60) return rtf.format(-Math.round(s / 86400), "day");
  return rtf.format(-Math.round(s / (86400 * 30)), "month");
};
export const k1 = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ------------------------------------------------------------------ state

export const S = { index: null, assets: null, profiles: {}, career: [], view: null };

/** history entry of a match for the current tracked player, else any tracked player */
export const entry = (id) => S.index?.matches.find((m) => m.match_id === id)
  || Object.values(S.indexes || {}).map((i) => i.matches.find((m) => m.match_id === id)).find(Boolean);

// ------------------------------------------------------------------ shared widgets

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];
/** tier emblem with the subrank numeral on top, like the in-game badge */
export function rankBadge(r, large = false) {
  if (!r?.image) return "";
  return `<span class="rank-badge ${large ? "lg" : ""}"><img src="${esc(large && r.image_lg ? r.image_lg : r.image)}" alt="">${r.subrank ? `<i>${ROMAN[r.subrank] || r.subrank}</i>` : ""}</span>`;
}

export function rankChip(e) {
  const r = e?.badge && S.assets.ranks[e.badge];
  if (!r) return "";
  const d = e.rank_delta ? ` <span class="${e.rank_delta > 0 ? "up" : "down"}">${e.rank_delta > 0 ? "+" : ""}${e.rank_delta}</span>` : "";
  return `<span class="rank-chip" title="${esc(r.name)}">${rankBadge(r)}${d}</span>`;
}

export function tile(k, v, cls = "") {
  return `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

export function controlsHTML(withWindow = true) {
  return `${withWindow ? `
    <label>game time
      <select data-set="gameWindow">
        ${GAME_WINDOWS.map(([v, l]) => `<option value="${v}" ${(settings.gameWindow || "") === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </label>` : ""}
    <label>Hit window
      <select data-set="window">
        ${[1, 2, 3, 5, 8].map((w) => `<option value="${w}" ${w === settings.window ? "selected" : ""}>${w} s</option>`).join("")}
      </select>
    </label>
    <label class="check"><input type="checkbox" data-set="heroesOnly" ${settings.heroesOnly ? "checked" : ""}> heroes only</label>`;
}

export function wireControls(root, onChange) {
  for (const el of root.querySelectorAll("[data-set]")) {
    el.addEventListener("change", () => {
      const k = el.dataset.set;
      settings[k] = el.type === "checkbox" ? el.checked : k === "gameWindow" ? el.value : Number(el.value);
      saveSettings();
      onChange();
    });
  }
}

export function abilityButtons(list, selected, extra = () => "") {
  return list.map((ab) => `
    <button class="ab ${ab.class_name === selected ? "on" : ""}" data-ability="${esc(ab.class_name)}" title="${esc(ab.name)}">
      ${ab.image ? `<img src="${esc(ab.image)}" alt="">` : `<span class="ab-ph">${esc((ab.name || "?")[0])}</span>`}
      <span class="ab-name">${esc(ab.name)}</span>${extra(ab)}
    </button>`).join("");
}

export function histogram(values, bins, width, unit) {
  const b = new Array(bins).fill(0);
  for (const v of values) b[Math.min(bins - 1, Math.floor(v / width))]++;
  const max = Math.max(1, ...b);
  return b.map((n, i) => `<span class="hb" title="${i * width}–${i === bins - 1 ? "∞" : (i + 1) * width} ${unit}: ${n}"><span style="height:${(n / max) * 100}%"></span></span>`).join("");
}

// ------------------------------------------------------------------ navigation

export function go(hash) { location.hash = hash; }

export function setParams(patch) {
  const [path, q] = location.hash.slice(1).split("?");
  const p = new URLSearchParams(q || "");
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) p.delete(k); else p.set(k, v);
  }
  location.hash = `${path}?${p}`;
}

