import { INPUT_BUFFER_TICKS, KILL_MARGIN, RESPAWN_TICKS } from '../constants.ts';
import type { Vec3 } from '../vec.ts';
import { previewAction, startAction, startFall } from './actions.ts';
import { checkTimeout, onLand } from './keyRace.ts';
import { Action, reservations, reserve, trySpawn, type Cmd, type PlayerState, type SimEvent, type World } from './world.ts';

/** Advances the world by one tick (ARCHITECTURE §7). Returns the events of this tick. */
export function step(world: World): SimEvent[] {
  const tick = ++world.tick;
  const events: SimEvent[] = [];
  const order = fairOrder(world.players, tick);

  for (const p of order) if (p.action !== Action.Idle && p.endTick === tick) finishAction(world, p, events);

  const intents = order.filter((p) => p.action === Action.Idle).map((p) => ({ p, cmds: commands(p, tick) }));
  resolveMoves(world, intents);

  checkTimeout(world, events);
  return events;
}

/** Join order rotated by tick % playerCount so no player always wins contested cells. */
function fairOrder(players: PlayerState[], tick: number): PlayerState[] {
  const k = players.length ? tick % players.length : 0;
  return [...players.slice(k), ...players.slice(0, k)];
}

/**
 * Candidate commands in priority order: the buffered pulse (jump beats turn at input time), then held forward.
 * A jump pulse jumps forward if fwd is held on this tick, otherwise hops in place; a blocked forward jump hops.
 */
function commands(p: PlayerState, tick: number): Cmd[] {
  if (p.pulse && tick - p.pulseTick > INPUT_BUFFER_TICKS) p.pulse = null;
  const cmds: Cmd[] = [];
  if (p.pulse === 'jump') cmds.push(...(p.fwdHeld ? ['jump', 'hop'] as const : ['hop'] as const));
  else if (p.pulse) cmds.push(p.pulse);
  if (p.fwdHeld) cmds.push('fwd');
  return cmds;
}

/**
 * The single place where all Idle players' intended moves are resolved against each other.
 * Players claim cells in fair order; a later player sees earlier claims as reserved.
 * PvP push resolution belongs here.
 */
function resolveMoves(world: World, intents: { p: PlayerState; cmds: Cmd[] }[]): void {
  const res = reservations(world);
  for (const { p, cmds } of intents) {
    for (const cmd of cmds) {
      if (cmd !== 'fwd') p.pulse = null; // a pulse is spent even if blocked
      const plan = previewAction(world, p, cmd, res);
      if (!plan) continue;
      startAction(p, plan, world.tick);
      reserve(res, p);
      break;
    }
  }
}

function finishAction(world: World, p: PlayerState, events: SimEvent[]): void {
  const tick = world.tick;
  if (p.action === Action.Dead) {
    if (trySpawn(world, p)) events.push({ type: 'respawn', playerId: p.id, cell: p.pose.cell });
    else p.endTick = tick + 1; // all spawns taken, retry next tick
    return;
  }
  const finished = p.action;
  p.pose = p.to;
  p.action = Action.Idle;
  if (finished === Action.Turn) return;
  if (finished === Action.Fall && outOfBounds(world, p.pose.cell)) {
    p.action = Action.Dead;
    p.startTick = tick;
    p.endTick = tick + RESPAWN_TICKS;
    events.push({ type: 'death', playerId: p.id, cell: p.pose.cell });
    return;
  }
  if ((finished === Action.Jump || finished === Action.Fall) && startFall(world, p, tick)) return;
  onLand(world, p, events);
}

function outOfBounds(world: World, c: Vec3): boolean {
  const { min, max } = world.level, m = KILL_MARGIN;
  return c.x < min.x - m || c.y < min.y - m || c.z < min.z - m || c.x > max.x + m || c.y > max.y + m || c.z > max.z + m;
}
