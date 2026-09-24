# Phase 03 report: Authoritative server + wander bots

## Room lifecycle (`packages/server/src/rooms/RaceRoom.ts`)
- **onCreate**
  - Loads `levels/<LEVEL>.json` and validates it. It throws on an invalid level, and `index.ts` checks the level once at boot so it fails fast.
  - Registers the `input` and `ready` handlers.
  - Starts `setFixedTimestep(update, 20)`. Enters `lobby`.
- **onJoin**
  - Creates a `PlayerS` with a name (from join options, max 16 chars) and the first free colour from an 8-colour palette.
  - Anyone joining outside `lobby` is `spectating` until the next lobby.
- **onLeave**
  - Deletes the player from the schema and from the world.
  - If the world is left with no players, the room goes back to `lobby`. Otherwise it re-checks the start condition.
- **Phases.** One log line per change.

| Phase | Enter | Each tick | Exit |
|---|---|---|---|
| lobby | world = null, tick = 0, clear ready/spectating/winner | nothing | all players ready and count ≥ MIN_PLAYERS |
| countdown | fresh `createWorld`, `addPlayer` for every non-spectator (they appear at spawns), rebuild items, `tick = -60`, `phaseEndTick = 0` | `tick++`, no `step` | tick reaches 0 |
| playing | `phaseEndTick = timeLimitTick` | `step(world)` → `tick = world.tick` → `syncSchema` → broadcast events | `world.result` set → results immediately |
| results | `winnerId`, `phaseEndTick = tick + 100` | `tick++` | after 5 s → lobby |

- **syncSchema(world, state)**
  - `from*` = `pose` and `to*` = `to`. For an Idle player, `to*` = `pose`.
  - A field is assigned only when its value changed.
  - Collected keys are deleted from `items`; the exit is added once.
  - Dead players keep their out-of-bounds cell.

## Message formats (as implemented)
**Client → server**
- `input`: `{ seq: integer, fwdHeld: boolean, turn: -1 | 0 | 1, jump: boolean }`.
  - `parseInput` validates it; invalid messages are dropped and logged once per client.
  - Rate limit: 30 per second per client (window reset every 20 ticks). Extras are dropped and logged once per client.
  - Ignored outside `playing`.
- `ready`: no payload. Toggles `ready`, only in `lobby`.

**Server → client**
- `event`: the sim `SimEvent` as-is:
  - `{ type:'key', playerId, keyId, keys }`
  - `{ type:'win', winnerId: string | null, reason: 'exit' | 'timeout' }`
  - `{ type:'death', playerId, cell:{x,y,z} }`
  - `{ type:'respawn', playerId, cell }`

**State** (`schema/State.ts`)
- `GameState { phase, tick:int32, phaseEndTick:int32, levelId, winnerId ('' = none/draw), players: Map<PlayerS>, items: Map<ItemS> }`
- `PlayerS { id, name, color, action:uint8, fromX/Y/Z:int16, fromUp/fromFwd:uint8, toX/Y/Z, toUp, toFwd, startTick, endTick:int32, keys:uint8, ready, spectating }`
- `ItemS { id ('key-N' | 'exit'), kind ('key' | 'exit'), x, y, z:int16, up:uint8 }`

## Config
- `packages/server/src/config.ts` reads the repo-root `.env` via `process.loadEnvFile`. Real env vars win.
  - `PORT` (2567)
  - `MIN_PLAYERS` (1 in dev, 2 in production)
  - `LEVEL` (test-cube)
  - `LATENCY_MS` (0; passed to `server.simulateLatency`, so it's round-trip)
- `.env.example` is added.

## Bots (`npm run bots -- --count N [--behaviour wander] [--duration sec] [--server url]`)
- Each bot joins as `bot-N` and retries the connection for up to 30 s, which fixes the ECONNREFUSED at startup from report 01.
- It readies up whenever it is in the lobby and not ready.
- While playing it holds forward and sends a random pulse every 300–1200 ms: 35% left, 35% right, 30% jump.
- It logs its own keys and deaths.
- On `--duration`, Ctrl+C or a disconnect it leaves and prints a per-bot summary (rounds, wins, keys, deaths).

## Tests
- 82 tests pass: the 80 from phase 02, plus 2 new ones in `packages/server/test/race.test.ts`.
  - `parseInput` rejects 8 malformed shapes.
  - In-process server on :2598 with MIN_PLAYERS=2 and test-flat:
    - two clients join the same room;
    - garbage inputs are dropped (one warning logged, the room survives);
    - A ready alone stays in lobby, then B ready → countdown;
    - A is Idle at spawn (1,1,1) and the 4 items are present;
    - once playing, a fwd input shows up as a Roll to (1,1,2) within ≤ 4 ticks, lasts ROLL_TICKS, and `from` updates on arrival.
- `npm run typecheck` is clean.

## Bot run results (4 wander bots, `--duration 300`, test-cube, MIN_PLAYERS=2)
I ran both runs at the same time on separate ports (2587 and 2577), because 2567 was taken by your `npm run dev`. Both used the same code and config; the latency value was set through the environment rather than `.env`.

| Run | Rounds completed | Results | Deaths | Keys | Server errors |
|---|---|---|---|---|---|
| no latency | 2 (+ 1 cut off by the end of the run) | R1 **bot-4 exit win** at tick 1128 (3 keys); R2 **bot-3 timeout win** (3 keys) | 105 | 15 | none |
| LATENCY_MS=150 | 2 (+ 1 cut off) | R1 **draw** on timeout (bot-2 and bot-3 on 2 keys each); R2 **bot-2 timeout win** (2 keys) | 107 | 14 | none |

- In both runs, when the bots disconnected the room went back to lobby cleanly.
- Wander bots die roughly every 11 s each. Random turns on a 5×5 cube easily lead to a jump off the edge.

## Patch size / rate
- A probe client joined alongside 3 bots and counted raw WebSocket messages over 30 s of play: **16.9 msgs/s, 22.3 B average, about 376 B/s** per client.
- That count includes `event` messages.
- The `tick` field changes every tick, so there is a patch roughly every 50 ms.

## Deviations (also in DECISIONS.md)
- `GameState.tick` is a round clock: negative during countdown, the sim tick while playing, and it keeps counting during results.
- Level and MIN_PLAYERS come only from server config (never from join options). Tests override the exported `config`.
- The integration test uses an in-process server plus `@colyseus/sdk`, not `@colyseus/testing` (no new dependency).
- The phase 01 client got a no-op `event` handler, so the SDK doesn't warn "onMessage() not registered" on every event.

## Sim bugs found
- None. Shared is unchanged in this phase.

## Open questions / risks
- `setFixedTimestep` drops its backlog after a few catch-up steps on a long hitch (Colyseus behaviour). On a hitch that long the round clock falls behind wall time. That's harmless for correctness, and the client's `estServerTick` smoothing should absorb it.
- The rate-limit window uses room frames, not wall time, so it's approximate when the timestep catches up after a hitch.
- With MIN_PLAYERS=1 in dev, one tab that presses ready starts a round alone. Anyone joining after that spectates until the next lobby, which comes after results or when everyone has left.
- `npm run dev` leaves port 2567 busy. To run bots against a second server, use `--server ws://localhost:<port>` with `PORT=<port>` set for that server.
