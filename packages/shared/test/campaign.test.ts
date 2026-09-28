import { describe, expect, test } from 'vitest';
import {
  Action, add, addPlayer, campaignLevels, cellKey, createWorld, dirVec, faceTileAt, findPathLasers, FRUITS, loadLevel, setInput, step, TICK_RATE,
  validateLevel, type Level, type PathStep, type Pose, type SimEvent, type World,
} from '../src/index.ts';
import { input, levelFiles, readLevelJson } from './util.ts';

// The single-player campaign (phase 15b, §22): every level validates, every key and the exit are reachable from the
// spawn, and a BFS route (nearest key first, then the exit) replayed in the sim finishes the level in time.

const LEVELS = levelFiles().map((f) => loadLevel(readLevelJson(f)));
const { main, bonus } = campaignLevels(LEVELS);

/** A planning world: vanishing blocks are gaps (never stand on them), like the bots' planWorld. */
function planWorld(level: Level): World {
  const w = createWorld(level, 1);
  for (const k of level.vanish.keys()) w.removed.add(k);
  return w;
}

/**
 * Nearest remaining goal first: each key (all are required), then the exit; on a bonus level every paint tile. A leg's
 * switch presses carry over to the next leg (findPathLasers restores the world's laser states after each search).
 */
function solve(level: Level): { steps: PathStep[]; legs: number[] } | null {
  const w = planWorld(level);
  let at: Pose = level.spawns[0];
  const left = new Set(level.bonus
    ? level.tiles.filter((t) => t.type === 'paint').map((t) => cellKey(add(t.block, dirVec(t.face!))))
    : level.keys.map((k) => cellKey(k.cell)));
  const steps: PathStep[] = [], legs: number[] = [];
  const leg = (goals: Set<string>): boolean => {
    const path = findPathLasers(w, at, goals);
    if (!path) return false;
    for (const st of path) {
      left.delete(cellKey(st.to.cell));
      const sw = st.cmd === 'left' || st.cmd === 'right' ? undefined : faceTileAt(w, st.to);
      if (sw?.type === 'switch') w.lasers.set(sw.group, !w.lasers.get(sw.group));
    }
    steps.push(...path);
    legs.push(path.length);
    if (path.length) at = path[path.length - 1].to;
    return true;
  };
  while (left.size) if (!leg(new Set(left))) return null;
  if (level.exit && !leg(new Set([cellKey(level.exit.cell)]))) return null;
  return { steps, legs };
}

/** Plays `steps` in the sim: each move pressed once the ball has settled. Returns the world when it ends (or stalls). */
function replay(level: Level, steps: PathStep[]): { world: World; ticks: number; stuck: string | null; events?: SimEvent[] } {
  const w = createWorld(level, 1);
  addPlayer(w, 'you', 'you');
  const p = w.players[0];
  const events: SimEvent[] = [];
  const settle = () => { for (let i = 0; i < 400 && (p.action !== Action.Idle || p.forced) && !w.result; i++) events.push(...step(w)); };
  for (const st of steps) {
    settle();
    if (w.result) break;
    const i = st.cmd === 'fwd' ? { fwdHeld: true } : st.cmd === 'jump' ? { fwdHeld: true, jump: true } : { turn: st.cmd === 'left' ? -1 as const : 1 as const };
    setInput(w, 'you', input(i));
    events.push(...step(w));
    setInput(w, 'you', input({}));
    settle();
    const at = p.pose;
    if (!w.result && (cellKey(at.cell) !== cellKey(st.to.cell) || at.up !== st.to.up)) {
      return { world: w, ticks: w.tick, stuck: `${st.cmd} → expected ${cellKey(st.to.cell)}|${st.to.up}, at ${cellKey(at.cell)}|${at.up} (tick ${w.tick})` };
    }
  }
  for (let i = 0; i < 100 && !w.result; i++) events.push(...step(w));
  return { world: w, ticks: w.tick, stuck: null, events };
}

describe('campaign', () => {
  test('10 levels and a bonus level, numbered in order, none in the pool', () => {
    expect(main.map((l) => l.campaign)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(bonus.length).toBe(1);
    for (const l of [...main, ...bonus]) expect([l.id, l.pool, l.mode]).toEqual([l.id, false, 'single']);
  });

  test('the 5 fruit kinds are spread over the first levels, so the bonus level can be unlocked', () => {
    const kinds = new Set(main.flatMap((l) => l.items.filter((i) => i.type === 'fruit').map((i) => i.fruit)));
    expect(kinds.size).toBe(FRUITS.length);
  });

  test.each([...main, ...bonus].map((l) => [l.id, l] as const))('%s: validates, reachable, solved in time', (_, level) => {
    expect(validateLevel(level)).toEqual([]);
    const w = planWorld(level);
    const goals = level.bonus ? [] : [...level.keys, level.exit!];
    for (const g of goals) expect([cellKey(g.cell), findPathLasers(w, level.spawns[0], new Set([cellKey(g.cell)])) !== null]).toEqual([cellKey(g.cell), true]);
    const plan = solve(level);
    expect(plan).not.toBeNull();
    const run = replay(level, plan!.steps);
    expect(run.stuck).toBeNull();
    expect(run.world.result?.reason).toBe(level.bonus ? 'painted' : 'exit');
    expect(run.ticks).toBeLessThan(level.timeLimitSec * TICK_RATE);
    // Route vs par (for the report): moves, seconds, par.
    console.log(`${level.id}: ${plan!.steps.length} moves (legs ${plan!.legs.join('+')}), ${(run.ticks / TICK_RATE).toFixed(1)} s, par ${level.parSec} s, limit ${level.timeLimitSec} s`);
  });
});
