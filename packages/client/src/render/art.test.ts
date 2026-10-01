import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ALL_DIRS, BALL_RADIUS, crumbleBands, dirVec, loadLevel, spikesUp, type LevelJson } from '@kula/shared';
import { art, BALL_MODELS, BLOCK_MODELS, environmentFor, loadArt, MODEL_NAMES } from './art.ts';
import { findLevel, LevelView } from './level.ts';
import { ItemsView } from './items.ts';
import { PlayersView, crownScale, CROWN_BOB, CROWN_GAP } from './players.ts';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { TrapsView } from './traps.ts';
import { staticLevel } from './traps2.ts';
import type { GameState, ItemS, PlayerS } from '../net.ts';

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
    // 19c: the pop rises clear of the ball that took it (its top is BALL_RADIUS - 0.1 above the cell centre), not over it.
    for (const t of [1.25, 1.3]) {
      items.update(state, true, true, t);
      const box = new THREE.Box3().setFromObject(pop), n = dirVec(direction);
      const low = Math.min(...[box.min, box.max].map((c) => c.x * n.x + c.y * n.y + c.z * n.z));
      expect(low, `${direction} at ${t}`).toBeGreaterThan(BALL_RADIUS - 0.1);
    }
    remaining.traverse((o) => { if (o instanceof THREE.Mesh) expect(o.material.opacity).toBe(1); });
    items.update(state, true, true, 1.4);
    expect(scene.children).not.toContain(pop);
  }
});

test('x-ray (18b): only your own ball has a silhouette; enemy balls, keys, the exit and the crown have none', () => {
  // Name labels are CSS2D objects: a stand-in element is enough in node.
  vi.stubGlobal('document', { createElement: () => ({ style: {}, setAttribute() {}, remove() {} }) });
  const hasXray = (o: THREE.Object3D) => { let x = false; o.traverse((c) => { if (c.userData.xray) x = true; }); return x; };
  const scene = new THREE.Scene(), view = new PlayersView(scene);
  const P = (id: string, x: number) => ({
    id, name: id, color: '#ff4040', action: 0, fromX: x, fromY: 1, fromZ: 0, fromUp: 2, fromFwd: 0, toX: x, toY: 1, toZ: 0, toUp: 2, toFwd: 0,
    startTick: 0, endTick: 0, turnFromFwd: 0, turnStartTick: 0, bounce: false, keys: 0, ready: false, spectating: false, lives: 3, eliminated: false,
    eliminatedTick: -1, eliminatedBy: '', protectedUntil: 0, knockouts: 0, ackSeq: 0, ackTick: 0, fireCount: 0, vote: -1,
  }) as PlayerS;
  const state = { phase: 'playing', tick: 10, players: new Map([['me', P('me', 0)], ['foe', P('foe', 3)]]), items: new Map(), pickups: new Map(), hot: new Map() } as unknown as GameState;
  view.crownId = 'foe';
  view.update(state, 10, 'me', 10, 0.016, 1000);
  const before = new Set(scene.children);
  const balls = scene.children.filter((o) => o.children.length && !(o instanceof THREE.Mesh) && hasXray(o));
  expect(balls).toHaveLength(1); // the local ball
  expect(view.positionOf('me')!.distanceTo(balls[0].position)).toBeLessThan(1e-6);
  const crown = scene.children.find((o) => o instanceof THREE.Group && o.visible && o.children.length === 11);
  expect(crown).toBeDefined();
  expect(hasXray(crown!)).toBe(false);
  expect(scene.children.find((o) => o instanceof CSS2DObject)?.element.textContent).toBe('👑 foe'); // the crowned player's label
  const items = new ItemsView(scene);
  const key: ItemS = { id: 'k', kind: 'key', x: 0, y: 0, z: 0, up: 2 }, exit: ItemS = { ...key, id: 'exit', kind: 'exit' };
  items.update({ phase: 'playing', items: new Map([['k', key], ['exit', exit]]) } as unknown as GameState, true, false, 0);
  const added = scene.children.filter((o) => !before.has(o));
  expect(added.length).toBeGreaterThanOrEqual(2);
  for (const o of added) expect(hasXray(o)).toBe(false);
  vi.unstubAllGlobals(); vi.stubGlobal('self', globalThis);
});

