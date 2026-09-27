import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, CHAIN_MAX, createWorld, loadLevel, mulberry32, Predictor, setInput, step, STRIKE_TICKS, STUN_TICKS, vec,
  type PlayerState, type ServerPlayer, type SimEvent, type World,
} from '../src/index.ts';
import { input, levelJson, makeWorld, player, row, run, serialize, type Spawn } from './util.ts';

// Cradle push (ARCHITECTURE §14, phase 12b): p0 at x=0 strikes +X into a line of balls at x=1, 2, ...
type V3 = [number, number, number];
const pusher = (): Spawn => [[0, 1, 0], '+Y', '+X'];
const ball = (x: number): Spawn => [[x, 1, 0], '+Y', '+Z'];
const line = (n: number) => Array.from({ length: n }, (_, i) => ball(i + 1));
const push = (w: World) => { setInput(w, 'p0', input({ fwdHeld: true })); const e = step(w); setInput(w, 'p0', input({})); return e; };
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
const stun = (w: World, id: string, bounce: boolean) =>
  Object.assign(player(w, id), { action: Action.Stunned, bounce, startTick: w.tick, endTick: w.tick + STUN_TICKS });
/** With a second row at z=1, so balls facing +Z can roll away. */
const wide = (x1: number): V3[] => [...row(0, x1), ...row(0, x1, 0, 1)];

function chainOffWorld(blocks: V3[], spawns: Spawn[]): World {
  const w = createWorld(loadLevel(levelJson(blocks, spawns)), 1, { push: true, chain: false });
  w.spawnOrder = spawns.map((_, i) => i);
  spawns.forEach((_, i) => addPlayer(w, `p${i}`, `p${i}`));
  return w;
}

