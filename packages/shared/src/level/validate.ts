import { dirName, dirVec, perpendicular } from '../dir.ts';
import { cellKey, sub } from '../vec.ts';
import { levelSolid } from './load.ts';
import type { Level, Placement } from './types.ts';

/** Returns a list of human-readable errors; empty means valid. */
export function validateLevel(level: Level): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();

  const checkPlacement = (what: string, p: Placement) => {
    const key = cellKey(p.cell);
    if (levelSolid(level, p.cell)) errors.push(`${what} at ${key} is inside a block`);
    else if (!levelSolid(level, sub(p.cell, dirVec(p.up)))) errors.push(`${what} at ${key} has no block under it (up ${dirName(p.up)})`);
    const other = seen.get(key);
    if (other) errors.push(`${what} at ${key} shares its cell with ${other}`);
    else seen.set(key, what);
  };

  if (level.solid.size === 0) errors.push('level has no blocks');
  level.spawns.forEach((s, i) => {
    checkPlacement(`spawn ${i}`, s);
    if (!perpendicular(s.up, s.fwd)) errors.push(`spawn ${i}: fwd ${dirName(s.fwd)} is not perpendicular to up ${dirName(s.up)}`);
  });
  if (level.spawns.length < 4) errors.push(`needs at least 4 spawns, has ${level.spawns.length}`);
  if (level.mode === 'knockout') {
    if (level.keys.length || level.exit || level.keysRequired) errors.push('knockout level must not have keys, an exit or keysRequired');
    if (!Number.isInteger(level.lives) || level.lives < 1) errors.push(`knockout lives must be a positive integer, got ${level.lives}`);
    const c = level.crumble;
    if (!c) errors.push('knockout level needs crumble { startSec, intervalSec, warnSec }');
    else if (!(c.startSec >= c.warnSec && c.intervalSec > c.warnSec && c.warnSec > 0)) {
      errors.push(`crumble needs startSec >= warnSec > 0 and intervalSec > warnSec, got ${JSON.stringify(c)}`);
    }
  } else if (level.mode === 'race') {
    level.keys.forEach((k, i) => checkPlacement(`key ${i}`, k));
    if (level.exit) checkPlacement('exit', level.exit);
    else errors.push('race level needs an exit');
    if (level.keys.length < level.keysRequired) errors.push(`keysRequired ${level.keysRequired} > ${level.keys.length} keys`);
  } else errors.push(`unknown mode ${level.mode}`);
  return errors;
}
