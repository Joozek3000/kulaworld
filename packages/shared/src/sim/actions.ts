import { FALL_TICKS_PER_CELL, FLIP_TICKS, JUMP_TICKS, ROLL_TICKS, TURN_TICKS } from '../constants.ts';
import { cross, dirVec, opposite, type Dir } from '../dir.ts';
import { isSolid } from '../level/load.ts';
import type { Pose } from '../level/types.ts';
import { add, sub, type Vec3 } from '../vec.ts';
import { Action, isFree, reservations, type Cmd, type PlayerState, type Reservations, type World } from './world.ts';

export interface Plan { action: Action; to: Pose; ticks: number }

/** left = cross(U, F), right = cross(F, U). With U=+Y, F=+Z: right is -X. */
export const turnFwd = (up: Dir, fwd: Dir, turn: -1 | 1): Dir => (turn < 0 ? cross(up, fwd) : cross(fwd, up));

/**
 * What `cmd` would do for a player at `self.pose`, or null if it is blocked.
 * Pure: reads the world, never mutates it. Bots use it for BFS.
 */
export function previewAction(
  world: World,
  self: Pick<PlayerState, 'id' | 'pose'>,
  cmd: Cmd,
  res: Reservations = reservations(world),
): Plan | null {
  const { cell: C, up, fwd } = self.pose;
  const U = dirVec(up), F = dirVec(fwd);
  const free = (v: Vec3) => isFree(world, res, self.id, v);

  switch (cmd) {
    case 'left':
    case 'right':
      return { action: Action.Turn, to: { cell: C, up, fwd: turnFwd(up, fwd, cmd === 'left' ? -1 : 1) }, ticks: TURN_TICKS };
    case 'fwd': {
      const A = add(C, F);
      if (!free(A)) return null; // wall or player
      const below = sub(A, U);
      if (isSolid(world.level, below)) return { action: Action.Roll, to: { cell: A, up, fwd }, ticks: ROLL_TICKS };
      if (!free(below)) return null;
      return { action: Action.Flip, to: { cell: below, up: fwd, fwd: opposite(up) }, ticks: FLIP_TICKS };
    }
    case 'jump': {
      const A1 = add(C, F);
      if (!free(A1)) return null;
      const A2 = add(A1, F);
      return { action: Action.Jump, to: { cell: free(A2) ? A2 : A1, up, fwd }, ticks: JUMP_TICKS };
    }
    case 'hop':
      if (isSolid(world.level, add(C, U))) return null; // low ceiling
      return { action: Action.Hop, to: { cell: C, up, fwd }, ticks: JUMP_TICKS };
  }
}

export function startAction(p: PlayerState, plan: Plan, tick: number): void {
  p.action = plan.action;
  p.to = plan.to;
  p.startTick = tick;
  p.endTick = tick + plan.ticks;
  // Reset a stale mid-air turn record, but keep one that is still spinning (e.g. a turn on the landing tick of a
  // chained hop), so the next action carries on rendering it instead of snapping.
  if (tick - p.turnStartTick >= TURN_TICKS) {
    p.turnFromFwd = plan.to.fwd;
    p.turnStartTick = tick;
  }
}

/** Starts one fall step along -up if nothing is below. Returns false when the player is standing on a block. */
export function startFall(world: World, p: PlayerState, tick: number): boolean {
  const { cell, up, fwd } = p.pose;
  const below = sub(cell, dirVec(up));
  if (isSolid(world.level, below)) return false;
  startAction(p, { action: Action.Fall, to: { cell: below, up, fwd }, ticks: FALL_TICKS_PER_CELL }, tick);
  return true;
}
