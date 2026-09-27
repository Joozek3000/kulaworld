import { FORCED_MAX, ROLL_TICKS } from '../constants.ts';
import { ALL_DIRS, dirName, dirVec, opposite, perpendicular, type Dir } from '../dir.ts';
import { previewAction, teleportTarget } from '../sim/actions.ts';
import { PLAN_FIRE_MAX, resultPose, type PathStep, type PlanPose } from '../sim/path.ts';
import { pickupCandidates, pickupSpotProblem, spotsNearSpawns, surfaceMove as move } from '../sim/pickups.ts';
import { beamAt, blockTileAt, faceTileAt, forcedAfter, lethalForPlanning, spikesUp } from '../sim/tiles.ts';
import { Action, createWorld, isSolid, outOfBounds, vanishOn, type Cmd, type Effect, type Reservations, type World } from '../sim/world.ts';
import { add, cellKey, sub, type Vec3 } from '../vec.ts';
import { LETHAL_TILES, MODIFIER_TILES, type Level, type Pose, type Tile, type TileType, type Vanish } from './types.ts';

/**
 * Trap placement rules (docs/LEVEL-DESIGN.md), checked by `npm run level:check`. Each finding has the rule number,
 * [E] error or [W] warning, and where: a tile as "block x,y,z face" or a spawn/key. A warning whose id
 * (`${rule} ${where}`) is in the level's `notes` is intentional and reported as noted.
 */
export interface RuleFinding { rule: string; error: boolean; where: string; msg: string; note?: string }
export const findingId = (f: Pick<RuleFinding, 'rule' | 'where'>): string => `${f.rule} ${f.where}`;

/** A place a ball stands: its (air) cell and up. The tile is the face `up` of block `cell − up`. */
interface Spot { cell: Vec3; up: Dir }
const spotKey = (s: Spot) => `${cellKey(s.cell)}|${s.up}`;
const at = (s: Spot) => `${cellKey(sub(s.cell, dirVec(s.up)))} ${dirName(s.up)}`;
const pose = (s: Spot, fwd: Dir = ALL_DIRS.find((d) => perpendicular(d, s.up))!): Pose => ({ cell: s.cell, up: s.up, fwd });
const sides = (up: Dir) => ALL_DIRS.filter((d) => perpendicular(d, up));
const standable = (w: World, s: Spot) => !isSolid(w, s.cell) && isSolid(w, sub(s.cell, dirVec(s.up)));

function spots(w: World): Spot[] {
  const out: Spot[] = [];
  for (const k of w.level.solid) {
    const [x, y, z] = k.split(',').map(Number);
    for (const up of ALL_DIRS) {
      const cell = add({ x, y, z }, dirVec(up));
      if (!isSolid(w, cell)) out.push({ cell, up });
    }
  }
  return out;
}

/** Tile types under a spot: its whole-block type and its face type. */
const types = (w: World, s: Spot): TileType[] =>
  [blockTileAt(w, pose(s))?.type, faceTileAt(w, pose(s))?.type].filter((t): t is TileType => !!t);
const tileLethal = (w: World, s: Spot) => faceTileAt(w, pose(s))?.type === 'spikes' || blockTileAt(w, pose(s))?.type === 'fire';
/** Lethal for the rules: planning-lethal tiles, and any laser beam cell, on or off (LEVEL-DESIGN 10.3). */
const lethal = (w: World, s: Spot) => lethalForPlanning(w, pose(s)) || w.level.beams.has(cellKey(s.cell));
const retracting = (w: World, s: Spot): Tile | null => {
  const t = faceTileAt(w, pose(s));
  return t?.type === 'spikes' && t.period ? t : null;
};

/** Fewest rolls/flips/climbs from `from` to every spot (up to `max`), not moving on past a lethal tile. */
function distances(w: World, from: Spot[], max: number): Map<string, { spot: Spot; d: number }> {
  const out = new Map(from.map((s) => [spotKey(s), { spot: s, d: 0 }]));
  let frontier = from;
  for (let d = 1; d <= max && frontier.length; d++) {
    const next: Spot[] = [];
    for (const s of frontier) {
      if (lethal(w, s)) continue;
      for (const dir of sides(s.up)) {
        const m = move(w, s, dir), k = spotKey(m);
        if (!out.has(k)) { out.set(k, { spot: m, d }); next.push(m); }
      }
    }
    frontier = next;
  }
  return out;
}

