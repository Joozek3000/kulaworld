import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, ALL_DIRS, BOOST_HOLD_TICKS, checkTrapRules, createWorld, cross, Dir, dirFromVec, dirVec, findPath, isSolid, loadLevel,
  mulberry32, opposite, perpendicular, ROLL_TICKS, setInput, step, SWITCH_COOLDOWN_TICKS, teleportFwd, vanishLanePassable, vec,
  type LaserJson, type LevelJson, type SimEvent, type TileJson, type World,
} from '../src/index.ts';
import { input, levelJson, makeWorld, player, row, run, serialize, type Spawn } from './util.ts';

// Phase 13b: teleporters, lasers + switches, invisible and vanishing blocks (§18).
type V3 = [number, number, number];
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
/** One roll forward (W for a tick), then run until it has ended. */
function rollOn(w: World, id = 'p0'): SimEvent[] {
  setInput(w, id, input({ fwdHeld: true }));
  const events = step(w);
  setInput(w, id, input({}));
  return [...events, ...run(w, ROLL_TICKS)];
}

// A strip x 0..6 at z 0 with a teleporter on top of (3,0,0), and an island x 10..14 at z 5 with its partner on (12,0,5).
const strip = (): V3[] => [...row(0, 6), ...row(10, 14, 0, 5)];
const tp = (block: V3, face: TileJson['face'] = '+Y', pair = 'A'): TileJson => ({ block, face, type: 'teleport', pair });
const pads = (): TileJson[] => [tp([3, 0, 0]), tp([12, 0, 5])];
const tpWorld = (spawns: Spawn[], tiles = pads(), blocks = strip()) => makeWorld(blocks, spawns, { heat: false, tiles });
const ARRIVAL = vec(12, 1, 5);

