# Phase 15b report: Single player (Kula World campaign)

## Summary
- **Task 0**
  - `37ea910 art: environment kit v02 + sky pack`: the art agent's integration, committed alone after `npm test` and `npm run build` passed. `.gitattributes` gained `*.exr binary` (the sky pack ships 3 EXRs).
  - `f41723a phase 15a follow-ups`:
    1. **Race pills near key routes.** New `pillRoute.test.ts`: every good pill (bouncy, heavy) on a pool race level is ≤ 2 moves from seek's tour (spawn → nearest keys → exit). Two were off: race-01 bouncy (10,1,5) → (9,1,11), race-07 heavy (3,1,8) → (0,1,5). Both are edge tiles and pass §11. Seek's detour allowance (`PILL_EXTRA`) is now 4.
    2. **`randomPickups.weights`**: percent per type. Types left out share the rest of 100 equally. The default is `{ lethargy: 15 }`. Validation: weights ≥ 0, at least one > 0. Test: defaults resolve to 28.3/28.3/15/28.3; lethargy's share over 400 seeds is in 8–22 %; `lethargy: 0` never spawns it.
    3. **Bouncy leaves ice slides alone**: on ice a bouncy ball's forward move is a roll, so it slides. Test: a bouncy ball on ice rolls, and slides to the first non-ice tile.
    4. **A fall onto a heavy ball**: the faller gets a `bounce` event and hops in place (no overlap). Once heavy ends, it stomps at the next landing. Test included.
- **Task 1: Local runtime**
  - `GameSource` (in `net.ts`) is the one interface the renderer, HUD, audio and input read. `Net` implements it, and so does the new `LocalGame` (`client/src/local.ts`).
  - `LocalGame` steps `createWorld` + `step` with a 50 ms fixed-step accumulator and mirrors the world into the same `GameState` shape the server syncs. That mirror only runs on ticks, not per frame.
  - Input goes straight to `setInput`. There's no prediction, and the local ball renders at the local tick (`estServerTick` = tick + accumulator fraction, no interpolation delay).
  - Each attempt starts with a 1 s READY countdown phase, so the renderer resets as it does for a server round.
  - **Rules** (in `createWorld`, `mode: "single"`): push rules off, heat off, no sudden-death crumble, crumble tiles never regrow, pill spots never respawn.
- **Task 2: Flow and UI** (`ui/menu.ts`, ceramic/lavender panels over the level orbiting behind)
  - **Main menu:** Single Player (Continue / New Game / Level Select), Multiplayer (a name field, then the existing lobby), Settings (a volume slider, plus "Sounds & feel…" for the F4 panel), Reset Progress (with a confirm).
  - **Pause (Esc):** Resume, Restart Level (costs a death), Quit to Menu. Pausing stops the local clock.
  - **SP HUD:** score, the timer (flashes under 10 s, blue ⏸ while a clock froze it), keys x/total (or Paint x/total), 5 fruit slots, the pill rings, and the level number and name.
  - **Results card:** items, time bonus (seconds × 20), paint bonus, total, score, time/par/best, then Next level (Enter).
  - **Game over:** restart from the checkpoint. Finishing level 10 shows a "campaign complete" screen.
- **Task 3: Sim (§22)**, in `shared/src/sim/single.ts` (level rules) and `campaign.ts` (progress, pure functions).
  - **Items** are taken by cell on any finish, like keys. Coin 250, gem 3 000, fruit 2 500 (one of 5 kinds), key 1 000.
  - **Hourglass:** remaining becomes total − remaining.
  - **Clock tile:** freezes the timer for 5 s, once per attempt.
  - **Paint tiles:** a lit set; when all are lit the result is `painted`.
  - **Timer:** at 0 it's a death with cause `time`. On a bonus level it just ends (result `timeout`).
  - **Deaths:** any death ends the attempt (result `death`).
  - **Events:** `item`, `timer` (flip or freeze), `paint`, and `win` with the new reasons.
  - **Campaign functions:** `levelCard` (items, time bonus, paint bonus, total), `levelDone` (bank points and fruit, unlock a bonus, advance, save a checkpoint), `levelDied` (penalty −(500 + 50 n), game over → checkpoint).
- **Task 4: Levels:** sp-01 … sp-10 and sp-bonus-1 (see below). All have `pool: false` and `campaign: n`, validate, and have 0 [E] findings in `level:check`. The warnings that are left are noted in each level's `notes`.
- **Task 5: Save** (`client/src/campaign.ts`, key `kula.save`, every access in try/catch)
  - Stored: the campaign (level, starting score, checkpoint + score, fruits, bonus state), the highest level reached, and best times.
  - Settings keep their existing `kula.tuning` / `kula.muted` storage.
  - Without storage the game plays and just forgets.