test('line of sight (18c): an occluded ball\'s label and crown hide; a visible one\'s label shows', () => {
  vi.stubGlobal('document', { createElement: () => ({ style: {}, setAttribute() {}, remove() {} }) });
  const scene = new THREE.Scene(), view = new PlayersView(scene);
  const P = (id: string, x: number) => ({
    id, name: id, color: '#ff4040', action: 0, fromX: x, fromY: 1, fromZ: 0, fromUp: 2, fromFwd: 0, toX: x, toY: 1, toZ: 0, toUp: 2, toFwd: 0,
    startTick: 0, endTick: 0, turnFromFwd: 0, turnStartTick: 0, bounce: false, keys: 0, ready: false, spectating: false, lives: 3, eliminated: false,
    eliminatedTick: -1, eliminatedBy: '', protectedUntil: 0, knockouts: 0, ackSeq: 0, ackTick: 0, fireCount: 0, vote: -1,
  }) as PlayerS;
  const state = { phase: 'playing', tick: 10, players: new Map([['me', P('me', 0)], ['foe', P('foe', 6)]]), items: new Map(), pickups: new Map(), hot: new Map() } as unknown as GameState;
  view.crownId = 'foe';
  const label = () => scene.children.find((o) => o instanceof CSS2DObject)!.element.style.opacity;
  const crown = () => scene.children.find((o) => o instanceof THREE.Group && o.children.length === 11)!;
  const camera = new THREE.Vector3(6, -5, 0); // under the floor
  const floor = (x: number, y: number, z: number) => y === 0 && z === 0 && x >= -2 && x <= 8;
  view.update(state, 10, 'me', 10, 0.016, 1000);
  expect(label()).toBe('0'); // hidden until the first check
  view.updateSight(camera, 1000, floor);
  expect(label()).toBe('0');
  expect(crown().visible).toBe(false);
  // Checked again only after ~100 ms: the camera comes up over the floor and the label fades back in.
  camera.set(6, 5, 4);
  view.updateSight(camera, 1050, floor);
  expect(label()).toBe('0');
  view.update(state, 10, 'me', 10, 0.016, 1200);
  view.updateSight(camera, 1200, floor);
  expect(label()).toBe('1');
  expect(crown().visible).toBe(true);
  // Phase 19: the crown grows with the camera's distance (≈6.5 cells here), and is 1.2× close up.
  expect(crown().scale.x).toBeCloseTo(crownScale(crown().position.distanceTo(camera)));
  expect(crown().scale.x).toBeGreaterThan(1.2);
  expect(crown().scale.x).toBeLessThan(2.3);
  camera.copy(crown().position).add(new THREE.Vector3(0, 1, 2));
  view.updateSight(camera, 1400, floor);
  expect(crown().scale.x).toBeCloseTo(1.2);
  vi.unstubAllGlobals(); vi.stubGlobal('self', globalThis);
});

test('crown scale (phase 19): 1.2× within 3 cells, 2.3× from 8, smooth between', () => {
  expect(crownScale(0)).toBe(1.2);
  expect(crownScale(3)).toBe(1.2);
  expect(crownScale(5.5)).toBeCloseTo(1.75);
  expect(crownScale(8)).toBeCloseTo(2.3);
  expect(crownScale(20)).toBeCloseTo(2.3);
  for (let d = 0; d < 10; d += 0.25) expect(crownScale(d + 0.25)).toBeGreaterThanOrEqual(crownScale(d));
});

/** Phase 19b: a stand-in PlayerS on cell (x, 1, z), standing on +Y. */
const P19 = (id: string, x: number, z = 0, protectedUntil = 0) => ({
  id, name: id, color: '#ff4040', action: 0, fromX: x, fromY: 1, fromZ: z, fromUp: 2, fromFwd: 0, toX: x, toY: 1, toZ: z, toUp: 2, toFwd: 0,
  startTick: 0, endTick: 0, turnFromFwd: 0, turnStartTick: 0, bounce: false, keys: 0, ready: false, spectating: false, lives: 3, eliminated: false,
  eliminatedTick: -1, eliminatedBy: '', protectedUntil, knockouts: 0, ackSeq: 0, ackTick: 0, fireCount: 0, vote: -1,
}) as PlayerS;
const state19 = (...ps: PlayerS[]) => ({ phase: 'playing', tick: 10, players: new Map(ps.map((p) => [p.id, p])), items: new Map(), pickups: new Map(), hot: new Map() }) as unknown as GameState;

