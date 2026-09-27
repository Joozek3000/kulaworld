import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Client, type Room } from '@colyseus/sdk';
import {
  Action, add, airHop, ALL_DIRS, beamHit, cellKey, createWorld, dirVec, findPath, findPathLasers, isPushable, isSolid, lintCorridors, loadLevel, opposite, pathCells, perpendicular,
  blockTileAt, lethalForPlanning, RANDOM_VOTE, previewAction, reservations, resultPose, stompPreview, sub, tileKey, turnFwd,
  type Dir, type Effect, type Input, type PathStep, type PickupType, type PlayerState, type Pose, type Reservations, type SimEvent, type Vec3, type World,
} from '@kula/shared';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1' },
    behaviour: { type: 'string', default: 'wander' }, // comma list, assigned round-robin: seek,wander,bully,blocker
    duration: { type: 'string' }, // seconds; default: run until Ctrl+C
    server: { type: 'string', default: 'ws://localhost:2567' },
    skill: { type: 'string', default: '0.5' }, // 0..1: reaction speed and reliability; 1 = instant, never misses
  },
});
const BEHAVIOURS = ['wander', 'seek', 'bully', 'blocker'] as const;
type Behaviour = (typeof BEHAVIOURS)[number];
const count = Number(values.count);
const duration = values.duration === undefined ? Infinity : Number(values.duration);
const behaviours = values.behaviour.split(',').map((b) => b.trim());
if (!Number.isInteger(count) || count < 1) throw new Error(`--count must be a positive integer, got ${values.count}`);
if (!(duration > 0)) throw new Error(`--duration must be a positive number of seconds, got ${values.duration}`);
for (const b of behaviours) if (!BEHAVIOURS.includes(b as Behaviour)) throw new Error(`unknown --behaviour ${b} (available: ${BEHAVIOURS.join(', ')})`);
const skill = Number(values.skill);
if (!(skill >= 0 && skill <= 1)) throw new Error(`--skill must be 0..1, got ${values.skill}`);
/**
 * Human-like reactions (phase 10b) for *reactive* inputs (the defensive hop, jumping over a blocker). At the default
 * skill 0.5: 150-300 ms before reacting and a 25 % chance of missing a hop. Skill 1 is instant and never misses (the
 * phase 10 bots); skill 0 doubles both.
 */
const slowness = (1 - skill) / 0.5;
const reactionMs = () => slowness * (150 + Math.random() * 150);
const HOP_MISS = Math.min(1, 0.25 * slowness);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (a: number, b: number) => a + Math.random() * (b - a);

interface Stats {
  rounds: number; wins: number; keys: number; deaths: number; hops: number; replans: number; stuck: number;
  pushes: number; bounces: number; knockouts: number; keyDrops: number; livesLost: number; eliminated: number;
  stomps: number; stomped: number; clashes: number; dodges: number; missedDodges: number; detours: number; heatEscapes: number; burns: number;
  cradles: number; edgePushes: number; headOns: number; sideHits: number; sideTries: number; teleports: number; zapped: number; toggles: number;
  pillDetours: number;
  /** Pills taken (phase 15a), by type. */
  pills: Record<string, number>;
}

/** Retries joinOrCreate for up to 30 s, so bots can start before the server is up. */
async function connect(client: Client, name: string): Promise<Room> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await client.joinOrCreate('race', { name });
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await sleep(1000);
    }
  }
}

/**
 * Planning worlds per level id: geometry only (the BFS ignores other players). In knockout, crumbled and warned
 * bands count as gone, so plans never stand on a tile that's about to drop. Vanishing blocks (13b) are never solid
 * for planning, and the laser groups are the synced ones (active beams are walls, off ones open).
 */
const planWorlds = new Map<string, World>();
type MapOf<T> = { forEach(cb: (v: T, k: string) => void): void };
function planWorld(state: { levelId: string; crumbled: number; warnBand: number; crumbling?: MapOf<number>; lasers?: MapOf<number> }): World {
  let w = planWorlds.get(state.levelId);
  if (!w) {
    const json = JSON.parse(readFileSync(new URL(`../../../levels/${state.levelId}.json`, import.meta.url), 'utf8'));
    planWorlds.set(state.levelId, (w = createWorld(loadLevel(json), 0)));
  }
  w.removed = new Set(w.knockout ? w.knockout.bands.slice(0, Math.max(state.crumbled, state.warnBand + 1)).flat() : []);
  state.crumbling?.forEach((_, k) => w.removed.add(k)); // crumble tiles (§18): counting down or gone, don't plan on them
  for (const k of w.level.vanish.keys()) w.removed.add(k);
  state.lasers?.forEach((on, g) => w.lasers.set(g, on === 1));
  return w;
}

/** A forward roll (or jump) from `pose` right now would pass through an active laser beam (13b). */
function beamAhead(world: World, pose: Pose, cmd: 'fwd' | 'jump' = 'fwd'): boolean {
  const plan = previewAction(world, { id: '', pose }, cmd, new Map());
  return !!plan && !!beamHit(world, pathCells(pose, plan.to.cell));
}

/**
 * bully (13b): the cells of switches that would turn a laser on with an opponent in, or right next to, its beam.
 */
function switchTraps(state: Players, selfId: string, world: World, skip: (id: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const t of world.level.tiles) {
    if (t.type !== 'switch' || world.lasers.get(t.group)) continue;
    const beams = world.level.lasers.filter((l) => l.group === t.group).flatMap((l) => l.cells);
    let hit = false;
    state.players.forEach((o, id) => {
      if (id === selfId || o.action === Action.Dead || skip(id)) return;
      const c = { x: o.toX, y: o.toY, z: o.toZ };
      if (beams.some((b) => Math.max(Math.abs(b.x - c.x), Math.abs(b.y - c.y), Math.abs(b.z - c.z)) <= 1)) hit = true;
    });
    if (hit) out.add(cellKey(add(t.block, dirVec(t.face!))));
  }
  return out;
}
/** bully: extra moves it will take to reach a switch that zaps someone (15a: was 4; it never triggered in the 13b soak). */
const SWITCH_DETOUR = 8;
/** Pills (15a): seek takes a good one this close (moves) if it costs at most PILL_EXTRA moves on its way to the goal; */
const SEEK_PILL_MOVES = 4, PILL_EXTRA = 2;
/** the bully (and any hunter) this close, whatever it costs. */
const HUNT_PILL_MOVES = 6;
const GOOD_PILLS: readonly PickupType[] = ['bouncy', 'heavy'];

