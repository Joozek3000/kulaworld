import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  Action, BALL_RADIUS, CLIMB_SPIN, dirVec, HOP_HEIGHT, JUMP_GRACE_TICKS, JUMP_HEIGHT, KILL_MARGIN, KNOCK_HOLD, KNOCK_SPIN, KNOCK_TICKS, newRenderPose, perpendicular, poseAt,
  SPIN_PER_CELL, STRIKE_TICKS, STUN_TICKS, TURN_TICKS,
  type AirTurn, type Dir, type Pose, type RenderPose,
} from '@kula/shared';
import type { GameState, PlayerS } from '../net.ts';
import { tuning } from '../tuning.ts';
import { applySquash, Spring } from './squash.ts';
import { art, BALL_MODELS } from './art.ts';

/**
 * Feel events (phase 08), raised at render time when a ball's on-screen action changes, so sounds match what you see.
 * `hit` is push contact (at the victim), `pop` a death, `clack` a middle ball of a cradle passing the strike on.
 */
export type FeelKind = 'takeoff' | 'land' | 'roll' | 'flip' | 'climb' | 'fall' | 'hit' | 'boing' | 'pop' | 'stomp' | 'clash' | 'strike' | 'clack';
export interface Feel { kind: FeelKind; at: THREE.Vector3; local: boolean; intensity: number; victimLocal?: boolean }
type FeelFn = (kind: FeelKind, intensity?: number) => void;

/**
 * The schema only holds each player's current action, but we render ~2 ticks behind the server.
 * So each player keeps its last few action segments and we render whichever was running at renderTick;
 * otherwise a chained roll would replace from/to while the previous roll is still on screen.
 */
interface Seg { serial: number; action: number; from: Pose; to: Pose; startTick: number; endTick: number; turnFromFwd: Dir; turnStartTick: number; bounce: boolean }
const HISTORY = 3;
const newPose = (): Pose => ({ cell: { x: 0, y: 0, z: 0 }, up: 2, fwd: 4 });
const newSeg = (): Seg => ({ serial: -1, action: Action.Idle, from: newPose(), to: newPose(), startTick: 0, endTick: 0, turnFromFwd: 4, turnStartTick: 0, bounce: false });

function setPose(q: Pose, x: number, y: number, z: number, up: number, fwd: number): void {
  q.cell.x = x; q.cell.y = y; q.cell.z = z; q.up = up as Dir; q.fwd = fwd as Dir;
}
/** When a segment starts rendering. Idle keeps the finished action's ticks, so it begins at endTick. */
const effStart = (s: Seg) => (s.action === Action.Idle ? s.endTick : s.startTick);

const topGeo = new THREE.SphereGeometry(BALL_RADIUS, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
const bottomGeo = new THREE.SphereGeometry(BALL_RADIUS, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const airTurn: AirTurn = { fromFwd: 4, progress: 1 };
const tmpQ = new THREE.Quaternion(), spinQ = new THREE.Quaternion(), tmpUp = new THREE.Vector3(), tmpFwd = new THREE.Vector3();
const wobQ = new THREE.Quaternion(), RING_TILT = new THREE.Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2);

// Stun: the ball wobbles (tilts side to side, dying out) under a flashing ring. A bounce also lunges forward and back.
const WOBBLE_RAD = 0.35;
const WOBBLE_CYCLES = 3;
const LUNGE_CELLS = 0.25;
const LUNGE_TICKS = 4;
// Cradle strike (phase 12b): the striker lunges into the line, peaking at contact after STRIKE_CONTACT_TICKS, and
// recoils. The middle balls then shudder along F one frame apart, and the last ball's slide waits for them.
const STRIKE_CELLS = 0.2;
const STRIKE_CONTACT_TICKS = 1;
const CRADLE_HOLD_TICKS = 2;
const ringGeo = new THREE.TorusGeometry(0.28, 0.04, 8, 24);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe14d });

// Blob shadow: a dark disc on the first block below the ball (along its up axis), fading with height.
const shadowGeo = new THREE.CircleGeometry(0.34, 24);
const SHADOW_OPACITY = 0.45;
const SHADOW_REACH = 3; // cells
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ground = new THREE.Vector3(), axis = new THREE.Vector3(), probe = new THREE.Vector3();
type SolidFn = (x: number, y: number, z: number) => boolean;

// Squash & stretch (phase 08): stretch amounts, multiplied by tuning.squash. Scale along the axis is 1 + x.
const SQUASH = {
  anticipation: -0.15, // kicked at takeoff and held for the first tick of a hop/jump
  rise: 0.15, // stretch along the velocity at takeoff, easing to 0 at the apex
  descend: 0.08, // stretch again on the way down
  fall: 0.1,
  landMin: -0.2, // landing squash: 0.8 for a soft hop ...
  landMax: -0.35, // ... to 0.65 for a long fall
  contact: -0.25, // both balls at push contact
  slide: 0.2, // the victim along the knock
  stop: -0.2, // the victim when the knock ends
  bounce: -0.3, // the pusher against the victim on a failed push
  wobble: 0.12, // stunned
  roll: -0.03, // pulse at each tile start
  climb: -0.12, // rolling into a wall's corner
  stomp: -0.5, // a stomped victim, flattened under the attacker before it shoots out (§16)
  shudder: -0.18, // a middle ball of a cradle, along the strike
};
/** A stomped victim stays flat this fraction of its knock before sliding out (a push holds KNOCK_HOLD). */
const STOMP_HOLD = 0.4;

