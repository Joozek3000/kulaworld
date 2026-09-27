# Phase 14c report: Boost pads that always work

## Summary
- **A pad launches whenever a ball arrives on it,** by roll, flip, climb, knock or ice slide, from any direction. It always launches **along its arrow (`dir`)**. The ball spins to face the arrow in the air (the mid-air turn record), and the camera swings with it.
  - The launch plan itself uses the pad's dir, so the sim, the bots' BFS and `level:check` all follow the new rule from one place.
  - Jumps and falls that land on a pad still don't launch (a boost landing on a pad would chain).
- **Blocked launch → hold.** If the flight path or landing is solid, the landing is reserved, or the ball on the landing can't be stomped (or bumped), the ball holds on the pad as `Action.Charge`:
  - It's squashed, the pad glows brightest, and a rising hum plays. Input is ignored.
  - It retries every tick for `BOOST_HOLD_TICKS` = 10. If still blocked, it's released as on a plain tile, and that pad stays quiet for this ball until it leaves the pad.
- **Knock onto a pad** = launch; the stagger comes after the landing. **Ice slide onto a pad** = the slide ends and the launch starts.
- **Server log:**
  - `boost: held <ball> (<reason> <other ball>)`, e.g. `boost: held Browser (can't stomp script)`, and `boost: released <ball>`.
  - Every round's results line ends with `boosts L/H/R (launch/held/released)`.
  - In the sim these are `boost` events.
- **Prediction:** a launch with another player within 3 cells of the landing is deferred to the server. `Charge` is server-only (prediction pauses). A solo launch is predicted exactly.
- **Client:**
  - The chevrons run along `dir` all the time, faster while the pad glows.
  - Charge squashes the ball and plays a new `hum` synth.
  - The local launch plays `pwomp` plus a short camera kick (pushed back 0.45 cells, easing out).
- **Level audit:** every pool pad, rolled onto from each open neighbour, launches along its arrow to the expected landing. **No pad needed a new `dir`**: the 14b dirs already match each level's intent (listed below). `level:check` is unchanged: 0 errors in the pool. LEVEL-DESIGN 6.2 and §18 are updated.
- **Checks:** typecheck and build are clean. `npm test` passes **611 tests** (564 before). `level:check` exits 0.

## Why pads "did nothing" before
All three causes from the prompt were real:
1. The 14b direction gate: from any direction but `dir` the pad was a plain tile.
2. A blocked launch (landing reserved, say) cleared the forced move and the ball just sat there.
3. A climb or knock onto a pad never launched.

There was a fourth, quieter one: a ball high in a hop on the landing made the launch a stomp jump that then *clashed* back. Now a non-stompable ball on the landing (staggered, spawn-protected or high in a hop) holds the launch instead.

## Tests (`boost.test.ts`, 46; `predict.test.ts` +2)
| What | Result |
|---|---|
| Entry along, against, and from both sides | all 4 launch to the same landing along `dir`; the side and back entries record a mid-air turn |
| Climb onto a pad on a wall (arrow +Y) | thrown 3 up the wall |
| Knock onto a pad | Knocked → Jump → Stunned (stagger, not bounce) → Idle, landing facing `dir` |
| Ice slide onto a pad | launches |
| A spawn-protected ball on the landing | `held` (reason `unstompable`, by that ball), Charge; launches the tick after it has rolled clear |
| Still blocked after 10 ticks | `held` then `released` exactly 10 ticks later; Idle on the pad for 20 more ticks with no re-fire; rolled off and back on → fires again (held again) |
| A stompable ball on the landing | stomp (unchanged) |
| Two pads with the same landing, both balls arriving on the same tick | one jumps, the other holds (reason `reserved`, by the jumper), in fair order |
| Planning: a pad entered from the side | the whole plan is one roll: the pad flies the ball across the gap |
| Determinism | 4 players, 3 pads + ice, random inputs, 1500 ticks, replayed identically |
| Level audit: every pool pad × every open neighbour | 33 pads, all launch along `dir` to the expected landing |
| Prediction: solo side-entry launch | 0 mispredictions |
| Prediction: another player 2 cells from the landing | deferred (deferrals > 0), 0 mispredictions |

The 14b test "a pad launches only along its dir" is removed; the rule it tested is gone.

## Pad directions (unchanged from 14b)
The audit test shows every pad lands where its arrow says:
- arena-01 centre +X
- arena-04 west pole +Y (past the middle plate)
- arena-05: 4 outer pads across the gap to the island, 4 island pads back out
- race-01 +Z (island C onto D)
- race-02 +X (over the gap east)
- race-04 +Y (the throw toward the top)
- race-06: 20 pads, each across its gap to the facing pad

With any-direction entry, a ball rolling *along* an island edge over a pad is now thrown across that gap. That's the new rule's intent: the arrow tells you where you'll go.

