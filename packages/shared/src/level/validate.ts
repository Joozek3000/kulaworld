import { dirName, dirVec, perpendicular } from '../dir.ts';
import { cellKey, sub } from '../vec.ts';
import { levelSolid } from './load.ts';
import { BLOCK_TILES, FACE_TILES, type Level, type Placement } from './types.ts';

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
  if (level.sky && !(level.sky.length === 2 && level.sky.every((c) => /^#[0-9a-fA-F]{6}$/.test(c)))) {
    errors.push(`sky must be two "#rrggbb" colours, got ${JSON.stringify(level.sky)}`);
  }
  const c = level.crumble;
  if (c && !(c.startSec >= c.warnSec && c.intervalSec > c.warnSec && c.warnSec > 0)) {
    errors.push(`crumble needs startSec >= warnSec > 0 and intervalSec > warnSec, got ${JSON.stringify(c)}`);
  }
  const h = level.heat;
  if (h && !(h.warnTicks > 0 && h.burnTicks > h.warnTicks)) errors.push(`heat needs 0 < warnSec < burnSec, got ${JSON.stringify(h)}`);
  if (level.mode === 'knockout') {
    if (level.keys.length || level.exit || level.keysRequired) errors.push('knockout level must not have keys, an exit or keysRequired');
    if (!Number.isInteger(level.lives) || level.lives < 1) errors.push(`knockout lives must be a positive integer, got ${level.lives}`);
    if (!c) errors.push('knockout level needs crumble { startSec, intervalSec, warnSec }');
  } else if (level.mode === 'race') {
    level.keys.forEach((k, i) => checkPlacement(`key ${i}`, k));
    if (level.exit) checkPlacement('exit', level.exit);
    else errors.push('race level needs an exit');
    if (level.keys.length < level.keysRequired) errors.push(`keysRequired ${level.keysRequired} > ${level.keys.length} keys`);
  } else errors.push(`unknown mode ${level.mode}`);
  validateTiles(level, errors);
  return errors;
}

/** Tiles (§18): known type, on a block, a face for face types, arrow ⟂ face, sane spike timing, one type per face. */
function validateTiles(level: Level, errors: string[]): void {
  const byBlock = new Map<string, string>(), byFace = new Map<string, string>();
  level.tiles.forEach((t, i) => {
    const key = cellKey(t.block), what = `tile ${i} (${t.type} at ${key})`;
    if (!BLOCK_TILES.includes(t.type) && !FACE_TILES.includes(t.type)) { errors.push(`${what}: unknown type`); return; }
    if (!levelSolid(level, t.block)) errors.push(`${what}: no block there`);
    if (FACE_TILES.includes(t.type)) {
      if (t.face === null) { errors.push(`${what}: needs a face`); return; }
      const fk = `${key}|${t.face}`;
      if (byFace.has(fk)) errors.push(`${what}: face ${dirName(t.face)} already has ${byFace.get(fk)}`);
      byFace.set(fk, t.type);
    } else {
      if (byBlock.has(key)) errors.push(`${what}: block already has ${byBlock.get(key)}`);
      byBlock.set(key, t.type);
    }
    if (t.type === 'arrow' && (t.dir === null || t.face === null || !perpendicular(t.dir, t.face))) errors.push(`${what}: arrow dir must be perpendicular to its face`);
    if (t.type === 'spikes' && t.period && !(Number.isInteger(t.period) && Number.isInteger(t.upTicks) && Number.isInteger(t.phase) && t.upTicks > 0 && t.upTicks < t.period)) {
      errors.push(`${what}: retracting spikes need integer ticks with 0 < up < period`);
    }
    if (t.type === 'boost' && t.variant !== 'far' && t.variant !== 'high') errors.push(`${what}: boost variant must be far or high`);
    if (t.type === 'crumble' && !(t.regrowTicks > 0)) errors.push(`${what}: regrowSec must be > 0`);
  });
  // A whole-block type conflicts with face types on that block, except crumble under arrow/boost/spikes.
  for (const [fk, type] of byFace) {
    const block = byBlock.get(fk.split('|')[0]);
    if (block && block !== 'crumble') errors.push(`${type} on ${fk} conflicts with the ${block} block`);
  }
}
