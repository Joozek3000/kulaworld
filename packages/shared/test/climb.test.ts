import { describe, expect, test } from 'vitest';
import {
  Action, addPlayer, CLIMB_TICKS, createWorld, Dir, loadLevel, mulberry32, setInput, step, turnFwd, vec,
  type Pose, type World,
} from '../src/index.ts';
import { input, makeWorld, player, readLevelJson, row, serialize, type Spawn } from './util.ts';

// ARCHITECTURE §5 (phase 11): rolling into a wall climbs it. p0 at x=2 facing +X, the wall at x=3.
const start = (): Spawn => [[2, 1, 0], '+Y', '+X'];
const pose = (x: number, y: number, z: number, up: Dir, fwd: Dir): Pose => ({ cell: vec(x, y, z), up, fwd });

/** Holds W until p's next action has finished; returns that action. */
function fwd(w: World): Action {
  const p = player(w);
  setInput(w, 'p0', input({ fwdHeld: true }));
  step(w);
  setInput(w, 'p0', input({}));
  const a = p.action;
  while (p.action !== Action.Idle) step(w);
  return a;
}

describe('climb', () => {
  test('1-high wall: climb, flip onto the top, flip down the far side, climb back onto the floor', () => {
    const w = makeWorld([...row(0, 6), [3, 1, 0]], [start()]);
    const p = player(w);
    expect(fwd(w)).toBe(Action.Climb);
    expect(p.pose).toEqual(pose(2, 1, 0, Dir.NX, Dir.PY)); // on the wall's face, facing up
    expect(p.endTick - p.startTick).toBe(CLIMB_TICKS);
    expect(fwd(w)).toBe(Action.Flip);
    expect(p.pose).toEqual(pose(3, 2, 0, Dir.PY, Dir.PX)); // on top of the wall
    expect(fwd(w)).toBe(Action.Flip);
    expect(p.pose).toEqual(pose(4, 1, 0, Dir.PX, Dir.NY)); // down its far face
    expect(fwd(w)).toBe(Action.Climb); // the floor is a wall now
    expect(p.pose).toEqual(pose(4, 1, 0, Dir.PY, Dir.PX));
  });

  test('2-high wall: climb, roll up, flip onto the top', () => {
    const w = makeWorld([...row(0, 6), [3, 1, 0], [3, 2, 0]], [start()]);
    const p = player(w);
    expect(fwd(w)).toBe(Action.Climb);
    expect(fwd(w)).toBe(Action.Roll);
    expect(p.pose).toEqual(pose(2, 2, 0, Dir.NX, Dir.PY));
    expect(fwd(w)).toBe(Action.Flip);
    expect(p.pose).toEqual(pose(3, 3, 0, Dir.PY, Dir.PX));
  });

  test('held W chains the climb into a roll up the wall', () => {
    const w = makeWorld([...row(0, 6), [3, 1, 0], [3, 2, 0]], [start()]);
    const p = player(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w);
    expect(p.action).toBe(Action.Climb);
    for (let i = 0; i < CLIMB_TICKS; i++) step(w);
    expect([p.action, p.to.cell]).toEqual([Action.Roll, vec(2, 2, 0)]);
  });

  test('under a ceiling (a concave corner above): climb onto the wall, then onto the ceiling', () => {
    const w = makeWorld([...row(0, 6), [3, 1, 0], [2, 2, 0]], [start()]);
    const p = player(w);
    expect(fwd(w)).toBe(Action.Climb);
    expect(fwd(w)).toBe(Action.Climb);
    expect(p.pose).toEqual(pose(2, 1, 0, Dir.NY, Dir.NX)); // hanging under the ceiling, facing back
  });

  test('turning on the wall', () => {
    const w = makeWorld([...row(0, 6), [3, 1, 0], [3, 2, 0], [3, 1, 1], [3, 2, 1], [3, 1, -1], [3, 2, -1]], [start()]);
    const p = player(w);
    fwd(w);
    for (const turn of [-1, 1] as const) {
      const before = p.pose.fwd;
      setInput(w, 'p0', input({ turn }));
      step(w);
      setInput(w, 'p0', input({}));
      while (p.action !== Action.Idle) step(w);
      expect(p.pose.fwd).toBe(turnFwd(Dir.NX, before, turn));
      expect(p.pose.up).toBe(Dir.NX);
    }
  });

  test('a climb reserves only its own cell, and a climbing player is not pushable', () => {
    const w = makeWorld([...row(0, 6), [3, 1, 0]], [start(), [[1, 1, 0], '+Y', '+X']]);
    const p0 = player(w), p1 = player(w, 'p1');
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w);
    expect(p0.action).toBe(Action.Climb);
    setInput(w, 'p1', input({ fwdHeld: true })); // p1 rolls into p0 while it climbs: blocked, not a push
    const events = step(w);
    expect(events.filter((e) => e.type === 'push')).toEqual([]);
    expect(p1.action).toBe(Action.Idle);
  });

  test('jumping into a wall still hops; pushing into a wall still bounces', () => {
    const hop = makeWorld([...row(0, 6), [3, 1, 0]], [start()]);
    setInput(hop, 'p0', input({ fwdHeld: true, jump: true }));
    step(hop);
    expect(player(hop).action).toBe(Action.Hop);
    const bounce = makeWorld([...row(0, 6), [4, 1, 0]], [start(), [[3, 1, 0], '+Y', '+Z']]);
    setInput(bounce, 'p0', input({ fwdHeld: true }));
    const events = step(bounce);
    expect(events.map((e) => e.type)).toEqual(['bounce']);
  });
});

test('determinism with climbs (4 players on race-01, random inputs, 2000 ticks)', () => {
  const runOnce = () => {
    const w = createWorld(loadLevel(readLevelJson('race-01.json')), 3);
    for (let i = 0; i < 4; i++) addPlayer(w, `p${i}`, `p${i}`);
    const rnd = mulberry32(11);
    let climbs = 0;
    for (let t = 0; t < 2000; t++) {
      for (const p of w.players) if (rnd() < 0.2) setInput(w, p.id, input({ fwdHeld: rnd() < 0.7, jump: rnd() < 0.1, turn: rnd() < 0.25 ? (rnd() < 0.5 ? -1 : 1) : 0 }));
      step(w);
      for (const p of w.players) if (p.action === Action.Climb && p.startTick === w.tick) climbs++;
    }
    return { state: serialize(w), climbs };
  };
  const a = runOnce(), b = runOnce();
  expect(a.state).toBe(b.state);
  expect(a.climbs).toBeGreaterThan(0);
});
