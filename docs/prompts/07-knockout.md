# Phase 07: Stagger fix + Knockout mode

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§14 as updated, §15 new), `docs/DECISIONS.md`, `docs/reports/06-report.md`.

## 0. Housekeeping (do first, separate commit)
- The working tree has 18 files that differ from HEAD only by line endings: CRLF on disk, LF in git. There's no `.gitattributes` and `core.autocrlf` is unset.
- Add `.gitattributes` with `* text=auto eol=lf` (plus `*.png *.jpg binary`), run `git add --renormalize .`, and check `git status` is clean apart from real changes.
- Commit: `chore: normalize line endings`.
- Configure your editor or tools to write LF from now on.

## 1. Stagger rule (§14 change, decided from the 06 report)
- A victim Stunned **after being knocked** is not pushable (stagger). A pusher Stunned by a **bounce** stays pushable.
- `STUN_TICKS` changes from 8 to 6.
- Tests:
  - chain push on a straight edge is no longer possible: after one push the pusher holding W is blocked until the stagger ends, then the victim's escape precedence applies
  - a bounce-stunned player is still pushable
  - update the old "Stunned victim is pushable (combo)" test to the new rule
- Leave `KNOCK_TICKS` at 4; Jakub will tune it.

## 2. Knockout mode (§15)
1. **Level format + validation**: `mode`, `lives`, `crumble`. Knockout levels must have no keys/exit and ≥ 4 spawns. Race levels are unchanged. The reachability test applies to race only.
2. **Solid overlay**: `world.removed` plus `isSolid(world, v)`. Replace every sim/BFS use of `level.solid` for ground checks. Add a test that removing a block under an Idle player makes it fall on the next tick.
3. **Sim**
   - lives, respawn at a random free spawn, spawn protection (`SPAWN_PROTECT_TICKS = 40`; it ends early when the player pushes)
   - elimination, win/draw/timeout per §15
   - the crumble schedule (bands, warn, stop-at-2×-alive floor)
   - events per §15
   - race-mode behaviour is untouched (the full race suite passes)
4. **Tests**
   - band ordering on arena-02 (corners/edges first)
   - warn precedes removal by exactly `warnSec`
   - the floor stops crumbling
   - a death with lives left respawns with protection, and a protected player is unpushable
   - pushing ends your own protection
   - elimination at 0 lives
   - last alive wins; simultaneous final deaths are a draw
   - timeout tiebreak (lives, then knockouts)
   - determinism in knockout with 4 players
5. **Server/schema**
   - `mode`
   - per player: `lives`, `eliminated`, `protectedUntil`
   - `removed` and `warning` cell sets. Use an efficient encoding: e.g. `ArraySchema<string>` of cellKeys, or band indices, since the client can recompute bands from the level.
   - The level rotation can mix modes.
6. **Client**
   - hide removed blocks (instance matrix → zero scale); warning blocks shake and blink red
   - HUD in knockout: lives as hearts/dots per player, an "ELIMINATED" banner, a crumble countdown ("Floor crumbles in 5"), and results by placement
   - spawn-protected balls are translucent
   - eliminated local player: follow-cam on the killer, or orbit
   - beeps for the crumble warning and elimination
7. **Bots**
   - bully and seek bots run in knockout: bully as-is; seek targets the nearest opponent (BFS) and pushes when the victim would fall
   - all bots treat warning and removed cells as not-ground in BFS, and step off warned tiles
8. **Levels**: `arena-01` and `arena-02` per §15.

## Acceptance checklist
- [ ] Line-ending commit done; `git status` is clean before feature work
- [ ] All tests pass (race suite with push on and off, plus knockout). Typecheck is clean.
- [ ] `LEVEL=race-01,arena-01,arena-02`: 9 unattended rounds with `seek,bully,bully,wander`. Rounds cycle through both modes, with no errors or STUCK.
- [ ] Browser on arena-01 with 3 bully bots: lives drop, respawn protection is visible, crumble warnings are readable before tiles vanish, and elimination → spectate → results works.
- [ ] Knockout rounds end before the timeout most of the time (crumble works)

## Report: `docs/reports/07-report.md`
- Knockout round stats: duration, winner, deaths, how many bands crumbled
- Screenshots: a crumble warning, the lives HUD, an eliminated spectator view
- Feel notes: stagger vs chain pushing, crumble pace; suggested constants (not applied)
- Open questions

Then commit: `phase 07: stagger + knockout`.
