// Client-side prediction for the local player (ARCHITECTURE §17). Pure and deterministic, so it's unit-testable; the
// client wraps it (client/src/predict/) and the server shares the input scheduling rule.
import { INPUT_BUFFER_TICKS } from './constants.ts';
import { dirVec } from './dir.ts';
import type { Level, Pose } from './level/types.ts';
import { add, cellKey, sub } from './vec.ts';
import { step } from './sim/tick.ts';
import {
  Action, addPlayer, createWorld, reserve, setInput,
  type Input, type PlayerState, type Reservations, type World,
} from './sim/world.ts';

/** Inputs stamped further ahead than this are applied this many ticks ahead instead (a jump is never dropped). */
export const MAX_INPUT_LEAD = 20;

/** Input message: a sim input plus the tick the client wants it applied at (absent from bots: next tick). */
export type InputMsg = Input & { tick?: number };

const hasPulse = (i: Input) => i.jump || i.turn !== 0;

/**
 * When a player's inputs apply (§17), the same on the server and in the predictor: at the stamped tick, but never
 * before the next tick, never before an earlier input of the same player, and a pulse never shares a tick with an
 * earlier pulse (the sim buffers one pulse, the latest wins, so a jump could otherwise be overwritten by a turn).
 */
export class InputSchedule {
  private lastAt = -Infinity;
  private lastPulseAt = -Infinity;

  /** The tick `input` applies at, given `now` (the last tick already stepped). */
  schedule(input: Input, stamped: number | undefined, now: number): number {
    let at = Math.max(Math.min(stamped ?? now + 1, now + MAX_INPUT_LEAD), now + 1, this.lastAt);
    if (hasPulse(input)) {
      at = Math.max(at, this.lastPulseAt + 1);
      this.lastPulseAt = at;
    }
    this.lastAt = at;
    return at;
  }
}

/** Server side: per-player queue of scheduled inputs, taken out tick by tick. */
export class InputQueue {
  private readonly sched = new InputSchedule();
  private q: { tick: number; input: Input }[] = [];

  push(input: Input, stamped: number | undefined, now: number): number {
    const tick = this.sched.schedule(input, stamped, now);
    this.q.push({ tick, input });
    return tick;
  }

  /** Inputs due by `tick`, in arrival order (removed from the queue). */
  due(tick: number): Input[] {
    const out: Input[] = [];
    while (this.q.length && this.q[0].tick <= tick) out.push(this.q.shift()!.input);
    return out;
  }
}

/** What the server tells us about a player (schema fields as sim types). */
export interface ServerPlayer {
  action: Action;
  pose: Pose;
  /** Equals pose while Idle. */
  to: Pose;
  startTick: number;
  endTick: number;
  turnFromFwd: PlayerState['turnFromFwd'];
  turnStartTick: number;
  bounce: boolean;
  protectedUntil: number;
}

/** The local player's predicted state at one tick: its motion plus the input state the sim keeps. */
type Snap = ServerPlayer & Pick<PlayerState, 'fwdHeld' | 'jumpHeld' | 'fwdLatch' | 'pulse' | 'pulseAge'>;

const clonePose = (p: Pose): Pose => ({ cell: { ...p.cell }, up: p.up, fwd: p.fwd });
const samePose = (a: Pose, b: Pose) => a.up === b.up && a.fwd === b.fwd && cellKey(a.cell) === cellKey(b.cell);

function snap(p: PlayerState): Snap {
  return {
    action: p.action, pose: clonePose(p.pose), to: clonePose(p.action === Action.Idle ? p.pose : p.to),
    startTick: p.startTick, endTick: p.endTick, turnFromFwd: p.turnFromFwd, turnStartTick: p.turnStartTick,
    bounce: p.bounce, protectedUntil: p.protectedUntil,
    fwdHeld: p.fwdHeld, jumpHeld: p.jumpHeld, fwdLatch: p.fwdLatch, pulse: p.pulse, pulseAge: p.pulseAge,
  };
}

/** Same motion: action, from/to poses and its ticks (what the server syncs and the renderer draws). */
export function sameMotion(a: ServerPlayer, b: ServerPlayer): boolean {
  return a.action === b.action && a.startTick === b.startTick && a.endTick === b.endTick && samePose(a.pose, b.pose)
    && (a.action === Action.Idle || samePose(a.to, b.to));
}

function applyServer(p: PlayerState, s: ServerPlayer): void {
  p.action = s.action;
  p.pose = clonePose(s.pose);
  p.to = clonePose(s.to);
  p.startTick = s.startTick;
  p.endTick = s.endTick;
  p.turnFromFwd = s.turnFromFwd;
  p.turnStartTick = s.turnStartTick;
  p.bounce = s.bounce;
  p.protectedUntil = s.protectedUntil;
}

export type ReconcileResult = 'match' | 'mispredict' | 'deferred' | 'reset' | 'paused';

