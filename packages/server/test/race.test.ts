import { afterAll, beforeAll, expect, test } from 'vitest';
import { defineRoom, defineServer } from 'colyseus';
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