test('crown (19b): seated on the ball, a gap of at most 0.15 ball radius, at every distance scale', () => {
  vi.stubGlobal('document', { createElement: () => ({ style: {}, setAttribute() {}, remove() {} }) });
  const scene = new THREE.Scene(), view = new PlayersView(scene);
  view.crownId = 'foe';
  const crown = () => scene.children.find((o) => o instanceof THREE.Group && o.children.length === 11)!;
  const box = new THREE.Box3();
  expect(CROWN_GAP + CROWN_BOB).toBeLessThanOrEqual(0.15 * BALL_RADIUS);
  for (const t of [1000, 1250, 1500, 1750, 2000]) { // through the bob
    view.update(state19(P19('me', 0), P19('foe', 3)), 10, 'me', 10, 0.016, t);
    const top = view.positionOf('foe')!.y + BALL_RADIUS;
    for (const dist of [1, 5, 12]) {
      crown().scale.setScalar(crownScale(dist));
      crown().updateMatrixWorld(true);
      const gap = box.setFromObject(crown()).min.y - top;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(0.15 * BALL_RADIUS + 1e-6);
    }
  }
  vi.unstubAllGlobals(); vi.stubGlobal('self', globalThis);
});

/**
 * Software raster of one pixel (19b render test), with the real meshes and materials: three's draw order (opaque by
 * renderOrder then near to far, then transparent by renderOrder then far to near), LessEqual depth, stencil Replace on
 * a z-pass. True if the local ball's silhouette draws on the ray from `from` to `to`.
 */
function silhouetteAt(scene: THREE.Scene, from: THREE.Vector3, to: THREE.Vector3): boolean {
  scene.updateMatrixWorld(true);
  const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));
  const hits = new Map<THREE.Mesh, number>();
  for (const h of new THREE.Raycaster(from, to.clone().sub(from).normalize()).intersectObjects(scene.children, true)) {
    if (h.object instanceof THREE.Mesh && shown(h.object) && !hits.has(h.object)) hits.set(h.object, h.distance);
  }
  const ball = [...hits.keys()].find((m) => m.children.some((c) => c.userData.xray));
  if (!ball) return false;
  const xray = ball.children.find((c) => c.userData.xray) as THREE.Mesh;
  hits.set(xray, hits.get(ball)!);
  const mat = (m: THREE.Mesh) => m.material as THREE.Material;
  const order = [...hits].sort(([a, da], [b, db]) => (mat(a).transparent !== mat(b).transparent ? (mat(a).transparent ? 1 : -1)
    : a.renderOrder - b.renderOrder || (mat(a).transparent ? db - da : da - db)));
  let depth = Infinity, stencil = 0;
  for (const [m, d] of order) {
    const M = mat(m);
    if (m === xray) return d - (M.userData.depthBias ?? 0) > depth && (!M.stencilWrite || M.stencilFunc !== THREE.EqualStencilFunc || stencil === M.stencilRef);
    if (M.stencilWrite && M.stencilFunc !== THREE.AlwaysStencilFunc) continue; // not used by anything else here
    if (d > depth) continue;
    if (M.depthWrite) depth = d;
    if (M.stencilWrite && M.stencilZPass === THREE.ReplaceStencilOp) stencil = M.stencilRef;
  }
  return false;
}

