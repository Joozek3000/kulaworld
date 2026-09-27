import { describe, expect, test } from 'vitest';
import {
  Action, ALL_DIRS, addPlayer, dirName, dirVec, FALL_TICKS_PER_CELL, FLIP_TICKS, INPUT_BUFFER_TICKS, JUMP_TICKS,
  opposite, perpendicular, previewAction, removePlayer, RESPAWN_TICKS, ROLL_TICKS, setInput, step, TURN_TICKS, vec,
  Dir,
} from '../src/index.ts';
import { input, makeWorld, player, row, rules, run, type Spawn } from './util.ts';

const onRow = (): Spawn => [[0, 1, 0], '+Y', '+X'];

describe('roll', () => {
  test('rolls onto a solid block', () => {
    const w = makeWorld(row(0, 4), [onRow()]);
    const p = player(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w);
    expect(p.action).toBe(Action.Roll);
    expect(p.to.cell).toEqual(vec(1, 1, 0));
    expect(p.endTick - p.startTick).toBe(ROLL_TICKS);
    setInput(w, 'p0', input({}));
    run(w, ROLL_TICKS);
    expect(p.action).toBe(Action.Idle);
    expect(p.pose).toEqual({ cell: vec(1, 1, 0), up: Dir.PY, fwd: Dir.PX });
  });

  test('a wall is climbed (phase 11, §5): same cell, the wall becomes the floor', () => {
    const w = makeWorld([...row(0, 4), [1, 1, 0]], [onRow()]);
    const p = player(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w);
    expect(p.action).toBe(Action.Climb);
    expect(p.to).toEqual({ cell: vec(0, 1, 0), up: Dir.NX, fwd: Dir.PY });
  });
});

describe('flip', () => {
  test.each(ALL_DIRS)('over an edge with up %i', (up) => {
    const fwd = ALL_DIRS.find((d) => perpendicular(d, up))!;
    const c = dirVec(up);
    const w = makeWorld([[0, 0, 0]], [[[c.x, c.y, c.z], dirName(up), dirName(fwd)]]);
    const p = player(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w);
    setInput(w, 'p0', input({}));
    expect(p.action).toBe(Action.Flip);
    expect(p.to).toEqual({ cell: dirVec(fwd), up: fwd, fwd: opposite(up) });
    run(w, FLIP_TICKS);
    expect(p.action).toBe(Action.Idle);
    expect(p.pose.cell).toEqual(dirVec(fwd));
  });
});

describe('turn', () => {
  test('a left pulse turns in place for TURN_TICKS', () => {
    const w = makeWorld(row(0, 2), [[[1, 1, 0], '+Y', '+Z']]);
    const p = player(w);
    setInput(w, 'p0', input({ turn: -1 }));
    step(w);
    expect(p.action).toBe(Action.Turn);
    expect(p.to).toEqual({ cell: vec(1, 1, 0), up: Dir.PY, fwd: Dir.PX });
    run(w, TURN_TICKS);
    expect(p.action).toBe(Action.Idle);
    expect(p.pose.fwd).toBe(Dir.PX);
  });
});

describe('jump', () => {
  /** Jump pulse with fwd held for the first tick only: a forward jump that doesn't chain into rolls. */
  const jump = (w: ReturnType<typeof makeWorld>) => {
    setInput(w, 'p0', input({ fwdHeld: true, jump: true }));
    step(w);
    setInput(w, 'p0', input({}));
  };

  test('full 2-cell landing', () => {
    const w = makeWorld(row(0, 4), [onRow()]);
    const p = player(w);
    jump(w);
    expect(p.action).toBe(Action.Jump);
    expect(p.to.cell).toEqual(vec(2, 1, 0));
    expect(p.endTick - p.startTick).toBe(JUMP_TICKS);
    run(w, JUMP_TICKS);
    expect(p.action).toBe(Action.Idle);
    expect(p.pose.cell).toEqual(vec(2, 1, 0));
  });

  test('short jump when A2 is solid', () => {
    const w = makeWorld([...row(0, 4), [2, 1, 0]], [onRow()]);
    jump(w);
    expect(player(w).to.cell).toEqual(vec(1, 1, 0));
  });

  test('A2 taken by a player: a stomp jump onto it with push rules (§16), else a short jump', () => {
    const w = makeWorld(row(0, 4), [onRow(), [[2, 1, 0], '+Y', '+X']]);
    jump(w);
    expect(player(w).to.cell).toEqual(rules.push ? vec(2, 1, 0) : vec(1, 1, 0));
  });

  test('forward jump into a wall (A1 solid) hops instead', () => {
    const w = makeWorld([...row(0, 4), [1, 1, 0]], [onRow()]);
    jump(w);
    expect(player(w).action).toBe(Action.Hop);
    expect(player(w).to.cell).toEqual(vec(0, 1, 0));
  });

  test('over a gap into air, then falls onto a lower block', () => {
    const w = makeWorld([[0, 0, 0], [2, -3, 0]], [onRow()]);
    const p = player(w);
    jump(w);
    run(w, JUMP_TICKS);
    expect(p.action).toBe(Action.Fall);
    run(w, 3 * FALL_TICKS_PER_CELL - 1);
    expect(p.action).toBe(Action.Fall);
    run(w, 1);
    expect(p.action).toBe(Action.Idle);
    expect(p.pose).toEqual({ cell: vec(2, -2, 0), up: Dir.PY, fwd: Dir.PX });
  });

  test('jumping over a key at A1 does not collect it', () => {
    const w = makeWorld(row(0, 4), [onRow()], { keys: [{ cell: [1, 1, 0], up: '+Y' }], keysRequired: 1 });
    jump(w);
    const events = run(w, JUMP_TICKS);
    expect(player(w).pose.cell).toEqual(vec(2, 1, 0));
    expect(events).toEqual([]);
    expect(w.keys[0].collected).toBe(false);
  });
});

