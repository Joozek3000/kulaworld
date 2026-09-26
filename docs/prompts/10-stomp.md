# Phase 10: Jump over + stomp

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§5 jump rules, §14 push/stagger, §16 new: this phase's spec, §17 prediction), `docs/DECISIONS.md`, `docs/reports/09-report.md`.

## Goal
Two new moves from Jakub's playtest:
- A forward jump can clear an enemy.
- Landing on an enemy bumps them one tile in your jump direction and you take their tile.

## Tasks
1. **Sim (shared)**, per §16:
   - A player on A1 no longer blocks a forward jump.
   - Stomp targeting at jump start, and reserving C, L and B.
   - Landing resolution: stomp, clash (with the new `Action.Rebound`, appended), escaped, or empty.
   - Fall-landing stomp (deterministic direction order).
   - Stagger after a stomp.
   - Events `stomp` and `clash`, and knockout credit.
   - `isPushable` and stomp eligibility share one helper.
   - Constants: `REBOUND_TICKS = 6`.
   - Everything runs with `rules.push` on. With push off, keep jump-over but no stomps: landing on a player falls back to the old short-jump logic. Log the choice.
2. **`previewAction` / BFS**
   - `jump` over a player is allowed.
   - BFS still ignores players, as now.
   - Add a pure helper `stompPreview(world, pose)` returning `{ victimId, bumpCell, lethal }` for bots.
3. **Tests (shared)**, each in a tiny world:
   - jump over a player on A1 → lands on A2, the A1 player is unaffected
   - A1 solid → still hops
   - stomp onto ground → victim Knocked to L+F then staggered; attacker in L
   - stomp with no ground at B → victim falls; off the map → death, key drop and knockout credit (race + push)
   - B blocked at jump start → short jump or hop fallback (no stomp)
   - B stays reserved during the jump (a third player can't roll into B)
   - victim rolls away mid-jump → escaped, normal landing
   - victim hopping high at landing → clash: attacker rebounds to C, no stun, victim unaffected
   - victim hopping low at landing → stomped
   - a hop never stomps
   - fall onto a grounded player → stomped in faller fwd; blocked → next direction in order
   - staggered victim can't be pushed or stomped until the stagger ends
   - determinism with stomps (4 players, random inputs incl. jumps, 2000 ticks)
   - push-off rules variant per the logged choice
   - the whole previous suite passes
4. **Server/schema**: the new action value, broadcast `stomp`/`clash` and log them.
5. **Client**
   - **Landing marker:** a ring on L during forward jumps in the attacker's colour, red if L holds a player. Everyone sees it.
   - **Stomp feel (uses the phase 08 systems):** the victim squashes flat (0.5) under the attacker, then shoots out stretched along F. A heavy sound: `stomp` = a low rubber thump + boing, with the victim louder. Hit-stop as for push.
   - **Clash:** both squash, the attacker arcs back to C, and a `boing`.
   - **Rebound pose** in `poseAt` (reverse arc), with tests.
   - Toast: "A stomped B!". Knockouts via stomp use the existing knockout toast.
6. **Prediction (§17):** don't predict jumps with a player on A1 or L. Add a test.
7. **Bots**
   - bully: when `stompPreview` says lethal (or would bump the target off a ledge within 2 moves), prefer the stomp.
   - seek: jump over a player blocking a 1-wide beam instead of waiting.
   - All bots hold jump (defensive hop) when an enemy's landing marker is on their tile: pass the jump target in the schema, or derive it from the enemy's jump `to.cell`.
8. Update DECISIONS.md, and note in the report where ARCHITECTURE §16 was ambiguous.

## Acceptance checklist
- [ ] All tests pass. Typecheck is clean.
- [ ] Browser, 2 windows on arena-01:
  - jump over the other ball on a beam
  - stomp it off the edge (it dies), and stomp it on the plate (it's bumped one tile and can't be pushed right away)
  - holding Space at the right moment → clash, and the attacker bounces back
- [ ] The landing marker is readable from both the attacker's and the victim's camera, including when the victim is on the underside of the plate (the marker faces the right way)
- [ ] 10 unattended knockout rounds with `seek,bully,bully,wander` on `arena-01,arena-02`: no errors or STUCK. Report pushes vs stomps vs clashes per round.

## Report: `docs/reports/10-report.md`
- Resolution order as implemented, and edge cases found
- Stats: pushes/stomps/clashes/knockouts per round
- Screenshots: a landing marker (normal + red), a victim squashed mid-stomp, a clash
- Feel notes: is stomp too strong vs push? Suggested constants (not applied)

Then commit: `phase 10: jump-over + stomp`.
