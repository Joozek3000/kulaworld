import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, createWorld, crumbleBands, Dir, dirVec, isSolid, loadLevel, MIN_BAND_BLOCKS, mulberry32, nextCrumbleTick, RESPAWN_TICKS,
  setInput, SPAWN_PROTECT_TICKS, step, sub, TICK_RATE, vec,
  type LevelJson, type PlayerState, type SimEvent, type World,
} from '../src/index.ts';
import { input, levelFiles, levelJson, makeWorld, player, readLevelJson, row, run, serialize, type Spawn } from './util.ts';

const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

const knockout = (lives = 3, crumble = { startSec: 600, intervalSec: 10, warnSec: 2 }): Partial<LevelJson> =>
  ({ mode: 'knockout', lives, crumble, keys: [], exit: undefined, keysRequired: undefined });

/** A 9-block row along x at y = 0, with players standing on it. */
const rowWorld = (spawns: Spawn[], lives = 3, crumble?: Parameters<typeof knockout>[1]) =>
  makeWorld(row(0, 8), spawns, knockout(lives, crumble));
const at = (x: number, fwd: '+X' | '-X' = '+X'): Spawn => [[x, 1, 0], '+Y', fwd];

/** Jumps p forward off the end of the row (rolling would flip over the edge) and runs until it's Dead. */
function walkOff(w: World, id: string): SimEvent[] {
  const p = player(w, id);
  setInput(w, id, input({ fwdHeld: true, jump: true }));
  const events = step(w);
  setInput(w, id, input({}));
  for (let i = 0; i < 200 && p.action !== Action.Dead; i++) events.push(...step(w));
  expect(p.action).toBe(Action.Dead);
  return events;
}

describe('crumble bands', () => {
  test('arena-cube: one band per distance shell, corners first, then edges, then faces, then the core', () => {
    const bands = crumbleBands(loadLevel(readLevelJson('arena-cube.json')));
    const bandOf = (x: number, y: number, z: number) => bands.findIndex((b) => b.includes(`${x},${y},${z}`));
    expect(bands.map((b) => b.length)).toEqual([8, 24, 12, 24, 24, 6, 8, 12, 7]);
    expect(bands[0].sort()).toEqual(['0,0,0', '0,0,4', '0,4,0', '0,4,4', '4,0,0', '4,0,4', '4,4,0', '4,4,4']);
    expect(bandOf(0, 0, 2)).toBe(2); // edge middles
    expect(bandOf(0, 2, 2)).toBe(5); // face centres
    expect(bandOf(2, 2, 2)).toBe(bands.length - 1); // the 7-block core last: its 1-block centre shell was merged in
    expect(bands.flat()).toHaveLength(125);
    // Strictly decreasing distance from the centre (2,2,2) across bands.
    const d2 = (k: string) => k.split(',').map(Number).reduce((s, v) => s + (v - 2) ** 2, 0);
    for (let i = 1; i < bands.length; i++) expect(Math.max(...bands[i].map(d2))).toBeLessThan(Math.min(...bands[i - 1].map(d2)));
  });

  test('thin shells merge until every band has >= MIN_BAND_BLOCKS blocks', () => {
    for (const f of levelFiles().filter((f) => readLevelJson(f).mode === 'knockout')) {
      const level = loadLevel(readLevelJson(f));
      const bands = crumbleBands(level);
      for (const b of bands) expect(b.length, f).toBeGreaterThanOrEqual(MIN_BAND_BLOCKS);
      expect(bands.flat().sort(), f).toEqual([...level.solid].sort());
    }
    // A 1-block tail joins the band before it rather than crumbling on its own.
    const bands = crumbleBands(loadLevel(levelJson(row(0, 4), [], knockout())));
    expect(bands.map((b) => b.length)).toEqual([5]);
  });

  test('arena-02 (Sky Cross): the far pads go first, the plate core last', () => {
    const bands = crumbleBands(loadLevel(readLevelJson('arena-02.json')));
    expect(bands[0].sort()).toEqual(['-8,0,1', '-8,0,3', '12,0,1', '12,0,3']);
    expect(bands[bands.length - 1]).toContain('2,0,2');
  });

  test('arena-01: the 4 corners go first', () => {
    const bands = crumbleBands(loadLevel(readLevelJson('arena-01.json')));
    expect(bands[0].sort()).toEqual(['0,0,0', '0,0,8', '8,0,0', '8,0,8']);
  });

  test('a warning precedes each removal by exactly warnSec; removals every intervalSec from startSec', () => {
    const w = createWorld(loadLevel(readLevelJson('arena-01.json')), 1);
    for (const id of ['a', 'b', 'c', 'd']) addPlayer(w, id, id);
    const c = w.level.crumble!;
    const warns: number[] = [], crumbles: number[] = [];
    for (let t = 0; t < (c.startSec + c.intervalSec) * TICK_RATE + 1; t++) {
      for (const e of step(w)) {
        if (e.type === 'crumbleWarn') warns.push(w.tick);
        if (e.type === 'crumble') crumbles.push(w.tick);
      }
    }
    expect(crumbles).toEqual([c.startSec * TICK_RATE, (c.startSec + c.intervalSec) * TICK_RATE]);
    expect(warns).toEqual(crumbles.map((t) => t - c.warnSec * TICK_RATE));
    expect(w.knockout!.warn).toBe(-1);
    expect(w.removed.size).toBe(w.knockout!.bands[0].length + w.knockout!.bands[1].length);
  });

  test('the floor rule stops crumbling at 2 blocks per alive player', () => {
    // Row of 13, 2 players in the middle: bands {0,1,11,12} {2,3,9,10} {4,5,6,7,8}. Floor = 4 blocks → stops after 2.
    const w = makeWorld(row(0, 12), [[[5, 1, 0], '+Y', '+X'], [[7, 1, 0], '+Y', '+X']],
      knockout(3, { startSec: 2, intervalSec: 2, warnSec: 1 }));
    const events = run(w, 20 * TICK_RATE);
    expect(of(events, 'crumble').map((e) => e.band)).toEqual([0, 1]);
    expect(of(events, 'crumbleWarn').map((e) => e.band)).toEqual([0, 1]);
    expect(w.removed.size).toBe(8);
    expect(w.knockout!.stopped).toBe(true);
    expect(nextCrumbleTick(w)).toBe(-1);
  });

  test('removing the block under an Idle player makes it fall on the next tick', () => {
    const w = rowWorld([at(4)]);
    const p = player(w);
    w.removed.add('4,0,0');
    step(w);
    expect(p.action).toBe(Action.Fall);
    expect(p.to.cell).toEqual(vec(4, 0, 0));
  });

  test('a player mid-roll onto a crumbled block falls when the roll ends', () => {
    const w = rowWorld([at(4)]);
    const p = player(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w);
    setInput(w, 'p0', input({}));
    w.removed.add('5,0,0');
    while (p.action === Action.Roll) step(w);
    expect(p.action).toBe(Action.Fall);
  });
});

