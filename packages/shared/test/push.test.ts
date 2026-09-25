import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, createWorld, Dir, isPushable, JUMP_TICKS, KNOCK_TICKS, KNOCKOUT_CREDIT_TICKS, loadLevel, mulberry32,
  ROLL_TICKS, setInput, step, STUN_TICKS, TURN_TICKS, vec,
  type PlayerState, type SimEvent, type World,
} from '../src/index.ts';
import { input, makeWorld, player, readLevelJson, row, run, serialize, type Spawn } from './util.ts';

// p0 at x=0 facing +X, victim p1 right in front of it at x=1.
const pusher = (): Spawn => [[0, 1, 0], '+Y', '+X'];
const victim = (fwd: '+X' | '-X' | '+Z' = '+Z'): Spawn => [[1, 1, 0], '+Y', fwd];
const push = (w: World) => setInput(w, 'p0', input({ fwdHeld: true }));
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

/** Runs until `p` dies (at most `max` ticks) and returns all events. */
function runToDeath(w: World, p: PlayerState, max = 200): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < max && p.action !== Action.Dead; i++) events.push(...step(w));
  expect(p.action).toBe(Action.Dead);
  return events;
}

/** Gives p1 key 0 as if it had collected it. */
function holdKey(w: World) {
  const p1 = player(w, 'p1');
  w.keys[0].collected = true;
  p1.keys = 1;
  p1.keyIds = [0];
}

