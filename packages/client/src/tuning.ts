/** Feel tuning (phase 08): audio mix and squash/stretch. The F4 panel edits it; it persists in localStorage. */
export const SOUND_NAMES = [
  'bounce', 'takeoff', 'roll', 'squeak', 'hit', 'stomp', 'boing', 'bump', 'fall', 'pop',
  'key', 'exit', 'countdown', 'go', 'win', 'lose', 'crumbleWarn', 'crumble', 'eliminated',
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

export const DEFAULT_TUNING = {
  /** Master volume 0..1 (also `[` / `]`). */
  master: 0.8,
  /** Multiplier on every squash/stretch amount (0 = rigid balls). */
  squash: 1,
  /** Squash spring (per second²) and damping (per second). ζ ≈ 0.35: a visible jiggle. */
  stiffness: 300,
  damping: 12,
  /** Push-contact hit-stop: the two balls' render time freezes this long. 0 = off. */
  hitStopMs: 35,
  /** Per-sound gain, 0..2. */
  gains: Object.fromEntries(SOUND_NAMES.map((n) => [n, 1])) as Record<SoundName, number>,
};
export type Tuning = typeof DEFAULT_TUNING;

const KEY = 'kula.tuning';

function load(): Tuning {
  const t: Tuning = { ...DEFAULT_TUNING, gains: { ...DEFAULT_TUNING.gains } };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Tuning>;
    for (const k of ['master', 'squash', 'stiffness', 'damping', 'hitStopMs'] as const) {
      if (typeof saved[k] === 'number') t[k] = saved[k];
    }
    for (const n of SOUND_NAMES) if (typeof saved.gains?.[n] === 'number') t.gains[n] = saved.gains[n];
  } catch { /* storage unavailable or corrupt: defaults */ }
  return t;
}

export const tuning: Tuning = load();

export function saveTuning(): void {
  try { localStorage.setItem(KEY, JSON.stringify(tuning)); } catch { /* storage unavailable */ }
}
