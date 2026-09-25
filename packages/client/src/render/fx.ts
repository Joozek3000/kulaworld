import * as THREE from 'three';

const geo = new THREE.SphereGeometry(0.4, 16, 8);
const FADE_SEC = 0.6;

/** Short-lived effects: a fading, growing ball where a player vanished (death). */
export class Fx {
  private live: { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; start: number }[] = [];

  constructor(private scene: THREE.Scene) {}

  vanish(at: THREE.Vector3, color: string, timeSec: number): void {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
    mesh.position.copy(at);
    this.scene.add(mesh);
    this.live.push({ mesh, start: timeSec });
  }

  update(timeSec: number): void {
    this.live = this.live.filter(({ mesh, start }) => {
      const t = (timeSec - start) / FADE_SEC;
      if (t >= 1) { this.scene.remove(mesh); mesh.material.dispose(); return false; }
      mesh.scale.setScalar(1 + t * 1.5);
      mesh.material.opacity = 0.7 * (1 - t);
      return true;
    });
  }
}
