# Phase 01: Scaffold

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§2, §10, §11), `docs/DECISIONS.md`.

## Goal
Get an empty but working monorepo: `npm run dev` starts server + client, the browser connects to a Colyseus room and shows the live player count.

## Tasks
1. `git init` with a `.gitignore` (node_modules, dist, .env, coverage).
2. Root `package.json` with npm workspaces: `packages/shared`, `packages/server`, `packages/client`, `tools/bots`. Also add `tsconfig.base.json` (strict, ES2022, moduleResolution bundler/node16 as appropriate).
3. Root scripts: `dev`, `build`, `test`, `typecheck`, `bots`. They must all work in Windows PowerShell.
4. `packages/shared`: export a `VERSION` constant and one trivial function with a Vitest test.
5. `packages/server`: Colyseus (latest stable) server on `PORT` (default 2567). Add a `race` room that tracks the connected clients in a schema `players` map (id + name from join options) and logs joins/leaves. Import `VERSION` from shared to prove workspace linking works.
6. `packages/client`: Vite + Three.js. Render a full-window scene with a rotating placeholder cube. Connect to `race` with `?name=` (default random `P-1234`) and `?server=` (default `ws://<location.hostname>:2567`). Show "connected / N players" in a corner overlay. Vite runs with `host: true`.
7. `tools/bots`: stub CLI that parses `--count` and `--behaviour`, joins N clients to `race` and prints player counts. It runs via `npm run bots -- --count 3`.
8. Create empty `docs/reports/` and `levels/` folders (add a `.gitkeep`).

## Constraints
- No game logic yet.
- Pin major versions in package.json.
- Check current Colyseus docs for the server/client API of the version you install. The API changed between 0.15 and 0.16. Record the version in DECISIONS.md.

## Acceptance checklist
- [ ] `npm install` then `npm run dev` works from a clean clone on Windows
- [ ] Two browser tabs both show "2 players"; closing one updates the other to 1
- [ ] `npm run bots -- --count 3` makes open tabs show +3 players
- [ ] `npm run typecheck` and `npm test` pass

## Report: `docs/reports/01-report.md`
- Files created (tree, short)
- Installed versions (Colyseus server/client/schema, three, vite, vitest, typescript)
- Deviations (also logged in DECISIONS.md)
- Manual test steps for Jakub
- Open questions/risks

Then commit: `phase 01: scaffold`.
