/**
 * Rebindable controls (phase 17). Each action has keyboard codes (KeyboardEvent.code) and gamepad buttons (standard
 * mapping indices). The left stick always also rolls/turns and the right stick always looks. Saved in localStorage
 * (try/catch: without storage the defaults just stay).
 */
export const ACTIONS = ['fwd', 'left', 'right', 'jump', 'look', 'ready', 'pause', 'mute'] as const;
export type BindAction = (typeof ACTIONS)[number];
export const ACTION_LABELS: Record<BindAction, string> = {
  fwd: 'Roll forward', left: 'Turn left', right: 'Turn right', jump: 'Jump', look: 'Free look (hold)', ready: 'Ready', pause: 'Pause', mute: 'Mute',
};
export interface Bindings { keys: Record<BindAction, string[]>; pad: Record<BindAction, number[]> }

/** Standard-mapping buttons: A 0, B 1, X 2, Y 3, LB 4, RB 5, Back 8, Start 9, L3 10, R3 11, D-pad 12–15. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
export const PAD_GLYPHS: Record<number, string> = { 0: 'Ⓐ', 1: 'Ⓑ', 2: 'Ⓧ', 3: 'Ⓨ', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'Back', 9: 'Start', 10: 'L3', 11: 'R3', 12: '▲', 13: '▼', 14: '◀', 15: '▶' };

export const DEFAULT_BINDINGS: Bindings = {
  keys: { fwd: ['KeyW', 'ArrowUp'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], jump: ['Space'], look: ['KeyQ'], ready: ['KeyR'], pause: ['Escape'], mute: ['KeyM'] },
  pad: { fwd: [PAD.UP], left: [PAD.LEFT], right: [PAD.RIGHT], jump: [PAD.A], look: [PAD.R3], ready: [PAD.B], pause: [PAD.START], mute: [PAD.BACK] },
};
const KEY = 'kula.bindings';

const copy = (b: Bindings): Bindings => ({
  keys: Object.fromEntries(ACTIONS.map((a) => [a, [...b.keys[a]]])) as Bindings['keys'],
  pad: Object.fromEntries(ACTIONS.map((a) => [a, [...b.pad[a]]])) as Bindings['pad'],
});

export function loadBindings(): Bindings {
  const b = copy(DEFAULT_BINDINGS);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Bindings>;
    for (const a of ACTIONS) {
      const k = saved.keys?.[a], p = saved.pad?.[a];
      if (Array.isArray(k) && k.every((x) => typeof x === 'string')) b.keys[a] = k;
      if (Array.isArray(p) && p.every((x) => Number.isInteger(x))) b.pad[a] = p;
    }
  } catch { /* storage unavailable or corrupt: defaults */ }
  return b;
}

export function saveBindings(b: Bindings): void {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* storage unavailable */ }
}

/** Binds `action` to `code` (keyboard) or `button` (pad) alone, taking it off any other action that had it. */
export function rebind(b: Bindings, action: BindAction, input: { code: string } | { button: number }): void {
  if ('code' in input) {
    for (const a of ACTIONS) b.keys[a] = b.keys[a].filter((c) => c !== input.code);
    b.keys[action] = [input.code];
  } else {
    for (const a of ACTIONS) b.pad[a] = b.pad[a].filter((c) => c !== input.button);
    b.pad[action] = [input.button];
  }
}

export const resetBindings = (b: Bindings): void => { Object.assign(b, copy(DEFAULT_BINDINGS)); };

/** Human label for a key code: "KeyW" → "W", "ArrowUp" → "↑", "Space" → "Space". */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' } as Record<string, string>)[code] ?? code;
}
