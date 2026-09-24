# Kulaworld (working title)

Multiplayer browser game inspired by Kula World. Balls roll on floating block structures. Each player has their own gravity, which flips when they roll over an edge. First mode: **Key Race**.

## How this repo is worked on

- The architecture and specs are in `docs/`. Implementation happens phase by phase from `docs/prompts/NN-*.md`, in order.
- `docs/ARCHITECTURE.md` is the source of truth. If you need to deviate from it, don't change it silently. Log the deviation in `docs/DECISIONS.md` (date, what, why) and mention it in your phase report.
- At the end of each phase, write `docs/reports/NN-report.md` in the format given in the phase prompt.

## Stack

- npm workspaces monorepo. TypeScript `strict` everywhere. ESM.
- `packages/shared`: pure TS with no runtime deps. It holds types, constants, the level format + validation, and the deterministic simulation. Tested with Vitest.
- `packages/server`: Node + Colyseus (latest stable) + `@colyseus/schema`.
- `packages/client`: Vite + Three.js + the Colyseus JS client.
- `tools/bots`: headless bot clients (Node) for solo multiplayer testing.
- `levels/*.json`: hand-authored levels.

## Commands (keep these working)

- `npm run dev`: server + client together (client on :5173, server on :2567)
- `npm test`: all Vitest suites
- `npm run typecheck`: tsc across all workspaces
- `npm run bots -- --count 3 --behaviour wander`: spawns bot players

## Hard rules

- All game rules live in `packages/shared/src/sim`. The server calls it. The client only renders (prediction may use it later). Never duplicate rule logic in client or server.
- Sim state uses integers only: grid cells, direction enums and tick counts. No floats, no `Date.now()`, no `Math.random()` inside the sim. Use the seeded RNG in shared.
- The server is authoritative. Clients send inputs only.
- Placeholder art only: primitives, flat colours, no textures or models.
- The dev machine is Windows. npm scripts must work in PowerShell, so no bash-only syntax. Use `concurrently`/`cross-env` or node scripts.
- A phase isn't done until `npm run typecheck` and `npm test` pass and the phase's acceptance checklist is complete.
- Keep dependencies minimal. Ask (via the report) before adding anything beyond the stack above plus small dev tools.
