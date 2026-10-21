// What the players you follow did lately, one line each (the Following page): matches (played
// together when several of them were in one) and builds created / updated. From the match
// histories and build lists deadlock-api has; the last DAYS days.

import { esc, S, ago } from "./ui.js";
import { fmtClock } from "./timeline.js";
import { getProfiles, getPlayer } from "./builds/api.js";
import { loadHistory } from "./sync.js";

const DAYS = 5;
const MODE = { 1: "an unranked", 2: "a private", 3: "a bot", 4: "a ranked", 7: "a Hero Labs" };
const SHOWN = 40;

/** fills `el` with the activity of `accs` (account ids) */
export async function renderActivity(el, accs) {
  el.innerHTML = `<p class="muted small">Loading activity from deadlock-api…</p>`;
  const since = Date.now() / 1000 - DAYS * 86400;
  const [profiles, histories, builds] = await Promise.all([
    getProfiles(accs).catch(() => ({})),
    Promise.all(accs.map((a) => loadHistory(a).catch(() => []))),
    Promise.all(accs.map((a) => getPlayer(a).then((e) => e.value.builds).catch(() => []))),
  ]);
  const who = (a) => `<a class="ac-who" href="#/player/${a}">${profiles[a]?.avatar ? `<img src="${esc(profiles[a].avatar)}" alt="">` : ""}${esc(profiles[a]?.name || a)}</a>`;
  const hero = (id) => esc(S.assets.hero(id).name);
  const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const local = new Set((S.localMatches || []).map((m) => m.match_id));
  const matchLink = (id, text) => `<a href="${local.has(id) ? `#/match/${id}` : `#/search?m=${id}`}">${text}</a>`;

  const events = [];
  // matches: one line per match, with everyone you follow who played it
  const byMatch = new Map();
  histories.forEach((rows, k) => {
    for (const r of rows) {
      if ((r.start_time || 0) < since) continue;
      if (!byMatch.has(r.match_id)) byMatch.set(r.match_id, []);
      byMatch.get(r.match_id).push({ acc: accs[k], ...r });
    }
  });
  for (const [id, ps] of byMatch) {
    const r = ps[0];
    const mode = MODE[r.match_mode] || "a";
    const won = (p) => p.match_result === p.player_team;
    const len = fmtClock(r.match_duration_s || 0);
    let text;
    if (ps.length === 1) {
      text = `${who(r.acc)} played ${matchLink(id, `${mode} match`)} as ${hero(r.hero_id)} and <b class="${won(r) ? "good" : "bad"}">${won(r) ? "won" : "lost"}</b> in ${len} <span class="muted">· ${r.player_kills}/${r.player_deaths}/${r.player_assists}</span>`;
    } else {
      const teams = [...new Set(ps.map((p) => p.player_team))];
      if (teams.length === 1) {
        text = `${list(ps.map((p) => who(p.acc)))} played ${matchLink(id, `${mode} match`)} together as ${list(ps.map((p) => hero(p.hero_id)))} and <b class="${won(r) ? "good" : "bad"}">${won(r) ? "won" : "lost"}</b> in ${len}`;
      } else {
        const w = ps.filter(won), l = ps.filter((p) => !won(p));
        text = `${list(w.map((p) => `${who(p.acc)} (${hero(p.hero_id)})`))} <b class="good">beat</b> ${list(l.map((p) => `${who(p.acc)} (${hero(p.hero_id)})`))} in ${matchLink(id, `${mode} match`)} · ${len}`;
      }
    }
    events.push({ t: r.start_time, kind: ps.length > 1 ? "together" : "match", text });
  }
  // builds changed in the window: version 1 is new, later versions are updates (the publish time
  // moves with every version). Busy authors (several a day) get one line per day.
  builds.forEach((rows, k) => {
    const byDay = new Map();
    for (const b of rows) {
      const t = b.updated ?? b.published;
      if (!t || t < since) continue;
      const day = new Date(t * 1000).toDateString();
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push({ ...b, t });
    }
    for (const day of byDay.values()) {
      if (day.length > 2) {
        const heroes = [...new Set(day.map((b) => hero(b.hero_id)))];
        const created = day.filter((b) => b.version === 1).length;
        events.push({ t: Math.max(...day.map((b) => b.t)), kind: "build",
          text: `▤ ${who(accs[k])} ${created === day.length ? "created" : created ? `created ${created} and updated` : "updated"} <a href="#/player/${accs[k]}?tab=builds">${created && created < day.length ? day.length - created : day.length} builds</a>: ${heroes.slice(0, 6).join(", ")}${heroes.length > 6 ? ` +${heroes.length - 6}` : ""}` });
        continue;
      }
      for (const b of day) {
        const link = `<a href="#/build/${b.id}">“${esc(b.name || "Untitled build")}”</a>`;
        events.push({ t: b.t, kind: "build",
          text: `▤ ${who(accs[k])} ${b.version === 1 ? "created a new" : "updated their"} ${hero(b.hero_id)} build ${link}` });
      }
    }
  });
  events.sort((a, b) => b.t - a.t);
  if (!el.isConnected) return;
  if (!events.length) { el.innerHTML = `<p class="muted">Nothing in the last ${DAYS} days.</p>`; return; }
  const line = (e, i) => `<li class="ac-${e.kind} ${i >= SHOWN ? "extra" : ""}"><span class="ac-t" title="${new Date(e.t * 1000).toLocaleString()}">${ago(new Date(e.t * 1000))}</span><span>${e.text}</span></li>`;
  el.innerHTML = `<ol class="ac-log">${events.map(line).join("")}</ol>${events.length > SHOWN ? `<button class="sr-more" data-ac-more>show all ${events.length}</button>` : ""}`;
  el.querySelector("[data-ac-more]")?.addEventListener("click", (ev) => { el.classList.add("all"); ev.target.remove(); });
}
