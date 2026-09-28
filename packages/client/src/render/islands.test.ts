import { expect, test } from 'vitest';
import * as THREE from 'three';
import { islands, islandTint } from './level.ts';

// Island tints (phase 17): face-connected blocks form one island; edge- or corner-touching ones don't.
test('islands: face-connected components, largest first; the largest keeps the plain glaze', () => {
  const solid = new Set(['0,0,0', '1,0,0', '2,0,0', '5,0,0', '5,1,0', '7,1,1', '8,2,2']);
  expect(islands(solid).map((i) => i.sort())).toEqual([['0,0,0', '1,0,0', '2,0,0'], ['5,0,0', '5,1,0'], ['7,1,1'], ['8,2,2']]);
  expect(islandTint(0, new THREE.Color()).getHex()).toBe(0xffffff);
  const hues = [1, 2, 3].map((n) => islandTint(n, new THREE.Color()).getHexString());
  expect(new Set(hues).size).toBe(3);
});
