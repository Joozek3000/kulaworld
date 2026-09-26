import {
  Action, crumbleBands, Predictor, UNPREDICTED,
  type Dir, type Input, type InputMsg, type Level, type Pose, type ReconcileResult, type ServerPlayer,
} from '@kula/shared';
import type { GameState, Net, PlayerS } from '../net.ts';

const TICK_MS = 50;
/**
 * How fast the lead follows a change in ping (ticks per second). A step would make predTick (and the ball) jump, so
 * the predicted clock instead runs a little fast (up) or slow (down) until it has caught up.
 */
const LEAD_GROW_PER_SEC = 2, LEAD_DECAY_PER_SEC = 0.5;
/**
 * Extra ticks of lead on top of the round trip. Patches aren't phase-locked to server ticks, so estServerTick can
 * trail by up to a tick; each input the server applied later than stamped adds one (up to MAX), and it eases back
 * after a quiet spell.
 */
const MARGIN_MIN = 2, MARGIN_MAX = 5, MARGIN_EASE_MS = 15_000;

const pose = (x: number, y: number, z: number, up: number, fwd: number): Pose => ({ cell: { x, y, z }, up: up as Dir, fwd: fwd as Dir });

/** Schema player → the sim's view of it. */
export function toServerPlayer(p: PlayerS): ServerPlayer {
  return {
    action: p.action as Action, pose: pose(p.fromX, p.fromY, p.fromZ, p.fromUp, p.fromFwd), to: pose(p.toX, p.toY, p.toZ, p.toUp, p.toFwd),
    startTick: p.startTick, endTick: p.endTick, turnFromFwd: p.turnFromFwd as Dir, turnStartTick: p.turnStartTick, bounce: p.bounce,
    protectedUntil: p.protectedUntil,
  };
}

/**
 * Client prediction for the local ball (ARCHITECTURE §17): the shared Predictor, fed by server patches and our own
 * inputs, running `lead` ticks ahead of the estimated server tick. `?predict=0` turns it off (the phase 08 path).
 */
export class LocalPrediction {
  readonly enabled = new URLSearchParams(location.search).get('predict') !== '0';
  private pred: Predictor | null = null;
  private levelId = '';
  private bands: string[][] = [];
  /** Ticks ahead of estServerTick: covers the whole round trip (estServerTick itself lags the server by RTT/2). */
  lead = 3;
  predTick = 0;
  /** When predTick was last advanced (a key press between frames extrapolates from here). */
  private predAt = 0;
  private margin = MARGIN_MIN;
  private lateSeen = 0;
  private lateAt = 0;
  lateInputs = 0;
  /** Stats for F3 (whole session): mispredictions (and their times, for the per-minute rate), corrections after a
   * held-back move toward another player, and the last visual correction (cells). */
  private mispredictAt: number[] = [];
  mispredictions = 0;
  deferred = 0;
  /** Details of recent mispredictions (debugging, via window.kula in dev). */
  readonly misses: unknown[] = [];
  lastCorrection = 0;
  /** Set when the predicted timeline changed under the renderer (it blends instead of snapping). */
  private corrected = false;
  /**
   * A held-back move toward another player was resolved by the server (a push, a bounce, or a roll once the way
   * cleared): the local ball follows the server timeline, which starts that action from the very cell the predicted
   * ball was holding in, until the server has it Idle again with nothing held back.
   */
  private serverMode = false;
  /** Inputs sent before the predictor started (unstamped; the server applies them on arrival). */
  private unstamped: { input: Input; at: number }[] = [];

  constructor(private readonly net: Net, private readonly findLevel: (id: string) => Level | null) {
    if (this.enabled) net.onPatch(() => this.onPatch());
  }

  private get me(): PlayerS | undefined { return this.net.state.players.get(this.net.sessionId); }

  private onPatch(): void {
    const s = this.net.state, me = this.me;
    if (s.phase !== 'playing' || !me || me.spectating) { this.pred = null; return; }
    if (!this.pred || this.levelId !== s.levelId) {
      const level = this.findLevel(s.levelId);
      if (!level) return;
      this.pred = new Predictor(level, this.net.sessionId);
      this.lateSeen = 0;
      this.serverMode = false;
      this.levelId = s.levelId;
      this.bands = level.mode === 'knockout' ? crumbleBands(level) : [];
      // Inputs sent just before we saw play start: the acked ones set the held keys, the rest wait for their ack.
      // Only the last second counts: older ones were sent in the lobby or countdown, where the server drops input.
      const recent = this.unstamped.filter((u) => performance.now() - u.at < 1000).map((u) => u.input);
      const applied = recent.filter((i) => i.seq <= me.ackSeq).pop();
      this.pred.reset(s.tick, toServerPlayer(me), applied && { fwdHeld: applied.fwdHeld, jumpHeld: applied.jumpHeld, fwdLatch: false, pulse: null, pulseAge: 0 });
      for (const i of recent) if (i.seq > me.ackSeq) this.pred.unackedInput(i);
      this.unstamped = [];
      this.lead = Math.ceil(this.net.ping / TICK_MS) + this.margin; // a new round starts at the right lead
      this.predTick = this.net.estServerTick + this.lead;
    }
    this.syncWorld(s);
    const ack = me.ackSeq >= 0 ? { seq: me.ackSeq, tick: me.ackTick } : undefined;
    const r = this.pred.reconcile(s.tick, toServerPlayer(me), ack);
    if (this.pred.lateInputs > this.lateSeen) { // the server got an input after its tick: lead more
      this.lateInputs += this.pred.lateInputs - this.lateSeen;
      this.lateSeen = this.pred.lateInputs;
      this.margin = Math.min(MARGIN_MAX, this.margin + 1);
      this.lateAt = performance.now();
    }
    if (r === 'mispredict') {
      // How far the nearest other ball was (cells, Chebyshev), to tell brawl mispredictions from solo ones.
      let near = Infinity;
      s.players.forEach((o, id) => {
        if (id === this.net.sessionId || o.spectating || o.action === Action.Dead) return;
        near = Math.min(near, Math.max(Math.abs(o.fromX - me.fromX), Math.abs(o.fromY - me.fromY), Math.abs(o.fromZ - me.fromZ)));
      });
      this.misses.push({ ...this.pred.lastMiss!, near });
    }
    this.count(r);
    if (r === 'deferred') this.serverMode = true;
    else if (this.serverMode && me.action === Action.Idle && !this.pred.deferring) this.serverMode = false;
  }

