// How every number on the site is derived. Used for hover help (looked up by the label shown on
// a tile or table header) and for the #/about page. Keep the wording close to the code in
// analysis.js / the parser; when a definition changes there, change it here too.

import { MELEE_REACH_M, AIMED_AT_DEG } from "./analysis.js";

export const SECTIONS = [
  {
    title: "Where the data comes from",
    items: [
      ["demo", "Demo", "The replay file you drop: a .dem from Deadlock's replays folder (in-game: Download Replay) or a .dem.bz2 from Valve's replay servers. It is parsed in your browser by dlparse compiled to WebAssembly; nothing is uploaded. Casts, damage, shots, melee swings, parries, buffs, items and positions (every 0.5 s) all come from it."],
      ["game time", "Game time", "Seconds since the match horn, from the server tick minus pauses. Matches the in-game clock."],
      ["point / span", "Point / span", "Point: every number covers the match start up to the playhead. Span: only events between the two handles count (e.g. 10:00 to 20:00)."],
    ],
  },
  {
    title: "Abilities",
    items: [
      ["thrown", "Thrown", "Casts of the ability: each ImportantAbilityUsed message the server sent. Older demos without it fall back to cooldown starts."],
      ["hit heroes", "Hit heroes", "Casts followed by damage (or a debuff notification) on an enemy hero from this ability within the hit window. The window ends early when the next cast starts. Ally buffs and self-hits don't count. For melee: swings followed within 0.6 s by melee damage on an enemy hero."],
      ["hit", "Hit", "Casts that hit an enemy hero, or anything (troopers, neutrals, objectives) when \"heroes only\" is off."],
      ["hit non-hero", "Hit non-hero", "Casts that damaged something within the window, but no enemy hero."],
      ["missed", "Missed", "Casts that damaged nothing within the hit window."],
      ["accuracy", "Accuracy", "Hit ÷ thrown. With \"heroes only\" (the default) only enemy-hero hits count."],
      ["skill%", "Skill %", "Signature-ability casts that hit an enemy hero ÷ casts, this match. Abilities that never connect with anything (pure buffs, movement) are left out. The best value (5+ casts) is underlined."],
      ["skill hit %", "Skill hit %", "Signature-ability casts that hit an enemy hero ÷ casts, in the current point or span."],
      ["skills thrown", "Skills thrown", "Signature-ability casts in the current point or span."],
      ["damage", "Damage", "Damage this ability dealt within the hit windows of its casts (all victims except allies)."],
      ["hits → kills", "Hits → kills", "Hero hits whose victim died within 10 s of the first hit, out of all hero hits."],
      ["ready → recast", "Ready → recast", "Average time the ability sat off cooldown before the next cast. Lower means it was used as soon as it was ready."],
      ["hit window", "Hit window", "How long after a cast damage still counts for it. Longer for slow projectiles or damage over time."],
      ["aim error", "Aim error (miss · N° off)", "For misses: the angle between the cast's view direction and the enemy hero closest to that line (within 80 m). Shown on the map as a ray."],
      ["dodge rate", "Dodge rate", `Enemy casts aimed at this player (within ${AIMED_AT_DEG}° of them) that missed them, out of all such casts.`],
    ],
  },
  {
    title: "Gun",
    items: [
      ["shots fired", "Shots fired", "Trigger pulls: each increase of the weapon's shot counter (m_nShotNumber)."],
      ["shots", "Shots", "Trigger pulls in the current point or span."],
      ["bullets", "Bullets", "Shots × pellets per shot from the weapon's game data (shotguns fire several). Matches Valve's bullet totals."],
      ["shots hit heroes", "Shots hit heroes", "Shots paired with bullet damage on an enemy hero. Damage packets from one tick claim the oldest unpaired shot of the last 1.5 s, so projectile travel time is covered."],
      ["shots hit troopers", "Shots hit troopers", "Shots whose bullet damage landed only on troopers, neutrals, objectives or crates."],
      ["hero accuracy", "Hero accuracy", "Hero hits ÷ (shots − shots that hit only NPCs). Shots spent on troopers aren't attempts at heroes, so they leave the denominator. Close to Valve's own end-of-match hero accuracy."],
      ["hit rate (all shots)", "Hit rate (all shots)", "Hero hits ÷ all shots, troopers included."],
      ["headshots", "Headshots", "Hero hits whose damage landed on the head hitgroup or carried crit damage (matches Valve's crit count)."],
      ["hero headshot %", "Hero headshot %", "Headshots ÷ hero hits."],
      ["hero hs %", "Hero HS %", "Headshots ÷ hero hits in the current point or span."],
    ],
  },
  {
    title: "Melee",
    items: [
      ["swings", "Swings", "Melee attacks: each new trigger time on the melee ability. Light and heavy come from the attack type the game reports."],
      ["light swings", "Light swings", "Quick melee attacks."],
      ["heavy swings", "Heavy swings", "Charged melee attacks (both heavy variants)."],
      ["at heroes", "At heroes / hero melees", `Swings with a living enemy hero within ${MELEE_REACH_M} m when the swing started (measured by the parser from exact positions), plus any swing that hit or got parried by a hero. These are the attacks.`],
      ["hero melees", "Hero melees", `Swings with a living enemy hero within ${MELEE_REACH_M} m, or that hit or got parried by one.`],
      ["at npcs", "At NPCs", `No enemy hero in reach, but a trooper, neutral, objective, crate or soul orb within ${MELEE_REACH_M} m: farming, pushing or securing souls.`],
      ["movement", "Movement", `Nothing to hit within ${MELEE_REACH_M} m: melee used to move (the heavy-melee lunge or the light-melee hop).`],
      ["hero melee accuracy", "Hero melee accuracy", "Hero hits ÷ hero melees. Swings at NPCs and movement swings stay out of the denominator."],
      ["acc", "Acc", "Hero hits ÷ swings at heroes."],
      ["whiff", "Whiff", "Swings at heroes that neither hit nor got parried."],
      ["got parried", "Got parried", "Own swings an enemy parried: a successful parry by an enemy within 8 m that started up to 0.6 s after the swing."],
      ["parried", "Parried", "Swings an enemy parried."],
      ["parries", "Parries", "Successful parries ÷ parry attempts by this player. The feed shows the enemy swing each one caught (light or heavy)."],
      ["melee → hero", "Melee → hero", "Per player in the current point or span: light hero hits ÷ light hero melees · heavy hero hits ÷ heavy hero melees · own swings that got parried."],
      ["dmg", "Dmg", "Melee damage dealt (heroes and NPCs)."],
    ],
  },
  {
    title: "Players, fights and positioning",
    items: [
      ["k / d / a", "K / D / A", "Kills, deaths and assists up to the playhead (in a span: during it), from the player's stats every 10 s."],
      ["souls", "Souls", "Net worth at the playhead."],
      ["level", "Level", "Hero level at the playhead."],
      ["fights", "Fights", "Kills grouped together when less than 15 s apart. The score is kills per team."],
      ["team souls lead", "Team souls lead", "Amber's total net worth minus Sapphire's, every 10 s."],
      ["heat", "Heat (map)", "Where the selected player spent time while alive in the current point or span (positions every 0.5 s)."],
      ["deaths", "Deaths (map)", "Every hero death in the current point or span, crossed in team color."],
      ["incoming", "Incoming", `Enemy casts aimed at this player (within ${AIMED_AT_DEG}° of them): how many hit them and how many they dodged.`],
      ["hp", "HP", "Health and max health at the playhead (max includes items and buffs)."],
      ["chat", "Chat", "Typed chat from the demo, split into each team's chat and all chat, plus chat-wheel pings (toggle). The ping text comes from the game's own chat-wheel messages; the hero or lane a ping refers to (\"Kelvin is missing\", \"Defend the Broadway Walker\") is read from the voice line it played. Lines after the playhead are dimmed; click one to jump there."],
    ],
  },
];

