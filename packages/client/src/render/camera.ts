import * as THREE from 'three';
import type { RenderPose } from '@kula/shared';

/** Follow cam in the ball's frame (X = left, Y = up, Z = fwd): behind and above, looking ahead. */
const OFFSET = new THREE.Vector3(0, 2.5, -4);
const LOOK = new THREE.Vector3(0, 0, 1.5);
/** Camera orientation relative to the ball frame, computed once. No world-space lookAt, so no gimbal flip. */
const Q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(OFFSET, LOOK, new THREE.Vector3(0, 1, 0)));
/**
 * Fallback follow offsets when the normal spot is inside a block (phase 11: on a climbed wall "behind" is the old
 * floor): progressively higher and closer, each still looking at LOOK. The first with a clear line to the ball wins.
 */
const OFFSETS = [OFFSET, new THREE.Vector3(0, 3.2, -2.4), new THREE.Vector3(0, 3.8, -1.1), new THREE.Vector3(0, 4.2, 0.3)]
  .map((o) => ({ o, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(o, LOOK, new THREE.Vector3(0, 1, 0))) }));
const probePos = new THREE.Vector3(), probeOut = new THREE.Vector3();
const DAMP_PER_SEC = 10;
const ORBIT_SPEED = 0.15; // rad/s
/** Fly-over (phase 17): half the vertical field of view, the elevation (40°), the start angle, and the swoop's share. */
const FLY_HALF_FOV = (60 / 2) * (Math.PI / 180), FLY_SIN = Math.sin(0.7), FLY_COS = Math.cos(0.7), FLY_START = -Math.PI / 2, SWOOP = 0.25;
const flyQuat = new THREE.Quaternion();
/** Free look (phase 17): the yaw/pitch limits (rad), and how fast the view follows the input and springs back. */
export const LOOK_YAW_MAX = Math.PI, LOOK_PITCH_MAX = Math.PI / 3;
const LOOK_DAMP = 12;
const lookQ = new THREE.Quaternion(), lookYawQ = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0);
const lookOffset = new THREE.Vector3(), lookAt = new THREE.Vector3();

const frame = new THREE.Quaternion(), m = new THREE.Matrix4(), Y = new THREE.Vector3(0, 1, 0);
const goalPos = new THREE.Vector3(), goalQuat = new THREE.Quaternion(), ball = new THREE.Vector3(), up = new THREE.Vector3();

/** Desired follow-camera transform for a ball pose. Ignores jump/hop height so the camera stays steady and the jump reads. */
export function followTarget(pose: RenderPose, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  frame.fromArray(pose.quat);
  ball.fromArray(pose.position).addScaledVector(up.fromArray(pose.up), -pose.lift);
  outPos.copy(OFFSET).applyQuaternion(frame).add(ball);
  outQuat.copy(frame).multiply(Q0);
}

type SolidFn = (x: number, y: number, z: number) => boolean;
const STEP = 0.1; // cells
const MARGIN = 0.2; // cells kept clear of the block face

/**
 * Occlusion (phase 11): the point on the segment `from` → `to` just before it first enters a solid cell, or `to`
 * if the way is clear. Climbing a wall puts the follow camera's spot behind the ball inside the old floor.
 */
export function clampToOpen(from: THREE.Vector3, to: THREE.Vector3, solid: SolidFn, out: THREE.Vector3): THREE.Vector3 {
  const len = from.distanceTo(to);
  for (let d = STEP; d < len; d += STEP) {
    out.lerpVectors(from, to, d / len);
    if (solid(Math.round(out.x), Math.round(out.y), Math.round(out.z))) {
      return out.lerpVectors(from, to, Math.max(0, d - MARGIN) / len);
    }
  }
  return out.copy(to);
}

/** Frame-rate independent exponential damping factor. */
export const dampAlpha = (k: number, dt: number) => 1 - Math.exp(-k * dt);

export type CameraMode = 'follow' | 'hold' | 'orbit';

const kickDir = new THREE.Vector3();

const swayQ = new THREE.Quaternion();

export class CameraRig {
  private orbitAngle = 0;
  private snap = true;
  /** The damped camera position before occlusion (damping continues from here, not from the clamped spot). */
  private readonly pos = new THREE.Vector3();
  private solid: SolidFn | null = null;
  /** A short jolt (a boost launch, phase 14c): cells the camera is pushed back along its view, easing out. */
  private kickAmt = 0;
  /** Free look (phase 17): the wanted yaw about the ball's up and pitch (0 = the normal follow view; release → 0). */
  lookYaw = 0;
  lookPitch = 0;
  private yaw = 0;
  private pitch = 0;
  /** Lethargy (15a): 0..1, a slow woozy roll of the view. */
  sway = 0;
  private swayT = 0;

  constructor(private camera: THREE.Camera) {}

  kick(amount = 0.45): void { this.kickAmt = amount; }

  /** Solid test for camera occlusion (the level minus crumbled blocks). */
  setSolid(solid: SolidFn | null): void { this.solid = solid; }

