import { describe, expect, test } from 'vitest';
import { Action, Dir, InputQueue, opposite, setInput, step, type Input, type World } from '../src/index.ts';
import { input, makeWorld, player, row, run, ROLL_TICKS, TURN_TICKS } from './util.ts';

/** Turn around (19c, §25): S/↓, pad ▼, Stick S and a double tap send two turn pulses; both must be kept. */
describe('turn around: a second turn pulse queues behind the first', () => {
  /** Inputs through the server's queue (pulses land on separate ticks), stepping `ticks`. */
  function feed(w: World, q: InputQueue, msgs: Partial<Input>[], ticks: number): void {
    for (const m of msgs) q.push(input(m), undefined, w.tick);
    for (let i = 0; i < ticks; i++) {
      for (const inp of q.due(w.tick + 1)) setInput(w, 'p0', inp);
      step(w);
    }
  }

  test('from rest: two quick lefts make 180°', () => {
    const w = makeWorld(row(-5, 5), [[[0, 1, 0], '+Y', '+X']]);
    feed(w, new InputQueue(), [{ turn: -1 }, { turn: -1 }], 3 * TURN_TICKS);
    expect(player(w).pose.fwd).toBe(opposite(Dir.PX));
    expect(player(w).action).toBe(Action.Idle);
  });

  test('while rolling: both pulses wait for the roll, then 180°, and forward carries on the other way', () => {
    const w = makeWorld(row(-8, 8), [[[0, 1, 0], '+Y', '+X']]);
    const q = new InputQueue(), p = player(w);
    feed(w, q, [{ fwdHeld: true }], 1);
    expect(p.action).toBe(Action.Roll);
    feed(w, q, [{ fwdHeld: true, turn: 1 }, { fwdHeld: true, turn: 1 }], ROLL_TICKS + 2 * TURN_TICKS);
    expect(p.pose.fwd).toBe(Dir.NX);
    expect(p.action).toBe(Action.Roll);
    expect(p.to.cell.x).toBe(p.pose.cell.x - 1);
  });

  test('two pulses set in the same tick (single player calls setInput directly) still make 180°', () => {
    const w = makeWorld(row(-5, 5), [[[0, 1, 0], '+Y', '+X']]);
    setInput(w, 'p0', input({ turn: -1 }));
    setInput(w, 'p0', input({ turn: -1 }));
    run(w, 3 * TURN_TICKS);
    expect(player(w).pose.fwd).toBe(opposite(Dir.PX));
  });

  test('opposite turns still replace (the latest wins), and a third same-side pulse is not stacked', () => {
    const w = makeWorld(row(-5, 5), [[[0, 1, 0], '+Y', '+X']]);
    const p = player(w);
    feed(w, new InputQueue(), [{ fwdHeld: true }], 1);
    for (const t of [-1, 1] as const) setInput(w, 'p0', input({ fwdHeld: true, turn: t }));
    expect([p.pulse, p.pulseNext]).toEqual(['right', null]);
    for (let i = 0; i < 3; i++) setInput(w, 'p0', input({ fwdHeld: true, turn: 1 }));
    expect([p.pulse, p.pulseNext]).toEqual(['right', 'right']);
  });
});
