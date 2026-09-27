# Phase 14d report: Moving collisions

## Summary
- **Moving balls now collide (§20).** A *mover* is a ball in Roll, Flip or Knocked, including every roll of an ice slide and a knock-slide. When a mover's forward move targets a cell X that another mover V on the same face is entering:
  - **Head-on** (V moving the opposite way), or both starting into X on the same tick (straight or T-bone): **both bounce back.** Each is Knocked one cell against its own motion, then bounce-stunned. If that cell is blocked, it bounce-stuns in place. On ice the knock-back slides on, so two sliders meeting on Ice Rink fly back to the rims.
  - **Side hit** (V started first, moving across): **V is pushed.** Its move is cancelled, it arrives at X and is Knocked on to X + dM (a stagger, or a fall/slide by the usual rules). The hitter enters X. If X + dM is blocked, the hitter bounces instead.
  - **Dodge** (V leaving X) and **rear-end** (V moving the same way): no collision; the hitter waits, as before.
  - **Standing V:** the old push, cradle, edge-push and roll-under rules, unchanged.
- **Mutual push:** two balls that have just arrived from a move and push each other are a head-on too (they get knocked back). From rest it's still the §14 bounce in place.
- **Other rules:**
  - A staggered ball (Knocked, or knock-sliding) can't be side-hit again until it recovers.
  - A spawn-protected ball is never hit.
  - With push rules off, the MVP blocking stays.
- **Events and logs:**
  - `push {pusherId, victimId, moving: 'headon' | 'side'}` plus `bounce` events. Knockout credit works as for pushes.
  - The server log tags pushes `(headon)` / `(side)`.
  - Every round's results line ends with `hits H/S (head-on/side), knockouts <cause>:<n>`.
- **Prediction:** a roll/flip into a cell another ball faces into (standing next to it, or arriving next to it) is deferred to the server. Found in the browser check (below).
- **race-06:** each edge pad now sticks out as a 1-wide tongue, so the only way onto a pad is heading for its gap. See deviation 1 for why the pads didn't move one tile in.
- **Charge vs spawn protection:** unchanged, as decided.
- **Client:**
  - Head-on: both balls lunge to the point where their render positions touch, squash hard there (`SQUASH.headOn` −0.45), hit-stop together, then recoil. One `hit` plays, ×1.3 louder, at the midpoint.
  - Side hit: the normal push FX and hit-stop; the knocked ball stretches along dM.
  - A ball knocked out of a move blends from where it was drawn instead of snapping.
- **Bots:**
  - Bully takes side hits: it presses into a mover crossing the cell ahead, turns toward one that has just started, and adds "beside the target's next cell" to its hunting goals.
  - All bots (wander, seek, bully, blocker) hold back from a forward move that would meet a mover head-on when the knock-back, following any ice, would drop them off an edge or onto a trap.
