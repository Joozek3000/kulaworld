# Phase 17 report: Polish & readability (pre-itch)

## Summary
1. **Rename:** `GAME_NAME = 'Flipside'` and `GAME_VERSION` (root package.json, now 0.1.0) live in `client/src/config.ts`. They show in the `<title>`, the menu logo, the version in the menu corner (every menu screen, results cards included), game over, the campaign-complete screen, the lobby HUD and the README title. Code identifiers, `@kula/*` packages and save keys are unchanged. CLAUDE.md gained the rule "after each commit, `git push`".
2. **Gentler early game:** before the first checkpoint (levels 1–4) a death clamps the score at 0, so there's no game over there. Campaign tests updated: level 1 at 0 → still level 1 at 0; level 4 at 300 → 0; level 5 at 300 → game over.
3. **Fog and lighting:**
   - Tone mapping AgX → Neutral; hemisphere fill 1.6 → 1.0; key light 2.4 → 3.0; environment 0.4 → 0.3; exposure 1.0/1.1/1.0.
   - The fog is fitted every frame: nothing within 14 cells of the camera fades, and from afar (the fly-over, the menu orbit) it starts at the level's near side.
   - Only light, fog and tone values changed; no art assets.
4. **Fly-over:**
   - Single player: a new level's READY is 3 s, with one orbit fitted to the level's bounding sphere at 40°, then a smoothstep swoop into the follow cam. Keys, the exit and score items grow while it runs.
   - Multiplayer: the same, over the server's 3 s countdown, ending on your ball.
   - Any key skips it. A restart after a death keeps the 1 s READY with no fly-over.
5. **See more:**
   - **Free look:** hold Q and move the mouse, or use the right stick. Yaw ±180°, pitch ±60°, damped; it springs back on release, and movement still works while looking.
   - **X-ray silhouettes:** balls, keys, the exit and pills behind blocks draw as a flat 60 % silhouette in their colour (an inverted depth test on a child mesh).
   - **Off-screen arrows (multiplayer):** enemies within 8 cells who are off screen get an arrow at the screen edge in their colour, fading with distance.
6. **Island tints:** face-connected components of the static blocks. The largest keeps the plain glaze; the others get a light golden-angle hue wash. Levels can override per box or block with `"tint": "#rrggbb"`, which is validated. Presentation only.
7. **Controller + remapping:**
   - Gamepad API (standard mapping), hot-plug, a focus ring in menus, rumble, and a pad hint (bottom left) whenever the pad was used last.
   - Settings → Controls rebinds every gameplay action for the keyboard and the pad, saved in `kula.bindings`.
8. **Music:**
   - A `music` bus (own volume slider in Settings) and a `Music` player: slots menu / single (or `single-1…4` first) / race / knockout / results.
   - 1.5 s crossfades, looping, and a duck to 35 % under the win/lose stingers.
   - Only tracks listed in `public/music/credits.json` load, so a missing track is silence with no failed request.
   - `CREDITS.md` has the table to fill in, and the menu's Credits screen renders `credits.json`. No audio files are committed.
9. **Timing presets:**
   - `Rules.timing` → `world.timing`. classic = the current values (roll 5, turn 3, flip 6, climb 5, jump/hop 10, boost 12); snappy = roll 4, turn 2, flip 5, climb 4, jump/hop 8, boost 10.
   - Server: `TIMING=classic|snappy` in `.env`, synced as `GameState.timing`. The predictor and bots build their worlds with it.
   - Single player has a dev-only toggle in Settings.
   - Knocks, stuns, falls and teleports are the same in both presets.

## Checks
- `npm test`: **1006 passed** (4 skipped by design: push-off-only cases, now in both presets). `npm run typecheck`, `npm run build` and `npm run level:check` are clean.
- **New tests**
  - `snappy.test.ts` re-runs 11 core movement suites (sim, keyRace, heldJump, airTurn, climb, grace, push, stomp, rollUnder, moving, boost, determinism cases included) under snappy: 230 passed. Their tick counts come from live bindings in `test/util.ts`.
  - The predictor's 2000-tick determinism test runs under both presets (0 mispredictions).
  - `islands.test.ts` covers the island components.
  - The single-player tests cover the clamp.
- **Test changes:** `art.test.ts` skips the x-ray silhouettes when checking that a remaining key stays opaque. heldJump/airTurn now use the preset's `JUMP_TICKS`/`TURN_TICKS` instead of literals.

