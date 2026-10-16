// How every number on the site is derived. Used for hover help (looked up by the label shown on
// a tile or table header) and for the #/about page. Keep the wording close to the code in
// analysis.js / the parser; when a definition changes there, change it here too.

import { MELEE_REACH_M, AIMED_AT_DEG } from "./analysis.js";

export const SECTIONS = [
  {
    title: "Where the data comes from",
    items: [
      ["demo", "Demo", "The replay file (.dem) from Deadlock's replays folder or Valve's replay servers, parsed locally by dlparse. Casts, damage, shots, melee swings, parries, buffs, items and positions (every 0.5 s) all come from it."],
      ["metadata", "Valve metadata", "Valve's match summary (.meta), decoded locally. It outlives the demo, so matches without a demo still get a scoreboard, objectives, positions once per second and Valve's own accuracy numbers."],
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
      ["skill accuracy", "Skill accuracy", "Signature-ability hits on heroes ÷ casts, over all parsed matches in view. Abilities that never connect with anything (pure buffs, movement) are left out."],
      ["skill%", "Skill %", "Same as skill accuracy, for this match. The best value (5+ casts) is underlined."],
      ["skill hit %", "Skill hit %", "Signature-ability casts that hit an enemy hero ÷ casts, in the current point or span."],
      ["skills thrown", "Skills thrown", "Signature-ability casts in the current point or span."],
      ["damage", "Damage", "Damage this ability dealt within the hit windows of its casts (all victims except allies)."],
      ["skill damage", "Skill damage", "Damage dealt by signature abilities within their hit windows."],
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
      ["hero accuracy", "Hero accuracy", "Hero hits ÷ (shots − shots that hit only NPCs). Shots spent on troopers aren't attempts at heroes, so they leave the denominator. Close to Valve's hero accuracy."],
      ["gun hero accuracy", "Gun hero accuracy", "Hero hits ÷ (shots − shots that hit only NPCs), over all parsed matches in view."],
      ["hit rate (all shots)", "Hit rate (all shots)", "Hero hits ÷ all shots, troopers included."],
      ["headshots", "Headshots", "Hero hits whose damage hit the head hitgroup."],
      ["hero headshot %", "Hero headshot %", "Headshots ÷ hero hits."],
      ["hero hs %", "Hero HS %", "Headshots ÷ hero hits in the current point or span."],
      ["valve: hero accuracy", "Valve: hero accuracy", "Valve's own end-of-match number (hero bullets hit ÷ hero bullets fired), from the metadata. Whole match only."],
      ["valve: headshots", "Valve: headshots", "Valve's hero headshot count, whole match."],
      ["valve: bullets hit", "Valve: bullets hit", "Valve's bullets that hit anything ÷ bullets fired, whole match."],
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
      ["melee use %", "Melee use %", "Share of swings at heroes, at NPCs and for movement."],
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
      ["kda ratio", "KDA ratio", "(Kills + assists) ÷ deaths."],
      ["souls", "Souls", "Net worth at the playhead."],
      ["level", "Level", "Hero level at the playhead."],
      ["win rate", "Win rate", "Wins ÷ parsed matches in view."],
      ["isolated deaths", "Isolated deaths", "Deaths with no living ally within 30 m half a second before."],
      ["fights", "Fights", "Kills grouped together when less than 15 s apart. The score is kills per team."],
      ["team souls lead", "Team souls lead", "Amber's total net worth minus Sapphire's, every 10 s."],
      ["heat", "Heat (map)", "Where the selected player spent time while alive in the current point or span (positions every 0.5 s)."],
      ["deaths", "Deaths (map)", "Every hero death in the current point or span, crossed in team color."],
      ["incoming", "Incoming", `Enemy casts aimed at this player (within ${AIMED_AT_DEG}° of them): how many hit them and how many they dodged.`],
      ["hp", "HP", "Health and max health at the playhead (max includes items and buffs)."],
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

export function viewAbout(app) {
  app.innerHTML = `
    <section class="about">
      <h2>How the numbers are made</h2>
      <p class="muted">Hover any underlined label on the site for the same text.</p>
      ${SECTIONS.map((s) => `
        <div class="about-sec">
          <h3>${s.title}</h3>
          <dl>${s.items.map(([, label, text]) => `<dt>${label}</dt><dd>${text}</dd>`).join("")}</dl>
        </div>`).join("")}
    </section>`;
}
