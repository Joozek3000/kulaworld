import { describe, expect, test } from 'vitest';
import {
  Action, add, addPlayer, ALL_DIRS, BOOST_HOLD_TICKS, BOOST_TICKS, cellKey, createWorld, Dir, dirName, dirVec, findPath, loadLevel,
  mulberry32, perpendicular, ROLL_TICKS, setInput, step, sub, vec,
  type SimEvent, type TileJson, type World,
} from '../src/index.ts';
import { input, levelFiles, makeWorld, player, readLevelJson, row, run, serialize, type Spawn } from './util.ts';

// Boost pads always launch (phase 14c, §18): a 3-wide plate x 0..10, z -1..1; the pad on top of (3,0,0) points +X,
// so a far launch lands in (6,1,0) whichever way the ball arrived.
type V3 = [number, number, number];
const plate = (x1 = 10): V3[] => [...row(0, x1, 0, -1), ...row(0, x1), ...row(0, x1, 0, 1)];
const pad = (x = 3, dir: TileJson['dir'] = '+X', more: Partial<TileJson> = {}): TileJson => ({ block: [x, 0, 0], face: '+Y', type: 'boost', dir, ...more });
const world = (spawns: Spawn[], tiles: TileJson[] = [pad()], blocks = plate()) => makeWorld(blocks, spawns, { heat: false, tiles });
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
/** p rolls once (W for one tick), then runs until its roll has ended: the tick the pad fires. */
function rollOn(w: World, id = 'p0'): SimEvent[] {
  setInput(w, id, input({ fwdHeld: true }));
  const events = step(w);
  setInput(w, id, input({}));
  return [...events, ...run(w, ROLL_TICKS)];
}
const L = vec(6, 1, 0);

describe('a pad launches on any arrival, always along its dir', () => {
  test.each([
    ['along (+X)', [[2, 1, 0], '+Y', '+X']],
    ['against (-X)', [[4, 1, 0], '+Y', '-X']],
    ['sideways (-Z)', [[3, 1, 1], '+Y', '-Z']],
    ['sideways (+Z)', [[3, 1, -1], '+Y', '+Z']],
  ] as [string, Spawn][])('entry %s', (_, spawn) => {
    const w = world([spawn]);
    const events = rollOn(w);
    const p = player(w);
    expect([p.action, p.to.cell, p.to.fwd, p.endTick - p.startTick]).toEqual([Action.Jump, L, Dir.PX, BOOST_TICKS]);
    expect(of(events, 'boost')).toEqual([{ type: 'boost', playerId: 'p0', result: 'launch' }]);
    if (spawn[2] !== '+X') expect(p.turnStartTick).toBe(w.tick); // it spins to face the arrow in the air
  });

  test('a climb onto a pad on a wall launches along the pad', () => {
    // A wall x=5, y 1..6; the pad on its -X face at y=1 points +Y: climbing onto it throws the ball 3 up the wall.
    const wall: V3[] = [1, 2, 3, 4, 5, 6].map((y) => [5, y, 0]);
    const w = world([[[4, 1, 0], '+Y', '+X']], [{ block: [5, 1, 0], face: '-X', type: 'boost', dir: '+Y' }], [...plate(), ...wall]);
    rollOn(w);
    const p = player(w);
    expect([p.action, p.to.cell, p.to.up, p.to.fwd]).toEqual([Action.Jump, vec(4, 4, 0), Dir.NX, Dir.PY]);
  });

  test('an ice slide onto a pad launches', () => {
    const w = world([[[0, 1, 0], '+Y', '+X']], [pad(), { block: [1, 0, 0], type: 'ice' }, { block: [2, 0, 0], type: 'ice' }]);
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w);
    setInput(w, 'p0', input({}));
    run(w, 3 * ROLL_TICKS);
    expect([player(w).action, player(w).to.cell]).toEqual([Action.Jump, L]);
  });

  test('a knock onto a pad launches; the stagger comes after the landing', () => {
    const w = world([[[1, 1, 0], '+Y', '+X'], [[2, 1, 0], '+Y', '+Z']]);
    const p1 = player(w, 'p1');
    setInput(w, 'p0', input({ fwdHeld: true }));
    expect(of(step(w), 'push')).toHaveLength(1);
    setInput(w, 'p0', input({}));
    const seen: Action[] = [];
    for (let i = 0; i < 40; i++) { step(w); if (seen[seen.length - 1] !== p1.action) seen.push(p1.action); }
    expect(seen).toEqual([Action.Knocked, Action.Jump, Action.Stunned, Action.Idle]);
    expect([p1.pose.cell, p1.pose.fwd, p1.bounce]).toEqual([L, Dir.PX, false]);
  });
});

