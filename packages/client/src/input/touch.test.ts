import { afterEach, expect, test, vi } from 'vitest';
import type { InputMsg } from '@kula/shared';
import { hitButton, HIT_PAD, STICK, stickZone, TouchPad, touchShown, type Btn, type Rect, type TouchAction } from './touch.ts';
import { setupInput } from '../input.ts';
import { DEFAULT_BINDINGS, loadBindings } from '../bindings.ts';

const R = 100;
/** The thumb at `deg` clockwise from straight up, `dist` px out (screen y grows down). */
const at = (deg: number, dist = 60): [number, number] => [Math.sin((deg * Math.PI) / 180) * dist, -Math.cos((deg * Math.PI) / 180) * dist];
/** A small seeded generator (tests only). */
const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

test('stick zones (19c): N ±40°, E/W 65–135°, S beyond 150°, 15 % dead zone, bands keep the previous zone', () => {
  expect(STICK.dead).toBe(0.15);
  expect(stickZone(...at(0), R, null)).toBe('N');
  expect(stickZone(...at(40), R, null)).toBe('N');
  expect(stickZone(...at(-40), R, null)).toBe('N');
  expect(stickZone(...at(65), R, null)).toBe('E');
  expect(stickZone(...at(-90), R, null)).toBe('W');
  expect(stickZone(...at(135), R, null)).toBe('E');
  expect(stickZone(...at(150), R, null)).toBe('S');
  expect(stickZone(...at(180), R, null)).toBe('S');
  expect(stickZone(...at(-155), R, null)).toBe('S');
  // Dead zone: 15 % of the radius, inclusive; the thumb can go past the ring.
  expect(stickZone(...at(90, 15), R, 'E')).toBeNull();
  expect(stickZone(...at(90, 15.5), R, null)).toBe('E');
  expect(stickZone(...at(90, 250), R, null)).toBe('E');
  // The upper band (40–65°): keeps N (forward, no turn), keeps a turn already on that side, else N.
  expect(stickZone(...at(55), R, 'N')).toBe('N');
  expect(stickZone(...at(55), R, 'E')).toBe('E');
  expect(stickZone(...at(-55), R, 'E')).toBe('N');
  expect(stickZone(...at(55), R, null)).toBe('N');
  // The lower band (135–150°): keeps E or S, else nothing.
  expect(stickZone(...at(142), R, 'E')).toBe('E');
  expect(stickZone(...at(142), R, 'S')).toBe('S');
  expect(stickZone(...at(142), R, 'N')).toBeNull();
});

/** A TouchPad whose actions are recorded as "fwd+", "fwd-", "right", "back", ... */
function recorder() {
  const log: string[] = [];
  const pad = new TouchPad({
    act: (a: TouchAction, down: boolean) => log.push(a === 'fwd' || a === 'jump' ? `${a}${down ? '+' : '-'}` : a),
    look: (dx, dy) => log.push(`look ${dx},${dy}`),
    lookEnd: () => log.push('lookEnd'),
  });
  return { log, pad, take: () => log.splice(0) };
}
/** A Stick fixed at (100, 300). */
function stick() {
  const r = recorder();
  r.pad.layout = 'stick';
  r.pad.centre = { x: 100, y: 300 };
  const to = (deg: number, dist = 60) => { const [dx, dy] = at(deg, dist); return [100 + dx, 300 + dy] as const; };
  return { ...r, to };
}

test('stick drift (19c): hold N, wander ±35° with noise for 3 s: forward all along, zero turns', () => {
  const { pad, take, to } = stick();
  pad.start(1, ...to(0), 'dpad', R);
  const rnd = rng(42);
  for (let f = 0; f < 180; f++) { // 3 s of 60 Hz touchmoves
    const deg = 35 * Math.sin(f / 9) + (rnd() - 0.5) * 16; // the wander, plus ±8° of noise (peaks past 40°: the band)
    pad.move(1, ...to(deg, 45 + rnd() * 40));
  }
  expect(take()).toEqual(['fwd+']);
  pad.end(1);
  expect(take()).toEqual(['fwd-']);
});

test('stick: a deliberate E flick gives one pulse; the ±65° edge does not chatter; S turns around', () => {
  const { pad, take, to } = stick();
  pad.start(1, ...to(0), 'dpad', R);
  pad.move(1, ...to(90));
  expect(take()).toEqual(['fwd+', 'fwd-', 'right']);
  for (let i = 0; i < 20; i++) { pad.move(1, ...to(60)); pad.move(1, ...to(70)); } // wobbling across the edge
  expect(take()).toEqual([]);
  pad.move(1, ...to(0)); // back to N, then E again: a second turn
  pad.move(1, ...to(95));
  expect(take()).toEqual(['fwd+', 'fwd-', 'right']);
  pad.move(1, ...to(180));
  pad.move(1, ...to(170));
  expect(take()).toEqual(['back']);
  pad.end(1);
  expect(take()).toEqual([]);
  // A fixed centre: a thumb landing up and left of it already reads (W here), wherever it lands.
  pad.start(2, ...to(-90, 80), 'dpad', R);
  expect(take()).toEqual(['left']);
  pad.end(2);
  // Floating: the centre is wherever the thumb lands, so landing is neutral.
  pad.centre = null;
  pad.start(3, 600, 200, 'dpad', R);
  pad.move(3, 603, 198);
  expect(take()).toEqual([]);
  pad.move(3, 600, 140);
  expect(take()).toEqual(['fwd+']);
});

