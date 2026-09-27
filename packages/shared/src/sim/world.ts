import { HOP_PUSH_WINDOW, KILL_MARGIN, TICK_RATE } from '../constants.ts';
import { ALL_DIRS, dirVec, perpendicular, type Dir } from '../dir.ts';
import { mulberry32, rngNext } from '../rng.ts';
import type { Level, Mode, PickupType, Placement, Pose, Vanish } from '../level/types.ts';
import { add, cellKey, sub, type Vec3 } from '../vec.ts';
import { crumbleBands } from './crumble.ts';

/** Extend by appending; values go over the network. */
export const Action = { Idle: 0, Roll: 1, Turn: 2, Flip: 3, Jump: 4, Fall: 5, Dead: 6, Hop: 7, Knocked: 8, Stunned: 9, Rebound: 10, Climb: 11, Strike: 12, Charge: 13, Teleport: 14 } as const;
export type Action = (typeof Action)[keyof typeof Action];

/**
 * 'jump' = jump forward, 'hop' = bounce in place. A jump pulse picks one by fwdHeld (see commands() in tick.ts).
 * 'boost' and 'teleport' are never input: the forced launch off a boost pad, and the warp off a teleporter (§18).
 */
export type Cmd = 'fwd' | 'left' | 'right' | 'jump' | 'hop' | 'boost' | 'teleport';
export type Pulse = 'left' | 'right' | 'jump';

/** Client → server input message (ARCHITECTURE §6). `turn` and `jump` are pulses; `jumpHeld` keeps bouncing. */
export interface Input { seq: number; fwdHeld: boolean; turn: -1 | 0 | 1; jump: boolean; jumpHeld: boolean }

export interface PlayerState {
  id: string;
  name: string;
  /** Settled pose; equals `from` while an action runs. */
  pose: Pose;
  action: Action;
  to: Pose;
  startTick: number;
  endTick: number;
  keys: number;
  /** Ids of the held keys, oldest first; a death drops the last one (push rules). */
  keyIds: number[];
  fwdHeld: boolean;
  jumpHeld: boolean;
  /** Forward pressed during a Hop: the next decision is a forward jump even if W is released by then. */
  fwdLatch: boolean;
  pulse: Pulse | null;
  /** Ticks the buffered pulse has waited, not counting airborne ticks (Hop/Jump/Fall). */
  pulseAge: number;
  /** Last mid-air turn, for rendering: facing before it and the tick it happened. Reset at every action start. */
  turnFromFwd: Dir;
  turnStartTick: number;
  /** Stunned by a failed push (render: lunge and recoil); on a Knocked ball, a head-on's knock-back (§20). */
  bounce: boolean;
  /** Who knocked this player last and when, for knockout credit. Cleared on death. */
  lastKnockedBy: string | null;
  lastKnockedTick: number;
  /** Push credits (knockouts) this round; the knockout-mode timeout tiebreak. */
  knockouts: number;
  /** Knockout mode: lives left, and elimination (at 0 lives: stays Dead, reserves nothing, spectates). */
  lives: number;
  eliminated: boolean;
  /** Tick of elimination (-1 while in) and who knocked the player out last, if credited. */
  eliminatedTick: number;
  eliminatedBy: string | null;
  /** Unpushable while tick < protectedUntil (knockout respawn). Ends early when this player pushes. */
  protectedUntil: number;
  /** Forward jump over a player on A1: A1 isn't reserved by the jumper (§16). */
  jumpOver: boolean;
  /** Stomp jump: the bump cell B = L + F, reserved for the whole jump; null otherwise (§16). */
  stompBump: Vec3 | null;
  /** Jump grace (§6): a Roll started from rest can still turn into a standing jump until this tick; -1 otherwise. */
  graceUntil: number;
  /** Hot tiles: the heat of the tile under this player (a copy of `world.hot` at its tile, 0 while dead). */
  heat: number;
  /** Fire landings in a row (§18); 3 pops the ball. */
  fireCount: number;
  /** A forced move for this tick's decision (an ice slide or a boost launch, §18), set when an action finishes. */
  forced: Cmd | null;
  /** Knocked onto ice (§18): sliding in the knock direction, and staggered once the slide stops. */
  staggerOwed: boolean;
  /** Boost pad (phase 14c) or teleporter (13b): the tick a blocked launch started holding the ball (Charge), or -1. */
  boostHold: number;
  /** The pad or teleporter (tileKey) a held launch gave up on: it doesn't fire again until the ball leaves it. */
  boostSpent: string | null;
  /** Pills (phase 15a): active effects, one per type. Cleared on death. */
  effects: Effect[];
}

