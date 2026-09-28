import { Action, addPlayer, createWorld, paintTotal, setInput, step, TICK_RATE, type Input, type Level, type Pose, type SimEvent, type World } from '@kula/shared';
import type { GameSource, GameState, ItemS, PlayerS } from './net.ts';

/** A short "get ready" before each attempt: a countdown phase, like a server round, so the renderer resets cleanly. */
const READY_TICKS = TICK_RATE;
const TICK_MS = 1000 / TICK_RATE;
export const LOCAL_ID = 'you';

/** Single player's extra state (ARCHITECTURE §22) for the HUD and trap views. */
export interface SingleView {
  gained: number; timer: number; frozen: boolean; lit: Set<string>; paintTotal: number; clocks: Set<string>;
  keysTotal: number; fruits: number;
}
type Maps = 'players' | 'items' | 'pickups' | 'hot' | 'crumbling' | 'lasers';
export type LocalState = Omit<GameState, Maps> & {
  players: Map<string, PlayerS>; items: Map<string, ItemS>; pickups: Map<string, ItemS>;
  hot: Map<string, number>; crumbling: Map<string, number>; lasers: Map<string, number>; single: SingleView;
};

/**
 * Single player without a server (phase 15b): the shared sim stepped here at 20 Hz with a fixed step, exposing the same
 * state shape as the network path (GameSource), so the renderer, HUD and audio don't care which one they read. Input
 * goes straight to setInput: no prediction and no delay. Pausing stops the clock.
 */
export class LocalGame implements GameSource {
  readonly sessionId = LOCAL_ID;
  readonly ping = 0;
  readonly patchRate = TICK_RATE;
  estServerTick = 0;
  paused = false;
  world!: World;
  readonly state: LocalState;
  private acc = 0;
  private listeners: ((e: SimEvent) => void)[] = [];
  private me!: PlayerS;

  constructor(level: Level, private readonly name = 'You') {
    this.state = {
      phase: 'countdown', tick: 0, phaseEndTick: 0, levelId: level.id, winnerId: '', players: new Map(), items: new Map(), pickups: new Map(),
      mode: level.mode, crumbled: 0, warnBand: -1, nextCrumbleTick: -1, hot: new Map(), crumbling: new Map(), lasers: new Map(), candidates: [], voteCounts: [],
      single: { gained: 0, timer: 0, frozen: false, lit: new Set(), paintTotal: 0, clocks: new Set(), keysTotal: 0, fruits: 0 },
    };
    this.start(level);
  }

  /** A fresh attempt at `level` (a restart too): new world, the countdown, then play. */
  start(level: Level, seed = 1): void {
    this.world = createWorld(level, seed);
    addPlayer(this.world, LOCAL_ID, this.name);
    const s = this.state;
    s.levelId = level.id;
    s.mode = level.mode;
    s.phase = 'countdown';
    s.tick = -READY_TICKS;
    s.phaseEndTick = 0;
    s.winnerId = '';
    s.players.clear();
    s.items.clear();
    s.pickups.clear();
    s.lasers.clear();
    this.me = blankPlayer(this.name);
    s.players.set(LOCAL_ID, this.me);
    this.acc = 0;
    this.estServerTick = s.tick;
    this.sync();
  }

  get result() { return this.world.result; }

