# Phase 12c: Edge push + tile heat + 12b follow-ups

**Before starting:** the working tree has an uncommitted art integration pass (`assets/`, `packages/client/public/models|sky`, `render/art.ts`, `docs/ART-SOUND.md`, `docs/reports/art-integration-report.md`, plus edits in render/ files and DECISIONS.md). Don't mix it into this phase.
- If `npm test` and `npm run build` pass with it, commit it first as `art: ceramic kit + lavender sky` (check the `.gitattributes` binary rules cover `.glb` and `.blend`; add them if not).
- Otherwise stop and tell Jakub.

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` §14 (new **Edge push**, Cradle push), §5 (Flip, Climb), `docs/reports/12b-report.md`.

## Why
Jakub: a player hiding on a different face of the same block, right past the edge, can't be pushed. That makes "just over the edge" a safe spot. Pushes around edges are what only this game can do, so allow them.

## Task 1: Edge push (per §14)
- **Sim:** in intent/push resolution, a `fwd` intent whose plan is a Flip, and whose target cell T holds a player with `up === F`, becomes an edge-push intent.
  - Same stages as pushes: escape precedence, mutual (two players flipping into each other's cells around the same edge → both bounce), fair order.
  - Success/fail/blocked exactly per §14.
  - Cradle doesn't apply to edge pushes (single victim only).
- **Prediction:** it involves players, so it's deferred.
- **Tests:**
  - top→side push knocks the victim down the side face; the flipper lands in T
  - side→top push knocks the victim across the top, away from the edge
  - the victim at the bottom of a 1-high side face is knocked off → falls along its own gravity → death and knockout credit
  - blocked `T + D` → flipper bounces
  - victim staggered → flip blocked, no stun
  - a victim on the opposite face (underside) is unaffected
  - mutual edge push → both bounce
  - escape precedence
  - determinism
- **Client:**
  - Edge-proximity glow: a thin line on the shared edge in the enemy's colour, fading in when an enemy stands on the adjacent face within 1 cell of the edge (and on the same block edge as you). Local player only.
  - The push feel reuses the push FX.
- **Bots:**
  - bully uses edge pushes (it gets them automatically through intents; check the BFS or target choice doesn't avoid them)
  - all bots treat "enemy on the adjacent face at my edge" as a threat, the same as an adjacent enemy

## Task 2: Tile heat instead of player heat (12b open question 2)
- Heat belongs to the **tile** (cell + up), not to the player. A tile heats while a player sits on it (same rates as now, hopping half) and **cools** at 1 per 2 ticks while empty.
- Warn and burn thresholds are unchanged, applied to the tile under the player. So stepping off at the warning and coming straight back resumes near the old heat.
- Sync only tiles with heat > 0 (a small map), and render as now.
- Tests:
  - step off and back within 1 s → burns sooner than a fresh tile
  - an empty tile cools to 0
  - two players alternating on one tile share its heat
  - determinism

## Task 3: 12b follow-ups
- **Cradle clacks (open question 1):** keep the sim hold at 2 ticks. Compress the render-side clack spacing so the whole sequence finishes within the hold for any line length (spacing = hold / (n − 1)).
- **Blocker strictness (open question 3):** on its way to its post the blocker waits instead of pushing. It pushes only when it's at its post and someone is adjacent in front.

## Acceptance checklist
- [ ] Art commit done first (or reported as blocked). All tests pass. Typecheck and build are clean.
- [ ] Browser on arena-02 or test-stomp:
  - roll over an edge onto a ball on the side face → it's knocked down the face or off
  - from the side face, flip up onto a ball on top → it's knocked inwards
  - the edge glow shows when an enemy is just around your edge
- [ ] Soak: 12 rounds `race-01,arena-01,arena-02` with `seek,bully,blocker,wander`. Report edge pushes, stalemate seconds and burns per round, vs 12b.

## Report: `docs/reports/12c-report.md`
Then commit: `phase 12c: edge push + tile heat`.
