//! dlparse: turns a Deadlock .dem into a compact, hero-agnostic JSON event log.
//!
//! usage: dlparse <demo.dem> <out.json> [match_id]
//!
//! Everything is stamped with game time in seconds (0 = match start). Interpreting
//! "thrown vs hit" for a specific ability happens in the web UI, so new abilities need no
//! reparse. Bump `FORMAT_VERSION` whenever the output changes; tools/sync.py reparses demos
//! whose JSON has an older version.
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter};

use haste::demofile::DemoFile;
use haste::entities::{DeltaHeader, Entity, ehandle_to_index, fkey_from_path, is_ehandle_valid};
use haste::fxhash;
use haste::parser::{Context, Parser, Visitor};
use haste::valveprotos::common::{CnetMsgTick, NetMessages};
use haste::valveprotos::deadlock::{
    CCitadelUserMessageDamage, CCitadelUserMessageImportantAbilityUsed,
    CCitadelUserMsgAbilityNotify, CCitadelUserMsgHeroKilled, CitadelUserMessageIds,
};
use prost::Message;
use serde::Serialize;

const FORMAT_VERSION: u32 = 4;
/// movement abilities fire constantly and say nothing about skill usage; keep them out of `uses`
const NOISY_ABILITIES: &[u32] = &[
    2573821048, // zip_line
    875395762,  // zipline_boost
    4109126631, // mantle
    4261702459, // climb_rope
    1466127517, // jump
    1443159618, // sprint
    2207638101, // dash
    2335418656, // slide
    1262508092, // jump_ratking
];
/// position / health sample interval (seconds)
const SAMPLE_DT: f32 = 0.5;
/// economy (net worth, k/d/a, level) sample interval (seconds)
const STATS_DT: f32 = 10.0;

const GAME_RULES: u64 = fxhash::hash_bytes(b"CCitadelGameRulesProxy");
const CONTROLLER: u64 = fxhash::hash_bytes(b"CCitadelPlayerController");
const PAWN: u64 = fxhash::hash_bytes(b"CCitadelPlayerPawn");

const GAME_START_TIME: u64 = fkey_from_path(&["m_pGameRules", "m_flGameStartTime"]);
const PAUSED_TICKS: u64 = fkey_from_path(&["m_pGameRules", "m_nTotalPausedTicks"]);
const STEAM_ID: u64 = fkey_from_path(&["m_steamID"]);
const PLAYER_NAME: u64 = fkey_from_path(&["m_iszPlayerName"]);
const TEAM: u64 = fkey_from_path(&["m_iTeamNum"]);
const CTRL_HERO_ID: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_nHeroID"]);
const CTRL_LANE: u64 = fkey_from_path(&["m_nOriginalLaneAssignment"]);
const NET_WORTH: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iGoldNetWorth"]);
const LEVEL: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iLevel"]);
const KILLS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iPlayerKills"]);
const DEATHS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iDeaths"]);
const ASSISTS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iPlayerAssists"]);
const LAST_HITS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iLastHits"]);
const DENIES: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iDenies"]);
const PAWN_CONTROLLER: u64 = fkey_from_path(&["m_hController"]);
const PAWN_HERO_ID: u64 =
    fkey_from_path(&["m_CCitadelHeroComponent", "m_spawnedHero", "m_nHeroID"]);
