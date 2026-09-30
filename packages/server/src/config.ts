import { isTimingName, type TimingName } from '@kula/shared';

// All server settings, read once from the repo-root .env (if present) and the process env.
try { process.loadEnvFile(new URL('../../../.env', import.meta.url)); } catch { /* no .env */ }

const env = process.env;
/** Production (phase 19): the Docker image sets NODE_ENV; `npm run start:prod` passes --prod (no cross-env on Windows). */
const prod = env.NODE_ENV === 'production' || process.argv.includes('--prod');

/** Mutable so tests can override before creating a room. */
export const config = {
  port: Number(env.PORT ?? 2567),
  /** Phase 19 (§24): the most rooms at once (beyond it: "Server full"), and how long a dropped player's seat is held. */
  maxRooms: Number(env.MAX_ROOMS ?? 20),
  reconnectSec: 20,
  minPlayers: Number(env.MIN_PLAYERS ?? (prod ? 2 : 1)),
  /** Optional level override (one id or a comma list) for testing; empty = the pool (levels with "pool": true). */
  level: env.LEVEL ?? '',
  /** PvP push rules (ARCHITECTURE §14): PUSH=on|off, default on. */
  push: env.PUSH !== 'off',
  /**
   * Phase 12 anti-stalemate rules (chain push, hot tiles, race sudden death). ANTI_STALEMATE=off restores the phase 11
   * rules, for before/after soaks. Default on.
   */
  antiStalemate: env.ANTI_STALEMATE !== 'off',
  /** Match length default (phase 18): MATCH_ROUNDS=3|5|7, default 5. The lobby votes on it before round 1. */
  matchRounds: [3, 5, 7].includes(Number(env.MATCH_ROUNDS)) ? Number(env.MATCH_ROUNDS) : 5,
  /** Movement timing preset (phase 17): TIMING=classic|snappy, default classic. */
  timing: (isTimingName(env.TIMING) ? env.TIMING : 'classic') as TimingName,
  /** Round-trip ms passed to Colyseus simulateLatency; 0 = off. Ignored in production. */
  latencyMs: prod ? 0 : Number(env.LATENCY_MS ?? 0),
};
