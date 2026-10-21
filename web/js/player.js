// A player: Steam name + avatar (from deadlock-api), and two tabs: their last matches (with demo
// sync, js/sync.js) and the builds they published (js/builds.js).
//
//   #/player/<account id>[?tab=matches|builds]

import { $, esc, S } from "./ui.js";
import { getProfile } from "./builds/api.js";
import { renderPlayerBuilds } from "./builds.js";
import { renderMatches, storedAccount, setStoredAccount } from "./sync.js";

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
          · <button class="chip-s pl-me" data-help="Remember as you&#10;Stored in this browser only. Your avatar in the top bar then leads here.">${storedAccount() === String(acc) ? "this is you · forget" : "this is me"}</button>
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
