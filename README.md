# Skill Hitter

Deadlock replay analysis for one player. For every ability it shows how many casts were
**thrown vs hit**, per match and across matches. The match view replays the game on a minimap
alongside timelines you can scrub.

It works for any hero, ability and player. The default is Drifter's Stalker's Mark for account
76800555.

## Quick start

```bash
tools/get-protoc.sh                       # once: protoc for the parser build
tools/get-vrf.sh                          # once: Source2Viewer-CLI to read game files
(cd parser && cargo build --release)      # once: demo parser
python3 tools/sync.py                     # pull history, find/download demos, parse
python3 tools/serve.py                    # http://127.0.0.1:8765 (sync button + auto-sync)
```

`serve.py` watches the game's replays folder. When you click **Download Replay** in Deadlock, the
match is parsed and shows up on the site without any further steps.

### Several players

```bash
python3 tools/sync.py --add-account 76561198000000000   # remember another player (steamid64 or account id)
python3 tools/sync.py                                   # syncs every remembered account
python3 tools/sync.py --account 60372773                # one-off run for one account
```

Parsed demos are shared, so a match is parsed once even when several tracked players were in it.

### sync.py options

| flag | |
| --- | --- |
| `--account <id>` (repeatable) | accounts for this run (default: remembered accounts, initially 76800555) |
| `--add-account <id>` / `--remove-account <id>` | edit the remembered accounts in `data/config.json` |
| `--hero drifter` (repeatable, or `all`) | heroes to try demo downloads for |
| `--no-download` | only use local demos |
| `--no-refetch` | use deadlock-api's cached match history (faster) |
| `--steam-salts` | let deadlock-api ask Steam for missing replay salts (rate-limited) |
| `--meta-all` | download Valve metadata for every match in history, not just demo/selected-hero ones |
| `--no-meta` | skip metadata downloads |
| `--reparse` | reparse every demo |
| `--jobs N` | parallel parser processes |

Set the `DEADLOCK_REPLAYS` env var if your replays folder isn't
`/mnt/d/SteamLibrary/steamapps/common/Deadlock/game/citadel/replays`.

## What's on the site

Matches are the main thing; players are how you find them. Every page and section has a URL.

**Matches** (`#/`): every parsed match with both teams, the winner, and the tracked players in it.
Search by player, hero or match id.

**Match** (`#/match/<id>?pawn=&ability=&from=&t=`):
- Scoreboard with Steam avatars and each player's signature-skill accuracy. Click a row to
  analyze that player, click the name to open their player page.
- Ability picker: **Gun**, the four signature abilities, other hero abilities (melee, parry,
  teleports) and active items, each with hits/thrown.
- Minimap replay: positions, health rings, trail, aim rays and hit markers, kills, ziplines,
  objectives, an "all casts" overlay, and hover cards with HP, souls, K/D/A and items.
- Timeline: cumulative thrown vs hit (or shots / hero hits / headshots in Gun mode), cast, kill
  and death markers, team souls lead. Wheel zooms, shift-wheel pans, double-click resets.
- **Spans**: shift+drag on the timeline (or `[` at the playhead) selects a window; every number
  on the page then covers only that window. **Fight chips** under the scrubber select a fight.
- State at the playhead: HP / max HP, souls, level, ability upgrade tiers, items, active buffs
  and enemy debuffs; while dead, a **death recap** (hero damage taken in the last 10 s by
  attacker and ability, nearest ally, enemies nearby).
- Event feed (filter: all / hit / miss / kills), CSV export, `in-game ↗` copies a
  `demo_gototick` command for the real replay.
- **Laning**: lane souls difference, last hits and K/D/A at 10:00, souls curve.
- **Accuracy tracker**: all 12 players' skill hit %, gun hit %, headshots, HP, souls and items
  at the playhead or within the span.
- **Incoming skillshots**: enemy casts aimed at the player, hit vs dodged.
- **Valve match report** (from the match metadata): objectives and souls over time, full
  scoreboard, how each player spent the match (combat state and movement), damage matrix, damage
  by source, gold sources, deaths with time-to-kill, accolades, power-ups and the item build.
