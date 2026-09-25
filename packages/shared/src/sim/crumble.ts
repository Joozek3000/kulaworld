import type { Level } from '../level/types.ts';

/** Smallest crumble band; thinner distance shells are merged with their neighbours. */
export const MIN_BAND_BLOCKS = 4;

/**
 * Knockout crumble order (ARCHITECTURE §15): blocks grouped by exact squared distance from the level's bounding-box
 * centre, furthest first, then consecutive groups merged (outside in) until each band has >= MIN_BAND_BLOCKS blocks.
 * A short leftover core joins the band before it. Integer-only: coordinates are doubled so the centre is integral.
 * Pure and deterministic, so the client recomputes the same bands from the level.
 */
export function crumbleBands(level: Level): string[][] {
  const { min, max } = level;
  const byD2 = new Map<number, number[][]>();
  for (const key of level.solid) {
    const c = key.split(',').map(Number);
    const dx = 2 * c[0] - (min.x + max.x), dy = 2 * c[1] - (min.y + max.y), dz = 2 * c[2] - (min.z + max.z);
    const d2 = dx * dx + dy * dy + dz * dz;
    let shell = byD2.get(d2);
    if (!shell) byD2.set(d2, (shell = []));
    shell.push(c);
  }
  const bands: number[][][] = [];
  let acc: number[][] = [];
  for (const d2 of [...byD2.keys()].sort((a, b) => b - a)) {
    acc.push(...byD2.get(d2)!);
    if (acc.length >= MIN_BAND_BLOCKS) { bands.push(acc); acc = []; }
  }
  if (acc.length) (bands.length ? bands[bands.length - 1].push(...acc) : bands.push(acc));
  return bands.map((b) => b.sort((a, c) => a[0] - c[0] || a[1] - c[1] || a[2] - c[2]).map((c) => c.join(',')));
}