const HEALTH: u64 = fkey_from_path(&["m_iHealth"]);
const MAX_HEALTH: u64 = fkey_from_path(&["m_iMaxHealth"]);
const LIFE_STATE: u64 = fkey_from_path(&["m_lifeState"]);
const EYE_ANGLES: u64 = fkey_from_path(&["m_angEyeAngles"]);
const CELL_X: u64 = fkey_from_path(&["CBodyComponent", "m_cellX"]);
const CELL_Y: u64 = fkey_from_path(&["CBodyComponent", "m_cellY"]);
const CELL_Z: u64 = fkey_from_path(&["CBodyComponent", "m_cellZ"]);
const VEC_X: u64 = fkey_from_path(&["CBodyComponent", "m_vecX"]);
const VEC_Y: u64 = fkey_from_path(&["CBodyComponent", "m_vecY"]);
const VEC_Z: u64 = fkey_from_path(&["CBodyComponent", "m_vecZ"]);
// ability / item entities
const COOLDOWN_START: u64 = fkey_from_path(&["m_flCooldownStart"]);
const COOLDOWN_END: u64 = fkey_from_path(&["m_flCooldownEnd"]);
const OWNER: u64 = fkey_from_path(&["m_hOwnerEntity"]);
const SUBCLASS: u64 = fkey_from_path(&["m_nSubclassID"]);
const UPGRADE_INFO: u64 = fkey_from_path(&["m_nUpgradeInfo"]);
const CHARGES: u64 = fkey_from_path(&["m_iRemainingCharges"]);

const STEAM_ID64_BASE: u64 = 76561197960265728;

#[derive(Default, Serialize, Clone)]
struct Player {
    controller: i32,
    pawn: i32,
    account_id: u32,
    name: String,
    hero_id: u32,
    team: u32,
    lane: i32,
    net_worth: i32,
    level: i32,
    kills: i32,
    deaths: i32,
    assists: i32,
    last_hits: i32,
    denies: i32,
}

/// Per-pawn time series, index i = time `samples.t0 + i * samples.dt`.
#[derive(Default, Serialize)]
struct Track {
    pawn: i32,
    /// x, y per sample (world units, rounded); 0,0 when unknown
    pos: Vec<i32>,
    /// health per sample (0 when dead)
    hp: Vec<i32>,
    max_hp: Vec<i32>,
}

#[derive(Default, Serialize)]
struct Samples {
    t0: f32,
    dt: f32,
    tracks: Vec<Track>,
}

/// Per-controller economy snapshots, index i = time `stats.t0 + i * stats.dt`.
#[derive(Default, Serialize)]
struct StatTrack {
    pawn: i32,
    /// [net_worth, level, kills, deaths, assists, last_hits] per sample
    rows: Vec<[i32; 6]>,
}

#[derive(Default, Serialize)]
struct Stats {
    t0: f32,
    dt: f32,
    tracks: Vec<StatTrack>,
}

#[derive(Default, Serialize)]
struct Output {
    version: u32,
    match_id: u64,
    tick_interval: f32,
    duration_s: f32,
    /// game clock when GameOver fired (None if the demo ends early)
    game_over_s: Option<f32>,
    map_radius: f32,
    players: Vec<Player>,
    /// [t, pawn, ability_name, x, y, z, yaw, pitch] (ImportantAbilityUsed + caster pose)
    casts: Vec<(f32, i32, String, i32, i32, i32, f32, f32)>,
    /// [t, pawn, ability_id, cooldown_s, charges_left] (ability/item cooldown started)
    uses: Vec<(f32, i32, u32, f32, i32)>,
    /// [t, pawn, item_id, +1 acquired / -1 removed]
    items: Vec<(f32, i32, u32, i32)>,
    /// [t, pawn, ability_id, upgrade_bits]
    upgrades: Vec<(f32, i32, u32, u64)>,
    /// [t, attacker_pawn, victim_entindex, victim_pawn_or_-1, ability_id, damage, victim_class, x, y]
    damage: Vec<(f32, i32, i32, i32, u32, i32, u32, i32, i32)>,
    /// [t, attacker_pawn, victim_pawn, ability_id, status_impact]
    notify: Vec<(f32, i32, i32, u32, u32)>,
    /// [t, victim_pawn, attacker_pawn, killer_ability_id, [assister pawns]]
    kills: Vec<(f32, i32, i32, u32, Vec<i32>)>,
    samples: Samples,
    stats: Stats,
}

#[derive(Default)]
struct AbilityState {
    owner_pawn: i32,
    id: u32,
    cooldown_start: f32,
    upgrade: u64,
    announced: bool,
}

