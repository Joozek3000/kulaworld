import * as THREE from 'three';
import { dirVec, type Dir } from '@kula/shared';
import type { GameState, ItemS } from '../net.ts';

const keyGeo = new THREE.OctahedronGeometry(0.22);
const keyMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x6b5200, roughness: 0.3, metalness: 0.4 });
const exitGeo = new THREE.TorusGeometry(0.34, 0.07, 12, 32);
const LOCKED = new THREE.Color(0x70748a), UNLOCKED = new THREE.Color(0x3ddc6f);
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const up = new THREE.Vector3(), align = new THREE.Quaternion(), spin = new THREE.Quaternion();
const POP_SEC = 0.35;

/** Keys: spinning octahedrons that pop when collected. Exit: a torus on its face, grey until the local player can use it. */
export class ItemsView {
  /** Keyed by id + cell, so a rotated level's exit (same id, new place) gets a new mesh. */
  private meshes = new Map<string, THREE.Mesh>();
  private popping: { mesh: THREE.Mesh; start: number }[] = [];
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
      }
    });
    for (const [key, m] of this.meshes) {
      if (live.has(key)) continue;
      this.meshes.delete(key);
      // A key collected mid-round pops; anything else (new round, level change) just goes.
      if (state.phase === 'playing' && m.geometry === keyGeo) {
        m.material = keyMat.clone();
        (m.material as THREE.MeshStandardMaterial).transparent = true;
        this.popping.push({ mesh: m, start: timeSec });
      } else this.scene.remove(m);
    }
    this.popping = this.popping.filter(({ mesh, start }) => {
      const t = (timeSec - start) / POP_SEC;
      if (t >= 1) { this.scene.remove(mesh); (mesh.material as THREE.Material).dispose(); return false; }
      mesh.scale.setScalar(1 + t * 1.5);
      (mesh.material as THREE.MeshStandardMaterial).opacity = 1 - t;
      return true;
    });
    this.exitMat.color.copy(unlocked ? UNLOCKED : LOCKED);
  }

  private create(item: ItemS): THREE.Mesh {
    up.copy(dirVec(item.up as Dir) as THREE.Vector3Like);
    const exit = item.kind === 'exit';
    const m = new THREE.Mesh(exit ? exitGeo : keyGeo, exit ? this.exitMat : keyMat);
    m.position.set(item.x, item.y, item.z);
    if (exit) {
      m.position.addScaledVector(up, -0.4); // lies just above the floor
      m.quaternion.copy(align.setFromUnitVectors(Z, up));
    }
    this.scene.add(m);
    return m;
  }
}
