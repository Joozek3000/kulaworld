import pkg from '../../../package.json' with { type: 'json' };

/** Online play (phase 19, §24). The one game version: the client sends it when joining, the server refuses a mismatch. */
export const GAME_VERSION: string = pkg.version;

/** Join refusals: the error code a join rejects with. Colyseus sends it as the HTTP status of the matchmaking call, so they are HTTP codes. */
export const JOIN_ERROR = { version: 426, serverFull: 503 } as const;

/** Private room codes: 4 letters with no I or O (and no digits, so no 0/1 lookalikes). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;

/** A new code not in `taken`; `rand` returns 0 ≤ x < 1. Throws only if every code is taken. */
export function newRoomCode(taken: { has(code: string): boolean }, rand: () => number): string {
  for (let i = 0; i < 1000; i++) {
    let code = '';
    for (let j = 0; j < CODE_LENGTH; j++) code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
    if (!taken.has(code)) return code;
  }
  throw new Error('no free room code');
}

/** What a player typed as a code, normalised (case-insensitive, spaces dropped); '' when it can't be one. */
export function normalizeCode(s: string): string {
  const code = s.replace(/\s+/g, '').toUpperCase();
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : '';
}

export const NAME_MAX = 16;
/** A player's name: control and bidi-override characters stripped, trimmed, at most NAME_MAX characters; 'anon' if empty. */
export function cleanName(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\p{Cc}‎‏‪-‮⁦-⁩]/gu, '').trim();
  return [...s].slice(0, NAME_MAX).join('').trim() || 'anon';
}
