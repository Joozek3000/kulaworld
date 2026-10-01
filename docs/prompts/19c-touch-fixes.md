# Phase 19c: Touch fixes (no more random turns) + 19b follow-ups

Read first: `CLAUDE.md` (commit **and push**), `docs/ARCHITECTURE.md` §25 (updated: the Buttons layout, the Stick fixes, turn around), `docs/reports/19b-report.md`, `packages/client/src/input/touch.ts`.

## Why
Jakub's phone test: **"random turns when holding forward".** The 19b d-pad is the cause:
- The forward sector is only 45° wide, so a drifting thumb lands in NE/NW and fires a turn.
- The floating centre makes it worse: there's no fixed spot to rest on.

## Task 1: Buttons layout (new default)
1. **Fixed ◀ ▲ ▶ cluster**, bottom-left (mirrored when left-handed).
   - ▲ is the largest, raised above the two turn buttons.
   - ~16 px dead gaps between the buttons.
   - The buttons scale with Button size.
2. **Behaviour per §25:**
   - ▲ hold = forward.
   - A tap on ◀ or ▶ = one turn pulse on touch-down.
   - Two quick taps = 180°.
   - **Slide from ▲ onto ◀/▶:** one turn, and forward stays held while that finger stays down. Sliding back onto ▲ doesn't turn.
   - Drift inside ▲ or the gaps never turns.
   - Hit-testing uses each button's rectangle (slightly enlarged), not angles.
3. **Right thumb unchanged:** Jump, and the look drag on empty space. Forward jump = hold ▲ (left thumb) + Jump (right thumb).
4. **Settings → Touch controls → Layout: Buttons / Stick.** Buttons is the default, and existing saved settings move to Buttons too.

## Task 2: Stick fixes (the alternative layout)
1. **Sectors:**
   - forward cone ±40°
   - E/W only beyond ±65°, with hysteresis
   - in the bands, keep forward with no turn
   - no diagonal turns
   - S = 180°
   - dead zone 15 %
2. **Centre:** fixed by default, with a "Floating stick" toggle.
3. **Tests:** a drift test. Hold N, then wander ±35° for 3 s with noise: **zero turn pulses**. Also a deliberate E flick gives one pulse, and hysteresis at the ±65° edge doesn't chatter.

## Task 3: Turn around (180°)
1. Keyboard **S / ↓**, pad **▼**, and Stick S send a 180° turn as two turn pulses. Add it to the rebinding screen as "Turn around".
2. **Check the input buffer:** a second turn pulse that arrives while the first turn is running must queue, not be dropped or expire, so double-tap and S both make a full 180°. Add a test for it in shared (the pulse buffer). If you change the buffer, log it in DECISIONS, and make sure prediction and server stay identical (the determinism tests).

## Task 4: 19b follow-ups
1. **Own silhouette on the support block:** in `19b-phone-dpad.jpg`, your ball's lower half shows an orange overlay. That's the silhouette where the ball dips into the tile it rests on (squash/bounce).
   - The block under the ball, or anything within ~0.3 cell of the ball's contact point, must not trigger it. Use a polygon offset on the stencil pass or a depth bias.
   - Check it on flat ground, mid-bounce and on ice. Add the case to the raster test.
2. **FPS/ping readout:** it overlaps the lobby panel (`19b-phone-lobby.jpg`). Move it to the top-left under Pause, and hide it while a HUD panel (lobby, results, stats) is open.
3. **Phone lobby fits:** at 844×390 the whole lobby, vote counts included, fits without scrolling, with Ready below it and not overlapping. Use shorter level-card thumbnails on small screens and a smaller header row. Screenshot it.
4. **Graphics Auto:** it stays on Low for the session once dropped (decided). No change.

## Acceptance
- [ ] Unit tests: the Buttons hit tests (tap, slide ▲→◀ keeps forward, slide back, drift in gaps), the Stick drift test, turn-around queueing, and the silhouette contact case.
- [ ] CDP touch emulation:
  - Hold ▲ with ±30 px random drift for 5 s: the ball rolls straight, with no turns.
  - Slide ▲→◀→▲: one turn, and it keeps rolling.
  - Double-tap ▶: 180°.
- [ ] Screenshots: the Buttons layout (phone + iPad), the Stick, the phone lobby fitting, and the ball on flat ground with no overlay.
- [ ] typecheck, test, level:check pass. Commit `phase 19c: touch fixes`, push.
- [ ] **Deploy:** Jakub approves `npm run deploy` for this phase (approve the tool call when it asks). Then fill in 19b's pending Fly numbers (cold start, image size) in the 19c report.
- [ ] **Jakub on his phone** (stop and ask):
  - Buttons layout: does holding forward still turn randomly?
  - How do slide-turn, double-tap 180°, held-jump bounce and jump-forward feel?
  - FPS and ping on High and Low, the airplane-mode reconnect, and whether sound plays on iPhone.

## Report: `docs/reports/19c-report.md`
Short: what changed, the screenshots, the Fly numbers, and Jakub's phone results.
