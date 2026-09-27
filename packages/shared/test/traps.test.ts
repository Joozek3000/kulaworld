import { describe, expect, test } from 'vitest';
import {
  Action, BOOST_TICKS, CRUMBLE_DELAY_TICKS, Dir, findPath, FIRE_MAX, loadLevel, mulberry32, ROLL_TICKS, setInput, step,
  TICK_RATE, validateLevel, vec,
  type LevelJson, type PlayerState, type SimEvent, type TileJson, type World,
} from '../src/index.ts';
import { input, levelJson, makeWorld, player, row, run, serialize, type Spawn } from './util.ts';

// Tiles & traps (ARCHITECTURE §18, phase 13a). Blocks along x at y=0; balls on top at y=1.
type V3 = [number, number, number];
const east = (x: number): Spawn => [[x, 1, 0], '+Y', '+X'];
const trapWorld = (blocks: V3[], spawns: Spawn[], tiles: TileJson[]) => makeWorld(blocks, spawns, { heat: false, tiles });
/** A face tile on top of block x. Boost pads point +X (east) unless `extra` says otherwise. */
const face = (x: number, type: TileJson['type'], extra: Partial<TileJson> = {}): TileJson =>
  ({ block: [x, 0, 0], face: '+Y', type, ...(type === 'boost' ? { dir: '+X' as const } : {}), ...extra });
const block = (x: number, type: TileJson['type'], extra: Partial<TileJson> = {}): TileJson => ({ block: [x, 0, 0], type, ...extra });
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
/** One press of `i` for one tick, then released. */
const tap = (w: World, i: Parameters<typeof input>[0], id = 'p0') => {
  setInput(w, id, input(i));
  const e = step(w);
  setInput(w, id, input({}));
  return e;
};
/** Steps until p is Idle or Dead (or `max` ticks), collecting events. */
const settle = (w: World, p: PlayerState, max = 200) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < max && p.action !== Action.Idle && p.action !== Action.Dead; i++) events.push(...step(w));
  return events;
};

describe('level format', () => {
  test('validation: unknown type, no block, missing face, arrow not ⟂, bad spike timing, conflicts', () => {
    const errs = (tiles: TileJson[]) => validateLevel(loadLevel(levelJson(row(0, 6), [east(0), east(2), east(4), east(6)], { tiles }))).filter((e) => !e.startsWith('exit'));
    expect(errs([block(1, 'ice'), face(2, 'spikes'), face(3, 'arrow', { dir: '+Z' }), face(4, 'boost', { variant: 'high' })])).toEqual([]);
    expect(errs([{ block: [1, 0, 0], type: 'lava' as TileJson['type'] }])[0]).toMatch(/unknown type/);
    expect(errs([{ block: [1, 5, 0], type: 'ice' }])[0]).toMatch(/no block/);
    expect(errs([{ block: [1, 0, 0], type: 'spikes' }])[0]).toMatch(/needs a face/);
    expect(errs([face(1, 'arrow', { dir: '+Y' })])[0]).toMatch(/perpendicular/);
    expect(errs([face(1, 'spikes', { period: 20, up: 20 })])[0]).toMatch(/0 < up < period/);
    expect(errs([face(1, 'spikes'), face(1, 'arrow', { dir: '+X' })])[0]).toMatch(/already has/);
    expect(errs([block(1, 'ice'), block(1, 'fire')])[0]).toMatch(/already has/);
    expect(errs([block(1, 'ice'), face(1, 'spikes')])[0]).toMatch(/conflicts/);
    expect(errs([block(1, 'crumble'), face(1, 'spikes'), face(2, 'boost'), block(2, 'crumble')])).toEqual([]);
  });

  test('phase 14b: boost needs a dir ⟂ its face; deathtrap only on ice/boost; theme non-lethal; notes are strings', () => {
    const errs = (extra: Partial<LevelJson>) => validateLevel(loadLevel(levelJson(row(0, 6), [east(0), east(2), east(4), east(6)], extra))).filter((e) => !e.startsWith('exit'));
    expect(errs({ tiles: [face(1, 'boost', { dir: undefined })] })[0]).toMatch(/boost needs a dir/);
    expect(errs({ tiles: [face(1, 'boost', { dir: '+Y' })] })[0]).toMatch(/boost needs a dir/);
    expect(errs({ tiles: [face(1, 'boost', { deathtrap: true }), block(2, 'ice', { deathtrap: true })] })).toEqual([]);
    expect(errs({ tiles: [face(1, 'spikes', { deathtrap: true })] })[0]).toMatch(/deathtrap is only for ice or boost/);
    expect(errs({ theme: 'ice' })).toEqual([]);
    expect(errs({ theme: 'fire' })[0]).toMatch(/theme must be a non-lethal/);
    expect(errs({ notes: { '7.5 1,0,0|+Y': 'on purpose' } })).toEqual([]);
    expect(errs({ notes: { x: 3 } as never })[0]).toMatch(/notes must be/);
  });
});

