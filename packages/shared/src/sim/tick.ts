import {
  BOOST_HOLD_TICKS, CHAIN_MAX, CRUMBLE_DELAY_TICKS, FIRE_MAX, FLIP_TICKS, INPUT_BUFFER_TICKS, JUMP_GRACE_TICKS, JUMP_TICKS, KNOCK_TICKS, REBOUND_TICKS,
  RESPAWN_TICKS, ROLL_TICKS, SPAWN_PROTECT_TICKS, STRIKE_TICKS, STUN_TICKS, SWITCH_COOLDOWN_TICKS,
} from '../constants.ts';
import { cross, dirFromVec, dirVec, opposite, type Dir } from '../dir.ts';
import type { Pose } from '../level/types.ts';
import { add, cellKey, eq, sub, type Vec3 } from '../vec.ts';
import { boostBlock, previewAction, standingAt, startAction, startFall, turnFwd, type Plan } from './actions.ts';
import { checkTimeout, onDeath, onLand } from './keyRace.ts';
import { loseLife, stepCrumble, stepKnockout } from './knockout.ts';
import { collectPickup, ownTicks, stepPickups } from './pickups.ts';
import { beamAt, beamHit, blockTileAt, faceTileAt, forcedAfter, fwdAllowed, onIce, pathCells, spiked } from './tiles.ts';
import {
  Action, airHop, hasEffect, isFree, isPushable, occupiedCells, pushableState, isSolid, outOfBounds, reservations, reserve, tileKey, transmits, trySpawn,
  type Cmd, type DeathCause, type PlayerState, type Reservations, type SimEvent, type World,
} from './world.ts';

