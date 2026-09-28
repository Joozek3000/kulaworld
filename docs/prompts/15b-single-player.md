# Phase 15b: Single player (Kula World campaign)

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` §22 (new: this phase's spec), §18/§21 (traps, pills), `docs/LEVEL-DESIGN.md` (§9 single-player notes plus all rules), `docs/reports/15a-report.md`.

## Task 0: Housekeeping and 15a follow-ups
1. **Art integration commit.** The art agent's environment-kit integration is finished (`docs/reports/environment-integration-report.md`) but uncommitted: `art.ts`, `level.ts`, `preview.ts`, `scene.ts`, `traps.ts`, `traps2.ts`, `art.test.ts`, one `main.ts` hunk, `docs/ART-SOUND.md`, its DECISIONS entry, `assets/art/sky-pack-v02`, `assets/models/environment-kit-v02`, `packages/client/public/models/environment-kit-v02` and `packages/client/public/sky/*.jpg`.
   - If `npm test` and `npm run build` pass, commit it alone first as `art: environment kit v02 + sky pack`. Check `.gitattributes` covers any new binary types.
2. **15a open questions (decisions):**
   1. Move race pills to within 2 moves of a main key route (keep §11). Seek's detour allowance becomes ≤ 4 extra moves.
   2. `randomPickups` gets optional `weights`. Default: lethargy 15 %, the others split the rest. The bully's lethargy push stays as it is (humans will do it).
   3. Bouncy doesn't change forced moves: ice slides stay slides while bouncy.
   4. A fall onto a heavy ball: the faller rebounds and re-hops (like a hop landing on a non-stompable ball), with no overlap.

   Each gets a test, and the whole thing is one commit: `phase 15a follow-ups`.

## Task 1: Local runtime
- A `LocalGame` in the client runs `createWorld` + `step` at 20 Hz (fixed step, accumulator) with the local player only, and feeds the existing renderer, HUD and audio with the same state shape the network path provides. Structure it so the renderer doesn't care whether the state is local or networked: one adapter interface, two implementations.
- Input goes straight to `setInput` (no prediction). Rendering happens at the local tick with interpolation, and there's no server delay.
- **Rules:** `mode: "single"` in the level (or the campaign) means push is irrelevant, heat off, crumble regrow off, sudden death off.

## Task 2: Game flow and UI
- **Main menu:**
  - options: Single Player (Continue / New Game / Level Select for reached levels), Multiplayer (the existing lobby flow with a name field), Settings (volume sliders, the existing F4 values), and Reset Progress (confirm)
  - style: ceramic/lavender, over a slowly orbiting level
- **Pause menu** (Esc) in single player: Resume, Restart Level, Quit to Menu.
- **Single-player HUD:** score, a level timer (flashing under 10 s), keys x/total, fruit collected (5 slots), the active pill rings (existing), and the level name.
- **Results card per level:** time bonus, items and total, then Next level.
- **Game over screen:** restart from the checkpoint.

## Task 3: Sim additions (§22)
- **Items:** `coin`, `gem`, `fruit` (kind), `hourglass` (flip timer), and a `clock` tile (5 s freeze).
- **Score, timer and death:** penalty, restart, game over and checkpoints.
- **Bonus-level `paint` tiles:** a "lit" state per tile, win when all are lit, and a paint counter in the HUD.
- **Events** for each.
- **Tests:**
  - item collection by every finish kind
  - the hourglass flip maths
  - the clock freeze
  - timer to 0 = a death
  - score and penalty maths
  - game over below 0
  - checkpoint every 5
  - fruit unlocking a bonus level
  - bonus paint completion
  - determinism of a scripted run

## Task 4: Campaign levels (10 + 1 bonus)
Kula-style, following LEVEL-DESIGN (§9: introduce one new mechanic per 2–3 levels, first in a safe teaching layout). All keys are required in single player. Each level has a par time and coins/gems placed to reward exploring undersides and edges.

| # | Name (suggested) | Teaches |
|---|---|---|
| sp-01 | First Roll | rolling, turning, edge flips, keys → exit |
| sp-02 | Over the Edge | undersides, jumps over 1-gaps |
| sp-03 | Up the Wall | climbing, hop vs forward jump |
| sp-04 | Sharp Turns | static spikes (beside the path first, then on it), retracting spikes |
| sp-05 | Hot Steps | fire (the 3-in-a-row rule), crumble bridges — **checkpoint** |
| sp-06 | Glide | ice slides, arrows |
| sp-07 | Launch | boost pads, bouncy pill |
| sp-08 | Warp | teleporters across faces, the hourglass |
| sp-09 | Beams | lasers + switches, sunglasses + invisible blocks |
| sp-10 | Finale | a mix, with vanishing blocks and a clock tile — **checkpoint** |
| sp-bonus-1 | Paint Box | a bonus paint level (unlocked by 5 fruits) |

- Each level: validate; a reachability test (every key and the exit from the spawn in single-player rules); a scripted **solver** test that finds a key→exit route with the BFS and replays it in the sim within the time limit, proving each level is beatable; a screenshot.
- Exclude the `sp-*` levels from the multiplayer pool (`"pool": false`, `"campaign": n`).

## Task 5: Save and progress
- localStorage (try/catch; the game must work without it): the highest level, checkpoint score, fruits, best times and settings.

## Acceptance checklist
- [ ] Task 0 commits done first (art, then 15a follow-ups)
- [ ] Tests, typecheck, build and `level:check` are clean
- [ ] Browser:
  - main menu → New Game → play sp-01 and sp-02 to completion
  - die once, and see the penalty and restart
  - pause and restart
  - quit → Continue resumes at the right level
  - multiplayer from the menu still works (lobby → round)
- [ ] With the network blocked (no server running), single player still works
- [ ] 60 fps in single player; no per-frame allocations were added

## Report: `docs/reports/15b-report.md`
- Screenshots: the menu, the SP HUD, a results card, game over, and one screenshot per campaign level
- Solver results (route length vs par) per level
- Open questions

Then commit: `phase 15b: single player`.