const MOVES: readonly Cmd[] = ['fwd', 'left', 'right', 'jump'];
/** A plan state with the laser groups' on/off bits (13b: switches are state edges). */
type Node = PlanPose & { mask: number };
const planKey = (p: Node) => `${cellKey(p.cell)}|${p.up}|${p.fwd}|${p.fire}|${p.mask}`;

/** Laser groups in level order, and their start states as a bit mask. */
const groupsOf = (level: Level) => [...new Set(level.lasers.map((l) => l.group))];
const startMask = (level: Level) => groupsOf(level).reduce((m, g, i) => (level.lasers.find((l) => l.group === g)!.on ? m | (1 << i) : m), 0);
function setMask(w: World, mask: number): void {
  groupsOf(w.level).forEach((g, i) => w.lasers.set(g, !!(mask & (1 << i))));
}

/**
 * Every plan state reachable from `starts` with the bots' moves (lethal outcomes excluded, `fireMax` fire landings
 * in a row), and the reverse edges between them. Standing on a switch toggles its group (both ways: a hop presses
 * it again), unless that switches a beam on through the ball's own cell. `masks` are the group states to start with.
 */
function explore(w: World, starts: Pose[], fireMax: number, res: Reservations = new Map(), masks = [startMask(w.level)]) {
  const nodes = new Map<string, Node>(), back = new Map<string, string[]>();
  const groups = groupsOf(w.level);
  let frontier: Node[] = [];
  const edge = (from: string | null, to: Node) => {
    const k = planKey(to);
    if (from !== null) { if (!back.has(k)) back.set(k, []); back.get(k)!.push(from); }
    if (!nodes.has(k)) { nodes.set(k, to); frontier.push(to); }
  };
  for (const s of starts) for (const mask of masks) {
    setMask(w, mask);
    if (!beamAt(w, s.cell)) edge(null, { ...s, fire: 0, mask }); // a ball in a beam as it comes on is dead, not stuck
  }
  while (frontier.length) {
    const cur = frontier;
    frontier = [];
    for (const p of cur) {
      const from = planKey(p);
      setMask(w, p.mask);
      const sw = faceTileAt(w, p);
      if (sw?.type === 'switch') {
        const flipped = { ...p, mask: p.mask ^ (1 << groups.indexOf(sw.group)) };
        setMask(w, flipped.mask);
        if (!beamAt(w, p.cell)) edge(from, flipped);
        setMask(w, p.mask);
      }
      for (const cmd of MOVES) {
        const to = resultPose(w, p, cmd, res, p.fire, fireMax);
        if (to) edge(from, { ...to, mask: p.mask });
      }
    }
  }
  return { nodes, back };
}

/**
 * Bots (phase 15a): the fewest moves from `from` to any cell in `goals`, searching (pose, laser group states) like
 * `explore`, so a path may press a switch to open a beam on the way. As in the sim, a move that finishes on a switch
 * toggles its group (unless that turns a beam on through the ball: never planned). Turns don't press. The world's
 * laser states are restored after the search. Returns [] if already there, or null if unreachable.
 */