/** Advances the world by one tick (ARCHITECTURE §7). Returns the events of this tick. */
export function step(world: World): SimEvent[] {
  const tick = ++world.tick;
  const events: SimEvent[] = [];
  const order = fairOrder(world.players, tick);
  stepPickups(world, events); // pills (§21): effects end, pickups respawn and spawn

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

  // A hop coming down on a cell another ball is in or passing through (§14 roll under) lands after the moves below.
  const hopLandings: PlayerState[] = [];
  const arrived = new Set<PlayerState>(); // finished a move this tick: still moving for a mutual push (§20)
  for (const p of order) {
    if (p.action === Action.Idle || p.endTick !== tick || p.eliminated) continue;
    if (p.action === Action.Hop && world.players.some((v) => under(p, v))) { hopLandings.push(p); continue; }
    const was = p.action;
    finishAction(world, p, events);
    if (MOVERS.has(was) && (p.action as Action) === Action.Idle) arrived.add(p);
  }
  // Spikes rising under a ball standing on them (§18), or a laser switched on through its cell (13b). Finishing onto
  // raised spikes or into a beam is handled in finishAction.
  for (const p of order) {
    if (!STANDING.has(p.action)) continue;
    if (spiked(world, p.pose)) die(world, p, events, 'spikes');
    else if (beamAt(world, p.pose.cell)) die(world, p, events, 'laser');
  }
  stepCrumbleTiles(world);
  // Crumbled or vanished ground (13b): an Idle player whose block is gone falls (mid-action players are checked when
  // they finish).
  if (world.removed.size || world.level.vanish.size) for (const p of order) if (p.action === Action.Idle) startFall(world, p, tick);

  const intents = order.filter((p) => p.action === Action.Idle).map((p) => ({ p, cmds: commands(world, p) }));
  resolveMoves(world, intents, arrived, events);
  // A knock-slide on ice that couldn't go on (blocked): the stagger it owes starts now.
  for (const p of order) if (p.staggerOwed && p.action === Action.Idle) stun(p, tick, false);
  for (const p of hopLandings) if (p.action === Action.Hop && p.endTick === tick) landHop(world, p, events);

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
const HELPLESS: ReadonlySet<Action> = new Set([Action.Knocked, Action.Stunned, Action.Charge]);
/** On the ground in place: rising spikes get these (§18). */
const STANDING: ReadonlySet<Action> = new Set([Action.Idle, Action.Turn, Action.Stunned, Action.Strike, Action.Charge]);
/** Actions that land a ball on a new tile: fire counts these (§18). A hop, turn or stun in place doesn't. */
/**
 * Balls moving along the ground to a new cell (§20 movers). A climb stays in its cell (nothing to enter), jumps and
 * hops are in the air, and a boost flight is a jump.
 */
const MOVERS: ReadonlySet<Action> = new Set([Action.Roll, Action.Flip, Action.Knocked]);
const LANDINGS: ReadonlySet<Action> = new Set([Action.Roll, Action.Flip, Action.Climb, Action.Jump, Action.Fall, Action.Knocked, Action.Rebound]);

/** `v` is on the ground in, or rolling through, hopper `p`'s cell (its pose or its target is there). Not in the air. */
const under = (p: PlayerState, v: PlayerState): boolean =>
  v !== p && v.action !== Action.Dead && !AIRBORNE.has(v.action) && (eq(v.pose.cell, p.pose.cell) || eq(v.to.cell, p.pose.cell));

/**
 * A Charge tick ends (phase 14c; a teleporter's hold too, 13b): retry the launch this tick, or after BOOST_HOLD_TICKS
 * release the ball as on a plain tile. The pad then stays quiet (boostSpent) until the ball leaves it; a stagger owed
 * by a knock starts now.
 */
function endCharge(world: World, p: PlayerState, events: SimEvent[]): void {
  p.action = Action.Idle;
  p.to = p.pose;
  const teleport = faceTileAt(world, p.pose)?.type === 'teleport';
  if (world.tick - p.boostHold < BOOST_HOLD_TICKS) { p.forced = teleport ? 'teleport' : 'boost'; return; }
  p.boostHold = -1;
  p.boostSpent = tileKey(p.pose.cell, p.pose.up);
  events.push(teleport ? { type: 'teleport', playerId: p.id, result: 'released' } : { type: 'boost', playerId: p.id, result: 'released' });
  if (p.staggerOwed) stun(p, world.tick, false);
}

/**
 * A hop lands on a cell with another ball in it (§14 roll under), after this tick's moves so a ball that rolls on
 * counts as passing. One standing there (not leaving) is stomped like a fall landing (§16); one that can't be stomped
 * (staggered, protected), or balls only passing through, keep the hopper up: it hops again at once. With push rules
 * off it just lands (the MVP overlap).
 */
function landHop(world: World, p: PlayerState, events: SimEvent[]): void {
  const near = world.players.filter((v) => under(p, v));
  const standing = near.find((v) => eq(v.pose.cell, p.pose.cell) && eq(v.to.cell, p.pose.cell));
  if (standing ? world.rules.push && !isPushable(standing, world.tick) : near.length) {
    startAction(p, { action: Action.Hop, to: p.pose, ticks: JUMP_TICKS }, world.tick);
    return;
  }
  finishAction(world, p, events);
  if (standing && world.rules.push && p.action === Action.Idle) fallStomp(world, p, events);
}

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
 * The latch is cleared at every decision. A forced move (ice slide, boost launch, §18) replaces the input: pulses
 * pressed during it are dropped, held keys carry on. On ice a jump always goes forward (Kula rule).
 */
function commands(world: World, p: PlayerState): Cmd[] {
  if (p.forced) {
    const cmd = p.forced;
    p.forced = null;
    p.pulse = null;
    p.fwdLatch = false;
    return [cmd];
  }
  if (p.pulse && p.pulseAge > INPUT_BUFFER_TICKS) p.pulse = null;
  const cmds: Cmd[] = [];
  const ice = (p.pulse === 'jump' || p.jumpHeld) && onIce(world, p.pose);
  if (p.pulse === 'jump' || p.fwdLatch) cmds.push(...jumpCmds(p.fwdHeld || p.fwdLatch || ice));
  if (p.pulse === 'left' || p.pulse === 'right') cmds.push(p.pulse);
  if (p.jumpHeld) cmds.push(...jumpCmds(p.fwdHeld || ice));
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
 * A mutual push where either ball `arrived` (was already moving) is a head-on (§20): both are knocked back.
 * Moving collisions with balls mid-move are found in tryCmds (stages 1 and 4).
 */
function resolveMoves(world: World, intents: Intent[], arrived: Set<PlayerState>, events: SimEvent[]): void {
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
  const act = ({ p, cmds }: Intent) => { done.add(p); tryCmds(world, p, cmds, res, events); };

  for (const it of intents) if (targeted.has(it.p) && plans.has(it.p) && plans.get(it.p)!.action !== Action.Turn) act(it);

  for (const [p, v] of victimOf) {
    if (victimOf.get(v) !== p || done.has(p)) continue;
    for (const q of [p, v]) { done.add(q); spendPulse(intents, q); }
    if (arrived.has(p) || arrived.has(v)) headOn(world, p, v, res, events);
    else {
      // Heavy (§21): an attacker bounces off a heavy ball; the heavy one just stands (two heavy balls both bounce).
      const heavy = [p, v].filter((q) => hasEffect(q, 'heavy'));
      for (const q of [p, v]) if (heavy.length !== 1 || heavy[0] !== q) { stun(q, world.tick, true); events.push({ type: 'bounce', playerId: q.id }); }
    }
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
    const plan = previewAction(world, p, cmd, res);
    // A bouncy ball's forward move is a jump (§21): it goes over or onto whoever is ahead, never a roll push.
    if (cmd === 'fwd' && plan?.action !== Action.Jump && world.rules.push && fwdAllowed(world, p.pose)) {
      const A = add(p.pose.cell, dirVec(p.pose.fwd));
      // A high hopper isn't a victim: the roll goes under it (§14). Two balls in A (one under a landing hop) block.
      const inA = world.players.filter((v) => v !== p && v.action !== Action.Dead && v.pose.up === p.pose.up && eq(v.pose.cell, A) && !airHop(v, world.tick));
      if (inA.length === 1) return { victim: inA[0] };
      const T = flipTarget(world, p, res);
      const onT = T && world.players.find((v) => v !== p && v.action !== Action.Dead && v.pose.up === p.pose.fwd && eq(v.pose.cell, T) && !airHop(v, world.tick));
      if (onT) return { victim: onT, edge: true };
    }
    if (plan) return plan;
  }
  return null;
}

/** Starts the first command that isn't blocked. A pulse is spent when tried, even if blocked. */
function tryCmds(world: World, p: PlayerState, cmds: Cmd[], res: Reservations, events: SimEvent[]): void {
  for (const cmd of cmds) {
    if (cmd !== 'fwd' && cmd !== 'boost' && cmd !== 'teleport') p.pulse = null;
    if (cmd === 'fwd' && world.rules.push && movingHit(world, p, res, events)) return;
    const plan = previewAction(world, p, cmd, res);
    if (!plan) continue;
    const resting = p.endTick < world.tick; // Idle for at least a tick, not chaining from a finished action
    const facing = p.pose.fwd;
    startAction(p, plan, world.tick);
    p.graceUntil = plan.action === Action.Roll && resting ? world.tick + JUMP_GRACE_TICKS : -1;
    if (cmd === 'boost') {
      // The launch goes along the pad's dir: the ball spins to face it in the air (the mid-air turn record).
      if (plan.to.fwd !== facing) { p.turnFromFwd = facing; p.turnStartTick = world.tick; }
      p.boostHold = -1;
      events.push({ type: 'boost', playerId: p.id, result: 'launch' });
    }
    if (cmd === 'teleport') {
      p.boostHold = -1;
      events.push({ type: 'teleport', playerId: p.id, result: 'go' });
    }
    reserve(res, p);
    return;
  }
  // A blocked launch (phase 14c) or teleport (13b): hold on the pad (Charge) and retry next tick, up to BOOST_HOLD_TICKS.
  if (cmds.length === 1 && (cmds[0] === 'boost' || cmds[0] === 'teleport')) {
    if (p.boostHold < 0) {
      p.boostHold = world.tick;
      events.push(cmds[0] === 'boost' ? { type: 'boost', playerId: p.id, result: 'held', ...boostBlock(world, p, res) } : { type: 'teleport', playerId: p.id, result: 'held' });
    }
    startAction(p, { action: Action.Charge, to: p.pose, ticks: 1 }, world.tick);
    reserve(res, p);
  }
}

/** A mover's direction at its from-cell (§20): a roll's or knock's step, else its facing (a flip's, or an Idle ball's). */
const motionFrom = (v: PlayerState): Dir =>
  v.action === Action.Roll || v.action === Action.Knocked ? stepDir(sub(v.to.cell, v.pose.cell)) : v.pose.fwd;
/** The direction of a straight move of any length (a heavy push knocks 2 cells, §21). */
const stepDir = (v: Vec3): Dir => dirFromVec({ x: Math.sign(v.x), y: Math.sign(v.y), z: Math.sign(v.z) });
/** A mover's direction arriving at its target (§20 dV): a flip's is its facing on the new face. */
const motionTo = (v: PlayerState): Dir => (v.action === Action.Flip ? v.to.fwd : motionFrom(v));

function unreserve(res: Reservations, p: PlayerState): void {
  for (const [k, id] of res) if (id === p.id) res.delete(k);
}

/**
 * Moving collisions (§20, phase 14d): P's forward move targets X, which a mover V on the same face is entering.
 * Returns true when the collision took P's decision (a hit or a bounce); false leaves P to the normal (blocked) rules:
 * rear-end, a staggered or protected V, or no V entering X. (V *leaving* X is a dodge: X stays reserved, P waits.)
 * - Head-on (dV = -dM), or a start into X on the same tick as V (not a knock): both bounce back (headOn).
 * - Side hit (V started earlier): V arrives at X and is Knocked on to X + dM, P enters X. X + dM blocked: P bounces.
 */
function movingHit(world: World, p: PlayerState, res: Reservations, events: SimEvent[]): boolean {
  const tick = world.tick;
  const A = add(p.pose.cell, dirVec(p.pose.fwd)), T = sub(A, dirVec(p.pose.up)); // a roll's or a flip's target
  for (const v of world.players) {
    if (v === p || !MOVERS.has(v.action) || (!eq(v.to.cell, A) && !eq(v.to.cell, T))) continue;
    const plan = previewAction(world, p, 'fwd', new Map([...res].filter(([, id]) => id !== v.id)));
    if (!plan || plan.action === Action.Climb || !eq(plan.to.cell, v.to.cell) || plan.to.up !== v.to.up) continue;
    const dM = plan.to.fwd, dV = motionTo(v);
    if (dV === dM || tick < v.protectedUntil) return false;
    if (dV === opposite(dM) || (v.startTick === tick && v.action !== Action.Knocked)) {
      headOn(world, p, v, res, events);
      return true;
    }
    if (v.action === Action.Knocked || v.staggerOwed) return false; // staggered: can't be hit again until it recovers
    const dest = add(v.to.cell, dirVec(dM));
    unreserve(res, v);
    if (hasEffect(v, 'heavy') || !isFree(world, res, v.id, dest)) { // a heavy ball can't be side-hit (§21)
      reserve(res, v);
      stun(p, tick, true);
      events.push({ type: 'bounce', playerId: p.id });
      return true;
    }
    v.pose = { ...v.to };
    knock(v, dest, p.id, tick);
    startAction(p, plan, tick);
    if (p.protectedUntil > tick) p.protectedUntil = tick;
    reserve(res, v);
    reserve(res, p);
    events.push({ type: 'push', pusherId: p.id, victimId: v.id, moving: 'side' });
    return true;
  }
  return false;
}

/**
 * Head-on (§20): P and V each bounce back opposite their own motion (P's facing; V's from its from-cell), Knocked one
 * cell if it's free (bounce-stunned after), else bounce-stunned in place. A knocked V whose from-cell was taken (its
 * pusher is rolling in) keeps its knock and bounce-stuns where it lands.
 */
function headOn(world: World, p: PlayerState, v: PlayerState, res: Reservations, events: SimEvent[]): void {
  // Heavy (§21): against a heavy ball only the other one bounces back. The heavy one carries on (a heavy P just
  // doesn't start its move this tick); two heavy balls both bounce.
  const hp = hasEffect(p, 'heavy'), hv = hasEffect(v, 'heavy');
  // The reservation map keeps one owner per cell, so ask the players who else holds V's from-cell.
  const taken = world.players.some((q) => q !== v && !airHop(q, world.tick) && occupiedCells(q).some((c) => eq(c, v.pose.cell)));
  if (hv && !hp) reserve(res, v);
  else if (!taken) recoil(world, v, motionFrom(v), p.id, res, events);
  else {
    v.bounce = true;
    reserve(res, v);
    events.push({ type: 'bounce', playerId: v.id });
  }
  if (!hp || hv) recoil(world, p, p.pose.fwd, v.id, res, events);
  events.push({ type: 'push', pusherId: p.id, victimId: v.id, moving: 'headon' });
}

/** Q's move (if any) is cancelled; it's knocked back from its cell against `d`, or bounce-stunned in place. */
function recoil(world: World, q: PlayerState, d: Dir, byId: string, res: Reservations, events: SimEvent[]): void {
  const back = sub(q.pose.cell, dirVec(d));
  unreserve(res, q);
  q.to = q.pose;
  if (isFree(world, res, q.id, back)) {
    knock(q, back, byId, world.tick);
    q.bounce = true; // bounce-stunned when the knock ends (not the stagger)
  } else stun(q, world.tick, true);
  reserve(res, q);
  events.push({ type: 'bounce', playerId: q.id });
}

/** A pusher tried every command before its roll, so any buffered pulse was spent. */
function spendPulse(intents: Intent[], p: PlayerState): void {
  if (intents.find((it) => it.p === p)!.cmds.some((c) => c !== 'fwd')) p.pulse = null;
}

function stun(p: PlayerState, tick: number, bounce: boolean): void {
  startAction(p, { action: Action.Stunned, to: p.pose, ticks: STUN_TICKS }, tick);
  p.bounce = bounce;
  p.staggerOwed = false;
}

/**
 * V1 and the balls lined up behind it along P's fwd on P's face, each in the next cell (at most CHAIN_MAX). A high
 * hopper ends the line: it's in the air, so the last ball is knocked under it (§14).
 */
function chainLine(world: World, p: PlayerState, v: PlayerState): PlayerState[] {
  const F = dirVec(p.pose.fwd), line = [v], max = world.rules.chain === false ? 1 : CHAIN_MAX;
  for (let cell = add(v.pose.cell, F); line.length < max; cell = add(cell, F)) {
    const next = world.players.find((q) => q !== p && q.action !== Action.Dead && q.pose.up === p.pose.up && eq(q.pose.cell, cell) && !airHop(q, world.tick));
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
  // A victim that isn't pushable blocks P, except a heavy one (§21): P bounces off it, as off a wall behind it.
  if (cradle ? !line.slice(0, -1).every((q) => transmits(q, tick)) : !pushableState(v, tick)) return null;
  if (!isPushable(last, tick) || !isFree(world, res, last.id, dest)) {
    stun(p, tick, true);
    events.push({ type: 'bounce', playerId: p.id });
    return null;
  }
  // A heavy pusher (§21) knocks the ball 2 cells, or 1 when the next one is blocked or has no ground (it drops there).
  const far = add(dest, F);
  const two = hasEffect(p, 'heavy') && isSolid(world, sub(dest, dirVec(p.pose.up))) && isFree(world, res, last.id, far);
  knock(last, two ? far : dest, p.id, tick, two ? 2 * KNOCK_TICKS : KNOCK_TICKS);
  if (cradle) startAction(p, { action: Action.Strike, to: p.pose, ticks: ownTicks(p, STRIKE_TICKS) }, tick);
  else startAction(p, { action: Action.Roll, to: { ...p.pose, cell: v.pose.cell }, ticks: ownTicks(p, ROLL_TICKS) }, tick);
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
  if (!pushableState(v, tick)) return null;
  if (!isPushable(v, tick) || !isFree(world, res, v.id, dest)) { // a heavy V (§21) bounces the flipper too
    stun(p, tick, true);
    events.push({ type: 'bounce', playerId: p.id });
    return null;
  }
  knock(v, dest, p.id, tick);
  startAction(p, { action: Action.Flip, to: { cell: v.pose.cell, up: p.pose.fwd, fwd: D }, ticks: ownTicks(p, FLIP_TICKS) }, tick);
  if (p.protectedUntil > tick) p.protectedUntil = tick;
  reserve(res, v);
  reserve(res, p);
  events.push({ type: 'push', pusherId: p.id, victimId: v.id, edge: true });
  return v;
}

/** A death (off the map, burnt, a trap): Dead for RESPAWN_TICKS, key drop and knockout credit, a life in knockout. */
function die(world: World, p: PlayerState, events: SimEvent[], cause: DeathCause): void {
  p.action = Action.Dead;
  p.to = p.pose;
  p.startTick = world.tick;
  p.endTick = world.tick + RESPAWN_TICKS;
  p.heat = 0;
  p.fireCount = 0;
  p.forced = null;
  p.staggerOwed = false;
  p.boostHold = -1;
  p.effects = []; // death clears every pill (§21)
  events.push({ type: 'death', playerId: p.id, cell: p.pose.cell, cause });
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
    die(world, p, events, 'burn');
  }
  if (world.tick % 2 === 0) {
    for (const [key, heat] of hot) if (!occupied.has(key)) { if (heat > 1) hot.set(key, heat - 1); else hot.delete(key); }
  }
}

/**
 * Crumble tiles (§18): a ball whose action takes it off a crumble block (to another block, or into the air) starts
 * its CRUMBLE_DELAY_TICKS countdown. A block already counting down keeps its time.
 */
function leaveTile(world: World, from: Pose, to: Pose): void {
  const block = cellKey(sub(from.cell, dirVec(from.up)));
  if (block === cellKey(sub(to.cell, dirVec(to.up))) || world.crumbling.has(block)) return;
  if (world.level.blockTiles.get(block)?.type === 'crumble') world.crumbling.set(block, world.tick + CRUMBLE_DELAY_TICKS);
}

/**
 * Crumble tiles due this tick vanish (the `removed` overlay; balls on them fall), and gone ones regrow after the
 * tile's regrow time once no ball occupies the block's cell. A block a knockout band took stays gone.
 */
function stepCrumbleTiles(world: World): void {
  if (!world.crumbling.size) return;
  let taken: Set<string> | null = null;
  for (const [key, at] of world.crumbling) {
    if (world.tick < at) continue;
    if (!world.removed.has(key)) { world.removed.add(key); continue; }
    if (world.tick < at + world.level.blockTiles.get(key)!.regrowTicks) continue;
    taken ??= new Set(world.players.flatMap((p) => occupiedCells(p).map(cellKey))); // high hoppers too
    if (taken.has(key) || bandRemoved(world, key)) continue;
    world.removed.delete(key);
    world.crumbling.delete(key);
  }
}

const bandRemoved = (world: World, key: string): boolean =>
  !!world.knockout && world.knockout.bands.slice(0, world.knockout.next).some((b) => b.includes(key));

/**
 * V is knocked to `dest` by `byId` (push or stomp; one cell, or two by a heavy ball's push, §21): it cancels a Turn
 * (keeping its start facing) or a Hop.
 */
function knock(v: PlayerState, dest: Vec3, byId: string, tick: number, ticks = KNOCK_TICKS): void {
  const fwd = v.action === Action.Turn ? v.pose.fwd : v.to.fwd;
  v.pose = { ...v.pose, fwd };
  startAction(v, { action: Action.Knocked, to: { cell: dest, up: v.pose.up, fwd }, ticks }, tick);
  v.bounce = false;
  v.boostHold = -1; // shoved off its pad mid-Charge
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
  const finished = p.action, bounced = p.bounce;
  if (finished === Action.Charge) { endCharge(world, p, events); return; }
  if (finished === Action.Jump && p.stompBump && landStomp(world, p, events)) return;
  const moved = sub(p.to.cell, p.pose.cell);
  // Lasers (13b): finishing in, or having passed through, an active beam cell. A teleport only arrives.
  const zapped = beamHit(world, finished === Action.Teleport ? [p.to.cell] : pathCells(p.pose, p.to.cell));
  leaveTile(world, p.pose, p.to);
  p.pose = p.to;
  p.action = Action.Idle;
  p.bounce = false;
  p.jumpOver = false;
  p.stompBump = null;
  if (p.boostSpent && p.boostSpent !== tileKey(p.pose.cell, p.pose.up)) p.boostSpent = null; // left the spent pad
  if (zapped) {
    p.pose = { ...p.pose, cell: zapped };
    die(world, p, events, 'laser');
    return;
  }
  if (finished === Action.Fall && outOfBounds(world.level, p.pose.cell)) {
    die(world, p, events, 'fall');
    return;
  }
  // Nothing below: a jump or knock into air, a fall step, or ground that crumbled during the action.
  if (startFall(world, p, tick)) return;
  if (spiked(world, p.pose)) { die(world, p, events, 'spikes'); return; }
  if (LANDINGS.has(finished)) {
    if (blockTileAt(world, p.pose)?.type !== 'fire') p.fireCount = 0;
    else if (++p.fireCount >= FIRE_MAX) { die(world, p, events, 'fire'); return; }
  }
  if (finished === Action.Fall && world.rules.push) fallStomp(world, p, events);
  if (finished === Action.Turn || finished === Action.Stunned || finished === Action.Strike) return;
  pressSwitch(world, p, events);
  p.forced = forcedAfter(world, p.pose, finished);
  if ((p.forced === 'boost' || p.forced === 'teleport') && p.boostSpent) p.forced = null; // gave up on this ball: a plain tile until it leaves
  if (finished === Action.Knocked && p.forced) {
    // Knocked onto ice or a pad (§18): it slides on in the knock direction, or launches; the stagger waits until the
    // slide stops or the launch lands.
    p.pose = { ...p.pose, fwd: stepDir(moved) };
    p.to = p.pose;
    p.staggerOwed = true;
  } else if (finished === Action.Knocked || (p.staggerOwed && !p.forced)) {
    stun(p, tick, finished === Action.Knocked && bounced); // stagger: not pushable (§14); a head-on's knock-back ends in a bounce-stun (§20)
  }
  collectPickup(world, p, events); // pills (§21): any finish in the cell, a knock too
  onLand(world, p, events);
}

/** A ball finishing a move (or a hop) on a switch toggles its laser group, at most once per SWITCH_COOLDOWN_TICKS (13b). */
function pressSwitch(world: World, p: PlayerState, events: SimEvent[]): void {
  const t = faceTileAt(world, p.pose);
  if (t?.type !== 'switch') return;
  const key = tileKey(p.pose.cell, p.pose.up);
  if (world.tick - (world.switchAt.get(key) ?? -Infinity) < SWITCH_COOLDOWN_TICKS) return;
  world.switchAt.set(key, world.tick);
  const on = !world.lasers.get(t.group);
  world.lasers.set(t.group, on);
  events.push({ type: 'laser', playerId: p.id, group: t.group, on });
}