- Matches without a demo still replay from Valve's 1 Hz position paths and show the report.

**Player** (`#/player/<id>`): win rate, KDA, skill accuracy, gun hit rate, headshot %, dodge
rate and isolated deaths across every parsed demo the player is in, per hero, per match, and
teammates/opponents. Tracked players also get hero tabs.

**Hero analysis** (`#/player/<id>/hero/<hero>?ability=`): one ability across matches: accuracy
per match, by game phase, by target hero and by distance, hit delay, aim error on misses, hit
range, cast map, hits that led to kills, ready-to-recast time, a benchmark against other players
on that hero, gun stats, career numbers from Valve's metadata, and filters (period, mode, result).

**Players** (`#/players`): everyone seen in parsed demos.

**Compare** (`#/compare/<a>/<b>`): two players side by side (skills, gun hero accuracy,
headshots, light/heavy melee, dodge rate, isolated deaths) plus the games they shared.

All cross-match pages take a **game-time window** (whole match / 0–10 / 10–20 / 20–30 / 30+ min,
linkable as `?gt=600-1200`).

Section deep links: `?section=report|tracker|laning|incoming|gun|career…` scrolls to a section,
`&solo=1` shows only that section.

Match files are cached in the browser (IndexedDB, 1 hour, keyed by parser version), so revisits
don't hit the server.

## Layout

