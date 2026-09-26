import { HOP_PUSH_WINDOW, KILL_MARGIN, TICK_RATE } from '../constants.ts';
import { ALL_DIRS, dirVec, perpendicular, type Dir } from '../dir.ts';
import { mulberry32, rngNext } from '../rng.ts';
import type { Level, Mode, Pose } from '../level/types.ts';
import { add, cellKey, sub, type Vec3 } from '../vec.ts';
import { crumbleBands } from './crumble.ts';

/** Extend by appending; values go over the network. */
export const Action = { Idle: 0, Roll: 1, Turn: 2, Flip: 3, Jump: 4, Fall: 5, Dead: 6, Hop: 7, Knocked: 8, Stunned: 9, Rebound: 10, Climb: 11 } as const;
export type Action = (typeof Action)[keyof typeof Action];

/** 'jump' = jump forward, 'hop' = bounce in place. A jump pulse picks one by fwdHeld (see commands() in tick.ts). */
export type Cmd = 'fwd' | 'left' | 'right' | 'jump' | 'hop';
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
  /** Stunned by a failed push (render: lunge and recoil). */
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
}

export interface KeyItem { id: number; cell: Vec3; collected: boolean }
/** 'lastAlive': one knockout player left; 'allOut': the last ones were eliminated together (a draw). */
export interface RaceResult { winnerId: string | null; reason: 'exit' | 'timeout' | 'lastAlive' | 'allOut' }

export interface Rules { push: boolean }

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
  knockout: KnockoutState | null;
  tick: number;
  timeLimitTick: number;
  /** Join order; step() iterates it rotated by tick for fairness. */
  players: PlayerState[];
  keys: KeyItem[];
  result: RaceResult | null;
  /** Spawn indices in the order players get them, shuffled per seed so join order doesn't fix the spawn. */
  spawnOrder: number[];
}

export type SimEvent =
  | { type: 'key'; playerId: string; keyId: number; keys: number }
  | { type: 'win'; winnerId: string | null; reason: RaceResult['reason'] }
  | { type: 'death'; playerId: string; cell: Vec3 }
  | { type: 'respawn'; playerId: string; cell: Vec3 }
  | { type: 'push'; pusherId: string; victimId: string }
  | { type: 'bounce'; playerId: string }
  | { type: 'keyDrop'; playerId: string; keyId: number }
  | { type: 'knockout'; pusherId: string; victimId: string }
  | { type: 'lifeLost'; playerId: string; livesLeft: number }
  | { type: 'eliminated'; playerId: string; byId?: string }
  | { type: 'crumbleWarn'; band: number }
  | { type: 'crumble'; band: number }
  | { type: 'stomp'; attackerId: string; victimId: string }
  | { type: 'clash'; attackerId: string; victimId: string };

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
    knockout: knockout ? { bands: crumbleBands(level), next: 0, warn: -1, stopped: false } : null,
    tick: 0,
    timeLimitTick: level.timeLimitSec * TICK_RATE,
    players: [],
    keys: level.keys.map((k, id) => ({ id, cell: k.cell, collected: false })),
    result: null,
    spawnOrder: shuffledIndices(level.spawns.length, seed),
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
  let open = world.spawnOrder.map((i) => world.level.spawns[i])
    .filter((s) => isFree(world, res, p.id, s.cell) && isSolid(world, sub(s.cell, dirVec(s.up))));
  if (!open.length && random) open = standingCells(world).filter((s) => isFree(world, res, p.id, s.cell));
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
    jumpOver: false, stompBump: null, graceUntil: -1,
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
    case Action.Idle: case Action.Turn: case Action.Hop: case Action.Stunned: return [cell];
    case Action.Flip: return [cell, add(cell, dirVec(fwd)), p.to.cell];
    case Action.Jump: {
      // Over a player on A1: A1 stays theirs. A stomp jump also holds the bump cell B.
      const cells = p.jumpOver ? [cell, p.to.cell] : [cell, add(cell, dirVec(fwd)), p.to.cell];
      return p.stompBump ? [...cells, p.stompBump] : cells;
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
  if (tick < v.protectedUntil) return false; // knockout spawn protection
  switch (v.action) {
    case Action.Idle: case Action.Turn: return true;
    case Action.Stunned: return v.bounce; // a knocked victim staggers; a bounced pusher is fair game
    case Action.Hop: {
      const since = tick - v.startTick;
      return (since >= 1 && since <= HOP_PUSH_WINDOW) || v.endTick - tick <= HOP_PUSH_WINDOW;
    }
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

export function reservations(world: World): Reservations {
  const res: Reservations = new Map();
  for (const p of world.players) reserve(res, p);
  return res;
}

export function reserve(res: Reservations, p: PlayerState): void {
  for (const c of occupiedCells(p)) res.set(cellKey(c), p.id);
}

/** Not solid, and not reserved by another player. */
/** A block here: in the level and not crumbled. Every sim/BFS ground check goes through this. */
export const isSolid = (world: World, v: Vec3): boolean => {
  const k = cellKey(v);
  return world.level.solid.has(k) && !world.removed.has(k);
};

export function isFree(world: World, res: Reservations, selfId: string, v: Vec3): boolean {
  if (isSolid(world, v)) return false;
  const owner = res.get(cellKey(v));
  return owner === undefined || owner === selfId;
}