describe('cradle push', () => {
  test.each([2, 3, CHAIN_MAX])('a line of %i: only the last ball moves; the pusher strikes in place, then Idle', (n) => {
    const w = makeWorld(row(0, n + 4), [pusher(), ...line(n)]);
    const last = player(w, `p${n}`);
    expect(push(w)).toEqual([{ type: 'cradle', pusherId: 'p0', victimId: last.id, length: n }]);
    expect([last.action, last.to.cell]).toEqual([Action.Knocked, vec(n + 1, 1, 0)]);
    const middle = w.players.slice(1, n);
    for (const q of middle) expect(q.action).toBe(Action.Idle);
    const p0 = player(w);
    expect([p0.action, p0.to.cell, p0.endTick - p0.startTick]).toEqual([Action.Strike, vec(0, 1, 0), STRIKE_TICKS]);
    run(w, STRIKE_TICKS);
    expect([p0.action, p0.pose.cell]).toEqual([Action.Idle, vec(0, 1, 0)]);
    middle.forEach((q, i) => expect(q.pose.cell).toEqual(vec(i + 1, 1, 0)));
  });

  test('the last ball flies off the edge: death, knockout credit to the pusher', () => {
    const w = makeWorld(row(0, 3), [pusher(), ...line(3)]);
    const events = push(w);
    const p3 = player(w, 'p3');
    for (let i = 0; i < 100 && p3.action !== Action.Dead; i++) events.push(...step(w));
    expect(p3.action).toBe(Action.Dead);
    expect(of(events, 'knockout')).toEqual([{ type: 'knockout', pusherId: 'p0', victimId: 'p3' }]);
    expect(player(w, 'p1').lastKnockedBy).toBeNull();
  });

  test('the last ball is blocked by a wall, or by a ball past CHAIN_MAX (a line of 7) → the pusher bounces', () => {
    const wall = makeWorld([...row(0, 6), [3, 1, 0]], [pusher(), ...line(2)]);
    expect(push(wall)).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    const seven = makeWorld(row(0, 10), [pusher(), ...line(CHAIN_MAX + 1)]);
    expect(push(seven)).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    for (const p of seven.players.slice(1)) expect(p.action).toBe(Action.Idle);
  });

  test('the cell after the last ball reserved by a rolling player → bounce', () => {
    const w = makeWorld([...row(0, 6), [3, 0, 1]], [pusher(), ...line(2), [[3, 1, 1], '+Y', '-Z']]);
    setInput(w, 'p3', input({ fwdHeld: true }));
    step(w);
    setInput(w, 'p3', input({}));
    expect([player(w, 'p3').action, player(w, 'p3').to.cell]).toEqual([Action.Roll, vec(3, 1, 0)]);
    expect(push(w)).toEqual([{ type: 'bounce', playerId: 'p0' }]);
  });

  test('the last ball is high in a hop: it ends the line, so the ball before it is pushed under it (§14 roll under)', () => {
    const hop = makeWorld(row(0, 6), [pusher(), ...line(2)]);
    setInput(hop, 'p2', input({ jumpHeld: true }));
    run(hop, 4); // high in its hop
    expect(player(hop, 'p2').action).toBe(Action.Hop);
    expect(push(hop)).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p1' }]);
    expect([player(hop, 'p1').action, player(hop, 'p1').to.cell]).toEqual([Action.Knocked, vec(2, 1, 0)]);
  });

  test('the last ball is staggered → bounce', () => {
    const stagger = makeWorld(row(0, 6), [pusher(), ...line(2)]);
    stun(stagger, 'p2', false);
    expect(push(stagger)).toEqual([{ type: 'bounce', playerId: 'p0' }]);
  });

  test('a middle ball is moving → the pusher is blocked, no stun', () => {
    const w = makeWorld(wide(6), [pusher(), ...line(3)]);
    setInput(w, 'p2', input({ fwdHeld: true })); // faces +Z: rolls away
    step(w);
    setInput(w, 'p2', input({}));
    expect(player(w, 'p2').action).toBe(Action.Roll);
    expect(push(w)).toEqual([]);
    expect(player(w).action).toBe(Action.Idle);
  });

  test('a middle ball escapes on the same tick: the line breaks, the pusher is blocked', () => {
    const w = makeWorld(wide(6), [pusher(), ...line(3)]);
    setInput(w, 'p2', input({ fwdHeld: true }));
    expect(push(w)).toEqual([]);
    expect([player(w).action, player(w, 'p2').action, player(w, 'p3').action]).toEqual([Action.Idle, Action.Roll, Action.Idle]);
  });

  test('the last ball escapes on the same tick → bounce', () => {
    const w = makeWorld(wide(6), [pusher(), ...line(2)]);
    setInput(w, 'p2', input({ fwdHeld: true }));
    expect(push(w)).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    expect(player(w, 'p2').action).toBe(Action.Roll);
  });

  test.each([['staggered', false], ['bounce-stunned', true]] as const)('a %s middle ball still transmits', (_, bounce) => {
    for (const mid of ['p1', 'p2']) {
      const w = makeWorld(row(0, 8), [pusher(), ...line(3)]);
      stun(w, mid, bounce);
      expect(push(w)).toEqual([{ type: 'cradle', pusherId: 'p0', victimId: 'p3', length: 3 }]);
      expect(player(w, mid).action).toBe(Action.Stunned);
    }
  });

  test('a single victim is the normal push: the pusher rolls in', () => {
    const w = makeWorld(row(0, 6), [pusher(), ball(1)]);
    expect(push(w)).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p1' }]);
    expect([player(w).action, player(w).to.cell]).toEqual([Action.Roll, vec(1, 1, 0)]);
  });

  test('rules.chain false: a ball behind the victim bounces the pusher (phase 11)', () => {
    const w = chainOffWorld(row(0, 6), [pusher(), ...line(2)]);
    expect(push(w)).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    expect(player(w, 'p2').action).toBe(Action.Idle);
  });

  test('the predictor defers a strike into a line to the server', () => {
    const spawns = [pusher(), ...line(2)];
    const w = makeWorld(row(0, 8), spawns);
    const toServer = (p: PlayerState): ServerPlayer => ({
      action: p.action, pose: p.pose, to: p.pose, startTick: 0, endTick: 0, turnFromFwd: p.turnFromFwd, turnStartTick: 0, bounce: false, protectedUntil: 0,
    });
    const pred = new Predictor(w.level, 'p0');
    pred.reset(0, toServer(player(w)));
    pred.setOthers(w.players.slice(1).map((p) => ({ id: p.id, ...toServer(p) })));
    pred.input(input({ seq: 1, fwdHeld: true }), 1);
    pred.advanceTo(5);
    expect(pred.deferrals).toBeGreaterThan(0);
    expect(pred.local.pose.cell).toEqual(vec(0, 1, 0));
  });

  test('determinism with cradles (5 players on a beam, random inputs, 2000 ticks)', () => {
    const runOnce = () => {
      const w = makeWorld(row(0, 9), [pusher(), ball(1), ball(2), ball(3), [[9, 1, 0], '+Y', '-X']], { heat: false });
      const rnd = mulberry32(3);
      let cradles = 0;
      for (let t = 0; t < 2000; t++) {
        for (const p of w.players) if (rnd() < 0.2) setInput(w, p.id, input({ fwdHeld: rnd() < 0.6, jump: rnd() < 0.05, turn: rnd() < 0.15 ? (rnd() < 0.5 ? -1 : 1) : 0 }));
        cradles += of(step(w), 'cradle').length;
      }
      return { state: serialize(w), cradles };
    };
    const a = runOnce();
    expect(a.cradles).toBeGreaterThan(0);
    expect(a).toEqual(runOnce());
  });
});