#[derive(Default)]
struct V {
    out: Output,
    game_start: Option<f32>,
    paused_ticks: i32,
    /// server tick from net_Tick; demo ticks start later than server ticks
    net_tick: u32,
    controllers: HashMap<i32, Player>,
    pawn_ctrl: HashMap<i32, i32>,
    pawn_hero: HashMap<i32, u32>,
    abilities: HashMap<i32, AbilityState>,
    next_sample: f32,
    next_stat: f32,
    track_idx: HashMap<i32, usize>,
    stat_idx: HashMap<i32, usize>,
}

#[derive(Debug)]
struct VErr(String);
impl std::fmt::Display for VErr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for VErr {}

fn position(ctx: &Context, e: &Entity) -> Option<[f32; 3]> {
    let c = |cell: u64, vec: u64| -> Option<f32> {
        Some(ctx.deadlock_coord_from_cell(e.get_value::<u16>(&cell)?, e.get_value::<f32>(&vec)?))
    };
    Some([c(CELL_X, VEC_X)?, c(CELL_Y, VEC_Y)?, c(CELL_Z, VEC_Z)?])
}

impl V {
    /// game clock in seconds (0 = horn); negative during pregame.
    fn time(&self, ctx: &Context) -> f32 {
        let start = self.game_start.unwrap_or(0.0);
        (self.net_tick as i64 - self.paused_ticks as i64) as f32 * ctx.tick_interval() - start
    }


    fn is_hero_pawn(&self, idx: i32) -> bool {
        self.pawn_ctrl.contains_key(&idx)
    }

    fn ehandle_pawn(&self, h: u32) -> i32 {
        if is_ehandle_valid(h) { ehandle_to_index(h) } else { -1 }
    }

    fn pawn_pose(&self, ctx: &Context, pawn: i32) -> (i32, i32, i32, f32, f32) {
        let Some(e) = ctx.entities().and_then(|es| es.get(&pawn)) else {
            return (0, 0, 0, 0.0, 0.0);
        };
        let p = position(ctx, e).unwrap_or_default();
        let ang: [f32; 3] = e.get_value(&EYE_ANGLES).unwrap_or_default();
        (p[0] as i32, p[1] as i32, p[2] as i32, ang[1], ang[0])
    }

    fn handle_ability_entity(&mut self, ctx: &Context, dh: DeltaHeader, e: &Entity) {
        let idx = e.index();
        let t = self.time(ctx);
        if dh == DeltaHeader::DELETE || dh == DeltaHeader::LEAVE {
            if let Some(a) = self.abilities.remove(&idx) {
                if a.announced && t > 0.0 {
                    self.out.items.push((t, a.owner_pawn, a.id, -1));
                }
            }
            return;
        }
        let owner = e.get_value::<u32>(&OWNER).map(|h| self.ehandle_pawn(h)).unwrap_or(-1);
        if !self.is_hero_pawn(owner) {
            return;
        }
        let id = e.get_value::<u64>(&SUBCLASS).unwrap_or(0) as u32;
        let a = self.abilities.entry(idx).or_insert_with(|| AbilityState {
            owner_pawn: owner,
            id,
            ..Default::default()
        });
        if !a.announced {
            a.announced = true;
            a.owner_pawn = owner;
            a.id = id;
            a.cooldown_start = e.get_value(&COOLDOWN_START).unwrap_or(0.0);
            a.upgrade = e.get_value(&UPGRADE_INFO).unwrap_or(0);
            self.out.items.push((t, owner, id, 1));
            return;
        }
        let cd_start: f32 = e.get_value(&COOLDOWN_START).unwrap_or(0.0);
        if cd_start > 0.0 && (cd_start - a.cooldown_start).abs() > 1e-3 && !NOISY_ABILITIES.contains(&a.id) {
            a.cooldown_start = cd_start;
            let cd_end: f32 = e.get_value(&COOLDOWN_END).unwrap_or(cd_start);
            let charges: i32 = e.get_value(&CHARGES).unwrap_or(0);
            let (owner, id) = (a.owner_pawn, a.id);
            // stamp with the tick we saw the change on: server curtime is not aligned with
            // net ticks across demos (offsets of 0-50 s were observed), the tick is.
            self.out.uses.push((t, owner, id, cd_end - cd_start, charges));
        } else if cd_start <= 0.0 {
            a.cooldown_start = cd_start;
        }
        let a = self.abilities.get_mut(&idx).unwrap();
        let up: u64 = e.get_value(&UPGRADE_INFO).unwrap_or(0);
        if up != a.upgrade {
            a.upgrade = up;
            let (owner, id) = (a.owner_pawn, a.id);
            self.out.upgrades.push((t, owner, id, up));
        }
    }

