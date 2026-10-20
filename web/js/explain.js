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
      ["ability kinds", "How abilities are scored", "Every ability and active item is scored by what it's for, measured on real matches (tools/profile_abilities.py): offensive ones (damage or debuffs on enemies) by accuracy, support ones (heals, shields, buffs on teammates) by how often they reached an ally, self buffs / mobility / utility by how often they were used in a fight, passive items by how often they triggered. Effects include the buffs and debuffs the ability applied, not just damage. Abilities whose effects land late (traps, fuses, slow projectiles) get a longer hit window, measured from when their effects actually land."],
      ["reached an ally", "Reached an ally", "Uses whose heal, shield or buff landed on a teammate (not just yourself)."],
      ["allies helped", "Allies helped", "Different teammates who got the ability's effect."],
      ["only on self", "Only on self", "Uses that only affected you."],
      ["used in a fight", "Used in a fight", "Uses with an enemy hero within 25 m, or with hero damage dealt or taken within 3 s: it was used in a fight rather than to farm or travel."],
      ["triggers", "Triggers", "Passive items with a cooldown: how often it went off."],
      ["loads", "Loads", "Abilities that swap your gun for another weapon (Nurse Harrow's Healing Needles): how often it was loaded."],
      ["shots fired", "Shots fired", "Shots fired with the swapped-in weapon (Healing Needles: syringes). They heal allies, so they're kept out of gun accuracy."],
      ["time loaded", "Time loaded", "How long the swapped-in weapon was out in total, from loading until it was empty or put away."],
      ["heroes feared", "Heroes feared", "Enemy heroes that got the ability's fear (Lurking Terrors: terror built up to the max). The damage is a side effect; the fear is the point."],
      ["casts that feared someone", "Casts that feared someone", "Casts that feared at least one enemy hero."],
      ["leeches now", "Leeches now", "Leeches Nurse Harrow has collected at the playhead (each one: regen and fire rate, and longer fears). A quarter is lost on death."],
      ["most leeches held", "Most leeches held", "The most leeches she held at once up to the playhead."],
      ["leeches lost", "Leeches lost", "Leeches lost so far (deaths cost a quarter of them)."],
      ["bullets fired", "Bullets fired", "For abilities that empower your next shots (Living Ink: next 3 bullets, Slam Fire, Hellfire Salvo): the gun shots fired after the cast, up to that number and within the ability's duration (from the game files)."],
      ["bullets hit heroes", "Bullets hit heroes", "Empowered bullets whose damage reached an enemy hero. Each damage packet of the ability is credited to the latest empowered bullet fired before it (within 4 s, since the bullets can be steered)."],
      ["bullet accuracy", "Bullet accuracy", "Empowered bullets that hit an enemy hero ÷ empowered bullets fired."],
      ["casts without a hit", "Casts without a hit", "Casts where none of the empowered bullets hit anything at all."],
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
      ["team souls lead", "Team souls lead", "The first team's total net worth minus the second team's, every 10 s (green above the line: the selected player's team, or the first team when nobody is selected)."],
      ["heat", "Heat (map)", "Where the selected player spent time while alive in the current point or span (positions every 0.5 s)."],
      ["cast heatmap", "Cast heatmap (map)", "Pick an ability or active item under the map: it glows wherever it was cast in the current point or span, brighter where casts pile up. With no player selected it shows everyone's casts, otherwise only the selected player's. Positions are where the caster stood when casting (for abilities without a cast event: when the cooldown started)."],
      ["deaths", "Deaths (map)", "Every hero death in the current point or span, crossed in team color."],
      ["incoming", "Incoming", `Enemy casts aimed at this player (within ${AIMED_AT_DEG}° of them): how many hit them and how many they dodged.`],
      ["summary", "Summary", "Deadlock's post-game screen rebuilt from the demo: MVP and key players, everyone's awards, the scoreboard and graphs. Souls, kills, damage, objective damage and healing are the game's own counters read from the demo every 10 s. MVP, key players, kill types and barriers come from Valve's post-game summary, which the server writes into the demo when the match ends."],
      ["mvp", "MVP / key player", "Picked by the game itself: read from Valve's post-game summary inside the demo."],
      ["awards", "Awards (most / second most …)", "Like the game's cards: each player's top-3 placements among the 12 players for kills, ability kills, player damage, objective damage, assists, healing, souls, headshot kills, weapon kills (gun + melee) and melee kills. Ties share a place. Up to five for the MVP, two for everyone else; players without a placement show their best-ranked number."],
      ["healing", "Healing", "Healing done plus barriers given, like the in-game scoreboard. The healing graph shows healing only, every 10 s."],
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
    id: "time",
    title: "Time split: combat and movement",
    body: `
      <p>For every player, each 0.5 s they were alive gets one combat state and one movement state.
      Valve keeps the same kind of data in its match metadata (once per second). Here it is rebuilt from the demo
      alone, and on five test matches it lands within about 3–5 points of Valve's numbers for combat and within
      0–3 points for movement.</p>
      <h4>Combat (first match wins)</h4>
      <ol>
        <li><b>Fighting heroes</b>: dealt damage to an enemy hero, or took damage from one, from 1 s before to 0.5 s after.</li>
        <li><b>Fighting troopers / objectives</b>: dealt damage to troopers, guardians, walkers, the patron, shrines,
        the mid boss or soul orbs in that window.</li>
        <li><b>Farming neutrals</b>: dealt damage to neutral camps (and Sinner's Sacrifice).</li>
        <li><b>Out of combat</b>: none of that.</li>
      </ol>
      <h4>Movement</h4>
      <ul>
        <li><b>Zipline</b>: the hero's zipline lane color is set (<code>m_eZipLineLaneColor</code>). Matches Valve's number almost exactly.</li>
        <li><b>Dash</b> / <b>slide</b>: up to 0.4 s / 0.75 s after the dash or slide ability fired (or ducked while moving on the ground).</li>
        <li><b>Airborne</b>: not on the ground (<code>m_fFlags</code>), not on a zipline.</li>
        <li><b>On foot</b>: everything else. Valve also tracks "ability movement" (dashing abilities like
        Flame Dash), which this doesn't separate yet.</li>
      </ul>
      <p>The counts at the end of each row are movement actions in the point / span: jumps (including double jumps),
      dashes, slides and zipline rides. Hover them for boosts and mantles.</p>`,
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
  {
    id: "builds",
    title: "Hero builds: the one part that goes online",
    body: `
      <p>The <b>builds</b> pages (merged in from Build Shitter) look up any hero build by ID, or every build a player
      published, and make the in-game share string. Unlike everything else here they need the internet: your browser
      asks <a href="https://deadlock-api.com" target="_blank" rel="noopener">deadlock-api.com</a> directly. Replay
      analysis never does.</p>
      <h4>Which build each player ran</h4>
      <p>Every hero in a demo carries the build its player had selected (<code>m_sHeroBuildSerialized</code>, a
      <code>CMsgHeroBuild</code>). The game sends it as a C string, so the demo only keeps it up to its first zero byte:
      the build's ID, hero, author, name, and sometimes its version and the build it was copied from. Never the items.
      The scoreboard on <b>Summary</b> shows that name and links the build. The full build is only fetched when you
      open it. Builds with small IDs are usually a player's own unpublished copies. Looking one up returns someone
      else's build, so the page checks the hero and author and says when it can't be found.</p>
      <h4>Where builds come from</h4>
      <p>For a build ID the browser asks Valve's game coordinator live through deadlock-api
      (<code>/v1/builds/{hero}/{id}</code>) and, at the same time, its search index. If Valve answers within 3 seconds you get
      that copy. Otherwise you get the indexed one, and the live one replaces it in the cache when it arrives. A player's
      builds come from the search index (<code>/v1/builds?author_id=</code>), which can lag a bit behind.</p>
      <h4>The share string</h4>
      <p>It's <code>base64(zstd(CMsgHeroBuild))</code>, the same format the game exports. The protobuf is encoded here and
      wrapped in a zstd frame of <b>stored (uncompressed) blocks</b>, because browsers can't compress zstd. Any zstd decoder
      reads it back byte for byte. It's just about 1.6× as long as the game's own strings. If the game ever refuses one,
      that's the first suspect.</p>
      <h4>Souls, levels and caching</h4>
      <p>Item prices per tier and the hero level table come from the game files. Clicking items adds up their price. The
      level shown is the last one whose required souls fit in that total. For each ability step, the page shows the
      earliest level with enough ability unlocks or points, buying every earlier step first. Builds and players are
      cached in this browser (IndexedDB) for 24 hours. Old versions are kept forever. ↻ Refresh works once per hour each.</p>
      <p><button type="button" class="btn" data-clear-builds>clear cached builds</button></p>`,
  },
];

