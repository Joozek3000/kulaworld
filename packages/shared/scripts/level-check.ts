// Validates every levels/*.json and prints a summary. Exit code 1 on any error.
import { readdirSync, readFileSync } from 'node:fs';
import { cellKey, dirName, loadLevel, validateLevel } from '../src/index.ts';

const dir = new URL('../../../levels/', import.meta.url);
let failed = false;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const level = loadLevel(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
  const errors = validateLevel(level);
  failed ||= errors.length > 0;
  console.log(`${errors.length ? 'FAIL' : 'ok  '} ${file} (${level.id})`);
  console.log(`     blocks ${level.solid.size}, AABB ${cellKey(level.min)} .. ${cellKey(level.max)}`);
  console.log(`     spawns ${level.spawns.map((s) => `${cellKey(s.cell)} ${dirName(s.up)}/${dirName(s.fwd)}`).join(' | ')}`);
  console.log(`     keys ${level.keys.length} (need ${level.keysRequired}): ${level.keys.map((k) => cellKey(k.cell)).join(' | ')}; exit ${cellKey(level.exit.cell)}`);
  for (const e of errors) console.log(`     ! ${e}`);
}
process.exit(failed ? 1 : 0);
