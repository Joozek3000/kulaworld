# Phase 05b report: Air turns + spawn shuffle

## What changed
- **Sim**
  - At the start of each tick (§7 step 1), an airborne player (Hop, Jump or Fall) with a buffered left/right pulse turns immediately. `to.fwd` is rotated, the pulse is consumed, and `turnFromFwd`/`turnStartTick` are recorded.
  - Landing cell, up, end tick and reservations don't change, so a forward jump still lands where it was aimed. Chaining after landing (held jump+fwd, or held fwd) uses the new facing.
  - Grounded turns are still 3-tick Turn actions. A turn during a Roll or Flip still waits until that action ends. Jump pulses pressed in the air still wait for landing (phase 05 rule).
- **Snap fix found during the latency check**: a turn that landed exactly on the last tick of a hop was applied, and then the next chained hop started on the same tick and reset the turn record. The new hop rendered already turned, which gave a one-frame 90° snap at 150 ms latency. `startAction` now only resets a record older than TURN_TICKS. There is a regression test for this.
- **Schema/client**
  - `PlayerS.turnFromFwd` / `turnStartTick` are synced.
  - The client's segment history updates an in-flight action in place when only its facing or turn record changes, so air turns don't count as "late segments".
  - `poseAt(..., airTurn)` slerps the facing from `turnFromFwd` to `to.fwd` over 150 ms, starting at the press. The camera follows the rendered facing, so it swings with the turn.
- **Spawn shuffle**: each world gets a seeded shuffled `spawnOrder`, and the server seeds it with the round number. It's deterministic per seed.

## Tests: 187 passed, typecheck clean
New (`packages/shared/test/airTurn.test.ts` and the pose test):
- hopping + turn → fwd changes on the same tick, the hop's endTick is unchanged, no Turn action, and the pulse is consumed;
- two presses in one hop → 180°, and the record follows the second press;
- forward jump + air turn → lands on the planned (2,1,0) facing +Z, then held jump+fwd jumps to (2,1,2);
- turn during a fall → applied immediately and kept on landing;
- a turn during a Roll or Flip still buffers until it ends, and a grounded turn is still 3 ticks;
- a turn on the landing tick of a chained hop keeps its spin record into the next hop (the snap fix);
- spawn shuffle: deterministic per seed, varies across seeds, and every spawn is someone's first spawn at some seed;
- pose: mid-air facing at turn progress 0 / 0.5 / 1 (clamped), with the position unaffected. A forward jump's arc still follows `from`.

Changed:
- **Removed 3 phase-05/04c tests** that asserted the old behaviour ("turn pressed mid-hop / mid-jump applies on landing", "jumpHeld + turn tap → Turn action on landing"). They contradict the new rule, and the new tests above replace them.
- **Tests that place players by spawn index** now call `inOrder(world)`: the `makeWorld` helper, the BFS replays and the cube tour.
- **The server integration test** accepts any test-flat spawn.
- BFS and bot logic are unchanged, and the determinism test passes.

## Browser checks (Claude in Chrome, race-01; server action log recorded in the page)
| Scenario | Server log | Result |
|---|---|---|
| Hold Space, tap A | Hop 17–27 facing +X → tick 21 same hop facing −Z → hops 27, 37 facing −Z | ✓ turns mid-bounce, keeps bouncing the new way |
| Hold Space, tap D twice | Hop 49–59: −Z → +X (tick 52) → +Z (tick 54), next hop +Z | ✓ faces back within one bounce |
| Space+W chain, tap D mid-jump | Jump 406–416 (3,1,3)→(1,1,3): −X → −Z at tick 411; next Jump 416 (1,1,3)→(1,1,1) | ✓ lands where planned, next jump goes the new way |

I used D in the chain test because a left turn from that spawn would have aimed the next jump over a gap. The mechanism is symmetric.

**Rendered spin**: I sampled the local ball's facing every frame while tapping A mid-bounce.

| Latency | Press → spin starts | Spin | Max per frame | Late segs |
|---|---|---|---|---|
| 0 ms | 91 ms | 90° over 146 ms | 3.9° | 0 |
| 150 ms, before the fix | ~330 ms | **90° in 1 frame** | 90° | 0 |
| 150 ms, after the fix (5 press timings across the hop) | 267–327 ms | 90° over 146–157 ms | ≤ 3.9° | 0 |

With 150 ms latency the delay is just the network plus the 1-tick render offset, with no snaps.

## Win distribution (race-01, 3 seek + 1 wander, unattended)
| | seek-1 | seek-2 | seek-3 | wander-4 |
|---|---|---|---|---|
| Before shuffle (phase 05, first 10 rounds) | 0 | 0 | **10** | 0 |
| After shuffle (first 10 rounds) | 3 | 2 | 5 | 0 |
| After shuffle (all 13 rounds in 480 s) | 3 | 4 | 6 | 0 |

- All rounds were exit wins, with **0 STUCK** and 0 server errors. Seek bots had 0 deaths; wander-4 had 21.
- Rounds now take 16.5–23 s instead of 11–16 s, because the bots start spread out and contend for the same keys and beams. Bot replans roughly tripled for the same reason, which is blocking, not bugs.

## Still unlike Kula World
- **Air turns happen at the press, but a press during a roll still waits for the tile to finish.** In Kula World a turn during a roll is also queued, so this probably matches, but worth confirming by feel.
- **Holding a turn key doesn't repeat**, since pulses fire once per press. Kula World behaves the same, as far as I know.
- **A turn on the ground still costs 150 ms (TURN_TICKS 3)** even when nothing blocks it. If ground turns now feel slow next to instant air turns, try TURN_TICKS 2.
- **The camera swings with an air turn over 150 ms plus its damping.** It reads well, but a rapid double tap (180°) swings the camera fast. Watch for motion discomfort.

## Open questions
- **Bots don't use air turns** (their BFS only plans ground turns). They could save a turn step by pressing it mid-jump. That's a cheap bot improvement if seek bots should get harder.
- **PvP (§14).** A hopping player turning mid-air is still non-Idle, so it can't be pushed. Settle this with the held-hop immunity question in the PvP phase.
- **Round length.** Rounds now take 16–23 s for bots; the race-01 time-limit suggestion (90 s) from the 05 report still stands.
