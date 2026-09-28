# Phase 16: Prepare the repo for GitHub (private)

Read first: `CLAUDE.md`, `docs/prompts/README.md`, `docs/reports/15b-report.md`.

## Context
Jakub is pushing the project to a **private** GitHub repo.
- Current state: branch `master`, 35 commits, no remote, no README, no LICENSE.
- History has ~160 MB of objects. The largest files are the three 48 MB `.exr` skies, a 19 MB `.blend` and the 4K PNGs: all under GitHub's 100 MB per-file limit, so a normal push works.
- No secrets were found in tracked files (`.env` is ignored).

## Tasks
1. **Clean up:** `git gc --prune=now`. There are 3 stray tmp objects in `.git/objects` (~36 MB of garbage). Report the pack size after.
2. **README.md** (repo root), written for Jakub-in-6-months and a future collaborator:
   - what the game is, in 3 lines: a Kula World-inspired multiplayer + single player, browser, Three.js + Colyseus. Note that "Kulaworld" is a working title.
   - requirements (Node version from package.json, npm) and setup: `npm install`, copy `.env.example` → `.env`
   - running: `npm run dev`, then open the client URL; single player from the menu; multiplayer lobby; `npm run bots -- --count N --behaviour seek,bully,blocker,wander --skill 0.5`
   - controls (W/A/D/Space, R, 1–4 vote, Esc pause, M mute, F3 debug, F4 tuning, `[` `]` volume)
   - modes: race, knockout, single player campaign, bonus
   - scripts: test, typecheck, build, level:check, level:stats
   - repo map: packages/shared (sim, the single source of rules), server, client, tools/bots, levels/, assets/ (art sources), docs/ (ARCHITECTURE, LEVEL-DESIGN, DECISIONS, ART-SOUND, prompts/, reports/)
   - how work is done: phase prompts in docs/prompts executed by Claude Code, reports in docs/reports
   - short and scannable; no marketing
3. **LICENSE:** none for now (a private repo, all rights reserved by default). Add a one-line note to the README: "Private project, all rights reserved."
4. **CI:** `.github/workflows/ci.yml` on push/PR to `main`. Ubuntu, Node (the same major as package.json engines, or 24), `npm ci`, then `npm run typecheck`, `npm test` and `npm run level:check`. Cache npm. Skip anything that needs a GPU or browser.
   - Check that `npm ci` works from a clean clone. package-lock must be committed and in sync.
   - If any test depends on local-only files (the art GLBs are committed, so they should be fine) or on timing, note it.
5. **Branch:** rename `master` → `main` (`git branch -m master main`).
6. **.gitignore:** add `*.log`, `.DS_Store`, `Thumbs.db`, `.vscode/` (unless the project relies on shared settings), and any local scratch dirs used in earlier phases (check the report "throwaway" notes). Don't ignore `docs/reports/img`.
7. **Large binaries note:** in README (or docs/ART-SOUND.md), explain that raw art sources (`.blend`, `.exr`, 4K PNG) live in `assets/` and runtime copies in `packages/client/public/`. If future art sources exceed 50 MB each, switch to Git LFS. Don't migrate the history now.
8. Commit: `chore: README, CI, gitignore for GitHub`.

## Don't
- Don't create the GitHub repo or push. Jakub does that (instructions below).
- Don't rewrite history.

## Report: `docs/reports/16-report.md`
- The pack size before and after gc
- A clean-clone check: clone the repo to a temp dir, `npm ci && npm run typecheck && npm test`, and give the result and duration
- The CI workflow summary

## Push instructions (for Jakub, include these at the end of the report)
1. On github.com → New repository → name it (e.g. `kulaworld`) → **Private** → don't add a README/licence/gitignore → Create.
2. In the project folder:
   ```
   git remote add origin https://github.com/<your-username>/kulaworld.git
   git push -u origin main
   ```
   The first push uploads ~160 MB, so it can take a few minutes. Sign in when Git Credential Manager asks.
3. Check the Actions tab: CI should go green.
