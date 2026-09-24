// All server settings, read once from the repo-root .env (if present) and the process env.
try { process.loadEnvFile(new URL('../../../.env', import.meta.url)); } catch { /* no .env */ }

const env = process.env;
const prod = env.NODE_ENV === 'production';

/** Mutable so tests can override before creating a room. */
export const config = {
  port: Number(env.PORT ?? 2567),
  minPlayers: Number(env.MIN_PLAYERS ?? (prod ? 2 : 1)),
  level: env.LEVEL ?? 'test-cube',
  /** Round-trip ms passed to Colyseus simulateLatency; 0 = off. Ignored in production. */
  latencyMs: prod ? 0 : Number(env.LATENCY_MS ?? 0),
};
