import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, createWorld, InputQueue, InputSchedule, loadLevel, mulberry32, Predictor, setInput, step, type TimingName,
  type Input, type PlayerState, type ServerPlayer, type TileJson, type World,
} from '../src/index.ts';
import { levelJson, makeWorld, readLevelJson, row, type Spawn } from './util.ts';

const toServer = (p: PlayerState): ServerPlayer => ({
  action: p.action, pose: p.pose, to: p.action === Action.Idle ? p.pose : p.to, startTick: p.startTick, endTick: p.endTick,
  turnFromFwd: p.turnFromFwd, turnStartTick: p.turnStartTick, bounce: p.bounce, protectedUntil: p.protectedUntil, effects: p.effects,
});

/**
 * A server world and a predicting client for player `me`. The client runs LEAD ticks ahead; its inputs reach the
 * server `delay` ticks after they're sent; each server tick the client reconciles against the server's state.
 */
class Harness {
  readonly queue = new InputQueue();
  readonly pred: Predictor;
  readonly results: string[] = [];
  private inflight: { at: number; input: Input; stamp: number }[] = [];
  private ack = { seq: -1, tick: -1 };
  private seq = 0;

  constructor(readonly server: World, readonly me = 'me', readonly lead = 3) {
    this.pred = new Predictor(server.level, me, server.rules.timing);
    this.pred.reset(server.tick, toServer(this.local));
    this.pred.advanceTo(server.tick + lead);
  }

  get local(): PlayerState { return this.server.players.find((p) => p.id === this.me)!; }

  /** The client presses something now (at its predicted tick); it reaches the server after `delay` server ticks. */
  send(i: Partial<Input>, delay = 1): void {
    const input: Input = { seq: ++this.seq, fwdHeld: false, turn: 0, jump: false, jumpHeld: false, ...i };
    const stamp = this.pred.input(input, this.pred.tick + 1);
    this.inflight.push({ at: this.server.tick + delay, input, stamp });
  }

  /** One server tick: deliver arrived inputs, apply the due ones, step, then the client catches up and reconciles. */
  tick(): void {
    const s = this.server;
    for (const m of this.inflight.filter((m) => m.at <= s.tick)) this.queue.push(m.input, m.stamp, s.tick);
    this.inflight = this.inflight.filter((m) => m.at > s.tick);
    for (const input of this.queue.due(s.tick + 1)) {
      setInput(s, this.me, input);
      this.ack = { seq: input.seq, tick: s.tick + 1 };
    }
    step(s);
    // Crumbled blocks and collected keys: the latest server view, as the client syncs them (race-01 crumbles from 75 s).
    this.pred.setWorld(s.removed, new Set(s.keys.filter((k) => k.collected).map((k) => k.id)), s.crumbling, undefined, s.pickups);
    this.pred.advanceTo(s.tick + this.lead);
    this.results.push(this.pred.reconcile(s.tick, toServer(this.local), this.ack));
  }

  run(ticks: number): void { for (let i = 0; i < ticks; i++) this.tick(); }
}

function soloWorld(file: string, seed = 7, timing: TimingName = 'classic'): World {
  const w = createWorld(loadLevel(readLevelJson(file)), seed, { push: true, timing });
  addPlayer(w, 'me', 'me');
  return w;
}

const rowLevel = (spawns: Spawn[]) => loadLevel(levelJson(row(0, 12), spawns));

describe('input scheduling', () => {
  test('stamped tick in the future → exactly then; late → the next tick; never before an earlier input', () => {
    const q = new InputSchedule();
    const i = (x: Partial<Input> = {}): Input => ({ seq: 0, fwdHeld: true, turn: 0, jump: false, jumpHeld: false, ...x });
    expect(q.schedule(i(), 25, 10)).toBe(25);
    expect(q.schedule(i(), 12, 20)).toBe(25); // late, but not before the earlier input
    expect(new InputSchedule().schedule(i(), 12, 20)).toBe(21); // late: next tick
    expect(new InputSchedule().schedule(i(), undefined, 20)).toBe(21); // bots don't stamp
    expect(new InputSchedule().schedule(i(), 500, 20)).toBe(40); // far future: clamped, not dropped
  });

  test('a pulse never shares a tick with an earlier pulse (a jump is never overwritten)', () => {
    const q = new InputSchedule();
    const i = (x: Partial<Input>): Input => ({ seq: 0, fwdHeld: false, turn: 0, jump: false, jumpHeld: false, ...x });
    expect(q.schedule(i({ jump: true }), 30, 10)).toBe(30);
    expect(q.schedule(i({ fwdHeld: true }), 30, 10)).toBe(30); // held state may share the tick
    expect(q.schedule(i({ turn: 1 }), 30, 10)).toBe(31);
  });

  test('the server applies a queued input exactly on its tick', () => {
    const w = createWorld(rowLevel([[[0, 1, 0], '+Y', '+X']]), 1);
    const p = addPlayer(w, 'p', 'p');
    const q = new InputQueue();
    q.push({ seq: 1, fwdHeld: true, turn: 0, jump: false, jumpHeld: false }, 5, w.tick);
    for (let t = 1; t <= 5; t++) {
      for (const input of q.due(w.tick + 1)) setInput(w, 'p', input);
      step(w);
    }
    expect([p.action, p.startTick]).toEqual([Action.Roll, 5]);
  });
});

