# Phase 14c: Boost pads that always work

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` §18 (boost), `docs/LEVEL-DESIGN.md` §6, `docs/reports/14b-report.md`.

## Why
Jakub rolled onto boost pads several times in multiplayer and "nothing happened". Likely causes in the current code:
1. **Direction gate:** a pad only launches when you enter moving along its `dir` (added in 14b). From any other direction it's a plain tile, and that reads as broken.
2. **Silent failure:** the forced `boost` command is tried once. If `previewAction('boost')` returns null (the landing cell is reserved by or holds a non-stompable player, or a flown-through cell is solid), `p.forced` is cleared and the ball just sits there or rolls on.
3. **Knocked or climbed onto a pad:** no launch, by design, which also looks broken.

## New rule (update §18 and LEVEL-DESIGN 6.2)
- **A pad launches whenever a ball arrives on it,** by roll, flip, climb, knock or slide, from **any** direction. It always launches **along the pad's arrow (`dir`)**. The ball turns to face `dir` as it launches, and the camera swings with it. So the arrow shows exactly where you'll fly, and the level only needs the arrow direction to be safe (rule 6.2 is unchanged in substance).
- **Blocked launch:** if the launch is blocked (landing reserved, or a non-stompable ball there), the ball **holds on the pad**: `Action.Charge` (appended), pad glowing, input ignored. It retries every tick for up to `BOOST_HOLD_TICKS = 10`. If it's still blocked, it's released as a plain tile (Idle, normal input), and the pad won't re-fire until the ball leaves it and comes back.
- **Knock onto a pad:** the knock ends and the launch starts, so a push onto a pad is a combo. The stagger is applied after landing.
- **Ice slide onto a pad:** the slide ends and the launch starts.

## Tasks
1. **Sim:**
   - `forcedAfter` returns `boost` for any arrival, with the facing set to `dir`.
   - Add the Charge/hold logic, and a `boostCooldown` until the ball leaves the pad.
   - Update the knock and slide paths.
   - Log the reason when a launch is held or released: server log `boost: held (landing reserved by X)`.
2. **Tests:**
   - entry along, against and sideways → all launch along `dir`
   - climb onto a pad → launch
   - knock onto a pad → launch, stagger after landing
   - slide onto a pad → launch
   - landing blocked by a standing non-stompable ball → Charge, then launch when it moves
   - still blocked after 10 ticks → released; no re-fire until the ball leaves and re-enters
   - a stompable ball on the landing → stomp (unchanged)
   - 2 players arriving on 2 pads with the same landing on the same tick → fair order, the second holds
   - prediction: a solo launch has 0 mispredictions; a launch with another player within 3 cells of the landing is deferred
   - determinism
3. **Level audit:**
   - For every pool level pad, a test that rolls onto it from each open neighbour and asserts a launch along `dir` to the expected landing.
   - Re-run `level:check` (6.2 must now hold for `dir` only).
   - Fix any pad whose `dir` arrow doesn't match the level's intent (compare with the 14b report's pad list).
4. **Client:**
   - The pad's chevrons animate along `dir`, always (not only when approached along it).
   - Charge state: the ball squashes down on the pad, the pad glows brighter, and a rising hum plays.
   - The launch plays the existing `pwomp`, plus a short camera kick.
5. **Bots:** BFS already models boosts. Update it to the any-direction rule, and test a path using a side-entry pad.

## Acceptance checklist
- [ ] All tests pass. Typecheck, build and `level:check` are clean.
- [ ] Browser, 2 windows on race-06 and arena-05: rolling onto pads from different directions always launches along the arrow; with the other ball standing on the landing tile, stompable → stomp, while its spawn protection → hold then release
- [ ] Soak: 12 pool rounds with `seek,bully,blocker,wander`, no errors or STUCK. Report launches, holds and releases per level.

## Report: `docs/reports/14c-report.md`
Then commit: `phase 14c: boost pads always launch`.
