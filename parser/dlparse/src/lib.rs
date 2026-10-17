//! dlparse: turns a Deadlock .dem into a compact, hero-agnostic JSON event log.
//!
//! Library used by the `dlparse` CLI (src/main.rs) and, compiled to WebAssembly, by the browser
//! (src/wasm.rs) so people can drop a demo straight onto the website.
//!
//! Everything is stamped with game time in seconds (0 = match start). Interpreting
//! "thrown vs hit" for a specific ability happens in the web UI, so new abilities need no
//! reparse. Bump `FORMAT_VERSION` whenever the output changes (the JSON shape the site reads).
use std::collections::HashMap;
use std::io::{Read, Seek};

use haste::demofile::DemoFile;
use haste::entities::{DeltaHeader, Entity, ehandle_to_index, fkey_from_path, is_ehandle_valid};
use haste::fieldvalue::FieldValue;
use haste::fxhash;
use haste::parser::{Context, Parser, Visitor};
use haste::valveprotos::common::{CnetMsgTick, NetMessages};
use haste::valveprotos::deadlock::{
    CCitadelUserMessageDamage, CCitadelUserMessageGameOver, CCitadelUserMessageImportantAbilityUsed,
    CCitadelUserMsgAbilityNotify, CCitadelUserMsgChatMsg, CCitadelUserMsgHeroKilled,
    CitadelUserMessageIds,
};
use prost::Message;
use serde::Serialize;