## Checks
- `npm test`: **774 passed** (2 skipped by design). `npm run typecheck`, `npm run build` and `npm run level:check` are clean.
- **New tests**
  - `single.test.ts` (15): items taken by roll, flip, climb, jump landing (not the cell jumped over), fall landing, hop, ice slide and teleport arrival; the hourglass flip; the clock freeze (once); timer → death; bonus paint completion; a bonus timeout (no death); score and penalty; game over below 0 (exactly 0 is fine); a checkpoint every 5; fruit → bonus; determinism of a scripted run.
  - `campaign.test.ts` (13): the level order, fruit coverage, and per level: validation, reachability, and the solver.
  - `pillRoute.test.ts` (7), plus 3 in `pickups.test.ts` for the follow-ups.

## Solver: route vs par
The solver takes the nearest remaining key (then the exit, or on the bonus level the nearest unlit paint tile) with `findPathLasers` on a planning world where vanishing blocks count as gaps. Switch presses carry over between legs. It replays the moves in the real sim, pressing each one once the ball has settled, checks every landing pose, and requires `exit`/`painted` before the time limit.

| Level | Teaches | Route | Solver time | Par | Limit | Mechanic seen in the replay |
|---|---|---:|---:|---:|---:|---|
| sp-01 First Roll | rolling, turns, edge flips | 12 moves | 5.1 s | 15 s | 60 s | underside key |
| sp-02 Over the Edge | undersides, 1-gap jumps | 13 | 6.0 s | 15 s | 60 s | jump over the gap |
| sp-03 Up the Wall | climbing, jump vs hop | 19 | 7.5 s | 20 s | 60 s | climbs, wall-top gap |
| sp-04 Sharp Turns | spikes beside / on the path, retracting | 24 | 10.2 s | 25 s | 75 s | goes round the spikes |
| sp-05 Hot Steps ✓ | fire, crumble bridge | 22 | 8.3 s | 20 s | 70 s | crosses the bridge |
| sp-06 Glide | ice, arrows | 17 | 8.8 s | 20 s | 70 s | arrow lane to the exit |
| sp-07 Launch | far + high boosts, bouncy | 13 | 5.2 s | 15 s | 60 s | 2 boost launches |
| sp-08 Warp | teleporter across faces, hourglass | 20 | 7.4 s | 20 s | 45 s | 1 teleport |
| sp-09 Beams | laser gate + switch, sunglasses/invisible | 25 | 10.4 s | 30 s | 80 s | switch turns the gate off |
| sp-10 Finale ✓ | mix: vanishing bridge, clock, ice, spikes, crumble, fire | 28 | 12.8 s | 30 s | 90 s | — |
| sp-bonus-1 Paint Box | paint (44 tiles, top + 4 sides) | 55 | 17.4 s | 45 s | 60 s | 44 `paint`, `painted` |

✓ = checkpoint level. Par is about 2.5× the solver time and the limit about 5×, since humans turn and look around. The solver jumps a lot (a 2-cell jump costs the same 10 ticks as two rolls and saves a move), so it sometimes skips the intended lesson: it jumps sp-06's ice and sp-05's crumble bridge. It proves each level is beatable, not that it teaches.

Fruit: cherry sp-01, apple sp-02, banana sp-03, melon sp-04, grape sp-05. Collecting all 5 (each on a finished level) unlocks Paint Box after sp-05.

## Browser
- **Setup:** Chrome extension not connected, so I drove headless Chrome over CDP from a scratch Node script (built-in WebSocket, no new deps) against Vite on :5175. Keys went in as DOM `KeyboardEvent`s; routes came from the shared BFS imported into the page.
- **Main menu → New Game → sp-01 to completion:** card "Items 2500, Time bonus 53 s × 20 = 1060, Total 3560".
- **Next → sp-02:** turned round and jumped off the back end: "You fell off", then "−600 · restarting". The score went back to the level's starting score minus 600, and a READY countdown ran.
- **Pause:** Esc showed the menu, and the tick stayed frozen for 0.5 s. Restart Level gave "−600 · restarting" again.
- **sp-02 to completion:** card total 6310, score 8670.
- **Quit → Continue:** Next went to sp-03. Esc → Quit to Menu → Single Player showed "Continue · Level 3 · 8670", and Continue started sp-03.
- **Game over:** set the score to 100 and let the timer run out. The screen read "GAME OVER · back to the checkpoint: level 1", and Restart from checkpoint started sp-01 with score 0.
- **Multiplayer from the menu:** a throwaway server on :2568 (`?server=`). Name "Tester" → Join → lobby → R → a race-02 round with prediction on. The vote offered only pool levels. Server stopped after.
- **Network blocked:** `?server=ws://127.0.0.1:9` (nothing there), New Game, sp-01 completed. 0 WebSocket resources opened, no console errors.
- **Frame rate** (headless Chrome on the real GPU, D3D11/AMD Radeon, uncapped rAF):
  - About 106–119 fps average in the first 4 s windows, with some 300–600 ms stalls (first shader and asset use).
  - After that, rolling on sp-01 ran at **131 fps, worst frame 9 ms, 0 frames over 20 ms** in two 4 s windows.
  - Software rendering (SwiftShader) manages about 9 fps, so the scenario runs used long waits.