describe('a blocked launch holds the ball on the pad (Charge)', () => {
  /** p1 stands on the landing, spawn-protected (not stompable) until `until`. */
  const guarded = (until: number) => {
    const w = world([[[2, 1, 0], '+Y', '+X'], [[6, 1, 0], '+Y', '+Z']]);
    player(w, 'p1').protectedUntil = until;
    return w;
  };

  test('a non-stompable ball on the landing: Charge, then the launch as soon as it moves away', () => {
    const w = guarded(1000);
    const events = rollOn(w);
    const p0 = player(w);
    expect(p0.action).toBe(Action.Charge);
    expect(of(events, 'boost')).toEqual([{ type: 'boost', playerId: 'p0', result: 'held', reason: 'unstompable', byId: 'p1' }]);
    setInput(w, 'p1', input({ fwdHeld: true })); // rolls away along +Z
    step(w);
    setInput(w, 'p1', input({}));
    const later: SimEvent[] = [];
    for (let i = 0; i < ROLL_TICKS + 2 && p0.action !== Action.Jump; i++) later.push(...step(w)); // its roll holds the cell 5 ticks
    expect([p0.action, p0.to.cell]).toEqual([Action.Jump, L]);
    expect(of(later, 'boost').map((e) => e.result)).toEqual(['launch']);
  });

  test(`still blocked after ${BOOST_HOLD_TICKS} ticks: released as a plain tile, no re-fire until it leaves and comes back`, () => {
    const w = guarded(10_000);
    const p0 = player(w);
    const events = rollOn(w);
    const heldAt = w.tick;
    while (p0.action === Action.Charge && w.tick < heldAt + 30) events.push(...step(w));
    expect(w.tick).toBe(heldAt + BOOST_HOLD_TICKS);
    expect(of(events, 'boost').map((e) => e.result)).toEqual(['held', 'released']);
    expect(p0.action).toBe(Action.Idle);
    run(w, 20); // idle on the pad: nothing
    expect([p0.action, p0.pose.cell]).toEqual([Action.Idle, vec(3, 1, 0)]);
    // Off the pad (+X to 4), and back onto it (-X): it fires again (and is held again: p1 is still there).
    rollOn(w);
    expect(p0.pose.cell).toEqual(vec(4, 1, 0));
    setInput(w, 'p0', input({ turn: 1 }));
    run(w, 4);
    setInput(w, 'p0', input({ turn: 1 }));
    run(w, 4);
    expect(p0.pose.fwd).toBe(Dir.NX);
    expect(of(rollOn(w), 'boost').map((e) => e.result)).toEqual(['held']);
  });

  test('a stompable ball on the landing is stomped (unchanged)', () => {
    const w = guarded(0);
    rollOn(w);
    expect(player(w).stompBump).toEqual(vec(7, 1, 0));
    expect(of(run(w, BOOST_TICKS), 'stomp')).toEqual([{ type: 'stomp', attackerId: 'p0', victimId: 'p1' }]);
  });

  test('two balls arrive on two pads with the same landing on the same tick: fair order, the second holds', () => {
    const w = world([[[2, 1, 0], '+Y', '+X'], [[10, 1, 0], '+Y', '-X']], [pad(3, '+X'), pad(9, '-X')], plate(12));
    setInput(w, 'p0', input({ fwdHeld: true }));
    setInput(w, 'p1', input({ fwdHeld: true }));
    step(w);
    setInput(w, 'p0', input({}));
    setInput(w, 'p1', input({}));
    const events = run(w, ROLL_TICKS);
    const actions = [player(w).action, player(w, 'p1').action].sort();
    expect(actions).toEqual([Action.Jump, Action.Charge].sort());
    const held = of(events, 'boost').find((e) => e.result === 'held')!;
    const jumper = player(w).action === Action.Jump ? 'p0' : 'p1';
    expect(held).toEqual({ type: 'boost', playerId: jumper === 'p0' ? 'p1' : 'p0', result: 'held', reason: 'reserved', byId: jumper });
  });
});

