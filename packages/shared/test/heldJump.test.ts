import { describe, expect, test } from 'vitest';
import { Action, JUMP_TICKS, ROLL_TICKS, setInput, step, TURN_TICKS, vec, type Input, type World } from '../src/index.ts';
import { input, makeWorld, player, row, type Spawn } from './util.ts';

const onRow = (): Spawn => [[0, 1, 0], '+Y', '+X'];
const world = () => makeWorld(row(0, 9), [onRow()]);
const send = (w: World, i: Partial<Input>) => setInput(w, 'p0', input(i));

/** Steps n ticks and returns every action start as [tick, action, to.x]. */
function starts(w: World, n: number): [number, number, number][] {
  const p = player(w);
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    step(w);
    if (p.startTick === w.tick && p.action !== Action.Idle) out.push([w.tick, p.action, p.to.cell.x]);
  }
  return out;
}

describe('held jump', () => {
  test('jumpHeld without fwd: exactly 3 hops back-to-back on the same cell, no idle tick', () => {
    const w = world();
    const p = player(w);
    send(w, { jump: true, jumpHeld: true });
    const seen: number[] = [];
    for (let i = 0; i < 3 * JUMP_TICKS; i++) { step(w); seen.push(p.action); }
    expect(seen.every((a) => a === Action.Hop)).toBe(true);
    const w2 = world();
    send(w2, { jump: true, jumpHeld: true });
    expect(starts(w2, 3 * JUMP_TICKS)).toEqual([[1, Action.Hop, 0], [11, Action.Hop, 0], [21, Action.Hop, 0]]);
  });

  test('jumpHeld + fwdHeld: consecutive forward jumps', () => {
    const w = world();
    send(w, { jump: true, jumpHeld: true, fwdHeld: true });
    expect(starts(w, 2 * JUMP_TICKS)).toEqual([[1, Action.Jump, 2], [11, Action.Jump, 4]]);
  });

  test('a tap (jumpHeld false by the next input) gives exactly one hop', () => {
    const w = world();
    send(w, { jump: true, jumpHeld: true });
    send(w, { jumpHeld: false });
    expect(starts(w, 3 * JUMP_TICKS)).toEqual([[1, Action.Hop, 0]]);
  });
});

describe('forward latch', () => {
  test('fwd pressed and released during a hop → forward jump on landing', () => {
    const w = world();
    send(w, { jump: true, jumpHeld: true });
    step(w);
    send(w, { jumpHeld: false }); // let go of jump mid-hop
    step(w);
    send(w, { fwdHeld: true });
    step(w);
    send(w, { fwdHeld: false });
    const s = starts(w, 2 * JUMP_TICKS);
    expect(s[0]).toEqual([1 + JUMP_TICKS, Action.Jump, 2]);
    expect(s).toHaveLength(1); // then idle
  });

  test('fwd pressed and held while jump is released → forward jump on landing, then rolls', () => {
    const w = world();
    send(w, { jump: true, jumpHeld: true });
    step(w);
    send(w, { fwdHeld: true, jumpHeld: false });
    expect(starts(w, 2 * JUMP_TICKS)).toEqual([[1 + JUMP_TICKS, Action.Jump, 2], [1 + 2 * JUMP_TICKS, Action.Roll, 3]]);
  });

  test('fwd pressed during a forward Jump does not latch', () => {
    const released = world();
    send(released, { jump: true, fwdHeld: true });
    step(released);
    send(released, { fwdHeld: false });
    step(released);
    send(released, { fwdHeld: true }); // rising edge mid-Jump
    step(released);
    send(released, { fwdHeld: false });
    expect(starts(released, 2 * JUMP_TICKS)).toEqual([]); // lands and stays Idle
    expect(player(released).fwdLatch).toBe(false);

    const held = world();
    send(held, { jump: true, fwdHeld: true });
    step(held);
    send(held, { fwdHeld: false });
    step(held);
    send(held, { fwdHeld: true }); // still held at landing → roll
    expect(starts(held, JUMP_TICKS)).toEqual([[1 + JUMP_TICKS, Action.Roll, 3]]);
  });
});
