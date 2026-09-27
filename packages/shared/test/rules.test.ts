import { describe, expect, test } from 'vitest';
import { checkTrapRules, lanePassable, loadLevel, type LevelJson, type Tile, type TileJson } from '../src/index.ts';
import { levelFiles, levelJson, readLevelJson, type Spawn } from './util.ts';

// LEVEL-DESIGN.md rules (phase 14b). The base: a 9×9 plate at y=0, spawns on its corners, a key in the middle and
// the exit two tiles further. It breaks no rule; each fixture adds one mistake.
type V3 = [number, number, number];
const plate = (): V3[] => { const b: V3[] = []; for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) b.push([x, 0, z]); return b; };
const corners: Spawn[] = [[[0, 1, 0], '+Y', '+X'], [[8, 1, 0], '+Y', '-X'], [[0, 1, 8], '+Y', '+X'], [[8, 1, 8], '+Y', '-X']];
const base = (extra: Partial<LevelJson> = {}, blocks = plate()): LevelJson =>
  levelJson(blocks, corners, { keys: [{ cell: [4, 1, 4], up: '+Y' }], exit: { cell: [4, 1, 6], up: '+Y' }, keysRequired: 1, ...extra });
const top = (x: number, z: number, type: TileJson['type'], more: Partial<TileJson> = {}): TileJson => ({ block: [x, 0, z], face: '+Y', type, ...more });
const under = (x: number, z: number, type: TileJson['type'], more: Partial<TileJson> = {}): TileJson => ({ block: [x, 0, z], face: '-Y', type, ...more });
const block = (x: number, z: number, type: TileJson['type'], more: Partial<TileJson> = {}): TileJson => ({ block: [x, 0, z], type, ...more });
const errors = (json: LevelJson) => checkTrapRules(loadLevel(json)).filter((f) => f.error).map((f) => f.rule);

test('the base fixture breaks no rule', () => {
  expect(checkTrapRules(loadLevel(base()))).toEqual([]);
});

const ring2 = (): TileJson[] => { // a 2-wide ring of spikes round the key: too wide to jump
  const t: TileJson[] = [];
  for (let x = 2; x <= 6; x++) for (let z = 2; z <= 6; z++) if (Math.max(Math.abs(x - 4), Math.abs(z - 4)) >= 1) t.push(top(x, z, 'spikes'));
  return t;
};

// 5.1: a 2×2 arrow loop at x 5..6, z 1..2, walled in at y=1 (a jump along an arrow hits the wall: a short jump inside).
const arrowLoop = (): TileJson[] => [top(5, 1, 'arrow', { dir: '+X' }), top(6, 1, 'arrow', { dir: '+Z' }), top(6, 2, 'arrow', { dir: '-X' }), top(5, 2, 'arrow', { dir: '-Z' })];
const wallRing = (): V3[] => {
  const b: V3[] = [];
  for (let x = 4; x <= 7; x++) for (let z = 0; z <= 3; z++) if (x === 4 || x === 7 || z === 0 || z === 3) b.push([x, 1, z]);
  return b;
};

