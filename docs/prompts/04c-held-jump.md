# Phase 04c: Held jump + forward latch (Kula World feel)

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§5 Jump selection, §6 input + priority list, §14 held-jump note), `docs/DECISIONS.md`, `docs/reports/04b-report.md`.

## Why
Jakub's playtest of 04b:
- Holding jump should keep the ball bouncing continuously.
- Pressing forward during a bounce should make it jump forward.
- Pressing forward while in the air should give a forward jump immediately after landing.

## Tasks
1. **Input**
   - Add `jumpHeld: boolean` to `Input` (shared type, `parseInput` on the server, client and bots).
   - Space keydown sends the `jump` pulse + `jumpHeld: true`; keyup sends `jumpHeld: false`. Key repeat is still ignored.
   - Focus loss or hidden tab releases jumpHeld too.
2. **Sim**
   - Store `jumpHeld` and `fwdLatch` on PlayerState.
   - In `setInput`, a `fwdHeld` false→true edge while `action === Hop` sets `fwdLatch = true`.
   - Rewrite `commands()` to the §6 priority list:
     1. buffered jump pulse or fwdLatch → `['jump','hop']` if (fwdHeld || fwdLatch), else `['hop']`
     2. buffered turn
     3. jumpHeld → `['jump','hop']` if fwdHeld, else `['hop']`
     4. fwdHeld → `['fwd']`

     Clear `fwdLatch` at every decision. The pulse is spent once, as before.
   - Hops chain into hops (and forward jumps into forward jumps) on the same tick the previous action ends, with no idle tick.
3. **Tests** (shared)
   - jumpHeld, no fwd, for 3×JUMP_TICKS → exactly 3 hops back-to-back on the same cell, no idle tick
   - jumpHeld + fwdHeld → consecutive forward jumps
   - during a hop: fwd pressed then released before landing → forward jump on landing
   - during a hop: fwd pressed and held while jump is released → forward jump on landing, then rolls
   - tap: jump pulse with jumpHeld false by the next input → exactly one hop
   - jumpHeld with a turn tap mid-hop → turn on landing, then hopping resumes
   - fwd pressed during a *forward* Jump doesn't latch (it rolls on landing if still held, otherwise Idle)
   - existing jump/hop tests still pass, adjusted only where the old pulse-only semantics differ (list them in the report); determinism test passes
4. **Pose/client**: no new action, but check that chained hops render as a continuous bounce with no pause at landing. The segment history must handle a hop → hop with identical from/to cells.
5. **Blob shadow** (suggested in the 04b report): one dark semi-transparent circle under each ball, projected onto the surface along −U. It keeps its size, fades with lift, and is hidden when there's no block within 3 cells below.
6. Update DECISIONS.md.

## Acceptance checklist
- [ ] All tests pass. Typecheck is clean.
- [ ] Browser:
  - holding Space bounces continuously
  - holding Space+W chains forward jumps
  - bouncing, then tapping W mid-air → forward jump right after landing
  - a single Space tap → one hop
  - holding W and tapping Space while rolling → forward jump at the end of the tile (unchanged)
- [ ] Shadows make hop height readable from the follow cam
- [ ] A 5-minute run with 4 wander bots has no server errors

## Report: `docs/reports/04c-report.md`
- Final priority rules as implemented, and any tests changed
- Screenshot: a hop at its peak with the shadow visible
- Open questions (especially anything that still feels unlike Kula World)

Then commit everything, including the uncommitted docs/prompt edits: `phase 04c: held jump + forward latch`.