type PickupLike = { kind: string; x: number; y: number; z: number };
type WithPickups = { pickups?: MapOf<PickupLike> };
/** Cells of the pickups of these types on the map. */
function pillCells(state: WithPickups, types: readonly string[]): Set<string> {
  const out = new Set<string>();
  state.pickups?.forEach((k) => { if (types.includes(k.kind)) out.add(`${k.x},${k.y},${k.z}`); });
  return out;
}
/** Every bot (15a): lethargy pills as obstacles for planning. A plan never stops on one; jumping over is fine. */
const lethargyRes = (state: WithPickups): Reservations => new Map([...pillCells(state, ['lethargy'])].map((k) => [k, 'pill']));
/** This bot's pills, for planning with them (bouncy changes its moves). */
function effectsOf(p: { effects?: MapOf<number> }): Effect[] {
  const out: Effect[] = [];
  p.effects?.forEach((untilTick, type) => out.push({ type: type as PickupType, untilTick }));
  return out;
}
/** A forward roll from `pose` right now would end on a lethargy pill (wander steers away, 15a). */
function lethargyAhead(state: WithPickups, world: World, pose: Pose): boolean {
  const plan = previewAction(world, { id: '', pose }, 'fwd', new Map());
  return !!plan && pillCells(state, ['lethargy']).has(cellKey(plan.to.cell));
}
/** After a head-on bounce with a ball, leave it alone this long (14d soak: two bots re-charging each other). */
const HEAD_ON_COOLDOWN_MS = 2_000;

type SchemaPlayer = PlayerLike & { fromUp: number; fromFwd: number; toUp: number; toFwd: number; protectedUntil: number; spectating: boolean; fireCount: number };
const poseOf2 = (x: number, y: number, z: number, up: number, fwd: number): Pose => ({ cell: { x, y, z }, up: up as Dir, fwd: fwd as Dir });

/**
 * The plan world plus the other players at their current server state (for stompPreview / jump previews). A shallow
 * copy: the shared plan world keeps no players.
 */
function withPlayers(world: World, state: { players: { forEach(cb: (p: SchemaPlayer, id: string) => void): void } }, selfId: string): World {
  const players: PlayerState[] = [];
  state.players.forEach((o, id) => {
    if (id === selfId || o.spectating || o.action === Action.Dead) return;
    const from = poseOf2(o.fromX, o.fromY, o.fromZ, o.fromUp, o.fromFwd);
    players.push({
      id, action: o.action, pose: from, to: poseOf2(o.toX, o.toY, o.toZ, o.toUp, o.toFwd),
      startTick: o.startTick, endTick: o.endTick, protectedUntil: o.protectedUntil, jumpOver: false, stompBump: null,
    } as PlayerState);
  });
  return { ...world, players };
}

/** Someone's forward jump is coming down on my cell (the landing marker is on my tile): that jump's key, or ''. */
function jumpingOnto(state: { players: { forEach(cb: (p: SchemaPlayer, id: string) => void): void } }, me: SchemaPlayer, selfId: string): string {
  let hit = '';
  state.players.forEach((o, id) => {
    if (id !== selfId && o.action === Action.Jump && o.toUp === me.fromUp && o.toX === me.fromX && o.toY === me.fromY && o.toZ === me.fromZ) hit = `${id}:${o.startTick}`;
  });
  return hit;
}

/** Empty cells next to a remaining block (any face): where a ball can stand. */
function standable(world: World): Set<string> {
  const cells = new Set<string>();
  for (const k of world.level.solid) {
    if (world.removed.has(k)) continue;
    const [x, y, z] = k.split(',').map(Number);
    for (const d of ALL_DIRS) {
      const c = add({ x, y, z }, dirVec(d));
      if (!isSolid(world, c)) cells.add(cellKey(c));
    }
  }
  return cells;
}

interface Ctx { name: string; room: Room; stats: Stats; send(i: Partial<Input>): void; headOnUntil: Map<string, number> }

/** wander: hold forward and send a random turn/jump/hop pulse every 300-1200 ms. */
function wanderBrain(ctx: Ctx) {
  let nextPulseAt = 0;
  let wasPlaying = false;
  let braking = false; // W released: a head-on would knock it off an edge (phase 14d)
  return (playing: boolean) => {
    const s = ctx.room.state, p: SchemaPlayer | undefined = s.players?.get(ctx.room.sessionId);
    const moving = p && (p.action === Action.Roll || p.action === Action.Flip);
    const pose = p && (p.action === Action.Idle || moving) ? (moving ? poseOf(p.toX, p.toY, p.toZ, p.toUp, p.toFwd) : poseOf(p.fromX, p.fromY, p.fromZ, p.fromUp, p.fromFwd)) : null;
    const risk = playing && !!pose && (headOnRisk(s, ctx.room.sessionId, pose, planWorld(s)) || beamAhead(planWorld(s), pose) || lethargyAhead(s, planWorld(s), pose));
    if (risk !== braking) { braking = risk; ctx.send(risk ? { turn: Math.random() < 0.5 ? -1 : 1 } : { fwdHeld: true }); }
    if (braking) { wasPlaying = playing; return; }
    if (playing && (!wasPlaying || Date.now() >= nextPulseAt)) {
      // 10% hop (jump with fwd released for this message), 30% left, 30% right, 20% forward jump, 10% just roll.
      const r = wasPlaying ? Math.random() : 1;
      const hop = r < 0.1;
      ctx.send({ fwdHeld: !hop, turn: r < 0.1 ? 0 : r < 0.4 ? -1 : r < 0.7 ? 1 : 0, jump: hop || (r >= 0.7 && r < 0.9) });
      if (hop) ctx.stats.hops++;
      nextPulseAt = Date.now() + (hop ? 600 : between(300, 1200));
    }
    wasPlaying = playing;
  };
}

/** Actions a path step may start as. */
const EXPECTED: Record<string, readonly number[]> = {
  fwd: [Action.Roll, Action.Flip, Action.Climb, Action.Jump], // a bouncy ball's roll is a jump (15a)
  jump: [Action.Jump],
  left: [Action.Turn],
  right: [Action.Turn],
};
/** Actions whose `to` is where the player ends up, so the next step may be pressed in their last tick. */
const EARLY_OK = new Set<number>([Action.Roll, Action.Turn, Action.Flip, Action.Climb]);
const STUCK_MS = 10_000;
const BULLY_PATIENCE_MS = 1_000;
const BULLY_IGNORE_MS = 3_000;
const BOUNCE_JITTER_MS = 500;
const AVOID_AFTER_MS = 500;
const AVOID_MS = 3_000;
/** A bully whose target is this close (cells) detours for AVOID_NEAR_MS instead (phase 12b): back to the shove sooner. */
const AVOID_NEAR_CELLS = 2;
const AVOID_NEAR_MS = 1_500;
/** bully (phase 13a): extra moves it will take to reach a spot that pushes its victim onto spikes or fire. */
const TRAP_DETOUR = 3;

