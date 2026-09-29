import { describe, expect, test } from 'vitest';
import { addRoundStats, crownOf, emptyStats, matchPlaces, mvps, scoreRound, type MatchStats, type RoundPlayer, type SimEvent } from '../src/index.ts';

// Matches (ARCHITECTURE §23, phase 18): round scoring, the crown, stats.
const P = (id: string, o: Partial<RoundPlayer> = {}): RoundPlayer => ({ id, keys: 0, lives: 0, knockouts: 0, eliminated: false, eliminatedTick: -1, ...o });
const ko = (pusherId: string, victimId: string): SimEvent => ({ type: 'knockout', pusherId, victimId });
const pts = (m: Map<string, { points: number }>) => Object.fromEntries([...m].map(([id, s]) => [id, s.points]));

describe('race', () => {
  test('exit 5; the rest by keys: 3, 2, then 1 with a key, 0 without', () => {
    const players = [P('a', { keys: 3 }), P('b', { keys: 2 }), P('c', { keys: 1 }), P('d', { keys: 1 }), P('e')];
    const m = scoreRound('race', { winnerId: 'a', reason: 'exit' }, [], players);
    // c and d tie for 3rd (share the higher place): 2 each; e holds no key.
    expect(pts(m)).toEqual({ a: 5, b: 3, c: 2, d: 2, e: 0 });
    expect(m.get('a')!.breakdown).toEqual([{ label: 'Exit', points: 5 }]);
    const fourth = scoreRound('race', { winnerId: 'a', reason: 'exit' }, [], [P('a'), P('b', { keys: 3 }), P('c', { keys: 2 }), P('d', { keys: 1 })]);
    expect(pts(fourth)).toEqual({ a: 5, b: 3, c: 2, d: 1 });
  });

  test('ties share the higher place', () => {
    const m = scoreRound('race', { winnerId: 'a', reason: 'exit' }, [], [P('a'), P('b', { keys: 2 }), P('c', { keys: 2 }), P('d', { keys: 1 })]);
    expect(pts(m)).toEqual({ a: 5, b: 3, c: 3, d: 1 });
    expect([m.get('b')!.place, m.get('c')!.place, m.get('d')!.place]).toEqual([2, 2, 4]);
  });

  test('a timeout with no exit ranks everyone by keys', () => {
    const m = scoreRound('race', { winnerId: 'b', reason: 'timeout' }, [], [P('a', { keys: 1 }), P('b', { keys: 2 }), P('c')]);
    expect(pts(m)).toEqual({ a: 3, b: 5, c: 0 });
  });

  test('+1 per knockout credited, capped at +2', () => {
    const events = [ko('b', 'c'), ko('b', 'd'), ko('b', 'c'), ko('c', 'd')];
    const m = scoreRound('race', { winnerId: 'a', reason: 'exit' }, events, [P('a'), P('b'), P('c'), P('d')]);
    expect(pts(m)).toEqual({ a: 5, b: 2, c: 1, d: 0 });
    expect(m.get('b')!.breakdown).toEqual([{ label: 'KO ×2', points: 2 }]);
  });
});

describe('knockout', () => {
  test('by elimination order: survivor 5, then 3, 2, 1; the same tick shares a place', () => {
    const players = [P('a'), P('b', { eliminated: true, eliminatedTick: 900 }), P('c', { eliminated: true, eliminatedTick: 500 }),
      P('d', { eliminated: true, eliminatedTick: 300 }), P('e', { eliminated: true, eliminatedTick: 300 })];
    const m = scoreRound('knockout', { winnerId: 'a', reason: 'lastAlive' }, [], players);
    expect(pts(m)).toEqual({ a: 5, b: 3, c: 2, d: 1, e: 1 });
    expect(m.get('a')!.breakdown[0].label).toBe('Survivor');
  });

  test('a timeout ranks the ones still in by lives, then knockouts', () => {
    const m = scoreRound('knockout', { winnerId: 'b', reason: 'timeout' }, [], [P('a', { lives: 1 }), P('b', { lives: 2 }), P('c', { lives: 1, knockouts: 2 })]);
    expect(pts(m)).toEqual({ b: 5, c: 3, a: 2 });
  });

  test('+1 per knockout, capped at +2 (as race)', () => {
    const events = [ko('a', 'b'), ko('a', 'c'), ko('a', 'd'), ko('a', 'b'), ko('a', 'c')];
    const m = scoreRound('knockout', { winnerId: 'a', reason: 'lastAlive' }, events, [P('a'), P('b', { eliminated: true, eliminatedTick: 5 })]);
    expect(m.get('a')!).toMatchObject({ points: 5 + 2, breakdown: [{ label: 'Survivor', points: 5 }, { label: 'KO ×2', points: 2 }] });
  });
});

