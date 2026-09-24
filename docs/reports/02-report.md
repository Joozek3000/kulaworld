# Phase 02 report: Shared simulation

## Public API (`@kula/shared`)
```ts
// vec.ts
interface Vec3 { x; y; z }
vec(x, y, z): Vec3; add(a, b); sub(a, b); scale(a, k); eq(a, b): boolean; cellKey(v): string
// dir.ts
const Dir = { PX:0, NX:1, PY:2, NY:3, PZ:4, NZ:5 }; type Dir = 0..5; ALL_DIRS; type DirName = '+X' | ...
dirVec(d): Vec3; dirName(d): DirName; parseDir(s): Dir; dirFromVec(v): Dir
opposite(d): Dir; perpendicular(a, b): boolean; cross(a, b): Dir   // throws on parallel
// rng.ts
mulberry32(seed): () => number
// constants.ts
TICK_RATE ROLL_TICKS TURN_TICKS FLIP_TICKS JUMP_TICKS FALL_TICKS_PER_CELL RESPAWN_TICKS INPUT_BUFFER_TICKS KILL_MARGIN
// level/
interface LevelJson
interface Level { id; name; version; solid: Set<cellKey>; min; max; spawns: Pose[]; keys: Placement[]; exit; keysRequired; timeLimitSec }
interface Placement { cell; up }   interface Pose extends Placement { fwd }
loadLevel(json: LevelJson): Level          // throws on bad dir strings
isSolid(level, v): boolean
validateLevel(level): string[]
// sim/world.ts
const Action = { Idle, Roll, Turn, Flip, Jump, Fall, Dead }; type Cmd = 'fwd' | 'left' | 'right' | 'jump'
interface Input { seq; fwdHeld; turn: -1 | 0 | 1; jump }
interface PlayerState { id; name; pose; action; to; startTick; endTick; keys; fwdHeld; pulse; pulseTick }
interface World { level; seed; tick; timeLimitTick; players; keys: KeyItem[]; result: RaceResult | null }
type SimEvent = key | win | death | respawn
createWorld(level, seed): World
addPlayer(world, id, name): PlayerState
removePlayer(world, id): void
setInput(world, id, input: Input): void
reservations(world): Map<cellKey, playerId>; reserve(res, p); isFree(world, res, selfId, v); occupiedCells(p)
trySpawn(world, p): boolean
// sim/actions.ts
previewAction(world, self: { id, pose }, cmd, res?): Plan | null    // Plan = { action, to: Pose, ticks }
turnFwd(up, fwd, -1 | 1): Dir; startAction(p, plan, tick); startFall(world, p, tick): boolean
// sim/tick.ts
step(world): SimEvent[]
// sim/keyRace.ts
onLand(world, p, events); checkTimeout(world, events)
```
`step` runs in this order:
1. `++tick`.
2. Finish due actions: pose ← to, fall chaining, out-of-bounds death, respawn, key pickup, exit win.
3. `resolveMoves`: a single function that sees every idle player's intent in fair (rotated) order.
4. Timeout check.

PvP push goes into `resolveMoves`. New `Action` values are appended.

## Tests: 80 passed (4 files)
| File | Tests | What |
|---|---|---|
| test/dir.test.ts | 29 | names/opposite, cross handedness + parallel throw, all 24 (up, fwd) turn pairs, U=+Y F=+Z → right = −X, mulberry32 |
| test/level.test.ts | 14 | every `levels/*.json` validates, box/hollow expansion + AABB, bad dir string throws, 8 invalid fixtures each give the expected error |
| test/sim.test.ts | 30 | See the list below. |
| test/keyRace.test.ts | 7 | key pickup on finish + removed, exit locked, exit win, timeout winner, timeout draw, cube tour (all 6 faces, back to exact spawn state), determinism (4 players × 2000 ticks × seeded inputs: identical twice, differs for another seed) |

