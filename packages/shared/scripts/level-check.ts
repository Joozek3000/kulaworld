// Validates every levels/*.json and prints a summary. Exit code 1 on any error.
import { readdirSync, readFileSync } from 'node:fs';
import { cellKey, crumbleBands, dirName, loadLevel, validateLevel } from '../src/index.ts';

const dir = new URL('../../../levels/', import.meta.url);
let failed = false;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const level = loadLevel(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
  const errors = validateLevel(level);
  failed ||= errors.length > 0;
  console.log(`${errors.length ? 'FAIL' : 'ok  '} ${file} (${level.id}, ${level.mode})`);
  console.log(`     blocks ${level.solid.size}, AABB ${cellKey(level.min)} .. ${cellKey(level.max)}`);
  console.log(`     spawns ${level.spawns.map((s) => `${cellKey(s.cell)} ${dirName(s.up)}/${dirName(s.fwd)}`).join(' | ')}`);
  if (level.mode === 'race') console.log(`     keys ${level.keys.length} (need ${level.keysRequired}): ${level.keys.map((k) => cellKey(k.cell)).join(' | ')}; exit ${level.exit ? cellKey(level.exit.cell) : '-'}`);
  else console.log(`     lives ${level.lives}, crumble ${JSON.stringify(level.crumble)}, bands ${crumbleBands(level).map((b) => b.length).join('/')}`);
  for (const e of errors) console.log(`     ! ${e}`);
}
process.exit(failed ? 1 : 0);
