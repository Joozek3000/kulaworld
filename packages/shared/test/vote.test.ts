import { expect, test } from 'vitest';
import { mulberry32, pickCandidates, RANDOM_VOTE, tallyVotes, voteCounts, type PoolLevel } from '../src/index.ts';

const pool: PoolLevel[] = [
  { id: 'r1', mode: 'race' }, { id: 'r2', mode: 'race' }, { id: 'r3', mode: 'race' }, { id: 'r4', mode: 'race' },
  { id: 'k1', mode: 'knockout' }, { id: 'k2', mode: 'knockout' },
];
const modeOf = (id: string) => pool.find((l) => l.id === id)!.mode;

test('candidates: 3 distinct, never the last played level, always a race and a knockout', () => {
  for (let seed = 0; seed < 200; seed++) {
    const c = pickCandidates(pool, 'k1', mulberry32(seed));
    expect(c).toHaveLength(3);
    expect(new Set(c).size).toBe(3);
    expect(c).not.toContain('k1');
    expect(c.map(modeOf)).toContain('race');
    expect(c).toContain('k2'); // the only knockout left
  }
});

test('candidates: every eligible level shows up over many lobbies', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 100; seed++) pickCandidates(pool, 'r1', mulberry32(seed)).forEach((id) => seen.add(id));
  expect([...seen].sort()).toEqual(['k1', 'k2', 'r2', 'r3', 'r4']);
});

test('candidates: small pools', () => {
  expect(pickCandidates([pool[0]], 'r1', mulberry32(1))).toEqual(['r1']); // the only level may repeat
  expect(pickCandidates([pool[0], pool[4]], 'r1', mulberry32(1))).toEqual(['k1']);
  expect(pickCandidates(pool.filter((l) => l.mode === 'race'), null, mulberry32(1)).map(modeOf)).toEqual(['race', 'race', 'race']);
});

test('tally: the majority wins; Random wins → a random eligible level', () => {
  const c = ['r1', 'r2', 'k1'];
  expect(tallyVotes(c, [1, 1, 0], pool, null, mulberry32(1))).toBe('r2');
  for (let seed = 0; seed < 50; seed++) {
    const id = tallyVotes(c, [RANDOM_VOTE, RANDOM_VOTE, 0], pool, 'r4', mulberry32(seed));
    expect(id).not.toBe('r4');
    expect(pool.map((l) => l.id)).toContain(id);
  }
});

test('tally: ties are broken by the seeded RNG, deterministically, and reach every tied option', () => {
  const c = ['r1', 'r2', 'k1'];
  const winners = new Set<string>();
  for (let seed = 0; seed < 50; seed++) {
    const a = tallyVotes(c, [0, 2, 0, 2, 1], pool, null, mulberry32(seed));
    expect(tallyVotes(c, [0, 2, 0, 2, 1], pool, null, mulberry32(seed))).toBe(a);
    expect(['r1', 'k1']).toContain(a);
    winners.add(a);
  }
  expect(winners.size).toBe(2);
});

test('tally: no votes → random eligible level', () => {
  const got = new Set<string>();
  for (let seed = 0; seed < 100; seed++) got.add(tallyVotes(['r1', 'r2', 'k1'], [-1, -1], pool, 'k2', mulberry32(seed)));
  expect(got.has('k2')).toBe(false);
  expect(got.size).toBe(5);
});

test('voteCounts: 3 slots + Random; invalid votes ignored', () => {
  expect(voteCounts(['a', 'b', 'c'], [0, 0, 2, 3, -1, 7, 1.5])).toEqual([2, 0, 1, 1]);
  expect(voteCounts(['a'], [0, 1, 2, 3])).toEqual([1, 0, 0, 1]); // no candidate in slots 1 and 2
});