describe('spikes', () => {
  test('rolling onto static spikes kills (cause spikes); jumping over them is safe', () => {
    const w = trapWorld(row(0, 4), [east(0)], [face(1, 'spikes')]);
    const events = [...tap(w, { fwdHeld: true }), ...settle(w, player(w))];
    expect(of(events, 'death')).toEqual([{ type: 'death', playerId: 'p0', cell: vec(1, 1, 0), cause: 'spikes' }]);
    const over = trapWorld(row(0, 4), [east(0)], [face(1, 'spikes')]);
    tap(over, { fwdHeld: true, jump: true });
    settle(over, player(over));
    expect([player(over).action, player(over).pose.cell]).toEqual([Action.Idle, vec(2, 1, 0)]);
  });

  test('retracting spikes (up while (tick + phase) % period < up): exact tick boundaries', () => {
    const spikes = face(1, 'spikes', { period: 20, up: 10, phase: 0 }); // up on ticks 0-9, 20-29, ...
    // Rolled on while down (finishes on tick 15): safe until they rise on tick 20.
    const w = trapWorld(row(0, 4), [east(0)], [spikes]);
    w.tick = 9;
    tap(w, { fwdHeld: true });
    settle(w, player(w));
    expect([w.tick, player(w).action]).toEqual([10 + ROLL_TICKS, Action.Idle]);
    while (w.tick < 19) step(w);
    expect(player(w).action).toBe(Action.Idle);
    expect(of(step(w), 'death')).toEqual([{ type: 'death', playerId: 'p0', cell: vec(1, 1, 0), cause: 'spikes' }]);
    expect(w.tick).toBe(20);
    // A roll finishing on tick 10 (down since tick 10) lives; one finishing on tick 9 (still up) dies.
    for (const [start, dies] of [[4, false], [3, true]] as const) {
      const v = trapWorld(row(0, 4), [east(0)], [spikes]);
      v.tick = start;
      tap(v, { fwdHeld: true });
      settle(v, player(v));
      expect([v.tick, player(v).action]).toEqual([start + 1 + ROLL_TICKS, dies ? Action.Dead : Action.Idle]);
    }
  });
});

