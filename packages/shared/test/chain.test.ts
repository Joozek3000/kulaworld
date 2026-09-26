import { describe, expect, test } from 'vitest';
import { Action, mulberry32, setInput, step, STUN_TICKS, vec, type SimEvent, type World } from '../src/index.ts';
import { input, makeWorld, player, row, run, serialize, type Spawn } from './util.ts';

// Chain push (ARCHITECTURE §14, phase 12): p0 at x=0 pushes +X into a line of balls at x=1, 2, ...
const pusher = (): Spawn => [[0, 1, 0], '+Y', '+X'];
const KNOCK_AND_STUN = 20; // ticks: a knock (4) plus the stagger (6), with margin
const ball = (x: number, z = 0): Spawn => [[x, 1, z], '+Y', '+Z'];
const push = (w: World) => { setInput(w, 'p0', input({ fwdHeld: true })); const e = step(w); setInput(w, 'p0', input({})); return e; };
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

describe('chain push', () => {
  test('a line of 2 shifts one cell together; the pusher rolls into the first cell', () => {
    const w = makeWorld(row(0, 6), [pusher(), ball(1), ball(2)]);
    const events = push(w);
    expect(of(events, 'push').map((e) => e.victimId)).toEqual(['p1', 'p2']);
    expect([player(w, 'p1').action, player(w, 'p1').to.cell]).toEqual([Action.Knocked, vec(2, 1, 0)]);
    expect([player(w, 'p2').action, player(w, 'p2').to.cell]).toEqual([Action.Knocked, vec(3, 1, 0)]);
    expect([player(w).action, player(w).to.cell]).toEqual([Action.Roll, vec(1, 1, 0)]);
  });

  test('a line of 4 shifts', () => {
    const w = makeWorld(row(0, 8), [pusher(), ball(1), ball(2), ball(3), ball(4)]);
    push(w);
    for (const [id, x] of [['p1', 2], ['p2', 3], ['p3', 4], ['p4', 5]] as const) expect(player(w, id).to.cell).toEqual(vec(x, 1, 0));
  });

  test('the last ball goes off the edge and dies; everyone in the line credits the pusher', () => {
    const w = makeWorld(row(0, 3), [pusher(), ball(1), ball(2), ball(3)]);
    const events = push(w);
    for (const id of ['p1', 'p2', 'p3']) expect(player(w, id).lastKnockedBy).toBe('p0');
    const p3 = player(w, 'p3');
    for (let i = 0; i < 100 && p3.action !== Action.Dead; i++) events.push(...step(w));
    expect(p3.action).toBe(Action.Dead);
    expect(of(events, 'knockout')).toEqual([{ type: 'knockout', pusherId: 'p0', victimId: 'p3' }]);
    run(w, KNOCK_AND_STUN);
    expect(player(w, 'p1').pose.cell).toEqual(vec(2, 1, 0));
    expect(player(w, 'p2').pose.cell).toEqual(vec(3, 1, 0));
  });

  test('a line of 5: the 5th ball blocks the cell after the 4th → bounce', () => {
    const w = makeWorld(row(0, 9), [pusher(), ball(1), ball(2), ball(3), ball(4), ball(5)]);
    expect(push(w)).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    expect(player(w, 'p1').action).toBe(Action.Idle);
  });

  test('a wall after the line → bounce', () => {
    const w = makeWorld([...row(0, 6), [3, 1, 0]], [pusher(), ball(1), ball(2)]);
    expect(push(w)).toEqual([{ type: 'bounce', playerId: 'p0' }]);
  });

  test('a staggered ball in the line → bounce', () => {
    const w = makeWorld(row(0, 6), [pusher(), ball(1), ball(2)]);
    const p2 = player(w, 'p2');
    Object.assign(p2, { action: Action.Stunned, bounce: false, startTick: w.tick, endTick: w.tick + STUN_TICKS });
    expect(push(w)).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    expect(player(w, 'p1').action).toBe(Action.Idle);
  });

  test('a ball in the middle escapes on the same tick: the line breaks there, and the pusher bounces', () => {
    const w = makeWorld([...row(0, 6), ...row(0, 6, 0, 1)], [pusher(), ball(1), ball(2), ball(3)]);
    setInput(w, 'p2', input({ fwdHeld: true })); // p2 faces +Z and rolls away the same tick
    const events = push(w);
    expect(player(w, 'p2').action).toBe(Action.Roll);
    expect(of(events, 'bounce')).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    expect(player(w, 'p1').action).toBe(Action.Idle);
  });

  test('determinism with chain pushes (4 players on a plate, random inputs, 2000 ticks)', () => {
    const runOnce = () => {
      const plate: [number, number, number][] = [];
      for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) plate.push([x, 0, z]);
      const w = makeWorld(plate, [pusher(), ball(1), ball(2), [[5, 1, 5], '+Y', '-X']]);
      const rnd = mulberry32(3);
      let chains = 0;
      for (let t = 0; t < 2000; t++) {
        for (const p of w.players) if (rnd() < 0.2) setInput(w, p.id, input({ fwdHeld: rnd() < 0.6, jump: rnd() < 0.1, turn: rnd() < 0.25 ? (rnd() < 0.5 ? -1 : 1) : 0 }));
        const pushes = of(step(w), 'push');
        if (pushes.length > 1) chains++;
      }
      return { state: serialize(w), chains };
    };
    const a = runOnce(), b = runOnce();
    expect(a).toEqual(b);
  });
});

