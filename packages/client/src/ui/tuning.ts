import type { AudioEngine } from '../audio/engine.ts';
import { DEFAULT_TUNING, saveTuning, SOUND_NAMES, tuning } from '../tuning.ts';

/**
 * F4 feel-tuning panel (dev only, phase 08): sliders for the mix, squash and hit-stop, a ▶ per sound to audition it,
 * and "copy as JSON" so tuned numbers can be sent back. Values persist in localStorage via saveTuning.
 */
export function createTuningPanel(audio: AudioEngine) {
  const el = document.createElement('div');
  el.id = 'tuning';
  el.hidden = true;
  document.body.appendChild(el);
  const refresh: (() => void)[] = [];

  const row = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, play?: () => void) => {
    const r = document.createElement('label');
    const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step });
    const out = document.createElement('output');
    const show = () => { input.value = String(get()); out.textContent = String(get()); };
    input.addEventListener('input', () => { set(Number(input.value)); saveTuning(); show(); });
    r.append(Object.assign(document.createElement('span'), { textContent: label }), input, out);
    if (play) {
      const b = Object.assign(document.createElement('button'), { textContent: '▶', title: `play ${label}` });
      b.addEventListener('click', play);
      r.append(b);
    }
    refresh.push(show);
    show();
    return r;
  };
  const heading = (text: string) => Object.assign(document.createElement('h3'), { textContent: text });

  el.append(
    heading('Feel tuning (F4)'),
    row('master', 0, 1, 0.05, () => tuning.master, (v) => audio.setVolume(v)),
    row('squash', 0, 2, 0.05, () => tuning.squash, (v) => { tuning.squash = v; }),
    row('stiffness', 50, 800, 10, () => tuning.stiffness, (v) => { tuning.stiffness = v; }),
    row('damping', 2, 40, 0.5, () => tuning.damping, (v) => { tuning.damping = v; }),
    row('hit-stop ms', 0, 120, 5, () => tuning.hitStopMs, (v) => { tuning.hitStopMs = v; }),
    row('marker ticks', 0, 10, 1, () => tuning.markerLeadTicks, (v) => { tuning.markerLeadTicks = v; }), // 0 = whole jump
    heading('Sound gains'),
    ...SOUND_NAMES.map((n) => row(n, 0, 2, 0.05, () => tuning.gains[n], (v) => { tuning.gains[n] = v; },
      () => audio.play(n, { intensity: 0.6, mine: true }, 'ui'))),
  );

  const buttons = document.createElement('div');
  const copy = Object.assign(document.createElement('button'), { textContent: 'copy as JSON' });
  copy.addEventListener('click', () => {
    const json = JSON.stringify(tuning, null, 2);
    navigator.clipboard.writeText(json).then(() => { copy.textContent = 'copied ✓'; }, () => { console.log(json); copy.textContent = 'logged to console'; });
    setTimeout(() => { copy.textContent = 'copy as JSON'; }, 1500);
  });
  const reset = Object.assign(document.createElement('button'), { textContent: 'reset' });
  reset.addEventListener('click', () => {
    Object.assign(tuning, { ...DEFAULT_TUNING, gains: { ...DEFAULT_TUNING.gains } });
    audio.setVolume(tuning.master); // also saves
    refresh.forEach((f) => f());
  });
  buttons.append(copy, reset);
  el.append(buttons);

  return {
    toggle() {
      el.hidden = !el.hidden;
      if (!el.hidden) refresh.forEach((f) => f()); // `[` / `]` may have changed the master volume
    },
  };
}