    fn sample(&mut self, ctx: &Context, t: f32) {
        let Some(entities) = ctx.entities() else { return };
        let mut pawns: Vec<i32> = self.pawn_ctrl.keys().copied().collect();
        pawns.sort();
        for pawn in pawns {
            let n = self.out.samples.tracks.len();
            let ti = *self.track_idx.entry(pawn).or_insert(n);
            if ti == n {
                // backfill so every track lines up with t0
                let missing = ((t - self.out.samples.t0) / SAMPLE_DT).round() as usize;
                self.out.samples.tracks.push(Track {
                    pawn,
                    pos: vec![0; missing * 2],
                    hp: vec![0; missing],
                    max_hp: vec![0; missing],
                });
            }
            let (x, y, hp, mhp) = match entities.get(&pawn) {
                Some(e) => {
                    let p = position(ctx, e).unwrap_or_default();
                    let alive = e.get_value::<u64>(&LIFE_STATE).unwrap_or(0) == 0;
                    let hp: i32 = if alive { e.get_value(&HEALTH).unwrap_or(0) } else { 0 };
                    (p[0].round() as i32, p[1].round() as i32, hp, e.get_value(&MAX_HEALTH).unwrap_or(0))
                }
                None => (0, 0, 0, 0),
            };
            let tr = &mut self.out.samples.tracks[ti];
            tr.pos.push(x);
            tr.pos.push(y);
            tr.hp.push(hp);
            tr.max_hp.push(mhp);
        }
    }

    fn sample_stats(&mut self, ctx: &Context, t: f32) {
        let Some(entities) = ctx.entities() else { return };
        let mut pawns: Vec<(i32, i32)> = self.pawn_ctrl.iter().map(|(p, c)| (*p, *c)).collect();
        pawns.sort();
        for (pawn, ctrl) in pawns {
            let n = self.out.stats.tracks.len();
            let si = *self.stat_idx.entry(pawn).or_insert(n);
            if si == n {
                let missing = ((t - self.out.stats.t0) / STATS_DT).round() as usize;
                self.out.stats.tracks.push(StatTrack { pawn, rows: vec![[0; 6]; missing] });
            }
            let row = entities.get(&ctrl).map(|e| {
                let g = |k: &u64| e.get_value::<i32>(k).unwrap_or(0);
                [g(&NET_WORTH), g(&LEVEL), g(&KILLS), g(&DEATHS), g(&ASSISTS), g(&LAST_HITS)]
            }).unwrap_or_default();
            self.out.stats.tracks[si].rows.push(row);
        }
    }
}

fn decode<M: Message + Default>(data: &[u8]) -> Result<M, VErr> {
    M::decode(data).map_err(|e| VErr(e.to_string()))
}

impl Visitor for V {
    type Error = VErr;

