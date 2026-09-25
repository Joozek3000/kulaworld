import { describe, expect, test } from 'vitest';
import {
  Action, ALL_DIRS, cross, Dir, dirVec, frameQuat, JUMP_HEIGHT, opposite, perpendicular, poseAt, rotate,
  HOP_HEIGHT, SPIN_PER_CELL, vec, type Pose, type Quat, type V3,
} from '../src/index.ts';

const pose = (x: number, y: number, z: number, up: Dir, fwd: Dir): Pose => ({ cell: vec(x, y, z), up, fwd });
const arr = (v: { x: number; y: number; z: number }): V3 => [v.x, v.y, v.z];
const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
const apply = (q: Quat, v: V3) => rotate(q, v, [0, 0, 0]);
/** Quaternions q and -q are the same rotation. */
const sameRot = (a: Quat, b: Quat) => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  expect(Math.abs(dot)).toBeCloseTo(1, 9);
};
const pairs = ALL_DIRS.flatMap((u) => ALL_DIRS.filter((f) => perpendicular(u, f)).map((f) => [u, f] as const));

describe('frameQuat', () => {
  test.each(pairs)('up %i fwd %i: local X/Y/Z → cross(U,F)/U/F', (up, fwd) => {
    const q = frameQuat(up, fwd, [0, 0, 0, 1]);
    close(apply(q, [1, 0, 0]), arr(dirVec(cross(up, fwd))));
    close(apply(q, [0, 1, 0]), arr(dirVec(up)));
    close(apply(q, [0, 0, 1]), arr(dirVec(fwd)));
  });
});

describe('poseAt', () => {
  const C = pose(0, 1, 0, Dir.PY, Dir.PZ);

  test('roll: lerp with spin', () => {
    const to = pose(0, 1, 1, Dir.PY, Dir.PZ);
    close(poseAt(Action.Roll, C, to, 0).position, [0, 1, 0]);
    const mid = poseAt(Action.Roll, C, to, 0.5);
    close(mid.position, [0, 1, 0.5]);
    expect(mid.spin).toBeCloseTo(SPIN_PER_CELL / 2);
    close(poseAt(Action.Roll, C, to, 1).position, [0, 1, 1]);
  });

  test('turn: rotates about up, position fixed', () => {
    const to = pose(0, 1, 0, Dir.PY, Dir.PX);
    const mid = poseAt(Action.Turn, C, to, 0.5);
    close(mid.position, [0, 1, 0]);
    close(mid.up, [0, 1, 0]);
    close(apply(mid.quat, [0, 0, 1]), [Math.SQRT1_2, 0, Math.SQRT1_2]);
    sameRot(poseAt(Action.Turn, C, to, 0).quat, frameQuat(Dir.PY, Dir.PZ, [0, 0, 0, 1]));
    sameRot(poseAt(Action.Turn, C, to, 1).quat, frameQuat(Dir.PY, Dir.PX, [0, 0, 0, 1]));
  });

  test('jump: lerp plus parabola peaking at JUMP_HEIGHT', () => {
    const to = pose(0, 1, 2, Dir.PY, Dir.PZ);
    close(poseAt(Action.Jump, C, to, 0).position, [0, 1, 0]);
    close(poseAt(Action.Jump, C, to, 0.5).position, [0, 1 + JUMP_HEIGHT, 1]);
    close(poseAt(Action.Jump, C, to, 1).position, [0, 1, 2]);
  });

  test('fall: linear along -up', () => {
    close(poseAt(Action.Fall, C, pose(0, 0, 0, Dir.PY, Dir.PZ), 0.25).position, [0, 0.75, 0]);
  });

  test.each(ALL_DIRS)('flip with up %i: start, mid on the arc around E, end, up at 0.5 = normalize(U+F)', (up) => {
    const fwd = ALL_DIRS.find((d) => perpendicular(d, up))!;
    const U = dirVec(up), F = dirVec(fwd);
    const from: Pose = { cell: U, up, fwd };
    const to: Pose = { cell: F, up: fwd, fwd: opposite(up) };
    const E: V3 = [0.5 * (U.x + F.x), 0.5 * (U.y + F.y), 0.5 * (U.z + F.z)]; // (C - U) + U/2 + F/2 with C = U

    const start = poseAt(Action.Flip, from, to, 0);
    close(start.position, arr(U));
    sameRot(start.quat, frameQuat(up, fwd, [0, 0, 0, 1]));

    const mid = poseAt(Action.Flip, from, to, 0.5);
    close(mid.position, [U.x + F.x, U.y + F.y, U.z + F.z]); // A = C + F
    expect(Math.hypot(mid.position[0] - E[0], mid.position[1] - E[1], mid.position[2] - E[2])).toBeCloseTo(Math.SQRT1_2);
    close(mid.up, [(U.x + F.x) * Math.SQRT1_2, (U.y + F.y) * Math.SQRT1_2, (U.z + F.z) * Math.SQRT1_2]);

    const end = poseAt(Action.Flip, from, to, 1);
    close(end.position, arr(F));
    sameRot(end.quat, frameQuat(to.up, to.fwd, [0, 0, 0, 1]));
    close(end.up, arr(F));
  });

  test('progress is clamped to 0..1', () => {
    const to = pose(0, 1, 1, Dir.PY, Dir.PZ);
    close(poseAt(Action.Roll, C, to, -3).position, [0, 1, 0]);
    close(poseAt(Action.Roll, C, to, 7).position, [0, 1, 1]);
    expect(poseAt(Action.Roll, C, to, 7).spin).toBeCloseTo(SPIN_PER_CELL);
  });

  test('idle and dead render the from pose; out is reused', () => {
    const out = poseAt(Action.Roll, C, pose(0, 1, 1, Dir.PY, Dir.PZ), 0.5);
    expect(poseAt(Action.Idle, C, C, 0.5, out)).toBe(out);
    close(out.position, [0, 1, 0]);
    expect(out.spin).toBe(0);
    close(poseAt(Action.Dead, pose(3, -7, 0, Dir.PY, Dir.PZ), C, 0.5).position, [3, -7, 0]);
  });
});

