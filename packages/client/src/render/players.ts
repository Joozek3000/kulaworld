import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Action, BALL_RADIUS, newRenderPose, perpendicular, poseAt, SPIN_PER_CELL, type Dir, type Level, type Pose, type RenderPose } from '@kula/shared';
import type { GameState, PlayerS } from '../net.ts';

/**
 * The schema only holds each player's current action, but we render ~2 ticks behind the server.
 * So each player keeps its last few action segments and we render whichever was running at renderTick;
 * otherwise a chained roll would replace from/to while the previous roll is still on screen.
 */
interface Seg { serial: number; action: number; from: Pose; to: Pose; startTick: number; endTick: number }
const HISTORY = 3;
const newPose = (): Pose => ({ cell: { x: 0, y: 0, z: 0 }, up: 2, fwd: 4 });
const newSeg = (): Seg => ({ serial: -1, action: Action.Idle, from: newPose(), to: newPose(), startTick: 0, endTick: 0 });

function samePose(q: Pose, x: number, y: number, z: number, up: number, fwd: number): boolean {
  return q.cell.x === x && q.cell.y === y && q.cell.z === z && q.up === up && q.fwd === fwd;
}
function setPose(q: Pose, x: number, y: number, z: number, up: number, fwd: number): void {
  q.cell.x = x; q.cell.y = y; q.cell.z = z; q.up = up as Dir; q.fwd = fwd as Dir;
}
/** When a segment starts rendering. Idle keeps the finished action's ticks, so it begins at endTick. */
const effStart = (s: Seg) => (s.action === Action.Idle ? s.endTick : s.startTick);

const topGeo = new THREE.SphereGeometry(BALL_RADIUS, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
const bottomGeo = new THREE.SphereGeometry(BALL_RADIUS, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
const bottomMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
const X_AXIS = new THREE.Vector3(1, 0, 0);
const tmpQ = new THREE.Quaternion(), spinQ = new THREE.Quaternion(), tmpUp = new THREE.Vector3();

// Blob shadow: a dark disc on the first block below the ball (along its up axis), fading with height.
const shadowGeo = new THREE.CircleGeometry(0.34, 24);
const SHADOW_OPACITY = 0.45;
const SHADOW_REACH = 3; // cells
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ground = new THREE.Vector3(), axis = new THREE.Vector3(), probe = new THREE.Vector3();
type SolidFn = (x: number, y: number, z: number) => boolean;

class PlayerView {
  readonly segs: Seg[] = Array.from({ length: HISTORY }, newSeg);
  private head = 0;
  private count = 0;
  private serial = 0;
  private renderedSerial = -1;
  private renderedAction: number = Action.Idle;
  private spinBase = 0;
  private lastRenderTick = -Infinity;
  /** Snap metric: moving segments that arrived after renderTick had passed their start, and the worst lateness (ticks). */
  lateCount = 0;
  lateMax = 0;
  readonly pose: RenderPose = newRenderPose();
  readonly ball = new THREE.Group();
  private readonly shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: SHADOW_OPACITY, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  readonly shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
  readonly label: CSS2DObject | null;
  shown = false;
  action: number = Action.Idle;

  constructor(p: PlayerS, local: boolean, scene: THREE.Scene) {
    const top = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5 });
    this.ball.add(new THREE.Mesh(topGeo, top), new THREE.Mesh(bottomGeo, bottomMat));
    this.ball.visible = false;
    this.shadow.visible = false;
    scene.add(this.ball, this.shadow);
    if (local) {
      this.label = null;
    } else {
      const div = document.createElement('div');
      div.className = 'label';
      div.textContent = p.name;
      div.style.borderColor = p.color;
      this.label = new CSS2DObject(div);
      this.label.visible = false;
      scene.add(this.label);
    }
  }

  get newest(): Seg { return this.segs[this.head]; }

  track(p: PlayerS): void {
    const s = this.newest;
    if (this.count && s.action === p.action && s.startTick === p.startTick && s.endTick === p.endTick
      && samePose(s.from, p.fromX, p.fromY, p.fromZ, p.fromUp, p.fromFwd)
      && samePose(s.to, p.toX, p.toY, p.toZ, p.toUp, p.toFwd)) return;
    this.head = (this.head + 1) % HISTORY;
    const n = this.segs[this.head];
    n.serial = ++this.serial;
    n.action = p.action;
    n.startTick = p.startTick;
    n.endTick = p.endTick;
    setPose(n.from, p.fromX, p.fromY, p.fromZ, p.fromUp, p.fromFwd);
    setPose(n.to, p.toX, p.toY, p.toZ, p.toUp, p.toFwd);
    this.count = Math.min(this.count + 1, HISTORY);
    // A moving segment that starts before what's already on screen arrived late: the ball has to jump into it.
    const late = this.lastRenderTick - effStart(n);
    if (late > 0.05 && n.action !== Action.Idle && n.action !== Action.Dead) {
      this.lateCount++;
      this.lateMax = Math.max(this.lateMax, late);
    }
  }

  clear(): void { this.count = 0; }

  private select(renderTick: number): Seg {
    for (let i = 0; i < this.count; i++) {
      const s = this.segs[(this.head - i + HISTORY) % HISTORY];
      if (effStart(s) <= renderTick) return s;
    }
    return this.newest;
  }

  /** Returns true when the rendered segment changed. */
  update(renderTick: number, show: boolean, solid: SolidFn | null): boolean {
    this.lastRenderTick = renderTick;
    const s = this.select(renderTick);
    const changed = s.serial !== this.renderedSerial;
    if (changed) {
      // Rolling spin is render-only; carry the finished roll's rotation into the next segment.
      if (this.renderedAction === Action.Roll || this.renderedAction === Action.Flip) {
        this.spinBase = (this.spinBase + SPIN_PER_CELL) % (Math.PI * 2);
      }
      this.renderedSerial = s.serial;
      this.renderedAction = s.action;
    }
    this.action = s.action;
    // Schema defaults (lobby, before the first round) are not a valid pose: up = fwd = +X.
    const valid = perpendicular(s.from.up, s.from.fwd) && perpendicular(s.to.up, s.to.fwd);
    this.shown = show && valid && s.action !== Action.Dead;
    this.ball.visible = this.shown;
    if (!this.shown) this.shadow.visible = false;
    if (this.label) this.label.visible = this.shown;
    if (this.shown) {
      const len = s.endTick - s.startTick;
      poseAt(s.action as Action, s.from, s.to, len > 0 ? (renderTick - s.startTick) / len : 1, this.pose);
      const [px, py, pz] = this.pose.position;
      tmpUp.fromArray(this.pose.up);
      this.ball.position.set(px, py, pz).addScaledVector(tmpUp, BALL_RADIUS - 0.5); // rest on the block
      spinQ.setFromAxisAngle(X_AXIS, this.spinBase + this.pose.spin);
      this.ball.quaternion.copy(tmpQ.fromArray(this.pose.quat)).multiply(spinQ);
      this.label?.position.copy(this.ball.position).addScaledVector(tmpUp, 0.75);
      // Mid-flip the up axis points into air over the edge: keep the last placement until the new face takes over.
      if (!solid || (!this.placeShadow(solid) && s.action !== Action.Flip)) this.shadow.visible = false;
    }
    return changed;
  }

  /** Projects the shadow along the dominant axis of up (diagonal mid-flip) onto the first block within reach. */
  private placeShadow(solid: SolidFn): boolean {
    const [ux, uy, uz] = this.pose.up;
    const ax = Math.abs(ux), ay = Math.abs(uy), az = Math.abs(uz);
    if (ax >= ay && ax >= az) axis.set(Math.sign(ux), 0, 0);
    else if (ay >= az) axis.set(0, Math.sign(uy), 0);
    else axis.set(0, 0, Math.sign(uz));
    ground.fromArray(this.pose.position).addScaledVector(tmpUp, -this.pose.lift); // tmpUp = pose.up
    for (let k = 1; k <= SHADOW_REACH; k++) {
      probe.copy(ground).addScaledVector(axis, -k).round();
      if (!solid(probe.x, probe.y, probe.z)) continue;
      const surface = probe.dot(axis) + 0.5; // block face, as a coordinate along axis
      const g = ground.dot(axis);
      this.shadow.position.copy(ground).addScaledVector(axis, surface - g + 0.01);
      this.shadow.quaternion.setFromUnitVectors(Z_AXIS, axis);
      const above = g - surface - 0.5 + this.pose.lift; // 0 when resting
      this.shadowMat.opacity = SHADOW_OPACITY * Math.max(0.15, 1 - above / 2.5);
      this.shadow.visible = true;
      return true;
    }
    return false;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.ball, this.shadow);
    this.shadowMat.dispose();
    (this.ball.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material.dispose();
    if (this.label) { scene.remove(this.label); this.label.element.remove(); }
  }
}

