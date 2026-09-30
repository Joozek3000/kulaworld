import { expect, test } from 'vitest';
import { cleanName, CODE_ALPHABET, mulberry32, newRoomCode, normalizeCode } from '../src/index.ts';

test('room codes: 4 letters from the unambiguous alphabet, never one already taken', () => {
  expect(CODE_ALPHABET).not.toMatch(/[IO01]/);
  const rng = mulberry32(7), taken = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const c = newRoomCode(taken, rng);
    expect(c).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(taken.has(c)).toBe(false);
    taken.add(c);
  }
  // A generator stuck on one taken code gives up instead of handing out a duplicate.
  expect(() => newRoomCode(new Set(['AAAA']), () => 0)).toThrow();
});

test('codes typed by players are case-insensitive', () => {
  expect(normalizeCode(' abcd ')).toBe('ABCD');
  expect(normalizeCode('ab cd')).toBe('ABCD');
  for (const bad of ['', 'ABC', 'ABCDE', 'AB0D', 'ABID']) expect(normalizeCode(bad)).toBe('');
});

test('names: trimmed, control and bidi characters stripped, at most 16 characters', () => {
  expect(cleanName('  Bob  ')).toBe('Bob');
  expect(cleanName('a\u0000b\nc‮d')).toBe('abcd');
  expect(cleanName('x'.repeat(40))).toBe('x'.repeat(16));
  expect(cleanName('🤖'.repeat(20))).toBe('🤖'.repeat(16)); // counted in characters, never splitting a pair
  expect(cleanName('   ')).toBe('anon');
  expect(cleanName(undefined)).toBe('anon');
  expect(cleanName({ toString: () => '<b>hi</b>' })).toBe('<b>hi</b>'); // markup is kept as text; the client renders names as text
});
