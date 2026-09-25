import type * as THREE from 'three';
import { saveTuning, tuning, type SoundName } from '../tuning.ts';
import { RECIPES, rollLoop } from './synth.ts';

/** Concurrent one-shot voices; past this the quietest is dropped (a new sound quieter than all of them is skipped). */
export const MAX_VOICES = 24;
/** Positional falloff (cells): full volume within REF, silent at MAX. */
const REF_DISTANCE = 2;
const MAX_DISTANCE = 30;
const PITCH_JITTER = 0.06;
const GAIN_JITTER = 0.1;

export interface PlayOpts {
  /** World position for other players' sounds; omit for the local player and UI (not spatialised). */
  at?: THREE.Vector3 | null;
  intensity?: number;
  mine?: boolean;
  /** Extra gain on top of the per-sound gain. */
  gain?: number;
}

interface Voice { out: GainNode; level: number; end: number }

/** Linear distance falloff, the same curve the PannerNodes use (for ranking voices by loudness). */
export const falloff = (d: number) => Math.min(1, Math.max(0, 1 - (d - REF_DISTANCE) / (MAX_DISTANCE - REF_DISTANCE)));

/** Index of the voice to drop so a new one of `level` fits, or -1 to skip the new one. Pure, for tests. */
export function voiceToDrop(levels: number[], level: number, max = MAX_VOICES): number | null {
  if (levels.length < max) return null;
  let q = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] < levels[q]) q = i;
  return levels[q] < level ? q : -1;
}