pub const FORMAT_VERSION: u32 = 15;
/// movement abilities fire constantly and say nothing about skill usage; keep them out of `uses`.
/// They are string tokens of the class names, so they survive patches. The CLI can override them
/// with `--ignore-ids`; the browser build always uses this list.
pub const DEFAULT_NOISY_ABILITIES: &[u32] = &[
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
/// game seconds between progress callbacks
const PROGRESS_DT: f32 = 15.0;

const GAME_RULES: u64 = fxhash::hash_bytes(b"CCitadelGameRulesProxy");
const CONTROLLER: u64 = fxhash::hash_bytes(b"CCitadelPlayerController");
const PAWN: u64 = fxhash::hash_bytes(b"CCitadelPlayerPawn");
/// things worth hitting with a melee that are not heroes: troopers, neutrals, objectives, crates,
/// soul orbs (class names from server.dll, checked against the damage victims of real demos)
const MELEE_TARGET_CLASSES: [u64; 15] = [
    fxhash::hash_bytes(b"CNPC_Trooper"),
    fxhash::hash_bytes(b"CNPC_TrooperNeutral"),
    fxhash::hash_bytes(b"CNPC_TrooperBoss"),
    fxhash::hash_bytes(b"CNPC_Boss_Tier2"),
    fxhash::hash_bytes(b"CNPC_Boss_Tier3"),
    fxhash::hash_bytes(b"CNPC_BarrackBoss"),
    fxhash::hash_bytes(b"CNPC_MidBoss"),
    fxhash::hash_bytes(b"CNPC_BaseDefenseSentry"),
    fxhash::hash_bytes(b"CNPC_ShieldedSentry"),
    fxhash::hash_bytes(b"CNPC_Neutral_SinnersSacrifice"),
    fxhash::hash_bytes(b"CNPC_Neutral_SinnersSacrifice_Hideout"),
    fxhash::hash_bytes(b"CCitadel_BreakableProp"),
    fxhash::hash_bytes(b"CCitadel_Destroyable_Building"),
    fxhash::hash_bytes(b"CNPC_ChessPiece"),
    fxhash::hash_bytes(b"CItemXP"),
];
/// soul orbs carry a team but either side can hit them (secure / deny)
const SOUL_ORB: u64 = fxhash::hash_bytes(b"CItemXP");
/// surroundings of a melee swing are looked up this far (world units, 30 m)
const MELEE_LOOK: f32 = 30.0 / 0.0254;

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
// post-game scoreboard numbers (what the in-game scoreboard shows)
const HERO_DAMAGE: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iHeroDamage"]);
const OBJECTIVE_DAMAGE: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iObjectiveDamage"]);
const HERO_HEALING: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iHeroHealing"]);
const SELF_HEALING: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iSelfHealing"]);
const KILL_STREAK: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iKillStreak"]);
const GOLD: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iGold"]);
const GOLD_SOURCES: [(&str, u64); 6] = [
    ("troopers", fkey_from_path(&["m_PlayerDataGlobal", "m_iCreepGoldKill"])),
    ("ground_orbs", fkey_from_path(&["m_PlayerDataGlobal", "m_iCreepGoldGroundOrb"])),
    ("air_orbs", fkey_from_path(&["m_PlayerDataGlobal", "m_iCreepGoldAirOrb"])),
    ("neutrals", fkey_from_path(&["m_PlayerDataGlobal", "m_iCreepGoldNeutral"])),
    ("denies", fkey_from_path(&["m_PlayerDataGlobal", "m_iCreepGoldDeny"])),
    ("solo_bonus", fkey_from_path(&["m_PlayerDataGlobal", "m_iCreepGoldSoloBonus"])),
];
const PAWN_CONTROLLER: u64 = fkey_from_path(&["m_hController"]);
const PAWN_HERO_ID: u64 =
    fkey_from_path(&["m_CCitadelHeroComponent", "m_spawnedHero", "m_nHeroID"]);
const HEALTH: u64 = fkey_from_path(&["m_iHealth"]);
/// controller-side max health includes item and level bonuses (the pawn's m_iMaxHealth doesn't)
const CTRL_HEALTH_MAX: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iHealthMax"]);
const MAX_HEALTH: u64 = fkey_from_path(&["m_iMaxHealth"]);
const LIFE_STATE: u64 = fkey_from_path(&["m_lifeState"]);
// movement state (found by probing pawn fields in real demos)
const FLAGS: u64 = fkey_from_path(&["m_fFlags"]); // bit 0 = FL_ONGROUND
const ZIPLINE_COLOR: u64 = fkey_from_path(&["m_eZipLineLaneColor"]); // non-zero while on a zipline
const DUCKED: u64 = fkey_from_path(&["m_pMovementServices", "m_bDucked"]); // crouch / slide
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
// weapons
const SHOT_NUMBER: u64 = fkey_from_path(&["m_nShotNumber"]);
// melee (CCitadel_Ability_HoldMelee): 1 = light, 2 = heavy, 3 = heavy variant
const MELEE_ATTACK_TYPE: u64 = fkey_from_path(&["m_eCurrentAttackType"]);
const MELEE_TRIGGERED: u64 = fkey_from_path(&["m_flAttackTriggeredTime"]);
// parry (CCitadel_Ability_MeleeParry)
const PARRY_START: u64 = fkey_from_path(&["m_flParryStartTime"]);
const PARRY_SUCCESS: u64 = fkey_from_path(&["m_bAttackParried"]);

const STEAM_ID64_BASE: u64 = 76561197960265728;

/// subset of CModifierTableEntry (SteamDatabase/Protobufs deadlock/base_modifier.proto); the
/// ActiveModifiers string table holds one per buff/debuff
#[derive(Clone, PartialEq, prost::Message)]
struct ModifierEntry {
    #[prost(int32, optional, tag = "1")]
    entry_type: Option<i32>,
    #[prost(uint32, optional, tag = "2")]
    parent: Option<u32>,
    #[prost(uint32, optional, tag = "3")]
    serial_number: Option<u32>,
    #[prost(uint32, optional, tag = "4")]
    modifier_subclass: Option<u32>,
    #[prost(int32, optional, tag = "5")]
    stack_count: Option<i32>,
    #[prost(float, optional, tag = "8")]
    duration: Option<f32>,
    #[prost(uint32, optional, tag = "9")]
    caster: Option<u32>,
    #[prost(uint32, optional, tag = "13")]
    ability_subclass: Option<u32>,
}
const MODIFIER_SCAN_DT: f32 = 0.25;

/// CCitadelUserMsg_ChatWheel as current demos send it (the vendored proto is outdated): field 1
/// is a nested message with the sender's slot, the wheel message id and the voice line played
#[derive(Clone, PartialEq, prost::Message)]
struct ChatWheel {
    #[prost(message, optional, tag = "1")]
    line: Option<ChatWheelLine>,
}
#[derive(Clone, PartialEq, prost::Message)]
struct ChatWheelLine {
    #[prost(int32, optional, tag = "4")]
    player_slot: Option<i32>,
    #[prost(uint32, optional, tag = "5")]
    message_id: Option<u32>,
    #[prost(string, optional, tag = "6")]
    voice_line: Option<String>,
}

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
    /// damage to enemy heroes, to objectives, healing done (others / self)
    hero_damage: i32,
    objective_damage: i32,
    hero_healing: i32,
    self_healing: i32,
    /// longest kill streak (max of the live m_iKillStreak)
    max_streak: i32,
    /// unspent souls at the end
    gold: i32,
    /// souls by source, where the demo has them
    gold_sources: std::collections::BTreeMap<String, i32>,
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
    /// movement bits per sample: 1 = airborne, 2 = on a zipline, 4 = ducked (crouch / slide)
    mv: Vec<u8>,
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
    /// [net_worth, level, kills, deaths, assists, last_hits, hero_damage, objective_damage,
    ///  hero_healing, self_healing, denies, unspent gold] per sample
    rows: Vec<[i32; 12]>,
}

