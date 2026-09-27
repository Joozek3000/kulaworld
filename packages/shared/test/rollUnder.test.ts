import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, createWorld, JUMP_TICKS, loadLevel, mulberry32, setInput, step, vec,
  type SimEvent, type World,
} from '../src/index.ts';
import { input, levelJson, makeWorld, player, row, run, serialize, type Spawn } from './util.ts';

// Roll under a high hop (ARCHITECTURE §14). p1 hops in place at x=1 from tick 1 and lands at LAND = 1 + JUMP_TICKS;
// it's high on ticks 4..8. p0 at x=0 faces it.
type V3 = [number, number, number];
const roller = (x = 0): Spawn => [[x, 1, 0], '+Y', '+X'];
const hopper = (x = 1): Spawn => [[x, 1, 0], '+Y', '+Z'];
const LAND = 1 + JUMP_TICKS;
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
/** Two rows (z = 0, 1), so a stomp along +Z has ground. */
const wide = (x0: number, x1: number): V3[] => [...row(x0, x1), ...row(x0, x1, 0, 1)];

/** p1 hops once at tick 1; p0 holds W from tick `from` (default 4: high) and lets go at `until`. Runs to LAND. */
function scene(w: World, { from = 4, until = Infinity } = {}): SimEvent[] {
  const events: SimEvent[] = [];
  setInput(w, 'p1', input({ jump: true }));
  events.push(...step(w));
  setInput(w, 'p1', input({}));
  while (w.tick < LAND) {
    if (w.tick + 1 === from) setInput(w, 'p0', input({ fwdHeld: true }));
    if (w.tick + 1 === until) setInput(w, 'p0', input({}));
    events.push(...step(w));
  }
  return events;
}