describe('predictor', () => {
  test.each(['classic', 'snappy'] as const)('determinism (%s timing): the server and a predictor fed the same inputs agree for 2000 ticks', (timing) => {
    const h = new Harness(soloWorld('race-01.json', 7, timing));
    const rnd = mulberry32(99);
    for (let t = 0; t < 2000; t++) {
      if (rnd() < 0.15) h.send({ fwdHeld: rnd() < 0.6, turn: rnd() < 0.2 ? (rnd() < 0.5 ? -1 : 1) : 0, jump: rnd() < 0.15, jumpHeld: rnd() < 0.1 });
      h.tick();
    }
    // Deaths pause prediction (respawns are the server's), so 'paused' ticks are expected; nothing else may differ.
    expect(h.results.filter((r) => r !== 'match' && r !== 'paused')).toEqual([]);
    expect(h.results.filter((r) => r === 'match').length).toBeGreaterThan(1400); // the rest: paused while dead
    expect(h.pred.mispredictions).toBe(0);
  });

  test('a jump shortened by a player the client did not know about: one misprediction, then it converges', () => {
    const w = createWorld(rowLevel([[[0, 1, 0], '+Y', '+X'], [[2, 1, 0], '+Y', '+X']]), 1, { push: false });
    w.spawnOrder = [0, 1];
    addPlayer(w, 'me', 'me');
    addPlayer(w, 'other', 'other'); // on A2, push off: no stomp, so the jump is cut short to A1
    const h = new Harness(w);
    h.run(2);
    h.send({ fwdHeld: true, jump: true });
    h.run(4);
    h.send({});
    h.run(40);
    expect(h.pred.mispredictions).toBe(1);
    expect(h.results.slice(-20).every((r) => r === 'match')).toBe(true);
    expect(h.local.pose.cell).toEqual({ x: 1, y: 1, z: 0 }); // short jump
    expect(h.pred.local.pose).toEqual(h.local.pose);
  });

  test('re-simulation replays held fwd, pulses and jumpHeld across a correction (a late input)', () => {
    const h = new Harness(soloWorld('test-flat.json'));
    h.run(2);
    h.send({ fwdHeld: true });
    h.run(7);
    h.send({ turn: 1 }, 5); // stop and turn; arrives 5 ticks late, so the server applies it later than predicted
    h.run(3);
    h.send({ jump: true }); // hop in place
    h.run(6);
    h.send({ jumpHeld: true }); // keep bouncing
    h.run(25);
    h.send({ turn: -1 });
    h.run(3);
    h.send({});
    h.run(40);
    expect(h.results).not.toContain('paused'); // stayed on the platform the whole time
    expect(h.pred.mispredictions).toBeGreaterThanOrEqual(1);
    expect(h.pred.mispredictions).toBeLessThanOrEqual(2); // the early guess, and the late arrival once acked
    expect(h.results.slice(-30).every((r) => r === 'match')).toBe(true);
    expect(h.pred.local.pose).toEqual(h.local.pose);
    expect([h.pred.local.fwdHeld, h.pred.local.jumpHeld]).toEqual([false, false]);
  });

  test('a move toward another player is deferred to the server, not predicted', () => {
    const w = createWorld(rowLevel([[[0, 1, 0], '+Y', '+X'], [[2, 1, 0], '+Y', '+X']]), 1, { push: false });
    w.spawnOrder = [0, 1];
    addPlayer(w, 'me', 'me');
    const other = addPlayer(w, 'other', 'other');
    const h = new Harness(w);
    h.pred.setOthers([{ id: 'other', ...toServer(other) }]);
    h.send({ fwdHeld: true }); // roll to x=1, then x=2 is taken: blocked on both sides
    h.run(30);
    expect(h.pred.local.pose.cell.x).toBe(1);
    expect(h.pred.deferrals).toBeGreaterThan(0);
    expect(h.pred.mispredictions).toBe(0);
  });

  test('an input the server never acks (dropped) does not hold back the ones after it', () => {
    const h = new Harness(soloWorld('test-flat.json'));
    h.pred.unackedInput({ seq: 0, fwdHeld: false, turn: 1, jump: false, jumpHeld: false }); // e.g. sent during the countdown
    h.run(2);
    h.send({ fwdHeld: true });
    h.run(8);
    h.send({});
    h.run(30);
    expect(h.results.slice(-20).every((r) => r === 'match')).toBe(true);
    expect(h.pred.local.pose).toEqual(h.local.pose);
  });

  test('a jump with a player on A1 or L is not predicted (§16, §17): deferred to the server', () => {
    for (const x of [1, 2]) { // over the player, and onto it
      const w = createWorld(rowLevel([[[0, 1, 0], '+Y', '+X'], [[x, 1, 0], '+Y', '+X']]), 1);
      w.spawnOrder = [0, 1];
      addPlayer(w, 'me', 'me');
      const other = addPlayer(w, 'other', 'other');
      const h = new Harness(w);
      h.pred.setOthers([{ id: 'other', ...toServer(other) }]);
      h.run(1);
      h.send({ fwdHeld: true, jump: true });
      h.run(4);
      h.send({});
      h.run(30);
      expect(h.pred.deferrals).toBeGreaterThan(0);
      expect(h.pred.mispredictions).toBe(0);
      expect(h.results).toContain('deferred'); // the server jumped; the client waited for it
    }
  });

  test('jump grace (W, then Space a tick later) is predicted exactly: no misprediction', () => {
    const h = new Harness(soloWorld('test-flat.json'));
    h.run(2);
    for (let i = 0; i < 6; i++) {
      h.send({ fwdHeld: true });
      h.run(1);
      h.send({ fwdHeld: true, jump: true });
      h.run(1);
      h.send({});
      h.run(14);
      h.send({ turn: 1 });
      h.run(4);
    }
    expect(h.pred.mispredictions).toBe(0);
    expect(h.results.filter((r) => r !== 'match' && r !== 'paused')).toEqual([]);
  });

  test('a climb (rolling into a wall, then up and over it) is predicted exactly', () => {
    const w = createWorld(loadLevel(levelJson([...row(0, 8), [4, 1, 0], [4, 2, 0]], [[[1, 1, 0], '+Y', '+X'], [[7, 1, 0], '+Y', '-X'], [[0, 1, 0], '+Y', '+X'], [[8, 1, 0], '+Y', '-X']])), 1);
    w.spawnOrder = [0, 1, 2, 3];
    addPlayer(w, 'me', 'me');
    const h = new Harness(w);
    h.run(2);
    h.send({ fwdHeld: true });
    h.run(40);
    h.send({});
    h.run(20);
    expect(h.local.pose.cell.x).toBeGreaterThan(4); // went over the wall
    expect(h.pred.mispredictions).toBe(0);
    expect(h.results.filter((r) => r !== 'match' && r !== 'paused')).toEqual([]);
  });

  test('a move near another player that does not involve it is predicted, not deferred (phase 11)', () => {
    // 14d: facing sideways (+Z); one facing x=1 could start into it on the same tick (a head-on), so that's deferred.
    const w = createWorld(rowLevel([[[0, 1, 0], '+Y', '+X'], [[2, 1, 0], '+Y', '+Z']]), 1);
    w.spawnOrder = [0, 1];
    addPlayer(w, 'me', 'me');
    const other = addPlayer(w, 'other', 'other');
    const h = new Harness(w);
    h.pred.setOthers([{ id: 'other', ...toServer(other) }]);
    h.send({ fwdHeld: true }); // one roll to x=1: the ball on x=2 is 1 cell past the target, not in the way
    h.run(2);
    h.send({});
    h.run(10);
    expect(h.local.pose.cell.x).toBe(1);
    expect(h.pred.deferrals).toBe(0);
    expect(h.pred.mispredictions).toBe(0);
  });
});


