# Phase 18b: Remove x-ray (no seeing through walls)

Read first: `CLAUDE.md` (commit **and push**), `docs/reports/17-report.md` (x-ray), `docs/reports/18-report.md`.
Start only after `phase 18: matches` is committed.

## Decision (Jakub)
Seeing other balls, items and the crown through blocks gives away hidden positions and removes the surprise of meeting someone around an edge. Reverse the phase 17 x-ray.

## Tasks
1. **Remove x-ray silhouettes** from:
   - other players' balls
   - keys, the exit, gems/coins/fruit and pills
   - the crown
2. **Keep one silhouette: your own ball.** It stays so you don't lose yourself when the camera is behind a block (free look, climbs, fly-over end). It's only visible to you.
   - In single player that means the only silhouette is your ball.
   - If the own-ball silhouette needs a separate path from `addXray`, keep `xray.ts` but shrink it to that one use.
3. **Keep the off-screen arrows** as they are (enemies within 8 cells, multiplayer only). They point at players outside the view, not behind walls.
4. **Docs:**
   - ARCHITECTURE §23 Crown: drop "and drawn through walls with the x-ray pass" and replace it with "visible when in line of sight; the off-screen arrow shows a crown icon".
   - Add a DECISIONS.md entry: x-ray reverted, own ball only, and why.
   - The README phase table is already updated. Include it in the commit.
5. **Tests:**
   - Update `art.test.ts` and any other test that counts or skips x-ray children.
   - Add a render test: an enemy ball, a key and the crown have no x-ray child, and the local ball has one.

## Acceptance
- [ ] Multiplayer on arena-02 with bots: pitch the camera under the floor. You see no enemy balls or crown through the blocks, and your own ball shows as a silhouette when hidden.
- [ ] race-01: keys and the exit are hidden behind blocks.
- [ ] sp-01 fly-over: the underside coins are no longer visible through the plank.
- [ ] typecheck, test and level:check pass.

## Report: `docs/reports/18b-report.md`
Short: what was removed, and screenshots of the three checks above.

Commit: `phase 18b: remove x-ray`, then push.
