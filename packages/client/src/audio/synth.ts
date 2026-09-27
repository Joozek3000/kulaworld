/**
 * Procedural rubber/dodgeball sounds (phase 08). Each recipe schedules its nodes into `out` starting at `t` and returns
 * its length in seconds. `pitch` is the per-play random factor (±6 %); `intensity` 0..1 scales loud/deep variants.
 */
export interface SynthOpts { pitch: number; intensity: number; mine: boolean }
export type Recipe = (c: AudioContext, out: AudioNode, t: number, o: SynthOpts) => number;

let white: AudioBuffer | null = null, brown: AudioBuffer | null = null;

/** 1 s of white noise and 2 s of looping brown noise, made once per context. */
export function noiseBuffers(c: AudioContext): { white: AudioBuffer; brown: AudioBuffer } {
  if (!white || white.sampleRate !== c.sampleRate) {
    white = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const w = white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    brown = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
  }
  return { white, brown: brown! };
}

/** A gain node with an attack/exponential-decay envelope, connected to `out`. */
function env(c: AudioContext, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

function osc(c: AudioContext, into: AudioNode, t: number, len: number, type: OscillatorType, f0: number, f1 = f0, glide = len): OscillatorNode {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  o.connect(into);
  o.start(t);
  o.stop(t + len + 0.02);
  return o;
}

function noise(c: AudioContext, into: AudioNode, t: number, len: number, filter: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
  const src = c.createBufferSource();
  src.buffer = noiseBuffers(c).white;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f).connect(into);
  src.start(t, Math.random() * 0.9); // a different grain each play
  src.stop(t + len + 0.02);
  return f;
}

/** Vibrato: an LFO added onto `param`, its depth fading to 0 over `len`. */
function vibrato(c: AudioContext, param: AudioParam, t: number, len: number, rate: number, depth: number): void {
  const lfo = c.createOscillator(), g = c.createGain();
  lfo.frequency.value = rate;
  g.gain.setValueAtTime(depth, t);
  g.gain.linearRampToValueAtTime(0, t + len);
  lfo.connect(g).connect(param);
  lfo.start(t);
  lfo.stop(t + len + 0.02);
}

/** Marimba-ish pluck: a sine plus a quiet 3.93× overtone that dies first. */
function pluck(c: AudioContext, out: AudioNode, t: number, f: number, gain: number, decay = 0.35): void {
  osc(c, env(c, out, t, gain, 0.003, decay), t, decay, 'sine', f);
  osc(c, env(c, out, t, gain * 0.35, 0.002, decay * 0.25), t, decay * 0.25, 'sine', f * 3.93);
}
const plucks = (c: AudioContext, out: AudioNode, t: number, freqs: number[], step: number, gain: number, pitch: number, decay?: number) => {
  freqs.forEach((f, i) => pluck(c, out, t + i * step, f * pitch, gain, decay));
  return freqs.length * step + (decay ?? 0.35);
};

