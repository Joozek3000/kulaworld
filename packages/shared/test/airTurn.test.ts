import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, createWorld, Dir, loadLevel, opposite, setInput, step, turnFwd, vec, type Input, type World,
} from '../src/index.ts';
import { input, makeWorld, player, readLevelJson, row, run, type Spawn, JUMP_TICKS, ROLL_TICKS, TURN_TICKS } from './util.ts';

const onRow = (): Spawn => [[0, 1, 0], '+Y', '+X'];
const send = (w: World, i: Partial<Input>) => setInput(w, 'p0', input(i));
/** A 5×7 plate at y=0 (x 0..4, z -3..3). */
const plate = () => Array.from({ length: 35 }, (_, i) => [i % 5, 0, Math.floor(i / 5) - 3] as [number, number, number]);

describe('mid-air turns', () => {
  test('turn pulse while hopping turns on the same tick; hop keeps its end tick; no Turn action', () => {
    const w = makeWorld(row(0, 5), [onRow()]);
    const p = player(w);
    send(w, { jump: true, jumpHeld: true });
    run(w, 3);
    const end = p.endTick;
    send(w, { turn: -1, jumpHeld: true });
    step(w);
    expect(p.action).toBe(Action.Hop);
    expect(p.to.fwd).toBe(turnFwd(Dir.PY, Dir.PX, -1));
    expect(p.to.cell).toEqual(vec(0, 1, 0));
    expect(p.endTick).toBe(end);
    expect([p.turnFromFwd, p.turnStartTick]).toEqual([Dir.PX, w.tick]);
    expect(p.pulse).toBe(null);
  });

  test('two presses in one hop turn 180°, and the record follows the second press', () => {
    const w = makeWorld(row(0, 5), [onRow()]);
    const p = player(w);
    send(w, { jump: true });
    step(w);
    send(w, { turn: -1 });
    step(w);
    const mid = p.to.fwd;
    send(w, { turn: -1 });
    step(w);
    expect(p.to.fwd).toBe(opposite(Dir.PX));
    expect([p.turnFromFwd, p.turnStartTick]).toEqual([mid, w.tick]);
    run(w, JUMP_TICKS);
    expect(p.pose.fwd).toBe(Dir.NX);
  });

  test('forward jump + air turn lands on the planned cell facing the new way; held jump+fwd then jumps that way', () => {
    const w = makeWorld(plate(), [onRow()]);
    const p = player(w);
    send(w, { jump: true, jumpHeld: true, fwdHeld: true });
    run(w, 2);
    send(w, { turn: 1, jumpHeld: true, fwdHeld: true });
    run(w, 1 + JUMP_TICKS - w.tick);
    expect(p.pose).toEqual({ cell: vec(2, 1, 0), up: Dir.PY, fwd: Dir.PZ }); // right of +X with up +Y is +Z
    expect(p.action).toBe(Action.Jump);
    expect(p.startTick).toBe(1 + JUMP_TICKS);
    expect(p.to.cell).toEqual(vec(2, 1, 2));
  });

  test('turn during a fall applies immediately and is kept on landing', () => {
    const w = makeWorld([[0, 0, 0], [2, -5, 0]], [onRow()]);
    const p = player(w);
    send(w, { jump: true, fwdHeld: true });
    step(w);
    send(w, {});
    run(w, JUMP_TICKS + 1);
    expect(p.action).toBe(Action.Fall);
    send(w, { turn: 1 });
    step(w);
    expect(p.action).toBe(Action.Fall);
    expect(p.to.fwd).toBe(Dir.PZ);
    for (let i = 0; i < 40 && p.action !== Action.Idle; i++) step(w);
    expect(p.pose).toEqual({ cell: vec(2, -4, 0), up: Dir.PY, fwd: Dir.PZ });
  });

  test.each([
    ['roll', row(0, 5), Action.Roll],
    ['flip', [[0, 0, 0]] as [number, number, number][], Action.Flip],
  ] as const)('turn during a %s still buffers until it ends', (_, blocks, moving) => {
    const w = makeWorld([...blocks], [onRow()]);
    const p = player(w);
    send(w, { fwdHeld: true });
    step(w);
    send(w, { turn: 1 });
    step(w);
    expect(p.action).toBe(moving);
    expect(p.to.fwd).toBe(moving === Action.Roll ? Dir.PX : opposite(Dir.PY));
    run(w, p.endTick - w.tick);
    expect(p.action).toBe(Action.Turn);
  });

  test('a grounded turn is still a TURN_TICKS action', () => {
    const w = makeWorld(row(0, 5), [onRow()]);
    const p = player(w);
    send(w, { turn: 1 });
    step(w);
    expect(p.action).toBe(Action.Turn);
    expect(p.endTick - p.startTick).toBe(TURN_TICKS);
  });
});

describe('spawn shuffle', () => {
  const level = loadLevel(readLevelJson('race-01.json'));

  test('deterministic per seed, and varies across seeds', () => {
    expect(createWorld(level, 7).spawnOrder).toEqual(createWorld(level, 7).spawnOrder);
    const orders = new Set(Array.from({ length: 20 }, (_, s) => createWorld(level, s + 1).spawnOrder.join()));
    expect(orders.size).toBeGreaterThan(5);
    for (const o of orders) expect(o.split(',').map(Number).sort((a, b) => a - b)).toEqual(level.spawns.map((_, i) => i));
  });

  test('the first player to join gets the first spawn of the shuffled order', () => {
    const counts = level.spawns.map(() => 0);
    for (let seed = 1; seed <= 80; seed++) {
      const w = createWorld(level, seed);
      const p = addPlayer(w, 'a', 'a');
      const i = level.spawns.findIndex((s) => s.cell.x === p.pose.cell.x && s.cell.z === p.pose.cell.z);
      expect(i).toBe(w.spawnOrder[0]);
      counts[i]++;
    }
    expect(counts.every((c) => c > 0)).toBe(true); // every spawn is someone's first spawn sometimes
  });
});

test('a turn on the landing tick of a chained hop keeps its spin record into the next hop', () => {
  const w = makeWorld(row(0, 5), [onRow()]);
  const p = player(w);
  send(w, { jump: true, jumpHeld: true });
  run(w, JUMP_TICKS); // tick 10; the hop ends on tick 11
  send(w, { turn: 1, jumpHeld: true });
  step(w);
  expect(p.action).toBe(Action.Hop);
  expect(p.startTick).toBe(1 + JUMP_TICKS); // the next hop, chained
  expect(p.to.fwd).toBe(Dir.PZ);
  expect([p.turnFromFwd, p.turnStartTick]).toEqual([Dir.PX, w.tick]); // still spinning, not reset to +Z
  run(w, JUMP_TICKS);
  expect([p.turnFromFwd, p.turnStartTick]).toEqual([Dir.PZ, 1 + 2 * JUMP_TICKS]); // stale by the hop after
});
