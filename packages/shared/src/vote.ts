import type { Mode } from './level/types.ts';

/** Lobby level vote (phase 14): options 0..2 are the candidates, RANDOM_VOTE picks a random pool level. */
export const VOTE_CANDIDATES = 3;
export const RANDOM_VOTE = 3;

export interface PoolLevel { id: string; mode: Mode }

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The pool without the last played level, unless that would leave nothing. */
export const eligible = (pool: readonly PoolLevel[], last: string | null): PoolLevel[] =>
  pool.length > 1 ? pool.filter((l) => l.id !== last) : [...pool];

/**
 * Up to VOTE_CANDIDATES level ids from the pool: random, never the last played level (when there's another), and at
 * least one race and one knockout level when the eligible pool has both.
 */
export function pickCandidates(pool: readonly PoolLevel[], last: string | null, rng: () => number): string[] {
  const rest = shuffle(eligible(pool, last), rng);
  const out: PoolLevel[] = [];
  for (const mode of ['race', 'knockout'] as const) {
    const i = rest.findIndex((l) => l.mode === mode);
    if (i >= 0) out.push(...rest.splice(i, 1));
  }
  out.push(...rest);
  return shuffle(out.slice(0, VOTE_CANDIDATES), rng).map((l) => l.id);
}

/**
 * The winning level id: most votes (0..candidates-1 or RANDOM_VOTE); a tie is broken by `rng`. No votes, or Random
 * winning, picks a random eligible pool level.
 */
export function tallyVotes(candidates: readonly string[], votes: Iterable<number>, pool: readonly PoolLevel[], last: string | null, rng: () => number): string {
  const counts = voteCounts(candidates, votes);
  const max = Math.max(...counts);
  const top = counts.flatMap((n, i) => (n === max && max > 0 ? [i] : []));
  const option = top.length ? top[Math.floor(rng() * top.length)] : RANDOM_VOTE;
  if (option !== RANDOM_VOTE) return candidates[option];
  const from = eligible(pool, last);
  return from[Math.floor(rng() * from.length)].id;
}

/** Votes per option (VOTE_CANDIDATES slots, then Random). Votes for a missing candidate or out of range are ignored. */
export function voteCounts(candidates: readonly string[], votes: Iterable<number>): number[] {
  const counts = Array<number>(RANDOM_VOTE + 1).fill(0);
  for (const v of votes) if (validVote(candidates, v)) counts[v]++;
  return counts;
}

export const validVote = (candidates: readonly string[], v: unknown): v is number =>
  v === RANDOM_VOTE || (Number.isInteger(v) && (v as number) >= 0 && (v as number) < candidates.length);