// Hot tile (phase 12): a square on the face under a ball that has stood still past the warn threshold, from orange
// to a flickering red at the burn threshold. Double-sided and drawn over the block, so it reads on every face.
const hotGeo = new THREE.PlaneGeometry(0.96, 0.96);
const HOT_ORANGE = new THREE.Color(0xff8a1e), HOT_RED = new THREE.Color(0xff1a1a);

// Landing marker (§16): a ring on a forward jump's landing cell, in the jumper's colour; red when a ball is on it.
const markerGeo = new THREE.TorusGeometry(0.46, 0.06, 8, 32); // wider than a ball (0.4), so it shows around one
const MARKER_RED = new THREE.Color(0xff2a2a);
const ANTICIPATION_TICKS = 1;
/** Prediction (§17): a corrected or re-sourced local ball blends from where it was drawn over this long. */
const BLEND_MS = 100;
const blendQ = new THREE.Quaternion(), IDENTITY = new THREE.Quaternion();
const orient = new THREE.Quaternion(), vel = new THREE.Vector3(), knockDir = new THREE.Vector3();
const frameX = new THREE.Vector3(), frameZ = new THREE.Vector3();

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
  /** Outer group: position and the squash (in an axis-aligned frame). The spin lives on `body`. */
  readonly ball = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly spring = new Spring();
  /** World axis the spring's stretch applies along. */
  private readonly squashAxis = new THREE.Vector3(0, 1, 0);
  private shadowWidth = 1;
  private fallCells = 0;
  /** A knock started on screen; contact (squash, THWACK, hit-stop) fires when its hold ends and the slide begins. */
  private contactPending = false;
  /** A bounce started on screen; the hard squash + boing fire at the lunge's peak. */
  private boingPending = false;
  /** A cradle strike started on screen; the line shudders from the lunge's peak (contact). */
  private strikePending = false;
  readonly local: boolean;
  /** Knock segments (serials) that are stomps, not pushes: set by PlayersView each frame. */
  stompSerials = new Set<number>();
  /** Hot-tile overlay and its level (0 = cold, 0..1 = warned → burning). */
  private readonly hotMat = new THREE.MeshBasicMaterial({ color: 0xff8a1e, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  private readonly hot = new THREE.Mesh(hotGeo, this.hotMat);
  hotLevel = 0;
  /** Landing marker, and the cell it marks ('' when hidden). */
  private readonly markerMat: THREE.MeshBasicMaterial;
  private readonly marker: THREE.Mesh;
  markerCell = '';
  /** The segment on screen, and the tick it rendered at (last update). */
  current: Seg = newSeg();
  get renderTickNow(): number { return this.lastRenderTick; }
  /** Where the ball was drawn last frame (before squash), and a pending/active correction blend. */
  private readonly lastPos = new THREE.Vector3();
  private readonly lastOrient = new THREE.Quaternion();
  private hasLast = false;
  private blendRequested = false;
  private blend: { pos: THREE.Vector3; q: THREE.Quaternion; start: number } | null = null;
  /** Size of the last correction blend (cells), for the F3 overlay. */
  lastCorrection = 0;
  /** Which timeline the local ball follows: 'server' or 'pred'. */
  source = 'server';

  /** Blend from the currently drawn pose to wherever the next update puts the ball (no teleport). */
  requestBlend(): void { this.blendRequested = true; }
  private readonly shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: SHADOW_OPACITY, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  readonly shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
  readonly label: CSS2DObject | null;
  private readonly ring = new THREE.Mesh(ringGeo, ringMat);
  shown = false;
  action: number = Action.Idle;
  readonly color: string;
  private readonly top: THREE.MeshStandardMaterial;
  private readonly bottom = new THREE.MeshStandardMaterial({ color: 0xfff0d7, roughness: 0.57 });
  /** Knockout spawn protection (server tick): the ball renders translucent until then. */
  private protectedUntil = 0;

  constructor(p: PlayerS, local: boolean, scene: THREE.Scene) {
    this.color = p.color;
    this.top = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5 });
    this.local = local;
    this.markerMat = new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.marker = new THREE.Mesh(markerGeo, this.markerMat);
    this.marker.visible = false;
    scene.add(this.marker);
    this.hot.visible = false;
    scene.add(this.hot);
    // Hue chooses a stable pattern while the server's player colour still matches labels and markers.
    const hue = this.top.color.getHSL({ h: 0, s: 0, l: 0 }).h;
    const model = art.models[BALL_MODELS[Math.floor(hue * BALL_MODELS.length) % BALL_MODELS.length]]?.clone(true);
    if (model) {
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const source = object.material as THREE.MeshStandardMaterial;
          object.material = source.name.includes('warm white') ? this.bottom : this.top;
        }
      });
      this.body.add(model);
    } else this.body.add(new THREE.Mesh(topGeo, this.top), new THREE.Mesh(bottomGeo, this.bottom));
    this.ball.add(this.body);
    this.ball.visible = false;
    this.shadow.visible = false;
    this.ring.visible = false;
    scene.add(this.ball, this.shadow, this.ring);
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
    this.protectedUntil = p.protectedUntil;
    const s = this.newest;
    if (this.count && s.action === p.action && s.startTick === p.startTick && s.endTick === p.endTick) {
      // Same action. Only a mid-air turn changes it in flight (to.fwd + turn record): update in place.
      setPose(s.to, p.toX, p.toY, p.toZ, p.toUp, p.toFwd);
      s.turnFromFwd = p.turnFromFwd as Dir;
      s.turnStartTick = p.turnStartTick;
      return;
    }
    // Jump grace (§6): a just-started roll turned into a standing jump from its origin. Blend, don't snap back.
    if (p.action === Action.Jump && s.action === Action.Roll && p.startTick - s.startTick <= JUMP_GRACE_TICKS
      && p.fromX === s.from.cell.x && p.fromY === s.from.cell.y && p.fromZ === s.from.cell.z) this.requestBlend();
    this.head = (this.head + 1) % HISTORY;
    const n = this.segs[this.head];
    n.serial = ++this.serial;
    n.action = p.action;
    n.startTick = p.startTick;
    n.endTick = p.endTick;
    setPose(n.from, p.fromX, p.fromY, p.fromZ, p.fromUp, p.fromFwd);
    setPose(n.to, p.toX, p.toY, p.toZ, p.toUp, p.toFwd);
    n.turnFromFwd = p.turnFromFwd as Dir;
    n.turnStartTick = p.turnStartTick;
    n.bounce = p.bounce;
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

