import { Client, type Room } from '@colyseus/sdk';
import { GAME_VERSION, JOIN_ERROR, type Input, type InputMsg, type SimEvent } from '@kula/shared';

/** Client-side view of the server schema (packages/server/src/schema/State.ts). */
export interface PlayerS {
  id: string; name: string; color: string; action: number;
  fromX: number; fromY: number; fromZ: number; fromUp: number; fromFwd: number;
  toX: number; toY: number; toZ: number; toUp: number; toFwd: number;
  startTick: number; endTick: number; turnFromFwd: number; turnStartTick: number; bounce: boolean; keys: number; ready: boolean; spectating: boolean;
  lives: number; eliminated: boolean; eliminatedTick: number; eliminatedBy: string; protectedUntil: number; knockouts: number;
  ackSeq: number; ackTick: number; fireCount: number;
  /** Pills (15a): effect type → the tick it ends. */
  effects?: MapLike<number>;
  /** Lobby vote (phase 14): 0..2 a candidate, 3 Random, -1 none. */
  vote: number;
  /** Matches (phase 18): match-length vote (0..2 → 3/5/7, -1 none) and the rematch vote. */
  lengthVote?: number;
  rematch?: boolean;
  /** Online (phase 19): a server-side bot; dropped, with the seat held for a reconnect. */
  bot?: boolean;
  away?: boolean;
}
/** A line on the match board (phase 18, §23). */
export interface StandingS {
  id: string; name: string; color: string; points: number; roundPoints: number; breakdown: string; scoredRound: number; left: boolean;
  wins: number; knockouts: number; pushes: number; stomps: number; deaths: number; keys: number;
}
/** `kind`: 'key' | 'exit' in `items`; the pill type in `pickups` (15a). */
export interface ItemS { id: string; kind: string; x: number; y: number; z: number; up: number }
interface MapLike<T> { get(k: string): T | undefined; has(k: string): boolean; forEach(cb: (v: T, k: string) => void): void; size: number }
export interface GameState {
  phase: 'lobby' | 'countdown' | 'playing' | 'results' | 'matchEnd'; tick: number; phaseEndTick: number;
  /** Matches (phase 18, §23); absent in single player. */
  matchRound?: number; matchRounds?: number; crownId?: string; standings?: MapLike<StandingS>; lengthVotes?: ArrayLike<number>;
  levelId: string; winnerId: string;
  /** Online (phase 19, §24): the private room's code ('' public), the host, the bot difficulty 0..2. */
  code?: string; hostId?: string; botLevel?: number;
  /** Movement timing preset (phase 17); absent from older servers. */
  timing?: string; players: MapLike<PlayerS>; items: MapLike<ItemS>;
  /** Pickups on the map (15a), by id. */
  pickups: MapLike<ItemS>;
  mode: 'race' | 'knockout' | 'single'; crumbled: number; warnBand: number; nextCrumbleTick: number;
  /** Hot tiles (phase 12c): tileKey → heat in ticks. */
  hot: MapLike<number>;
  /** Crumble tiles (§18): block cellKey → the tick it vanishes (or vanished). */
  crumbling: MapLike<number>;
  /** Laser groups (phase 13b): group → 1 on, 0 off. */
  lasers: MapLike<number>;
  /** Lobby vote (phase 14): candidate level ids, and votes per option (3 candidate slots, then Random). */
  candidates: ArrayLike<string>;
  voteCounts: ArrayLike<number>;
}

/**
 * What the renderer, HUD and audio read (phase 15b): the server's room (Net) or the local single-player game
 * (LocalGame). `estServerTick` is the clock to render at.
 */
export interface GameSource {
  readonly state: GameState;
  readonly sessionId: string;
  readonly estServerTick: number;
  readonly ping: number;
  readonly patchRate: number;
  update(now: number, dtMs: number): void;
  onEvent(cb: (e: SimEvent) => void): void;
  sendInput(input: Input): void;
  sendReady(): void;
  sendVote(option: number): void;
  /** Matches (phase 18): the length vote (0..2) and the rematch vote. No-ops in single player. */
  sendLength?(option: number): void;
  sendRematch?(yes: boolean): void;
}

const TICK_MS = 50;
const SNAP_TICKS = 5;

const params = new URLSearchParams(location.search);
export const playerName = params.get('name') ?? `P-${Math.floor(1000 + Math.random() * 9000)}`;
/**
 * The game server (§24): ?server= wins, then a build-time VITE_SERVER_URL (the itch build), then in production the
 * page's own origin (the server serves the client), else in dev the same host on :2567.
 */
export const serverUrl = params.get('server') || import.meta.env.VITE_SERVER_URL
  || (import.meta.env.PROD ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}` : `ws://${location.hostname}:2567`);
