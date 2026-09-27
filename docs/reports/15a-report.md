# Phase 15a report: Pickups & pills (+ 13b follow-ups)

## Summary
- **Task 0: 13b follow-ups**
  - **race-07:**
    - Both cages are now 3×2 inside (beams from x 1–5 and 7–11, still off the edge rows, which are flip landings).
    - Red holds 3 keys and blue holds 2. The 2 free keys are the underside one (6,−1,4) and the annex one (3,1,13).
    - With keysRequired 3, every winner has to open at least one cage. `level:check`: 0 errors.
  - **Bots and switches:**
    - The seek and bully main plans now use `findPathLasers`. It searches (pose, laser group states), and a move that finishes on a switch toggles its group, as in the sim.
    - In the soak, seek opened the blue cage itself on race-07 (`seek-1 turned blue off`) and won.
    - The bully's switch detour is now 8 moves.
  - **Teleport under a high hopper:** a high hopper over the partner pad no longer counts as occupied. The ball arrives under it: the hop re-hops while it's still arriving, then stomps it at the next landing if it stays. There's a test for this.
- **Task 1: Sim (§21)**, in the new `shared/src/sim/pickups.ts` plus hooks in `actions.ts`, `tick.ts` and `world.ts`.
  - **Level format:** `pickups` (cell, up, type, respawnSec) and `randomPickups` (everySec, types, maxOnMap), loaded and validated.
  - **Collecting:** by cell, at the same place in `finishAction` as keys. So every finish counts: roll, flip, climb, jump/fall landing, knock, each slide step, teleport arrival, and a hop.
  - **Fixed spots** come back after `respawnSec` (default 15), once nobody is in or entering the cell.
  - **Random spawns:**
    - Every `everySec`, while fewer than `maxOnMap` random ones are out, a pill spawns on a free candidate tile.
    - Candidates are exactly the LEVEL-DESIGN §11 tiles.
    - Spawns use their own seeded RNG stream (`seed ^ 0x9e3779b9`), so knockout respawns stay the same with or without pills.
    - A pickup whose block crumbles goes away.
  - **Effects:**
    - `effects: {type, untilTick}[]` per player.
    - The same type refreshes its duration.
    - Death clears all effects.
    - `effectEnd` fires when an effect runs out.
  - **Bouncy:**
    - `fwd` is the §16 forward jump of 2 cells (over, stomp, short-jump fallback, fall, lasers). Forward + jump reaches 3 cells.
    - A wall ahead is still climbed, and a roll/push happens only where the bounce can't start.
    - It lives in `previewAction`, so `resultPose`/`findPath`, bots and the predictor all see it.
  - **Lethargy:** the durations of the ball's own actions ×1.6, rounded up (integer `ceil(8t/5)`): roll 8, turn 5, flip 10, jump/hop 16. That covers the pusher's own roll/strike/edge-push flip too. Knocks, stuns and falls done to the ball aren't slowed.
  - **Heavy:**
    - A push, edge push, cradle, side hit or stomp on a heavy ball bounces the attacker (a stomp clashes).
    - In a head-on, only the other ball bounces back.
    - A heavy push (or a heavy cradle striker's last ball) knocks 2 cells. It knocks 1 if the second cell is blocked, or if the first cell has no ground (the victim drops there).
  - **Sunglasses:** no sim effect.
  - **Events:** `pickup {playerId, pickupId, pickup}` and `effectEnd {playerId, effect}`.
  - **Schema:** a `pickups` map (an `ItemS` with `kind` = type) and `PlayerS.effects` (type → untilTick).
  - **Predictor:** it applies the synced effects and takes pickups on its own timeline, so a pill changes the very next move without a misprediction.
- **Task 3: Levels** (`level:check` exits 0; pool: 0 errors, 0 unnoted warnings)
  - **Knockout arenas:** `randomPickups` every 20 s, max 2, bouncy/heavy/lethargy. arena-01 (invisible ledges) adds sunglasses.
  - **Race levels:** 2 fixed spots each, all on edge or trap-adjacent tiles:

    | Level | Pills |
    |---|---|
    | race-01 | bouncy (10,1,5); lethargy (11,1,2), next to the (10,1,2) key |
    | race-02 | bouncy (21,1,8); lethargy (9,1,19), next to the (8,1,19) key |
    | race-03 | bouncy (5,1,4), heavy (8,1,10) |
    | race-04 | bouncy (3,4,3), heavy (2,12,4) |
    | race-05 | sunglasses (11,1,3) for the invisible beam, bouncy (5,1,10) |
    | race-06 | bouncy (18,1,0), heavy (0,1,0) |
    | race-07 | heavy (3,1,8) just outside the red cage, bouncy (3,1,15) in the annex |
  - `level:stats` has a pickups column.
- **level:check §11:**
  - 11.1: spawn/key/exit/trap tile, or within 2 moves of a spawn.
  - 11.2: ≤ 4 fixed spots, `maxOnMap` ≤ 3.
  - 11.3: lethargy on the only route. It counts as a cell you may fly over but not stop in, and random lethargy candidates are checked on race levels too.
  - 11.4 [W]: a good pill not next to an edge or trap.
- **Task 4: Client**
  - **Pills** (`render/pills.ts`): ceramic capsules that float and spin slowly.
    - bouncy: pink/purple, bouncing on the tile.
    - lethargy: red/yellow, drooping and sagging.
    - heavy: dark iron, metallic, with a slow low bob.
    - sunglasses: a little pair of glasses.
    - A taken pill pops (grows and fades).
  - **Collect sounds:** pop + chime, or a descending "wah" for lethargy. Toasts "You got Heavy!" and "Bouncy wore off" (the latter local only).
  - **On the ball:**
    - bouncy: squash/stretch ×1.8, and an extra boing on landing.
    - lethargy: a washed-out grey tint, a small woozy camera sway, and a slower roll rumble (it follows the slower rolls).
    - heavy: dark metallic iron, a deep "thud" instead of the bounce on landing, and a "clang" when someone bounces off it.
    - sunglasses: `revealInvisible` shows every invisible block.
  - **HUD:**
    - An icon per active effect in a ring that runs down, with seconds left, above the status bar.
    - Other players' name labels get small icons (🟣 💤 ⚓ 🕶).
  - New synth sounds: `chime`, `wah`, `clang`, `thud` (F4 gains).
- **Task 5: Bots**
  - All BFS bots pass lethargy cells as reserved, so they never stop on one (flying over is fine), with a plain-plan fallback if that's the only way.
  - Wander turns away from a lethargy pill ahead.
  - Seek takes bouncy/heavy within 4 moves if the detour costs ≤ 2 extra moves to its goal. Hunters (the bully, and every bot in knockout) take one within 6 moves.
  - The bully's trap-push goals include pushing a victim onto a lethargy pill.
  - Plans use the bot's own effects (bouncy moves), and a `fwd` press may now start a Jump.
  - The bot summary adds `pills type:n (detours n)`.
- **Server:** logs `event pickup`. The results line adds `pickups name:type:n` and `pill knockouts heavy N bouncy N` (the attacker's pills at the victim's last knock).

## Checks
- `npm test`: **705 passed** (2 skipped by design). `npm run typecheck`, `npm run build` and `npm run level:check` are clean.
- **The art agent's WIP was in place for these runs.** It has grown since 13b, and now also touches `traps2.ts`, `preview.ts`, `scene.ts`, `art.test.ts` and one `main.ts` hunk. Its `art.test.ts` passes with it. I didn't edit any of their files.
- **Found while writing 11.3:** `resultPose` checked other players' cells only for a jump's own cells, not for the fall after it. So a plan could fall sideways into a taken cell. It now rejects that (this also stops bots routing a fall onto another player).

## Tests (`pickups.test.ts`, 31, plus 3 in `predict.test.ts`)
| Area | Cases |
|---|---|
| Collecting | a roll takes it (effect and duration); jump landing (not the cell flown over), flip, fall landing (not a cell fallen through), knock onto a pill, ice slide, teleport arrival; a fixed spot respawns exactly `respawnSec` later, and waits while a ball stands on it; refresh keeps one entry with the later end; death clears all effects |
| Random | exactly 3 after 100 ticks at everySec 1 / max 3; only on §11 tiles across 30 seeds; same seed → identical world, different seed → different cells |
| Bouncy | a 2-cell bounce over a gap; a 3-cell jump; a wall is still climbed; hops unchanged; a plain roll stomps a ball 2 ahead; a bounce through an active beam → laser death; it ends on time (`effectEnd`) and rolls are rolls again |
| Lethargy | roll 8, flip 10, turn 5, jump 16; a knock done to a lethargic ball is 4 ticks; a lethargic pusher's roll is 8 |
| Heavy | push → the pusher bounces; stomp → clash; edge push → bounce; side hit on a heavy roller → the hitter bounces, the roller carries on; head-on → only the other one knocked back; a heavy push knocks 2 (8 ticks), 1 with a wall or a gap after 1; a heavy cradle striker's last ball flies 2 |
| Prediction | taking lethargy, bouncy or heavy, then rolling, jumping and turning with it: 0 mispredictions solo |
| Other | teleport arrival under a high hopper → stomped at the landing; `findPathLasers` presses a switch to pass a beam (plain `findPath`: no route) and restores the laser states; determinism: 4 random players, fixed and random pills, 2000 ticks, identical replays with ≥ 3 pill types taken |
| Checker §11 | a clean edge pill + spawner; failing fixtures for 11.1 (spawn, 2 moves from a spawn, key, trap), 11.2 (5 spots, maxOnMap 4), 11.3 (lethargy on the bend of a closed tunnel to the exit); 11.4 warning for a pill in the open |

## Browser
- **Setup:**
  - Chrome extension on a throwaway server (:2569, a temporary strip level, deleted since) and Vite (:5175). The second player was a scripted Colyseus client reacting to the browser ball.
  - Inputs were sent from the page with tick stamps, registered with the predictor.
- **Each pill:** rolling along the strip took sunglasses, lethargy and heavy in turn (toasts "You got Lethargy…" and "You got Heavy!").
  - The screenshot shows the ball in dark metallic iron and three rings (🕶 13 s, 💤 6 s, ⚓ 7 s) running down above the status bar.
  - The pills render as intended: the little glasses, iron capsule, red/yellow and pink/purple ones.
  - Bouncy's ring showed on its own later.
- **Bouncy stomp:** with bouncy, one plain W press at the attacker 2 cells ahead stomped it (`stomp` at tick 191; the attacker knocked to x=4).
- **Heavy:** I jumped over the attacker onto the heavy pill (tick 624). The attacker pushed me 2 ticks later and **bounced** (`bounce` event for it; I didn't move).
- **Knocked onto lethargy:** when heavy ended (tick 784), the attacker pushed again and knocked me onto the lethargy pill: `pickup … lethargy` at tick 790.
- **Not checked by eye:**
  - The lethargy tint and camera sway: the tab's round trips outlast the 8 s effect.
  - The sunglasses reveal: the test level had no invisible blocks. It sets the existing `revealInvisible` hook from 13b.
  - None of the sounds were listened to.
- **Test-harness notes:**
  - Inputs sent with `room.send` alone skip the predictor, so the drawn local ball drifts (as in 13b).
  - The throttled tab can deliver two stamped inputs late enough that both land on one tick. Stamps 6 ticks ahead fixed that.
  - Neither is a game bug.

## Soak
One server on :2568 (pool, `MIN_PLAYERS=4`) and one bot process (`--count 4 --behaviour seek,bully,blocker,wander`, skill 0.5).

**12 pool rounds: 0 STUCK, no errors.**

| # | Level | Winner | Pickups (bot:type) | Pill knockouts |
|---:|---|---|---|---|
| 1 | race-02 | seek (exit) | bully:bouncy | — |
| 2 | arena-05 | seek (lastAlive) | seek:heavy, bully:heavy | **heavy 1** |
| 3 | arena-02 | seek (lastAlive) | — | — |
| 4 | race-01 | seek (exit) | bully:bouncy | — |
| 5 | arena-01 | blocker (lastAlive) | — | — |
| 6 | arena-04 | bully (lastAlive) | seek:bouncy | — |
| 7 | race-01 | seek (exit) | bully:bouncy | — |
| 8 | arena-02 | bully (lastAlive) | bully:heavy | **heavy 1** |
| 9 | arena-06 | bully (lastAlive) | bully:bouncy | — |
| 10 | race-04 | seek (exit) | — | — |
| 11 | race-07 | seek (exit) | bully:heavy, bully:bouncy | — |
| 12 | arena-06 | bully (lastAlive) | bully:heavy | — |

- **Pickups by bot:**
  - bully: bouncy 5, heavy 4.
  - seek: heavy 1, bouncy 1.
  - blocker and wander: none (blocker doesn't seek pills; wander only avoids lethargy).
- **Nobody took lethargy**, and the bully never landed a push onto one.
- **Knockouts:** 2 involved heavy (a heavy bully's push), 0 involved bouncy.
- **race-07 (round 11):** seek switched the blue cage off itself and won through the cage (1 laser toggle, 3 teleports, 1 laser death).
- Rounds 5 and 10 had no pickups: random pills went to spots nobody's plan passed within range.

## Deviations (details in DECISIONS.md)
1. **Bouncy on forced slides:** a slide that starts under bouncy is one bounce (a jump landing never slides on). A roll/push happens only where the bounce can't start.
2. **Which durations lethargy slows:** only actions the ball starts itself (the pusher's own roll/strike/flip included). Falls, knocks, stuns, rebound, the re-hop over a roller, and Charge aren't slowed.
3. **Heavy's 2-cell knock:** takes 2×KNOCK_TICKS and reserves the middle cell. It drops to 1 cell if the first cell has no ground.
   - A heavy ball in a state it couldn't be pushed in anyway (e.g. mid-roll) still just blocks.
   - A plain fall onto a heavy ball keeps the MVP overlap.
4. **Pickups are collected by cell** (like keys), so a hop in the cell takes one that spawned under you. `effectEnd` isn't sent on death.
5. **Random pickups:**
   - They use their own RNG stream.
   - Candidates also exclude invisible blocks and beam cells.
   - Spawns skip cells with a ball in or entering them, and blocks that are crumbling or warned.
6. **The predictor collects pickups itself** (the prompt said only "applies your own effects").
7. **§11 checker interpretations:**
   - 11.3: jumping over a pill counts as avoiding it.
   - 11.4: "risk spot" = next to an edge or a trap tile (contested lanes aren't detected).
   - Also the `resultPose` fix above.

## Open questions
1. **Pills taken in the soak: 11 in 12 rounds, 9 of them by the bully.** Seek's rule (≤ 4 moves, ≤ 2 extra) rarely fires on race levels, because the spots are on edges away from the key routes. Should race pills sit closer to key routes, or should seek's detour allowance grow?
2. **Nobody ever took or was pushed onto lethargy.** Everyone avoids it, and the bully's lethargy push needs a victim standing right next to a pill. Is lethargy meant to be rarer in `randomPickups` (e.g. weighted types), or should the bully hunt that push harder?
3. **Bouncy on ice (deviation 1)** kills ice slides for the whole effect. Do you want bouncy to leave forced slides as rolls instead?
4. **Heavy vs a fall onto it** keeps the old overlap rather than bouncing the faller. Should the faller bounce like a hopper does (re-hop)?