/** An active pill effect (§21): gone from `untilTick` on. */
export interface Effect { type: PickupType; untilTick: number }
/** A pickup on the map (§21). `spot`: its fixed spot's index, or -1 for a random spawn. Ids are never reused. */
export interface Pickup extends Placement { id: number; spot: number; type: PickupType }

export interface KeyItem { id: number; cell: Vec3; collected: boolean }
/** 'lastAlive': one knockout player left; 'allOut': the last ones were eliminated together (a draw). */
export interface RaceResult { winnerId: string | null; reason: 'exit' | 'timeout' | 'lastAlive' | 'allOut' }

/** `chain: false` turns the cradle push off: a player behind the victim bounces the pusher (phase 11 rules; soak comparisons). */
export interface Rules { push: boolean; chain?: boolean }

/** Knockout crumble progress (ARCHITECTURE §15). Bands are block cellKeys, furthest from the centre first. */
export interface KnockoutState {
  bands: string[][];
  /** Index of the next band to remove. */
  next: number;
  /** Band currently warned, or -1. */
  warn: number;
  /** The floor rule stopped crumbling for good. */
  stopped: boolean;
}

export interface World {
  level: Level;
  mode: Mode;
  rules: Rules;
  seed: number;
  /** mulberry32 state for in-round randomness (knockout respawn spawns). */
  rng: number;
  /** Crumbled blocks (cellKeys). isSolid(world, v) is the level minus these. */
  removed: Set<string>;
  /** Crumble progress (§15; race levels may crumble too since phase 12). Named for its first mode. */
  knockout: KnockoutState | null;
  /** Hot tiles, in ticks (from the level; the predictor turns them off). */
  heat: { warnTicks: number; burnTicks: number } | null;
  /** Crumble tiles (§18): block cellKey → the tick it is (or was) removed. Deleted when it regrows. */
  crumbling: Map<string, number>;
  /** Tile heat (phase 12c), by tileKey; only tiles with heat > 0. */
  hot: Map<string, number>;
  /** Laser groups (phase 13b): group → on. Starts from the level. */
  lasers: Map<string, boolean>;
  /** Switch tiles (tileKey) → the tick they last toggled (20-tick cooldown). */
  switchAt: Map<string, number>;
  tick: number;
  timeLimitTick: number;
  /** Join order; step() iterates it rotated by tick for fairness. */
  players: PlayerState[];
  keys: KeyItem[];
  result: RaceResult | null;
  /** Spawn indices in the order players get them, shuffled per seed so join order doesn't fix the spawn. */
  spawnOrder: number[];
  /** Pickups (phase 15a): the ones on the map, the tick each fixed spot comes back (-1: on the map), the next id,
   * the random spawner's RNG state and its candidate tiles (computed on first use), and whether spots respawn and
   * random ones spawn at all (the predictor leaves that to the server). */
  pickups: Pickup[];
  pickupBack: number[];
  nextPickupId: number;
  pickupRng: number;
  pickupSpots: Placement[] | null;
  spawnPickups: boolean;
}

export type SimEvent =
  | { type: 'key'; playerId: string; keyId: number; keys: number }
  | { type: 'win'; winnerId: string | null; reason: RaceResult['reason'] }
  | { type: 'death'; playerId: string; cell: Vec3; cause: DeathCause }
  | { type: 'respawn'; playerId: string; cell: Vec3 }
  | { type: 'push'; pusherId: string; victimId: string; edge?: true; moving?: 'headon' | 'side' }
  | { type: 'bounce'; playerId: string }
  | { type: 'keyDrop'; playerId: string; keyId: number }
  | { type: 'knockout'; pusherId: string; victimId: string }
  | { type: 'lifeLost'; playerId: string; livesLeft: number }
  | { type: 'eliminated'; playerId: string; byId?: string }
  | { type: 'crumbleWarn'; band: number }
  | { type: 'crumble'; band: number }
  | { type: 'stomp'; attackerId: string; victimId: string }
  | { type: 'clash'; attackerId: string; victimId: string }
  | { type: 'burn'; playerId: string }
  | { type: 'cradle'; pusherId: string; victimId: string; length: number }
  | { type: 'boost'; playerId: string; result: 'launch' | 'held' | 'released'; reason?: BoostBlock; byId?: string }
  | { type: 'teleport'; playerId: string; result: 'go' | 'held' | 'released' }
  | { type: 'laser'; playerId: string; group: string; on: boolean }
  | { type: 'pickup'; playerId: string; pickupId: number; pickup: PickupType }
  | { type: 'effectEnd'; playerId: string; effect: PickupType };