## Browser
Chrome through the extension, with throwaway servers on :2569 and Vite on :5174. Your :2567/:5173 were untouched.

**Two windows on a small test plate** (pad arrow +X, landing 3 ahead; the second window is a scripted client). The landing cases need spawn protection, which only exists in knockout after a respawn, so they ran on a temporary knockout plate.
- *Stompable ball on the landing:* the browser rolled onto the pad → `launch` → `stomp` of the other ball.
- *Spawn-protected ball on the landing:* the script jumped off, respawned protected, and rolled onto the landing. The browser's page reacted in the same patch and rolled onto the pad. Server log: `boost: held Browser (can't stomp script)` at tick 94, `boost: released Browser` at tick 104.
- *Re-fire:* the browser rolled off the pad, turned round, and rolled back on *against* the arrow → `launch` +X → `stomp` → knockout.
- The scripted ball later walked onto the pad on its way back and was launched onto the browser's ball (`stomp script → Browser`): any-direction entry working for the other side too.

**race-06 and arena-05:** the page planned a route with the shared `findPath` and rolled onto the nearest pad **sideways** (perpendicular to its arrow).
- race-06: pad (7,0,16), arrow −X, entered moving −Z → launched to (4,1,16) facing −X.
- arena-05: pad (7,0,3), arrow +Z, entered moving −X → launched to (7,1,6) facing +Z, onto the island.
- In screenshots the chevrons are visible on every pad, pointing along the arrows.

**Not verified on screen:** the Charge squash, the hum, and the camera kick. Timers in the automated tab are throttled, so I couldn't capture the 10-tick hold as a still frame. They're render/audio code only.

## Soak
Pool soak: 4 bots (`seek,bully,blocker,wander`, skill 0.5), no `LEVEL` override, bots voting, MIN_PLAYERS 4, throwaway server on :2568.

**25 rounds, 0 STUCK, 0 errors.** Claude Code stopped the bots after round 25 because the machine was low on memory (the session was idle, so it wasn't something in the bots). The checklist's 12 rounds were already covered, so I didn't restart it.

Boost launches / holds / releases per level (summed over its rounds):

| Level | Rounds | Launch | Held | Released |
|---|---:|---:|---:|---:|
| arena-01 | 4 | 7 | 0 | 0 |
| arena-02 | 4 | 0 | 0 | 0 |
| arena-03 | 4 | 0 | 0 | 0 |
| arena-04 | 3 | 4 | 2 | 2 |
| arena-05 | 1 | 29 | 2 | 1 |
| race-01 | 1 | 0 | 0 | 0 |
| race-02 | 1 | 1 | 0 | 0 |
| race-03 | 3 | 0 | 0 | 0 |
| race-04 | 1 | 0 | 0 | 0 |
| race-05 | 3 | 0 | 0 | 0 |
| race-06 | 0 | – | – | – |

- The vote never picked race-06 in this run; its pads are covered by the audit test and the browser check.
- The pad-less levels show 0, as they should.
- The 4 holds, from the log:
  - `held bully-2 (no room to bump blocker-3)` → released
  - `held blocker-3 (can't stomp seek-1)` → no release logged (it launched, or was shoved off the pad, within the hold)
  - `held bully-2 (no room to bump seek-1)` → released
  - `held seek-1 (can't stomp blocker-3)` → released
- Most launches are bots crossing arena-05's ring gap (29 in one round). Winners: seek on all 9 races, and bully, blocker or seek on the knockouts.

## Deviations (details in DECISIONS.md)
1. **Charge is a run of 1-tick actions,** so each retry goes through the normal intent resolution (that's what makes the two-pads case fair).
2. **A charging ball is pushable** and transmits in a cradle line: it's grounded and still. Shoving someone off a pad mid-hold is allowed.
3. **A solid cell on the flight path also holds, then releases,** instead of doing nothing. No pool pad has one.
4. **Jump and fall landings on a pad don't launch.**
5. **The prediction deferral covers the other player's cell or target within 3 cells (Manhattan) of the landing.** The predictor still simulates the launch but records the tick as deferred, so a server hold reconciles as a deferral, not a misprediction.

## Open questions
1. **Edge pads now throw sideways walkers.** Rolling along race-06's island edges over a pad throws you across the gap. That's the rule as specified, but on race-06 (20 pads, one on every edge middle) you can't walk an island's edge row without being thrown. Keep it, or move those pads one tile in from the edge, so the only way onto them is heading for the gap?
2. **Charge length:** 10 ticks (0.5 s) felt right in the logs, but a hold under the stomp-able rule means a spawn-protected ball blocks a pad for its whole 2 s protection (held, released, then the pad is quiet until you leave). Fine, or should a protected ball simply be stomped anyway (protection only against pushes)?
