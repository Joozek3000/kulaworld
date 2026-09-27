import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, checkTrapRules, createWorld, EFFECT_TICKS, findPath, findPathLasers, JUMP_TICKS, KNOCK_TICKS, loadLevel, mulberry32,
  pickupSpotProblem, ROLL_TICKS, setInput, spotsNearSpawns, step, vec,
  type LevelJson, type PickupJson, type PickupType, type PlayerState, type SimEvent, type TileJson, type World,
} from '../src/index.ts';
import { input, levelJson, makeWorld, player, row, run, serialize, type Spawn } from './util.ts';

// Pickups & pills (ARCHITECTURE §21, phase 15a).
type V3 = [number, number, number];
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
const pill = (cell: V3, type: PickupType, more: Partial<PickupJson> = {}): PickupJson => ({ cell, up: '+Y', type, ...more });
const world = (blocks: V3[], spawns: Spawn[], extra: Partial<LevelJson> = {}) => makeWorld(blocks, spawns, { heat: false, ...extra });
const give = (p: PlayerState, ...types: PickupType[]) => { p.effects = types.map((type) => ({ type, untilTick: 100_000 })); };
/** `i` for one tick for each of `ids` (released after), returning that tick's events. */
function press(w: World, i: Parameters<typeof input>[0], ...ids: string[]): SimEvent[] {
  for (const id of ids) setInput(w, id, input(i));
  const events = step(w);
  for (const id of ids) setInput(w, id, input({}));
  return events;
}
const W = { fwdHeld: true };
const JUMP = { fwdHeld: true, jump: true };
const east = (x: number, y = 1, z = 0): Spawn => [[x, y, z], '+Y', '+X'];
const got = (events: SimEvent[]) => of(events, 'pickup').map((e) => [e.playerId, e.pickup]);