describe('teleporters', () => {
  test('a roll onto one warps to the partner, same facing, and never back (no ping-pong)', () => {
    const w = tpWorld([[[2, 1, 0], '+Y', '+X']]);
    const events = rollOn(w);
    const p = player(w);
    expect([p.action, p.to.cell, p.to.fwd, p.endTick - p.startTick]).toEqual([Action.Teleport, ARRIVAL, Dir.PX, 6]);
    expect(of(events, 'teleport')).toEqual([{ type: 'teleport', playerId: 'p0', result: 'go' }]);
    run(w, 6);
    expect([p.action, p.pose.cell]).toEqual([Action.Idle, ARRIVAL]);
    run(w, 40);
    expect([p.action, p.pose.cell]).toEqual([Action.Idle, ARRIVAL]); // standing on the arrival pad never re-triggers
    rollOn(w); // off it, onto (13,1,5)
    setInput(w, 'p0', input({ turn: 1 })); run(w, 1); setInput(w, 'p0', input({})); run(w, 3);
    setInput(w, 'p0', input({ turn: 1 })); run(w, 1); setInput(w, 'p0', input({})); run(w, 3);
    rollOn(w); // back onto the pad: it warps again
    expect([p.action, p.to.cell]).toEqual([Action.Teleport, vec(3, 1, 0)]);
  });

  test('a flip, a climb, an ice slide and a knock onto one all warp', () => {
    // Flip over the strip's end onto a pad on its +X face: up +X, fwd −Y → on top, facing +X.
    const flip = tpWorld([[[6, 1, 0], '+Y', '+X']], [tp([6, 0, 0], '+X'), tp([12, 0, 5])]);
    rollOn(flip); run(flip, 1);
    expect([player(flip).action, player(flip).to.cell, player(flip).to.fwd]).toEqual([Action.Teleport, ARRIVAL, Dir.PX]);
    // Climb a wall whose face holds the pad: up −X, fwd +Y → on top, facing +X.
    const climb = tpWorld([[[6, 1, 0], '+Y', '+X']], [tp([7, 1, 0], '-X'), tp([12, 0, 5])], [...strip(), [7, 1, 0]]);
    rollOn(climb);
    expect([player(climb).action, player(climb).to.cell, player(climb).to.fwd]).toEqual([Action.Teleport, ARRIVAL, Dir.PX]);
    // Slide off an ice block onto the pad.
    const slide = tpWorld([[[1, 1, 0], '+Y', '+X']], [...pads(), { block: [2, 0, 0], type: 'ice' }]);
    rollOn(slide); run(slide, ROLL_TICKS);
    expect([player(slide).action, player(slide).to.cell]).toEqual([Action.Teleport, ARRIVAL]);
    // Knocked onto it (a push combo): it warps facing the knock, then staggers.
    const knock = tpWorld([[[1, 1, 0], '+Y', '+X'], [[2, 1, 0], '+Y', '-Z']]);
    setInput(knock, 'p0', input({ fwdHeld: true })); run(knock, 1); setInput(knock, 'p0', input({}));
    const v = player(knock, 'p1');
    expect(v.action).toBe(Action.Knocked);
    run(knock, 4);
    expect([v.action, v.to.cell, v.to.fwd]).toEqual([Action.Teleport, ARRIVAL, Dir.PX]);
    run(knock, 6);
    expect([v.action, v.pose.cell]).toEqual([Action.Stunned, ARRIVAL]);
  });

  test('facing: the rotation taking the source face onto the target face, for all 36 face pairs', () => {
    const dot = (a: Dir, b: Dir) => { const u = dirVec(a), v = dirVec(b); return u.x * v.x + u.y * v.y + u.z * v.z; };
    for (const from of ALL_DIRS) for (const to of ALL_DIRS) for (const fwd of ALL_DIRS.filter((d) => perpendicular(d, from))) {
      const out = teleportFwd(from, to, fwd);
      expect(perpendicular(out, to)).toBe(true);
      if (from === to || from === opposite(to)) { expect(out).toBe(fwd); continue; }
      // R v = a × v + a (a · v), a = from × to (a quarter turn): R(from) = to.
      const a = cross(from, to), av = dot(fwd, a) ? dirVec(fwd) : dirVec(cross(a, fwd));
      expect(out).toBe(dirFromVec(av));
    }
    expect(teleportFwd(Dir.PY, Dir.PX, Dir.PX)).toBe(Dir.NY); // top → side, heading at the new face: down it
    expect(teleportFwd(Dir.PY, Dir.PX, Dir.PZ)).toBe(Dir.PZ); // along the shared axis: unchanged
  });

  test('a taken partner holds the ball (Charge), then releases it as a plain tile', () => {
    const w = tpWorld([[[2, 1, 0], '+Y', '+X'], [[12, 1, 5], '+Y', '+X']]);
    const events = rollOn(w);
    const p = player(w);
    expect(p.action).toBe(Action.Charge);
    events.push(...run(w, BOOST_HOLD_TICKS + 1));
    expect(of(events, 'teleport').map((e) => e.result)).toEqual(['held', 'released']);
    expect([p.action, p.pose.cell]).toEqual([Action.Idle, vec(3, 1, 0)]);
    rollOn(w, 'p1'); // the partner is free now, but this pad gave up on p0 until it leaves
    run(w, 20);
    expect([p.action, p.pose.cell]).toEqual([Action.Idle, vec(3, 1, 0)]);
  });

  test('held, then the partner clears within the hold: it warps', () => {
    const w = tpWorld([[[2, 1, 0], '+Y', '+X'], [[12, 1, 5], '+Y', '+X']]);
    rollOn(w);
    setInput(w, 'p1', input({ fwdHeld: true })); run(w, 1); setInput(w, 'p1', input({}));
    run(w, ROLL_TICKS);
    const p = player(w);
    expect([p.action, p.to.cell]).toEqual([Action.Teleport, ARRIVAL]);
  });

  test('planning follows a teleport', () => {
    const w = tpWorld([[[1, 1, 0], '+Y', '+X']]);
    const path = findPath(w, player(w).pose, new Set(['14,1,5']))!;
    expect(path.slice(0, 2).map((s) => [s.cmd, s.to.cell])).toEqual([['fwd', vec(2, 1, 0)], ['fwd', ARRIVAL]]); // onto the pad: warped
  });
});

// Lasers: a strip x 0..8 at z 0; a red beam over (4,0,0) (the cell (4,1,0)), a switch on (2,0,0).
const laser = (on = true, from: V3 = [4, 1, 0], length = 1, group = 'red'): LaserJson => ({ group, from, dir: '+X', length, on });
const lzWorld = (spawns: Spawn[], lasers = [laser()], tiles: TileJson[] = [], blocks = row(0, 8)) => makeWorld(blocks, spawns, { heat: false, lasers, tiles });
const sw = (x: number, group = 'red'): TileJson => ({ block: [x, 0, 0], face: '+Y', type: 'switch', group });