#[derive(Default, Serialize)]
struct Stats {
    t0: f32,
    dt: f32,
    tracks: Vec<StatTrack>,
}

#[derive(Default, Serialize)]
pub struct Output {
    version: u32,
    match_id: u64,
    tick_interval: f32,
    duration_s: f32,
    /// game clock when GameOver fired (None if the demo ends early)
    game_over_s: Option<f32>,
    /// team number that won (2 = Amber, 3 = Sapphire), from GameOver
    winning_team: Option<i32>,
    /// demo tick = game time / tick_interval + demo_tick_offset (for demo_gototick); pauses
    /// shift it, the value is taken at the end of the match
    demo_tick_offset: f32,
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
    /// [t, attacker_pawn, victim_entindex, victim_pawn_or_-1, ability_id, damage, victim_class, x, y,
    ///  hitgroup, crit]
    damage: Vec<(f32, i32, i32, i32, u32, i32, u32, i32, i32, i32, u8)>,
    /// melee swings: [t, pawn, melee_ability_id, attack_type (1 light, 2 heavy, 3 heavy variant),
    /// distance to the nearest living enemy hero, to the nearest enemy/neutral NPC, crate or
    /// objective (decimeters, -1 = none within 30 m)]
    melee: Vec<(f32, i32, u32, u8, i32, i32)>,
    /// parries: [t, pawn, 0 = attempt / 1 = successful parry]
    parries: Vec<(f32, i32, u8)>,
    /// weapon shots fired (trigger pulls; multiply by the weapon's pellets for bullets):
    /// [t, pawn, weapon_id, shots] (one row per tick with shots)
    shots: Vec<(f32, i32, u32, i32)>,
    /// [t, attacker_pawn, victim_pawn, ability_id, status_impact]
    notify: Vec<(f32, i32, i32, u32, u32)>,
    /// buffs/debuffs on heroes: [start, end, parent_pawn, caster_pawn_or_-1, modifier_id,
    ///  ability_id, max_stacks]; end = removal time (or start + duration if never seen removed)
    modifiers: Vec<(f32, f32, i32, i32, u32, u32, i32)>,
    /// [t, victim_pawn, attacker_pawn, killer_ability_id, [assister pawns]]
    kills: Vec<(f32, i32, i32, u32, Vec<i32>)>,
    /// movement abilities (kept out of `uses`): [t, pawn, ability_id] for dash, jump, mantle,
    /// slide, zipline boost, ...
    moves: Vec<(f32, i32, u32)>,
    /// damage heroes took from non-heroes: [t, victim pawn, damage, attacker_class]
    npc_hits: Vec<(f32, i32, i32, u32)>,
    /// typed chat: [t, pawn, 1 = all chat / 0 = team chat, text]
    chat: Vec<(f32, i32, u8, String)>,
    /// Valve's post-game summary, embedded in the demo at game end (the same data as the match
    /// metadata the in-game post-game screen shows: MVP, accolades, stats snapshots, items, ...)
    #[serde(skip_serializing_if = "Option::is_none")]
    postgame: Option<haste::valveprotos::deadlock::CMsgMatchMetaDataContents>,
    /// chat wheel: [t, pawn, wheel message id, voice line ("haze_ping_retreat_01_ping_2d", may be empty)]
    wheel: Vec<(f32, i32, u32, String)>,
    samples: Samples,
    stats: Stats,
    /// sanity problems found after parsing (a game patch changing the demo format shows up here)
    warnings: Vec<String>,
}