test('planning: a path through a pad entered from the side (it launches along its arrow)', () => {
  // Two islands: x 0..4 and x 7..9 (z -1..1), a 2-wide gap. The pad at (4,0,0) points +X across it; the ball starts
  // beside the pad facing -Z, so one roll sideways onto it is the whole plan.
  const blocks = [...plate(4), ...[7, 8, 9].flatMap((x) => [-1, 0, 1].map((z) => [x, 0, z] as V3))];
  const w = world([[[4, 1, 1], '+Y', '-Z']], [pad(4, '+X')], blocks);
  const path = findPath(w, player(w).pose, new Set(['7,1,0']))!;
  expect(path.map((s) => [s.cmd, s.to.cell, s.to.fwd])).toEqual([['fwd', vec(7, 1, 0), Dir.PX]]);
});

test('determinism with pads, holds and knocks (4 players, random inputs, 1500 ticks)', () => {
  const tiles = [pad(3, '+X'), pad(9, '-X'), { block: [6, 0, 1], face: '+Y', type: 'boost', dir: '-Z' } as TileJson, { block: [5, 0, -1], type: 'ice' } as TileJson];
  const runOnce = () => {
    const w = world([[[0, 1, 0], '+Y', '+X'], [[12, 1, 0], '+Y', '-X'], [[6, 1, -1], '+Y', '+Z'], [[6, 1, 1], '+Y', '-Z']], tiles, plate(12));
    const rnd = mulberry32(5);
    const results: string[] = [];
    for (let t = 0; t < 1500; t++) {
      for (const p of w.players) if (rnd() < 0.2) setInput(w, p.id, input({ fwdHeld: rnd() < 0.7, jump: rnd() < 0.05, turn: rnd() < 0.25 ? (rnd() < 0.5 ? -1 : 1) : 0 }));
      for (const e of step(w)) if (e.type === 'boost') results.push(e.result);
    }
    return { state: serialize(w), results };
  };
  const a = runOnce();
  expect(a.results).toContain('launch');
  expect(a).toEqual(runOnce());
});

// Level audit: every pad in the pool, rolled onto from each open neighbour on its face, launches along its arrow.
describe.each(levelFiles().filter((f) => readLevelJson(f).pool && (readLevelJson(f).tiles ?? []).some((t) => t.type === 'boost')))('%s pads', (file) => {
  const level = loadLevel(readLevelJson(file));
  const pads = level.tiles.filter((t) => t.type === 'boost');
  test.each(pads.map((t) => [`${cellKey(t.block)} ${dirName(t.face!)} → ${dirName(t.dir!)}`, t] as const))('%s', (_, t) => {
    const up = t.face!, U = dirVec(up), F = dirVec(t.dir!), C = add(t.block, U);
    const expected = t.variant === 'high' ? add(add(C, F), add(F, U)) : add(add(C, F), add(F, F));
    let entries = 0;
    for (const d of ALL_DIRS.filter((x) => perpendicular(x, up))) {
      const from = sub(C, dirVec(d));
      if (level.solid.has(cellKey(from)) || !level.solid.has(cellKey(sub(from, U)))) continue; // no neighbour tile that way
      const w = createWorld(level, 1);
      const p = addPlayer(w, 'p', 'p');
      p.pose = { cell: from, up, fwd: d };
      p.to = p.pose;
      p.action = Action.Idle;
      setInput(w, 'p', input({ fwdHeld: true }));
      step(w);
      setInput(w, 'p', input({}));
      run(w, ROLL_TICKS);
      expect([p.action, p.to.cell, p.to.fwd], `${file}: entering along ${dirName(d)}`).toEqual([Action.Jump, expected, t.dir]);
      entries++;
    }
    expect(entries).toBeGreaterThan(0);
  });
});
