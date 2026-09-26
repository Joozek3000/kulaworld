import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, createWorld, Dir, isPushable, JUMP_TICKS, KNOCK_TICKS, loadLevel, mulberry32, REBOUND_TICKS, setInput,
  step, stompPreview, STUN_TICKS, turnFwd, vec,
  type PlayerState, type SimEvent, type World,
} from '../src/index.ts';
import { inOrder, input, levelJson, makeWorld, player, row, run, serialize, type Spawn } from './util.ts';

// ARCHITECTURE §16. p0 is the attacker at x=0 facing +X; a forward jump lands on A2 = x=2.
const attacker = (): Spawn => [[0, 1, 0], '+Y', '+X'];
const at = (x: number, fwd: '+X' | '-X' | '+Z' | '-Z' = '+Z', z = 0): Spawn => [[x, 1, z], '+Y', fwd];
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

/** p0 jumps forward (one pulse), then lets go. Returns the events of the takeoff tick. */
function jump(w: World, id = 'p0'): SimEvent[] {
  setInput(w, id, input({ fwdHeld: true, jump: true }));
  const e = step(w);
  setInput(w, id, input({}));
  return e;
}

/** Runs until p's current action has finished (its landing tick included), returning the events. */
function land(w: World, p: PlayerState): SimEvent[] {
  const events: SimEvent[] = [];
  const end = p.endTick;
  while (w.tick < end) events.push(...step(w));
  return events;
}

describe('jump over', () => {
  test('a player on A1 no longer blocks: the jumper lands on A2, the A1 player is unaffected', () => {
    const w = makeWorld(row(0, 4), [attacker(), at(1)]);
    const p0 = player(w), p1 = player(w, 'p1');
    jump(w);
    expect(p0.action).toBe(Action.Jump);
    expect(p0.to.cell).toEqual(vec(2, 1, 0));
    expect(p0.jumpOver).toBe(true);
    const events = land(w, p0);
    expect(events).toEqual([]);
    expect(p0.pose.cell).toEqual(vec(2, 1, 0));
    expect([p1.action, p1.pose.cell]).toEqual([Action.Idle, vec(1, 1, 0)]);
  });

  test('A1 solid still blocks: a hop instead', () => {
    const w = makeWorld([...row(0, 4), [1, 1, 0]], [attacker()]);
    jump(w);
    expect(player(w).action).toBe(Action.Hop);
  });

  test('a hop never stomps', () => {
    const w = makeWorld(row(0, 4), [attacker(), at(1)]);
    setInput(w, 'p0', input({ jump: true })); // no fwd: hop in place
    const events = [...step(w), ...land(w, player(w))];
    expect(of(events, 'stomp')).toEqual([]);
    expect(player(w, 'p1').action).toBe(Action.Idle);
  });
});

