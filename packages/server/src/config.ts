import { isTimingName, type TimingName } from '@kula/shared';

// All server settings, read once from the repo-root .env (if present) and the process env.
try { process.loadEnvFile(new URL('../../../.env', import.meta.url)); } catch { /* no .env */ }

const env = process.env;
const prod = env.NODE_ENV === 'production';

/** Mutable so tests can override before creating a room. */
export const config = {
  port: Number(env.PORT ?? 2567),
  minPlayers: Number(env.MIN_PLAYERS ?? (prod ? 2 : 1)),
  /** Optional level override (one id or a comma list) for testing; empty = the pool (levels with "pool": true). */
  level: env.LEVEL ?? '',
  /** Round-trip ms passed to Colyseus simulateLatency; 0 = off. Ignored in production. */
  /** PvP push rules (ARCHITECTURE §14): PUSH=on|off, default on. */
  push: env.PUSH !== 'off',
  /**
   * Phase 12 anti-stalemate rules (chain push, hot tiles, race sudden death). ANTI_STALEMATE=off restores the phase 11
   * rules, for before/after soaks. Default on.
   */
  antiStalemate: env.ANTI_STALEMATE !== 'off',
  /** Movement timing preset (phase 17): TIMING=classic|snappy, default classic. */
  timing: (isTimingName(env.TIMING) ? env.TIMING : 'classic') as TimingName,
  latencyMs: prod ? 0 : Number(env.LATENCY_MS ?? 0),
};