export function findPathLasers(
  w: World, from: Pose, goals: ReadonlySet<string>, res: Reservations = new Map(), fire = 0, effects?: readonly Effect[],
): PathStep[] | null {
  if (goals.has(cellKey(from.cell))) return [];
  const groups = groupsOf(w.level), saved = new Map(w.lasers);
  const start: Node = { ...from, fire, mask: groups.reduce((m, g, i) => (w.lasers.get(g) ? m | (1 << i) : m), 0) };
  const parent = new Map<string, { prev: string; step: PathStep } | null>([[planKey(start), null]]);
  try {
    for (let frontier = [start]; frontier.length;) {
      const next: Node[] = [];
      for (const p of frontier) {
        for (const cmd of MOVES) {
          setMask(w, p.mask);
          const to = resultPose(w, p, cmd, res, p.fire, PLAN_FIRE_MAX, effects);
          if (!to) continue;
          let mask = p.mask;
          const sw = cmd === 'left' || cmd === 'right' ? undefined : faceTileAt(w, to);
          if (sw?.type === 'switch') {
            setMask(w, (mask ^= 1 << groups.indexOf(sw.group)));
            if (beamAt(w, to.cell)) continue;
          }
          const node: Node = { ...to, mask }, k = planKey(node);
          if (parent.has(k)) continue;
          parent.set(k, { prev: planKey(p), step: { cmd, to } });
          if (goals.has(cellKey(to.cell))) {
            const path: PathStep[] = [];
            for (let e = parent.get(k); e; e = parent.get(e.prev)) path.push(e.step);
            return path.reverse();
          }
          next.push(node);
        }
      }
      frontier = next;
    }
    return null;
  } finally {
    for (const [g, on] of saved) w.lasers.set(g, on);
  }
}

/** Cells reachable from `start` with lethal tiles (fire too) as walls: the plain safe BFS of rule 2.2 (switches allowed). */
const safeCells = (w: World, start: Pose, res?: Reservations) =>
  new Set([...explore(w, [start], 0, res).nodes.values()].map((p) => cellKey(p.cell)));

/** Follows a forced chain (ice slides, boost launches) from `p`. Why it stops, and the trap tiles that forced it. */
function trace(w: World, p: Pose, cmd: Cmd): { why: 'ok' | 'lethal' | 'void' | 'loop'; sources: Tile[] } {
  const sources: Tile[] = [];
  let from = p, next: Cmd | null = cmd;
  for (let i = 0; next; i++) {
    if (i > FORCED_MAX) return { why: 'loop', sources };
    const src = next === 'boost' ? faceTileAt(w, from) : blockTileAt(w, from);
    if (src) sources.push(src);
    const plan = previewAction(w, { id: '', pose: from }, next);
    if (!plan) return { why: 'ok', sources };
    let to = plan.to;
    if (plan.action === Action.Jump) {
      const down = dirVec(to.up);
      while (!isSolid(w, sub(to.cell, down))) {
        to = { ...to, cell: sub(to.cell, down) };
        if (outOfBounds(w.level, to.cell)) return { why: 'void', sources };
      }
    }
    if (lethalForPlanning(w, to)) return { why: 'lethal', sources };
    next = forcedAfter(w, to, plan.action);
    from = to;
  }
  return { why: 'ok', sources };
}

/** Straight runs of rolls along +X/+Y/+Z on each face: the lanes of rules 4.2, 4.3, 5.3. */
function lanes(w: World, all: Spot[]): Spot[][] {
  const out: Spot[][] = [];
  const set = new Set(all.map(spotKey));
  for (const s of all) {
    for (const d of sides(s.up)) {
      if (d & 1) continue; // each axis once, walking +
      const prev = { cell: sub(s.cell, dirVec(d)), up: s.up };
      if (set.has(spotKey(prev)) && move(w, prev, d).kind === 'roll') continue; // not the start of a run
      const run = [s];
      for (let c = s; move(w, c, d).kind === 'roll'; c = { cell: add(c.cell, dirVec(d)), up: s.up }) run.push({ cell: add(c.cell, dirVec(d)), up: s.up });
      if (run.length > 1) out.push(run);
    }
  }
  return out;
}

/**
 * Rule 4.2: can a ball at walking speed get along `lane` (in order) past its retracting spikes? It arrives on the
 * first tile at any tick, rolls one tile per ROLL_TICKS, may wait on tiles without spikes, and dies arriving on
 * raised spikes. Exported for the tests.
 */
export function lanePassable(lane: (Tile | null)[]): boolean {
  const L = lane.reduce((l, t) => (t ? lcm(l, t.period) : l), 1);
  return passable(lane.length, L, (i, t) => !lane[i] || !spikesUp(lane[i]!, t), (i) => !lane[i]);
}

/**
 * Rule 10.7: the same walk along a lane of vanishing blocks (null = a plain tile): a ball arrives on a tile only while
 * its block is there, and waits on one only while it stays there.
 */
