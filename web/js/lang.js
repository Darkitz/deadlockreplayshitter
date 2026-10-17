// Language: English (default) or Gen Z English, a joke mode. Instead of threading a t() call
// through every view, rendered text nodes are rewritten from a phrase table (exact labels)
// plus a few patterns (feed lines, headings). Player names, chat messages and code are left
// alone. The original text is kept, so switching back restores it and hover help still finds
// its explanation by the original label (see helpLabel).

const KEY = "skillhitter.lang";
export let lang = (() => { try { return localStorage.getItem(KEY) || "en"; } catch { return "en"; } })();

/** exact labels (whole text node, trimmed) */
const PHRASES = {
  // header / home
  "Deadlock Demo Insight · in your browser": "Deadlock Demo Insight but make it bussin 💅",
  "DLDI": "DLDI 😩",
  "How it works": "How it works (nerd stuff) 🤓",
  "open demo": "drop a demo 📂",
  "Drop a Deadlock demo here": "Yeet a Deadlock demo in here fr 📂✨",
  "Parsed right here in your browser. Nothing is uploaded.": "Parsed in your browser, nothing gets uploaded. We're not the feds 🕵️",
  "REPLAY ANALYSIS IS 100% OFFLINE": "REPLAY ANALYSIS IS 100% OFFLINE, NO CAP 🔒🧢",
  "on your computer": "on your own machine 💻",
  "Opened in this browser": "Your demo lore 📜",
  "← home": "← back to the crib 🏠",
  "How the numbers are made": "How the numbers get cooked 👨‍🍳",
  // match header / scoreboard
  "WIN": "W 🏆",
  "LOSS": "L 💀",
  "player": "player 🎮",
  "skill%": "skill% 🎯",
  "souls": "bag 💰",
  "level": "lvl ✨",
  "Hit window": "Hit window ⏳",
  "heroes only": "opps only 🎯",
  "other abilities": "side quests 🧩",
  "active items": "active items 🛒",
  // ability tiles
  "Thrown": "Yeeted 🚀",
  "Hit heroes": "Hit the opps 🎯",
  "Hit": "Landed 🎯",
  "Accuracy": "Aim rizz 🎯",
  "Missed": "Fumbled 💀",
  "Damage": "Damage (sheesh) 🔥",
  "K / D / A": "K/D/A (ratio check) 📊",
  "Souls": "Bag 💰",
  "Level": "Level (glow up) ✨",
  "Hit non-hero": "Hit NPCs (mid) 🤖",
  "Hits → kills": "Hits → bodies ☠️",
  "Ready → recast": "Cooldown just vibing 🥱",
  // gun
  "Shots fired": "Bullets sent 🔫",
  "Bullets": "Lead dispensed 🔫",
  "Shots hit heroes": "Shots on opps 🎯",
  "Shots hit troopers": "Shots on NPCs 🤖",
  "Hero accuracy": "Opp accuracy (aim check) 🎯",
  "Hit rate (all shots)": "Hit rate (everything) 📈",
  "Headshots": "Domeshots 🧠💥",
  "Hero headshot %": "Dome % 🧠",
  // melee
  "Light swings": "Light bonks 🔨",
  "Heavy swings": "Heavy bonks 🔨💪",
  "Melee swings": "Bonks 🔨",
  "Hero melees": "Bonks at opps 🥊",
  "Hero melee accuracy": "Bonk accuracy 🎯",
  "Got parried": "Got parried (L) 😭",
  "Parries": "Parries (cracked) 🛡️",
  "movement": "zoomies 🏃",
  "whiff": "whiff 💨",
  "parried": "parried 😭",
  // replay controls / feed
  "all": "all 👀",
  "hit": "hits 🎯",
  "miss": "Ls 💀",
  "kills": "bodies ☠️",
  "all kills": "all bodies ☠️",
  "point": "point 📍",
  "span": "span ↔️",
  "all casts": "all casts 🌀",
  "heat": "heat 🔥",
  "deaths": "deaths 💀",
  "full map": "whole map 🗺️",
  "killed": "got unalived 💀",
  "kill": "bodied ☠️",
  "→ kill": "→ bodied ☠️",
  "dead": "unalived 💀",
  "fights": "beef 🥩",
  // tabs
  "Players": "The squad 👥",
  "Incoming": "Incoming (dodge diff) 🏃",
  "Time split": "Where the time went ⏰",
  "Laning": "Lane diff 🛣️",
  "Chat": "The yap 💬",
  // chat
  "All chat": "Global yap 🌍",
  "Amber team": "Amber squad 🟠",
  "Sapphire team": "Sapphire squad 🔵",
  "nothing said": "dead chat 🦗",
  "chat-wheel pings": "ping spam 📢",
  // time split legend
  "fighting heroes": "beefing with opps 🥊",
  "fighting troopers / objectives": "farming troopers / objectives 🏗️",
  "farming neutrals": "jungle farming 🌾",
  "out of combat": "chilling 🧘",
  "zipline": "zippin' 🚡",
  "slide": "slidin' 🛝",
  "dash": "dashin' 💨",
  "airborne": "air time 🦅",
  "on foot": "walking (NPC behavior) 🚶",
  "Summary": "The tea ☕",
  // home
  "or click to pick a file ·": "or tap here to pick a file bestie ·",
  "Download Replay": "Download Replay (the sacred button 🙏)",
  "AI slop": "AI slop 🤖💀",
  "Your demo is read and analyzed": "Your demo gets cooked and analyzed",
  ", right in this browser tab.": ", right here in this tab, no cap 🧢",
  "It is never uploaded. No server, no account, no tracking.": "Never uploaded. No server, no account, no tracking. We do NOT want your data fr 🙅",
  "Rem": "Rem 🐐",
  "Drop the demo again to open it.": "Yeet the demo in again to open it 📂",
  // summary
  "Standard match": "Standard match (sweaty) 😤",
  "MVP": "MVP (goated) 🐐",
  "Most": "most (no contest) 👑",
  "Second most": "second most (so close) 😮‍💨",
  "Third most": "third most (bronze arc) 🥉",
  "ability kills": "ability bodies 🪄☠️",
  "player dmg": "opp dmg 🔥",
  "plyr dmg": "opp dmg 🔥",
  "obj dmg": "building beef 🏗️",
  "assists": "carried homies 🤝",
  "healing": "heals (therapist arc) 💚",
  "weapon kills": "gun bodies 🔫",
  "melee kills": "bonk bodies 🔨",
  "headshot kills": "dome bodies 🧠",
  "kills": "bodies ☠️",
  "souls": "bag 💰",
  "Key Players": "Key Players (real ones) 🫡",
  "Key": "Real one 🫡",
  "Graph type": "Graph vibe 📊",
  "Player": "Player 🎮",
  // graph picker
  "General": "General vibes ✨",
  "Souls collected": "Bag collected 💰",
  "Souls per minute": "Bag per minute 💸",
  "Deaths": "Ls taken 💀",
  "Assists": "Carried homies 🤝",
  "Player damage": "Opp damage 🔥",
  "Objective damage": "Building beef 🏗️",
  "Healing (without barriers)": "Heals (no shields) 💚",
  "Last hits": "Last hits (farming sim) 🌾",
  "Team souls": "Team bag 💰",
  "Time fighting heroes": "Time spent beefing 🥊",
  "Time on ziplines": "Zipline era 🚡",
  "Movement actions (jumps, dashes, slides)": "Zoomies (jumps, dashes, slides) 🏃💨",
  "Damage dealt by type": "Damage by flavor 🍦",
  "Damage to players": "Damage to opps 🎯",
  "Damage from players": "Damage tanked (ouch) 🤕",
  "Time split: combat": "Where the time went: beef 🥊",
  "Time split: movement": "Where the time went: zoomies 🏃",
  "Movement actions by type": "Zoomies by type 🏃",
  "Souls by source": "Where the bag came from 💰",
  "Permanent buffs": "Perma buffs (stat glow up) 📈",
  "cast heatmap…": "where they spammed it 🔥…",
  // overview + replay
  "Kills": "Bodies ☠️",
  "Souls lead": "Bag lead 💰",
  "Winner": "Winner (W) 🏆",
  "Game time": "Game time ⏱️",
  "Fights": "Beef 🥩",
  "Match overview.": "Match overview (vibe check) ✅",
  "abilities": "abilities ✨",
  "Light melee": "Light bonk 🔨",
  "Heavy melee": "Heavy bonk 💪",
  "Gun": "Gun (pew pew) 🔫",
  "Parry": "Parry (no u) 🛡️",
  "melee → hero": "bonk → opp 🥊",
  "light · heavy · parried": "light · heavy · got denied 😭",
  "· signature skills that connect + gun, every player": "· signature skills that actually connect + gun, whole lobby 👥",
  "· alive time, from the demo every 0.5 s": "· alive time only (no ghost arc 👻), every 0.5 s",
  "shift+drag": "shift+drag (galaxy brain move 🧠)",
  "dead": "unalived 💀",
  "no items yet": "no drip yet 🥲",
  "no buffs or debuffs": "no buffs, just vibes 😐",
  "nothing yet": "nothing yet (it's giving empty) 🫥",
  "no kills yet": "no bodies yet 🕊️",
  "no swings yet": "no bonks yet 🔨",
  "no hero hits yet": "no opp hits yet 😶",
  "Hit window": "Hit window ⏳",
  "Hidden King": "Hidden King 👑",
  "Archmother": "Archmother 🔮",
  // how it works headings + labels
  "1. Finding swings": "1. Finding the bonks 🔍",
  "2. Measuring the surroundings": "2. Reading the room 👀",
  "3. Intent": "3. What were they even trying 🤔",
  "4. Outcome": "4. Did it slap? 👋",
  "5. The numbers": "5. The numbers (math class) 🧮",
  "Limits": "Limits (the fine print) 📜",
  "Combat (first match wins)": "Beef (first match wins) 🥊",
  "Fighting heroes": "Beefing with opps 🥊",
  "Fighting troopers / objectives": "Farming troopers / objectives 🏗️",
  "Farming neutrals": "Jungle farming 🌾",
  "Out of combat": "Chilling 🧘",
  "Zipline": "Zippin' 🚡",
  "Dash": "Dashin' 💨",
  "Slide": "Slidin' 🛝",
  "Airborne": "Air time 🦅",
  "On foot": "Walking (NPC behavior) 🚶",
  "At heroes": "At opps 🥊",
  "At NPCs": "At NPCs 🤖",
  "Movement": "Zoomies 🏃",
  "Parried": "Got denied 😭",
  "Whiff": "Whiff 💨",
  "Hit NPC": "Bonked an NPC 🤖",
  "Melee use %": "Bonk usage % 🔨",
  "Demo": "Demo (the evidence) 📼",
  "Game time": "Game time ⏱️",
  "Point / span": "Point / span 📍↔️",
  "Skill %": "Skill % 🎯",
  "Skill hit %": "Skill hit % 🎯",
  "Skills thrown": "Skills yeeted 🚀",
  "Aim error (miss · N° off)": "Aim error (how cooked the aim was) 🫠",
  "Hero HS %": "Dome % 🧠",
  "Swings": "Bonks 🔨",
  "At heroes / hero melees": "At opps / opp bonks 🥊",
  "Acc": "Acc 🎯",
  "Melee → hero": "Bonk → opp 🥊",
  "Dmg": "Dmg 🔥",
  "Team souls lead": "Team bag lead 💰",
  "Heat (map)": "Heat (map) 🔥",
  "Cast heatmap (map)": "Spam map 🔥",
  "Deaths (map)": "Deaths (map) 💀",
  "MVP / key player": "MVP / real ones 🐐",
  "Awards (most / second most …)": "Awards (the flex list) 🏅",
  "Healing": "Heals 💚",
  "Shots": "Shots 🔫",
  "Hits": "Hits 🎯",
  "What it hit": "What it hit 🎯",
  "Nearest living enemy hero.": "Closest opp still breathing. 😤",
  "soul orbs": "soul orbs 💰",
  "oldest unclaimed shot of the last 1.5 s": "oldest unclaimed shot of the last 1.5 s (first come first served) 🍽️",
  "AI SLOP": "AI SLOP 🤖💀",
  "Simple Graphs": "Line go up 📈",
  "Replay & analysis": "Replay & analysis (lore drop) 🔍",
  "victorious": "ate and left no crumbs 💅",
  "Victorious": "W 🏆",
  "Defeated": "L 💀",
  "Key player": "Key player (real one) 🫡",
  // more replay bits
  "follow ×2": "stalk ×2 👀",
  "follow ×3": "stalk ×3 👀👀",
  "click a hero to analyze them · rays = aim at cast": "tap a hero to stalk them 👀 · rays = where they aimed (or didn't 💀)",
  "CSV": "CSV (for the nerds) 🤓",
  "in-game ↗": "in-game ↗ 🎮",
  "from": "from ⏮️",
  "to": "to ⏭️",
  "souls diff": "bag diff 💰",
  "later lines are dimmed · click a line to jump there": "future yap is dimmed (no spoilers) · tap a line to time travel ⏰",
  "· right: movement": "· right side: the zoomies 🏃",
  "Rebuilt from the demo; lands within a few points of Valve's own numbers.": "Cooked from the demo, basically matches Valve's numbers, we're so back 🔥",
  "How it's measured →": "the lore →",
  // tracker / tables
  "HP": "HP ❤️",
  "shots": "shots 🔫",
  "skills thrown": "skills yeeted 🚀",
  "skill hit %": "skill hit % 🎯",
  "hero accuracy": "opp accuracy 🎯",
  "hero HS %": "dome % 🧠",
  "items": "drip 🛍️",
  "swings": "bonks 🔨",
  "at heroes": "at opps 🥊",
  "acc": "acc 🎯",
  "at NPCs": "at NPCs 🤖",
  "dmg": "dmg 🔥",
  "Light": "Light 🪶",
  "Heavy": "Heavy 🏋️",
  "how swings are classified →": "the bonk lore →",
  "enemy": "opp 😈",
  "ability": "ability ✨",
  "aimed": "aimed 🎯",
  "dodged": "dodged 🕺",
  // incoming / laning tiles
  "Aimed at": "Targeted 🎯",
  "Got hit": "Got clipped 😵",
  "Dodged": "Dodged (ankles intact) 🕺",
  "Dodge rate": "Dodge rizz 🕺",
  "Lane souls diff @10": "Lane bag diff @10 💰",
  "Lane kills @10": "Lane bodies @10 ☠️",
  "souls @10": "bag @10 💰",
  "last hits": "last hits (farming sim) 🌾",
  "k/d/a": "k/d/a 📊",
  // state panel / recap
  "nearest ally": "closest homie 🤝",
  // about page
  "Where the data comes from": "Where the data comes from (the source, trust) 📦",
  "Abilities": "Abilities (the spells) 🪄",
  "Gun": "Gun (pew pew) 🔫",
  "Melee": "Melee (bonk zone) 🔨",
  "Players, fights and positioning": "Players, beef and positioning 🗺️",
  "Melee in depth: what each swing was for": "Melee deep dive: what was each bonk even for 🔨🤔",
  "Gun accuracy in depth": "Gun accuracy deep dive (aim check) 🎯",
  "Time split: combat and movement": "Where the time went: beef and zoomies ⏰",
  // home cards
  "Amber": "Amber 🟠",
  "Sapphire": "Sapphire 🔵",
  "dropped demo": "dropped demo 📂",
};

