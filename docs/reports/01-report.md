# Phase 01 report: Scaffold

## Files created
```
.gitignore  package.json  tsconfig.base.json  package-lock.json
levels/.gitkeep  docs/reports/.gitkeep
packages/shared/   package.json tsconfig.json src/index.ts src/index.test.ts
packages/server/   package.json tsconfig.json src/index.ts src/rooms/RaceRoom.ts src/schema/State.ts
packages/client/   package.json tsconfig.json vite.config.ts index.html src/main.ts
tools/bots/        package.json tsconfig.json src/index.ts
```

## Installed versions
| Package | Version |
|---|---|
| colyseus (server) | 0.18.8 (@colyseus/core 0.18.16) |
| @colyseus/schema | 5.0.34 |
| @colyseus/sdk (client + bots) | 0.18.4 |
| three / @types/three | 0.186.1 / 0.186.0 |
| vite | 8.3.1 |
| vitest | 5.0.1 |
| typescript | 7.0.2 |
| tsx / concurrently | 4.23.15 / 10.0.5 |

Node 24.14, npm 11.19.

## Deviations (also in DECISIONS.md)
- The client SDK is `@colyseus/sdk`. `colyseus.js` stopped at 0.16.
- There is no emitted JS for server/shared/bots. They run from source via `tsx`, and `npm run build` = typecheck + Vite client build.
- `.env` is loaded with Node's `process.loadEnvFile`, not dotenv.

## Verified automatically
- `npm run typecheck` passes in all four workspaces, and `npm test` passes (1 test).
- `npm run dev` starts the server on :2567 and Vite on :5173 (LAN URL printed).
- `npm run bots -- --count 3` joins 3 players. A 4th client made the count 4, and leaves dropped it again (server logs join/leave).
- A two-client probe script saw 2 players, then 1 after one client left.
- `npm run build` produces the client bundle.

## Manual test steps for Jakub
1. `npm install`, then `npm run dev`.
2. Open http://localhost:5173/?name=A and http://localhost:5173/?name=B. Each shows a rotating cube and "connected / 2 players".
3. Close one tab. The other shows 1 player.
4. In a second terminal run `npm run bots -- --count 3`. The open tab shows +3. Ctrl+C the bots and the count drops back.
5. Optional LAN test: open `http://<PC-IP>:5173` on a phone. The server URL defaults to the same host on port 2567, so Windows Firewall must allow Node on 5173 and 2567.

## Open questions / risks
- The first server start takes ~5–10 s (tsx + Colyseus boot). If bots are started right after `npm run dev`, they can get ECONNREFUSED, so wait for the `kulaworld server ... on :2567` line.
- npm 11 skips install scripts for `esbuild` and `msgpackr-extract` (`allowScripts`). Everything works without them (esbuild's platform binary comes from optionalDependencies, and msgpackr falls back to pure JS). If tsx ever complains about esbuild, run `npm install-scripts approve esbuild`.
- The client bundle is ~700 kB (three + sdk), which Vite warns about. That's fine for now.
- `npm audit` reports 16 low/moderate issues in transitive deps. They are not investigated yet.