export function vanishLanePassable(lane: (Vanish | null)[]): boolean {
  const L = lane.reduce((l, v) => (v ? lcm(l, v.period) : l), 1);
  const on = (i: number, t: number) => !lane[i] || vanishOn(lane[i]!, t);
  return passable(lane.length, L, on, (i, t) => on(i, t + 1));
}

/** BFS over (tile, tick mod L): arrive(i, t) may a ball arrive on tile i at t; wait(i, t) may it stay from t to t + 1. */
function passable(n: number, L: number, arrive: (i: number, t: number) => boolean, wait: (i: number, t: number) => boolean): boolean {
  const seen = new Set<number>();
  let frontier: number[] = [];
  for (let t = 0; t < L; t++) if (arrive(0, t)) frontier.push(t);
  for (const t of frontier) seen.add(t);
  while (frontier.length) {
    const next: number[] = [];
    for (const s of frontier) {
      const i = Math.floor(s / L), t = s % L;
      if (i === n - 1) return true;
      const go = (j: number, u: number) => { const k = j * L + (u % L); if (!seen.has(k)) { seen.add(k); next.push(k); } };
      if (wait(i, t)) go(i, t + 1); // wait
      if (arrive(i + 1, t + ROLL_TICKS)) go(i + 1, t + ROLL_TICKS);
    }
    frontier = next;
  }
  return false;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;

/** Checks every LEVEL-DESIGN rule. Rule 7.3 (2–5 trap types) applies to pool levels only. */
export function checkTrapRules(level: Level): RuleFinding[] {
  // Vanishing blocks count as there for the geometry (13b); rule 10.7 checks they can be crossed.
  const geo: Level = level.vanish.size ? { ...level, vanish: new Map() } : level;
  const w = createWorld(geo, 0);
  const out: RuleFinding[] = [];
  const seen = new Set<string>();
  const add1 = (rule: string, error: boolean, where: string, msg: string) => {
    const id = findingId({ rule, where });
    if (seen.has(id) || (error && level.lab)) return; // lab levels are exempt from [E] rules (LEVEL-DESIGN §10)
    seen.add(id);
    out.push({ rule, error, where, msg, note: error ? undefined : level.notes[id] });
  };
  const all = spots(w);
  const race = level.mode === 'race';
  const spawnSpots: Spot[] = level.spawns.map((s) => ({ cell: s.cell, up: s.up }));

  // 1. Spawns are safe.
  level.spawns.forEach((s, i) => {
    const t = types(w, s);
    if (t.length) add1('1.1', true, `spawn ${i}`, `${t.join('+')} on a spawn tile`);
    const exits = sides(s.up).filter((d) => { const m = move(w, s, d); return m.kind !== 'climb' && !lethal(w, m); });
    if (exits.length < 2) add1('1.3', false, `spawn ${i}`, `only ${exits.length} exit direction(s)`);
  });
  const beam = (s: Spot) => level.beams.has(cellKey(s.cell));
  const vanishing = (s: Spot) => level.vanish.has(cellKey(sub(s.cell, dirVec(s.up))));
  for (const { spot, d } of distances(w, spawnSpots, 3).values()) {
    const t = types(w, spot);
    if (d <= 2) {
      if (t.some((x) => x !== 'arrow' && x !== 'teleport' && x !== 'switch')) add1('1.2', true, at(spot), `${t.join('+')} ${d} move(s) from a spawn`);
      if (beam(spot)) add1('1.2', true, at(spot), `a laser beam ${d} move(s) from a spawn`);
      if (t.includes('teleport')) add1('10.1', true, at(spot), `teleporter ${d} move(s) from a spawn`);
      if (t.includes('switch')) add1('10.5', true, at(spot), `switch ${d} move(s) from a spawn`);
      if (vanishing(spot)) add1('10.7', true, at(spot), `vanishing block ${d} move(s) from a spawn`);
    } else if (t.includes('boost')) add1('6.2', true, at(spot), `boost ${d} moves from a spawn`);
  }

  // 2. Keys, exit and goals.
  const goals = race ? [...level.keys.map((k, i) => ({ what: `key ${i}`, p: k })), ...(level.exit ? [{ what: 'exit', p: level.exit }] : [])] : [];
  for (const g of goals) {
    const t = types(w, g.p);
    if (t.length) add1('2.1', true, g.what, `${t.join('+')} on the ${g.what} tile`);
    if (!sides(g.p.up).some((d) => { const m = move(w, g.p, d); return !types(w, m).length; })) add1('2.3', false, g.what, 'no trap-free approach');
  }
  const reach = level.spawns.map((s) => safeCells(w, s));
  level.spawns.forEach((s, i) => {
    for (const g of goals) if (!reach[i].has(cellKey(g.p.cell))) add1('2.2', true, `${g.what} from spawn ${i}`, 'no route with lethal tiles as walls');
  });

  // 3. Readability; 6. ice and boosts (forced moves).
  const deathtraps = level.tiles.filter((t) => t.deathtrap);
  for (const s of all) {
    if (lethal(w, s)) continue;
    for (const d of sides(s.up)) {
      const m = move(w, s, d);
      if (m.kind === 'flip' && lethal(w, m)) add1('3.1', true, at(m), `${types(w, m).join('+')} on a flip landing tile`);
      if (m.kind === 'climb' && lethal(w, m)) add1('3.2', true, at(m), `${types(w, m).join('+')} on the first tile up a wall`);
      const plan = previewAction(w, { id: '', pose: pose(s, d) }, 'fwd');
      const forced = plan && forcedAfter(w, plan.to, plan.action);
      if (!plan || !forced) continue;
      const { why, sources } = trace(w, plan.to, forced);
      const where = `${at(plan.to)} entered ${dirName(plan.to.fwd)}`;
      if (why === 'loop') add1('6.1', true, where, 'an ice slide with no stopping tile (loops)');
      else if (why !== 'ok' && !sources.some((t) => t.deathtrap)) {
        add1(sources.some((t) => t.type === 'boost') ? '6.2' : '6.1', true, where, `the forced move ends ${why === 'void' ? 'in the void' : 'on a lethal tile'} (3.3; no deathtrap)`);
      }
    }
  }
  if (deathtraps.length > 1) add1('3.3', true, 'level', `${deathtraps.length} deathtrap tiles (at most 1)`);
  if (deathtraps.length && !race) add1('3.3', true, 'level', 'deathtrap in a knockout level');
  for (const t of deathtraps) {
    // Its tile as a wall: nobody may stand on it (a whole block: on any face).
    const res: Reservations = new Map((t.face === null ? ALL_DIRS : [t.face]).map((d) => [cellKey(add(t.block, dirVec(d))), 'x']));
    level.spawns.forEach((s, i) => {
      const r = safeCells(w, s, res);
      for (const g of goals) if (reach[i].has(cellKey(g.p.cell)) && !r.has(cellKey(g.p.cell))) add1('3.3', true, `${cellKey(t.block)} deathtrap`, `on the only route from spawn ${i} to the ${g.what}`);
    });
  }
  for (const s of all) {
    const t = retracting(w, s);
    if (!t) continue;
    for (const d of sides(s.up)) {
      const n1 = { cell: sub(s.cell, dirVec(d)), up: s.up };
      if (!standable(w, n1) || spotKey(move(w, n1, d)) !== spotKey(s)) continue;
      if (move(w, n1, opposite(d)).kind !== 'roll') add1('3.4', false, at(s), `approached along ${dirName(d)} from around a corner (not visible 2 tiles ahead)`);
    }
    // 4.1 timing.
    if (t.period < 30 || t.upTicks > 0.6 * t.period) add1('4.1', true, at(s), `period ${t.period} up ${t.upTicks}: needs period >= 30 and up <= 60 %`);
  }

  // 4.2, 4.3, 5.3: lanes.
  for (const lane of lanes(w, all)) {
    // 4.2: split at static spikes; each part with 2+ retracting spikes must be passable both ways.
    let part: Spot[] = [];
    const flush = () => {
      const idx = part.map((s, i) => (retracting(w, s) ? i : -1)).filter((i) => i >= 0);
      if (idx.length >= 2) {
        const seg = part.slice(Math.max(0, idx[0] - 1), idx[idx.length - 1] + 2).map((s) => retracting(w, s));
        if (!lanePassable(seg) || !lanePassable([...seg].reverse())) add1('4.2', true, at(part[idx[0]]), `a lane of ${idx.length} retracting spikes has no way through at walking speed`);
      }
      part = [];
    };
    for (const s of lane) {
      const f = faceTileAt(w, pose(s));
      if (f?.type === 'spikes' && !f.period) flush();
      else part.push(s);
    }
    flush();
    for (const [type, rule, max] of [['fire', '4.3', 2], ['crumble', '5.3', 4]] as const) {
      let n = 0;
      lane.forEach((s, i) => {
        n = blockTileAt(w, pose(s))?.type === type ? n + 1 : 0;
        if (n === max + 1) add1(rule, false, at(lane[i - max]), `${type}: more than ${max} in a row`);
      });
    }
  }

  // 5.1: no soft-locks. Every state reachable from a spawn can get back to a key, the exit or a spawn.
  const goalCells = new Set([...goals.map((g) => cellKey(g.p.cell)), ...level.spawns.map((s) => cellKey(s.cell))]);
  const { nodes, back } = explore(w, level.spawns, PLAN_FIRE_MAX);
  const ok = new Set([...nodes].filter(([, p]) => goalCells.has(cellKey(p.cell))).map(([k]) => k));
  for (let frontier = [...ok]; frontier.length;) {
    const next: string[] = [];
    for (const k of frontier) for (const b of back.get(k) ?? []) if (!ok.has(b)) { ok.add(b); next.push(b); }
    frontier = next;
  }
  for (const [k, p] of nodes) if (!ok.has(k)) add1('5.1', true, at(p), 'a soft-lock: no way back to a key, the exit or a spawn');

  // 5.2: crumble that never regrows (no regrowSec: single player) is never the only link to a key or the exit.
  const solid = level.tiles.filter((t) => t.type === 'crumble' && !t.regrows);
  if (race && solid.length) {
    const cut = createWorld(level, 0);
    for (const t of solid) cut.removed.add(cellKey(t.block));
    level.spawns.forEach((s, i) => {
      const r = safeCells(cut, s);
      for (const g of goals) if (reach[i].has(cellKey(g.p.cell)) && !r.has(cellKey(g.p.cell))) add1('5.2', true, `${g.what} from spawn ${i}`, 'only reachable over crumble that never regrows');
    });
  }

  // 6.3: ice arenas keep a non-ice rim.
  if (!race) for (const s of all) if (blockTileAt(w, pose(s))?.type === 'ice' && sides(s.up).some((d) => move(w, s, d).kind === 'flip')) add1('6.3', false, at(s), 'ice on the arena rim');

  // 7. Density and variety.
  const n = all.length;
  const nLethal = all.filter((s) => beam(s) || types(w, s).some((t) => LETHAL_TILES.includes(t))).length;
  if (nLethal > 0.1 * n) add1('7.1', true, 'level', `${nLethal} of ${n} standable tiles are lethal (max 10 %)`);
  const nMod = all.filter((s) => types(w, s).some((t) => MODIFIER_TILES.includes(t) && t !== level.theme)).length;
  if (nMod > 0.25 * n) add1('7.2', true, 'level', `${nMod} of ${n} standable tiles are modifiers${level.theme ? ` (theme ${level.theme} exempt)` : ''} (max 25 %)`);
  // Trap types: tile types, with lasers (and their switches) one type, and invisible and vanishing blocks (13b).
  const kinds = new Set<string>(level.tiles.map((t) => (t.type === 'switch' ? 'laser' : t.type)));
  if (level.lasers.length) kinds.add('laser');
  if (level.invisible.size) kinds.add('invisible');
  if (level.vanish.size) kinds.add('vanish');
  if (level.pool && (kinds.size < 2 || kinds.size > 5)) add1('7.3', true, 'level', `${kinds.size} trap types (pool levels use 2-5)`);
  const third = (a: number, lo: number, hi: number) => a > lo + (hi - lo) / 3 && a < hi - (hi - lo) / 3;
  for (const s of all) {
    if (!tileLethal(w, s)) continue; // laser beams count for rules 1, 2, 3 and 7.1 only (10.3)
    const b = sub(s.cell, dirVec(s.up));
    if (!race && third(b.x, level.min.x, level.max.x) && third(b.z, level.min.z, level.max.z)) add1('7.4', false, at(s), 'lethal tile in the central third');
    for (const d of sides(s.up)) {
      let c = s, plain = 0;
      for (; plain < 3; plain++) {
        const prev = { cell: sub(c.cell, dirVec(d)), up: s.up };
        if (!standable(w, prev) || spotKey(move(w, prev, d)) !== spotKey(c) || types(w, prev).length) break;
        c = prev;
      }
      if (plain === 3) add1('7.5', false, at(s), `lethal at the end of a push lane along ${dirName(d)}`);
    }
  }
  check13b(level, w, all, goals, reach, add1);
  check15a(level, w, goals, reach, add1);
  return out;
}

type Goal = { what: string; p: { cell: Vec3; up: Dir } };
type Add = (rule: string, error: boolean, where: string, msg: string) => void;

/** LEVEL-DESIGN §10 (phase 13b): teleporters, lasers and switches, invisible and vanishing blocks. */
function check13b(level: Level, w: World, all: Spot[], goals: Goal[], reach: Set<string>[], add1: Add): void {
  const tileAt = (t: Tile): Spot => ({ cell: add(t.block, dirVec(t.face!)), up: t.face! });
  const onGoal = (s: Spot) => goals.find((g) => spotKey(g.p) === spotKey(s));
  // 10.1 pairs (spawn distance is checked with rule 1.2), 10.2 arrivals, 10.5 switches on goals.
  const tps = level.tiles.filter((t) => t.type === 'teleport');
  for (const id of new Set(tps.map((t) => t.pair))) {
    const n = tps.filter((t) => t.pair === id).length;
    if (n !== 2) add1('10.1', true, `pair ${id}`, `${n} teleporter(s) (pairs are exactly 2)`);
  }
  for (const t of level.tiles) {
    if (t.type !== 'teleport' && t.type !== 'switch') continue;
    const s = tileAt(t), g = onGoal(s);
    if (g) add1(t.type === 'teleport' ? '10.1' : '10.5', true, at(s), `${t.type} on the ${g.what} tile`);
    if (t.type !== 'teleport') continue;
    for (const fwd of sides(s.up)) {
      const to = teleportTarget(w, pose(s, fwd));
      if (!to) continue;
      if (lethal(w, to)) add1('10.2', true, at(s), `arrives on a lethal tile (${at(to)})`);
      else if (!resultPose(w, to, 'fwd')) add1('10.2', true, `${at(s)} entered ${dirName(fwd)}`, `arrives facing ${dirName(to.fwd)} into a fall, a trap or a dead end (${at(to)})`);
    }
  }
  // 10.4: at most 3 groups, and no laser soft-lock: from every state the players can cause (any spot reachable from
  // a spawn, with any group states the switches allow), every key and the exit can still be reached, switches included.
  const groups = groupsOf(level);
  if (groups.length > 3) add1('10.4', true, 'level', `${groups.length} laser groups (max 3)`);
  if (groups.length && goals.length) {
    // Every spot a ball can reach, with every group state the switches allow (another player may flip them any time).
    const first = [...explore(w, level.spawns, 0).nodes.values()];
    const masks = [...new Set(first.map((n) => n.mask))];
    const spots = [...new Map(first.map((n) => [`${cellKey(n.cell)}|${n.up}|${n.fwd}`, { cell: n.cell, up: n.up, fwd: n.fwd }])).values()];
    const { nodes, back } = explore(w, spots, 0, new Map(), masks);
    for (const g of goals) {
      const ok = new Set([...nodes].filter(([, p]) => cellKey(p.cell) === cellKey(g.p.cell)).map(([k]) => k));
      for (let frontier = [...ok]; frontier.length;) {
        const next: string[] = [];
        for (const k of frontier) for (const b of back.get(k) ?? []) if (!ok.has(b)) { ok.add(b); next.push(b); }
        frontier = next;
      }
      const stuck = [...nodes].find(([k]) => !ok.has(k));
      if (stuck) {
        const on = groups.filter((_, i) => stuck[1].mask & (1 << i));
        add1('10.4', true, g.what, `unreachable from ${at(stuck[1])} with lasers on: ${on.join(', ') || 'none'} (a laser soft-lock)`);
      }
    }
  }
  // 10.6 / 10.7: invisible blocks, and vanishing ones gone, never cut a spawn off a goal (vanishing: unless each lane
  // of them can be crossed at walking speed).
  const cut = (drop: Iterable<string>) => { const c = createWorld(w.level, 0); c.removed = new Set(drop); return c; };
  const lost = (c: World) => goals.filter((g) => level.spawns.some((s, i) => reach[i].has(cellKey(g.p.cell)) && !safeCells(c, s).has(cellKey(g.p.cell))));
  if (level.invisible.size) for (const g of lost(cut(level.invisible))) add1('10.6', true, g.what, 'only reachable over invisible blocks');
  if (level.vanish.size) {
    for (const [k, v] of level.vanish) if (v.period < 40 || 2 * v.on < v.period) add1('10.7', true, k, `period ${v.period} on ${v.on}: needs period >= 40 and on >= 50 %`);
    if (lost(cut(level.vanish.keys())).length) {
      for (const lane of lanes(w, all)) {
        const seq = lane.map((s) => level.vanish.get(cellKey(sub(s.cell, dirVec(s.up)))) ?? null);
        if (seq.some((v) => v) && (!vanishLanePassable(seq) || !vanishLanePassable([...seq].reverse()))) {
          add1('10.7', true, at(lane[seq.findIndex((v) => v)]), "on the only route to a goal, and this lane of vanishing blocks can't be crossed at walking speed");
        }
      }
    }
  }
  // 10.8: one main mechanic.
  if (tps.length && level.lasers.length) add1('10.8', false, 'level', 'both teleporters and lasers (use one as the main mechanic)');
}

/** LEVEL-DESIGN §11 (phase 15a): pickup spots. */
function check15a(level: Level, w: World, goals: Goal[], reach: Set<string>[], add1: Add): void {
  const near = spotsNearSpawns(w), r = level.randomPickups;
  level.pickups.forEach((s, i) => {
    const why = pickupSpotProblem(w, s, near);
    if (why) add1('11.1', true, `pickup ${i}`, `${s.type} ${why}`);
  });
  if (level.pickups.length > 4) add1('11.2', true, 'level', `${level.pickups.length} fixed pickup spots (max 4)`);
  if (r && r.maxOnMap > 3) add1('11.2', true, 'level', `randomPickups.maxOnMap ${r.maxOnMap} (max 3)`);
  const candidates = r ? pickupCandidates(level) : [];
  if (r && !candidates.length) add1('11.1', true, 'level', 'randomPickups has no tile to spawn on');
  // 11.3: with a lethargy spot as a wall (you can jump over it, not stop on it), every key and the exit stay reachable.
  // ponytail: one safe BFS per lethargy spot per spawn; random lethargy on a race level makes that one per candidate.
  const lethargy = [...level.pickups.filter((s) => s.type === 'lethargy'), ...(r?.types.includes('lethargy') && goals.length ? candidates : [])];
  for (const s of lethargy) {
    const res: Reservations = new Map([[cellKey(s.cell), 'x']]);
    level.spawns.forEach((sp, i) => {
      const cut = safeCells(w, sp, res);
      for (const g of goals) if (reach[i].has(cellKey(g.p.cell)) && !cut.has(cellKey(g.p.cell))) add1('11.3', true, `${at(s)} lethargy`, `on the only route from spawn ${i} to the ${g.what}`);
    });
  }
  // 11.4: a good pill next to an edge (a move from it flips over) or a trap is a decision, not a freebie.
  level.pickups.forEach((s, i) => {
    if (s.type === 'lethargy') return;
    const risky = sides(s.up).some((d) => { const m = move(w, s, d); return m.kind === 'flip' || types(w, m).length > 0 || lethal(w, m); });
    if (!risky) add1('11.4', false, `pickup ${i}`, `${s.type} isn't at a risk spot (next to an edge or a trap)`);
  });
}
