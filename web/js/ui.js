// Shared state, settings, formatting and small widgets.

export const $ = (sel, el = document) => el.querySelector(sel);
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ------------------------------------------------------------------ settings (per browser)

export const settings = {
  window: 3,
  heroesOnly: true,
  speed: 30,
  showAll: false,
  feed: "all",
  ...readStore("skillhitter.settings"),
};
function readStore(k) {
  try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; }
}
export function saveSettings() {
  try { localStorage.setItem("skillhitter.settings", JSON.stringify(settings)); } catch { /* private mode */ }
}
export const opts = () => ({ window: settings.window, heroesOnly: settings.heroesOnly });

// ------------------------------------------------------------------ formatting

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

/** assets: game data · localMatches: demos parsed in this browser · pickDemo: open the file picker */
export const S = { assets: null, localMatches: [], view: null };

// ------------------------------------------------------------------ shared widgets

export function tile(k, v, cls = "") {
  return `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

export function controlsHTML() {
  return `
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
      settings[k] = el.type === "checkbox" ? el.checked : Number(el.value);
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

// ------------------------------------------------------------------ navigation

export function setParams(patch) {
  const [path, q] = location.hash.slice(1).split("?");
  const p = new URLSearchParams(q || "");
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) p.delete(k); else p.set(k, v);
  }
  location.hash = `${path}?${p}`;
}
