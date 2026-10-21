// A player: Steam name + avatar (from deadlock-api), and two tabs: their last matches (with demo
// sync, js/sync.js) and the builds they published (js/builds.js). Plus (finding players
// is js/search.js), and #/following: you + the players you follow with one merged match feed.
//
//   #/player/<account id>[?tab=matches|builds]
//   #/following

import { $, esc, S } from "./ui.js";
import { getProfile, getProfiles } from "./builds/api.js";
import { renderPlayerBuilds } from "./builds.js";
import { renderMatches } from "./sync.js";
import { storedAccount, setStoredAccount, isFollowed, setFollowed, people, toAccount } from "./account.js";

const STEAM64_BASE = 76561197960265728n;

export async function viewPlayer(acc, params) {
  const app = $("#app");
  const tab = params.get("tab") === "builds" ? "builds" : "matches";
  // a name from demos opened in this browser until Steam's answers
  const known = (S.localMatches || []).flatMap((m) => m.players || []).find((p) => String(p.account_id) === String(acc));
  const steam64 = String(BigInt(acc) + STEAM64_BASE);
  app.innerHTML = `
    <section class="pl-head">
      <img class="pl-avatar" alt="" hidden>
      <div class="pl-text">
        <h2 class="pl-name">${esc(known?.name || `Player ${acc}`)}</h2>
        <div class="muted small pl-sub">
          account ${esc(acc)} · <a href="https://steamcommunity.com/profiles/${steam64}" target="_blank" rel="noopener">Steam profile</a>
          · <button class="chip-s pl-me" data-help="Remember as you&#10;Stored in this browser only. Your avatar in the top bar then leads to you and the players you follow.">${storedAccount() === String(acc) ? "this is you · forget" : "this is me"}</button>
          ${storedAccount() === String(acc) ? "" : `<button class="chip-s pl-follow ${isFollowed(acc) ? "on" : ""}" data-help="Follow&#10;Their matches join yours on the Following page. Stored in this browser only.">${isFollowed(acc) ? "★ following" : "☆ follow"}</button>`}
        </div>
      </div>
    </section>
    <nav class="view-switch" role="tablist">
      <a class="tab ${tab === "matches" ? "on" : ""}" href="#/player/${esc(acc)}?tab=matches">Matches</a>
      <a class="tab ${tab === "builds" ? "on" : ""}" href="#/player/${esc(acc)}?tab=builds">Builds</a>
      <span class="muted small pl-source" data-help="deadlock-api&#10;deadlock-api.com: a free community API for Deadlock data (not Valve, not us). Your browser asks it directly; replay analysis never does.">from deadlock-api.com</span>
    </nav>
    <section class="pl-body"></section>`;
  document.title = `${known?.name || `Player ${acc}`} · DLDI`;
  $(".pl-me", app).addEventListener("click", (ev) => {
    const mine = storedAccount() === String(acc);
    setStoredAccount(mine ? null : String(acc));
    ev.currentTarget.textContent = mine ? "this is me" : "this is you · forget";
  });
  $(".pl-follow", app)?.addEventListener("click", (ev) => {
    const on = !isFollowed(acc);
    setFollowed(acc, on);
    ev.currentTarget.classList.toggle("on", on);
    ev.currentTarget.textContent = on ? "★ following" : "☆ follow";
  });
  getProfile(acc).then((p) => {
    if (!p || !$(".pl-head", app)) return;
    if (p.name) {
      $(".pl-name", app).textContent = p.name;
      document.title = `${p.name} · DLDI`;
    }
    if (p.avatar_full || p.avatar) Object.assign($(".pl-avatar", app), { src: p.avatar_full || p.avatar, hidden: false });
  }).catch(() => {});
  const body = $(".pl-body", app);
  if (tab === "builds") renderPlayerBuilds(body, acc);
  else renderMatches(body, acc);
}

/** what the search box got: an account (open it), a vanity name (/id/<name>), or a name */
export function parsePlayerQuery(raw) {
  const s = String(raw || "").trim();
  const profile = s.match(/steamcommunity\.com\/profiles\/(\d+)/)?.[1] ?? s.match(/^\[?U:1:(\d+)\]?$/i)?.[1];
  if (profile && toAccount(profile)) return { acc: toAccount(profile) };
  const vanity = s.match(/steamcommunity\.com\/id\/([^/?#\s]+)/)?.[1];
  if (vanity) return { vanity: decodeURIComponent(vanity) };
  if (/^\d{1,20}$/.test(s) && toAccount(s)) return { acc: toAccount(s) };
  return s ? { name: s } : null;
}

const followBtn = (acc) => storedAccount() === String(acc) ? `<span class="chip-s on">you</span>`
  : `<button class="chip-s pl-follow ${isFollowed(acc) ? "on" : ""}" data-follow="${esc(acc)}">${isFollowed(acc) ? "★ following" : "☆ follow"}</button>`;

/** Following: you and the players you follow, with one merged feed of their last matches */
export async function viewFollowing(params) {
  const app = $("#app");
  const accs = people();
  const me = storedAccount();
  document.title = "Following · DLDI";
  app.innerHTML = `<div class="pl-page">
    <h2 class="pl-name">Following</h2>
    <p class="muted small">You and the players you follow, with their last matches in one list. Find players with <a href="#/search">Search</a>.</p>
    <section class="fl-people">${accs.map((a) => `
      <a class="fl-chip" href="#/player/${a}" data-acc="${a}"><img alt="" hidden><span>${a === me ? "you" : esc(a)}</span>${a === me ? "" : `<button class="fl-unfollow" data-unfollow="${a}" data-help="Unfollow">×</button>`}</a>`).join("")
      || `<p class="muted">Nobody yet. Find someone with <a href="#/search">Search</a> (or click a name on a match scoreboard) and press ☆ follow; remember yourself with “this is me” on your own page. Kept in this browser only.</p>`}</section>
    <section class="pl-body"></section></div>`;
  $(".pl-page", app).addEventListener("click", (ev) => {
    const un = ev.target.closest("[data-unfollow]");
    const fo = ev.target.closest("[data-follow]");
    if (!un && !fo) return;
    ev.preventDefault();
    if (un) { setFollowed(un.dataset.unfollow, false); viewFollowing(params); return; }
    const on = !isFollowed(fo.dataset.follow);
    setFollowed(fo.dataset.follow, on);
    fo.classList.toggle("on", on);
    fo.textContent = on ? "★ following" : "☆ follow";
  });
  getProfiles(accs).then((ps) => {
    for (const chip of app.querySelectorAll(".fl-chip")) {
      const p = ps[chip.dataset.acc];
      if (!p) continue;
      if (p.avatar) Object.assign(chip.querySelector("img"), { src: p.avatar, hidden: false });
      if (p.name) chip.querySelector("span").textContent = chip.dataset.acc === me ? `${p.name} (you)` : p.name;
    }
  }).catch(() => {});
  if (accs.length) renderMatches($(".pl-body", app), accs);
}
