import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, createWorld, KNOCK_TICKS, loadLevel, mulberry32, setInput, step, STUN_TICKS, vec, type SimEvent, type TileJson, type World,
} from '../src/index.ts';
import { input, makeWorld, player, readLevelJson, row, run, serialize, type Spawn, ROLL_TICKS } from './util.ts';

// Moving collisions (§20, phase 14d). Floor at y=0, balls at y=1.
type V3 = [number, number, number];
/** x 0..x1, z -w..w. */
const plate = (x1 = 6, w = 2): V3[] => Array.from({ length: 2 * w + 1 }, (_, i) => row(0, x1, 0, i - w)).flat();
const ice = (cells: [number, number][]): TileJson[] => cells.map(([x, z]) => ({ block: [x, 0, z], type: 'ice' }));
const world = (blocks: V3[], spawns: Spawn[], tiles: TileJson[] = []) => makeWorld(blocks, spawns, { heat: false, tiles });
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
/** W for one tick for each of `ids` (released after), returning that tick's events. */
function press(w: World, ...ids: string[]): SimEvent[] {
  for (const id of ids) setInput(w, id, input({ fwdHeld: true }));
  const events = step(w);
  for (const id of ids) setInput(w, id, input({}));
  return events;
}
const headOnEvent = (events: SimEvent[]) => of(events, 'push').filter((e) => e.moving === 'headon');
const at = (w: World, id: string) => [player(w, id).action, player(w, id).pose.cell, player(w, id).to.cell];

