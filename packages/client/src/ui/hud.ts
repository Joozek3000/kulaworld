import { RANDOM_VOTE, TICK_RATE, tileKey, type Dir, type Level, type TileType } from '@kula/shared';
import type { GameState, PlayerS } from '../net.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dot = (color: string) => `<span class="dot" style="background:${esc(color)}"></span>`;
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const CONTROLS = 'W roll · A/D turn · Space jump (hold to bounce) · R ready · M mute · F3 debug';
const LOBBY_CONTROLS = '1–4 or click to vote · R ready · M mute';
/** Lobby cards (phase 14): one icon per trap type a level uses. */
const TRAP_ICONS: Record<TileType, [string, string]> = {
  spikes: ['▲', 'spikes'], fire: ['🔥', 'fire'], crumble: ['▦', 'crumble'], ice: ['❄', 'ice'], arrow: ['➜', 'arrows'], boost: ['⏫', 'boost'],
};
const trapIcons = (level: Level) => [...new Set(level.tiles.map((t) => t.type))]
  .map((t) => `<span class="trap" title="${TRAP_ICONS[t][1]}">${TRAP_ICONS[t][0]}</span>`).join('');
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

export interface LobbyHooks {
  /** A vote card was clicked: a candidate index or RANDOM_VOTE. */
  onVote(option: number): void;
  /** Cached preview image (data URL) of a level. */
  preview(level: Level): string;
  findLevel(id: string): Level | null;
}

/** HTML overlay per phase: lobby vote + list, big countdown, timer + scoreboard + exit status, results banner, toasts. */
export function createHud(lobby: LobbyHooks) {
  const top = div('hud-top'), center = div('hud-center'), board = div('hud-board'), status = div('hud-status'), toasts = div('hud-toasts');
  center.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-vote]');
    if (card) lobby.onVote(Number(card.dataset.vote));
  });
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
          // Level vote (phase 14): a card per candidate, then Random. Your vote is outlined.
          const myVote = mine?.vote ?? -1;
          const card = (option: number, body: string) => {
            const n = s.voteCounts?.[option] ?? 0;
            return `<button class="card${myVote === option ? ' mine' : ''}" data-vote="${option}"><kbd>${option + 1}</kbd>${body}`
              + `<div class="votes">${n ? `${'●'.repeat(n)} ${n}` : '<span class="dim">no votes</span>'}</div></button>`;
          };
          const cards = Array.from(s.candidates ?? [], (id, i) => {
            const l = lobby.findLevel(id);
            if (!l) return card(i, `<div class="cname">${esc(id)}</div>`);
            return card(i, `<img src="${lobby.preview(l)}" alt=""><div class="cname">${esc(l.name)}</div>`
              + `<div class="cmode">${l.mode === 'knockout' ? 'Knockout' : 'Race'} ${trapIcons(l)}</div>`);
          });
          cards.push(card(RANDOM_VOTE, '<div class="random">?</div><div class="cname">Random</div><div class="cmode dim">any level</div>'));
          const hint = mine?.ready ? `Ready. Waiting for others (${ready}/${s.players.size})` : myVote < 0 ? 'Vote for the next level, then press <kbd>R</kbd>' : 'Press <kbd>R</kbd> to ready';
          set(top, `Lobby${sound}`);
          set(center, `<div class="panel lobby"><h1>Next level</h1><div class="cards">${cards.join('')}</div><ul class="list">${rows.join('')}</ul><div class="hint">${hint}</div></div>`);
          set(board, '');
          set(status, LOBBY_CONTROLS);
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
          set(center, `<div class="panel">${banner}<ul class="list">${rows.join('')}</ul><div class="hint">Next: vote in lobby (${secs}s)</div></div>`);
          set(board, '');
          set(status, '');
          break;
        }
      }
    },
  };
}
