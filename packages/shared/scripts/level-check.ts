// Validates every levels/*.json and prints a summary. Exit code 1 on any error.
import { readdirSync, readFileSync } from 'node:fs';
import { cellKey, crumbleBands, dirName, lintCorridors, loadLevel, validateLevel } from '../src/index.ts';

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
  // Lint (phase 12, warnings only): 1-wide corridors with no way round, where balls get stuck behind each other.
  for (const c of lintCorridors(level)) {
    const where = `corridor ${c.length} long on ${dirName(c.up)} along ${dirName(c.along)}: ${cellKey(c.from)} .. ${cellKey(c.to)}`;
    if (c.detour === null) console.log(`     ! warning: ${where}, no way round`);
    else console.log(`     ~ ${where}, way round ${c.detour} moves (through: ${c.length - 1})`);
  }
}
process.exit(failed ? 1 : 0);
