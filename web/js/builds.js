// Hero builds (merged in from Build Shitter): look up any build by ID, or every build a player
// published, and copy the in-game share string. Unlike the rest of the site this needs the
// internet: builds come from deadlock-api.com, straight into the browser (CORS is open), and are
// cached in IndexedDB (js/builds/store.js). Items, heroes, prices and tooltips come from the
// game files like everywhere else.
//
//   #/builds                    look up a build ID / player
//   #/build/<id>[/v/<n>]        a build (latest or an old version); from a match also
//                               ?hero=&author=&name=&origin= to recognize private copies
//   #/builds/<account>          redirects to the player page's builds tab (#/player/<id>?tab=builds)

import { $, S, esc, itemHelp } from "./ui.js";
import { Cooldown, getBuild, getPlayer, parseAccount, withMeta, getProfile } from "./builds/api.js";

const app = () => $("#app");
let renderId = 0; // drops results of navigations that were superseded
let current = null; // build page: { hero, selected: Set<item id> }

// ------------------------------------------------------------------ helpers

const fmtSouls = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));
const TIERS = ["", "I", "II", "III", "IV", "V"];
const heroName = (hid) => S.assets.hero(hid).name;
const price = (it) => (it?.tier ? S.assets.prices?.[it.tier] ?? 0 : 0);
const pageUrl = (hash) => `${location.origin}${location.pathname}${hash}`;
// "#Citadel_HeroBuilds_EarlyGame" -> "Early Game"
const locName = (s) =>
  s?.startsWith("#") ? s.replace(/^#Citadel_HeroBuilds?_/i, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2") : s;
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

function toast(text) {
  document.querySelector(".bp-toast")?.remove();
  const t = document.createElement("div");
  t.className = "bp-toast";
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 1600);
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(`${label} copied`);
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const message = (text, cls = "bp-loading") => { app().innerHTML = `<p class="${cls}">${esc(text)}</p>`; };

// Build ID, SteamID64, SteamID3 ("player 123", "[U:1:123]") or a steamcommunity.com/profiles/ link -> hash.
export function lookupHash(raw) {
  const s = raw.trim();
  const steam = s.match(/steamcommunity\.com\/profiles\/(\d+)/)?.[1] ?? s.match(/^(?:player[:/ ]?|\[?U:1:)(\d+)\]?$/i)?.[1];
  const id = s.replace(/^#\/?(build\/)?/, "");
  if (steam && parseAccount(steam)) return `#/player/${parseAccount(steam)}?tab=builds`;
  if (/^\d{11,}$/.test(id) && parseAccount(id)) return `#/player/${parseAccount(id)}?tab=builds`; // SteamID64
  if (/^\d{1,10}$/.test(id) && Number(id) <= 0xffffffff) return `#/build/${id}`;
  // names and /id/<name> links: the player search
  return s ? `#/search?p=${encodeURIComponent(s)}` : null;
}

function go(raw) {
  const hash = lookupHash(raw);
  if (!hash) return toast("Enter a build ID, SteamID64 or Steam profile link");
  if (location.hash === hash) viewBuilds(hash.slice(2).split("/"), new URLSearchParams());
  else location.hash = hash;
}

/** the lookup box (builds landing page) */
function lookupForm(big) {
  return `<form class="bp-lookup ${big ? "big" : ""}">
    <input type="search" placeholder="Build ID, player name, Steam link or SteamID" autocomplete="off" spellcheck="false" aria-label="build ID or player">
    <button class="btn primary">${big ? "get builds" : "go"}</button>
  </form>`;
}
function wireLookup(root) {
  for (const f of root.querySelectorAll(".bp-lookup")) {
    f.addEventListener("submit", (e) => { e.preventDefault(); go(f.querySelector("input").value); });
  }
}

// "Cached 5 min ago · ↻ Refresh". One refresh per hour per build/player (per browser).
function refreshBar(root, data, refresh, onDone) {
  const bar = root.querySelector(".bp-refresh");
  if (!bar) return;
  const label = bar.querySelector("span");
  const btn = bar.querySelector("button");
  const tick = () => {
    if (!btn.isConnected) return clearInterval(timer);
    label.textContent = `Cached ${ago(data.fetched_at)}`;
    const wait = data.refresh_at - Date.now();
    btn.disabled = wait > 0;
    btn.title = wait > 0 ? `Refresh available in ${Math.ceil(wait / 60000)} min` : "Fetch the latest version from Deadlock";
  };
  const timer = setInterval(tick, 30000);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "↻ Refreshing…";
    try {
      const fresh = await refresh();
      toast("Refreshed");
      onDone(fresh);
    } catch (err) {
      if (err instanceof Cooldown) data.refresh_at = err.retryAt;
      toast(err.message ?? "Refresh failed");
      btn.textContent = "↻ Refresh";
      tick();
    }
  });
  tick();
}
const refreshHTML = `<div class="bp-refresh"><span></span><button type="button" class="btn small">↻ Refresh</button></div>`;

