import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Client, type Room } from '@colyseus/sdk';
import {
  Action, add, ALL_DIRS, cellKey, createWorld, dirVec, findPath, isPushable, isSolid, loadLevel, perpendicular, sub, turnFwd,
  type Dir, type Input, type PathStep, type PlayerState, type Pose, type SimEvent, type World,
} from '@kula/shared';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1' },
    behaviour: { type: 'string', default: 'wander' }, // comma list, assigned round-robin: seek,wander,bully
    duration: { type: 'string' }, // seconds; default: run until Ctrl+C
    server: { type: 'string', default: 'ws://localhost:2567' },
  },
});
const BEHAVIOURS = ['wander', 'seek', 'bully'] as const;
type Behaviour = (typeof BEHAVIOURS)[number];
const count = Number(values.count);
const duration = values.duration === undefined ? Infinity : Number(values.duration);
const behaviours = values.behaviour.split(',').map((b) => b.trim());
if (!Number.isInteger(count) || count < 1) throw new Error(`--count must be a positive integer, got ${values.count}`);
if (!(duration > 0)) throw new Error(`--duration must be a positive number of seconds, got ${values.duration}`);
for (const b of behaviours) if (!BEHAVIOURS.includes(b as Behaviour)) throw new Error(`unknown --behaviour ${b} (available: ${BEHAVIOURS.join(', ')})`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (a: number, b: number) => a + Math.random() * (b - a);

interface Stats {
  rounds: number; wins: number; keys: number; deaths: number; hops: number; replans: number; stuck: number;
  pushes: number; bounces: number; knockouts: number; keyDrops: number; livesLost: number; eliminated: number;
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
 * bands count as gone, so plans never stand on a tile that's about to drop.
 */
const planWorlds = new Map<string, World>();
function planWorld(state: { levelId: string; crumbled: number; warnBand: number }): World {
  let w = planWorlds.get(state.levelId);
  if (!w) {
    const json = JSON.parse(readFileSync(new URL(`../../../levels/${state.levelId}.json`, import.meta.url), 'utf8'));
    planWorlds.set(state.levelId, (w = createWorld(loadLevel(json), 0)));
  }
  if (w.knockout) w.removed = new Set(w.knockout.bands.slice(0, Math.max(state.crumbled, state.warnBand + 1)).flat());
  return w;
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

interface Ctx { name: string; room: Room; stats: Stats; send(i: Partial<Input>): void }

/** wander: hold forward and send a random turn/jump/hop pulse every 300-1200 ms. */
function wanderBrain(ctx: Ctx) {
  let nextPulseAt = 0;
  let wasPlaying = false;
  return (playing: boolean) => {
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
  fwd: [Action.Roll, Action.Flip],
  jump: [Action.Jump],
  left: [Action.Turn],
  right: [Action.Turn],
};
/** Actions whose `to` is where the player ends up, so the next step may be pressed in their last tick. */
const EARLY_OK = new Set<number>([Action.Roll, Action.Turn, Action.Flip]);
const STUCK_MS = 10_000;
const BULLY_PATIENCE_MS = 1_000;
const BULLY_IGNORE_MS = 3_000;
const BOUNCE_JITTER_MS = 500;

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

/**
 * An opponent a roll forward would push right now: standing in A = C + F on the same face and pushable next tick.
 * With `voidOnly`, only if the knock would drop it into air (A + F − U not solid).
 */
function pushable(state: { tick: number; players: { forEach(cb: (p: PlayerLike, id: string) => void): void } }, selfId: string, pose: Pose, world: World, voidOnly: boolean): boolean {
  const F = dirVec(pose.fwd), A = add(pose.cell, F), dest = add(A, F);
  if (isSolid(world, dest)) return false; // would bounce
  if (voidOnly && isSolid(world, sub(dest, dirVec(pose.up)))) return false;
  let hit = false;
  state.players.forEach((o, id) => {
    if (id === selfId || o.fromUp !== pose.up || `${o.fromX},${o.fromY},${o.fromZ}` !== cellKey(A)) return;
    if (isPushable({ action: o.action, startTick: o.startTick, endTick: o.endTick } as PlayerState, state.tick + 1)) hit = true;
  });
  return hit;
}

/** Standable cells next to each opponent on its own face (where a bully can push from), cellKey → opponent id. */
function besideOpponents(state: { players: { forEach(cb: (p: PlayerLike & { toUp: number }, id: string) => void): void } }, selfId: string, world: World, skip: (id: string) => boolean): Map<string, string> {
  const cells = new Map<string, string>();
  state.players.forEach((o, id) => {
    if (id === selfId || o.action === Action.Dead || skip(id)) return;
    const U = dirVec(o.toUp as Dir);
    for (const d of ALL_DIRS) {
      if (!perpendicular(d, o.toUp as Dir)) continue;
      const c = add({ x: o.toX, y: o.toY, z: o.toZ }, dirVec(d));
      if (!isSolid(world, c) && isSolid(world, sub(c, U))) cells.set(cellKey(c), id);
    }
  });
  return cells;
}

/** An opponent standing right next to `pose` on the same face: its id and the direction to it. */
function adjacentOpponent(state: { players: { forEach(cb: (p: PlayerLike, id: string) => void): void } }, selfId: string, pose: Pose, skip: (id: string) => boolean): { id: string; dir: Dir } | null {
  let hit: { id: string; dir: Dir } | null = null;
  state.players.forEach((o, id) => {
    if (id === selfId || o.action === Action.Dead || skip(id) || o.fromUp !== pose.up) return;
    for (const d of ALL_DIRS) {
      if (perpendicular(d, pose.up) && cellKey(add(pose.cell, dirVec(d))) === `${o.fromX},${o.fromY},${o.fromZ}`) hit = { id, dir: d };
    }
  });
  return hit;
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
  const skip = (id: string) => (ignored.get(id) ?? 0) > Date.now();
  // After a bounce, wait a random moment: two bots that bounced off each other recover on the same tick and would
  // otherwise push each other again in lockstep forever.
  let holdUntil = 0;

  const replan = () => { path = []; target = ''; expected = null; };
  const randomTurn = () => ctx.send({ turn: Math.random() < 0.5 ? -1 : 1 });
  /** The move didn't happen (blocked, or bounced off a push): retry, replan after two, turn randomly after 3 replans. */
  const onBlocked = () => {
    if (++blocked >= 2) {
      blocked = 0;
      replan();
      if (++failedPlans >= 3) { failedPlans = 0; randomTurn(); }
    }
  };
  const press = (cmd: string, prevStart: number, prevAction: number, tick: number, offPath = false) => {
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
        if (p.action === Action.Stunned) { onBlocked(); holdUntil = Date.now() + Math.random() * BOUNCE_JITTER_MS; } // bounced
        else if (pending.offPath) replan();
        else if (EXPECTED[pending.cmd].includes(p.action)) {
          expected = path.shift()!.to;
          blocked = 0;
          failedPlans = 0;
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
    const unsafe = !!world.knockout && !isSolid(world, sub(pose.cell, dirVec(pose.up)));
    if (!unsafe && pushable(s, me, pose, world, !bully)) {
      replan();
      facing = null;
      return press('fwd', p.startTick, p.action, s.tick, true);
    }
    if (hunter && !unsafe) {
      const adj = adjacentOpponent(s, me, pose, skip);
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
    if (unsafe) goals = standable(world);
    else if (hunter) goals = new Set(besideOpponents(s, me, world, skip).keys());
    else if (world.level.exit && p.keys >= world.level.keysRequired) goals.add(cellKey(world.level.exit.cell));
    else s.items.forEach((it: { kind: string; x: number; y: number; z: number }) => { if (it.kind === 'key') goals.add(`${it.x},${it.y},${it.z}`); });

    const onPlan = path.length > 0 && goals.has(target) && expected !== null && samePose(pose, expected);
    if (!onPlan) {
      const found = goals.size ? findPath(world, pose, goals) : null;
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
    // A player on A1/A2 blocks or shortens a forward jump (a short jump can drop into a gap): wait for them.
    if (cmd === 'jump') {
      const F = dirVec(pose.fwd);
      const a1 = add(pose.cell, F), a2 = add(a1, F);
      // Someone standing right in front can be shoved out of the way instead.
      if (pushable(s, me, pose, world, false)) { replan(); return press('fwd', p.startTick, p.action, s.tick, true); }
      if (occupiedByOther(s, me, cellKey(a1)) || occupiedByOther(s, me, cellKey(a2))) return;
    }
    press(cmd, p.startTick, p.action, s.tick);
  };
}

async function runBot(client: Client, name: string, behaviour: Behaviour): Promise<Stats> {
  const room = await connect(client, name);
  const stats: Stats = { rounds: 0, wins: 0, keys: 0, deaths: 0, hops: 0, replans: 0, stuck: 0, pushes: 0, bounces: 0, knockouts: 0, keyDrops: 0, livesLost: 0, eliminated: 0 };
  let seq = 0;
  const ctx: Ctx = {
    name, room, stats,
    send: (i) => room.send('input', { seq: ++seq, fwdHeld: false, turn: 0, jump: false, jumpHeld: false, ...i }),
  };
  const brain = behaviour === 'wander' ? wanderBrain(ctx) : seekBrain(ctx, behaviour === 'bully');

  room.onMessage('event', (e: SimEvent) => {
    if (e.type === 'win') {
      stats.rounds++;
      if (e.winnerId === room.sessionId) stats.wins++;
      return;
    }
    const me = room.sessionId;
    if (e.type === 'push' && e.pusherId === me) stats.pushes++;
    if (e.type === 'knockout' && e.pusherId === me) stats.knockouts++;
    if (!('playerId' in e) || e.playerId !== me) return;
    if (e.type === 'key') stats.keys++;
    if (e.type === 'death') stats.deaths++;
    if (e.type === 'bounce') stats.bounces++;
    if (e.type === 'keyDrop') stats.keyDrops++;
    if (e.type === 'lifeLost') stats.livesLost++;
    if (e.type === 'eliminated') stats.eliminated++;
  });

  const timer = setInterval(() => {
    const p = room.state.players?.get(room.sessionId);
    if (!p) return;
    if (room.state.phase === 'lobby' && !p.ready) { room.send('ready'); return; }
    brain(room.state.phase === 'playing' && !p.spectating);
  }, behaviour === 'wander' ? 100 : 20);

  await new Promise<void>((resolve) => {
    room.onLeave(() => resolve());
    if (duration !== Infinity) setTimeout(() => room.leave().catch(() => resolve()), duration * 1000);
    process.once('SIGINT', () => room.leave().catch(() => resolve()));
  });
  clearInterval(timer);
  return stats;
}

const assigned = Array.from({ length: count }, (_, i) => behaviours[i % behaviours.length] as Behaviour);
console.log(`spawning ${count} bot(s) [${assigned.join(', ')}] → ${values.server}${duration !== Infinity ? ` for ${duration}s` : ''}`);
const client = new Client(values.server);
const names = assigned.map((b, i) => `${b}-${i + 1}`);
const results = await Promise.allSettled(names.map((n, i) => runBot(client, n, assigned[i])));

console.log('\nsummary');
results.forEach((r, i) => {
  if (r.status === 'rejected') console.log(`  ${names[i]}: failed (${r.reason?.message ?? r.reason})`);
  else {
    const v = r.value;
    console.log(`  ${names[i]}: rounds ${v.rounds}, wins ${v.wins}, keys ${v.keys}, deaths ${v.deaths}, hops ${v.hops}, replans ${v.replans}, stuck ${v.stuck}, pushes ${v.pushes}, bounces ${v.bounces}, knockouts ${v.knockouts}, keyDrops ${v.keyDrops}, livesLost ${v.livesLost}, eliminated ${v.eliminated}`);
  }
});
process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
