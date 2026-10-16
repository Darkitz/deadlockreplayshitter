# Skill Hitter

Deadlock replay analysis for one player. For every ability it shows how many casts were
**thrown vs hit**, per match and across matches. The match view replays the game on a minimap
alongside timelines you can scrub.

It works for any hero, ability and player. The default is Drifter's Stalker's Mark for account
76800555.

## Quick start

```bash
tools/get-protoc.sh                       # once: protoc for the parser build
(cd parser && cargo build --release)      # once: demo parser
python3 tools/sync.py                     # pull history, find/download demos, parse
python3 tools/serve.py                    # http://127.0.0.1:8765 (sync button + auto-sync)
```

`serve.py` watches the game's replays folder. When you click **Download Replay** in Deadlock, the
match is parsed and shows up on the site without any further steps.

### sync.py options

| flag | |
| --- | --- |
| `--account <steamid64 or account id>` | player to track (default 76561198037066283) |
| `--hero drifter` (repeatable, or `all`) | heroes to try demo downloads for |
| `--no-download` | only use local demos |
| `--no-refetch` | use deadlock-api's cached match history (faster) |
| `--steam-salts` | let deadlock-api ask Steam for missing replay salts (rate-limited) |
| `--reparse` | reparse every demo |
| `--jobs N` | parallel parser processes |

Set the `DEADLOCK_REPLAYS` env var if your replays folder isn't
`/mnt/d/SteamLibrary/steamapps/common/Deadlock/game/citadel/replays`.

## What's on the site

**Overview** (`#/hero/<id>`):
- Hero tabs show how many matches have a demo out of the total.
- An ability picker.
- Totals for the selected ability: thrown, hit, accuracy, average hit delay, average hit range,
  and damage.
- Charts: accuracy per match, accuracy by game phase, most-hit heroes, hit delay, and hit range.
- An ability report covering all four abilities.
- Match cards with sparklines.
- A **career** section built from Valve's end-of-match stats. It covers every match, even
  without a demo: gun accuracy vs heroes, headshot rate, damage per minute, and ability damage
  by range.

**Match** (`#/match/<id>?pawn=&ability=`):
- Scoreboard with Steam avatars and each player's signature-ability accuracy (best one
  underlined). Click any player to analyze them instead.
- Every ability and every active item, with hit counts.
- Minimap:
  - interpolated positions, health rings and the subject's trail
  - aim rays on cast, and hit markers linked to the cast
  - kills, ziplines and objectives
  - an "all casts" overlay
- Timeline lanes: cumulative thrown vs hit, cast/kill/death markers, health, team souls lead, and
  item purchases. Click a marker to jump to it.
- Playback at 1× to 120×, an event feed, and CSV export.
- Keys: space, ←/→ (shift for ±30 s), `,` and `.` for the previous/next cast, home/end.

Matches without a demo still open, showing Valve's end-of-match stats.

## Layout

- `parser/`: Rust demo parser (`dlparse`). It uses deadlock-api's maintained fork of
  [haste](https://github.com/blukai/haste), vendored in `parser/vendor`; upstream haste hangs on
  current demos. Output is one gzipped JSON per match (`web/data/matches/<id>.json.gz`):
  - players and final stats
  - `ImportantAbilityUsed` casts, with caster position and aim
  - ability/item cooldown starts (`uses`), item purchases/sells, ability upgrades
  - all hero damage (ability id, victim, position), status notifications, kills with assisters
  - positions/health every 0.5 s, and souls/KDA every 10 s

  Times are game-clock seconds taken from the server tick; they match Valve's death timestamps.
  Run `dlparse --version` to see the format version. Sync reparses whenever it changes.
- `tools/sync.py`: history, demo lookup/download, parallel parsing, Steam profiles, Valve career
  stats, assets (hero/ability/item icons, minimap).
- `tools/serve.py`: static server with `/api/sync` and `/api/status`, plus the replay folder
  watcher. It binds to localhost only.
- `web/`: static site with no build step (ES modules: `data`, `analysis`, `timeline`, `minimap`,
  `app`).

## Where demos come from (in order)

1. `data/demos/<match_id>.dem`: drop demos here manually.
2. The game's replays folder, where in-game **Download Replay** saves them.
3. deadlock-api `/v1/matches/<id>/salts` → `replayNNN.valve.net/1422450/<id>_<salt>.dem.bz2`.

The replay salt never appears in public metadata. It comes only from the Steam Game Coordinator
(`GetMatchMetaData`) for a logged-in account. deadlock-api only knows it if someone submitted it
(their ingest tool or the mod manager's "match data sharing"). Valve also deletes old demos. Sync
remembers failed lookups: deleted demos are never retried, and missing salts are rechecked after
6 h.

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