describe('plain floor', () => {
  test('head-on, both mid-move: both knocked back 1 cell, then bounce-stunned', () => {
    const w = world(row(0, 6), [[[1, 1, 0], '+Y', '+X'], [[3, 1, 0], '+Y', '-X']]);
    press(w, 'p0'); // p0 rolls 1 → 2
    const events = press(w, 'p1'); // p1 starts into 2, which p0 is entering head-on
    expect(headOnEvent(events)).toEqual([{ type: 'push', pusherId: 'p1', victimId: 'p0', moving: 'headon' }]);
    expect(of(events, 'bounce').map((e) => e.playerId).sort()).toEqual(['p0', 'p1']);
    expect(at(w, 'p0')).toEqual([Action.Knocked, vec(1, 1, 0), vec(0, 1, 0)]);
    expect(at(w, 'p1')).toEqual([Action.Knocked, vec(3, 1, 0), vec(4, 1, 0)]);
    expect([player(w, 'p0').lastKnockedBy, player(w, 'p1').lastKnockedBy]).toEqual(['p1', 'p0']);
    run(w, KNOCK_TICKS);
    for (const id of ['p0', 'p1']) expect([player(w, id).action, player(w, id).bounce]).toEqual([Action.Stunned, true]);
    run(w, STUN_TICKS);
    expect([player(w, 'p0').pose.cell, player(w, 'p1').pose.cell]).toEqual([vec(0, 1, 0), vec(4, 1, 0)]);
  });

  test('head-on, both starting into the same empty cell on the same tick: both bounce back', () => {
    const w = world(row(0, 4), [[[1, 1, 0], '+Y', '+X'], [[3, 1, 0], '+Y', '-X']]);
    const events = press(w, 'p0', 'p1');
    expect(headOnEvent(events)).toHaveLength(1);
    expect(at(w, 'p0')).toEqual([Action.Knocked, vec(1, 1, 0), vec(0, 1, 0)]);
    expect(at(w, 'p1')).toEqual([Action.Knocked, vec(3, 1, 0), vec(4, 1, 0)]);
  });

  test('adjacent and both already rolling (a mutual push): head-on; from rest it stays the §14 bounce in place', () => {
    const moving = world(row(0, 6), [[[1, 1, 0], '+Y', '+X'], [[4, 1, 0], '+Y', '-X']]);
    for (const id of ['p0', 'p1']) setInput(moving, id, input({ fwdHeld: true }));
    const events = run(moving, ROLL_TICKS + 1); // both arrive (2 and 3) on the same tick, then push each other
    expect(headOnEvent(events)).toHaveLength(1);
    expect([player(moving, 'p0').to.cell, player(moving, 'p1').to.cell]).toEqual([vec(1, 1, 0), vec(4, 1, 0)]);
    const rest = world(row(0, 4), [[[1, 1, 0], '+Y', '+X'], [[2, 1, 0], '+Y', '-X']]);
    expect(press(rest, 'p0', 'p1').map((e) => e.type)).toEqual(['bounce', 'bounce']);
    expect([player(rest, 'p0').action, player(rest, 'p1').action]).toEqual([Action.Stunned, Action.Stunned]);
  });

  // p1 rolls +Z from (2,1,-1) into X = (2,1,0); a tick later p0 rolls +X from (1,1,0) into X.
  const tbone = (blocks = plate()) => world(blocks, [[[1, 1, 0], '+Y', '+X'], [[2, 1, -1], '+Y', '+Z']]);

  test('side hit on a roller already moving into X: it is knocked on along dM, the hitter enters X', () => {
    const w = tbone();
    press(w, 'p1');
    const events = press(w, 'p0');
    expect(events).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p1', moving: 'side' }]);
    expect(at(w, 'p1')).toEqual([Action.Knocked, vec(2, 1, 0), vec(3, 1, 0)]);
    expect(at(w, 'p0')).toEqual([Action.Roll, vec(1, 1, 0), vec(2, 1, 0)]);
    expect(player(w, 'p1').lastKnockedBy).toBe('p0');
    run(w, KNOCK_TICKS);
    expect([player(w, 'p1').action, player(w, 'p1').bounce, player(w, 'p1').pose.cell]).toEqual([Action.Stunned, false, vec(3, 1, 0)]);
  });

  test('side hit with X + dM blocked: the hitter bounces, the roller carries on', () => {
    const w = tbone([...plate(), [3, 1, 0]]);
    press(w, 'p1');
    expect(press(w, 'p0')).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    expect([player(w, 'p0').action, player(w, 'p0').bounce]).toEqual([Action.Stunned, true]);
    expect(at(w, 'p1')).toEqual([Action.Roll, vec(2, 1, -1), vec(2, 1, 0)]);
  });

  test('simultaneous T-bone: both bounce back opposite their own motion', () => {
    const w = tbone();
    const events = press(w, 'p0', 'p1');
    expect(headOnEvent(events)).toHaveLength(1);
    expect(at(w, 'p0')).toEqual([Action.Knocked, vec(1, 1, 0), vec(0, 1, 0)]);
    expect(at(w, 'p1')).toEqual([Action.Knocked, vec(2, 1, -1), vec(2, 1, -2)]);
  });

  test('dodge: V leaving X sideways as M starts → no collision, M waits and then rolls', () => {
    const w = world(plate(), [[[1, 1, 0], '+Y', '+X'], [[2, 1, 0], '+Y', '+Z']]);
    setInput(w, 'p0', input({ fwdHeld: true }));
    const events = press(w, 'p1');
    expect(events).toEqual([]);
    expect(player(w, 'p0').action).toBe(Action.Idle);
    expect(of(run(w, ROLL_TICKS), 'push')).toEqual([]);
    expect(at(w, 'p0')).toEqual([Action.Roll, vec(1, 1, 0), vec(2, 1, 0)]);
  });

  test('rear-end: following a roller the same way → no collision', () => {
    const w = world(row(0, 6), [[[1, 1, 0], '+Y', '+X'], [[2, 1, 0], '+Y', '+X']]);
    press(w, 'p1');
    setInput(w, 'p0', input({ fwdHeld: true }));
    const events = run(w, ROLL_TICKS);
    expect(events.filter((e) => e.type === 'push' || e.type === 'bounce')).toEqual([]);
    expect(at(w, 'p0')).toEqual([Action.Roll, vec(1, 1, 0), vec(2, 1, 0)]);
  });

  test('push rules off: no moving collisions (the MVP blocking)', () => {
    const w = createWorld(loadLevel({
      id: 't', name: 't', version: 1, blocks: plate(), keys: [], exit: { cell: [99, 99, 99], up: '+Y' }, keysRequired: 0, timeLimitSec: 600,
      spawns: [{ cell: [1, 1, 0], up: '+Y', fwd: '+X' }, { cell: [2, 1, -1], up: '+Y', fwd: '+Z' }],
    }), 1, { push: false });
    w.spawnOrder = [0, 1];
    addPlayer(w, 'p0', 'p0');
    addPlayer(w, 'p1', 'p1');
    press(w, 'p1');
    expect(press(w, 'p0')).toEqual([]);
    expect(player(w, 'p0').action).toBe(Action.Idle);
  });
});