- **Checks** (with the other agent's uncommitted `art.ts`/`level.ts` set aside): `npm test` passes 627 (2 skipped by design), and typecheck, build and `level:check` are clean.
  - With their WIP in place, 2 client `art.test.ts` tests fail: that WIP expects 21 models where 8 `.glb` files exist, and changes the block mesh. It isn't part of this phase.

## Tests (`moving.test.ts`, 18)
| Case | Result |
|---|---|
| Plain: head-on, both mid-move | both Knocked 1 back (1→0, 3→4), credited to each other, then bounce-stunned |
| Plain: both start into the same empty cell | both bounce back |
| Adjacent, both already rolling (mutual push) / from rest | head-on knock-back / the §14 bounce in place |
| Side hit on a roller entering X | V Knocked X → X+dM, hitter rolls into X, V staggered after |
| Side hit, X + dM a wall | hitter bounce-stunned; V keeps rolling |
| Simultaneous T-bone | both knocked back against their own motion |
| Dodge (V leaves X sideways as M starts) | no events; M rolls once X is free |
| Rear-end | no collision; M follows |
| Push rules off | no collision, M blocked |
| Ice: two sliders head-on (even and odd gap) | both slide back to the rims |
| Ice: slider side-hits a crossing slider | V knocked along dM and slides on to the plain rim |
| Ice: slider into a standing ball | old push + knock-slide |
| Knocked ball head-on into a roller | both bounce (the knocked one where its knock lands, since its pusher took its from-cell) |
| Stagger after a side hit | a 3rd ball can't hit it through Knocked + stagger; pushed the tick it's Idle |
| Side hit off an edge | falls, dies, knockout credited to the hitter |
| Head-on at a boost pad arrival / knock-back onto a pad | nobody launches / the knocked-back ball launches along the pad's dir |
| Determinism: 4 players on arena-03, random inputs, 2000 ticks | identical replays; head-ons and side hits happen |

Changed expectations in older suites:
- `sim.test.ts` "two players rolling into the same cell: exactly one moves" and "fairness rotation" now run with push off only. With push on, that case is a head-on.
- `cradle.test.ts` determinism: random seed 3 → 4. With moving collisions, seed 3 never lines up a cradle.
- `predict.test.ts` "a move near another player is predicted": the other ball now faces sideways. Facing the target, it could start into it on the same tick, so that's deferred now.

## Browser
Headless Chrome over CDP on the real GPU (the Chrome extension wasn't connected). Throwaway server on :2569 with `LATENCY_MS=150`, Vite on :5174. The second player (and more) were scripted clients playing tick-stamped inputs.
- **arena-03, head-on on ice:**
  - The browser ball and a scripted ball rolled at each other along z=4. Both started into (7,4) on tick 69 → `push … (headon)`.
  - Knocked 8→9 and 6→5, then both slid back to the rims (12,4) and (2,4) and staggered.
  - The page's per-frame render log shows the lunge meeting at x≈7.45 / 6.5: 0.9 cells apart (touching is 0.8), in the same frames on both balls.
  - The local ball was first mispredicted into (7,4) and corrected, which led to the new prediction deferral.
- **arena-03, side hit on ice:**
  - A scripted ball slid +Z down x=10. The browser ball, sliding −X along z=4, reached (11,4) while it was entering (10,4) → `push … (side)`.
  - It was knocked to (9,4) and slid on −X to the rim at (2,4), then staggered; the browser ball followed it and stopped behind it.
- **arena-01, head-on on plain floor:**
  - The browser ball (6,0) and a scripted ball (4,0) faced each other; the browser rolled first, the script started into (5,0) a tick later.
  - Both were knocked back (→7, →3), then bounce-stunned (`9!` in the tick log).
- **Not done:**
  - A side hit on a roller on plain floor in the browser: that run's scripted balls burned on their hot tiles before the scheduled inputs.
  - "A slider still pushes a standing player" in the browser.
  - Both are covered by unit tests.
  - The run was cut short: Claude Code stopped the test server, Vite and Chrome because the machine ran low on memory.
- Screenshots were too slow to catch the contact frame. The squash itself wasn't checked by eye (render code only).

## Soak
**Not run.** The background processes were stopped for low memory, and I didn't restart them without being asked. Command, when you want it:

`PORT=2568 MIN_PLAYERS=4 npx tsx packages/server/src/index.ts` and `npm run bots -- --count 4 --behaviour seek,bully,blocker,wander --server ws://localhost:2568`

Per level, the results lines will give `hits H/S` and `knockouts cause:n`.

## Deviations (details in DECISIONS.md)
1. **race-06 pads didn't move one tile in.** A far launch goes exactly 3 cells, so from one tile in it would land in the 2-cell gap. Instead the two edge tiles beside each pad are removed (40 blocks): the pad is a tongue reachable only from behind, heading for its gap. Landings are unchanged, and `level:check` is clean (0 errors, 0 warnings).
2. **Climbs aren't movers** (a climb stays in its own cell), and **boost flights stay jumps** (airborne, with the stomp rules).
3. **A mutual push after a move is a head-on;** from rest it's the old bounce in place.
4. **A head-on knock-back on ice ends in the stagger** (unpushable), not a bounce-stun.
5. **Prediction defers moves into a cell another ball faces into** (a new rule, not in §20).

## Open questions
1. Should a mutual push from rest also knock both back? That would make it consistent with the gap case, but it's riskier at edges.
2. race-06's tongues change the look of the islands: 61 boxes instead of 11, and a notched edge row. Keep them, or add a 4-cell launch variant so pads can really sit one tile in?
