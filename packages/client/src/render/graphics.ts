import * as THREE from 'three';

/**
 * Graphics quality (phase 19b, §25). High: pixel ratio up to 2, shadows. Low: pixel ratio 1, no shadows, fewer
 * particles. Auto starts High and drops to Low for the session once the frame rate stays under 45 for 5 s.
 */
export type GraphicsMode = 'auto' | 'high' | 'low';
const KEY = 'kula.graphics';

export function loadGraphics(): GraphicsMode {
  try {
    const g = localStorage.getItem(KEY);
    if (g === 'auto' || g === 'high' || g === 'low') return g;
  } catch { /* storage unavailable */ }
  return 'auto';
}
export function saveGraphics(g: GraphicsMode): void {
  try { localStorage.setItem(KEY, g); } catch { /* storage unavailable */ }
}

/**
 * Frame rate over 1 s windows. `frame` says true once every window for `holdMs` in a row was under `min` fps. A gap
 * over half a second (a hidden tab, a level loading) starts over rather than counting as slow.
 */
export class FpsGuard {
  /** The last full window's frame rate (the FPS readout). */
  fps = 0;
  private frames = 0;
  private windowMs = 0;
  private slowMs = 0;

  constructor(readonly min = 45, readonly holdMs = 5000) {}

  frame(dtMs: number): boolean {
    if (dtMs > 500) { this.frames = this.windowMs = this.slowMs = 0; return false; }
    this.frames++;
    this.windowMs += dtMs;
    if (this.windowMs >= 1000) {
      this.fps = (this.frames * 1000) / this.windowMs;
      this.slowMs = this.fps < this.min ? this.slowMs + this.windowMs : 0;
      this.frames = this.windowMs = 0;
    }
    return this.slowMs >= this.holdMs;
  }
}

/** Switches the renderer between High and Low; materials recompile without (or with) shadow sampling. */
export function applyGraphics(renderer: THREE.WebGLRenderer, scene: THREE.Scene, low: boolean): void {
  renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  if (renderer.shadowMap.enabled === !low) return;
  renderer.shadowMap.enabled = !low;
  scene.traverse((o) => { if (o instanceof THREE.Mesh) for (const m of [o.material].flat()) m.needsUpdate = true; });
}
