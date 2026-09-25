import { TICK_RATE, type Level } from '@kula/shared';
import type { GameState, PlayerS } from '../net.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dot = (color: string) => `<span class="dot" style="background:${esc(color)}"></span>`;
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const CONTROLS = 'W roll · A/D turn · Space jump (hold to bounce) · R ready · M mute · F3 debug';
const TOAST_MS = 2500;

function div(id: string): HTMLDivElement {
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

/** HTML overlay per phase: lobby list, big countdown, timer + scoreboard + exit status, results banner, toasts. */
export function createHud() {
  const top = div('hud-top'), center = div('hud-center'), board = div('hud-board'), status = div('hud-status'), toasts = div('hud-toasts');
  top.textContent = 'connecting…';
  const cache = new Map<HTMLElement, string>();
  const set = (el: HTMLElement, html: string) => {
    if (cache.get(el) === html) return;
    cache.set(el, html);
    el.innerHTML = html;
    el.hidden = html === '';
  };

  const byKeys = (s: GameState) => {
    const list: PlayerS[] = [];
    s.players.forEach((p) => { if (!p.spectating) list.push(p); });
    return list.sort((a, b) => b.keys - a.keys || a.name.localeCompare(b.name));
  };
  const row = (p: PlayerS, me: string, right: string) =>
    `<li class="${p.id === me ? 'me' : ''}">${dot(p.color)}<span class="name">${esc(p.name)}${p.id === me ? ' (you)' : ''}</span><span class="val">${right}</span></li>`;

  return {
    error(text: string) { set(top, esc(text)); },

    toast(text: string, color: string) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = `${dot(color)}${esc(text)}`;
      toasts.appendChild(el);
      setTimeout(() => el.classList.add('out'), TOAST_MS - 400);
      setTimeout(() => el.remove(), TOAST_MS);
    },

    update(s: GameState, me: string, level: Level | null, muted: boolean) {
      const mine = s.players.get(me);
      const required = level?.keysRequired ?? 0;
      const secs = Math.max(0, Math.ceil((s.phaseEndTick - s.tick) / TICK_RATE));
      const name = (id: string) => s.players.get(id)?.name ?? '?';
      const sound = muted ? ' · <span class="muted">muted</span>' : '';
      const levelName = esc(level?.name ?? s.levelId);

      switch (s.phase) {
        case 'lobby': {
          let ready = 0;
          const rows: string[] = [];
          s.players.forEach((p) => {
            if (p.ready) ready++;
            rows.push(row(p, me, p.ready ? '<span class="ok">ready</span>' : '<span class="dim">not ready</span>'));
          });
          const hint = mine?.ready ? `Ready. Waiting for others (${ready}/${s.players.size})` : 'Press <kbd>R</kbd> to ready';
          set(top, `Lobby · ${levelName}${sound}`);
          set(center, `<div class="panel"><h1>Key Race</h1><div class="sub">${levelName} · collect ${required} keys, then reach the exit</div><ul class="list">${rows.join('')}</ul><div class="hint">${hint}</div></div>`);
          set(board, '');
          set(status, CONTROLS);
          break;
        }
        case 'countdown':
          set(top, `${levelName}${sound}`);
          set(center, `<div class="big">${secs || 'GO'}</div>`);
          set(board, '');
          set(status, mine?.spectating ? 'Spectating: you join next round' : `Collect ${required} keys, then reach the exit`);
          break;
        case 'playing': {
          const spectating = !mine || mine.spectating;
          const keys = mine?.keys ?? 0;
          const open = keys >= required;
          set(top, `<span class="timer${secs <= 10 ? ' warn' : ''}">${clock(secs)}</span>${spectating ? ' · spectating' : ''}${sound}`);
          set(center, '');
          set(board, `<ul class="list">${byKeys(s).map((p) => row(p, me, `${p.keys}/${required}`)).join('')}</ul>`);
          set(status, spectating ? 'Spectating: you join next round'
            : `Keys <b>${keys}/${required}</b> · ${open ? '<span class="ok">Exit OPEN</span>' : '<span class="dim">Exit locked</span>'}`);
          break;
        }
        case 'results': {
          const color = s.players.get(s.winnerId)?.color ?? '#fff';
          const banner = s.winnerId ? `<h1 style="color:${esc(color)}">${esc(name(s.winnerId))} wins!</h1>` : '<h1>Draw</h1>';
          set(top, `Results${sound}`);
          set(center, `<div class="panel">${banner}<ul class="list">${byKeys(s).map((p) => row(p, me, `${p.keys} key${p.keys === 1 ? '' : 's'}`)).join('')}</ul><div class="hint">Lobby in ${secs}s</div></div>`);
          set(board, '');
          set(status, '');
          break;
        }
      }
    },
  };
}