describe('collecting', () => {
  test('a roll onto a pill takes it: the effect runs for its duration', () => {
    const w = world(row(0, 6), [east(0)], { pickups: [pill([1, 1, 0], 'bouncy')] });
    const events = [...press(w, W, 'p0'), ...run(w, ROLL_TICKS)];
    expect(of(events, 'pickup')).toEqual([{ type: 'pickup', playerId: 'p0', pickupId: 0, pickup: 'bouncy' }]);
    expect(player(w).effects).toEqual([{ type: 'bouncy', untilTick: 1 + ROLL_TICKS + EFFECT_TICKS.bouncy }]);
    expect(w.pickups).toEqual([]);
  });

  test('every way of finishing in the cell takes it; flying over it or falling past it does not', () => {
    // Jump landing, not the cell jumped over.
    const jump = world(row(0, 6), [east(0)], { pickups: [pill([1, 1, 0], 'lethargy'), pill([2, 1, 0], 'heavy')] });
    expect(got([...press(jump, JUMP, 'p0'), ...run(jump, JUMP_TICKS)])).toEqual([['p0', 'heavy']]);
    // A flip over the end onto the side face.
    const flip = world(row(0, 6), [east(6)], { pickups: [{ cell: [7, 0, 0], up: '+X', type: 'sunglasses' }] });
    expect(got([...press(flip, W, 'p0'), ...run(flip, 10)])).toEqual([['p0', 'sunglasses']]);
    // A fall landing (off the end of a jump, down onto a lower block), not a cell fallen through.
    const fall = world([...row(0, 2), [4, -2, 0]], [east(2)], { pickups: [pill([4, 0, 0], 'heavy'), pill([4, -1, 0], 'bouncy')] });
    expect(got([...press(fall, JUMP, 'p0'), ...run(fall, 20)])).toEqual([['p0', 'bouncy']]);
    // Knocked onto it.
    const knock = world(row(0, 6), [east(0), [[1, 1, 0], '+Y', '-Z']], { pickups: [pill([2, 1, 0], 'lethargy')] });
    expect(got([...press(knock, W, 'p0'), ...run(knock, KNOCK_TICKS)])).toEqual([['p1', 'lethargy']]);
    // An ice slide.
    const ice = world(row(0, 6), [east(0)], { pickups: [pill([2, 1, 0], 'heavy')], tiles: [{ block: [1, 0, 0], type: 'ice' }] });
    expect(got([...press(ice, W, 'p0'), ...run(ice, 2 * ROLL_TICKS)])).toEqual([['p0', 'heavy']]);
    // A teleport arrival.
    const tiles: TileJson[] = [{ block: [3, 0, 0], face: '+Y', type: 'teleport', pair: 'A' }, { block: [12, 0, 5], face: '+Y', type: 'teleport', pair: 'A' }];
    const warp = world([...row(0, 6), ...row(10, 14, 0, 5)], [east(2)], { pickups: [pill([12, 1, 5], 'sunglasses')], tiles });
    expect(got([...press(warp, W, 'p0'), ...run(warp, 12)])).toEqual([['p0', 'sunglasses']]);
  });

  test('a fixed spot comes back respawnSec after it was taken, once nobody is on it', () => {
    const w = world(row(0, 12), [east(0)], { pickups: [pill([1, 1, 0], 'sunglasses', { respawnSec: 1 })] });
    setInput(w, 'p0', input(W)); // rolls on and on: takes it at tick 6 (the roll started at tick 1)
    run(w, 6);
    expect(w.pickups).toEqual([]);
    run(w, 19);
    expect(w.pickups).toEqual([]);
    run(w, 1); // tick 26
    expect(w.pickups).toEqual([{ id: 1, spot: 0, cell: vec(1, 1, 0), up: 2, type: 'sunglasses' }]);
    // Standing on it when it's due: it waits.
    const camp = world(row(0, 6), [east(0)], { pickups: [pill([1, 1, 0], 'sunglasses', { respawnSec: 1 })] });
    press(camp, W, 'p0');
    run(camp, 40);
    expect(camp.pickups).toEqual([]);
    press(camp, W, 'p0');
    run(camp, ROLL_TICKS + 1); // it's back the tick after the ball has left
    expect(camp.pickups.map((k) => k.id)).toEqual([1]);
  });

  test('the same type refreshes its duration; death clears every effect', () => {
    const w = world(row(0, 12), [east(0)], { pickups: [pill([1, 1, 0], 'sunglasses'), pill([2, 1, 0], 'sunglasses'), pill([3, 1, 0], 'heavy')] });
    setInput(w, 'p0', input(W));
    run(w, 16); // taken at ticks 6, 11 and 16
    expect(player(w).effects).toEqual([{ type: 'sunglasses', untilTick: 11 + EFFECT_TICKS.sunglasses }, { type: 'heavy', untilTick: 16 + EFFECT_TICKS.heavy }]);
    setInput(w, 'p0', input({}));
    const death = world(row(0, 2), [east(0)]);
    give(player(death), 'bouncy', 'heavy');
    setInput(death, 'p0', input(W)); // bounces off the end
    const events = run(death, 40);
    expect(of(events, 'death')).toHaveLength(1);
    expect(player(death).effects).toEqual([]);
  });

  test('random spawns: every everySec below maxOnMap, only on §11 tiles, the same for the same seed', () => {
    const plate: V3[] = [];
    for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) plate.push([x, 0, z]);
    const json = levelJson(plate, [east(0), [[8, 1, 0], '+Y', '-X'], east(0, 1, 8), [[8, 1, 8], '+Y', '-X']], {
      heat: false, keys: [{ cell: [4, 1, 4], up: '+Y' }], tiles: [{ block: [6, 0, 6], type: 'fire' }],
      randomPickups: { everySec: 1, types: ['bouncy', 'heavy', 'lethargy', 'sunglasses'], maxOnMap: 3 },
    });
    const make = (seed: number) => { const w = createWorld(loadLevel(json), seed); for (let t = 0; t < 100; t++) step(w); return w; };
    const a = make(3), near = spotsNearSpawns(a);
    expect(a.pickups.length).toBe(3); // ticks 20, 40, 60; then full
    for (const k of a.pickups) expect(pickupSpotProblem(a, k, near)).toBeNull();
    expect(a.pickups.map((k) => k.id)).toEqual([0, 1, 2]);
    expect(serialize(make(3))).toBe(serialize(a));
    expect(make(4).pickups.map((k) => k.cell)).not.toEqual(a.pickups.map((k) => k.cell));
    // Nothing spawns on the key, the fire tile or near a spawn, whatever the seed.
    for (let seed = 0; seed < 30; seed++) for (const k of make(seed).pickups) expect(pickupSpotProblem(a, k, near)).toBeNull();
  });
});

