import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Action, ALL_DIRS, dirVec, perpendicular, poseAt, turnFwd, vec, type Pose } from '@kula/shared';
import { clampToOpen, dampAlpha, followTarget } from './camera.ts';

const pairs = ALL_DIRS.flatMap((u) => ALL_DIRS.filter((f) => perpendicular(u, f)).map((f) => [u, f] as const));
const v3 = (d: { x: number; y: number; z: number }) => new THREE.Vector3(d.x, d.y, d.z);

describe('follow camera', () => {
  test.each(pairs)('up %i fwd %i: screen-right is the sim right turn, camera up leans along U, looks along F', (up, fwd) => {
    const p: Pose = { cell: vec(3, 4, 5), up, fwd };
    const pos = new THREE.Vector3(), q = new THREE.Quaternion();
    followTarget(poseAt(Action.Idle, p, p, 0), pos, q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    expect(right.distanceTo(v3(dirVec(turnFwd(up, fwd, 1))))).toBeLessThan(1e-9);
    expect(camUp.dot(v3(dirVec(up)))).toBeGreaterThan(0.5);
    expect(look.dot(v3(dirVec(fwd)))).toBeGreaterThan(0.5);
    // behind and above the ball
    const rel = pos.sub(v3(p.cell));
    expect(rel.dot(v3(dirVec(fwd)))).toBeCloseTo(-4);
    expect(rel.dot(v3(dirVec(up)))).toBeCloseTo(2.5);
  });

  test('camera up turns smoothly through a flip (no roll or gimbal flip)', () => {
    const from: Pose = { cell: vec(0, 1, 0), up: 2, fwd: 4 }; // +Y, +Z
    const to: Pose = { cell: vec(0, 0, 1), up: 4, fwd: 3 }; // +Z, -Y
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), prev = new THREE.Quaternion();
    for (let i = 0; i <= 20; i++) {
      followTarget(poseAt(Action.Flip, from, to, i / 20), pos, q);
      if (i) expect(q.angleTo(prev)).toBeLessThan(Math.PI / 2 / 20 + 1e-6); // ≤ one step of the 90° turn
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      expect(right.x).toBeCloseTo(-1); // right stays -X throughout (axis of the flip)
      prev.copy(q);
    }
  });

  test('damping is frame-rate independent', () => {
    const one = dampAlpha(10, 0.032);
    const half = dampAlpha(10, 0.016);
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(one, 12);
  });
});

test('camera ignores hop/jump height', () => {
  const p: Pose = { cell: vec(0, 1, 0), up: 2, fwd: 4 };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion();
  followTarget(poseAt(Action.Hop, p, p, 0), a, q);
  followTarget(poseAt(Action.Hop, p, p, 0.5), b, q);
  expect(a.distanceTo(b)).toBeLessThan(1e-9);
});

test('clampToOpen: stops just before the first solid cell on the way to the camera, else keeps the camera', () => {
  const floor = (_x: number, y: number) => y <= 0; // everything at y <= 0 is solid
  const out = new THREE.Vector3();
  clampToOpen(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -3, 0), floor, out);
  expect(out.y).toBeGreaterThan(0.5); // above the floor's top face (y = 0.5)
  expect(out.y).toBeLessThan(1);
  clampToOpen(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 3, -4), floor, out);
  expect(out.toArray()).toEqual([0, 3, -4]);
});

