import { expect, test } from 'vitest';
import { cellKey, VERSION } from './index.ts';

test('cellKey', () => {
  expect(cellKey({ x: 1, y: -2, z: 3 })).toBe('1,-2,3');
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
