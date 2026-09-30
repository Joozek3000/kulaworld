import { afterAll, beforeAll, expect, test } from 'vitest';
import { defineRoom, defineServer, matchMaker } from 'colyseus';
import { Client, type Room } from '@colyseus/sdk';
import { GAME_VERSION, JOIN_ERROR } from '@kula/shared';
import { config } from '../src/config.ts';
import { RaceRoom, roomCodes } from '../src/rooms/RaceRoom.ts';

// Online rooms (phase 19, §24): codes, private rooms, join errors, the version check, the host, bots, reconnection.
const PORT = 2597;
const server = defineServer({ rooms: { race: defineRoom(RaceRoom).sortBy({ lobby: -1, clients: -1 } as never) } });
const client = new Client(`ws://localhost:${PORT}`);
const v = { version: GAME_VERSION };

beforeAll(async () => {
  Object.assign(config, { port: PORT, minPlayers: 2, level: 'test-flat', latencyMs: 0, maxRooms: 20 });
  await server.listen(PORT);
});
afterAll(() => server.gracefullyShutdown(false).catch(() => { /* the last test shut it down */ }));

async function waitFor<T>(what: string, fn: () => T, timeoutMs = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = fn();
    if (r) return r as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((res) => setTimeout(res, 10));
  }
}
/** The error a join rejects with (code and message). */
async function joinError(p: Promise<unknown>): Promise<{ code: number; message: string }> {
  try { await p; } catch (e) { return e as { code: number; message: string }; }
  throw new Error('the join was not refused');
}
const players = (r: Room) => [...(r.state.players?.values() ?? [])] as { id: string; name: string; bot: boolean; away: boolean }[];

test('private rooms: a unique 4-letter code, hidden from Quick Play, joinable by code', async () => {
  const a: Room = await client.create('race', { ...v, name: 'A', private: true });
  const b: Room = await client.create('race', { ...v, name: 'B', private: true });
  expect(a.roomId).toMatch(/^[A-HJ-NP-Z]{4}$/);
  expect(b.roomId).not.toBe(a.roomId);
  await waitFor('code', () => a.state.code === a.roomId);
  // Quick Play never lands in a private room: it makes a public one (no code shown).
  const q: Room = await client.joinOrCreate('race', { ...v, name: 'Q' });
  expect([a.roomId, b.roomId]).not.toContain(q.roomId);
  await waitFor('public state', () => q.state.phase === 'lobby');
  expect(q.state.code).toBe('');
  // Join with code: case is the client's job (normalizeCode), the code itself joins.
  const c: Room = await client.joinById(a.roomId, { ...v, name: 'C' });
  expect(c.roomId).toBe(a.roomId);
  await waitFor('2 in A', () => a.state.players.size === 2);
  for (const r of [a, b, q, c]) await r.leave();
});

test('join errors: no such code, a full room, a version mismatch', async () => {
  const taken = new Set(roomCodes);
  const free = ['ZZZZ', 'ZZZY', 'ZZZX'].find((c) => !taken.has(c))!;
  const missing = await joinError(client.joinById(free, { ...v, name: 'X' }));
  expect(missing.message).toMatch(/not found/);

  const host: Room = await client.create('race', { ...v, name: 'H', private: true });
  const rest = await Promise.all(Array.from({ length: 7 }, (_, i) => client.joinById(host.roomId, { ...v, name: `P${i}` })));
  const full = await joinError(client.joinById(host.roomId, { ...v, name: 'late' }));
  expect(full.message).toMatch(/locked/);

  for (const bad of [{}, { version: '0.0.0' }]) {
    const e = await joinError(client.joinOrCreate('race', { ...bad, name: 'old' }));
    expect(e.code).toBe(JOIN_ERROR.version);
  }
  await rest.pop()!.leave(); // a seat free: joining by code checks the version too
  expect((await joinError(client.joinById(host.roomId, { version: 'x', name: 'old' }))).code).toBe(JOIN_ERROR.version);
  for (const r of [host, ...rest]) await r.leave();
});

test('host: the creator, handed to the longest-connected human; names are cleaned', async () => {
  const a: Room = await client.create('race', { ...v, name: '  Ann\u0007  ', private: true });
  const b: Room = await client.joinById(a.roomId, { ...v, name: 'Bob' });
  const c: Room = await client.joinById(a.roomId, { ...v, name: 'x'.repeat(30) });
  await waitFor('3 players', () => b.state.players.size === 3);
  expect(players(b).map((p) => p.name)).toEqual(['Ann', 'Bob', 'x'.repeat(16)]);
  expect(b.state.hostId).toBe(a.sessionId);
  await a.leave();
  await waitFor('Bob hosts', () => b.state.hostId === b.sessionId);
  await b.leave();
  await waitFor('C hosts', () => c.state.hostId === c.sessionId);
  await c.leave();
});

