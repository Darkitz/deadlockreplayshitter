// Skill Hitter: data loading, header, router, sync button.
//   #/                       overview for the default hero
//   #/hero/<id>              overview for a hero
//   #/match/<id>?pawn=&ability=   match detail (minimap + timeline)

import { loadJSON, Assets } from "./data.js";
import { $, esc, S, fmtDate, fmtDay, TZ, settings, saveSettings } from "./ui.js";
import { viewOverview } from "./overview.js";
import { viewMatch } from "./match.js";

async function loadAll() {
  S.accounts = await loadJSON("data/accounts.json").catch(() => []);
  const fromUrl = Number(new URLSearchParams(location.search).get("account"));
  const ids = S.accounts.map((a) => a.account_id);
  const acc = [fromUrl, settings.account].find((a) => a && ids.includes(a)) ?? ids[0];
  const [index, assets, profiles, career] = await Promise.all([
    acc ? loadJSON(`data/index-${acc}.json`) : loadJSON("data/index.json"),
    loadJSON("data/assets.json"),
    loadJSON("data/profiles.json").catch(() => ({})),
    loadJSON(acc ? `data/career-${acc}.json` : "data/career.json").catch(() => []),
  ]);
  S.career = career;
  S.index = index;
  S.assets = new Assets(assets);
  S.profiles = profiles;
  renderHeader();
}

function renderHeader() {
  const prof = S.index.profile || {};
  const acc = S.index.account_id;
  $("#avatar").src = prof.avatar || "";
  $("#avatar").hidden = !prof.avatar;
  $("#player-name").textContent = prof.name || `account ${acc}`;
  $("#steam-link").href = prof.url || `https://steamcommunity.com/profiles/${BigInt(acc) + 76561197960265728n}/`;
  $("#steam-link").textContent = "steam profile ↗";
  const sw = $("#account-switch");
  sw.hidden = (S.accounts || []).length < 2;
  sw.innerHTML = (S.accounts || []).map((a) =>
    `<option value="${a.account_id}" ${a.account_id === acc ? "selected" : ""}>${esc(a.name)} · ${a.parsed} demos</option>`).join("");
  sw.onchange = async () => {
    settings.account = Number(sw.value);
    saveSettings();
    await loadAll();
    location.hash = "#/";
    route();
  };
  const parsed = S.index.matches.filter((m) => m.parsed).length;
  const lastRanked = S.index.matches.filter((m) => m.badge).sort((a, b) => b.start_time - a.start_time)[0];
  const rank = lastRanked && S.assets.ranks[lastRanked.badge];
  $("#rank").innerHTML = rank ? `<img src="${esc(rank.image)}" alt=""><span>${esc(rank.name)}</span>` : "";
  $("#rank").title = rank ? `latest ranked badge (${fmtDay(new Date(lastRanked.start_time * 1000))})` : "";
  const h = S.index.health;
  $("#health").innerHTML = h
    ? `parser v${S.index.parser_version} · ${h.parsed} demos parsed` +
      (h.failed.length ? ` · <b class="bad">${h.failed.length} failed to parse</b> (a game patch may need <code>tools/update-parser.sh</code>)` : "") +
      (h.warned.length ? ` · ${h.warned.length} with warnings` : "")
    : "";
  $("#subtitle").textContent =
    `${S.index.matches.length} matches · ${parsed} with demo · synced ${fmtDate(new Date(S.index.generated * 1000))} (${TZ})`;
}

// ------------------------------------------------------------------ router

async function route() {
  S.cleanup?.();
  S.cleanup = null;
  const [path, q] = location.hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(q || "");
  const parts = (path || "/").split("/").filter(Boolean);
  window.scrollTo({ top: 0 });
  if (parts[0] === "match" && parts[1]) {
    S.view = "match";
    await viewMatch(Number(parts[1]), params);
  } else {
    S.view = "overview";
    await viewOverview(parts[0] === "hero" ? Number(parts[1]) : undefined, params);
  }
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
      if (wasRunning && !s.running) { await loadAll(); route(); }
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
    const h = S.index.health;
  $("#health").innerHTML = h
    ? `parser v${S.index.parser_version} · ${h.parsed} demos parsed` +
      (h.failed.length ? ` · <b class="bad">${h.failed.length} failed to parse</b> (a game patch may need <code>tools/update-parser.sh</code>)` : "") +
      (h.warned.length ? ` · ${h.warned.length} with warnings` : "")
    : "";
  $("#subtitle").textContent = `failed to load data: ${err.message}. Run tools/sync.py first.`;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
  initSync();
}

main();