/** Winner glow: pulses the coloured half. */
  highlight(on: boolean, timeSec: number): void {
    if (on) this.top.emissive.set(this.color).multiplyScalar(0.35 + 0.25 * Math.sin(timeSec * 8));
    else this.top.emissive.setRGB(0, 0, 0);
  }

  /** True when the ball was on screen last frame and its rendered action just became Dead. */
  vanished = false;

  /** Returns true when the rendered segment changed. */
  update(
    renderTick: number, show: boolean, solid: SolidFn | null, knockHold: (s: Seg) => number = () => KNOCK_HOLD,
    dt = 0, feel: FeelFn = () => {}, nowMs = 0,
  ): boolean {
    const wasShown = this.shown;
    this.lastRenderTick = renderTick;
    const s = this.select(renderTick);
    const changed = s.serial !== this.renderedSerial;
    const prevAction = this.renderedAction;
    this.current = s;
    if (changed) {
      // Rolling spin is render-only; carry the finished roll's rotation into the next segment.
      if (this.renderedAction === Action.Roll || this.renderedAction === Action.Flip) {
        this.spinBase = (this.spinBase + SPIN_PER_CELL) % (Math.PI * 2);
      } else if (this.renderedAction === Action.Knocked) {
        this.spinBase = (this.spinBase + KNOCK_SPIN) % (Math.PI * 2);
      } else if (this.renderedAction === Action.Climb) {
        this.spinBase = (this.spinBase + CLIMB_SPIN) % (Math.PI * 2);
      }
      this.renderedSerial = s.serial;
      this.renderedAction = s.action;
    }
    this.action = s.action;
    // Schema defaults (lobby, before the first round) are not a valid pose: up = fwd = +X.
    const valid = perpendicular(s.from.up, s.from.fwd) && perpendicular(s.to.up, s.to.fwd);
    this.shown = show && valid && s.action !== Action.Dead;
    this.vanished = wasShown && show && s.action === Action.Dead;
    this.ball.visible = this.shown;
    this.placeMarker(s, renderTick);
    if (!this.shown) this.shadow.visible = false;
    this.ring.visible = false;
    if (this.label) this.label.visible = this.shown;
    if (this.shown) {
      const len = s.endTick - s.startTick;
      airTurn.fromFwd = s.turnFromFwd;
      airTurn.progress = (renderTick - s.turnStartTick) / TURN_TICKS;
      poseAt(s.action as Action, s.from, s.to, len > 0 ? (renderTick - s.startTick) / len : 1, this.pose, airTurn, knockHold(s));
      const [px, py, pz] = this.pose.position;
      tmpUp.fromArray(this.pose.up);
      this.ball.position.set(px, py, pz).addScaledVector(tmpUp, BALL_RADIUS - 0.5); // rest on the block
      spinQ.setFromAxisAngle(X_AXIS, this.spinBase + this.pose.spin);
      orient.copy(tmpQ.fromArray(this.pose.quat));
      if (s.action === Action.Stunned) this.stunned(s, renderTick);
      if (s.action === Action.Strike) this.strike(s, renderTick, feel);
      const ghost = renderTick < this.protectedUntil;
      for (const mat of [this.top, this.bottom]) { mat.transparent = ghost; mat.opacity = ghost ? 0.4 : 1; }
      orient.multiply(spinQ);
      this.applyBlend(wasShown, nowMs);
      if (changed && wasShown) this.transition(prevAction, s, solid, feel);
      this.squash(s, renderTick, len, knockHold(s), dt, feel);
      this.label?.position.copy(this.ball.position).addScaledVector(tmpUp, 0.75);
      // Mid-flip the up axis points into air over the edge: keep the last placement until the new face takes over.
      if (!solid || (!this.placeShadow(solid) && s.action !== Action.Flip)) this.shadow.visible = false;
    }
    return changed;
  }

  /**
   * Correction blend: on request, the error between last frame's drawn pose and this frame's is captured, then decays
   * to 0 over BLEND_MS (position offset + orientation slerp). Records this frame's pose for the next request.
   */
  private applyBlend(wasShown: boolean, nowMs: number): void {
    if (this.blendRequested) {
      this.blendRequested = false;
      if (wasShown && this.hasLast) {
        const err = this.lastPos.clone().sub(this.ball.position);
        this.lastCorrection = err.length();
        this.blend = { pos: err, q: this.lastOrient.clone().multiply(orient.clone().invert()), start: nowMs };
      }
    }
    if (this.blend) {
      const k = (nowMs - this.blend.start) / BLEND_MS;
      if (k >= 1) this.blend = null;
      else {
        this.ball.position.addScaledVector(this.blend.pos, 1 - k);
        orient.premultiply(blendQ.copy(this.blend.q).slerp(IDENTITY, k));
      }
    }
    this.lastPos.copy(this.ball.position);
    this.lastOrient.copy(orient);
    this.hasLast = true;
  }

  /** The landing marker of a forward jump: flat on L's face, shrinking toward the landing. */
  private placeMarker(s: Seg, renderTick: number): void {
    const { from, to } = s;
    const lead = tuning.markerLeadTicks; // 0 = the whole jump, else only its last `lead` ticks
    const forward = this.shown && s.action === Action.Jump && (lead <= 0 || s.endTick - renderTick <= lead)
      && (from.cell.x !== to.cell.x || from.cell.y !== to.cell.y || from.cell.z !== to.cell.z);
    this.marker.visible = forward;
    this.markerCell = forward ? `${to.cell.x},${to.cell.y},${to.cell.z}|${to.up}` : '';
    if (!forward) return;
    const u = dirVec(to.up);
    probe.set(u.x, u.y, u.z);
    this.marker.position.set(to.cell.x - u.x * 0.47, to.cell.y - u.y * 0.47, to.cell.z - u.z * 0.47);
    this.marker.quaternion.setFromUnitVectors(Z_AXIS, probe);
    const p = Math.min(1, Math.max(0, (renderTick - s.startTick) / Math.max(1, s.endTick - s.startTick)));
    this.marker.scale.setScalar(1.25 - 0.45 * p);
  }

  /**
   * The hot tile under a heated ball (phase 12). `heat` is the server's count on the ball's current tile; the glow
   * follows the settled pose (the tile it stands on), so it vanishes as soon as the ball moves.
   */
  placeHot(heat: number, cfg: { warnTicks: number; burnTicks: number } | null, timeSec: number): void {
    const s = this.current;
    const still = this.shown && cfg && (s.action === Action.Idle || s.action === Action.Turn || s.action === Action.Hop);
    this.hotLevel = still && heat >= cfg.warnTicks ? Math.min(1, (heat - cfg.warnTicks) / (cfg.burnTicks - cfg.warnTicks)) : 0;
    this.hot.visible = this.hotLevel > 0;
    if (!this.hot.visible) return;
    const u = dirVec(s.from.up), c = s.from.cell;
    this.hot.position.set(c.x - u.x * 0.49, c.y - u.y * 0.49, c.z - u.z * 0.49);
    this.hot.quaternion.setFromUnitVectors(Z_AXIS, probe.set(u.x, u.y, u.z));
    const t = this.hotLevel;
    const flicker = t > 0.6 ? 0.5 + 0.5 * Math.sin(timeSec * (20 + 30 * t)) : 0;
    this.hotMat.color.copy(HOT_ORANGE).lerp(HOT_RED, Math.min(1, t * 0.8 + flicker * 0.4));
    this.hotMat.opacity = 0.35 + 0.5 * t;
  }

  /** The marker turns red when a ball stands on it (a stomp is coming), else it's the jumper's colour. */
  setMarkerTaken(taken: boolean): void {
    this.markerMat.color.set(taken ? MARKER_RED : this.color);
  }

  /** Feel on a change of on-screen action: sounds, plus the squash kicks that happen at a moment (not over time). */
  private transition(prev: number, s: Seg, solid: SolidFn | null, feel: FeelFn): void {
    const sq = tuning.squash;
    const airborne = prev === Action.Hop || prev === Action.Jump || prev === Action.Fall || prev === Action.Rebound;
    if (airborne && s.action !== Action.Fall && s.action !== Action.Dead && s.action !== Action.Rebound) {
      const i = prev === Action.Hop || prev === Action.Rebound ? 0.35 : prev === Action.Jump ? 0.55 : Math.min(1, 0.5 + 0.1 * this.fallCells);
      this.kick(tmpUp, (SQUASH.landMin + (SQUASH.landMax - SQUASH.landMin) * i) * sq);
      feel('land', i);
    }
    // A contact or boing moment that a slow frame skipped past still fires, late rather than never.
    if (this.contactPending && s.action !== Action.Knocked) { this.contactPending = false; feel('hit'); }
    if (this.boingPending && s.action !== Action.Stunned) { this.boingPending = false; feel('boing'); }
    if (this.strikePending && s.action !== Action.Strike) { this.strikePending = false; feel('strike'); }
    if (prev === Action.Knocked && s.action !== Action.Knocked) this.kick(this.knockAxis, SQUASH.stop * sq);
    switch (s.action) {
      case Action.Hop:
      case Action.Jump: // your own ball leaves at once (phase 11: a wind-up reads as input lag); others wind up
        if (!this.local) this.kick(tmpUp, Math.min(this.spring.x, SQUASH.anticipation * sq));
        feel('takeoff');
        break;
      case Action.Roll: if (this.spring.x > SQUASH.roll * sq) this.kick(tmpUp, SQUASH.roll * sq); feel('roll'); break; // don't cut a jiggle short
      case Action.Flip: feel('flip'); break;
      case Action.Climb: { // squash into the corner, toward the wall that becomes the floor
        const f = dirVec(s.from.fwd);
        this.kick(probe.set(f.x, f.y, f.z), SQUASH.climb * sq);
        feel('climb');
        break;
      }
      case Action.Rebound: this.kick(tmpUp, SQUASH.contact * sq); feel('clash'); break; // bounced off a high hop
      case Action.Knocked: this.contactPending = true; break;
      case Action.Stunned: this.boingPending = s.bounce; break;
      case Action.Strike: this.strikePending = true; break;
      case Action.Fall:
        if (prev !== Action.Fall) {
          this.fallCells = 0;
          if (solid && this.offMap(s, solid)) feel('fall');
        }
        this.fallCells++;
        break;
    }
  }

  /** Nothing solid below the fall's start, down past the kill margin: this fall leaves the map. */
  private offMap(s: Seg, solid: SolidFn): boolean {
    const [ux, uy, uz] = this.pose.up.map(Math.round);
    const { x, y, z } = s.from.cell;
    for (let k = 1; k <= 40 + KILL_MARGIN; k++) if (solid(x - ux * k, y - uy * k, z - uz * k)) return false;
    return true;
  }

  private kick(axisV: THREE.Vector3, x: number): void {
    this.squashAxis.copy(axisV);
    this.spring.kick(x);
  }

  /** Push contact on the pusher's side, called by PlayersView: squash along the contact axis. */
  contact(axisV: THREE.Vector3): void {
    this.kick(axisV, SQUASH.contact * tuning.squash);
  }

  /** Direction of this ball's latest knock (read by PlayersView for the pusher's contact squash). */
  readonly knockAxis = new THREE.Vector3();

  /** Spring target + axis for the current action, the contact/boing moments, then the transform and shadow width. */
  private squash(s: Seg, renderTick: number, len: number, hold: number, dt: number, feel: FeelFn): void {
    const sq = tuning.squash;
    const t = renderTick - s.startTick;
    const p = len > 0 ? Math.min(1, Math.max(0, t / len)) : 1;
    let target = 0;
    let driven = false; // the stretch is set directly this frame (no spring step)
    switch (s.action) {
      case Action.Hop:
      case Action.Jump: {
        if (t < ANTICIPATION_TICKS && !this.local) { target = SQUASH.anticipation; this.squashAxis.copy(tmpUp); break; }
        // Velocity along the arc (cells/tick): the forward glide plus the parabola's rate along up.
        const h = (4 * (s.action === Action.Hop ? HOP_HEIGHT : JUMP_HEIGHT)) / len;
        const vu = h * (1 - 2 * p);
        vel.set(s.to.cell.x - s.from.cell.x, s.to.cell.y - s.from.cell.y, s.to.cell.z - s.from.cell.z).divideScalar(len);
        const vmax = Math.hypot(vel.length(), h);
        vel.addScaledVector(tmpUp, vu);
        const speed = vel.length();
        if (speed > 1e-6) this.squashAxis.copy(vel).divideScalar(speed);
        target = (vu >= 0 ? SQUASH.rise : SQUASH.descend) * (speed / vmax);
        break;
      }
      case Action.Fall: target = SQUASH.fall; this.squashAxis.copy(tmpUp); break;
      case Action.Knocked: {
        knockDir.set(s.to.cell.x - s.from.cell.x, s.to.cell.y - s.from.cell.y, s.to.cell.z - s.from.cell.z).normalize();
        this.knockAxis.copy(knockDir);
        if (this.stompSerials.has(s.serial) && p < hold) {
          // Stomped: flat under the attacker (contact fires at once), then it slides out below.
          if (this.contactPending) { this.contactPending = false; feel('hit'); }
          this.squashAxis.copy(tmpUp);
          this.spring.x = SQUASH.stomp * sq;
          this.spring.v = 0;
          driven = true;
        } else if (this.contactPending && p >= hold) {
          this.contactPending = false;
          this.kick(knockDir, SQUASH.contact * sq);
          feel('hit');
        } else if (p > hold && !this.contactPending) {
          // The slide is only ~2 ticks, too short for the spring to swing from the contact squash into a stretch:
          // drive it, squash → stretch over the first third, then hold the stretch until the stop kick.
          const k = (p - hold) / (1 - hold);
          this.squashAxis.copy(knockDir);
          const from = this.stompSerials.has(s.serial) ? SQUASH.stomp : SQUASH.contact;
          this.spring.x = (k < 0.35 ? from + (SQUASH.slide - from) * (k / 0.35) : SQUASH.slide) * sq;
          this.spring.v = 0;
          driven = true;
        }
        break;
      }
      case Action.Stunned: {
        const fade = Math.max(0, 1 - t / STUN_TICKS);
        if (this.boingPending && t >= LUNGE_TICKS / 2) {
          this.boingPending = false;
          this.kick(tmpFwd.set(0, 0, 1).applyQuaternion(tmpQ), SQUASH.bounce * sq);
          feel('boing');
        } else if (!s.bounce) {
          // Wobble on two axes: the stretch axis circles the ground plane while it dies out.
          frameX.set(1, 0, 0).applyQuaternion(tmpQ);
          frameZ.set(0, 0, 1).applyQuaternion(tmpQ);
          const a = t * 0.9;
          this.squashAxis.copy(frameX).multiplyScalar(Math.cos(a)).addScaledVector(frameZ, Math.sin(a));
          target = SQUASH.wobble * fade * Math.sin(t * 2.2);
        }
        break;
      }
    }
    if (!driven) this.spring.step(dt, target * sq, tuning.stiffness, tuning.damping);
    const k = Math.min(1.6, Math.max(0.5, 1 + this.spring.x));
    applySquash(this.ball, this.body, this.squashAxis, k, orient);
    // Keep the bottom on the ground: move the centre by the change in the ball's half-height along up.
    const along = Math.abs(this.squashAxis.dot(tmpUp)), side = 1 / Math.sqrt(k);
    this.ball.position.addScaledVector(tmpUp, BALL_RADIUS * (along * k + (1 - along) * side - 1));
    // Shadow width: the ball's footprint on the ground plane (wide when squashed along up).
    this.shadowWidth = along * side + ((1 - along) * (k + side)) / 2;
  }

  /** Wobble, the flashing ring, and for a bounce the lunge into the blocked push and back. Ball only, not the camera. */
  private stunned(s: Seg, renderTick: number): void {
    const t = renderTick - s.startTick;
    const fade = Math.max(0, 1 - t / STUN_TICKS);
    orient.multiply(wobQ.setFromAxisAngle(Z_AXIS, WOBBLE_RAD * fade * Math.sin((t / STUN_TICKS) * WOBBLE_CYCLES * 2 * Math.PI)));
    if (s.bounce && t < LUNGE_TICKS) {
      tmpFwd.set(0, 0, 1).applyQuaternion(tmpQ);
      this.ball.position.addScaledVector(tmpFwd, LUNGE_CELLS * Math.sin((Math.max(0, t) / LUNGE_TICKS) * Math.PI));
    }
    this.ring.visible = Math.floor(t * 3) % 2 === 0; // flashes ~6 times a second
    this.ring.position.copy(this.ball.position).addScaledVector(tmpUp, 0.6);
    this.ring.quaternion.copy(tmpQ).multiply(RING_TILT); // lies flat, facing up
  }

  /** Cradle strike: a lunge like a bounce's (no stun ring), peaking at contact, then the recoil. */
  private strike(s: Seg, renderTick: number, feel: FeelFn): void {
    const t = Math.max(0, renderTick - s.startTick);
    const k = t < STRIKE_CONTACT_TICKS ? t / STRIKE_CONTACT_TICKS : Math.max(0, (STRIKE_TICKS - t) / (STRIKE_TICKS - STRIKE_CONTACT_TICKS));
    this.ball.position.addScaledVector(tmpFwd.set(0, 0, 1).applyQuaternion(tmpQ), STRIKE_CELLS * k);
    if (this.strikePending && t >= STRIKE_CONTACT_TICKS) { this.strikePending = false; feel('strike'); }
  }

  /** A middle ball of a cradle passing the strike on: a quick squash along it. */
  shudder(axisV: THREE.Vector3): void {
    this.kick(axisV, SQUASH.shudder * tuning.squash);
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
      this.shadow.scale.setScalar(this.shadowWidth * Math.max(0.5, 1 - above / 4)); // shrinks with height
      this.shadow.visible = true;
      return true;
    }
    return false;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.ball, this.shadow, this.ring, this.marker, this.hot);
    this.markerMat.dispose();
    this.hotMat.dispose();
    this.shadowMat.dispose();
    this.top.dispose();
    this.bottom.dispose();
    if (this.label) { scene.remove(this.label); this.label.element.remove(); }
  }
}

