import { schema, t, type SchemaType } from '@colyseus/schema';
import { Action, nextCrumbleTick, type Pose, type World } from '@kula/shared';

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
  /** Knockout: lives left, elimination (tick, and who knocked the player out: '' = nobody), spawn protection. */
  lives: t.uint8().default(0),
  eliminated: t.boolean().default(false),
  eliminatedTick: t.int32().default(-1),
  eliminatedBy: t.string().default(''),
  protectedUntil: t.int32().default(0),
  knockouts: t.uint8().default(0),
  /** Prediction (§17): the last input applied (its seq) and the tick it was applied at. */
  ackSeq: t.int32().default(-1),
  ackTick: t.int32().default(-1),
  /** Fire landings in a row (§18): the client inflates the ball a little per count. */
  fireCount: t.uint8().default(0),
  /** Pills (phase 15a): effect type → the tick it ends. */
  effects: t.map('int32'),
  ready: t.boolean().default(false),
  /** Lobby level vote (phase 14): 0..2 a candidate, 3 Random, -1 none. */
  vote: t.int8().default(-1),
  spectating: t.boolean().default(false),
  /** Matches (phase 18): the match-length vote (0..2 → 3/5/7 rounds, -1 none) and the rematch vote at matchEnd. */
  lengthVote: t.int8().default(-1),
  rematch: t.boolean().default(false),
}, 'PlayerS');

/**
 * A player's line on the match board (phase 18, §23). Stays after they leave (`left`, shown greyed). `roundPoints`
 * and `breakdown` are the last scored round's ("Exit +5 · KO ×1 +1").
 */
export const StandingS = schema({
  id: t.string(),
  name: t.string(),
  color: t.string(),
  points: t.int16().default(0),
  roundPoints: t.int16().default(0),
  breakdown: t.string().default(''),
  /** The round the last scoring was for (the client pops it once per round). */
  scoredRound: t.uint8().default(0),
  left: t.boolean().default(false),
  wins: t.uint8().default(0),
  knockouts: t.uint16().default(0),
  pushes: t.uint16().default(0),
  stomps: t.uint16().default(0),
  deaths: t.uint16().default(0),
  keys: t.uint16().default(0),
}, 'StandingS');
export type StandingS = SchemaType<typeof StandingS>;
export type PlayerS = SchemaType<typeof PlayerS>;

export const ItemS = schema({
  id: t.string(),
  kind: t.string(), // 'key' | 'exit'
  x: t.int16(), y: t.int16(), z: t.int16(),
  up: t.uint8(),
}, 'ItemS');
export type ItemS = SchemaType<typeof ItemS>;

export const GameState = schema({
  phase: t.string(), // 'lobby' | 'countdown' | 'playing' | 'results' | 'matchEnd' (phase 18)
  /** Round clock: -countdown..0 during countdown, the sim tick while playing, keeps counting in results. */
  tick: t.int32(),
  phaseEndTick: t.int32(),
  levelId: t.string(),
  /** Movement timing preset (phase 17): 'classic' | 'snappy'. The predictor and bots build their worlds with it. */
  timing: t.string().default('classic'),
  mode: t.string().default('race'), // 'race' | 'knockout', from the level
  /** Knockout crumble: bands removed so far (the client recomputes bands from the level), the warned band (-1 none),
   * and the tick the next band goes (-1 none). */
  crumbled: t.uint8().default(0),
  warnBand: t.int8().default(-1),
  nextCrumbleTick: t.int32().default(-1),
  winnerId: t.string(), // '' = none / draw
  /** Matches (phase 18, §23): the round being (or last) played (0 before the first), the match length, the crowned
   * leader ('' = nobody), the board, and the length-vote counts (3/5/7) shown before round 1. */
  matchRound: t.uint8().default(0),
  matchRounds: t.uint8().default(5),
  crownId: t.string().default(''),
  standings: t.map(StandingS),
  lengthVotes: t.array('uint8'),
  players: t.map(PlayerS),
  items: t.map(ItemS),
  /** Pickups on the map (phase 15a), by id; `kind` is the pill type. */
  pickups: t.map(ItemS),
  /** Hot tiles (phase 12c): tileKey → heat in ticks, only tiles with heat > 0. The client glows them from warn. */
  hot: t.map('uint16'),
  /** Crumble tiles (§18): block cellKey → the tick it vanishes (or vanished). Gone once it regrows. */
  crumbling: t.map('int32'),
  /** Laser groups (phase 13b): group → 1 on, 0 off. */
  lasers: t.map('uint8'),
  /** Lobby level vote (phase 14): up to 3 candidate level ids, and votes per option (3 candidate slots, then Random). */
  candidates: t.array('string'),
  voteCounts: t.array('uint8'),
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

/** Mirrors a sim map into a schema map, touching only the entries that changed. */
function syncMap(from: ReadonlyMap<string, number>, to: GameState['hot']): void {
  for (const [k, v] of from) if (to.get(k) !== v) to.set(k, v);
  for (const k of [...to.keys()]) if (!from.has(k)) to.delete(k);
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
    set(s, 'lives', p.lives);
    set(s, 'eliminated', p.eliminated);
    set(s, 'eliminatedTick', p.eliminatedTick);
    set(s, 'eliminatedBy', p.eliminatedBy ?? '');
    set(s, 'protectedUntil', p.protectedUntil);
    set(s, 'knockouts', p.knockouts);
    set(s, 'fireCount', p.fireCount);
    syncMap(new Map(p.effects.map((e) => [e.type, e.untilTick])), s.effects);
  }
  const pickups = new Map(world.pickups.map((k) => [String(k.id), k]));
  for (const [id, k] of pickups) if (!state.pickups.has(id)) state.pickups.set(id, new ItemS({ id, kind: k.type, ...k.cell, up: k.up }));
  for (const id of [...state.pickups.keys()]) if (!pickups.has(id)) state.pickups.delete(id);
  for (const k of world.keys) {
    const id = `key-${k.id}`;
    if (k.collected) {
      if (state.items.has(id)) state.items.delete(id);
    } else if (!state.items.has(id)) {
      state.items.set(id, new ItemS({ id, kind: 'key', ...k.cell, up: world.level.keys[k.id].up }));
    }
  }
  const exit = world.level.exit;
  if (exit && !state.items.has('exit')) state.items.set('exit', new ItemS({ id: 'exit', kind: 'exit', ...exit.cell, up: exit.up }));
  syncMap(world.hot, state.hot);
  syncMap(world.crumbling, state.crumbling);
  syncMap(new Map([...world.lasers].map(([g, on]) => [g, on ? 1 : 0])), state.lasers);
  set(state, 'mode', world.mode);
  set(state, 'crumbled', world.knockout?.next ?? 0);
  set(state, 'warnBand', world.knockout?.warn ?? -1);
  set(state, 'nextCrumbleTick', nextCrumbleTick(world));
}