describe('bouncy', () => {
  test('a forward roll is a 2-cell bounce, over a gap', () => {
    const w = world([...row(0, 1), ...row(3, 6)], [east(1)]);
    give(player(w), 'bouncy');
    press(w, W, 'p0');
    expect([player(w).action, player(w).to.cell, player(w).endTick - player(w).startTick]).toEqual([Action.Jump, vec(3, 1, 0), JUMP_TICKS]);
    run(w, JUMP_TICKS);
    expect([player(w).action, player(w).pose.cell]).toEqual([Action.Idle, vec(3, 1, 0)]);
  });

  test('forward + jump is a 3-cell jump; a wall ahead is still climbed; hops are unchanged', () => {
    const w = world(row(0, 6), [east(0)]);
    give(player(w), 'bouncy');
    press(w, JUMP, 'p0');
    expect([player(w).action, player(w).to.cell]).toEqual([Action.Jump, vec(3, 1, 0)]);
    const wall = world([...row(0, 6), [1, 1, 0]], [east(0)]);
    give(player(wall), 'bouncy');
    press(wall, W, 'p0');
    expect(player(wall).action).toBe(Action.Climb);
    const hop = world(row(0, 6), [east(0)]);
    give(player(hop), 'bouncy');
    press(hop, { jump: true }, 'p0');
    expect([player(hop).action, player(hop).to.cell]).toEqual([Action.Hop, vec(0, 1, 0)]);
  });

  test('a plain roll at a ball 2 cells ahead stomps it', () => {
    const w = world(row(0, 6), [east(0), [[2, 1, 0], '+Y', '-Z']]);
    give(player(w), 'bouncy');
    press(w, W, 'p0');
    const events = run(w, JUMP_TICKS);
    expect(of(events, 'stomp')).toEqual([{ type: 'stomp', attackerId: 'p0', victimId: 'p1' }]);
    expect([player(w, 'p1').action, player(w, 'p1').to.cell]).toEqual([Action.Knocked, vec(3, 1, 0)]);
  });

  test('a bounce through an active laser beam kills', () => {
    const w = world(row(0, 6), [east(0)], { lasers: [{ group: 'red', from: [1, 1, 0], dir: '+X', length: 1, on: true }] });
    give(player(w), 'bouncy');
    press(w, W, 'p0');
    const events = run(w, JUMP_TICKS);
    expect(of(events, 'death').map((e) => e.cause)).toEqual(['laser']);
  });

  test('it ends on time: an effectEnd event, and rolls are rolls again', () => {
    const w = world(row(0, 12), [east(0)], { pickups: [pill([1, 1, 0], 'bouncy')] });
    press(w, W, 'p0');
    run(w, ROLL_TICKS); // taken at tick 6
    const end = 6 + EFFECT_TICKS.bouncy;
    const events = run(w, end - w.tick);
    expect(of(events, 'effectEnd')).toEqual([{ type: 'effectEnd', playerId: 'p0', effect: 'bouncy' }]);
    expect(player(w).effects).toEqual([]);
    press(w, W, 'p0');
    expect(player(w).action).toBe(Action.Roll);
  });
});

