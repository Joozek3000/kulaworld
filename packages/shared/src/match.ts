import type { Mode } from './level/types.ts';
import type { RaceResult, SimEvent } from './sim/world.ts';

/**
 * Matches (ARCHITECTURE §23, phase 18): rounds grouped into a match with points. Pure functions; the room keeps the
 * match state. Nothing here touches the sim.
 */

/** Points by place (1st, 2nd, 3rd); 4th and below get PLACE_REST. */
export const PLACE_POINTS = [5, 3, 2] as const;
export const PLACE_REST = 1;
/** Knockout credit bonus caps per round: knockout mode, and race with push. */
export const KO_CAP_KNOCKOUT = 3;
export const KO_CAP_RACE = 2;
/** Knocking out the crowned player. */
export const CROWN_KO_BONUS = 1;
export const MATCH_LENGTHS = [3, 5, 7] as const;

/** A player as the round ended (the sim's PlayerState has these). */
export interface RoundPlayer { id: string; keys: number; lives: number; knockouts: number; eliminated: boolean; eliminatedTick: number }
export interface Breakdown { label: string; points: number }
export interface RoundScore { points: number; place: number; breakdown: Breakdown[] }

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/**
 * Places for players ranked by `better` (a comparator: < 0 means a is ahead). Ties share the higher place:
 * 1, 2, 2, 4.
 */
function places<T>(list: readonly T[], cmp: (a: T, b: T) => number): Map<T, number> {
  const sorted = [...list].sort(cmp), out = new Map<T, number>();
  sorted.forEach((p, i) => out.set(p, i > 0 && cmp(sorted[i - 1], p) === 0 ? out.get(sorted[i - 1])! : i + 1));
  return out;
}

/**
 * One round's points (§23), for the players still in the room at the end (anyone who left gets nothing). `crownId`
 * is the player wearing the crown during the round (it only changes between rounds), or null.
 * - Race: the exit winner is 1st; everyone else by keys held (ties share the higher place). A timeout with no exit
 *   ranks everyone by keys. A non-winner scores place points only with ≥ 1 key. +1 per knockout credited, cap +2.
 * - Knockout: by elimination order (the survivor 1st; those still alive at a timeout by lives, then knockouts; the
 *   eliminated by how late they went out, the same tick sharing a place). Everyone placed scores. +1 per knockout,
 *   cap +3.
 * - Either mode: knocking out the crowned player +1 (outside the cap).
 */
export function scoreRound(
  mode: Mode, result: RaceResult | null, events: readonly SimEvent[], players: readonly RoundPlayer[], crownId: string | null = null,
): Map<string, RoundScore> {
  const out = new Map<string, RoundScore>();
  const knockout = mode === 'knockout';
  const winner = result?.reason === 'exit' ? result.winnerId : null;
  const rank = knockout
    ? places(players, (a, b) => Number(a.eliminated) - Number(b.eliminated)
      || (a.eliminated ? b.eliminatedTick - a.eliminatedTick : b.lives - a.lives || b.knockouts - a.knockouts))
    : places(players, (a, b) => Number(b.id === winner) - Number(a.id === winner) || b.keys - a.keys);
  const kos = new Map<string, number>(), crownKos = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'knockout' || e.pusherId === e.victimId) continue;
    kos.set(e.pusherId, (kos.get(e.pusherId) ?? 0) + 1);
    if (crownId && e.victimId === crownId) crownKos.set(e.pusherId, (crownKos.get(e.pusherId) ?? 0) + 1);
  }
  for (const p of players) {
    const place = rank.get(p)!;
    const breakdown: Breakdown[] = [];
    const placed = knockout || p.id === winner || p.keys > 0;
    const pts = !placed ? 0 : (PLACE_POINTS[place - 1] ?? PLACE_REST);
    if (pts) breakdown.push({ label: p.id === winner ? 'Exit' : knockout && place === 1 ? 'Survivor' : ordinal(place), points: pts });
    const ko = Math.min(kos.get(p.id) ?? 0, knockout ? KO_CAP_KNOCKOUT : KO_CAP_RACE);
    if (ko) breakdown.push({ label: `KO ×${ko}`, points: ko });
    const crown = (crownKos.get(p.id) ?? 0) * CROWN_KO_BONUS;
    if (crown) breakdown.push({ label: '👑 KO', points: crown });
    out.set(p.id, { points: breakdown.reduce((s, b) => s + b.points, 0), place, breakdown });
  }
  return out;
}

/** The crown (§23): the strict points leader, or null on a tie (or with no points at all). */
export function crownOf(points: ReadonlyMap<string, number>): string | null {
  let best: string | null = null, top = 0, tied = false;
  for (const [id, n] of points) {
    if (n > top) { best = id; top = n; tied = false; }
    else if (n === top && n > 0) tied = true;
  }
  return tied ? null : best;
}

/** A player's match stats (§23), for the stats card and MVP badges. */
export interface MatchStats { points: number; wins: number; knockouts: number; pushes: number; stomps: number; deaths: number; keys: number }
export const emptyStats = (): MatchStats => ({ points: 0, wins: 0, knockouts: 0, pushes: 0, stomps: 0, deaths: 0, keys: 0 });

/** Adds one round's events to the stats of the players in `stats` (others are ignored). Keys are keys picked up. */
export function addRoundStats(stats: Map<string, MatchStats>, events: readonly SimEvent[]): void {
  const s = (id: string) => stats.get(id);
  for (const e of events) {
    switch (e.type) {
      case 'knockout': { const p = s(e.pusherId); if (p) p.knockouts++; break; }
      case 'push': case 'cradle': { const p = s(e.pusherId); if (p) p.pushes++; break; }
      case 'stomp': { const p = s(e.attackerId); if (p) p.stomps++; break; }
      case 'death': { const p = s(e.playerId); if (p) p.deaths++; break; }
      case 'key': { const p = s(e.playerId); if (p) p.keys++; break; }
      case 'win': { const p = e.winnerId ? s(e.winnerId) : undefined; if (p) p.wins++; break; }
    }
  }
}

/** MVP badges (§23): the strict leader per stat (a tie → nobody). Survivor is the fewest deaths. */
export function mvps(stats: ReadonlyMap<string, MatchStats>): { badge: string; id: string }[] {
  const pick = (badge: string, value: (s: MatchStats) => number, fewest = false) => {
    let best: string | null = null, top = fewest ? Infinity : 0, tied = false;
    for (const [id, st] of stats) {
      const v = value(st);
      if (fewest ? v < top : v > top) { best = id; top = v; tied = false; } else if (v === top) tied = true;
    }
    return best && !tied ? [{ badge, id: best }] : [];
  };
  return [
    ...pick('Most knockouts', (s) => s.knockouts), ...pick('Most keys', (s) => s.keys),
    ...pick('Survivor', (s) => s.deaths, true), ...pick('Bully', (s) => s.pushes),
  ];
}