  update(_now: number, dtMs: number): void {
    if (this.paused) return;
    this.acc += dtMs;
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.tick();
    }
    this.estServerTick = this.state.tick + this.acc / TICK_MS;
  }

  private tick(): void {
    const s = this.state;
    if (s.phase === 'countdown') {
      if (++s.tick >= 0) s.phase = 'playing';
      return;
    }
    // After the result the world keeps running (a death pops, a ball finishes its roll), without input or timer.
    const events = step(this.world);
    s.tick = this.world.tick;
    this.sync();
    if (this.world.result && s.phase === 'playing') {
      s.phase = 'results';
      s.winnerId = this.world.result.winnerId ?? '';
      setInput(this.world, LOCAL_ID, NEUTRAL);
    }
    for (const e of events) for (const cb of this.listeners) cb(e);
  }

  /** Copies the world into the GameState shape (only on ticks: 20 Hz, not per frame). */
  private sync(): void {
    const w = this.world, s = this.state, p = w.players[0], me = this.me;
    me.action = p.action;
    setPose(me, 'from', p.pose);
    setPose(me, 'to', p.action === Action.Idle ? p.pose : p.to);
    me.startTick = p.startTick;
    me.endTick = p.endTick;
    me.turnFromFwd = p.turnFromFwd;
    me.turnStartTick = p.turnStartTick;
    me.bounce = p.bounce;
    me.keys = p.keys;
    me.fireCount = p.fireCount;
    const fx = me.effects as Map<string, number>;
    fx.clear();
    for (const e of p.effects) fx.set(e.type, e.untilTick);
    const items = s.items;
    w.keys.forEach((k) => {
      const id = `key-${k.id}`;
      if (k.collected) items.delete(id);
      else if (!items.has(id)) items.set(id, { id, kind: 'key', ...k.cell, up: w.level.keys[k.id].up });
    });
    if (w.level.exit && !items.has('exit')) items.set('exit', { id: 'exit', kind: 'exit', ...w.level.exit.cell, up: w.level.exit.up });
    const sp = w.single!;
    w.level.items.forEach((it, i) => {
      const id = `item-${i}`;
      if (sp.taken[i]) items.delete(id);
      else if (!items.has(id)) items.set(id, { id, kind: it.fruit >= 0 ? `fruit-${it.fruit}` : it.type, ...it.cell, up: it.up });
    });
    const pickups = s.pickups;
    const live = new Set(w.pickups.map((k) => String(k.id)));
    for (const id of [...pickups.keys()]) if (!live.has(id)) pickups.delete(id);
    for (const k of w.pickups) if (!pickups.has(String(k.id))) pickups.set(String(k.id), { id: String(k.id), kind: k.type, ...k.cell, up: k.up });
    const { crumbling, lasers } = s;
    crumbling.clear();
    for (const [k, v] of w.crumbling) crumbling.set(k, v);
    for (const [g, on] of w.lasers) lasers.set(g, on ? 1 : 0);
    const v = s.single;
    v.gained = sp.gained;
    v.timer = sp.timer;
    v.frozen = w.tick < sp.frozenUntil && !w.result;
    v.lit = sp.lit;
    v.clocks = sp.clocks;
    v.paintTotal = paintTotal(w);
    v.keysTotal = w.level.keys.length;
    v.fruits = sp.fruits;
  }

  onEvent(cb: (e: SimEvent) => void): void { this.listeners.push(cb); }
  sendInput(input: Input): void {
    if (this.state.phase === 'playing' && !this.paused) setInput(this.world, LOCAL_ID, input);
  }
  sendReady(): void {}
  sendVote(): void {}
}

const NEUTRAL: Input = { seq: 0, fwdHeld: false, turn: 0, jump: false, jumpHeld: false };

function setPose(s: PlayerS, pre: 'from' | 'to', p: Pose): void {
  s[`${pre}X`] = p.cell.x;
  s[`${pre}Y`] = p.cell.y;
  s[`${pre}Z`] = p.cell.z;
  s[`${pre}Up`] = p.up;
  s[`${pre}Fwd`] = p.fwd;
}

const blankPlayer = (name: string): PlayerS => ({
  id: LOCAL_ID, name, color: '#e6194b', action: Action.Dead,
  fromX: 0, fromY: 0, fromZ: 0, fromUp: 0, fromFwd: 0, toX: 0, toY: 0, toZ: 0, toUp: 0, toFwd: 0,
  startTick: 0, endTick: 0, turnFromFwd: 0, turnStartTick: 0, bounce: false, keys: 0, ready: true, spectating: false,
  lives: 0, eliminated: false, eliminatedTick: -1, eliminatedBy: '', protectedUntil: 0, knockouts: 0, ackSeq: -1, ackTick: -1, fireCount: 0,
  effects: new Map(), vote: -1,
});