export const RECIPES: Record<string, Recipe> = {
  /** Rubber "bonk": sine ~180 Hz dropping from ×2 in 60 ms, a band-passed noise slap and a low thud. Harder = deeper. */
  bounce(c, out, t, { pitch, intensity: i }) {
    const f = 180 * pitch * (1.15 - 0.35 * i);
    osc(c, env(c, out, t, 0.35 + 0.35 * i, 0.002, 0.16), t, 0.18, 'sine', f * 2, f, 0.06);
    noise(c, env(c, out, t, 0.12 + 0.2 * i, 0.001, 0.025), t, 0.03, 'bandpass', 1400 * pitch, 1.5);
    osc(c, env(c, out, t, 0.25 + 0.3 * i, 0.003, 0.12), t, 0.14, 'sine', 70 * pitch, 50 * pitch, 0.1);
    return 0.2;
  },
  /** Soft "fwup": noise through a rising low-pass, swelling and fading. */
  takeoff(c, out, t, { pitch }) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    g.connect(out);
    const f = noise(c, g, t, 0.16, 'lowpass', 400 * pitch, 0.7);
    f.frequency.exponentialRampToValueAtTime(1600 * pitch, t + 0.12);
    return 0.17;
  },
  /** The faint squeak tick at each tile start while rolling (the rumble itself is the roll loop). */
  roll(c, out, t, { pitch }) {
    osc(c, env(c, out, t, 0.03, 0.002, 0.03), t, 0.035, 'sine', 1500 * pitch, 1800 * pitch, 0.03);
    return 0.04;
  },
  /** Rubber on an edge: sine gliding 700 → 1100 Hz over 120 ms with a slight vibrato. */
  squeak(c, out, t, { pitch }) {
    const o = osc(c, env(c, out, t, 0.1, 0.01, 0.12), t, 0.13, 'sine', 700 * pitch, 1100 * pitch, 0.12);
    vibrato(c, o.frequency, t, 0.13, 32, 25);
    return 0.14;
  },
  /** Dodgeball THWACK: a 30 ms high-passed slap, a boomy 110 Hz body with a pitch drop and a short boing tail. */
  hit(c, out, t, { pitch, intensity: i }) {
    noise(c, env(c, out, t, 0.5 + 0.3 * i, 0.001, 0.03), t, 0.035, 'highpass', 1500, 0.7);
    osc(c, env(c, out, t, 0.6 + 0.3 * i, 0.002, 0.25), t, 0.27, 'sine', 220 * pitch, 110 * pitch, 0.08);
    const tail = osc(c, env(c, out, t + 0.04, 0.1, 0.01, 0.25), t + 0.04, 0.27, 'sine', 240 * pitch);
    vibrato(c, tail.frequency, t + 0.04, 0.27, 14, 30);
    return 0.32;
  },
  /** Stomp (§16): a heavy low rubber thump (sine 90 → 40 Hz, a low-passed slap) and a deep boing tail. */
  stomp(c, out, t, { pitch, intensity: i }) {
    osc(c, env(c, out, t, 0.8 + 0.2 * i, 0.002, 0.3), t, 0.32, 'sine', 90 * pitch, 40 * pitch, 0.18);
    noise(c, env(c, out, t, 0.35 + 0.2 * i, 0.001, 0.05), t, 0.06, 'lowpass', 900, 0.8);
    const tail = osc(c, env(c, out, t + 0.06, 0.16, 0.01, 0.35), t + 0.06, 0.37, 'sine', 170 * pitch, 210 * pitch, 0.35);
    vibrato(c, tail.frequency, t + 0.06, 0.37, 11, 35);
    return 0.45;
  },
  /**
   * Cradle clack (phase 12b): a hard rubber click, a 10 ms high-passed tick plus a short sine knock. `intensity` is the
   * ball's place down the line (0..1): each one clicks higher.
   */
  clack(c, out, t, { pitch, intensity: i }) {
    const f = 900 * pitch * (1 + 0.5 * i);
    noise(c, env(c, out, t, 0.35, 0.0005, 0.012), t, 0.015, 'highpass', 3000, 0.8);
    osc(c, env(c, out, t, 0.3, 0.001, 0.045), t, 0.05, 'sine', f * 1.3, f, 0.02);
    return 0.06;
  },
  /** Cartoon boing: sine ~250 Hz with a 12 Hz vibrato, both decaying over 300 ms. */
  boing(c, out, t, { pitch }) {
    const o = osc(c, env(c, out, t, 0.28, 0.005, 0.3), t, 0.32, 'sine', 250 * pitch, 300 * pitch, 0.3);
    vibrato(c, o.frequency, t, 0.32, 12, 40);
    return 0.33;
  },
  /** Dull rubber thud against a wall. */
  bump(c, out, t, { pitch }) {
    osc(c, env(c, out, t, 0.18, 0.003, 0.09), t, 0.1, 'sine', 95 * pitch, 60 * pitch, 0.06);
    noise(c, env(c, out, t, 0.05, 0.001, 0.03), t, 0.04, 'lowpass', 500, 0.7);
    return 0.11;
  },
  /** Falling off the map: a whistle gliding 900 → 200 Hz. */
  fall(c, out, t, { pitch }) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.05);
    g.gain.setValueAtTime(0.07, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
    g.connect(out);
    osc(c, g, t, 1, 'sine', 900 * pitch, 200 * pitch, 1);
    return 1;
  },
  /** Hot tile (phase 12): a short hiss (high-passed noise) with crackle, louder and brighter as it heats. */
  sizzle(c, out, t, { intensity: i }) {
    noise(c, env(c, out, t, 0.04 + 0.12 * i, 0.02, 0.2), t, 0.24, 'highpass', 2500 + 3000 * i, 0.7);
    for (let k = 0; k < 2 + Math.round(4 * i); k++) {
      const at = t + Math.random() * 0.2;
      noise(c, env(c, out, at, 0.05 + 0.1 * i, 0.001, 0.012), at, 0.015, 'bandpass', 3000 + Math.random() * 4000, 4);
    }
    return 0.25;
  },
  /** Distant rubbery pop: a band-passed burst and a quick falling tone. */
  pop(c, out, t, { pitch }) {
    noise(c, env(c, out, t, 0.25, 0.001, 0.06), t, 0.07, 'bandpass', 900 * pitch, 2);
    osc(c, env(c, out, t, 0.2, 0.002, 0.09), t, 0.1, 'sine', 420 * pitch, 150 * pitch, 0.08);
    return 0.12;
  },
  key: (c, out, t, { pitch, mine }) => plucks(c, out, t, mine ? [659, 988, 1319] : [659, 880], 0.07, 0.14, pitch),
  /** The local player's exit just unlocked. */
  exit: (c, out, t, { pitch }) => plucks(c, out, t, [523, 659, 784, 1047, 1319], 0.06, 0.12, pitch),
  countdown: (c, out, t, { pitch }) => plucks(c, out, t, [440], 0.1, 0.18, pitch, 0.3),
  go: (c, out, t, { pitch }) => plucks(c, out, t, [880, 1320], 0.05, 0.16, pitch, 0.5),
  win: (c, out, t, { pitch }) => plucks(c, out, t, [523, 659, 784, 1047, 1319], 0.11, 0.15, pitch, 0.6),
  lose: (c, out, t, { pitch }) => plucks(c, out, t, [392, 330, 262, 196], 0.16, 0.14, pitch, 0.6),
  eliminated: (c, out, t, { pitch, mine }) =>
    plucks(c, out, t, mine ? [392, 294, 196, 131] : [262, 196], 0.17, mine ? 0.16 : 0.1, pitch, 0.5),
  /** Low wooden knocks over a quiet rumble: the floor is about to go. */
  crumbleWarn(c, out, t, { pitch }) {
    noise(c, env(c, out, t, 0.06, 0.2, 0.5), t, 0.7, 'lowpass', 300, 0.7);
    return Math.max(0.7, plucks(c, out, t, [196, 185, 175, 165], 0.12, 0.14, pitch * 0.5, 0.2));
  },
  /** Edge warning (phase 13a): a quiet creak and two dry ticks, an enemy just around your edge. */
  edge(c, out, t, { pitch }) {
    const o = osc(c, env(c, out, t, 0.05, 0.02, 0.16), t, 0.18, 'sawtooth', 180 * pitch, 150 * pitch, 0.18);
    vibrato(c, o.frequency, t, 0.18, 30, 12);
    for (const at of [t + 0.02, t + 0.11]) noise(c, env(c, out, at, 0.12, 0.0005, 0.01), at, 0.012, 'highpass', 4000, 0.8);
    return 0.2;
  },
  /** Ice slide (§18): a soft "ssss", band-passed noise gliding down. */
  slide(c, out, t, { pitch }) {
    const f = noise(c, env(c, out, t, 0.07, 0.03, 0.3), t, 0.34, 'bandpass', 6500 * pitch, 1.4);
    f.frequency.exponentialRampToValueAtTime(3500 * pitch, t + 0.34);
    return 0.35;
  },
  /** Boost launch (§18): a rubbery "pwomp", a low sine swooping up under a puff of air. */
  pwomp(c, out, t, { pitch }) {
    osc(c, env(c, out, t, 0.32, 0.004, 0.22), t, 0.24, 'sine', 90 * pitch, 320 * pitch, 0.16);
    noise(c, env(c, out, t, 0.08, 0.01, 0.12), t, 0.14, 'lowpass', 900, 0.7);
    return 0.25;
  },
  /** Roll under a hop (§14): a quick airy "whff", band-passed noise sweeping down past the ball overhead. */
  whoosh(c, out, t, { pitch }) {
    const f = noise(c, env(c, out, t, 0.09, 0.04, 0.16), t, 0.22, 'bandpass', 2400 * pitch, 1.1);
    f.frequency.exponentialRampToValueAtTime(700 * pitch, t + 0.2);
    return 0.22;
  },
  /** Held on a boost pad (phase 14c): a hum rising over the hold (BOOST_HOLD_TICKS, half a second), with a wobble. */
  hum(c, out, t, { pitch }) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.08);
    g.gain.setValueAtTime(0.09, t + 0.42);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    g.connect(out);
    const o = osc(c, g, t, 0.55, 'triangle', 110 * pitch, 330 * pitch, 0.5);
    vibrato(c, o.frequency, t, 0.55, 18, 6);
    return 0.55;
  },
  /** Teleport (13b): "vwoop", a sine sweeping down then up with a wobble, over a breathy band of noise. */
  vwoop(c, out, t, { pitch }) {
    const o = osc(c, env(c, out, t, 0.2, 0.02, 0.32), t, 0.34, 'sine', 900 * pitch, 180 * pitch, 0.16);
    o.frequency.exponentialRampToValueAtTime(1200 * pitch, t + 0.32);
    vibrato(c, o.frequency, t, 0.34, 20, 40);
    noise(c, env(c, out, t, 0.04, 0.05, 0.25), t, 0.3, 'bandpass', 2000 * pitch, 2);
    return 0.35;
  },
  /** Laser death (13b): a bright crackling zap, a saw diving from 2 kHz plus a burst of high noise. */
  zap(c, out, t, { pitch }) {
    osc(c, env(c, out, t, 0.12, 0.002, 0.18), t, 0.2, 'sawtooth', 2000 * pitch, 120 * pitch, 0.18);
    noise(c, env(c, out, t, 0.2, 0.001, 0.08), t, 0.1, 'highpass', 5000, 0.7);
    return 0.21;
  },
  /** Switch (13b): a ceramic button click, a tick and a short knock. */
  click(c, out, t, { pitch }) {
    noise(c, env(c, out, t, 0.25, 0.0005, 0.01), t, 0.012, 'highpass', 3500, 0.8);
    osc(c, env(c, out, t, 0.25, 0.001, 0.05), t, 0.06, 'square', 520 * pitch, 380 * pitch, 0.03);
    return 0.07;
  },
  /** An active laser beam nearby (13b): a short electric buzz, 100 Hz saw with its harmonics through a band-pass. */
  buzz(c, out, t, { pitch }) {
    const g = env(c, out, t, 0.05, 0.03, 0.3);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 600;
    f.connect(g);
    osc(c, f, t, 0.33, 'sawtooth', 100 * pitch);
    return 0.34;
  },
  /** Crumbly low noise: a rumble plus a scatter of short gritty grains. */
  crumble(c, out, t, { pitch }) {
    noise(c, env(c, out, t, 0.3, 0.01, 0.6), t, 0.62, 'lowpass', 500 * pitch, 0.8);
    for (let k = 0; k < 10; k++) {
      const at = t + Math.random() * 0.45;
      noise(c, env(c, out, at, 0.08 + Math.random() * 0.1, 0.001, 0.03), at, 0.035, 'bandpass', 600 + Math.random() * 1400, 3);
    }
    return 0.65;
  },
};

/** Continuous rubber rumble for one rolling ball: brown noise → low-pass ~300 Hz → gain (starts silent). A `roll` sample replaces the noise. */
export function rollLoop(c: AudioContext, out: AudioNode, sample: AudioBuffer | null): { gain: GainNode; src: AudioBufferSourceNode } {
  const g = c.createGain();
  g.gain.value = 0;
  const src = c.createBufferSource();
  src.buffer = sample ?? noiseBuffers(c).brown;
  src.loop = true;
  if (sample) src.connect(g);
  else {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    src.connect(f).connect(g);
  }
  g.connect(out);
  src.start();
  return { gain: g, src };
}
