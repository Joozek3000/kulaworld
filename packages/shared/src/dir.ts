import type { Vec3 } from './vec.ts';

export const Dir = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];
export const ALL_DIRS: readonly Dir[] = [0, 1, 2, 3, 4, 5];

const NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const;
export type DirName = (typeof NAMES)[number];

const VECS: readonly Vec3[] = [
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
];

export const dirVec = (d: Dir): Vec3 => VECS[d];
export const dirName = (d: Dir): DirName => NAMES[d];
/** Pairs are laid out (+,-) so the opposite is the index with the low bit flipped. */
export const opposite = (d: Dir): Dir => (d ^ 1) as Dir;
export const perpendicular = (a: Dir, b: Dir): boolean => a >> 1 !== b >> 1;

export function parseDir(s: string): Dir {
  const i = NAMES.indexOf(s as DirName);
  if (i < 0) throw new Error(`invalid dir "${s}"`);
  return i as Dir;
}

export function dirFromVec(v: Vec3): Dir {
  const i = VECS.findIndex((w) => w.x === v.x && w.y === v.y && w.z === v.z);
  if (i < 0) throw new Error(`not a unit axis vector: ${v.x},${v.y},${v.z}`);
  return i as Dir;
}

export function cross(a: Dir, b: Dir): Dir {
  if (!perpendicular(a, b)) throw new Error(`cross of parallel dirs ${dirName(a)}, ${dirName(b)}`);
  const u = VECS[a], v = VECS[b];
  return dirFromVec({ x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x });
}