describe('lives', () => {
  test('a death with lives left respawns with protection; a protected player is unpushable', () => {
    const w = rowWorld([at(8), at(0)]);
    const p0 = player(w), p1 = player(w, 'p1');
    const events = walkOff(w, 'p0');
    expect(of(events, 'lifeLost')).toEqual([{ type: 'lifeLost', playerId: 'p0', livesLeft: 2 }]);
    expect(of(events, 'eliminated')).toEqual([]);
    const deathTick = w.tick;
    const more = run(w, RESPAWN_TICKS);
    expect(of(more, 'respawn')).toHaveLength(1);
    expect(p0.action).toBe(Action.Idle);
    expect(p0.protectedUntil).toBe(deathTick + RESPAWN_TICKS + SPAWN_PROTECT_TICKS);
    // Put p1 right behind p0 facing it: its push is blocked while p0 is protected, and lands once it runs out.
    const behind = vec(p0.pose.cell.x - 1, 1, 0);
    p1.pose = p1.to = { cell: behind, up: Dir.PY, fwd: Dir.PX };
    setInput(w, 'p1', input({ fwdHeld: true }));
    const blocked = run(w, SPAWN_PROTECT_TICKS - 1);
    expect(of(blocked, 'push')).toEqual([]);
    expect(p1.action).toBe(Action.Idle);
    expect(of(step(w), 'push')).toHaveLength(1);
  });

  test('with every spawn crumbled, a respawn lands on a free cell of a remaining block', () => {
    const w = rowWorld([at(8), at(0)]);
    const p0 = player(w);
    walkOff(w, 'p0');
    w.removed.add('8,0,0').add('0,0,0'); // both spawns lose their ground
    const events = run(w, RESPAWN_TICKS);
    expect(of(events, 'respawn')).toHaveLength(1);
    expect(p0.action).toBe(Action.Idle);
    expect(isSolid(w, sub(p0.pose.cell, dirVec(p0.pose.up)))).toBe(true);
  });

  test('pushing ends your own spawn protection', () => {
    const w = rowWorld([at(3), at(4)]);
    const p0 = player(w);
    p0.protectedUntil = w.tick + SPAWN_PROTECT_TICKS;
    setInput(w, 'p0', input({ fwdHeld: true }));
    expect(of(step(w), 'push')).toHaveLength(1);
    expect(p0.protectedUntil).toBe(w.tick);
  });

  test('elimination at 0 lives: stays Dead, reserves nothing, credited to the pusher', () => {
    const w = rowWorld([at(7), at(8, '-X'), at(0)], 1);
    const p1 = player(w, 'p1');
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w); // p0 pushes p1 off the end
    setInput(w, 'p0', input({}));
    p1.fwdHeld = false;
    const events: SimEvent[] = [];
    while (p1.action !== Action.Dead) events.push(...step(w));
    expect(of(events, 'eliminated')).toEqual([{ type: 'eliminated', playerId: 'p1', byId: 'p0' }]);
    expect(p1).toMatchObject({ eliminated: true, lives: 0, eliminatedBy: 'p0', eliminatedTick: w.tick });
    expect(player(w).knockouts).toBe(1);
    run(w, RESPAWN_TICKS * 2);
    expect(p1.action).toBe(Action.Dead);
  });
});

