# Phase 19b: Touch controls (phones and tablets)

Read first: `CLAUDE.md` (commit **and push**), `docs/ARCHITECTURE.md` §25 (new: this phase's spec), §5, §6, §11, `packages/client/src/input.ts` and `bindings.ts`.
**Start only after `phase 19: online hosting` is committed.** If you already began touch controls as a side quest in phase 19, move that work here and finish it to this spec.

## Task 0: Phase 19 follow-ups (decisions)
1. **Bundle the server** at image build with esbuild (approved as a dev dependency). The runtime runs plain `node dist/server.js`, with no tsx at runtime.
   - Target: `/health` answering within ~4 s of a cold start (it's ~10 s now).
   - Report before/after cold-start times, and the image size.
   - `npm run start:prod` uses the bundle too.
2. **"Fill with bots" stays at 4 players.** The host can still add more with +.
3. **Crown position:** it floats about a ball-height above the ball, so up close it reads as belonging to whatever is behind (`19-crown-near.jpg`).
   - Seat it just above the ball's top (a gap ≤ 0.15 ball radius), and scale it from its base so it stays seated at every distance scale.
4. **Own-ball silhouette only through blocks:** in `19-crown-near.jpg`, your hidden ball draws its red silhouette over the enemy ball in front of you, which looks like the enemy's colour.
   - The silhouette should show only where level blocks hide your ball, not other balls, the crown or items.
   - Add a render test.

Commit these separately: `phase 19 follow-ups`, then push. Deploy once at the end of 19b (not twice).

## Tasks
1. **`input/touch.ts`:** a third input source next to the keyboard and the pad.
   - It feeds the same held/pulse state that `setupInput` sends, so there's no new message type and the "sends only on change" rule still holds.
   - Multi-touch: the d-pad and Jump at the same time, plus a look drag.
   - Release everything on `touchcancel`, blur and `visibilitychange`.
2. **Pure mapping (testable):** `dpadSectors(dx, dy, radius) → { fwd: boolean, turn: -1|0|1 }` and an edge detector that fires one turn pulse on entering E/W/NE/NW. Follow the §25 table exactly, including the dead zone and a floating centre that re-centres per touch.
3. **UI (HTML/CSS over the canvas):**
   - Left: the d-pad, with a ring and a thumb dot that follows the finger. Its sectors light up while pressed.
   - Right: Jump (large). A drag on the empty right half is free look.
   - Top-left: Pause. Ready (large, bottom centre) shows in the lobby and on results only.
   - Semi-transparent, respecting the opacity/size/left-handed settings and safe-area insets.
   - Nothing may cover the HUD timer, keys or scoreboard. Make the scoreboard compact on small screens.
4. **Menus on touch:**
   - All buttons ≥ 44 px.
   - The name and room-code inputs work with the on-screen keyboard (code input uppercase, `autocapitalize`, `inputmode`).
   - Hide the rebinding screen when touch is active and show the touch settings instead.
   - Pause menu: add Mute and Quit to menu.
5. **Portrait and fullscreen:**
   - "Rotate your device" overlay during gameplay in portrait.
   - Request fullscreen + `screen.orientation.lock('landscape')` on the first Play tap (in try/catch; iOS Safari may refuse, and that's fine).
   - Add a web-app manifest and icons (placeholder icon from the logo colours), and `apple-mobile-web-app-capable` meta.
6. **Browser hygiene per §25:** touch-action, no zoom, no selection or long-press menu, overscroll, `viewport-fit=cover`, and audio unlock on the first touch (check iOS).
7. **Settings:**
   - Touch controls: Auto / On / Off.
   - Button size S / M / L, opacity, left-handed, haptics.
   - Graphics: Auto / High / Low per §25 (pixel ratio cap, shadows, particles, and the auto-drop rule).
   - All settings saved with try/catch storage.
8. **Tests:**
   - the sector mapping (every sector, dead zone, boundaries)
   - the pulse edge (one pulse per sector entry, none while holding, one on each re-entry)
   - multi-touch independence (a jump while holding forward)
   - release on cancel
   - Auto show/hide on the first touch vs a keyboard press
   - the graphics auto-drop threshold logic

## Acceptance
Test on the deployed site: after tests pass, run `npm run deploy`, then use `https://flipside-game.fly.dev`.
- [ ] Chrome devtools device emulation (a phone in landscape, and an iPad): screenshots of play, lobby with Ready, pause menu, touch settings, portrait overlay.
- [ ] **Jakub on his phone** (stop and ask, like the 19 phone check):
  - Complete single-player levels 1–3.
  - Play one multiplayer match against server bots.
  - Report whether turning mid-roll, held-jump bounce and jump-forward feel right, the FPS and ping (add a small on-screen FPS/ping toggle in touch settings, since there's no F3 key), and the airplane-mode reconnect (10 s off, then back: same seat).
- [ ] If Jakub has a tablet: the same quick check.
- [ ] Keyboard and gamepad still work on desktop, and the touch UI never shows there unless forced On.
- [ ] typecheck, test, level:check pass.

## Report: `docs/reports/19b-report.md`
- What was built, the screenshots, and Jakub's phone results.
- Devices and browsers tested, the FPS on the phone at High and Low.
- Deviations and open questions (e.g. should S on the d-pad do a 180° turn?).

Commit: `phase 19b: touch controls`, push, then `npm run deploy`.
