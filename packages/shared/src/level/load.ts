import { CRUMBLE_REGROW_SEC, PICKUP_RESPAWN_SEC, HEAT_BURN_TICKS, HEAT_WARN_TICKS, TICK_RATE } from '../constants.ts';
import { dirVec, parseDir } from '../dir.ts';
import { add, cellKey, scale, vec, type Vec3 } from '../vec.ts';
import { BLOCK_TILES, FRUITS, type BlockFlags, type Level, type LevelJson, type PickupType, type Tile, type Vanish } from './types.ts';

const v3 = (a: [number, number, number]): Vec3 => vec(a[0], a[1], a[2]);

/** Expands boxes, parses dirs and computes the AABB. Throws on malformed dirs; use validateLevel for rule checks. */
export function loadLevel(json: LevelJson): Level {
  const solid = new Set<string>(), invisible = new Set<string>(), vanish = new Map<string, Vanish>(), tints = new Map<string, string>();
  const cells: Vec3[] = [];
  const flag = (c: Vec3, f: BlockFlags) => {
    if (f.invisible) invisible.add(cellKey(c));
    if (f.tint) tints.set(cellKey(c), f.tint);
    if (f.vanish) vanish.set(cellKey(c), { period: f.vanish.period, on: f.vanish.on, phase: f.vanish.phase ?? 0 });
  };
  for (const b of json.blocks ?? []) {
    const c = v3(Array.isArray(b) ? b : b.cell);
    cells.push(c);
    if (!Array.isArray(b)) flag(c, b);
  }
  for (const b of json.boxes ?? []) {
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const surface = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
          if (!b.hollow || surface) { cells.push(vec(x, y, z)); flag(vec(x, y, z), b); }
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
    dir: t.dir ? parseDir(t.dir) : null, variant: t.variant ?? 'far', deathtrap: t.deathtrap ?? false, regrows: t.regrowSec !== undefined,
    pair: t.pair ?? '', group: t.group ?? '',
  }));
  const blockTiles = new Map<string, Tile>(), faceTiles = new Map<string, Tile>();
  for (const t of tiles) {
    if (t.face === null) blockTiles.set(cellKey(t.block), t);
    else faceTiles.set(`${cellKey(t.block)}|${t.face}`, t);
  }
  // Teleporters (phase 13b): each end of a pair of exactly two points at the other.
  const partners = new Map<string, Tile>();
  for (const t of tiles) {
    if (t.type !== 'teleport' || t.face === null) continue;
    const ends = tiles.filter((u) => u.type === 'teleport' && u.pair === t.pair);
    if (ends.length === 2) partners.set(`${cellKey(t.block)}|${t.face}`, ends[0] === t ? ends[1] : ends[0]);
  }
  const lasers = (json.lasers ?? []).map((l) => {
    const from = v3(l.from), dir = parseDir(l.dir);
    return { group: l.group, from, dir, length: l.length, on: l.on, cells: Array.from({ length: l.length }, (_, i) => add(from, scale(dirVec(dir), i))) };
  });
  const beams = new Map<string, string[]>();
  for (const l of lasers) for (const c of l.cells) beams.set(cellKey(c), [...(beams.get(cellKey(c)) ?? []), l.group]);

  return {
    id: json.id,
    name: json.name,
    version: json.version,
    mode: json.mode ?? 'race',
    pool: json.pool ?? false,
    lab: json.lab ?? false,
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
    pickups: (json.pickups ?? []).map((p) => ({
      cell: v3(p.cell), up: parseDir(p.up), type: p.type, respawnTicks: Math.round((p.respawnSec ?? PICKUP_RESPAWN_SEC) * TICK_RATE),
    })),
    randomPickups: json.randomPickups
      ? {
        everyTicks: Math.round(json.randomPickups.everySec * TICK_RATE), types: json.randomPickups.types, maxOnMap: json.randomPickups.maxOnMap,
        weights: pickupWeights(json.randomPickups.types, json.randomPickups.weights ?? { lethargy: 15 }),
      }
      : null,
    theme: json.theme ?? null,
    notes: json.notes ?? {},
    campaign: json.campaign ?? 0,
    parSec: json.parSec ?? 0,
    bonus: json.bonus ?? false,
    items: (json.items ?? []).map((i) => ({ cell: v3(i.cell), up: parseDir(i.up), type: i.type, fruit: i.fruit ? FRUITS.indexOf(i.fruit) : -1 })),
    blockTiles,
    faceTiles,
    tints,
    invisible,
    vanish,
    lasers,
    beams,
    partners,
  };
}

/** A block in the level as authored. The sim asks `isSolid(world, v)` instead, which also sees crumbled blocks. */
export const levelSolid = (level: Level, v: Vec3): boolean => level.solid.has(cellKey(v));

/** Percent per type (15b): the given ones, and the rest of 100 split equally among the others. A lone type gets it all. */
function pickupWeights(types: PickupType[], given: Partial<Record<PickupType, number>>): number[] {
  if (types.length === 1) return [100];
  const rest = types.filter((t) => given[t] === undefined);
  const share = rest.length ? (100 - types.reduce((a, t) => a + (given[t] ?? 0), 0)) / rest.length : 0;
  return types.map((t) => given[t] ?? share);
}
