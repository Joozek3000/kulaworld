import * as THREE from 'three';

/** Substep for the spring, so the jiggle looks the same at 30, 60 or 144 fps. */
const SUBSTEP = 1 / 240;

/** Damped spring on a stretch value x (scale along the squash axis is 1 + x). */
export class Spring {
  x = 0;
  v = 0;
  /** A kick is shown as-is on the frame it happens; the spring moves from the next frame on (else a slow frame eats it). */
  private held = false;

  step(dt: number, target: number, stiffness: number, damping: number): void {
    if (this.held) { this.held = false; return; }
    for (let left = Math.min(dt, 0.1); left > 1e-9; left -= SUBSTEP) {
      const h = Math.min(left, SUBSTEP);
      this.v += (-stiffness * (this.x - target) - damping * this.v) * h;
      this.x += this.v * h;
    }
  }

  kick(x: number): void {
    this.x = x;
    this.v = 0;
    this.held = true;
  }
}

const Y = new THREE.Vector3(0, 1, 0);
const inv = new THREE.Quaternion();

/**
 * Volume-preserving squash along a world axis: `outer` turns local Y onto `axis` and scales (1/√s, s, 1/√s); `inner`
 * gets `orient` with outer's rotation undone, so the ball keeps its spin while the squash stays on the axis.
 */
export function applySquash(outer: THREE.Object3D, inner: THREE.Object3D, axis: THREE.Vector3, s: number, orient: THREE.Quaternion): void {
  outer.quaternion.setFromUnitVectors(Y, axis);
  const k = 1 / Math.sqrt(s);
  outer.scale.set(k, s, k);
  inner.quaternion.copy(inv.copy(outer.quaternion).invert()).multiply(orient);
}
