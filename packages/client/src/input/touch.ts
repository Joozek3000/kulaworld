/**
 * Touch controls (phase 19b, ARCHITECTURE §25): a third input source next to the keyboard and the pad. The left thumb
 * has two layouts (19c): fixed ◀ ▲ ▶ Buttons (the default) or a Stick. The right thumb has a big Jump button and a
 * free-look drag. It feeds the same held/pulse actions as the keyboard (`act`), so nothing downstream changes.
 */

export type Layout = 'buttons' | 'stick';

/**
 * Stick zones (19c): N forward, E/W turn, S turn around. Angles are from straight up, clockwise: N within ±40°, E/W
 * from 65° to 135°, S beyond 150°. The bands between keep the previous zone (hysteresis: no chatter at an edge), so a
 * thumb drifting off N keeps rolling with no turn. A band reached straight from the centre (or the other side) reads
 * as N above and as nothing below. Never a diagonal: forward and a turn are never held together.
 */
export type StickZone = 'N' | 'E' | 'W' | 'S';
export const STICK = { dead: 0.15, fwd: 40, turn: 65, turnEnd: 135, back: 150 } as const;

/** The zone of a thumb at (dx, dy) screen px from the stick's centre (y grows down), or null inside the dead zone. */
export function stickZone(dx: number, dy: number, radius: number, prev: StickZone | null): StickZone | null {
  if (Math.hypot(dx, dy) <= STICK.dead * radius) return null;
  const a = (Math.atan2(dx, -dy) * 180) / Math.PI, abs = Math.abs(a), side: StickZone = a < 0 ? 'W' : 'E';
  if (abs <= STICK.fwd) return 'N';
  if (abs >= STICK.back) return 'S';
  if (abs >= STICK.turn && abs <= STICK.turnEnd) return side;
  if (abs < STICK.turn) return prev === side ? side : 'N'; // the upper band
  return prev === side || prev === 'S' ? prev : null; // the lower band
}

/** Buttons (19c): screen rectangles of ◀ ▲ ▶. A touch counts on a button within HIT_PAD px of it. */
export type Btn = 'fwd' | 'left' | 'right';
export interface Rect { left: number; top: number; right: number; bottom: number }
export const HIT_PAD = 6;
export function hitButton(x: number, y: number, rects: Record<Btn, Rect>): Btn | null {
  for (const b of ['fwd', 'left', 'right'] as const) {
    const r = rects[b];
    if (x >= r.left - HIT_PAD && x <= r.right + HIT_PAD && y >= r.top - HIT_PAD && y <= r.bottom + HIT_PAD) return b;
  }
  return null;
}

export type TouchAction = 'fwd' | 'jump' | 'left' | 'right' | 'back';
export type Zone = 'dpad' | 'jump' | 'look';
export interface TouchSink {
  /** As a key: fwd and jump are held (down/up); left, right and back (turn around) fire on down. */
  act(a: TouchAction, down: boolean): void;
  /** Free look: the drag so far (px from where the finger went down); `lookEnd` springs it back. */
  look(dx: number, dy: number): void;
  lookEnd(): void;
}

/** A finger on the Buttons: the button it's over (null: a gap or off), the last button it was on, and if it holds ▲. */
interface Finger { over: Btn | null; last: Btn | null; fwd: boolean }

/**
 * The touches, by identifier: the left thumb (Buttons fingers, or one on the Stick), one on Jump, one looking, each
 * independent. DOM-free, so it's unit-tested; `createTouchUI` feeds it the touch events and sets `layout`, `rects`
 * (Buttons) and `centre` (a fixed Stick; null floats).
 *
 * Buttons: ▲ holds forward for as long as a finger that has been on it stays down (slide ▲ → ◀ = W held + A). A
 * finger turns on landing on ◀/▶, or on sliding onto one from another button; never on coming back to the same
 * button through a gap, so drift turns nothing. Two taps = two pulses = 180° (the sim queues the second).
 */
export class TouchPad {
  layout: Layout = 'buttons';
  rects: Record<Btn, Rect> | null = null;
  centre: { x: number; y: number } | null = null;
  private fingers = new Map<number, Finger>();
  private stick: { id: number; x: number; y: number; radius: number; zone: StickZone | null } | null = null;
  private jumpId: number | null = null;
  private lookAt: { id: number; x: number; y: number } | null = null;
  private fwd = false;
  /** The Stick's centre and thumb (for drawing), null when no thumb is on it. */
  onPad: ((p: { cx: number; cy: number; dx: number; dy: number; zone: StickZone | null } | null) => void) | null = null;
  /** Which buttons are lit: ▲ while it holds forward, ◀/▶ while a finger is on them. */
  onButtons: ((lit: Record<Btn, boolean>) => void) | null = null;
  onJump: ((down: boolean) => void) | null = null;

