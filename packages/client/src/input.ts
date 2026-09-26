import type { Net } from './net.ts';

export interface InputHooks {
  onPress(): void; // gameplay key pressed (for the input→motion latency metric)
  onDebug(): void; // F3
  onScreenshot(): void; // F9
  onFreeze(): void; // F8: freeze the rendered frame (screenshots)
  onMute(): void; // M
  onVolume(delta: number): void; // [ and ]
  onTuning(): void; // F4 (dev)
  /** A gameplay key went down (not a repeat): its label and the event's timeStamp (latency audit). */
  onKey?(key: string, at: number): void;
}

/**
 * Keyboard per ARCHITECTURE §6/§11. Sends only on change. Turn and jump fire a pulse once per physical press;
 * forward and jump are also held states (holding Space keeps bouncing).
 */
export function setupInput(net: Net, hooks: InputHooks): { readonly fwdHeld: boolean } {
  let fwdHeld = false;
  let jumpHeld = false;
  let seq = 0;
  const send = (turn: -1 | 0 | 1, jump: boolean) => net.sendInput({ seq: ++seq, fwdHeld, turn, jump, jumpHeld });
  const setFwd = (held: boolean) => {
    if (held === fwdHeld) return;
    fwdHeld = held;
    send(0, false);
    if (held) hooks.onPress();
  };
  const setJump = (held: boolean) => {
    if (held === jumpHeld) return;
    jumpHeld = held;
    send(0, held); // the press also carries the jump pulse, so a tap shorter than a tick still bounces once
    if (held) hooks.onPress();
  };
  const turn = (t: -1 | 1) => { send(t, false); hooks.onPress(); };
  const releaseAll = () => { setFwd(false); setJump(false); };

  const LABELS: Record<string, string> = { KeyW: 'W', ArrowUp: 'W', KeyA: 'A', ArrowLeft: 'A', KeyD: 'D', ArrowRight: 'D', Space: 'Space' };
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return; // a focused tuning slider owns the arrow keys
    if (!e.repeat && LABELS[e.code]) hooks.onKey?.(LABELS[e.code], e.timeStamp);
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': setFwd(true); break;
      case 'KeyA': case 'ArrowLeft': if (!e.repeat) turn(-1); break;
      case 'KeyD': case 'ArrowRight': if (!e.repeat) turn(1); break;
      case 'Space': setJump(true); break;
      case 'KeyR': if (!e.repeat) net.sendReady(); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': // lobby level vote (phase 14): 4 = Random
        if (!e.repeat) net.sendVote(Number(e.code.slice(5)) - 1);
        break;
      case 'KeyM': if (!e.repeat) hooks.onMute(); break;
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
    if (e.code === 'KeyW' || e.code === 'ArrowUp') setFwd(false);
    if (e.code === 'Space') setJump(false);
  });
  addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
  return { get fwdHeld() { return fwdHeld; } };
}