test('traps (§18): an ice slide into a boost, predicted solo with no mispredictions', () => {
  const tiles = [1, 2, 3].map((x) => ({ block: [x, 0, 0] as [number, number, number], type: 'ice' as const }));
  const w = makeWorld(row(0, 12), [[[0, 1, 0], '+Y', '+X']], {
    heat: false, tiles: [...tiles, { block: [4, 0, 0], face: '+Y', type: 'boost', dir: '+X' }, { block: [9, 0, 0], type: 'crumble' }],
  });
  const h = new Harness(w, 'p0');
  h.send({ fwdHeld: true });
  h.run(3);
  h.send({});
  h.run(60);
  expect(w.players[0].pose.cell).toEqual({ x: 7, y: 1, z: 0 });
  h.send({ fwdHeld: true });
  h.run(30);
  h.send({});
  h.run(40);
  expect(w.players[0].pose.cell.x).toBeGreaterThan(9);
  expect(w.removed.has('9,0,0')).toBe(true);
  expect(h.pred.mispredictions).toBe(0);
  expect(h.results).not.toContain('mispredict');
});

describe('boost pads (phase 14c): prediction', () => {
  const padWorld = (spawns: Spawn[]) => {
    const blocks: [number, number, number][] = [...row(0, 12, 0, -1), ...row(0, 12), ...row(0, 12, 0, 1)];
    const w = makeWorld(blocks, spawns, { heat: false, tiles: [{ block: [3, 0, 0], face: '+Y', type: 'boost', dir: '+X' }] });
    return w;
  };

  test('a solo launch from a side entry is predicted with no mispredictions', () => {
    const w = padWorld([[[3, 1, 1], '+Y', '-Z']]);
    const h = new Harness(w, 'p0');
    h.send({ fwdHeld: true });
    h.run(2);
    h.send({});
    h.run(40);
    expect(w.players[0].pose.cell).toEqual({ x: 6, y: 1, z: 0 });
    expect(h.pred.mispredictions).toBe(0);
    expect(h.results).not.toContain('mispredict');
  });

  test('a launch with another player within 3 cells of the landing is left to the server (deferred)', () => {
    const w = padWorld([[[3, 1, 1], '+Y', '-Z'], [[7, 1, 1], '+Y', '-X']]); // 2 cells from the landing (6,1,0)
    const h = new Harness(w, 'p0');
    h.pred.setOthers([{ id: 'p1', ...toServer(w.players[1]) }]);
    h.send({ fwdHeld: true });
    h.run(2);
    h.send({});
    h.run(40);
    expect(w.players[0].pose.cell).toEqual({ x: 6, y: 1, z: 0 });
    expect(h.pred.deferrals).toBeGreaterThan(0);
    expect(h.pred.mispredictions).toBe(0);
  });
});

