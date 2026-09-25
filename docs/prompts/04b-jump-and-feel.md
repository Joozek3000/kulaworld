# Phase 04b: Jump like the original + feel fixes

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§5 Jump selection / Hop / Jump forward, §10 Hop + ball contact, §14), `docs/DECISIONS.md`, `docs/reports/04-report.md`.

## Why
Playtest feedback from Jakub: in Kula World, pressing jump alone bounces the ball up on the same tile. Only jump combined with forward jumps forward. Ours always jumps forward.

## Tasks
1. **Sim (shared)**
   - Add `Action.Hop`, appended as the next value. Don't renumber the existing values.
   - `Cmd` gains `'hop'`. `previewAction(..., 'hop')` returns `{ action: Hop, to: current pose, ticks: JUMP_TICKS }`, or null if `solid(C + U)`. `'jump'` keeps its meaning: jump forward. Bots' BFS will use it.
   - In `commands()` / `resolveMoves`, a buffered jump pulse becomes `'jump'` if `fwdHeld` is true on that tick, otherwise `'hop'`. If `'jump'` is blocked, try `'hop'` before falling through to held fwd. The pulse is still spent once.
   - Reservations: a hop reserves only its own cell.
   - When a hop finishes, run `onLand`, which does nothing new but keeps the path uniform.
2. **Tests**
   - jump pulse without fwd → Hop, same cell, `JUMP_TICKS`
   - jump pulse with fwd → forward jump (existing tests still pass)
   - forward jump into a wall → Hop
   - hop under a ceiling → blocked, and the pulse is spent
   - jump pressed mid-roll with W held → forward jump chains at the roll end
   - jump pressed mid-roll with W released before the roll ends → Hop
   - a player can't roll into a hopping player's cell
   - determinism test still passes
3. **Pose**: add Hop to `poseAt` (parabola along U with peak 1.0, no lateral move, no spin). Tests at 0, 0.5 and 1.
4. **Ball contact**: render the ball offset by `−U·0.1`, using the current pose `up` so it also applies through flips. The ball should visibly sit on the tiles.
5. **Latency experiment** (local player only):
   - Render the local ball at `estServerTick − 1` instead of `− 2`, and keep −2 for others.
   - Compare input→motion and look for snaps (check the debug overlay at LATENCY_MS 0 and 150).
   - Keep the change only if there are no visible snaps, and log the result in DECISIONS.md either way.
6. **Bots**: wander still holds fwd, so its jumps stay forward. Add a 10% chance of a hop (jump pulse with fwd released for that message) so hop is exercised in bot runs.
7. Update DECISIONS.md.

## Acceptance checklist
- [ ] All tests pass. Typecheck is clean.
- [ ] In the browser: Space alone bounces in place; W+Space jumps forward; Space while rolling with W held jumps forward at the end of the tile.
- [ ] The ball visibly rests on the tiles, including on the underside and side faces of test-cube.
- [ ] A 5-minute run with 4 wander bots has no server errors.

## Report: `docs/reports/04b-report.md`
- Before/after input→motion numbers from the latency experiment, and the decision
- Screenshot: a hop at its peak, and the ball resting on a side face
- Deviations, open questions

Then commit: `phase 04b: hop + feel fixes`.
