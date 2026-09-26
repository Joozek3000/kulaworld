# Phase 10b: Stomp polish (answers to the 10 report's open questions)

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` §16 (+ your clarification list), `docs/reports/10-report.md`, `docs/reports/09-report.md`.

## Decisions (from the architect, on the 10 report's open questions)
1. **Clash rule for staggered or spawn-protected victims:** keep "the attacker rebounds". No overlap. No change.
2. **Landing marker:** keep it visible for the whole jump for now. Jakub will judge it after human play. Make its visibility window a tuning value in the F4 panel (`markerLeadTicks`: 0 = whole jump, N = last N ticks).
3. **Bots get human-like reactions (do this):**
   - reaction delay: a random 150–300 ms before any *reactive* input (the defensive hop, and jumping over a blocker)
   - a 25% miss chance on the defensive hop
   - an optional `--skill 0..1` flag that scales both (1 = today's perfect bots)
   - default 0.5
   - Soaks should now show stomps at roughly human rates.
4. **Jump grace (do this).** A player who presses W and Space "together" from a standstill should get a standing forward jump, not a roll then a jump.
   - If a jump pulse arrives within `JUMP_GRACE_TICKS = 2` ticks after a **Roll started from Idle**, and fwd is still held, cancel that roll and start a forward jump from the roll's origin cell instead. The jump uses the normal jump/stomp rules at that moment, with its start tick = the current tick.
   - Only roll → jump, and only within the grace window. Rolls chained from a previous roll aren't affected, so holding W and tapping Space mid-run still jumps at the end of the tile, as in Kula World.
   - Reservations: release the cancelled roll's target cell in the same tick.
   - Prediction: the predictor applies the same rule (it's in shared). Add a predictor test so the grace doesn't cause mispredictions.
   - Tests:
     - W then Space 1 tick later → forward jump from the origin cell
     - Space 3 ticks later → roll, then jump at the end of the tile
     - a chained roll plus Space → no cancel
     - the grace jump that stomps works
     - determinism
   - Add it to ARCHITECTURE §6 as a clarification.
5. **Keep `test-stomp`** as a practice level (not in the rotation). Also add `LEVEL=test-stomp` usage to `.env.example` comments.

## Also
- `.env.example` shows as modified in git because Jakub edited the template once. Restore it with his values commented, as examples only, and make sure `.env` is untracked. `AGENTS.md` is Jakub's file: leave it alone.

## Acceptance checklist
- [ ] Tests pass. Typecheck is clean.
- [ ] Browser: from a standstill, pressing W+Space together gives a standing forward jump (and a stomp if a ball is 2 tiles ahead); tap Space mid-run still jumps at the end of the tile
- [ ] Soak: 10 rounds on `arena-01,arena-02` with `seek,bully,bully,wander` at the default skill. Report stomps, clashes and pushes per round, and compare with the 10 report.
- [ ] Prediction: 0 mispredictions solo at 150 ms with W+Space spam

## Report: `docs/reports/10b-report.md`
Then commit: `phase 10b: stomp polish`.
