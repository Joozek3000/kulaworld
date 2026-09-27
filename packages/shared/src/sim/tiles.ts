import { dirVec } from '../dir.ts';
import type { Pose, Tile } from '../level/types.ts';
import { cellKey, sub } from '../vec.ts';
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
 * (a slide's roll too) launches ('boost', always along the pad's dir, phase 14c); a roll/flip/climb or a knock onto
 * ice keeps rolling ('fwd'; a knocked ball slides in the knock direction, the caller turns it that way). Else null.
 */
export function forcedAfter(world: World, pose: Pose, finished: Action): Cmd | null {
  if (finished !== Action.Roll && finished !== Action.Flip && finished !== Action.Climb && finished !== Action.Knocked) return null;
  if (faceTileAt(world, pose)?.type === 'boost') return 'boost';
  return onIce(world, pose) ? 'fwd' : null;
}

/** For planning (BFS): any spikes (retracting ones too, bots don't time them) and fire count as lethal. */
export function lethalForPlanning(world: World, pose: Pose): boolean {
  return faceTileAt(world, pose)?.type === 'spikes' || blockTileAt(world, pose)?.type === 'fire';
}

