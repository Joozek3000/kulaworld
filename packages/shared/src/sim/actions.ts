import { BOOST_TICKS, CLIMB_TICKS, FALL_TICKS_PER_CELL, FLIP_TICKS, JUMP_TICKS, ROLL_TICKS, TELEPORT_TICKS, TURN_TICKS } from '../constants.ts';
import { cross, dirVec, opposite, type Dir } from '../dir.ts';
import type { Pose } from '../level/types.ts';
import { add, cellKey, eq, sub, type Vec3 } from '../vec.ts';
import { faceTileAt, fwdAllowed } from './tiles.ts';
import { Action, isFree, isPushable, isSolid, outOfBounds, reservations, type BoostBlock, type Cmd, type PlayerState, type Reservations, type World } from './world.ts';

/** `over`: a forward jump over a player on A1. `bump`: a stomp jump's bump cell B (§16). */
export interface Plan { action: Action; to: Pose; ticks: number; over?: boolean; bump?: Vec3 }

/** A live player standing in `cell` on face `up` (the stomp target of a jump landing there). */
export const standingAt = (world: World, cell: Vec3, up: Dir, selfId: string): PlayerState | undefined =>
  world.players.find((v) => v.id !== selfId && v.action !== Action.Dead && v.pose.up === up
    && v.pose.cell.x === cell.x && v.pose.cell.y === cell.y && v.pose.cell.z === cell.z);

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
  if ((cmd === 'fwd' || cmd === 'jump') && !fwdAllowed(world, self.pose)) return null; // an arrow tile (§18)

  switch (cmd) {
    case 'left':
    case 'right':
      return { action: Action.Turn, to: { cell: C, up, fwd: turnFwd(up, fwd, cmd === 'left' ? -1 : 1) }, ticks: TURN_TICKS };
    case 'fwd': {
      const A = add(C, F);
      // A wall ahead becomes the floor (§5, phase 11): the ball stays in C and turns up onto it.
      if (isSolid(world, A)) return { action: Action.Climb, to: { cell: C, up: opposite(fwd), fwd: up }, ticks: CLIMB_TICKS };
      if (!free(A)) return null; // a player
      const below = sub(A, U);
      if (isSolid(world, below)) return { action: Action.Roll, to: { cell: A, up, fwd }, ticks: ROLL_TICKS };
      if (!free(below)) return null;
      return { action: Action.Flip, to: { cell: below, up: fwd, fwd: opposite(up) }, ticks: FLIP_TICKS };
    }
    case 'jump': {
      // §16: a player on A1 doesn't block (the ball passes over); a block does. Landing L is A2, else A1 (short
      // jump). A player standing in L makes it a stomp jump if the bump cell L + F is free; otherwise L isn't free.
      const A1 = add(C, F);
      if (isSolid(world, A1)) return null;
      const over = !free(A1);
      for (const L of [add(A1, F), A1]) {
        if (isSolid(world, L)) continue;
        // A high hopper in L isn't reserved (§14 roll under) but still isn't a place to land: a stomp or nothing.
        const onL = standingAt(world, L, up, self.id);
        if (free(L) && !onL) return { action: Action.Jump, to: { cell: L, up, fwd }, ticks: JUMP_TICKS, over };
        const B = add(L, F);
        // With push rules off there are no stomps: a player in L just makes it not free (the old fallback).
        if (world.rules.push && onL && free(B)) {
          return { action: Action.Jump, to: { cell: L, up, fwd }, ticks: JUMP_TICKS, over, bump: B };
        }
      }
      return null;
    }
    case 'boost': {
      // §18: a forced jump off a boost pad, always along the pad's dir (phase 14c; the ball turns to face it). far: 3
      // cells ahead; high: 2 ahead and 1 up. The cells flown through must be open (no fallback to a shorter launch).
      // Landing, stomp and fall rules are the jump's, but a ball on the landing that can't be stomped blocks it.
      const t = faceTileAt(world, self.pose);
      if (t?.type !== 'boost' || boostBlock(world, self, res)) return null;
      const fwd = t.dir!, F = dirVec(fwd);
      const high = t.variant === 'high';
      const L = high ? add(add(C, F), add(F, U)) : add(add(C, F), add(F, F));
      const through = high ? [add(C, U), add(add(C, F), U)] : [add(C, F), add(add(C, F), F)];
      if (through.some((c) => isSolid(world, c)) || isSolid(world, L)) return null;
      const over = !free(add(C, F));
      const onL = standingAt(world, L, up, self.id);
      if (free(L) && !onL) return { action: Action.Jump, to: { cell: L, up, fwd }, ticks: BOOST_TICKS, over };
      const B = add(L, F);
      if (world.rules.push && onL && free(B)) {
        return { action: Action.Jump, to: { cell: L, up, fwd }, ticks: BOOST_TICKS, over, bump: B };
      }
      return null;
    }
    case 'teleport': {
      // §18 (phase 13b): to the partner tile, facing the same way relative to the face. Its cell taken (reserved,
      // or anyone in it, a high hopper too) or its block gone: blocked (the caller holds the ball, like a boost).
      const to = teleportTarget(world, self.pose);
      if (!to || !free(to.cell) || world.players.some((v) => v.id !== self.id && v.action !== Action.Dead && eq(v.pose.cell, to.cell))) return null;
      return { action: Action.Teleport, to, ticks: TELEPORT_TICKS };
    }
    case 'hop':
      if (isSolid(world, add(C, U))) return null; // low ceiling
      return { action: Action.Hop, to: { cell: C, up, fwd }, ticks: JUMP_TICKS };
  }
}