  /**
   * The level fly-over (phase 17): at `t` 0..1, one full orbit over the level, high enough to fit it all in view
   * (`center`, `radius`), and over the last SWOOP of it a swoop down into the follow cam behind `pose` (if any).
   * Places the camera directly; the follow cam then carries on damping from there.
   */
  flyover(t: number, pose: RenderPose | null, center: THREE.Vector3, radius: number): void {
    const a = FLY_START + t * Math.PI * 2, d = (radius / Math.sin(FLY_HALF_FOV)) * 1.05;
    goalPos.set(center.x + Math.cos(a) * d * FLY_COS, center.y + d * FLY_SIN, center.z + Math.sin(a) * d * FLY_COS);
    goalQuat.setFromRotationMatrix(m.lookAt(goalPos, center, Y));
    const s = pose ? Math.min(1, Math.max(0, (t - (1 - SWOOP)) / SWOOP)) : 0;
    if (s > 0) {
      followTarget(pose!, probePos, flyQuat);
      const e = s * s * (3 - 2 * s); // smoothstep
      goalPos.lerp(probePos, e);
      goalQuat.slerp(flyQuat, e);
    }
    this.pos.copy(goalPos);
    this.camera.position.copy(goalPos);
    this.camera.quaternion.copy(goalQuat);
    this.snap = false;
  }

  /** follow: chase `pose`; hold: stay put (local ball dead); orbit: circle the level. */
  update(dt: number, mode: CameraMode, pose: RenderPose | null, center: THREE.Vector3, radius: number): void {
    if (mode === 'hold') return;
    const k = dampAlpha(LOOK_DAMP, dt);
    this.yaw += (Math.max(-LOOK_YAW_MAX, Math.min(LOOK_YAW_MAX, this.lookYaw)) - this.yaw) * k;
    this.pitch += (Math.max(-LOOK_PITCH_MAX, Math.min(LOOK_PITCH_MAX, this.lookPitch)) - this.pitch) * k;
    const looking = Math.abs(this.yaw) > 1e-3 || Math.abs(this.pitch) > 1e-3;
    if (mode === 'follow' && pose && looking) {
      // Orbit the follow offset about the ball: pitch about its left axis, then yaw about its up.
      frame.fromArray(pose.quat);
      ball.fromArray(pose.position).addScaledVector(up.fromArray(pose.up), -pose.lift);
      lookQ.setFromAxisAngle(Y, this.yaw).multiply(lookYawQ.setFromAxisAngle(X, this.pitch));
      lookOffset.copy(OFFSET).applyQuaternion(lookQ);
      lookAt.copy(LOOK).applyAxisAngle(Y, this.yaw).multiplyScalar(Math.cos(this.pitch));
      goalQuat.setFromRotationMatrix(m.lookAt(lookOffset, lookAt, Y)).premultiply(frame);
      goalPos.copy(lookOffset).applyQuaternion(frame).add(ball);
    } else if (mode === 'follow' && pose) {
      followTarget(pose, goalPos, goalQuat);
      if (this.solid) {
        for (const { o, q } of OFFSETS) {
          probePos.copy(o).applyQuaternion(frame).add(ball);
          if (clampToOpen(ball, probePos, this.solid, probeOut).equals(probePos)) {
            goalPos.copy(probePos);
            goalQuat.copy(frame).multiply(q);
            break;
          }
        }
      }
    } else {
      this.orbitAngle += dt * ORBIT_SPEED;
      const r = radius * 2.2;
      goalPos.set(center.x + Math.cos(this.orbitAngle) * r, center.y + r * 0.6, center.z + Math.sin(this.orbitAngle) * r);
      goalQuat.setFromRotationMatrix(m.lookAt(goalPos, center, Y));
    }
    const a = this.snap ? 1 : dampAlpha(DAMP_PER_SEC, dt);
    this.snap = false;
    this.pos.lerp(goalPos, a);
    this.camera.quaternion.slerp(goalQuat, a);
    if (mode === 'follow' && pose && this.solid) clampToOpen(ball, this.pos, this.solid, this.camera.position);
    else this.camera.position.copy(this.pos);
    if (this.kickAmt > 0.005) {
      this.camera.position.add(kickDir.set(0, 0, 1).applyQuaternion(this.camera.quaternion).multiplyScalar(this.kickAmt));
      this.kickAmt *= Math.exp(-dt * 9);
    } else this.kickAmt = 0;
    if (this.sway > 0) {
      this.swayT += dt;
      const a = this.sway * 0.05;
      this.camera.quaternion.multiply(swayQ.setFromAxisAngle(kickDir.set(0, 0, 1), a * Math.sin(this.swayT * 1.3)));
      this.camera.position.add(kickDir.set(1, 0, 0).applyQuaternion(this.camera.quaternion).multiplyScalar(a * 2 * Math.sin(this.swayT * 0.9)));
    }
  }
}