describe('lasers and switches', () => {
  test('finishing in an active beam kills (cause laser)', () => {
    const w = lzWorld([[[3, 1, 0], '+Y', '+X']]);
    const events = rollOn(w);
    expect(of(events, 'death')).toEqual([{ type: 'death', playerId: 'p0', cell: vec(4, 1, 0), cause: 'laser' }]);
  });

  test('passing through one kills: a jump over it, a flip past it', () => {
    const jump = lzWorld([[[3, 1, 0], '+Y', '+X']]);
    setInput(jump, 'p0', input({ fwdHeld: true, jump: true })); run(jump, 1); setInput(jump, 'p0', input({}));
    expect(player(jump).to.cell).toEqual(vec(5, 1, 0));
    expect(of(run(jump, 10), 'death')).toEqual([{ type: 'death', playerId: 'p0', cell: vec(4, 1, 0), cause: 'laser' }]);
    const flip = lzWorld([[[8, 1, 0], '+Y', '+X']], [laser(true, [9, 1, 0])]); // the air cell a flip over the end rolls through
    expect(of([...rollOn(flip), ...run(flip, 1)], 'death').map((e) => [e.cell, e.cause])).toEqual([[vec(9, 1, 0), 'laser']]);
  });

  test('an off beam (the level default) is harmless; a switch turns it on, with a cooldown', () => {
    const w = lzWorld([[[1, 1, 0], '+Y', '+X']], [laser(false)], [sw(2)]);
    const events = rollOn(w);
    expect(of(events, 'laser')).toEqual([{ type: 'laser', playerId: 'p0', group: 'red', on: true }]);
    expect(w.lasers.get('red')).toBe(true);
    // Hopping on the switch presses it again, but not within the cooldown.
    // Hopping on it presses it again, but not within the cooldown: landings 11, 21 and 31 ticks later, only the 21 counts.
    setInput(w, 'p0', input({ jumpHeld: true }));
    const hops = run(w, 30);
    expect(SWITCH_COOLDOWN_TICKS).toBe(20);
    expect(of(hops, 'laser').map((e) => e.on)).toEqual([false]);
  });

  test('a beam switched on through a standing ball kills it; a new round starts from the level default', () => {
    const w = lzWorld([[[1, 1, 0], '+Y', '+X'], [[4, 1, 0], '+Y', '+X']], [laser(false)], [sw(2)]);
    const events = rollOn(w);
    expect(of(events, 'death').map((e) => [e.playerId, e.cause])).toEqual([['p1', 'laser']]);
    expect(createWorld(w.level, 2).lasers.get('red')).toBe(false);
  });

  test('planning treats an active beam as a wall and an off one as open', () => {
    const w = lzWorld([[[1, 1, 0], '+Y', '+X']], [laser(true, [4, 1, 0])], [], [...row(0, 8), ...row(0, 8, 0, 1)]);
    const goal = new Set(['7,1,0']);
    const around = findPath(w, player(w).pose, goal)!;
    expect(around.every((s) => s.to.cell.x !== 4 || s.to.cell.z !== 0)).toBe(true);
    w.lasers.set('red', false);
    expect(findPath(w, player(w).pose, goal)!.map((s) => s.cmd)).toEqual(['jump', 'jump', 'jump']); // straight over it
  });
});

describe('invisible and vanishing blocks', () => {
  test('an invisible bridge is solid for rolls and planning', () => {
    const w = makeWorld([], [[[0, 1, 0], '+Y', '+X']], {
      heat: false, boxes: [{ min: [0, 0, 0], max: [1, 0, 0] }, { min: [2, 0, 0], max: [4, 0, 0], invisible: true }, { min: [5, 0, 0], max: [6, 0, 0] }],
    });
    expect(w.level.invisible.size).toBe(3);
    expect(findPath(w, player(w).pose, new Set(['6,1,0']))!.map((s) => s.to.cell.x)).toEqual([2, 4, 6]); // jumps along it
    for (let i = 0; i < 4; i++) rollOn(w);
    expect(player(w).pose.cell).toEqual(vec(4, 1, 0));
  });

  test('a vanishing block follows its schedule, and a ball standing on it falls when it goes', () => {
    const w = makeWorld([], [[[2, 1, 0], '+Y', '+X']], {
      heat: false, blocks: [...row(0, 2), ...row(4, 5), { cell: [3, 0, 0], vanish: { period: 40, on: 20, phase: 0 } }],
    });
    const at = (t: number) => { w.tick = t; return isSolid(w, vec(3, 0, 0)); };
    expect([at(0), at(19), at(20), at(39), at(40)]).toEqual([true, true, false, false, true]);
    w.tick = 0;
    rollOn(w); // onto it at tick 6
    expect(player(w).pose.cell).toEqual(vec(3, 1, 0));
    run(w, 14);
    expect(player(w).action).toBe(Action.Fall);
  });

  test('a lane of vanishing blocks: passable when the on-windows chain at walking speed', () => {
    const v = (phase: number, on = 20) => ({ period: 40, on, phase });
    expect(vanishLanePassable([null, v(0), v(35), v(30), null])).toBe(true); // each on-window starts as you arrive
    expect(vanishLanePassable([null, v(0, 8), v(20, 8), null])).toBe(false); // too short, and out of step
  });
});