test('bots: the host adds up to 8 and removes them; only the host can; the last human leaving disposes the room', { timeout: 20000 }, async () => {
  const a: Room = await client.create('race', { ...v, name: 'A', private: true });
  const b: Room = await client.joinById(a.roomId, { ...v, name: 'B' });
  await waitFor('2 players', () => a.state.players.size === 2);
  b.send('addBot'); // not the host: ignored
  for (let i = 0; i < 9; i++) a.send('addBot');
  await waitFor('8 players', () => a.state.players.size === 8);
  await new Promise((r) => setTimeout(r, 300));
  expect(a.state.players.size).toBe(8); // never past 8
  const bots = players(a).filter((p) => p.bot);
  expect(bots).toHaveLength(6);
  for (const p of bots) expect(p.name).toMatch(/^🤖 /);
  expect(new Set(bots.map((p) => p.name)).size).toBe(6);
  a.send('removeBot');
  a.send('removeBot');
  await waitFor('6 players', () => a.state.players.size === 6);
  // Bots ready themselves and count toward MIN_PLAYERS: the humans readying starts the round.
  a.send('ready');
  b.send('ready');
  await waitFor('countdown', () => a.state.phase === 'countdown');

  const code = a.roomId;
  await b.leave();
  await a.leave();
  await waitFor('room disposed', () => !matchMaker.getLocalRoomById(code) && !roomCodes.has(code));
});

test('difficulty: the host sets it before the match; bots are replaced at the new level', { timeout: 20000 }, async () => {
  const a: Room = await client.create('race', { ...v, name: 'A', private: true });
  a.send('addBot');
  a.send('addBot');
  await waitFor('3 players', () => a.state.players?.size === 3);
  const before = players(a).filter((p) => p.bot).map((p) => p.id);
  a.send('botLevel', 2);
  await waitFor('hard, 2 new bots', () => a.state.botLevel === 2 && players(a).filter((p) => p.bot && !before.includes(p.id)).length === 2);
  expect(a.state.players.size).toBe(3);
  a.send('botLevel', 7); // garbage: ignored
  await new Promise((r) => setTimeout(r, 100));
  expect(a.state.botLevel).toBe(2);
  await a.leave();
});

test('reconnect: a drop holds the seat (points and stats kept); past the hold the player has left', { timeout: 20000 }, async () => {
  config.reconnectSec = 1.5;
  const a: Room = await client.create('race', { ...v, name: 'A', private: true });
  const b: Room = await client.joinById(a.roomId, { ...v, name: 'B' });
  await waitFor('2 players', () => a.state.players.size === 2);
  const room = matchMaker.getLocalRoomById(a.roomId) as unknown as RaceRoom & { state: { standings: Map<string, { points: number; wins: number }> } };
  const st = room.state.standings.get(b.sessionId)!;
  st.points = 7;
  st.wins = 1;

  // An unexpected drop (MAY_TRY_RECONNECT): the SDK retries with its token and gets the same seat back.
  b.reconnection.minUptime = 0;
  const id = b.sessionId;
  let dropped = false, back = false;
  b.onDrop(() => { dropped = true; });
  b.onReconnect(() => { back = true; });
  b.connection.close(4010);
  await waitFor('away', () => players(a).find((p) => p.id === id)?.away);
  await waitFor('reconnected', () => dropped && back);
  await waitFor('back', () => players(a).find((p) => p.id === id)?.away === false);
  expect(b.sessionId).toBe(id);
  expect(room.state.standings.get(id)).toMatchObject({ points: 7, wins: 1 });

  // No reconnect this time: after the hold it's a normal leave (points stay on the board, greyed).
  b.reconnection.enabled = false;
  b.connection.close(4010);
  await waitFor('away again', () => players(a).find((p) => p.id === id)?.away);
  await new Promise((r) => setTimeout(r, 700));
  expect(a.state.players.has(id)).toBe(true); // still held
  await waitFor('left', () => !a.state.players.has(id), 3000);
  expect(a.state.standings.get(id)).toMatchObject({ points: 7, left: true });
  config.reconnectSec = 20;
  await a.leave();
});

test('MAX_ROOMS: creating past the cap is refused as "server full"', async () => {
  const open = roomCodes.size;
  config.maxRooms = open + 1;
  const a: Room = await client.create('race', { ...v, name: 'A', private: true });
  expect((await joinError(client.create('race', { ...v, name: 'B', private: true }))).code).toBe(JOIN_ERROR.serverFull);
  expect((await joinError(client.create('race', { ...v, name: 'C' }))).code).toBe(JOIN_ERROR.serverFull);
  await a.leave();
  await waitFor('room gone', () => roomCodes.size === open);
  config.maxRooms = 20;
});

// Last: this shuts the server down.
test('shutdown (a deploy): rooms get "Server restarting", then close about 3 s later', { timeout: 15000 }, async () => {
  const a: Room = await client.create('race', { ...v, name: 'A', private: true });
  let notice = '', noticeAt = 0, closedAt = 0, code = 0;
  a.onMessage('notice', (t: string) => { notice = t; noticeAt = Date.now(); });
  a.onLeave((c) => { code = c; closedAt = Date.now(); });
  void server.gracefullyShutdown(false);
  await waitFor('closed', () => closedAt, 10000);
  expect(notice).toBe('Server restarting');
  expect(closedAt - noticeAt).toBeGreaterThanOrEqual(2900);
  expect(code).toBe(4001); // SERVER_SHUTDOWN: the client says the server restarted
});