describe('ice', () => {
  // An ice lane x 1..n-1 between plain rims at x=0 and x=n.
  test.each([[10], [9]])('two sliders head-on (rims 0 and %i): both slide back to the rims', (n) => {
    const w = world(row(0, n), [[[0, 1, 0], '+Y', '+X'], [[n, 1, 0], '+Y', '-X']], ice(Array.from({ length: n - 1 }, (_, i) => [i + 1, 0])));
    const events = [...press(w, 'p0', 'p1'), ...run(w, 120)];
    expect(headOnEvent(events)).toHaveLength(1);
    expect([player(w, 'p0').pose.cell, player(w, 'p1').pose.cell]).toEqual([vec(0, 1, 0), vec(n, 1, 0)]);
    expect([player(w, 'p0').action, player(w, 'p1').action]).toEqual([Action.Idle, Action.Idle]);
  });

  test('a slider hits a crossing slider from the side: it is knocked and slides on along dM', () => {
    // M slides +X along the z=0 ice row; V slides +Z down x=3 from (3,1,-2) and is entering (3,1,0) when M gets there.
    const w = world(plate(8), [[[0, 1, 0], '+Y', '+X'], [[3, 1, -2], '+Y', '+Z']], ice([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [3, -1]]));
    press(w, 'p0'); // tick 1: M onto (1,0,0); it decides for (3,1,0) at tick 11
    run(w, 1);
    press(w, 'p1'); // tick 3: V onto (3,0,-1); it slides on into (3,1,0) at tick 8
    const events = run(w, 8);
    expect(of(events, 'push')).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p1', moving: 'side' }]);
    const v = player(w, 'p1');
    expect([v.action, v.pose.cell, v.to.cell]).toEqual([Action.Knocked, vec(3, 1, 0), vec(4, 1, 0)]);
    run(w, 60);
    expect(v.pose.cell).toEqual(vec(7, 1, 0)); // slid along +X to the plain rim, then staggered
  });

  test('a slider hits a standing ball: the old push, and the victim knock-slides', () => {
    const w = world(row(0, 8), [[[0, 1, 0], '+Y', '+X'], [[4, 1, 0], '+Y', '+Z']], ice([1, 2, 3, 4, 5, 6].map((x) => [x, 0])));
    press(w, 'p0');
    const events = run(w, 80);
    expect(of(events, 'push')).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p1' }]);
    expect(player(w, 'p1').pose.cell).toEqual(vec(7, 1, 0));
  });
});

