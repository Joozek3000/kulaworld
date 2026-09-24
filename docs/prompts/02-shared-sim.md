# Phase 02: Shared simulation

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§3–§9 exactly), `docs/DECISIONS.md`, `docs/reports/01-report.md`.

## Goal
The complete game rules in `packages/shared`, as pure deterministic TypeScript with thorough tests. No networking or rendering in this phase.

## Tasks
1. `dir.ts`, `vec.ts`: the Dir enum, string↔enum mapping, `dirVec`, `opposite`, `cross` (throws on parallel input), vector ops and `cellKey`.
2. `rng.ts`: a small seeded PRNG (e.g. mulberry32).
3. `constants.ts`: every constant from §6.
4. `level/`: types, `loadLevel(json)` (expands `boxes`, parses dirs, computes the AABB) and `validateLevel()` returning `string[]` errors.
5. Author `levels/test-flat.json` and `levels/test-cube.json` exactly as described in §9. Add `npm run level:check` to validate all levels and print a summary (block count, AABB, spawns, keys).
6. `sim/`:
   - `createWorld(level, seed)`, `addPlayer(world, id, name)` (first free spawn), `removePlayer`, `setInput(world, id, input)`, `step(world): SimEvent[]`
   - `previewAction(world, playerState, cmd)`: a pure "what would this command do" function. `step` must use it internally, and bots will use it later for BFS.
   - Key Race logic: phases are handled by the server, but the sim owns key pickup, exit unlock, win detection, the timeout result and events (`key`, `win`, `death`, `respawn`).
7. Export everything through `index.ts`.

## Required tests (Vitest, tiny hand-built worlds)
- **Roll**: onto a solid block. Blocked by a wall (state unchanged, no action).
- **Flip**: over an edge, asserting the exact `to.cell/up/fwd`. Parametrise over all 6 `up` directions.
- **Turn**: for all 24 (up, fwd) pairs, left/right give a perpendicular fwd and four lefts return to the start. Handedness: U=+Y, F=+Z → right = −X.
- **Jump**:
  - full 2-cell landing
  - short jump when A2 is solid
  - blocked when A1 is solid
  - jump over a gap into air → Fall → lands on a lower block
  - jump over a key at A1 does NOT collect it
- **Fall**: out of bounds → Dead → respawns after exactly RESPAWN_TICKS at a free spawn, keys kept.
- **Reservations**:
  - two players rolling into the same cell on the same tick → exactly one moves
  - fairness rotation alternates the winner across ticks
  - can't flip into an occupied cell
- **Input**:
  - holding fwd rolls 3 tiles in exactly 3×ROLL_TICKS ticks (chaining with no idle gap)
  - pulse priority jump > turn > fwd
  - a pulse expires after INPUT_BUFFER_TICKS
- **Key Race**:
  - key collected on action finish and removed for everyone
  - exit locked until keysRequired
  - win event
  - timeout: most keys wins, or a draw on a tie
- **Cube tour**: on `test-cube`, a scripted input sequence visits all 6 faces and ends back at the spawn state.
- **Determinism**: 4 players, seeded random inputs for 2000 ticks, run twice → identical serialized world.
- **Levels**: every file in `levels/` validates. Invalid fixtures each produce the expected error.

## Constraints
- Don't implement PvP, but follow the "Sim implications" in ARCHITECTURE §14 so push can be added later without a rewrite.
- Integers only in sim state (see CLAUDE.md). No imports from three/colyseus.
- If a rule in §5 is ambiguous or contradicts itself, pick the simplest behaviour, log it in DECISIONS.md and flag it in the report. Don't redesign.

## Acceptance checklist
- [ ] All tests above exist and pass. `npm run typecheck` is clean.
- [ ] `npm run level:check` passes for both levels
- [ ] Coverage of `sim/` ≥ 90% lines (`vitest --coverage`)

## Report: `docs/reports/02-report.md`
- Public API of shared (signatures)
- Test list with pass counts, coverage numbers
- Every rule ambiguity found and the choice made
- ASCII sketch of both levels (one slice per layer is fine)
- Open questions/risks

Then commit: `phase 02: shared sim`.
