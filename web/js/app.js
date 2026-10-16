// Skill Hitter: data loading, header, router, sync button.
//
// Matches are the main entity; players lead to matches.
//   #/                                   all parsed matches
//   #/match/<id>?pawn=&ability=&from=&t=  match detail (minimap + timeline + tracker)
//   #/player/<account>                   a player's performance across parsed matches
//   #/player/<account>/hero/<id>?ability= per-hero ability analysis (tracked accounts)
//   #/hero/<id>                          legacy: hero page of the current player

import { loadJSON, Assets, clearCache, setDataVersion } from "./data.js";
import { $, esc, S, fmtDate, TZ, settings, saveSettings } from "./ui.js";
import { viewOverview } from "./overview.js";
import { viewMatch } from "./match.js";
import { viewHome } from "./home.js";
import { viewPlayer } from "./player.js";

async function loadAll() {
  S.accounts = await loadJSON("data/accounts.json").catch(() => []);
  const [assets, profiles, valveStats, matchList, ...indexes] = await Promise.all([
    loadJSON("data/assets.json"),
    loadJSON("data/profiles.json").catch(() => ({})),
    loadJSON("data/valve-stats.json").catch(() => ({})),
    loadJSON("data/matches.json").catch(() => []),
    ...S.accounts.map((a) => loadJSON(`data/index-${a.account_id}.json`).catch(() => null)),
  ]);
  S.assets = new Assets(assets);
  S.profiles = profiles;
  S.valveStats = valveStats;
  S.matchList = matchList;
  S.indexes = {};
  for (const idx of indexes) if (idx) S.indexes[idx.account_id] = idx;
  S.careers = {};
  const first = S.indexes[settings.account] || Object.values(S.indexes)[0];
  setDataVersion(Math.max(0, ...Object.values(S.indexes).map((i) => i.parser_version || 0)));
  await useAccount(first?.account_id);
  renderHeader();
}

/** make `acc` the current tracked player (S.index / S.career) */
async function useAccount(acc) {
  if (!acc || !S.indexes[acc]) return false;
  S.index = S.indexes[acc];
  if (!S.careers[acc]) S.careers[acc] = await loadJSON(`data/career-${acc}.json`).catch(() => []);
  S.career = S.careers[acc];
  if (settings.account !== acc) {
    settings.account = acc;
    saveSettings();
  }
  return true;
}

function renderHeader() {
  const sw = $("#account-switch");
  sw.hidden = !S.accounts.length;
  sw.innerHTML = `<option value="">players…</option>` + S.accounts.map((a) =>
    `<option value="${a.account_id}">${esc(a.name)} · ${a.parsed} demos</option>`).join("");
  sw.onchange = () => {
    if (sw.value) location.hash = `#/player/${sw.value}`;
    sw.value = "";
  };
  const parsed = S.matchList.length;
  const failed = Object.values(S.indexes).flatMap((i) => i.health?.failed || []);
  const warned = new Set(Object.values(S.indexes).flatMap((i) => i.health?.warned || []));
  const version = Math.max(0, ...Object.values(S.indexes).map((i) => i.parser_version || 0)) || null;
  $("#health").innerHTML = `parser v${version ?? "?"} · ${parsed} demos parsed` +
    (failed.length ? ` · <b class="bad">${failed.length} failed to parse</b> (a game patch may need <code>tools/update-parser.sh</code>)` : "") +
    (warned.size ? ` · ${warned.size} with warnings` : "");
  const synced = Math.max(0, ...Object.values(S.indexes).map((i) => i.generated || 0));
  $("#subtitle").textContent = `${parsed} parsed matches · ${S.accounts.length} tracked player${S.accounts.length === 1 ? "" : "s"}` +
    (synced ? ` · synced ${fmtDate(new Date(synced * 1000))} (${TZ})` : "");
}

// ------------------------------------------------------------------ router

async function route() {
  S.cleanup?.();
  S.cleanup = null;
  const [path, q] = location.hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(q || "");
  const parts = (path || "/").split("/").filter(Boolean);
  window.scrollTo({ top: 0 });
  for (const a of document.querySelectorAll("[data-nav]")) a.classList.toggle("on", a.dataset.nav === (parts[0] || "matches"));

  if (parts[0] === "match" && parts[1]) {
    const id = Number(parts[1]);
    // analyze from the point of view of a tracked player in this match, if any
    const inMatch = S.matchList.find((m) => m.match_id === id)?.players.map((p) => p.account_id) || [];
    if (!inMatch.includes(S.index?.account_id)) {
      const tracked = inMatch.find((a) => S.indexes[a]);
      if (tracked) await useAccount(tracked);
    }
    S.view = "match";
    await viewMatch(id, params);
  } else if (parts[0] === "player" && parts[1]) {
    const acc = Number(parts[1]);
    const tracked = await useAccount(acc);
    if (parts[2] === "hero" && parts[3] && tracked) {
      S.view = "overview";
      await viewOverview(Number(parts[3]), params);
    } else {
      S.view = "player";
      await viewPlayer(acc, params);
    }
  } else if (parts[0] === "hero" && parts[1] && S.index) {
    location.replace(`#/player/${S.index.account_id}/hero/${parts[1]}${q ? `?${q}` : ""}`);
  } else {
    S.view = "home";
    await viewHome(params);
  }
  // deep link to a section: ?section=report|tracker|incoming|gun|career|...
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

// ------------------------------------------------------------------ sync button (only with tools/serve.py)

async function initSync() {
  let status;
  try {
    const r = await fetch("api/status");
    if (!r.ok) return;
    status = await r.json();
  } catch { return; }
  const btn = $("#sync");
  const log = $("#sync-log");
  btn.hidden = false;
  S.syncAvailable = true;
  const show = (s) => {
    btn.disabled = s.running;
    btn.textContent = s.running ? "syncing…" : "sync";
    btn.title = s.last_finished ? `last sync ${fmtDate(new Date(s.last_finished * 1000))} (exit ${s.last_exit})` : "";
    log.textContent = (s.log || []).slice(-12).join("\n");
    log.hidden = !s.running;
  };
  show(status);
  let wasRunning = status.running;
  const poll = async () => {
    try {
      const s = await (await fetch("api/status")).json();
      show(s);
      if (wasRunning && !s.running) { await clearCache(); await loadAll(); route(); }
      wasRunning = s.running;
    } catch { /* server gone */ }
  };
  setInterval(poll, 2500);
  btn.addEventListener("click", async () => {
    await fetch("api/sync", { method: "POST" });
    wasRunning = true;
    poll();
  });
}

async function main() {
  try {
    await loadAll();
  } catch (err) {
    $("#subtitle").textContent = `failed to load data: ${err.message}. Run tools/sync.py first.`;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
  initSync();
}

main();
