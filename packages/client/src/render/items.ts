import * as THREE from 'three';
import { dirVec, type Dir } from '@kula/shared';
import type { GameState, ItemS } from '../net.ts';

const keyGeo = new THREE.OctahedronGeometry(0.22);
const keyMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x6b5200, roughness: 0.3, metalness: 0.4 });
const exitGeo = new THREE.TorusGeometry(0.34, 0.07, 12, 32);
const LOCKED = new THREE.Color(0x70748a), UNLOCKED = new THREE.Color(0x3ddc6f);
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const up = new THREE.Vector3(), align = new THREE.Quaternion(), spin = new THREE.Quaternion();

/** Keys: spinning octahedrons. Exit: a torus lying on its face, grey until the local player can use it. */
export class ItemsView {
  private meshes = new Map<string, THREE.Mesh>();
  private exitMat = new THREE.MeshStandardMaterial({ color: LOCKED, roughness: 0.4 });

  constructor(private scene: THREE.Scene) {}

  update(state: GameState, visible: boolean, unlocked: boolean, timeSec: number): void {
    state.items.forEach((item, id) => {
      let m = this.meshes.get(id);
      if (!m) this.meshes.set(id, (m = this.create(item)));
      m.visible = visible;
      if (item.kind === 'key') {
        up.copy(dirVec(item.up as Dir) as THREE.Vector3Like);
        m.quaternion.setFromUnitVectors(Y, up).multiply(spin.setFromAxisAngle(Y, timeSec * 2));
      }
    });
    for (const [id, m] of this.meshes) {
      if (!state.items.has(id)) { this.scene.remove(m); this.meshes.delete(id); }
    }
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