- **Per-frame allocations:** `LocalGame.update` and the SP HUD path allocate nothing per frame. The HUD object is reused, and the world → state mirror runs per tick at 20 Hz. The HUD builds HTML strings like the multiplayer HUD already does, and only touches the DOM when they change.
- **Found in the browser and fixed:** while a results card showed, the HUD already displayed the *next* level's label and counted the level's points twice. It also stored the best time rounded up while showing it rounded down. The HUD label and score now stay on the finished level while its card shows, and best times use the card's time.
- **Not checked:** no sound was listened to. The lethargy sway and the sunglasses reveal weren't looked at in single player (they're the same code as multiplayer).

## Screenshots
- Menu: ![](img/15b-menu.jpg)
- SP HUD: ![](img/15b-hud-sp.jpg)
- Results card: ![](img/15b-card-sp-01.jpg) ![](img/15b-card-sp-02.jpg)
- Death restart: ![](img/15b-death-restart.jpg)
- Pause: ![](img/15b-pause.jpg)
- Game over: ![](img/15b-gameover.jpg)
- Level Select: ![](img/15b-level-select.jpg)
- Settings: ![](img/15b-settings.jpg)
- Multiplayer round from the menu: ![](img/15b-mp-round.jpg)
- Levels (the menu's orbit view, panel hidden; items only show in play):
  - sp-01 ![](img/15b-sp-01.jpg)
  - sp-02 ![](img/15b-sp-02.jpg)
  - sp-03 ![](img/15b-sp-03.jpg)
  - sp-04 ![](img/15b-sp-04.jpg)
  - sp-05 ![](img/15b-sp-05.jpg)
  - sp-06 ![](img/15b-sp-06.jpg)
  - sp-07 ![](img/15b-sp-07.jpg)
  - sp-08 ![](img/15b-sp-08.jpg)
  - sp-09 ![](img/15b-sp-09.jpg)
  - sp-10 ![](img/15b-sp-10.jpg)
  - sp-bonus-1 ![](img/15b-sp-bonus-1.jpg), in play ![](img/15b-sp-bonus-1-play.jpg)

## Deviations (details in DECISIONS.md)
1. **A death restarts from the level's starting score** minus the penalty. The items reset, so their points do too.
2. **Checkpoints are saved on reaching levels 5 and 10.** Before level 5 a game over goes back to level 1 with score 0.
3. **A clock works once per attempt.** There's a 1 s READY countdown per attempt; the timer doesn't run during it.
4. **Fruit counts only on a finished level.** It's spent on the bonus level it unlocks, and kept if there's no bonus level left.
5. **Level Select starts a fresh run** from that level, with score 0.
6. **Settings** = volume + the F4 panel, now also in production builds (opened from the menu only).
7. **level:check changes for single player:** key/exit rules apply, 5.2 and 7.5 are skipped, and clock/paint count as harmless for 1.2.
8. **The bots weren't touched** beyond the `PILL_EXTRA` change. Campaign levels are never pooled.

## Open questions
1. **Deaths reset the level's points** (deviation 1). Kula's exact rule is fuzzy in my memory. Should the collected points survive a death instead? That would need a guard against farming coins.
2. **The early game over is harsh:** score 0 plus any death on levels 1–4 means game over, back to level 1. That's faithful to "below 0 = game over" but brutal for new players. Do you want a starting score (e.g. 1 000), or no game over before the first checkpoint?
3. **Par and time limits** are solver-based guesses (about 2.5× and 5×). They need a human playtest, especially sp-08 (45 s, where the hourglass matters).
4. **The paint bonus** (10 000 + time bonus) and paint needing a *landing* (a jump over a tile doesn't light it) are my picks.
5. **Level generator:** the campaign JSON was generated by a scratch Python script (not committed). The JSON files are the source now. Commit the generator if you'd rather edit levels as code.