/**
 * Phase 08 sound engine. master ← sfx/ui buses. Every sound is a synth recipe unless `public/sfx/<name>.ogg` (or .wav)
 * exists, which is fetched lazily on first use and replaces the synth from then on.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: { sfx: GainNode; ui: GainNode };
  private voices: Voice[] = [];
  private samples = new Map<SoundName, AudioBuffer | null | 'loading'>();
  private rolls = new Map<string, { gain: GainNode; src: AudioBufferSourceNode; panner: PannerNode | null }>();
  private listenerPos = { x: 0, y: 0, z: 0 };
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem('kula.muted') === '1'; } catch { /* storage unavailable */ }
    // Browsers only allow audio after a user gesture: the first key press creates (or resumes) the context.
    addEventListener('keydown', () => this.start(), { capture: true });
  }

  private start(): void {
    if (!this.ctx) {
      const c = (this.ctx = new AudioContext());
      this.master = c.createGain();
      this.master.connect(c.destination);
      this.buses = { sfx: c.createGain(), ui: c.createGain() };
      this.buses.sfx.connect(this.master);
      this.buses.ui.connect(this.master);
      this.applyVolume();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  get volume(): number { return tuning.master; }
  /** Master volume 0..1, persisted with the tuning. */
  setVolume(v: number): void {
    tuning.master = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    saveTuning();
    this.applyVolume();
  }
  toggleMute(): void {
    this.muted = !this.muted;
    try { localStorage.setItem('kula.muted', this.muted ? '1' : '0'); } catch { /* storage unavailable */ }
    this.applyVolume();
  }
  private applyVolume(): void {
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : tuning.master, this.ctx.currentTime, 0.02);
  }

  /** The listener rides on the camera. */
  setListener(camera: THREE.Camera): void {
    const c = this.ctx;
    if (!c) return;
    const e = camera.matrixWorld.elements;
    const l = c.listener, t = c.currentTime;
    this.listenerPos = { x: e[12], y: e[13], z: e[14] };
    if (l.positionX) {
      l.positionX.setValueAtTime(e[12], t); l.positionY.setValueAtTime(e[13], t); l.positionZ.setValueAtTime(e[14], t);
      l.forwardX.setValueAtTime(-e[8], t); l.forwardY.setValueAtTime(-e[9], t); l.forwardZ.setValueAtTime(-e[10], t);
      l.upX.setValueAtTime(e[4], t); l.upY.setValueAtTime(e[5], t); l.upZ.setValueAtTime(e[6], t);
    } else {
      l.setPosition(e[12], e[13], e[14]);
      l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  private panner(at: THREE.Vector3): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower'; // HRTF costs far more per voice
    p.distanceModel = 'linear';
    p.refDistance = REF_DISTANCE;
    p.maxDistance = MAX_DISTANCE;
    p.rolloffFactor = 1;
    p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z;
    return p;
  }

  private distance(at: THREE.Vector3): number {
    const l = this.listenerPos;
    return Math.hypot(at.x - l.x, at.y - l.y, at.z - l.z);
  }

  play(name: SoundName, o: PlayOpts = {}, bus: 'sfx' | 'ui' = 'sfx'): void {
    const c = this.ctx;
    if (!c || c.state !== 'running' || this.muted) return;
    const now = c.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    const gain = tuning.gains[name] * (o.gain ?? 1) * (1 + (Math.random() * 2 - 1) * GAIN_JITTER);
    const level = gain * (o.at ? falloff(this.distance(o.at)) : 1);
    if (gain <= 0 || level <= 0) return;
    const drop = voiceToDrop(this.voices.map((v) => v.level), level);
    if (drop === -1) return;
    if (drop !== null) this.stop(this.voices.splice(drop, 1)[0]);

    const out = c.createGain();
    out.gain.value = gain;
    if (o.at) out.connect(this.panner(o.at)).connect(this.buses[bus]);
    else out.connect(this.buses[bus]);
    const pitch = 1 + (Math.random() * 2 - 1) * PITCH_JITTER;
    const sample = this.sample(name);
    if (sample && name === 'roll') { out.disconnect(); return; } // the roll sample is the loop, not a tile tick
    let len: number;
    if (sample) {
      const src = c.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = pitch;
      src.connect(out);
      src.start(now);
      len = sample.duration / pitch;
    } else {
      len = RECIPES[name](c, out, now, { pitch, intensity: o.intensity ?? 0.5, mine: o.mine ?? false });
    }
    this.voices.push({ out, level, end: now + len + 0.05 });
  }

  private stop(v: Voice): void {
    const c = this.ctx!;
    v.out.gain.setTargetAtTime(0, c.currentTime, 0.005); // quick fade instead of a click
    setTimeout(() => v.out.disconnect(), 60);
  }

  /** A sample override, or null (use the synth). The first call starts the fetch; the synth covers until it lands. */
  private sample(name: SoundName): AudioBuffer | null {
    const s = this.samples.get(name);
    if (s !== undefined) return s === 'loading' ? null : s;
    this.samples.set(name, 'loading');
    void this.fetchSample(name).then((b) => this.samples.set(name, b));
    return null;
  }

  private async fetchSample(name: SoundName): Promise<AudioBuffer | null> {
    for (const ext of ['ogg', 'wav']) {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}sfx/${name}.${ext}`);
        // Vite's dev server answers a missing file with index.html (200), so check the type too.
        if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) continue;
        return await this.ctx!.decodeAudioData(await res.arrayBuffer());
      } catch { /* missing or undecodable: try the next, then the synth */ }
    }
    return null;
  }

  /** Which sounds use a sample file (debug/automation). */
  sampled(): string[] {
    return [...this.samples].filter(([, b]) => b && b !== 'loading').map(([n]) => n);
  }

  /**
   * Roll rumble per ball: `speed` 0..1 (0 = not rolling). Local balls aren't spatialised. Loops are made on first roll
   * and kept (silent) until `endRolls` drops balls that left.
   */
  roll(id: string, speed: number, at: THREE.Vector3, local: boolean): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    let r = this.rolls.get(id);
    if (!r) {
      if (speed <= 0) return;
      const panner = local ? null : this.panner(at);
      if (panner) panner.connect(this.buses.sfx);
      const sample = this.sample('roll'); // a roll.ogg replaces the rumble (and silences the synth tile tick)
      r = { ...rollLoop(c, panner ?? this.buses.sfx, sample), panner };
      this.rolls.set(id, r);
    }
    if (r.panner) {
      const t = c.currentTime;
      r.panner.positionX.setValueAtTime(at.x, t); r.panner.positionY.setValueAtTime(at.y, t); r.panner.positionZ.setValueAtTime(at.z, t);
    }
    r.gain.gain.setTargetAtTime(speed * 0.35 * tuning.gains.roll, c.currentTime, 0.04);
  }

  /** Stops the roll loops of balls not in `ids`. */
  endRolls(ids: Set<string>): void {
    for (const [id, r] of this.rolls) {
      if (ids.has(id)) continue;
      r.src.stop();
      r.gain.disconnect();
      r.panner?.disconnect();
      this.rolls.delete(id);
    }
  }

  get activeVoices(): number { return this.voices.length; }
}
