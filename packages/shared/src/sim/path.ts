import { dirVec } from '../dir.ts';
import type { Pose } from '../level/types.ts';
import { cellKey, sub } from '../vec.ts';
import { previewAction } from './actions.ts';
import { Action, isSolid, outOfBounds, type Cmd, type Reservations, type World } from './world.ts';

export interface PathStep { cmd: Cmd; to: Pose }

/** Moves a path can use. Hop never changes the pose, so it's left out. */
const MOVES: readonly Cmd[] = ['fwd', 'left', 'right', 'jump'];
const NO_PLAYERS: Reservations = new Map();

const poseKey = (p: Pose) => `${cellKey(p.cell)}|${p.up}|${p.fwd}`;

/**
 * Where `cmd` leaves a player at `pose`, ignoring other players (or, with `res`, treating their cells as obstacles:
 * no pushes, jumps fly over them, landing on one isn't allowed). A forward jump that lands in air
 * follows the fall to where it lands. Returns null if the move is blocked or ends in death.
 */
export function resultPose(world: World, pose: Pose, cmd: Cmd, res: Reservations = NO_PLAYERS): Pose | null {
  const plan = previewAction(world, { id: '', pose }, cmd, res);
  if (!plan || (res !== NO_PLAYERS && plan.bump)) return null; // routing around players: never through a stomp
  if (plan.action !== Action.Jump) return plan.to;
  const down = dirVec(pose.up);
  let cell = plan.to.cell;
  while (!isSolid(world, sub(cell, down))) {
    cell = sub(cell, down);
    if (outOfBounds(world.level, cell)) return null;
  }
  return { ...plan.to, cell };
}

/**
 * Breadth-first search over (cell, up, fwd) for the fewest moves until the player stands on any cell in
 * `goals` (cellKeys). Ignores other players, or with `res` (phase 12: bots routing around a blocker) routes around
 * the cells they occupy. Returns [] if already there, or null if unreachable.
 */
export function findPath(world: World, from: Pose, goals: ReadonlySet<string>, res: Reservations = NO_PLAYERS): PathStep[] | null {
  if (goals.has(cellKey(from.cell))) return [];
  const parent = new Map<string, { prev: string; step: PathStep } | null>([[poseKey(from), null]]);
  let frontier: Pose[] = [from];
  while (frontier.length) {
    const next: Pose[] = [];
    for (const pose of frontier) {
      const key = poseKey(pose);
      for (const cmd of MOVES) {
        const to = resultPose(world, pose, cmd, res);
        if (!to) continue;
        const toKey = poseKey(to);
        if (parent.has(toKey)) continue;
        parent.set(toKey, { prev: key, step: { cmd, to } });
        if (goals.has(cellKey(to.cell))) return unwind(parent, toKey);
        next.push(to);
      }
    }
    frontier = next;
  }
  return null;
}

function unwind(parent: Map<string, { prev: string; step: PathStep } | null>, key: string): PathStep[] {
  const path: PathStep[] = [];
  for (let e = parent.get(key); e; e = parent.get(e.prev)) path.push(e.step);
  return path.reverse();
}
