import { expect, test } from 'vitest';
import { loadLevel, lintCorridors } from '../src/index.ts';
import { levelJson, row, type Spawn } from './util.ts';

const spawns: Spawn[] = [[[1, 1, 0], '+Y', '+X'], [[2, 1, 0], '+Y', '+X'], [[3, 1, 0], '+Y', '+X'], [[4, 1, 0], '+Y', '+X']];

test('a 1-wide beam is a corridor with a way round (its underside and sides): no warning', () => {
  const found = lintCorridors(loadLevel(levelJson(row(0, 8), spawns)));
  expect(found.length).toBeGreaterThan(0);
  expect(found.every((c) => c.detour !== null)).toBe(true);
});

test('a sealed tube: the only way from one end to the other is through it → warning', () => {
  const blocks: [number, number, number][] = [];
  for (let x = 0; x <= 7; x++) blocks.push([x, 0, 0], [x, 2, 0], [x, 1, -1], [x, 1, 1]); // floor, ceiling, walls
  blocks.push([0, 1, 0], [7, 1, 0]); // end caps
  const found = lintCorridors(loadLevel(levelJson(blocks, spawns)));
  expect(found.some((c) => c.length === 6 && c.from.x === 1 && c.to.x === 6 && c.detour === null)).toBe(true);
});
