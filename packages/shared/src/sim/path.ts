import { dirVec } from '../dir.ts';
import type { Pose } from '../level/types.ts';
import { cellKey, sub } from '../vec.ts';
import { FIRE_MAX, FORCED_MAX } from '../constants.ts';
import { previewAction } from './actions.ts';
import { blockTileAt, faceTileAt, forcedAfter } from './tiles.ts';
import { Action, isSolid, outOfBounds, type Cmd, type Reservations, type World } from './world.ts';

/** `fire`: fire landings in a row on arrival (§18), tracked so a plan never takes a third. */
export interface PathStep { cmd: Cmd; to: PlanPose }
export type PlanPose = Pose & { fire: number };
/** Fire landings in a row a plan may take (a third pops the ball). 0 makes fire a wall. */
export const PLAN_FIRE_MAX = FIRE_MAX - 1;

/** Moves a path can use. Hop never changes the pose, so it's left out. */
const MOVES: readonly Cmd[] = ['fwd', 'left', 'right', 'jump'];
const NO_PLAYERS: Reservations = new Map();

const poseKey = (p: PlanPose) => `${cellKey(p.cell)}|${p.up}|${p.fwd}|${p.fire}`;

/**
 * Where `cmd` leaves a player at `pose`, ignoring other players (or, with `res`, treating their cells as obstacles:
 * no pushes, jumps fly over them, landing on one isn't allowed). A forward jump that lands in air
 * follows the fall to where it lands, and forced moves (ice slides, boost launches, §18) are followed to where they
 * stop. Returns null if the move is blocked or ends in death: a fatal fall, spikes (retracting ones too: bots don't
 * time them), or a fire landing past `fireMax` in a row. `fire` is the count before the move (turns keep it).
 */
export function resultPose(
  world: World, pose: Pose, cmd: Cmd, res: Reservations = NO_PLAYERS, fire = 0, fireMax = PLAN_FIRE_MAX,
): PlanPose | null {
  let from: PlanPose = { ...pose, fire }, next: Cmd | null = cmd;
  for (let i = 0; next; i++) {
    const plan = previewAction(world, { id: '', pose: from }, next, res);
    if (!plan) return i ? from : null; // a forced slide that's blocked just stops
    if (res !== NO_PLAYERS && plan.bump) return null; // routing around players: never through a stomp
    const to = plan.action === Action.Jump ? landing(world, plan.to) : plan.to;
    if (!to || faceTileAt(world, to)?.type === 'spikes' || i > FORCED_MAX) return null;
    const landed = plan.action !== Action.Turn && plan.action !== Action.Hop;
    const f = !landed ? from.fire : blockTileAt(world, to)?.type === 'fire' ? from.fire + 1 : 0;
    if (f > fireMax) return null;
    next = forcedAfter(world, to, plan.action);
    from = { ...to, fire: f };
  }
  return from;
}


/** Where a jump to `to` comes down: the first cell with ground below along −up, or null off the map. */
function landing(world: World, to: Pose): Pose | null {
  const down = dirVec(to.up);
  let cell = to.cell;
  while (!isSolid(world, sub(cell, down))) {
    cell = sub(cell, down);
    if (outOfBounds(world.level, cell)) return null;
  }
  return { ...to, cell };
}

/**
 * Breadth-first search over (cell, up, fwd, fire count) for the fewest moves until the player stands on any cell in
 * `goals` (cellKeys). Ignores other players, or with `res` (phase 12: bots routing around a blocker) routes around
 * the cells they occupy. `fire`: the player's fire landings in a row now; up to `fireMax` in a row are allowed (0:
 * fire is a wall). Returns [] if already there, or null if unreachable.
 */
export function findPath(
  world: World, from: Pose, goals: ReadonlySet<string>, res: Reservations = NO_PLAYERS, fire = 0, fireMax = PLAN_FIRE_MAX,
): PathStep[] | null {
  if (goals.has(cellKey(from.cell))) return [];
  const start: PlanPose = { ...from, fire };
  const parent = new Map<string, { prev: string; step: PathStep } | null>([[poseKey(start), null]]);
  let frontier: PlanPose[] = [start];
  while (frontier.length) {
    const next: PlanPose[] = [];
    for (const pose of frontier) {
      const key = poseKey(pose);
      for (const cmd of MOVES) {
        const to = resultPose(world, pose, cmd, res, pose.fire, fireMax);
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
