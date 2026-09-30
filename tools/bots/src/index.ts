import { parseArgs } from 'node:util';
import { Client, type Room } from '@colyseus/sdk';
import { GAME_VERSION } from '@kula/shared';
import { BEHAVIOURS, runBot, type Behaviour } from './brain.ts';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1' },
    behaviour: { type: 'string', default: 'wander' }, // comma list, assigned round-robin: seek,wander,bully,blocker,rival
    duration: { type: 'string' }, // seconds; default: run until Ctrl+C
    server: { type: 'string', default: 'ws://localhost:2567' },
    skill: { type: 'string', default: '0.5' }, // 0..1: reaction speed and reliability; 1 = instant, never misses
    length: { type: 'string', default: 'random' }, // match-length vote (phase 18): 3, 5, 7 or random
  },
});
const count = Number(values.count);
const duration = values.duration === undefined ? Infinity : Number(values.duration);
const behaviours = values.behaviour.split(',').map((b) => b.trim());
if (!Number.isInteger(count) || count < 1) throw new Error(`--count must be a positive integer, got ${values.count}`);
if (!(duration > 0)) throw new Error(`--duration must be a positive number of seconds, got ${values.duration}`);
for (const b of behaviours) if (!BEHAVIOURS.includes(b as Behaviour)) throw new Error(`unknown --behaviour ${b} (available: ${BEHAVIOURS.join(', ')})`);
const skill = Number(values.skill);
if (!(skill >= 0 && skill <= 1)) throw new Error(`--skill must be 0..1, got ${values.skill}`);
const lengthVote = values.length === 'random' ? -1 : [3, 5, 7].indexOf(Number(values.length));
if (values.length !== 'random' && lengthVote < 0) throw new Error(`--length must be 3, 5, 7 or random, got ${values.length}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries joinOrCreate for up to 30 s, so bots can start before the server is up. */
async function connect(client: Client, name: string): Promise<Room> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await client.joinOrCreate('race', { name, version: GAME_VERSION });
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await sleep(1000);
    }
  }
}

const assigned = Array.from({ length: count }, (_, i) => behaviours[i % behaviours.length] as Behaviour);
console.log(`spawning ${count} bot(s) [${assigned.join(', ')}] → ${values.server}${duration !== Infinity ? ` for ${duration}s` : ''}, skill ${skill}`);
const client = new Client(values.server);
const names = assigned.map((b, i) => `${b}-${i + 1}`);
const results = await Promise.allSettled(names.map(async (n, i) => {
  const room = await connect(client, n);
  if (duration !== Infinity) setTimeout(() => void room.leave().catch(() => {}), duration * 1000);
  process.once('SIGINT', () => void room.leave().catch(() => {}));
  return runBot(room, n, assigned[i], { skill, lengthVote });
}));

console.log('\nsummary');
results.forEach((r, i) => {
  if (r.status === 'rejected') console.log(`  ${names[i]}: failed (${r.reason?.message ?? r.reason})`);
  else {
    const v = r.value;
    console.log(`  ${names[i]}: rounds ${v.rounds}, wins ${v.wins}, keys ${v.keys}, deaths ${v.deaths}, hops ${v.hops}, replans ${v.replans}, stuck ${v.stuck}, pushes ${v.pushes}, bounces ${v.bounces}, knockouts ${v.knockouts}, keyDrops ${v.keyDrops}, livesLost ${v.livesLost}, eliminated ${v.eliminated}, stomps ${v.stomps}, stomped ${v.stomped}, clashes ${v.clashes}, dodges ${v.dodges}, missedDodges ${v.missedDodges}, detours ${v.detours}, heatEscapes ${v.heatEscapes}, burns ${v.burns}, cradles ${v.cradles}, edgePushes ${v.edgePushes}, headOns ${v.headOns}, sideHits ${v.sideHits}/${v.sideTries}, teleports ${v.teleports}, zapped ${v.zapped}, toggles ${v.toggles}, pills ${Object.entries(v.pills).map(([k, n]) => `${k}:${n}`).join(' ') || 'none'} (detours ${v.pillDetours}), rival hunts ${v.rivalHunts}`);
  }
});
process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
