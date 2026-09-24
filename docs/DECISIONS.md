# Decisions log

Format: `YYYY-MM-DD, phase NN: decision, reason`

- 2026-09-24, phase 00: Stack is Three.js + Colyseus + TS monorepo. Browser-first for fast solo iteration and link-shareable playtests.
- 2026-09-24, phase 00: Multiplayer from day one. Solo testing via multiple tabs, headless bots and simulated latency.
- 2026-09-24, phase 00: No client prediction in the MVP. Action-based sync (from/to + start/end tick) with interpolation instead. Grid actions last 150–500 ms, so input delay at typical ping should be acceptable. Revisit after the latency test.
- 2026-09-24, phase 00: Falls ignore other players in the MVP. Death keeps keys.
- 2026-09-24, phase 00: PvP is push/knock-off (ARCHITECTURE §14), planned after the MVP. In Key Race with PvP, a death drops 1 key back to its spot. Second mode: Knockout arena.
- 2026-09-24, phase 01: Colyseus 0.18 (server `colyseus@0.18.8`, `@colyseus/schema@5.0.34`, client `@colyseus/sdk@0.18.4`; the old `colyseus.js` package is replaced by `@colyseus/sdk`). Server uses `defineServer`/`defineRoom`; schema uses the `schema({...})` + `t.*` helper, so no decorators are needed.
- 2026-09-24, phase 01: No build step for server/shared/bots. They run from TS source via `tsx`, and shared is linked as TS source (`exports: ./src/index.ts`). `npm run build` = typecheck + Vite client build. Add emitted JS only if deployment needs it.
- 2026-09-24, phase 01: TypeScript 7 (native `tsc`) with `moduleResolution: bundler` and `.ts` import extensions everywhere.
- 2026-09-24, phase 01: `.env` is loaded with Node's built-in `process.loadEnvFile` (no dotenv dependency).
