# DLDI · Deadlock Demo Insight

<img src="web/icon.svg" width="96" alt="">

> ⚠ **This is AI slop.** DLDI was written almost entirely by an AI (Claude), steered by one human.
> Many numbers are checked against Deadlock's own post-game screens and Valve's match data, but that's spot
> checks, not proof. Expect bugs.

**Live: [darkitz.github.io/deadlockreplayshitter/](https://darkitz.github.io/deadlockreplayshitter/)**

Drop a Deadlock demo onto the page and see, for every player in the match, how many skillshots,
gun shots and melee swings were **thrown vs hit**. The match plays back on a minimap with timelines
you can scrub or select a span on.

**Replay analysis is 100% offline:** the demo is read and analyzed on your computer and never uploaded. There is no server, account or tracking. Only the website itself, icons included, loads from the internet. A service worker (`web/sw.js`) keeps the core files, so analysis keeps working without a connection after the first visit.

Everything runs in the browser. The demo parser ([haste](https://github.com/deadlock-api/haste),
in `parser/`) is compiled to WebAssembly and parses the file locally. Nothing is uploaded and there
is no server, so the site can be hosted on GitHub Pages.

**Hero builds** (`#/builds`, merged in from Build Shitter) are the one online part: look up any build by ID, or
every build a player published, see its items (with souls and level totals) and ability order, and copy the
in-game share string. Builds load from [deadlock-api.com](https://deadlock-api.com) straight into the browser and
are cached there. On a match's **Summary**, each player's row links the build they had selected: the demo
carries its ID and name (only those, the game cuts it off at the first zero byte), the full build loads when you
open it.

## Using it

1. Get a demo:
   - In Deadlock: match history → **Download Replay**. The file lands in
     `Deadlock/game/citadel/replays/<match_id>.dem`.
   - Or a `.dem.bz2` from Valve's replay servers. These are decompressed in the browser too.
2. Drop it onto the page, or click **open demo**.
3. Parsing a 40-minute match takes about 10 s and peaks around 0.5–0.8 GB of memory.

Parsed matches are kept in the browser (IndexedDB), so `#/match/<id>` links keep working there.
The home page lists them; × removes one.

## What's on a match

**Summary** (opens first): Deadlock's post-game screen, without the 3D art. The graphs live in their own **Simple Graphs** tab.
- **Winner, MVP and key players:** picked by the game; read from Valve's post-game summary, which the server writes into the demo at game end.
- **Award cards for all 12 players** ("Most ability kills", "Second most player dmg", … computed like the game: ties share a place).
- **Full scoreboard:** souls, K/D/A, player and objective damage, healing incl. barriers, last hits, final build, ability upgrades.
- **Graphs**, much finer than the game's (which has ~11 points per player):
  - every 10 s: souls, souls/min, kills, deaths, assists, player and objective damage, healing, last hits, team souls
  - every hit: damage dealt by type, damage to and from players
  - from Valve's snapshots: souls by source, permanent buffs

**Replay & analysis:**

- **Scoreboard:** every player's signature-skill accuracy. Click a row to analyze that player.
- **Ability picker:**
  - **Gun**, **Light melee**, **Heavy melee** and the four signature abilities.
  - Other hero abilities (parry, teleports) and active items.
  - Each shows hits / attempts.
- **Minimap replay:**
  - Positions, health rings, trail, aim rays and hit markers, kills, ziplines, objectives.
  - Overlays: "all casts", **heat** (where the player spent time) and **deaths**.
- **Timeline:**
  - Cumulative attempts vs hits, cast/kill/death markers, team souls lead.
  - Wheel zooms; **shift+drag** selects a span. Point mode counts from the start; span mode counts only inside the span.
- **At the playhead:** HP / max HP, souls, level, ability levels, items, buffs and debuffs, and a death recap.
- **Accuracy tracker** (Players tab):
  - Skills, gun hero accuracy, headshot %, and light / heavy / parried melee for every player.
  - The chart follows the selected mode.
- Below the replay, tabs:
  - **Players**: accuracy tracker.
  - **Incoming**: skillshots aimed at the player, hit or dodged.
  - **Time split**: how each player spent the match or span (fighting heroes / troopers / neutrals / out of combat), how they moved (zipline, slide, dash, airborne), and counts of jumps, dashes, slides and zipline rides. Rebuilt from the demo; within a few points of Valve's own numbers.
  - **Laning**: the first 10 minutes.
  - **Chat**.
- **Chat:**
  - Three columns: each team's chat and all chat.
  - Hero icons, plus chat-wheel pings with the hero or lane they refer to ("Kelvin is missing", "Defend the Broadway Walker").
  - Lines after the playhead are dimmed; click one to jump there.
- **How it works** (`#/about`):
  - Explains every number, with walkthroughs for melee and gun.
  - Underlined labels show the same text on hover.
  - Each melee swing in the feed explains its own classification.

Some metrics need explaining:
- **Gun hero accuracy** = hero hits ÷ (shots − shots that hit only NPCs). Shots spent on troopers
  aren't attempts at heroes.
- **Melee intent:** at every swing the parser records the distance to the nearest living enemy
  hero and to the nearest NPC, crate, soul orb or objective.
  - Enemy hero within 10 m = **hero melee**.
  - Else something farmable within 10 m = **at NPCs**.
  - Else **movement**.
  - Hero melee accuracy = hero hits ÷ hero melees.
- **Parries** are paired with the enemy swing they caught (within 8 m, 0.6 s).

**Header toggles:**
- Light / dark theme.
- Language: English, or **Gen Z English** (`web/js/lang.js`). That one is a joke mode, you've been warned 💀. It never touches player names or chat.
- Both are saved per browser.

## Layout

| path | |
| --- | --- |
| `web/` | the site, served as is (GitHub Pages publishes this folder) |
| `web/parser/dlparse.wasm` | the parser, built by `tools/build-wasm.sh` (committed) |
| `web/data/assets.json`, `web/assets/game/` | hero/ability/item names and icons from the game files (committed) |
| `parser/dlparse/` | the parser: `src/lib.rs` (demo → JSON), `src/wasm.rs` (browser exports), `src/main.rs` (CLI) |
| `parser/vendor/` | deadlock-api's haste fork and protos |
| `tools/game_assets.py` | extracts `assets.json` + icons from a local Deadlock install, and `data/tips.json` (in-game tooltips, `tools/ability_tips.py`) |
| `web/js/builds.js`, `web/js/builds/` | hero build pages: deadlock-api client + cache, share-string codec (protobuf + stored zstd frame) |
| `tests/` | `node --test tests/*.test.mjs` |
| `tools/smoke.mjs` | browser smoke test: drops a demo into the running site and screenshots it |

## Running locally

Module workers and WebAssembly need http, not `file://`:

```bash
python3 -m http.server -d web 8000     # http://localhost:8000
```

### Player pages: last matches and builds

`#/player/<SteamID64 or account id>` shows a player's Steam name and avatar and two tabs:
**Matches** (their last 40 matches from deadlock-api's match history, with demo sync) and
**Builds** (the builds they published). Scoreboard names link there. Remember your own account
with **this is me** (or open `#/?account=<SteamID64>` once): it's stored in that browser only,
and **☆ follow** other players: **Following** in the menu lists everyone (avatars included) with one merged feed of their last matches; matches you played together show up once, with each of you. Matches deadlock-api has no replay salt for
get **ask deadlock-api**: it looks the salt up from Steam, about 10 times per 30 minutes per IP.
deadlock-api.com is a free community API (not Valve); the browser asks it directly.

Downloading the demo is the one step the page can't do itself: Valve's replay servers are plain
http without CORS headers, so a page can't read them. The browser downloads it like any file
(**download demo**; it may ask before keeping an http download). In Chrome and Edge, **pick your
Downloads folder** once (or the game's replays folder): the page may then read that one folder,
syncs demos as they land there, and offers one-click **sync** / **sync all** for demos already in
it. Elsewhere, drop the downloaded file onto the page.

Valve now serves many `.dem.bz2` files zstd-compressed; the parser reads both.

## Building

```bash
tools/get-protoc.sh          # once: protoc for the parser build
tools/build-wasm.sh          # parser → web/parser/dlparse.wasm (adds the wasm32 target if needed)
```

Refresh the game assets after a patch that adds heroes, abilities or items. This needs a local
install; set `DEADLOCK_GAME` if it isn't at the default path:

```bash
tools/get-vrf.sh                 # once: Source2Viewer-CLI to read the game's VPKs
python3 tools/game_assets.py     # → web/data/assets.json + web/assets/game/
```

The native CLI is still available for debugging:
`parser/target/release/dlparse <demo> <out.json> [match_id]`.

## GitHub Pages

The site is live at **https://darkitz.github.io/deadlockreplayshitter/**.

`.github/workflows/pages.yml` runs the unit tests and publishes `web/` on every push to `main`.
In the repository settings, **Pages → Source** must be **GitHub Actions**. All paths are relative
and routing uses the URL hash, so the site works under any `https://<user>.github.io/<repo>/`.

## After a Deadlock patch

Patches can change the demo format. Run:

```bash
tools/check.sh || tools/update-parser.sh
```

- `tools/check.sh`:
  - Parses the newest local demo with the CLI and fails on errors or sanity warnings (missing casts, positions, net worth, …).
  - Checks the **WebAssembly build gives byte-identical output**.
  - Runs the tests.
- `tools/update-parser.sh`:
  - Pulls deadlock-api's maintained haste fork and protos, rebuilds the CLI and the wasm, then runs the check.
  - Rolls back automatically if the build or the check fails.
- Commit the new `web/parser/dlparse.wasm`.
- Bump `FORMAT_VERSION` in `parser/dlparse/src/lib.rs` when the JSON changes. Demos dropped
  earlier then need to be dropped again to pick up new fields.

## How abilities are scored

Every ability and active item is scored by what it's for. `tools/profile_abilities.py` measures
this on real matches (parsed demo JSON) and writes `tools/ability_profiles.json`, which
`tools/game_assets.py` merges into `assets.json`. Abilities without enough data fall back to the
game's own flags.

| kind | what it is | shown as |
| --- | --- | --- |
| offensive | damage or debuffs on enemies | hits / casts (accuracy) |
| empowered shots | "your next N bullets" (Living Ink, Slam Fire, Hellfire Salvo) | bullets that hit / bullets fired |
| support | heals, shields, buffs on teammates | uses that reached an ally / uses |
| self | self buffs, mobility, utility | uses, % used in a fight |
| proc | passive items with a cooldown | triggers |

Effects include the buffs and debuffs an ability applied (from the demo's modifier table), not
just damage. Abilities whose effects land late (traps, fuses, slow projectiles) get a longer hit
window: the time in which 80 % of their first enemy effects landed.

## How "hit" is decided (`web/js/analysis.js`)

- **Thrown:** `ImportantAbilityUsed` for the ability. Old demos don't have it, so there a cast is
  the ability's cooldown starting.
- **Hit:** the first damage or status event from the same ability id inside the hit window
  (1–8 s, cut short by the next cast).
  - Enemy hero = hero hit.
  - Anything else that isn't an ally = non-hero hit.
  - Nothing = miss.
- **Aim error:** the horizontal angle between the caster's view at cast time and the nearest
  living enemy hero within 80 m.
