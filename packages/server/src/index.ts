import { defineServer, defineRoom } from 'colyseus';
import { VERSION } from '@kula/shared';
import { RaceRoom } from './rooms/RaceRoom.ts';

try { process.loadEnvFile(new URL('../../../.env', import.meta.url)); } catch { /* no .env */ }

const port = Number(process.env.PORT ?? 2567);
const server = defineServer({ rooms: { race: defineRoom(RaceRoom) } });
server.listen(port);
console.log(`kulaworld server v${VERSION} on :${port}`);
