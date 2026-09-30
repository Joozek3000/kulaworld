import * as THREE from 'three';
import type { Level } from '@kula/shared';
import { levelBounds, LevelView } from './level.ts';
import { TrapsView } from './traps.ts';
import { createEnvironment } from './scene.ts';
import { staticLevel, Traps2View } from './traps2.ts';

const W = 320, H = 200;
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
const keyGeo = new THREE.SphereGeometry(0.28, 12, 8);
const keyMat = new THREE.MeshStandardMaterial({ color: 0xe8b04a, emissive: 0x6a4000, roughness: 0.3 });
const exitMat = new THREE.MeshStandardMaterial({ color: 0x5fd6a4, emissive: 0x0b5a3a, roughness: 0.3 });

/**
 * Lobby card preview (phase 14): the level from a fixed 3/4 angle, rendered once by a small offscreen renderer and
 * cached per level as a data URL.
 */
export function levelPreview(level: Level): string {
  const hit = cache.get(level.id);
  if (hit) return hit;
  renderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const blocks = new LevelView(staticLevel(level)), traps = new TrapsView(level), traps2 = new Traps2View(level);
  traps2.update(0, (group) => !!level.lasers.find((laser) => laser.group === group)?.on, null, 0);
  scene.add(blocks.group, traps.group, traps2.group);
  for (const [p, mat] of [...level.keys.map((k) => [k, keyMat] as const), ...(level.exit ? [[level.exit, exitMat] as const] : [])]) {
    const m = new THREE.Mesh(keyGeo, mat);
    m.castShadow = m.receiveShadow = true;
    m.position.set(p.cell.x, p.cell.y, p.cell.z);
    scene.add(m);
  }

  const { center, radius } = levelBounds(level);
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 500);
  camera.position.copy(center).add(new THREE.Vector3(1, 0.85, 1.25).normalize().multiplyScalar(radius * 2.5));
  camera.lookAt(center);
  scene.add(camera);
  const environment = createEnvironment(scene, camera, renderer);
  environment.set(level.id);
  environment.fit(center, radius);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.85);
  blocks.dispose();
  traps.dispose();
  traps2.dispose();
  environment.dispose();
  cache.set(level.id, url);
  return url;
}
