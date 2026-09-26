import { TICK_RATE } from '../constants.ts';
import type { PlayerState, SimEvent, World } from './world.ts';

/** Knockout mode (ARCHITECTURE §15): lives, crumbling floor, last ball rolling wins. */

const alive = (world: World) => world.players.filter((p) => !p.eliminated);

/** Removing `band` keeps at least 2 blocks per alive player. */
const floorAllows = (world: World, band: string[]) =>
  world.level.solid.size - world.removed.size - band.length >= 2 * alive(world).length;

/** Tick the next band is removed at, or -1 when crumbling is over (all bands gone, or stopped by the floor rule). */
export function nextCrumbleTick(world: World): number {
  const k = world.knockout, c = world.level.crumble;
  if (!k || !c || k.stopped || k.next >= k.bands.length || !floorAllows(world, k.bands[k.next])) return -1;
  return (c.startSec + k.next * c.intervalSec) * TICK_RATE;
}

/** A death costs a life. At 0 the player is eliminated: it stays Dead and never respawns. */
export function loseLife(world: World, p: PlayerState, creditId: string | null, events: SimEvent[]): void {
  p.lives = Math.max(0, p.lives - 1);
  events.push({ type: 'lifeLost', playerId: p.id, livesLeft: p.lives });
  if (p.lives > 0) return;
  p.eliminated = true;
  p.eliminatedTick = world.tick;
  p.eliminatedBy = creditId;
  events.push(creditId ? { type: 'eliminated', playerId: p.id, byId: creditId } : { type: 'eliminated', playerId: p.id });
}

/** Crumble warning and removal for one tick (§15), for any level with `crumble` (race: sudden death, phase 12). */
export function stepCrumble(world: World, events: SimEvent[]): void {
  const k = world.knockout, c = world.level.crumble, tick = world.tick;
  if (!k || !c || world.result) return;

  if (!k.stopped && k.next < k.bands.length) {
    const removeAt = (c.startSec + k.next * c.intervalSec) * TICK_RATE;
    if (k.warn !== k.next && tick >= removeAt - c.warnSec * TICK_RATE) {
      if (floorAllows(world, k.bands[k.next])) {
        k.warn = k.next;
        events.push({ type: 'crumbleWarn', band: k.next });
      } else k.stopped = true;
    }
    if (k.warn === k.next && tick >= removeAt) {
      for (const key of k.bands[k.next]) world.removed.add(key);
      events.push({ type: 'crumble', band: k.next });
      k.next++;
      k.warn = -1;
    }
  }
}

/** Knockout mode logic for one tick (§7 step 4): crumble, then win, draw and timeout checks. */
export function stepKnockout(world: World, events: SimEvent[]): void {
  if (world.result) return;
  stepCrumble(world, events);
  const tick = world.tick;
  const left = alive(world);
  if (world.players.length && !left.length) {
    world.result = { winnerId: null, reason: 'allOut' }; // the last ones went out on the same tick
  } else if (world.players.length > 1 && left.length === 1) {
    world.result = { winnerId: left[0].id, reason: 'lastAlive' };
  } else if (tick >= world.timeLimitTick) {
    // Most lives, then most knockouts; still tied is a draw.
    const best = [...left].sort((a, b) => b.lives - a.lives || b.knockouts - a.knockouts);
    const tied = best.length > 1 && best[0].lives === best[1].lives && best[0].knockouts === best[1].knockouts;
    world.result = { winnerId: best.length && !tied ? best[0].id : null, reason: 'timeout' };
  }
  if (world.result) events.push({ type: 'win', winnerId: world.result.winnerId, reason: world.result.reason });
}