    fn on_entity(&mut self, ctx: &Context, dh: DeltaHeader, e: &Entity) -> Result<(), VErr> {
        if e.serializer_name_heq(GAME_RULES) {
            if let Some(t) = e.get_value::<f32>(&GAME_START_TIME) {
                if t > 0.001 {
                    self.game_start = Some(t);
                }
            }
            if let Some(p) = e.get_value::<i32>(&PAUSED_TICKS) {
                self.paused_ticks = p;
            }
        } else if e.serializer_name_heq(CONTROLLER) {
            let p = self.controllers.entry(e.index()).or_default();
            p.controller = e.index();
            if let Some(sid) = e.get_value::<u64>(&STEAM_ID) {
                if sid > STEAM_ID64_BASE {
                    p.account_id = (sid - STEAM_ID64_BASE) as u32;
                }
            }
            if let Some(n) = e.get_value::<String>(&PLAYER_NAME) {
                p.name = n;
            }
            if let Some(t) = e.get_value::<u32>(&TEAM) {
                p.team = t;
            }
            if let Some(h) = e.get_value::<u32>(&CTRL_HERO_ID) {
                if h != 0 {
                    p.hero_id = h;
                }
            }
            let g = |k: &u64| e.get_value::<i32>(k);
            if let Some(v) = g(&CTRL_LANE) { p.lane = v; }
            if let Some(v) = g(&NET_WORTH) { p.net_worth = v; }
            if let Some(v) = g(&LEVEL) { p.level = v; }
            if let Some(v) = g(&KILLS) { p.kills = v; }
            if let Some(v) = g(&DEATHS) { p.deaths = v; }
            if let Some(v) = g(&ASSISTS) { p.assists = v; }
            if let Some(v) = g(&LAST_HITS) { p.last_hits = v; }
            if let Some(v) = g(&DENIES) { p.denies = v; }
        } else if e.serializer_name_heq(PAWN) {
            if let Some(h) = e.get_value::<u32>(&PAWN_CONTROLLER) {
                if is_ehandle_valid(h) {
                    self.pawn_ctrl.insert(e.index(), ehandle_to_index(h));
                }
            }
            if let Some(h) = e.get_value::<u32>(&PAWN_HERO_ID) {
                if h != 0 {
                    self.pawn_hero.insert(e.index(), h);
                }
            }
        } else if e.get_field_value(&COOLDOWN_START).is_some()
            || self.abilities.contains_key(&e.index())
        {
            self.handle_ability_entity(ctx, dh, e);
        }
        Ok(())
    }

    fn on_packet(&mut self, ctx: &Context, ty: u32, data: &[u8]) -> Result<(), VErr> {
        const DAMAGE: u32 = CitadelUserMessageIds::KEUserMsgDamage as u32;
        const IMPORTANT: u32 = CitadelUserMessageIds::KEUserMsgImportantAbilityUsed as u32;
        const NOTIFY: u32 = CitadelUserMessageIds::KEUserMsgAbilityNotify as u32;
        const KILLED: u32 = CitadelUserMessageIds::KEUserMsgHeroKilled as u32;
        const GAME_OVER: u32 = CitadelUserMessageIds::KEUserMsgGameOver as u32;
        const NET_TICK: u32 = NetMessages::NetTick as u32;
        match ty {
            NET_TICK => {
                if let Some(t) = decode::<CnetMsgTick>(data)?.tick {
                    self.net_tick = t;
                }
            }
            GAME_OVER => {
                if self.out.game_over_s.is_none() {
                    self.out.game_over_s = Some(self.time(ctx));
                }
            }
            DAMAGE => {
                let m: CCitadelUserMessageDamage = decode(data)?;
                let att = m.entindex_attacker();
                if !self.is_hero_pawn(att) || m.ability_id() == 0 {
                    return Ok(());
                }
                let vic = m.entindex_victim();
                let vic_pawn = if self.is_hero_pawn(vic) { vic } else { -1 };
                let (x, y) = m
                    .origin
                    .as_ref()
                    .map(|o| (o.x() as i32, o.y() as i32))
                    .unwrap_or((0, 0));
                let t = self.time(ctx);
                self.out.damage.push((
                    t, att, vic, vic_pawn, m.ability_id(), m.damage(), m.victim_class(), x, y,
                ));
            }
            IMPORTANT => {
                let m: CCitadelUserMessageImportantAbilityUsed = decode(data)?;
                let pawn = self.ehandle_pawn(m.caster());
                let t = self.time(ctx);
                let (x, y, z, yaw, pitch) = self.pawn_pose(ctx, pawn);
                self.out.casts.push((t, pawn, m.ability_name().to_owned(), x, y, z, yaw, pitch));
            }
            NOTIFY => {
                let m: CCitadelUserMsgAbilityNotify = decode(data)?;
                let t = self.time(ctx);
                let (a, v) = (self.ehandle_pawn(m.attacker()), self.ehandle_pawn(m.victim()));
                self.out.notify.push((t, a, v, m.ability_id(), m.status_impact()));
            }
            KILLED => {
                let m: CCitadelUserMsgHeroKilled = decode(data)?;
                let t = self.time(ctx);
                self.out.kills.push((
                    t,
                    m.entindex_victim(),
                    m.entindex_attacker(),
                    m.killer_ability_id(),
                    m.entindex_assisters.clone(),
                ));
            }
            _ => {}
        }
        Ok(())
    }