describe('push', () => {
  test('onto ground: victim Knocked one cell then Stunned; pusher rolls into its cell', () => {
    const w = makeWorld(row(0, 4), [pusher(), victim()]);
    const p0 = player(w), p1 = player(w, 'p1');
    push(w);
    expect(step(w)).toEqual([{ type: 'push', pusherId: 'p0', victimId: 'p1' }]);
    expect(p1.action).toBe(Action.Knocked);
    expect(p1.to).toEqual({ cell: vec(2, 1, 0), up: Dir.PY, fwd: Dir.PZ });
    expect(p1.endTick - p1.startTick).toBe(KNOCK_TICKS);
    expect(p1.lastKnockedBy).toBe('p0');
    expect(p0.action).toBe(Action.Roll);
    expect(p0.to.cell).toEqual(vec(1, 1, 0));
    setInput(w, 'p0', input({}));
    run(w, KNOCK_TICKS);
    expect(p1.action).toBe(Action.Stunned);
    expect(p1.bounce).toBe(false);
    expect(p1.pose.cell).toEqual(vec(2, 1, 0));
    run(w, STUN_TICKS);
    expect(p1.action).toBe(Action.Idle);
  });

  test('over an edge: victim falls; off the map it dies, drops its key back to its spot, knockout credited', () => {
    const w = makeWorld(row(0, 1), [pusher(), victim()], { keys: [{ cell: [0, 1, 0], up: '+Y' }], keysRequired: 1 });
    const p1 = player(w, 'p1');
    holdKey(w);
    push(w);
    step(w);
    setInput(w, 'p0', input({}));
    run(w, KNOCK_TICKS);
    expect(p1.action).toBe(Action.Fall);
    const events = runToDeath(w, p1);
    expect(of(events, 'keyDrop')).toEqual([{ type: 'keyDrop', playerId: 'p1', keyId: 0 }]);
    expect(of(events, 'knockout')).toEqual([{ type: 'knockout', pusherId: 'p0', victimId: 'p1' }]);
    expect(p1.keys).toBe(0);
    expect(w.keys[0]).toEqual({ id: 0, cell: vec(0, 1, 0), collected: false });
    expect(p1.lastKnockedBy).toBe(null);
  });

  test(`death more than ${KNOCKOUT_CREDIT_TICKS} ticks after the knock: no knockout credit`, () => {
    // A far-away low block stretches the kill box, so the fall lasts ~100 ticks.
    const w = makeWorld([...row(0, 1), [20, -40, 20]], [pusher(), victim()]);
    const p1 = player(w, 'p1');
    push(w);
    step(w);
    const knockTick = w.tick;
    const events = runToDeath(w, p1);
    expect(w.tick - knockTick).toBeGreaterThan(KNOCKOUT_CREDIT_TICKS);
    expect(of(events, 'death')).toHaveLength(1);
    expect(of(events, 'knockout')).toEqual([]);
  });

  test.each([
    ['a wall', [[2, 1, 0]], [pusher(), victim()]],
    ['another player', [], [pusher(), victim(), [[2, 1, 0], '+Y', '+Z']]],
  ] as const)('%s behind the victim: pusher Stunned with bounce, victim unchanged', (_, extra, spawns) => {
    const w = makeWorld([...row(0, 4), ...extra] as ReturnType<typeof row>, [...spawns] as Spawn[]);
    const p0 = player(w), p1 = player(w, 'p1');
    const before = structuredClone(p1);
    push(w);
    expect(step(w)).toEqual([{ type: 'bounce', playerId: 'p0' }]);
    expect(p0.action).toBe(Action.Stunned);
    expect(p0.bounce).toBe(true);
    expect(p0.endTick - p0.startTick).toBe(STUN_TICKS);
    expect(p0.pose.cell).toEqual(vec(0, 1, 0));
    expect(p1).toEqual(before);
    setInput(w, 'p0', input({})); // still holding W would bounce again
    run(w, STUN_TICKS);
    expect(p0.bounce).toBe(false);
  });

  test('victim on another face (different up): no push, just blocked', () => {
    // p1 stands on the -X face of the wall block at (2,1,0), in the cell p0 rolls towards.
    const w = makeWorld([...row(0, 4), [2, 1, 0]], [pusher(), [[1, 1, 0], '-X', '+Y']]);
    push(w);
    expect(run(w, 3)).toEqual([]);
    expect(player(w).action).toBe(Action.Idle);
    expect(player(w, 'p1').action).toBe(Action.Idle);
  });

  test('victim mid-hop (high): pusher blocked with no stun; holding W pushes once the hop is in its last 2 ticks', () => {
    const w = makeWorld(row(0, 4), [pusher(), victim()]);
    const p0 = player(w), p1 = player(w, 'p1');
    setInput(w, 'p1', input({ jump: true }));
    step(w); // hop from tick 1 to 1 + JUMP_TICKS
    run(w, 2); // past the low window
    push(w);
    let events: SimEvent[] = [];
    while (!events.length) {
      expect(p0.action).toBe(Action.Idle);
      expect(p1.action).toBe(Action.Hop);
      events = step(w);
    }
    expect(of(events, 'push')).toHaveLength(1);
    expect(w.tick).toBe(1 + JUMP_TICKS - 2);
    expect(p1.action).toBe(Action.Knocked);
  });

  test('victim hopping low (first 2 ticks): pushed, the hop is cancelled', () => {
    const w = makeWorld(row(0, 4), [pusher(), victim()]);
    const p1 = player(w, 'p1');
    setInput(w, 'p1', input({ jump: true }));
    step(w);
    push(w);
    expect(of(step(w), 'push')).toHaveLength(1);
    expect(p1.action).toBe(Action.Knocked);
    expect(p1.endTick).toBe(w.tick + KNOCK_TICKS);
  });

  const at = (action: Action, startTick = 10, endTick = 20) => ({ action, startTick, endTick }) as PlayerState;
  test.each([
    ['Idle', at(Action.Idle), 15, true],
    ['Turning', at(Action.Turn), 11, true],
    ['Stunned', at(Action.Stunned), 11, true],
    ['Rolling', at(Action.Roll), 12, false],
    ['Flipping', at(Action.Flip), 12, false],
    ['Jumping', at(Action.Jump), 11, false],
    ['Falling', at(Action.Fall), 11, false],
    ['Knocked', at(Action.Knocked), 11, false],
    ['Dead', at(Action.Dead), 11, false],
    ['Hop, start tick (escape)', at(Action.Hop), 10, false],
    ['Hop, +1', at(Action.Hop), 11, true],
    ['Hop, +2', at(Action.Hop), 12, true],
    ['Hop, +3 (high)', at(Action.Hop), 13, false],
    ['Hop, 3 before end (high)', at(Action.Hop), 17, false],
    ['Hop, 2 before end', at(Action.Hop), 18, true],
    ['Hop, 1 before end', at(Action.Hop), 19, true],
  ] as const)('isPushable: %s → %s', (_, v, tick, expected) => {
    expect(isPushable(v, tick)).toBe(expected);
  });

  test('a rolling victim is not pushable: pusher blocked, no stun', () => {
    const w = makeWorld(row(0, 4), [pusher(), victim('+X')]);
    setInput(w, 'p1', input({ fwdHeld: true }));
    step(w);
    setInput(w, 'p1', input({}));
    push(w);
    expect(step(w)).toEqual([]);
    expect(player(w).action).toBe(Action.Idle);
  });

  test('a Stunned victim is pushable (combo): holding W pushes it again as the roll ends', () => {
    const w = makeWorld(row(0, 5), [pusher(), victim()]);
    const p1 = player(w, 'p1');
    push(w);
    step(w);
    run(w, KNOCK_TICKS);
    expect(p1.action).toBe(Action.Stunned);
    const events = run(w, ROLL_TICKS - KNOCK_TICKS);
    expect(of(events, 'push')).toHaveLength(1);
    expect(p1.action).toBe(Action.Knocked);
    expect(p1.to.cell).toEqual(vec(3, 1, 0));
  });

  test.each([
    ['a roll', { fwdHeld: true }, Action.Roll],
    ['a hop', { jump: true }, Action.Hop],
  ] as const)('same-tick escape: victim starts %s away → no push, no stun', (_, i, action) => {
    const w = makeWorld(row(0, 4), [pusher(), victim('+X')]);
    push(w);
    setInput(w, 'p1', input(i));
    expect(step(w)).toEqual([]);
    expect(player(w, 'p1').action).toBe(action);
    expect(player(w).action).toBe(Action.Idle);
  });

  test('same-tick victim Turn: still pushed, and the buffered turn applies after the stun', () => {
    const w = makeWorld(row(0, 4), [pusher(), victim()]);
    const p1 = player(w, 'p1');
    push(w);
    setInput(w, 'p1', input({ turn: 1 }));
    expect(of(step(w), 'push')).toHaveLength(1);
    expect(p1.action).toBe(Action.Knocked);
    expect(p1.pulse).toBe('right');
    setInput(w, 'p0', input({}));
    run(w, KNOCK_TICKS + STUN_TICKS);
    expect(p1.action).toBe(Action.Turn);
    expect(p1.startTick).toBe(1 + KNOCK_TICKS + STUN_TICKS);
  });

  test('buffered turn pressed while Stunned applies after the stun', () => {
    const w = makeWorld([...row(0, 4), [2, 1, 0]], [pusher(), victim()]);
    const p0 = player(w);
    push(w);
    step(w); // p0 bounces off p1 (wall behind): stunned until 1 + STUN_TICKS
    setInput(w, 'p0', input({ turn: -1 }));
    run(w, STUN_TICKS - 1);
    expect(p0.action).toBe(Action.Stunned);
    run(w, 1);
    expect(p0.action).toBe(Action.Turn);
    expect(p0.startTick).toBe(1 + STUN_TICKS);
    expect(p0.endTick - p0.startTick).toBe(TURN_TICKS);
  });

  test('mutual push: both Stunned with bounce', () => {
    const w = makeWorld(row(0, 4), [pusher(), victim('-X')]);
    push(w);
    setInput(w, 'p1', input({ fwdHeld: true }));
    const events = step(w);
    expect(of(events, 'bounce').map((e) => e.playerId).sort()).toEqual(['p0', 'p1']);
    expect(of(events, 'push')).toEqual([]);
    for (const p of w.players) {
      expect(p.action).toBe(Action.Stunned);
      expect(p.bounce).toBe(true);
    }
  });

  test.each([0, 1, 2])('two pushers on one victim (tick %i): knocked once, the other pusher is blocked', (t) => {
    const floor = Array.from({ length: 5 }, (_, z) => row(0, 4, 0, z)).flat();
    const w = makeWorld(floor, [[[2, 1, 2], '+Y', '+Z'], [[1, 1, 2], '+Y', '+X'], [[2, 1, 1], '+Y', '+Z']]);
    w.tick = t;
    setInput(w, 'p1', input({ fwdHeld: true }));
    setInput(w, 'p2', input({ fwdHeld: true }));
    const events = step(w);
    expect(of(events, 'push')).toHaveLength(1);
    expect(of(events, 'bounce')).toEqual([]);
    expect(player(w).action).toBe(Action.Knocked);
    expect(w.players.filter((p) => p.action === Action.Roll)).toHaveLength(1);
    expect(w.players.filter((p) => p.action === Action.Idle)).toHaveLength(1);
  });

  test('push rules: dying on your own drops a key with no knockout; push off keeps it', () => {
    for (const on of [true, false]) {
      const w = makeWorld(row(0, 1), [victim('+X'), pusher()], { keys: [{ cell: [0, 1, 0], up: '+Y' }], keysRequired: 1 });
      w.rules = { push: on };
      w.keys[0].collected = true;
      const p = player(w);
      p.keys = 1;
      p.keyIds = [0];
      setInput(w, 'p0', input({ fwdHeld: true, jump: true }));
      step(w);
      setInput(w, 'p0', input({}));
      const events = runToDeath(w, p);
      expect(of(events, 'knockout')).toEqual([]);
      expect(of(events, 'keyDrop')).toHaveLength(on ? 1 : 0);
      expect(p.keys).toBe(on ? 0 : 1);
      expect(w.keys[0].collected).toBe(!on);
    }
  });
});

describe('determinism with push', () => {
  function randomGame(seed: number): { state: string; pushes: number } {
    const w = createWorld(loadLevel(readLevelJson('test-flat.json')), seed, { push: true });
    const ids = ['a', 'b', 'c', 'd'];
    for (const id of ids) addPlayer(w, id, id);
    const rnd = mulberry32(seed);
    let pushes = 0;
    for (let t = 0; t < 2000; t++) {
      for (const id of ids) {
        if (rnd() < 0.3) {
          const r = rnd();
          setInput(w, id, input({ fwdHeld: rnd() < 0.7, turn: r < 0.15 ? -1 : r < 0.3 ? 1 : 0, jump: r > 0.9, jumpHeld: r > 0.95 }));
        }
      }
      pushes += step(w).filter((e) => e.type === 'push').length;
    }
    return { state: serialize(w), pushes };
  }

  test('4 players, seeded random inputs for 2000 ticks, run twice → identical world (and pushes happen)', () => {
    const a = randomGame(42);
    expect(a.pushes).toBeGreaterThan(0);
    expect(randomGame(42)).toEqual(a);
    expect(randomGame(43).state).not.toBe(a.state);
  });
});
