import { describe, expect, test } from 'vitest';
import {
  Action, Dir, mulberry32, Predictor, setInput, step, STUN_TICKS, vec,
  type PlayerState, type ServerPlayer, type SimEvent, type World,
} from '../src/index.ts';
import { input, makeWorld, player, row, serialize, type Spawn } from './util.ts';

// Edge push (ARCHITECTURE §14, phase 12c): a flip onto a ball standing on the face being flipped onto pushes it along
// the flipper's arrival direction. The block's +X side face is at x=4; its top at y=1.
type V3 = [number, number, number];
const top: Spawn = [[3, 1, 0], '+Y', '+X']; // flips over +X, down onto the side face
const side = (fwd: '+Y' | '+Z'): Spawn => [[4, 0, 0], '+X', fwd]; // on the side face, right below the edge
const plate = row(0, 3); // 1 high
const wall = [...row(0, 3), ...row(0, 3, -1)]; // 2 high
const press = (w: World, ...ids: string[]) => {
  for (const id of ids) setInput(w, id, input({ fwdHeld: true }));
  const e = step(w);
  for (const id of ids) setInput(w, id, input({}));
  return e;
};
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
const settle = (w: World) => { for (let i = 0; i < 40 && w.players.some((p) => p.action !== Action.Idle); i++) step(w); };

describe('edge push', () => {
  test('top → side: the victim is knocked down the side face, the flipper lands in T', () => {
    const w = makeWorld(wall, [top, side('+Z')]);
    expect(press(w, 'p0')).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p1', edge: true }]);
    const p0 = player(w), p1 = player(w, 'p1');
    expect([p0.action, p0.to]).toEqual([Action.Flip, { cell: vec(4, 0, 0), up: Dir.PX, fwd: Dir.NY }]);
    expect([p1.action, p1.to.cell, p1.to.up, p1.lastKnockedBy]).toEqual([Action.Knocked, vec(4, -1, 0), Dir.PX, 'p0']);
    settle(w);
    expect([p0.pose.cell, p1.pose.cell]).toEqual([vec(4, 0, 0), vec(4, -1, 0)]);
  });

  test('side → top: the victim is knocked across the top, away from the edge', () => {
    const w = makeWorld(plate, [side('+Y'), [[3, 1, 0], '+Y', '+Z']]);
    expect(press(w, 'p0')).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p1', edge: true }]);
    expect(player(w).to).toEqual({ cell: vec(3, 1, 0), up: Dir.PY, fwd: Dir.NX });
    expect([player(w, 'p1').action, player(w, 'p1').to.cell]).toEqual([Action.Knocked, vec(2, 1, 0)]);
  });

  test('the victim at the bottom of a 1-high side face is knocked off: falls along its own gravity, death, knockout credit', () => {
    const w = makeWorld(plate, [top, side('+Z')]);
    const events = press(w, 'p0');
    const p1 = player(w, 'p1');
    for (let i = 0; i < 200 && p1.action !== Action.Dead; i++) {
      if (p1.action === Action.Fall) expect([p1.to.up, p1.to.cell.x < p1.pose.cell.x]).toEqual([Dir.PX, true]); // falls toward −X
      events.push(...step(w));
    }
    expect(p1.action).toBe(Action.Dead);
    expect(of(events, 'knockout')).toEqual([{ type: 'knockout', pusherId: 'p0', victimId: 'p1' }]);
  });

  test('T + D blocked → the flipper bounces', () => {
    const w = makeWorld([...plate, [2, 1, 0]], [side('+Y'), [[3, 1, 0], '+Y', '+Z']]);
    expect(press(w, 'p0')).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    expect([player(w).action, player(w).bounce, player(w, 'p1').action]).toEqual([Action.Stunned, true, Action.Idle]);
  });

  test('a staggered victim blocks the flip, no stun', () => {
    const w = makeWorld(wall, [top, side('+Z')]);
    Object.assign(player(w, 'p1'), { action: Action.Stunned, bounce: false, startTick: w.tick, endTick: w.tick + STUN_TICKS });
    expect(press(w, 'p0')).toEqual([]);
    expect(player(w).action).toBe(Action.Idle);
  });

  test('a ball on the opposite face (the underside) is unaffected: a normal flip', () => {
    const w = makeWorld(plate, [top, [[3, -1, 0], '-Y', '+Z']]);
    expect(press(w, 'p0')).toEqual([]);
    expect([player(w).action, player(w).to.cell]).toEqual([Action.Flip, vec(4, 0, 0)]);
    expect(player(w, 'p1').action).toBe(Action.Idle);
  });

  test('mutual edge push (flipping into each other around the same edge) → both bounce', () => {
    const w = makeWorld(plate, [top, side('+Y')]);
    expect(press(w, 'p0', 'p1')).toEqual(expect.arrayContaining([{ type: 'bounce', playerId: 'p0' }, { type: 'bounce', playerId: 'p1' }]));
    expect([player(w).action, player(w, 'p1').action]).toEqual([Action.Stunned, Action.Stunned]);
  });

  test('escape precedence: a victim rolling away on the same tick blocks the flip, no stun', () => {
    const w = makeWorld([...wall, ...row(0, 3, 0, 1)], [top, side('+Z')]);
    expect(press(w, 'p0', 'p1')).toEqual([]);
    expect([player(w).action, player(w, 'p1').action]).toEqual([Action.Idle, Action.Roll]);
  });

  test('the predictor defers an edge push to the server', () => {
    const w = makeWorld(wall, [top, side('+Z')]);
    const toServer = (p: PlayerState): ServerPlayer => ({
      action: p.action, pose: p.pose, to: p.pose, startTick: 0, endTick: 0, turnFromFwd: p.turnFromFwd, turnStartTick: 0, bounce: false, protectedUntil: 0,
    });
    const pred = new Predictor(w.level, 'p0');
    pred.reset(0, toServer(player(w)));
    pred.setOthers([{ id: 'p1', ...toServer(player(w, 'p1')) }]);
    pred.input(input({ seq: 1, fwdHeld: true }), 1);
    pred.advanceTo(5);
    expect(pred.deferrals).toBeGreaterThan(0);
    expect(pred.local.pose.cell).toEqual(vec(3, 1, 0));
  });

  test('determinism with edge pushes (4 players on a 2×2×2 cube, random inputs, 3000 ticks)', () => {
    const cube: V3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const runOnce = () => {
      const w = makeWorld(cube, [[[0, 2, 0], '+Y', '+X'], [[2, 1, 1], '+X', '+Y'], [[1, -1, 0], '-Y', '-X'], [[0, 0, 2], '+Z', '+Y']], { heat: false });
      const rnd = mulberry32(7);
      let edges = 0;
      for (let t = 0; t < 3000; t++) {
        for (const p of w.players) if (rnd() < 0.2) setInput(w, p.id, input({ fwdHeld: rnd() < 0.7, turn: rnd() < 0.2 ? (rnd() < 0.5 ? -1 : 1) : 0 }));
        edges += of(step(w), 'push').filter((e) => e.edge).length;
      }
      return { state: serialize(w), edges };
    };
    const a = runOnce();
    expect(a.edges).toBeGreaterThan(0);
    expect(a).toEqual(runOnce());
  });
});
