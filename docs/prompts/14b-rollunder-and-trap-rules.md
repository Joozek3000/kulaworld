# Phase 14b: Roll under a hop + trap placement rules

Run after phase 14 is committed.

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` §19 (new), §14, §16, §18; `docs/LEVEL-DESIGN.md` (new: the trap placement rules); `docs/reports/14-report.md`.

## Task 1: Roll under a high hop (§19)
- **Sim:**
  - Reservations: a high hopper's cell is "air-occupied" (not blocking rolls, flips or climbs). A low hopper is a normal pushable ball.
  - Landing resolution per §19: stomp a ball that's standing in the cell; re-hop if a ball is only passing.
  - Fold §19 into §14/§16 and delete §19 afterwards.
- **Client:** a ball passing under a hopper renders normally. The hopper's shadow sits on the roller. Add a small "whoosh-under" sound.
- **Bots:** seek/blocker may roll under hoppers on their path. The bully prefers to *stop* under a hopper only when it wants to be stomped... never. It should stop elsewhere.
- **Tests:**
  - roll under a high hopper, passing through
  - a roll into a low hopper is a push
  - stop under a hopper → stomped at landing (bump direction order)
  - a ball passing at landing → re-hop, the hopper stays in the air
  - two balls passing in sequence keep re-hopping
  - forward jump onto a high hopper → clash (unchanged)
  - a cradle line with a high hopper in it
  - determinism
  - push-off rules: roll-under also applies (it isn't PvP; it's just movement), but a stop-under stomp becomes the old MVP overlap. Log it.

## Task 2: Trap placement rules in `level:check`
- Implement every **[E]** rule in `docs/LEVEL-DESIGN.md` as an error and every **[W]** rule as a warning. Print the rule id (e.g. `3.1`) and the cell.
- Errors fail `npm test` for levels with `"pool": true`.
- Add a `notes` field and a `deathtrap` flag to the level format (validated).
- **Level fixes:** make every pool level pass all [E] rules. List every change per level and every remaining warning with a one-line justification.
- **Tests:** one tiny failing fixture per [E] rule, plus the retracting-spike passability simulation (a phase-staggered lane passes, an unstaggered one fails).

## Task 3: Phase 14 follow-ups (decisions on the 14 report's open questions)
1. **Knocked balls slide on ice.** A knock that finishes on ice continues as a forced slide in the knock direction (the knocked ball's facing becomes the knock direction for the slide), with the normal slide rules (climb at walls, flip at edges, push into balls). This is the Ice Rink's point. Update §18, and add tests: a knock onto ice slides to the rim; a knock-slide into another ball pushes it; stagger applies after the slide ends.
2. **race-05 invisible routes:** noted for 13b. Take the proposal: an invisible beam at z=5 from x=2 to x=9 as the counter-direction shortcut. Don't build it now.
3. **Boost pads get a `dir`.** They only launch when a ball enters moving in `dir`; from any other direction they're plain tiles. Add it to §18 and the level format (required for boost tiles). Set sensible dirs on every existing pad, and render the chevrons pointing along `dir`. LEVEL-DESIGN rule 6.2 is updated accordingly.
4. **Fire in BFS:** track `fireCount` in the planning state, so bots may cross up to 2 fire tiles in a row but never a 3rd. Test it on race-03 and arena-05.
5. **8 spawns in every pool race level** (lobbies of 5–8), placed per LEVEL-DESIGN §1.
6. **Lobby backdrop:** the scene behind the vote panel shows the currently leading candidate (the first candidate while there are no votes), with a quick fade between levels.
7. **LEVEL-DESIGN.md changed** since this prompt was first written: rule 7.2 (modifier cap, with a `theme` exemption) and rule 6.2 (boost `dir`). Implement the current text. Give arena-03 `"theme": "ice"` and race-06 `"theme": "boost"` if they need it.
8. **Jakub's `.env` `LEVEL` override is now commented out,** so his local server uses the pool. Leave it that way.

## Acceptance checklist
- [ ] All tests pass. Typecheck and build are clean.
- [ ] `npm run level:check`: 0 errors on pool levels; warnings listed in the report
- [ ] Browser: bounce in place while a second window rolls under you; stop under a bouncing ball and get stomped
- [ ] Soak: 12 rounds from the pool with `seek,bully,blocker,wander`, no errors or STUCK

## Report: `docs/reports/14b-report.md`
Then commit: `phase 14b: roll-under + trap rules`.