#[derive(Default)]
struct AbilityState {
    shot_number: Option<i64>,
    melee_triggered: f32,
    parry_start: f32,
    parried: bool,
    owner_pawn: i32,
    id: u32,
    cooldown_start: f32,
    upgrade: u64,
    announced: bool,
}

#[derive(Default)]
struct V {
    /// called with the game time reached, every PROGRESS_DT seconds (browser progress bar)
    progress: Option<Box<dyn FnMut(f32)>>,
    next_progress: f32,
    out: Output,
    game_start: Option<f32>,
    paused_ticks: i32,
    /// server tick from net_Tick; demo ticks start later than server ticks
    net_tick: u32,
    controllers: HashMap<i32, Player>,
    pawn_ctrl: HashMap<i32, i32>,
    pawn_hero: HashMap<i32, u32>,
    abilities: HashMap<i32, AbilityState>,
    noisy: Vec<u32>,
    /// ActiveModifiers row index -> (hash of user data, index into out.modifiers)
    mod_rows: HashMap<i32, (u64, Option<usize>)>,
    next_mod_scan: f32,
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

    fn pawn_team(&self, pawn: i32) -> u32 {
        self.pawn_ctrl.get(&pawn).and_then(|c| self.controllers.get(c)).map(|p| p.team).unwrap_or(0)
    }

