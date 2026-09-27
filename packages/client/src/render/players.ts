import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  Action, ALL_DIRS, BALL_RADIUS, CLIMB_SPIN, cross, dirVec, HOP_HEIGHT, JUMP_GRACE_TICKS, JUMP_HEIGHT, KILL_MARGIN, KNOCK_HOLD, KNOCK_SPIN, KNOCK_TICKS, newRenderPose, perpendicular, poseAt,
  SPIN_PER_CELL, STRIKE_TICKS, STUN_TICKS, TICK_RATE, tileKey, TURN_TICKS,
  type AirTurn, type Dir, type Level, type Pose, type RenderPose,
} from '@kula/shared';
import type { GameState, PlayerS } from '../net.ts';
import { tuning } from '../tuning.ts';
import { applySquash, Spring } from './squash.ts';
import { art, BALL_MODELS } from './art.ts';

/**
 * Feel events (phase 08), raised at render time when a ball's on-screen action changes, so sounds match what you see.
 * `hit` is push contact (at the victim), `pop` a death, `clack` a middle ball of a cradle passing the strike on.
 */
export type FeelKind = 'takeoff' | 'land' | 'roll' | 'flip' | 'climb' | 'fall' | 'hit' | 'boing' | 'pop' | 'stomp' | 'clash' | 'strike' | 'clack'
  | 'slide' | 'launch' | 'edge' | 'whoosh' | 'charge';
