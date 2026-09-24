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
- 2026-09-24, phase 02: `Dir` and `Action` are `as const` objects plus union types, not TS `enum`s. Same values, and they stay erasable (Node type stripping, isolatedModules).
- 2026-09-24, phase 02: Pulses use one buffer slot. Within one input message jump beats turn; across messages the latest wins. That is how "jump > turn" works with a single slot.
- 2026-09-24, phase 02: A pulse is valid while `tick - pulseTick <= INPUT_BUFFER_TICKS`, where `pulseTick` is the world tick when the input arrived (so it's usable on the next 6 steps). A pulse is spent when tried, even if blocked. A blocked pulse falls through to held fwd on the same tick.
- 2026-09-24, phase 02: Reservations are derived each tick from player state and not stored. Flip and Jump also reserve their pass-through cell (A / A1). A falling player reserves its current and next cell, so others can't move in, but its own fall ignores reservations (§5). Dead players reserve nothing.
- 2026-09-24, phase 02: With no free spawn (on respawn or on join), the player stays Dead and retries every tick. `addPlayer` uses the same path.
- 2026-09-24, phase 02: Key pickup and the exit win are resolved when the action finishes (§7 step 2), in the same rotated player order as starts. Only the timeout is checked in step 4. After a result, keys and exit are frozen but movement keeps running; the server decides when to stop stepping.
- 2026-09-24, phase 02: The time limit counts from world creation (tick 0), so the server should create the world when `playing` starts.
- 2026-09-24, phase 02: The level check for "no duplicate item cells" also covers spawns (spawn/key/exit must all be distinct).
- 2026-09-24, phase 02: Added dev dependency `@vitest/coverage-v8` (required by the phase's coverage check).
