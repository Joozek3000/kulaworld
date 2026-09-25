import { TICK_RATE } from '../constants.ts';
import { dirVec } from '../dir.ts';
import { isSolid } from '../level/load.ts';
import type { Level, Pose } from '../level/types.ts';
import { add, cellKey, type Vec3 } from '../vec.ts';

/** Extend by appending (e.g. Knocked, Stunned for PvP); values go over the network. */
export const Action = { Idle: 0, Roll: 1, Turn: 2, Flip: 3, Jump: 4, Fall: 5, Dead: 6, Hop: 7 } as const;
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
  fwdHeld: boolean;
  jumpHeld: boolean;
  /** Forward pressed during a Hop: the next decision is a forward jump even if W is released by then. */
  fwdLatch: boolean;
  pulse: Pulse | null;
  pulseTick: number;
}

export interface KeyItem { id: number; cell: Vec3; collected: boolean }
export interface RaceResult { winnerId: string | null; reason: 'exit' | 'timeout' }

export interface World {
  level: Level;
  seed: number;
  tick: number;
  timeLimitTick: number;
  /** Join order; step() iterates it rotated by tick for fairness. */
  players: PlayerState[];
  keys: KeyItem[];
  result: RaceResult | null;
}

export type SimEvent =
  | { type: 'key'; playerId: string; keyId: number; keys: number }
  | { type: 'win'; winnerId: string | null; reason: RaceResult['reason'] }
  | { type: 'death'; playerId: string; cell: Vec3 }
  | { type: 'respawn'; playerId: string; cell: Vec3 };

export function createWorld(level: Level, seed: number): World {
  return {
    level,
    seed,
    tick: 0,
    timeLimitTick: level.timeLimitSec * TICK_RATE,
    players: [],
    keys: level.keys.map((k, id) => ({ id, cell: k.cell, collected: false })),
    result: null,
  };
}

const clonePose = (p: Pose): Pose => ({ cell: { ...p.cell }, up: p.up, fwd: p.fwd });

/** Places the player on the first free spawn. Returns false (player untouched) if all are taken. */
export function trySpawn(world: World, p: PlayerState): boolean {
  const res = reservations(world);
  const spawn = world.level.spawns.find((s) => isFree(world, res, p.id, s.cell));
  if (!spawn) return false;
  p.pose = clonePose(spawn);
  p.to = clonePose(spawn);
  p.action = Action.Idle;
  p.startTick = p.endTick = world.tick;
  return true;
}

/** Adds a player at the first free spawn. With no free spawn it waits as Dead and retries every tick. */
export function addPlayer(world: World, id: string, name: string): PlayerState {
  const spawn = clonePose(world.level.spawns[0]);
  const p: PlayerState = {
    id, name, pose: spawn, to: clonePose(spawn), action: Action.Dead,
    startTick: world.tick, endTick: world.tick + 1, keys: 0,
    fwdHeld: false, jumpHeld: false, fwdLatch: false, pulse: null, pulseTick: 0,
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
  if (pulse) { p.pulse = pulse; p.pulseTick = world.tick; }
}

/** Cells a player occupies: its cell plus the target (and pass-through) cells of its running action. */
export function occupiedCells(p: PlayerState): Vec3[] {
  const { cell, fwd } = p.pose;
  switch (p.action) {
    case Action.Dead: return [];
    case Action.Idle: case Action.Turn: case Action.Hop: return [cell];
    case Action.Flip: case Action.Jump: return [cell, add(cell, dirVec(fwd)), p.to.cell];
    default: return [cell, p.to.cell];
  }
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
export function isFree(world: World, res: Reservations, selfId: string, v: Vec3): boolean {
  if (isSolid(world.level, v)) return false;
  const owner = res.get(cellKey(v));
  return owner === undefined || owner === selfId;
}
