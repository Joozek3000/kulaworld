// Float render interpolation (ARCHITECTURE §10). Display only: never feeds back into the sim.
import { cross, dirVec, type Dir } from './dir.ts';
import type { Pose } from './level/types.ts';
import { Action } from './sim/world.ts';
import type { Vec3 } from './vec.ts';

export type V3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export interface RenderPose {
  /** Ball centre = cell centre (blocks are unit cubes centred on their cell). */
  position: V3;
  /** Frame orientation: local X = cross(U, F) (left), Y = up, Z = fwd. Excludes rolling spin. */
  quat: Quat;
  up: V3;
  /** Rolling angle (rad) about local X during this action; positive rolls the top forward. */
  spin: number;
  /** Jump/hop height along up included in position (the camera follows position − up·lift). */
  lift: number;
}

export const BALL_RADIUS = 0.4;
export const SPIN_PER_CELL = 1 / BALL_RADIUS;
export const JUMP_HEIGHT = 1.2;
export const HOP_HEIGHT = 1.0;
/** Clash rebound (§16): a lower arc back to the takeoff cell. */
export const REBOUND_HEIGHT = 0.8;
/** A knock waits this fraction of KNOCK_TICKS (1 tick: the pusher closing the 0.2-cell gap), then slides fast. */
export const KNOCK_HOLD = 0.25;
/** Rolling spin (rad) a knocked ball picks up while it skids one cell. */
export const KNOCK_SPIN = Math.PI / 2;

export const newRenderPose = (): RenderPose => ({ position: [0, 0, 0], quat: [0, 0, 0, 1], up: [0, 1, 0], spin: 0, lift: 0 });

export function quatFromBasis(x: Vec3, y: Vec3, z: Vec3, out: Quat): Quat {
  // Rotation matrix with columns x, y, z → quaternion (same algorithm as three.js).
  const m00 = x.x, m01 = y.x, m02 = z.x, m10 = x.y, m11 = y.y, m12 = z.y, m20 = x.z, m21 = y.z, m22 = z.z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    out[3] = 0.25 / s; out[0] = (m21 - m12) * s; out[1] = (m02 - m20) * s; out[2] = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    out[3] = (m21 - m12) / s; out[0] = 0.25 * s; out[1] = (m01 + m10) / s; out[2] = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    out[3] = (m02 - m20) / s; out[0] = (m01 + m10) / s; out[1] = 0.25 * s; out[2] = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    out[3] = (m10 - m01) / s; out[0] = (m02 + m20) / s; out[1] = (m12 + m21) / s; out[2] = 0.25 * s;
  }
  return out;
}

export const frameQuat = (up: Dir, fwd: Dir, out: Quat): Quat =>
  quatFromBasis(dirVec(cross(up, fwd)), dirVec(up), dirVec(fwd), out);

export function axisAngle(a: Vec3, angle: number, out: Quat): Quat {
  const s = Math.sin(angle / 2);
  out[0] = a.x * s; out[1] = a.y * s; out[2] = a.z * s; out[3] = Math.cos(angle / 2);
  return out;
}

/** out = a * b (apply b, then a). `out` may alias either input. */
export function quatMul(a: Quat, b: Quat, out: Quat): Quat {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export function slerp(a: Quat, b: Quat, t: number, out: Quat): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0 = 1 - t, k1 = t;
  if (cos < 0.9999) {
    const th = Math.acos(cos), s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = Math.sin(t * th) / s;
  }
  out[0] = a[0] * k0 + bx * k1; out[1] = a[1] * k0 + by * k1; out[2] = a[2] * k0 + bz * k1; out[3] = a[3] * k0 + bw * k1;
  return out;
}

