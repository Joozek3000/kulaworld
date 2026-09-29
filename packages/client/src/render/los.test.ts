import { expect, test } from 'vitest';
import { lineClear } from './los.ts';

// Line of sight over the block grid (phase 18c).
const grid = (...cells: [number, number, number][]) => {
  const set = new Set(cells.map((c) => c.join(',')));
  return (x: number, y: number, z: number) => set.has(`${x},${y},${z}`);
};
const p = (x: number, y: number, z: number) => ({ x, y, z });

test('a clear line, and a block between', () => {
  const floor = grid([0, 0, 0], [1, 0, 0], [2, 0, 0]);
  expect(lineClear(floor, p(-3, 4, 0), p(2, 1, 0))).toBe(true); // over the floor to a ball on it
  expect(lineClear(grid([5, 0, 0]), p(0, 0, 0), p(10, 0, 0))).toBe(false);
  expect(lineClear(grid([5, 0, 0]), p(10, 0, 0), p(0, 0, 0))).toBe(false); // either way round
  expect(lineClear(floor, p(1, -4, 0.2), p(1, 1, 0))).toBe(false); // from under the floor
});

test('a ray grazing a block edge: just over is clear, just under is blocked', () => {
  const block = grid([0, 0, 0]); // spans -0.5..0.5
  expect(lineClear(block, p(-3, 0.51, 0), p(3, 0.51, 0))).toBe(true);
  expect(lineClear(block, p(-3, 0.49, 0), p(3, 0.49, 0))).toBe(false);
  // Diagonal past the block's (0.5, 0.5) corner: a hair outside is clear, a hair inside is blocked.
  expect(lineClear(block, p(-1.5, 2.52, 0), p(2.5, -1.48, 0))).toBe(true);
  expect(lineClear(block, p(-1.5, 2.48, 0), p(2.5, -1.52, 0))).toBe(false);
});

test('the camera inside a block is occluded (and nothing throws); the target cell itself never occludes', () => {
  expect(lineClear(grid([0, 0, 0]), p(0.1, 0.2, 0), p(4, 0, 0))).toBe(false);
  expect(lineClear(grid([4, 0, 0]), p(0, 0, 0), p(4, 0, 0))).toBe(true);
  expect(lineClear(grid(), p(1, 1, 1), p(1, 1, 1))).toBe(true); // zero length
});