const ACTIVE = new Set(['countdown', 'playing', 'results']);
const cellOf = (p: Pose) => `${p.cell.x},${p.cell.y},${p.cell.z}`;

export class PlayersView {
  private views = new Map<string, PlayerView>();
  private lastPhase = '';
  private solid: SolidFn | null = null;
  /** Called with the last on-screen position when a ball dies (renders its fade at the fall point). */
  onVanish: ((at: THREE.Vector3, color: string) => void) | null = null;
  /** Called when the local player's rendered action changes to a moving one (input→motion metric). */
  onLocalMotion: (() => void) | null = null;
  /** Render-time feel events (sounds). */
  onFeel: ((e: Feel) => void) | null = null;
  /** Hit-stop: a ball's render tick is held at `tick` until `until` (performance.now ms). Local and visual only. */
  private frozen = new Map<string, { until: number; tick: number }>();
  /** Cradle shudders waiting for their frame: one middle ball per frame, down the line (phase 12b). */
  private shudders: { view: PlayerView; axis: THREE.Vector3; step: number; of: number }[] = [];

  constructor(private scene: THREE.Scene) {}

  /** Solid test for blob shadows (the level minus crumbled blocks), or null without a level. */
  setSolid(solid: SolidFn | null): void {
    this.solid = solid;
  }

