# Phase 18b: Remove x-ray + phase 18 follow-ups

Read first: `CLAUDE.md` (commit **and push**), `docs/ARCHITECTURE.md` §23 (updated for this phase), `docs/reports/17-report.md` (x-ray), `docs/reports/18-report.md`.

## Task 1: Remove x-ray (Jakub's decision)
Seeing other balls, items and the crown through blocks gives away hidden positions and removes the surprise of meeting someone around an edge. Reverse the phase 17 x-ray.
1. **Remove the silhouettes** from:
   - other players' balls
   - keys, the exit, gems/coins/fruit and pills
   - the crown
2. **Keep one silhouette: your own ball.** It stays so you don't lose yourself when the camera is behind a block (free look, climbs, the fly-over end). It's only visible to you. In single player that means the only silhouette is your ball. If `xray.ts` only has that one use left, shrink it to that.
3. **Keep the off-screen arrows** as they are (enemies within 8 cells, multiplayer only).
4. **Tests:**
   - Update `art.test.ts` and any other test that counts or skips x-ray children.
   - Add a render test: an enemy ball, a key and the crown have no x-ray child, and the local ball has one.

## Task 2: Match follow-ups (answers to the 18 report's open questions; §23 is already updated)
1. **Knockout KO cap +3 → +2**, the same as race. The crowned-KO +1 stays outside the cap. Update the scoring tests.
2. **Match tie-break:** round wins, then knockouts, then keys. If still tied, they share the place:
   - the same place number on the stats card
   - both balls side by side on that podium step (widen the step)
   - a title like "seek-1 and bully-2 share the match!"
   - Add tests for each tie-break level and a full tie.
   - The crown during the match stays as it is: a tie → nobody.
3. **Rematch:** it passes with at least half of the connected players, so 1–1 → rematch. Update the room test.
4. **Pad length vote:** LB/RB cycle the match-length vote in the lobby before round 1. Add a hint on the length cards ("LB/RB").
5. **Crown readability:** without x-ray, the crown must read in line of sight.
   - Prefix the crowned player's name label with 👑.
   - Check the crown is readable at 8 cells in a screenshot; if not, scale it up again.
6. **3D name labels draw over HUD panels:** in `18-points-pop.jpg`, the "seek-1" label sits on top of the results panel. Hide the world name labels while the results/matchEnd panels are up, or put the HUD panels above the CSS2D layer.
7. **Podium title contrast:** the winner-coloured title is hard to read on the teal sky. Add a dark outline or backdrop.

## Docs
- Add a DECISIONS.md entry for each item above (x-ray reverted with own ball only; KO cap; tie-break; rematch ≥ half; pad vote; crown label).
- The README phase table is already updated. Include it in the commit.

## Acceptance
- [ ] Multiplayer on arena-02 with bots: pitch the camera under the floor. You see no enemy balls or crown through the blocks, and your own ball shows as a silhouette when hidden.
- [ ] race-01: keys and the exit are hidden behind blocks.
- [ ] sp-01 fly-over: the underside coins are no longer visible through the plank.
- [ ] The crowned player's label shows 👑; the crown is readable at 8 cells.
- [ ] No name labels over the results panel or the stats card.
- [ ] A forced tied match shows a shared 1st on the podium and the stats card. In a 2-player match, a 1–1 rematch vote starts a rematch.
- [ ] Pad: LB/RB changes the length vote.
- [ ] Soak: 1 full 5-round match with `seek,bully,rival,wander`, 0 STUCK. Report the board and whether knockout rounds still dominate.
- [ ] typecheck, test and level:check pass.

## Report: `docs/reports/18b-report.md`
Short: what changed, screenshots of each check above, and the soak board.

Commit: `phase 18b: remove x-ray, match follow-ups`, then push.
