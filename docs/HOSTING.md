# Hosting Flipside online (Fly.io)

One Fly.io app runs one machine in London (`lhr`). The machine serves the built client and the game rooms on one HTTPS host, so a friend only needs the link. The image comes from the repo's `Dockerfile`, so it runs anywhere Docker does (see "Moving to a VPS" below). The spec is `ARCHITECTURE.md` §24.

- URL: `https://flipside-game.fly.dev` (the `app` name in `fly.toml`)
- Machine: `shared-cpu-1x`, 512 MB, no volumes
- Health: `https://flipside-game.fly.dev/health` returns `{ version, rooms, players }`

## Exactly one machine

Rooms live in the server's memory. A second machine would split players into two sets of rooms that can't see each other, and an invite code would work only half the time. Keep the count at 1:

```powershell
npm run fly -- scale count 1
npm run fly -- machines list   # exactly one row
```

A deploy keeps the current count. If `machines list` ever shows two, run `scale count 1` again.

## flyctl and the token

Every Fly command goes through `npm run fly -- <args>` (`scripts/fly.mjs`). It loads `FLY_API_TOKEN` from the repo's `.env` (ignored by git and Docker) and runs `.fly/bin/flyctl.exe`, a git-ignored local download, falling back to `flyctl` on the PATH. The token is never printed. There's no browser login: create a token on fly.io (Account → Access Tokens, or the app's Tokens page), then put it in `.env` as `FLY_API_TOKEN=...`. Check it with:

```powershell
npm run fly -- auth whoami
```

## First-time setup (once)

1. Create a Fly.io account and **add a credit card**. A trial account's machines are killed after 5 minutes ("Trial machine stopping").
2. Put a token in `.env` (above) and check `npm run fly -- auth whoami`.
3. Create the app. The name becomes `https://<name>.fly.dev` and must match `app` in `fly.toml`:
   ```powershell
   npm run fly -- apps create flipside-game
   ```
4. First deploy, with `--ha=false`; without it Fly creates two machines:
   ```powershell
   npm run fly -- deploy --ha=false
   npm run fly -- scale count 1
   ```

No volumes, databases or secrets on the app are needed. Never commit a Fly token.

## Deploy

```powershell
npm run deploy        # = npm run fly -- deploy
```

Fly builds the `Dockerfile` on its remote builder (no local Docker needed) and replaces the machine. The machine count stays at 1. Players in a room get a "Server restarting" toast, and their rooms close about 3 s later. When they rejoin on an old page, they get "A new version is out, refresh the page" if `version` in `package.json` changed.

Bump `version` in the root `package.json` for any change to the game rules or the network messages, so old pages are refused cleanly.

## Logs, status, rollback

```powershell
npm run fly -- logs               # live server log: room create/dispose, join/leave (one line each), rounds
npm run fly -- logs --no-tail     # the recent buffer only
npm run fly -- status             # machine state (started / stopped), region, image
npm run fly -- machines list      # the one machine, its size and state
npm run fly -- releases --image   # past deploys, with their image refs
npm run fly -- deploy --image registry.fly.io/flipside-game:deployment-XXXX   # roll back to a listed image
```

Metrics (CPU, memory, connections) are on the app's page in the Fly dashboard: Monitoring → Metrics. The same numbers come from Fly's Prometheus API with the token (`https://api.fly.io/prometheus/personal/api/v1/query`, header `Authorization: <token>`), e.g. `fly_instance_memory_mem_total - fly_instance_memory_mem_available` for memory in use, and `rate(fly_instance_cpu{mode!="idle"}[1m])` for CPU in centiseconds per second (≈ % of one vCPU).

## Idle stop and cold start

`fly.toml` has `auto_stop_machines = "stop"` and `min_machines_running = 0`. The Fly proxy stops the machine a few minutes after the last connection closes. The next request starts it again, which is a cold start of a few seconds. An open WebSocket counts as a connection, so the machine never stops while anyone is in a room. A stopped machine loses its rooms, but they're already empty by then.

## Cost

From Fly's pricing page (https://docs.fly.io/about/pricing/, checked 2026-09-30):

- `shared-cpu-1x` with 512 MB: $0.0095 per hour in the base region (about $6.91/month if it never stops). London costs about 13.5 % more, so about $7.84/month running 24/7.
- It's billed per second while running. With auto-stop, a few hours of play a day costs a fraction of that. For example, 3 h/day is about $1/month in London.
- A stopped machine's root filesystem: $0.15 per GB per 30 days (the image is well under 1 GB).
- Outbound data (Europe): $0.02/GB. A match is a few MB per player.
- The shared IPv4 and IPv6 addresses and the `fly.dev` certificate are free. A dedicated IPv4 ($2/month) isn't needed.

## Moving to a VPS (same image)

Any Linux VPS with Docker works. Run the same image, with Caddy in front for HTTPS (it gets and renews the certificate on its own, and proxies WebSockets without extra config).

```sh
# on the VPS, from a clone of the repo
docker build -t flipside .
docker run -d --name flipside --restart unless-stopped -p 127.0.0.1:2567:2567 flipside
```

`/etc/caddy/Caddyfile` (point the domain's DNS A record at the VPS first):

```
play.example.com {
  reverse_proxy 127.0.0.1:2567
}
```

Then `sudo systemctl reload caddy`. On SIGTERM (`docker stop`, which waits 10 s by default), the server gives rooms the restart toast and closes them. Keep it to one server process, for the same reason as on Fly.

## Running the production server locally

```powershell
npm run build         # typecheck, client build (packages/client/dist), server bundle (packages/server/dist/server.js)
npm run start:prod    # the server on :2567, serving the client: open http://localhost:2567
```

`$env:PORT=2568; npm run start:prod` picks another port. `MAX_ROOMS` (default 20) caps rooms; see `.env.example`.