// LEVEL-DESIGN §10 checker fixtures: a 9×9 plate, corner spawns, a key in the middle, the exit two tiles further.
const plate = (): V3[] => { const b: V3[] = []; for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) b.push([x, 0, z]); return b; };
const corners: Spawn[] = [[[0, 1, 0], '+Y', '+X'], [[8, 1, 0], '+Y', '-X'], [[0, 1, 8], '+Y', '+X'], [[8, 1, 8], '+Y', '-X']];
const base = (extra: Partial<LevelJson> = {}, blocks: LevelJson['blocks'] = plate()): LevelJson =>
  levelJson([], corners, { blocks, keys: [{ cell: [4, 1, 4], up: '+Y' }], exit: { cell: [4, 1, 6], up: '+Y' }, keysRequired: 1, ...extra });
const errors = (json: LevelJson) => checkTrapRules(loadLevel(json)).filter((f) => f.error).map((f) => f.rule);
const top = (x: number, z: number, more: Partial<TileJson> & Pick<TileJson, 'type'>): TileJson => ({ block: [x, 0, z], face: '+Y', ...more });
// Soft-lock fixture: a floating island x 20..24, z 20..24 at y 20 (off in every axis, so no sideways fall from it
// lands on the plate), reached by a teleporter pair (6,0,6) ↔ (22,20,22). The pad and the tile south of it form a
// room fenced by six beams (off at the start); the exit is on the island, outside the room.
const island = (): V3[] => { const b = plate(); for (let x = 20; x <= 24; x++) for (let z = 20; z <= 24; z++) b.push([x, 20, z]); return b; };
const gate = (): LaserJson[] => ([[21, 21, 22], [23, 21, 22], [22, 21, 21], [21, 21, 23], [23, 21, 23], [22, 21, 24]] as V3[])
  .map((from) => ({ group: 'red', from, dir: '+X', length: 1, on: false }));
const farExit = { cell: [20, 21, 20] as V3, up: '+Y' as const };
const warp = (): TileJson[] => [top(6, 6, { type: 'teleport', pair: 'W' }), { block: [22, 20, 22], face: '+Y', type: 'teleport', pair: 'W' }];
const roomSwitch: TileJson = { block: [22, 20, 23], face: '+Y', type: 'switch', group: 'red' };