const ACTIVE = new Set(['countdown', 'playing', 'results']);

export class PlayersView {
  private views = new Map<string, PlayerView>();
  private lastPhase = '';
  private solid: SolidFn | null = null;
  /** Called when the local player's rendered action changes to a moving one (input→motion metric). */
  onLocalMotion: (() => void) | null = null;

  constructor(private scene: THREE.Scene) {}

  setLevel(level: Level | null): void {
    this.solid = level ? (x, y, z) => level.solid.has(`${x},${y},${z}`) : null;
  }

  /** The local ball renders at localRenderTick (it may run closer to the server than the others). */
  update(state: GameState, renderTick: number, localId: string, localRenderTick = renderTick): void {
    const newRound = state.phase === 'countdown' && this.lastPhase !== 'countdown';
    this.lastPhase = state.phase;
    const active = ACTIVE.has(state.phase);

    state.players.forEach((p, id) => {
      let v = this.views.get(id);
      if (!v) this.views.set(id, (v = new PlayerView(p, id === localId, this.scene)));
      if (newRound) v.clear(); // last round's segments would otherwise sort before the new spawn
      v.track(p);
      const changed = v.update(id === localId ? localRenderTick : renderTick, active && !p.spectating, this.solid);
      if (changed && id === localId && v.action !== Action.Idle && v.action !== Action.Dead) this.onLocalMotion?.();
    });
    for (const [id, v] of this.views) {
      if (!state.players.has(id)) { v.dispose(this.scene); this.views.delete(id); }
    }
  }

  /** The local ball's render pose, or null when it isn't on screen (lobby, spectating, dead). */
  localPose(localId: string): RenderPose | null {
    const v = this.views.get(localId);
    return v?.shown ? v.pose : null;
  }

  localLate(localId: string): { count: number; max: number } {
    const v = this.views.get(localId);
    return { count: v?.lateCount ?? 0, max: v?.lateMax ?? 0 };
  }

  localAction(localId: string): number | null {
    return this.views.get(localId)?.action ?? null;
  }
}