## Browser
Headless Chrome on the real GPU, driven over CDP (the Chrome extension wasn't connected); Vite on :5175, throwaway servers on :2568.
- **Rename:** title "Flipside", logo FLIPSIDE, "Flipside v0.1.0" in the corner.
- **Gamepad:** a **Gamepad API shim** (no physical pad here), i.e. a fake standard pad behind `navigator.getGamepads` whose buttons the script pressed.
  - Menus: Ⓐ picked Single Player, ▼ put the focus ring on New Game, Ⓐ confirmed it.
  - The pad played **sp-01 to its results card** (D-pad + Ⓐ along the BFS route), and Ⓐ started sp-02.
  - The pad hint appeared.
- **Fly-over:**
  - Single player: READY was 60 ticks on a new level and 20 after a death, with shots mid-orbit and after the swoop.
  - Multiplayer: the countdown fly-over over race-01 with 3 bots.
- **Free look:** Q + mouse gave yaw 1.56 rad, pitch 0.30 (clamped); release sprang back to 0/0.
- **X-ray:** with the camera pitched under arena-02's floor, the balls on top show through the blocks as flat silhouettes. The underside coins of sp-01 show through its plank during the fly-over.
- **Off-screen arrows:** up to 2 arrows at once with bots on race-01 and arena-02.
- **Tints:** race-01 (overrides), arena-02 (automatic: 71 + 11 blocks), race-06 (automatic: 15 islands), sp-10 (overrides).
- **Rebinding:** forward → I in Settings → Controls. The binding was saved to localStorage and survived a reload (`fwd = ["KeyI"]`); after that I rolled the ball and W didn't.
- **Music:**
  - Tested with two generated sine tones (440/660 Hz WAVs and a temporary `credits.json` entry, both removed before the commit).
  - The slot went `menu` in the menu → `single` in play (1.5 s crossfade) → none on the results card (no `results` track, so it faded to silence).
  - No console errors in any run.
- **`TIMING=snappy` in multiplayer with bots:** `GameState.timing` = snappy, the predictor built with snappy, the server logged `timing snappy`, and bots played with no STUCK.

## Soak
One server on :2569 (pool, `MIN_PLAYERS=4`, `TIMING=snappy`) and one bot process (`--count 4 --behaviour seek,bully,blocker,wander --skill 0.5`). **15 pool rounds, 0 STUCK, no errors.**

| # | Level | Winner (reason, tick) |
|---:|---|---|
| 1 | race-07 | seek (exit, 434) |
| 2 | arena-04 | bully (lastAlive, 854) |
| 3 | race-01 | seek (exit, 181) |
| 4 | race-06 | seek (exit, 313) |
| 5 | arena-06 | seek (lastAlive, 1486) |
| 6 | arena-03 | seek (lastAlive, 983) |
| 7 | race-01 | seek (exit, 649) |
| 8 | arena-07 | seek (lastAlive, 1259) |
| 9 | race-02 | seek (exit, 407) |
| 10 | arena-06 | blocker (lastAlive, 1090) |
| 11 | arena-04 | blocker (lastAlive, 1057) |
| 12 | arena-06 | blocker (lastAlive, 1610) |
| 13 | race-03 | seek (exit, 756) |
| 14 | race-01 | seek (exit, 370) |
| 15 | arena-06 | bully (lastAlive, 766) |

This server was started before I added `timing …` to the round log line, so its log doesn't show the preset. It was launched with `TIMING=snappy`, and the multiplayer runs above show the same setting reaching the clients.

## Screenshots
- **Fog before/after**, follow cam (sp-01, sp-06, sp-10; arena-01 peach dawn, arena-02 teal moon, arena-03 amber afterglow):
  - sp-01 ![](img/17-before-sp-01.jpg) ![](img/17-after-sp-01.jpg)
  - sp-06 ![](img/17-before-sp-06.jpg) ![](img/17-after-sp-06.jpg)
  - sp-10 ![](img/17-before-sp-10.jpg) ![](img/17-after-sp-10.jpg)
  - arena-01 ![](img/17-before-arena-01.jpg) ![](img/17-after-arena-01.jpg)
  - arena-02 ![](img/17-before-arena-02.jpg) ![](img/17-after-arena-02.jpg)
  - arena-03 ![](img/17-before-arena-03.jpg) ![](img/17-after-arena-03.jpg)
  - Overviews: ![](img/17-before-sp-10-orbit.jpg) ![](img/17-after-sp-10-orbit.jpg) ![](img/17-before-sp-06-orbit.jpg) ![](img/17-after-sp-06-orbit.jpg)
- Menu (rename + version): ![](img/17-menu.jpg)
- Fly-over: ![](img/17-flyover-1.jpg) ![](img/17-flyover-2.jpg) ![](img/17-flyover-end-follow.jpg); multiplayer ![](img/17-mp-race-01-flyover.jpg)
- Free look: ![](img/17-freelook.jpg), released ![](img/17-freelook-released.jpg)
- X-ray: ![](img/17-mp-arena-02-xray.jpg) ![](img/17-mp-race-01-xray.jpg)
- Off-screen arrows: ![](img/17-mp-race-01-arrows.jpg)
- Island tints: race-01 ![](img/17-tints-race-01.jpg), arena-02 ![](img/17-tints-arena-02.jpg) ![](img/17-mp-arena-02-tints.jpg), sp-10 ![](img/17-tints-sp-10.jpg), race-06 ![](img/17-tints-race-06.jpg)
- Controls / Settings / pad hint: ![](img/17-controls.jpg) ![](img/17-settings.jpg) ![](img/17-pad-hint.jpg)

## Gamepad mapping (standard mapping)
| Input | In play | In menus | Lobby |
|---|---|---|---|
| Left stick up / D-pad ▲ | roll forward (held) | focus up | — |
| Left stick ←→ / D-pad ◀ ▶ | turn (edge-triggered, deadzone 0.5, release under 0.3: no repeats) | — | — |
| D-pad ▼ / left stick down | — | focus down | — |
| Ⓐ | jump (held = keep bouncing) | confirm | — |
| Ⓑ | ready | confirm | ready |
| Ⓧ / Ⓨ | — | — | vote: next / previous option |
| Start | pause | pause / resume | — |
| Back | mute | — | — |
| Right stick | free look (deflection = angle) | — | — |
| R3 | free look (held) | — | — |
| LB / RB | unused | | |

The D-pad, Ⓐ, Ⓑ, Start, Back and R3 are the defaults of rebindable actions (Settings → Controls). The sticks are fixed. Rumble fires on a push, stomp, bounce or death involving you.

## How to add music (3 steps)
1. Put the file in `packages/client/public/music/`, e.g. `race.ogg` (ogg or mp3).
2. Add it to `packages/client/public/music/credits.json`:
   `{ "slot": "race", "file": "race.ogg", "track": "…", "artist": "…", "source": "https://…", "licence": "CC0" }`
   Slots: `menu`, `single` (or `single-1`…`single-4` for campaign worlds of 5 levels), `race`, `knockout`, `results`.
3. Fill in the same row in `CREDITS.md`. The menu's Credits screen shows it.

## Deviations (details in DECISIONS.md)
1. **Free look on keyboard** is Q + mouse: there's no spare key axis. On the pad it's the right stick, or R3 held.
2. **Pad voting:** Ⓧ/Ⓨ step the vote to the next/previous option. In menus Ⓐ and Ⓑ both confirm.
3. **Rebindable actions** are roll, turn ×2, jump, look, ready, pause and mute. Votes 1–4, volume and the F-keys stay fixed.
4. **Tints:** most pool levels are one connected piece (their bridges join the islands), so automatic tints only show where islands are really separate (arena-02, arena-05, race-06, sp-02, sp-07–09). race-01 and sp-10 got explicit `tint` overrides.
5. **Music loads only tracks listed in `credits.json`,** so a missing slot makes no request.
6. **Timing presets** leave knocks, stuns, falls and teleports alone. level:check keeps classic walking speed.

## Open questions
1. **Timing:** classic or snappy? Both pass the full suite and the soak.
2. **Tint strength:** race-01's overrides read clearly, but the green island is fairly strong over the celadon glaze. Would you like paler washes?
3. **Other pool levels:** should they get `tint` overrides so their conceptual islands read (e.g. arena-01, race-02–05), or only the levels whose islands really are separate?
4. **Keyboard free look:** is Q + mouse right? An alternative is Q + the movement keys (look instead of move while Q is held).
5. **CI:** I pushed, but I can't see the private repo's Actions from here; please check that CI is green.
