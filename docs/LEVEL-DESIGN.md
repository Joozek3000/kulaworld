# Level design rules (traps)

These rules apply to every level in the pool and to future editor levels.
- **[E]** = hard rule, enforced as an **error** by `npm run level:check`. A pool level with an error can't be in the pool.
- **[W]** = soft rule, reported as a **warning** with a reason. Allowed, but think twice.
- "Distance" = moves along surfaces (BFS steps), not straight-line distance.
- "Lethal" = static spikes, retracting spikes, fire (a line of 3), and void (falling off).

## 1. Spawns are safe
- [E] No trap of any kind on a spawn tile.
- [E] No lethal tile, boost, ice or crumble within **2 moves** of a spawn.
- [W] Each spawn has at least 2 exit directions, so one enemy can't box in a respawning player.

## 2. Keys, exit and goals
- [E] A key or exit tile is never itself a trap tile.
- [E] Every key and the exit are reachable from every spawn with lethal tiles treated as walls (plain BFS), so a safe route always exists, even if it's slower.
- [W] Traps next to keys are fine (risk vs reward), but give each key at least one safe approach direction.

## 3. You can see it before it hits you (readability)
- [E] No lethal tile on a **flip landing tile**: the first tile after rolling over an edge, which you can't see before flipping.
- [E] No lethal tile on the tile directly **after a climb** (the first tile up the wall).
- [E] Forced moves (ice slides, boost landings) never end on a lethal tile or in void, unless the tile is marked `"deathtrap": true`. That's allowed at most once per level, never on the only route to a key, and never in knockout.
- [W] Retracting spikes are visible from at least 2 tiles away along the approach, not around a corner.

## 4. Timing traps are passable
- [E] Retracting spikes: `period ≥ 30` ticks, and `up ≤ 60 %` of the period, so the down window is ≥ 12 ticks (more than 2 rolls).
- [E] Consecutive retracting spikes in a lane are phase-staggered, so a ball at walking speed has a way through (checked by simulating a ball rolling through at ROLL_TICKS).
- [W] Fire: no more than 2 fire tiles in a row on a required route (3 pops you). Use 3+ fire only on optional or shortcut routes.

## 5. No soft-locks
- [E] From every standable tile reachable from a spawn, you can reach at least one key, the exit or a spawn area again. Arrow loops, ice and crumble must never trap a ball in a region it can't leave (dying doesn't count as leaving).
- [E] Crumble in race without regrow may never be the only link to a key or the exit.
- [W] Crumble bridges are at most 4 tiles long.

## 6. Ice and boosts
- [E] Every ice field has a non-lethal stopping tile at the end of every slide direction.
- [E] Boost pads have a `dir`. A ball arriving on a pad from any direction (roll, flip, climb, knock or slide) is launched along `dir`, so the arrow shows exactly where you'll fly. The landing tile for `dir` is clear (not lethal, not void), and no boost is within 3 moves of a spawn. (Phase 14c; `npm test` also checks that every pool pad launches along its arrow from each open neighbour.)
- [W] Ice arenas have a non-ice rim at least 1 tile wide.

## 7. Density and variety (readability budget)
- [E] Lethal tiles ≤ **10 %** of standable tiles.
- [E] Non-lethal modifier tiles (ice, arrow, boost, crumble) ≤ **25 %** of standable tiles. A level may declare one `"theme"` type (e.g. `"theme": "ice"` for Ice Rink), and that type is exempt from the 25 % cap. A lethal type can't be a theme.
- [E] Pool levels use **2–5** trap types, so each level has an identity without becoming noise.
- [W] Knockout: no lethal tile within the central third of the arena. The middle should be for brawling, with the edges and crumble as the danger.
- [W] Every lethal trap on a push lane (a straight line of ≥ 3 plain tiles leading into it) is intentional: note it in the level's `notes` field.

## 8. Push-into-trap is a feature
Pushing, cradling, edge-pushing and stomping people into traps is the multiplayer point of traps. Rules 1–4 make sure the trap is *fair to walk past*, not that it's safe to stand next to an enemy.

## 9. Single player (later)
- Introduce one new trap type per 2–3 levels, first in a safe teaching layout (a trap next to the path, not on it).
- Density limits can go up to 15 % lethal after level 10.
