# Phase 19: Online hosting (Fly.io) + rooms for friends and strangers

Read first: `CLAUDE.md` (commit **and push**), `docs/ARCHITECTURE.md` §24 (new: this phase's spec), §3, §23, `docs/reports/18c-report.md`, and `docs/prompts/itch-build.md` (this phase must leave the itch build easy).

## Fly setup (Jakub works remotely, so no browser login on the PC)
- **flyctl is already on disk:** `.fly\bin\flyctl.exe` (v0.4.110, Windows x64, from the official GitHub release, checksum verified). `.fly/` is in `.gitignore`. Use it from there. Don't run the PowerShell installer.
- **Auth is a token, not `fly auth login`:**
  - Jakub creates it on fly.io from his phone and puts it in `.env` as `FLY_API_TOKEN=...` (`.env` is ignored by git and must also be in `.dockerignore`).
  - Add a commented `# FLY_API_TOKEN=` line to `.env.example`.
- **`scripts/fly.mjs`:** loads `.env`, then spawns `.fly/bin/flyctl.exe` (or `flyctl` from PATH if present) with the token in its environment and the given args.
  - `npm run fly -- <args>` runs any command.
  - `npm run deploy` runs `npm run fly -- deploy`.
  - Never print the token.
- **Before anything else:** run `npm run fly -- auth whoami`. If it fails (no token, or a bad one), stop and tell Jakub. Don't work around it.
- **App name:** create the app as `flipside-game`. If that's taken, try `flipside-kula`, then stop and ask. It becomes `https://<app>.fly.dev`.
- Never commit or log Fly tokens. Don't create anything beyond one app with one machine and no volumes. Before any command that creates a paid resource, say what it creates in the report.
- There's no local Docker, so use Fly's remote builder (`fly deploy` builds remotely). The Task 3 local check is `npm run build` + `npm run start:prod` unless Docker happens to be installed.

## Task 0: Crown size by distance (18c follow-up)
At 2.3× the crown is bigger than the ball up close (`18c-race-01-back.jpg`). Scale it with camera distance: about 1.2× within 3 cells, up to 2.3× at 8+ cells, smoothly. Take another screenshot at both distances.

## Task 1: Production server (§24)
1. **Same origin:**
   - The server serves `packages/client/dist` (static, with long cache headers for hashed assets and no-cache for `index.html`) and the WebSocket on one port. Use Colyseus 0.18's Express hook on `defineServer` (check the current API).
   - Bind `0.0.0.0` and read `PORT` from the environment.
2. **Client URL:**
   - `?server=` wins.
   - Otherwise a build-time `VITE_SERVER_URL`.
   - Otherwise, in production builds, the same origin (`wss:` on https, `ws:` on http).
   - Otherwise, in dev, `ws://<hostname>:2567` as now.
3. **Version check:**
   - Join options carry `GAME_VERSION`, and the server refuses a mismatch with a clear error code.
   - The client shows "A new version is out, refresh the page" with a Refresh button.
4. **`/health`:** returns `{ version, rooms, players }`.
5. **SIGTERM:** broadcast a "Server restarting" toast, wait ~3 s, then shut down gracefully.
6. **Names:** check that names are trimmed, capped at 16 characters, stripped of control characters, and rendered with `textContent` everywhere: labels, the board, toasts, the podium and the stats card. Fix any `innerHTML` use with a name.
7. **Logs:** one line each for room create/dispose (with code or public), and for join/leave with the room's player count. No per-tick logs.

## Task 2: Rooms (§24)
1. **Multiplayer menu:**
   - Name field.
   - **Quick Play:** a public room, preferring one in the lobby phase.
   - **Create private room.**
   - **Join with code:** a 4-letter input, case-insensitive.
   - Errors in plain words: "No room with that code", "Room is full", "Server full, try again soon", the version message.
2. **Private rooms:**
   - The server generates the code from an unambiguous alphabet, so a code maps to exactly one room.
   - Private rooms are hidden from Quick Play.
   - The lobby shows the code large, with a **Copy invite link** button (`<origin>/?room=CODE`).
   - Opening an invite link goes straight to the name field, then joins.
3. **Host:**
   - The creator (or, in a public room, the first human) is host.
   - When the host leaves, the longest-connected human becomes host.
   - The board shows a small host marker.
4. **Server-side bots:**
   - Refactor `tools/bots` so the bot brain is an importable module. `npm run bots` keeps working with the same flags.
   - The server spawns bots in-process: either as Colyseus clients to its own port, or through a direct in-room hook. Pick the simpler path and log why in DECISIONS.
   - The host's lobby controls:
     - **Add bot** and **Remove bot**, up to 8 in the room.
     - **Difficulty** Easy/Normal/Hard, with the behaviour mixes in §24.
   - Bots are named with 🤖, count toward `MIN_PLAYERS`, ready themselves, vote randomly, and vote yes on a rematch.
   - When the last human leaves, the room and its bots are disposed.
   - In a public room where one human has waited 30 s, the host gets a "Fill with bots" prompt.
5. **Reconnection:**
   - The server holds the seat for 20 s with `allowReconnection` on an unexpected drop. A clean leave (menu, tab close) is immediate.
   - The client keeps the reconnection token and retries with backoff behind a "Reconnecting…" overlay.
   - Prediction resets cleanly after a reconnect.
6. **`MAX_ROOMS`:** default 20, in `.env.example`.
7. **Tests:**
   - code generation and uniqueness
   - private rooms not joinable by Quick Play
   - the join-by-code errors
   - the version mismatch refused
   - host handover
   - add/remove bots respecting 8
   - a room disposed when the last human leaves (bots gone)
   - a reconnect within 20 s keeps points and stats, and after 20 s the player has left
   - `MAX_ROOMS` enforced

## Task 3: Deploy
1. **`Dockerfile`:**
   - Multi-stage on `node:24-slim`: `npm ci`, build the client, then a runtime stage with `NODE_ENV=production`.
   - Run the server with tsx or Node's own type stripping, whichever works with the workspace imports. No new bundler unless needed; ask via the report first.
   - Add a `.dockerignore` (node_modules, .git, docs/reports/img, release, .env).
   - Keep the image small; report its size.
2. **`fly.toml`:**
   - `primary_region = "lhr"`, `internal_port = 2567`, `force_https = true`.
   - `auto_stop_machines = "stop"`, `auto_start_machines = true`, `min_machines_running = 0`.
   - A health check on `/health`.
   - `shared-cpu-1x`, 512 MB.
   - Concurrency limits suited to WebSockets.
   - Add a comment that the app must stay at **one machine** (`fly scale count 1`).
3. **Scripts:**
   - `npm run fly` and `npm run deploy`, as in the Fly setup above.
   - `npm run start:prod` runs the production server locally, and the Docker image runs the same command.
4. **Local check first:**
   - `docker build` and run the image locally, if Docker is installed. Otherwise `npm run build` plus `npm run start:prod`.
   - Then open `http://localhost:2567` and play a round with 3 server-side bots.
5. **Deploy to Fly:** follow the Fly setup above, then run `npm run fly -- scale count 1`.
6. **`docs/HOSTING.md`:**
   - first-time setup, deploy, logs (`fly logs`), status, and how to roll back (`fly releases`, `fly deploy --image`)
   - how to check the app runs one machine
   - what it costs, from Fly's pricing page, with the date checked
   - how to move to a VPS with the same image (a Caddy reverse proxy for TLS)
7. **CI:** add a job that builds the Docker image. It doesn't push or deploy.

## Task 4: Internet checks
Use the real `https://<app>.fly.dev` for these.
- Two browsers on Jakub's PC plus a phone on mobile data (no Wi-Fi) join one private room via the invite link. Controls on the phone aren't required; it can spectate.
- Report the ping each client shows (F3), and whether movement feels as responsive as local with prediction.
- Kill the phone's connection for ~10 s and restore it: the reconnect keeps its seat.
- **Soak:** one public room from Jakub's machine with `npm run bots -- --count 4 --behaviour seek,bully,rival,wander --server wss://<app>.fly.dev --length 3`, plus a private room with 6 server-side bots and 1 browser, at the same time. 1 full match each, 0 STUCK, no errors.
  - Report the machine's memory and CPU during it (`fly status` / the metrics page).
- Leave everything idle for 10 minutes and check the machine stopped. Then open the URL: report the cold-start time to the menu and to a joined lobby.
- Deploy a trivial change (bump `GAME_VERSION` to 0.1.1) while a browser is still on 0.1.0. It should get the restart toast, then the refresh message on rejoin.

## Acceptance
- [ ] Crown scales with distance (two screenshots)
- [ ] `https://<app>.fly.dev` serves the game; Quick Play, private code, and invite link all work from outside the LAN
- [ ] Server-side bots: add/remove/difficulty in the lobby, a full match with bots only plus 1 human
- [ ] Reconnect within 20 s keeps the seat; the version mismatch is handled
- [ ] Soak above clean; machine memory well under 512 MB
- [ ] Auto-stop and cold start work; one machine only
- [ ] `docs/HOSTING.md` written; CI Docker job green (or say you can't see it)
- [ ] typecheck, test, level:check pass; single player still works from the hosted URL

## Report: `docs/reports/19-report.md`
- The URL, the image size, the machine size and the cost estimate.
- Ping numbers (PC, phone on mobile data), cold-start times, and the soak stats.
- Screenshots: the Multiplayer menu, the private lobby with its code and bot controls, the reconnect overlay, the version message, and the crown at both distances.
- Deviations and open questions.

Commit: `phase 19: online hosting`, then push. Don't deploy anything else afterwards without Jakub.
