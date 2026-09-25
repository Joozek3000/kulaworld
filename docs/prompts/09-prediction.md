# Phase 09: Local client-side prediction

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§6, §7, §10, and §17, which you write in this phase), `docs/DECISIONS.md`, `docs/reports/08-report.md`.

## Why
Input→motion is ~140 ms locally and ~290 ms at 150 ms RTT, because the local ball waits for the server. The goal: your own ball reacts on the next frame after a key press, while the server stays authoritative.

## Design (implement this; log deviations)
1. **Input timestamps.**
   - The client keeps a **predicted tick** `predTick = estServerTick + lead`, where `lead = ceil(RTT/2 / 50 ms) + 1`, smoothed.
   - Every input message gets `tick: predTick`, meaning the tick at which the client wants it applied.
2. **Server.**
   - Apply an input at `max(msg.tick, currentTick + 1)`. Keep a small per-player queue keyed by tick, and drop inputs more than 20 ticks in the future.
   - Echo `ackSeq` and `ackTick` per player in the schema (the last input seq applied and the tick it was applied at). Invalid or late inputs still apply, just later; never drop a jump.
3. **Client predictor** (`client/src/predict/`, with pure logic in `shared/src/predict.ts` so it's unit-testable).
   - The client holds a local `World` copy. It's rebuilt from the latest authoritative server state for the **local player only**. Other players are included as static obstacles at their latest server pose, plus their current action's reserved cells. Level, removed blocks and items come from the server state.
   - Every client tick, it runs the shared `step()` for the local player, using its own input history.
   - **Reconciliation.** When a server patch shows the local player state at server tick T:
     - compare it with the predicted state recorded for T
     - if they match (action, from, to, start/end), drop the history before T
     - if not, reset the local player to the server state at T, re-simulate with the recorded inputs from T+1 to predTick, and count a **misprediction**
4. **Rendering.**
   - The local ball renders from the predicted timeline at `predTick` (minus 0 ticks, no interpolation delay).
   - On a misprediction, don't teleport. Blend the render position/orientation from the old predicted pose to the corrected one over ~100 ms (visual error offset decay).
   - Other balls stay interpolated at `estServerTick − 2`, unchanged.
5. **Safety rules.**
   - **Don't predict pushes.** If the predicted fwd target cell, or the cell beyond it, holds another player (by latest server state), don't predict that action. Wait for the server as now.
   - **Don't predict** key pickups, exit wins, deaths/respawns, knockouts, crumble falls or being knocked. Those come from the server only. The predictor may predict a *fall start* off an edge (pure geometry), but not the death.
   - When the local player is Knocked, Stunned, Dead or eliminated, pause prediction and render from the server until it's Idle again.
6. **Sounds and squash** (from 08) for the local ball are triggered from the predicted timeline, so they happen at press time.
7. **Toggle.** `?predict=0` disables prediction (the old path). Default on. The F3 overlay shows predTick, lead, mispredictions/min and the last correction distance.

## Tests
- **Shared predictor, pure:**
  - no mismatch when the server echoes identical results
  - a jump blocked on the server by a player the client didn't know about → exactly one misprediction, and the state converges after reconciliation
  - re-simulation replays held fwd, pulses and jumpHeld correctly across a correction
  - inputs are applied at their stamped tick on the server (integration test: stamped `tick` in the future → applied exactly then; late → applied at the next tick)
- **Determinism:** the server and a predictor fed the same inputs and no other players produce identical local states for 2000 ticks.

## Acceptance checklist
- [ ] Tests pass. Typecheck is clean. `?predict=0` behaves exactly like phase 08.
- [ ] Measured input→motion (F3): ≤ 1 frame + 1 tick at LATENCY_MS 0 and at 150
- [ ] Solo rolling/hopping/air-turning at 150 ms: 0 mispredictions over 60 s
- [ ] Against 3 bully bots at 150 ms: mispredictions happen only around other players, corrections blend without visible teleports, and pushes still look right (the victim doesn't slide before contact)
- [ ] A 10-round bot soak with a predicting browser client: no errors

## Report: `docs/reports/09-report.md`
- Latency before/after table (0 and 150 ms)
- Misprediction stats solo vs brawl
- Deviations
- Recommendation: are the push rule and remote-player interpolation OK at 150 ms, or is more needed?

Also write ARCHITECTURE §17 "Client prediction" summarising the final design.

Then commit: `phase 09: local prediction`.
