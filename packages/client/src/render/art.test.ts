import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ALL_DIRS, crumbleBands, dirVec, loadLevel, spikesUp, type LevelJson } from '@kula/shared';
import { art, BALL_MODELS, BLOCK_MODELS, environmentFor, loadArt, MODEL_NAMES } from './art.ts';
import { findLevel, LevelView } from './level.ts';
import { ItemsView } from './items.ts';
import { TrapsView } from './traps.ts';
import { staticLevel } from './traps2.ts';
import type { GameState, ItemS } from '../net.ts';

beforeAll(async () => {
  vi.stubGlobal('self', globalThis);
  // Node parses actual GLB geometry/materials; browser smoke checks decode their embedded PNGs.
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
    const texture = new THREE.Texture<HTMLImageElement>();
    queueMicrotask(() => onLoad?.(texture));
    return texture;
  });
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url) => {
    const bytes = await readFile(new URL(`../../public${url}`, import.meta.url));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  });
  vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(new THREE.Texture());
  await loadArt();
});
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  const files = import.meta.glob<LevelJson>('../../../../levels/*.json', { eager: true, import: 'default' });
  for (const json of Object.values(files)) {
    const level = staticLevel(loadLevel(json));
    const view = new LevelView(level);
    const meshes = view.group.children as THREE.InstancedMesh[];
    const seen = new Set<string>();
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    for (const mesh of meshes) {
      (mesh.userData.cells as string[]).forEach((cell, slot) => {
        mesh.getMatrixAt(slot, matrix);
        position.setFromMatrixPosition(matrix);
        expect(position.toArray().join(',')).toBe(cell);
        seen.add(cell);
      });
    }
    expect(seen).toEqual(level.solid);
    if (level.crumble) {
      const removed = crumbleBands(level)[0];
      view.update(0, 0, 0);
      const colour = new THREE.Color();
      const mesh = meshes.find((m) => m.userData.cells.includes(removed[0]))!;
      mesh.getColorAt(mesh.userData.cells.indexOf(removed[0]), colour);
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

test('textured environment blocks retain unit scale and each map family selects its sky', () => {
  for (const name of BLOCK_MODELS) {
    const parts = art.blocks[name]!;
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.some((part) => part.material.map && part.material.normalMap && part.material.roughnessMap)).toBe(true);
    const size = new THREE.Box3().setFromObject(art.models[name]!).getSize(new THREE.Vector3());
    size.toArray().forEach((n) => { expect(n).toBeGreaterThanOrEqual(0.999); expect(n).toBeLessThan(1.06); });
  }
  expect(art.blocks['block-fire']).toHaveLength(3); // all six X marks batch into two materials plus the core
  for (const [id, sky] of [['race-01', 'peach-dawn'], ['arena-02', 'teal-moon'], ['race-03', 'amber-afterglow']]) {
    expect(environmentFor(id).id).toBe(sky);
    expect(art.skies[sky]?.mapping).toBe(THREE.EquirectangularReflectionMapping);
  }
});

test('trap models align on every face and spikes swap on their existing tick boundaries', () => {
  const original = findLevel('traps-lab')!;
  const template = original.tiles.find((t) => t.type === 'spikes' && t.period)!;
  for (const face of ALL_DIRS) {
    const dir = ALL_DIRS.find((d) => d >> 1 !== face >> 1)!;
    const tile = { ...template, face, dir, block: { x: 0, y: 0, z: 0 } };
    const view = new TrapsView({ ...original, tiles: [tile, { ...tile, type: 'arrow' }, { ...tile, type: 'boost', variant: 'high' }] });
    for (const group of view.group.children) {
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion).distanceTo(new THREE.Vector3().copy(dirVec(face)))).toBeLessThan(1e-6);
      expect(group.position.distanceTo(new THREE.Vector3().copy(dirVec(face)).multiplyScalar(0.5))).toBeLessThan(1e-6);
    }
    for (const group of view.group.children.slice(1)) {
      expect(new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion).distanceTo(new THREE.Vector3().copy(dirVec(dir)))).toBeLessThan(1e-6);
    }
    for (let tick = 0; tick <= tile.period; tick++) {
      view.update(tick, tick, new Map(), [], 0.05, tick / 20);
      expect(view.group.children[0].children.map((o) => o.visible)).toEqual([spikesUp(tile, tick), !spikesUp(tile, tick)]);
    }
    view.dispose();
  }
});

