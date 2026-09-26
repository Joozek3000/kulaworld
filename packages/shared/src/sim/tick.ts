import { CHAIN_MAX, FLIP_TICKS, INPUT_BUFFER_TICKS, JUMP_GRACE_TICKS, KNOCK_TICKS, REBOUND_TICKS, RESPAWN_TICKS, ROLL_TICKS, SPAWN_PROTECT_TICKS, STRIKE_TICKS, STUN_TICKS } from '../constants.ts';
import { cross, dirVec, opposite, type Dir } from '../dir.ts';
import { add, eq, sub, type Vec3 } from '../vec.ts';
import { previewAction, standingAt, startAction, startFall, turnFwd, type Plan } from './actions.ts';
import { checkTimeout, onDeath, onLand } from './keyRace.ts';
import { loseLife, stepCrumble, stepKnockout } from './knockout.ts';
import {
  Action, isFree, isPushable, isSolid, outOfBounds, reservations, reserve, tileKey, transmits, trySpawn,
  type Cmd, type PlayerState, type Reservations, type SimEvent, type World,
} from './world.ts';

/** Advances the world by one tick (ARCHITECTURE §7). Returns the events of this tick. */
export function step(world: World): SimEvent[] {
  const tick = ++world.tick;
  const events: SimEvent[] = [];
  const order = fairOrder(world.players, tick);

  // Apply inputs (§7 step 1). Airborne players turn instantly: only the facing they land with changes.
  for (const p of order) {
    if (!AIRBORNE.has(p.action)) {
      if (p.pulse && !HELPLESS.has(p.action)) p.pulseAge++; // buffered pulses age only while grounded and in control
    } else if (p.pulse === 'left' || p.pulse === 'right') {
      p.turnFromFwd = p.to.fwd;
      p.turnStartTick = tick;
      p.to = { ...p.to, fwd: turnFwd(p.to.up, p.to.fwd, p.pulse === 'left' ? -1 : 1) };
      p.pulse = null;
    }
  }

  // Jump grace (§6): W and Space pressed "together" from rest but a tick or two apart. The roll is cancelled (its
  // target cell released) and the player decides again this tick, from its origin cell: a standing forward jump.
  for (const p of order) {
    if (p.action === Action.Roll && tick <= p.graceUntil && p.pulse === 'jump' && p.fwdHeld) {
      p.action = Action.Idle;
      p.to = p.pose;
      p.startTick = p.endTick = tick;
      p.graceUntil = -1;
    }
  }

  for (const p of order) if (p.action !== Action.Idle && p.endTick === tick && !p.eliminated) finishAction(world, p, events);
  // Crumbled ground: an Idle player whose block is gone falls (mid-action players are checked when they finish).
  if (world.removed.size) for (const p of order) if (p.action === Action.Idle) startFall(world, p, tick);

  const intents = order.filter((p) => p.action === Action.Idle).map((p) => ({ p, cmds: commands(p) }));
  resolveMoves(world, intents, events);

  updateHeat(world, events);

  if (world.mode === 'knockout') stepKnockout(world, events);
  else {
    stepCrumble(world, events);
    checkTimeout(world, events);
  }
  return events;
}

const AIRBORNE: ReadonlySet<Action> = new Set([Action.Hop, Action.Jump, Action.Fall, Action.Rebound]);
/** Pushed around: buffered pulses wait (don't age) until the player is back in control. */
const HELPLESS: ReadonlySet<Action> = new Set([Action.Knocked, Action.Stunned]);

/** Join order rotated by tick % playerCount so no player always wins contested cells. */
function fairOrder(players: PlayerState[], tick: number): PlayerState[] {
  const k = players.length ? tick % players.length : 0;
  return [...players.slice(k), ...players.slice(0, k)];
}

/** A jump goes forward when `forward`, otherwise hops in place; a blocked forward jump hops. */
const jumpCmds = (forward: boolean): Cmd[] => (forward ? ['jump', 'hop'] : ['hop']);