  /** The level's hot-tile thresholds (phase 12), or null when off. */
  heat: { warnTicks: number; burnTicks: number } | null = null;

  /** Balls glowing on a hot tile, for the sizzle: level 0..1 (warned → burning). */
  hotBalls(): { id: string; at: THREE.Vector3; local: boolean; level: number }[] {
    return [...this.views].filter(([, v]) => v.hotLevel > 0).map(([id, v]) => ({ id, at: v.ball.position, local: v.local, level: v.hotLevel }));
  }

  /** Where a ball is drawn (for effects such as the burn puff), or null when it isn't on screen. */
  ballAt(id: string): THREE.Vector3 | null {
    const v = this.views.get(id);
    return v?.shown ? v.ball.position.clone() : null;
  }

  /**
   * The local ball renders at localRenderTick (it may run closer to the server than the others). With prediction
   * (§17) `local` is the predicted local player, rendered at the predicted tick; `corrected` blends a correction.
   */
  update(
    state: GameState, renderTick: number, localId: string, localRenderTick = renderTick, dt = 0, nowMs = 0,
    local: PlayerS | null = null, corrected = false,
  ): void {
    const newRound = state.phase === 'countdown' && this.lastPhase !== 'countdown';
    this.lastPhase = state.phase;
    const active = ACTIVE.has(state.phase);

    state.players.forEach((p, id) => {
      let v = this.views.get(id);
      if (!v) this.views.set(id, (v = new PlayerView(p, id === localId, this.scene)));
      if (newRound) v.clear(); // last round's segments would otherwise sort before the new spawn
      if (id === localId) {
        const source = local ? 'pred' : 'server';
        if (v.source !== source) { v.source = source; v.clear(); v.requestBlend(); } // the timelines don't mix
        else if (corrected) v.requestBlend();
      }
      v.track(id === localId && local ? local : p);
    });
    for (const [id, v] of this.views) {
      v.stompSerials.clear();
      for (const q of v.segs) if (q.action === Action.Knocked && this.stomperOf(q, id)) v.stompSerials.add(q.serial);
    }
    state.players.forEach((p, id) => {
      const v = this.views.get(id)!;
      const hold = (s: Seg) => this.knockHold(s, id, localId, localRenderTick - renderTick);
      let tick = id === localId ? localRenderTick : renderTick;
      const f = this.frozen.get(id);
      if (f && nowMs < f.until) tick = f.tick;
      else this.frozen.delete(id);
      const feel: FeelFn = (kind, intensity = 0.5) => {
        if (kind === 'hit') this.contact(id, v, localId, nowMs);
        else if (kind === 'clash') this.clash(v);
        else if (kind === 'strike') this.strike(v);
        else this.onFeel?.({ kind, at: v.ball.position, local: v.local, intensity });
      };
      const changed = v.update(tick, active && !p.spectating, this.solid, hold, dt, feel, nowMs);
      if (changed && id === localId && v.action !== Action.Idle && v.action !== Action.Dead) this.onLocalMotion?.();
      if (v.vanished) {
        this.onVanish?.(v.ball.position, v.color);
        this.onFeel?.({ kind: 'pop', at: v.ball.position, local: v.local, intensity: 0.5 });
      }
    });
    for (const [id, v] of this.views) {
      if (!state.players.has(id)) { v.dispose(this.scene); this.views.delete(id); }
    }
    const sh = this.shudders.shift();
    if (sh?.view.shown) {
      sh.view.shudder(sh.axis);
      this.onFeel?.({ kind: 'clack', at: sh.view.ball.position, local: sh.view.local, intensity: sh.of > 1 ? sh.step / (sh.of - 1) : 0 });
    }
    const cfg = this.heat;
    state.players.forEach((p, id) => this.views.get(id)?.placeHot(p.heat, cfg, nowMs / 1000));
    // Markers go red over a ball (a stomp is coming): anyone else on screen standing in the marked cell.
    const standing = new Set<string>();
    for (const v of this.views.values()) if (v.shown) standing.add(`${cellOf(v.current.from)}|${v.current.from.up}`);
    for (const v of this.views.values()) if (v.markerCell) v.setMarkerTaken(standing.has(v.markerCell));
  }