describe('roll under a high hop', () => {
  test('a roll into a high hopper passes under it and out the other side', () => {
    const w = makeWorld(row(0, 5), [roller(), hopper()]);
    const p0 = player(w), p1 = player(w, 'p1');
    setInput(w, 'p1', input({ jump: true }));
    step(w);
    run(w, 2);
    setInput(w, 'p0', input({ fwdHeld: true }));
    expect(step(w)).toEqual([]); // tick 4: high
    expect([p0.action, p0.to.cell, p1.action]).toEqual([Action.Roll, vec(1, 1, 0), Action.Hop]);
    run(w, 15); // to tick 19: rolled on to x=3
    expect(p0.pose.cell.x).toBeGreaterThanOrEqual(3);
    expect(p1.pose.cell).toEqual(vec(1, 1, 0));
  });

  test('a roll into a low hopper is a push', () => {
    const w = makeWorld(row(0, 5), [roller(), hopper()]);
    setInput(w, 'p1', input({ jump: true }));
    step(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    expect(of(step(w), 'push')).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p1' }]); // tick 2: low
    expect(player(w, 'p1').action).toBe(Action.Knocked);
  });

  test("stop under a hopper: stomped at its landing, bumped along the hopper's fwd", () => {
    const w = makeWorld(wide(0, 5), [roller(), hopper()]);
    const p0 = player(w), p1 = player(w, 'p1');
    const events = scene(w, { until: 5 }); // one roll in (ticks 4..9), then W released
    expect(of(events, 'stomp')).toEqual([{ type: 'stomp', attackerId: 'p1', victimId: 'p0' }]);
    expect([p0.action, p0.to.cell, p0.lastKnockedBy]).toEqual([Action.Knocked, vec(1, 1, 1), 'p1']);
    expect([p1.action, p1.pose.cell]).toEqual([Action.Idle, vec(1, 1, 0)]);
  });

  test('bump direction order: hopper fwd, then its left, right, back', () => {
    const left = makeWorld([...wide(0, 5), [1, 1, 1]], [roller(), hopper()]); // fwd +Z walled
    scene(left, { until: 5 });
    expect(player(left).to.cell).toEqual(vec(2, 1, 0)); // left of +Z (up +Y) is +X
    const right = makeWorld([...wide(0, 5), [1, 1, 1], [2, 1, 0]], [roller(), hopper()]); // and +X
    scene(right, { until: 5 });
    expect(player(right).to.cell).toEqual(vec(0, 1, 0)); // right is -X
    // Coming in from -Z, with +Z, +X and -X walled: bumped back the way it came.
    const back = makeWorld([...wide(0, 5), ...row(0, 5, 0, -1), [1, 1, 1], [2, 1, 0], [0, 1, 0]], [[[1, 1, -1], '+Y', '+Z'], hopper()]);
    scene(back, { until: 5 });
    expect(player(back).to.cell).toEqual(vec(1, 1, -1));
  });

  test('a ball passing through at the landing tick: the hopper hops again at once, without jump held', () => {
    const w = makeWorld(row(0, 5), [roller(), hopper()]);
    const p1 = player(w, 'p1');
    const events = scene(w); // W held: in at 4..9, out at 9..14
    expect(of(events, 'stomp')).toEqual([]);
    expect([p1.action, p1.startTick, p1.endTick, p1.jumpHeld]).toEqual([Action.Hop, LAND, LAND + JUMP_TICKS, false]);
    expect([player(w).action, player(w).to.cell]).toEqual([Action.Roll, vec(2, 1, 0)]);
  });

  test('two balls passing in sequence keep the hopper up; it lands once they are through', () => {
    const w = makeWorld(row(-1, 8), [roller(), hopper(), roller(-1)]);
    const p1 = player(w, 'p1');
    setInput(w, 'p2', input({ fwdHeld: true }));
    const events = scene(w); // p0 through first, p2 right behind it
    const starts = [p1.startTick];
    for (let i = 0; i < 30; i++) {
      events.push(...step(w));
      if (p1.action === Action.Hop && p1.startTick !== starts[starts.length - 1]) starts.push(p1.startTick);
    }
    expect(starts).toEqual([LAND, LAND + JUMP_TICKS]); // re-hopped for p0, then for p2
    expect(of(events, 'stomp')).toEqual([]);
    expect([p1.action, p1.pose.cell]).toEqual([Action.Idle, vec(1, 1, 0)]);
    expect(player(w, 'p2').pose.cell.x).toBeGreaterThan(1);
  });

  test('a forward jump at a high hopper is a stomp jump (not a landing on it); still high at the landing → clash', () => {
    const w = makeWorld(row(0, 5), [roller(), [[2, 1, 0], '+Y', '+Z']]);
    const p0 = player(w);
    setInput(w, 'p1', input({ jump: true, jumpHeld: true })); // keeps hopping: 1..11, 11..21
    step(w);
    run(w, 2);
    setInput(w, 'p0', input({ fwdHeld: true, jump: true })); // tick 4: p1 is high, its cell isn't reserved
    step(w);
    setInput(w, 'p0', input({}));
    expect([p0.action, p0.to.cell, p0.stompBump]).toEqual([Action.Jump, vec(2, 1, 0), vec(3, 1, 0)]);
    const events = run(w, 4 + JUMP_TICKS - w.tick); // lands at 14: p1's second hop is high
    expect(of(events, 'clash')).toEqual([{ type: 'clash', attackerId: 'p0', victimId: 'p1' }]);
    expect(p0.action).toBe(Action.Rebound);
  });

  test('a cradle line with a high hopper in it: the roller passes under, then strikes the line behind it', () => {
    const w = makeWorld(row(0, 6), [roller(), hopper(), [[2, 1, 0], '+Y', '+Z'], [[3, 1, 0], '+Y', '+Z']]);
    const events = scene(w); // p0 under p1 by tick 9, then strikes p2..p3
    expect(of(events, 'cradle')).toEqual([{ type: 'cradle', pusherId: 'p0', victimId: 'p3', length: 2 }]);
    expect(player(w, 'p3').to.cell).toEqual(vec(4, 1, 0));
    expect(player(w, 'p2').pose.cell).toEqual(vec(2, 1, 0));
  });

  test("a push toward a high hopper's cell: the hopper ends the line, the victim is knocked under it", () => {
    const w = makeWorld(wide(0, 5), [roller(), [[1, 1, 0], '+Y', '+Z'], [[2, 1, 0], '+Y', '+Z']]);
    setInput(w, 'p2', input({ jump: true }));
    step(w);
    run(w, 2);
    setInput(w, 'p0', input({ fwdHeld: true }));
    expect(of(step(w), 'push')).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p1' }]);
    expect(player(w, 'p1').to.cell).toEqual(vec(2, 1, 0));
  });

  test('push rules off: roll-under still works, but stopping under gives the MVP overlap (no stomp)', () => {
    const w = makeWorld(row(0, 5), [roller(), hopper()]);
    w.rules = { push: false };
    const events = scene(w, { until: 5 });
    expect(of(events, 'stomp')).toEqual([]);
    expect([player(w).action, player(w).pose.cell]).toEqual([Action.Idle, vec(1, 1, 0)]);
    expect([player(w, 'p1').action, player(w, 'p1').pose.cell]).toEqual([Action.Idle, vec(1, 1, 0)]);
    const through = makeWorld(row(0, 5), [roller(), hopper()]);
    through.rules = { push: false };
    scene(through);
    expect(player(through, 'p1').startTick).toBe(LAND); // passing: re-hop, as with push on
  });

  test('determinism: hoppers and rollers with random inputs replay identically', () => {
    const blocks = wide(0, 6);
    const spawns: Spawn[] = [roller(), hopper(), [[3, 1, 1], '+Y', '-X'], [[5, 1, 0], '+Y', '-X']];
    const runOnce = () => {
      const w = createWorld(loadLevel(levelJson(blocks, spawns)), 7);
      w.spawnOrder = [0, 1, 2, 3];
      spawns.forEach((_, i) => addPlayer(w, `p${i}`, `p${i}`));
      const rnd = mulberry32(99);
      let stomps = 0;
      for (let t = 0; t < 600; t++) {
        for (const p of w.players) {
          const r = rnd();
          if (r < 0.15) setInput(w, p.id, input({ jump: r < 0.1, jumpHeld: r < 0.05 }));
          else if (r < 0.3) setInput(w, p.id, input({ fwdHeld: r < 0.25, turn: r < 0.2 ? 1 : -1 }));
        }
        stomps += of(step(w), 'stomp').length;
      }
      return { state: serialize(w), stomps };
    };
    expect(runOnce()).toEqual(runOnce());
  });
});
