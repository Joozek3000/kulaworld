import { defineServer, defineRoom } from 'colyseus';
import { VERSION } from '@kula/shared';
import { config } from './config.ts';
import { loadLevelFile, RaceRoom } from './rooms/RaceRoom.ts';

loadLevelFile(config.level); // fail fast on an invalid level

const server = defineServer({ rooms: { race: defineRoom(RaceRoom) } });
if (config.latencyMs) server.simulateLatency(config.latencyMs);
await server.listen(config.port);
console.log(`kulaworld server v${VERSION} on :${config.port}, level ${config.level}, min players ${config.minPlayers}, latency ${config.latencyMs} ms`);
