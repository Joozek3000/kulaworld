import type { Net } from './net.ts';

export interface InputHooks {
  onPress(): void; // gameplay key pressed (for the input→motion latency metric)
  onDebug(): void; // F3
  onScreenshot(): void; // F9
  onFreeze(): void; // F8: freeze the rendered frame (screenshots)
}

/** Keyboard per ARCHITECTURE §11. Sends only on change; pulses once per physical press. */
export function setupInput(net: Net, hooks: InputHooks): void {
  let fwdHeld = false;
  let seq = 0;
  const send = (turn: -1 | 0 | 1, jump: boolean) => net.sendInput({ seq: ++seq, fwdHeld, turn, jump });
  const setFwd = (held: boolean) => {
    if (held === fwdHeld) return;
    fwdHeld = held;
    send(0, false);
    if (held) hooks.onPress();
  };
  const pulse = (turn: -1 | 0 | 1, jump: boolean) => { send(turn, jump); hooks.onPress(); };

  addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': setFwd(true); break;
      case 'KeyA': case 'ArrowLeft': if (!e.repeat) pulse(-1, false); break;
      case 'KeyD': case 'ArrowRight': if (!e.repeat) pulse(1, false); break;
      case 'Space': if (!e.repeat) pulse(0, true); break;
      case 'KeyR': if (!e.repeat) net.sendReady(); break;
      case 'F3': if (!e.repeat) hooks.onDebug(); break;
      case 'F8': if (!e.repeat) hooks.onFreeze(); break;
      case 'F9': if (!e.repeat) hooks.onScreenshot(); break;
      default: return;
    }
    e.preventDefault();
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') setFwd(false);
  });
  addEventListener('blur', () => setFwd(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setFwd(false); });
}