type PlayerLike = {
  fromX: number; fromY: number; fromZ: number; fromUp: number; toX: number; toY: number; toZ: number;
  action: number; startTick: number; endTick: number;
};
function occupiedByOther(state: { players: { forEach(cb: (p: PlayerLike, id: string) => void): void } }, selfId: string, cell: string): boolean {
  let hit = false;
  state.players.forEach((o, id) => {
    if (id !== selfId && o.action !== Action.Dead && (`${o.fromX},${o.fromY},${o.fromZ}` === cell || `${o.toX},${o.toY},${o.toZ}` === cell)) hit = true;
  });
  return hit;
}

/** Someone high in a hop in `cell` over the next ticks (§14): a roll goes under it rather than being blocked. */
function highHopperAt(state: { tick: number; players: { forEach(cb: (p: PlayerLike, id: string) => void): void } }, selfId: string, cell: string): boolean {
  let hit = false;
  state.players.forEach((o, id) => {
    if (id !== selfId && `${o.fromX},${o.fromY},${o.fromZ}` === cell && airHop(o, state.tick + 1) && airHop(o, state.tick + 2)) hit = true;
  });
  return hit;
}

/**
 * Where a roll forward from `pose` would push an opponent: V standing in A = C + F on the same face (knocked along F),
 * or, over an open edge, V standing in T = A − U on face F (an edge push, §14: knocked along −U).
 */
function pushSpot(world: World, pose: Pose): { cell: Vec3; up: Dir; dest: Vec3 } {
  const F = dirVec(pose.fwd), U = dirVec(pose.up), A = add(pose.cell, F);
  if (isSolid(world, A) || isSolid(world, sub(A, U))) return { cell: A, up: pose.up, dest: add(A, F) };
  const T = sub(A, U);
  return { cell: T, up: pose.fwd, dest: sub(T, U) };
}

/**
 * An opponent a roll forward would push right now (pushSpot), pushable next tick. With `voidOnly`, only if the knock
 * is lethal: into air (nothing under the destination along the victim's gravity) or onto spikes/fire (§18).
 */
function pushable(state: { tick: number; players: { forEach(cb: (p: PlayerLike, id: string) => void): void } }, selfId: string, pose: Pose, world: World, voidOnly: boolean): boolean {
  const { cell, up, dest } = pushSpot(world, pose);
  if (isSolid(world, dest)) return false; // would bounce
  if (voidOnly && isSolid(world, sub(dest, dirVec(up))) && !lethalForPlanning(world, { cell: dest, up, fwd: pose.fwd })) return false;
  let hit = false;
  state.players.forEach((o, id) => {
    if (id === selfId || o.fromUp !== up || `${o.fromX},${o.fromY},${o.fromZ}` !== cellKey(cell)) return;
    if (isPushable({ action: o.action, startTick: o.startTick, endTick: o.endTick } as PlayerState, state.tick + 1)) hit = true;
  });
  return hit;
}

/**
 * Cells a bully can push each opponent from, cellKey → opponent id: next to it on its own face, or around an edge
 * (phase 12c): on the adjacent face of its block, one cell over the shared edge (C = O − Uo + U, with C + Uo open).
 */
function besideOpponents(state: { players: { forEach(cb: (p: PlayerLike & { toUp: number }, id: string) => void): void } }, selfId: string, world: World, skip: (id: string) => boolean): Map<string, string> {
  const cells = new Map<string, string>();
  state.players.forEach((o, id) => {
    if (id === selfId || o.action === Action.Dead || skip(id)) return;
    const U = dirVec(o.toUp as Dir);
    for (const d of ALL_DIRS) {
      if (!perpendicular(d, o.toUp as Dir)) continue;
      const O = { x: o.toX, y: o.toY, z: o.toZ }, c = add(O, dirVec(d));
      if (!isSolid(world, c) && isSolid(world, sub(c, U))) cells.set(cellKey(c), id);
      const e = sub(c, U); // around the edge: the flip from e along +Uo lands on O
      if (!isSolid(world, e) && !isSolid(world, c) && isSolid(world, sub(e, dirVec(d)))) cells.set(cellKey(e), id);
    }
  });
  return cells;
}

/**
 * bully (phase 13a): cells beside an opponent from which a push knocks it onto spikes or fire, cellKey → opponent id.
 * The push goes from c through the opponent O to O + d, on the opponent's face.
 */
function trapPushCells(state: { players: { forEach(cb: (p: PlayerLike & { toUp: number }, id: string) => void): void } } & WithPickups, selfId: string, world: World, skip: (id: string) => boolean): Map<string, string> {
  const cells = new Map<string, string>();
  const lethargy = pillCells(state, ['lethargy']); // 15a: a push onto a lethargy pill slows the victim down
  state.players.forEach((o, id) => {
    if (id === selfId || o.action === Action.Dead || skip(id)) return;
    const up = o.toUp as Dir, O = { x: o.toX, y: o.toY, z: o.toZ }, U = dirVec(up);
    for (const d of ALL_DIRS) {
      if (!perpendicular(d, up)) continue;
      const c = sub(O, dirVec(d)), dest = add(O, dirVec(d));
      if (isSolid(world, c) || !isSolid(world, sub(c, U)) || isSolid(world, dest)) continue;
      if (lethalForPlanning(world, { cell: dest, up, fwd: d }) || lethargy.has(cellKey(dest))) cells.set(cellKey(c), id);
    }
  });
  return cells;
}

/**
 * An opponent `pose` could push by rolling in some direction d (pushSpot with fwd d): right next to it on the same
 * face, or just around the edge on the adjacent face (phase 12c). Its id and d.
 */
function adjacentOpponent(state: { players: { forEach(cb: (p: PlayerLike, id: string) => void): void } }, selfId: string, pose: Pose, skip: (id: string) => boolean, world: World): { id: string; dir: Dir } | null {
  let hit: { id: string; dir: Dir } | null = null;
  const spots = ALL_DIRS.filter((d) => perpendicular(d, pose.up)).map((d) => ({ d, ...pushSpot(world, { ...pose, fwd: d }) }));
  state.players.forEach((o, id) => {
    if (id === selfId || o.action === Action.Dead || skip(id)) return;
    for (const s of spots) if (o.fromUp === s.up && cellKey(s.cell) === `${o.fromX},${o.fromY},${o.fromZ}`) hit = { id, dir: s.d };
  });
  return hit;
}

/** A ball moving along the ground (§20 mover) and its motion vector on its arrival face, or null. */
function motionOf(o: SchemaPlayer): Vec3 | null {
  if (o.action === Action.Flip) return dirVec(o.toFwd as Dir);
  if (o.action !== Action.Roll && o.action !== Action.Knocked) return null;
  return { x: o.toX - o.fromX, y: o.toY - o.fromY, z: o.toZ - o.fromZ };
}
const sameVec = (a: Vec3, b: Vec3) => a.x === b.x && a.y === b.y && a.z === b.z;

