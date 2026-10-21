// Search: one page, one bar each for players (Steam name, profile link, SteamID), builds (id)
// and matches (id), all looked up on deadlock-api.
//
//   #/search[?p=<player>&b=<build id>&m=<match id>]

import { $, esc, S, ago } from "./ui.js";
import { fmtClock } from "./timeline.js";
import { TEAM_NAMES } from "./data.js";
import { getProfiles, searchPlayers, findBuild, matchInfo } from "./builds/api.js";
import { parsePlayerQuery } from "./player.js";
import { isFollowed, setFollowed, storedAccount } from "./account.js";

let renderId = 0;

const BARS = [
  ["p", "Players", "Steam name or profile link", "Name, steamcommunity.com link or SteamID"],
  ["b", "Builds", "Build id", "The number in a build's info"],
  ["m", "Matches", "Match id", "From the match history or a replay file"],
];

export async function viewSearch(params) {
  const app = $("#app");
  const rid = ++renderId;
  document.title = "Search · DLDI";
  app.innerHTML = `<div class="sr-page">
    <h2 class="sr-title">Search</h2>
    <div class="sr-tiles">${BARS.map(([k, label, ph, hint]) => `
      <form class="sr-tile sr-form" data-k="${k}">
        <label for="sr-${k}">${label}</label>
        <div class="sr-input"><span aria-hidden="true">⌕</span>
          <input id="sr-${k}" type="search" name="q" value="${esc(params.get(k) || "")}" placeholder="${ph}" autocomplete="off" spellcheck="false" ${k === "p" ? "" : 'inputmode="numeric"'}></div>
        <small>${hint}</small>
      </form>`).join("")}</div>
    <div class="sr-results">${BARS.map(([k, label]) => `<section class="sr-bar" data-k="${k}" hidden><h3 class="sr-h">${label}</h3><div class="sr-out"></div></section>`).join("")}</div>
    <p class="muted small sr-note">Everything here is looked up on <a href="https://deadlock-api.com" target="_blank" rel="noopener">deadlock-api.com</a>.
      Names only find players with recent matches; a profile link or SteamID always works.</p>
  </div>`;
  for (const form of app.querySelectorAll(".sr-form")) {
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const p = new URLSearchParams(location.hash.split("?")[1] || "");
      const v = form.q.value.trim();
      if (v) p.set(form.dataset.k, v); else p.delete(form.dataset.k);
      location.hash = `#/search${p.size ? `?${p}` : ""}`;
    });
  }
  app.querySelector(".sr-results").addEventListener("click", (ev) => {
    const more = ev.target.closest("[data-more]");
    if (more) { more.closest(".sr-out").classList.add("all"); more.remove(); return; }
    const fo = ev.target.closest("[data-follow]");
    if (!fo) return;
    ev.preventDefault();
    const on = !isFollowed(fo.dataset.follow);
    setFollowed(fo.dataset.follow, on);
    fo.classList.toggle("on", on);
    fo.textContent = fo.classList.contains("sr-star") ? (on ? "★" : "☆") : on ? "★ following" : "☆ follow";
  });
  const out = (k) => { const sec = $(`.sr-bar[data-k="${k}"]`, app); sec.hidden = false; return $(".sr-out", sec); };
  const pq = params.get("p"), bq = params.get("b"), mq = params.get("m");
  document.title = pq || bq || mq ? `${pq || bq || mq} · search · DLDI` : "Search · DLDI";
  if (!pq && !bq && !mq) $('.sr-form[data-k="p"] input', app).focus();
  if (pq) findPlayers(pq, out("p"), rid);
  if (bq) findBuildCard(bq, out("b"));
  if (mq) findMatchCard(mq, out("m"));
}

async function findPlayers(q, box, rid) {
  const parsed = parsePlayerQuery(q);
  if (parsed?.acc) { location.hash = `#/player/${parsed.acc}`; return; }
  box.innerHTML = `<p class="muted small">Searching…</p>`;
  let rows;
  try { rows = await searchPlayers(parsed.vanity || parsed.name); } catch (err) { box.innerHTML = `<p class="bad">Search failed: ${esc(err.message)}</p>`; return; }
  if (rid !== renderId) return;
  if (parsed.vanity) {
    // a /id/<name> link: the profile whose URL is exactly that
    const exact = rows.find((r) => r.url?.toLowerCase().replace(/\/$/, "").endsWith(`/id/${parsed.vanity.toLowerCase()}`));
    if (exact) { location.hash = `#/player/${exact.acc}`; return; }
  }
  box.innerHTML = rows.length ? playersHTML(rows) : `<p class="muted small">No players found for “${esc(q)}”.</p>`;
}

async function findBuildCard(q, box) {
  if (!/^\d{1,10}$/.test(q)) { box.innerHTML = `<p class="muted small">A build id is a number (in game: the build's info).</p>`; return; }
  box.innerHTML = `<p class="muted small">Looking up build ${esc(q)}…</p>`;
  const b = await findBuild(q).catch(() => null);
  box.innerHTML = b ? await buildHTML(b) : `<p class="muted small">Build ${esc(q)} isn't in deadlock-api's index. <a href="#/build/${esc(q)}">Ask Valve for it</a> (slower).</p>`;
}

