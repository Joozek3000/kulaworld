# Phase 09 report: Local client-side prediction

## Summary
- **Your own ball now reacts on the next predicted tick after a key press.** Measured input→motion is a median of 18–32 ms and a max of 64 ms, at both 0 and 150 ms of simulated latency. Before, it was a median of 163 ms and 298 ms.
- **The server stays authoritative.** Inputs carry the tick they should apply at. The server queues them and echoes `ackSeq`/`ackTick`, and the client reconciles on every patch.
- **Checks.** `npm run typecheck` is clean and `npm test` passes: 356 tests, up from 347.
  - `shared/test/predict.test.ts` (8): scheduling, determinism over 2000 ticks, the unknown-blocker jump, replay across a late input, deferral, and a never-acked input.
  - One server integration test for stamped ticks.
- **Code:**
  - `shared/src/predict.ts`: `InputSchedule`/`InputQueue`, shared by server and client, and the pure `Predictor`.
  - `client/src/predict/local.ts`: lead/predTick, reconcile on patch, input stamping, stats.
  - Render integration in `render/players.ts`: timeline source switch and a 100 ms correction blend.
  - The server input queue and ack in `RaceRoom.ts`/`State.ts`.
- **Docs:** ARCHITECTURE §17 is written, and §6 mentions `tick`. Six deviations are logged in DECISIONS (summarised below).
- **`?predict=0`** leaves inputs unstamped and renders from the server only. That's the phase 08 path; the server applies unstamped inputs on the next tick as before.

## Latency (F3 input→motion, headless Chrome at ~22 fps, arena-01, solo)
Each run is 30 presses (W, D, D, Space, A mid-hop, D) × 6.

| | LATENCY_MS 0 | LATENCY_MS 150 (ping ~160) |
|---|---|---|
| `?predict=0` (phase 08) | median **163 ms**, max 202 ms | median **298 ms**, max 364 ms |
| prediction on | median **32 ms**, max 64 ms | median **18 ms**, max 59 ms |
| budget (1 frame + 1 tick) | ≈ 95 ms at 22 fps | ≈ 95 ms |

- The ~900 ms outliers in the raw data (every 5th sample, in both modes) aren't latency. They come from the mid-hop air turn: an air turn changes the running hop in place, so it never starts a new action and the metric waits for the next press. They're excluded above (5–6 per run, 23–24 samples left).
- Headless Chrome renders at ~22 fps, so frame time dominates the prediction numbers. At 60+ fps they'd be lower.

## Mispredictions
| Scenario | Duration | Mispredictions | Deferred corrections | Notes |
|---|---|---|---|---|
| Solo, 0 ms (roll, hop, air turns, random) | ~95 s | **0** | 0 | 0 late inputs |
| Solo, 150 ms | ~95 s | **0** | 0 | 0 late inputs |
| 3 bully bots, 150 ms (hunting + random) | ~300 s, 2 rounds | **3** | 12 | 1 adjacent to a bot, 1 at round start, 1 a turn/roll order difference (below) |
| 10-round soak, 150 ms, seek + 2 bullies | 1020 s, 11 rounds | 24 | 36 | before the deferral-tracking fix (below); 14 of 24 were adjacent to a bot |

**Deferred corrections** are the server resolving a move the predictor deliberately didn't predict because another player was in the way: a push, a bounce, or a roll once the way cleared. They're expected, and not mispredictions.

**Remaining misprediction causes**
- **Round start:** an input sent after the server started play but before the client saw it. It goes out unstamped and costs one correction when its ack arrives.
- **Other players moving** into or out of the cells our prediction used.
- **Hidden late inputs:** acks show only the last input applied per patch, so the lateness of an earlier input in the same window goes unseen.
- **Crumble falls:** server-only, corrected when the patch arrives.

**Visual check.** A per-frame monitor of the local ball in all runs found no teleports.
- Every step over 0.45 cells is a fall (0.5 cells/tick at ~22 fps), or the 100 ms blend of a large correction. At 22 fps that blend spans ~2 frames (a fast slide); at 60 fps it spans 6.
- The one bigger case, 2.4 cells in one frame, was the blend of a mispredicted crumble fall.

**Pushes look the same as without prediction.** When I push a bot, the gap between the balls' centres at the moment the victim starts sliding was:

