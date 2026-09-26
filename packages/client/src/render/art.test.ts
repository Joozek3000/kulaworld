import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ALL_DIRS, crumbleBands, dirVec } from '@kula/shared';
import { art, BALL_MODELS, loadArt, MODEL_NAMES } from './art.ts';
import { findLevel, LevelView } from './level.ts';
import { ItemsView } from './items.ts';
import type { GameState, ItemS } from '../net.ts';

beforeAll(async () => {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url) => {
    const bytes = await readFile(new URL(`../../public/models/ceramic-kit-v01/${basename(url)}`, import.meta.url));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  });
  vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(new THREE.Texture());
  await loadArt();
});
afterAll(() => vi.restoreAllMocks());

test('shipped models load at simulation scale with the expected rubber material slots', () => {
  expect(Object.keys(art.models)).toHaveLength(MODEL_NAMES.length);
  expect(art.block).toBeDefined();
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(art.block!).getSize(size);
  size.toArray().forEach((n) => expect(n).toBeCloseTo(1, 5));
  for (const name of BALL_MODELS) {
    const model = art.models[name]!;
    new THREE.Box3().setFromObject(model).getSize(size);
    size.toArray().forEach((n) => expect(n).toBeCloseTo(0.8, 4));
    const materials = new Set<string>();
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        expect(Array.isArray(o.material)).toBe(false);
        materials.add((o.material as THREE.Material).name);
      }
    });
    expect(materials.size).toBe(2);
    expect([...materials].some((name) => name.includes('warm white'))).toBe(true);
  }
});

test('all current maps retain cell positions and crumble removes the same solid cells', () => {
  for (const id of ['arena-01', 'arena-02', 'arena-cube', 'race-01', 'test-cube', 'test-flat', 'test-stomp']) {
    const level = findLevel(id)!;
    const view = new LevelView(level);
    const mesh = view.group.children[0] as THREE.InstancedMesh;
    expect(mesh.geometry).toBe(art.block!.geometry);
    expect(mesh.count).toBe(level.solid.size);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    [...level.solid].forEach((cell, i) => {
      mesh.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      expect(position.toArray().join(',')).toBe(cell);
    });
    if (level.crumble) {
      const removed = crumbleBands(level)[0];
      view.update(0, 0, 0);
      const colour = new THREE.Color();
      mesh.getColorAt([...level.solid].indexOf(removed[0]), colour);
      expect(colour.getHex()).toBe(0xff3b3b);
      view.update(1, -1, 1);
      for (const cell of removed) {
        const [x, y, z] = cell.split(',').map(Number);
        expect(view.solid(x, y, z)).toBe(false);
      }
      view.update(0, -1, 2);
      expect(view.solid(...removed[0].split(',').map(Number) as [number, number, number])).toBe(true);
    }
    view.dispose();
  }
});

test('ceramic gates align on all six faces; key pops keep other keys opaque', () => {
  for (const direction of ALL_DIRS) {
    const scene = new THREE.Scene(), items = new ItemsView(scene);
    const exit: ItemS = { id: 'exit', kind: 'exit', x: 0, y: 0, z: 0, up: direction };
    const key: ItemS = { ...exit, id: 'key', kind: 'key' };
    const keep: ItemS = { ...key, id: 'keep', x: 2 };
    const state = { phase: 'playing', items: new Map([['exit', exit], ['key', key], ['keep', keep]]) } as unknown as GameState;
    items.update(state, true, false, 0);
    const gate = scene.children[0], pop = scene.children[1], remaining = scene.children[2];
    const normal = new THREE.Vector3().copy(dirVec(direction));
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(gate.quaternion).distanceTo(normal)).toBeLessThan(1e-6);
    expect(gate.position.distanceTo(normal.multiplyScalar(-0.5))).toBeLessThan(1e-6);
    expect(gate.children.map((o) => o.visible)).toEqual([true, false]);
    (state.items as Map<string, ItemS>).delete('key');
    items.update(state, true, true, 1);
    expect(gate.children.map((o) => o.visible)).toEqual([false, true]);
    items.update(state, true, true, 1.2);
    pop.traverse((o) => { if (o instanceof THREE.Mesh) expect(o.material.opacity).toBeLessThan(1); });
    remaining.traverse((o) => { if (o instanceof THREE.Mesh) expect(o.material.opacity).toBe(1); });
    items.update(state, true, true, 1.4);
    expect(scene.children).not.toContain(pop);
  }
});
