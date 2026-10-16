# Skill Hitter

Per-match timelines of ability casts vs. hits, built from Deadlock demo files.
Step 1: Drifter's Stalker's Mark for account 76800555. The pipeline works for any hero and any ability.

## Layout

- `parser/`: Rust demo parser (`dlparse`). It uses deadlock-api's maintained fork of
  [haste](https://github.com/blukai/haste), vendored in `parser/vendor`. Upstream haste hangs on
  current demos. It writes one compact JSON per match containing players, every
  `ImportantAbilityUsed` cast, all damage done by heroes (with ability ids), ability status
  notifications and kills, with timestamps in game seconds.
- `tools/sync.py`: gets the player's match history from deadlock-api, filters by hero, finds or
  downloads each demo, parses it, and mirrors hero/ability names and icons into `web/`.
- `web/`: static site with no build step.

## Run

```bash
# once: fetch protoc + build the parser
tools/get-protoc.sh
cd parser && cargo build --release && cd ..

# sync matches (defaults: --account 76561198037066283 --hero drifter)
python3 tools/sync.py
python3 tools/sync.py --hero "lady geist" --account 76800555   # any hero / player

# view
python3 -m http.server 8765 -d web    # open http://localhost:8765
```

`?ability=<class_name>` in the URL preselects an ability.

## Where demos come from (in order)

1. `data/demos/<match_id>.dem`: drop demos here manually.
2. The game's replay folder (`.../Deadlock/game/citadel/replays/<match_id>.dem`). This is where
   the in-game **Download Replay** button saves them.
3. deadlock-api `/v1/matches/<id>/salts` → `replayNNN.valve.net/1422450/<id>_<salt>.dem.bz2`.
   This only works if someone has submitted that match's replay salt. `--steam-salts` lets the
   API ask Steam, which is rate-limited.

The replay salt is never in the public metadata. It only comes from the Steam Game Coordinator
(`GetMatchMetaData`) for a logged-in account, and Valve's servers eventually delete old demos.

## How "hit" is decided (web/app.js `analyze`)

- **Thrown**: one `ImportantAbilityUsed` event for that ability from the player's pawn.
  Stalker's Mark reactivation (the teleport) doesn't emit one, so it isn't counted twice.
- **Hit**: the first damage or status event from the same ability id after the cast, within the
  hit window (default 3 s, cut short by the next cast). It counts as a hero hit if the target is
  a player pawn, and as non-hero otherwise (troopers, neutrals, objectives).