/** A head-on's knock-back from `pose` (one cell against fwd, then on across any ice) ends off an edge or on a trap. */
function bounceLethal(world: World, pose: Pose): boolean {
  const F = dirVec(pose.fwd), U = dirVec(pose.up);
  for (let c = sub(pose.cell, F), i = 0; i < 32; c = sub(c, F), i++) {
    if (isSolid(world, c)) return false; // a wall behind: it bounces in place
    const here = { cell: c, up: pose.up, fwd: opposite(pose.fwd) };
    if (!isSolid(world, sub(c, U)) || lethalForPlanning(world, here)) return true;
    if (blockTileAt(world, here)?.type !== 'ice') return false;
  }
  return false;
}

/**
 * All bots (phase 14d): rolling forward from `pose` now would meet an opponent head-on (§20) that gets there at least as
 * soon (already entering A, or arriving next to A this tick), and the knock-back would drop this bot off an edge.
 */
function headOnRisk(state: Players & { tick: number }, selfId: string, pose: Pose, world: World): boolean {
  const F = dirVec(pose.fwd), A = add(pose.cell, F), AF = add(A, F), back = sub({ x: 0, y: 0, z: 0 }, F);
  let risk = false;
  state.players.forEach((o, id) => {
    const m = id === selfId || o.toUp !== pose.up ? null : motionOf(o);
    if (!m || !sameVec(m, back)) return;
    const to = { x: o.toX, y: o.toY, z: o.toZ };
    if (sameVec(to, A) || (sameVec(to, AF) && o.endTick - state.tick <= 1)) risk = true;
  });
  return risk && bounceLethal(world, pose);
}

/**
 * bully (phase 14d): a side hit (§20) on an opponent rolling into a cell beside this bot, across its path: 'fwd' when
 * it's entering the cell ahead, or the turn toward one that has only just started (a turn takes 3 of its 5 ticks).
 */
function sideHit(state: Players & { tick: number }, selfId: string, pose: Pose, world: World): 'fwd' | 'left' | 'right' | null {
  let hit: 'fwd' | 'left' | 'right' | null = null;
  state.players.forEach((o, id) => {
    if (hit === 'fwd' || id === selfId || o.toUp !== pose.up || o.action === Action.Knocked || o.protectedUntil > state.tick) return;
    const m = motionOf(o);
    if (!m) return;
    const to = { x: o.toX, y: o.toY, z: o.toZ };
    for (const cmd of ['fwd', 'left', 'right'] as const) {
      const d = cmd === 'fwd' ? pose.fwd : turnFwd(pose.up, pose.fwd, cmd === 'left' ? -1 : 1), D = dirVec(d);
      if (!sameVec(add(pose.cell, D), to) || m.x * D.x + m.y * D.y + m.z * D.z !== 0 || isSolid(world, add(to, D))) continue;
      if (cmd === 'fwd' || state.tick - o.startTick <= 1) hit = cmd;
    }
  });
  return hit;
}

/** bully (phase 14d): where to be for a side hit: beside the cell each rolling opponent enters next (its target + its motion), across its path. */
function sideSpots(state: Players, selfId: string, world: World, skip: (id: string) => boolean): Set<string> {
  const cells = new Set<string>();
  state.players.forEach((o, id) => {
    const m = id === selfId || skip(id) || o.action === Action.Knocked ? null : motionOf(o);
    if (!m) return;
    const U = dirVec(o.toUp as Dir), N = add({ x: o.toX, y: o.toY, z: o.toZ }, m);
    if (isSolid(world, N) || !isSolid(world, sub(N, U))) return;
    for (const d of ALL_DIRS) {
      const D = dirVec(d);
      if (!perpendicular(d, o.toUp as Dir) || m.x * D.x + m.y * D.y + m.z * D.z !== 0) continue;
      const c = add(N, D);
      if (!isSolid(world, c) && isSolid(world, sub(c, U))) cells.add(cellKey(c));
    }
  });
  return cells;
}

const poseOf = (x: number, y: number, z: number, up: number, fwd: number): Pose => ({ cell: { x, y, z }, up: up as Dir, fwd: fwd as Dir });
const samePose = (a: Pose, b: Pose) => cellKey(a.cell) === cellKey(b.cell) && a.up === b.up && a.fwd === b.fwd;

/**
 * seek: BFS (shared findPath) to the nearest remaining key, or the exit once unlocked. Takes an off-path push
 * whenever an opponent ahead would be knocked into the void.
 * In knockout, seek hunts like bully but only pushes into the void, and every BFS bot first steps off a warned tile.
 * bully: BFS to a cell beside the nearest opponent, turns to face it and pushes whenever it's pushable. An opponent
 * it can't push for BULLY_PATIENCE_MS (e.g. a wall behind it) is ignored for BULLY_IGNORE_MS. A hunter with no
 * opponent left to reach makes a random move instead of idling.
 * Executes one step at a time: press, then release once the action has started (holding fwd would chain rolls).
 * Replans when the target disappears, the pose drifts from the plan, or a move is blocked twice.
 */
