// A player: Steam name + avatar (from deadlock-api), and two tabs: their last matches (with demo
// sync, js/sync.js) and the builds they published (js/builds.js). Plus #/following: you and the
// players you follow, with one merged match feed.
//
//   #/player/<account id>[?tab=matches|builds]
//   #/following

import { $, esc, S } from "./ui.js";
import { getProfile, getProfiles } from "./builds/api.js";
import { renderPlayerBuilds } from "./builds.js";
import { renderMatches } from "./sync.js";
import { storedAccount, setStoredAccount, isFollowed, setFollowed, people } from "./account.js";

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
          ${storedAccount() === String(acc) ? "" : `<button class="chip-s pl-follow ${isFollowed(acc) ? "on" : ""}" data-help="Follow&#10;Their matches join yours on the Following page (top bar). Stored in this browser only.">${isFollowed(acc) ? "★ following" : "☆ follow"}</button>`}
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

/** you and the players you follow: who they are, and one merged feed of their last matches */
export async function viewFollowing() {
  const app = $("#app");
  const accs = people();
  const me = storedAccount();
  document.title = "Following · DLDI";
  app.innerHTML = `
    <section class="pl-head"><div class="pl-text">
      <h2 class="pl-name">Following</h2>
      <div class="muted small">${me ? "You and the players you follow" : "Players you follow"}: their last matches in one list.
        Follow someone with ☆ on their player page (scoreboard names lead there). Kept in this browser only.</div>
    </div></section>
    <section class="fl-people">${accs.map((a) => `
      <a class="fl-chip" href="#/player/${a}" data-acc="${a}"><img alt="" hidden><span>${a === me ? "you" : esc(a)}</span>${a === me ? "" : `<button class="fl-unfollow" data-unfollow="${a}" data-help="Unfollow">×</button>`}</a>`).join("")
      || `<p class="muted">Nobody yet. Open a player's page (click a name on a match scoreboard) and press ☆ follow, or remember yourself with “this is me”.</p>`}</section>
    <section class="pl-body"></section>`;
  $(".fl-people", app).addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-unfollow]");
    if (!b) return;
    ev.preventDefault();
    setFollowed(b.dataset.unfollow, false);
    viewFollowing();
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