describe('fall and death', () => {
  test('out of bounds → Dead → respawns after exactly RESPAWN_TICKS at a free spawn, keys kept', () => {
    const w = makeWorld([[0, 0, 0], [5, 0, 0]], [onRow(), [[5, 1, 0], '+Y', '+X']]);
    const p0 = player(w), p1 = player(w, 'p1');
    p0.keys = 2;
    setInput(w, 'p0', input({ fwdHeld: true, jump: true }));
    step(w);
    setInput(w, 'p0', input({}));
    let deathTick = -1, respawnTick = -1;
    for (let i = 0; i < 200 && respawnTick < 0; i++) {
      for (const e of step(w)) {
        if (e.type === 'death') {
          deathTick = w.tick;
          expect(p0.action).toBe(Action.Dead);
          p1.pose = p1.to = { cell: vec(0, 1, 0), up: Dir.PY, fwd: Dir.PX }; // take spawn 0
        }
        if (e.type === 'respawn') respawnTick = w.tick;
      }
    }
    expect(deathTick).toBeGreaterThan(0);
    expect(respawnTick - deathTick).toBe(RESPAWN_TICKS);
    expect(p0.pose.cell).toEqual(vec(5, 1, 0));
    expect(p0.action).toBe(Action.Idle);
    expect(p0.keys).toBe(2);
  });

  test('a player joining with every spawn taken waits, then spawns once one frees up', () => {
    const w = makeWorld(row(0, 3), [onRow()]);
    const late = addPlayer(w, 'late', 'late');
    expect(late.action).toBe(Action.Dead);
    run(w, 3);
    expect(late.action).toBe(Action.Dead);
    setInput(w, 'p0', input({ fwdHeld: true }));
    run(w, ROLL_TICKS + 2);
    expect(late.action).toBe(Action.Idle);
    expect(late.pose.cell).toEqual(vec(0, 1, 0));
  });

  test('removePlayer drops the player and its reservations', () => {
    const w = makeWorld(row(0, 2), [onRow(), [[2, 1, 0], '+Y', '-X']]);
    removePlayer(w, 'p1');
    expect(w.players.map((p) => p.id)).toEqual(['p0']);
    expect(previewAction(w, player(w), 'jump')!.to.cell).toEqual(vec(2, 1, 0));
  });
});

describe('reservations', () => {
  const facing = () => makeWorld(row(0, 2), [onRow(), [[2, 1, 0], '+Y', '-X']]);
  const contest = (tickBefore: number) => {
    const w = facing();
    w.tick = tickBefore;
    setInput(w, 'p0', input({ fwdHeld: true }));
    setInput(w, 'p1', input({ fwdHeld: true }));
    step(w);
    const moving = w.players.filter((p) => p.action === Action.Roll);
    expect(moving).toHaveLength(1);
    return { winner: moving[0].id, tick: w.tick };
  };

  test('two players rolling into the same cell on the same tick: exactly one moves', () => {
    const { winner, tick } = contest(0);
    expect(winner).toBe(`p${tick % 2}`);
  });

  test('fairness rotation alternates the winner across ticks', () => {
    expect(contest(0).winner).not.toBe(contest(1).winner);
  });

  test("can't flip into an occupied cell (with push rules it's an edge push, §14)", () => {
    // p1 stands on the +X face of the block, exactly where p0's flip would land.
    const w = makeWorld([[0, 0, 0]], [onRow(), [[1, 0, 0], '+X', '+Y']]);
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w);
    expect(player(w).action).toBe(rules.push ? Action.Flip : Action.Idle);
  });

  test("can't roll into a cell another player is leaving", () => {
    const w = makeWorld(row(0, 3), [onRow(), [[1, 1, 0], '+Y', '+X']]);
    setInput(w, 'p1', input({ fwdHeld: true }));
    step(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w);
    expect(player(w, 'p1').action).toBe(Action.Roll);
    expect(player(w).action).toBe(Action.Idle);
  });
});