/** An invite link (§24): `?room=CODE` opens the Multiplayer menu ready to join that room. */
export const inviteCode = params.get('room') ?? '';
export const VERSION_MESSAGE = 'A new version is out, refresh the page';

export class Net implements GameSource {
  /** Smoothed estimate of the server's round clock (float); never goes backwards except on a reset. */
  estServerTick = 0;
  ping = 0;
  patchRate = 0;
  private lastTick = 0;
  private lastAt = 0;
  private lastPhase = '';
  private reset = true;
  private patches = 0;
  private patchWindow = 0;
  private eventListeners: ((e: SimEvent) => void)[] = [];
  private patchListeners: (() => void)[] = [];
  private noticeListeners: ((text: string) => void)[] = [];
  /** Stamps outgoing inputs with their apply tick (prediction, §17); identity when unset. */
  stamp: ((i: Input) => InputMsg) | null = null;

  constructor(readonly room: Room) {
    room.onStateChange((s: GameState) => {
      if (s.phase !== this.lastPhase || s.tick < this.lastTick - SNAP_TICKS) this.reset = true;
      this.lastPhase = s.phase;
      this.lastTick = s.tick;
      this.lastAt = performance.now();
      this.patches++;
      for (const cb of this.patchListeners) cb();
    });
    room.onMessage('event', (e: SimEvent) => { for (const cb of this.eventListeners) cb(e); });
    room.onMessage('notice', (text: string) => { for (const cb of this.noticeListeners) cb(String(text)); });
    // Reconnection (§24): the SDK retries with its token on a drop; the server holds the seat for 20 s.
    room.reconnection.maxDelay = 2000;
    room.reconnection.maxRetries = 12;
    room.onReconnect(() => { this.reset = true; });
    // Leave promptly on navigation; a page kept in the back/forward cache would otherwise hold its seat.
    addEventListener('pagehide', () => { void room.leave(); });
    const ping = () => room.ping((ms) => { this.ping = ms; });
    ping();
    const timer = setInterval(ping, 2000);
    room.onLeave(() => clearInterval(timer));
  }

  get state(): GameState { return this.room.state as GameState; }
  get sessionId(): string { return this.room.sessionId; }

  /** Call once per frame. */
  update(now: number, dtMs: number): void {
    const target = this.lastTick + (now - this.lastAt) / TICK_MS;
    if (this.reset) {
      this.estServerTick = target;
      this.reset = false;
    } else {
      const prev = this.estServerTick;
      const est = prev + dtMs / TICK_MS;
      const err = target - est;
      this.estServerTick = Math.abs(err) > SNAP_TICKS ? target : Math.max(prev, est + err * Math.min(1, (dtMs / 1000) * 2));
    }
    if (now - this.patchWindow >= 1000) {
      this.patchRate = (this.patches * 1000) / (now - this.patchWindow);
      this.patches = 0;
      this.patchWindow = now;
    }
  }

  /** Sim events broadcast by the server (key, death, respawn, win). */
  onEvent(cb: (e: SimEvent) => void): void { this.eventListeners.push(cb); }

  /** Server notices (phase 19), e.g. "Server restarting" before a deploy. */
  onNotice(cb: (text: string) => void): void { this.noticeListeners.push(cb); }

  /** Called after every state patch, once the new state is in place. */
  onPatch(cb: () => void): void { this.patchListeners.push(cb); }

  sendInput(input: Input): void { this.room.send('input', this.stamp ? this.stamp(input) : input); }
  sendReady(): void { this.room.send('ready'); }
  sendVote(option: number): void { this.room.send('vote', option); }
  sendLength(option: number): void { this.room.send('length', option); }
  sendRematch(yes: boolean): void { this.room.send('rematch', yes); }
}

/** How to get into a room (§24): Quick Play (a public room), a new private room, or a room's code. */
export type JoinHow = { quick: true } | { create: true } | { code: string };

export async function connect(name: string, how: JoinHow): Promise<Net> {
  const client = new Client(serverUrl), opts = { name, version: GAME_VERSION };
  const room = 'code' in how ? await client.joinById(how.code, opts)
    : 'create' in how ? await client.create('race', { ...opts, private: true }) : await client.joinOrCreate('race', opts);
  return new Net(room);
}

/** A refused join in plain words (§24). */
export function joinErrorText(e: unknown): string {
  const { code, message = '' } = (e ?? {}) as { code?: number; message?: string };
  if (code === JOIN_ERROR.version) return VERSION_MESSAGE;
  if (code === JOIN_ERROR.serverFull) return 'Server full, try again soon';
  if (/not found|disposed/.test(message)) return 'No room with that code';
  if (/locked/.test(message)) return 'Room is full';
  return `Can't reach the server (${serverUrl})`;
}
