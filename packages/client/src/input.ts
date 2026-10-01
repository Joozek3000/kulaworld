import type { GameSource } from './net.ts';
import { ACTIONS, PAD, type BindAction, type Bindings } from './bindings.ts';

export interface InputHooks {
  onPress(): void; // gameplay key pressed (for the input→motion latency metric)
  onDebug(): void; // F3
  onScreenshot(): void; // F9
  onFreeze(): void; // F8: freeze the rendered frame (screenshots)
  onMute(): void;
  onVolume(delta: number): void; // [ and ]
  onTuning(): void; // F4 (dev)
  onPause(): void; // single player (phase 15b)
  onLook?(held: boolean): void; // free look held (phase 17)
  /** Right stick (phase 17), each frame a pad is connected: -1..1 after the deadzone. */
  onLookStick?(x: number, y: number): void;
  /** A gameplay key went down (not a repeat): its label and the event's timeStamp (latency audit). */
  onKey?(key: string, at: number): void;
  /** Menus (phase 17): a menu is up, so the pad navigates it instead of playing. */
  menuActive?(): boolean;
  onMenuNav?(dir: -1 | 1): void;
  onMenuConfirm?(): void;
  /** Lobby vote with the pad: X next option, Y previous (phase 17). */
  onVoteStep?(step: -1 | 1): void;
  /** Match-length vote with the pad: RB next, LB previous (phase 18b). */
  onLengthStep?(step: -1 | 1): void;
  /** The device last used changed (the HUD shows pad glyphs; touch shows the touch controls, phase 19b). */
  onDevice?(device: Device): void;
}

type Sender = Pick<GameSource, 'sendInput' | 'sendReady' | 'sendVote'>;
export type Device = 'keyboard' | 'pad' | 'touch';
type Captured = { code: string } | { button: number };
const DEAD = 0.5, RELEASE = 0.3, LOOK_DEAD = 0.2;

/**
 * Keyboard and gamepad per ARCHITECTURE §6/§11 (19c: plus Turn around, two turn pulses), through rebindable actions (phase 17), and touch (phase 19b, fed by
 * input/touch.ts through `feed`). Sends only on change. Turn and jump fire a pulse once per physical press; forward
 * and jump are also held states (holding jump keeps bouncing). Each device holds its own state; the ball gets their
 * union. `device` starts as `initial` (touch on a coarse-pointer screen).
 */