  /**
   * Cradle strike contact (§14): the balls lined up in front of the striker on its face. All but the last shudder in
   * turn, one per frame, each with a clack; the last one's knock plays the normal hit when its slide starts.
   */
  private strike(striker: PlayerView): void {
    const { cell, up, fwd } = striker.current.from, F = dirVec(fwd);
    const line: PlayerView[] = [];
    for (let k = 1; ; k++) {
      const key = `${cell.x + F.x * k},${cell.y + F.y * k},${cell.z + F.z * k}`;
      const q = [...this.views.values()].find((v) => v !== striker && v.shown && v.current.from.up === up && cellOf(v.current.from) === key);
      if (!q) break;
      line.push(q);
    }
    const middle = line.slice(0, -1), axisV = new THREE.Vector3(F.x, F.y, F.z);
    middle.forEach((view, step) => this.shudders.push({ view, axis: axisV, step, of: middle.length }));
  }

  /** The cradle strike behind a knock: a Strike starting on the knock's tick, on the same face. */
  private strikerOf(knock: Seg): boolean {
    for (const v of this.views.values()) {
      if (v.segs.some((q) => q.action === Action.Strike && q.startTick === knock.startTick && q.from.up === knock.from.up)) return true;
    }
    return false;
  }

  /** Clash (§16): the rebounding attacker squashed itself; the hopping victim at its landing cell squashes too. */
  private clash(attacker: PlayerView): void {
    const L = attacker.current.from; // a rebound starts at the landing cell it bounced off
    for (const v of this.views.values()) {
      if (v === attacker || !v.shown || cellOf(v.current.from) !== cellOf(L)) continue;
      const u = dirVec(v.current.from.up);
      v.contact(probe.set(u.x, u.y, u.z));
      this.onFeel?.({ kind: 'clash', at: attacker.ball.position, local: attacker.local || v.local, intensity: 0.6 });
      return;
    }
    this.onFeel?.({ kind: 'clash', at: attacker.ball.position, local: attacker.local, intensity: 0.6 });
  }

