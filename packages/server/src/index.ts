import { defineServer, defineRoom } from 'colyseus';
import { VERSION } from '@kula/shared';
import { config } from './config.ts';
import { levelPool, RaceRoom } from './rooms/RaceRoom.ts';

const pool = levelPool().map((l) => l.id); // fail fast on an invalid level or an empty pool

const server = defineServer({ rooms: { race: defineRoom(RaceRoom) } });
if (config.latencyMs) server.simulateLatency(config.latencyMs);
await server.listen(config.port);
console.log(`kulaworld server v${VERSION} on :${config.port}, levels ${config.level ? `${pool.join(',')} (LEVEL override)` : `${pool.join(',')} (pool)`}, min players ${config.minPlayers}, latency ${config.latencyMs} ms`);