/** Server-only states: while the local player is in one (on the server or in our prediction), prediction pauses. */
export const UNPREDICTED: ReadonlySet<Action> = new Set([Action.Knocked, Action.Stunned, Action.Dead, Action.Rebound]);

/**
 * The local player's predicted timeline (§17). A private World holds the local player plus the other players frozen
 * at their latest server state (obstacles that never act). It runs the shared `step()` with push rules off, no mode
 * logic (no crumble schedule, no timeout) and no events: keys, exits, deaths and knocks only ever come from the server.
 */
export class Predictor {
  readonly world: World;
  private readonly sched = new InputSchedule();
  /** Inputs in send order: the tick they were stamped for, and the tick they apply at (Infinity: late, held back). */
  private log: { seq: number; stamp: number; tick: number; input: Input }[] = [];
  private hist = new Map<number, Snap>();
  /** Predicted ticks where a move toward another player was held back (never predicted; the server decides it). */
  private deferredTicks = new Set<number>();
  mispredictions = 0;
  deferrals = 0;
  /** Inputs the server applied later than stamped (the client's lead was too short). */
  lateInputs = 0;
  /** The latest predicted tick held back a move toward another player. */
  deferring = false;
  /** The last misprediction (debugging): tick, the server's state and ours. */
  lastMiss: { tick: number; server: ServerPlayer; mine: ServerPlayer | null } | null = null;

  constructor(level: Level, readonly localId: string) {
    this.world = createWorld(level, 0, { push: false });
    this.world.mode = 'race';
    this.world.knockout = null;
    this.world.timeLimitTick = Infinity;
    addPlayer(this.world, localId, localId);
  }

  get local(): PlayerState { return this.world.players.find((p) => p.id === this.localId)!; }
  get tick(): number { return this.world.tick; }

  /** Resets the local player to the server's state at `tick`; the input state comes from `input` (default: none). */
  reset(tick: number, s: ServerPlayer, input?: Pick<Snap, 'fwdHeld' | 'jumpHeld' | 'fwdLatch' | 'pulse' | 'pulseAge'>): void {
    const p = this.local;
    this.world.tick = tick;
    applyServer(p, s);
    p.fwdHeld = input?.fwdHeld ?? false;
    p.jumpHeld = input?.jumpHeld ?? false;
    p.fwdLatch = input?.fwdLatch ?? false;
    p.pulse = input?.pulse ?? null;
    p.pulseAge = input?.pulseAge ?? 0;
    this.hist.clear();
    this.hist.set(tick, snap(p));
    this.deferredTicks.clear();
  }

  /** The other players as frozen obstacles at their latest server state. */
  setOthers(others: (ServerPlayer & { id: string })[]): void {
    const local = this.local;
    this.world.players = [local];
    for (const o of others) {
      const p = addPlayer(this.world, o.id, o.id);
      applyServer(p, o);
      p.endTick = Infinity; // never finishes: an obstacle, not a prediction
    }
  }

  /** Crumbled blocks and collected keys, from the server. */
  setWorld(removed: Iterable<string>, collectedKeys: ReadonlySet<number>): void {
    this.world.removed = new Set(removed);
    for (const k of this.world.keys) k.collected = collectedKeys.has(k.id);
  }

  /** Records a local input; returns the tick it applies at (send this as the message's `tick`). */
  input(input: Input, stamped: number): number {
    const tick = this.sched.schedule(input, stamped, this.world.tick);
    this.log.push({ seq: input.seq, stamp: tick, tick, input });
    return tick;
  }

  /**
   * An input sent before this predictor existed and not yet acked: the server applies it when it arrives, at a tick
   * we'll only learn from its ack, so it waits (like a late input) until then.
   */
  unackedInput(input: Input): void {
    this.log.push({ seq: input.seq, stamp: Infinity, tick: Infinity, input });
  }

  /** Steps the local timeline up to `tick`. */
  advanceTo(tick: number): void {
    while (this.world.tick < tick) this.stepOnce();
  }

  private stepOnce(): void {
    const t = this.world.tick + 1, p = this.local;
    if (p.action === Action.Dead) p.endTick = Infinity; // respawns (and lives) are the server's call
    for (const e of this.log) if (e.tick === t) setInput(this.world, this.localId, e.input);
    const deciding = p.action === Action.Idle || (p.action !== Action.Dead && p.endTick === t);
    if (deciding && this.world.players.length > 1 && this.towardOthers(p, p.action === Action.Idle ? p.pose : p.to)) {
      // Don't predict a push or a move into another player: hold still and let the server decide.
      const keep = { fwdHeld: p.fwdHeld, jumpHeld: p.jumpHeld, fwdLatch: p.fwdLatch, pulse: p.pulse, pulseAge: p.pulseAge };
      p.fwdHeld = p.jumpHeld = p.fwdLatch = false;
      p.pulse = null;
      step(this.world);
      Object.assign(p, keep);
      this.deferrals++;
      this.deferredTicks.add(t);
      this.deferring = true;
    } else {
      step(this.world);
      this.deferring = false;
    }
    if (p.action === Action.Dead) p.endTick = Infinity;
    this.hist.set(this.world.tick, snap(p));
  }