describe('lethargy', () => {
  test('every action you start takes ×1.6, rounded up', () => {
    const w = world(row(0, 6), [east(5)]);
    give(player(w), 'lethargy');
    const took = () => player(w).endTick - player(w).startTick;
    press(w, W, 'p0');
    expect([player(w).action, took()]).toEqual([Action.Roll, 8]);
    run(w, 8);
    press(w, W, 'p0');
    expect([player(w).action, took()]).toEqual([Action.Flip, 10]);
    run(w, 10);
    press(w, { turn: 1 }, 'p0');
    expect([player(w).action, took()]).toEqual([Action.Turn, 5]);
    const jump = world(row(0, 6), [east(0)]);
    give(player(jump), 'lethargy');
    press(jump, JUMP, 'p0');
    expect([player(jump).action, player(jump).endTick - player(jump).startTick]).toEqual([Action.Jump, 16]);
  });

  test("knocks done to you aren't slowed; your own push roll is", () => {
    const w = world(row(0, 6), [east(0), [[1, 1, 0], '+Y', '-Z']]);
    give(player(w, 'p1'), 'lethargy');
    press(w, W, 'p0');
    expect([player(w, 'p1').action, player(w, 'p1').endTick - player(w, 'p1').startTick]).toEqual([Action.Knocked, KNOCK_TICKS]);
    expect(player(w).endTick - player(w).startTick).toBe(ROLL_TICKS);
    const slow = world(row(0, 6), [east(0), [[1, 1, 0], '+Y', '-Z']]);
    give(player(slow), 'lethargy');
    press(slow, W, 'p0');
    expect([player(slow).action, player(slow).endTick - player(slow).startTick]).toEqual([Action.Roll, 8]);
  });
});

describe('heavy', () => {
  const victim = (x: number): Spawn => [[x, 1, 0], '+Y', '-Z'];
  test('a push at a heavy ball bounces the pusher; the heavy ball stays', () => {
    const w = world(row(0, 6), [east(0), victim(1)]);
    give(player(w, 'p1'), 'heavy');
    expect(press(w, W, 'p0')).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    expect([player(w).action, player(w).bounce, player(w, 'p1').action]).toEqual([Action.Stunned, true, Action.Idle]);
  });

  test('a stomp on a heavy ball clashes: the attacker rebounds', () => {
    const w = world(row(0, 6), [east(0), victim(2)]);
    give(player(w, 'p1'), 'heavy');
    press(w, JUMP, 'p0');
    const events = run(w, JUMP_TICKS);
    expect(of(events, 'clash')).toEqual([{ type: 'clash', attackerId: 'p0', victimId: 'p1' }]);
    expect([player(w).action, player(w, 'p1').action]).toEqual([Action.Rebound, Action.Idle]);
  });

  test('an edge push at a heavy ball bounces the flipper', () => {
    const w = world([...row(0, 3), ...row(0, 3, -1)], [[[3, 1, 0], '+Y', '+X'], [[4, 0, 0], '+X', '+Z']]);
    give(player(w, 'p1'), 'heavy');
    expect(press(w, W, 'p0')).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    expect([player(w).action, player(w, 'p1').action]).toEqual([Action.Stunned, Action.Idle]);
  });

  test('a side hit on a heavy roller bounces the hitter; the roller carries on', () => {
    const plate = [-1, 0, 1].flatMap((z) => row(0, 6, 0, z));
    const w = world(plate, [east(1), [[2, 1, -1], '+Y', '+Z']]);
    give(player(w, 'p1'), 'heavy');
    press(w, W, 'p1');
    expect(press(w, W, 'p0')).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    expect([player(w, 'p1').action, player(w, 'p1').to.cell]).toEqual([Action.Roll, vec(2, 1, 0)]);
  });

  test('head-on with a heavy ball: only the other one bounces back', () => {
    const w = world(row(0, 6), [east(1), [[3, 1, 0], '+Y', '-X']]);
    give(player(w), 'heavy');
    press(w, W, 'p0'); // p0 (heavy) rolls 1 → 2
    press(w, W, 'p1'); // p1 starts into 2 head-on
    expect([player(w, 'p1').action, player(w, 'p1').to.cell]).toEqual([Action.Knocked, vec(4, 1, 0)]);
    expect([player(w).action, player(w).to.cell]).toEqual([Action.Roll, vec(2, 1, 0)]);
  });

  test('a heavy push knocks 2 cells; 1 when blocked after 1 or with no ground there', () => {
    const w = world(row(0, 6), [east(0), victim(1)]);
    give(player(w), 'heavy');
    press(w, W, 'p0');
    expect([player(w, 'p1').action, player(w, 'p1').to.cell, player(w, 'p1').endTick - player(w, 'p1').startTick]).toEqual([Action.Knocked, vec(3, 1, 0), 2 * KNOCK_TICKS]);
    run(w, 2 * KNOCK_TICKS);
    expect([player(w, 'p1').action, player(w, 'p1').pose.cell]).toEqual([Action.Stunned, vec(3, 1, 0)]);
    const wall = world([...row(0, 6), [3, 1, 0]], [east(0), victim(1)]);
    give(player(wall), 'heavy');
    press(wall, W, 'p0');
    expect(player(wall, 'p1').to.cell).toEqual(vec(2, 1, 0));
    const gap = world([...row(0, 1), ...row(3, 6)], [east(0), victim(1)]);
    give(player(gap), 'heavy');
    press(gap, W, 'p0');
    expect(player(gap, 'p1').to.cell).toEqual(vec(2, 1, 0));
  });

  test('a heavy cradle striker: the last ball flies 2', () => {
    const w = world(row(0, 8), [east(0), victim(1), victim(2)]);
    give(player(w), 'heavy');
    expect(of(press(w, W, 'p0'), 'cradle')).toEqual([{ type: 'cradle', pusherId: 'p0', victimId: 'p2', length: 2 }]);
    expect([player(w, 'p2').action, player(w, 'p2').to.cell]).toEqual([Action.Knocked, vec(4, 1, 0)]);
  });
});

