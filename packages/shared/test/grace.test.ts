import { describe, expect, test } from 'vitest';
import { Action, JUMP_GRACE_TICKS, mulberry32, ROLL_TICKS, setInput, step, vec, type World } from '../src/index.ts';
import { input, makeWorld, player, row, run, serialize, type Spawn } from './util.ts';

// Jump grace (ARCHITECTURE §6): p0 at x=0 facing +X on a long row.
const start = (): Spawn => [[0, 1, 0], '+Y', '+X'];
const press = (w: World, i: Parameters<typeof input>[0]) => { setInput(w, 'p0', input(i)); step(w); };

describe('jump grace', () => {
  test('W, then Space 1 tick later: the roll becomes a standing forward jump from the origin cell', () => {
    const w = makeWorld(row(0, 8), [start()]);
    const p = player(w);
    press(w, { fwdHeld: true });
    expect([p.action, p.graceUntil]).toEqual([Action.Roll, w.tick + JUMP_GRACE_TICKS]);
    press(w, { fwdHeld: true, jump: true });
    expect(p.action).toBe(Action.Jump);
    expect([p.pose.cell, p.to.cell, p.startTick]).toEqual([vec(0, 1, 0), vec(2, 1, 0), w.tick]);
  });

  test('Space 2 ticks later is still inside the window', () => {
    const w = makeWorld(row(0, 8), [start()]);
    press(w, { fwdHeld: true });
    press(w, { fwdHeld: true });
    press(w, { fwdHeld: true, jump: true });
    expect([player(w).action, player(w).pose.cell]).toEqual([Action.Jump, vec(0, 1, 0)]);
  });

  test('Space 3 ticks later: the roll finishes, then the jump goes from the end of the tile', () => {
    const w = makeWorld(row(0, 8), [start()]);
    const p = player(w);
    press(w, { fwdHeld: true });
    run(w, 2);
    press(w, { fwdHeld: true, jump: true });
    expect(p.action).toBe(Action.Roll);
    setInput(w, 'p0', input({ fwdHeld: true }));
    while (p.action === Action.Roll) step(w);
    expect(p.action).toBe(Action.Jump);
    expect([p.pose.cell, p.to.cell]).toEqual([vec(1, 1, 0), vec(3, 1, 0)]);
  });

  test('a roll chained from a previous roll is never cancelled (Space mid-run jumps at the end of the tile)', () => {
    const w = makeWorld(row(0, 8), [start()]);
    const p = player(w);
    press(w, { fwdHeld: true });
    run(w, ROLL_TICKS); // the first roll ends and the next one chains on the same tick
    expect([p.action, p.pose.cell, p.graceUntil]).toEqual([Action.Roll, vec(1, 1, 0), -1]);
    press(w, { fwdHeld: true, jump: true });
    expect(p.action).toBe(Action.Roll);
    while (p.action === Action.Roll) step(w);
    expect([p.action, p.pose.cell]).toEqual([Action.Jump, vec(2, 1, 0)]);
  });

  test('the grace jump follows the normal rules: onto a ball 2 tiles ahead it is a stomp', () => {
    const w = makeWorld(row(0, 8), [start(), [[2, 1, 0], '+Y', '+Z']]);
    const p = player(w);
    press(w, { fwdHeld: true });
    expect(p.action).toBe(Action.Roll); // rolling toward x=1; the ball on x=2 isn't in the way yet
    press(w, { fwdHeld: true, jump: true });
    expect([p.action, p.to.cell, p.stompBump]).toEqual([Action.Jump, vec(2, 1, 0), vec(3, 1, 0)]);
    setInput(w, 'p0', input({}));
    const events = [];
    while (p.action === Action.Jump) events.push(...step(w));
    expect(events.filter((e) => e.type === 'stomp')).toHaveLength(1);
  });
});

test('determinism with grace jumps (W and Space close together), 2000 ticks', () => {
  const runOnce = () => {
    const plate: [number, number, number][] = [];
    for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) plate.push([x, 0, z]);
    const w = makeWorld(plate, [start(), [[5, 1, 5], '+Y', '-X'], [[0, 1, 5], '+Y', '+Z'], [[5, 1, 0], '+Y', '-Z']]);
    const rnd = mulberry32(7);
    let graceJumps = 0;
    for (let t = 0; t < 2000; t++) {
      for (const p of w.players) {
        const r = rnd();
        if (r < 0.05) setInput(w, p.id, input({ fwdHeld: true }));
        else if (r < 0.1) setInput(w, p.id, input({ fwdHeld: true, jump: true }));
        else if (r < 0.14) setInput(w, p.id, input({ turn: rnd() < 0.5 ? -1 : 1 }));
        else if (r < 0.17) setInput(w, p.id, input({}));
      }
      const before = new Map(w.players.map((p) => [p.id, { action: p.action, start: p.startTick }]));
      step(w);
      for (const p of w.players) {
        const b = before.get(p.id)!; // a roll that started 1-2 ticks ago became a jump: the grace rule fired
        if (b.action === Action.Roll && w.tick - b.start <= JUMP_GRACE_TICKS && p.action === Action.Jump && p.startTick === w.tick) graceJumps++;
      }
    }
    return { state: serialize(w), graceJumps };
  };
  const a = runOnce(), b = runOnce();
  expect(a.state).toBe(b.state);
  expect(a.graceJumps).toBeGreaterThan(0);
});
