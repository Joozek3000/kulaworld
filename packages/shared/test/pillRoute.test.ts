import { describe, expect, test } from 'vitest';
import { ALL_DIRS, cellKey, createWorld, findPath, loadLevel, perpendicular, surfaceMove, type Placement, type Pose, type World } from '../src/index.ts';
import { levelFiles, readLevelJson } from './util.ts';

// 15a follow-up 1: good race pills (the ones seek takes) sit within 2 moves of a main key route (spawn → each key, each key → exit).
const spot = (s: Placement) => `${cellKey(s.cell)}|${s.up}`;

/** Every tile of seek's tour from each spawn: the nearest remaining key, until keysRequired, then the exit. */
function routeSpots(w: World): Placement[] {
  const out: Placement[] = [];
  for (const spawn of w.level.spawns) {
    let at: Pose = spawn;
    const left = new Set(w.level.keys.map((k) => cellKey(k.cell)));
    for (let n = 0; n <= w.level.keysRequired; n++) {
      const goals = n < w.level.keysRequired ? left : new Set([cellKey(w.level.exit!.cell)]);
      const path = findPath(w, at, goals) ?? [];
      out.push(at, ...path.map((st) => st.to));
      if (path.length) at = path[path.length - 1].to;
      left.delete(cellKey(at.cell));
    }
  }
  return out;
}

/** Moves (rolls, flips, climbs) from the nearest route tile to `s`, up to `max`, else Infinity. */
function routeDistance(w: World, s: Placement, max = 3): number {
  let frontier = [...new Map(routeSpots(w).map((r) => [spot(r), { cell: r.cell, up: r.up }])).values()];
  const seen = new Set(frontier.map(spot));
  for (let d = 0; d <= max; d++) {
    if (frontier.some((f) => spot(f) === spot(s))) return d;
    const next: Placement[] = [];
    for (const f of frontier) for (const dir of ALL_DIRS.filter((x) => perpendicular(x, f.up))) {
      const m = surfaceMove(w, f, dir);
      if (!seen.has(spot(m))) { seen.add(spot(m)); next.push(m); }
    }
    frontier = next;
  }
  return Infinity;
}

const race = levelFiles().map((f) => readLevelJson(f)).filter((j) => j.pool && (j.mode ?? 'race') === 'race' && j.pickups?.length);

describe('race pills are near a key route', () => {
  test.each(race.map((j) => [j.id, j] as const))('%s', (_, json) => {
    const w = createWorld(loadLevel(json), 1);
    const far = w.level.pickups.filter((p) => p.type === 'bouncy' || p.type === 'heavy')
      .map((p) => [p.type, cellKey(p.cell), routeDistance(w, p)]).filter(([, , d]) => (d as number) > 2);
    expect(far).toEqual([]);
  });
});
