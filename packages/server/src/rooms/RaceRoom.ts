import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { Room, type Client } from 'colyseus';
import {
  Action, addPlayer, createWorld, InputQueue, loadLevel, removePlayer, setInput, step, TICK_RATE, validateLevel,
  type InputMsg, type Level, type SimEvent, type World,
} from '@kula/shared';
import { config } from '../config.ts';
import { GameState, PlayerS, syncSchema } from '../schema/State.ts';

const COUNTDOWN_TICKS = 3 * TICK_RATE;
const RESULTS_TICKS = 5 * TICK_RATE;
const MAX_INPUTS_PER_SEC = 30;
const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45'];

type Phase = 'lobby' | 'countdown' | 'playing' | 'results';

/**
 * Soak metric (phase 12, logged with each round's result): ticks in which at least two live players have both sat in
 * the same (cell, up) for more than 3 s while within 2 cells (Chebyshev) of each other.
 */
class StalemateMeter {
  private since = new Map<string, { key: string; tick: number }>();
  ticks = 0;

  step(world: World): void {
    const still: { x: number; y: number; z: number }[] = [];
    for (const p of world.players) {
      if (p.action === Action.Dead || p.eliminated) { this.since.delete(p.id); continue; }
      const key = `${p.pose.cell.x},${p.pose.cell.y},${p.pose.cell.z}|${p.pose.up}`;
      const prev = this.since.get(p.id);
      if (prev?.key !== key) this.since.set(p.id, { key, tick: world.tick });
      else if (world.tick - prev.tick > 3 * TICK_RATE) still.push(p.pose.cell);
    }
    const near = (a: typeof still[0], b: typeof still[0]) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z)) <= 2;
    if (still.some((a, i) => still.some((b, j) => j > i && near(a, b)))) this.ticks++;
  }
}

/** Loads and validates levels/<id>.json. Throws on invalid levels, so a room never starts with one. */
export function loadLevelFile(id: string): Level {
  const level = loadLevel(JSON.parse(readFileSync(new URL(`../../../../levels/${id}.json`, import.meta.url), 'utf8')));
  const errors = validateLevel(level);
  if (errors.length) throw new Error(`level "${id}" is invalid:\n  ${errors.join('\n  ')}`);
  return level;
}

/** LEVEL may be a comma list (e.g. "race-01,test-cube"); rooms rotate through it each round. */
export const levelIds = (): string[] => config.level.split(',').map((s) => s.trim()).filter(Boolean);

/** Validates an `input` message at the trust boundary. `tick` (when to apply it, §17) is optional: bots omit it. */
export function parseInput(m: unknown): InputMsg | null {
  if (typeof m !== 'object' || m === null) return null;
  const { seq, fwdHeld, turn, jump, jumpHeld, tick } = m as Record<string, unknown>;
  if (!Number.isInteger(seq) || typeof fwdHeld !== 'boolean' || typeof jump !== 'boolean' || typeof jumpHeld !== 'boolean') return null;
  if (turn !== -1 && turn !== 0 && turn !== 1) return null;
  if (tick !== undefined && !Number.isInteger(tick)) return null;
  const input: InputMsg = { seq: seq as number, fwdHeld, turn, jump, jumpHeld };
  if (tick !== undefined) input.tick = tick as number;
  return input;
}

export class RaceRoom extends Room<{ state: GameState }> {
  maxClients = 8;
  state = new GameState();
  /** Levels from LEVEL (comma list), rotated each round. */
  private levels: Level[] = [];
  private level!: Level;
  private world: World | null = null;
  private stalemate = new StalemateMeter();
  private round = 0;
  private frame = 0;
  private inputCounts = new Map<string, number>();
  /** Per player: inputs waiting for their tick (§17), and the last one applied (echoed as ackSeq/ackTick). */
  private queues = new Map<string, InputQueue>();
  private warned = new Set<string>();

