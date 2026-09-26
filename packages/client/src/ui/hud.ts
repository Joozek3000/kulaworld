import { TICK_RATE, tileKey, type Dir, type Level } from '@kula/shared';
import type { GameState, PlayerS } from '../net.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dot = (color: string) => `<span class="dot" style="background:${esc(color)}"></span>`;
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const CONTROLS = 'W roll · A/D turn · Space jump (hold to bounce) · R ready · M mute · F3 debug';
const TOAST_MS = 2500;
const CRUMBLE_COUNTDOWN_SEC = 5;
const hearts = (lives: number, max: number) =>
  `<span class="hearts">${'♥'.repeat(lives)}<span class="dim">${'♥'.repeat(Math.max(0, max - lives))}</span></span>`;
const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`); // up to 8 players

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
  /** Knockout standings: players still in (most lives, then knockouts), then the eliminated, latest out first. */
  const byPlace = (s: GameState) => {
    const list: PlayerS[] = [];
    s.players.forEach((p) => { if (!p.spectating) list.push(p); });
    return list.sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.lives - a.lives || b.knockouts - a.knockouts
      || b.eliminatedTick - a.eliminatedTick || a.name.localeCompare(b.name));
  };
  const row = (p: PlayerS, me: string, right: string) =>
    `<li class="${p.id === me ? 'me' : ''}${p.eliminated ? ' out' : ''}">${dot(p.color)}<span class="name">${esc(p.name)}${p.id === me ? ' (you)' : ''}</span><span class="val">${right}</span></li>`;

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
      const MOVE = '<div class="big move">MOVE!</div>';
      const mine = s.players.get(me);
      const required = level?.keysRequired ?? 0;
      const secs = Math.max(0, Math.ceil((s.phaseEndTick - s.tick) / TICK_RATE));
      const name = (id: string) => s.players.get(id)?.name ?? '?';
      const sound = muted ? ' · <span class="muted">muted</span>' : '';
      const levelName = esc(level?.name ?? s.levelId);
      const ko = (level?.mode ?? s.mode) === 'knockout';
      const maxLives = level?.lives ?? 3;
      const goal = ko ? `last ball rolling wins · ${maxLives} lives` : `collect ${required} keys, then reach the exit`;
      // Hot tile (phase 12): the local ball has stood still long enough to glow.
      const hot = !!mine && !!level?.heat && s.phase === 'playing' && !mine.spectating
        && (s.hot.get(tileKey({ x: mine.fromX, y: mine.fromY, z: mine.fromZ }, mine.fromUp as Dir)) ?? 0) >= level.heat.warnTicks;

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
          set(center, `<div class="panel"><h1>${ko ? 'Knockout' : 'Key Race'}</h1><div class="sub">${levelName} · ${goal}</div><ul class="list">${rows.join('')}</ul><div class="hint">${hint}</div></div>`);
          set(board, '');
          set(status, CONTROLS);
          break;
        }
        case 'countdown':
          set(top, `${levelName}${sound}`);
          set(center, `<div class="big">${secs || 'GO'}</div>`);
          set(board, '');
          set(status, mine?.spectating ? 'Spectating: you join next round' : goal[0].toUpperCase() + goal.slice(1));
          break;
        case 'playing': {
          const spectating = !mine || mine.spectating;
          if (ko) {
            const out = !!mine?.eliminated;
            const crumbleIn = s.nextCrumbleTick >= 0 ? Math.ceil((s.nextCrumbleTick - s.tick) / TICK_RATE) : -1;
            const crumble = crumbleIn > 0 && crumbleIn <= CRUMBLE_COUNTDOWN_SEC ? ` · <span class="warn">Floor crumbles in ${crumbleIn}</span>` : '';
            set(top, `<span class="timer${secs <= 10 ? ' warn' : ''}">${clock(secs)}</span>${spectating ? ' · spectating' : ''}${crumble}${sound}`);
            const by = mine?.eliminatedBy ? ` by ${esc(name(mine.eliminatedBy))}` : '';
            set(center, out ? `<div class="panel"><h1 class="warn">ELIMINATED</h1><div class="sub">Knocked out${by} · spectating</div></div>` : hot ? MOVE : '');
            set(board, `<ul class="list">${byPlace(s).map((p) => row(p, me, p.eliminated ? '<span class="dim">out</span>' : `${hearts(p.lives, maxLives)} ${p.knockouts ? `KO ${p.knockouts}` : ''}`)).join('')}</ul>`);
            set(status, spectating ? 'Spectating: you join next round' : out ? 'Spectating until the round ends'
              : `Lives ${hearts(mine!.lives, maxLives)} · Knockouts <b>${mine!.knockouts}</b>`);
            break;
          }
          const keys = mine?.keys ?? 0;
          const open = keys >= required;
          const crumbleIn = s.nextCrumbleTick >= 0 ? Math.ceil((s.nextCrumbleTick - s.tick) / TICK_RATE) : -1; // race sudden death
          const crumble = crumbleIn > 0 && crumbleIn <= CRUMBLE_COUNTDOWN_SEC ? ` · <span class="warn">Floor crumbles in ${crumbleIn}</span>` : '';
          set(top, `<span class="timer${secs <= 10 ? ' warn' : ''}">${clock(secs)}</span>${spectating ? ' · spectating' : ''}${crumble}${sound}`);
          set(center, hot ? MOVE : '');
          set(board, `<ul class="list">${byKeys(s).map((p) => row(p, me, `${p.keys}/${required}`)).join('')}</ul>`);
          set(status, spectating ? 'Spectating: you join next round'
            : `Keys <b>${keys}/${required}</b> · ${open ? '<span class="ok">Exit OPEN</span>' : '<span class="dim">Exit locked</span>'}`);
          break;
        }
        case 'results': {
          const color = s.players.get(s.winnerId)?.color ?? '#fff';
          const banner = s.winnerId ? `<h1 style="color:${esc(color)}">${esc(name(s.winnerId))} wins!</h1>` : '<h1>Draw</h1>';
          set(top, `Results${sound}`);
          const rows = ko
            ? byPlace(s).map((p, i) => row(p, me, `${ordinal(i + 1)} · ${p.eliminated ? 'out' : hearts(p.lives, maxLives)} · KO ${p.knockouts}`))
            : byKeys(s).map((p) => row(p, me, `${p.keys} key${p.keys === 1 ? '' : 's'}`));
          set(center, `<div class="panel">${banner}<ul class="list">${rows.join('')}</ul><div class="hint">Lobby in ${secs}s</div></div>`);
          set(board, '');
          set(status, '');
          break;
        }
      }
    },
  };
}