export function setupInput(net: Sender, hooks: InputHooks, bindings: Bindings, initial: Device = 'keyboard') {
  const held = { key: { fwd: false, jump: false }, pad: { fwd: false, jump: false }, touch: { fwd: false, jump: false } };
  let fwdHeld = false, jumpHeld = false, seq = 0;
  let device: Device = initial;
  let capture: ((c: Captured) => void) | null = null;
  const send = (turn: -1 | 0 | 1, jump: boolean) => net.sendInput({ seq: ++seq, fwdHeld, turn, jump, jumpHeld });
  const use = (d: Device) => { if (d !== device) { device = d; hooks.onDevice?.(d); } };
  /** Recomputes the held union; sends when it changed (a new jump hold also carries the jump pulse). */
  const sync = () => {
    const f = held.key.fwd || held.pad.fwd || held.touch.fwd, j = held.key.jump || held.pad.jump || held.touch.jump;
    if (f === fwdHeld && j === jumpHeld) return;
    const pulse = j && !jumpHeld;
    if ((f && !fwdHeld) || pulse) hooks.onPress();
    fwdHeld = f;
    jumpHeld = j;
    send(0, pulse); // the press also carries the jump pulse, so a tap shorter than a tick still bounces once
  };
  const turn = (t: -1 | 1) => { send(t, false); hooks.onPress(); };
  /** Turn around (19c): two turn pulses (the sim queues the second behind the first). */
  const back = () => { turn(1); turn(1); };
  /** An action pressed (`down`) or released on a device. */
  const act = (a: BindAction, down: boolean, src: 'key' | 'pad' | 'touch') => {
    switch (a) {
      case 'fwd': held[src].fwd = down; sync(); break;
      case 'jump': held[src].jump = down; sync(); break;
      case 'left': if (down) turn(-1); break;
      case 'right': if (down) turn(1); break;
      case 'back': if (down) back(); break;
      case 'look': hooks.onLook?.(down); break;
      case 'ready': if (down) net.sendReady(); break;
      case 'pause': if (down) hooks.onPause(); break;
      case 'mute': if (down) hooks.onMute(); break;
    }
  };
  const actionOfKey = (code: string) => ACTIONS.find((a) => bindings.keys[a].includes(code));
  const releaseAll = () => {
    held.key.fwd = held.key.jump = held.pad.fwd = held.pad.jump = held.touch.fwd = held.touch.jump = false;
    sync();
    hooks.onLook?.(false);
  };

  const LABELS: Record<string, string> = { fwd: 'W', left: 'A', right: 'D', jump: 'Space' };
  addEventListener('keydown', (e) => {
    if (capture) { e.preventDefault(); if (!e.repeat) { const c = capture; capture = null; if (e.code !== 'Escape') c({ code: e.code }); else c({ code: '' }); } return; }
    if (e.target instanceof HTMLInputElement) return; // a focused slider or name field owns the keys
    use('keyboard');
    const a = actionOfKey(e.code);
    if (a) {
      if (!e.repeat && LABELS[a]) hooks.onKey?.(LABELS[a], e.timeStamp);
      if (!e.repeat || a === 'fwd' || a === 'jump') act(a, true, 'key');
      e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': // lobby level vote (phase 14): 4 = Random
        if (!e.repeat) net.sendVote(Number(e.code.slice(5)) - 1);
        break;
      case 'BracketLeft': hooks.onVolume(-0.1); break;
      case 'BracketRight': hooks.onVolume(0.1); break;
      case 'F4': if (!e.repeat) hooks.onTuning(); break;
      case 'F3': if (!e.repeat) hooks.onDebug(); break;
      case 'F8': if (!e.repeat) hooks.onFreeze(); break;
      case 'F9': if (!e.repeat) hooks.onScreenshot(); break;
      default: return;
    }
    e.preventDefault();
  });
  addEventListener('keyup', (e) => {
    const a = actionOfKey(e.code);
    if (a === 'fwd' || a === 'jump' || a === 'look') act(a, false, 'key');
  });
  addEventListener('blur', releaseAll);
  // Any touch (a menu tap too) makes touch the device: Auto shows the touch controls on the first touch (§25).
  addEventListener('touchstart', () => use('touch'), { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  // Gamepad (phase 17): polled once per frame. Buttons and the left stick are edge-detected against last frame.
  let prev: boolean[] = [], stickX = 0, stickY = 0, padIndex = -1;
  addEventListener('gamepadconnected', (e) => { if (padIndex < 0) padIndex = (e as GamepadEvent).gamepad.index; });
  addEventListener('gamepaddisconnected', (e) => {
    if ((e as GamepadEvent).gamepad.index !== padIndex) return;
    padIndex = -1;
    held.pad.fwd = held.pad.jump = false;
    sync();
  });
  const pad = (): Gamepad | null => {
    const pads = navigator.getGamepads?.() ?? [];
    if (padIndex >= 0 && pads[padIndex]) return pads[padIndex];
    const p = [...pads].find((g) => g?.connected) ?? null;
    padIndex = p ? p.index : -1;
    return p;
  };
  /** A stick axis with hysteresis: -1, 0 or 1 (press past DEAD, release under RELEASE: no repeats while held). */
  const axis = (v: number, was: number) => (Math.abs(v) >= DEAD ? Math.sign(v) : Math.abs(v) < RELEASE ? 0 : was);

  return {
    get fwdHeld() { return fwdHeld; },
    get device() { return device; },
    /** Touch (phase 19b): an action from the touch layer, held or pressed like a key. */
    feed(a: 'fwd' | 'jump' | 'left' | 'right' | 'back', down: boolean): void { use('touch'); act(a, down, 'touch'); },
    /** Rebinding (phase 17): the next key or pad button goes to `cb` instead of the game ({ code: '' }: cancelled with Esc). */
    captureNext(cb: (c: Captured) => void) { capture = cb; },
    /** Once per frame: reads the pad, if any. */
    poll(): void {
      const p = pad();
      if (!p) return;
      const now = p.buttons.map((b) => b.pressed);
      const edge = (i: number) => now[i] && !prev[i];
      const any = now.some(Boolean) || p.axes.some((v) => Math.abs(v) > DEAD);
      if (any) use('pad');
      if (capture) {
        const i = now.findIndex((b, k) => b && !prev[k]);
        if (i >= 0) { const c = capture; capture = null; c({ button: i }); }
        prev = now;
        return;
      }
      const sx = axis(p.axes[0] ?? 0, stickX), sy = axis(p.axes[1] ?? 0, stickY);
      if (hooks.menuActive?.()) {
        if (edge(PAD.UP) || (sy < 0 && stickY >= 0)) hooks.onMenuNav?.(-1);
        if (edge(PAD.DOWN) || (sy > 0 && stickY <= 0)) hooks.onMenuNav?.(1);
        if (edge(PAD.A) || edge(PAD.B)) hooks.onMenuConfirm?.();
        if (edge(PAD.START)) hooks.onPause();
        if (held.pad.fwd || held.pad.jump) { held.pad.fwd = held.pad.jump = false; sync(); }
      } else {
        const on = (a: BindAction) => bindings.pad[a].some((i) => now[i]);
        const pressed = (a: BindAction) => bindings.pad[a].some((i) => edge(i));
        const released = (a: BindAction) => bindings.pad[a].some((i) => !now[i] && prev[i]);
        const f = on('fwd') || sy < 0, j = on('jump');
        if (f !== held.pad.fwd) act('fwd', f, 'pad');
        if (j !== held.pad.jump) act('jump', j, 'pad');
        if (pressed('left') || (sx < 0 && stickX >= 0)) act('left', true, 'pad');
        if (pressed('right') || (sx > 0 && stickX <= 0)) act('right', true, 'pad');
        if (pressed('back') || (sy > 0 && stickY <= 0)) act('back', true, 'pad');
        for (const a of ['ready', 'pause', 'mute'] as const) if (pressed(a)) act(a, true, 'pad');
        if (pressed('look')) act('look', true, 'pad');
        if (released('look')) act('look', false, 'pad');
        if (edge(PAD.X)) hooks.onVoteStep?.(1);
        if (edge(PAD.Y)) hooks.onVoteStep?.(-1);
        if (edge(PAD.RB)) hooks.onLengthStep?.(1);
        if (edge(PAD.LB)) hooks.onLengthStep?.(-1);
      }
      stickX = sx;
      stickY = sy;
      const rx = p.axes[2] ?? 0, ry = p.axes[3] ?? 0;
      hooks.onLookStick?.(Math.abs(rx) > LOOK_DEAD ? rx : 0, Math.abs(ry) > LOOK_DEAD ? ry : 0);
      prev = now;
    },
    /** Rumble (phase 17) if the pad supports it: `strength` 0..1 for `ms`. */
    rumble(strength: number, ms: number): void {
      const p = pad() as (Gamepad & { vibrationActuator?: { playEffect?(t: string, o: object): Promise<unknown> } }) | null;
      if (device !== 'pad') return;
      p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 })?.catch(() => {});
    },
  };
}
