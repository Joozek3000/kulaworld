import { INPUT_BUFFER_TICKS, KNOCK_TICKS, RESPAWN_TICKS, ROLL_TICKS, SPAWN_PROTECT_TICKS, STUN_TICKS } from '../constants.ts';
import { dirVec } from '../dir.ts';
import { add, eq } from '../vec.ts';
import { previewAction, startAction, startFall, turnFwd, type Plan } from './actions.ts';
import { checkTimeout, onDeath, onLand } from './keyRace.ts';
import { loseLife, stepKnockout } from './knockout.ts';
import {
  Action, isFree, isPushable, outOfBounds, reservations, reserve, trySpawn,
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

  for (const p of order) if (p.action !== Action.Idle && p.endTick === tick && !p.eliminated) finishAction(world, p, events);
  // Crumbled ground: an Idle player whose block is gone falls (mid-action players are checked when they finish).
  if (world.removed.size) for (const p of order) if (p.action === Action.Idle) startFall(world, p, tick);

  const intents = order.filter((p) => p.action === Action.Idle).map((p) => ({ p, cmds: commands(p) }));
  resolveMoves(world, intents, events);

  if (world.mode === 'knockout') stepKnockout(world, events);
  else checkTimeout(world, events);
  return events;
}

const AIRBORNE: ReadonlySet<Action> = new Set([Action.Hop, Action.Jump, Action.Fall]);
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
 * Each player's intent is its first viable command, or a push when that is a roll into a same-face player.
 * Order: 1. targeted victims escaping (any move but a turn), 2. mutual pushes bounce, 3. other pushes, 4. the rest.
 * Within each stage players go in fair order; a later player sees earlier claims as reserved.
 * With push rules off there are no push intents, so only stage 4 runs: the MVP rules.
 */
function resolveMoves(world: World, intents: Intent[], events: SimEvent[]): void {
  const res = reservations(world);
  const victimOf = new Map<PlayerState, PlayerState>();
  const plans = new Map<PlayerState, Plan>();
  for (const { p, cmds } of intents) {
    const choice = choose(world, p, cmds, res);
    if (choice && 'victim' in choice) victimOf.set(p, choice.victim);
    else if (choice) plans.set(p, choice);
  }
  const targeted = new Set(victimOf.values());
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
    if (push(world, p, v, res, events)) done.add(v);
  }

  for (const it of intents) if (!done.has(it.p)) act(it);
}

/** The first command that would start, or the victim when that is a roll into a player on the same face. */
function choose(world: World, p: PlayerState, cmds: Cmd[], res: Reservations): Plan | { victim: PlayerState } | null {
  for (const cmd of cmds) {
    if (cmd === 'fwd' && world.rules.push) {
      const A = add(p.pose.cell, dirVec(p.pose.fwd));
      const victim = world.players.find((v) => v !== p && v.action !== Action.Dead && v.pose.up === p.pose.up && eq(v.pose.cell, A));
      if (victim) return { victim };
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
    startAction(p, plan, world.tick);
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

/**
 * P rolls into V's cell A. Not pushable: P is blocked (stays Idle, retries next tick). A + F solid or reserved:
 * P bounces (Stunned). Otherwise V is Knocked to A + F and P rolls into A. Returns true when V was knocked.
 */
function push(world: World, p: PlayerState, v: PlayerState, res: Reservations, events: SimEvent[]): boolean {
  const tick = world.tick;
  if (!isPushable(v, tick)) return false;
  const A = v.pose.cell, dest = add(A, dirVec(p.pose.fwd));
  if (!isFree(world, res, v.id, dest)) {
    stun(p, tick, true);
    events.push({ type: 'bounce', playerId: p.id });
    return false;
  }
  // Knocking cancels a Turn (keep its start facing) or a Hop (keep any mid-air turn).
  const fwd = v.action === Action.Turn ? v.pose.fwd : v.to.fwd;
  v.pose = { ...v.pose, fwd };
  startAction(v, { action: Action.Knocked, to: { cell: dest, up: v.pose.up, fwd }, ticks: KNOCK_TICKS }, tick);
  v.bounce = false;
  v.lastKnockedBy = p.id;
  v.lastKnockedTick = tick;
  startAction(p, { action: Action.Roll, to: { ...p.pose, cell: A }, ticks: ROLL_TICKS }, tick);
  if (p.protectedUntil > tick) p.protectedUntil = tick; // pushing ends your own spawn protection
  reserve(res, v);
  reserve(res, p);
  events.push({ type: 'push', pusherId: p.id, victimId: v.id });
  return true;
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
  p.pose = p.to;
  p.action = Action.Idle;
  p.bounce = false;
  if (finished === Action.Fall && outOfBounds(world.level, p.pose.cell)) {
    p.action = Action.Dead;
    p.startTick = tick;
    p.endTick = tick + RESPAWN_TICKS;
    events.push({ type: 'death', playerId: p.id, cell: p.pose.cell });
    const creditId = onDeath(world, p, events);
    if (world.mode === 'knockout') loseLife(world, p, creditId, events);
    return;
  }
  // Nothing below: a jump or knock into air, a fall step, or ground that crumbled during the action.
  if (startFall(world, p, tick)) return;
  if (finished === Action.Turn || finished === Action.Stunned) return;
  if (finished === Action.Knocked) stun(p, tick, false); // stagger: not pushable (§14)
  onLand(world, p, events);
}