test('hop: parabola along up with peak HOP_HEIGHT, no lateral move, no spin', () => {
  const c = pose(2, 1, 3, Dir.PY, Dir.PZ);
  close(poseAt(Action.Hop, c, c, 0).position, [2, 1, 3]);
  const mid = poseAt(Action.Hop, c, c, 0.5);
  close(mid.position, [2, 1 + HOP_HEIGHT, 3]);
  expect(mid.lift).toBeCloseTo(HOP_HEIGHT);
  expect(mid.spin).toBe(0);
  close(poseAt(Action.Hop, c, c, 1).position, [2, 1, 3]);
  const side = pose(5, 2, 2, Dir.PX, Dir.PY); // on a +X face
  close(poseAt(Action.Hop, side, side, 0.5).position, [5 + HOP_HEIGHT, 2, 2]);
});

test('mid-air turn: facing spins from turnFromFwd to to.fwd over the turn, position unaffected', () => {
  const from = pose(0, 1, 0, Dir.PY, Dir.PZ);
  const to = pose(0, 1, 0, Dir.PY, Dir.PX); // turned left mid-hop
  const at = (t: number) => poseAt(Action.Hop, from, to, 0.5, undefined, { fromFwd: Dir.PZ, progress: t });
  close(apply(at(0).quat, [0, 0, 1]), [0, 0, 1]);
  close(apply(at(0.5).quat, [0, 0, 1]), [Math.SQRT1_2, 0, Math.SQRT1_2]);
  close(apply(at(1).quat, [0, 0, 1]), [1, 0, 0]);
  close(apply(at(7).quat, [0, 0, 1]), [1, 0, 0]); // clamped
  close(at(0.5).position, [0, 1 + HOP_HEIGHT, 0]);
  close(at(0.5).up, [0, 1, 0]);
  // a forward jump's path still follows from.fwd even though it lands facing the new way
  const jumpTo = pose(0, 1, 2, Dir.PY, Dir.PX);
  close(poseAt(Action.Jump, from, jumpTo, 0.5, undefined, { fromFwd: Dir.PZ, progress: 1 }).position, [0, 1 + JUMP_HEIGHT, 1]);
});