describe('input', () => {
  test('holding fwd rolls 3 tiles in exactly 3×ROLL_TICKS with no idle gap', () => {
    const w = makeWorld(row(0, 5), [onRow()]);
    const p = player(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w);
    const start = p.startTick;
    while (p.pose.cell.x < 3) {
      expect(p.action).toBe(Action.Roll);
      step(w);
    }
    expect(w.tick - start).toBe(3 * ROLL_TICKS);
  });

  test.each([
    ['turn beats held fwd', [{ fwdHeld: true, turn: 1 }], Action.Turn],
    ['jump beats held fwd', [{ fwdHeld: true, jump: true }], Action.Jump],
    ['jump (as hop) beats turn in one message', [{ turn: 1, jump: true }], Action.Hop],
    ['latest pulse wins (jump → hop)', [{ turn: -1 }, { jump: true }], Action.Hop],
    ['latest pulse wins (turn)', [{ jump: true }, { turn: 1 }], Action.Turn],
  ] as const)('priority: %s', (_, inputs, expected) => {
    const w = makeWorld(row(0, 5), [onRow()]);
    for (const i of inputs) setInput(w, 'p0', input(i));
    step(w);
    expect(player(w).action).toBe(expected);
  });

  test.each([
    [INPUT_BUFFER_TICKS, Action.Turn],
    [INPUT_BUFFER_TICKS + 1, Action.Idle],
  ])('a pulse sent %i grounded ticks before the player is free (dead, respawning): %i', (age, expected) => {
    const w = makeWorld(row(0, 5), [onRow()]);
    const p = player(w);
    Object.assign(p, { action: Action.Dead, startTick: 0, endTick: 20 }); // respawns at tick 20
    run(w, p.endTick - age);
    setInput(w, 'p0', input({ turn: 1 }));
    run(w, age);
    expect(p.action).toBe(expected);
    expect(p.pulse).toBe(null);
  });

});

describe('hop', () => {
  test('jump pulse without fwd hops in place for JUMP_TICKS', () => {
    const w = makeWorld(row(0, 4), [onRow()]);
    const p = player(w);
    setInput(w, 'p0', input({ jump: true }));
    step(w);
    expect(p.action).toBe(Action.Hop);
    expect(p.to).toEqual(p.pose);
    expect(p.endTick - p.startTick).toBe(JUMP_TICKS);
    run(w, JUMP_TICKS);
    expect(p.action).toBe(Action.Idle);
    expect(p.pose.cell).toEqual(vec(0, 1, 0));
  });

  test('hop under a ceiling is blocked and the pulse is spent', () => {
    const w = makeWorld([...row(0, 4), [0, 2, 0]], [onRow()]);
    const p = player(w);
    setInput(w, 'p0', input({ jump: true }));
    step(w);
    expect(p.action).toBe(Action.Idle);
    expect(p.pulse).toBe(null);
  });

  test.each([
    ['W held → forward jump chains at the roll end', true, Action.Jump, vec(3, 1, 0)],
    ['W released before the roll ends → hop', false, Action.Hop, vec(1, 1, 0)],
  ] as const)('jump pressed mid-roll, %s', (_, held, expected, target) => {
    const w = makeWorld(row(0, 5), [onRow()]);
    const p = player(w);
    setInput(w, 'p0', input({ fwdHeld: true }));
    step(w); // roll 0 → 1, ends at tick 1 + ROLL_TICKS
    run(w, 2);
    setInput(w, 'p0', input({ fwdHeld: held, jump: true }));
    run(w, 1 + ROLL_TICKS - w.tick);
    expect(p.action).toBe(expected);
    expect(p.startTick).toBe(1 + ROLL_TICKS);
    expect(p.to.cell).toEqual(target);
  });

  test("a player can't roll into a low hop's cell, and rolls under it once it's high (§14 roll under)", () => {
    const w = makeWorld(row(0, 3), [onRow(), [[1, 1, 0], '+Y', '+X']]);
    w.rules = { push: false }; // with push, a low hop is pushable (push.test.ts)
    setInput(w, 'p1', input({ jump: true }));
    step(w);
    expect(player(w, 'p1').action).toBe(Action.Hop);
    setInput(w, 'p0', input({ fwdHeld: true }));
    run(w, 2); // the low window
    expect(player(w).action).toBe(Action.Idle);
    step(w);
    expect([player(w).action, player(w).to.cell]).toEqual([Action.Roll, vec(1, 1, 0)]);
  });
});