/** ◀ and ▶ (80 px) side by side with a 16 px gap, ▲ (104 × 92) above them, 16 px up. */
const RECTS: Record<Btn, Rect> = {
  left: { left: 20, top: 300, right: 100, bottom: 380 },
  right: { left: 116, top: 300, right: 196, bottom: 380 },
  fwd: { left: 56, top: 192, right: 160, bottom: 284 },
};
function buttons() {
  const r = recorder();
  r.pad.rects = RECTS;
  return r;
}

test('buttons hit test: rectangles enlarged by a few px, the rest of the gaps dead', () => {
  expect(HIT_PAD).toBeLessThan(8); // at most half the 16 px gap
  expect(hitButton(60, 340, RECTS)).toBe('left');
  expect(hitButton(150, 340, RECTS)).toBe('right');
  expect(hitButton(108, 240, RECTS)).toBe('fwd');
  expect(hitButton(108, 340, RECTS)).toBeNull(); // between ◀ and ▶
  expect(hitButton(80, 292, RECTS)).toBeNull(); // between ▲ and ◀
  expect(hitButton(100 + HIT_PAD, 340, RECTS)).toBe('left');
  expect(hitButton(56 - HIT_PAD, 200, RECTS)).toBe('fwd');
});

test('buttons: a tap turns on touch-down, two taps turn twice (180°)', () => {
  const { pad, take } = buttons();
  pad.start(1, 60, 340, 'dpad');
  expect(take()).toEqual(['left']);
  pad.move(1, 70, 350);
  pad.end(1);
  pad.start(2, 62, 338, 'dpad');
  pad.end(2);
  expect(take()).toEqual(['left']);
  pad.start(3, 150, 340, 'dpad');
  pad.start(4, 152, 342, 'dpad'); // a second finger on ▶: another turn
  expect(take()).toEqual(['right', 'right']);
});

test('buttons: slide ▲ → ◀ turns once and keeps forward; sliding back onto ▲ does not turn', () => {
  const { pad, take } = buttons();
  pad.start(1, 108, 240, 'dpad');
  expect(take()).toEqual(['fwd+']);
  pad.move(1, 90, 290); // the gap
  pad.move(1, 70, 330); // ◀
  pad.move(1, 60, 350);
  expect(take()).toEqual(['left']); // forward still held
  pad.move(1, 100, 260); // back on ▲
  expect(take()).toEqual([]);
  pad.move(1, 150, 330); // over to ▶: a deliberate second turn
  expect(take()).toEqual(['right']);
  pad.end(1);
  expect(take()).toEqual(['fwd-']);
});

test('buttons: drift inside ▲ or the gaps never turns; ◀ → gap → ◀ turns once', () => {
  const { pad, take } = buttons();
  pad.start(1, 108, 240, 'dpad');
  const rnd = rng(7);
  for (let f = 0; f < 300; f++) pad.move(1, 108 + (rnd() - 0.5) * 60, 240 + (rnd() - 0.5) * 60); // ±30 px, sometimes into the gap above ◀ ▶
  expect(take()).toEqual(['fwd+']);
  pad.end(1);
  take();
  pad.start(2, 60, 340, 'dpad');
  pad.move(2, 108, 340); // the gap between ◀ and ▶
  pad.move(2, 95, 340); // ◀ again
  pad.move(2, 80, 292); // the gap above
  pad.move(2, 80, 320);
  expect(take()).toEqual(['left']);
  // Landing in a gap does nothing; sliding onto ▲ from there holds forward.
  pad.start(3, 108, 340, 'dpad');
  expect(take()).toEqual([]);
  pad.move(3, 108, 250);
  expect(take()).toEqual(['fwd+']);
});

test('multi-touch: jump while holding ▲, and a look drag, each independent', () => {
  const { pad, take } = buttons();
  pad.start(1, 108, 240, 'dpad');
  expect(pad.start(2, 700, 320, 'jump')).toBe(true);
  expect(pad.start(3, 600, 100, 'look')).toBe(true);
  expect(pad.start(9, 700, 320, 'jump')).toBe(false); // a second finger on Jump is ignored
  pad.move(3, 640, 90);
  expect(take()).toEqual(['fwd+', 'jump+', 'look 40,-10']);
  pad.end(2); // jump lets go; forward stays held
  pad.end(9); // the ignored touch does nothing
  expect(take()).toEqual(['jump-']);
  pad.end(3);
  pad.end(1);
  expect(take()).toEqual(['lookEnd', 'fwd-']);
});

