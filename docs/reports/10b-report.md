# Phase 10b report: Stomp polish

## Summary
All five architect decisions from the 10 report are applied:

1. **Clash rule:** unchanged. A staggered or spawn-protected victim still makes the attacker rebound.
2. **Landing marker:** still shown for the whole jump by default. Its window is the new F4 tuning value `markerLeadTicks` (0 = the whole jump, N = only the last N ticks). It's persisted with the other tuning values.
3. **Human-like bots:** a `--skill 0..1` flag (default 0.5).
   - At 0.5: 150–300 ms before reacting (the defensive hop, and seek's jump over a blocker) and a 25 % chance of missing the hop.
   - Skill 1 is the phase 10 bots (instant, never miss); skill 0 doubles both.
   - A bot that hasn't reacted yet, or has missed, carries on with its normal behaviour.
4. **Jump grace** (shared sim, §6): a jump pulse within `JUMP_GRACE_TICKS` = 2 ticks of a Roll that started **from rest** cancels the roll into a standing forward jump from the origin cell. It follows the normal jump/stomp rules and starts on the current tick. Rolls chained from a previous action never cancel.
   - The predictor applies the same rule, and its deferral check knows about it, so a grace jump toward a player is deferred like any other.
   - The client blends the few rendered roll frames back into the jump.
   - Inputs are now stamped with the predicted tick extrapolated to the key press, not the last frame's value. At low frame rates, two presses 60–90 ms apart could otherwise land 3 ticks apart.
5. **`test-stomp` stays as a practice level** (not in any rotation), and `.env.example` now documents `LEVEL=test-stomp`.

Also:
- **`.env.example`** is back to the template values (`MIN_PLAYERS=2`, `LEVEL=race-01,test-cube`). Jakub's values (`MIN_PLAYERS=4`, `LEVEL=race-01,arena-01,arena-02`) and `LEVEL=test-stomp` are comments. `.env` is git-ignored and untracked.
- **`AGENTS.md`** is untouched.
- **Checks.** `npm run typecheck` is clean, and `npm test` passes: 386 tests, up from 379.
  - `grace.test.ts`: 5 grace cases plus determinism over 2000 ticks with grace jumps.
  - `predict.test.ts`: W then Space a tick later is predicted exactly (0 mispredictions over 6 combos).
- **Docs:** ARCHITECTURE §6 describes the jump grace, and §16 mentions `markerLeadTicks`. DECISIONS has 4 new entries.

## Browser checks
These ran in two headless windows on `test-stomp`, with prediction on. The script used separate real key events, like a human pressing both keys.

**The server's view of the attacker, per case:**

| Case | Server sequence | Result |
|---|---|---|
| W then Space, 0 ms apart | `Jump 1→3` | a standing jump |
| 30 ms apart | `Jump 1→3` | a standing jump |
| 60 ms apart | `Roll 1→2 (t206)`, then `Jump 1→3 (t207)` | **grace**: the roll is cancelled a tick later, and the jump starts from the origin |
| 90 ms apart | `Roll 1→2`, then `Jump 2→4` at the end of the tile | outside the window |
| 120 ms apart | `Roll 1→2`, then `Jump 2→4` at the end of the tile | outside the window |
| Ball 2 tiles ahead, 40 ms apart | `Jump 2→4`, event `stomp` | a stomp |
| Ball 2 tiles ahead, 80 ms apart | `Roll 2→3`, then `Jump 2→4`, event `stomp` | a grace stomp |
| W held (a run), Space tapped mid-roll | `Roll 0→1`, `Roll 1→2`, then `Jump 2→4` | the jump comes at the end of the tile, as in Kula World |

The 90 and 120 ms rows have longer real gaps than those numbers: each CDP key call adds a round trip, so they're really ~130–170 ms, beyond the 2-tick (100 ms) window. That's as specified. If humans' "together" presses turn out slower, `JUMP_GRACE_TICKS` 3 is the knob.

**Prediction at 150 ms, solo** (arena-01): 90 s of spam, with 58 W+Space combos 0–80 ms apart, turns, and runs with mid-run Space. The result was **0 mispredictions** and 0 late inputs. The ping was ~158 ms and the lead 6.

## Soak: `arena-01,arena-02`, `seek,bully,bully,wander`, default skill 0.5
The soak ran 840 s unattended. **15 rounds, 0 STUCK, 0 server errors,** all won by last alive.

| # | Level | Duration | Winner | Pushes | Stomps | Clashes | Knockouts | Deaths |
|---|---|---|---|---|---|---|---|---|
| 1 | arena-01 | 53.0 s | bully-3 | 30 | 2 | 7 | 8 | 11 |
| 2 | arena-02 | 37.5 s | bully-2 | 19 | 3 | 1 | 7 | 9 |
| 3 | arena-01 | 44.0 s | bully-2 | 33 | 1 | 3 | 7 | 10 |
| 4 | arena-02 | 86.6 s | bully-2 | 58 | 1 | 1 | 7 | 10 |
| 5 | arena-01 | 25.4 s | bully-3 | 13 | 1 | 1 | 6 | 10 |
| 6 | arena-02 | 55.0 s | bully-2 | 21 | 2 | 0 | 7 | 9 |
| 7 | arena-01 | 37.6 s | bully-2 | 20 | 2 | 0 | 8 | 11 |
| 8 | arena-02 | 47.2 s | bully-2 | 29 | 2 | 0 | 8 | 11 |
| 9 | arena-01 | 39.2 s | bully-2 | 17 | 1 | 2 | 8 | 11 |
| 10 | arena-02 | 31.3 s | bully-3 | 25 | 1 | 2 | 8 | 10 |
| 11 | arena-01 | 38.3 s | bully-3 | 35 | 1 | 2 | 8 | 11 |
| 12 | arena-02 | 30.1 s | bully-2 | 18 | 4 | 3 | 6 | 9 |
| 13 | arena-01 | 62.7 s | bully-3 | 47 | 0 | 0 | 8 | 11 |
| 14 | arena-02 | 67.5 s | bully-3 | 18 | 1 | 3 | 9 | 11 |
| 15 | arena-01 | 31.4 s | bully-2 | 26 | 1 | 2 | 5 | 9 |
| **total** | | | | **409** | **23** | **27** | **110** | |

**Compared with the 10 report** (skill 1, the perfect bots):

| | Phase 10 (skill 1), 11 rounds | Phase 10b (skill 0.5), 15 rounds |
|---|---|---|
| Stomps per round | 0.55 (6 total) | **1.53** (23 total) |
| Clashes per round | 2.36 (26) | 1.80 (27) |
| Stomps : clashes | 6 : 26 | **23 : 27** |
| Pushes per round | 28.0 | 27.3 |
| Knockouts per round | 7.5 | 7.3 |

- **Stomp attempts now land about half the time instead of about a fifth,** which is what a human-speed dodge should give. The bots missed 32 of their 107 dodge chances (the `missedDodges` stat), and the rest reacted late.
- **Pushes are still the main weapon** (~27 per round, against ~1.5 stomps). Only bullies stomp, and only when it's lethal or sets up a ledge.

| Bot | Stomps made | Stomped | Clashes its hop caused | Dodges (reacted) | Missed dodges |
|---|---|---|---|---|---|
| seek-1 | 0 | 14 | 17 | 23 | 11 |
| bully-2 | 11 | 2 | 3 | 19 | 12 |
| bully-3 | 12 | 4 | 7 | 27 | 6 |
| wander-4 | 0 | 3 | 1 | 6 | 3 |

## Deviations
- **Grace target-cell release.** "Release the cancelled roll's target cell in the same tick" needed no code: reservations are rebuilt from the players every tick, and the cancelled player is back to Idle at its origin before intents resolve. No test can observe it separately, since the grace jump re-reserves A1 itself.
- **Input stamps are extrapolated to the key press** (see Summary item 4). This is a small client change, prompted by the grace window's sensitivity to tick quantisation.

## Open questions
1. **Grace window:** 2 ticks (100 ms) catches presses up to ~60–90 ms apart in practice. Raise it to 3 if human "W+Space together" presses miss?
2. **Bot stomp share:** bullies now land about 1.5 stomps per round. Should seek also stomp, when it's lethal, to show more stomps in race?
3. **Skill per bot:** a single `--skill` applies to all bots. Is a per-behaviour list (like `--behaviour`) wanted for mixed-skill soaks?
