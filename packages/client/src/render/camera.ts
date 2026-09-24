import * as THREE from 'three';
import type { RenderPose } from '@kula/shared';

/** Follow cam in the ball's frame (X = left, Y = up, Z = fwd): behind and above, looking ahead. */
const OFFSET = new THREE.Vector3(0, 2.5, -4);
const LOOK = new THREE.Vector3(0, 0, 1.5);
/** Camera orientation relative to the ball frame, computed once. No world-space lookAt, so no gimbal flip. */
const Q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(OFFSET, LOOK, new THREE.Vector3(0, 1, 0)));
const DAMP_PER_SEC = 10;
const ORBIT_SPEED = 0.15; // rad/s

const frame = new THREE.Quaternion(), m = new THREE.Matrix4(), Y = new THREE.Vector3(0, 1, 0);
const goalPos = new THREE.Vector3(), goalQuat = new THREE.Quaternion(), ball = new THREE.Vector3();

/** Desired follow-camera transform for a ball pose. */
export function followTarget(pose: RenderPose, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  frame.fromArray(pose.quat);
  outPos.copy(OFFSET).applyQuaternion(frame).add(ball.fromArray(pose.position));
  outQuat.copy(frame).multiply(Q0);
}

/** Frame-rate independent exponential damping factor. */
export const dampAlpha = (k: number, dt: number) => 1 - Math.exp(-k * dt);

export type CameraMode = 'follow' | 'hold' | 'orbit';

export class CameraRig {
  private orbitAngle = 0;
  private snap = true;

  constructor(private camera: THREE.Camera) {}

  /** follow: chase `pose`; hold: stay put (local ball dead); orbit: circle the level. */
  update(dt: number, mode: CameraMode, pose: RenderPose | null, center: THREE.Vector3, radius: number): void {
    if (mode === 'hold') return;
    if (mode === 'follow' && pose) {
      followTarget(pose, goalPos, goalQuat);
    } else {
      this.orbitAngle += dt * ORBIT_SPEED;
      const r = radius * 2.2;
      goalPos.set(center.x + Math.cos(this.orbitAngle) * r, center.y + r * 0.6, center.z + Math.sin(this.orbitAngle) * r);
      goalQuat.setFromRotationMatrix(m.lookAt(goalPos, center, Y));
    }
    const a = this.snap ? 1 : dampAlpha(DAMP_PER_SEC, dt);
    this.snap = false;
    this.camera.position.lerp(goalPos, a);
    this.camera.quaternion.slerp(goalQuat, a);
  }
}
