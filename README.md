# Kulaworld (working title)

A browser game inspired by Kula World: balls roll over floating block structures, each with its own gravity that flips as it rolls over an edge.
It has online multiplayer (race and knockout) and a single-player campaign.
Built with TypeScript, Three.js (client) and Colyseus (server).

Private project, all rights reserved.

## Requirements
- Node 24 (CI uses 24) and npm
- Windows is the main dev machine. The npm scripts work in PowerShell and in bash.

## Setup
```
npm install
cp .env.example .env    # optional server settings (port, min players, level override, …)
```

## Running
```
npm run dev             # server on :2567 + client on :5173
```
- Open http://localhost:5173.
- **Single Player** (menu) runs entirely in the browser, with no server needed.
- **Multiplayer** (menu): enter a name and join the lobby. Vote for a level, press R when ready, and the round starts once everyone is ready.
- To test multiplayer alone, add bots:
  ```
  npm run bots -- --count 3 --behaviour seek,bully,blocker,wander --skill 0.5
  ```
- To connect the client to another server: `http://localhost:5173/?server=ws://host:port`

## Controls
| Key | Action |
|---|---|
| W / ↑ | roll forward (hold to keep rolling) |
| A D / ← → | turn |
| Space | jump (with W: forward jump; hold: keep bouncing) |
| R | ready (lobby) |
| 1–4 | vote for a level (lobby; 4 = random) |
| Esc | pause (single player) |
| M | mute |
| [ ] | volume |
| F3 | debug overlay |
| F4 | feel/sound tuning panel (dev builds; also under Settings in the menu) |

## Modes
- **Race** (multiplayer): collect the required keys, then reach the exit. Pushing, stomping and traps are all fair game.
- **Knockout** (multiplayer): lives and a crumbling floor. The last ball rolling wins.
- **Single player**: a 10-level campaign (`levels/sp-*.json`) with Kula scoring, a level timer, a death penalty, checkpoints every 5 levels, and progress saved in localStorage.
- **Bonus level**: collect all 5 fruit kinds to unlock it, then light every paint tile before time runs out.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | server + client with reload |
| `npm test` | all Vitest suites (sim, levels, server) |
| `npm run typecheck` | `tsc` in every workspace |
| `npm run build` | typecheck + client production build (`packages/client/dist`) |
| `npm run level:check` | validates every level and the level-design rules (`docs/LEVEL-DESIGN.md`) |
| `npm run level:stats` | per-level stats (blocks, traps, pickups, …) |
| `npm run bots -- …` | headless bot players (see above) |

## Repo map
```
packages/shared   types, constants, level format + validation, and the deterministic simulation:
                  the single source of game rules (server and client both run it)
packages/server   Colyseus server: rooms, lobby vote, runs the sim authoritatively
packages/client   Vite + Three.js client: rendering, HUD, audio, prediction, local single-player
tools/bots        headless bot clients for multiplayer testing
levels/           hand-authored level JSON (pool levels, campaign sp-*, test/lab levels)
assets/           art and audio sources (.blend, .exr, 4K PNG, …)
docs/             ARCHITECTURE (source of truth), LEVEL-DESIGN, DECISIONS, ART-SOUND,
                  prompts/ (phase specs), reports/ (phase reports + screenshots)
```

## How work is done
- The game is built phase by phase. Each phase is a spec in `docs/prompts/NN-*.md`, executed by Claude Code.
- Each phase ends with a report in `docs/reports/NN-report.md`.
- `CLAUDE.md` holds the working rules (hard rules: all game rules in `packages/shared/src/sim`, integer-only sim state, server-authoritative).
- `docs/DECISIONS.md` logs every deviation from the architecture.

## Large files
- Raw art sources (`.blend`, `.exr`, 4K PNGs) live in `assets/`. The runtime copies the client actually loads (GLB, JPG, sounds) live in `packages/client/public/`.
- Everything is plain Git for now; the largest file is ~48 MB.
- If a future art source goes over ~50 MB, switch those file types to Git LFS. The existing history stays as is.
