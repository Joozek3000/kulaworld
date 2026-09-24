import { parseArgs } from 'node:util';
import { Client, type Room } from '@colyseus/sdk';
import type { SimEvent } from '@kula/shared';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1' },
    behaviour: { type: 'string', default: 'wander' },
    duration: { type: 'string' }, // seconds; default: run until Ctrl+C
    server: { type: 'string', default: 'ws://localhost:2567' },
  },
});
const count = Number(values.count);
const duration = values.duration === undefined ? Infinity : Number(values.duration);
if (!Number.isInteger(count) || count < 1) throw new Error(`--count must be a positive integer, got ${values.count}`);
if (!(duration > 0)) throw new Error(`--duration must be a positive number of seconds, got ${values.duration}`);
if (values.behaviour !== 'wander') throw new Error(`unknown --behaviour ${values.behaviour} (available: wander)`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (a: number, b: number) => a + Math.random() * (b - a);

interface Stats { rounds: number; wins: number; keys: number; deaths: number; hops: number }

/** Retries joinOrCreate for up to 30 s, so bots can start before the server is up. */
async function connect(client: Client, name: string): Promise<Room> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await client.joinOrCreate('race', { name });
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await sleep(1000);
    }
  }
}

/** wander: ready up in the lobby; while playing hold forward and send a random turn/jump/hop pulse every 300-1200 ms. */
async function runBot(client: Client, name: string): Promise<Stats> {
  const room = await connect(client, name);
  const stats: Stats = { rounds: 0, wins: 0, keys: 0, deaths: 0, hops: 0 };
  const me = () => room.state.players?.get(room.sessionId);
  let seq = 0;
  let nextPulseAt = 0;
  let wasPlaying = false;

  room.onMessage('event', (e: SimEvent) => {
    if (e.type === 'win') {
      stats.rounds++;
      if (e.winnerId === room.sessionId) stats.wins++;
      return;
    }
    if (e.playerId !== room.sessionId) return;
    if (e.type === 'key') { stats.keys++; console.log(`${name}: key (${e.keys} this round)`); }
    if (e.type === 'death') { stats.deaths++; console.log(`${name}: died at ${e.cell.x},${e.cell.y},${e.cell.z}`); }
  });

  const timer = setInterval(() => {
    const p = me();
    const phase: string = room.state.phase;
    if (!p) return;
    if (phase === 'lobby' && !p.ready) {
      room.send('ready');
      return;
    }
    const playing = phase === 'playing' && !p.spectating;
    if (playing && (!wasPlaying || Date.now() >= nextPulseAt)) {
      // 10% hop (jump with fwd released for this message), 30% left, 30% right, 20% forward jump, 10% just roll.
      const r = wasPlaying ? Math.random() : 1;
      const hop = r < 0.1;
      const pulse = { turn: r < 0.1 ? 0 : r < 0.4 ? -1 : r < 0.7 ? 1 : 0, jump: hop || (r >= 0.7 && r < 0.9) } as const;
      room.send('input', { seq: ++seq, fwdHeld: !hop, ...pulse });
      if (hop) stats.hops++;
      nextPulseAt = Date.now() + (hop ? 600 : between(300, 1200)); // after a hop, resume holding fwd soon
    }
    wasPlaying = playing;
  }, 100);

  await new Promise<void>((resolve) => {
    room.onLeave(() => resolve());
    if (duration !== Infinity) setTimeout(() => room.leave().catch(() => resolve()), duration * 1000);
    process.once('SIGINT', () => room.leave().catch(() => resolve()));
  });
  clearInterval(timer);
  return stats;
}

console.log(`spawning ${count} ${values.behaviour} bot(s) → ${values.server}${duration !== Infinity ? ` for ${duration}s` : ''}`);
const client = new Client(values.server);
const names = Array.from({ length: count }, (_, i) => `bot-${i + 1}`);
const results = await Promise.allSettled(names.map((n) => runBot(client, n)));

console.log('\nsummary');
results.forEach((r, i) => {
  if (r.status === 'rejected') console.log(`  ${names[i]}: failed (${r.reason?.message ?? r.reason})`);
  else console.log(`  ${names[i]}: rounds ${r.value.rounds}, wins ${r.value.wins}, keys ${r.value.keys}, deaths ${r.value.deaths}, hops sent ${r.value.hops}`);
});
process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
