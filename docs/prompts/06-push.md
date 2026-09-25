# Phase 06: PvP push

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§14 exactly; §5–§7 for how it fits the existing rules), `docs/DECISIONS.md`, `docs/reports/05b-report.md`.

## Goal
Rolling into another player knocks them one tile, and off the map if there's no ground. Key Race becomes a fight: deaths drop a key.

## Tasks
1. **Sim (shared)**
   - Constants: `KNOCK_TICKS=4`, `STUN_TICKS=8`, `HOP_PUSH_WINDOW=2`, `KNOCKOUT_CREDIT_TICKS=60`.
   - Append `Action.Knocked` and `Action.Stunned` after Hop. Don't renumber.
   - `createWorld(level, seed, rules?)` with `rules = { push: boolean }` (default true).
   - Implement §14 inside `resolveMoves`:
     - collect all Idle intents, then resolve by the precedence list (escape → mutual push → pushes in fair order → other moves)
     - "pushable" is one pure function (`isPushable(victim, tick)`) so the client, bots and tests share it
   - Stunned: no actions for STUN_TICKS. Buffered pulses survive the stun (treat it like airborne for pulse ageing). A `bounce: boolean` field is used only for rendering.
   - Knocked → on finish: land (Stunned) or `startFall`.
   - Track `lastKnockedBy` / `lastKnockedTick` on the victim for the knockout credit.
   - Death drops 1 key back to its original spot (`keyDrop` event), and sends `knockout` when credited. Both only apply with `rules.push`.
   - Events: `push {pusherId, victimId}`, `bounce {playerId}`, `keyDrop {playerId, keyId}`, `knockout {pusherId, victimId}`.
2. **Tests (shared)**, each in a tiny world:
   - push onto ground → victim Knocked one cell, then Stunned; pusher rolls into A
   - push over an edge → victim falls; off the map → Dead, key dropped and back at its original cell, knockout credited
   - death more than 60 ticks after the knock → no knockout credit
   - wall behind the victim → pusher Stunned with bounce, victim unchanged
   - player behind the victim → same as a wall
   - different `up` (victim on another face) → no push
   - victim mid-hop (high) → pusher blocked, no stun; W held → the push lands once the hop enters its last 2 ticks
   - victim hopping low (first 2 ticks) → pushed, and the hop is cancelled
   - victim Rolling/Jumping/Falling/Knocked → not pushable
   - victim Stunned → pushable (combo)
   - same-tick escape: the victim starts a Roll away on the same tick → no push, no stun
   - same-tick victim Turn → still pushed
   - mutual push → both Stunned with bounce
   - a victim is knocked at most once per tick when two pushers target it
   - buffered turn pressed while Stunned applies after the stun
   - `rules.push=false` → exact MVP behaviour: all existing tests pass unchanged with push off, and deaths keep keys
   - determinism test with push on (4 players, random inputs, 2000 ticks)
3. **Server**
   - `PUSH` in config and `.env.example`, passed into `createWorld`.
   - `PlayerS` gets `bounce: boolean`. `action` already covers Knocked/Stunned.
   - Broadcast the new events and log `push`/`knockout` lines.
4. **Client**
   - Knocked pose: a fast slide along the pusher's F. Include a small spin in `poseAt`, and add tests.
   - Stunned: a wobble (small oscillating tilt) plus a flashing ring above the ball.
   - Bounce: a lunge of 0.25 cell forward and back over the first 4 ticks.
   - Toasts: "A knocked B off!" for knockouts, "B dropped a key" for key drops.
   - Beeps: thump on push, low buzz on bounce.
   - The HUD key count updates on drop.
5. **Bots**
   - Seek bots push opportunistically: if an opponent is pushable directly ahead on the same face and `A + F − U` is air (a push would knock them into the void), take that step even if it's off-path.
   - Otherwise keep BFS.
   - Add behaviour `bully`: BFS towards the nearest opponent's *next* cell, and push whenever possible. Use it for testing pushes.
6. Update DECISIONS.md. The ARCHITECTURE §14 text is the spec; log any deviation.

## Acceptance checklist
- [ ] All tests pass (including the full old suite with push off). Typecheck is clean.
- [ ] Browser, 2 tabs on test-flat:
  - pushing the other ball off the 2-gap edge kills it and drops its key
  - pushing into a wall bounces you
  - holding Space dodges some pushes but not all
- [ ] race-01, 10 unattended rounds with `seek,seek,bully,wander`: no errors or STUCK. Report pushes, knockouts and key drops per round.
- [ ] LATENCY_MS=150: pushes look right (the victim's knock doesn't start before the pusher visibly reaches it; adjust the render if it does).

## Report: `docs/reports/06-report.md`
- Precedence rules as implemented, with any edge cases found
- Bot stats: pushes, knockouts, key drops, wins per bot type
- Screenshots: a knock mid-slide, a stunned ball, a bounce
- Feel notes and suggested constants (don't apply)
- Open questions for the Knockout mode (phase 07)

Then commit everything: `phase 06: push`.
