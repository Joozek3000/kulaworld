import { dirVec } from '../dir.ts';
import type { Pose, Tile } from '../level/types.ts';
import { add, cellKey, scale, sub, type Vec3 } from '../vec.ts';
import { Action, isSolid, type Cmd, type World } from './world.ts';

/** Tiles & traps (ARCHITECTURE §18). A ball at `pose` stands on the tile (pose.cell − up, up). */

/** The whole-block tile (ice, fire, crumble) under a ball, if its block is still there. */
export function blockTileAt(world: World, pose: Pose): Tile | undefined {
  const block = sub(pose.cell, dirVec(pose.up));
  return isSolid(world, block) ? world.level.blockTiles.get(cellKey(block)) : undefined;
}

/** The face tile (spikes, arrow, boost) under a ball, if its block is still there. */
export function faceTileAt(world: World, pose: Pose): Tile | undefined {
  const block = sub(pose.cell, dirVec(pose.up));
  return isSolid(world, block) ? world.level.faceTiles.get(`${cellKey(block)}|${pose.up}`) : undefined;
}

/** Spikes are up at `tick`: always when static, else for `upTicks` of every `period`, offset by `phase`. */
export const spikesUp = (t: Tile, tick: number): boolean =>
  !t.period || (((tick + t.phase) % t.period) + t.period) % t.period < t.upTicks;

/** A ball on this pose right now is killed by spikes. */
export function spiked(world: World, pose: Pose, tick = world.tick): boolean {
  const t = faceTileAt(world, pose);
  return t?.type === 'spikes' && spikesUp(t, tick);
}

/** Arrow tiles (§18): fwd moves only along the arrow. Turning and hopping stay allowed. */
export function fwdAllowed(world: World, pose: Pose): boolean {
  const t = faceTileAt(world, pose);
  return t?.type !== 'arrow' || t.dir === pose.fwd;
}

/** On an ice block (a jump there goes forward even without W). */
export const onIce = (world: World, pose: Pose): boolean => blockTileAt(world, pose)?.type === 'ice';

/**
 * The forced move after `finished` ends on `pose` (§18): arriving on a boost pad by a roll, flip, climb or knock
 * (a slide's roll too) launches ('boost', always along the pad's dir, phase 14c); arriving on a teleporter the same
 * ways warps ('teleport', phase 13b; the arrival itself never re-triggers); a roll/flip/climb or a knock onto
 * ice keeps rolling ('fwd'; a knocked ball slides in the knock direction, the caller turns it that way). Else null.
 */
export function forcedAfter(world: World, pose: Pose, finished: Action): Cmd | null {
  if (finished !== Action.Roll && finished !== Action.Flip && finished !== Action.Climb && finished !== Action.Knocked) return null;
  const face = faceTileAt(world, pose)?.type;
  if (face === 'boost' || face === 'teleport') return face;
  return onIce(world, pose) ? 'fwd' : null;
}

/** The group of an active laser beam through `cell` (phase 13b), or null. */
export function beamAt(world: World, cell: Vec3): string | null {
  const groups = world.level.beams.size ? world.level.beams.get(cellKey(cell)) : undefined;
  return groups?.find((g) => world.lasers.get(g)) ?? null;
}

/**
 * The cells an action from `from` to cell `to` passes through, in order (phase 13b, laser deaths): up along from.up
 * first (a high boost), then across (a roll, knock, jump or flight), then down (a flip's drop, a fall).
 */
export function pathCells(from: Pose, to: Vec3): Vec3[] {
  const U = dirVec(from.up), d = sub(to, from.cell);
  const u = d.x * U.x + d.y * U.y + d.z * U.z, lat = sub(d, scale(U, u));
  const n = Math.abs(lat.x) + Math.abs(lat.y) + Math.abs(lat.z);
  const cells = [from.cell];
  let c = from.cell;
  const walk = (v: Vec3, k: number) => { for (let i = 0; i < k; i++) cells.push((c = add(c, v))); };
  if (u > 0) walk(U, u);
  walk({ x: Math.sign(lat.x), y: Math.sign(lat.y), z: Math.sign(lat.z) }, n);
  if (u < 0) walk(scale(U, -1), -u);
  return cells;
}

/** The first cell of `cells` in an active beam, or null. */
export const beamHit = (world: World, cells: Vec3[]): Vec3 | null => (world.level.beams.size ? cells.find((c) => beamAt(world, c)) ?? null : null);

/**
 * For planning (BFS): any spikes (retracting ones too, bots don't time them), fire and an active laser beam count as
 * lethal. Vanishing blocks aren't solid in planning worlds at all (planWorld).
 */
export function lethalForPlanning(world: World, pose: Pose): boolean {
  return faceTileAt(world, pose)?.type === 'spikes' || blockTileAt(world, pose)?.type === 'fire' || beamAt(world, pose.cell) !== null;
}

