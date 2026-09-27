# Phase 13b report: Traps part 2

## Summary
- **Teleporters** (`"type": "teleport", "face", "pair"`):
  - Arriving on a pad by a roll, flip, climb, ice slide or knock starts `Teleport` (Action 14, 6 ticks). It reserves both cells, and the ball fades out, then back in on the partner.
  - Facing: the rotation that takes the source face onto the target face is applied to fwd. For the same face or the opposite face, fwd doesn't change.
  - If the partner cell is taken (reserved, or any ball in it), the ball holds like a boost `Charge` for up to 10 ticks, then is released as on a plain tile.
  - Arriving by teleport never re-triggers the pad, so there's no ping-pong, and no extra state was needed for it.
  - A knock onto a pad teleports the ball, then it staggers.
- **Lasers + switches:**
  - `"lasers": [{ group, from, dir, length, on }]`. Group states are synced as the `lasers` map.
  - A ball dies (cause `laser`) if its finished action ended in or passed through an active beam cell. That covers roll, flip, jump and boost flight cells, fall steps and knocks.
  - A beam switched on through a standing ball kills it.
  - Switch tiles toggle their group when an action finishes on them. That includes hops, so hopping presses the switch again. Each switch has a 20-tick cooldown.
- **Invisible blocks:** `"invisible": true` on a box, or a `{ "cell", "invisible" }` block entry. They're solid.
- **Vanishing blocks:** `"vanish": { period, on, phase }`. Solidity comes from the tick inside `isSolid` (deviation 1). A ball standing on one when it goes falls. Invisible and vanishing blocks never crumble.
- **Planning:** `resultPose` follows teleports and treats active beams as walls (off beams are open). Planning worlds (bots, level:check) treat vanishing blocks as gaps.
- **Predictor:**
  - It runs the same rules and takes the laser groups from each patch.
  - A teleport whose arrival cell another ball is in or entering is left to the server.
  - Solo prediction through a teleport gives 0 mispredictions (test).
- **level:check:**
  - LEVEL-DESIGN §10 [E] 10.1–10.7 and [W] 10.8 are implemented.
  - Rules 2.2 and 5.1 now search (pose, laser states), with switches as edges.
  - 10.4, the laser soft-lock check, tests every reachable spot with every group state the switches allow.
  - `"lab": true` levels report no errors. traps-lab is marked lab and has new lanes for teleport (across faces), a laser gate, invisible blocks and vanishing blocks.
  - `level:stats` has new columns for teleport, switch, lasers, invisible and vanish.
- **Levels** (every 13b type is now in 2 pool levels; `level:check` shows 0 errors and 0 unnoted warnings):

  | Level | 13b content |
  |---|---|
  | race-07 Switchyard (new) | Two laser cages, red and blue, each around a key with a switch inside. The outside red switch sits by the blue cage, and vice versa. A teleporter pair takes you home from the annex, where the exit is. 8 spawns, 7 keys. |
  | arena-07 Warp Ring (new) | A 3-wide ring, an inner ring of 32 vanishing blocks that blink in a wave, and two teleporter pairs across the hole. |
  | race-01 | A red laser fence across island 2, in front of its key, with a switch on each side. |
  | race-05 | The invisible beam at z=5 from x=2 to x=9. Rule 10.6 confirms it isn't the only route. |
  | arena-01 | The four holes are plugged by blinking vanishing blocks. Two invisible stepping stones sit off the east and west edges. |
- **Client** (procedural, in the ceramic/lavender style; new `render/traps2.ts`):
  - Teleporter pads: a glowing ring with a turning swirl, one colour per pair. The ball fades out and in, with a "vwoop" sound.
  - Lasers: emitter nubs, and an additive, flickering beam in the group colour. An off beam shows as a faint dotted guide. A positional buzz plays near active beams, and a "zap" on a laser death.
  - Switches: a round button that pushes down with a click. The HUD toasts "Red lasers ON/OFF".
  - Invisible blocks: a glass shimmer within 2 cells of the local ball, fading out to 3 cells. `revealInvisible` is the hook for the sunglasses pickup.
  - Vanishing blocks: they fade out and in, flicker for 0.5 s before going, and leave a faint ghost while gone.
  - The lobby cards have icons for the new types.