const BY_KEY = new Map();
for (const s of SECTIONS) for (const [k, label, text] of s.items) BY_KEY.set(k.trim(), { label, text });

/** help text for a label as shown on the page ("Hero accuracy", "Light swings 12", ...) or null */
export function explain(label) {
  const t = String(label || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (BY_KEY.has(t)) return BY_KEY.get(t).text;
  let best = null;
  for (const [k, v] of BY_KEY) {
    if (t.startsWith(k + " ") && (!best || k.length > best[0].length)) best = [k, v];
  }
  return best ? best[1].text : null;
}

/** long-form walkthroughs for the derived numbers that need more than a hover */
export const DEEP_DIVES = [
  {
    id: "melee",
    title: "Melee in depth: what each swing was for",
    body: `
      <p>Every melee swing gets two labels: what it was <b>for</b> (intent) and what <b>came of it</b> (outcome).
      Hero melee accuracy only counts swings that were plausibly attacks on a hero, so farming troopers or
      melee-hopping across the map doesn't drag it down.</p>
      <h4>1. Finding swings</h4>
      <p>The hero's melee ability sets a new <code>m_flAttackTriggeredTime</code> on every attack. Each change is one
      swing. <code>m_eCurrentAttackType</code> says light (1) or heavy (2 and 3; 3 is a heavy variant).</p>
      <h4>2. Measuring the surroundings</h4>
      <p>When the swing starts, the parser looks at every entity in the demo and records two distances (3D, exact,
      not the 0.5 s position samples):</p>
      <ul>
        <li><b>Nearest living enemy hero.</b></li>
        <li><b>Nearest non-allied target:</b> troopers, neutral camps, guardians, walkers, the patron, shrines, the
        mid boss, sentries, Sinner's Sacrifice, breakable crates and <b>soul orbs</b> (either team's, since both sides
        hit them to secure or deny).</li>
      </ul>
      <p>The class list was checked against every damage victim in real demos: 99.8&nbsp;% of melee swings that damaged
      an NPC had one of these within ${MELEE_REACH_M} m.</p>
      <h4>3. Intent</h4>
      <ol>
        <li><b>At heroes</b> (a "hero melee") when an enemy hero was within <b>${MELEE_REACH_M} m</b>, or when the swing hit
        a hero or got parried by one. In real demos the median hero hit started 2.9 m away and 95&nbsp;% within 6.6 m
        (heavy lunges cover distance), so ${MELEE_REACH_M} m catches the attempts without counting far-off swings.</li>
        <li><b>At NPCs</b> when no enemy hero was within ${MELEE_REACH_M} m but a trooper, crate, orb or objective was.</li>
        <li><b>Movement</b> when nothing hittable was within ${MELEE_REACH_M} m. Players melee to move: the heavy melee lunges
        forward, and a light melee keeps momentum. These swings start while the player is already moving fast:
        median 8.0 m/s for light movement swings against 4.7 m/s for light swings at heroes (heavy: 6.9 against 5.0).</li>
      </ol>
      <p>Across the parsed demos about 12&nbsp;% of swings are at heroes, 65&nbsp;% at NPCs and 23&nbsp;% movement.</p>
      <h4>4. Outcome</h4>
      <ul>
        <li><b>Hit</b>: melee damage on an enemy hero within 0.6 s of the swing (ends early if the next swing starts).</li>
        <li><b>Parried</b>: an enemy's successful parry (their <code>m_bAttackParried</code>) within 8 m, from 0.6 s
        before to 0.2 s after their parry flag flips. The closest swing in time gets the blame.</li>
        <li><b>Hit NPC</b>: melee damage only on non-heroes.</li>
        <li><b>Whiff</b>: no damage and no parry.</li>
      </ul>
      <h4>5. The numbers</h4>
      <ul>
        <li><b>Hero melee accuracy</b> = hero hits ÷ hero melees, per light and heavy.</li>
        <li><b>Got parried</b> = own swings an enemy parried, also as a share of hero melees.</li>
        <li><b>Parries</b> = own successful parries ÷ attempts; the feed shows which enemy swing each one caught.</li>
        <li><b>Melee use %</b> = share of swings at heroes · at NPCs · movement.</li>
      </ul>
      <h4>Limits</h4>
      <ul>
        <li>Intent is inferred from what was in reach. A swing toward a hero 11 m away counts as movement or NPC.
        A movement swing that happens to pass an enemy within ${MELEE_REACH_M} m counts as a hero melee.</li>
        <li>Demos parsed before parser version 12 have no measured distances. Hero distance then comes from the
        0.5 s position samples and NPCs are only known when they were hit.</li>
        <li>Parries against trooper attacks or abilities have no enemy swing to pair with. They still count as
        successful parries but the feed shows no attacker.</li>
      </ul>
      <p>Hover a swing in the melee feed of a match for its own step-by-step breakdown.</p>`,
  },
  {
    id: "gun",
    title: "Gun accuracy in depth",
    body: `
      <p>Server demos don't record which bullet hit what, so shots and hits are paired after the fact.</p>
      <ol>
        <li><b>Shots</b>: each increase of the weapon's <code>m_nShotNumber</code> is one trigger pull. Shotguns
        fire several pellets per pull (from the weapon's game data), so bullets = shots × pellets.</li>
        <li><b>Hits</b>: bullet damage packets from the same server tick are grouped (one pull, several pellets or
        targets). Each group claims the <b>oldest unclaimed shot of the last 1.5 s</b>, which covers projectile
        travel time.</li>
        <li><b>What it hit</b>: a group with an enemy hero is a hero hit, a headshot if any packet hit the head.
        A group with only troopers, neutrals or objectives is an NPC shot.</li>
        <li><b>Hero accuracy</b> = hero hits ÷ (shots − NPC shots). A shot spent on a trooper was not an attempt at a
        hero, so it leaves the denominator. On single-bullet guns this lands within about 2 points of Valve's own
        end-of-match hero accuracy.</li>
      </ol>`,
  },
];

export function viewAbout(app, params) {
  app.innerHTML = `
    <section class="about">
      <h2>How the numbers are made</h2>
      <p class="muted">Everything is computed in your browser from the demo alone. Hover any underlined label on the site for the same text.</p>
      <nav class="about-toc">${[...DEEP_DIVES.map((d) => [d.id, d.title]), ...SECTIONS.map((x, i) => [`s${i}`, x.title])]
        .map(([id, t]) => `<a href="#/about?s=${id}" data-jump="${id}">${t}</a>`).join("")}</nav>
      ${DEEP_DIVES.map((d) => `<div class="about-sec deep" id="about-${d.id}"><h3>${d.title}</h3>${d.body}</div>`).join("")}
      ${SECTIONS.map((s, i) => `
        <div class="about-sec" id="about-s${i}">
          <h3>${s.title}</h3>
          <dl>${s.items.map(([, label, text]) => `<dt>${label}</dt><dd>${text}</dd>`).join("")}</dl>
        </div>`).join("")}
    </section>`;
  const jump = params?.get("s");
  if (jump) requestAnimationFrame(() => document.getElementById(`about-${jump}`)?.scrollIntoView());
}
