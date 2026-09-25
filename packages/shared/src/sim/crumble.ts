import type { Level } from '../level/types.ts';

/**
 * Knockout crumble order (ARCHITECTURE §15): blocks grouped by their distance from the level's bounding-box centre,
 * rounded to whole cells, furthest band first. Integer-only: coordinates are doubled so the centre is integral, and
 * the rounded distance r satisfies (2r - 1)² <= d² < (2r + 1)² for the doubled squared distance d².
 * Pure and deterministic, so the client recomputes the same bands from the level.
 */
export function crumbleBands(level: Level): string[][] {
  const { min, max } = level;
  const byRadius = new Map<number, number[][]>();
  for (const key of level.solid) {
    const c = key.split(',').map(Number);
    const dx = 2 * c[0] - (min.x + max.x), dy = 2 * c[1] - (min.y + max.y), dz = 2 * c[2] - (min.z + max.z);
    const d2 = dx * dx + dy * dy + dz * dz;
    let r = 0;
    while ((2 * r + 1) * (2 * r + 1) <= d2) r++;
    let band = byRadius.get(r);
    if (!band) byRadius.set(r, (band = []));
    band.push(c);
  }
  return [...byRadius.keys()].sort((a, b) => b - a).map((r) =>
    byRadius.get(r)!.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map((c) => c.join(',')));
}