describe('knocked balls, stagger and edges', () => {
  test('a knocked ball head-on into a roller: both bounce (the knocked one where its knock lands)', () => {
    // p0 pushes p1 (1 → 2) and rolls into 1; next tick p2 starts from 3 into 2, head-on to the knocked p1.
    const w = world(row(0, 6), [[[0, 1, 0], '+Y', '+X'], [[1, 1, 0], '+Y', '+Z'], [[3, 1, 0], '+Y', '-X']]);
    press(w, 'p0');
    const events = press(w, 'p2');
    expect(headOnEvent(events)).toEqual([{ type: 'push', pusherId: 'p2', victimId: 'p1', moving: 'headon' }]);
    expect(at(w, 'p1')).toEqual([Action.Knocked, vec(1, 1, 0), vec(2, 1, 0)]); // its from-cell is p0's now: the knock goes on
    expect(at(w, 'p2')).toEqual([Action.Knocked, vec(3, 1, 0), vec(4, 1, 0)]);
    run(w, KNOCK_TICKS);
    expect([player(w, 'p1').action, player(w, 'p1').bounce, player(w, 'p1').pose.cell]).toEqual([Action.Stunned, true, vec(2, 1, 0)]);
  });

  test('a ball knocked by a side hit cannot be hit again until it recovers', () => {
    // As the side hit above; p2 at (3,1,-1) faces +Z, into (3,1,0) where p1 is knocked to.
    const w = world(plate(), [[[1, 1, 0], '+Y', '+X'], [[2, 1, -1], '+Y', '+Z'], [[3, 1, -1], '+Y', '+Z']]);
    press(w, 'p1');
    press(w, 'p0');
    setInput(w, 'p2', input({ fwdHeld: true }));
    const events = run(w, KNOCK_TICKS + STUN_TICKS - 1); // Knocked, then the stagger, to its last tick
    expect(events.filter((e) => e.type === 'push' || e.type === 'bounce')).toEqual([]);
    expect(player(w, 'p2').action).toBe(Action.Idle);
    expect(of(step(w), 'push')).toEqual([{ type: 'push', pusherId: 'p2', victimId: 'p1' }]); // recovered: pushed the tick it's Idle
  });

  test('a side hit that knocks a ball off an edge: it falls, and the hitter gets the knockout', () => {
    const w = world(plate(2, 1), [[[1, 1, 0], '+Y', '+X'], [[2, 1, -1], '+Y', '+Z']]);
    press(w, 'p1');
    press(w, 'p0');
    const events = run(w, 60);
    expect(of(events, 'death').map((e) => e.playerId)).toEqual(['p1']);
    expect(of(events, 'knockout')).toEqual([{ type: 'knockout', pusherId: 'p0', victimId: 'p1' }]);
  });

  test('head-on at a boost pad arrival: both bounce, nobody launches; a knock-back onto a pad launches', () => {
    const pad = (x: number, dir: TileJson['dir']): TileJson => ({ block: [x, 0, 0], face: '+Y', type: 'boost', dir });
    // p0 rolls 3 → 4 (a pad), p1 starts from 5 into 4 a tick later.
    const onPad = world(row(0, 12), [[[3, 1, 0], '+Y', '+X'], [[5, 1, 0], '+Y', '-X']], [pad(4, '+X')]);
    press(onPad, 'p0');
    const events = [...press(onPad, 'p1'), ...run(onPad, 30)];
    expect(headOnEvent(events)).toHaveLength(1);
    expect(of(events, 'boost')).toEqual([]);
    // The same, with p0's knock-back cell (2) a pad pointing -X: p0 is thrown 3 cells back.
    const back = world(row(-4, 12), [[[3, 1, 0], '+Y', '+X'], [[5, 1, 0], '+Y', '-X']], [pad(2, '-X')]);
    press(back, 'p0');
    const later = [...press(back, 'p1'), ...run(back, 30)];
    expect(of(later, 'boost')).toEqual([{ type: 'boost', playerId: 'p0', result: 'launch' }]);
    expect(player(back, 'p0').pose.cell).toEqual(vec(-1, 1, 0));
  });
});

test('determinism with moving collisions (4 players on arena-03, random inputs, 2000 ticks)', () => {
  const runOnce = () => {
    const w = createWorld(loadLevel(readLevelJson('arena-03.json')), 5);
    for (let i = 0; i < 4; i++) addPlayer(w, `p${i}`, `p${i}`).lives = 99; // random walkers fall off the ice a lot
    const rnd = mulberry32(23);
    const hits = { headon: 0, side: 0 };
    for (let t = 0; t < 2000; t++) {
      for (const p of w.players) if (rnd() < 0.2) setInput(w, p.id, input({ fwdHeld: rnd() < 0.7, jump: rnd() < 0.05, turn: rnd() < 0.25 ? (rnd() < 0.5 ? -1 : 1) : 0 }));
      for (const e of step(w)) if (e.type === 'push' && e.moving) hits[e.moving]++;
    }
    return { state: serialize(w), hits };
  };
  const a = runOnce();
  expect(a).toEqual(runOnce());
  expect(a.hits.headon + a.hits.side).toBeGreaterThan(0);
});
