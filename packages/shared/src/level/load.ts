import { CRUMBLE_REGROW_SEC, HEAT_BURN_TICKS, HEAT_WARN_TICKS, TICK_RATE } from '../constants.ts';
import { parseDir } from '../dir.ts';
import { cellKey, vec, type Vec3 } from '../vec.ts';
import { BLOCK_TILES, type Level, type LevelJson, type Tile } from './types.ts';

const v3 = (a: [number, number, number]): Vec3 => vec(a[0], a[1], a[2]);

/** Expands boxes, parses dirs and computes the AABB. Throws on malformed dirs; use validateLevel for rule checks. */
export function loadLevel(json: LevelJson): Level {
  const solid = new Set<string>();
  const cells: Vec3[] = (json.blocks ?? []).map(v3);
  for (const b of json.boxes ?? []) {
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const surface = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
          if (!b.hollow || surface) cells.push(vec(x, y, z));
        }
  }
  const min = vec(Infinity, Infinity, Infinity), max = vec(-Infinity, -Infinity, -Infinity);
  for (const c of cells) {
    solid.add(cellKey(c));
    min.x = Math.min(min.x, c.x); min.y = Math.min(min.y, c.y); min.z = Math.min(min.z, c.z);
    max.x = Math.max(max.x, c.x); max.y = Math.max(max.y, c.y); max.z = Math.max(max.z, c.z);
  }
  if (!cells.length) { min.x = min.y = min.z = max.x = max.y = max.z = 0; }

  const tiles: Tile[] = (json.tiles ?? []).map((t) => ({
    block: v3(t.block), type: t.type, face: BLOCK_TILES.includes(t.type) || !t.face ? null : parseDir(t.face),
    regrowTicks: Math.round((t.regrowSec ?? CRUMBLE_REGROW_SEC) * TICK_RATE),
    period: t.period ?? 0, upTicks: t.up ?? 0, phase: t.phase ?? 0,
    dir: t.dir ? parseDir(t.dir) : null, variant: t.variant ?? 'far',
  }));
  const blockTiles = new Map<string, Tile>(), faceTiles = new Map<string, Tile>();
  for (const t of tiles) {
    if (t.face === null) blockTiles.set(cellKey(t.block), t);
    else faceTiles.set(`${cellKey(t.block)}|${t.face}`, t);
  }

  return {
    id: json.id,
    name: json.name,
    version: json.version,
    mode: json.mode ?? 'race',
    lives: json.lives ?? 0,
    crumble: json.crumble ?? null,
    heat: json.heat === false ? null
      : { warnTicks: Math.round((json.heat?.warnSec ?? HEAT_WARN_TICKS / TICK_RATE) * TICK_RATE), burnTicks: Math.round((json.heat?.burnSec ?? HEAT_BURN_TICKS / TICK_RATE) * TICK_RATE) },
    sky: json.sky ?? null,
    solid,
    min,
    max,
    spawns: json.spawns.map((s) => ({ cell: v3(s.cell), up: parseDir(s.up), fwd: parseDir(s.fwd) })),
    keys: (json.keys ?? []).map((k) => ({ cell: v3(k.cell), up: parseDir(k.up) })),
    exit: json.exit ? { cell: v3(json.exit.cell), up: parseDir(json.exit.up) } : null,
    keysRequired: json.keysRequired ?? 0,
    timeLimitSec: json.timeLimitSec,
    tiles,
    blockTiles,
    faceTiles,
  };
}

/** A block in the level as authored. The sim asks `isSolid(world, v)` instead, which also sees crumbled blocks. */
export const levelSolid = (level: Level, v: Vec3): boolean => level.solid.has(cellKey(v));