/** Why a launch is held (phase 14c): a flown-through or landing cell is solid, the landing is taken, or its ball can't be stomped (or bumped). */
export type BoostBlock = 'solid' | 'reserved' | 'unstompable' | 'bump';

/** Why a ball died (§18), for the HUD and toasts. */
export type DeathCause = 'fall' | 'spikes' | 'fire' | 'burn' | 'laser';

/** The level's `mode` picks the mode. Knockout always plays with push on, whatever `rules` says. */
export function createWorld(level: Level, seed: number, rules: Rules = { push: true }): World {
  const knockout = level.mode === 'knockout';
  return {
    level,
    mode: level.mode,
    rules: knockout ? { ...rules, push: true } : rules,
    seed,
    rng: seed >>> 0,
    removed: new Set(),
    knockout: level.crumble ? { bands: crumbleBands(level), next: 0, warn: -1, stopped: false } : null,
    heat: level.heat,
    hot: new Map(),
    lasers: new Map(level.lasers.map((l) => [l.group, l.on])),
    switchAt: new Map(),
    crumbling: new Map(),
    tick: 0,
    timeLimitTick: level.timeLimitSec * TICK_RATE,
    players: [],
    keys: level.keys.map((k, id) => ({ id, cell: k.cell, collected: false })),
    result: null,
    spawnOrder: shuffledIndices(level.spawns.length, seed),
    pickups: level.pickups.map((s, i) => ({ id: i, spot: i, cell: s.cell, up: s.up, type: s.type })),
    pickupBack: level.pickups.map(() => -1),
    nextPickupId: level.pickups.length,
    pickupRng: (seed ^ 0x9e3779b9) >>> 0,
    pickupSpots: null,
    spawnPickups: true,
  };
}