describe('§10 [E] rules: one failing fixture each', () => {
  test('the base fixture with a teleporter pair, a laser and a switch breaks no rule', () => {
    const ok = base({ tiles: [top(2, 4, { type: 'teleport', pair: 'A' }), top(6, 2, { type: 'teleport', pair: 'A' }), top(6, 4, { type: 'switch', group: 'red' })],
      lasers: [{ group: 'red', from: [4, 1, 2], dir: '+X', length: 1, on: false }] });
    expect(checkTrapRules(loadLevel(ok)).filter((f) => f.error)).toEqual([]);
  });
  const cases: [string, LevelJson][] = [
    ['10.1', base({ tiles: [top(2, 4, { type: 'teleport', pair: 'A' })] })], // half a pair
    ['10.1', base({ tiles: [top(2, 0, { type: 'teleport', pair: 'A' }), top(6, 4, { type: 'teleport', pair: 'A' })] })], // 2 moves from a spawn
    ['10.2', base({ tiles: [top(3, 4, { type: 'teleport', pair: 'A' }), top(4, 7, { type: 'teleport', pair: 'A' }), top(4, 8, { type: 'spikes' })] })], // arrives facing spikes (entered +Z)
    ['3.1', base({ lasers: [{ group: 'red', from: [9, 0, 4], dir: '+Y', length: 1, on: false }] })], // a beam on a flip landing (10.3)
    // The only switches are on the plate and in the room: on the island outside the room with the beams on, the key is
    // out of reach for good.
    ['10.4', base({ exit: farExit, tiles: [...warp(), top(4, 2, { type: 'switch', group: 'red' }), roomSwitch], lasers: gate() }, island())],
    ['10.4', base({ lasers: ['a', 'b', 'c', 'd'].map((g, i) => ({ group: g, from: [2 + i, 1, 2] as V3, dir: '+X' as const, length: 1, on: false })) })],
    ['10.5', base({ tiles: [top(0, 2, { type: 'switch', group: 'red' })], lasers: [{ group: 'red', from: [4, 1, 2], dir: '+X', length: 1, on: false }] })],
    ['10.6', base({ exit: { cell: [12, 1, 4], up: '+Y' } }, [...plate(), { cell: [9, 0, 4], invisible: true }, { cell: [10, 0, 4], invisible: true }, ...row(11, 12, 0, 4)])],
    ['10.7', base({}, [...plate().filter(([x, , z]) => !(x === 4 && z === 2)), { cell: [4, 0, 2], vanish: { period: 30, on: 20, phase: 0 } }])], // too fast
    ['10.7', base({}, [...plate().filter(([x, , z]) => !(x === 1 && z === 0)), { cell: [1, 0, 0], vanish: { period: 40, on: 30, phase: 0 } }])], // next to a spawn
    // The only route, and out of step: (9) is there for ticks 0-19, (10) for 25-44: you can't get from one to the other.
    ['10.7', base({ exit: { cell: [12, 1, 4], up: '+Y' } }, [...plate(), ...[[9, 0], [10, 15], [11, 0]].map(([x, phase]) => ({ cell: [x, 0, 4] as V3, vanish: { period: 40, on: 20, phase } })), [12, 0, 4]])],
  ];
  test.each(cases)('%s', (rule, json) => {
    expect(errors(json)).toContain(rule);
  });

  test('10.4: the same laser gate with a switch on each side too is no soft-lock', () => {
    const twoSided = base({ exit: farExit, tiles: [...warp(), top(4, 2, { type: 'switch', group: 'red' }), roomSwitch, { block: [20, 20, 24], face: '+Y', type: 'switch', group: 'red' }],
      lasers: gate() }, island());
    expect(errors(twoSided)).not.toContain('10.4');
  });

  test('a lab level reports no errors', () => {
    expect(errors({ ...base({ tiles: [top(2, 4, { type: 'teleport', pair: 'A' })] }), lab: true })).toEqual([]);
  });
});

test('determinism with every 13b type (4 players, random inputs, 2000 ticks)', () => {
  const json = levelJson([], [[[0, 1, 0], '+Y', '+X'], [[8, 1, 0], '+Y', '-X'], [[0, 1, 8], '+Y', '+X'], [[8, 1, 8], '+Y', '-X']], {
    heat: false,
    blocks: [...plate().filter(([x, , z]) => !(z === 6 && x >= 3 && x <= 5)), ...[3, 4, 5].map((x) => ({ cell: [x, 0, 6] as V3, vanish: { period: 40, on: 24, phase: x * 5 } })),
      { cell: [9, 0, 4], invisible: true }, [10, 0, 4]],
    tiles: [top(2, 4, { type: 'teleport', pair: 'A' }), top(6, 2, { type: 'teleport', pair: 'A' }), top(6, 4, { type: 'switch', group: 'red' }), top(2, 2, { type: 'switch', group: 'red' })],
    lasers: [{ group: 'red', from: [4, 1, 2], dir: '+Z', length: 2, on: true }],
  });
  const runOnce = () => {
    const w = createWorld(loadLevel(json), 9);
    for (let i = 0; i < 4; i++) addPlayer(w, `p${i}`, `p${i}`);
    const rnd = mulberry32(31);
    const seen = new Set<string>();
    for (let t = 0; t < 2000; t++) {
      for (const p of w.players) if (rnd() < 0.2) setInput(w, p.id, input({ fwdHeld: rnd() < 0.7, jump: rnd() < 0.05, turn: rnd() < 0.25 ? (rnd() < 0.5 ? -1 : 1) : 0 }));
      for (const e of step(w)) seen.add(e.type === 'death' ? `death:${e.cause}` : e.type);
    }
    return { state: serialize(w), seen: [...seen].sort() };
  };
  const a = runOnce();
  expect(a).toEqual(runOnce());
  expect(a.seen).toEqual(expect.arrayContaining(['teleport', 'laser', 'death:laser']));
});