  /**
   * The player whose landing stomped this knock: a Jump (or a Fall, §16 fall stomp) ending on the knock's start tick
   * in the victim's cell.
   */
  private stomperOf(knock: Seg, victimId: string): string | null {
    for (const [id, v] of this.views) {
      if (id === victimId) continue;
      if (v.segs.some((q) => (q.action === Action.Jump || q.action === Action.Fall) && q.endTick === knock.startTick
        && q.to.cell.x === knock.from.cell.x && q.to.cell.y === knock.from.cell.y && q.to.cell.z === knock.from.cell.z)) return id;
    }
    return null;
  }

  /**
   * Push contact on `victim` (its knock's slide begins on screen): the pusher squashes too, both freeze for the hit-stop,
   * and the THWACK plays at the victim.
   */
  private contact(victimId: string, victim: PlayerView, localId: string, nowMs: number): void {
    const stomperId = this.stomperOf(victim.current, victimId);
    const pusherId = stomperId ?? this.pusherOf(victim.current, victimId);
    const pusher = pusherId ? this.views.get(pusherId) : undefined;
    if (!stomperId) pusher?.contact(victim.knockAxis); // a stomper squashes from its own landing instead
    if (tuning.hitStopMs > 0) {
      for (const [id, v] of [[victimId, victim], [pusherId, pusher]] as const) {
        if (id && v) this.frozen.set(id, { until: nowMs + tuning.hitStopMs, tick: v.renderTickNow });
      }
    }
    this.onFeel?.({
      kind: stomperId ? 'stomp' : 'hit', at: victim.ball.position, local: victim.local || !!pusher?.local,
      intensity: victim.local ? 1 : 0.6, victimLocal: victimId === localId,
    });
  }