  /**
   * Would the command the sim is about to pick move toward another player? Mirrors the priority in tick.ts
   * (jump pulse/latch, turn pulse, jumpHeld, fwdHeld): true when it's a roll/flip/forward jump and the cell ahead,
   * the one beyond it, or the flip's landing cell is held by another player.
   */
  private towardOthers(p: PlayerState, pose: Pose): boolean {
    const pulse = p.pulse && p.pulseAge <= INPUT_BUFFER_TICKS ? p.pulse : null;
    let forward: boolean;
    if (pulse === 'jump' || p.fwdLatch) forward = p.fwdHeld || p.fwdLatch;
    else if (pulse) forward = false; // a turn
    else forward = p.fwdHeld;
    if (!forward) return false;
    const res: Reservations = new Map();
    for (const o of this.world.players) if (o !== p) reserve(res, o);
    const F = dirVec(pose.fwd), A = add(pose.cell, F);
    return [A, add(A, F), sub(A, dirVec(pose.up))].some((c) => res.has(cellKey(c)));
  }

  /**
   * The server's state of the local player at tick `ts` (with the last input it applied, if known). A match drops
   * older history. A difference resets to the server state at `ts` and re-simulates the recorded inputs up to the
   * current predicted tick: a misprediction, or a deferral when a held-back move toward a player was involved.
   * While the local player is Knocked, Stunned or Dead on the server or in the prediction, prediction pauses: each
   * patch resets to the server and replays the inputs (so held keys carry over), and nothing is counted.
   */
  reconcile(ts: number, server: ServerPlayer, ack?: { seq: number; tick: number }): ReconcileResult {
    if (ack) this.fixTicks(ts, ack);
    const mine = this.hist.get(ts);
    // Knocked, stunned or dead (or just back from it): not ours to predict. Follow the server, count nothing.
    const count = !UNPREDICTED.has(server.action) && !(mine && UNPREDICTED.has(mine.action));
    if (count && mine && sameMotion(mine, server)) {
      for (const k of this.hist.keys()) if (k < ts) this.hist.delete(k);
      const older = this.log.filter((e) => e.tick < ts);
      if (older.length > 1) this.log = this.log.slice(older.length - 1); // keep the last applied, for held state
      for (const t of this.deferredTicks) if (t <= ts) this.deferredTicks.delete(t);
      return 'match';
    }
    const target = this.world.tick;
    // Held flags as of ts come from the log (the server may have applied inputs later than stamped). The buffered
    // pulse and latch aren't synced: if the server decided at ts (Idle, or an action starting then) they were spent,
    // otherwise they come from our own history.
    const last = this.log.filter((e) => e.tick <= ts).pop();
    const deferred = [...this.deferredTicks].some((t) => t <= ts);
    const decided = server.action === Action.Idle || server.startTick === ts;
    this.reset(ts, server, {
      fwdHeld: last?.input.fwdHeld ?? mine?.fwdHeld ?? false,
      jumpHeld: last?.input.jumpHeld ?? mine?.jumpHeld ?? false,
      fwdLatch: decided ? false : mine?.fwdLatch ?? false,
      pulse: decided ? null : mine?.pulse ?? null,
      pulseAge: decided ? 0 : mine?.pulseAge ?? 0,
    });
    if (target <= ts) return 'reset'; // the server is at or ahead of our prediction: nothing to replay
    this.advanceTo(target);
    if (!count) return 'paused';
    if (deferred) return 'deferred';
    this.mispredictions++;
    this.lastMiss = { tick: ts, server, mine: mine ?? null };
    return 'mispredict';
  }

  /**
   * Puts inputs at the ticks the server applies them at. The acked one: exactly its ack tick. An unacked one whose
   * tick the server has already passed arrived late, and when the server applies it is unknown, so it (and every
   * input after it, which the server applies in order) is held back until acked rather than guessed tick by tick.
   */
  private fixTicks(ts: number, ack: { seq: number; tick: number }): void {
    let prev = -Infinity, prevPulse = -Infinity, late = false;
    for (const e of this.log) {
      if (e.seq === ack.seq) {
        if (e.tick !== ack.tick && ack.tick > e.stamp) this.lateInputs++; // first time we learn it was late
        e.tick = ack.tick;
      } else if (e.seq < ack.seq) {
        // Still waiting although a later input was applied: it went in no later than that one (or was dropped;
        // the later input then overrides it anyway). Never let it hold back everything after it.
        if (e.tick === Infinity) e.tick = ack.tick;
      } else {
        let t = Math.max(e.stamp, prev);
        if (hasPulse(e.input)) t = Math.max(t, prevPulse + 1);
        late ||= t <= ts;
        e.tick = late ? Infinity : t;
      }
      if (e.tick !== Infinity) {
        prev = Math.max(prev, e.tick);
        if (hasPulse(e.input)) prevPulse = Math.max(prevPulse, e.tick);
      }
    }
  }
}