/** Fisher-Yates over 0..n-1 with the seeded RNG: deterministic per seed. */
function shuffledIndices(n: number, seed: number): number[] {
  const rnd = mulberry32(seed);
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clonePose = (p: Pose): Pose => ({ cell: { ...p.cell }, up: p.up, fwd: p.fwd });

/**
 * Places the player on a free spawn that still has ground: the first in spawnOrder, or with `random` a seeded-random
 * one (knockout respawns). When crumbling has taken the ground from every spawn, a random respawn uses any free cell
 * on a remaining block instead. Returns false (player untouched) if there is none.
 */
export function trySpawn(world: World, p: PlayerState, random = false): boolean {
  const res = reservations(world);
  // A high hopper's cell isn't reserved (§14), but nobody spawns under one.
  const taken = new Set(world.players.filter((q) => q !== p && q.action !== Action.Dead).map((q) => cellKey(q.pose.cell)));
  const open1 = (c: Vec3) => isFree(world, res, p.id, c) && !taken.has(cellKey(c));
  let open = world.spawnOrder.map((i) => world.level.spawns[i])
    .filter((s) => open1(s.cell) && isSolid(world, sub(s.cell, dirVec(s.up))));
  if (!open.length && random) open = standingCells(world).filter((s) => open1(s.cell));
  if (!open.length) return false;
  let spawn = open[0];
  if (random) {
    const r = rngNext(world.rng);
    world.rng = r.state;
    spawn = open[Math.floor(r.value * open.length)];
  }
  p.pose = clonePose(spawn);
  p.to = clonePose(spawn);
  p.action = Action.Idle;
  p.startTick = p.endTick = world.tick;
  p.turnFromFwd = spawn.fwd;
  p.turnStartTick = world.tick;
  return true;
}

/** Every place a ball could stand on the remaining blocks (any face), in level order; fwd is the first perpendicular dir. */
function standingCells(world: World): Pose[] {
  const out: Pose[] = [];
  for (const k of world.level.solid) {
    if (world.removed.has(k)) continue;
    const [x, y, z] = k.split(',').map(Number);
    for (const up of ALL_DIRS) {
      const cell = add({ x, y, z }, dirVec(up));
      if (!isSolid(world, cell)) out.push({ cell, up, fwd: ALL_DIRS.find((d) => perpendicular(d, up))! });
    }
  }
  return out;
}

/** Adds a player at the first free spawn. With no free spawn it waits as Dead and retries every tick. */
export function addPlayer(world: World, id: string, name: string): PlayerState {
  const spawn = clonePose(world.level.spawns[0]);
  const p: PlayerState = {
    id, name, pose: spawn, to: clonePose(spawn), action: Action.Dead,
    startTick: world.tick, endTick: world.tick + 1, keys: 0, keyIds: [],
    fwdHeld: false, jumpHeld: false, fwdLatch: false, pulse: null, pulseAge: 0, turnFromFwd: spawn.fwd, turnStartTick: world.tick,
    bounce: false, lastKnockedBy: null, lastKnockedTick: 0, knockouts: 0,
    lives: world.level.lives, eliminated: false, eliminatedTick: -1, eliminatedBy: null, protectedUntil: 0,
    jumpOver: false, stompBump: null, graceUntil: -1, heat: 0, fireCount: 0, forced: null, staggerOwed: false,
    boostHold: -1, boostSpent: null, effects: [],
  };
  world.players.push(p);
  trySpawn(world, p);
  return p;
}

export function removePlayer(world: World, id: string): void {
  world.players = world.players.filter((p) => p.id !== id);
}

export function setInput(world: World, id: string, input: Input): void {
  const p = world.players.find((q) => q.id === id);
  if (!p) return;
  if (input.fwdHeld && !p.fwdHeld && p.action === Action.Hop) p.fwdLatch = true;
  p.fwdHeld = input.fwdHeld;
  p.jumpHeld = input.jumpHeld;
  const pulse: Pulse | null = input.jump ? 'jump' : input.turn < 0 ? 'left' : input.turn > 0 ? 'right' : null;
  if (pulse) { p.pulse = pulse; p.pulseAge = 0; }
}

/** Cells a player occupies: its cell plus the target (and pass-through) cells of its running action. */
export function occupiedCells(p: PlayerState): Vec3[] {
  const { cell, fwd } = p.pose;
  switch (p.action) {
    case Action.Dead: return [];
    case Action.Idle: case Action.Turn: case Action.Hop: case Action.Stunned: case Action.Strike: case Action.Charge: return [cell];
    case Action.Flip: return [cell, add(cell, dirVec(fwd)), p.to.cell];
    case Action.Jump: {
      // Over a player on A1: A1 stays theirs. A stomp jump also holds the bump cell B.
      const cells = p.jumpOver ? [cell, p.to.cell] : [cell, add(cell, dirVec(fwd)), p.to.cell];
      return p.stompBump ? [...cells, p.stompBump] : cells;
    }
    case Action.Knocked: { // a heavy ball's push knocks 2 cells (§21): the one in between is held too
      const d = sub(p.to.cell, cell);
      return Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z) === 2 ? [cell, add(cell, { x: d.x / 2, y: d.y / 2, z: d.z / 2 }), p.to.cell] : [cell, p.to.cell];
    }
    default: return [cell, p.to.cell];
  }
}

/**
 * Can a push or a stomp land on `v` at `tick` (ARCHITECTURE §14, §16)? One helper for both. Idle, Turning, Stunned by a bounce (not the stagger after a
 * knock), or Hopping while low: the first HOP_PUSH_WINDOW ticks after the hop's start tick or the last HOP_PUSH_WINDOW
 * before its end. A hop on its start tick is an escape, not pushable. Never while spawn-protected (§15).
 * The same-face check is the pusher's (v.pose.up === pusher up).
 */
export function isPushable(v: PlayerState, tick: number): boolean {
  return !hasEffect(v, 'heavy') && pushableState(v, tick);
}

