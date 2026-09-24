import { describe, expect, test } from 'vitest';
import { ALL_DIRS, cross, Dir, dirName, dirVec, mulberry32, opposite, parseDir, perpendicular, turnFwd } from '../src/index.ts';

const pairs = ALL_DIRS.flatMap((up) => ALL_DIRS.filter((f) => perpendicular(up, f)).map((fwd) => [up, fwd] as const));

describe('dir', () => {
  test('names round-trip, opposite flips the vector', () => {
    for (const d of ALL_DIRS) {
      expect(parseDir(dirName(d))).toBe(d);
      const v = dirVec(d), o = dirVec(opposite(d));
      expect([v.x + o.x, v.y + o.y, v.z + o.z]).toEqual([0, 0, 0]);
    }
    expect(() => parseDir('up')).toThrow(/invalid dir/);
  });

  test('cross is right-handed and throws on parallel input', () => {
    expect(cross(Dir.PX, Dir.PY)).toBe(Dir.PZ);
    expect(cross(Dir.PY, Dir.PX)).toBe(Dir.NZ);
    expect(() => cross(Dir.PX, Dir.NX)).toThrow(/parallel/);
    expect(() => cross(Dir.PY, Dir.PY)).toThrow(/parallel/);
  });
});

describe('turn', () => {
  test('there are 24 (up, fwd) pairs', () => expect(pairs).toHaveLength(24));

  test.each(pairs)('up %i fwd %i: left/right stay perpendicular, 4 lefts return, right undoes left', (up, fwd) => {
    const l = turnFwd(up, fwd, -1), r = turnFwd(up, fwd, 1);
    for (const d of [l, r]) {
      expect(perpendicular(d, up)).toBe(true);
      expect(perpendicular(d, fwd)).toBe(true);
    }
    expect(r).toBe(opposite(l));
    expect(turnFwd(up, l, 1)).toBe(fwd);
    let f = fwd;
    for (let i = 0; i < 4; i++) f = turnFwd(up, f, -1);
    expect(f).toBe(fwd);
  });

  test('handedness: U=+Y, F=+Z, right is -X', () => {
    expect(turnFwd(Dir.PY, Dir.PZ, 1)).toBe(Dir.NX);
    expect(turnFwd(Dir.PY, Dir.PZ, -1)).toBe(Dir.PX);
  });
});

test('mulberry32 is deterministic and in [0, 1)', () => {
  const a = mulberry32(7), b = mulberry32(7);
  for (let i = 0; i < 100; i++) {
    const x = a();
    expect(x).toBe(b());
    expect(x >= 0 && x < 1).toBe(true);
  }
});
