import { schema, t, type SchemaType } from '@colyseus/schema';
import { Action, type Pose, type World } from '@kula/shared';

export const PlayerS = schema({
  id: t.string(),
  name: t.string(),
  color: t.string(),
  action: t.uint8().default(0),
  fromX: t.int16().default(0), fromY: t.int16().default(0), fromZ: t.int16().default(0), fromUp: t.uint8().default(0), fromFwd: t.uint8().default(0),
  toX: t.int16().default(0), toY: t.int16().default(0), toZ: t.int16().default(0), toUp: t.uint8().default(0), toFwd: t.uint8().default(0),
  startTick: t.int32().default(0),
  endTick: t.int32().default(0),
  /** Mid-air turn (render only): facing before it and its tick; equals toFwd and startTick when there was none. */
  turnFromFwd: t.uint8().default(0),
  turnStartTick: t.int32().default(0),
  /** Stunned by a failed push (render: lunge and recoil). */
  bounce: t.boolean().default(false),
  keys: t.uint8().default(0),
  ready: t.boolean().default(false),
  spectating: t.boolean().default(false),
}, 'PlayerS');
export type PlayerS = SchemaType<typeof PlayerS>;

export const ItemS = schema({
  id: t.string(),
  kind: t.string(), // 'key' | 'exit'
  x: t.int16(), y: t.int16(), z: t.int16(),
  up: t.uint8(),
}, 'ItemS');
export type ItemS = SchemaType<typeof ItemS>;

export const GameState = schema({
  phase: t.string(), // 'lobby' | 'countdown' | 'playing' | 'results'
  /** Round clock: -countdown..0 during countdown, the sim tick while playing, keeps counting in results. */
  tick: t.int32(),
  phaseEndTick: t.int32(),
  levelId: t.string(),
  winnerId: t.string(), // '' = none / draw
  players: t.map(PlayerS),
  items: t.map(ItemS),
}, 'GameState');
export type GameState = SchemaType<typeof GameState>;

/** Assigns only when the value differs, so unchanged fields never enter a patch. */
function set<T extends object, K extends keyof T>(o: T, k: K, v: T[K]): void {
  if (o[k] !== v) o[k] = v;
}

function setPose(s: PlayerS, pre: 'from' | 'to', p: Pose): void {
  set(s, `${pre}X` as const, p.cell.x);
  set(s, `${pre}Y` as const, p.cell.y);
  set(s, `${pre}Z` as const, p.cell.z);
  set(s, `${pre}Up` as const, p.up);
  set(s, `${pre}Fwd` as const, p.fwd);
}

/** Copies sim → schema. from* = pose, to* = to (= pose when Idle). Collected keys are removed from items. */
export function syncSchema(world: World, state: GameState): void {
  for (const p of world.players) {
    const s = state.players.get(p.id);
    if (!s) continue;
    set(s, 'action', p.action);
    setPose(s, 'from', p.pose);
    setPose(s, 'to', p.action === Action.Idle ? p.pose : p.to);
    set(s, 'startTick', p.startTick);
    set(s, 'endTick', p.endTick);
    set(s, 'turnFromFwd', p.turnFromFwd);
    set(s, 'turnStartTick', p.turnStartTick);
    set(s, 'bounce', p.bounce);
    set(s, 'keys', p.keys);
  }
  for (const k of world.keys) {
    const id = `key-${k.id}`;
    if (k.collected) {
      if (state.items.has(id)) state.items.delete(id);
    } else if (!state.items.has(id)) {
      state.items.set(id, new ItemS({ id, kind: 'key', ...k.cell, up: world.level.keys[k.id].up }));
    }
  }
  if (!state.items.has('exit')) {
    const { cell, up } = world.level.exit;
    state.items.set('exit', new ItemS({ id: 'exit', kind: 'exit', ...cell, up }));
  }
}
