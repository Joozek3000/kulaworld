import { readdirSync, readFileSync } from 'node:fs';
import {
  addPlayer, createWorld, loadLevel, step,
  type DirName, type Input, type LevelJson, type PlayerState, type SimEvent, type World,
} from '../src/index.ts';

type V3 = [number, number, number];
export type Spawn = [V3, DirName, DirName];

export const levelsDir = new URL('../../../levels/', import.meta.url);
export const levelFiles = () => readdirSync(levelsDir).filter((f) => f.endsWith('.json'));
export const readLevelJson = (file: string): LevelJson => JSON.parse(readFileSync(new URL(file, levelsDir), 'utf8'));

/** Blocks along x from x0 to x1 (inclusive) at y, z. */
export const row = (x0: number, x1: number, y = 0, z = 0): V3[] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y, z] as V3);

export function levelJson(blocks: V3[], spawns: Spawn[], extra: Partial<LevelJson> = {}): LevelJson {
  return {
    id: 'test', name: 'test', version: 1, blocks,
    spawns: spawns.map(([cell, up, fwd]) => ({ cell, up, fwd })),
    keys: [], exit: { cell: [99, 99, 99], up: '+Y' }, keysRequired: 0, timeLimitSec: 600,
    ...extra,
  };
}

/** Hand spawns out in level order (worlds shuffle them per seed), so tests know who starts where. */
export function inOrder(w: World): World {
  w.spawnOrder = w.level.spawns.map((_, i) => i);
  return w;
}

/** A tiny world with one player per spawn, ids p0, p1, ... in spawn order. */
export function makeWorld(blocks: V3[], spawns: Spawn[], extra: Partial<LevelJson> = {}): World {
  const w = inOrder(createWorld(loadLevel(levelJson(blocks, spawns, extra)), 1));
  spawns.forEach((_, i) => addPlayer(w, `p${i}`, `p${i}`));
  return w;
}

export const player = (w: World, id = 'p0'): PlayerState => w.players.find((p) => p.id === id)!;

export function run(w: World, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(w));
  return events;
}

export const input = (i: Partial<Input>): Input => ({ seq: 0, fwdHeld: false, turn: 0, jump: false, jumpHeld: false, ...i });

/** JSON of everything but the static level, for determinism comparisons. */
export const serialize = (w: World): string => JSON.stringify({ ...w, level: w.level.id });