export function viewAbout(app, params) {
  app.innerHTML = `
    <section class="about">
      <h2>How the numbers are made</h2>
      <div class="slop-note"><b>⚠ This is AI slop.</b> DLDI was written almost entirely by an AI (Claude), with one human pointing at
        things and saying "no, like in the game". The numbers below explain what the code does, and many were checked against
        Deadlock's own post-game screens and Valve's match data. That's spot checks, not proof. Expect bugs, especially after
        patches and in unusual matches.</div>
      <p class="muted">Everything is computed in your browser from the demo alone (the hero build pages are the one exception: they load builds from deadlock-api). Hover any underlined label on the site for the same text.</p>
      <nav class="about-toc">${[...DEEP_DIVES.map((d) => [d.id, d.title]), ...SECTIONS.map((x, i) => [`s${i}`, x.title])]
        .map(([id, t]) => `<a href="#/about?s=${id}" data-jump="${id}">${t}</a>`).join("")}</nav>
      ${DEEP_DIVES.map((d) => `<div class="about-sec deep" id="about-${d.id}"><h3>${d.title}</h3>${d.body}</div>`).join("")}
      ${SECTIONS.map((s, i) => `
        <div class="about-sec" id="about-s${i}">
          <h3>${s.title}</h3>
          <dl>${s.items.map(([, label, text]) => `<dt>${label}</dt><dd>${text}</dd>`).join("")}</dl>
        </div>`).join("")}
    </section>`;
  app.querySelector("[data-clear-builds]")?.addEventListener("click", async (e) => {
    const { clearAll } = await import("./builds/store.js");
    await clearAll();
    e.target.textContent = "cleared";
  });
  const jump = params?.get("s");
  if (jump) requestAnimationFrame(() => document.getElementById(`about-${jump}`)?.scrollIntoView());
}
