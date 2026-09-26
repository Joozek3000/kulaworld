import { afterAll, beforeAll, expect, test } from 'vitest';
import { defineRoom, defineServer, matchMaker } from 'colyseus';
import { Client, type Room } from '@colyseus/sdk';
import { Action, ROLL_TICKS } from '@kula/shared';
import { config } from '../src/config.ts';
import { parseInput, RaceRoom } from '../src/rooms/RaceRoom.ts';

const PORT = 2598;
const server = defineServer({ rooms: { race: defineRoom(RaceRoom) } });

beforeAll(async () => {
  Object.assign(config, { minPlayers: 2, level: 'test-flat', latencyMs: 0 });
  await server.listen(PORT);
});
afterAll(() => server.gracefullyShutdown(false));

async function waitFor<T>(what: string, fn: () => T, timeoutMs = 6000): Promise<NonNullable<T>> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('parseInput rejects malformed messages', () => {
  expect(parseInput({ seq: 1, fwdHeld: true, turn: 0, jump: false, jumpHeld: false })).toEqual({ seq: 1, fwdHeld: true, turn: 0, jump: false, jumpHeld: false });
  for (const bad of [null, 'x', 5, {}, { seq: 1.5, fwdHeld: true, turn: 0, jump: false, jumpHeld: false },
    { seq: 1, fwdHeld: 'yes', turn: 0, jump: false, jumpHeld: false }, { seq: 1, fwdHeld: true, turn: 2, jump: false, jumpHeld: false },
    { seq: 1, fwdHeld: true, turn: 0 }, { seq: 1, fwdHeld: true, turn: 0, jump: false }]) {
    expect(parseInput(bad)).toBe(null);
  }
});

test('2 clients join, ready, round starts, inputs move the player in the schema', { timeout: 15000 }, async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const a: Room = await client.joinOrCreate('race', { name: 'A' });
  const b: Room = await client.joinOrCreate('race', { name: 'B' });
  expect(b.roomId).toBe(a.roomId);
  await waitFor('2 players', () => a.state.players?.size === 2);
  expect(a.state.phase).toBe('lobby');

  // Garbage and outside-playing inputs are dropped without crashing the room.
  a.send('input', { turn: 5 });
  a.send('input', 'nonsense');
  a.send('input', { seq: 1, fwdHeld: true, turn: 0, jump: false, jumpHeld: false });

  a.send('ready');
  await waitFor('A ready', () => a.state.players.get(a.sessionId)?.ready);
  expect(a.state.phase).toBe('lobby'); // B not ready yet
  b.send('ready');
  await waitFor('countdown', () => a.state.phase === 'countdown');

  const me = a.state.players.get(a.sessionId);
  expect(me.action).toBe(Action.Idle);
  // Spawns are shuffled per round; every test-flat spawn is at y=1, z=1 facing +Z.
  const [x0, y0, z0] = [me.fromX, me.fromY, me.fromZ];
  expect([1, 3, 5, 7]).toContain(x0);
  expect([y0, z0]).toEqual([1, 1]);
  expect(a.state.items.size).toBe(4); // 3 keys + exit

  await waitFor('playing', () => a.state.phase === 'playing', 5000);
  const sentAt = a.state.tick;
  a.send('input', { seq: 2, fwdHeld: true, turn: 0, jump: false, jumpHeld: false });
  await waitFor('roll', () => me.action === Action.Roll);
  expect(me.startTick - sentAt).toBeLessThanOrEqual(4);
  expect([me.toX, me.toY, me.toZ]).toEqual([x0, 1, 2]);
  expect(me.endTick - me.startTick).toBe(ROLL_TICKS);
  await waitFor('arrive', () => me.fromZ === 2);

  a.send('input', { seq: 3, fwdHeld: false, turn: 0, jump: false, jumpHeld: false });
  await a.leave();
  await b.leave();
});