| Mode | Gap at slide start (cells, centre to centre) |
|---|---|
| `?predict=0` | 0.94–0.95 |
| prediction on | 0.84–1.06 across 29 measured pushes |

The balls touch at 0.8. The smallest gap seen during any knock was 0.84–0.87, so there was no interpenetration.

**Soak:** 11 rounds, 0 client exceptions (page `error` listener), 0 server errors, all rounds ended by last-alive.

## Deviations (details in DECISIONS.md)
1. **Lead from `estServerTick` is `ceil(RTT / 50 ms) + margin`, not `ceil(RTT/2 / 50 ms) + 1`.** `estServerTick` already trails the server by RTT/2.
   - With a margin of 1 there were late inputs even at 0 ms, because patches aren't phase-locked to ticks.
   - The margin now starts at 2, grows by 1 per late input (up to 5), and eases back after 15 s.
   - Lead changes are rate-limited. A stepped lead made `predTick`, and so falls, jump up to 1.6 cells in one frame.
2. **Far-future stamps are clamped to +20 ticks, not dropped** (a jump is never dropped). A pulse never shares a tick with an earlier pulse, on both sides; the sim buffers only one.
3. **Late inputs are held back until acked**, rather than re-guessed every patch. A late input costs 2 mispredictions.
   - An input sent before the predictor started is logged the same way.
   - An input that's never acked stops holding back later ones as soon as a later input is acked.
4. **Pause rules:**
   - Prediction also pauses while the predictor itself has the player Dead, and it never respawns on its own.
   - The unsynced pulse and forward latch count as spent when the server shows a decision at the compared tick. Without this, a buffered jump fired twice after a respawn.
5. **Pushes render from the server timeline.** At 150 ms the lead (6 ticks) is longer than a roll (5 ticks). So by the time the push arrived, the predicted timeline was already past the pusher's roll: the roll never rendered, and the ball blended a cell.
   - Now, after a held-back move is resolved by the server, the local ball follows the server timeline until the server has it Idle again.
   - The server's action starts in the very cell the predicted ball was holding in, so the switch is seamless.
6. **Deferral bookkeeping is per tick.** A single "deferred since" marker was cleared by earlier matches, which mislabelled later deferrals as mispredictions. It was fixed after the 11-round soak, and the brawl numbers above are from after the fix.

## Recommendation: is the push rule OK at 150 ms?
**Yes for correctness, with one feel cost.**
- **Correctness.** Pushes are never predicted, so they're never wrong. With the server-timeline handover they look exactly as before: same contact gap, no double slide, no rewind.
- **Feel cost.** A push, or any move into a cell next to another player, still has the old full-RTT delay: the ball waits in place for the server, about 300 ms at 150 ms latency.
  - Near other players you feel both behaviours: instant motion in open space, and the old delay when brushing past someone.
  - At 150 ms that's noticeable but consistent. At 250 ms or more I'd expect it to feel sticky.
- **Options if it bothers you in playtests:**
  1. **Predict the pusher's roll only.** Roll into the victim's cell, and let the server decide the victim's knock. On a bounce it becomes a (visible) correction back.
  2. **Show press feedback immediately** (a squash "wind-up" on the local ball) while waiting for the server.

**Remote interpolation (`estServerTick − 2`)** is fine for watching others. But at 150 ms your view of them is ~6 ticks behind your own ball, so aiming a push at a moving bot means leading the target by about a cell. That's inherent to prediction without remote extrapolation. Phase 10 (stomp) makes it more visible, because landing spots matter.

## Open questions
1. **Pushes at high ping:** try "predict the pusher's roll only" (option 1 above)?
2. **Round start:** inputs sent just after play starts but before the client sees it cost one correction. Should the server accept (and queue) inputs during the last second of the countdown, so holding W across "GO" works for everyone? That would change phase 08 behaviour for `?predict=0` too.
3. **Rate limit:** the 30 inputs/s limit can still drop an input. With prediction, a dropped input shows as a misprediction until a later one is acked. Raise it, or exempt pulses?
4. **Air-turn metric:** F3's input→motion misses air turns (the ~900 ms outliers above). Should air turns count as motion in the metric?
5. **Real-browser check:** all numbers are from headless Chrome at ~22 fps plus a synthetic 150 ms. A LAN or phone test at real latency would be worth doing before phase 10.