// ------------------------------------------------------------------ router entry

/** parts: ["builds"] | ["builds", account] | ["build", id] | ["build", id, "v", n] */
export async function viewBuilds(parts, params) {
  renderId++;
  current = null;
  if (parts[0] === "build" && parts[1]) return showBuild(parts[1], parts[2] === "v" ? parts[3] : null, params);
  if (parts[1]) {
    // a player's builds live on the player page now
    const account = parseAccount(parts[1]);
    if (account) location.replace(`#/player/${account}?tab=builds`);
    else message("Player ID must be a SteamID3 or SteamID64", "bp-error");
    return;
  }
  showHome();
}

// ------------------------------------------------------------------ landing

function showHome() {
  document.title = "Builds · DLDI";
  app().innerHTML = `
    <section class="bp-home">
      <h2>Hero builds</h2>
      <p class="muted">Paste a build ID to get its items, ability order and in-game share string.
        Or a SteamID64 / Steam profile link for every build that player published.</p>
      ${lookupForm(true)}
      <div class="bp-examples muted">try: <a href="#/build/897781">#897781 (Violet)</a> <a href="#/build/1174">#1174 (old Infernus)</a>
        <a href="#/player/93543378?tab=builds">a player's builds</a></div>
      <p class="note">Opened a demo? Every player's selected build is linked on its <b>Summary</b> scoreboard, and their names lead to their player page with all their builds.</p>
      <div class="bp-online">
        <h3>NEEDS THE INTERNET</h3>
        <ul>
          <li>Builds load from <b>deadlock-api.com</b>, which asks Valve for them, straight into this tab. Replay analysis never does this.</li>
          <li>The share string is made <b>on your computer</b>. No server of ours, no account, no tracking.</li>
          <li>Builds and players are cached in this browser for a day.</li>
        </ul>
      </div>
    </section>`;
  wireLookup(app());
  app().querySelector(".bp-lookup input")?.focus();
}

// ------------------------------------------------------------------ build page

const heroLevels = () => current?.hero?.levels || S.assets.levels || [];

// level reached at a given net worth: last level whose required souls <= total
function levelAt(souls) {
  const levels = heroLevels();
  let lvl = 0;
  for (let i = 0; i < levels.length; i++) if (levels[i][0] <= souls) lvl = i + 1;
  return lvl || null;
}

function updateSelection(root) {
  const sel = current.selected;
  for (const node of root.querySelectorAll(".bp-item[data-id]")) node.classList.toggle("selected", sel.has(Number(node.dataset.id)));
  const total = [...sel].reduce((sum, id) => sum + price(S.assets.item(id)), 0);
  const bar = root.querySelector(".bp-selbar");
  bar.hidden = sel.size === 0;
  bar.querySelector(".sel-count").textContent = `${sel.size} item${sel.size === 1 ? "" : "s"}`;
  bar.querySelector(".sel-souls").textContent = total.toLocaleString();
  bar.querySelector(".sel-level").textContent = levelAt(total) ?? "—";
}

