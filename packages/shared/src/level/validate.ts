import { dirName, dirVec, perpendicular } from '../dir.ts';
import { cellKey, sub } from '../vec.ts';
import { isSolid } from './load.ts';
import type { Level, Placement } from './types.ts';

/** Returns a list of human-readable errors; empty means valid. */
export function validateLevel(level: Level): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();

  const checkPlacement = (what: string, p: Placement) => {
    const key = cellKey(p.cell);
    if (isSolid(level, p.cell)) errors.push(`${what} at ${key} is inside a block`);
    else if (!isSolid(level, sub(p.cell, dirVec(p.up)))) errors.push(`${what} at ${key} has no block under it (up ${dirName(p.up)})`);
    const other = seen.get(key);
    if (other) errors.push(`${what} at ${key} shares its cell with ${other}`);
    else seen.set(key, what);
  };

  if (level.solid.size === 0) errors.push('level has no blocks');
  level.spawns.forEach((s, i) => {
    checkPlacement(`spawn ${i}`, s);
    if (!perpendicular(s.up, s.fwd)) errors.push(`spawn ${i}: fwd ${dirName(s.fwd)} is not perpendicular to up ${dirName(s.up)}`);
  });
  level.keys.forEach((k, i) => checkPlacement(`key ${i}`, k));
  checkPlacement('exit', level.exit);
  if (level.spawns.length < 4) errors.push(`needs at least 4 spawns, has ${level.spawns.length}`);
  if (level.keys.length < level.keysRequired) errors.push(`keysRequired ${level.keysRequired} > ${level.keys.length} keys`);
  return errors;
}