test('teleport arrival under a high hopper: it arrives under it and is stomped at the landing (13b follow-up)', () => {
  const tiles: TileJson[] = [{ block: [3, 0, 0], face: '+Y', type: 'teleport', pair: 'A' }, { block: [12, 0, 5], face: '+Y', type: 'teleport', pair: 'A' }];
  const w = world([...row(0, 6), ...row(10, 14, 0, 5)], [east(2), [[12, 1, 5], '+Y', '+X']], { tiles });
  setInput(w, 'p1', input({ jump: true }));
  const events = [...press(w, W, 'p0')];
  setInput(w, 'p1', input({}));
  events.push(...run(w, 30));
  expect(of(events, 'teleport').map((e) => e.result)).toEqual(['go']);
  expect(of(events, 'stomp')).toEqual([{ type: 'stomp', attackerId: 'p1', victimId: 'p0' }]);
});

test('bots: the laser-aware planner presses a switch to get through a beam', () => {
  // A beam round every face of the strip at x=5, and its switch on top of (2,0,0).
  const ring: [number, number, number][] = [[5, 1, 0], [5, -1, 0], [5, 0, 1], [5, 0, -1]];
  const w = createWorld(loadLevel(levelJson(row(0, 8), [east(0)], {
    lasers: ring.map((from) => ({ group: 'red', from, dir: '+X' as const, length: 1, on: true })),
    tiles: [{ block: [2, 0, 0], face: '+Y', type: 'switch', group: 'red' }],
  })), 0);
  const from = { cell: vec(0, 1, 0), up: 2 as const, fwd: 0 as const }, goal = new Set(['8,1,0']);
  expect(findPath(w, from, goal)).toBeNull();
  const path = findPathLasers(w, from, goal)!;
  expect(path.some((s) => s.to.cell.x === 2 && s.to.up === 2)).toBe(true); // stops on the switch
  expect(path[path.length - 1].to.cell).toEqual(vec(8, 1, 0));
  expect(w.lasers.get('red')).toBe(true); // restored
});