describe('knockout result', () => {
  test('last player alive wins', () => {
    const w = rowWorld([at(8), at(0)], 1);
    const events = walkOff(w, 'p0');
    expect(of(events, 'win')).toEqual([{ type: 'win', winnerId: 'p1', reason: 'lastAlive' }]);
  });

  test('the last players eliminated on the same tick draw', () => {
    const w = rowWorld([at(8), at(0, '-X')], 1);
    setInput(w, 'p1', input({ fwdHeld: true, jump: true }));
    const events = walkOff(w, 'p0');
    expect(player(w, 'p1').action).toBe(Action.Dead);
    expect(of(events, 'eliminated')).toHaveLength(2);
    expect(of(events, 'win')).toEqual([{ type: 'win', winnerId: null, reason: 'allOut' }]);
  });

  test('solo: no win while alive; eliminated → round over (draw)', () => {
    const w = rowWorld([at(8)], 1);
    run(w, 5);
    expect(w.result).toBe(null);
    walkOff(w, 'p0');
    expect(w.result).toEqual({ winnerId: null, reason: 'allOut' });
  });

  const timeout = (stats: [number, number][]) => {
    const w = rowWorld(stats.map((_, i) => at(2 * i)));
    stats.forEach(([lives, kos], i) => Object.assign(w.players[i], { lives, knockouts: kos } satisfies Partial<PlayerState>));
    w.timeLimitTick = w.tick + 1;
    return of(step(w), 'win')[0];
  };
  test('timeout: most lives wins', () => expect(timeout([[2, 0], [3, 0], [1, 5]])).toMatchObject({ winnerId: 'p1', reason: 'timeout' }));
  test('timeout: lives tied → most knockouts', () => expect(timeout([[3, 1], [3, 2], [1, 5]])).toMatchObject({ winnerId: 'p1' }));
  test('timeout: lives and knockouts tied → draw', () => expect(timeout([[3, 2], [3, 2], [1, 5]])).toMatchObject({ winnerId: null }));
});

describe('knockout rules', () => {
  test('push is always on in knockout', () => {
    const w = createWorld(loadLevel(readLevelJson('arena-01.json')), 1, { push: false });
    expect(w.rules.push).toBe(true);
  });

  test('a race world keeps lives at 0 and never crumbles', () => {
    const w = createWorld(loadLevel(readLevelJson('race-01.json')), 1);
    const p = addPlayer(w, 'a', 'a');
    expect(w.mode).toBe('race');
    expect(w.knockout).toBe(null);
    expect(p.lives).toBe(0);
    run(w, 100);
    expect(w.removed.size).toBe(0);
  });
});

describe('determinism in knockout', () => {
  function randomGame(seed: number): { state: string; crumbles: number; deaths: number } {
    const w = createWorld(loadLevel(readLevelJson('arena-01.json')), seed);
    const ids = ['a', 'b', 'c', 'd'];
    for (const id of ids) addPlayer(w, id, id);
    const rnd = mulberry32(seed);
    let crumbles = 0, deaths = 0;
    for (let t = 0; t < 2000 && !w.result; t++) {
      for (const id of ids) {
        if (rnd() < 0.3) {
          const r = rnd();
          setInput(w, id, input({ fwdHeld: rnd() < 0.7, turn: r < 0.15 ? -1 : r < 0.3 ? 1 : 0, jump: r > 0.9, jumpHeld: r > 0.95 }));
        }
      }
      for (const e of step(w)) {
        if (e.type === 'crumble') crumbles++;
        if (e.type === 'death') deaths++;
      }
    }
    return { state: serialize(w), crumbles, deaths };
  }

  test('4 players, seeded random inputs, run twice → identical world', () => {
    const a = randomGame(7);
    expect(a.deaths).toBeGreaterThan(0);
    expect(randomGame(7)).toEqual(a);
    expect(randomGame(8).state).not.toBe(a.state);
  });
});
