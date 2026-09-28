# Phase 16 report: GitHub prep

## Summary
- **Cleanup:** `git gc --prune=now` removed the 3 stray `tmp_obj_*` files (35.6 MiB) and packed 1 667 loose objects into one pack.

  | | Before | After |
  |---|---|---|
  | Loose objects | 1 667 (159.6 MiB) | 0 |
  | Packs | 0 | 1 (**148.6 MiB**) |
  | Garbage | 3 files, 35.6 MiB | 0 |

- **README.md** (repo root): what the game is ("working title"), requirements, setup, running (dev, single player, multiplayer, bots, `?server=`), controls, modes, scripts, repo map, how phases work, and a note on large files and when to switch to Git LFS. It also has the line "Private project, all rights reserved." There's no LICENSE file.
- **CI:** `.github/workflows/ci.yml`.
- **Branch:** `master` → `main`.
- **.gitignore:** added `*.log`, `.DS_Store`, `Thumbs.db` and `.vscode/`.
  - There's no `.vscode/` in the repo, so no shared settings are lost.
  - Earlier phases' scratch work (CDP scripts, throwaway servers and test levels, the level generator) lived outside the repo in the session scratchpad, so there's no in-repo scratch dir to ignore.
  - `docs/reports/img` stays tracked.
- **History:** not rewritten. The two tracked Blender backups (`*.blend1`) stay in history.

## Clean-clone check
I cloned the repo (HEAD `c671bf8`) to a temp dir on the Windows dev machine (Node 24.14, npm 11.19) and ran the CI steps:

| Step | Result | Time |
|---|---|---|
| `npm ci` | ok: package-lock is committed and in sync | 23 s |
| `npm run typecheck` | 0 errors | 2 s |
| `npm test` | 34 files, **774 passed**, 2 skipped (by design: push-off-only cases) | 30 s |
| `npm run level:check` | exit 0 | 13 s |

Notes:
- **npm install scripts:** npm 11.19 skipped the install scripts of `esbuild` (a postinstall that checks its binary) and `msgpackr-extract` (optional native speed-up for Colyseus). Everything above passed without them: esbuild's platform binary comes as an optional dependency, and msgpackr falls back to JS. CI's npm may simply run them, which is harmless either way.
- **Timing-sensitive test:** `packages/server/test/race.test.ts` starts a real Colyseus server on port 2598 and waits on wall-clock time (up to 6 s per wait, 15–20 s per test). It passed here, but it's the one test that could flake on a very slow runner.
- **Other tests:** they use the deterministic sim only. No test needs a GPU, a browser, or anything outside the repo. The art tests read the committed GLBs.

## CI workflow
`.github/workflows/ci.yml` runs on push to `main` and on pull requests to `main`:
1. Ubuntu (latest) with Node 24 (`actions/setup-node`, npm cache).
2. `npm ci`.
3. `npm run typecheck`.
4. `npm test`.
5. `npm run level:check`.

No build, browser or GPU steps. `npm run build` isn't in CI because it's typecheck + the Vite build, and nothing checks the bundle yet; add it if you want the build to gate PRs.

## Push instructions (for Jakub)
1. On github.com: **New repository**, name it (e.g. `kulaworld`), set it to **Private**, don't add a README, licence or gitignore, and click **Create**.
2. In the project folder:
   ```
   git remote add origin https://github.com/<your-username>/kulaworld.git
   git push -u origin main
   ```
   The first push uploads about 150 MB, so it can take a few minutes. Sign in when Git Credential Manager asks.
3. Check the **Actions** tab: CI should go green.
