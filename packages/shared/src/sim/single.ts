import { CLOCK_FREEZE_TICKS, SCORE_COIN, SCORE_FRUIT, SCORE_GEM, TICK_RATE } from '../constants.ts';
import type { ItemType } from '../level/types.ts';
import { eq } from '../vec.ts';
import { faceTileAt } from './tiles.ts';
import { tileKey, type PlayerState, type SimEvent, type World } from './world.ts';

/** Single player's level rules (ARCHITECTURE §22, phase 15b): items, the timer, clock and paint tiles. */

export const ITEM_POINTS: Record<ItemType, number> = { coin: SCORE_COIN, gem: SCORE_GEM, fruit: SCORE_FRUIT, hourglass: 0 };

/**
 * A ball's action finished at its pose (single player): it takes the items in the cell (like keys: by cell, so every
 * finish counts), an unused clock tile under it freezes the timer, and a paint tile under it lights. The last paint
 * tile lit finishes a bonus level.
 */
export function landSingle(world: World, p: PlayerState, events: SimEvent[]): void {
  const s = world.single;
  if (!s || world.result) return;
  world.level.items.forEach((it, i) => {
    if (s.taken[i] || !eq(it.cell, p.pose.cell)) return;
    s.taken[i] = true;
    s.gained += ITEM_POINTS[it.type];
    if (it.fruit >= 0) s.fruits |= 1 << it.fruit;
    events.push({ type: 'item', playerId: p.id, itemId: i, item: it.type, fruit: it.fruit, points: ITEM_POINTS[it.type] });
    if (it.type === 'hourglass') {
      s.timer = world.level.timeLimitSec * TICK_RATE - s.timer;
      events.push({ type: 'timer', playerId: p.id, kind: 'flip', ticks: s.timer });
    }
  });
  const t = faceTileAt(world, p.pose), key = tileKey(p.pose.cell, p.pose.up);
  if (t?.type === 'clock' && !s.clocks.has(key)) {
    s.clocks.add(key);
    s.frozenUntil = world.tick + CLOCK_FREEZE_TICKS;
    events.push({ type: 'timer', playerId: p.id, kind: 'freeze', ticks: CLOCK_FREEZE_TICKS });
  }
  if (t?.type === 'paint' && !s.lit.has(key)) {
    s.lit.add(key);
    const total = paintTotal(world);
    events.push({ type: 'paint', playerId: p.id, lit: s.lit.size, total });
    if (s.lit.size === total) {
      world.result = { winnerId: p.id, reason: 'painted' };
      events.push({ type: 'win', winnerId: p.id, reason: 'painted' });
    }
  }
}

export const paintTotal = (world: World): number => world.level.tiles.filter((t) => t.type === 'paint').length;

/**
 * The timer runs down one tick per tick unless a clock froze it. Returns true when it just ran out: a death on a
 * normal level (the caller kills the ball), the end of a bonus level (result 'timeout', no death).
 */
export function stepTimer(world: World, events: SimEvent[]): boolean {
  const s = world.single;
  if (!s || world.result || s.timer <= 0) return false;
  if (world.tick >= s.frozenUntil) s.timer--;
  if (s.timer > 0) return false;
  if (!world.level.bonus) return true;
  world.result = { winnerId: null, reason: 'timeout' };
  events.push({ type: 'win', winnerId: null, reason: 'timeout' });
  return false;
}
