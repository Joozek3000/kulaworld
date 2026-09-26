import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, cellKey, createWorld, dirVec, findPath, loadLevel, resultPose, setInput, step,
  type Cmd, type Dir, type PathStep, type Pose, type World,
} from '../src/index.ts';
import { inOrder, input, levelFiles, levelJson, readLevelJson, row, rules } from './util.ts';

const worldOf = (file: string) => createWorld(loadLevel(readLevelJson(file)), 1, { ...rules });
const MOVES: Cmd[] = ['fwd', 'left', 'right', 'jump'];

/** Runs a path through the real sim the way a seek bot does: press, let the action start, release, wait. */
function execute(w: World, path: PathStep[]): Pose {
  const p = addPlayer(w, 'p0', 'p0');
  for (const s of path) {
    const press = s.cmd === 'fwd' ? { fwdHeld: true } : s.cmd === 'jump' ? { fwdHeld: true, jump: true } : { turn: s.cmd === 'left' ? -1 : 1 } as const;
    setInput(w, 'p0', input(press));
    step(w);
    setInput(w, 'p0', input({}));
    for (let i = 0; i < 100 && p.action !== Action.Idle; i++) step(w);
    expect(p.pose).toEqual(s.to);
  }
  return p.pose;
}

/** Brute-force shortest path length (iterative deepening), to check that BFS is optimal. */
function bruteForce(w: World, from: Pose, goal: string, maxDepth: number): number {
  for (let depth = 0; depth <= maxDepth; depth++) {
    const best = new Map<string, number>();
    const dfs = (pose: Pose, d: number): boolean => {
      if (cellKey(pose.cell) === goal) return true;
      if (d === depth) return false;
      const k = `${cellKey(pose.cell)}|${pose.up}|${pose.fwd}`;
      if ((best.get(k) ?? Infinity) <= d) return false;
      best.set(k, d);
      return MOVES.some((c) => { const n = resultPose(w, pose, c); return !!n && dfs(n, d + 1); });
    };
    if (dfs(from, 0)) return depth;
  }
  return -1;
}

describe('findPath on test-cube', () => {
  const w = worldOf('test-cube.json');
  const spawn = w.level.spawns[0]; // (1,5,1) +Y facing +Z
  const targets = [...w.level.keys, w.level.exit!].map((k) => k.cell);

  test('two cells straight ahead is a single jump', () => {
    expect(findPath(w, spawn, new Set(['1,5,3']))!.map((s) => s.cmd)).toEqual(['jump']);
  });

  test('already on the goal → empty path; unreachable goal → null', () => {
    expect(findPath(w, spawn, new Set([cellKey(spawn.cell)]))).toEqual([]);
    expect(findPath(w, spawn, new Set(['2,2,2']))).toBe(null); // inside the cube
  });

  test.each(targets.map((c) => cellKey(c)))('key/exit %s is reachable and the path works in the real sim', (goal) => {
    const path = findPath(w, spawn, new Set([goal]))!;
    expect(path).not.toBe(null);
    const end = execute(inOrder(worldOf('test-cube.json')), path);
    expect(cellKey(end.cell)).toBe(goal);
  });

  test.each(targets.map((c) => cellKey(c)))('path to %s is optimal (matches brute force)', (goal) => {
    const len = findPath(w, spawn, new Set([goal]))!.length;
    expect(bruteForce(w, spawn, goal, len)).toBe(len);
  });

  test('nearest of several goals wins', () => {
    const path = findPath(w, spawn, new Set(targets.map((c) => cellKey(c))))!;
    const each = targets.map((c) => findPath(w, spawn, new Set([cellKey(c)]))!.length);
    expect(path.length).toBe(Math.min(...each));
  });
});

// traps-lab (phase 13a) is a human test lab outside the rotation: its fire lane is deliberately unplannable (bots
// treat fire as lethal), so it's left out.
describe('every race level: all keys and the exit are reachable from every spawn', () => {
  test.each(levelFiles().filter((f) => readLevelJson(f).mode !== 'knockout' && f !== 'traps-lab.json'))('%s', (file) => {
    const w = worldOf(file);
    for (const s of w.level.spawns) {
      for (const t of [...w.level.keys, w.level.exit!]) {
        expect(findPath(w, s, new Set([cellKey(t.cell)])), `${file}: spawn ${cellKey(s.cell)} → ${cellKey(t.cell)}`).not.toBe(null);
      }
    }
  });
});

/** Every (cell, up) a ball can stand on: an empty cell with a block at cell - up. */
function standable(w: World): Set<string> {
  const out = new Set<string>();
  for (const key of w.level.solid) {
    const [x, y, z] = key.split(',').map(Number);
    for (let d = 0 as Dir; d < 6; d++) {
      const v = dirVec(d), cell = `${x + v.x},${y + v.y},${z + v.z}`;
      if (!w.level.solid.has(cell)) out.add(`${cell}|${d}`);
    }
  }
  return out;
}

/** (cell, up) of every pose findPath can reach from `from` (the same moves and search, run to exhaustion). */
function reachable(w: World, from: Pose): Set<string> {
  const seen = new Set([`${cellKey(from.cell)}|${from.up}|${from.fwd}`]);
  const out = new Set<string>();
  for (let frontier = [from]; frontier.length;) {
    const next: Pose[] = [];
    for (const pose of frontier) {
      out.add(`${cellKey(pose.cell)}|${pose.up}`);
      for (const cmd of MOVES) {
        const to = resultPose(w, pose, cmd);
        const k = to && `${cellKey(to.cell)}|${to.up}|${to.fwd}`;
        if (to && !seen.has(k!)) { seen.add(k!); next.push(to); }
      }
    }
    frontier = next;
  }
  return out;
}

describe('every knockout level: spawns reach each other and >= 90% of standable surfaces', () => {
  test.each(levelFiles().filter((f) => readLevelJson(f).mode === 'knockout'))('%s', (file) => {
    const w = worldOf(file);
    const all = standable(w);
    for (const s of w.level.spawns) {
      for (const t of w.level.spawns) {
        expect(findPath(w, s, new Set([cellKey(t.cell)])), `${file}: spawn ${cellKey(s.cell)} → ${cellKey(t.cell)}`).not.toBe(null);
      }
      const got = [...reachable(w, s)].filter((k) => all.has(k)).length;
      expect(got / all.size, `${file}: from ${cellKey(s.cell)}, ${got}/${all.size}`).toBeGreaterThanOrEqual(0.9);
    }
  });
});

test('findPath with other players as obstacles routes around a blocker on a beam (phase 12)', () => {
  const w = createWorld(loadLevel(levelJson(row(0, 8), [[[0, 1, 0], '+Y', '+X'], [[4, 1, 0], '+Y', '-X'], [[8, 1, 0], '+Y', '-X'], [[7, 1, 0], '+Y', '-X']])), 1);
  w.spawnOrder = [0, 1, 2, 3];
  const me = addPlayer(w, 'me', 'me');
  addPlayer(w, 'blocker', 'blocker'); // standing on x=4
  const others = new Map([['4,1,0', 'blocker']]);
  const goal = new Set(['6,1,0']);
  const plain = findPath(w, me.pose, goal)!;
  expect(plain.some((s) => cellKey(s.to.cell) === '4,1,0')).toBe(true); // straight through: players ignored
  const around = findPath(w, me.pose, goal, others)!;
  expect(around).not.toBe(null);
  expect(around.some((s) => cellKey(s.to.cell) === '4,1,0')).toBe(false); // over or under it instead
  expect(cellKey(around[around.length - 1].to.cell)).toBe('6,1,0');
});
