import { describe, expect, test } from 'vitest';
import {
  Action, crumbleBands, Dir, HEAT_BURN_TICKS, HEAT_WARN_TICKS, loadLevel, setInput, step, STUN_TICKS, TICK_RATE, tileKey, vec,
  type SimEvent, type World,
} from '../src/index.ts';
import { input, levelJson, makeWorld, player, row, run, serialize, type Spawn } from './util.ts';

// Hot tiles (phase 12): heat counts ticks on the same (cell, up) while Idle, Turning or Hopping (half rate, 12b).
const at = (x: number): Spawn => [[x, 1, 0], '+Y', '+X'];
const knockout = { mode: 'knockout' as const, lives: 3, crumble: { startSec: 600, intervalSec: 10, warnSec: 2 }, keys: [], exit: undefined, keysRequired: undefined };

describe('hot tiles', () => {
  test('heat builds while Idle, Turning and Hopping, and resets when the ball moves', () => {
    const w = makeWorld(row(0, 8), [at(2)]);
    const p = player(w);
    run(w, 10);
    expect(p.heat).toBe(10);
    setInput(w, 'p0', input({ turn: 1 }));
    run(w, 5);
    expect(p.heat).toBe(15); // turning in place still counts
    setInput(w, 'p0', input({ jump: true }));
    run(w, 5);
    expect([p.action, p.heat]).toEqual([Action.Hop, 18]); // hopping in place counts at half rate: even ticks 16, 18, 20
    setInput(w, 'p0', input({}));
    while (p.action !== Action.Idle) step(w);
    const before = p.heat;
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w);
    setInput(w, 'p0', input({}));
    while (p.action !== Action.Idle) step(w);
    expect(before).toBeGreaterThan(18);
    expect(p.heat).toBeLessThanOrEqual(1); // a new tile
  });

  test('a stun does not count', () => {
    const w = makeWorld(row(0, 8), [at(2)]);
    const p = player(w);
    run(w, 5);
    Object.assign(p, { action: Action.Stunned, bounce: false, startTick: w.tick, endTick: w.tick + STUN_TICKS });
    run(w, STUN_TICKS - 1);
    expect(p.heat).toBe(5);
  });

  test('warn and burn at the exact ticks', () => {
    const w = makeWorld(row(0, 8), [at(2)]);
    const p = player(w);
    run(w, HEAT_WARN_TICKS);
    expect([p.heat, w.tick]).toEqual([HEAT_WARN_TICKS, HEAT_WARN_TICKS]);
    const events: SimEvent[] = [];
    while (w.tick < HEAT_BURN_TICKS - 1) events.push(...step(w));
    expect(p.action).toBe(Action.Idle);
    events.push(...step(w));
    expect(w.tick).toBe(HEAT_BURN_TICKS);
    expect(events.filter((e) => e.type === 'burn')).toEqual([{ type: 'burn', playerId: 'p0' }]);
    expect(p.action).toBe(Action.Dead);
  });

  test('a burn in knockout costs a life; in race it drops a key', () => {
    const ko = makeWorld(row(0, 8), [at(2), at(6)], knockout);
    run(ko, HEAT_BURN_TICKS);
    expect(player(ko).lives).toBe(2);
    const race = makeWorld(row(0, 8), [at(2), at(6)], { keys: [{ cell: [0, 1, 0], up: '+Y' }], keysRequired: 1 });
    const p = player(race);
    race.keys[0].collected = true;
    p.keys = 1;
    p.keyIds = [0];
    const events: SimEvent[] = [];
    for (let i = 0; i < HEAT_BURN_TICKS; i++) events.push(...step(race));
    expect(events.filter((e) => e.type === 'keyDrop')).toEqual([{ type: 'keyDrop', playerId: 'p0', keyId: 0 }]);
  });

  test('level heat false turns it off; heat thresholds come from the level', () => {
    const off = makeWorld(row(0, 8), [at(2)], { heat: false });
    run(off, HEAT_BURN_TICKS * 2);
    expect(player(off).action).toBe(Action.Idle);
    const custom = makeWorld(row(0, 8), [at(2)], { heat: { warnSec: 1, burnSec: 2 } });
    run(custom, 2 * TICK_RATE);
    expect(player(custom).action).toBe(Action.Dead);
  });

  // Tile heat (phase 12c): the heat belongs to the tile, and an empty tile cools at 1 per 2 ticks.
  const tile2 = tileKey(vec(2, 1, 0), Dir.PY);
  /** One command, then wait until p's action is done. */
  const act = (w: World, id: string, i: Parameters<typeof input>[0]) => {
    setInput(w, id, input(i));
    step(w);
    setInput(w, id, input({}));
    while (player(w, id).action !== Action.Idle) step(w);
  };

  test('step off at the warning and straight back: burns sooner than a fresh tile', () => {
    const w = makeWorld(row(0, 8), [at(2)]);
    const p = player(w);
    run(w, HEAT_WARN_TICKS);
    act(w, 'p0', { fwdHeld: true }); // to x=3
    const left = w.tick; // the tile is empty from here
    act(w, 'p0', { turn: 1 });
    act(w, 'p0', { turn: 1 });
    act(w, 'p0', { fwdHeld: true }); // back to x=2
    const back = w.tick;
    expect([p.pose.cell, back - left < TICK_RATE]).toEqual([vec(2, 1, 0), true]);
    expect(p.heat).toBeGreaterThan(HEAT_WARN_TICKS - 10);
    while (p.action !== Action.Dead) step(w);
    expect(w.tick - back).toBeLessThan(HEAT_BURN_TICKS - HEAT_WARN_TICKS + 10);
  });

  test('an empty tile cools at 1 per 2 ticks, to 0', () => {
    const w = makeWorld(row(0, 8), [at(2)]);
    run(w, 20);
    act(w, 'p0', { fwdHeld: true });
    const h = w.hot.get(tile2)!;
    expect(h).toBeGreaterThan(15);
    run(w, 10);
    expect(w.hot.get(tile2)).toBe(h - 5);
    run(w, 2 * h);
    expect(w.hot.has(tile2)).toBe(false);
  });

  test('two players alternating on one tile share its heat', () => {
    const w = makeWorld(row(0, 8), [at(2), at(1)]);
    run(w, 30);
    act(w, 'p0', { fwdHeld: true }); // p0 leaves x=2
    act(w, 'p1', { fwdHeld: true }); // p1 rolls in
    step(w);
    expect(player(w, 'p1').pose.cell).toEqual(vec(2, 1, 0));
    expect(player(w, 'p1').heat).toBeGreaterThan(25);
  });

  test('determinism with burns', () => {
    const once = () => { const w = makeWorld(row(0, 8), [at(1), at(4), at(7), [[3, 1, 0], '+Y', '-X']]); run(w, 400); return serialize(w); };
    expect(once()).toBe(once());
  });
});

test('race sudden death: crumble bands never include the block under a key or the exit', () => {
  const level = loadLevel(levelJson(row(0, 12), [at(1), at(3), at(5), at(7)], {
    keys: [{ cell: [0, 1, 0], up: '+Y' }], exit: { cell: [12, 1, 0], up: '+Y' }, keysRequired: 1,
    crumble: { startSec: 10, intervalSec: 2, warnSec: 1 },
  }));
  const all = crumbleBands(level).flat();
  expect(all).not.toContain('0,0,0');
  expect(all).not.toContain('12,0,0');
  expect(all).toHaveLength(11);
  const w = makeWorld(row(0, 12), [at(4), at(5), at(6), at(7)], {
    keys: [{ cell: [0, 1, 0], up: '+Y' }], exit: { cell: [12, 1, 0], up: '+Y' }, keysRequired: 1,
    crumble: { startSec: 1, intervalSec: 2, warnSec: 1 }, heat: false,
  });
  const events: SimEvent[] = [];
  for (let i = 0; i < 2 * TICK_RATE; i++) events.push(...step(w));
  expect(events.some((e) => e.type === 'crumble')).toBe(true); // race levels crumble too
  expect(w.removed.has('0,0,0') || w.removed.has('12,0,0')).toBe(false);
});