    fn on_tick_end(&mut self, ctx: &Context) -> Result<(), VErr> {
        self.out.tick_interval = ctx.tick_interval();
        let t = self.time(ctx);
        self.out.duration_s = t;
        if self.game_start.is_none() || self.pawn_ctrl.is_empty() {
            return Ok(());
        }
        if self.out.samples.tracks.is_empty() && self.out.samples.dt == 0.0 {
            // first sample after pawns exist; align to the sample grid
            let t0 = (t / SAMPLE_DT).floor() * SAMPLE_DT;
            self.out.samples.t0 = t0;
            self.out.samples.dt = SAMPLE_DT;
            self.next_sample = t0;
            let s0 = (t / STATS_DT).floor() * STATS_DT;
            self.out.stats.t0 = s0;
            self.out.stats.dt = STATS_DT;
            self.next_stat = s0;
        }
        while t >= self.next_sample {
            let st = self.next_sample;
            self.sample(ctx, st);
            self.next_sample += SAMPLE_DT;
        }
        while t >= self.next_stat {
            let st = self.next_stat;
            self.sample_stats(ctx, st);
            self.next_stat += STATS_DT;
        }
        Ok(())
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--version") {
        println!("{FORMAT_VERSION}");
        return Ok(());
    }
    if args.len() < 3 {
        anyhow::bail!("usage: dlparse <demo.dem> <out.json> [match_id]");
    }
    let match_id = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);

    let demo = DemoFile::start_reading(BufReader::new(File::open(&args[1])?))?;
    let mut parser = Parser::from_stream_with_visitor(demo, V::default())?;
    parser.run_to_end().map_err(|e| anyhow::anyhow!("parse failed: {e:?}"))?;
    let max_coord = parser.context().max_coord();
    let mut v = parser.into_visitor();

    let mut players: Vec<Player> = Vec::new();
    for (pawn, ctrl) in &v.pawn_ctrl {
        let Some(c) = v.controllers.get(ctrl) else { continue };
        let mut p = c.clone();
        p.pawn = *pawn;
        if let Some(h) = v.pawn_hero.get(pawn) {
            p.hero_id = *h;
        }
        players.push(p);
    }
    players.sort_by_key(|p| (p.team, p.lane, p.controller));
    v.out.players = players;
    v.out.match_id = match_id;
    v.out.version = FORMAT_VERSION;
    v.out.map_radius = max_coord.unwrap_or(0.0);
    v.out.uses.sort_by(|a, b| a.0.total_cmp(&b.0));

    serde_json::to_writer(BufWriter::new(File::create(&args[2])?), &v.out)?;
    eprintln!(
        "ok: {} players, {} casts, {} uses, {} items, {} damage, {} kills, {} samples, {:.0}s",
        v.out.players.len(),
        v.out.casts.len(),
        v.out.uses.len(),
        v.out.items.len(),
        v.out.damage.len(),
        v.out.kills.len(),
        v.out.samples.tracks.first().map_or(0, |t| t.hp.len()),
        v.out.duration_s
    );
    Ok(())
}