/**
 * Candidate commands in priority order (ARCHITECTURE §6):
 * 1. buffered jump pulse or forward latch, 2. buffered turn, 3. jumpHeld, 4. fwdHeld.
 * The latch is cleared at every decision.
 */
function commands(p: PlayerState): Cmd[] {
  if (p.pulse && p.pulseAge > INPUT_BUFFER_TICKS) p.pulse = null;
  const cmds: Cmd[] = [];
  if (p.pulse === 'jump' || p.fwdLatch) cmds.push(...jumpCmds(p.fwdHeld || p.fwdLatch));
  if (p.pulse === 'left' || p.pulse === 'right') cmds.push(p.pulse);
  if (p.jumpHeld) cmds.push(...jumpCmds(p.fwdHeld));
  if (p.fwdHeld) cmds.push('fwd');
  p.fwdLatch = false;
  return cmds;
}

type Intent = { p: PlayerState; cmds: Cmd[] };

/**
 * The single place where all Idle players' intended moves are resolved against each other (ARCHITECTURE §7, §14).
 * Each player's intent is its first viable command, or a push when that is a roll into a same-face player, or an
 * edge push when it is a flip onto a player standing on the face being flipped onto.
 * Order: 1. targeted victims escaping (any move but a turn), 2. mutual pushes bounce, 3. other pushes, 4. the rest.
 * Within each stage players go in fair order; a later player sees earlier claims as reserved.
 * With push rules off there are no push intents, so only stage 4 runs: the MVP rules.
 */
function resolveMoves(world: World, intents: Intent[], events: SimEvent[]): void {
  const res = reservations(world);
  const victimOf = new Map<PlayerState, PlayerState>();
  const edge = new Set<PlayerState>();
  const plans = new Map<PlayerState, Plan>();
  for (const { p, cmds } of intents) {
    const choice = choose(world, p, cmds, res);
    if (choice && 'victim' in choice) {
      victimOf.set(p, choice.victim);
      if (choice.edge) edge.add(p);
    } else if (choice) plans.set(p, choice);
  }
  // Every ball in a pushed line may escape first (cradle push, §14); one that does breaks the line there.
  const targeted = new Set([...victimOf].flatMap(([p, v]) => (edge.has(p) ? [v] : chainLine(world, p, v))));
  const done = new Set<PlayerState>();
  const act = ({ p, cmds }: Intent) => { done.add(p); tryCmds(world, p, cmds, res); };

  for (const it of intents) if (targeted.has(it.p) && plans.has(it.p) && plans.get(it.p)!.action !== Action.Turn) act(it);

  for (const [p, v] of victimOf) {
    if (victimOf.get(v) !== p || done.has(p)) continue;
    for (const q of [p, v]) { done.add(q); spendPulse(intents, q); stun(q, world.tick, true); events.push({ type: 'bounce', playerId: q.id }); }
  }

  for (const [p, v] of victimOf) {
    if (done.has(p)) continue;
    done.add(p);
    spendPulse(intents, p);
    const knocked = edge.has(p) ? edgePush(world, p, v, res, events) : push(world, p, v, res, events);
    if (knocked) done.add(knocked);
  }

  for (const it of intents) if (!done.has(it.p)) act(it);
}

/**
 * The first command that would start, or the victim when that is a roll into a player on the same face, or (`edge`)
 * a flip whose target cell T holds a player standing on the face flipped onto (§14 edge push).
 */
function choose(world: World, p: PlayerState, cmds: Cmd[], res: Reservations): Plan | { victim: PlayerState; edge?: true } | null {
  for (const cmd of cmds) {
    if (cmd === 'fwd' && world.rules.push) {
      const A = add(p.pose.cell, dirVec(p.pose.fwd));
      const victim = world.players.find((v) => v !== p && v.action !== Action.Dead && v.pose.up === p.pose.up && eq(v.pose.cell, A));
      if (victim) return { victim };
      const T = flipTarget(world, p, res);
      const onT = T && world.players.find((v) => v !== p && v.action !== Action.Dead && v.pose.up === p.pose.fwd && eq(v.pose.cell, T));
      if (onT) return { victim: onT, edge: true };
    }
    const plan = previewAction(world, p, cmd, res);
    if (plan) return plan;
  }
  return null;
}

