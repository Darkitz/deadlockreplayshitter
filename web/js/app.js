// DLDI (Deadlock Demo Insight): a static site. Drop a Deadlock demo, it is parsed in the browser
// (WebAssembly build of parser/dlparse) and analyzed right there. No server, no accounts.
//
//   #/                                    drop a demo · demos opened in this browser
//   #/match/<id>?pawn=&ability=&from=&t=   one match: minimap + timeline + tracker
//   #/about                               how every number is derived

import { loadJSON, Assets, TEAM_NAMES } from "./data.js";
import { $, S } from "./ui.js";
import { viewMatch } from "./match.js";
import { viewHome } from "./home.js";
import { viewAbout, explain } from "./explain.js";
import { initDropZone, localList } from "./local.js";
import { initLang, helpLabel, helpText } from "./lang.js";

async function loadAll() {
  const [assets, local] = await Promise.all([loadJSON("data/assets.json"), localList()]);
  S.assets = new Assets(assets);
  Object.assign(TEAM_NAMES, assets.teams || {});
  S.localMatches = local;
}

// ------------------------------------------------------------------ router

async function route() {
  S.cleanup?.();
  S.cleanup = null;
  const [path, q] = location.hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(q || "");
  const parts = (path || "/").split("/").filter(Boolean);
  window.scrollTo({ top: 0 });
  for (const a of document.querySelectorAll("[data-nav]")) a.classList.toggle("on", a.dataset.nav === (parts[0] || "home"));

  if (parts[0] === "match" && parts[1]) {
    S.view = "match";
    await viewMatch(Number(parts[1]), params);
  } else if (parts[0] === "about") {
    S.view = "about";
    viewAbout($("#app"), params);
  } else {
    S.view = "home";
    viewHome();
  }
  // deep link to a section: ?section=tracker|incoming|laning (&solo=1 hides the rest)
  const section = params.get("section");
  document.body.classList.toggle("solo", !!section && params.get("solo") === "1");
  if (section) {
    for (const el of document.querySelectorAll(".solo-target")) el.classList.remove("solo-target");
    document.getElementById(section)?.classList.add("solo-target");
    scrollToSection(section);
  }
}

/** sections that render asynchronously appear a bit later; poll briefly */
function scrollToSection(id, tries = 40) {
  const el = document.getElementById(id);
  if (el && el.childElementCount && !el.querySelector(":scope > .muted:only-child")) {
    el.scrollIntoView({ block: "start" });
    return;
  }
  if (tries > 0) setTimeout(() => scrollToSection(id, tries - 1), 150);
}

// ------------------------------------------------------------------ hover help
// Tile labels, table headers and anything with data-help get an explanation on hover. Labels
// are looked up in explain.js, so new tiles with a known label get help for free.
const HELP_SEL = "[data-help]:not(.rem-btn), .tile .k, th";

function helpFor(el) {
  if (el.dataset.help) return el.dataset.help;
  return explain(helpLabel(el));
}

function initHelp() {
  const tip = document.createElement("div");
  tip.className = "help-tip";
  tip.hidden = true;
  document.body.append(tip);
  // mark explained labels (dotted underline) whenever a view renders
  const mark = () => {
    for (const el of document.querySelectorAll(HELP_SEL)) {
      if (el.classList.contains("has-help") || el.dataset.helpChecked) continue;
      el.dataset.helpChecked = "1";
      if (helpFor(el)) el.classList.add("has-help");
    }
  };
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; mark(); });
  }).observe(document.body, { childList: true, subtree: true });
  let cur = null;
  document.addEventListener("mouseover", (ev) => {
    const el = ev.target.closest?.(".has-help, [data-help]");
    if (el === cur) return;
    cur = el;
    const text = el && helpFor(el);
    if (!text) { tip.hidden = true; return; }
    tip.textContent = helpText(text);
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 16);
    tip.style.maxWidth = `${w}px`;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    tip.style.left = `${left + window.scrollX}px`;
    const below = r.bottom + 6 + tip.offsetHeight < window.innerHeight;
    tip.style.top = `${(below ? r.bottom + 6 : r.top - 6 - tip.offsetHeight) + window.scrollY}px`;
  });
  window.addEventListener("scroll", () => { tip.hidden = true; cur = null; }, { passive: true });
}

// ------------------------------------------------------------------ Rem

/** "Could you maybe stop doing that?" — Rem's answer, from the game files */
function initRem() {
  const btn = $("#rem-btn");
  const src = S.assets?.ui?.rem;
  if (!btn || !src) { if (btn) btn.hidden = true; return; }
  btn.addEventListener("click", () => {
    const a = new Audio(src);
    a.volume = 0.8;
    a.play().catch(() => {});
    btn.classList.remove("rem-wiggle");
    void btn.offsetWidth; // restart the animation
    btn.classList.add("rem-wiggle");
  });
}

// ------------------------------------------------------------------ light / dark

function initTheme() {
  const btn = $("#theme-toggle");
  const apply = (theme) => {
    const light = theme === "light";
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", light ? "light" : "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f4f5f7" : "#0a0b0d");
    btn.textContent = light ? "☾" : "☀";
    btn.title = light ? "switch to dark" : "switch to light";
  };
  apply(document.documentElement.dataset.theme);
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    try { localStorage.setItem("skillhitter.theme", next); } catch { /* private mode: this page only */ }
    apply(next);
  });
}

async function main() {
  initTheme();
  console.info("%cDLDI is AI slop", "font-weight:bold;color:#e2b34f", "— written almost entirely by an AI. Found a bug? It's probably real.");
  // offline support (web/sw.js); not available on file:// or in some private modes
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    // a new version took over (old tabs were served by the previous worker): reload once
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
  }
  try {
    await loadAll();
  } catch (err) {
    $("#app").innerHTML = `<div class="empty">Failed to load game data (${err.message}).</div>`;
    return;
  }
  initHelp();
  initRem();
  initDropZone();
  initLang();
  window.addEventListener("hashchange", route);
  route();
}

main();