/**
 * Facing after a teleport from face `from` to face `to` (phase 13b): the rotation taking `from` onto `to` applied to
 * fwd. Same face: unchanged. Opposite faces: the half turn about fwd (unchanged). Perpendicular: the quarter turn
 * about from × to, which takes `to` to −from and −to to from, and leaves the axis alone.
 */
export function teleportFwd(from: Dir, to: Dir, fwd: Dir): Dir {
  if (from === to || from === opposite(to)) return fwd;
  if (fwd === to) return opposite(from);
  if (fwd === opposite(to)) return from;
  return fwd;
}

/** Where a teleport from `pose` (on a teleporter) arrives: the partner tile, or null (no partner, or its block is gone). */
export function teleportTarget(world: World, pose: Pose): Pose | null {
  const t = faceTileAt(world, pose), dest = t?.type === 'teleport' ? world.level.partners.get(`${cellKey(t.block)}|${t.face}`) : undefined;
  if (!dest || !isSolid(world, dest.block)) return null;
  const cell = add(dest.block, dirVec(dest.face!));
  return isSolid(world, cell) ? null : { cell, up: dest.face!, fwd: teleportFwd(pose.up, dest.face!, pose.fwd) };
}

/** Why the boost launch from `self`'s pad can't start now (phase 14c), or null if it can. */
export function boostBlock(
  world: World, self: Pick<PlayerState, 'id' | 'pose'>, res: Reservations = reservations(world),
): { reason: BoostBlock; byId?: string } | null {
  const t = faceTileAt(world, self.pose);
  if (t?.type !== 'boost') return null;
  const { cell: C, up } = self.pose, U = dirVec(up), F = dirVec(t.dir!);
  const high = t.variant === 'high';
  const L = high ? add(add(C, F), add(F, U)) : add(add(C, F), add(F, F));
  const through = high ? [add(C, U), add(add(C, F), U)] : [add(C, F), add(add(C, F), F)];
  if (through.some((c) => isSolid(world, c)) || isSolid(world, L)) return { reason: 'solid' };
  const owner = res.get(cellKey(L));
  const onL = standingAt(world, L, up, self.id);
  if (onL) {
    if (!world.rules.push || !isPushable(onL, world.tick)) return { reason: 'unstompable', byId: onL.id };
    const B = add(L, F);
    return isFree(world, res, self.id, B) ? null : { reason: 'bump', byId: onL.id };
  }
  return owner === undefined || owner === self.id ? null : { reason: 'reserved', byId: owner };
}

export interface StompPreview { victimId: string; bumpCell: Vec3; lethal: boolean }

/**
 * Would a forward jump from `pose` right now be a stomp (§16)? Who it hits, where they'd be bumped, and whether that
 * bump is lethal (no block below B until the ball leaves the level). For bots; the landing itself is resolved later,
 * so the victim may still escape or clash.
 */
export function stompPreview(world: World, pose: Pose, selfId = ''): StompPreview | null {
  const plan = previewAction(world, { id: selfId, pose }, 'jump');
  if (!plan?.bump) return null;
  const victim = standingAt(world, plan.to.cell, plan.to.up, selfId)!;
  const down = dirVec(plan.to.up);
  let c = plan.bump, lethal = false;
  while (!isSolid(world, sub(c, down))) {
    c = sub(c, down);
    if (outOfBounds(world.level, c)) { lethal = true; break; }
  }
  return { victimId: victim.id, bumpCell: plan.bump, lethal };
}

export function startAction(p: PlayerState, plan: Plan, tick: number): void {
  p.action = plan.action;
  p.to = plan.to;
  p.jumpOver = plan.over ?? false;
  p.stompBump = plan.bump ?? null;
  p.graceUntil = -1; // tryCmds re-arms it for a roll started from rest
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
  if (isSolid(world, below)) return false;
  p.forced = null; // a slide or launch never survives losing the ground
  p.staggerOwed = false;
  startAction(p, { action: Action.Fall, to: { cell: below, up, fwd }, ticks: FALL_TICKS_PER_CELL }, tick);
  return true;
}
