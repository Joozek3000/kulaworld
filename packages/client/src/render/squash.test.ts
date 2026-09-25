import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { voiceToDrop } from '../audio/engine.ts';
import { applySquash, Spring } from './squash.ts';

describe('squash spring', () => {
  const run = (fps: number) => {
    const s = new Spring();
    s.kick(-0.3);
    const samples: number[] = [];
    for (let t = 0; t < 1; t += 1 / fps) { s.step(1 / fps, 0, 300, 12); samples.push(s.x); }
    return { end: s.x, overshoot: Math.max(...samples) };
  };

  test('frame-rate independent: the same jiggle at 30 and 144 fps', () => {
    const a = run(30), b = run(144);
    expect(a.overshoot).toBeCloseTo(b.overshoot, 2);
    expect(Math.abs(a.end)).toBeLessThan(0.01);
  });

  test('a landing squash springs back past rest (visible jiggle)', () => {
    expect(run(60).overshoot).toBeGreaterThan(0.05);
  });
});

test('squash preserves volume and keeps the axis in world space', () => {
  const outer = new THREE.Group(), inner = new THREE.Group();
  outer.add(inner);
  const axis = new THREE.Vector3(1, 0, 0);
  applySquash(outer, inner, axis, 0.7, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.2));
  expect(outer.scale.x * outer.scale.y * outer.scale.z).toBeCloseTo(1);
  outer.updateMatrixWorld();
  // Local Y lies on the axis and shrinks to 0.7; a perpendicular direction grows by 1/√0.7.
  const m = outer.matrixWorld;
  const along = new THREE.Vector3(0, 1, 0).applyMatrix4(m), across = new THREE.Vector3(0, 0, 1).applyMatrix4(m);
  expect(along.x).toBeCloseTo(0.7);
  expect(across.length()).toBeCloseTo(1 / Math.sqrt(0.7));
});

test('voice cap drops the quietest, or skips a new sound quieter than all', () => {
  expect(voiceToDrop([0.5, 0.2], 0.1, 3)).toBe(null);
  expect(voiceToDrop([0.5, 0.2, 0.8], 0.3, 3)).toBe(1);
  expect(voiceToDrop([0.5, 0.2, 0.8], 0.1, 3)).toBe(-1);
});
