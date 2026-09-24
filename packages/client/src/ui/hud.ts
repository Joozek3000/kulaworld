import { TICK_RATE } from '@kula/shared';
import type { GameState } from '../net.ts';

/** Placeholder HUD: phase, time left, ready hint. The full HUD is phase 05. */
export function createHud() {
  const el = document.createElement('div');
  el.id = 'hud';
  el.textContent = 'connecting…';
  document.body.appendChild(el);
  let last = '';
  const show = (text: string) => { if (text !== last) el.textContent = last = text; };

  return {
    error: show,
    update(s: GameState, localId: string) {
      const me = s.players.get(localId);
      const secs = Math.max(0, Math.ceil((s.phaseEndTick - s.tick) / TICK_RATE));
      let ready = 0;
      s.players.forEach((p) => { if (p.ready) ready++; });
      const name = (id: string) => s.players.get(id)?.name ?? '?';
      switch (s.phase) {
        case 'lobby': show(`Lobby · ${me?.ready ? 'ready, waiting for others' : 'press R to ready'} (${ready}/${s.players.size} ready)`); break;
        case 'countdown': show(`Starting in ${secs}…`); break;
        case 'playing': show(me?.spectating ? `Spectating · ${secs}s left` : `Playing · ${secs}s left · keys ${me?.keys ?? 0}`); break;
        case 'results': show(`${s.winnerId ? `${name(s.winnerId)} wins` : 'Draw'} · lobby in ${secs}s`); break;
      }
    },
  };
}
