/**
 * Touch controls (phase 19b, ARCHITECTURE §25): a third input source next to the keyboard and the pad. The left thumb
 * is a floating d-pad (8 sectors around where it went down), the right thumb has a big Jump button and a free-look
 * drag. It feeds the same held/pulse actions as the keyboard (`act`), so nothing downstream changes.
 */

export type Sector = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
const SECTORS: Sector[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Dead zone: this fraction of the pad radius around the centre reads as nothing. */
export const DEAD_ZONE = 0.12;

/**
 * The sector of a thumb at (dx, dy) screen px from the pad's centre (y grows down), or null inside the dead zone.
 * 45° each, N centred on straight up; a boundary angle belongs to the sector clockwise of it (22.5° is NE).
 */
export function dpadSector(dx: number, dy: number, radius: number): Sector | null {
  if (Math.hypot(dx, dy) <= DEAD_ZONE * radius) return null;
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return SECTORS[Math.floor((deg + 22.5) / 45) % 8];
}

/**
 * §25's table: N forward, E/W turn, NE/NW forward + turn, S nothing. SE/SW (not in the table) compose the same way
 * as NE/NW, S + E = turn right only, like pressing two arrows of a real d-pad. `turn` is the sector's side, held
 * while the thumb stays; `turnEdge` makes the pulse.
 */
export function dpadSectors(dx: number, dy: number, radius: number): { fwd: boolean; turn: -1 | 0 | 1 } {
  const s = dpadSector(dx, dy, radius);
  return { fwd: s === 'N' || s === 'NE' || s === 'NW', turn: s === 'E' || s === 'NE' || s === 'SE' ? 1 : s === 'W' || s === 'NW' || s === 'SW' ? -1 : 0 };
}

/**
 * One turn pulse on entering a turning sector: the side changed to left or right. Holding there gives no repeat; back
 * to N, S or the centre and in again gives another. Sliding E → NE keeps the same side, so no second turn.
 */
export function turnEdge(): (turn: -1 | 0 | 1) => -1 | 0 | 1 {
  let prev = 0;
  return (turn) => {
    const pulse = turn !== 0 && turn !== prev ? turn : 0;
    prev = turn;
    return pulse;
  };
}

export type TouchAction = 'fwd' | 'jump' | 'left' | 'right';
export type Zone = 'dpad' | 'jump' | 'look';
export interface TouchSink {
  /** As a key: fwd and jump are held (down/up), left and right fire on down. */
  act(a: TouchAction, down: boolean): void;
  /** Free look: the drag so far (px from where the finger went down); `lookEnd` springs it back. */
  look(dx: number, dy: number): void;
  lookEnd(): void;
}

/**
 * The touches, by identifier: one on the d-pad, one on Jump, one looking, each independent of the others. DOM-free,
 * so it's unit-tested; `createTouchUI` feeds it the touch events.
 */
export class TouchPad {
  private pad: { id: number; x: number; y: number; radius: number } | null = null;
  private jumpId: number | null = null;
  private lookAt: { id: number; x: number; y: number } | null = null;
  private fwd = false;
  private edge = turnEdge();
  /** The d-pad's centre and thumb (for drawing), null when no thumb is on it. */
  onPad: ((p: { cx: number; cy: number; dx: number; dy: number; fwd: boolean; turn: -1 | 0 | 1 } | null) => void) | null = null;
  onJump: ((down: boolean) => void) | null = null;

  constructor(private readonly sink: TouchSink) {}

  /** A touch went down in `zone`; false if that zone already has a touch (it's ignored). */
  start(id: number, x: number, y: number, zone: Zone, radius = 60): boolean {
    if (zone === 'dpad') {
      if (this.pad) return false;
      this.pad = { id, x, y, radius }; // the floating centre: wherever this thumb went down
      this.onPad?.({ cx: x, cy: y, dx: 0, dy: 0, fwd: false, turn: 0 });
    } else if (zone === 'jump') {
      if (this.jumpId !== null) return false;
      this.jumpId = id;
      this.sink.act('jump', true);
      this.onJump?.(true);
    } else {
      if (this.lookAt) return false;
      this.lookAt = { id, x, y };
    }
    return true;
  }

  move(id: number, x: number, y: number): void {
    if (this.pad?.id === id) {
      const dx = x - this.pad.x, dy = y - this.pad.y, s = dpadSectors(dx, dy, this.pad.radius);
      if (s.fwd !== this.fwd) { this.fwd = s.fwd; this.sink.act('fwd', s.fwd); }
      const pulse = this.edge(s.turn);
      if (pulse) this.sink.act(pulse < 0 ? 'left' : 'right', true);
      this.onPad?.({ cx: this.pad.x, cy: this.pad.y, dx, dy, ...s });
    } else if (this.lookAt?.id === id) this.sink.look(x - this.lookAt.x, y - this.lookAt.y);
  }

  end(id: number): void {
    if (this.pad?.id === id) {
      this.pad = null;
      this.edge(0);
      if (this.fwd) { this.fwd = false; this.sink.act('fwd', false); }
      this.onPad?.(null);
    } else if (this.jumpId === id) {
      this.jumpId = null;
      this.sink.act('jump', false);
      this.onJump?.(false);
    } else if (this.lookAt?.id === id) {
      this.lookAt = null;
      this.sink.lookEnd();
    }
  }

  /** touchcancel, blur, a hidden tab, the controls hiding: every touch lets go. */
  releaseAll(): void {
    for (const id of [this.pad?.id, this.jumpId, this.lookAt?.id]) if (id !== undefined && id !== null) this.end(id);
  }
}

export type TouchMode = 'auto' | 'on' | 'off';
export interface TouchSettings {
  mode: TouchMode;
  size: 'S' | 'M' | 'L';
  opacity: number;
  lefty: boolean;
  haptics: boolean;
  /** A small FPS/ping readout (there's no F3 on a phone). */
  stats: boolean;
}
export const DEFAULT_TOUCH: TouchSettings = { mode: 'auto', size: 'M', opacity: 0.6, lefty: false, haptics: true, stats: false };
const KEY = 'kula.touch';

export function loadTouchSettings(): TouchSettings {
  const s = { ...DEFAULT_TOUCH };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<TouchSettings>;
    if (saved.mode === 'auto' || saved.mode === 'on' || saved.mode === 'off') s.mode = saved.mode;
    if (saved.size === 'S' || saved.size === 'M' || saved.size === 'L') s.size = saved.size;
    if (typeof saved.opacity === 'number' && saved.opacity >= 0.2 && saved.opacity <= 1) s.opacity = saved.opacity;
    for (const k of ['lefty', 'haptics', 'stats'] as const) if (typeof saved[k] === 'boolean') s[k] = saved[k];
  } catch { /* storage unavailable or corrupt: defaults */ }
  return s;
}
export function saveTouchSettings(s: TouchSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** Auto shows the touch controls while touch is the device last used (§25); On and Off force them. */
export const touchShown = (mode: TouchMode, device: string) => mode === 'on' || (mode === 'auto' && device === 'touch');

/** What the touch layer shows (Pause always): the game controls while playing, the Ready (or Rematch) button. */
export interface TouchView { shown: boolean; play: boolean; ready: 'ready' | 'rematch' | null; readyOn: boolean }

const SIZES = { S: 0.8, M: 1, L: 1.25 };

/** The touch layer: HTML over the canvas, under the menus. `hooks.act` is the input's; the rest are the game's. */
export function createTouchUI(hooks: TouchSink & { pause(): void; ready(): void }) {
  const root = document.createElement('div');
  root.id = 'touch';
  root.hidden = true;
  root.innerHTML = `<div class="t-zone" data-zone="dpad"></div><div class="t-zone" data-zone="look"></div>`
    + `<div class="t-pad"><div class="t-ring"><b class="t-n">▲</b><b class="t-w">◀</b><b class="t-e">▶</b></div><div class="t-thumb"></div></div>`
    + `<button class="t-jump" data-zone="jump">JUMP</button><button class="t-pause" aria-label="Pause">❚❚</button><button class="t-ready">Ready</button>`
    + `<div class="t-stats" hidden></div>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const padEl = $('.t-pad'), ring = $('.t-ring'), thumb = $('.t-thumb'), jump = $('.t-jump'), readyBtn = $('.t-ready'), stats = $('.t-stats');
  const arrows = { n: $('.t-n'), w: $('.t-w'), e: $('.t-e') };
  const pad = new TouchPad(hooks);

  pad.onPad = (p) => {
    if (!p) { padEl.style.removeProperty('left'); padEl.style.removeProperty('top'); padEl.classList.remove('live'); thumb.style.transform = ''; }
    else {
      padEl.classList.add('live');
      padEl.style.left = `${p.cx}px`;
      padEl.style.top = `${p.cy}px`;
      const r = ring.offsetWidth / 2, d = Math.hypot(p.dx, p.dy), k = d > r ? r / d : 1; // the dot stays on the ring
      thumb.style.transform = `translate(${p.dx * k}px, ${p.dy * k}px)`;
    }
    arrows.n.classList.toggle('on', !!p?.fwd);
    arrows.w.classList.toggle('on', p?.turn === -1);
    arrows.e.classList.toggle('on', p?.turn === 1);
  };
  pad.onJump = (down) => jump.classList.toggle('on', down);

  const onTouch = (e: TouchEvent) => {
    e.preventDefault(); // no mouse emulation, zoom, scroll or long-press menu
    for (const t of e.changedTouches) {
      if (e.type === 'touchstart') {
        const el = (t.target as HTMLElement).closest<HTMLElement>('[data-zone], .t-pause, .t-ready');
        if (!el) continue;
        if (el.classList.contains('t-pause')) hooks.pause();
        else if (el.classList.contains('t-ready')) hooks.ready();
        else pad.start(t.identifier, t.clientX, t.clientY, el.dataset.zone as Zone, ring.offsetWidth / 2 || 60);
      } else if (e.type === 'touchmove') pad.move(t.identifier, t.clientX, t.clientY);
      else if (e.type === 'touchend') pad.end(t.identifier);
    }
    if (e.type === 'touchcancel') pad.releaseAll();
  };
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) root.addEventListener(type, onTouch as EventListener, { passive: false });
  // A forced-On layer on a desktop: the buttons still take the mouse.
  $('.t-pause').addEventListener('click', () => hooks.pause());
  readyBtn.addEventListener('click', () => hooks.ready());
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS ignores user-scalable=no: no pinch zoom
  addEventListener('blur', () => pad.releaseAll());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pad.releaseAll(); });

  let last = '';
  return {
    apply(s: TouchSettings): void {
      root.style.setProperty('--k', String(SIZES[s.size]));
      root.style.setProperty('--touch-opacity', String(s.opacity));
      root.classList.toggle('lefty', s.lefty);
      stats.hidden = !s.stats;
      document.body.classList.toggle('show-stats', s.stats && !root.hidden);
    },
    /** Per frame: cheap (classes change only when the view does). Hiding lets go of every touch. */
    update(v: TouchView): void {
      const sig = `${v.shown}${v.play}${v.ready}${v.readyOn}`;
      if (sig === last) return;
      last = sig;
      if (!v.shown || !v.play) pad.releaseAll();
      root.hidden = !v.shown;
      document.body.classList.toggle('touch-ui', v.shown);
      document.body.classList.toggle('show-stats', v.shown && !stats.hidden);
      root.classList.toggle('play', v.play);
      readyBtn.hidden = !v.ready;
      readyBtn.classList.toggle('on', v.readyOn);
      readyBtn.textContent = `${v.ready === 'rematch' ? 'Rematch' : 'Ready'}${v.readyOn ? ' ✓' : ''}`;
    },
    stats(text: string): void { if (stats.textContent !== text) stats.textContent = text; },
  };
}