/** A pill effect is active (§21). Expired effects are removed at the start of the tick they end. */
export const hasEffect = (p: { effects?: readonly Effect[] }, type: PickupType): boolean => !!p.effects?.some((e) => e.type === type);

/**
 * isPushable ignoring the heavy pill: a heavy ball in a state like this bounces its attacker instead of just blocking
 * it (§21).
 */
export function pushableState(v: PlayerState, tick: number): boolean {
  if (tick < v.protectedUntil) return false; // knockout spawn protection
  switch (v.action) {
    case Action.Idle: case Action.Turn: case Action.Strike: case Action.Charge: return true; // a charging ball can be shoved off its pad
    case Action.Stunned: return v.bounce; // a knocked victim staggers; a bounced pusher is fair game
    case Action.Hop: return lowHop(v, tick);
    default: return false;
  }
}

/**
 * A hop high in the air (§14 roll under): past its low window at both ends. Its ground cell is air-occupied: it
 * doesn't block rolls, flips or climbs, isn't a push victim and isn't reserved. The start tick is neither low nor high.
 */
export function airHop(v: { action: number; startTick: number; endTick: number }, tick: number): boolean {
  return v.action === Action.Hop && tick - v.startTick > HOP_PUSH_WINDOW && v.endTick - tick > HOP_PUSH_WINDOW;
}

/** A hop is low (touching the ground) in its first HOP_PUSH_WINDOW ticks after the start tick and its last ones. */
function lowHop(v: PlayerState, tick: number): boolean {
  const since = tick - v.startTick;
  return (since >= 1 && since <= HOP_PUSH_WINDOW) || v.endTick - tick <= HOP_PUSH_WINDOW;
}

/**
 * A middle ball of a cradle line passes the strike on (§14, phase 12b): grounded and not moving. Idle, Turning,
 * Striking, Stunned (bounce or stagger) or a low Hop. Spawn protection doesn't matter: a middle ball isn't moved.
 */
export function transmits(v: PlayerState, tick: number): boolean {
  switch (v.action) {
    case Action.Idle: case Action.Turn: case Action.Strike: case Action.Stunned: case Action.Charge: return true;
    case Action.Hop: return lowHop(v, tick);
    default: return false;
  }
}

/** Outside the level's AABB expanded by KILL_MARGIN: a falling player here dies. */
export function outOfBounds(level: Level, c: Vec3): boolean {
  const { min, max } = level, m = KILL_MARGIN;
  return c.x < min.x - m || c.y < min.y - m || c.z < min.z - m || c.x > max.x + m || c.y > max.y + m || c.z > max.z + m;
}

/** cellKey → id of the player holding it. Derived each tick, never stored in the world. */
export type Reservations = Map<string, string>;

/** A high hopper's cell is air-occupied (§14), so it isn't reserved: others roll under it. */
export function reservations(world: World): Reservations {
  const res: Reservations = new Map();
  for (const p of world.players) if (!airHop(p, world.tick)) reserve(res, p);
  return res;
}

export function reserve(res: Reservations, p: PlayerState): void {
  for (const c of occupiedCells(p)) res.set(cellKey(c), p.id);
}

/** A tile: the face a ball stands on, as its cell and up (the key of `world.hot`). */
export const tileKey = (cell: Vec3, up: Dir): string => `${cellKey(cell)}|${up}`;

/**
 * A block here: in the level, not crumbled, and not a vanishing block in its off-window (phase 13b, derived from the
 * tick). Every sim/BFS ground check goes through this. Planning worlds put vanishing blocks in `removed` instead.
 */
export const isSolid = (world: World, v: Vec3): boolean => {
  const k = cellKey(v);
  if (!world.level.solid.has(k) || world.removed.has(k)) return false;
  const van = world.level.vanish.size ? world.level.vanish.get(k) : undefined;
  return !van || vanishOn(van, world.tick);
};

/** A vanishing block is there at `tick`: for `on` ticks of every `period`, offset by `phase`. */
export const vanishOn = (v: Vanish, tick: number): boolean => (((tick + v.phase) % v.period) + v.period) % v.period < v.on;

/** Not solid, and not reserved by another player. */
export function isFree(world: World, res: Reservations, selfId: string, v: Vec3): boolean {
  if (isSolid(world, v)) return false;
  const owner = res.get(cellKey(v));
  return owner === undefined || owner === selfId;
}