async function findMatchCard(q, box) {
  if (!/^\d{1,12}$/.test(q)) { box.innerHTML = `<p class="muted small">A match id is a number.</p>`; return; }
  box.innerHTML = `<p class="muted small">Looking up match ${esc(q)}…</p>`;
  const m = await matchInfo(q).catch(() => null);
  const local = (S.localMatches || []).some((x) => String(x.match_id) === q);
  if (m && !local) {
    // a demo link, if deadlock-api knows the replay salt (no Steam request)
    const salts = await fetch(`https://api.deadlock-api.com/v1/matches/${q}/salts?disable_steam=true`).then((r) => r.json()).catch(() => null);
    m.demo_url = salts?.demo_url || null;
  }
  box.innerHTML = m ? matchHTML(m) : local ? `<p><a class="btn primary small" href="#/match/${esc(q)}">open match ${esc(q)}</a> <span class="muted small">(parsed in this browser)</span></p>`
    : `<p class="muted small">Match ${esc(q)} isn't known to deadlock-api.</p>`;
}

const section = (title, body) => `<section class="sr-section"><h3 class="section-title">${title}</h3>${body}</section>`;

function playersHTML(rows) {
  const me = storedAccount();
  return `<div class="sr-people">${rows.map((r, i) => `
    <div class="sr-person ${i >= 10 ? "extra" : ""}">
      <a href="#/player/${r.acc}">
        ${r.avatar ? `<img src="${esc(r.avatar)}" alt="" loading="lazy">` : `<span class="pl-r-ph"></span>`}
        <span><b>${esc(r.name || r.acc)}</b><small>${r.played30 != null ? `${r.played30} matches · 30 days` : `account ${esc(r.acc)}`}</small></span>
      </a>
      ${me === r.acc ? `<span class="sr-you">you</span>` : `<button class="sr-star ${isFollowed(r.acc) ? "on" : ""}" data-follow="${esc(r.acc)}" aria-label="follow" data-help="${isFollowed(r.acc) ? "Following" : "Follow"}&#10;Their matches join yours on the Following page">${isFollowed(r.acc) ? "★" : "☆"}</button>`}
    </div>`).join("")}</div>${rows.length > 10 ? `<button class="sr-more" data-more>show all ${rows.length}</button>` : ""}`;
}

async function buildHTML({ build, stats }) {
  const hero = S.assets.hero(build.hero_id);
  const author = build.author_account_id ? (await getProfiles([build.author_account_id]).catch(() => ({})))[build.author_account_id] : null;
  return `<div class="sr-card">
    <a class="sr-main" href="#/build/${build.hero_build_id}">
      ${hero.icon ? `<img src="${esc(hero.icon)}" alt="">` : ""}
      <span><b>${esc(build.name || "Untitled build")}</b><small class="muted">${esc(hero.name)} · #${build.hero_build_id} v${build.version}${stats?.favorites ? ` · ★ ${stats.favorites}` : ""}</small></span>
    </a>
    ${build.author_account_id ? `<a class="sr-author" href="#/player/${build.author_account_id}?tab=builds">${author?.avatar ? `<img src="${esc(author.avatar)}" alt="">` : ""}by ${esc(author?.name || build.author_account_id)}</a>` : ""}
  </div>`;
}

function matchHTML(m) {
  const local = (S.localMatches || []).some((x) => x.match_id === m.match_id);
  const win = m.winning_team === "Team0" ? 0 : m.winning_team === "Team1" ? 1 : null;
  const started = m.start_time ? new Date(m.start_time.replace(" ", "T") + "Z") : null;
  const team = (t) => (m.players || []).filter((p) => p.team === `Team${t}`);
  return `<div class="sr-card sr-match">
    <div class="sr-main">
      <span><b>#${m.match_id}</b><small class="muted">${started ? `${ago(started)} · ` : ""}${fmtClock(m.duration_s || 0)} · ${esc(m.match_mode || "")}</small></span>
    </div>
    ${[0, 1].map((t) => `<div class="sr-team team-${t + 2} ${win === t ? "won" : ""}">
      <span class="mc-team-name">${TEAM_NAMES[t + 2]}${win === t ? " ✓" : ""}</span>
      <span class="mc-heroes">${team(t).map((p) => `<a href="#/player/${p.account_id}"><img src="${esc(S.assets.hero(p.hero_id).icon)}" alt=""
        data-help="${esc(S.assets.hero(p.hero_id).name)}&#10;${p.kills}/${p.deaths}/${p.assists} · open their player page"></a>`).join("")}</span>
    </div>`).join("")}
    <div class="sr-act">${local ? `<a class="btn primary small" href="#/match/${m.match_id}">open</a>`
      : m.demo_url ? `<a class="btn primary small" href="${esc(m.demo_url)}" data-help="Download the demo&#10;From Valve's replay servers (plain http: your browser may ask before keeping it). Then drop it onto the page.">download demo</a><span class="muted small">then drop it onto the page</span>`
      : `<span class="muted small">No demo link known yet: “ask deadlock-api” on a player's Matches tab (click a hero) can look it up.</span>`}</div>
  </div>`;
}
