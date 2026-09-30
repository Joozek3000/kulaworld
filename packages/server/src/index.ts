import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { defineServer, defineRoom, matchMaker } from 'colyseus';
import { GAME_VERSION } from '@kula/shared';
import { config } from './config.ts';
import { levelPool, RaceRoom, roomCodes } from './rooms/RaceRoom.ts';

const pool = levelPool().map((l) => l.id); // fail fast on an invalid level or an empty pool
/** The built client (phase 19, §24): served from the same origin as the rooms, when it's been built. */
const DIST = fileURLToPath(new URL('../../client/dist/', import.meta.url));

const server = defineServer({
  greet: false,
  // Quick Play (§24): a public room in its lobby first, then the fullest.
  rooms: { race: defineRoom(RaceRoom).sortBy({ lobby: -1, clients: -1 } as never) },
  express: (app) => {
    app.get('/health', async (_req, res) => {
      const rooms = await matchMaker.query({ name: 'race' });
      res.json({ version: GAME_VERSION, rooms: roomCodes.size, players: rooms.reduce((n, r) => n + r.clients, 0) });
    });
    if (!existsSync(DIST)) return console.log('no client build (packages/client/dist): serving rooms only');
    // Hashed bundles never change; index.html always revalidates so a deploy is picked up on the next load.
    app.use('/assets', express.static(`${DIST}assets`, { immutable: true, maxAge: '1y' }));
    app.use(express.static(DIST, { setHeaders: (res, path) => { if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
  },
});
if (config.latencyMs) server.simulateLatency(config.latencyMs);
// Colyseus shuts down on the first SIGTERM (once). Fly can send a second one a second later during a deploy, which would
// kill the process before rooms get their ~3 s "Server restarting" grace; with a listener, repeats are ignored.
process.on('SIGTERM', () => {});
await server.listen(config.port, '0.0.0.0');
console.log(`kulaworld server v${GAME_VERSION} on 0.0.0.0:${config.port}, levels ${pool.join(',')} (${config.level ? 'LEVEL override' : 'pool'}), min players ${config.minPlayers}, max rooms ${config.maxRooms}, latency ${config.latencyMs} ms`);