describe('stomp', () => {
  test('onto ground: victim Knocked to L + F then staggered; attacker takes L', () => {
    const w = makeWorld(row(0, 5), [attacker(), at(2)]);
    const p0 = player(w), p1 = player(w, 'p1');
    jump(w);
    expect(p0.stompBump).toEqual(vec(3, 1, 0));
    const events = land(w, p0);
    expect(of(events, 'stomp')).toEqual([{ type: 'stomp', attackerId: 'p0', victimId: 'p1' }]);
    expect(p0.pose.cell).toEqual(vec(2, 1, 0));
    expect([p1.action, p1.to.cell, p1.lastKnockedBy]).toEqual([Action.Knocked, vec(3, 1, 0), 'p0']);
    run(w, KNOCK_TICKS);
    expect([p1.action, p1.bounce, p1.pose.cell]).toEqual([Action.Stunned, false, vec(3, 1, 0)]);
  });

  test('no ground at B: the victim falls; off the map it dies, drops its key and credits the attacker', () => {
    const w = makeWorld(row(0, 2), [attacker(), at(2)], { keys: [{ cell: [0, 1, 0], up: '+Y' }], keysRequired: 1 });
    const p1 = player(w, 'p1');
    w.keys[0].collected = true;
    p1.keys = 1;
    p1.keyIds = [0];
    jump(w);
    const events = land(w, player(w));
    for (let i = 0; i < 200 && p1.action !== Action.Dead; i++) events.push(...step(w));
    expect(p1.action).toBe(Action.Dead);
    expect(of(events, 'keyDrop')).toEqual([{ type: 'keyDrop', playerId: 'p1', keyId: 0 }]);
    expect(of(events, 'knockout')).toEqual([{ type: 'knockout', pusherId: 'p0', victimId: 'p1' }]);
  });

  test('B blocked at jump start (block or player): no stomp, the short-jump / hop fallback applies', () => {
    const blocked = makeWorld([...row(0, 5), [3, 1, 0]], [attacker(), at(2)]);
    jump(blocked);
    expect([player(blocked).to.cell, player(blocked).stompBump]).toEqual([vec(1, 1, 0), null]); // short jump to A1
    const crowd = makeWorld(row(0, 5), [attacker(), at(1), at(2), at(3)]);
    jump(crowd);
    expect(player(crowd).action).toBe(Action.Hop); // A2 → B taken, A1 → its B (A2) taken
  });

  test('B stays reserved for the whole jump: a third player cannot roll into it', () => {
    const w = makeWorld(row(0, 5), [attacker(), at(2), at(4, '-X')]);
    const p2 = player(w, 'p2');
    jump(w);
    setInput(w, 'p2', input({ fwdHeld: true }));
    for (let i = 0; i < JUMP_TICKS - 1; i++) {
      step(w);
      expect(p2.action).toBe(Action.Idle);
    }
  });

  test('the victim rolls away mid-jump: it escaped, a normal landing', () => {
    const w = makeWorld([...row(0, 5), ...row(0, 5, 0, 1)], [attacker(), at(2, '+Z')]);
    const p0 = player(w), p1 = player(w, 'p1');
    jump(w);
    run(w, 3);
    setInput(w, 'p1', input({ fwdHeld: true }));
    step(w);
    setInput(w, 'p1', input({}));
    const events = land(w, p0);
    expect(of(events, 'stomp')).toEqual([]);
    expect([p0.action, p0.pose.cell]).toEqual([Action.Idle, vec(2, 1, 0)]);
    expect(p1.pose.cell).toEqual(vec(2, 1, 1));
  });

  test('victim high in a hop at landing: clash, the attacker rebounds to C, no stun, the hop goes on', () => {
    const w = makeWorld(row(0, 5), [attacker(), at(2)]);
    const p0 = player(w), p1 = player(w, 'p1');
    jump(w);
    run(w, 4);
    setInput(w, 'p1', input({ jump: true }));
    step(w); // hop starts 5 ticks before the landing: high by then
    setInput(w, 'p1', input({}));
    const events = land(w, p0);
    expect(of(events, 'clash')).toEqual([{ type: 'clash', attackerId: 'p0', victimId: 'p1' }]);
    expect(of(events, 'stomp')).toEqual([]);
    expect([p0.action, p0.pose.cell, p0.to.cell]).toEqual([Action.Rebound, vec(2, 1, 0), vec(0, 1, 0)]);
    expect(p0.endTick - p0.startTick).toBe(REBOUND_TICKS);
    expect(p1.action).toBe(Action.Hop);
    run(w, REBOUND_TICKS);
    expect([p0.action, p0.pose.cell]).toEqual([Action.Idle, vec(0, 1, 0)]);
    expect(p1.action).not.toBe(Action.Stunned);
  });

  test('victim low in a hop at landing: stomped', () => {
    const w = makeWorld(row(0, 5), [attacker(), at(2)]);
    const p0 = player(w), p1 = player(w, 'p1');
    jump(w);
    run(w, JUMP_TICKS - 2);
    setInput(w, 'p1', input({ jump: true }));
    step(w); // hop starts 1 tick before the landing: still low
    setInput(w, 'p1', input({}));
    expect(p1.action).toBe(Action.Hop);
    const events = land(w, p0);
    expect(of(events, 'stomp')).toHaveLength(1);
    expect(p1.action).toBe(Action.Knocked);
  });

  test('a staggered victim can be neither pushed nor stomped until the stagger ends (a stomp landing clashes)', () => {
    const w = makeWorld(row(0, 5), [attacker(), at(2)]);
    const p1 = player(w, 'p1');
    p1.action = Action.Stunned; // a stagger that outlasts the jump
    p1.bounce = false;
    p1.startTick = w.tick;
    p1.endTick = w.tick + 30;
    expect(isPushable(p1, w.tick + 1)).toBe(false);
    jump(w);
    const events = land(w, player(w));
    expect(of(events, 'clash')).toHaveLength(1);
    expect(p1.action).toBe(Action.Stunned);
  });

  test('a real stomp stagger is unpushable for STUN_TICKS, then pushable', () => {
    const w = makeWorld(row(0, 6), [attacker(), at(2)]);
    const p1 = player(w, 'p1');
    jump(w);
    land(w, player(w));
    run(w, KNOCK_TICKS);
    expect(p1.action).toBe(Action.Stunned);
    expect(isPushable(p1, w.tick)).toBe(false);
    run(w, STUN_TICKS);
    expect(isPushable(p1, w.tick)).toBe(true);
  });
});