describe('fire', () => {
  test(`${FIRE_MAX} fire landings in a row pop the ball; a normal tile in between resets the count`, () => {
    const fire = [1, 2, 4].map((x) => block(x, 'fire'));
    const w = trapWorld(row(0, 8), [east(0)], fire);
    const p = player(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    const events: SimEvent[] = [];
    while (!(p.action === Action.Roll && p.to.cell.x === 4) && p.action !== Action.Dead) events.push(...step(w));
    setInput(w, 'p0', input({}));
    settle(w, p);
    expect([p.pose.cell.x, p.fireCount, p.action]).toEqual([4, 1, Action.Idle]); // 1, 2, reset on x=3, then 1

    const pop = trapWorld(row(0, 8), [east(0)], [1, 2, 3].map((x) => block(x, 'fire')));
    setInput(pop, 'p0', input({ fwdHeld: true }));
    const died: SimEvent[] = [];
    for (let i = 0; i < 40; i++) died.push(...step(pop));
    expect(of(died, 'death')).toEqual([{ type: 'death', playerId: 'p0', cell: vec(3, 1, 0), cause: 'fire' }]);
  });
});

describe('crumble', () => {
  test(`a crumble block vanishes ${CRUMBLE_DELAY_TICKS} ticks after the ball leaves it, not while it stands there`, () => {
    const w = trapWorld(row(0, 4), [east(0)], [block(1, 'crumble', { regrowSec: 1 })]);
    tap(w, { fwdHeld: true });
    settle(w, player(w));
    run(w, 30);
    expect([w.removed.has('1,0,0'), player(w).pose.cell]).toEqual([false, vec(1, 1, 0)]);
    tap(w, { fwdHeld: true });
    settle(w, player(w));
    const left = w.tick;
    expect(w.crumbling.get('1,0,0')).toBe(left + CRUMBLE_DELAY_TICKS);
    run(w, CRUMBLE_DELAY_TICKS - 1);
    expect(w.removed.has('1,0,0')).toBe(false);
    step(w);
    expect(w.removed.has('1,0,0')).toBe(true);
    // Regrows 1 s after vanishing, but only while nobody is in the block's cell.
    const other = player(w);
    // A (stunned, so it doesn't fall) ball in the gap.
    Object.assign(other, { pose: { cell: vec(1, 0, 0), up: Dir.PY, fwd: Dir.PX }, action: Action.Stunned, endTick: w.tick + 1000 });
    run(w, TICK_RATE + 5);
    expect(w.removed.has('1,0,0')).toBe(true);
    Object.assign(other, { pose: { cell: vec(3, 1, 0), up: Dir.PY, fwd: Dir.PX }, action: Action.Idle });
    step(w);
    expect([w.removed.has('1,0,0'), w.crumbling.has('1,0,0')]).toEqual([false, false]);
  });

  test('a ball still on the block (another face) when it vanishes falls', () => {
    const w = trapWorld(row(0, 4), [[[1, 1, 0], '+Y', '+X'], [[1, 0, 1], '+Z', '+X']], [block(1, 'crumble')]);
    tap(w, { fwdHeld: true });
    settle(w, player(w));
    run(w, CRUMBLE_DELAY_TICKS);
    expect(w.removed.has('1,0,0')).toBe(true);
    expect(player(w, 'p1').action).toBe(Action.Fall);
  });
});

describe('ice', () => {
  const lane = (ice: number[], extra: V3[] = [], spawns: Spawn[] = [east(0)]) =>
    trapWorld([...row(0, 6), ...extra], spawns, ice.map((x) => block(x, 'ice')));

  test('a roll onto ice keeps rolling (input ignored) until it finishes off the ice', () => {
    const w = lane([1, 2, 3]);
    const p = player(w);
    tap(w, { fwdHeld: true });
    const actions = new Set<Action>();
    for (let i = 0; i < 60 && !(p.action === Action.Idle && p.pose.cell.x === 4); i++) {
      if (p.pose.cell.x === 2 && p.action === Action.Roll) setInput(w, 'p0', input({ turn: 1 })); // ignored mid-slide
      step(w);
      actions.add(p.action);
    }
    expect([p.pose.cell, p.pose.fwd, p.action]).toEqual([vec(4, 1, 0), Dir.PX, Action.Idle]);
    expect(actions.has(Action.Turn)).toBe(false);
  });

  test('a slide into a wall climbs it; a slide off an edge flips', () => {
    const wall = lane([1, 2], [[3, 1, 0]]);
    tap(wall, { fwdHeld: true });
    const seen: Action[] = [];
    for (let i = 0; i < 20; i++) { step(wall); seen.push(player(wall).action); }
    expect(seen).toContain(Action.Climb);
    const edge = trapWorld(row(0, 2), [east(0)], [block(1, 'ice'), block(2, 'ice')]);
    tap(edge, { fwdHeld: true });
    let flip: PlayerState['to'] | null = null;
    for (let i = 0; i < 20 && !flip; i++) { step(edge); if (player(edge).action === Action.Flip) flip = player(edge).to; }
    expect(flip).toEqual({ cell: vec(3, 0, 0), up: Dir.PX, fwd: Dir.NY });
  });

  test('a slide into a player pushes it', () => {
    const w = lane([1, 2, 3], [], [east(0), [[4, 1, 0], '+Y', '+Z']]);
    tap(w, { fwdHeld: true });
    const events: SimEvent[] = [];
    for (let i = 0; i < 20; i++) events.push(...step(w));
    expect(of(events, 'push')).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p1' }]);
  });

  test('a jump on ice goes forward even without W', () => {
    const w = trapWorld(row(0, 6), [east(1)], [block(1, 'ice')]);
    tap(w, { jump: true });
    expect([player(w).action, player(w).to.cell]).toEqual([Action.Jump, vec(3, 1, 0)]);
  });
});

describe('arrow', () => {
  test('fwd only along the arrow; turning and hopping allowed', () => {
    const wide: V3[] = [...row(0, 4), ...row(0, 4, 0, 1)];
    const w = trapWorld(wide, [[[1, 1, 0], '+Y', '+Z']], [face(1, 'arrow', { dir: '+X' })]);
    const p = player(w);
    tap(w, { fwdHeld: true });
    expect(p.action).toBe(Action.Idle); // facing +Z: blocked
    tap(w, { jump: true, fwdHeld: true });
    expect(p.action).toBe(Action.Hop); // a forward jump is blocked too; the hop isn't
    settle(w, p);
    tap(w, { turn: -1 });
    expect(p.action).toBe(Action.Turn);
    settle(w, p);
    expect(p.pose.fwd).toBe(Dir.PX);
    tap(w, { fwdHeld: true });
    expect([p.action, p.to.cell]).toEqual([Action.Roll, vec(2, 1, 0)]);
  });
});

describe('boost', () => {
  test('far lands 3 ahead; high lands 2 ahead and 1 up', () => {
    const far = trapWorld(row(0, 6), [east(0)], [face(1, 'boost', { variant: 'far' })]);
    tap(far, { fwdHeld: true });
    run(far, ROLL_TICKS);
    const p = player(far);
    expect([p.action, p.pose.cell, p.to.cell, p.endTick - p.startTick]).toEqual([Action.Jump, vec(1, 1, 0), vec(4, 1, 0), BOOST_TICKS]);
    settle(far, p);
    expect([p.action, p.pose.cell]).toEqual([Action.Idle, vec(4, 1, 0)]);

    const high = trapWorld([...row(0, 4), [3, 1, 0]], [east(0)], [face(1, 'boost', { variant: 'high' })]);
    tap(high, { fwdHeld: true });
    settle(high, player(high));
    settle(high, player(high));
    expect(player(high).pose.cell).toEqual(vec(3, 2, 0));
  });

  test('a boost onto a player stomps it (§16); a boost into the void falls to its death', () => {
    const w = trapWorld(row(0, 7), [east(0), [[4, 1, 0], '+Y', '+Z']], [face(1, 'boost')]);
    tap(w, { fwdHeld: true });
    const events: SimEvent[] = [];
    for (let i = 0; i < ROLL_TICKS + BOOST_TICKS + 1; i++) events.push(...step(w));
    expect(of(events, 'stomp')).toEqual([{ type: 'stomp', attackerId: 'p0', victimId: 'p1' }]);
    expect(player(w, 'p1').to.cell).toEqual(vec(5, 1, 0));

    const pit = trapWorld(row(0, 1), [east(0)], [face(1, 'boost')]);
    tap(pit, { fwdHeld: true });
    const died: SimEvent[] = [];
    for (let i = 0; i < 100; i++) died.push(...step(pit));
    expect(of(died, 'death').map((e) => e.cause)).toEqual(['fall']);
  });
});

describe('knocked onto ice (phase 14b)', () => {
  // p1 pushes p0 (+X): p0 at x=1 is knocked onto x=2, the start of an ice run to x=5; x=6 is plain.
  const rink = (extra: Spawn[] = []) =>
    trapWorld(row(0, 8), [[[1, 1, 0], '+Y', '+Z'], [[0, 1, 0], '+Y', '+X'], ...extra], [2, 3, 4, 5].map((x) => block(x, 'ice')));

  test('a knock that ends on ice slides on in the knock direction to the rim', () => {
    const w = rink();
    const p0 = player(w);
    expect(of(tap(w, { fwdHeld: true }, 'p1'), 'push')).toHaveLength(1);
    settle(w, p0);
    for (let i = 0; i < 60 && p0.pose.cell.x < 6; i++) step(w);
    expect(p0.pose.cell).toEqual(vec(6, 1, 0));
    expect(p0.pose.fwd).toBe(Dir.PX); // it faces the knock direction for the slide
  });

  test('a knock-slide into another ball pushes it', () => {
    const w = rink([[[6, 1, 0], '+Y', '+Z']]);
    tap(w, { fwdHeld: true }, 'p1');
    const events: SimEvent[] = [];
    for (let i = 0; i < 60; i++) events.push(...step(w));
    expect(of(events, 'push')).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p2' }]);
    expect(player(w, 'p2').pose.cell).toEqual(vec(7, 1, 0));
    expect(player(w).pose.cell).toEqual(vec(6, 1, 0));
  });

  test('the stagger comes after the slide ends, not when the knock lands', () => {
    const w = rink();
    const p0 = player(w);
    tap(w, { fwdHeld: true }, 'p1');
    const seen: Action[] = [];
    for (let i = 0; i < 60; i++) { step(w); if (seen[seen.length - 1] !== p0.action) seen.push(p0.action); }
    expect(seen).toEqual([Action.Knocked, Action.Roll, Action.Stunned, Action.Idle]);
    expect(p0.bounce).toBe(false);
    expect(p0.pose.cell).toEqual(vec(6, 1, 0));
  });
});

describe('planning (findPath)', () => {
  test('across ice to a key: one press, the slide does the rest', () => {
    const w = trapWorld(row(0, 6), [east(0)], [1, 2, 3].map((x) => block(x, 'ice')));
    const path = findPath(w, player(w).pose, new Set(['4,1,0']));
    expect(path?.map((s) => s.cmd)).toEqual(['fwd']);
  });

  test('around spikes, never onto them', () => {
    const w = trapWorld([...row(0, 4), ...row(0, 4, 0, 1)], [east(0)], [face(2, 'spikes', { period: 40, up: 1 })]);
    const path = findPath(w, player(w).pose, new Set(['4,1,0']))!;
    expect(path.length).toBeGreaterThan(0);
    expect(path.some((s) => s.to.cell.x === 2 && s.to.cell.z === 0 && s.to.up === Dir.PY)).toBe(false);
  });

  test('fire (phase 14b): a plan may take 2 fire landings in a row but never a 3rd', () => {
    const two = trapWorld(row(0, 3), [east(0)], [1, 2].map((x) => block(x, 'fire')));
    const from = player(two).pose, goal = new Set(['3,1,0']);
    expect(findPath(two, from, goal)!.map((s) => s.to.fire)).toEqual([1, 0]); // jump onto 2, roll off
    expect(findPath(two, from, goal, undefined, 1)!.map((s) => s.to.fire)).toEqual([2, 0]); // standing on 1 fire already
    const third = findPath(two, from, goal, undefined, 2)!; // jumping onto 2 would be a third: round by a side face
    expect(third.length).toBeGreaterThan(2);
    expect(third[0].to.fire).toBe(2); // the first landing isn't on fire...
    expect(third.find((s) => s.cmd !== 'left' && s.cmd !== 'right')!.to.fire).toBe(0); // ...it resets the count
    expect(findPath(two, from, goal, undefined, 0, 0)).toBe(null); // fireMax 0: fire is a wall
    const six = trapWorld(row(0, 8), [east(0)], [1, 2, 3, 4, 5, 6].map((x) => block(x, 'fire')));
    expect(findPath(six, player(six).pose, new Set(['8,1,0']))).toBe(null); // 6 in a row: at least 3 landings
  });

  test('over a gap with a boost pad', () => {
    const w = trapWorld([[0, 0, 0], [1, 0, 0], [4, 0, 0], [5, 0, 0]], [east(0)], [face(1, 'boost')]);
    const path = findPath(w, player(w).pose, new Set(['5,1,0']));
    expect(path?.map((s) => [s.cmd, s.to.cell.x])).toEqual([['fwd', 4], ['fwd', 5]]);
  });
});

test('determinism with every tile type (4 players, random inputs, 2000 ticks)', () => {
  const tiles: TileJson[] = [
    block(1, 'ice'), block(2, 'ice'), block(4, 'fire'), block(5, 'crumble', { regrowSec: 1 }), block(9, 'crumble', { regrowSec: 2 }),
    face(7, 'spikes', { period: 30, up: 10, phase: 5 }), face(8, 'arrow', { dir: '-X' }), face(10, 'boost', { variant: 'high' }),
    face(3, 'boost'), { block: [6, 0, 1], face: '+Y', type: 'spikes' },
  ];
  const blocks: V3[] = [...row(0, 12), ...row(0, 12, 0, 1), [12, 1, 0]];
  const runOnce = () => {
    const w = makeWorld(blocks, [east(0), [[12, 1, 1], '+Y', '-X'], [[5, 1, 1], '+Y', '-Z'], [[9, 1, 1], '+Y', '+X']], { heat: false, tiles });
    const rnd = mulberry32(11);
    const causes: string[] = [];
    for (let t = 0; t < 2000; t++) {
      for (const p of w.players) if (rnd() < 0.2) setInput(w, p.id, input({ fwdHeld: rnd() < 0.7, jump: rnd() < 0.08, turn: rnd() < 0.2 ? (rnd() < 0.5 ? -1 : 1) : 0 }));
      for (const e of step(w)) if (e.type === 'death') causes.push(e.cause);
    }
    return { state: serialize(w), causes };
  };
  const a = runOnce();
  expect(new Set(a.causes).size).toBeGreaterThan(1);
  expect(a).toEqual(runOnce());
});
