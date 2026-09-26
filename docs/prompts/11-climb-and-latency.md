# Phase 11: Wall climb (Kula gravity) + input latency audit

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§5 Forward: new step 1 "Climb", §6, §17 prediction), `docs/DECISIONS.md`, `docs/reports/09-report.md`, `docs/reports/10b-report.md`.

## Why (Jakub's playtest after 10b)
1. **Gravity isn't Kula-like.** Rolling into a vertical wall should make the wall the new floor. Ours just stops.
2. **"Lag on every key press"**, even solo. Phase 09 measured ~30 ms in headless Chrome at 22 fps, but on Jakub's machine it feels laggy. Measure what he actually experiences and fix it.

## Part A: Climb (concave transition)
1. **Sim:**
   - In `previewAction('fwd')`, `solid(A)` → `Action.Climb` (appended), `to = { cell: C, up: opposite(F), fwd: U }`, `CLIMB_TICKS = 5` (same as a roll; tunable).
   - Reservations: own cell only.
   - Held W chains into a roll up the wall.
   - A climb doesn't collect anything (same cell).
   - Pushes: a climbing player is not pushable (it's moving).
   - Everything else is unchanged: a jump with A1 solid → hop; push/knock/stomp bump into a solid cell → bounce or fallback.
2. **Pose:**
   - Climb: the ball rotates 90° about the axis `cross(U, F)` (sign so that up goes U → −F) while staying in cell C.
   - The contact offset (−up·0.1) interpolates with up, so the ball visibly rolls into the corner.
   - The camera follows up as in flips (a 90° pitch up).
   - Add tests: start, mid and end for all 24 frames.
3. **BFS/bots:** they get climbs automatically through `previewAction`. Update any path/optimality/reachability tests whose expectations change, and list them.
4. **Audio/feel:** replace the old wall `bump` sound with a rubber squeak on climb, plus a small squash into the corner.
5. **Tests:**
   - roll into a 1-high wall → climb → W → roll up → flip onto the top → W → flip down the far side
   - climb into a 2-high wall, then up
   - climb under a ceiling (concave corner above)
   - climb then turn left/right on the wall
   - jump into a wall still hops
   - push into a wall still bounces
   - determinism
   - prediction: a climb is predicted locally with 0 mispredictions
6. **Levels:** re-run level checks. Note in the report where climbing now opens shortcuts in race-01 / arena-01 / arena-02 (probably fine, but Jakub should know).

## Part B: Latency audit (measure first, then fix)
1. **Measure in a real headed browser at 60 fps** (not headless 22 fps), on Jakub's normal setup: `npm run dev`, LATENCY_MS=0, arena-01, alone and with 3 bots. For W from rest, A/D from rest, Space from rest, and W+Space, record the timeline in ms from the `keydown` event to:
   - (a) the input being sent
   - (b) the tick it's stamped for
   - (c) the predicted action starting
   - (d) the first *visible* ball change (position or rotation > 0.01)

   Use `performance.now()`, and log to F3 plus a copyable table.
2. **Check each suspect and report which ones apply:**
   - **Prediction not active:** is prediction actually running in Jakub's normal flow (default URL, after respawn, after round restart, near bots)? Show the F3 `predicting` flag, and count how often actions are *deferred* to the server.
   - **Tick quantisation:** a press waits up to 50 ms for the next tick.
   - **Stamping too far ahead:** `lead` makes an input apply several ticks in the future while the local timeline renders at predTick. Check that the local ball starts moving at the press, not `lead` ticks later.
   - **Visual start delay:** the takeoff anticipation squash (08), easing curves that start slowly (ease-in on roll, so the first 50 ms barely moves), and the hit-stop.
   - **Action commitment:** a turn blocks for TURN_TICKS before the next roll, and pulses wait for the current action to end.
   - **Keyboard handling:** listeners on the canvas vs the window, key repeat, and focus.
3. **Fix what applies.** Expected fixes; apply the ones the measurements justify:
   - **Sub-tick start:** when the predictor starts a local action on key press, render it from the press time, offsetting the local timeline by the fraction of the tick, instead of waiting for the tick boundary. The sim stays tick-based; this is render-only for the local ball, blended away within the action.
   - **Front-load motion:** roll/flip/climb easing starts fast (ease-out, not ease-in-out), so movement is visible on the first frame.
   - **No anticipation squash for the local ball's takeoff:** keep it for remote balls.
   - **Prediction coverage:** predict everything except true interactions. Deferral near other players should only happen when the target cell or bump cell actually involves a player, not "within 2 cells". Fix any pause state that doesn't resume.
   - **Faster actions if still needed:** propose (don't apply) TURN_TICKS 3→2 and ROLL_TICKS 5→4 with the measured effect, for Jakub to decide.
4. **Add a "feel check" section to the report,** with steps for Jakub to compare `?predict=0` and default side by side, plus what the F3 numbers should read.

## Acceptance checklist
- [ ] All tests pass. Typecheck is clean.
- [ ] Browser: roll into walls on test-flat and race-01. The ball climbs and the camera pitches smoothly; go up and over a 1-high wall.
- [ ] Latency table before/after (60 fps, headed). Target: visible motion within **one frame (~17 ms) of keydown** for W/A/D/Space from rest, solo, predict on.
- [ ] With 3 bots, deferred actions happen only when a player is directly involved
- [ ] A 10-round bot soak with no errors or STUCK

## Report: `docs/reports/11-report.md`
- The latency breakdown table (before/after) with which suspects were real
- Climb screenshots (mid-climb and on the wall)
- Changed tests list
- Proposed timing changes (not applied)

Then commit: `phase 11: climb + latency`.
