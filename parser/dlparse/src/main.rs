//! dlparse: turns a Deadlock .dem into a compact, hero-agnostic JSON event log.
//!
//! usage: dlparse <demo.dem> <out.json> [match_id]
//!
//! Output contains every player, every ability cast (ImportantAbilityUsed), all damage dealt by
//! heroes (with ability ids), ability status notifications and hero kills, all stamped with game
//! time in seconds. Interpreting "thrown vs hit" for a specific ability happens in the web UI so
//! new abilities need no reparse.
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter};

use haste::demofile::DemoFile;
use haste::entities::{DeltaHeader, Entity, ehandle_to_index, fkey_from_path, is_ehandle_valid};
use haste::fxhash;
use haste::parser::{Context, Parser, Visitor};
use haste::valveprotos::deadlock::{
    CCitadelUserMessageDamage, CCitadelUserMessageImportantAbilityUsed,
    CCitadelUserMsgAbilityNotify, CCitadelUserMsgHeroKilled, CitadelUserMessageIds,
};
use prost::Message;
use serde::Serialize;

const GAME_RULES: u64 = fxhash::hash_bytes(b"CCitadelGameRulesProxy");
const CONTROLLER: u64 = fxhash::hash_bytes(b"CCitadelPlayerController");
const PAWN: u64 = fxhash::hash_bytes(b"CCitadelPlayerPawn");

const GAME_START_TIME: u64 = fkey_from_path(&["m_pGameRules", "m_flGameStartTime"]);
const PAUSED_TICKS: u64 = fkey_from_path(&["m_pGameRules", "m_nTotalPausedTicks"]);
const STEAM_ID: u64 = fkey_from_path(&["m_steamID"]);
const PLAYER_NAME: u64 = fkey_from_path(&["m_iszPlayerName"]);
const TEAM: u64 = fkey_from_path(&["m_iTeamNum"]);
const CTRL_HERO_ID: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_nHeroID"]);
const PAWN_CONTROLLER: u64 = fkey_from_path(&["m_hController"]);
const PAWN_HERO_ID: u64 =
    fkey_from_path(&["m_CCitadelHeroComponent", "m_spawnedHero", "m_nHeroID"]);

const STEAM_ID64_BASE: u64 = 76561197960265728;

#[derive(Default, Serialize, Clone)]
struct Player {
    controller: i32,
    pawn: i32,
    account_id: u32,
    name: String,
    hero_id: u32,
    team: u32,
}

#[derive(Default, Serialize)]
struct Output {
    match_id: u64,
    tick_interval: f32,
    duration_s: f32,
    players: Vec<Player>,
    /// [t, pawn, ability_name]
    casts: Vec<(f32, i32, String)>,
    /// [t, attacker_pawn, victim_entindex, victim_pawn_or_-1, ability_id, damage, victim_class]
    damage: Vec<(f32, i32, i32, i32, u32, i32, u32)>,
    /// [t, attacker_pawn, victim_pawn, ability_id, status_impact]
    notify: Vec<(f32, i32, i32, u32, u32)>,
    /// [t, victim_pawn, attacker_pawn, killer_ability_id]
    kills: Vec<(f32, i32, i32, u32)>,
}

#[derive(Default)]
struct V {
    out: Output,
    game_start: Option<f32>,
    paused_ticks: i32,
    controllers: HashMap<i32, Player>,
    pawn_ctrl: HashMap<i32, i32>,
    pawn_hero: HashMap<i32, u32>,
}

#[derive(Debug)]
struct VErr(String);
impl std::fmt::Display for VErr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for VErr {}

impl V {
    /// game clock in seconds (0 = horn); negative during pregame.
    fn time(&self, ctx: &Context) -> f32 {
        let start = self.game_start.unwrap_or(0.0);
        (ctx.tick() - self.paused_ticks) as f32 * ctx.tick_interval() - start
    }

    fn is_hero_pawn(&self, idx: i32) -> bool {
        self.pawn_ctrl.contains_key(&idx)
    }

    fn ehandle_pawn(&self, h: u32) -> i32 {
        if is_ehandle_valid(h) { ehandle_to_index(h) } else { -1 }
    }
}

fn decode<M: Message + Default>(data: &[u8]) -> Result<M, VErr> {
    M::decode(data).map_err(|e| VErr(e.to_string()))
}

impl Visitor for V {
    type Error = VErr;

    fn should_track_entity(&self, h: u64) -> bool {
        matches!(h, GAME_RULES | CONTROLLER | PAWN)
    }

    fn on_entity(&mut self, _ctx: &Context, _dh: DeltaHeader, e: &Entity) -> Result<(), VErr> {
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
        }
        Ok(())
    }

    fn on_packet(&mut self, ctx: &Context, ty: u32, data: &[u8]) -> Result<(), VErr> {
        const DAMAGE: u32 = CitadelUserMessageIds::KEUserMsgDamage as u32;
        const IMPORTANT: u32 = CitadelUserMessageIds::KEUserMsgImportantAbilityUsed as u32;
        const NOTIFY: u32 = CitadelUserMessageIds::KEUserMsgAbilityNotify as u32;
        const KILLED: u32 = CitadelUserMessageIds::KEUserMsgHeroKilled as u32;
        match ty {
            DAMAGE => {
                let m: CCitadelUserMessageDamage = decode(data)?;
                let att = m.entindex_attacker();
                if !self.is_hero_pawn(att) || m.ability_id() == 0 {
                    return Ok(());
                }
                let vic = m.entindex_victim();
                let vic_pawn = if self.is_hero_pawn(vic) { vic } else { -1 };
                let t = self.time(ctx);
                self.out.damage.push((
                    t, att, vic, vic_pawn, m.ability_id(), m.damage(), m.victim_class(),
                ));
            }
            IMPORTANT => {
                let m: CCitadelUserMessageImportantAbilityUsed = decode(data)?;
                let pawn = self.ehandle_pawn(m.caster());
                let t = self.time(ctx);
                self.out.casts.push((t, pawn, m.ability_name().to_owned()));
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
                    t, m.entindex_victim(), m.entindex_attacker(), m.killer_ability_id(),
                ));
            }
            _ => {}
        }
        Ok(())
    }

    fn on_tick_end(&mut self, ctx: &Context) -> Result<(), VErr> {
        self.out.tick_interval = ctx.tick_interval();
        self.out.duration_s = self.time(ctx);
        Ok(())
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        anyhow::bail!("usage: dlparse <demo.dem> <out.json> [match_id]");
    }
    let match_id = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);

    let demo = DemoFile::start_reading(BufReader::new(File::open(&args[1])?))?;
    let mut parser = Parser::from_stream_with_visitor(demo, V::default())?;
    parser.run_to_end().map_err(|e| anyhow::anyhow!("parse failed: {e:?}"))?;
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
    players.sort_by_key(|p| (p.team, p.controller));
    v.out.players = players;
    v.out.match_id = match_id;

    serde_json::to_writer(BufWriter::new(File::create(&args[2])?), &v.out)?;
    eprintln!(
        "ok: {} players, {} casts, {} damage, {} notify, {} kills, {:.0}s",
        v.out.players.len(), v.out.casts.len(), v.out.damage.len(), v.out.notify.len(),
        v.out.kills.len(), v.out.duration_s
    );
    Ok(())
}