  /** Other players as obstacles, crumbled blocks and collected keys: always the latest server view. */
  private syncWorld(s: GameState): void {
    const others: (ServerPlayer & { id: string })[] = [];
    s.players.forEach((p, id) => { if (id !== this.net.sessionId && !p.spectating) others.push({ id, ...toServerPlayer(p) }); });
    this.pred!.setOthers(others);
    const collected = new Set<number>();
    for (const k of this.pred!.world.keys) if (!s.items.has(`key-${k.id}`)) collected.add(k.id);
    this.pred!.setWorld(this.bands.slice(0, s.crumbled).flat(), collected);
  }

  private count(r: ReconcileResult): void {
    if (r === 'mispredict') { this.mispredictAt.push(performance.now()); this.mispredictions++; }
    if (r === 'deferred') this.deferred++;
    if (r === 'mispredict' || r === 'deferred' || r === 'reset') this.corrected = true;
  }

  /** Per frame: follow the ping with the lead, and step the prediction up to predTick. */
  update(dtMs: number): void {
    if (this.margin > MARGIN_MIN && performance.now() - this.lateAt > MARGIN_EASE_MS) { this.margin--; this.lateAt = performance.now(); }
    const target = Math.ceil(this.net.ping / TICK_MS) + this.margin;
    this.lead = target > this.lead
      ? Math.min(target, this.lead + (LEAD_GROW_PER_SEC * dtMs) / 1000)
      : Math.max(target, this.lead - (LEAD_DECAY_PER_SEC * dtMs) / 1000);
    if (!this.pred) return;
    this.predTick = Math.max(this.predTick, this.net.estServerTick + this.lead); // never runs backwards
    this.predAt = performance.now();
    this.pred.advanceTo(Math.floor(this.predTick));
  }

  /** The local ball is drawn from the prediction (else from the server, as with ?predict=0). */
  get predicting(): boolean {
    const me = this.me;
    return !!this.pred && !!me && !me.eliminated && !this.serverMode
      && !UNPREDICTED.has(me.action as Action) && !UNPREDICTED.has(this.pred.local.action);
  }

  /** Stamps an outgoing input with the tick it should apply at, and records it for re-simulation. */
  stamp(input: Input): InputMsg {
    if (!this.pred) { this.unstamped = [...this.unstamped.slice(-7), { input, at: performance.now() }]; return input; }
    // Extrapolated to the moment of the key press: at low frame rates two presses in one frame gap would otherwise
    // get the same (stale) tick, and presses 60-90 ms apart could land 3 ticks apart.
    const now = this.predTick + Math.max(0, performance.now() - this.predAt) / TICK_MS;
    return { ...input, tick: this.pred.input(input, Math.floor(now) + 1) };
  }

  /** The predicted local player in schema shape, for the renderer. */
  localPlayer(base: PlayerS): PlayerS {
    const p = this.pred!.local, to = p.action === Action.Idle ? p.pose : p.to;
    const b = base; // a schema instance: its fields are accessors, so copy them one by one
    return {
      id: b.id, name: b.name, color: b.color, keys: b.keys, ready: b.ready, spectating: b.spectating, lives: b.lives,
      eliminated: b.eliminated, eliminatedTick: b.eliminatedTick, eliminatedBy: b.eliminatedBy, protectedUntil: b.protectedUntil,
      knockouts: b.knockouts, ackSeq: b.ackSeq, ackTick: b.ackTick, action: p.action,
      fromX: p.pose.cell.x, fromY: p.pose.cell.y, fromZ: p.pose.cell.z, fromUp: p.pose.up, fromFwd: p.pose.fwd,
      toX: to.cell.x, toY: to.cell.y, toZ: to.cell.z, toUp: to.up, toFwd: to.fwd,
      startTick: p.startTick, endTick: p.endTick, turnFromFwd: p.turnFromFwd, turnStartTick: p.turnStartTick, bounce: p.bounce,
    };
  }

  /** True once after the predicted timeline was corrected. */
  takeCorrection(): boolean {
    const c = this.corrected;
    this.corrected = false;
    return c;
  }

  /** Mispredictions in the last minute. */
  get mispredictionsPerMin(): number {
    const cutoff = performance.now() - 60_000;
    this.mispredictAt = this.mispredictAt.filter((t) => t > cutoff);
    return this.mispredictAt.length;
  }
}