- `parser/`: Rust demo parser (`dlparse`). It uses deadlock-api's maintained fork of
  [haste](https://github.com/blukai/haste), vendored in `parser/vendor`; upstream haste hangs on
  current demos. Output is one gzipped JSON per match (`web/data/matches/<id>.json.gz`):
  - players and final stats
  - `ImportantAbilityUsed` casts, with caster position and aim
  - ability/item cooldown starts (`uses`), item purchases/sells, ability upgrades
  - all hero damage (ability id, victim, position, hitgroup, crit), status notifications,
    kills with assisters, the winning team
  - weapon shots (trigger pulls), buffs/debuffs from the `ActiveModifiers` string table
  - positions/health/max health every 0.5 s, souls/KDA every 10 s, a demo-tick mapping
  - sanity `warnings`
- `dlmeta`: decodes Valve's `.meta` files (match metadata) to JSON.

  Times are game-clock seconds taken from the server tick; they match Valve's death timestamps.
  Run `dlparse --version` to see the format version. Sync reparses whenever it changes.
- `tools/sync.py`: history, demo lookup/download, parallel parsing, Steam profiles, Valve career
  stats, assets (hero/ability/item icons, minimap).
- `tools/serve.py`: static server with `/api/sync` and `/api/status`, plus the replay folder
  watcher. It binds to localhost only.
- `web/`: static site with no build step (ES modules: `data`, `analysis`, `timeline`, `minimap`,
  `app`).

## Where the data comes from

| data | source |
| --- | --- |
| demos | your replays folder / `data/demos/`, or Valve's replay servers (needs the replay salt) |
| match IDs, history, rank badges | deadlock-api `/v1/players/<id>/match-history` |
| replay + metadata salts | deadlock-api `/v1/matches/<id>/salts` (cached in `data/salts.json`) |
| match metadata | Valve's replay servers (`.meta` file via the metadata salt), decoded locally by `dlmeta` |
| heroes, abilities, items, modifiers, accolades, ranks, icons, minimap | your Deadlock install: `pak01_dir.vpk` via Source2Viewer-CLI (`tools/get-vrf.sh`) + localization files (`tools/game_assets.py`) |
| player names + avatars | steamcommunity.com public profile XML, cached 1 h |

Ability/item/modifier ids are Valve string tokens: MurmurHash2 of the lowercase class name, seed
`0x31415926`. If the game isn't installed, sync falls back to deadlock-api's asset endpoints.
Set `DEADLOCK_GAME` to your `game/citadel` folder if it isn't at the default path.

## Where demos come from (in order)

1. `data/demos/<match_id>.dem`: drop demos here manually.
2. The game's replays folder, where in-game **Download Replay** saves them.
3. deadlock-api `/v1/matches/<id>/salts` → `replayNNN.valve.net/1422450/<id>_<salt>.dem.bz2`.

The replay salt never appears in public metadata. It comes only from the Steam Game Coordinator
(`GetMatchMetaData`) for a logged-in account. deadlock-api only knows it if someone submitted it
(their ingest tool or the mod manager's "match data sharing"). Valve also deletes old demos. Sync
remembers failed lookups: deleted demos are never retried, and missing salts are rechecked after
6 h.

## After a Deadlock patch

Game updates can change the demo format: new field types, renamed fields, or new protobuf
messages. Here is what protects the site:

- **The parser fails loudly or warns.** `dlparse` writes sanity `warnings` into every match
  file, for example missing casts, positions, steam ids or net worth. Sync logs them, the site
  shows them on the match, and the footer lists any demos that failed to parse.
- **The canary:** `tools/check.sh` parses the newest local demo. It fails on parse errors or
  warnings, then runs all tests.
- **Updating the parser:** `tools/update-parser.sh` pulls deadlock-api's maintained haste fork
  and protos, which they keep current across patches. It then rebuilds and runs the canary. If
  either step fails, it restores the previous parser automatically.
- **No hardcoded game ids in the data path.** Heroes, abilities and items come from live
  deadlock-api assets on every sync. The movement abilities that get filtered out are resolved
  by class name and passed to the parser.
- **Reparsing on format changes.** Bumping `FORMAT_VERSION` in the parser makes the next sync
  reparse every demo.

Typical patch-day routine:

```bash
tools/check.sh || tools/update-parser.sh
python3 tools/sync.py
```

## Verifying a demo

```bash
python3 tools/verify_demo.py path/to/<match_id>.dem[.bz2]
```

There are three checks:
- **Valve's md5** (`x-goog-hash` on the replay server). This only works for the original
  `.dem.bz2`, and only while Valve still hosts it.
- **Recorded fingerprints** (`data/demo_hashes.json`). Sync stores Valve's md5 whenever a replay
  salt is known, before the file expires, plus a sha256 of every decompressed demo it parses.
- **Content cross-check against Valve's metadata**: the same accounts, heroes, teams, K/D/A,
  winner and length. The metadata outlives the demo by months, and nothing in it hashes the
  demo, so this is the check that keeps working.

## Gun and melee metrics

- **Gun:**
  - Each trigger pull (`m_nShotNumber`) is paired with the damage it caused: the first hit
    claims the oldest unclaimed shot within 1.5 s of travel time, and pellets from one shot
    count once.
  - **Hero accuracy** = shots that hit a hero / (all shots − shots that only hit
    troopers/neutrals). For single-bullet guns this lands within about 2 points of Valve's own
    hero accuracy. Shotguns differ because Valve counts pellets.
  - **Hero headshot %** = hero hits on hitgroup 1 or with crit damage / hero hits.
- **Melee:**
  - Swings come from the melee ability's `m_flAttackTriggeredTime`, and their type from
    `m_eCurrentAttackType` (1 light, 2 heavy, 3 heavy variant).
  - A swing counts as a hit when melee damage follows within 0.6 s.
  - Parries come from `m_flParryStartTime` / `m_bAttackParried`.

## Tests

```bash
node --test tests/*.test.mjs          # hit/miss classification, aim error, range
python3 -m unittest discover tests    # sync helpers
```

## How "hit" is decided (`web/js/analysis.js`)

- **Thrown** comes from `ImportantAbilityUsed` for the ability. Older demos don't have this
  message, so for them a cast is the ability's cooldown starting.
- **Hit** is the first damage or status event from the same ability id inside the hit window
  (1–8 s, cut short by the next cast). An enemy hero counts as a hero hit, anything else that
  isn't an ally counts as a non-hero hit, and no event is a miss.
- Hit position is the damage origin, which is within about 1–2 m of the victim. Range is measured
  from the caster's position at cast time.
- **Aim error** is the horizontal angle between the caster's eye yaw at cast time and the nearest
  alive enemy hero within 80 m. On real Drifter data, hits sit at about 2° and Rend misses at
  about 20°.