  /** The player whose roll pushed this knock: a Roll starting on the same tick into the victim's cell. */
  private pusherOf(knock: Seg, victimId: string): string | null {
    for (const [id, v] of this.views) {
      if (id === victimId) continue;
      if (v.segs.some((q) => q.action === Action.Roll && q.startTick === knock.startTick
        && q.to.cell.x === knock.from.cell.x && q.to.cell.y === knock.from.cell.y && q.to.cell.z === knock.from.cell.z)) return id;
    }
    return null;
  }

  /** Last correction blend of the local ball (cells), for F3. */
  localCorrection(localId: string): number { return this.views.get(localId)?.lastCorrection ?? 0; }

  /** Every ball's roll state for the rumble loops: speed 1 while rolling or flipping on screen. */
  rolling(): { id: string; speed: number; at: THREE.Vector3; local: boolean }[] {
    return [...this.views].map(([id, v]) => ({
      id, at: v.ball.position, local: v.local, speed: v.shown && (v.action === Action.Roll || v.action === Action.Flip || v.action === Action.Climb) ? 1 : 0,
    }));
  }

  /**
   * The local ball renders `lead` ticks closer to the server than the others. A knock (which starts on the same tick
   * as the pusher's roll) waits 1 tick for the pusher to close the gap, adjusted so it matches what is on screen:
   * longer when the victim is local, shorter when the pusher is.
   */
  private knockHold(s: Seg, victimId: string, localId: string, lead: number): number {
    if (s.action !== Action.Knocked) return KNOCK_HOLD;
    if (this.stomperOf(s, victimId)) return STOMP_HOLD; // the attacker lands on it: no gap to close
    if (this.strikerOf(s)) return CRADLE_HOLD_TICKS / KNOCK_TICKS; // the impulse travels down the line first
    let ticks = 1 + (victimId === localId ? lead : 0);
    if (this.pusherOf(s, victimId) === localId) ticks -= lead;
    return Math.min(KNOCK_TICKS - 1, Math.max(0, ticks)) / KNOCK_TICKS;
  }

  /** A ball's render pose, or null when it isn't on screen (lobby, spectating, dead). */
  poseOf(id: string): RenderPose | null {
    const v = this.views.get(id);
    return v?.shown ? v.pose : null;
  }

  /** Glow the winner during results (id '' = nobody). */
  highlight(winnerId: string, timeSec: number): void {
    for (const [id, v] of this.views) v.highlight(id === winnerId, timeSec);
  }

  localLate(localId: string): { count: number; max: number } {
    const v = this.views.get(localId);
    return { count: v?.lateCount ?? 0, max: v?.lateMax ?? 0 };
  }

  localAction(localId: string): number | null {
    return this.views.get(localId)?.action ?? null;
  }
}
