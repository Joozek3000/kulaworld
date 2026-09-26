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

/** Spinning ceramic keys and a gate with distinct locked/open models on any gravity face. */
export class ItemsView {
  /** Keyed by id + cell, so a rotated level's exit (same id, new place) gets a new mesh. */
  private meshes = new Map<string, THREE.Object3D>();
  private popping: { mesh: THREE.Object3D; materials: THREE.Material[]; start: number }[] = [];
  private exitMat = new THREE.MeshStandardMaterial({ color: LOCKED, roughness: 0.4 });

  constructor(private scene: THREE.Scene) {}

  update(state: GameState, visible: boolean, unlocked: boolean, timeSec: number): void {
    const live = new Set<string>();
    state.items.forEach((item, id) => {
      const key = `${id}@${item.x},${item.y},${item.z}`;
      live.add(key);
      let m = this.meshes.get(key);
      if (!m) this.meshes.set(key, (m = this.create(item)));
      m.visible = visible;
      if (item.kind === 'key') {
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
      // A key collected mid-round pops; anything else (new round, level change) just goes.
      if (state.phase === 'playing' && m.userData.kind === 'key') {
        const materials: THREE.Material[] = [];
        const clone = (source: THREE.Material) => {
          const material = source.clone();
          material.transparent = true;
          materials.push(material);
          return material;
        };
        m.traverse((object) => {
          if (object instanceof THREE.Mesh) object.material = Array.isArray(object.material)
            ? object.material.map(clone) : clone(object.material);
        });
        this.popping.push({ mesh: m, materials, start: timeSec });
      } else this.scene.remove(m);
    }
    this.popping = this.popping.filter(({ mesh, materials, start }) => {
      const t = (timeSec - start) / POP_SEC;
      if (t >= 1) { this.scene.remove(mesh); materials.forEach((m) => m.dispose()); return false; }
      mesh.scale.setScalar(1 + t * 1.5);
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
    } else if (!exit && art.models['key-marigold']) m = art.models['key-marigold'].clone(true);
    else m = new THREE.Mesh(exit ? exitGeo : keyGeo, exit ? this.exitMat : keyMat);
    m.userData.kind = item.kind;
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
