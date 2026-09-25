import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, createWorld, Dir, loadLevel, mulberry32, ROLL_TICKS, setInput, step, turnFwd,
  type Dir as DirT, type World,
} from '../src/index.ts';
import { inOrder, input, makeWorld, player, readLevelJson, row, run, serialize } from './util.ts';

describe('key race', () => {
  test('key is collected when an action finishes in its cell and removed for everyone', () => {
    const w = makeWorld(row(0, 4), [[[0, 1, 0], '+Y', '+X']], { keys: [{ cell: [2, 1, 0], up: '+Y' }], keysRequired: 1 });
    const p = player(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    expect(run(w, 1 + ROLL_TICKS)).toEqual([]);
    const events = run(w, ROLL_TICKS);
    expect(p.pose.cell.x).toBe(2);
    expect(events).toEqual([{ type: 'key', playerId: 'p0', keyId: 0, keys: 1 }]);
    expect(w.keys[0].collected).toBe(true);
    run(w, 2 * ROLL_TICKS);
    expect(p.keys).toBe(1);
  });

  const exitWorld = (keys: number) => {
    const w = makeWorld(row(0, 4), [[[0, 1, 0], '+Y', '+X']], { exit: { cell: [2, 1, 0], up: '+Y' }, keysRequired: 1 });
    player(w).keys = keys;
    setInput(w, 'p0', input({ fwdHeld: true }));
    return { w, events: run(w, 1 + 2 * ROLL_TICKS) };
  };

  test('exit is locked until keysRequired', () => {
    const { w, events } = exitWorld(0);
    expect(player(w).pose.cell.x).toBe(2);
    expect(events).toEqual([]);
    expect(w.result).toBe(null);
  });

  test('reaching the unlocked exit wins', () => {
    const { w, events } = exitWorld(1);
    expect(events).toEqual([{ type: 'win', winnerId: 'p0', reason: 'exit' }]);
    expect(w.result).toEqual({ winnerId: 'p0', reason: 'exit' });
  });

  const timeout = (keys: number[]) => {
    const w = makeWorld(row(0, 6), [[[0, 1, 0], '+Y', '+X'], [[2, 1, 0], '+Y', '+X'], [[4, 1, 0], '+Y', '+X']]);
    w.timeLimitTick = 5;
    keys.forEach((k, i) => { w.players[i].keys = k; });
    run(w, 4);
    expect(w.result).toBe(null);
    return run(w, 1);
  };

  test('timeout: most keys wins', () => {
    expect(timeout([1, 2, 0])).toEqual([{ type: 'win', winnerId: 'p1', reason: 'timeout' }]);
  });

  test('timeout: tie for most keys is a draw', () => {
    expect(timeout([2, 0, 2])).toEqual([{ type: 'win', winnerId: null, reason: 'timeout' }]);
  });
});

describe('test-cube', () => {
  const cube = () => inOrder(createWorld(loadLevel(readLevelJson('test-cube.json')), 1));

  /** Holds fwd until the running action ends at the spawn cell on the top face, then lets it finish. */
  function loop(w: World, faces: Set<DirT>) {
    const p = player(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    for (let i = 0; i < 1000; i++) {
      step(w);
      faces.add(p.pose.up);
      if (p.action !== Action.Idle && p.to.up === Dir.PY && p.to.cell.x === 1 && p.to.cell.z === 1) break;
    }
    setInput(w, 'p0', input({}));
    while (p.action !== Action.Idle) step(w);
  }

  function turn(w: World, t: -1 | 1) {
    setInput(w, 'p0', input({ turn: t }));
    while (step(w), player(w).action !== Action.Idle);
  }

  test('scripted tour visits all 6 faces and returns to the spawn state', () => {
    const w = cube();
    const p = addPlayer(w, 'p0', 'p0');
    const spawn = structuredClone(p.pose);
    const faces = new Set<DirT>();
    loop(w, faces); // top → +Z → bottom → -Z → top
    expect(p.pose).toEqual(spawn);
    turn(w, 1);
    expect(p.pose.fwd).toBe(turnFwd(Dir.PY, Dir.PZ, 1));
    loop(w, faces); // top → -X → bottom → +X → top
    turn(w, -1);
    expect(faces.size).toBe(6);
    expect(p.pose).toEqual(spawn);
  });
});

describe('determinism', () => {
  function randomGame(seed: number): string {
    const w = createWorld(loadLevel(readLevelJson('test-cube.json')), seed);
    const ids = ['a', 'b', 'c', 'd'];
    for (const id of ids) addPlayer(w, id, id);
    const rnd = mulberry32(seed);
    for (let t = 0; t < 2000; t++) {
      for (const id of ids) {
        if (rnd() < 0.3) {
          const r = rnd();
          setInput(w, id, input({ fwdHeld: rnd() < 0.7, turn: r < 0.15 ? -1 : r < 0.3 ? 1 : 0, jump: r > 0.9, jumpHeld: r > 0.95 }));
        }
      }
      step(w);
    }
    return serialize(w);
  }

  test('4 players, seeded random inputs for 2000 ticks, run twice → identical world', () => {
    const a = randomGame(42);
    expect(randomGame(42)).toBe(a);
    expect(randomGame(43)).not.toBe(a);
  });
});
