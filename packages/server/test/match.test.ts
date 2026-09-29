import { afterAll, beforeAll, expect, test } from 'vitest';
import { defineRoom, defineServer, matchMaker } from 'colyseus';
import { Client, type Room } from '@colyseus/sdk';
import type { SimEvent } from '@kula/shared';
import { config } from '../src/config.ts';
import { RaceRoom } from '../src/rooms/RaceRoom.ts';

// Matches (ARCHITECTURE §23, phase 18): a 3-round match through the real room, with round results forced.
const PORT = 2599;
const server = defineServer({ rooms: { race: defineRoom(RaceRoom) } });

beforeAll(async () => {
  Object.assign(config, { minPlayers: 2, level: 'test-flat', latencyMs: 0, matchRounds: 5 });
  await server.listen(PORT);
});
afterAll(() => server.gracefullyShutdown(false));

async function waitFor<T>(what: string, fn: () => T, timeoutMs = 10000): Promise<NonNullable<T>> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

type RoomInternals = { world: { result: unknown; players: { id: string; keys: number }[] }; roundEvents: SimEvent[] };

test('a 3-round match: length vote, points, the crown, a late joiner and a leaver, matchEnd, a 1–1 rematch resets', { timeout: 90000 }, async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const a: Room = await client.joinOrCreate('race', { name: 'A' });
  const b: Room = await client.joinOrCreate('race', { name: 'B' });
  const room = () => matchMaker.getLocalRoomById(a.roomId) as unknown as RoomInternals;
  const s = () => a.state;
  const points = () => Object.fromEntries([...s().standings.values()].map((st: { name: string; points: number }) => [st.name, st.points]));
  const nameOf = (id: string) => s().standings.get(id)?.name ?? '';
  await waitFor('lobby', () => s().phase === 'lobby' && s().standings?.size === 2);

  // Length vote (before round 1): 3 rounds.
  a.send('length', 0);
  b.send('length', 0);
  a.send('length', 9); // ignored
  await waitFor('length votes', () => [...s().lengthVotes].join() === '2,0,0');

  /** Plays one round: ready both (and `extra`), then force the result: `winner` takes the exit. */
  const round = async (n: number, winner: Room, events: SimEvent[] = [], extra: Room[] = []) => {
    for (const r of [a, b, ...extra]) r.send('ready');
    await waitFor(`round ${n} playing`, () => s().phase === 'playing' && s().matchRound === n);
    room().roundEvents.push(...events);
    room().world.result = { winnerId: winner.sessionId, reason: 'exit' };
    await waitFor(`round ${n} results`, () => s().phase === 'results');
  };

  await round(1, a);
  expect(s().matchRounds).toBe(3);
  expect(points()).toEqual({ A: 5, B: 0 });
  expect(nameOf(s().crownId)).toBe('A');
  expect(s().standings.get(a.sessionId).breakdown).toBe('Exit +5');
  await waitFor('lobby 2', () => s().phase === 'lobby', 8000);
  expect([...s().lengthVotes].join()).toBe('0,0,0');
  b.send('length', 2); // no length vote after round 1: ignored
  await new Promise((r) => setTimeout(r, 200));
  expect([...s().lengthVotes].join()).toBe('0,0,0');

  // Round 2: B wins and knocks out the crowned A: 5 + 1 (KO) + 1 (crown KO). The crown moves to B.
  await round(2, b, [{ type: 'knockout', pusherId: b.sessionId, victimId: a.sessionId }]);
  expect(points()).toEqual({ A: 5, B: 7 });
  expect(s().standings.get(b.sessionId).breakdown).toBe('Exit +5 · KO ×1 +1 · 👑 KO +1');
  expect(nameOf(s().crownId)).toBe('B');

  // A latecomer joins mid-match with 0 points, and plays round 3 from the lobby.
  const c: Room = await client.joinOrCreate('race', { name: 'C' });
  await waitFor('C on the board', () => s().standings.get(c.sessionId)?.points === 0);
  await waitFor('lobby 3', () => s().phase === 'lobby', 8000);
  await round(3, c, [], [c]);
  expect(points()).toEqual({ A: 5, B: 7, C: 5 });
  expect(nameOf(s().crownId)).toBe('B');

  // matchEnd after round 3. C leaves: their points stay, greyed (left).
  await waitFor('matchEnd', () => s().phase === 'matchEnd', 8000);
  await c.leave();
  await waitFor('C left', () => s().standings.get(c.sessionId)?.left === true);
  expect(points()).toEqual({ A: 5, B: 7, C: 5 });

  // Rematch: 1 yes, 1 no is half the room, enough (18b) → a new match, same length (3, not the default 5), points reset, the leaver gone.
  a.send('rematch', true);
  b.send('rematch', false);
  await waitFor('rematch lobby', () => s().phase === 'lobby', 16000);
  expect(points()).toEqual({ A: 0, B: 0 });
  expect([s().matchRound, s().matchRounds, s().crownId]).toEqual([0, 3, '']);
  await a.leave();
  await b.leave();
});
