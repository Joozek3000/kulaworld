import { expect, test } from 'vitest';
import { FpsGuard } from './graphics.ts';

/** Feeds `sec` seconds of frames at `fps`; true if the guard asked to drop at any point. */
const run = (g: FpsGuard, fps: number, sec: number) => {
  let drop = false;
  for (let t = 0; t < sec * 1000; t += 1000 / fps) drop = g.frame(1000 / fps) || drop;
  return drop;
};

test('graphics Auto (§25): drops once the frame rate stays under 45 for 5 s', () => {
  const g = new FpsGuard();
  expect(run(g, 60, 20)).toBe(false);
  expect(g.fps).toBeCloseTo(60, 0);
  expect(run(g, 30, 4.5)).toBe(false); // not yet 5 s
  expect(run(g, 30, 1)).toBe(true);
  expect(g.fps).toBeCloseTo(30, 0);
});

test('graphics Auto: 45 fps is enough, a fast second starts the count over, and so does a gap', () => {
  expect(run(new FpsGuard(), 45, 20)).toBe(false);
  expect(run(new FpsGuard(), 44, 6)).toBe(true);
  const g = new FpsGuard();
  expect(run(g, 30, 3.5)).toBe(false);
  expect(run(g, 60, 1.2)).toBe(false); // a good second resets it
  expect(run(g, 30, 3.5)).toBe(false);
  expect(g.frame(2000)).toBe(false); // a hidden tab or a level load: not slow, starts over
  expect(run(g, 30, 3.5)).toBe(false);
  expect(run(g, 30, 2)).toBe(true);
});
