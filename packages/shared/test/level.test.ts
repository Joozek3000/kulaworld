import { describe, expect, test } from 'vitest';
import { loadLevel, validateLevel, vec, type LevelJson } from '../src/index.ts';
import { levelFiles, levelJson, readLevelJson, row } from './util.ts';

describe('levels/', () => {
  test('has the required levels', () => {
    expect(levelFiles()).toEqual(expect.arrayContaining(['test-flat.json', 'test-cube.json']));
  });
  test.each(levelFiles())('%s validates', (file) => {
    expect(validateLevel(loadLevel(readLevelJson(file)))).toEqual([]);
  });
});

describe('loadLevel', () => {
  test('expands solid and hollow boxes and computes the AABB', () => {
    const solid = loadLevel({ ...levelJson([], []), boxes: [{ min: [0, 0, 0], max: [2, 2, 2] }] });
    expect(solid.solid.size).toBe(27);
    const hollow = loadLevel({ ...levelJson([[5, -1, 0]], []), boxes: [{ min: [0, 0, 0], max: [2, 2, 2], hollow: true }] });
    expect(hollow.solid.size).toBe(27);
    expect(hollow.solid.has('1,1,1')).toBe(false);
    expect(hollow.min).toEqual(vec(0, -1, 0));
    expect(hollow.max).toEqual(vec(5, 2, 2));
  });

  test('throws on an invalid dir string', () => {
    const json = levelJson(row(0, 2), [[[0, 1, 0], '+Y', '+X']]);
    json.spawns[0].up = 'up' as never;
    expect(() => loadLevel(json)).toThrow(/invalid dir/);
  });
});

describe('validateLevel', () => {
  const valid = (): LevelJson => levelJson(row(0, 8), [
    [[0, 1, 0], '+Y', '+X'], [[2, 1, 0], '+Y', '+X'], [[4, 1, 0], '+Y', '+X'], [[6, 1, 0], '+Y', '+X'],
  ], { keys: [{ cell: [8, 1, 0], up: '+Y' }], exit: { cell: [7, 1, 0], up: '+Y' }, keysRequired: 1 });

  test('valid fixture has no errors', () => expect(validateLevel(loadLevel(valid()))).toEqual([]));

  const cases: [string, (j: LevelJson) => void, RegExp][] = [
    ['spawn inside a block', (j) => { j.spawns[0].cell = [0, 0, 0]; }, /spawn 0 .* inside a block/],
    ['key with nothing under it', (j) => { j.keys[0].cell = [8, 3, 0]; }, /key 0 .* no block under it/],
    ['exit on the wrong face', (j) => { j.exit.up = '-Y'; }, /exit .* no block under it/],
    ['fwd parallel to up', (j) => { j.spawns[1].fwd = '-Y'; }, /spawn 1: fwd -Y is not perpendicular/],
    ['fewer than 4 spawns', (j) => { j.spawns.pop(); }, /at least 4 spawns/],
    ['duplicate item cells', (j) => { j.exit.cell = [8, 1, 0]; }, /exit .* shares its cell with key 0/],
    ['not enough keys', (j) => { j.keysRequired = 2; }, /keysRequired 2 > 1 keys/],
    ['no blocks', (j) => { j.blocks = []; }, /no blocks/],
  ];
  test.each(cases)('%s', (_, mutate, expected) => {
    const json = valid();
    mutate(json);
    const errors = validateLevel(loadLevel(json));
    expect(errors.some((e) => expected.test(e)), errors.join('\n')).toBe(true);
  });
});
