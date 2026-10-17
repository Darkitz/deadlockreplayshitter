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
  "100% OFFLINE": "100% OFFLINE, NO CAP 🔒🧢",
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
];

/** long prose (notes, help popups, the "How it works" page): slang swaps + a closer */
const WORDS = [
  [/\benem(y|ies)\b/gi, (m, e) => (e === "y" ? "opp" : "opps")],
  [/\bkills\b/gi, "bodies"], [/\bkilled\b/gi, "unalived"], [/\bdied\b/gi, "got unalived"],
  [/\bgood\b/gi, "bussin"], [/\bbad\b/gi, "mid"], [/\bgreat\b/gi, "goated"], [/\bbest\b/gi, "most goated"],
  [/\bvery\b/gi, "lowkey"], [/\breally\b/gi, "fr"], [/\bprobably\b/gi, "prolly"], [/\bbecause\b/gi, "cuz"],
  [/\bpeople\b/gi, "ppl"], [/\bthough\b/gi, "tho"], [/\bplayers\b/gi, "gamers"], [/\bplayer\b/gi, "gamer"],
  [/\bexactly\b/gi, "on god"], [/\bimportant\b/gi, "kinda a big deal"], [/\bfriends?\b/gi, "homies"],
  [/\bmoney\b/gi, "bag"], [/\bsouls\b/gi, "bag"], [/\baccuracy\b/gi, "aim rizz"], [/\bmissed\b/gi, "fumbled"],
  [/\bmiss(es)?\b/gi, "L$1"], [/\bheadshots?\b/gi, "domeshot"], [/\bmelee\b/gi, "bonk"], [/\bswings\b/gi, "bonks"],
];
const CLOSERS = [" no cap 🧢", " fr fr 💯", " type shit 🔥", " 💀💀💀", " (real) 😤", " ong 🙏", " it's giving accuracy 💅",
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
const PROSE = ".about, .note, p.small, .keys, .drop-field span, dd";
const PROSE_MIN = 40;

/** never rewritten: player-written or player-named text, code */
const SKIP = ".body, .sb-name, .ts-name, .who, code, pre, script, style, textarea, input, [data-raw]";
const originals = new WeakMap();

function genz(text, el) {
  const t = text.trim();
  if (!t) return null;
  if (Object.hasOwn(PHRASES, t)) return text.replace(t, PHRASES[t]);
  for (const [re, rep] of PATTERNS) if (re.test(t)) return text.replace(t, t.replace(re, rep));
  if (t.length >= PROSE_MIN && el?.closest(PROSE)) return text.replace(t, zoomerify(t));
  return null;
}

export function translateTree(root = document.body) {
  if (lang !== "genz") return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (originals.has(n) || n.parentElement?.closest(SKIP)) continue;
    const out = genz(n.nodeValue, n.parentElement);
    if (out == null) continue;
    originals.set(n, n.nodeValue);
    // the hover help looks labels up by their English text
    n.parentElement.dataset.orig ??= n.parentElement.textContent;
    n.nodeValue = out;
  }
}

function restoreTree(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
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
  let queued = false;
  new MutationObserver(() => {
    if (lang !== "genz" || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; translateTree(); });
  }).observe(document.body, { childList: true, subtree: true });
  btn.addEventListener("click", () => {
    lang = lang === "genz" ? "en" : "genz";
    try { localStorage.setItem(KEY, lang); } catch { /* private mode */ }
    if (lang === "genz") translateTree(); else restoreTree();
    paint();
    onChange?.();
  });
  translateTree();
}