test('touchcancel (releaseAll): every held touch lets go, and nothing is left for a later end', () => {
  for (const layout of ['buttons', 'stick'] as const) {
    const { pad, take } = buttons();
    pad.layout = layout;
    pad.start(1, 108, 240, 'dpad');
    pad.move(1, 108, 140); // the floating stick: N
    pad.start(2, 700, 320, 'jump');
    pad.start(3, 600, 100, 'look');
    take();
    pad.releaseAll();
    expect(take().sort()).toEqual(['fwd-', 'jump-', 'lookEnd']);
    pad.end(1); pad.end(2); pad.end(3); pad.move(1, 100, 100);
    expect(take()).toEqual([]);
  }
});

/** setupInput against stand-in browser globals (node has no window). */
function browser() {
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLInputElement', class {});
  const sent: InputMsg[] = [], devices: string[] = [];
  const input = setupInput({ sendInput: (i) => sent.push(i), sendReady() {}, sendVote() {} }, {
    onPress() {}, onDebug() {}, onScreenshot() {}, onFreeze() {}, onMute() {}, onVolume() {}, onTuning() {}, onPause() {},
    onDevice: (d) => devices.push(d),
  }, DEFAULT_BINDINGS);
  const key = (type: string, code: string) => win.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat: false }));
  return { win, input, sent, devices, key, touch: () => win.dispatchEvent(new Event('touchstart')) };
}
afterEach(() => { vi.unstubAllGlobals(); });

test('Auto shows the touch controls on the first touch and hides them on a keyboard press; On/Off force them', () => {
  const { input, devices, key, touch } = browser();
  expect(touchShown('auto', input.device)).toBe(false); // a desktop starts on the keyboard
  touch(); // any touch, a menu tap too
  expect(input.device).toBe('touch');
  expect(touchShown('auto', input.device)).toBe(true);
  key('keydown', 'KeyW');
  key('keyup', 'KeyW');
  expect(touchShown('auto', input.device)).toBe(false);
  input.feed('jump', true); // the touch layer itself also switches back
  input.feed('jump', false);
  expect(touchShown('auto', input.device)).toBe(true);
  expect(devices).toEqual(['touch', 'keyboard', 'touch']);
  expect(touchShown('on', 'keyboard')).toBe(true);
  expect(touchShown('off', 'touch')).toBe(false);
});

test('touch feeds the same held/pulse input: jump while holding forward, sends only on change', () => {
  const { input, sent } = browser();
  input.feed('fwd', true);
  input.feed('fwd', true); // no change: nothing sent
  input.feed('jump', true);
  input.feed('right', true);
  input.feed('jump', false);
  const view = sent.map(({ fwdHeld, jumpHeld, jump, turn }) => ({ fwdHeld, jumpHeld, jump, turn }));
  expect(view).toEqual([
    { fwdHeld: true, jumpHeld: false, jump: false, turn: 0 },
    { fwdHeld: true, jumpHeld: true, jump: true, turn: 0 }, // the press carries the jump pulse
    { fwdHeld: true, jumpHeld: true, jump: false, turn: 1 },
    { fwdHeld: true, jumpHeld: false, jump: false, turn: 0 }, // forward still held
  ]);
});

test('a blur releases touch-held input too', () => {
  const { win, input, sent } = browser();
  input.feed('fwd', true);
  input.feed('jump', true);
  win.dispatchEvent(new Event('blur'));
  expect(sent.at(-1)).toMatchObject({ fwdHeld: false, jumpHeld: false });
});

test('turn around (19c): S, ↓ and the touch back action send two turn pulses', () => {
  const { input, sent, key } = browser();
  key('keydown', 'KeyS');
  key('keyup', 'KeyS');
  input.feed('back', true);
  key('keydown', 'ArrowDown');
  expect(sent.map((m) => m.turn)).toEqual([1, 1, 1, 1, 1, 1]);
  expect(DEFAULT_BINDINGS.pad.back).toEqual([13]); // pad ▼
});

test('bindings saved before 19c: Turn around gets its defaults, minus keys already given to another action', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  const old = { keys: { ...DEFAULT_BINDINGS.keys, jump: ['KeyS'] } as Record<string, string[]>, pad: { ...DEFAULT_BINDINGS.pad } as Record<string, number[]> };
  delete old.keys.back;
  delete old.pad.back;
  store.set('kula.bindings', JSON.stringify(old));
  const b = loadBindings();
  expect(b.keys.back).toEqual(['ArrowDown']);
  expect(b.keys.jump).toEqual(['KeyS']);
  expect(b.pad.back).toEqual([13]);
});
