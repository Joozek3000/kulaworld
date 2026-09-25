import type { Net } from './net.ts';

export interface InputHooks {
  onPress(): void; // gameplay key pressed (for the input→motion latency metric)
  onDebug(): void; // F3
  onScreenshot(): void; // F9
  onFreeze(): void; // F8: freeze the rendered frame (screenshots)
  onMute(): void; // M
  onVolume(delta: number): void; // [ and ]
  onTuning(): void; // F4 (dev)
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

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return; // a focused tuning slider owns the arrow keys
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': setFwd(true); break;
      case 'KeyA': case 'ArrowLeft': if (!e.repeat) turn(-1); break;
      case 'KeyD': case 'ArrowRight': if (!e.repeat) turn(1); break;
      case 'Space': setJump(true); break;
      case 'KeyR': if (!e.repeat) net.sendReady(); break;
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
