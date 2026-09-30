import { expect, test } from 'vitest';
import * as THREE from 'three';
import { ALL_DIRS, dirVec } from '@kula/shared';
import { contactShadowTexture } from './art.ts';
import { fitKeyShadow } from './scene.ts';
import { findLevel } from './level.ts';
import { Traps2View } from './traps2.ts';

test('shadow coverage follows translated levels through all six gravity directions', () => {
  for (const dir of ALL_DIRS) {
    const camera = new THREE.PerspectiveCamera(), key = new THREE.DirectionalLight();
    camera.add(key, key.target);
    const center = new THREE.Vector3(80, -20, 45), radius = 12;
    camera.position.copy(center).add(new THREE.Vector3(0, 18, 26));
    camera.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().copy(dirVec(dir)));
    fitKeyShadow(key, camera, center, radius);
    camera.updateMatrixWorld(true);
    expect(key.target.getWorldPosition(new THREE.Vector3()).distanceTo(center)).toBeLessThan(1e-6);
    key.shadow.updateMatrices(key);
    for (const x of [-radius, radius]) for (const y of [-radius, radius]) for (const z of [-radius, radius]) {
      const projected = center.clone().add(new THREE.Vector3(x, y, z)).project(key.shadow.camera);
      projected.toArray().forEach((value) => expect(Math.abs(value)).toBeLessThan(1));
    }
  }
});

test('contact shadow has a soft radial falloff and fully transparent border', () => {
  const texture = contactShadowTexture(), { data, width, height } = texture.image;
  const alpha = (x: number, y: number) => data![(y * width + x) * 4 + 3];
  expect(alpha(32, 32)).toBeGreaterThan(250);
  expect(alpha(48, 32)).toBeGreaterThan(alpha(58, 32));
  expect(alpha(48, 32)).toBeLessThan(alpha(32, 32));
  for (let i = 0; i < width; i++) {
    expect(alpha(i, 0)).toBe(0); expect(alpha(i, height - 1)).toBe(0);
    expect(alpha(0, i)).toBe(0); expect(alpha(width - 1, i)).toBe(0);
  }
  texture.dispose();
});

test('invisible blocks and vanished ghosts never cast solid shadows', () => {
  const level = findLevel('traps-lab')!, view = new Traps2View(level);
  const block = (cell: string) => view.group.children.find((o) => o instanceof THREE.Mesh && o.position.toArray().join(',') === cell) as THREE.Mesh;
  const [cell, schedule] = [...level.vanish][0];
  view.update(5 - schedule.phase, () => false, null, 0);
  expect(block(cell).castShadow).toBe(true);
  view.update(schedule.on - schedule.phase, () => false, null, 1);
  expect(block(cell).castShadow).toBe(false);
  for (const invisible of level.invisible) expect(block(invisible).castShadow).toBe(false);
  view.dispose();
});