function seekBrain(ctx: Ctx, bully: boolean) {
  let path: PathStep[] = [];
  let target = '';
  let expected: Pose | null = null; // where the next step of `path` starts
  let pending: { cmd: string; prevStart: number; prevAction: number; sentTick: number; offPath?: boolean } | null = null;
  let blocked = 0;
  let failedPlans = 0;
  let lastSig = '';
  let lastChange = Date.now();
  let facing: { id: string; since: number } | null = null; // bully: opponent it's waiting to push
  const ignored = new Map<string, number>(); // bully: opponent id → ignored until (ms)
  const skip = (id: string) => (ignored.get(id) ?? 0) > Date.now() || (ctx.headOnUntil.get(id) ?? 0) > Date.now();
  // After a bounce, wait a random moment: two bots that bounced off each other recover on the same tick and would
  // otherwise push each other again in lockstep forever.
  let holdUntil = 0;
  /** seek: the blocker currently in the way and when this bot reacts to it (ms). */
  let blocker: { key: string; at: number } | null = null;

  const replan = () => { path = []; target = ''; expected = null; };
  const randomTurn = () => ctx.send({ turn: Math.random() < 0.5 ? -1 : 1 });
  /** The move didn't happen (blocked, or bounced off a push): retry, replan after two, turn randomly after 3 replans. */
  // Phase 12: blocked by a player for AVOID_AFTER_MS (or one bounce) → replan with other players as obstacles for a
  // while, to find a way round (underside, side faces, climbs, jump-overs); no such route → the old path (wait/push).
  let firstBlockAt = 0;
  let avoidUntil = 0;
  const avoidPlayers = () => {
    const near = bully && nearestOpponent(ctx.room.state, ctx.room.sessionId).dist <= AVOID_NEAR_CELLS;
    avoidUntil = Date.now() + (near ? AVOID_NEAR_MS : AVOID_MS);
    firstBlockAt = 0;
    replan();
  };
  const onBlocked = () => {
    if (!firstBlockAt) firstBlockAt = Date.now();
    else if (Date.now() - firstBlockAt >= AVOID_AFTER_MS && Date.now() >= avoidUntil) avoidPlayers();
    if (++blocked >= 2) {
      blocked = 0;
      replan();
      if (++failedPlans >= 3) { failedPlans = 0; randomTurn(); }
    }
  };
  const press = (cmd: string, prevStart: number, prevAction: number, tick: number, offPath = false) => {
    const s = ctx.room.state, p = s.players.get(ctx.room.sessionId);
    const pose = p && (p.action === Action.Idle ? poseOf(p.fromX, p.fromY, p.fromZ, p.fromUp, p.fromFwd) : poseOf(p.toX, p.toY, p.toZ, p.toUp, p.toFwd));
    if (cmd === 'fwd' && pose && headOnRisk(s, ctx.room.sessionId, pose, planWorld(s))) return; // wait it out (phase 14d)
    if ((cmd === 'fwd' || cmd === 'jump') && pose && beamAhead(planWorld(s), pose, cmd)) { replan(); return; } // a laser came on (13b)
    pending = { cmd, prevStart, prevAction, sentTick: tick, offPath };
    if (cmd === 'fwd') ctx.send({ fwdHeld: true });
    else if (cmd === 'jump') ctx.send({ fwdHeld: true, jump: true });
    else ctx.send({ turn: cmd === 'left' ? -1 : 1 });
  };

  return (playing: boolean) => {
    const s = ctx.room.state;
    const p = s.players?.get(ctx.room.sessionId);
    if (!playing || !p) { replan(); pending = null; lastChange = Date.now(); return; }

    // Watchdog: pose and action unchanged for 10 s while alive = stuck. Log the state, then shake loose.
    const sig = `${p.action}|${p.fromX},${p.fromY},${p.fromZ}|${p.fromUp}|${p.fromFwd}|${p.startTick}`;
    if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
    else if (p.action !== Action.Dead && Date.now() - lastChange > STUCK_MS) {
      ctx.stats.stuck++;
      console.log(`${ctx.name}: STUCK ${STUCK_MS / 1000}s action|cell|up|fwd|start=${sig} path=${path.map((x) => x.cmd).join(',')} target=${target} pending=${JSON.stringify(pending)}`);
      lastChange = Date.now();
      replan();
      pending = null;
      randomTurn();
      return;
    }
    if (p.action === Action.Dead) { replan(); pending = null; return; }

    // A step was pressed: wait for its action to start, then release.
    if (pending) {
      if (p.startTick !== pending.prevStart || p.action !== pending.prevAction) {
        if (pending.cmd === 'fwd' || pending.cmd === 'jump') ctx.send({});
        if (p.action === Action.Stunned) { onBlocked(); avoidPlayers(); holdUntil = Date.now() + Math.random() * BOUNCE_JITTER_MS; } // bounced
        else if (pending.offPath) replan();
        else if (EXPECTED[pending.cmd].includes(p.action)) {
          expected = path.shift()!.to;
          blocked = 0;
          failedPlans = 0;
          firstBlockAt = 0;
        } else replan();
        pending = null;
      } else if (s.tick - pending.sentTick > 4) {
        // Nothing started: a player is in the way. Release and retry; replan after two blocks.
        ctx.send({});
        pending = null;
        onBlocked();
      }
      return;
    }

    // Decide when Idle, or in the last tick of a roll/turn/flip (a pulse or held fwd then applies at its end).
    if (Date.now() < holdUntil) return;
    const idle = p.action === Action.Idle;
    if (!idle && !(EARLY_OK.has(p.action) && p.endTick - s.tick <= 1)) return;
    const pose = idle ? poseOf(p.fromX, p.fromY, p.fromZ, p.fromUp, p.fromFwd) : poseOf(p.toX, p.toY, p.toZ, p.toUp, p.toFwd);

    const world = planWorld(s);
    const me = ctx.room.sessionId;
    const hunter = bully || s.mode === 'knockout';
    // Standing on a warned (or already crumbled) tile: get off it before anything else.
    const unsafe = !isSolid(world, sub(pose.cell, dirVec(pose.up))); // also a crumble tile counting down (§18)
    // bully: a stomp that kills, or leaves the victim one push from a ledge, beats walking over to push (§16).
    if (bully && !unsafe) {
      const pw = withPlayers(world, s, me);
      for (const turn of ['jump', 'left', 'right'] as const) {
        const fwd = turn === 'jump' ? pose.fwd : turnFwd(pose.up, pose.fwd, turn === 'left' ? -1 : 1);
        const sp = stompPreview(pw, { ...pose, fwd }, me);
        if (!sp) continue;
        const beyond = add(sp.bumpCell, dirVec(fwd));
        if (sp.lethal || !isSolid(world, sub(beyond, dirVec(pose.up)))) {
          replan();
          facing = null;
          return press(turn, p.startTick, p.action, s.tick, true);
        }
      }
    }
    const side = bully && !unsafe ? sideHit(s, me, pose, world) : null;
    if (side) {
      replan();
      facing = null;
      ctx.stats.sideTries++;
      return press(side, p.startTick, p.action, s.tick, true);
    }
    if (!unsafe && pushable(s, me, pose, world, !bully)) {
      replan();
      facing = null;
      return press('fwd', p.startTick, p.action, s.tick, true);
    }
    if (hunter && !unsafe) {
      const adj = adjacentOpponent(s, me, pose, skip, world);
      if (adj && adj.dir !== pose.fwd) {
        replan();
        return press(adj.dir === turnFwd(pose.up, pose.fwd, -1) ? 'left' : 'right', p.startTick, p.action, s.tick, true);
      }
      if (adj) { // facing it, but it isn't pushable (high hop, or something behind it): wait, then give up on it
        if (facing?.id !== adj.id) facing = { id: adj.id, since: Date.now() };
        else if (Date.now() - facing.since > BULLY_PATIENCE_MS) { ignored.set(adj.id, Date.now() + BULLY_IGNORE_MS); facing = null; }
        return;
      }
      facing = null;
    }
    let goals = new Set<string>();
    let trapGoals: Set<string> | null = null; // bully: push spots that knock the victim onto spikes or fire
    let switchGoals: Set<string> | null = null; // bully (13b): switches that turn a laser on at someone
    if (unsafe) goals = standable(world);
    else if (hunter) {
      goals = new Set(besideOpponents(s, me, world, skip).keys());
      if (bully) {
        trapGoals = new Set(trapPushCells(s, me, world, skip).keys());
        switchGoals = switchTraps(s, me, world, skip);
        for (const k of sideSpots(s, me, world, skip)) goals.add(k); // head across a roller's path (phase 14d)
      }
      // Never stop under someone's hop (§14): it comes down on you. Roll through, stop elsewhere.
      for (const g of [goals, trapGoals]) for (const k of g ?? []) if (occupiedByOther(s, me, k)) g!.delete(k);
    }
    else if (world.level.exit && p.keys >= world.level.keysRequired) goals.add(cellKey(world.level.exit.cell));
    else s.items.forEach((it: { kind: string; x: number; y: number; z: number }) => { if (it.kind === 'key') goals.add(`${it.x},${it.y},${it.z}`); });

    const onPlan = path.length > 0 && goals.has(target) && expected !== null && samePose(pose, expected);
    // Pills (15a): plan with this bot's own (bouncy changes its moves), around lethargy, and through switches (13b
    // follow-up: seek opens a cage for itself).
    const fx = effectsOf(p), avoid = lethargyRes(s);
    const plan = (to: ReadonlySet<string>, from = pose, f = fire): PathStep[] | null => {
      const go = (res: Reservations) => (world.level.lasers.length ? findPathLasers(world, from, to, res, f, fx) : findPath(world, from, to, res, f, undefined, fx));
      return go(avoid) ?? (avoid.size ? go(new Map()) : null); // no way round a lethargy pill: through it
    };
    // Fire landings in a row (§18, phase 14b): plans may take 2, never a 3rd. Deciding early, count the landing ahead.
    const landing = !idle && p.action !== Action.Turn;
    const fire = !landing ? p.fireCount : blockTileAt(world, pose)?.type === 'fire' ? p.fireCount + 1 : 0;
    if (!onPlan) {
      let found: PathStep[] | null = null;
      if (goals.size && Date.now() < avoidUntil) {
        const res = reservations(withPlayers(world, s, me)); // others only: withPlayers leaves this bot out
        for (const [k, v] of avoid) res.set(k, v);
        found = findPath(world, pose, goals, res, fire, undefined, fx);
        if (found?.length) ctx.stats.detours++;
      }
      if (!found?.length) found = goals.size ? plan(goals) : null;
      // A good pill nearby (15a): seek takes it if it barely slows the race; hunters take it anyway.
      const pills = unsafe ? new Set<string>() : pillCells(s, GOOD_PILLS);
      if (found && pills.size) {
        const pill = plan(pills);
        if (pill?.length && pill.length <= (bully ? HUNT_PILL_MOVES : SEEK_PILL_MOVES)) {
          const end = pill[pill.length - 1].to, rest = hunter ? 0 : plan(goals, end, end.fire)?.length ?? Infinity;
          if (hunter || pill.length + rest <= found.length + PILL_EXTRA) { found = pill; ctx.stats.pillDetours++; }
        }
      }
      if (found && trapGoals?.size) { // worth a short detour: a push onto a trap is a knockout
        const trap = findPath(world, pose, trapGoals, avoid, fire, undefined, fx);
        if (trap?.length && trap.length <= found.length + TRAP_DETOUR) found = trap;
      }
      if (found && switchGoals?.size) {
        const zap = findPath(world, pose, switchGoals, avoid, fire, undefined, fx);
        if (zap?.length && zap.length <= found.length + SWITCH_DETOUR) found = zap;
      }
      if (!found?.length) {
        replan();
        // A hunter with nobody to reach (all ignored, e.g. an opponent tucked where every push bounces) roams instead
        // of idling: two bots otherwise wait beside each other in such a pocket until the crumble breaks it up.
        if (hunter && !unsafe) press(Math.random() < 0.5 ? 'fwd' : Math.random() < 0.5 ? 'left' : 'right', p.startTick, p.action, s.tick, true);
        return;
      }
      path = found;
      target = cellKey(found[found.length - 1].to.cell);
      expected = pose;
      ctx.stats.replans++;
    }
    const cmd = path[0].cmd;
    const F = dirVec(pose.fwd), a1 = add(pose.cell, F), a2 = add(a1, F);
    // seek: a player blocking the way (say on a 1-wide beam) is jumped over, if the landing is safe ground (§16),
    // after a human-like reaction delay from first seeing the blocker there.
    if (cmd === 'fwd' && !bully && occupiedByOther(s, me, cellKey(a1)) && !highHopperAt(s, me, cellKey(a1))) {
      const key = cellKey(a1);
      if (blocker?.key !== key) blocker = { key, at: Date.now() + reactionMs() };
      const plan = previewAction(withPlayers(world, s, me), { id: me, pose }, 'jump');
      if (plan?.action === Action.Jump && !plan.bump && isSolid(world, sub(plan.to.cell, dirVec(pose.up)))) {
        if (Date.now() < blocker.at) return; // still "noticing"
        replan();
        return press('jump', p.startTick, p.action, s.tick, true);
      }
    } else blocker = null;
    if (cmd === 'jump') {
      // Someone standing right in front can be shoved out of the way instead.
      if (pushable(s, me, pose, world, false)) { replan(); return press('fwd', p.startTick, p.action, s.tick, true); }
      // A player on A1 is jumped over now; one on the landing cell would shorten the jump (or be stomped): wait.
      if (occupiedByOther(s, me, cellKey(a2)) && !bully) return;
    }
    press(cmd, p.startTick, p.action, s.tick);
  };
}

