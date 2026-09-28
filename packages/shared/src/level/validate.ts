import { dirName, dirVec, perpendicular } from '../dir.ts';
import { cellKey, sub } from '../vec.ts';
import { levelSolid } from './load.ts';
import { BLOCK_TILES, FACE_TILES, ITEM_TYPES, MODIFIER_TILES, PICKUP_TYPES, type Level, type Placement } from './types.ts';

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
  const min = level.mode === 'single' ? 1 : 4; // a campaign level has one player (§22)
  if (level.spawns.length < min) errors.push(`needs at least ${min} spawns, has ${level.spawns.length}`);
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
  } else if (level.mode === 'single') validateSingle(level, errors, checkPlacement);
  else errors.push(`unknown mode ${level.mode}`);
  validateTiles(level, errors);
  validate13b(level, errors);
  // Pickups (phase 15a): known types, placed like items, a positive respawn; a sane random spawner.
  level.pickups.forEach((p, i) => {
    checkPlacement(`pickup ${i} (${p.type})`, p);
    if (!PICKUP_TYPES.includes(p.type)) errors.push(`pickup ${i}: unknown type ${p.type}`);
    if (!(p.respawnTicks > 0)) errors.push(`pickup ${i}: respawnSec must be > 0`);
  });
  const r = level.randomPickups;
  if (r && !(r.everyTicks > 0 && Number.isInteger(r.maxOnMap) && r.maxOnMap > 0 && r.types.length && r.types.every((t) => PICKUP_TYPES.includes(t)))) {
    errors.push(`randomPickups needs everySec > 0, maxOnMap > 0 and known types, got ${JSON.stringify(r)}`);
  }
  if (r && (r.weights.some((w) => !(w >= 0)) || !r.weights.some((w) => w > 0))) errors.push(`randomPickups weights must be ≥ 0 (given ones ≤ 100 in total) with one > 0, got ${r.weights.join(', ')}`);
  if (level.lab && level.pool) errors.push('a lab level is never in the pool');
  if (level.theme !== null && !MODIFIER_TILES.includes(level.theme)) errors.push(`theme must be a non-lethal trap type (${MODIFIER_TILES.join(', ')}), got ${level.theme}`);
  if (typeof level.notes !== 'object' || Array.isArray(level.notes) || Object.values(level.notes).some((n) => typeof n !== 'string')) {
    errors.push('notes must be an object of strings');
  }
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
    if (t.type === 'boost' && (t.dir === null || t.face === null || !perpendicular(t.dir, t.face))) errors.push(`${what}: boost needs a dir perpendicular to its face`);
    if (t.deathtrap && t.type !== 'ice' && t.type !== 'boost') errors.push(`${what}: deathtrap is only for ice or boost tiles`);
    if (t.type === 'crumble' && !(t.regrowTicks > 0)) errors.push(`${what}: regrowSec must be > 0`);
    if (t.type === 'teleport' && !t.pair) errors.push(`${what}: teleport needs a pair id`);
    if (t.type === 'switch' && !level.lasers.some((l) => l.group === t.group)) errors.push(`${what}: switch group "${t.group}" has no laser`);
  });
  // A whole-block type conflicts with face types on that block, except crumble under arrow/boost/spikes.
  for (const [fk, type] of byFace) {
    const block = byBlock.get(fk.split('|')[0]);
    if (block && block !== 'crumble') errors.push(`${type} on ${fk} conflicts with the ${block} block`);
  }
}

/** Phase 13b: laser beams run through air and agree on their group's start state; vanish schedules are sane. */
function validate13b(level: Level, errors: string[]): void {
  const start = new Map<string, boolean>();
  level.lasers.forEach((l, i) => {
    const what = `laser ${i} (${l.group})`;
    if (!l.group) errors.push(`${what}: needs a group`);
    if (!Number.isInteger(l.length) || l.length < 1) errors.push(`${what}: length must be a positive integer`);
    if (typeof l.on !== 'boolean') errors.push(`${what}: on must be true or false`);
    for (const c of l.cells) if (levelSolid(level, c)) errors.push(`${what}: beam cell ${cellKey(c)} is inside a block`);
    if (start.has(l.group) && start.get(l.group) !== l.on) errors.push(`${what}: group ${l.group} starts both on and off`);
    start.set(l.group, l.on);
  });
  for (const [k, v] of level.vanish) {
    if (!(Number.isInteger(v.period) && Number.isInteger(v.on) && Number.isInteger(v.phase) && v.on > 0 && v.on < v.period)) {
      errors.push(`vanishing block ${k}: needs integer ticks with 0 < on < period`);
    }
    if (level.blockTiles.get(k)?.type === 'crumble') errors.push(`vanishing block ${k}: can't also crumble`);
  }
}

/**
 * Single player (§22): a campaign number, keys and an exit with every key required (a bonus level has neither, and
 * needs paint tiles), items placed like keys, no random pickups, no pool.
 */
function validateSingle(level: Level, errors: string[], checkPlacement: (what: string, p: Placement) => void): void {
  if (!(Number.isInteger(level.campaign) && level.campaign > 0)) errors.push(`a single-player level needs a campaign number > 0, got ${level.campaign}`);
  if (level.pool) errors.push('a single-player level is never in the pool');
  if (level.randomPickups) errors.push('a single-player level has no randomPickups (fixed spots only)');
  level.keys.forEach((k, i) => checkPlacement(`key ${i}`, k));
  if (level.bonus) {
    if (level.keys.length || level.exit) errors.push('a bonus level has no keys or exit');
    if (!level.tiles.some((t) => t.type === 'paint')) errors.push('a bonus level needs paint tiles');
  } else {
    if (level.exit) checkPlacement('exit', level.exit);
    else errors.push('single-player level needs an exit');
    if (level.keysRequired !== level.keys.length) errors.push(`single player needs every key: keysRequired ${level.keysRequired} ≠ ${level.keys.length} keys`);
  }
  level.items.forEach((it, i) => {
    checkPlacement(`item ${i} (${it.type})`, it);
    if (!ITEM_TYPES.includes(it.type)) errors.push(`item ${i}: unknown type ${it.type}`);
    if ((it.type === 'fruit') !== it.fruit >= 0) errors.push(`item ${i}: a fruit needs a known fruit kind, other items none`);
  });
  if (!(level.parSec > 0 && level.parSec <= level.timeLimitSec)) errors.push(`parSec must be in (0, timeLimitSec], got ${level.parSec}`);
}