describe('one failing fixture per [E] rule', () => {
  const cases: [string, LevelJson][] = [
    ['1.1', base({ tiles: [block(0, 0, 'crumble')] })], // on a spawn tile
    ['1.2', base({ tiles: [block(2, 0, 'ice')] })], // 2 moves from the spawn at (0,0)
    ['2.1', base({ tiles: [top(4, 4, 'arrow', { dir: '+X' })] })], // on the key tile
    ['2.2', base({ tiles: ring2(), exit: { cell: [4, 1, 8], up: '+Y' } })], // the key walled in by spikes
    ['3.1', base({ tiles: [top(4, 0, 'spikes')] })], // an edge tile: you flip onto it from the side
    ['3.2', base({ tiles: [{ block: [4, 1, 2], face: '-Z', type: 'spikes' }] }, [...plate(), [4, 1, 2]])], // the first tile up a wall
    ['3.3', base({ tiles: [top(8, 3, 'boost', { dir: '+X', deathtrap: true }), top(8, 5, 'boost', { dir: '+X', deathtrap: true })] })], // two deathtraps
    ['4.1', base({ tiles: [top(4, 2, 'spikes', { period: 20, up: 10 })] })], // too fast
    ['4.2', base({ tiles: [2, 3, 4, 5].map((x) => top(x, 3, 'spikes', { period: 30, up: 18, phase: 0 })) })], // no green wave
    ['5.1', base({ tiles: arrowLoop() }, [...plate(), ...wallRing()])], // climb in over the wall, then the arrows never let you out
    ['5.2', base({ keys: [{ cell: [12, 1, 4], up: '+Y' }], tiles: [block(9, 4, 'crumble'), block(10, 4, 'crumble')] }, [...plate(), [9, 0, 4], [10, 0, 4], [11, 0, 3], [11, 0, 4], [11, 0, 5], [12, 0, 3], [12, 0, 4], [12, 0, 5]])],
    ['6.1', base({ tiles: [block(9, 4, 'ice'), block(10, 4, 'ice')] }, [...plate(), [9, 0, 4], [10, 0, 4]])], // a thin ice beam: across it, the slide circles it
    ['6.2', base({ tiles: [top(8, 4, 'boost', { dir: '+X' })] })], // launches into the void
    ['6.2', base({ tiles: [top(3, 0, 'boost', { dir: '+Z' })] })], // 3 moves from a spawn
    ['7.1', base({ tiles: [1, 2, 3, 4, 5, 6, 7].flatMap((x) => [1, 2, 3].map((z) => under(x, z, 'spikes'))) })], // 21 of 198 tiles
    ['7.2', base({ tiles: [3, 4, 5].flatMap((x) => [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((z) => z !== 4 && z !== 6).map((z) => block(x, z, 'crumble'))).concat([1, 7].flatMap((x) => [3, 4, 5].map((z) => block(x, z, 'crumble')))) })],
    ['7.3', base({ pool: true, tiles: [top(4, 2, 'spikes')] })], // one trap type
  ];
  test.each(cases)('%s', (rule, json) => {
    expect(errors(json)).toContain(rule);
  });

  test('3.3: a deathtrap is allowed once in race, never in knockout, never on the only route to a key', () => {
    const once = base({ tiles: [top(8, 4, 'boost', { dir: '+X', deathtrap: true })] });
    expect(errors(once)).toEqual([]);
    const knockout = { ...once, mode: 'knockout' as const, lives: 3, crumble: { startSec: 45, intervalSec: 10, warnSec: 2 }, keys: undefined, exit: undefined, keysRequired: undefined };
    expect(errors(knockout)).toContain('3.3');
    // An ice runway to the key island whose slide overshoots into spikes, marked a deathtrap: the only way there.
    const blocks: V3[] = [...plate(), [9, 0, 4], [10, 0, 4], [11, 0, 4], [12, 0, 4]];
    const only = base({ keys: [{ cell: [12, 1, 4], up: '+Y' }], tiles: [top(8, 4, 'boost', { dir: '+X', deathtrap: true, variant: 'far' })] }, blocks.filter((b) => b[0] !== 9 && b[0] !== 10));
    expect(errors(only)).toContain('3.3');
  });

  test('7.2: a theme type is exempt from the modifier cap', () => {
    const ice = base({ theme: 'ice', tiles: [3, 4, 5].flatMap((x) => [2, 3, 4, 5, 6].filter((z) => z !== 4 && z !== 6).map((z) => block(x, z, 'ice'))) });
    expect(errors(base({ tiles: ice.tiles }))).not.toContain('7.2');
    expect(errors(ice)).not.toContain('7.2');
  });
});

describe('4.2: retracting spikes in a lane, simulated at walking speed (ROLL_TICKS per tile)', () => {
  const spike = (phase: number): Tile => ({ block: { x: 0, y: 0, z: 0 }, type: 'spikes', face: 2, regrowTicks: 0, period: 30, upTicks: 18, phase, dir: null, variant: 'far', deathtrap: false, regrows: false });
  test('a phase-staggered lane (a green wave, 5 ticks per tile) passes', () => {
    expect(lanePassable([null, spike(0), spike(25), spike(20), spike(15), null])).toBe(true);
  });
  test('the same lane unstaggered fails: 4 tiles take 15 ticks, the down window is 12', () => {
    expect(lanePassable([null, spike(0), spike(0), spike(0), spike(0), null])).toBe(false);
  });
  test('a safe tile between two unstaggered spikes lets you wait: it passes', () => {
    expect(lanePassable([null, spike(0), spike(0), null, spike(0), spike(0), null])).toBe(true);
  });
  test('checkTrapRules walks each lane both ways: a one-way green wave fails, a down window covering the walk passes', () => {
    const wave = [0, 25, 20, 15];
    expect(errors(base({ tiles: [2, 3, 4, 5].map((x, i) => top(x, 3, 'spikes', { period: 30, up: 18, phase: wave[i] })) }))).toContain('4.2');
    expect(errors(base({ tiles: [2, 3, 4, 5].map((x) => top(x, 3, 'spikes', { period: 60, up: 24, phase: 0 })) }))).not.toContain('4.2');
  });
});

test.each(levelFiles().filter((f) => readLevelJson(f).pool))('pool level %s: no [E] trap rule broken, every warning noted', (file) => {
  const findings = checkTrapRules(loadLevel(readLevelJson(file)));
  expect(findings.filter((f) => f.error)).toEqual([]);
  expect(findings.filter((f) => !f.note)).toEqual([]);
});