/** dynamic text: [pattern, replacement] tried in order on the trimmed text node */
const PATTERNS = [
  [/^miss · no enemy in range$/, "miss · nobody was even there 💀"],
  [/^miss · (.*)$/, "whiffed 💀 · $1"],
  [/^hit non-hero(.*)$/, "hit an NPC (mid) 🤖$1"],
  [/^hit NPC · (.*)$/, "bonked an NPC 🤖 · $1"],
  [/^hit ([+·].*)$/, "landed 🎯 $1"],
  [/^hit · (.*)$/, "landed 🎯 · $1"],
  [/^Accuracy tracker · (.*)$/, "Aim leaderboard 🎯 · $1"],
  [/^How each player spent (.*)$/, "Where everyone's time went ⏰ ($1)"],
  [/^Incoming skillshots aimed at (.*)$/, "Skillshots aimed at $1 (dodge check) 🏃"],
  [/^Laning · first 10 minutes$/, "Lane diff · first 10 min 🛣️"],
  [/^Killed by$/, "Got unalived by 💀"],
  [/^(\d+)–(\d+) min$/, "$1–$2 min ⏱️"],
  [/^parsing · game clock (.*)$/, "cooking the demo 👨‍🍳 · $1"],
  [/^parsing · pregame$/, "cooking the demo 👨‍🍳 · pregame (vibes only)"],
  [/^parsed in (.*)$/, "cooked in $1, sheesh 🥶"],
  [/^reading file…$/, "reading the file, hold up 🫸"],
  [/^opened (.*)$/, "opened $1 🕰️"],
  [/^(\d+) kills$/, "$1 bodies ☠️"],
  [/^thrown (\d+) · hit (\d+)$/, "yeeted $1 · landed $2 🎯"],
  [/^swings (\d+) · hero hits (\d+)(.*)$/, "bonks $1 · opp hits $2$3 🔨"],
  [/^shots (\d+) · hero hits (\d+) · headshots (\d+)$/, "shots $1 · opp hits $2 · domes $3 🧠"],
  [/^team souls lead (.*)$/, "team bag lead $1 💰"],
  [/^whiff · hero (.*)$/, "whiffed 💨 · opp $1"],
  [/^whiff · NPC (.*)$/, "whiffed on an NPC 🤡 · $1"],
  [/^whiff$/, "whiff 💨"],
  [/^parried by$/, "parried by 😭"],
  [/^Parser warnings for this demo: (.*)$/, "the parser is lowkey confused 😵‍💫: $1"],
  [/^(\w+) melee at (.*)$/, "$1 bonk at $2 🔨"],
  [/^(\d+:\d+) kill \/ assist$/, "$1 bodied someone ☠️"],
  [/^(\d+:\d+) died$/, "$1 got sent to the lobby 💀"],
  [/^(\d+:\d+) hit · (\d+) dmg$/, "$1 landed 🎯 · $2 dmg"],
  [/^(\d+:\d+) hit$/, "$1 landed 🎯"],
  [/^(\d+:\d+) miss$/, "$1 whiffed 💀"],
  [/^(\d+:\d+) other · (\d+) dmg$/, "$1 hit an NPC 🤖 · $2 dmg"],
  [/^([^:]{1,40}): (\d+%)$/, "$1: $2 aim rizz 🎯"],
  [/^(\d+) \/ (\d+) HP$/, "$1 / $2 HP ❤️"],
  [/^(Hidden King|Archmother|Amber|Sapphire) won$/, "$1 won (W) 🏆"],
  [/^Match (\d+)$/, "Match $1 🎮"],
  [/^· lane (\d+)$/, "· lane $1 🛣️"],
  [/^\/ (\d+) tried(.*)$/, "/ $1 attempts$2 🛡️"],
  [/^enemy ≤ (\d+) m$/, "opp within $1 m 👀"],
  [/^chart: (.*) over the match$/, "chart: $1 over the whole match 📈"],
  [/^· enemy casts whose aim was within (\d+)° of them$/, "· opp casts aimed within $1° of them (they were locked in 🔒)"],
  [/^(\d+(?:\.\d+)?k?) souls$/, "$1 bag 💰"],
  [/^(Hidden King|Amber) – (Archmother|Sapphire)$/, "$1 👑 vs $2 🔮"],
];