type Players = { players: { forEach(cb: (p: SchemaPlayer, id: string) => void): void } };
const cellOf = (o: PlayerLike) => ({ x: o.fromX, y: o.fromY, z: o.fromZ });
const manhattan = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);

/** The closest live opponent to this bot (Manhattan cells), or dist Infinity when there's none. */
function nearestOpponent(state: Players, selfId: string): { o: SchemaPlayer | null; dist: number } {
  let me: SchemaPlayer | null = null;
  state.players.forEach((o, id) => { if (id === selfId) me = o; });
  let best: { o: SchemaPlayer | null; dist: number } = { o: null, dist: Infinity };
  if (!me) return best;
  state.players.forEach((o, id) => {
    if (id === selfId || o.spectating || o.action === Action.Dead) return;
    const d = manhattan(cellOf(me!), cellOf(o));
    if (d < best.dist) best = { o, dist: d };
  });
  return best;
}

/** 1-wide runs (≥ 2 tiles) per level, cellKey → its face and axis. */
const corridorCells = new Map<string, Map<string, { up: Dir; along: Dir }>>();
function corridorsOf(world: World): Map<string, { up: Dir; along: Dir }> {
  let m = corridorCells.get(world.level.id);
  if (m) return m;
  m = new Map();
  for (const c of lintCorridors(world.level, 2)) {
    for (let k = 0, cell = c.from; k < c.length; k++, cell = add(cell, dirVec(c.along))) m.set(cellKey(cell), { up: c.up, along: c.along });
  }
  corridorCells.set(world.level.id, m);
  return m;
}