function itemHTML(entry) {
  const id = entry.ability_id;
  const it = S.assets.item(id);
  const note = entry.annotation ? `\n📝 ${entry.annotation}` : "";
  if (!it) {
    return `<button type="button" class="bp-item missing" data-id="${id}" data-help="${esc(`Removed item\nID ${id} isn't in the current game; Deadlock hides it in this build.${note}`)}"><span class="unknown">?</span></button>`;
  }
  return `<button type="button" class="bp-item slot-${esc(it.slot || "x")}" data-id="${id}" data-tip="${esc(it.class_name)}" data-help="${esc(itemHelp(it) + note)}" aria-label="${esc(it.name)}">
    ${S.assets.itemIcon(id) ? `<img src="${esc(S.assets.itemIcon(id))}" alt="" loading="lazy" draggable="false">` : `<span class="unknown">?</span>`}
    ${it.tier ? `<span class="tier">${TIERS[it.tier] ?? it.tier}</span>` : ""}${entry.annotation ? `<span class="has-note">!</span>` : ""}
  </button>`;
}

// ability order: currency_type 2 = unlock (delta -1), 1 = ability points (delta -1/-2/-5 = upgrade tier 1/2/3)
const CUR_POINTS = 1;
const CUR_UNLOCK = 2;

// for each step: earliest level (and souls) with enough unlocks / points, buying every earlier step first
function abilityTimeline(changes) {
  const levels = heroLevels();
  const need = { [CUR_POINTS]: 0, [CUR_UNLOCK]: 0 };
  let floor = 0;
  return changes.map((s) => {
    if (!(s.currency_type in need)) return null;
    need[s.currency_type] += -(s.delta ?? 0);
    const have = { [CUR_POINTS]: 0, [CUR_UNLOCK]: 0 };
    for (let i = 0; i < levels.length; i++) {
      have[CUR_UNLOCK] += levels[i][1];
      have[CUR_POINTS] += levels[i][2];
      if (i >= floor && have[s.currency_type] >= need[s.currency_type]) {
        floor = i;
        return { level: i + 1, souls: levels[i][0] };
      }
    }
    return { level: null, souls: null };
  });
}

function abilitiesHTML(changes, heroId) {
  const rows = S.assets.signatures(heroId).map((a) => a.id).filter(Boolean);
  for (const c of changes) if (!rows.includes(c.ability_id)) rows.push(c.ability_id);
  const timeline = abilityTimeline(changes);
  const tiers = {};
  const cells = changes.map((c) => (c.currency_type === CUR_UNLOCK ? 0 : (tiers[c.ability_id] = (tiers[c.ability_id] ?? 0) + 1)));
  const body = rows.map((id, ri) => {
    const it = S.assets.item(id);
    const img = it && S.assets.itemIcon(id);
    return `<tr><th><div class="bp-abil-name" ${it ? `data-tip="${esc(it.class_name)}" data-help="${esc(it.name)}"` : ""}>
        <span class="bp-abil-icon">${img ? `<img src="${esc(img)}" alt="">` : "?"}</span>
        <span class="bp-abil-label"><small>${ri < 4 ? ri + 1 : ""}</small>${esc(it?.name ?? id)}</span></div></th>
      ${changes.map((c, i) => {
        if (c.ability_id !== id) return "<td></td>";
        const unlock = c.currency_type === CUR_UNLOCK;
        const when = timeline[i]?.level ? `\nlevel ${timeline[i].level}, ${timeline[i].souls.toLocaleString()} souls` : "";
        const help = `Step ${i + 1}: ${unlock ? "unlock" : `upgrade T${cells[i]} (${-(c.delta ?? 0)} AP)`}\n${it?.name ?? id}${when}${c.annotation ? `\n📝 ${c.annotation}` : ""}`;
        return `<td data-help="${esc(help)}"><span class="bp-pip ${unlock ? "unlock" : `t${cells[i]}`}">${unlock ? "★" : cells[i]}</span></td>`;
      }).join("")}</tr>`;
  }).join("");
  const foot = (label, cls, fn) => `<tr class="foot ${cls}"><th>${label}</th>${timeline.map((t) => `<td>${fn(t)}</td>`).join("")}</tr>`;
  return `<table class="bp-abil">${body}
    ${foot("souls", "souls-row", (t) => (t?.souls != null ? fmtSouls(t.souls) : "—"))}
    ${foot("level", "", (t) => t?.level ?? "—")}</table>`;
}

