import { EFFECT_TICKS, RANDOM_VOTE, TICK_RATE, tileKey, type Dir, type Level, type PickupType, type TileType } from '@kula/shared';
import type { GameState, PlayerS, StandingS } from '../net.ts';
import { matchOrder, matchPlaces, MATCH_LENGTHS, mvps, type MatchStats } from '@kula/shared';
import { PILL_ICONS } from '../render/players.ts';
import type { LocalState } from '../local.ts';
import { fruitSlots } from './menu.ts';
import { GAME_NAME } from '../config.ts';

/** Single player's HUD extras (§22): the campaign's banked score and fruits, and the level's label. */
export interface SingleHud { score: number; fruits: number; label: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dot = (color: string) => `<span class="dot" style="background:${esc(color)}"></span>`;
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const CONTROLS = 'W roll · A/D turn · Space jump (hold to bounce) · R ready · M mute · F3 debug';
const LOBBY_CONTROLS = '1–4 or click to vote · R ready · M mute';
/** Lobby cards (phase 14): one icon per trap type a level uses. */
const TRAP_ICONS: Record<TileType | 'laser' | 'invisible' | 'vanish', [string, string]> = {
  spikes: ['▲', 'spikes'], fire: ['🔥', 'fire'], crumble: ['▦', 'crumble'], ice: ['❄', 'ice'], arrow: ['➜', 'arrows'], boost: ['⏫', 'boost'],
  teleport: ['◎', 'teleporters'], switch: ['⚡', 'lasers'], clock: ['⏱', 'clock'], paint: ['🎨', 'paint'], laser: ['⚡', 'lasers'], invisible: ['▢', 'invisible blocks'], vanish: ['◌', 'vanishing blocks'],
};
const trapIcons = (level: Level) => [...new Set([
  ...level.tiles.map((t) => (t.type === 'switch' ? 'laser' : t.type)),
  ...(level.lasers.length ? ['laser' as const] : []), ...(level.invisible.size ? ['invisible' as const] : []), ...(level.vanish.size ? ['vanish' as const] : []),
])].map((t) => `<span class="trap" title="${TRAP_ICONS[t][1]}">${TRAP_ICONS[t][0]}</span>`).join('');
const TOAST_MS = 2500;
/** Pills (15a): the local player's effects, each an icon in a ring that runs down with the time left. */
function pillRings(p: PlayerS | undefined, tick: number): string {
  const out: string[] = [];
  p?.effects?.forEach((until, type) => {
    const left = Math.max(0, until - tick), frac = left / EFFECT_TICKS[type as PickupType];
    out.push(`<span class="pill ${esc(type)}" style="--p:${frac.toFixed(3)}" title="${esc(type)}"><i>${PILL_ICONS[type] ?? '?'}</i><b>${Math.ceil(left / TICK_RATE)}</b></span>`);
  });
  return out.join('');
}
const CRUMBLE_COUNTDOWN_SEC = 5;
/** Matches (phase 18): "Round n/N" over the in-round board, points and the crown on each line. */
const matchHead = (s: GameState) => (s.matchRounds && s.matchRound ? `<div class="round">Round ${s.matchRound}/${s.matchRounds}</div>` : '');
const matchPoints = (s: GameState, id: string) => {
  const st = s.standings?.get(id);
  return st ? ` · <b>${st.points}</b> pts` : '';
};
const crownMark = (s: GameState, id: string) => (s.crownId && s.crownId === id ? '👑 ' : '');
/** A board line: name, points, and (`pop`) the round's gain and its breakdown popping in. Leavers are greyed. */
function standingRow(st: StandingS, me: string, crownId: string, pop = false): string {
  const gain = pop && st.roundPoints ? ` <span class="pop">+${st.roundPoints}</span> <small class="dim">${esc(st.breakdown)}</small>` : '';
  return `<li class="${st.id === me ? 'me' : ''}${st.left ? ' out' : ''}">${dot(st.color)}<span class="name">${crownId === st.id ? '👑 ' : ''}${esc(st.name)}${st.id === me ? ' (you)' : ''}${st.left ? ' <span class="dim">(left)</span>' : ''}</span><span class="val"><b>${st.points}</b>${gain}</span></li>`;
}
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
  /** Matches (phase 18): a match-length card (0..2) or a rematch button was clicked. */
  onLength?(option: number): void;
  onRematch?(yes: boolean): void;
  /** Online rooms (phase 19): the host's bot buttons and difficulty (0..2), the invite link, the Leave button. */
  onBot?(what: 'addBot' | 'removeBot' | 'fill'): void;
  onBotLevel?(level: number): void;
  onCopy?(link: string): void;
  onLeave?(): void;
}