/** long prose (notes, help popups, the "How it works" page): slang swaps + a closer */
const WORDS = [
  [/(?<![-\w])game(?![-\w])/gi, "game (the grind)"], [/\bnet worth\b/gi, "bag"], [/\bplayhead\b/gi, "playhead 📍"],
  [/\bdamage\b/gi, "dmg"], [/\blevel\b/gi, "lvl"], [/\battacks\b/gi, "hits"], [/\bplayer's\b/gi, "gamer's"], [/\bwinner\b/gi, "W-er"],
  [/\bnumbers?\b/gi, (m) => (m.endsWith("s") ? "numbers (math 🤓)" : "number")],
  [/\bcomputer\b/gi, "PC (the battlestation)"], [/\binternet\b/gi, "interwebs"],
  [/\bexplain(s|ed)?\b/gi, "spill$1"], [/\bcheck(ed)?\b/gi, "vibe-check$1"], [/\bbugs\b/gi, "bugs (skill issue)"],
  [/\bsuccessful\b/gi, "clean"], [/\bperfect\b/gi, "immaculate"], [/\bhowever\b/gi, "but lowkey"],
  [/\benem(y|ies)\b/gi, (m, e) => (e === "y" ? "opp" : "opps")],
  [/\bkills\b/gi, "bodies"], [/\bkilled\b/gi, "unalived"], [/\bdied\b/gi, "got unalived"],
  [/\bgood\b/gi, "bussin"], [/\bbad\b/gi, "mid"], [/\bgreat\b/gi, "goated"], [/\bbest\b/gi, "most goated"],
  [/\bvery\b/gi, "lowkey"], [/\breally\b/gi, "fr"], [/\bprobably\b/gi, "prolly"], [/\bbecause\b/gi, "cuz"],
  [/\bpeople\b/gi, "ppl"], [/\bthough\b/gi, "tho"], [/\bplayers\b/gi, "gamers"], [/\bplayer\b/gi, "gamer"],
  [/\bexactly\b/gi, "on god"], [/\bimportant\b/gi, "kinda a big deal"], [/\bfriends?\b/gi, "homies"],
  [/\bmoney\b/gi, "bag"], [/\bsouls\b/gi, "bag"], [/\baccuracy\b/gi, "aim rizz"], [/\bmissed\b/gi, "fumbled"],
  [/\bmiss(es)?\b/gi, "L$1"], [/\bheadshots?\b/gi, "domeshot"], [/\bmelee\b/gi, "bonk"], [/\bswings\b/gi, "bonks"],
];
const CLOSERS = [" skibidi 🚽", " gyatt 😳", " rizzler behavior 😏", " sigma grindset 🗿", " it's giving 💅", " cooked 🍳", " we're so back 📈",
  " it's so over 📉", " mid fr 😐", " NPC energy 🤖", " no thoughts head empty 🫥", " delulu is the solulu 🌈", " caught in 4K 📸",
  " touch grass 🌱", " ohio moment 🌽", " slay queen 👑", " bussin bussin 😋", " real and true 🙏", " brainrot certified 🧠🔥"," no cap 🧢", " fr fr 💯", " type shit 🔥", " 💀💀💀", " (real) 😤", " ong 🙏", " it's giving accuracy 💅",
  " bussin 😋", " sheesh 🥶", " lowkey 👀", " W 🏆", " ifykyk 🤫", " and that's on period 💅", " slay 💅", " based 🗿",
  " vibe check passed ✅", " rent free 🧠", " understood the assignment 📝", " main character energy ✨", " it's the aim for me 🎯"];

function zoomerify(text) {
  let out = text;
  for (const [re, rep] of WORDS) out = out.replace(re, rep);
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  // keep trailing punctuation outside the closer: "...the denominator. no cap 🧢"
  return out.replace(/\s*$/, "") + CLOSERS[h % CLOSERS.length];
}
/** prose gets zoomerified: these containers, text this long */
const PROSE = ".about, .note, p.small, .keys, .drop-field, dd, .offline, .slop-note, .pick-hint, .pg-graph-note, .small.muted, footer, .empty, .chart-card > div.small";
const PROSE_MIN = 40;

/** never rewritten: player-written or player-named text, code */
const SKIP = ".body, .sb-name, .ts-name, .who, code, pre, script, style, textarea, input, [data-raw]";
const originals = new WeakMap();
/** text we wrote ourselves, so the observer can tell our edits from the page's */
const written = new WeakMap();

function slang(text) {
  let out = text;
  for (const [re, rep2] of WORDS) out = out.replace(re, rep2);
  return out;
}

function genz(text, el) {
  const t = text.trim();
  if (!t) return null;
  if (Object.hasOwn(PHRASES, t)) return text.replace(t, PHRASES[t]);
  for (const [re, rep2] of PATTERNS) if (re.test(t)) return text.replace(t, t.replace(re, rep2));
  if (el?.closest(PROSE)) {
    if (t.length >= PROSE_MIN) return text.replace(t, zoomerify(t));
    const swapped = slang(t);
    if (swapped !== t) return text.replace(t, swapped);
  }
  return null;
}

export function translateTree(root = document.body) {
  if (lang !== "genz") return;
  for (const g of root.querySelectorAll?.("optgroup[label]") || []) {
    if (g.dataset.origLabel == null && Object.hasOwn(PHRASES, g.label)) { g.dataset.origLabel = g.label; g.label = PHRASES[g.label]; }
  }
  // a text node root (changed in place) is handled itself; the walker only visits descendants
  const nodes = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
  else { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let x = w.nextNode(); x; x = w.nextNode()) nodes.push(x); }
  for (const n of nodes) {
    if (originals.has(n) || n.parentElement?.closest(SKIP)) continue;
    const out = genz(n.nodeValue, n.parentElement);
    if (out == null) continue;
    originals.set(n, n.nodeValue);
    // the hover help looks labels up by their English text
    n.parentElement.dataset.orig ??= n.parentElement.textContent;
    n.nodeValue = out;
    written.set(n, out);
  }
}

