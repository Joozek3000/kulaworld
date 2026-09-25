# Phase 03: Authoritative server + wander bots

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§6–§8, §10, §12), `docs/DECISIONS.md`, `docs/reports/02-report.md`.

## Goal
The `race` room runs the shared sim at 20 Hz, handles the round phases and syncs state. Headless bots can play a full round against each other.

## Tasks
1. `schema/State.ts`: `GameState`, `PlayerS`, `ItemS` per §10. Write a `syncSchema(world, state)` that copies the sim → schema after each step, touching only changed fields.
2. `RaceRoom`:
   - loads the level from `LEVEL` (validates it, refuses to start if invalid)
   - uses a fixed 50 ms simulation interval
   - on join: `addPlayer` and assign a colour (palette of 8)
   - on leave: `removePlayer`
   - messages: `input` (validated: types, turn ∈ {-1,0,1}, rate-limited to 30/s per client, extra dropped) and `ready` (toggle)
   - phase machine: lobby → countdown (3 s) → playing → results (5 s) → lobby. Respect `MIN_PLAYERS`. Reset the world each round. Ignore gameplay inputs outside `playing`.
   - broadcast sim events as `event` messages
   - joining mid-round: the player spectates until the next lobby (`PlayerS.spectating`)
3. Env config: `PORT`, `MIN_PLAYERS`, `LEVEL`, `LATENCY_MS`, read in one config module. Values come from a `.env` file (dotenv or `node --env-file`) so no shell env syntax is needed on Windows. Add `.env.example`.
4. `tools/bots`: behaviour `wander`.
   - each bot joins with name `bot-N` and readies up in the lobby
   - while playing, it holds forward and sends random turn/jump pulses every 300–1200 ms
   - it logs its keys and deaths
   - flag `--duration <sec>`
   - retries the connection for up to 30 s (fixes the ECONNREFUSED on start from report 01), and on disconnect exits cleanly with a summary
5. Integration test (`@colyseus/testing` or an in-process server): 2 clients join, ready, the round starts, one sends inputs, and its state changes in the schema within the expected ticks.
6. Server logs: one line per phase change and per event. No per-tick spam.

## Notes from the phase 02 review
- The time limit counts from world tick 0 (DECISIONS). At countdown start, create a fresh world and add all non-spectating players so they appear at their spawns. Don't call `step` until `playing` starts, so the timer begins with the round.
- When `world.result` becomes non-null, stop stepping immediately and switch to `results`. Don't rely on the sim freezing items.
- The sim stores `pose` (current) + `to`. Map that to the schema's `from*` = `pose` and `to*` = `to`. For an Idle player, set to = from.
- Dead players keep their out-of-bounds cell in `pose`. The client hides them by action, so leave the cell as-is.

## Constraints
- The room doesn't implement rules. Anything rule-like belongs in shared.
- If you find a sim bug, fix it in shared with a regression test and note it in the report.

## Acceptance checklist
- [ ] `npm test` includes the integration test and passes. Typecheck is clean.
- [ ] `.env` with `MIN_PLAYERS=2`, `npm run dev` + `npm run bots -- --count 4 --duration 300` runs 5 minutes with no server errors and at least 1 round completing (win or timeout)
- [ ] The same run with `LATENCY_MS=150` in `.env` also completes without errors
- [ ] Invalid input messages are rejected and logged once per client, and the server doesn't crash

## Report: `docs/reports/03-report.md`
- Room lifecycle summary, message formats as implemented
- Bot run results (rounds played, winners, deaths)
- Measured average patch size / rate if easy to get
- Deviations, open questions/risks

Then commit: `phase 03: server + bots`.