test('teleporters (phase 13b): a warp is predicted solo with no mispredictions', () => {
  const tiles: TileJson[] = [{ block: [3, 0, 0], face: '+Y', type: 'teleport', pair: 'A' }, { block: [12, 0, 5], face: '+Y', type: 'teleport', pair: 'A' }];
  const w = createWorld(loadLevel(levelJson([...row(0, 6), ...row(10, 14, 0, 5)], [[[1, 1, 0], '+Y', '+X']], { heat: false, tiles })), 1);
  addPlayer(w, 'me', 'me');
  const h = new Harness(w);
  h.send({ fwdHeld: true });
  h.run(8);
  h.send({});
  h.run(30);
  expect(w.players[0].pose.cell.z).toBe(5); // warped to the island
  expect(h.pred.mispredictions).toBe(0);
  expect(h.results).not.toContain('mispredict');
});

test.each(['lethargy', 'bouncy', 'heavy'] as const)('pills (phase 15a): taking %s and rolling on is predicted solo with no mispredictions', (type) => {
  const w = createWorld(loadLevel(levelJson(row(0, 40), [[[0, 1, 0], '+Y', '+X']], { heat: false, pickups: [{ cell: [1, 1, 0], up: '+Y', type }] })), 1);
  addPlayer(w, 'me', 'me');
  const h = new Harness(w);
  h.send({ fwdHeld: true });
  h.run(60);
  h.send({ fwdHeld: true, jump: true });
  h.run(20);
  h.send({ turn: 1 });
  h.run(10);
  expect(w.players[0].effects.map((e) => e.type)).toEqual([type]);
  expect(w.players[0].pose.cell.x).toBeGreaterThan(5);
  expect(h.pred.mispredictions).toBe(0);
});
