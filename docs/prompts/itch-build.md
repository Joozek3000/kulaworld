# Final phase: "Flipside": itch.io build (run LAST, after the pre-itch roadmap)

Read first: `CLAUDE.md`, `README.md`, `docs/ARCHITECTURE.md` §22, `docs/reports/15b-report.md`, `docs/reports/16-report.md`.

## Context
- Jakub wants feedback from real players. He'll upload a **single-player-only** browser build to itch.io, first as a **restricted** (password or link-only) page.
- Multiplayer needs a hosted server, so it's a later phase.
- The public name is now **Flipside** (a working title). Kula World is Sony's name, so nothing player-facing may say "Kula". Internal package names (`@kula/*`), save keys (`kula.save`, `kula.tuning`) and the repo name stay as they are, so saves and imports don't break.
- The repo now has a GitHub remote (`origin`, private). **After each commit in this phase, `git push`.** Do that in every future phase too, and add it to CLAUDE.md's rules.

## Tasks 1–3
Moved to phase 17 (rename, gentler early game, fog), which are already done by the time this runs. Check they're in place.

## Task 4: The itch build
- `npm run build:itch`:
  - a Vite build with `base: './'` (relative paths, because itch serves from a random subpath inside an iframe)
  - if online multiplayer is hosted by then, point the build at the hosted server; otherwise `VITE_SINGLE_ONLY=1`: the menu shows "Multiplayer — coming soon" (disabled), and the client never opens a WebSocket
  - output: `release/flipside-web-<version>.zip` with `index.html` at the zip root (`release/` is git-ignored)
- **Checks:**
  - the zip's file count is < 1000 and the total size is reported
  - no source maps, and no dev helpers (`window.kula`, F8/F9)
  - F3 debug hidden unless `?debug`
  - F4 stays reachable only from Settings
- **iframe-safe:**
  - a "Click to play" overlay on first load: gives keyboard focus and unlocks audio
  - `preventDefault` on arrows/Space/WASD so the itch page doesn't scroll
  - a fullscreen button in the menu (Fullscreen API)
  - the layout works at a 960×600 embed and at fullscreen
  - it pauses (single player) when the iframe loses focus/visibility
- **Test:** serve the unzipped build from a nested path (e.g. `http://localhost:8080/some/random/path/index.html`) with a plain static server, inside an iframe test page at 960×600. Play sp-01 to completion with no console errors or 404s. Also check that localStorage works there (itch iframes allow it) and that it degrades gracefully if blocked.

## Task 5: Feedback hooks
- `FEEDBACK_URL` in the client config, default empty. When set, show a "Give feedback" button in the menu, on the results card and on the game-over screen (opens in a new tab). Jakub will paste a Google Form URL.
- Add a draft form structure to `docs/itch/feedback-form.md` (questions Jakub can copy into Google Forms):
  - How responsive did the controls feel? (1–5)
  - Did the camera ever confuse you? Where?
  - Which level did you stop at, and why?
  - Did you ever feel a death was unfair?
  - Have you played Kula World / Axyz? (Y/N)
  - Would you play online multiplayer (push/stomp other balls)?
  - Anything else

## Task 6: itch page kit (`docs/itch/`)
- **`page.md`:** title, short tagline (≤ 80 chars), description (what it is, "early prototype, single player only, multiplayer coming", controls, known issues, what feedback is wanted), suggested tags, embed settings (1280×720 or 960×600, "fullscreen button" on, "mobile friendly" off), and the restricted-page instructions.
- **Screenshots:** 5 at 1280×720 (menu, three different levels mid-play, a results card), saved in `docs/itch/`.
- **A cover image** at 630×500 made from a screenshot, with "Flipside" text in the menu's logo style.
- **Upload steps:** Dashboard → Create new project → Kind: HTML → upload the zip → "This file will be played in the browser" → embed size → Visibility: Restricted (or Draft) → Save.

## Acceptance checklist
- [ ] Tests, typecheck, build and `level:check` are clean
- [ ] `npm run build:itch` produces the zip; the nested-path iframe test passes (sp-01 completed, no errors or 404s, no WebSocket)
- [ ] Nothing player-facing says "Kula"
- [ ] Fog before/after screenshots show a clear readability improvement
- [ ] Committed and **pushed**; CI green on GitHub (report the run URL/status if `gh` is available, otherwise say to check the Actions tab)

## Report: `docs/reports/17-report.md`
Then commit: `phase 17: Flipside itch build`, and push.