/** Starts the first command that isn't blocked. A pulse is spent when tried, even if blocked. */
function tryCmds(world: World, p: PlayerState, cmds: Cmd[], res: Reservations): void {
  for (const cmd of cmds) {
    if (cmd !== 'fwd') p.pulse = null;
    const plan = previewAction(world, p, cmd, res);
    if (!plan) continue;
    const resting = p.endTick < world.tick; // Idle for at least a tick, not chaining from a finished action
    startAction(p, plan, world.tick);
    p.graceUntil = plan.action === Action.Roll && resting ? world.tick + JUMP_GRACE_TICKS : -1;
    reserve(res, p);
    return;
  }
}

/** A pusher tried every command before its roll, so any buffered pulse was spent. */
function spendPulse(intents: Intent[], p: PlayerState): void {
  if (intents.find((it) => it.p === p)!.cmds.some((c) => c !== 'fwd')) p.pulse = null;
}

function stun(p: PlayerState, tick: number, bounce: boolean): void {
  startAction(p, { action: Action.Stunned, to: p.pose, ticks: STUN_TICKS }, tick);
  p.bounce = bounce;
}

/** V1 and the balls lined up behind it along P's fwd on P's face, each in the next cell (at most CHAIN_MAX). */
function chainLine(world: World, p: PlayerState, v: PlayerState): PlayerState[] {
  const F = dirVec(p.pose.fwd), line = [v], max = world.rules.chain === false ? 1 : CHAIN_MAX;
  for (let cell = add(v.pose.cell, F); line.length < max; cell = add(cell, F)) {
    const next = world.players.find((q) => q !== p && q.action !== Action.Dead && q.pose.up === p.pose.up && eq(q.pose.cell, cell));
    if (!next) break;
    line.push(next);
  }
  return line;
}

/**
 * P rolls into V's cell A (§14). Returns the knocked ball, or null.
 * - V alone (nothing behind it): the normal push. V not pushable: P is blocked (stays Idle, retries next tick). V's
 *   next cell blocked (a wall, or a player past CHAIN_MAX / with chain off): P bounces. Else V is knocked, P rolls in.
 * - A line V1..Vn (n ≥ 2): a cradle strike. P and the middle balls stay put; only Vn is knocked. A middle ball that
 *   isn't transmitting (moving) blocks P; Vn not pushable, or its next cell blocked, bounces P.
 */
function push(world: World, p: PlayerState, v: PlayerState, res: Reservations, events: SimEvent[]): PlayerState | null {
  const tick = world.tick;
  const F = dirVec(p.pose.fwd);
  const line = chainLine(world, p, v);
  const last = line[line.length - 1], dest = add(last.pose.cell, F);
  const cradle = line.length > 1;
  if (cradle ? !line.slice(0, -1).every((q) => transmits(q, tick)) : !isPushable(v, tick)) return null;
  if (!isPushable(last, tick) || !isFree(world, res, last.id, dest)) {
    stun(p, tick, true);
    events.push({ type: 'bounce', playerId: p.id });
    return null;
  }
  knock(last, dest, p.id, tick);
  if (cradle) startAction(p, { action: Action.Strike, to: p.pose, ticks: STRIKE_TICKS }, tick);
  else startAction(p, { action: Action.Roll, to: { ...p.pose, cell: v.pose.cell }, ticks: ROLL_TICKS }, tick);
  if (p.protectedUntil > tick) p.protectedUntil = tick; // pushing ends your own spawn protection
  reserve(res, last);
  reserve(res, p);
  events.push(cradle ? { type: 'cradle', pusherId: p.id, victimId: last.id, length: line.length } : { type: 'push', pusherId: p.id, victimId: v.id });
  return last;
}

