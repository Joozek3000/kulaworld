import { ALL_DIRS, dirVec, perpendicular, type Dir } from '../dir.ts';
import { findPath } from '../sim/path.ts';
import { createWorld, isSolid, type World } from '../sim/world.ts';
import { add, cellKey, sub, type Vec3 } from '../vec.ts';
import type { Level } from './types.ts';

/**
 * A 1-wide straight run (phase 12 level lint: a stalemate risk), and the fewest moves from one end to the other
 * without going through it: `detour` null = no way round (a warning).
 */
export interface Corridor { up: Dir; along: Dir; from: Vec3; to: Vec3; length: number; detour: number | null }

/** Corridors shorter than this aren't reported. */
export const CORRIDOR_MIN = 4;

const standable = (w: World, c: Vec3, up: Dir) => !isSolid(w, c) && isSolid(w, sub(c, dirVec(up)));

/**
 * Straight runs of ≥ CORRIDOR_MIN standable tiles on one face where no tile has a standable same-face neighbour to
 * either side (1 wide), with the length of the way round: a BFS (climbs, flips onto other faces, jumps) from one end
 * to the other with the run's interior blocked. Report-only: `npm run level:check` warns when there's no way round.
 */
export function lintCorridors(level: Level): Corridor[] {
  const w = createWorld(level, 0);
  const narrow = (c: Vec3, up: Dir, along: Dir) =>
    standable(w, c, up) && ALL_DIRS.filter((s) => s !== along && s !== (along ^ 1) && perpendicular(s, up))
      .every((s) => !standable(w, add(c, dirVec(s)), up));
  const out: Corridor[] = [];
  const seen = new Set<string>();
  for (const k of level.solid) {
    const [x, y, z] = k.split(',').map(Number);
    for (const up of ALL_DIRS) {
      const start = add({ x, y, z }, dirVec(up));
      for (const along of ALL_DIRS) {
        if (!perpendicular(along, up) || (along & 1)) continue; // walk each axis once, in its + direction
        const tag = `${cellKey(start)}|${up}|${along}`;
        if (seen.has(tag) || !narrow(start, up, along)) continue;
        // Only start at the beginning of a run.
        if (narrow(sub(start, dirVec(along)), up, along)) continue;
        const run: Vec3[] = [];
        for (let c = start; narrow(c, up, along); c = add(c, dirVec(along))) { run.push(c); seen.add(`${cellKey(c)}|${up}|${along}`); }
        if (run.length < CORRIDOR_MIN) continue;
        const interior = new Map(run.slice(1, -1).map((c) => [cellKey(c), 'wall']));
        const a = run[0], b = run[run.length - 1];
        const round = findPath(w, { cell: a, up, fwd: along }, new Set([cellKey(b)]), interior);
        out.push({ up, along, from: a, to: b, length: run.length, detour: round ? round.length : null });
      }
    }
  }
  return out;
}
