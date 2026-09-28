import { BOUNCY_TICKS, HEAVY_TICKS, LETHARGY_TICKS, SUNGLASSES_TICKS } from '../constants.ts';
import { ALL_DIRS, dirVec, opposite, perpendicular, type Dir } from '../dir.ts';
import type { Level, PickupType, Placement } from '../level/types.ts';
import { rngNext } from '../rng.ts';
import { add, cellKey, eq, sub } from '../vec.ts';
import { beamAt } from './tiles.ts';
import { Action, createWorld, hasEffect, isSolid, type Effect, type PlayerState, type SimEvent, type World } from './world.ts';

/** Pickups & pills (ARCHITECTURE §21, phase 15a). */

export const EFFECT_TICKS: Record<PickupType, number> = {
  bouncy: BOUNCY_TICKS, lethargy: LETHARGY_TICKS, heavy: HEAVY_TICKS, sunglasses: SUNGLASSES_TICKS,
};

/** Lethargy: an action you start lasts ×1.6, rounded up (ceil(8t/5), in integers). */
export const ownTicks = (p: { effects?: readonly Effect[] }, ticks: number): number =>
  hasEffect(p, 'lethargy') ? Math.floor((ticks * 8 + 4) / 5) : ticks;

/** A ball's action finished in `p.pose.cell`: it takes the pickup there (like a key: the cell counts, not the face). */
export function collectPickup(world: World, p: PlayerState, events: SimEvent[]): void {
  const k = world.pickups.find((q) => eq(q.cell, p.pose.cell));
  if (!k) return;
  world.pickups = world.pickups.filter((q) => q !== k);
  if (k.spot >= 0) world.pickupBack[k.spot] = world.tick + world.level.pickups[k.spot].respawnTicks;
  // The same type refreshes its duration. Replaced, not mutated: the predictor keeps snapshots of this array.
  p.effects = [...p.effects.filter((e) => e.type !== k.type), { type: k.type, untilTick: world.tick + EFFECT_TICKS[k.type] }];
  events.push({ type: 'pickup', playerId: p.id, pickupId: k.id, pickup: k.type });
}

/**
 * Start of a tick: effects that end now go (event `effectEnd`); pickups whose block is gone go too (a fixed spot then
 * counts down to come back). With `spawnPickups`: fixed spots come back when their time is up and nobody is on them,
 * and every `everyTicks` a random one spawns on a free candidate tile while fewer than `maxOnMap` random ones are out.
 */
export function stepPickups(world: World, events: SimEvent[]): void {
  const tick = world.tick;
  for (const p of world.players) {
    if (!p.effects.some((e) => tick >= e.untilTick)) continue;
    for (const e of p.effects) if (tick >= e.untilTick) events.push({ type: 'effectEnd', playerId: p.id, effect: e.type });
    p.effects = p.effects.filter((e) => tick < e.untilTick);
  }
  if (!world.spawnPickups) return;
  for (const k of world.pickups) {
    if (isSolid(world, sub(k.cell, dirVec(k.up)))) continue;
    world.pickups = world.pickups.filter((q) => q !== k);
    if (k.spot >= 0) world.pickupBack[k.spot] = tick + world.level.pickups[k.spot].respawnTicks;
  }
  world.level.pickups.forEach((s, i) => {
    const back = world.pickupBack[i];
    if (back < 0 || tick < back || !spotOpen(world, s)) return;
    world.pickupBack[i] = -1;
    world.pickups.push({ id: world.nextPickupId++, spot: i, cell: s.cell, up: s.up, type: s.type });
  });
  const r = world.level.randomPickups;
  if (!r || tick % r.everyTicks || world.pickups.filter((k) => k.spot < 0).length >= r.maxOnMap) return;
  world.pickupSpots ??= pickupCandidates(world.level);
  const open = world.pickupSpots.filter((s) => spotOpen(world, s));
  if (!open.length) return;
  const a = rngNext(world.pickupRng), b = rngNext(a.state);
  world.pickupRng = b.state;
  const s = open[Math.floor(a.value * open.length)];
  let x = b.value * r.weights.reduce((a, w) => a + w, 0), i = 0; // weighted (15b)
  while (i < r.types.length - 1 && (x -= r.weights[i]) >= 0) i++;
  world.pickups.push({ id: world.nextPickupId++, spot: -1, cell: s.cell, up: s.up, type: r.types[i] });
}