/** Rotates v by q into out. `out` may alias v. */
export function rotate(q: Quat, v: V3, out: V3): V3 {
  const [qx, qy, qz, qw] = q, [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + qy * tz - qz * ty;
  out[1] = vy + qw * ty + qz * tx - qx * tz;
  out[2] = vz + qw * tz + qx * ty - qy * tx;
  return out;
}

const qa: Quat = [0, 0, 0, 1], qb: Quat = [0, 0, 0, 1], off: V3 = [0, 0, 0], Y: V3 = [0, 1, 0];

/** A mid-air turn during Hop/Jump/Fall: facing before it, and how far its TURN_TICKS spin has got (0..1). */
export interface AirTurn { fromFwd: Dir; progress: number }

/**
 * Render pose for an action at `progress` (clamped to 0..1). Writes into `out`; allocates nothing when `out` is given.
 * `airTurn` spins an airborne ball's facing from `airTurn.fromFwd` to `to.fwd`; its path still follows `from`.
 * `knockHold` overrides KNOCK_HOLD when pusher and victim render at different ticks (see the client's PlayersView).
 */
export function poseAt(action: Action, from: Pose, to: Pose, progress: number, out: RenderPose = newRenderPose(), airTurn?: AirTurn, knockHold = KNOCK_HOLD): RenderPose {
  const p = Math.min(1, Math.max(0, progress));
  const C = from.cell, U = dirVec(from.up), F = dirVec(from.fwd), T = to.cell;
  const pos = out.position;
  pos[0] = C.x; pos[1] = C.y; pos[2] = C.z;
  frameQuat(from.up, from.fwd, out.quat);
  out.spin = 0;
  out.lift = 0;
  const lerp = () => { pos[0] += (T.x - C.x) * p; pos[1] += (T.y - C.y) * p; pos[2] += (T.z - C.z) * p; };

  switch (action) {
    case Action.Roll:
      lerp();
      out.spin = p * SPIN_PER_CELL;
      break;
    case Action.Turn:
      slerp(out.quat, frameQuat(to.up, to.fwd, qb), p, out.quat);
      break;
    case Action.Flip: {
      // Centre sweeps a semicircle around edge E = C - U/2 + F/2; offset C - E = U/2 - F/2 rotates by π·p about X.
      const X = dirVec(cross(from.up, from.fwd));
      off[0] = 0.5 * (U.x - F.x); off[1] = 0.5 * (U.y - F.y); off[2] = 0.5 * (U.z - F.z);
      rotate(axisAngle(X, Math.PI * p, qa), off, off);
      pos[0] = C.x - 0.5 * U.x + 0.5 * F.x + off[0];
      pos[1] = C.y - 0.5 * U.y + 0.5 * F.y + off[1];
      pos[2] = C.z - 0.5 * U.z + 0.5 * F.z + off[2];
      quatMul(axisAngle(X, (Math.PI / 2) * p, qa), out.quat, out.quat); // up turns 90° from U to F
      out.spin = p * SPIN_PER_CELL;
      break;
    }
    case Action.Jump:
    case Action.Hop:
    case Action.Rebound: { // a rebound: from = the landing cell it bounced off, to = the takeoff cell, facing kept
      lerp(); // a hop has to = from, so this is a no-op
      const h = 4 * (action === Action.Hop ? HOP_HEIGHT : action === Action.Rebound ? REBOUND_HEIGHT : JUMP_HEIGHT) * p * (1 - p);
      pos[0] += U.x * h; pos[1] += U.y * h; pos[2] += U.z * h;
      out.lift = h;
      break;
    }
    case Action.Fall:
      lerp();
      break;
    case Action.Knocked: {
      const k = Math.max(0, (p - knockHold) / (1 - knockHold));
      pos[0] += (T.x - C.x) * k; pos[1] += (T.y - C.y) * k; pos[2] += (T.z - C.z) * k;
      out.spin = k * KNOCK_SPIN;
      break;
    }
  }
  if (airTurn && airTurn.fromFwd !== to.fwd && (action === Action.Hop || action === Action.Jump || action === Action.Fall || action === Action.Rebound)) {
    const t = Math.min(1, Math.max(0, airTurn.progress));
    slerp(frameQuat(from.up, airTurn.fromFwd, qa), frameQuat(from.up, to.fwd, qb), t, out.quat);
  }
  rotate(out.quat, Y, out.up);
  return out;
}
