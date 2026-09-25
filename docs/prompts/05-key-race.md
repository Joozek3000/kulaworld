# Phase 05: Key Race complete + seek bots

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§8, §11, §12), `docs/DECISIONS.md`, `docs/reports/04-report.md`.

## Goal
A full, readable round of Key Race that you can play solo against smart bots.

## Tasks
1. HUD (HTML/CSS overlay):
   - lobby: player list with colour dot, name and ready state, plus the "Press R to ready" hint
   - countdown: big 3-2-1
   - playing: timer, own keys x/required, a compact scoreboard (keys per player), and an exit status line ("Exit locked" / "Exit OPEN")
   - results: winner banner or "Draw", final key counts, and a countdown to the lobby
2. Event feedback from `event` messages:
   - key pickup: the key pops/fades and a toast shows "Bob got a key (2/3)"
   - death: a brief fade at the fall point
   - win: a highlight on the winner
   - placeholder beeps via WebAudio oscillator (no audio files), with a mute toggle (M)
3. Exit visual: unlocked (green) only for players with enough keys, evaluated per local player.
4. Seek bots (`--behaviour seek`):
   - BFS over `(cell, up, fwd)` using `previewAction` from shared, ignoring other players
   - target: the nearest remaining key, or the exit once unlocked
   - replan when its target key disappears or it gets blocked twice
   - mixable: `--count 3 --behaviour seek,wander`
5. Level `race-01.json`: a first real layout (about 3–4 connected structures, flips needed to reach at least half the keys, one jump shortcut). 7 keys, keysRequired 3, 120 s.
6. `LEVEL` also accepts a comma list and rotates levels each round.

## Notes from the 04/04b/04c reviews
- **Input buffer fix (small sim change, do it first):** buffered pulses (turn and jump) don't expire while the player is in an airborne or timed action (Hop, Jump, Fall). Expiry counts only Idle ticks. Add tests: a turn pressed in the first tick of a hop is applied on landing; a turn pressed while Idle and blocked still expires after INPUT_BUFFER_TICKS. Log it in DECISIONS.md.
- **Leave timings alone.** Jakub will tune JUMP_TICKS etc. after this phase, so just list suggestions in the report.
- **Seek bots and inputs:** holding fwd chains rolls, so a bot executing a BFS path must press fwd for one step and release it once its Roll/Flip has started (as seen in the schema), or it will overshoot. The BFS `jump` step = jump pulse sent together with fwdHeld true; release both once the Jump starts. Turns = turn pulses. Only issue the next step when the bot's action is Idle, or within the last tick of the current action.
- **Blob shadows** already exist (04c). HUD work shouldn't touch them.

## Acceptance checklist
- [ ] Solo + 3 seek bots on race-01: rounds finish by win. Bots win some rounds, and you can win others.
- [ ] A seek bot never gets stuck for > 10 s. If one does, log the state and fix the bug.
- [ ] Round loop runs 10 rounds unattended with bots only, without errors
- [ ] HUD readable at 1280×720 and 1920×1080
- [ ] Tests and typecheck pass (add BFS unit tests on test-cube: reachable key found, path length is optimal)

## Report: `docs/reports/05-report.md`
- 10-round bot stats (winner, duration, keys)
- Screenshots: lobby, playing HUD, results
- Your own playtest notes: what felt good/bad (movement speed, camera, jump)
- Suggested constant tweaks (don't apply without logging)
- Recommendation: is client prediction needed? Is bump/knockback the next feature?

Then commit: `phase 05: key race MVP`.