test('own-ball silhouette (19b): only through level blocks, never over an enemy ball, a ghost ball or the crown', () => {
  vi.stubGlobal('document', { createElement: () => ({ style: {}, setAttribute() {}, remove() {} }) });
  // A floor, and a wall block at x=2 between the camera (x=7) and your ball (x=0).
  const json = { id: 'xray-19b', name: 'x', version: 1, boxes: [{ min: [-1, 0, -1], max: [6, 0, 6] }], blocks: [[2, 1, 0]],
    spawns: [{ cell: [0, 1, 0], up: '+Y', fwd: '+X' }] } as unknown as LevelJson;
  const setup = (foe: PlayerS, crowned = false) => { // a fresh view per case: a segment with the same ticks isn't re-read
    const scene = new THREE.Scene(), view = new PlayersView(scene);
    scene.add(new LevelView(staticLevel(loadLevel(json))).group);
    if (crowned) view.crownId = 'foe';
    view.update(state19(P19('me', 0), foe), 10, 'me', 10, 0.016, 1000);
    return { scene, me: view.positionOf('me')!.clone() };
  };
  const eye = new THREE.Vector3(7, 0.9, 0);
  let { scene, me } = setup(P19('foe', 4, 5));
  expect(silhouetteAt(scene, eye, me)).toBe(true); // hidden by the wall only
  expect(silhouetteAt(scene, new THREE.Vector3(0, 6, 0), me)).toBe(false); // in plain view
  ({ scene, me } = setup(P19('foe', 4, 0)));
  expect(silhouetteAt(scene, eye, me)).toBe(false); // the enemy ball is in front of the wall
  ({ scene, me } = setup(P19('foe', 4, 0, 99)));
  expect(silhouetteAt(scene, eye, me)).toBe(false); // a ghost (transparent) enemy ball, too
  ({ scene, me } = setup(P19('foe', 4, 0), true));
  const crown = scene.children.find((o) => o instanceof THREE.Group && o.children.length === 11)!;
  const c = new THREE.Box3().setFromObject(crown).getCenter(new THREE.Vector3());
  expect(silhouetteAt(scene, c.clone().addScaledVector(c.clone().sub(me).normalize(), 3), me)).toBe(false); // through the crown
  vi.unstubAllGlobals(); vi.stubGlobal('self', globalThis);
});

test('own-ball silhouette (19c): never from the tile the ball rests on, even dipped into it, on flat ground and on ice', () => {
  vi.stubGlobal('document', { createElement: () => ({ style: {}, setAttribute() {}, remove() {} }) });
  for (const ice of [false, true]) {
    const json = { id: 'xray-19c', name: 'x', version: 1, boxes: [{ min: [-6, 0, -3], max: [6, 0, 3] }], blocks: [[3, 1, 3]],
      tiles: ice ? [{ block: [0, 0, 0], type: 'ice' }] : [], spawns: [{ cell: [0, 1, 0], up: '+Y', fwd: '+X' }] } as unknown as LevelJson;
    const scene = new THREE.Scene(), view = new PlayersView(scene), level = loadLevel(json);
    scene.add(new LevelView(staticLevel(level)).group);
    const traps = new TrapsView(level);
    scene.add(traps.group);
    view.update(state19(P19('me', 0), P19('foe', -5, 3)), 10, 'me', 10, 0.016, 1000);
    const me = view.positionOf('me')!.clone();
    const bottom = me.y - BALL_RADIUS;
    for (const dip of [0, 0.03, 0.08]) { // resting, a squash, a hard landing (mid-bounce the ball is above the tile)
      const ball = scene.children.find((o) => { let x = false; o.traverse((c) => { if (c.userData.xray) x = true; }); return x; })!;
      ball.position.y -= dip;
      for (const [eye, aim] of [[new THREE.Vector3(-6, bottom + 1.3, 0), 0.01], [new THREE.Vector3(-3, bottom + 2, 2), 0.005]] as const) {
        // aim at the ball just under the tile top: the ray crosses the tile first, then the dipped ball
        const target = new THREE.Vector3(me.x, bottom - dip + aim, me.z);
        expect(silhouetteAt(scene, eye, target), `ice ${ice} dip ${dip}`).toBe(false);
      }
      ball.position.y += dip;
    }
    expect(silhouetteAt(scene, new THREE.Vector3(0, -4, 0), me)).toBe(true); // from under the floor it still shows
  }
  vi.unstubAllGlobals(); vi.stubGlobal('self', globalThis);
});
