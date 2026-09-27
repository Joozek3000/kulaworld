# Phase 14d: Moving collisions (head-on bounce, side hits)

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` §20 (new: this phase's spec), §14 (push, stagger, cradle, roll-under), §18 (ice, knock-slide, boost), `docs/DECISIONS.md`, `docs/reports/14c-report.md`.

**Before starting:** there are untracked art assets from another agent (`assets/art/sky-pack-v02/`, `assets/models/environment-kit-v02/`, the `docs/ART-SOUND.md` edit) and `assets/audio/temporary-bounce/decoded-source.wav`.
- Don't include them in this phase's commit.
- If `decoded-source.wav` is a generated intermediate, add it to `.gitignore`.
- Leave the art assets for Jakub to commit with their own integration.

## Why
Jakub, playing Ice Rink: players on ice never push each other, because pushes only hit *standing* balls, and on ice everyone is sliding. Wanted:
- face to face → both bounce back
- hit from the side → the side-hit ball gets pushed

## Task 1: Sim (per §20)
- Define movers and the motion direction `dM` for Roll, Flip (the arrival direction), Climb, slides, Knocked and boost ground travel. Jumps and hops aren't movers (air).
- In intent resolution, when a mover's target X involves another mover, classify it as head-on / side / simultaneous / dodge / rear-end and apply the §20 table.
- Cancelling V's in-progress move: V's pose is still its from-cell while acting. For a side hit, V is knocked from X, so treat V as arriving at X, then knock it. For a head-on, V is knocked back to its from-cell's opposite neighbour. Keep reservations consistent: release the cancelled `to` cells the same tick.
- Forced slides on ice are movers every tick of the chain. A head-on knock-back that lands on ice slides back.
- Events: `push {pusherId, victimId, moving}` and `bounce`. Knockout credit as for pushes.
- Rules flag: applies with push rules on. With push off, the MVP blocking stays.

## Task 2: Tests (one tiny world each)
- On plain floor:
  - head-on roll vs roll, both mid-move → both knocked back 1 cell and bounce-stunned
  - head-on simultaneous start into the same cell → both bounce
  - a side hit on a roller already moving into X → it's knocked along M's direction, and M enters X
  - side hit with `X + dM` blocked → M bounces
  - simultaneous T-bone → both bounce
  - dodge (V leaving X sideways as M starts) → no collision, M waits
  - rear-end → no collision
  - a standing ball → the old push tests pass unchanged
- On ice:
  - two sliders head-on → both slide back to the rims
  - a slider hits a crossing slider from the side → the side slider is knocked and continues sliding along `dM`
  - a slider hits a standing ball → push + knock-slide (existing)
- Knocked balls as movers: a knocked ball head-on into a roller → both bounce
- Stagger: a ball knocked by a side hit can't be hit again until it recovers
- Edge cases: a side hit that knocks a ball off an edge → fall, credit; head-on at a boost pad arrival
- Determinism (4 players on arena-03, random inputs, 2000 ticks)
- All older suites pass (list any changed expectations)

## Task 3: 14c follow-ups (decisions)
1. **race-06 edge pads:** move them one tile in from the island edges, so the only way onto a pad is heading for its gap. Keep `level:check` clean and the reachability tests green.
2. **Charge vs spawn protection:** keep it as is. Protection is full, and the hold/release behaviour is fine.

## Task 4: Client
- **Head-on:** both balls squash hard along the contact axis at the meeting point, which is rendered at the midpoint where their render positions touch, not at the cell edge. Then the recoil. Use the `hit` sound, a bit louder.
- **Side hit:** the push FX and hit-stop as for pushes. The knocked ball stretches along `dM`.
- Check at LATENCY_MS 150 that the collision renders where the balls visually touch (adjust the knock hold as in phase 06 if needed).

## Task 5: Bots
- Bully: prefer side hits on moving targets (predict the target's next cell from its current action).
- All bots: avoid a head-on into a faster-arriving mover when it would bounce them off an edge.

## Acceptance checklist
- [ ] All tests pass. Typecheck, build and `level:check` are clean.
- [ ] Browser, 2 windows on arena-03 (Ice Rink): two players sliding at each other bounce apart; a side hit on a sliding player knocks it sideways; a slider still pushes a standing player
- [ ] Also on plain floor (arena-01): a head-on roll bounce, and a side hit on a roller
- [ ] Soak: 12 pool rounds with `seek,bully,blocker,wander`, no errors or STUCK. Report head-on and side-hit counts per level, and knockouts by cause.

## Report: `docs/reports/14d-report.md`
Then commit: `phase 14d: moving collisions`.
