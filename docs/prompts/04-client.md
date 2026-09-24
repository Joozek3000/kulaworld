# Phase 04: Client rendering, camera, controls

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§10 client time and rendering, §11), `docs/DECISIONS.md`, `docs/reports/03-report.md`.

## Goal
Play the game in a browser: see the level, your ball and other balls moving smoothly, with a follow camera that rotates cleanly through flips.

## Tasks
1. `shared/pose.ts`: `poseAt(action, from, to, progress) → { position: [x,y,z], quat: [x,y,z,w], up: [x,y,z] }` per §10. Tests:
   - roll/turn/jump/flip start, mid and end points (flip mid-point is on the arc around edge E)
   - `up` at flip progress 0.5 is the normalised (U+F)
   - progress is clamped to 0–1
2. `net.ts`: connect, expose state, send `input`/`ready`, and track `estServerTick` (smoothed, never goes backwards, snaps if error > 5 ticks). Add ping measurement.
3. `input.ts`: keyboard per §11. Send only on change. Pulses are sent once per key press, and key repeat is ignored. Losing window focus releases held forward.
4. `render/`:
   - level `InstancedMesh` + edge lines, lighting and fog
   - balls: two-hemisphere spheres in the player colour, rolling rotation from the pose quat
   - keys (spinning octahedron) and exit (torus, locked/unlocked colour)
   - CSS2D name labels for others
   - hide Dead players; spectators are not shown
5. `camera.ts`: follow cam per §11, driven by the local player's pose `up` and fwd. Damp the position and quaternion (frame-rate independent). No roll or gimbal flip when up changes by 90°. Test the math where possible.
6. `ui/debug.ts`: F3 overlay per §11 plus the FPS.
7. Minimal HUD placeholder: phase text, and a ready hint in the lobby (full HUD is phase 05).

## Constraints
- The client never decides movement. It only renders `poseAt` from server state at `renderTick`.
- 60 fps target on a mid laptop with 8 players on test-cube. Don't allocate per frame in the render loop.

## Acceptance checklist
- [ ] Two tabs: each sees both balls. Movement is smooth, with no stepping at 20 Hz.
- [ ] Holding W rolls continuously with no stutter between tiles
- [ ] Rolling around all 6 faces of test-cube: the camera flips smoothly each time and controls stay intuitive (left is always screen-left)
- [ ] Jumping a 1-gap on test-flat works; the 2-gap drops you, you die and respawn
- [ ] `LATENCY_MS=150` in `.env`: still smooth, only delayed
- [ ] Phone on LAN can join (`?server=ws://<pc-ip>:2567`) and render (controls on phone not required)
- [ ] Tests and typecheck pass

## Report: `docs/reports/04-report.md`
- Screenshots (save to `docs/reports/img/`): lobby, mid-flip, 4 players on the cube
- Perceived input latency at 0 and 150 ms (your judgement) and whether client prediction looks necessary
- Perf numbers (FPS, draw calls) with 8 players
- Deviations, open questions/risks

Then commit: `phase 04: client`.
