# Phase 17: Polish & readability (pre-itch)

Read first: `CLAUDE.md`, `README.md`, `docs/ARCHITECTURE.md` (§10 rendering, §17 prediction, §22 single player), `docs/reports/15b-report.md`.

## Context
- The game is being polished before it goes public. The public name is now **Flipside** (a working title; Kula World is Sony's).
- Lessons from player reviews of *Axyz* (a Kula-like released 2025):
  - players loved the bird's-eye level overview before each level, and the soundtrack
  - they complained about a limited camera ("no way to see through platforms"), levels that are hard to *read*, no distinct island colours, a harsh lives system, and missing controller remapping
- The repo has a GitHub remote. **After each commit, `git push`.** Add that rule to CLAUDE.md's hard rules.

## Task 1: Rename (player-facing only)
- `GAME_NAME = 'Flipside'` and `GAME_VERSION` (set the root package.json to `0.1.0`) in one client config module.
- Use them for the `<title>`, the menu logo (`KULAWORLD` in `ui/menu.ts`), the results/game-over screens, the HUD and the README title ("Flipside (working title; repo name kulaworld)").
- Show the version in the menu corner.
- Replace "Kula" in user-visible strings. Keep code identifiers, `@kula/*` package names and the save keys unchanged.

## Task 2: Gentler early game
- Before the first checkpoint (levels 1–4) the score is clamped at 0, so there's no game over there. Update the campaign tests.

## Task 3: Fog and lighting readability
- The screenshots look hazy.
- Everything within ~12 cells of the camera should be crisp and full-contrast; only far structure fades. Check the exposure/tone mapping isn't lifting blacks.
- Before/after screenshots on sp-01, sp-06, sp-10 and one arena under each of the 3 skies.
- Only change the fog, exposure and light values, not the art assets.

## Task 4: Level overview fly-over
- Single player: at the start of each level (during the READY phase, extended to ~3 s), the camera orbits once over the whole level (fitted to the bounds), with keys, exit and items highlighted, then swoops into the follow cam. Any key skips it.
- Multiplayer: during the countdown, the same orbit, ending on your ball.
- Restarting after a death skips the fly-over.

## Task 5: See more (camera)
1. **Free look:** hold `Q` (or the right stick) to orbit the camera around your ball on its up axis (±180°) and pitch (±60°). Release to spring back. Kula's look up/down is covered by the pitch. Movement input still works while looking.
2. **X-ray outlines:** balls, keys, the exit and pills hidden behind blocks from the camera's view render as coloured silhouettes (a second pass with depth test inverted, or a stencil), in their colour and at ~60 % opacity. This matters most for enemies on other faces in multiplayer.
3. **Off-screen indicators (multiplayer):** small arrows at the screen edge pointing to enemies within ~8 cells who are off-screen, in their colour, fading with distance.

## Task 6: Island tints
- Compute connected components of the level (blocks touching face-to-face). Give each component a subtle distinct tint (hue shift on the base glaze, keeping the art style). This is presentation only.
- A level can override tints per box in JSON (`"tint": "#hex"`).
- Screenshots of race-01, arena-02 and sp-10.

## Task 7: Controller support + key remapping
- **Gamepad API** (standard mapping):
  - D-pad/left stick up = forward (held), left/right = turn (edge-triggered, with deadzone and repeat suppression)
  - A = jump (held = bounce)
  - B = ready/confirm in menus
  - X/Y = vote 1–4 via the D-pad in the lobby
  - Start = pause
  - right stick = free look
  - LB/RB = unused for now
- Menus are navigable with the pad (focus ring).
- Rumble (`vibrationActuator`) on push, stomp, bounce and death if supported.
- **Key remapping:** in Settings, rebind every action (keyboard and gamepad), persisted (try/catch).
- Hot-plug support and an on-screen hint showing the controller glyphs when a pad is in use.

## Task 8: Music system
- A `music` bus next to sfx/ui, with its own volume slider in Settings.
- Tracks come from `packages/client/public/music/<slot>.(ogg|mp3)`. Slots: `menu`, `single` (plus optional `single-<world>`), `race`, `knockout`, `results`.
  - Crossfade between slots (1.5 s), loop, and duck under results stingers.
  - A missing file means silence for that slot (no errors).
- **`CREDITS.md`** at the repo root, with a table (slot, track, artist, source link, licence) and a note to fill it when adding tracks. The menu gets a Credits screen that renders the same info from a `credits.json` next to the music.
- Don't add any audio files yourself. Jakub will add CC0/Pixabay tracks.

## Task 9: Timing presets for playtesting
- The movement constants (ROLL, TURN, FLIP, JUMP/HOP ticks) become a **rules preset** in `createWorld`:
  - `classic` = the current values
  - `snappy` = turn 2, roll 4, flip 5, jump/hop 8, and anything derived scaled sensibly
- Selected by `.env` `TIMING=classic|snappy` for the server, and by a dev-only toggle in single-player Settings.
- The predictor and bots read the preset from the world.
- Tests: the full suite passes under both presets (parametrise the core movement tests), and determinism for both.
- Jakub will pick one after playing.

## Acceptance checklist
- [ ] Tests, typecheck, build and `level:check` are clean
- [ ] Browser:
  - rename visible
  - fly-over in single and multiplayer
  - free look and x-ray outlines (a ball behind a block shows as a silhouette)
  - off-screen arrows with bots
  - island tints
  - a gamepad playing sp-01 (if no physical pad, simulate via a Gamepad API shim and say so)
  - rebinding a key works and persists
  - a music slot plays a placeholder file (use a generated sine test tone, not committed) and crossfades
  - `TIMING=snappy` works in multiplayer with bots
- [ ] Soak (one server + one bot process): 8 pool rounds with `TIMING=snappy`, no errors or STUCK
- [ ] Committed and pushed; CI green

## Report: `docs/reports/17-report.md`
- Screenshots of each item
- The fog before/after
- Gamepad mapping table
- How to add music (3 steps)
- Open questions

Then commit: `phase 17: polish & readability`, and push.
