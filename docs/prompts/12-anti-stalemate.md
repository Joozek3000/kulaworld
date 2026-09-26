# Phase 12: Anti-stalemate

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§14 push precedence, §15 knockout/crumble, §16 stomp, §5 climb), `docs/DECISIONS.md`, `docs/reports/11-report.md`.

## Why
Jakub's playtest: all 4 players end up stuck in tight corridors, and nobody moves unless someone changes block face. That's partly bot pathing (BFS ignores players, so bots wait in a blocked corridor) and partly rules (pushing into a line of balls just bounces). Fix both, and add pressure against standing still.

## Task A: Bots route around blockers
- If a bot's next planned step is blocked by a player for ≥ 0.5 s (or it bounces once), replan the BFS treating every other player's occupied/reserved cells as obstacles. That finds routes via the underside, side faces, climbs or jump-overs.
- If there's no route that way, fall back to the old behaviour (wait, push or stomp).
- The bully keeps targeting its victim, but also uses the obstacle BFS to flank.
- Soak metric: **stalemate seconds**, i.e. time when ≥ 2 players have both been in the same cell for > 3 s while within 2 cells of each other. Report it before and after.

## Task B: Chain push (Newton's cradle)
Spec, to add to ARCHITECTURE §14 as "Chain push":
- When P pushes V1, look along F for a contiguous line V1..Vn (n ≤ 4) of players on P's face, each in the next cell.
- If **every** Vi is pushable and the cell after Vn (`A + n·F`) is not solid and not reserved, all of them are Knocked one cell along F in the same tick. Each lands staggered, or falls if there's no ground (the last one usually).
- If any Vi isn't pushable, or the cell after Vn is solid or reserved, it's today's rule: P bounces.
- Knockout credit goes to P for every ball in the chain.
- Mutual/escape precedence is unchanged. A victim in the line that escapes on the same tick breaks the line at that point: the line is re-evaluated without it.
- Stomps don't chain; they stay a single bump.

Tests:
- a line of 2 and of 4 shifts
- the last ball falls off an edge
- a line of 5 → bounce
- a wall after the line → bounce
- a staggered ball in the line → bounce
- escape in the middle of a line
- knockout credit for all
- determinism

## Task C: Hot tiles (anti-camping)
Kula's fire block turned into pressure against standing still.
- Each player gets `heat`: ticks spent on the same (cell, up) while Idle, Turning or Hopping. Stunned/staggered/Knocked ticks don't count, because being a victim isn't camping. Any change of cell or up (roll, flip, climb, jump, knock) resets it.
- At `HEAT_WARN_TICKS = 50` (2.5 s) the tile starts glowing. At `HEAT_BURN_TICKS = 80` (4 s) the ball **pops**: a death with the usual race/knockout consequences, event `burn`.
- Level config: `"heat": { "warnSec": 2.5, "burnSec": 4 }`, or `false`. Default is on for knockout levels, on for race levels, and off for single-player (a future mode).
- Hot tiles show on the tile the ball stands on only. Everyone sees them.
- Client:
  - the tile's face lerps from its normal colour to orange and then flickering red over warn→burn
  - a sizzle sound rises with it (a new synth sound, sample-overridable)
  - the pop uses the death FX plus a small puff
  - the HUD shows a "MOVE!" hint for the local player once warned
- Bots move off a warned tile (any legal step).

Tests:
- heat builds while Idle, Turning or Hopping and resets on movement
- a stun doesn't count
- warn and burn at the exact ticks
- a burn in knockout costs a life; in race it drops a key
- level `heat: false` disables it
- determinism

## Task D: Sudden death in race
- Race levels may define `crumble` too. For race-01, set `startSec` = timeLimitSec − 30 so the last 30 s crumble from the outside in, while keys/exit stay intact as long as the floor rule allows.
- Crumble never removes the block under a key or the exit.

## Task E: Level lint (report only, not a validation error)
- `npm run level:check` prints a warning for corridor segments ≥ 4 cells long, 1 wide, with no alternative route between their ends other than going through them (use BFS with the segment's cells removed).
- Run it on all levels and list the warnings in the report, so Jakub can decide on level fixes.

## Acceptance checklist
- [ ] All tests pass. Typecheck is clean.
- [ ] Soak: 12 rounds on `race-01,arena-01,arena-02` with `seek,bully,bully,wander`. Stalemate seconds per round before vs after (A alone, then all), no errors or STUCK.
- [ ] Browser: chain-push 3 bots off the end of a beam (test-stomp level); hot-tile warning → move → reset; standing still → pop
- [ ] Heat is readable from the follow cam on every face, including the underside

## Report: `docs/reports/12-report.md`
- Stalemate metric table
- Chain push and hot tile screenshots
- Level lint warnings
- Suggested constants (not applied)

Then commit: `phase 12: anti-stalemate`.