/** from a match: the demo's build header, to tell a published build from a private copy */
function demoHint(params) {
  if (!params.has("author")) return null;
  return { hero: Number(params.get("hero")), author: Number(params.get("author")), name: params.get("name") || "",
    origin: Number(params.get("origin")) || null, player: params.get("player") || "" };
}

function privateCopy(id, hint, found) {
  document.title = `${hint.name || "Private build"} · DLDI`;
  app().innerHTML = `
    <section class="bp-home">
      <h2>${esc(hint.name || "Unnamed build")}</h2>
      <p class="muted"><b>${esc(heroName(hint.hero))}</b> · build #${esc(id)}${hint.player ? ` · played by ${esc(hint.player)}` : ""}</p>
      <p class="note">This build isn't published, so it can't be looked up: it's the player's own copy, and the demo only
        has its name. ${found ? `(Build #${esc(id)} on deadlock-api is someone else's ${esc(heroName(found.hero_id))} build.)` : ""}</p>
      <div class="bp-examples">
        ${hint.origin ? `<a class="btn primary" href="#/build/${hint.origin}">the build it was copied from (#${hint.origin})</a>` : ""}
        <a class="btn" href="#/player/${hint.author}?tab=builds">builds published by its author</a>
      </div>
    </section>`;
}

async function showBuild(id, version, params, preloaded) {
  const rid = renderId;
  const hint = demoHint(params);
  if (!preloaded) message("Loading build…");
  let data;
  try {
    data = preloaded ?? withMeta((await getBuild(id, version)) ?? { value: null, fetchedAt: 0 });
  } catch (err) {
    if (rid === renderId) message(`Couldn't load build ${id}: ${err.message}`, "bp-error");
    return;
  }
  if (rid !== renderId) return;
  if (!data?.build) {
    if (hint) return privateCopy(id, hint, null);
    document.title = "Build not found · DLDI";
    return message(version ? `Build ${id} version ${version} not found` : `Build ${id} not found`, "bp-error");
  }
  const { build, share, stats } = data;
  // a private copy's id points at some other published build
  if (hint && (build.hero_id !== hint.hero || build.author_account_id !== hint.author)) return privateCopy(id, hint, build);

  const hero = S.assets.hero(build.hero_id);
  current = { hero, selected: new Set() };
  const hash = `#/build/${id}${version ? `/v/${version}` : ""}`;
  document.title = `${build.name || "Untitled build"} — ${hero.name} · DLDI`;
  const updated = build.last_updated_timestamp ? new Date(build.last_updated_timestamp * 1000).toLocaleDateString() : null;
  const cats = build.details?.mod_categories ?? [];
  const changes = build.details?.ability_order?.currency_changes ?? [];
  const maxed = changes.length ? abilityTimeline(changes).at(-1) : null;

  const root = app();
  root.innerHTML = `
    <section class="bp-hero-row">
      ${hero.card || hero.icon ? `<img class="bp-hero-img" src="${esc(hero.card || hero.icon)}" alt="${esc(hero.name)}">` : ""}
      <div class="bp-hero-text">
        <h2>${esc(build.name || "Untitled build")}</h2>
        <div class="bp-sub"><b>${esc(hero.name)}</b> · #${build.hero_build_id} v${build.version}${updated ? ` · updated ${updated}` : ""}
          · ★ ${stats.favorites.toLocaleString()} favorites
          ${build.author_account_id ? ` · by <a class="bp-author" href="#/player/${build.author_account_id}?tab=builds" data-help="The creator&#10;Their page: matches and all their builds"><img alt="" hidden><span>player ${build.author_account_id}</span></a>` : ""}</div>
        ${hint?.player ? `<p class="note bp-from-match">${esc(hint.player)} played this build in the match you came from.</p>` : ""}
        ${build.description ? `<p class="bp-desc">${esc(build.description)}</p>` : ""}
        ${version ? `<p class="note">Old version ${esc(version)}. <a href="#/build/${id}">Show latest</a></p>` : refreshHTML}
      </div>
    </section>
    <section class="bp-card">
      <div class="bp-share-head">
        <h3 class="bp-title">Share string</h3>
        <div class="bp-actions"><button type="button" class="btn primary bp-copy">copy string</button><button type="button" class="btn bp-link">copy link</button></div>
      </div>
      <textarea class="bp-string" readonly rows="3" spellcheck="false">${esc(share)}</textarea>
      <p class="muted small">In game: Builds → Import → paste.</p>
    </section>
    <section>
      <h3 class="bp-title">Items <span class="hint">hover for info · click items to total their souls and the level you'd be</span></h3>
      ${cats.length ? `<div class="bp-cats">${cats.map((cat) => {
        const mods = cat.mods ?? [];
        const souls = [...new Set(mods.map((m) => m.ability_id))].reduce((s, i) => s + price(S.assets.item(i)), 0);
        return `<div class="bp-cat">
          <div class="bp-cat-head"><h4>${esc(locName(cat.name) || "Unnamed")}${cat.optional ? `<span class="opt">optional</span>` : ""}</h4>
            ${mods.length ? `<button type="button" class="bp-cat-all bp-souls" data-help="Select / deselect all&#10;Adds up this category's items: total souls and the level you'd be at.">${fmtSouls(souls)}</button>` : ""}</div>
          ${cat.description ? `<p>${esc(cat.description)}</p>` : ""}
          <div class="bp-items">${mods.map(itemHTML).join("")}</div>
        </div>`;
      }).join("")}</div>` : `<p class="muted">No items in this build.</p>`}
    </section>
    ${changes.length ? `<section class="bp-card">
      <h3 class="bp-title"><span data-help="Ability order&#10;Each column is one step. ★ unlocks an ability, 1/2/3 are its upgrade tiers.&#10;Under each step: the souls and level at which you can first afford it, buying every earlier step first.">Ability order</span>
        ${maxed?.level ? `<span class="hint accent">maxed at level ${maxed.level} · ${maxed.souls.toLocaleString()} souls</span>` : ""}</h3>
      <div class="bp-abil-wrap">${abilitiesHTML(changes, build.hero_id)}</div>
    </section>` : ""}
    <div class="bp-selbar" hidden>
      <span class="sel-count"></span>
      <span class="bp-souls sel-souls"></span>
      <span data-help="Level&#10;The hero level you reach at this many souls (net worth).">Level <b class="sel-level"></b></span>
      <button type="button" class="btn small sel-clear">clear</button>
    </div>`;

  if (build.author_account_id) {
    getProfile(build.author_account_id).then((p) => {
      const a = root.querySelector(".bp-author");
      if (!p || !a?.isConnected) return;
      if (p.name) a.querySelector("span").textContent = p.name;
      if (p.avatar) Object.assign(a.querySelector("img"), { src: p.avatar, hidden: false });
    }).catch(() => {});
  }
  root.querySelector(".bp-string").addEventListener("focus", (e) => e.target.select());
  root.querySelector(".bp-copy").addEventListener("click", () => copy(share, "Share string"));
  root.querySelector(".bp-link").addEventListener("click", () => copy(pageUrl(hash), "Link"));
  const onClick = (e) => {
    if (!current) return;
    const item = e.target.closest(".bp-item[data-id]");
    if (item) {
      const iid = Number(item.dataset.id);
      current.selected.has(iid) ? current.selected.delete(iid) : current.selected.add(iid);
      return updateSelection(root);
    }
    const cat = e.target.closest(".bp-cat-all");
    if (cat) {
      const ids = [...cat.closest(".bp-cat").querySelectorAll(".bp-item[data-id]")].map((n) => Number(n.dataset.id));
      const allIn = ids.every((x) => current.selected.has(x));
      for (const x of ids) allIn ? current.selected.delete(x) : current.selected.add(x);
      return updateSelection(root);
    }
    if (e.target.closest(".sel-clear")) {
      current.selected.clear();
      updateSelection(root);
    }
  };
  // #app outlives this page: take the listener off when the route changes
  S.cleanup?.();
  root.addEventListener("click", onClick);
  S.cleanup = () => root.removeEventListener("click", onClick);
  if (!version) {
    refreshBar(root, data, async () => withMeta(await getBuild(id, null, true)), (fresh) => { renderId++; showBuild(id, null, params, fresh); });
  }
  updateSelection(root);
}

