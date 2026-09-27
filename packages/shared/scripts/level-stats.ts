// Trap usage per pool level (phase 14), as a markdown table: mode, blocks, tiles by type, lasers, invisible and
// vanishing blocks (13b), keys, spawns.
import { readdirSync, readFileSync } from 'node:fs';
import { loadLevel, type Level, type TileType } from '../src/index.ts';

const TYPES: TileType[] = ['spikes', 'fire', 'crumble', 'ice', 'arrow', 'boost', 'teleport', 'switch'];
const EXTRA = ['lasers', 'invisible', 'vanish'] as const;
const extra = (l: Level, k: (typeof EXTRA)[number]) => (k === 'lasers' ? l.lasers.length : k === 'invisible' ? l.invisible.size : l.vanish.size);
const dir = new URL('../../../levels/', import.meta.url);
const pool = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => loadLevel(JSON.parse(readFileSync(new URL(f, dir), 'utf8')))).filter((l) => l.pool);

const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
console.log(row(['level', 'mode', 'blocks', ...TYPES, ...EXTRA, 'keys', 'spawns']));
console.log(row(['---', '---', ...Array(TYPES.length + EXTRA.length + 3).fill('---:')]));
for (const l of pool) {
  const n = (t: TileType) => l.tiles.filter((x) => x.type === t).length || '·';
  console.log(row([`${l.id} ${l.name}`, l.mode, l.solid.size, ...TYPES.map(n), ...EXTRA.map((k) => extra(l, k) || '·'),
    l.mode === 'race' ? `${l.keys.length} (need ${l.keysRequired})` : '·', l.spawns.length]));
}
console.log(row(['**levels using it**', '', '', ...TYPES.map((t) => pool.filter((l) => l.tiles.some((x) => x.type === t)).length),
  ...EXTRA.map((k) => pool.filter((l) => extra(l, k)).length), '', '']));