  constructor(private readonly sink: TouchSink) {}

  /** A touch went down in `zone`; false if it's ignored (that zone already has its touch). */
  start(id: number, x: number, y: number, zone: Zone, radius = 60): boolean {
    if (zone === 'dpad' && this.layout === 'buttons') {
      this.fingers.set(id, { over: null, last: null, fwd: false });
      this.move(id, x, y);
    } else if (zone === 'dpad') {
      if (this.stick) return false;
      const c = this.centre ?? { x, y }; // floating: wherever this thumb went down
      this.stick = { id, x: c.x, y: c.y, radius, zone: null };
      this.move(id, x, y);
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
    const f = this.fingers.get(id);
    if (f) {
      const b = this.rects ? hitButton(x, y, this.rects) : null;
      if (b === f.over) return;
      f.over = b;
      if (b === 'fwd') f.fwd = true;
      else if (b && b !== f.last) this.sink.act(b, true);
      if (b) f.last = b;
      this.syncFwd();
    } else if (this.stick?.id === id) {
      const s = this.stick, dx = x - s.x, dy = y - s.y, zone = stickZone(dx, dy, s.radius, s.zone);
      if (zone !== s.zone) {
        s.zone = zone;
        this.syncFwd();
        if (zone === 'E' || zone === 'W' || zone === 'S') this.sink.act(zone === 'E' ? 'right' : zone === 'W' ? 'left' : 'back', true);
      }
      this.onPad?.({ cx: s.x, cy: s.y, dx, dy, zone });
    } else if (this.lookAt?.id === id) this.sink.look(x - this.lookAt.x, y - this.lookAt.y);
  }

  end(id: number): void {
    if (this.fingers.delete(id)) this.syncFwd();
    else if (this.stick?.id === id) {
      this.stick = null;
      this.syncFwd();
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
    for (const id of [...this.fingers.keys(), this.stick?.id, this.jumpId, this.lookAt?.id]) if (id !== undefined && id !== null) this.end(id);
  }

  /** Forward is held while a Buttons finger holds ▲ or the Stick is in N; also relights the buttons. */
  private syncFwd(): void {
    const fs = [...this.fingers.values()], btnFwd = fs.some((f) => f.fwd);
    const fwd = btnFwd || this.stick?.zone === 'N';
    if (fwd !== this.fwd) { this.fwd = fwd; this.sink.act('fwd', fwd); }
    this.onButtons?.({ fwd: btnFwd, left: fs.some((f) => f.over === 'left'), right: fs.some((f) => f.over === 'right') });
  }
}

export type TouchMode = 'auto' | 'on' | 'off';
export interface TouchSettings {
  mode: TouchMode;
  /** 19c: Buttons (default) or Stick. */
  layout: Layout;
  /** A Stick centred where the thumb lands, not fixed. */
  floating: boolean;
  size: 'S' | 'M' | 'L';
  opacity: number;
  lefty: boolean;
  haptics: boolean;
  /** A small FPS/ping readout (there's no F3 on a phone). */
  stats: boolean;
}
export const DEFAULT_TOUCH: TouchSettings = { mode: 'auto', layout: 'buttons', floating: false, size: 'M', opacity: 0.6, lefty: false, haptics: true, stats: false };
const KEY = 'kula.touch';

/** Settings saved before 19c have no layout, so they get Buttons. */
export function loadTouchSettings(): TouchSettings {
  const s = { ...DEFAULT_TOUCH };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<TouchSettings>;
    if (saved.mode === 'auto' || saved.mode === 'on' || saved.mode === 'off') s.mode = saved.mode;
    if (saved.layout === 'buttons' || saved.layout === 'stick') s.layout = saved.layout;
    if (saved.size === 'S' || saved.size === 'M' || saved.size === 'L') s.size = saved.size;
    if (typeof saved.opacity === 'number' && saved.opacity >= 0.2 && saved.opacity <= 1) s.opacity = saved.opacity;
    for (const k of ['floating', 'lefty', 'haptics', 'stats'] as const) if (typeof saved[k] === 'boolean') s[k] = saved[k];
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
    + `<div class="t-btns"><b class="t-bf">▲</b><b class="t-bl">◀</b><b class="t-br">▶</b></div>`
    + `<div class="t-pad"><div class="t-ring"><b class="t-n">▲</b><b class="t-w">◀</b><b class="t-e">▶</b><b class="t-s">▼</b></div><div class="t-thumb"></div></div>`
    + `<button class="t-jump" data-zone="jump">JUMP</button><button class="t-pause" aria-label="Pause">❚❚</button><button class="t-ready">Ready</button>`
    + `<div class="t-stats" hidden></div>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const padEl = $('.t-pad'), ring = $('.t-ring'), thumb = $('.t-thumb'), jump = $('.t-jump'), readyBtn = $('.t-ready'), stats = $('.t-stats');
  const arrows = { N: $('.t-n'), W: $('.t-w'), E: $('.t-e'), S: $('.t-s') };
  const btns = { fwd: $('.t-bf'), left: $('.t-bl'), right: $('.t-br') };
  const pad = new TouchPad(hooks);
  let floating = false;

  pad.onPad = (p) => {
    if (!p) { padEl.style.removeProperty('left'); padEl.style.removeProperty('top'); padEl.classList.remove('live'); thumb.style.transform = ''; }
    else {
      padEl.classList.add('live');
      padEl.style.left = `${p.cx}px`;
      padEl.style.top = `${p.cy}px`;
      const r = ring.offsetWidth / 2, d = Math.hypot(p.dx, p.dy), k = d > r ? r / d : 1; // the dot stays on the ring
      thumb.style.transform = `translate(${p.dx * k}px, ${p.dy * k}px)`;
    }
    for (const z of ['N', 'W', 'E', 'S'] as const) arrows[z].classList.toggle('on', p?.zone === z);
  };
  pad.onButtons = (lit) => { for (const b of ['fwd', 'left', 'right'] as const) btns[b].classList.toggle('on', lit[b]); };
  pad.onJump = (down) => jump.classList.toggle('on', down);

  /** Where the left-thumb controls are now (they're fixed, but the screen can rotate or resize). */
  const place = () => {
    if (pad.layout === 'buttons') {
      pad.rects = { fwd: btns.fwd.getBoundingClientRect(), left: btns.left.getBoundingClientRect(), right: btns.right.getBoundingClientRect() };
    } else if (floating) pad.centre = null;
    else { const r = padEl.getBoundingClientRect(); pad.centre = { x: r.left, y: r.top }; } // .t-pad is 0×0 at the centre
  };

  const onTouch = (e: TouchEvent) => {
    e.preventDefault(); // no mouse emulation, zoom, scroll or long-press menu
    for (const t of e.changedTouches) {
      if (e.type === 'touchstart') {
        const el = (t.target as HTMLElement).closest<HTMLElement>('[data-zone], .t-pause, .t-ready');
        if (!el) continue;
        if (el.classList.contains('t-pause')) hooks.pause();
        else if (el.classList.contains('t-ready')) hooks.ready();
        else {
          if (el.dataset.zone === 'dpad') place();
          pad.start(t.identifier, t.clientX, t.clientY, el.dataset.zone as Zone, ring.offsetWidth / 2 || 60);
        }
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
      pad.releaseAll();
      pad.layout = s.layout;
      floating = s.floating;
      root.classList.toggle('stick', s.layout === 'stick');
      root.style.setProperty('--k', String(SIZES[s.size]));
      root.style.setProperty('--touch-opacity', String(s.opacity));
      root.classList.toggle('lefty', s.lefty);
      stats.hidden = !s.stats;
    },
    /** Per frame: cheap (classes change only when the view does). Hiding lets go of every touch. */
    update(v: TouchView): void {
      const sig = `${v.shown}${v.play}${v.ready}${v.readyOn}`;
      if (sig === last) return;
      last = sig;
      if (!v.shown || !v.play) pad.releaseAll();
      root.hidden = !v.shown;
      document.body.classList.toggle('touch-ui', v.shown);
      root.classList.toggle('play', v.play);
      readyBtn.hidden = !v.ready;
      readyBtn.classList.toggle('on', v.readyOn);
      readyBtn.textContent = `${v.ready === 'rematch' ? 'Rematch' : 'Ready'}${v.readyOn ? ' ✓' : ''}`;
    },
    stats(text: string): void { if (stats.textContent !== text) stats.textContent = text; },
  };
}
