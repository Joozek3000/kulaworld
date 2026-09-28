/**
 * Music (phase 17): one looping track per slot, crossfaded over CROSSFADE_SEC, on the engine's music bus. Tracks are
 * listed in `public/music/credits.json` (file + credits); a slot with no entry is silence, and nothing is fetched for
 * it. Slots: menu, single (or single-<world> first), race, knockout, results.
 */
export type MusicSlot = 'menu' | 'single' | 'race' | 'knockout' | 'results' | `single-${string}`;
export interface Track { slot: string; file: string; track: string; artist: string; source: string; licence: string }

const CROSSFADE_SEC = 1.5;
const DUCK = 0.35;

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private tracks: Track[] = [];
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private playing: { slot: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wanted = '';
  private last: readonly MusicSlot[] | null = null;
  /** Resolves once credits.json has been read (or failed: no music). */
  readonly ready: Promise<Track[]>;

  constructor(private readonly base: string = import.meta.env.BASE_URL) {
    this.ready = fetch(`${base}music/credits.json`)
      .then((r) => (r.ok ? r.json() : { tracks: [] }))
      .then((j: { tracks?: Track[] }) => (this.tracks = (j.tracks ?? []).filter((t) => t.slot && t.file)))
      .catch(() => (this.tracks = []));
  }

  /** The engine's context and music bus (after the first user gesture). */
  attach(ctx: AudioContext, bus: GainNode): void {
    this.ctx = ctx;
    this.duckGain = ctx.createGain();
    this.duckGain.connect(bus);
    this.out = this.duckGain;
    const want = this.last;
    this.wanted = '';
    this.last = null;
    if (want) this.play(want);
  }

  /** The slot playing now (fading in or steady), or null. */
  get slot(): string | null { return this.playing?.slot ?? null; }

  /** Every track listed, for the Credits screen. */
  get credits(): Track[] { return this.tracks; }

  /**
   * Switches to the first of `slots` that has a track, crossfading. Same list as last time: nothing (callable per
   * frame with constant arrays). None has a track: fades out.
   */
  play(slots: readonly MusicSlot[]): void {
    if (slots === this.last) return;
    this.last = slots;
    const key = slots.join('|');
    if (key === this.wanted) return;
    this.wanted = key;
    if (!this.ctx) return;
    void this.ready.then(async () => {
      const t = slots.map((s) => this.tracks.find((x) => x.slot === s)).find(Boolean);
      if (this.wanted !== key) return;
      if (t && this.playing?.slot === t.slot) return;
      const buffer = t ? await this.load(t.file) : null;
      if (this.wanted !== key) return;
      this.crossfade(t && buffer ? { slot: t.slot, buffer } : null);
    });
  }

  /** Under a results stinger: the music dips for `sec`, then comes back. */
  duck(sec = 2.5): void {
    const c = this.ctx, g = this.duckGain?.gain;
    if (!c || !g) return;
    g.cancelScheduledValues(c.currentTime);
    g.setTargetAtTime(DUCK, c.currentTime, 0.05);
    g.setTargetAtTime(1, c.currentTime + sec, 0.4);
  }

  private load(file: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      p = fetch(`${this.base}music/${file}`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => (b ? this.ctx!.decodeAudioData(b) : null))
        .catch(() => null);
      this.buffers.set(file, p);
    }
    return p;
  }

  private crossfade(next: { slot: string; buffer: AudioBuffer } | null): void {
    const c = this.ctx!, now = c.currentTime, old = this.playing;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_SEC);
      old.src.stop(now + CROSSFADE_SEC + 0.05);
    }
    this.playing = null;
    if (!next) return;
    const gain = c.createGain(), src = c.createBufferSource();
    src.buffer = next.buffer;
    src.loop = true;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SEC);
    src.connect(gain).connect(this.out!);
    src.start(now);
    this.playing = { slot: next.slot, src, gain };
  }
}
