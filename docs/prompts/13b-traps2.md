# Phase 13b: Traps part 2 (teleporters, lasers + switches, invisible and vanishing blocks)

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` §18 ("13b rules", already specced), §14/§16/§20 (push, stomp, moving collisions), `docs/LEVEL-DESIGN.md` (new §10), `docs/reports/14d-report.md`.

**Working tree:** `art.ts`, `level.ts`, `docs/ART-SOUND.md` and the untracked `assets/art/sky-pack-v02`, `assets/models/environment-kit-v02`, `packages/client/public/models/environment-kit-v02` and `packages/client/public/sky/*.jpg` are **another agent's unfinished art integration**. Don't commit them. If you need to change `art.ts` or `level.ts` for this phase, tell Jakub in the report instead of mixing edits. Keep the tests passing without their WIP (the same as in 14d).

## Task 1: Sim (per §18 13b rules)
1. **Teleporters** (`"type": "teleport", "face", "pair": "A"`):
   - Arriving on one by roll, flip, climb, slide or knock starts `Action.Teleport` (appended, 6 ticks, render fade out/in). The ball arrives on the partner tile with the same facing relative to the face: apply the rotation that maps the source face's up onto the target face's up to fwd.
   - If the partner cell is occupied or reserved, **hold** like a boost Charge (up to 10 ticks), then release as a plain tile.
   - A ball that teleported can't re-trigger until it leaves the arrival tile (no ping-pong).
   - A knock onto a teleporter teleports (combo). Arrival onto a standing ball isn't possible (the hold covers it).
2. **Lasers + switches:**
   - Level format: `"lasers": [{ "group": "red", "from": [x,y,z], "dir": "+X", "length": 5, "on": true }]`. The beam covers `length` air cells starting at `from` along `dir`; `from` sits next to an emitter block the renderer draws.
   - Switch tiles: `{ "block", "face", "type": "switch", "group": "red" }`. A ball finishing an action on it toggles the group, with a 20-tick cooldown per switch.
   - A ball whose action finishes in a beam cell, **or passes through one** (roll/flip/slide from→to cells, jump or boost flight cells, knock path), dies (cause `laser`).
   - Group states are synced in the schema.
3. **Invisible blocks:** `"invisible": true` on blocks or boxes. Solid in the sim. Rendering is in Task 4.
4. **Vanishing blocks:**
   - `"vanish": { "period": 60, "on": 40, "phase": 0 }` on blocks or boxes. Solid only during the on-window, via the `removed` overlay, derived from the tick with no extra sync.
   - A ball standing on one when it vanishes starts a fall.
   - A ball can't roll into a cell whose block will vanish before the roll ends? **No.** Keep it simple: it's checked at action finish as usual.
5. **BFS / `resultPose`:** follow teleports; treat active beams as lethal and inactive beams as passable at the current state; treat vanishing blocks as not solid for planning (like retracting spikes = lethal).
6. **Predictor:** runs the same rules. Laser group states come from server state each patch.

## Task 2: Level checker (LEVEL-DESIGN §10)
- Implement §10 [E] and [W].
- The laser soft-lock check runs a BFS over (pose, group states) with switches as state edges.
- Mark `traps-lab` `"lab": true` so its errors stop failing or being reported as pool errors.
- Add teleport, laser, switch, invisible and vanish lanes to traps-lab.

## Task 3: Levels
- **race-05 "Underside":** add the invisible beam at z=5 from x=2 to x=9 (the counter-direction shortcut from 14), and check it's not the only route.
- **New `race-07` "Switchyard"** (pool): a race built around 2 laser groups and switches. Keys behind beams that you open for yourself, or close on chasers. One teleporter pair as the return route. 8 spawns.
- **New `arena-07` "Warp Ring"** (pool, knockout): a plate ring with 2 teleporter pairs across it, and vanishing blocks on the inner ring, so the floor blinks. Crumble on as usual.
- Add 1 laser gate (with a switch on each side) to an existing race level of your choice, and invisible stepping blocks to one knockout level, so every 13b type is in ≥ 2 pool levels.
- `level:stats` gains the new columns.

## Task 4: Client (ceramic/lavender style, procedural placeholders)
- **Teleporter:** a glowing ring pad with a swirl, in its pair colour (both ends match), plus a fade-out/in and a "vwoop" sound.
- **Laser:** emitter nubs on the blocks and a thin bright beam (additive, slight flicker) in the group colour. Off beams show as faint dotted guides. A buzzing sound near active beams (positional), and a zap on death.
- **Switch:** a round button in the group colour. It pushes down with a click when toggled. The HUD toasts "Red lasers OFF".
- **Invisible:** blocks are rendered only within 2 cells of the local ball (a fading shimmer at 2–3 cells). There's also a hook for the 15a sunglasses pickup (`revealInvisible` flag).
- **Vanishing:** blocks fade out and in on schedule, and flicker for 0.5 s before vanishing.

## Task 5: Bots
- They use teleports and avoid active beams.
- The bully may toggle a switch when a victim is in or next to that group's beam path.
- **Head-on re-charge fix (14d report):** after a head-on bounce with ball X, don't target X head-on again for 2 s.

## Tests
- **Teleport:** each entry kind; the facing mapping across different faces (all 6 source/target up pairs); hold, then release; no ping-pong; knock → teleport; prediction solo = 0 mispredictions.
- **Lasers:** finish in a beam → death; pass through with a roll or jump → death; toggle by switch; the cooldown; group state after a round reset; beam on/off by level default.
- **Invisible:** solid for movement and BFS.
- **Vanishing:** the schedule; a ball standing on one falls; the passable-lane simulation.
- **Checker:** a failing fixture per §10 [E] rule, including the laser soft-lock.
- **Determinism** with all 13b types.
- All older suites pass.

## Acceptance checklist
- [ ] Tests, typecheck, build and `level:check` are clean (pool 0 errors; traps-lab exempt)
- [ ] Browser: teleport across faces with the camera following, toggle lasers with a switch and zap a scripted player, invisible blocks appear near you, and vanishing floor blinks and drops you
- [ ] Soak (one server + one bot process): 10 pool rounds with `seek,bully,blocker,wander`, no errors or STUCK, and deaths by cause including `laser`

## Report: `docs/reports/13b-report.md`
Then commit: `phase 13b: traps part 2`.