const BOT_LEVELS = ['Easy', 'Normal', 'Hard'];
/** A lone human in a public lobby this long (ms) gets the host's "Fill with bots" prompt (§24). */
const FILL_PROMPT_MS = 30_000;
/** The invite link for a private room's code (§24). */
export const inviteLink = (code: string) => `${location.origin}${location.pathname}?room=${code}`;

/** Match board lines (phase 18), in match order (points, then wins, KOs, keys: 18b); players who left too, drawn greyed. */
function boardOf(s: GameState): StandingS[] {
  const list: StandingS[] = [];
  s.standings?.forEach((st) => list.push(st));
  return list.sort((a, b) => matchOrder(a, b) || a.name.localeCompare(b.name));
}
/** "A", "A and B", "A, B and C". */
const names = (list: string[]) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);
/** Seconds into the matchEnd phase before the stats card replaces the podium names. */
export const PODIUM_SEC = 5;

/** HTML overlay per phase: lobby vote + list, big countdown, timer + scoreboard + exit status, results banner, toasts. */
export function createHud(lobby: LobbyHooks) {
  const top = div('hud-top'), center = div('hud-center'), board = div('hud-board'), status = div('hud-status'), toasts = div('hud-toasts'), fx = div('hud-fx');
  center.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-vote]');
    if (card) lobby.onVote(Number(card.dataset.vote));
    const len = (e.target as HTMLElement).closest<HTMLElement>('[data-length]');
    if (len) lobby.onLength?.(Number(len.dataset.length));
    const re = (e.target as HTMLElement).closest<HTMLElement>('[data-rematch]');
    if (re) lobby.onRematch?.(re.dataset.rematch === 'yes');
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-bot],[data-level],[data-copy],[data-leave]');
    if (b?.dataset.bot) lobby.onBot?.(b.dataset.bot as 'addBot');
    if (b?.dataset.level) lobby.onBotLevel?.(Number(b.dataset.level));
    if (b?.dataset.copy) lobby.onCopy?.(inviteLink(b.dataset.copy));
    if (b && 'leave' in b.dataset) lobby.onLeave?.();
  });
  /** When the host became a lone human in a public lobby (0 = not alone). */
  let aloneSince = 0;
  top.textContent = 'connecting…';
  const padHint = div('pad-hint');
  padHint.innerHTML = '🎮 ▲/stick roll · ◀▶ turn · Ⓐ jump · R-stick look · Ⓑ ready · Ⓧ/Ⓨ vote · LB/RB length · Start pause';
  padHint.hidden = true;
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
  /** The host (phase 19): a small ★ on their line. */
  let hostId = '';
  const row = (p: PlayerS, me: string, right: string) =>
    `<li class="${p.id === me ? 'me' : ''}${p.eliminated || p.away ? ' out' : ''}">${dot(p.color)}<span class="name">${esc(p.name)}${p.id === me ? ' (you)' : ''}`
    + `${p.id === hostId ? ' <span class="host" title="host">★</span>' : ''}${p.away ? ' <span class="dim">reconnecting…</span>' : ''}</span><span class="val">${right}</span></li>`;
  /**
   * The room bar over the lobby (phase 19): a private room's code with its invite link, the host's bot controls
   * (difficulty before the match only), Leave; and after 30 s alone in a public room, the host's "Fill with bots".
   */
  const roomBar = (s: GameState, me: string): string => {
    const list: PlayerS[] = [];
    s.players.forEach((p) => list.push(p));
    const bots = list.filter((p) => p.bot).length, humans = list.length - bots, host = s.hostId === me;
    const alone = host && !s.code && humans === 1 && bots === 0;
    if (!alone) aloneSince = 0;
    else if (!aloneSince) aloneSince = performance.now();
    const code = s.code ? `<span class="dim">Room code</span> <b class="code">${esc(s.code)}</b> <button class="mini" data-copy="${esc(s.code)}">Copy invite link</button>` : '';
    const level = s.botLevel ?? 1;
    const levels = (s.matchRound ?? 0) === 0 ? BOT_LEVELS.map((n, i) => `<button class="mini${i === level ? ' on' : ''}" data-level="${i}">${n}</button>`).join('') : `<span class="dim">${BOT_LEVELS[level]}</span>`;
    const botCtl = host ? `<span class="bots">🤖 <button class="mini" data-bot="removeBot"${bots ? '' : ' disabled'}>−</button> ${bots} <button class="mini" data-bot="addBot"${list.length < 8 ? '' : ' disabled'}>+</button> ${levels}</span>` : '';
    const fill = alone && performance.now() - aloneSince >= FILL_PROMPT_MS
      ? '<div class="fill">Nobody else here yet. <button class="mini on" data-bot="fill">Fill with bots</button></div>' : '';
    return `<div class="roombar">${code}${botCtl}<button class="mini" data-leave>Leave</button></div>${fill}`;
  };

  return {
    error(text: string) { set(top, esc(text)); },

    /** Gamepad in use (phase 17): a hint with the controller glyphs, bottom left. */
    padHint(on: boolean) {
      padHint.hidden = !on;
    },

    /** Hides every HUD panel (the main menu). */
    clear() { for (const el of [top, center, board, status, fx]) set(el, ''); },

    /**
     * Single player (§22): score, the level timer (flashing under 10 s, blue while a clock froze it), keys x/total (or
     * the paint count on a bonus level), the 5 fruit slots, the pill rings, and the level name.
     */
    single(s: LocalState, me: string, sp: SingleHud, muted: boolean) {
      const v = s.single, mine = s.players.get(me);
      const secs = Math.ceil(v.timer / TICK_RATE), low = secs <= 10 && !v.frozen && s.phase === 'playing';
      const sound = muted ? ' · <span class="muted">muted</span>' : '';
      set(fx, s.phase === 'playing' ? pillRings(mine, s.tick) : '');
      set(top, `<span class="timer${low ? ' warn flash' : ''}${v.frozen ? ' frozen' : ''}">${v.frozen ? '⏸ ' : ''}${clock(secs)}</span> · <b>${esc(sp.label)}</b>${sound}`);
      set(board, `<div class="score">${sp.score.toLocaleString('en-US')}</div><div class="fruits">${fruitSlots(sp.fruits | v.fruits)}</div>`);
      const goal = v.paintTotal && !v.keysTotal ? `Paint <b>${v.lit.size}/${v.paintTotal}</b>`
        : `Keys <b>${mine?.keys ?? 0}/${v.keysTotal}</b> · ${(mine?.keys ?? 0) >= v.keysTotal ? '<span class="ok">Exit OPEN</span>' : '<span class="dim">Exit locked</span>'}`;
      set(status, s.phase === 'countdown' ? `${esc(sp.label)} · get ready` : goal);
      set(center, s.phase === 'countdown' ? '<div class="big ready">READY</div>' : '');
    },

    toast(text: string, color: string) {
      const el = document.createElement('div'), d = document.createElement('span');
      el.className = 'toast';
      d.className = 'dot';
      d.style.background = color;
      el.append(d, text); // names go in as text (phase 19)
      toasts.appendChild(el);
      setTimeout(() => el.classList.add('out'), TOAST_MS - 400);
      setTimeout(() => el.remove(), TOAST_MS);
    },

    update(s: GameState, me: string, level: Level | null, muted: boolean, sp?: SingleHud) {
      if (sp && 'single' in s) { this.single(s as LocalState, me, sp, muted); return; }
      const MOVE = '<div class="big move">MOVE!</div>';
      const mine = s.players.get(me);
      hostId = s.hostId ?? '';
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

      set(fx, s.phase === 'playing' ? pillRings(mine, s.tick) : '');
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
          set(top, `${GAME_NAME} · Lobby${sound}`);
          const round = s.matchRound ?? 0, rounds = s.matchRounds ?? 0;
          let match = '';
          if (s.standings && round === 0) {
            const lv = mine?.lengthVote ?? -1;
            match = `<h2>Match length <small class="dim">(🎮 LB/RB)</small></h2><div class="cards lengths">${MATCH_LENGTHS.map((n, i) => {
              const c = s.lengthVotes?.[i] ?? 0;
              return `<button class="card len${lv === i ? ' mine' : ''}" data-length="${i}"><div class="cname">${n} rounds</div>`
                + `<div class="votes">${c ? `${'●'.repeat(c)} ${c}` : '<span class="dim">no votes</span>'}</div></button>`;
            }).join('')}</div>`;
          } else if (s.standings && rounds) {
            match = `<h2>Round ${round + 1} of ${rounds}</h2><ul class="list board">${boardOf(s).map((st) => standingRow(st, me, s.crownId ?? '')).join('')}</ul>`;
          }
          set(center, `<div class="panel lobby">${s.hostId !== undefined ? roomBar(s, me) : ''}${match}<h1>Next level</h1><div class="cards">${cards.join('')}</div><ul class="list">${rows.join('')}</ul><div class="hint">${hint}</div></div>`);
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
            set(board, `${matchHead(s)}<ul class="list">${byPlace(s).map((p) => row(p, me, `${crownMark(s, p.id)}${p.eliminated ? '<span class="dim">out</span>' : `${hearts(p.lives, maxLives)} ${p.knockouts ? `KO ${p.knockouts}` : ''}`}${matchPoints(s, p.id)}`)).join('')}</ul>`);
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
          set(board, `${matchHead(s)}<ul class="list">${byKeys(s).map((p) => row(p, me, `${crownMark(s, p.id)}${p.keys}/${required}${matchPoints(s, p.id)}`)).join('')}</ul>`);
          set(status, spectating ? 'Spectating: you join next round'
            : `Keys <b>${keys}/${required}</b> · ${open ? '<span class="ok">Exit OPEN</span>' : '<span class="dim">Exit locked</span>'}`);
          break;
        }
        case 'matchEnd': {
          // The podium (phase 18): names float above the balls in 3D; after PODIUM_SEC, the stats card and rematch vote.
          const list = boardOf(s), place = matchPlaces(list), champs = list.filter((st) => place.get(st) === 1);
          set(top, `${GAME_NAME} · Match over${sound}`);
          set(board, '');
          set(status, '');
          if (s.tick < PODIUM_SEC * TICK_RATE) {
            // A tie after every tie-break (18b): they share the match.
            const title = champs.length > 1 ? `🏆 ${esc(names(champs.map((c) => c.name)))} share the match!` : `🏆 ${esc(champs[0]?.name ?? '')} wins the match!`;
            set(center, champs.length ? `<div class="podium-title" style="color:${esc(champs.length > 1 ? '#fff' : champs[0].color)}">${title}</div>` : '');
            break;
          }
          const stats = new Map<string, MatchStats>(list.map((st) => [st.id, st]));
          const badges = new Map<string, string[]>();
          for (const m of mvps(stats)) badges.set(m.id, [...(badges.get(m.id) ?? []), m.badge]);
          const here: PlayerS[] = [];
          s.players.forEach((p) => here.push(p));
          const yes = here.filter((p) => p.rematch).length, mineYes = !!mine?.rematch;
          const rowsHtml = list.map((st) => `<tr class="${st.id === me ? 'me' : ''}${st.left ? ' out' : ''}"><td>${ordinal(place.get(st)!)}</td><td>${dot(st.color)}${esc(st.name)}${st.left ? ' <span class="dim">(left)</span>' : ''}</td>`
            + `<td><b>${st.points}</b></td><td>${st.wins}</td><td>${st.knockouts}</td><td>${st.pushes}</td><td>${st.stomps}</td><td>${st.deaths}</td><td>${st.keys}</td>`
            + `<td>${(badges.get(st.id) ?? []).map((b) => `<span class="badge">${esc(b)}</span>`).join('')}</td></tr>`).join('');
          set(center, `<div class="panel stats"><h1>Match stats</h1><table class="statcard"><tr><th></th><th></th><th>Pts</th><th>Wins</th><th>KOs</th><th>Pushes</th><th>Stomps</th><th>Deaths</th><th>Keys</th><th></th></tr>${rowsHtml}</table>`
            + `<div class="rematch"><button class="card${mineYes ? ' mine' : ''}" data-rematch="yes">Rematch</button><button class="card" data-rematch="no">New lobby</button>`
            + `<span class="votes">${'●'.repeat(yes)} ${yes}/${here.length} for a rematch · ${secs}s</span></div></div>`);
          break;
        }
        case 'results': {
          const color = s.players.get(s.winnerId)?.color ?? '#fff';
          const banner = s.winnerId ? `<h1 style="color:${esc(color)}">${esc(name(s.winnerId))} wins!</h1>` : '<h1>Draw</h1>';
          set(top, `Results${sound}`);
          const rows = ko
            ? byPlace(s).map((p, i) => row(p, me, `${ordinal(i + 1)} · ${p.eliminated ? 'out' : hearts(p.lives, maxLives)} · KO ${p.knockouts}`))
            : byKeys(s).map((p) => row(p, me, `${p.keys} key${p.keys === 1 ? '' : 's'}`));
          const last = (s.matchRound ?? 0) >= (s.matchRounds ?? 0);
          const boardHtml = s.standings?.size ? `<h2>Round ${s.matchRound} of ${s.matchRounds}</h2><ul class="list board">${boardOf(s).map((st) => standingRow(st, me, s.crownId ?? '', true)).join('')}</ul>` : '';
          set(center, `<div class="panel">${banner}<ul class="list">${rows.join('')}</ul>${boardHtml}<div class="hint">${last ? `Match over: the podium in ${secs}s` : `Next: vote in lobby (${secs}s)`}</div></div>`);
          set(board, '');
          set(status, '');
          break;
        }
      }
    },
  };
}
