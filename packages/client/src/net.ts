import { Client, type Room } from '@colyseus/sdk';
import type { Input } from '@kula/shared';

/** Client-side view of the server schema (packages/server/src/schema/State.ts). */
export interface PlayerS {
  id: string; name: string; color: string; action: number;
  fromX: number; fromY: number; fromZ: number; fromUp: number; fromFwd: number;
  toX: number; toY: number; toZ: number; toUp: number; toFwd: number;
  startTick: number; endTick: number; keys: number; ready: boolean; spectating: boolean;
}
export interface ItemS { id: string; kind: 'key' | 'exit'; x: number; y: number; z: number; up: number }
interface MapLike<T> { get(k: string): T | undefined; has(k: string): boolean; forEach(cb: (v: T, k: string) => void): void; size: number }
export interface GameState {
  phase: 'lobby' | 'countdown' | 'playing' | 'results'; tick: number; phaseEndTick: number;
  levelId: string; winnerId: string; players: MapLike<PlayerS>; items: MapLike<ItemS>;
}

const TICK_MS = 50;
const SNAP_TICKS = 5;

const params = new URLSearchParams(location.search);
export const playerName = params.get('name') ?? `P-${Math.floor(1000 + Math.random() * 9000)}`;
export const serverUrl = params.get('server') ?? `ws://${location.hostname}:2567`;

export class Net {
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

  constructor(readonly room: Room) {
    room.onStateChange((s: GameState) => {
      if (s.phase !== this.lastPhase || s.tick < this.lastTick - SNAP_TICKS) this.reset = true;
      this.lastPhase = s.phase;
      this.lastTick = s.tick;
      this.lastAt = performance.now();
      this.patches++;
    });
    room.onMessage('event', () => {}); // sim events: FX/sounds later
    const ping = () => room.ping((ms) => { this.ping = ms; });
    ping();
    setInterval(ping, 2000);
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

  sendInput(input: Input): void { this.room.send('input', input); }
  sendReady(): void { this.room.send('ready'); }
}

export async function connect(): Promise<Net> {
  return new Net(await new Client(serverUrl).joinOrCreate('race', { name: playerName }));
}
