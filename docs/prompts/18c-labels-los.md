# Phase 18c: Name labels only in line of sight

Read first: `CLAUDE.md` (commit **and push**), `docs/ARCHITECTURE.md` §23 (line of sight rule), `docs/reports/18b-report.md` (open question).

## Why
18b removed the silhouettes, but CSS2D name labels aren't depth-tested. A hidden enemy's name, and now the crowned player's 👑, still floats through the blocks and gives away the position. Jakub's rule: nothing about another player shows through walls.

## Tasks
1. **Occlusion test (client, render only):**
   - A grid ray from the camera to the ball against the level's solid cells. Use a 3D DDA over the block grid, not a Three.js raycast against meshes.
   - Test a few points: the ball centre, plus top and bottom (±0.4 up). The ball counts as visible if any point is clear.
   - Moving blocks and vanishing/invisible blocks: use their current rendered state. Invisible blocks do not occlude when they're invisible.
   - Run it at ~10 Hz per remote player (staggered across frames), not every frame. No per-frame allocations.
2. **Labels:**
   - Fade a remote player's name label out when its ball is occluded and back in when it's visible (~150 ms).
   - This includes the 👑 prefix, and applies during free look and the fly-over.
   - Spectators follow the same rule.
3. **Unchanged:**
   - the scoreboard (the 👑 line stays there)
   - the off-screen arrows (they cover players outside the view, not behind blocks)
   - the podium labels
   - the local player has no label
4. **Crown model:** it's part of the ball's group, so it's already depth-tested. Check that it doesn't poke above a block edge while the ball is hidden. If it does, hide the crown with the label.
5. **Tests:**
   - DDA unit tests: a clear line; a block between; a ray grazing an edge; the camera inside a block (counts as occluded, no crash).
   - Label visibility test: an occluded ball's label hides, and a visible ball's label shows.
6. **Docs:**
   - Add a DECISIONS.md entry.
   - The README phase table is already updated. Include it in the commit.

## Acceptance
- [ ] race-01 with bots: a bot under the plank shows no label, and the label comes back when it rolls into view. Repeat the 18b shot.
- [ ] arena-02 with the camera under the floor: no labels for balls on top.
- [ ] The crowned bot behind a block: no 👑 label, and no crown visible.
- [ ] Free look sweep: labels fade in and out cleanly, with no flicker at block edges.
- [ ] 8 players on the busiest pool level: FPS within 5 % of before (report both numbers).
- [ ] typecheck, test and level:check pass.

## Report: `docs/reports/18c-report.md`
Short: what changed, before/after screenshots of the three scenes, and the FPS numbers.

Commit: `phase 18c: labels in line of sight`, then push.