  onCreate() {
    this.levels = levelIds().map(loadLevelFile);
    this.level = this.levels[0];
    this.state.levelId = this.level.id;
    this.onMessage('input', (client, msg) => this.onInput(client, msg));
    this.onMessage('ready', (client) => this.onReady(client));
    this.setFixedTimestep(() => this.update(), TICK_RATE);
    this.setPhase('lobby');
  }

  onJoin(client: Client, options?: { name?: unknown }) {
    const name = String(options?.name ?? 'anon').slice(0, 16);
    const used = new Set([...this.state.players.values()].map((p) => p.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[0];
    const spectating = this.state.phase !== 'lobby';
    this.state.players.set(client.sessionId, new PlayerS({ id: client.sessionId, name, color, spectating }));
    console.log(`join ${name} (${client.sessionId})${spectating ? ' as spectator' : ''}, players=${this.state.players.size}`);
  }

  onLeave(client: Client) {
    const id = client.sessionId;
    console.log(`leave ${this.nameOf(id)} (${id}), players=${this.state.players.size - 1}`);
    this.state.players.delete(id);
    this.inputCounts.delete(id);
    this.queues.delete(id);
    if (this.world) {
      removePlayer(this.world, id);
      if (this.world.players.length === 0) this.setPhase('lobby');
    }
    this.maybeStart();
  }

  private onReady(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || this.state.phase !== 'lobby') return;
    p.ready = !p.ready;
    this.maybeStart();
  }

  private onInput(client: Client, msg: unknown) {
    const id = client.sessionId;
    const n = (this.inputCounts.get(id) ?? 0) + 1;
    this.inputCounts.set(id, n);
    if (n > MAX_INPUTS_PER_SEC) return this.warnOnce(id, 'rate', `more than ${MAX_INPUTS_PER_SEC} inputs/s, dropping extras`);
    const input = parseInput(msg);
    if (!input) return this.warnOnce(id, 'invalid', `invalid input ${inspect(msg, { depth: 2, breakLength: Infinity }).slice(0, 120)}`);
    if (this.state.phase !== 'playing' || !this.world) return;
    let q = this.queues.get(id);
    if (!q) this.queues.set(id, (q = new InputQueue()));
    const { tick, ...sim } = input;
    q.push(sim, tick, this.world.tick);
  }

  private warnOnce(id: string, kind: string, msg: string) {
    if (this.warned.has(`${id}:${kind}`)) return;
    this.warned.add(`${id}:${kind}`);
    console.warn(`client ${this.nameOf(id)} (${id}): ${msg}`);
  }

  private maybeStart() {
    const players = [...this.state.players.values()];
    if (this.state.phase === 'lobby' && players.length >= config.minPlayers && players.every((p) => p.ready)) {
      this.setPhase('countdown');
    }
  }

  private update() {
    if (++this.frame % TICK_RATE === 0) this.inputCounts.clear();
    const s = this.state;
    switch (s.phase as Phase) {
      case 'countdown':
        if (++s.tick >= s.phaseEndTick) this.setPhase('playing');
        break;
      case 'playing': {
        const world = this.world!;
        for (const [id, q] of this.queues) {
          for (const input of q.due(world.tick + 1)) {
            setInput(world, id, input);
            const p = s.players.get(id);
            if (p) { p.ackSeq = input.seq; p.ackTick = world.tick + 1; }
          }
        }
        const events = step(world);
        this.stalemate.step(world);
        s.tick = world.tick;
        syncSchema(world, s);
        for (const e of events) this.emit(e);
        if (world.result) this.setPhase('results');
        break;
      }
      case 'results':
        if (++s.tick >= s.phaseEndTick) this.setPhase('lobby');
        break;
    }
  }

  private setPhase(phase: Phase) {
    const s = this.state;
    s.phase = phase;
    switch (phase) {
      case 'lobby':
        this.world = null;
        s.tick = s.phaseEndTick = 0;
        s.winnerId = '';
        for (const p of s.players.values()) { p.ready = false; p.spectating = false; }
        console.log(`phase lobby (min players ${config.minPlayers})`);
        break;
      case 'countdown': {
        // Fresh world with everyone at their spawns; not stepped until playing, so the timer starts with the round.
        this.level = this.levels[this.round % this.levels.length];
        s.levelId = this.level.id;
        const level = config.antiStalemate ? this.level : { ...this.level, heat: null, crumble: this.level.mode === 'race' ? null : this.level.crumble };
        const world = createWorld(level, ++this.round, { push: config.push, chain: config.antiStalemate });
        for (const [id, p] of s.players) if (!p.spectating) addPlayer(world, id, p.name);
        this.world = world;
        this.stalemate = new StalemateMeter();
        this.queues.clear();
        for (const p of s.players.values()) { p.ackSeq = -1; p.ackTick = -1; }
        s.items.clear();
        syncSchema(world, s);
        s.tick = -COUNTDOWN_TICKS;
        s.phaseEndTick = 0;
        console.log(`phase countdown: round ${this.round}, ${world.players.length} players, level ${this.level.id} (${this.level.mode}), push ${world.rules.push ? 'on' : 'off'}`);
        break;
      }
      case 'playing':
        s.phaseEndTick = this.world!.timeLimitTick;
        console.log('phase playing');
        break;
      case 'results': {
        const result = this.world!.result!;
        s.winnerId = result.winnerId ?? '';
        s.phaseEndTick = s.tick + RESULTS_TICKS;
        const winner = result.winnerId ? this.nameOf(result.winnerId) : 'draw';
        const w = this.world!;
        const stats = w.mode === 'knockout'
          ? `lives ${w.players.map((p) => `${p.name}:${p.lives}/ko${p.knockouts}`).join(' ')}, bands crumbled ${w.knockout!.next}`
          : `keys ${w.players.map((p) => `${p.name}:${p.keys}`).join(' ')}`;
        console.log(`phase results: ${winner} (${result.reason}) at tick ${w.tick}, level ${w.level.id}, ${stats}, stalemate ${(this.stalemate.ticks / TICK_RATE).toFixed(1)}s`);
        break;
      }
    }
  }

  private emit(e: SimEvent) {
    this.broadcast('event', e);
    const who = 'playerId' in e ? this.nameOf(e.playerId) : '';
    switch (e.type) {
      case 'key': console.log(`event key: ${who} has ${e.keys}`); break;
      case 'death': console.log(`event death: ${who} at ${e.cell.x},${e.cell.y},${e.cell.z}`); break;
      case 'respawn': console.log(`event respawn: ${who}`); break;
      case 'push': console.log(`event push: ${this.nameOf(e.pusherId)} → ${this.nameOf(e.victimId)}`); break;
      case 'knockout': console.log(`event knockout: ${this.nameOf(e.pusherId)} knocked ${this.nameOf(e.victimId)} off`); break;
      case 'stomp': console.log(`event stomp: ${this.nameOf(e.attackerId)} → ${this.nameOf(e.victimId)}`); break;
      case 'clash': console.log(`event clash: ${this.nameOf(e.attackerId)} ↔ ${this.nameOf(e.victimId)}`); break;
      case 'burn': console.log(`event burn: ${who}`); break;
      case 'keyDrop': console.log(`event keyDrop: ${who} dropped key ${e.keyId}`); break;
      case 'lifeLost': console.log(`event lifeLost: ${who} has ${e.livesLeft}`); break;
      case 'eliminated': console.log(`event eliminated: ${who}${e.byId ? ` by ${this.nameOf(e.byId)}` : ''}`); break;
      case 'crumbleWarn': console.log(`event crumbleWarn: band ${e.band}`); break;
      case 'crumble': console.log(`event crumble: band ${e.band}`); break;
      case 'win': console.log(`event win: ${e.winnerId ? this.nameOf(e.winnerId) : 'draw'} (${e.reason})`); break;
    }
  }

  private nameOf(id: string): string {
    return this.state.players.get(id)?.name ?? id;
  }
}