const POST_REFRESH_MS = 2_000;

/**
 * blocker (phase 12b): holds a 1-wide corridor like a human camper, so soaks see corridor stalemates. Every
 * POST_REFRESH_MS it picks its post: the nearest corridor cell on an opponent's shortest route to the keys/exit
 * (knockout: the arena centre), or failing that the nearest corridor cell. It goes there, faces along the corridor
 * toward the nearest opponent, and sits. It only moves to step off a hot tile (the shared heat escape, then back) or
 * to return after being pushed. Defensive hops come from the shared runBot loop.
 * Phase 12c: on its way it waits rather than push anyone in its path; it pushes only at its post, when someone is
 * right in front (on its face, or just around the edge).
 */
function blockerBrain(ctx: Ctx) {
  let post: { cell: string; up: Dir; along: Dir } | null = null;
  let postAt = 0;
  let pending: { prevStart: number; prevAction: number; sentTick: number; fwd: boolean } | null = null;
  const press = (cmd: string, p: SchemaPlayer, tick: number) => {
    if (cmd === 'fwd' && headOnRisk(ctx.room.state, ctx.room.sessionId, poseOf(p.fromX, p.fromY, p.fromZ, p.fromUp, p.fromFwd), planWorld(ctx.room.state))) return;
    pending = { prevStart: p.startTick, prevAction: p.action, sentTick: tick, fwd: cmd === 'fwd' || cmd === 'jump' };
    if (cmd === 'fwd') ctx.send({ fwdHeld: true });
    else if (cmd === 'jump') ctx.send({ fwdHeld: true, jump: true });
    else ctx.send({ turn: cmd === 'left' ? -1 : 1 });
  };

  const choosePost = (world: World, s: Players & { items: { forEach(cb: (it: { kind: string; x: number; y: number; z: number }) => void): void } }, pose: Pose, me: string) => {
    // Never post on a crumble or fire block (§18): the post would drop away or pop the blocker.
    const corridors = new Map([...corridorsOf(world)].filter(([k, c]) => {
      const [x, y, z] = k.split(',').map(Number);
      const t = blockTileAt(world, { cell: { x, y, z }, up: c.up, fwd: c.along })?.type;
      return t !== 'crumble' && t !== 'fire' && !lethalForPlanning(world, { cell: { x, y, z }, up: c.up, fwd: c.along });
    }));
    if (!corridors.size) return null;
    const goals = new Set<string>();
    if (world.mode === 'knockout') {
      const { min, max } = world.level;
      const mid = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
      for (const k of standable(world)) {
        const [x, y, z] = k.split(',').map(Number);
        if (manhattan({ x, y, z }, mid) <= 3) goals.add(k);
      }
    } else {
      s.items.forEach((it) => goals.add(`${it.x},${it.y},${it.z}`));
      if (world.level.exit) goals.add(cellKey(world.level.exit.cell));
    }
    const onRoutes = new Set<string>();
    s.players.forEach((o, id) => {
      if (id === me || o.spectating || o.action === Action.Dead) return;
      const route = findPath(world, poseOf(o.fromX, o.fromY, o.fromZ, o.fromUp, o.fromFwd), goals) ?? [];
      for (const st of route) if (corridors.has(cellKey(st.to.cell))) onRoutes.add(cellKey(st.to.cell));
    });
    const path = findPath(world, pose, onRoutes.size ? onRoutes : new Set(corridors.keys()));
    if (!path) return null;
    const cell = path.length ? cellKey(path[path.length - 1].to.cell) : cellKey(pose.cell);
    const c = corridors.get(cell);
    return c ? { cell, ...c } : null;
  };

  return (playing: boolean) => {
    const s = ctx.room.state;
    const me = ctx.room.sessionId;
    const p: SchemaPlayer | undefined = s.players?.get(me);
    if (!playing || !p || p.action === Action.Dead) { pending = null; post = null; return; }
    if (pending) {
      if (p.startTick !== pending.prevStart || p.action !== pending.prevAction) { if (pending.fwd) ctx.send({}); pending = null; }
      else if (s.tick - pending.sentTick > 4) { ctx.send({}); pending = null; } // blocked: try again next decision
      return;
    }
    if (p.action !== Action.Idle) return;
    const world = planWorld(s);
    const pose = poseOf(p.fromX, p.fromY, p.fromZ, p.fromUp, p.fromFwd);
    if (!post || Date.now() >= postAt) { post = choosePost(world, s, pose, me); postAt = Date.now() + POST_REFRESH_MS; }
    if (!post) return;
    if (cellKey(pose.cell) !== post.cell || pose.up !== post.up) {
      const path = findPath(world, pose, new Set([post.cell]), undefined, p.fireCount);
      if (!path?.length) { post = null; return; }
      const ahead = cellKey(pushSpot(world, pose).cell);
      if (path[0].cmd === 'fwd' && occupiedByOther(s, me, ahead) && !highHopperAt(s, me, ahead)) return; // wait, don't push (a high hop: roll under)
      return press(path[0].cmd, p, s.tick);
    }
    // At the post: face along the corridor toward the nearest opponent (where they'll come from).
    const { o } = nearestOpponent(s, me);
    if (!o) return;
    const A = dirVec(post.along), d = sub(cellOf(o), pose.cell);
    const want = A.x * d.x + A.y * d.y + A.z * d.z >= 0 ? post.along : opposite(post.along);
    if (pose.fwd !== want) press(turnFwd(pose.up, pose.fwd, -1) === want ? 'left' : 'right', p, s.tick);
    else if (pushable(s, me, pose, world, false)) press('fwd', p, s.tick);
  };
}

