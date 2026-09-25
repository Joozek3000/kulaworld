/** Placeholder beeps with a WebAudio oscillator (no audio files). M toggles mute; the choice is remembered. */
export function createSfx() {
  let ctx: AudioContext | null = null;
  let muted = false;
  try { muted = localStorage.getItem('kula.muted') === '1'; } catch { /* storage unavailable */ }

  /** Browsers only allow audio after a user gesture; the first key press creates the context. */
  addEventListener('keydown', () => { ctx ??= new AudioContext(); void ctx.resume(); }, { once: true });

  /** Plays `freqs` one after another, `step` seconds each. */
  function tones(freqs: number[], step = 0.09, type: OscillatorType = 'square', gain = 0.06) {
    if (muted || !ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx!.createOscillator(), g = ctx!.createGain();
      osc.type = type;
      osc.frequency.value = f;
      const t = t0 + i * step;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 0.95);
      osc.connect(g).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + step);
    });
  }

  return {
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('kula.muted', muted ? '1' : '0'); } catch { /* storage unavailable */ }
    },
    tick: () => tones([440], 0.12, 'sine', 0.08),
    go: () => tones([880], 0.25, 'sine', 0.08),
    key: (mine: boolean) => tones(mine ? [660, 990, 1320] : [660, 880], 0.07),
    thump: () => tones([140, 90], 0.06, 'triangle', 0.12),
    buzz: () => tones([70, 70], 0.08, 'sawtooth', 0.05),
    death: () => tones([330, 247, 165], 0.1, 'sawtooth', 0.04),
    win: (mine: boolean) => tones(mine ? [523, 659, 784, 1047] : [392, 330, 262], 0.13, 'triangle', 0.08),
  };
}

export type Sfx = ReturnType<typeof createSfx>;