/** The cell a forward roll from P's pose would flip into (A free, nothing below it), or null. */
function flipTarget(world: World, p: PlayerState, res: Reservations): Vec3 | null {
  const A = add(p.pose.cell, dirVec(p.pose.fwd));
  if (isSolid(world, A) || !isFree(world, res, p.id, A)) return null;
  const T = sub(A, dirVec(p.pose.up));
  return isSolid(world, T) ? null : T;
}

/**
 * Edge push (§14, phase 12c): P flips over its edge into T, where V stands on P's new face. V is pushed along
 * D = −U (P's old up reversed: down the side face, or across the top away from the edge) to T + D.
 * V not pushable: P is blocked. T + D blocked: P bounces. Else V is knocked and P completes its flip into T.
 */
function edgePush(world: World, p: PlayerState, v: PlayerState, res: Reservations, events: SimEvent[]): PlayerState | null {
  const tick = world.tick, D = opposite(p.pose.up), dest = add(v.pose.cell, dirVec(D));
  if (!isPushable(v, tick)) return null;
  if (!isFree(world, res, v.id, dest)) {
    stun(p, tick, true);
    events.push({ type: 'bounce', playerId: p.id });
    return null;
  }
  knock(v, dest, p.id, tick);
  startAction(p, { action: Action.Flip, to: { cell: v.pose.cell, up: p.pose.fwd, fwd: D }, ticks: FLIP_TICKS }, tick);
  if (p.protectedUntil > tick) p.protectedUntil = tick;
  reserve(res, v);
  reserve(res, p);
  events.push({ type: 'push', pusherId: p.id, victimId: v.id, edge: true });
  return v;
}

/** A death (off the map, or burnt): Dead for RESPAWN_TICKS, key drop and knockout credit, a life in knockout. */
function die(world: World, p: PlayerState, events: SimEvent[]): void {
  p.action = Action.Dead;
  p.to = p.pose;
  p.startTick = world.tick;
  p.endTick = world.tick + RESPAWN_TICKS;
  p.heat = 0;
  events.push({ type: 'death', playerId: p.id, cell: p.pose.cell });
  const creditId = onDeath(world, p, events);
  if (world.mode === 'knockout') loseLife(world, p, creditId, events);
}

/**
 * Hot tiles (phase 12, per tile since 12c): a tile (cell, up) heats 1 per tick while a ball on it is Idle, Turning or
 * Hopping (hops at half rate, every even tick), and cools 1 per 2 ticks while no ball is on it. A ball that is on it
 * but stunned, knocked or leaving holds its heat. At the level's burn threshold the ball pops (a death) and the tile
 * resets.
 */
function updateHeat(world: World, events: SimEvent[]): void {
  const h = world.heat;
  if (!h) return;
  const hot = world.hot, occupied = new Set<string>();
  for (const p of world.players) {
    if (p.action === Action.Dead || p.eliminated) { p.heat = 0; continue; }
    const key = tileKey(p.pose.cell, p.pose.up);
    occupied.add(key);
    p.heat = hot.get(key) ?? 0;
    if (p.action !== Action.Idle && p.action !== Action.Turn && p.action !== Action.Hop) continue;
    if (p.action === Action.Hop && world.tick % 2) continue; // hopping in place (the stomp defence) heats at half rate
    if (++p.heat < h.burnTicks) { hot.set(key, p.heat); continue; }
    hot.delete(key);
    events.push({ type: 'burn', playerId: p.id });
    die(world, p, events);
  }
  if (world.tick % 2 === 0) {
    for (const [key, heat] of hot) if (!occupied.has(key)) { if (heat > 1) hot.set(key, heat - 1); else hot.delete(key); }
  }
}

/** V is knocked one cell to `dest` by `byId` (push or stomp): it cancels a Turn (keeping its start facing) or a Hop. */
function knock(v: PlayerState, dest: Vec3, byId: string, tick: number): void {
  const fwd = v.action === Action.Turn ? v.pose.fwd : v.to.fwd;
  v.pose = { ...v.pose, fwd };
  startAction(v, { action: Action.Knocked, to: { cell: dest, up: v.pose.up, fwd }, ticks: KNOCK_TICKS }, tick);
  v.bounce = false;
  v.lastKnockedBy = byId;
  v.lastKnockedTick = tick;
}