async function runBot(client: Client, name: string, behaviour: Behaviour): Promise<Stats> {
  const room = await connect(client, name);
  const stats: Stats = {
    rounds: 0, wins: 0, keys: 0, deaths: 0, hops: 0, replans: 0, stuck: 0, pushes: 0, bounces: 0, knockouts: 0, keyDrops: 0, livesLost: 0,
    eliminated: 0, stomps: 0, stomped: 0, clashes: 0, dodges: 0, missedDodges: 0, detours: 0, heatEscapes: 0, burns: 0, cradles: 0, edgePushes: 0,
    headOns: 0, sideHits: 0, sideTries: 0, teleports: 0, zapped: 0, toggles: 0, pillDetours: 0, pills: {},
  };
  let seq = 0;
  const ctx: Ctx = {
    name, room, stats, headOnUntil: new Map(),
    send: (i) => room.send('input', { seq: ++seq, fwdHeld: false, turn: 0, jump: false, jumpHeld: false, ...i }),
  };
  const brain = behaviour === 'wander' ? wanderBrain(ctx) : behaviour === 'blocker' ? blockerBrain(ctx) : seekBrain(ctx, behaviour === 'bully');

  room.onMessage('event', (e: SimEvent) => {
    if (e.type === 'win') {
      stats.rounds++;
      if (e.winnerId === room.sessionId) stats.wins++;
      return;
    }
    const me = room.sessionId;
    if (e.type === 'push' && e.pusherId === me) { stats.pushes++; if (e.edge) stats.edgePushes++; if (e.moving === 'side') stats.sideHits++; }
    if (e.type === 'push' && e.moving === 'headon' && (e.pusherId === me || e.victimId === me)) {
      stats.headOns++;
      ctx.headOnUntil.set(e.pusherId === me ? e.victimId : e.pusherId, Date.now() + HEAD_ON_COOLDOWN_MS);
    }
    if (e.type === 'teleport' && e.playerId === me && e.result === 'go') stats.teleports++;
    if (e.type === 'death' && e.playerId === me && e.cause === 'laser') stats.zapped++;
    if (e.type === 'laser' && e.playerId === me) stats.toggles++;
    if (e.type === 'pickup' && e.playerId === me) stats.pills[e.pickup] = (stats.pills[e.pickup] ?? 0) + 1;
    if (e.type === 'cradle' && e.pusherId === me) stats.cradles++;
    if (e.type === 'knockout' && e.pusherId === me) stats.knockouts++;
    if (e.type === 'stomp' && e.attackerId === me) stats.stomps++;
    if (e.type === 'stomp' && e.victimId === me) stats.stomped++;
    if (e.type === 'clash' && e.victimId === me) stats.clashes++; // clashes this bot's hop caused
    if (!('playerId' in e) || e.playerId !== me) return;
    if (e.type === 'key') stats.keys++;
    if (e.type === 'death') stats.deaths++;
    if (e.type === 'bounce') stats.bounces++;
    if (e.type === 'keyDrop') stats.keyDrops++;
    if (e.type === 'lifeLost') stats.livesLost++;
    if (e.type === 'eliminated') stats.eliminated++;
    if (e.type === 'burn') stats.burns++;
  });

  let dodging = false;
  let cooling = false;
  let voted = false;
  /** The incoming jump being reacted to: when the hop goes in, or null if this bot misses it. */
  let threat: { key: string; at: number | null } | null = null;
  const timer = setInterval(() => {
    const p = room.state.players?.get(room.sessionId);
    if (!p) return;
    if (room.state.phase !== 'lobby') voted = false;
    else if (!voted && room.state.candidates?.length) {
      // Lobby vote (phase 14): a random option, a candidate or Random.
      const options = [...Array(room.state.candidates.length).keys(), RANDOM_VOTE];
      room.send('vote', options[Math.floor(Math.random() * options.length)]);
      voted = true;
    }
    if (room.state.phase === 'lobby' && !p.ready) { room.send('ready'); return; }
    const playing = room.state.phase === 'playing' && !p.spectating;
    // Hot tile (phase 12): past the warn threshold, step off (any legal move: W rolls, flips or climbs).
    const pw = planWorld(room.state), heat = pw.level.heat;
    const tileHeat = room.state.hot?.get(tileKey({ x: p.fromX, y: p.fromY, z: p.fromZ }, p.fromUp)) ?? 0;
    if (playing && heat && tileHeat >= heat.warnTicks && p.action === Action.Idle) {
      // Roll off, unless that's onto a trap or off the map (§18): then turn and try the next direction.
      const pose: Pose = { cell: { x: p.fromX, y: p.fromY, z: p.fromZ }, up: p.fromUp as Dir, fwd: p.fromFwd as Dir };
      if (!cooling && !resultPose(pw, pose, 'fwd')) { ctx.send({ turn: 1 }); return; }
      if (!cooling) { ctx.send({ fwdHeld: true }); stats.heatEscapes++; cooling = true; }
      return;
    }
    if (cooling) { ctx.send({}); cooling = false; }
    // Every bot: an enemy's landing marker on my tile → hold jump (a hop high at their landing clashes, §16),
    // after a reaction delay, and sometimes not at all.
    const key = playing ? jumpingOnto(room.state, p, room.sessionId) : '';
    if (key) {
      if (threat?.key !== key) {
        const miss = Math.random() < HOP_MISS;
        threat = { key, at: miss ? null : Date.now() + reactionMs() };
        if (miss) stats.missedDodges++;
      }
      if (threat.at !== null && Date.now() >= threat.at) {
        if (!dodging) { ctx.send({ jump: true, jumpHeld: true }); stats.dodges++; dodging = true; }
        return;
      }
      if (!dodging) { brain(playing); return; } // not reacting (yet): carry on as if nothing's coming
      return;
    }
    threat = null;
    if (dodging) { ctx.send({}); dodging = false; }
    brain(playing);
  }, 20);

  await new Promise<void>((resolve) => {
    room.onLeave(() => resolve());
    if (duration !== Infinity) setTimeout(() => room.leave().catch(() => resolve()), duration * 1000);
    process.once('SIGINT', () => room.leave().catch(() => resolve()));
  });
  clearInterval(timer);
  return stats;
}

const assigned = Array.from({ length: count }, (_, i) => behaviours[i % behaviours.length] as Behaviour);
console.log(`spawning ${count} bot(s) [${assigned.join(', ')}] → ${values.server}${duration !== Infinity ? ` for ${duration}s` : ''}, skill ${skill}`);
const client = new Client(values.server);
const names = assigned.map((b, i) => `${b}-${i + 1}`);
const results = await Promise.allSettled(names.map((n, i) => runBot(client, n, assigned[i])));

console.log('\nsummary');
results.forEach((r, i) => {
  if (r.status === 'rejected') console.log(`  ${names[i]}: failed (${r.reason?.message ?? r.reason})`);
  else {
    const v = r.value;
    console.log(`  ${names[i]}: rounds ${v.rounds}, wins ${v.wins}, keys ${v.keys}, deaths ${v.deaths}, hops ${v.hops}, replans ${v.replans}, stuck ${v.stuck}, pushes ${v.pushes}, bounces ${v.bounces}, knockouts ${v.knockouts}, keyDrops ${v.keyDrops}, livesLost ${v.livesLost}, eliminated ${v.eliminated}, stomps ${v.stomps}, stomped ${v.stomped}, clashes ${v.clashes}, dodges ${v.dodges}, missedDodges ${v.missedDodges}, detours ${v.detours}, heatEscapes ${v.heatEscapes}, burns ${v.burns}, cradles ${v.cradles}, edgePushes ${v.edgePushes}, headOns ${v.headOns}, sideHits ${v.sideHits}/${v.sideTries}, teleports ${v.teleports}, zapped ${v.zapped}, toggles ${v.toggles}, pills ${Object.entries(v.pills).map(([k, n]) => `${k}:${n}`).join(' ') || 'none'} (detours ${v.pillDetours})`);
  }
});
process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