test('stamped inputs (§17): a future tick applies exactly then, a late one at the next tick', { timeout: 15000 }, async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const a: Room = await client.joinOrCreate('race', { name: 'A' });
  const b: Room = await client.joinOrCreate('race', { name: 'B' });
  await waitFor('2 players', () => a.state.players?.size === 2);
  a.send('ready');
  b.send('ready');
  await waitFor('playing', () => a.state.phase === 'playing', 8000);
  const me = a.state.players.get(a.sessionId);

  const future = a.state.tick + 12;
  a.send('input', { seq: 10, fwdHeld: true, turn: 0, jump: false, jumpHeld: false, tick: future });
  await waitFor('ack 10', () => me.ackSeq === 10);
  expect(me.ackTick).toBe(future);
  await waitFor('roll', () => me.action === Action.Roll);
  expect(me.startTick).toBe(future);

  const sentAt = a.state.tick;
  a.send('input', { seq: 11, fwdHeld: false, turn: 1, jump: false, jumpHeld: false, tick: sentAt - 5 });
  await waitFor('ack 11', () => me.ackSeq === 11);
  expect(me.ackTick).toBeGreaterThan(sentAt - 5); // late: applied when it arrived, not dropped
  expect(me.ackTick).toBeLessThanOrEqual(a.state.tick);

  a.send('input', { seq: 12, fwdHeld: false, turn: 0, jump: false, jumpHeld: false, tick: 1.5 });
  expect(parseInput({ seq: 12, fwdHeld: false, turn: 0, jump: false, jumpHeld: false, tick: 1.5 })).toBe(null);
  await a.leave();
  await b.leave();
});

test('lobby vote (phase 14): counts, a leaver vote removed, the winner loads, votes cleared on the next lobby', { timeout: 20000 }, async () => {
  Object.assign(config, { level: 'test-flat,test-cube' });
  const client = new Client(`ws://localhost:${PORT}`);
  const a: Room = await client.joinOrCreate('race', { name: 'A' });
  const b: Room = await client.joinOrCreate('race', { name: 'B' });
  await waitFor('2 players', () => a.state.players?.size === 2 && a.state.candidates?.length === 2);
  const candidates = [...a.state.candidates];
  expect(candidates.sort()).toEqual(['test-cube', 'test-flat']);
  const counts = () => [...a.state.voteCounts].join(',');

  a.send('vote', 1);
  b.send('vote', 3);
  await waitFor('votes', () => counts() === '0,1,0,1');
  const c: Room = await client.joinOrCreate('race', { name: 'C' });
  c.send('vote', 0);
  await waitFor('C voted', () => counts() === '1,1,0,1');
  await c.leave();
  await waitFor("C's vote removed", () => counts() === '0,1,0,1');
  for (const bad of [2, 4, -1, 'x', 1.5]) b.send('vote', bad); // slot 2 has no candidate
  b.send('vote', 1); // change of mind
  await waitFor('B moved', () => counts() === '0,2,0,0');
  expect(a.state.players.get(b.sessionId).vote).toBe(1);

  a.send('ready');
  b.send('ready');
  await waitFor('countdown', () => a.state.phase === 'countdown');
  const played = a.state.candidates[1];
  expect(a.state.levelId).toBe(played);
  a.send('vote', 0); // ignored outside the lobby
  await waitFor('playing', () => a.state.phase === 'playing', 5000);
  expect(counts()).toBe('0,2,0,0');

  // End the round now: results, then a fresh lobby.
  const room = matchMaker.getLocalRoomById(a.roomId) as unknown as { world: { result: unknown } };
  room.world.result = { winnerId: null, reason: 'timeout' };
  await waitFor('lobby', () => a.state.phase === 'lobby', 8000);
  expect(counts()).toBe('0,0,0,0');
  expect(a.state.players.get(a.sessionId).vote).toBe(-1);
  expect([...a.state.candidates]).toEqual(candidates.filter((id) => id !== played)); // not the last played level
  await a.leave();
  await b.leave();
  Object.assign(config, { level: 'test-flat' });
});
