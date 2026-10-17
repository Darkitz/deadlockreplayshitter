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
export const k1 = (n) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

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

const SLOT_NAME = { weapon: "Weapon", vitality: "Vitality", spirit: "Spirit" };
/** hover text for an item icon: name, then slot / tier */
export function itemHelp(it) {
  if (!it) return "";
  const meta = [it.slot && `${SLOT_NAME[it.slot] || it.slot} item`, it.tier && `tier ${it.tier}`].filter(Boolean).join(" · ");
  return meta ? `${it.name}\n${meta}` : it.name;
}

// ------------------------------------------------------------------ in-game style tooltips

// data/tips.json (tools/ability_tips.py): description, stats, spirit scaling and upgrade tiers
// for every ability and item. Loaded on the first hover; the markup in it is generated at build
// time from the game's localization (only <b class>, <i> and <br>).
let TIPS = null;
let tipsLoading = null;
export function loadTips() {
  tipsLoading ??= fetch("data/tips.json").then((r) => r.json()).then((j) => (TIPS = j)).catch(() => { tipsLoading = null; });
  return tipsLoading;
}
export const hasTip = (cls) => !!TIPS?.[cls];
const AREA = { active: "Active", passive: "Passive", innate: null };
const TIER_COST = [1, 2, 5];

/** the tooltip body for one ability / item: `tier` = upgrades unlocked (null: unknown),
 *  `ours` = extra lines under it (`stats`: they are this match's numbers) */
export function tipHTML(cls, tier, ours = [], stats = false) {
  const tp = TIPS?.[cls];
  const it = S.assets?.byClass?.get(cls);
  if (!tp) return null;
  const chips = tp.head.map(([k, v]) => `<span class="gt-chip"><small>${esc(k)}</small>${esc(v)}</span>`).join("");
  const sec = tp.sections.map((x) => `
    <div class="gt-sec">
      ${AREA[x.area] ? `<div class="gt-area gt-${x.area}">${AREA[x.area]}</div>` : ""}
      ${x.desc ? `<p class="gt-desc">${x.desc}</p>` : ""}
      ${x.main.length ? `<div class="gt-main">${x.main.map(([k, v, sc]) => `
        <div class="gt-box"><b>${esc(v)}</b><span>${esc(k)}</span>${sc ? `<em class="gt-scale gt-${esc(sc[1].split(" ")[0])}">×${sc[0]} ${esc(sc[1])}</em>` : ""}</div>`).join("")}</div>` : ""}
      ${x.basic.length ? `<div class="gt-basic">${x.basic.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join("")}</div>` : ""}
    </div>`).join("");
  const tiers = tp.tiers ? `<div class="gt-tiers">${tp.tiers.map((d, i) => `
    <div class="gt-tier ${tier == null ? "" : i < tier ? "on" : "off"}"><span class="gt-cost" title="ability points">${TIER_COST[i]}</span><p>${d || "—"}</p></div>`).join("")}</div>` : "";
  return `<div class="gt">
    <div class="gt-head"><b class="gt-name">${esc(it?.name || cls)}</b>${chips ? `<div class="gt-chips">${chips}</div>` : ""}</div>
    ${sec}${tiers}
    ${ours.length ? `<div class="gt-ours ${stats ? "stats" : ""}">${ours.map((l) => `<div>${esc(l)}</div>`).join("")}</div>` : ""}
  </div>`;
}

/** icon buttons; `extra` adds the stat badge, `help` the hover text (name, then what the numbers mean) */
export function abilityButtons(list, selected, extra = () => "", help = (ab) => ab.name) {
  return list.map((ab) => `
    <button class="ab ${ab.class_name === selected ? "on" : ""}" data-ability="${esc(ab.class_name)}" data-tip="${esc(ab.class_name)}" aria-label="${esc(ab.name)}" data-help="${esc(help(ab))}">
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