- **Bots:**
  - All bots use teleports (via the BFS) and plan around active beams.
  - Seek, bully and blocker replan when a beam comes on ahead. Wander turns away from a beam ahead.
  - The bully detours up to 4 moves to a switch that would turn a beam on with an opponent in it or next to it.
  - **Head-on fix (14d):** after a head-on bounce with ball X, a bot leaves X alone for 2 s.
- **Server:** the results line adds `deaths cause:n`, `teleports N` and `laser toggles N`, and switch toggles are logged.

## Checks
- `npm test`: 667 passed (2 skipped by design). This is with the art agent's `art.ts`/`level.ts` WIP set aside, as in 14d.
  - With their WIP in place, the same 2 `art.test.ts` tests as in 14d fail (the model count, and the single block mesh).
- `npm run typecheck` passes (with and without the WIP). `npm run build` passes, and `npm run level:check` exits 0.

## Tests (`traps2.test.ts`, 29, plus 1 in `predict.test.ts`)
| Area | Cases |
|---|---|
| Teleport | a roll warps (same facing), no ping-pong, and rolling back on warps again; flip, climb, ice slide and knock all warp (the knock one then staggers); facing for all 36 source/target face pairs checked against the rotation formula; a taken partner holds, then releases, and the pad stays quiet; held, then the partner clears: warps; planning follows a teleport; solo prediction: 0 mispredictions |
| Lasers | finishing in a beam kills; jumping over or flipping past one kills; an off beam by default, a switch turns it on, and the cooldown; a beam switched on through a standing ball kills it; a new world starts from the level default; planning treats an active beam as a wall and an off one as open |
| Invisible / vanish | an invisible bridge works for rolls and planning; the vanish schedule; a ball standing on one falls; vanish lanes that are passable and not |
| Checker | a clean base fixture; failing fixtures for 10.1 (half a pair, near a spawn), 10.2, 10.3 (a beam on a flip landing → 3.1), 10.4 (laser soft-lock, and more than 3 groups), 10.5, 10.6 and 10.7 (too fast, near a spawn, only route and out of step); the same gate with a switch on each side isn't a soft-lock; a lab level reports no errors |
| Determinism | 4 random players for 2000 ticks on a level with every 13b type: identical replays, with teleports, toggles and laser deaths all happening |

Changed older tests:
- `knockout.test.ts`: bands cover every block except invisible and vanishing ones.
- `path.test.ts`: the "every key reachable" test turns lasers off first, because switches open them (10.4 checks this properly).
- `rules.test.ts`: the tile fixture needed the new `pair`/`group` fields.

## Browser
Chrome extension on a throwaway server (:2568) and Vite (:5175), using a throwaway test level (deleted since). The second player was a scripted Colyseus client.
- **Switch and zap:**
  - The scripted player rolled into the off beam cell (3,1,5). My ball rolled onto the switch.
  - Result: `laser: red on`, and the scripted player died with `death … (laser)` at (3,1,5).
  - The screenshot shows the lit beam between its nubs and the red button.
- **Invisible:** walking up to the invisible bridge, its blocks showed as a lavender shimmer near the ball and faded further out (screenshot).
- **Teleport across faces:**
  - Rolling onto the island pad teleported me onto the plate's −X side face, arriving with up −X and facing +Y, as the mapping predicts.
  - The camera followed onto the wall.
  - A held key then carried me up onto the top and into the active red beam: a real `laser` death of my own ball.
- **Vanishing floor:**
  - Rolling on the underside onto a vanished block dropped me off the level (`fall`).
  - I timed a roll onto the top of the block during its on-window. At the end of the window the ball fell through (`death … (fall)` from (4,1,1)).
  - The flicker itself wasn't checked by eye. The background tab only renders when a screenshot is taken, so the 0.5 s flicker couldn't be caught.
