// Trap usage per pool level (phase 14), as a markdown table: mode, blocks, tiles by type, keys, spawns.
import { readdirSync, readFileSync } from 'node:fs';
import { loadLevel, type TileType } from '../src/index.ts';

const TYPES: TileType[] = ['spikes', 'fire', 'crumble', 'ice', 'arrow', 'boost'];
const dir = new URL('../../../levels/', import.meta.url);
const pool = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => loadLevel(JSON.parse(readFileSync(new URL(f, dir), 'utf8')))).filter((l) => l.pool);

const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
console.log(row(['level', 'mode', 'blocks', ...TYPES, 'keys', 'spawns']));
console.log(row(['---', '---', ...Array(TYPES.length + 3).fill('---:')]));
for (const l of pool) {
  const n = (t: TileType) => l.tiles.filter((x) => x.type === t).length || '·';
  console.log(row([`${l.id} ${l.name}`, l.mode, l.solid.size, ...TYPES.map(n), l.mode === 'race' ? `${l.keys.length} (need ${l.keysRequired})` : '·', l.spawns.length]));
}
console.log(row(['**levels using it**', '', '', ...TYPES.map((t) => pool.filter((l) => l.tiles.some((x) => x.type === t)).length), '', '']));
