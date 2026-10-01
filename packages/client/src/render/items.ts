import * as THREE from 'three';
import { dirVec, type Dir } from '@kula/shared';
import type { GameState, ItemS } from '../net.ts';
import { art } from './art.ts';

const keyGeo = new THREE.OctahedronGeometry(0.22);
const keyMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x6b5200, roughness: 0.3, metalness: 0.4 });
const exitGeo = new THREE.TorusGeometry(0.34, 0.07, 12, 32);
const LOCKED = new THREE.Color(0x70748a), UNLOCKED = new THREE.Color(0x3ddc6f);
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const up = new THREE.Vector3(), align = new THREE.Quaternion(), spin = new THREE.Quaternion();
const POP_SEC = 0.35;
/** 19c: a pop rises this far along the tile's up (and as far again while it lasts): above the ball that took it, not over it. */
export const POP_RISE = 0.5;
// Single-player items (phase 15b, §22): placeholder primitives in flat colours.
const coinGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 20).rotateX(Math.PI / 2);
const gemGeo = new THREE.OctahedronGeometry(0.2).scale(1, 1.4, 1);
const fruitGeo = new THREE.SphereGeometry(0.17, 16, 12);
const glassGeo = new THREE.ConeGeometry(0.14, 0.2, 14);
const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.3, ...extra });
const coinMat = mat(0xf2c230, { metalness: 0.6, emissive: 0x4a3500 }), gemMat = mat(0x3fd0ff, { emissive: 0x0a3a55, roughness: 0.1 });
const glassMat = mat(0xf6e7c8, { emissive: 0x3a2a10 });
/** cherry, apple, banana, melon, grape (FRUITS order). */
const FRUIT_MATS = [0xd7263d, 0x7ac74f, 0xf5d547, 0x9be58b, 0x7b3fa0].map((c) => mat(c));
function scoreItem(kind: string): THREE.Object3D {
  if (kind === 'coin') return new THREE.Mesh(coinGeo, coinMat);
  if (kind === 'gem') return new THREE.Mesh(gemGeo, gemMat);
  if (kind === 'hourglass') {
    const g = new THREE.Group(), top = new THREE.Mesh(glassGeo, glassMat), bottom = new THREE.Mesh(glassGeo, glassMat);
    top.rotation.x = Math.PI;
    top.position.y = 0.1;
    bottom.position.y = -0.1;
    return g.add(top, bottom);
  }
  return new THREE.Mesh(fruitGeo, FRUIT_MATS[Number(kind.slice(6))] ?? FRUIT_MATS[0]); // 'fruit-N'
}

/** Spinning ceramic keys and a gate with distinct locked/open models on any gravity face. */
export class ItemsView {
  /** Keyed by id + cell, so a rotated level's exit (same id, new place) gets a new mesh. */
  private meshes = new Map<string, THREE.Object3D>();
  private popping: { mesh: THREE.Object3D; materials: THREE.Material[]; start: number; lift: number }[] = [];
  private exitMat = new THREE.MeshStandardMaterial({ color: LOCKED, roughness: 0.4 });
  /** 0..1: keys, the exit and score items grow and bob (the level fly-over, phase 17). */
  highlight = 0;

  constructor(private scene: THREE.Scene) {}

  update(state: GameState, visible: boolean, unlocked: boolean, timeSec: number): void {
    const live = new Set<string>();
    state.items.forEach((item, id) => {
      const key = `${id}@${item.x},${item.y},${item.z}`;
      live.add(key);
      let m = this.meshes.get(key);
      if (!m) this.meshes.set(key, (m = this.create(item)));
      m.visible = visible;
      const h = this.highlight;
      m.scale.setScalar(1 + h * (0.8 + 0.2 * Math.sin(timeSec * 6)));
      if (item.kind !== 'exit') { // keys and score items spin about their up
        up.copy(dirVec(item.up as Dir) as THREE.Vector3Like);
        m.quaternion.setFromUnitVectors(Y, up).multiply(spin.setFromAxisAngle(Y, timeSec * 2));
      } else if (m instanceof THREE.Group) {
        m.children[0].visible = !unlocked;
        m.children[1].visible = unlocked;
      }
    });
    for (const [key, m] of this.meshes) {
      if (live.has(key)) continue;
      this.meshes.delete(key);
      // A key or score item collected mid-round pops; anything else (new round, level change) just goes.
      if (state.phase === 'playing' && m.userData.kind !== 'exit') {
        const materials: THREE.Material[] = [];
        const clone = (source: THREE.Material) => {
          const material = source.clone();
          material.transparent = true;
          materials.push(material);
          return material;
        };
        m.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = false;
            object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
          }
        });
        this.popping.push({ mesh: m, materials, start: timeSec, lift: 0 });
      } else this.scene.remove(m);
    }
    this.popping = this.popping.filter((p) => {
      const { mesh, materials, start } = p, t = (timeSec - start) / POP_SEC;
      if (t >= 1) { this.scene.remove(mesh); materials.forEach((m) => m.dispose()); return false; }
      mesh.scale.setScalar(1 + t * 1.5);
      mesh.translateY(POP_RISE * (1 + t) - p.lift); // keys and score items: local +Y is the tile's up
      p.lift = POP_RISE * (1 + t);
      materials.forEach((m) => { m.opacity = 1 - t; });
      return true;
    });
    this.exitMat.color.copy(unlocked ? UNLOCKED : LOCKED);
  }

  private create(item: ItemS): THREE.Object3D {
    up.copy(dirVec(item.up as Dir) as THREE.Vector3Like);
    const exit = item.kind === 'exit';
    let m: THREE.Object3D;
    if (exit && art.models['exit-locked'] && art.models['exit-open']) {
      m = new THREE.Group().add(art.models['exit-locked'].clone(true), art.models['exit-open'].clone(true));
    } else if (item.kind !== 'key' && !exit) m = scoreItem(item.kind);
    else if (!exit && art.models['key-marigold']) m = art.models['key-marigold'].clone(true);
    else m = new THREE.Mesh(exit ? exitGeo : keyGeo, exit ? this.exitMat : keyMat);
    m.userData.kind = item.kind;
    m.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = object.receiveShadow = true; });
    m.position.set(item.x, item.y, item.z);
    if (exit) {
      const ceramic = m instanceof THREE.Group;
      m.position.addScaledVector(up, ceramic ? -0.5 : -0.4); // model origin is the supporting face
      m.quaternion.copy(align.setFromUnitVectors(ceramic ? Y : Z, up));
    }
    this.scene.add(m);
    return m;
  }
}