// ------------------------------------------------------------------ player page

const buildsText = (rows, header) =>
  [header, "", ...rows.flatMap((b) => [`# ${heroName(b.hero_id)} — ${b.name || "Untitled build"} (v${b.version}) ${pageUrl(`#/build/${b.id}`)}`, b.share, ""])].join("\n");

/** a player's published builds, into `root` (the player page's builds tab) */
export async function renderPlayerBuilds(root, account, preloaded) {
  const rid = ++renderId;
  if (!preloaded) root.innerHTML = `<p class="bp-loading">Loading builds…</p>`;
  let data;
  try {
    data = preloaded ?? withMeta(await getPlayer(account));
  } catch (err) {
    if (rid === renderId && root.isConnected) root.innerHTML = `<p class="bp-error">Couldn't load builds: ${esc(err.message)}</p>`;
    return;
  }
  if (rid !== renderId || !root.isConnected) return;
  const counts = {};
  for (const b of data.builds) counts[b.hero_id] = (counts[b.hero_id] ?? 0) + 1;

  root.innerHTML = `
    <section class="bp-p-head">
      <div>
        <div class="bp-sub"><b class="bp-total"></b></div>
        ${refreshHTML}
      </div>
      <div class="bp-actions"><button type="button" class="btn primary bp-copy-all">copy shown</button><button type="button" class="btn bp-dl">download all (.txt)</button></div>
    </section>
    <section class="bp-filters">
      <input type="search" class="bp-q" placeholder="search name or description">
      <select class="bp-hero" aria-label="hero"><option value="">All heroes (${data.builds.length})</option>
        ${Object.keys(counts).sort((x, y) => heroName(x).localeCompare(heroName(y))).map((hid) => `<option value="${hid}">${esc(heroName(hid))} (${counts[hid]})</option>`).join("")}</select>
      <select class="bp-sort" aria-label="sort"><option value="updated">Recently updated</option><option value="favorites">Most favorites</option><option value="hero">Hero</option><option value="name">Name</option></select>
      <span class="bp-count"></span>
    </section>
    <p class="note">Newest builds can take a while to show up in this list. Opening a build by ID adds it right away.</p>
    <div class="bp-plist"></div>`;
  const q = root.querySelector(".bp-q"), heroSel = root.querySelector(".bp-hero"), sortSel = root.querySelector(".bp-sort");
  const visible = () => {
    const needle = q.value.trim().toLowerCase();
    const rows = data.builds.filter((b) => (!heroSel.value || String(b.hero_id) === heroSel.value) && (!needle || `${b.name}\n${b.description}`.toLowerCase().includes(needle)));
    const by = sortSel.value;
    return rows.sort((x, y) => by === "favorites" ? y.favorites - x.favorites
      : by === "hero" ? heroName(x.hero_id).localeCompare(heroName(y.hero_id)) || (y.updated ?? 0) - (x.updated ?? 0)
      : by === "name" ? x.name.localeCompare(y.name)
      : (y.updated ?? 0) - (x.updated ?? 0));
  };
  let shown = [];
  // older builds (often outdated, or deleted in game: deadlock-api keeps those) are hidden behind a
  // button at the end of the list; each press adds the next age group (a month, 3 months, half a
  // year, a year) and moves the button below it
  const DAY = 86400;
  const AGES = [[30, "a month"], [91, "3 months"], [182, "half a year"], [365, "a year"]];
  const now = Date.now() / 1000;
  const ageLevel = (b) => (b.updated == null ? 0 : AGES.filter(([d]) => b.updated < now - d * DAY).length);
  let reveal = 0; // age groups shown: 0 = only builds updated in the last month
  const row = (b, i) => {
    const hero = S.assets.hero(b.hero_id);
    return `<div class="bp-prow">
      ${hero.icon ? `<img class="bp-p-hero" src="${esc(hero.icon)}" alt="" data-help="${esc(hero.name)}" loading="lazy">` : `<span class="bp-p-hero"></span>`}
      <div class="bp-p-main">
        <a class="bp-p-name" href="#/build/${b.id}">${esc(b.name || "Untitled build")}</a>
        <div class="bp-p-meta">${esc(hero.name)} · #${b.id} v${b.version}${b.updated ? ` · ${new Date(b.updated * 1000).toLocaleDateString()}` : ""}${b.favorites ? ` · ★ ${b.favorites.toLocaleString()}` : ""}</div>
        ${b.description ? `<div class="bp-p-desc">${esc(b.description)}</div>` : ""}
      </div>
      <button type="button" class="btn primary" data-copy="${i}">copy</button>
    </div>`;
  };
  const draw = () => {
    const rows = visible();
    const byLevel = AGES.map(() => []).concat([[]]);
    for (const b of rows) byLevel[ageLevel(b)].push(b);
    // skip empty groups: the button always adds something
    while (reveal < AGES.length && !byLevel.slice(0, reveal + 1).some((x) => x.length)) reveal++;
    shown = byLevel.slice(0, reveal + 1).flat();
    const next = byLevel.findIndex((x, lvl) => lvl > reveal && x.length);
    const hidden = rows.length - shown.length;
    // header: the player's builds as far as they're revealed (filters aside)
    const all = data.builds.length, olderAll = data.builds.filter((b) => ageLevel(b) > reveal).length;
    root.querySelector(".bp-total").textContent = `${all - olderAll} build${all - olderAll === 1 ? "" : "s"}${olderAll ? ` · ${olderAll} older hidden` : ""}`;
    root.querySelector(".bp-count").textContent = `${shown.length} build${shown.length === 1 ? "" : "s"}${hidden ? ` · ${hidden} older hidden` : ""}`;
    root.querySelector(".bp-plist").innerHTML = (shown.map(row).join("") || (next < 0 ? `<p class="muted">No builds match.</p>` : ""))
      + (next > 0 ? `<button type="button" class="btn bp-more" data-reveal="${next}">show ${byLevel[next].length} more not updated in over ${AGES[next - 1][1]}</button>` : "");
  };
  root.querySelector(".bp-plist").addEventListener("click", (e) => {
    const more = e.target.closest("[data-reveal]");
    if (more) { reveal = Number(more.dataset.reveal); draw(); return; }
    const b = shown[e.target.closest("[data-copy]")?.dataset.copy];
    if (b) copy(b.share, `“${b.name || "Untitled"}”`);
  });
  q.addEventListener("input", draw);
  heroSel.addEventListener("change", draw);
  sortSel.addEventListener("change", draw);
  root.querySelector(".bp-dl").addEventListener("click", () =>
    download(`deadlock-builds-${data.account_id}.txt`, buildsText(data.builds, `# Deadlock builds by account ${data.account_id} (${data.builds.length})`)));
  root.querySelector(".bp-copy-all").addEventListener("click", () => {
    const rows = visible();
    copy(buildsText(rows, `# Deadlock builds by account ${data.account_id}`), `${rows.length} builds`);
  });
  refreshBar(root, data, async () => withMeta(await getPlayer(account, true)), (fresh) => renderPlayerBuilds(root, account, fresh));
  draw();
}

