# Phase 05b: Instant mid-air turning + bot fairness

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§5 Jump selection → "Mid-air turning", §6), `docs/DECISIONS.md`, `docs/reports/05-report.md`.

## Why
Jakub's playtest: while bouncing, pressing left/right only turns after landing. In Kula World the ball turns the moment the button is pressed, even mid-bounce.

## Tasks
1. **Sim (shared)**
   - In the input-apply part of `step` (§7 step 1): if a player is airborne (Hop, Jump, Fall) and has a buffered **turn** pulse, apply it now and consume the pulse: `p.to.fwd = turnFwd(p.to.up, p.to.fwd, dir)`.
   - Record `turnFromFwd` (the fwd before this turn) and `turnStartTick` (the current tick) on the player for rendering.
   - `to.cell`, `to.up`, `endTick` and reservations don't change. A 2nd press during the same airborne action turns again from the new fwd, and the record updates.
   - Jump pulses during airborne actions keep the phase 05 behaviour (buffered until landing). Grounded turns are unchanged: they stay a TURN_TICKS action.
   - After landing, chaining uses the new fwd: a held jump+fwd jumps in the new direction, and a held fwd rolls that way.
2. **Schema/sync**: add `turnFromFwd: uint8` and `turnStartTick: int32` to `PlayerS`. On every new action start, reset them to `turnFromFwd = to.fwd` and `turnStartTick = startTick` so the stale value never animates.
3. **Pose/client**
   - During Hop/Jump/Fall, the rendered facing is `slerp(frame(up, turnFromFwd), frame(up, to.fwd), clamp((renderTick − turnStartTick) / TURN_TICKS))`. So an air turn visibly spins over 150 ms, starting at the press.
   - The camera follows the rendered facing, so it swings with the turn.
   - A forward jump's position path still uses `from.fwd` (the trajectory is unchanged).
   - Add pose tests for mid-air facing at progress 0, 0.5 and 1 of the turn.
4. **Tests (shared)**
   - hopping + turn pulse → fwd changes on the same tick, the hop's endTick is unchanged, no Turn action
   - two presses in one hop → 180°
   - forward jump + turn mid-air → lands on the original `to.cell` facing the new direction; with jump+fwd held, the next jump goes the new way
   - turn during Fall → applied immediately
   - grounded turn still takes TURN_TICKS
   - turn during Roll/Flip still buffers until the action ends (unchanged)
   - determinism passes
   - BFS/bot tests pass unchanged
5. **Bot fairness** (from the 05 report): shuffle the spawn assignment each round with the world's seeded RNG in `createWorld`/`addPlayer`, so seek bots don't always get the same spawn. Keep it deterministic per seed. Update any tests that assumed join order = spawn order.
6. Update DECISIONS.md.

## Acceptance checklist
- [ ] Tests pass. Typecheck is clean.
- [ ] Browser: hold Space and tap A → the ball spins left mid-bounce straight away, and keeps bouncing facing the new way. Tap D twice mid-bounce → faces back. Space+W chain, then tap A mid-jump → lands where planned and the next jump goes left.
- [ ] LATENCY_MS=150: the air turn is delayed only by the network, with no snaps.
- [ ] A 10-round run with 3 seek bots + 1 wander bot: no STUCK, no errors, and the wins spread across at least 2 seek bots.

## Report: `docs/reports/05b-report.md`
- Win distribution before and after the spawn shuffle
- Anything that still feels unlike Kula World
- Open questions

Then commit everything: `phase 05b: air turns + spawn shuffle`.