    /// (nearest living enemy hero, nearest non-allied NPC / crate / objective) around a pawn, in
    /// decimeters; -1 when nothing is within MELEE_LOOK
    fn melee_surroundings(&self, ctx: &Context, pawn: i32) -> (i32, i32) {
        let Some(entities) = ctx.entities() else { return (-1, -1) };
        let Some(me) = entities.get(&pawn).and_then(|e| position(ctx, e)) else { return (-1, -1) };
        let team = self.pawn_team(pawn);
        let (mut hero, mut npc) = (f32::MAX, f32::MAX);
        for (&idx, e) in entities.iter() {
            let is_hero = self.is_hero_pawn(idx);
            if !is_hero && !MELEE_TARGET_CLASSES.iter().any(|&c| e.serializer_name_heq(c)) {
                continue;
            }
            if idx == pawn || e.get_value::<u64>(&LIFE_STATE).unwrap_or(0) != 0 {
                continue;
            }
            let other = if is_hero { self.pawn_team(idx) } else { e.get_value::<u32>(&TEAM).unwrap_or(0) };
            if (other == team && !e.serializer_name_heq(SOUL_ORB)) || (is_hero && e.get_value::<i32>(&HEALTH).unwrap_or(1) <= 0) {
                continue;
            }
            let Some(p) = position(ctx, e) else { continue };
            let d = ((p[0] - me[0]).powi(2) + (p[1] - me[1]).powi(2) + (p[2] - me[2]).powi(2)).sqrt();
            if is_hero { hero = hero.min(d) } else { npc = npc.min(d) }
        }
        let dm = |d: f32| if d <= MELEE_LOOK { (d * 0.254).round() as i32 } else { -1 };
        (dm(hero), dm(npc))
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
        if let Some(sn) = e.get_field_value(&SHOT_NUMBER).and_then(|v| match v {
            FieldValue::I64(x) => Some(*x),
            FieldValue::U64(x) => Some(*x as i64),
            _ => None,
        }) {
            let prev = a.shot_number.replace(sn);
            if let Some(prev) = prev {
                if sn > prev && t > 0.0 {
                    let (owner, id) = (a.owner_pawn, a.id);
                    self.out.shots.push((t, owner, id, (sn - prev) as i32));
                }
            }
        }
        let a = self.abilities.get_mut(&idx).unwrap();
        // melee swing: the trigger time jumps to a new non-zero value once per attack
        if let Some(trig) = e.get_value::<f32>(&MELEE_TRIGGERED) {
            if trig > 0.0 && (trig - a.melee_triggered).abs() > 1e-3 && t > 0.0 {
                let kind = e.get_value::<u64>(&MELEE_ATTACK_TYPE).unwrap_or(0) as u8;
                let (owner, id) = (a.owner_pawn, a.id);
                let (hero_d, npc_d) = self.melee_surroundings(ctx, owner);
                self.out.melee.push((t, owner, id, kind, hero_d, npc_d));
            }
        }
        let a = self.abilities.get_mut(&idx).unwrap();
        if let Some(trig) = e.get_value::<f32>(&MELEE_TRIGGERED) {
            a.melee_triggered = trig;
        }
        if let Some(ps) = e.get_value::<f32>(&PARRY_START) {
            if ps > 0.0 && (ps - a.parry_start).abs() > 1e-3 && t > 0.0 {
                self.out.parries.push((t, a.owner_pawn, 0));
            }
            a.parry_start = ps;
        }
        if let Some(ok) = e.get_value::<bool>(&PARRY_SUCCESS) {
            if ok && !a.parried && t > 0.0 {
                self.out.parries.push((t, a.owner_pawn, 1));
            }
            a.parried = ok;
        }
        let cd_start: f32 = e.get_value(&COOLDOWN_START).unwrap_or(0.0);
        if cd_start > 0.0 && (cd_start - a.cooldown_start).abs() > 1e-3 && self.noisy.contains(&a.id) {
            // movement ability: keep it apart from `uses` (they fire constantly)
            a.cooldown_start = cd_start;
            let (owner, id) = (a.owner_pawn, a.id);
            if t > 0.0 {
                self.out.moves.push((t, owner, id));
            }
        } else if cd_start > 0.0 && (cd_start - a.cooldown_start).abs() > 1e-3 {
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
                    mv: vec![0; missing],
                });
            }
            let ctrl_max: Option<i32> = self
                .pawn_ctrl
                .get(&pawn)
                .and_then(|c| entities.get(c))
                .and_then(|c| c.get_value(&CTRL_HEALTH_MAX));
            let (x, y, hp, mhp, mv) = match entities.get(&pawn) {
                Some(e) => {
                    let p = position(ctx, e).unwrap_or_default();
                    let alive = e.get_value::<u64>(&LIFE_STATE).unwrap_or(0) == 0;
                    let hp: i32 = if alive { e.get_value(&HEALTH).unwrap_or(0) } else { 0 };
                    let max = ctrl_max.unwrap_or_else(|| e.get_value(&MAX_HEALTH).unwrap_or(0));
                    let flags = e.get_value::<u64>(&FLAGS).unwrap_or(1);
                    let zip = e.get_value::<u64>(&ZIPLINE_COLOR).unwrap_or(0) != 0;
                    let ducked = e.get_value::<bool>(&DUCKED).unwrap_or(false);
                    let mv = u8::from(flags & 1 == 0) | (u8::from(zip) << 1) | (u8::from(ducked) << 2);
                    (p[0].round() as i32, p[1].round() as i32, hp, max.max(hp), if alive { mv } else { 0 })
                }
                None => (0, 0, 0, 0, 0),
            };
            let tr = &mut self.out.samples.tracks[ti];
            tr.pos.push(x);
            tr.pos.push(y);
            tr.hp.push(hp);
            tr.max_hp.push(mhp);
            tr.mv.push(mv);
        }
    }

    /// diff the ActiveModifiers string table against the last scan
    fn scan_modifiers(&mut self, ctx: &Context, t: f32) {
        let Some(table) = ctx.string_tables().and_then(|st| st.find_table("ActiveModifiers")) else {
            return;
        };
        let mut seen = std::collections::HashSet::new();
        for (idx, item) in table.items() {
            seen.insert(*idx);
            let Some(ud) = item.get_user_data() else { continue };
            let h = fxhash::hash_bytes(ud);
            if self.mod_rows.get(idx).is_some_and(|(ph, _)| *ph == h) {
                continue;
            }
            let prev = self.mod_rows.get(idx).and_then(|(_, o)| *o);
            let Ok(e) = ModifierEntry::decode(ud) else { continue };
            let removed = e.entry_type == Some(2);
            // a row that changed closes the previous modifier stored there
            if let Some(o) = prev {
                let row = &mut self.out.modifiers[o];
                if removed || e.serial_number.is_some() {
                    row.1 = row.1.min(t);
                }
                if !removed {
                    row.6 = row.6.max(e.stack_count.unwrap_or(0));
                }
            }
            let mut slot = None;
            if !removed {
                let parent = e.parent.filter(|h| is_ehandle_valid(*h)).map(ehandle_to_index).unwrap_or(-1);
                let noisy = self.noisy.contains(&e.ability_subclass.unwrap_or(0));
                if self.is_hero_pawn(parent) && !noisy {
                    let same = prev.is_some_and(|o| {
                        let r = &self.out.modifiers[o];
                        r.2 == parent && r.4 == e.modifier_subclass.unwrap_or(0)
                    });
                    if same {
                        // refresh / stack change of the same modifier: keep the row open
                        let o = prev.unwrap();
                        let dur = e.duration.unwrap_or(-1.0);
                        self.out.modifiers[o].1 = if dur > 0.0 { t + dur } else { f32::MAX };
                        slot = Some(o);
                    } else {
                        let caster = e.caster.filter(|h| is_ehandle_valid(*h)).map(ehandle_to_index).unwrap_or(-1);
                        let dur = e.duration.unwrap_or(-1.0);
                        let end = if dur > 0.0 { t + dur } else { f32::MAX };
                        self.out.modifiers.push((
                            t, end, parent, if self.is_hero_pawn(caster) { caster } else { -1 },
                            e.modifier_subclass.unwrap_or(0), e.ability_subclass.unwrap_or(0),
                            e.stack_count.unwrap_or(0),
                        ));
                        slot = Some(self.out.modifiers.len() - 1);
                    }
                }
            }
            self.mod_rows.insert(*idx, (h, slot));
        }
        // rows that vanished from the table
        let gone: Vec<i32> = self.mod_rows.keys().filter(|k| !seen.contains(k)).copied().collect();
        for k in gone {
            if let Some((_, Some(o))) = self.mod_rows.remove(&k) {
                let row = &mut self.out.modifiers[o];
                row.1 = row.1.min(t);
            }
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
                self.out.stats.tracks.push(StatTrack { pawn, rows: vec![[0; 12]; missing] });
            }
            let row = entities.get(&ctrl).map(|e| {
                let g = |k: &u64| e.get_value::<i32>(k).unwrap_or(0);
                [g(&NET_WORTH), g(&LEVEL), g(&KILLS), g(&DEATHS), g(&ASSISTS), g(&LAST_HITS),
                 g(&HERO_DAMAGE), g(&OBJECTIVE_DAMAGE), g(&HERO_HEALING), g(&SELF_HEALING), g(&DENIES), g(&GOLD)]
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
            if let Some(v) = g(&HERO_DAMAGE) { p.hero_damage = v; }
            if let Some(v) = g(&OBJECTIVE_DAMAGE) { p.objective_damage = v; }
            if let Some(v) = g(&HERO_HEALING) { p.hero_healing = v; }
            if let Some(v) = g(&SELF_HEALING) { p.self_healing = v; }
            if let Some(v) = g(&KILL_STREAK) { p.max_streak = p.max_streak.max(v); }
            if let Some(v) = g(&GOLD) { p.gold = v; }
            for (name, key) in GOLD_SOURCES {
                if let Some(v) = g(&key) { p.gold_sources.insert(name.to_string(), v); }
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
        } else if e.get_field_value(&COOLDOWN_START).is_some()
            || e.get_field_value(&SHOT_NUMBER).is_some()
            || e.get_field_value(&MELEE_TRIGGERED).is_some()
            || e.get_field_value(&PARRY_START).is_some()
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
        const CHAT: u32 = CitadelUserMessageIds::KEUserMsgChatMsg as u32;
        const WHEEL: u32 = CitadelUserMessageIds::KEUserMsgChatWheel as u32;
        const POST_MATCH: u32 = CitadelUserMessageIds::KEUserMsgPostMatchDetails as u32;
        const GAME_OVER: u32 = CitadelUserMessageIds::KEUserMsgGameOver as u32;
        const NET_TICK: u32 = NetMessages::NetTick as u32;
        match ty {
            NET_TICK => {
                if let Some(t) = decode::<CnetMsgTick>(data)?.tick {
                    self.net_tick = t;
                }
                if self.progress.is_some() {
                    let t = self.time(ctx);
                    if t >= self.next_progress {
                        self.next_progress = t + PROGRESS_DT;
                        if let Some(f) = self.progress.as_mut() {
                            f(t);
                        }
                    }
                }
            }
            GAME_OVER => {
                if self.out.game_over_s.is_none() {
                    self.out.game_over_s = Some(self.time(ctx));
                    let m: CCitadelUserMessageGameOver = decode(data)?;
                    self.out.winning_team = m.winning_team;
                }
            }
            DAMAGE => {
                let m: CCitadelUserMessageDamage = decode(data)?;
                let att = m.entindex_attacker();
                if !self.is_hero_pawn(att) {
                    // troopers, neutrals, objectives hitting a hero: tells "fighting troopers"
                    // apart from "out of combat" for the time-split chart
                    let vic = m.entindex_victim();
                    if self.is_hero_pawn(vic) && m.damage() > 0 {
                        self.out.npc_hits.push((self.time(ctx), vic, m.damage(), m.attacker_class()));
                    }
                    return Ok(());
                }
                if m.ability_id() == 0 {
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
                    m.hitgroup_id(), u8::from(m.crit_damage() > 0.0),
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
            CHAT => {
                // optional data: a changed message must not fail the whole demo
                let Ok(m) = CCitadelUserMsgChatMsg::decode(data) else { return Ok(()) };
                // player_slot is the controller entity index - 1; resolved to a pawn at the end
                let text = m.text().trim().to_string();
                if !text.is_empty() {
                    self.out.chat.push((self.time(ctx), m.player_slot() + 1, m.all_chat() as u8, text));
                }
            }
            WHEEL => {
                let Some(l) = ChatWheel::decode(data).ok().and_then(|m| m.line) else { return Ok(()) };
                // controller index (slot + 1), resolved to a pawn at the end
                let ctrl = l.player_slot.unwrap_or(-1) + 1;
                self.out.wheel.push((self.time(ctx), ctrl, l.message_id.unwrap_or(0), l.voice_line.unwrap_or_default()));
            }
            POST_MATCH => {
                // optional: a format change here must not fail the parse
                use haste::valveprotos::deadlock::{CCitadelUserMsgPostMatchDetails, CMsgMatchMetaDataContents};
                let details = CCitadelUserMsgPostMatchDetails::decode(data).ok()
                    .and_then(|m| CMsgMatchMetaDataContents::decode(m.match_details()).ok());
                if details.is_some() {
                    self.out.postgame = details;
                }
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
        if self.game_start.is_some() && ctx.tick_interval() > 0.0 {
            self.out.demo_tick_offset = ctx.tick() as f32 - t / ctx.tick_interval();
        }
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
        if t >= self.next_mod_scan {
            self.next_mod_scan = t + MODIFIER_SCAN_DT;
            self.scan_modifiers(ctx, t);
        }
        while t >= self.next_stat {
            let st = self.next_stat;
            self.sample_stats(ctx, st);
            self.next_stat += STATS_DT;
        }
        Ok(())
    }
}

/// cheap invariants; each failure usually means a field or message was renamed by a patch
fn sanity_check(o: &Output, has_start: bool) -> Vec<String> {
    let mut w = Vec::new();
    if !has_start {
        w.push("game start time not found (m_flGameStartTime)".into());
    }
    if o.players.len() != 12 {
        w.push(format!("{} players resolved (expected 12)", o.players.len()));
    }
    if o.players.iter().any(|p| p.account_id == 0) {
        w.push("players without steam id (m_steamID)".into());
    }
    if o.players.iter().any(|p| p.hero_id == 0) {
        w.push("players without hero id".into());
    }
    if o.casts.is_empty() {
        w.push("no ImportantAbilityUsed casts (old demo, or message changed)".into());
    }
    if o.uses.is_empty() {
        w.push("no ability cooldowns (m_flCooldownStart / m_nSubclassID)".into());
    }
    if o.damage.is_empty() {
        w.push("no hero damage events".into());
    }
    if o.shots.is_empty() {
        w.push("no weapon shots (m_nShotNumber)".into());
    }
    if o.melee.is_empty() {
        w.push("no melee swings (m_flAttackTriggeredTime)".into());
    }
    if o.modifiers.is_empty() {
        w.push("no modifiers (ActiveModifiers string table)".into());
    }
    if o.kills.is_empty() {
        w.push("no hero kills".into());
    }
    let moving = o.samples.tracks.iter().filter(|t| t.pos.iter().any(|&v| v != 0)).count();
    if moving < o.players.len() {
        w.push(format!("positions missing for {} players", o.players.len() - moving));
    }
    if o.stats.tracks.iter().all(|t| t.rows.iter().all(|r| r[0] == 0)) {
        w.push("net worth never set (m_iGoldNetWorth)".into());
    }
    w
}

/// short one-line summary of a parse (for logs)
pub fn summary(o: &Output) -> String {
    format!(
        "{} players, {} casts, {} uses, {} items, {} damage, {} shots, {} modifiers, {} kills, {} samples, {:.0}s",
        o.players.len(),
        o.casts.len(),
        o.uses.len(),
        o.items.len(),
        o.damage.len(),
        o.shots.iter().map(|s| s.3 as i64).sum::<i64>(),
        o.modifiers.len(),
        o.kills.len(),
        o.samples.tracks.first().map_or(0, |t| t.hp.len()),
        o.duration_s
    )
}

pub fn warnings(o: &Output) -> &[String] {
    &o.warnings
}

/// Parse a whole demo. `progress` is called now and then with the game time reached (seconds).
pub fn parse_demo<R: Read + Seek>(
    rdr: R,
    match_id: u64,
    noisy: Vec<u32>,
    progress: Option<Box<dyn FnMut(f32)>>,
) -> anyhow::Result<Output> {
    let demo = DemoFile::start_reading(rdr)?;
    let v = V { noisy, progress, ..V::default() };
    let mut parser = Parser::from_stream_with_visitor(demo, v)?;
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
    // chat carries controller indices; the site works with pawns
    let ctrl_pawn: HashMap<i32, i32> = v.pawn_ctrl.iter().map(|(p, c)| (*c, *p)).collect();
    for c in &mut v.out.chat {
        c.1 = ctrl_pawn.get(&c.1).copied().unwrap_or(-1);
    }
    for w in &mut v.out.wheel {
        w.1 = ctrl_pawn.get(&w.1).copied().unwrap_or(-1);
    }
    let end = v.out.duration_s;
    for m in &mut v.out.modifiers {
        if m.1 > end {
            m.1 = end;
        }
    }
    v.out.warnings = sanity_check(&v.out, v.game_start.is_some());
    Ok(v.out)
}

#[cfg(target_arch = "wasm32")]
mod wasm;
