import { parseArgs } from 'node:util';
import { Client, Callbacks } from '@colyseus/sdk';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1' },
    behaviour: { type: 'string', default: 'wander' },
    server: { type: 'string', default: 'ws://localhost:2567' },
  },
});
const count = Number(values.count);
if (!Number.isInteger(count) || count < 1) throw new Error(`--count must be a positive integer, got ${values.count}`);
console.log(`spawning ${count} bot(s), behaviour=${values.behaviour} (behaviours arrive in phase 03)`);

const client = new Client(values.server);
for (let i = 1; i <= count; i++) {
  const name = `bot-${i}`;
  const room = await client.joinOrCreate('race', { name });
  const log = () => console.log(`${name}: ${room.state.players.size} players`);
  Callbacks.get(room).onAdd('players', log);
  Callbacks.get(room).onRemove('players', log);
}
console.log('bots connected, Ctrl+C to quit');