`test/sim.test.ts` covers:
- **Roll:** onto a block; wall block.
- **Flip:** over an edge, for all 6 ups.
- **Turn:** a left pulse.
- **Jump:** full, short (A2 is a block), short (A2 has a player), blocked, gap → fall → lands lower, key at A1 not collected.
- **Death:** out of bounds → respawn after exactly RESPAWN_TICKS at a free spawn, keys kept.
- **Joining:** join with no free spawn; removePlayer.
- **Reservations:** same-cell contest, fairness alternation, no flip into an occupied cell, no roll into a cell being vacated.
- **Input:** 3 rolls in exactly 15 ticks with no idle gap; 5 pulse-priority cases; pulse-expiry boundary (6 ticks → used, 7 → expired).

Coverage of `packages/shared/src/sim` (`npm run coverage`): **100% lines**, 98.7% statements, 97% branches, 100% functions.

`npm run typecheck` is clean and `npm run level:check` passes for both levels.

## Rule ambiguities and choices (all in DECISIONS.md)
1. **One pulse slot vs "jump > turn".** Jump beats turn only within a single input message; otherwise the latest pulse wins.
2. **Pulse expiry boundary.** A pulse is usable while `tick − pulseTick ≤ 6`, where `pulseTick` is the world tick when the input arrived.
3. **Blocked pulse.** It is spent, and held fwd is tried on the same tick.
4. **Reservations for multi-cell actions.** Flip and Jump also reserve the pass-through cell (A / A1). Falling players reserve their current and next cell but their fall ignores others. Dead players reserve nothing.
5. **No free spawn.** The player stays Dead and retries each tick (join as well).
6. **Where the win is checked.** The exit win and key pickup happen at action finish (§7 step 2), not step 4. They use the rotated order, so simultaneous arrivals are fair. The timeout stays in step 4.
7. **Timer origin.** tick 0 is world creation, so the server must create the world when `playing` starts.
8. **After a result.** Pickups and exit are frozen; movement continues until the server stops stepping.
9. **Duplicate item cells** also include spawns.
10. **Out-of-bounds check** runs only after a fall step. A jump moves at most 2 cells, so it can't leave an AABB expanded by 6.

## Levels
Legend: `#` block, `0-3` spawn, `K` key, `E` exit, `.` air. Rows are z, columns are x (min−1 .. max+1).

**test-flat**: a 9×1×9 platform at y=0.
- 1-wide gap at z=3, x 0..3: jumpable, with a key just beyond it.
- 2-wide gap at z=5..6, x 5..8: not jumpable. A jump lands in air and falls to death.
- Wall block at (4,1,4).
- Key on the underside at (4,−1,4), reached by flipping over an edge.
- keysRequired 2.
```
     y=1            y=0            y=-1
z=0  ...........    .#########.    ...........
z=1  ..0.1.2.3..    .#########.    ...........
z=2  ...........    .#########.    ...........
z=3  ...........    .....#####.    ...........
z=4  ..K..#.....    .#########.    .....K.....
z=5  ...........    .#####.....    ...........
z=6  ...........    .#####.....    ...........
z=7  ...........    .#########.    ...........
z=8  .....E..K..    .#########.    ...........
```
**test-cube**: a solid 5×5×5 box from (0,0,0) to (4,4,4).
- 4 spawns on top (y=5).
- One key in the middle of each side face (y=2), plus one on the bottom at (3,−1,3).
- Exit at the bottom centre (2,−1,2).
- keysRequired 3.
```
      y=5 top    y=0..4     y=2 sides  y=-1 bottom
z=-1  .......    .......    ...K...    .......
z=0   .......    .#####.    .#####.    .......
z=1   ..0.1..    .#####.    .#####.    .......
z=2   .......    .#####.    K#####K    ...E...
z=3   ..2.3..    .#####.    .#####.    ....K..
z=4   .......    .#####.    .#####.    .......
z=5   .......    .......    ...K...    .......
```

## Open questions / risks
- The server isn't wired to the sim yet; that's phase 03. It still only imports `VERSION`.
- Spending a pulse when it's blocked (choice 3) may feel harsh when a jump is blocked by a player who is about to move away. Revisit after playtests.
- A falling player can land on an idle one (§5 simplification). The reservation map holds one id per cell, so while they overlap only one of them "owns" that cell. It resolves as soon as someone moves.
- `@types/node` is enabled in the shared tsconfig so that `test/` and `scripts/level-check.ts` can use `fs`. Nothing in `src/` imports Node.
- New dev dependency: `@vitest/coverage-v8` (small dev tool, needed for the coverage acceptance check).