function restoreTree(root = document.body) {
  for (const g of root.querySelectorAll("optgroup[data-orig-label]")) { g.label = g.dataset.origLabel; delete g.dataset.origLabel; }
  // a text node root (changed in place) is handled itself; the walker only visits descendants
  const nodes = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
  else { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let x = w.nextNode(); x; x = w.nextNode()) nodes.push(x); }
  for (const n of nodes) {
    if (originals.has(n)) { n.nodeValue = originals.get(n); originals.delete(n); }
  }
}

/** label text for help lookup (the English original when Gen Z mode rewrote it) */
export const helpLabel = (el) => el.dataset.orig || el.textContent;

/** the help tooltip, in character */
export function helpText(text) {
  if (lang !== "genz" || !text) return text;
  const intros = ["ok so basically 👉 ", "lowkey: ", "bestie, listen 💅 ", "real talk 🗣️ ", "storytime 📖 ", "not gonna lie 😳 ", "hear me out 👂 "];
  return `${intros[text.length % intros.length]}${zoomerify(text)}`;
}

export function initLang(onChange) {
  const btn = document.getElementById("lang-toggle");
  const paint = () => {
    btn.textContent = lang === "genz" ? "Gen Z 💅" : "EN";
    btn.title = lang === "genz" ? "back to normal English" : "switch to Gen Z English (it's cringe, you've been warned)";
  };
  paint();
  // translate new / changed text right in the observer callback: it runs as a microtask,
  // before the browser paints, so the English text never shows (no flicker while playing)
  new MutationObserver((records) => {
    if (lang !== "genz") return;
    for (const r of records) {
      if (r.type === "childList") {
        for (const n of r.addedNodes) if (n.isConnected) translateTree(n);
      } else if (r.type === "characterData") {
        const n = r.target;
        if (written.get(n) === n.nodeValue) continue; // our own edit
        originals.delete(n);
        translateTree(n);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  btn.addEventListener("click", () => {
    lang = lang === "genz" ? "en" : "genz";
    try { localStorage.setItem(KEY, lang); } catch { /* private mode */ }
    if (lang === "genz") translateTree(); else restoreTree();
    paint();
    onChange?.();
  });
  translateTree();
}
