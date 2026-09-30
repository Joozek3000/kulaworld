import { afterEach, expect, test, vi } from 'vitest';
import type { InputMsg } from '@kula/shared';
import { DEAD_ZONE, dpadSector, dpadSectors, TouchPad, touchShown, turnEdge, type TouchAction } from './touch.ts';
import { setupInput } from '../input.ts';
import { DEFAULT_BINDINGS } from '../bindings.ts';

const R = 100;
/** The thumb at `deg` clockwise from straight up, `dist` px out (screen y grows down). */
const at = (deg: number, dist = 60): [number, number] => [Math.sin((deg * Math.PI) / 180) * dist, -Math.cos((deg * Math.PI) / 180) * dist];

test('d-pad sectors (§25): every sector, the dead zone, and the boundaries', () => {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  names.forEach((n, i) => expect(dpadSector(...at(i * 45), R)).toBe(n));
  expect(dpadSectors(...at(0), R)).toEqual({ fwd: true, turn: 0 }); // N: forward
  expect(dpadSectors(...at(45), R)).toEqual({ fwd: true, turn: 1 }); // NE: forward + right
  expect(dpadSectors(...at(90), R)).toEqual({ fwd: false, turn: 1 }); // E: right
  expect(dpadSectors(...at(135), R)).toEqual({ fwd: false, turn: 1 }); // SE: right (S adds nothing)
  expect(dpadSectors(...at(180), R)).toEqual({ fwd: false, turn: 0 }); // S: nothing
  expect(dpadSectors(...at(225), R)).toEqual({ fwd: false, turn: -1 });
  expect(dpadSectors(...at(270), R)).toEqual({ fwd: false, turn: -1 }); // W: left
  expect(dpadSectors(...at(315), R)).toEqual({ fwd: true, turn: -1 }); // NW: forward + left
  // Dead zone: 12 % of the radius, inclusive; the thumb can go past the ring.
  expect(DEAD_ZONE).toBe(0.12);
  expect(dpadSector(0, 0, R)).toBeNull();
  expect(dpadSector(...at(0, 12), R)).toBeNull();
  expect(dpadSector(...at(90, 12), R)).toBeNull();
  expect(dpadSector(...at(0, 12.5), R)).toBe('N');
  expect(dpadSector(...at(90, 250), R)).toBe('E');
  expect(dpadSectors(...at(0, 5), R)).toEqual({ fwd: false, turn: 0 });
  // Boundaries: 22.5° steps, each boundary belongs to the next sector clockwise.
  expect(dpadSector(...at(22.4), R)).toBe('N');
  expect(dpadSector(...at(22.5), R)).toBe('NE');
  expect(dpadSector(...at(67.4), R)).toBe('NE');
  expect(dpadSector(...at(67.5), R)).toBe('E');
  expect(dpadSector(...at(157.5), R)).toBe('S');
  expect(dpadSector(...at(202.4), R)).toBe('S');
  expect(dpadSector(...at(292.5), R)).toBe('NW');
  expect(dpadSector(...at(337.4), R)).toBe('NW');
  expect(dpadSector(...at(337.5), R)).toBe('N');
  expect(dpadSector(...at(359.9), R)).toBe('N');
});

test('turn pulse: one per sector entry, none while holding, one on each re-entry', () => {
  const edge = turnEdge();
  expect([0, 1, 1, 1].map((t) => edge(t as 0 | 1))).toEqual([0, 1, 0, 0]); // in, then held
  expect(edge(0)).toBe(0);
  expect(edge(1)).toBe(1); // re-entry
  expect(edge(-1)).toBe(-1); // straight across to the other side
  expect(edge(-1)).toBe(0);
});

/** A TouchPad whose actions are recorded as "fwd+", "fwd-", "right", ... */
function recorder() {
  const log: string[] = [];
  const pad = new TouchPad({
    act: (a: TouchAction, down: boolean) => log.push(a === 'left' || a === 'right' ? a : `${a}${down ? '+' : '-'}`),
    look: (dx, dy) => log.push(`look ${dx},${dy}`),
    lookEnd: () => log.push('lookEnd'),
  });
  return { log, pad, take: () => log.splice(0) };
}

test('d-pad touch: floating centre, sliding between sectors, pulses on entry only', () => {
  const { pad, take } = recorder();
  expect(pad.start(1, 300, 400, 'dpad', R)).toBe(true); // the centre is wherever the thumb lands
  expect(take()).toEqual([]);
  pad.move(1, 360, 400); // E
  pad.move(1, 380, 405); // still E
  expect(take()).toEqual(['right']);
  pad.move(1, 340, 360); // NE: forward joins, same side: no second turn
  expect(take()).toEqual(['fwd+']);
  pad.move(1, 300, 330); // N
  pad.move(1, 360, 400); // E again: a new turn, forward lets go
  expect(take()).toEqual(['fwd-', 'right']);
  pad.move(1, 302, 402); // the dead zone
  pad.move(1, 240, 400); // W
  expect(take()).toEqual(['left']);
  pad.end(1);
  expect(take()).toEqual([]);
  // A new touch re-centres: going down at 600,200 and staying there is neutral.
  pad.start(2, 600, 200, 'dpad', R);
  pad.move(2, 603, 198);
  expect(take()).toEqual([]);
  pad.move(2, 600, 140);
  expect(take()).toEqual(['fwd+']);
  pad.end(2);
  expect(take()).toEqual(['fwd-']);
});

test('multi-touch: jump while holding forward, and a look drag, each independent', () => {
  const { pad, take } = recorder();
  pad.start(1, 100, 300, 'dpad', R);
  pad.move(1, 100, 240); // N: forward held
  expect(pad.start(2, 700, 320, 'jump')).toBe(true);
  expect(pad.start(3, 600, 100, 'look')).toBe(true);
  expect(pad.start(4, 120, 300, 'dpad')).toBe(false); // a second thumb on the d-pad is ignored
  pad.move(3, 640, 90);
  pad.move(4, 300, 300);
  expect(take()).toEqual(['fwd+', 'jump+', 'look 40,-10']);
  pad.end(2); // jump lets go; forward stays held
  pad.end(4); // the ignored touch does nothing
  expect(take()).toEqual(['jump-']);
  pad.move(1, 100, 230);
  expect(take()).toEqual([]);
  pad.end(3);
  pad.end(1);
  expect(take()).toEqual(['lookEnd', 'fwd-']);
});

test('touchcancel (releaseAll): every held touch lets go, and nothing is left for a later end', () => {
  const { pad, take } = recorder();
  pad.start(1, 100, 300, 'dpad', R);
  pad.move(1, 150, 250); // NE
  pad.start(2, 700, 320, 'jump');
  pad.start(3, 600, 100, 'look');
  take();
  pad.releaseAll();
  expect(take().sort()).toEqual(['fwd-', 'jump-', 'lookEnd']);
  pad.end(1); pad.end(2); pad.end(3); pad.move(1, 100, 100);
  expect(take()).toEqual([]);
  pad.start(5, 100, 300, 'dpad', R); // free again
  pad.move(5, 150, 300);
  expect(take()).toEqual(['right']);
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