- **Not checked:** the sounds (buzz, zap, vwoop, click) weren't listened to.
- **Problem found:** inputs I sent straight through `room.send` bypassed the predictor, so the drawn local ball drifted until I switched to key events or stamped inputs. This is a test-harness issue, not a game bug.

## Soak
One server on :2568 (pool, `MIN_PLAYERS=4`, bots voting) and one bot process (`--count 4 --behaviour seek,bully,blocker,wander`, skill 0.5).

**12 pool rounds: 0 STUCK, no errors.**

| # | Level | Winner | Deaths by cause | Teleports / toggles |
|---:|---|---|---|---|
| 1 | race-01 | seek (exit) | fall 1, **laser 1** | 0 / 0 |
| 2 | arena-06 | seek (lastAlive) | fall 9, spikes 2 | 0 / 0 |
| 3 | race-06 | seek (exit) | spikes 2, fall 1 | 0 / 0 |
| 4 | arena-07 | bully (lastAlive) | fall 9, burn 1 | 2 / 0 |
| 5 | race-01 | seek (exit) | fall 1 | 0 / 0 |
| 6 | arena-01 | bully (lastAlive) | fall 10 | 0 / 0 |
| 7 | race-01 | seek (exit) | fall 2 | 0 / 0 |
| 8 | arena-05 | bully (lastAlive) | fire 1, fall 9 | 0 / 0 |
| 9 | arena-02 | seek (lastAlive) | fall 10 | 0 / 0 |
| 10 | race-06 | seek (timeout, 3 keys) | spikes 3, fall 14 | 0 / 0 |
| 11 | race-02 | seek (exit) | fall 6 | 0 / 0 |
| 12 | race-03 | seek (exit) | fall 2 | 0 / 0 |

- The random vote never picked race-07. So I ran 4 more rounds with `LEVEL=race-07,arena-07`: 0 STUCK, no errors.
  - race-07 ×2: seek won by the exit both times, with **laser deaths 1 + 1**, 1 teleport and 4 switch toggles (all by wander and blocker).
  - arena-07 ×2: 3 and 5 teleports.
- **The bully never used a switch.** On race-07, seek grabs the free keys (underside, annex) and wins in 15–18 s, before anyone is near a cage.
- **Round 10:** seek held 3 keys but timed out on race-06. It was knocked off 6+ times by the bully (push 6), not stuck.

## Deviations (details in DECISIONS.md)
1. **Vanishing blocks are solid by schedule inside `isSolid`**, not by toggling `removed`. It's the same rule with no state to sync.
2. **Invisible and vanishing blocks never crumble.**
   - The client draws them apart from `LevelView`, which gets the level without them. Its crumble bands must still match the sim's.
   - This kept me out of `level.ts`, so there was **no edit to the art agent's `art.ts`/`level.ts`**.
   - When their integration lands, LevelView could draw these blocks itself (per-instance opacity), and `staticLevel()`/Traps2View's blocks could go.
3. **10.2:** a roll never falls (it flips over the edge), so "facing into void" is checked as "the next forward move is legal and not lethal", for every entry direction.
4. **Beams count as lethal for rules 1, 2, 3 and 7.1 only**, as LEVEL-DESIGN 10.3 says. Rules 7.4/7.5 still look at tile traps, so race-07 doesn't need 20 push-lane notes.
5. **Laser gates are cages over interior floor.**
   - Balls can jump off any face and fall sideways onto another part of the level, and a beam next to any block edge is a flip landing (10.3). Together these make "pockets" behind a gate almost impossible.
   - So race-07's gates are cages, each with an inside switch. race-01's gate is a fence you can walk around, with a switch on each side.
6. **Laser JSON uses `group`** (as in the prompt), not the old `color` in the §18 draft.

## Open questions
1. race-07 plays short: its free keys are quicker than the caged ones. Should one or two of the free keys move into cages, so the lasers matter more?
2. Should the bully's switch play reach further than a 4-move detour? In the soak it never triggered.
3. Teleport "occupied" also counts a high hopper over the partner pad. Is that intended, or should the arrival roll under it, like a roll does?