/**
 * A stomp jump lands (§16). Returns true when the attacker's landing is fully handled (stomp done, or a rebound
 * started); false for a normal landing (the victim escaped, or L is empty).
 * - V still in L and stompable (the same helper as pushes): stomp. V is knocked to B, the attacker lands in L.
 * - V still in L but not stompable (high in a hop, staggered, spawn-protected): clash. The attacker rebounds to C.
 * - V in L but its action is taking it elsewhere: it escaped.
 */
function landStomp(world: World, p: PlayerState, events: SimEvent[]): boolean {
  const tick = world.tick, L = p.to.cell, B = p.stompBump!;
  const v = standingAt(world, L, p.to.up, p.id);
  if (!v) return false;
  const leaving = v.action !== Action.Idle && v.action !== Action.Turn && v.action !== Action.Hop
    && v.action !== Action.Stunned && v.action !== Action.Strike && !eq(v.to.cell, L);
  if (leaving) return false;
  if (isPushable(v, tick)) {
    knock(v, B, p.id, tick);
    events.push({ type: 'stomp', attackerId: p.id, victimId: v.id });
    return false; // the attacker lands in L as usual
  }
  // Clash: back along the jump to the takeoff cell (C stayed reserved during the jump), from L.
  const C = p.pose.cell;
  p.pose = { ...p.to };
  startAction(p, { action: Action.Rebound, to: { cell: C, up: p.to.up, fwd: p.to.fwd }, ticks: REBOUND_TICKS }, tick);
  events.push({ type: 'clash', attackerId: p.id, victimId: v.id });
  return true;
}

/**
 * A fall lands on a grounded, stompable player (§16): it's knocked one cell, in the first free direction of the
 * faller's fwd, left, right, back. None free: the MVP overlap rule.
 */
function fallStomp(world: World, p: PlayerState, events: SimEvent[]): void {
  const v = standingAt(world, p.pose.cell, p.pose.up, p.id);
  if (!v || !isPushable(v, world.tick)) return;
  const { up, fwd } = p.pose;
  const res = reservations(world);
  const dirs: Dir[] = [fwd, cross(up, fwd), cross(fwd, up), opposite(fwd)];
  for (const d of dirs) {
    const dest = add(v.pose.cell, dirVec(d));
    if (!isFree(world, res, v.id, dest) || !isFree(world, res, p.id, dest)) continue;
    knock(v, dest, p.id, world.tick);
    events.push({ type: 'stomp', attackerId: p.id, victimId: v.id });
    return;
  }
}

function finishAction(world: World, p: PlayerState, events: SimEvent[]): void {
  const tick = world.tick;
  if (p.action === Action.Dead) {
    const knockout = world.mode === 'knockout'; // random spawn + protection
    if (trySpawn(world, p, knockout)) {
      if (knockout) p.protectedUntil = tick + SPAWN_PROTECT_TICKS;
      events.push({ type: 'respawn', playerId: p.id, cell: p.pose.cell });
    } else p.endTick = tick + 1; // no free spawn with ground, retry next tick
    return;
  }
  const finished = p.action;
  if (finished === Action.Jump && p.stompBump && landStomp(world, p, events)) return;
  p.pose = p.to;
  p.action = Action.Idle;
  p.bounce = false;
  p.jumpOver = false;
  p.stompBump = null;
  if (finished === Action.Fall && outOfBounds(world.level, p.pose.cell)) {
    die(world, p, events);
    return;
  }
  // Nothing below: a jump or knock into air, a fall step, or ground that crumbled during the action.
  if (startFall(world, p, tick)) return;
  if (finished === Action.Fall && world.rules.push) fallStomp(world, p, events);
  if (finished === Action.Turn || finished === Action.Stunned || finished === Action.Strike) return;
  if (finished === Action.Knocked) stun(p, tick, false); // stagger: not pushable (§14)
  onLand(world, p, events);
}