test('knocking out the crowned player: +1 on top of the cap, in either mode', () => {
  const events = [ko('a', 'b'), ko('a', 'c'), ko('a', 'd'), ko('a', 'crown')];
  const m = scoreRound('knockout', { winnerId: 'a', reason: 'lastAlive' }, events, [P('a'), P('crown', { eliminated: true, eliminatedTick: 1 })], 'crown');
  expect(m.get('a')!.breakdown).toEqual([{ label: 'Survivor', points: 5 }, { label: 'KO ×2', points: 2 }, { label: '👑 KO', points: 1 }]);
  const race = scoreRound('race', { winnerId: 'x', reason: 'exit' }, [ko('b', 'crown')], [P('x'), P('b'), P('crown', { keys: 1 })], 'crown');
  expect(pts(race)).toEqual({ x: 5, b: 1 + 1, crown: 3 });
  // Without a crown there's no bonus; the crown holder knocking someone out isn't a crown KO.
  expect(pts(scoreRound('race', { winnerId: 'x', reason: 'exit' }, [ko('crown', 'b')], [P('x'), P('b'), P('crown')], 'crown'))).toEqual({ x: 5, b: 0, crown: 1 });
});

test('a player who left mid-round scores nothing (not in the result)', () => {
  const m = scoreRound('race', { winnerId: 'a', reason: 'exit' }, [ko('gone', 'b')], [P('a'), P('b', { keys: 1 })]);
  expect(pts(m)).toEqual({ a: 5, b: 3 });
  expect(m.has('gone')).toBe(false);
});

test('determinism: the same round gives the same breakdown, whatever the player order', () => {
  const players = [P('a', { keys: 2 }), P('b', { keys: 2 }), P('c', { keys: 1 })];
  const events = [ko('c', 'a')];
  const one = scoreRound('race', null, events, players), two = scoreRound('race', null, events, [...players].reverse());
  expect(Object.fromEntries(two)).toEqual(Object.fromEntries(one));
  expect(JSON.stringify([...scoreRound('race', null, events, players)])).toBe(JSON.stringify([...one]));
});

test('crown: the strict leader; a tie or no points → nobody', () => {
  expect(crownOf(new Map([['a', 5], ['b', 3]]))).toBe('a');
  expect(crownOf(new Map([['a', 5], ['b', 5], ['c', 1]]))).toBeNull();
  expect(crownOf(new Map([['a', 0], ['b', 0]]))).toBeNull();
  expect(crownOf(new Map([['a', 2], ['b', 7], ['c', 7], ['d', 9]]))).toBe('d');
});

test('stats from events, and MVP badges (strict leaders; fewest deaths for Survivor)', () => {
  const stats = new Map<string, MatchStats>([['a', emptyStats()], ['b', emptyStats()]]);
  addRoundStats(stats, [
    { type: 'push', pusherId: 'a', victimId: 'b' }, { type: 'push', pusherId: 'a', victimId: 'b' }, { type: 'knockout', pusherId: 'a', victimId: 'b' },
    { type: 'death', playerId: 'b', cell: { x: 0, y: 0, z: 0 }, cause: 'fall' }, { type: 'key', playerId: 'b', keyId: 0, keys: 1 },
    { type: 'stomp', attackerId: 'b', victimId: 'a' }, { type: 'win', winnerId: 'a', reason: 'exit' }, { type: 'key', playerId: 'z', keyId: 1, keys: 1 },
  ]);
  expect(stats.get('a')).toEqual({ points: 0, wins: 1, knockouts: 1, pushes: 2, stomps: 0, deaths: 0, keys: 0 });
  expect(stats.get('b')).toEqual({ points: 0, wins: 0, knockouts: 0, pushes: 0, stomps: 1, deaths: 1, keys: 1 });
  expect(mvps(stats)).toEqual([{ badge: 'Most knockouts', id: 'a' }, { badge: 'Most keys', id: 'b' }, { badge: 'Survivor', id: 'a' }, { badge: 'Bully', id: 'a' }]);
});

test('match places (18b): points, then round wins, then knockouts, then keys; a full tie shares the place', () => {
  const S = (id: string, o: Partial<MatchStats>) => ({ id, ...emptyStats(), points: 10, ...o });
  const placesOf = (list: ReturnType<typeof S>[]) => Object.fromEntries([...matchPlaces(list)].map(([s, n]) => [s.id, n]));
  expect(placesOf([S('a', { points: 9 }), S('b', {})])).toEqual({ b: 1, a: 2 });
  expect(placesOf([S('a', { wins: 1 }), S('b', { wins: 2, knockouts: 0 })])).toEqual({ b: 1, a: 2 });
  expect(placesOf([S('a', { wins: 1, knockouts: 3 }), S('b', { wins: 1, knockouts: 4, keys: 0 })])).toEqual({ b: 1, a: 2 });
  expect(placesOf([S('a', { wins: 1, knockouts: 3, keys: 5 }), S('b', { wins: 1, knockouts: 3, keys: 2 })])).toEqual({ a: 1, b: 2 });
  // Still tied: both 1st, and the next one is 3rd.
  expect(placesOf([S('a', { wins: 1, keys: 2 }), S('b', { wins: 1, keys: 2 }), S('c', { points: 4 })])).toEqual({ a: 1, b: 1, c: 3 });
});