describe('fall stomp', () => {
  // p0 jumps off a ledge at y=3 and falls onto p1 standing on the floor at x=3.
  const blocks = (extra: [number, number, number][] = []): [number, number, number][] =>
    [[0, 3, 0], [1, 3, 0], ...row(0, 7), ...row(0, 7, 0, 1), ...row(0, 7, 0, -1), ...extra];
  const spawns: Spawn[] = [[[1, 4, 0], '+Y', '+X'], at(3)];

  test('a fall onto a grounded player knocks it in the faller\'s fwd', () => {
    const w = makeWorld(blocks(), spawns);
    const p0 = player(w), p1 = player(w, 'p1');
    const events = jump(w);
    for (let i = 0; i < 40 && !(p0.action === Action.Idle && p0.pose.cell.y === 1); i++) events.push(...step(w));
    expect(of(events, 'stomp')).toEqual([{ type: 'stomp', attackerId: 'p0', victimId: 'p1' }]);
    expect([p1.action, p1.to.cell]).toEqual([Action.Knocked, vec(4, 1, 0)]);
  });

  test('fwd blocked: the next free direction in order (left, right, back)', () => {
    const w = makeWorld(blocks([[4, 1, 0]]), spawns);
    const p0 = player(w), p1 = player(w, 'p1');
    const events = jump(w);
    for (let i = 0; i < 40 && !(p0.action === Action.Idle && p0.pose.cell.y === 1); i++) events.push(...step(w));
    expect(of(events, 'stomp')).toHaveLength(1);
    const left = turnFwd(Dir.PY, Dir.PX, -1); // cross(U, F)
    expect(left).toBe(Dir.NZ);
    expect(p1.to.cell).toEqual(vec(3, 1, -1));
  });
});

describe('push rules off', () => {
  const offWorld = (spawns: Spawn[], blocks = row(0, 5)) => {
    const w = inOrder(createWorld(loadLevel(levelJson(blocks, spawns)), 1, { push: false }));
    spawns.forEach((_, i) => addPlayer(w, `p${i}`, `p${i}`));
    return w;
  };

  test('jump-over still works', () => {
    const w = offWorld([attacker(), at(1)]);
    jump(w);
    expect(player(w).to.cell).toEqual(vec(2, 1, 0));
  });

  test('landing on a player falls back to the old short-jump logic: no stomp', () => {
    const w = offWorld([attacker(), at(2)]);
    jump(w);
    expect([player(w).to.cell, player(w).stompBump]).toEqual([vec(1, 1, 0), null]);
    expect(of(land(w, player(w)), 'stomp')).toEqual([]);
  });
});

test('stompPreview: victim, bump cell and lethality', () => {
  const safe = makeWorld(row(0, 5), [attacker(), at(2)]);
  expect(stompPreview(safe, player(safe).pose, 'p0')).toEqual({ victimId: 'p1', bumpCell: vec(3, 1, 0), lethal: false });
  const edge = makeWorld(row(0, 2), [attacker(), at(2)]);
  expect(stompPreview(edge, player(edge).pose, 'p0')).toEqual({ victimId: 'p1', bumpCell: vec(3, 1, 0), lethal: true });
  const nobody = makeWorld(row(0, 5), [attacker()]);
  expect(stompPreview(nobody, player(nobody).pose, 'p0')).toBe(null);
});

test('determinism with stomps: 4 players, random inputs incl. jumps, 2000 ticks', () => {
  const runOnce = () => {
    // A 5x5 race plate (no lives), so the four keep running into each other.
    const plate: [number, number, number][] = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) plate.push([x, 0, z]);
    const w = makeWorld(plate, [at(0, '+X'), [[4, 1, 4], '+Y', '-X'], [[0, 1, 4], '+Y', '+Z'], [[4, 1, 0], '+Y', '-Z']]);
    const rnd = mulberry32(42);
    let stomps = 0, clashes = 0;
    for (let t = 0; t < 2000; t++) {
      for (const p of w.players) {
        if (rnd() < 0.2) setInput(w, p.id, input({ fwdHeld: rnd() < 0.5, jump: rnd() < 0.3, jumpHeld: rnd() < 0.15, turn: rnd() < 0.2 ? (rnd() < 0.5 ? -1 : 1) : 0 }));
      }
      for (const e of step(w)) { if (e.type === 'stomp') stomps++; if (e.type === 'clash') clashes++; }
    }
    return { state: serialize(w), stomps, clashes };
  };
  const a = runOnce(), b = runOnce();
  expect(a.state).toBe(b.state);
  expect(a.stomps).toBeGreaterThan(0); // clashes are too rare for random inputs; they have their own test
  expect(a).toEqual(b);
});