test('crumble model disappears, emits eight shards once and regrows; boost glow stays local', () => {
  const level = findLevel('traps-lab')!, blocks = new LevelView(staticLevel(level)), traps = new TrapsView(level);
  const cell = level.tiles.find((tile) => tile.type === 'crumble')!.block;
  const key = `${cell.x},${cell.y},${cell.z}`, state = new Map([[key, 10]]);
  const crumble = blocks.group.children.find((o) => o.name === 'block-crumble') as THREE.InstancedMesh;
  const slot = crumble.userData.cells.indexOf(key), matrix = new THREE.Matrix4();
  blocks.updateTraps(state, 9, 0.45);
  expect(blocks.solid(cell.x, cell.y, cell.z)).toBe(true);
  blocks.updateTraps(state, 10, 0.5);
  crumble.getMatrixAt(slot, matrix);
  expect(matrix.determinant()).toBe(0);
  expect(blocks.solid(cell.x, cell.y, cell.z)).toBe(false);
  const before = traps.group.children.length;
  traps.update(10, 10, state, [], 0.05, 0.5);
  expect(traps.group.children.length).toBe(before + 8);
  traps.update(11, 11, state, [], 0.05, 0.55);
  expect(traps.group.children.length).toBe(before + 8);
  traps.update(30, 30, state, [], 0.05, 1.5);
  expect(traps.group.children.length).toBe(before);
  blocks.updateTraps(new Map(), 31, 1.55);
  blocks.updateTraps(new Map(), 40, 2);
  crumble.getMatrixAt(slot, matrix);
  expect(matrix.determinant()).toBeCloseTo(1);
  expect(blocks.solid(cell.x, cell.y, cell.z)).toBe(true);
  const tile = level.tiles.find((t) => t.type === 'boost')!, up = dirVec(tile.face!);
  const pose = { cell: { x: tile.block.x + up.x, y: tile.block.y + up.y, z: tile.block.z + up.z }, up: tile.face!, fwd: tile.dir! };
  const source = art.models['pad-boost-far']!.getObjectByName('pad-enamel') as THREE.Mesh;
  const material = source.material as THREE.MeshStandardMaterial, oldGlow = material.emissiveIntensity;
  traps.update(40, 40, new Map(), [], 0.1, 2, [pose]);
  const glowing: number[] = [];
  traps.group.traverse((o) => { if (o instanceof THREE.Mesh && o.name.startsWith('pad-enamel')) glowing.push(o.material.emissiveIntensity); });
  expect(Math.max(...glowing)).toBeGreaterThan(1);
  expect(Math.min(...glowing)).toBeCloseTo(0.1);
  expect(material.emissiveIntensity).toBe(oldGlow);
  blocks.dispose(); traps.dispose();
});

test('missing environment assets retain playable primitive traps and blocks', () => {
  const models = art.models, textured = art.blocks;
  try {
    art.models = {}; art.blocks = {};
    const level = findLevel('traps-lab')!, blocks = new LevelView(staticLevel(level)), traps = new TrapsView(level);
    expect(blocks.group.children.length).toBeGreaterThan(0);
    expect(traps.group.children.length).toBeGreaterThan(level.tiles.filter((t) => t.type === 'boost').length);
    expect(() => {
      blocks.update(0, -1, 1);
      blocks.updateTraps(new Map(), 20, 1);
      traps.update(20, 20, new Map(), [], 0.05, 1);
    }).not.toThrow();
    blocks.dispose(); traps.dispose();
  } finally { art.models = models; art.blocks = textured; }
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