test('determinism with pickups: 4 random players, fixed and random pills, replayed', () => {
  const plate: V3[] = [];
  for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) plate.push([x, 0, z]);
  const json = levelJson(plate, [east(0), [[8, 1, 0], '+Y', '-X'], east(0, 1, 8), [[8, 1, 8], '+Y', '-X']], {
    pickups: [pill([4, 1, 0], 'bouncy'), pill([4, 1, 8], 'heavy'), pill([0, 1, 4], 'lethargy'), pill([8, 1, 4], 'sunglasses')],
    randomPickups: { everySec: 2, types: ['bouncy', 'heavy', 'lethargy'], maxOnMap: 3 },
  });
  const play = () => {
    const w = createWorld(loadLevel(json), 5), rnd = mulberry32(9), got: SimEvent[] = [];
    for (let i = 0; i < 4; i++) addPlayer(w, `p${i}`, `p${i}`);
    for (let t = 0; t < 2000; t++) {
      for (const p of w.players) if (rnd() < 0.2) setInput(w, p.id, input({ fwdHeld: rnd() < 0.7, turn: rnd() < 0.2 ? -1 : rnd() < 0.2 ? 1 : 0, jump: rnd() < 0.1, jumpHeld: rnd() < 0.05 }));
      got.push(...step(w));
    }
    return { w, got };
  };
  const a = play(), b = play();
  expect(serialize(a.w)).toBe(serialize(b.w));
  expect(new Set(of(a.got, 'pickup').map((e) => e.pickup)).size).toBeGreaterThanOrEqual(3);
});

describe('§11 checker', () => {
  const plate = (): V3[] => { const b: V3[] = []; for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) b.push([x, 0, z]); return b; };
  const corners: Spawn[] = [[[0, 1, 0], '+Y', '+X'], [[8, 1, 0], '+Y', '-X'], [[0, 1, 8], '+Y', '+X'], [[8, 1, 8], '+Y', '-X']];
  const base = (extra: Partial<LevelJson> = {}, blocks: V3[] = plate()): LevelJson =>
    levelJson(blocks, corners, { keys: [{ cell: [4, 1, 4], up: '+Y' }], exit: { cell: [4, 1, 6], up: '+Y' }, keysRequired: 1, ...extra });
  /** Blocks closing in the tunnel (9,1,4) → (10,1,4) → (10,1,6), open only toward the plate at (8,1,4). */
  const tunnel = (): V3[] => {
    const cells = ['9,1,4', '10,1,4', '10,1,5', '10,1,6'], out = new Map<string, V3>();
    for (const c of cells) {
      const [x, y, z] = c.split(',').map(Number);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const n: V3 = [x + dx, y + dy, z + dz], k = n.join(',');
        if (!cells.includes(k) && k !== '8,1,4') out.set(k, n);
      }
    }
    return [...out.values()];
  };
  const findings = (json: LevelJson) => checkTrapRules(loadLevel(json)).filter((f) => f.rule.startsWith('11.'));

  test('a good pill on the edge and a random spawner break no rule', () => {
    expect(findings(base({ pickups: [pill([4, 1, 0], 'bouncy')], randomPickups: { everySec: 20, types: ['heavy', 'bouncy'], maxOnMap: 2 } }))).toEqual([]);
  });
  const cases: [string, LevelJson][] = [
    ['11.1', base({ pickups: [pill([0, 1, 0], 'bouncy')] })], // on a spawn
    ['11.1', base({ pickups: [pill([2, 1, 0], 'bouncy')] })], // 2 moves from a spawn
    ['11.1', base({ pickups: [pill([4, 1, 4], 'bouncy')] })], // on the key
    ['11.1', base({ pickups: [pill([4, 1, 0], 'bouncy')], tiles: [{ block: [4, 0, 0], type: 'crumble' }] })], // on a trap
    ['11.2', base({ pickups: [3, 4, 5, 6, 7].map((z) => pill([4, 1, z === 4 ? 3 : z === 6 ? 7 : z], 'heavy')) })], // 5 spots
    ['11.2', base({ randomPickups: { everySec: 20, types: ['heavy'], maxOnMap: 4 } })],
    // The exit is at the end of a closed tunnel with a bend; the lethargy pill is on the bend, where you must stop.
    ['11.3', base({ exit: { cell: [10, 1, 6], up: '+Y' }, pickups: [pill([10, 1, 4], 'lethargy')] }, [...plate(), ...tunnel()])],
  ];
  test.each(cases)('%s', (rule, json) => {
    expect(findings(json).filter((f) => f.error).map((f) => f.rule)).toContain(rule);
  });
  test('11.4 [W]: a good pill in the open, far from any edge or trap', () => {
    expect(findings(base({ pickups: [pill([3, 1, 3], 'heavy')] }))).toMatchObject([{ rule: '11.4', error: false }]);
  });
});
