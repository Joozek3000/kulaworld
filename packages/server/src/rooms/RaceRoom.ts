import { readdirSync, readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { Room, type Client } from 'colyseus';
import {
  Action, addPlayer, addRoundStats, createWorld, crownOf, emptyStats, InputQueue, loadLevel, MATCH_LENGTHS, mulberry32, pickCandidates, removePlayer,
  scoreRound, setInput, step, tallyVotes, TICK_RATE, validateLevel, validVote, voteCounts, type InputMsg, type Level, type MatchStats, type SimEvent, type World,
} from '@kula/shared';
import { config } from '../config.ts';
import { GameState, PlayerS, StandingS, syncSchema } from '../schema/State.ts';

const COUNTDOWN_TICKS = 3 * TICK_RATE;
const RESULTS_TICKS = 5 * TICK_RATE;
/** The end of a match (phase 18): podium, stats card and the rematch vote. */
const MATCH_END_TICKS = 12 * TICK_RATE;
const MAX_INPUTS_PER_SEC = 30;
const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45'];

type Phase = 'lobby' | 'countdown' | 'playing' | 'results' | 'matchEnd';

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

const LEVELS_DIR = new URL('../../../../levels/', import.meta.url);

/** Loads and validates levels/<id>.json. Throws on invalid levels, so a room never starts with one. */
export function loadLevelFile(id: string): Level {
  const level = loadLevel(JSON.parse(readFileSync(new URL(`${id}.json`, LEVELS_DIR), 'utf8')));
  const errors = validateLevel(level);
  if (errors.length) throw new Error(`level "${id}" is invalid:\n  ${errors.join('\n  ')}`);
  return level;
}

/** LEVEL may be a comma list (e.g. "race-01,test-cube"): a testing override of the pool. */
export const levelIds = (): string[] => config.level.split(',').map((s) => s.trim()).filter(Boolean);

/** The lobby vote's level pool (phase 14): the LEVEL override if set, else every level file with "pool": true. */
export function levelPool(): Level[] {
  const ids = levelIds();
  const pool = ids.length ? ids.map(loadLevelFile)
    : readdirSync(LEVELS_DIR).filter((f) => f.endsWith('.json')).map((f) => loadLevelFile(f.slice(0, -5))).filter((l) => l.pool);
  if (!pool.length) throw new Error('empty level pool: no LEVEL and no level with "pool": true');
  return pool;
}

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
  /** The vote's level pool, and the last level played (never a candidate next time). */
  private pool: Level[] = [];
  private level!: Level;
  private lastLevelId: string | null = null;
  /** Lobby vote RNG (candidates, tie-breaks, Random): seeded per room, outside the sim. */
  private rng = mulberry32(Date.now() >>> 0);
  private world: World | null = null;
  private stalemate = new StalemateMeter();
  /** Boost pads this round (phase 14c): launches, holds, releases. */
  private boostStats = { launch: 0, held: 0, released: 0 };
  /** Phase 14d: moving collisions this round, knockouts by cause, and each ball's last knock (push, edge, cradle, stomp, headon, side). */
  private hitStats = { headon: 0, side: 0 };
  private koCauses: Record<string, number> = {};
  /** Phase 13b: deaths by cause this round, teleports and laser toggles. */
  private deathCauses: Record<string, number> = {};
  private trapStats = { teleport: 0, toggles: 0 };
  /** Phase 15a: pills taken this round ("name:type" → n), and knockouts whose knock came from a heavy or bouncy ball. */
  private pickupStats: Record<string, number> = {};
  private pillKos = { heavy: 0, bouncy: 0 };
  /** The attacker's pills at each ball's last knock, for pillKos. */
  private readonly knockPills = new Map<string, string[]>();
  private readonly lastKnock = new Map<string, string>();
  private round = 0;
  private frame = 0;
  private inputCounts = new Map<string, number>();
  /** Per player: inputs waiting for their tick (§17), and the last one applied (echoed as ackSeq/ackTick). */
  private queues = new Map<string, InputQueue>();
  private warned = new Set<string>();
  /** Matches (phase 18): this round's events (for scoring and stats), and the crown holder while it's played. */
  private roundEvents: SimEvent[] = [];
  private roundCrown: string | null = null;
  /** A rematch keeps the match length: no length vote before its first round. */
  private lengthLocked = false;

  onCreate() {
    this.pool = levelPool();
    console.log(`level pool: ${this.pool.map((l) => l.id).join(', ')}`);
    this.onMessage('input', (client, msg) => this.onInput(client, msg));
    this.onMessage('ready', (client) => this.onReady(client));
    this.onMessage('vote', (client, option) => this.onVote(client, option));
    this.onMessage('length', (client, option) => this.onLengthVote(client, option));
    this.onMessage('rematch', (client, yes) => this.onRematch(client, yes));
    this.state.matchRounds = config.matchRounds;
    if (!this.state.lengthVotes.length) this.state.lengthVotes.push(0, 0, 0);
    this.setFixedTimestep(() => this.update(), TICK_RATE);
    this.setPhase('lobby');
  }

  onJoin(client: Client, options?: { name?: unknown }) {
    const name = String(options?.name ?? 'anon').slice(0, 16);
    const used = new Set([...this.state.players.values()].map((p) => p.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[0];
    const spectating = this.state.phase !== 'lobby';
    this.state.players.set(client.sessionId, new PlayerS({ id: client.sessionId, name, color, spectating }));
    // Matches (§23): a new player joins the board with 0 points.
    this.state.standings.set(client.sessionId, new StandingS({ id: client.sessionId, name, color }));
    console.log(`join ${name} (${client.sessionId})${spectating ? ' as spectator' : ''}, players=${this.state.players.size}`);
  }

  onLeave(client: Client) {
    const id = client.sessionId;
    console.log(`leave ${this.nameOf(id)} (${id}), players=${this.state.players.size - 1}`);
    this.state.players.delete(id);
    const st = this.state.standings.get(id);
    if (st) st.left = true; // their points stay on the board, greyed (§23)
    this.inputCounts.delete(id);
    this.queues.delete(id);
    this.syncVotes();
    if (this.world) {
      removePlayer(this.world, id);
      if (this.world.players.length === 0) this.setPhase('lobby');
    }
    if (!this.state.players.size) this.resetMatch(false); // everyone left: the next ones start a fresh match
    this.syncLengthVotes();
    this.maybeStart();
  }

  /** Lobby before round 1 only: 0..2 for 3/5/7 rounds. Voting again changes the vote. */
  private onLengthVote(client: Client, option: unknown) {
    const p = this.state.players.get(client.sessionId);
    if (!p || this.state.phase !== 'lobby' || this.state.matchRound > 0 || this.lengthLocked) return;
    if (option !== 0 && option !== 1 && option !== 2) return;
    p.lengthVote = option;
    this.syncLengthVotes();
  }

  private syncLengthVotes() {
    const counts = [0, 0, 0];
    for (const p of this.state.players.values()) if (p.lengthVote >= 0) counts[p.lengthVote]++;
    counts.forEach((n, i) => { if (this.state.lengthVotes[i] !== n) this.state.lengthVotes[i] = n; });
  }

  /** matchEnd only: yes/no to a rematch. */
  private onRematch(client: Client, yes: unknown) {
    const p = this.state.players.get(client.sessionId);
    if (!p || this.state.phase !== 'matchEnd' || typeof yes !== 'boolean') return;
    p.rematch = yes;
  }

  /**
   * A new match (§23): points and stats back to 0 for everyone here, leavers off the board. `rematch` keeps the length
   * (no length vote); otherwise the length goes back to the default and the lobby votes on it.
   */
  private resetMatch(rematch: boolean) {
    const s = this.state;
    s.matchRound = 0;
    s.crownId = '';
    this.lengthLocked = rematch;
    if (!rematch) s.matchRounds = config.matchRounds;
    s.standings.clear();
    for (const [id, p] of s.players) s.standings.set(id, new StandingS({ id, name: p.name, color: p.color }));
    for (const p of s.players.values()) { p.lengthVote = -1; p.rematch = false; }
    this.syncLengthVotes();
  }

  /** The match length vote: the most-voted length; on a tie the default if it's among them, else the shortest. */
  private tallyLength(): number {
    const v = [...this.state.lengthVotes];
    const top = Math.max(...v);
    if (!top) return this.state.matchRounds;
    const best: number[] = v.flatMap((n, i) => (n === top ? [MATCH_LENGTHS[i]] : []));
    return best.includes(this.state.matchRounds) ? this.state.matchRounds : best[0];
  }

  /** A round ended: score it (§23), add the stats, move the crown (the strict leader among players still here). */
  private scoreMatchRound(world: World) {
    const s = this.state;
    const scores = scoreRound(world.mode, world.result, this.roundEvents, world.players, this.roundCrown);
    const stats = new Map<string, MatchStats>();
    for (const id of s.standings.keys()) stats.set(id, emptyStats());
    addRoundStats(stats, this.roundEvents);
    for (const [id, st] of s.standings) {
      const sc = scores.get(id), add = stats.get(id)!;
      st.roundPoints = sc?.points ?? 0;
      st.breakdown = sc ? sc.breakdown.map((b) => `${b.label} +${b.points}`).join(' · ') : '';
      st.scoredRound = s.matchRound;
      st.points += st.roundPoints;
      st.wins += add.wins; st.knockouts += add.knockouts; st.pushes += add.pushes; st.stomps += add.stomps; st.deaths += add.deaths; st.keys += add.keys;
    }
    const before = s.crownId;
    const present = new Map([...s.standings].filter(([id]) => s.players.has(id)).map(([id, st]) => [id, st.points]));
    s.crownId = crownOf(present) ?? '';
    const board = [...s.standings.values()].map((st) => `${st.name}:${st.points}(+${st.roundPoints})`).join(' ');
    console.log(`match round ${s.matchRound}/${s.matchRounds}: ${board}, crown ${s.crownId ? this.nameOf(s.crownId) : 'nobody'}${s.crownId !== before ? ' (changed)' : ''}`);
  }

  private onReady(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || this.state.phase !== 'lobby') return;
    p.ready = !p.ready;
    this.maybeStart();
  }

  /** Lobby only: a candidate index or RANDOM_VOTE. Voting again changes the vote. */
  private onVote(client: Client, option: unknown) {
    const p = this.state.players.get(client.sessionId);
    if (!p || this.state.phase !== 'lobby' || !validVote([...this.state.candidates], option)) return;
    p.vote = option;
    this.syncVotes();
  }

  private syncVotes() {
    const votes = [...this.state.players.values()].map((p) => p.vote);
    voteCounts([...this.state.candidates], votes).forEach((n, i) => {
      if (this.state.voteCounts[i] !== n) this.state.voteCounts[i] = n;
    });
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
        if (++s.tick >= s.phaseEndTick) this.setPhase(s.matchRound >= s.matchRounds ? 'matchEnd' : 'lobby');
        break;
      case 'matchEnd':
        if (++s.tick >= s.phaseEndTick) {
          const here = [...s.players.values()], yes = here.filter((p) => p.rematch).length;
          const rematch = here.length > 0 && yes * 2 > here.length;
          console.log(`match over: rematch ${yes}/${here.length} → ${rematch ? 'rematch' : 'fresh lobby'}`);
          this.resetMatch(rematch);
          this.setPhase('lobby');
        }
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
        for (const p of s.players.values()) { p.ready = false; p.spectating = false; p.vote = -1; }
        s.candidates.clear();
        s.candidates.push(...pickCandidates(this.pool, this.lastLevelId, this.rng));
        if (!s.voteCounts.length) s.voteCounts.push(0, 0, 0, 0);
        this.syncVotes();
        if (!s.levelId) s.levelId = s.candidates[0]; // the lobby backdrop until a round has been played
        console.log(`phase lobby (min players ${config.minPlayers}), vote: ${s.candidates.join(', ')}, random`);
        break;
      case 'countdown': {
        // Fresh world with everyone at their spawns; not stepped until playing, so the timer starts with the round.
        const votes = [...s.players.values()].map((p) => p.vote);
        const id = tallyVotes([...s.candidates], votes, this.pool, this.lastLevelId, this.rng);
        console.log(`vote: ${voteCounts([...s.candidates], votes).join('/')} (${s.candidates.join(', ')}, random) → ${id}`);
        this.level = this.pool.find((l) => l.id === id)!;
        this.lastLevelId = s.levelId = id;
        const level = config.antiStalemate ? this.level : { ...this.level, heat: null, crumble: this.level.mode === 'race' ? null : this.level.crumble };
        // Matches (§23): the first round fixes the length from the vote; the crown is fixed for the round.
        if (s.matchRound === 0 && !this.lengthLocked) s.matchRounds = this.tallyLength();
        s.matchRound++;
        this.roundCrown = s.crownId || null;
        this.roundEvents = [];
        for (const p of s.players.values()) p.lengthVote = -1;
        this.syncLengthVotes();
        const world = createWorld(level, ++this.round, { push: config.push, chain: config.antiStalemate, timing: config.timing });
        s.timing = config.timing;
        for (const [id, p] of s.players) if (!p.spectating) addPlayer(world, id, p.name);
        this.world = world;
        this.stalemate = new StalemateMeter();
        this.boostStats = { launch: 0, held: 0, released: 0 };
        this.hitStats = { headon: 0, side: 0 };
        this.koCauses = {};
        this.deathCauses = {};
        this.trapStats = { teleport: 0, toggles: 0 };
        this.pickupStats = {};
        this.pillKos = { heavy: 0, bouncy: 0 };
        this.knockPills.clear();
        this.lastKnock.clear();
        this.queues.clear();
        for (const p of s.players.values()) { p.ackSeq = -1; p.ackTick = -1; }
        s.items.clear();
        s.pickups.clear();
        syncSchema(world, s);
        s.tick = -COUNTDOWN_TICKS;
        s.phaseEndTick = 0;
        console.log(`phase countdown: round ${this.round} (match round ${s.matchRound}/${s.matchRounds}), ${world.players.length} players, level ${this.level.id} (${this.level.mode}), push ${world.rules.push ? 'on' : 'off'}, timing ${config.timing}`);
        break;
      }
      case 'matchEnd':
        this.world = null;
        s.tick = 0;
        s.phaseEndTick = MATCH_END_TICKS;
        for (const p of s.players.values()) p.rematch = false;
        console.log(`phase matchEnd: ${[...s.standings.values()].sort((a, b) => b.points - a.points).map((st) => `${st.name}:${st.points}`).join(' ')}`);
        break;
      case 'playing':
        s.phaseEndTick = this.world!.timeLimitTick;
        console.log('phase playing');
        break;
      case 'results': {
        this.scoreMatchRound(this.world!);
        const result = this.world!.result!;
        s.winnerId = result.winnerId ?? '';
        s.phaseEndTick = s.tick + RESULTS_TICKS;
        const winner = result.winnerId ? this.nameOf(result.winnerId) : 'draw';
        const w = this.world!;
        const stats = w.mode === 'knockout'
          ? `lives ${w.players.map((p) => `${p.name}:${p.lives}/ko${p.knockouts}`).join(' ')}, bands crumbled ${w.knockout!.next}`
          : `keys ${w.players.map((p) => `${p.name}:${p.keys}`).join(' ')}`;
        console.log(`phase results: ${winner} (${result.reason}) at tick ${w.tick}, level ${w.level.id}, ${stats}, stalemate ${(this.stalemate.ticks / TICK_RATE).toFixed(1)}s, boosts ${this.boostStats.launch}/${this.boostStats.held}/${this.boostStats.released} (launch/held/released), hits ${this.hitStats.headon}/${this.hitStats.side} (head-on/side), knockouts ${Object.entries(this.koCauses).map(([k, n]) => `${k}:${n}`).join(' ') || 'none'}, deaths ${Object.entries(this.deathCauses).map(([k, n]) => `${k}:${n}`).join(' ') || 'none'}, teleports ${this.trapStats.teleport}, laser toggles ${this.trapStats.toggles}, pickups ${Object.entries(this.pickupStats).map(([k, n]) => `${k}:${n}`).join(' ') || 'none'}, pill knockouts heavy ${this.pillKos.heavy} bouncy ${this.pillKos.bouncy}`);
        break;
      }
    }
  }

  private emit(e: SimEvent) {
    this.broadcast('event', e);
    this.roundEvents.push(e);
    const who = 'playerId' in e ? this.nameOf(e.playerId) : '';
    const pills = (id: string) => this.world?.players.find((p) => p.id === id)?.effects.map((x) => x.type) ?? [];
    if (e.type === 'push' || e.type === 'cradle') this.knockPills.set(e.victimId, pills(e.pusherId));
    if (e.type === 'stomp') this.knockPills.set(e.victimId, pills(e.attackerId));
    switch (e.type) {
      case 'pickup': { const k = `${who}:${e.pickup}`; this.pickupStats[k] = (this.pickupStats[k] ?? 0) + 1; console.log(`event pickup: ${who} took ${e.pickup}`); break; }
      case 'effectEnd': break;
      case 'key': console.log(`event key: ${who} has ${e.keys}`); break;
      case 'death': this.deathCauses[e.cause] = (this.deathCauses[e.cause] ?? 0) + 1; console.log(`event death: ${who} at ${e.cell.x},${e.cell.y},${e.cell.z} (${e.cause})`); break;
      case 'teleport': if (e.result === 'go') this.trapStats.teleport++; else console.log(`teleport: ${e.result} ${who}`); break;
      case 'laser': this.trapStats.toggles++; console.log(`event laser: ${who} turned ${e.group} ${e.on ? 'on' : 'off'}`); break;
      case 'respawn': console.log(`event respawn: ${who}`); break;
      case 'push': // phase 14d: moving collisions say which kind, and every knock is remembered for the knockout's cause
        this.lastKnock.set(e.victimId, e.moving ?? (e.edge ? 'edge' : 'push'));
        if (e.moving === 'headon') this.lastKnock.set(e.pusherId, 'headon');
        if (e.moving) this.hitStats[e.moving]++;
        console.log(`event push: ${this.nameOf(e.pusherId)} → ${this.nameOf(e.victimId)}${e.edge ? ' (edge)' : ''}${e.moving ? ` (${e.moving})` : ''}`);
        break;
      case 'cradle': this.lastKnock.set(e.victimId, 'cradle'); console.log(`event cradle: ${this.nameOf(e.pusherId)} → ${this.nameOf(e.victimId)} (line of ${e.length})`); break;
      case 'knockout': {
        const cause = this.lastKnock.get(e.victimId) ?? 'other';
        this.koCauses[cause] = (this.koCauses[cause] ?? 0) + 1;
        for (const t of ['heavy', 'bouncy'] as const) if (this.knockPills.get(e.victimId)?.includes(t)) this.pillKos[t]++;
      }
        console.log(`event knockout: ${this.nameOf(e.pusherId)} knocked ${this.nameOf(e.victimId)} off`); break;
      case 'stomp': this.lastKnock.set(e.victimId, 'stomp'); console.log(`event stomp: ${this.nameOf(e.attackerId)} → ${this.nameOf(e.victimId)}`); break;
      case 'clash': console.log(`event clash: ${this.nameOf(e.attackerId)} ↔ ${this.nameOf(e.victimId)}`); break;
      case 'burn': console.log(`event burn: ${who}`); break;
      case 'boost': { // phase 14c: holds and releases say why; launches are counted, not logged one by one
        this.boostStats[e.result]++;
        if (e.result === 'launch') break;
        const why = { solid: 'a cell on the flight path is solid', reserved: 'landing reserved by', unstompable: "can't stomp", bump: 'no room to bump' }[e.reason ?? 'solid'];
        console.log(`boost: ${e.result} ${who}${e.result === 'held' ? ` (${why}${e.byId ? ` ${this.nameOf(e.byId)}` : ''})` : ''}`);
        break;
      }
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
