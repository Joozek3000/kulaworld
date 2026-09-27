// Validates every levels/*.json and prints a summary. Exit code 1 on any error.
import { readdirSync, readFileSync } from 'node:fs';
import { cellKey, checkTrapRules, crumbleBands, dirName, findingId, lintCorridors, loadLevel, validateLevel } from '../src/index.ts';

const dir = new URL('../../../levels/', import.meta.url);
let failed = false;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const level = loadLevel(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
  const errors = validateLevel(level);
  // Trap placement rules (docs/LEVEL-DESIGN.md): [E] errors fail pool levels, [W] warnings unless noted in `notes`.
  const findings = checkTrapRules(level);
  const trapErrors = findings.filter((f) => f.error).length;
  const bad = errors.length > 0 || (level.pool && trapErrors > 0);
  failed ||= bad;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${file} (${level.id}, ${level.mode}${level.pool ? ', pool' : ''})`);
  console.log(`     blocks ${level.solid.size}, AABB ${cellKey(level.min)} .. ${cellKey(level.max)}`);
  console.log(`     spawns ${level.spawns.map((s) => `${cellKey(s.cell)} ${dirName(s.up)}/${dirName(s.fwd)}`).join(' | ')}`);
  if (level.mode === 'race') console.log(`     keys ${level.keys.length} (need ${level.keysRequired}): ${level.keys.map((k) => cellKey(k.cell)).join(' | ')}; exit ${level.exit ? cellKey(level.exit.cell) : '-'}`);
  else console.log(`     lives ${level.lives}, crumble ${JSON.stringify(level.crumble)}, bands ${crumbleBands(level).map((b) => b.length).join('/')}`);
  for (const e of errors) console.log(`     ! ${e}`);
  for (const f of findings) {
    const tag = f.error ? 'E' : f.note ? 'noted' : 'W';
    console.log(`     ${f.error ? '!' : '~'} [${tag}] ${findingId(f)}: ${f.msg}${f.note ? ` (${f.note})` : ''}`);
  }
  console.log(`     rules: ${trapErrors} error(s), ${findings.filter((f) => !f.error && !f.note).length} warning(s), ${findings.filter((f) => f.note).length} noted${level.pool ? '' : ' (not in the pool: errors are informational)'}`);
  // Lint (phase 12, warnings only): 1-wide corridors with no way round, where balls get stuck behind each other.
  for (const c of lintCorridors(level)) {
    const where = `corridor ${c.length} long on ${dirName(c.up)} along ${dirName(c.along)}: ${cellKey(c.from)} .. ${cellKey(c.to)}`;
    if (c.detour === null) console.log(`     ! warning: ${where}, no way round`);
    else console.log(`     ~ ${where}, way round ${c.detour} moves (through: ${c.length - 1})`);
  }
}
process.exit(failed ? 1 : 0);