export interface Feel { kind: FeelKind; at: THREE.Vector3; local: boolean; intensity: number; victimLocal?: boolean; headOn?: boolean }
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
// recoils. The middle balls then shudder along F in turn, spaced so the last clack lands before the last ball's slide
// (the hold) for any line length (phase 12c).
const STRIKE_CELLS = 0.2;
const STRIKE_CONTACT_TICKS = 1;
const CRADLE_HOLD_TICKS = 2;
/** Per fire landing in a row (§18), the ball's scale grows by this. */
const FIRE_SWELL = 0.07;
/** Edge warning line thickness (phase 13a). */
const EDGE_THICK = 0.12;
const streakGeo = new THREE.PlaneGeometry(0.9, 0.28);
const streakM = new THREE.Matrix4(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
const CLACK_WINDOW_MS = (CRADLE_HOLD_TICKS - STRIKE_CONTACT_TICKS) * 1000 / TICK_RATE; // from contact to the end of the hold
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
  charge: -0.3, // held on a boost pad, squashed down, ready to fly (phase 14c)
  headOn: -0.45, // both balls of a head-on (§20), hard along the contact axis
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
  /** Head-on knock-backs (§20, serial → lunge): the ball first lunges this far to where the two touch. By PlayersView. */
  readonly headOn = new Map<number, THREE.Vector3>();
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
  /** Fire landings in a row (§18): the ball inflates a little per count (visual only; 3 pops it). */
  private fireCount = 0;

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
    this.fireCount = p.fireCount ?? 0;
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
      const lunge = s.action === Action.Knocked ? this.headOn.get(s.serial) : undefined;
      if (lunge) {
        // Head-on: out to the touch point during the hold (the contact), then eased back into the knock-back slide.
        const p = len > 0 ? Math.min(1, Math.max(0, (renderTick - s.startTick) / len)) : 1, h = knockHold(s);
        this.ball.position.addScaledVector(lunge, p < h ? Math.sin((p / h) * Math.PI / 2) : 1 - (p - h) / (1 - h));
      }
      spinQ.setFromAxisAngle(X_AXIS, this.spinBase + this.pose.spin);
      orient.copy(tmpQ.fromArray(this.pose.quat));
      if (s.action === Action.Stunned) this.stunned(s, renderTick);
      if (s.action === Action.Strike) this.strike(s, renderTick, feel);
      const ghost = renderTick < this.protectedUntil;
      for (const mat of [this.top, this.bottom]) { mat.transparent = ghost; mat.opacity = ghost ? 0.4 : 1; }
      orient.multiply(spinQ);
      // Knocked out of a move (a side hit, a head-on, §20): blend from where the ball was drawn instead of snapping.
      if (changed && s.action === Action.Knocked && (prevAction === Action.Roll || prevAction === Action.Flip || prevAction === Action.Knocked)) this.blendRequested = true;
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
   * The hot tile under a heated ball (phase 12). `heat` is the server's heat of the tile the ball is on; the glow
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
      case Action.Charge: target = SQUASH.charge; this.squashAxis.copy(tmpUp); break;
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
          this.kick(knockDir, (this.headOn.has(s.serial) ? SQUASH.headOn : SQUASH.contact) * sq);
          feel('hit');
        } else if (p > hold && !this.contactPending) {
          // The slide is only ~2 ticks, too short for the spring to swing from the contact squash into a stretch:
          // drive it, squash → stretch over the first third, then hold the stretch until the stop kick.
          const k = (p - hold) / (1 - hold);
          this.squashAxis.copy(knockDir);
          const from = this.stompSerials.has(s.serial) ? SQUASH.stomp : this.headOn.has(s.serial) ? SQUASH.headOn : SQUASH.contact;
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
    if (this.fireCount) this.ball.scale.multiplyScalar(1 + FIRE_SWELL * this.fireCount);
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

  /** Roll under (§14): this (hopping) ball's shadow sits on top of the ball below it instead of the floor. */
  shadowOn(below: THREE.Vector3): void {
    tmpUp.fromArray(this.pose.up);
    this.shadow.position.copy(below).addScaledVector(tmpUp, BALL_RADIUS + 0.02);
    this.shadow.quaternion.setFromUnitVectors(Z_AXIS, tmpUp);
    this.shadow.scale.setScalar(0.6 * this.shadowWidth);
    this.shadowMat.opacity = SHADOW_OPACITY;
    this.shadow.visible = true;
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
  /** Cradle shudders waiting for their time (`at`, performance.now ms), down the line (phase 12b/12c). */
  private shudders: { view: PlayerView; axis: THREE.Vector3; step: number; of: number; at: number }[] = [];

  /**
   * Edge-proximity warning (phase 12c, stronger in 13a): a pulsing line on the local ball's edge and a ring on the
   * enemy's tile, in the enemy's colour, when an enemy is just around the edge. `edgeEnemy` is who it's showing.
   */
  private readonly edgeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  private readonly edgeGlow = new THREE.Mesh(new THREE.BoxGeometry(1, EDGE_THICK, EDGE_THICK), this.edgeMat);
  private readonly edgeRing = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.5, 32), this.edgeMat);
  private edgeEnemy: PlayerView | null = null;
  private edgeLevel = 0;
  /** Tiles for slide streaks and launch sounds (§18), or null without a level. */
  private level: Level | null = null;
  private readonly streaks = new Map<PlayerView, THREE.Mesh>();
  private readonly streakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
  /** Balls holding on a boost pad right now (for the charge hum's start). */
  private readonly charging = new WeakSet<PlayerView>();
  /** Roll under (§14): the last roll segment (serial) per ball that whooshed under a hop, so it plays once. */
  private readonly whooshed = new WeakMap<PlayerView, number>();

  constructor(private scene: THREE.Scene) {
    this.edgeGlow.visible = this.edgeRing.visible = false;
    scene.add(this.edgeGlow, this.edgeRing);
  }

  setLevel(level: Level | null): void { this.level = level; }

  /** Where balls are rolling, flipping or climbing onto right now (boost pads glow before the launch). */
  rollingOnto(): Pose[] {
    return [...this.views.values()].filter((v) => v.shown && (v.action === Action.Roll || v.action === Action.Flip || v.action === Action.Climb)).map((v) => v.current.to);
  }

  /** Where balls are held on a boost pad (Charge, phase 14c): those pads glow brightest. */
  chargingOn(): Pose[] {
    return [...this.views.values()].filter((v) => v.shown && v.action === Action.Charge).map((v) => v.current.from);
  }

  /** The tile under a pose: its whole-block and face tile types (§18). */
  private tileTypes(p: Pose): { block?: string; face?: string } {
    if (!this.level) return {};
    const u = dirVec(p.up), b = `${p.cell.x - u.x},${p.cell.y - u.y},${p.cell.z - u.z}`;
    return { block: this.level.blockTiles.get(b)?.type, face: this.level.faceTiles.get(`${b}|${p.up}`)?.type };
  }

  /**
   * Ice and boosts on screen (§18): a roll/flip starting from ice is a slide (a streak behind the ball, "ssss" when a
   * slide starts), a jump starting from a boost pad is a launch ("pwomp").
   */
  private trapFeel(v: PlayerView, changed: boolean): void {
    const s = v.current, t = this.tileTypes(s.from);
    const sliding = v.shown && t.block === 'ice' && (s.action === Action.Roll || s.action === Action.Flip || s.action === Action.Climb);
    let streak = this.streaks.get(v);
    if (changed && sliding && !streak?.visible) this.onFeel?.({ kind: 'slide', at: v.ball.position, local: v.local, intensity: 0.5 });
    if (changed && s.action === Action.Jump && t.face === 'boost') this.onFeel?.({ kind: 'launch', at: v.ball.position, local: v.local, intensity: 0.5 });
    // Held on a pad (phase 14c): one rising hum when the hold starts (a hold is a run of 1-tick Charge segments).
    const charging = v.shown && s.action === Action.Charge;
    if (charging && !this.charging.has(v)) this.onFeel?.({ kind: 'charge', at: v.ball.position, local: v.local, intensity: 0.5 });
    if (charging) this.charging.add(v); else this.charging.delete(v);
    if (!streak && sliding) {
      streak = new THREE.Mesh(streakGeo, this.streakMat);
      this.scene.add(streak);
      this.streaks.set(v, streak);
    }
    if (!streak) return;
    streak.visible = sliding;
    if (!sliding) return;
    // A pale streak on the ice behind the ball, along its motion.
    const u = dirVec(s.from.up), f = dirVec(s.from.fwd);
    streak.position.copy(v.ball.position).add(probe.set(-f.x * 0.55 - u.x * 0.42, -f.y * 0.55 - u.y * 0.42, -f.z * 0.55 - u.z * 0.42));
    tmpA.set(f.x, f.y, f.z);
    tmpB.set(u.x, u.y, u.z);
    streak.quaternion.setFromRotationMatrix(streakM.makeBasis(tmpA, probe.copy(tmpB).cross(tmpA), tmpB));
  }

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
      v.headOn.clear();
      for (const q of v.segs) {
        if (q.action !== Action.Knocked) continue;
        if (this.stomperOf(q, id)) v.stompSerials.add(q.serial);
        if (q.bounce) v.headOn.set(q.serial, this.lungeOf(v, q)); // only a head-on's knock-back has bounce (§20)
      }
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
        else if (kind === 'strike') this.strike(v, nowMs);
        else this.onFeel?.({ kind, at: v.ball.position, local: v.local, intensity });
      };
      const changed = v.update(tick, active && !p.spectating, this.solid, hold, dt, feel, nowMs);
      this.trapFeel(v, changed);
      if (changed && id === localId && v.action !== Action.Idle && v.action !== Action.Dead) this.onLocalMotion?.();
      if (v.vanished) {
        this.onVanish?.(v.ball.position, v.color);
        this.onFeel?.({ kind: 'pop', at: v.ball.position, local: v.local, intensity: 0.5 });
      }
    });
    for (const [id, v] of this.views) {
      if (!state.players.has(id)) {
        v.dispose(this.scene);
        this.views.delete(id);
        const streak = this.streaks.get(v);
        if (streak) { this.scene.remove(streak); this.streaks.delete(v); }
      }
    }
    while (this.shudders.length && this.shudders[0].at <= nowMs) {
      const sh = this.shudders.shift()!;
      if (!sh.view.shown) continue;
      sh.view.shudder(sh.axis);
      this.onFeel?.({ kind: 'clack', at: sh.view.ball.position, local: sh.view.local, intensity: sh.of > 1 ? sh.step / (sh.of - 1) : 0 });
    }
    this.placeEdgeGlow(localId, dt, nowMs / 1000);
    this.rollUnder();
    const cfg = this.heat;
    for (const v of this.views.values()) {
      const { cell, up } = v.current.from;
      v.placeHot(state.hot.get(tileKey(cell, up)) ?? 0, cfg, nowMs / 1000);
    }
    // Markers go red over a ball (a stomp is coming): anyone else on screen standing in the marked cell.
    const standing = new Set<string>();
    for (const v of this.views.values()) if (v.shown) standing.add(`${cellOf(v.current.from)}|${v.current.from.up}`);
    for (const v of this.views.values()) if (v.markerCell) v.setMarkerTaken(standing.has(v.markerCell));
  }

  /**
   * Roll under a hop (§14): a ball on the ground in (or rolling through) a hopper's cell gets the hopper's shadow on
   * top of it, and a whoosh once per roll that goes under.
   */
  private rollUnder(): void {
    for (const v of this.views.values()) {
      if (!v.shown || v.action !== Action.Hop || v.pose.lift < 0.25) continue;
      const cell = cellOf(v.current.from);
      tmpA.fromArray(v.pose.position).addScaledVector(tmpB.fromArray(v.pose.up), -v.pose.lift); // its ground point
      for (const w of this.views.values()) {
        if (w === v || !w.shown || (cellOf(w.current.from) !== cell && cellOf(w.current.to) !== cell)) continue;
        if (w.ball.position.distanceTo(tmpA) < 0.8) v.shadowOn(w.ball.position);
        const rolling = w.action === Action.Roll || w.action === Action.Flip;
        if (rolling && this.whooshed.get(w) !== w.current.serial) {
          this.whooshed.set(w, w.current.serial);
          this.onFeel?.({ kind: 'whoosh', at: w.ball.position, local: w.local, intensity: 0.5 });
        }
      }
    }
  }

  /**
   * Cradle strike contact (§14): the balls lined up in front of the striker on its face. All but the last shudder in
   * turn, each with a clack, spaced hold / (n − 1) so all n − 1 fit before the last one's knock plays the normal hit.
   */
  private strike(striker: PlayerView, nowMs: number): void {
    const { cell, up, fwd } = striker.current.from, F = dirVec(fwd);
    const line: PlayerView[] = [];
    for (let k = 1; ; k++) {
      const key = `${cell.x + F.x * k},${cell.y + F.y * k},${cell.z + F.z * k}`;
      const q = [...this.views.values()].find((v) => v !== striker && v.shown && v.current.from.up === up && cellOf(v.current.from) === key);
      if (!q) break;
      line.push(q);
    }
    const middle = line.slice(0, -1), axisV = new THREE.Vector3(F.x, F.y, F.z);
    const spacing = CLACK_WINDOW_MS / Math.max(1, line.length - 1);
    middle.forEach((view, step) => this.shudders.push({ view, axis: axisV, step, of: middle.length, at: nowMs + step * spacing }));
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
   * The player whose landing stomped this knock: a Jump (or a Fall or a Hop, §16 fall stomp, §14 roll under) ending on the knock's start tick
   * in the victim's cell.
   */
  private stomperOf(knock: Seg, victimId: string): string | null {
    for (const [id, v] of this.views) {
      if (id === victimId) continue;
      if (v.segs.some((q) => (q.action === Action.Jump || q.action === Action.Fall || q.action === Action.Hop) && q.endTick === knock.startTick
        && q.to.cell.x === knock.from.cell.x && q.to.cell.y === knock.from.cell.y && q.to.cell.z === knock.from.cell.z)) return id;
    }
    return null;
  }

  /**
   * Push contact on `victim` (its knock's slide begins on screen): the pusher squashes too, both freeze for the hit-stop,
   * and the THWACK plays at the victim.
   */
  private contact(victimId: string, victim: PlayerView, localId: string, nowMs: number): void {
    if (victim.headOn.has(victim.current.serial)) { this.headOnContact(victimId, victim, localId, nowMs); return; }
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

  /** The other ball of a head-on (§20): a bounce knock or bounce-stun starting on the same tick, close by. */
  private partnerOf(v: PlayerView, knock: Seg): [string, PlayerView, Seg] | null {
    const A = knock.from.cell;
    for (const [id, w] of this.views) {
      if (w === v) continue;
      const r = w.segs.find((q) => q.bounce && q.startTick === knock.startTick && (q.action === Action.Knocked || q.action === Action.Stunned)
        && Math.abs(q.from.cell.x - A.x) + Math.abs(q.from.cell.y - A.y) + Math.abs(q.from.cell.z - A.z) <= 3);
      if (r) return [id, w, r];
    }
    return null;
  }

  /**
   * How far a head-on knock-back first lunges, along the ball's own motion (against the knock), to where the two
   * balls touch: both move toward each other at the same rate (the partner along its motion, or its facing when it
   * bounced in place) until their centres are two radii apart. The same point on both screens, whatever the lead.
   */
  private lungeOf(v: PlayerView, knock: Seg): THREE.Vector3 {
    const back = (q: Seg) => tmpA.set(q.from.cell.x - q.to.cell.x, q.from.cell.y - q.to.cell.y, q.from.cell.z - q.to.cell.z);
    const da = back(knock).clone();
    const partner = this.partnerOf(v, knock);
    if (!partner) return da.multiplyScalar(0.3);
    const r = partner[2], f = dirVec(r.from.fwd);
    const db = r.action === Action.Knocked ? back(r) : tmpA.set(f.x, f.y, f.z);
    const W = tmpB.copy(da).sub(db);
    const D = probe.set(knock.from.cell.x - r.from.cell.x, knock.from.cell.y - r.from.cell.y, knock.from.cell.z - r.from.cell.z);
    const a = W.lengthSq(), b = 2 * D.dot(W), c = D.lengthSq() - (2 * BALL_RADIUS) ** 2, disc = b * b - 4 * a * c;
    const t = a < 1e-9 ? 0 : disc < 0 ? -b / (2 * a) : (-b - Math.sqrt(disc)) / (2 * a);
    return da.multiplyScalar(Math.min(1, Math.max(0, t)));
  }

  /** Head-ons whose hit already played (pair key), so the two balls' contacts make one sound. */
  private readonly headOnHeard = new Set<string>();

  /** Head-on contact (§20): both balls freeze for the hit-stop, and one hit (a bit louder) plays between them. */
  private headOnContact(victimId: string, victim: PlayerView, localId: string, nowMs: number): void {
    const partner = this.partnerOf(victim, victim.current);
    const pair: [string, PlayerView][] = partner ? [[victimId, victim], [partner[0], partner[1]]] : [[victimId, victim]];
    if (tuning.hitStopMs > 0) for (const [id, v] of pair) this.frozen.set(id, { until: nowMs + tuning.hitStopMs, tick: v.renderTickNow });
    const key = `${victim.current.startTick}|${pair.map(([id]) => id).sort().join('|')}`;
    if (this.headOnHeard.has(key)) return;
    if (this.headOnHeard.size > 32) this.headOnHeard.clear();
    this.headOnHeard.add(key);
    const at = victim.ball.position.clone();
    if (partner) at.add(partner[1].ball.position).multiplyScalar(0.5);
    const local = pair.some(([id]) => id === localId);
    this.onFeel?.({ kind: 'hit', at, local, intensity: local ? 1 : 0.7, victimLocal: local, headOn: true });
  }

  /** The player whose roll pushed this knock: a Roll (or an edge push's Flip) starting on the same tick into the victim's cell. */
  private pusherOf(knock: Seg, victimId: string): string | null {
    for (const [id, v] of this.views) {
      if (id === victimId) continue;
      if (v.segs.some((q) => (q.action === Action.Roll || q.action === Action.Flip) && q.startTick === knock.startTick
        && q.to.cell.x === knock.from.cell.x && q.to.cell.y === knock.from.cell.y && q.to.cell.z === knock.from.cell.z)) return id;
    }
    return null;
  }

  /**
   * Edge push readability (§14): an enemy standing on the adjacent face of the local ball's block, right past an open
   * edge (in T, where a roll over that edge would push it). The shared edge glows in the enemy's colour, fading in.
   */
  private placeEdgeGlow(localId: string, dt: number, timeSec: number): void {
    const me = this.views.get(localId);
    let enemy: PlayerView | null = null;
    if (me?.shown && this.solid) {
      const { cell: c, up } = me.current.from, U = dirVec(up);
      for (const d of ALL_DIRS) {
        if (!perpendicular(d, up)) continue;
        const D = dirVec(d), T = { x: c.x + D.x - U.x, y: c.y + D.y - U.y, z: c.z + D.z - U.z };
        if (this.solid(c.x + D.x, c.y + D.y, c.z + D.z) || this.solid(T.x, T.y, T.z)) continue; // no open edge that way
        const key = `${T.x},${T.y},${T.z}`;
        enemy = [...this.views.values()].find((v) => v !== me && v.shown && v.current.from.up === d && cellOf(v.current.from) === key) ?? null;
        if (!enemy) continue;
        const along = dirVec(cross(up, d));
        this.edgeGlow.position.set(c.x + (D.x - U.x) / 2, c.y + (D.y - U.y) / 2, c.z + (D.z - U.z) / 2);
        this.edgeGlow.quaternion.setFromUnitVectors(X_AXIS, probe.set(along.x, along.y, along.z));
        // The ring lies on the enemy's tile: the side face of our block, just under the enemy.
        this.edgeRing.position.set(T.x - D.x * 0.49, T.y - D.y * 0.49, T.z - D.z * 0.49);
        this.edgeRing.quaternion.setFromUnitVectors(Z_AXIS, probe.set(D.x, D.y, D.z));
        this.edgeMat.color.set(enemy.color);
        break;
      }
    }
    // A quiet cue once when an enemy first appears around the edge (not again while the same one stays there).
    if (enemy && enemy !== this.edgeEnemy) this.onFeel?.({ kind: 'edge', at: enemy.ball.position, local: true, intensity: 0.5 });
    this.edgeEnemy = enemy;
    this.edgeLevel += ((enemy ? 1 : 0) - this.edgeLevel) * Math.min(1, dt * 8);
    if (!enemy && this.edgeLevel < 0.02) this.edgeLevel = 0;
    this.edgeMat.opacity = this.edgeLevel * (0.65 + 0.3 * Math.sin(timeSec * 7)); // a soft pulse
    this.edgeGlow.visible = this.edgeRing.visible = this.edgeLevel > 0;
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
