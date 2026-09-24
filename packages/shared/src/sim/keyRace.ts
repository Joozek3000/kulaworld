import { eq } from '../vec.ts';
import type { PlayerState, SimEvent, World } from './world.ts';

/** Runs when an action finishes on the ground: key pickup, then the exit check. */
export function onLand(world: World, p: PlayerState, events: SimEvent[]): void {
  if (world.result) return;
  for (const k of world.keys) {
    if (k.collected || !eq(k.cell, p.pose.cell)) continue;
    k.collected = true;
    p.keys++;
    events.push({ type: 'key', playerId: p.id, keyId: k.id, keys: p.keys });
  }
  if (p.keys >= world.level.keysRequired && eq(world.level.exit.cell, p.pose.cell)) {
    world.result = { winnerId: p.id, reason: 'exit' };
    events.push({ type: 'win', winnerId: p.id, reason: 'exit' });
  }
}

/** At the time limit, most keys wins; a tie for most is a draw (winnerId null). */
export function checkTimeout(world: World, events: SimEvent[]): void {
  if (world.result || world.tick < world.timeLimitTick) return;
  let best = -1;
  let winnerId: string | null = null;
  for (const p of world.players) {
    if (p.keys > best) { best = p.keys; winnerId = p.id; }
    else if (p.keys === best) winnerId = null;
  }
  world.result = { winnerId, reason: 'timeout' };
  events.push({ type: 'win', winnerId, reason: 'timeout' });
}