/** A pickup can appear on `s` now: its block is there and not about to go, no pickup or ball is in it, no beam is on. */
function spotOpen(world: World, s: Placement): boolean {
  const block = sub(s.cell, dirVec(s.up)), k = world.knockout;
  if (!isSolid(world, block) || world.crumbling.has(cellKey(block))) return false;
  if (k && k.warn >= 0 && k.bands[k.warn].includes(cellKey(block))) return false;
  if (world.pickups.some((q) => eq(q.cell, s.cell)) || beamAt(world, s.cell)) return false;
  return !world.players.some((p) => p.action !== Action.Dead && (eq(p.pose.cell, s.cell) || eq(p.to.cell, s.cell)));
}

/** Where rolling from `s` along `d` goes, ignoring players and arrows: a roll, a flip over the edge or a climb. */
export function surfaceMove(w: World, s: Placement, d: Dir): Placement & { kind: 'roll' | 'flip' | 'climb' } {
  const A = add(s.cell, dirVec(d));
  if (isSolid(w, A)) return { cell: s.cell, up: opposite(d), kind: 'climb' };
  const below = sub(A, dirVec(s.up));
  return isSolid(w, below) ? { cell: A, up: s.up, kind: 'roll' } : { cell: below, up: d, kind: 'flip' };
}

/**
 * Why `s` can't hold a pickup (LEVEL-DESIGN §11), or null if it can: a standable tile with no trap (tile, beam,
 * vanishing or invisible block), not a spawn, key or exit, and more than 2 rolls/flips/climbs from every spawn.
 * `near` is the set of spots within 2 moves of a spawn (spotsNearSpawns), computed once per level.
 */
export function pickupSpotProblem(w: World, s: Placement, near: ReadonlySet<string>): string | null {
  const level = w.level, block = sub(s.cell, dirVec(s.up)), bk = cellKey(block);
  if (isSolid(w, s.cell) || !isSolid(w, block)) return 'not a standable tile';
  if (level.blockTiles.has(bk) || level.faceTiles.has(`${bk}|${s.up}`) || level.vanish.has(bk) || level.invisible.has(bk) || level.beams.has(cellKey(s.cell))) return 'on a trap tile';
  if ([...level.spawns, ...level.keys, ...(level.exit ? [level.exit] : [])].some((q) => eq(q.cell, s.cell))) return 'on a spawn, key or exit';
  if (near.has(`${cellKey(s.cell)}|${s.up}`)) return 'within 2 moves of a spawn';
  return null;
}

/** Spots (`cellKey|up`) at most 2 rolls/flips/climbs from a spawn. */
export function spotsNearSpawns(w: World): Set<string> {
  const key = (s: Placement) => `${cellKey(s.cell)}|${s.up}`;
  const seen = new Set(w.level.spawns.map(key));
  let frontier: Placement[] = w.level.spawns;
  for (let d = 1; d <= 2; d++) {
    const next: Placement[] = [];
    for (const s of frontier) for (const dir of ALL_DIRS.filter((x) => perpendicular(x, s.up))) {
      const m = surfaceMove(w, s, dir);
      if (!seen.has(key(m))) { seen.add(key(m)); next.push(m); }
    }
    frontier = next;
  }
  return seen;
}

/** Every tile a random pickup may spawn on (LEVEL-DESIGN §11), in level order. */
export function pickupCandidates(level: Level): Placement[] {
  const w = createWorld(level, 0), near = spotsNearSpawns(w), out: Placement[] = [];
  for (const k of level.solid) {
    const [x, y, z] = k.split(',').map(Number);
    for (const up of ALL_DIRS) {
      const s = { cell: add({ x, y, z }, dirVec(up)), up };
      if (!pickupSpotProblem(w, s, near)) out.push(s);
    }
  }
  return out;
}
