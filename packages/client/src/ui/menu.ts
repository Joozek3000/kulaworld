import { FRUITS, type LevelCard } from '@kula/shared';
import { GAME_NAME, GAME_VERSION } from '../config.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
export const FRUIT_ICONS = ['🍒', '🍏', '🍌', '🍈', '🍇'];
export const fruitSlots = (bits: number) => FRUITS.map((_, i) => `<span class="fruit${bits & (1 << i) ? '' : ' empty'}">${FRUIT_ICONS[i]}</span>`).join('');

/** A button: `act` goes to onAction with `arg`. The first `primary` one is what Enter presses. */
const btn = (label: string, act: string, o: { arg?: string | number; primary?: boolean; disabled?: boolean } = {}) =>
  `<button class="mbtn${o.primary ? ' primary' : ''}" data-act="${act}"${o.arg !== undefined ? ` data-arg="${o.arg}"` : ''}${o.disabled ? ' disabled' : ''}>${label}</button>`;

export type Screen =
  | { kind: 'main' }
  | { kind: 'single'; canContinue: string | null; highest: number; names: string[] }
  | { kind: 'levels'; highest: number; names: string[]; best: (number | null)[] }
  | { kind: 'multi'; name: string; error?: string }
  | { kind: 'settings'; volume: number; music: number; timing: string | null }
  | { kind: 'controls'; rows: { action: string; label: string; keys: string; pad: string }[]; waiting: string | null }
  | { kind: 'credits'; rows: { slot: string; track: string; artist: string; source: string; licence: string }[] }
  | { kind: 'reset' }
  | { kind: 'pause' }
  | { kind: 'card'; name: string; card: LevelCard; bonus: boolean; painted: boolean; par: number; best: number | null; score: number; finished: boolean }
  | { kind: 'gameOver'; checkpoint: number; name: string; score: number }
  | { kind: 'done'; score: number };

/**
 * Main menu, pause menu, results card and game over (phase 15b): a ceramic/lavender panel over the scene. One overlay;
 * `show` swaps the screen, `hide` clears it. Clicks and Enter (the primary button) go to `onAction`.
 */
export function createMenu(onAction: (act: string, arg: string | undefined, el: HTMLElement) => void) {
  const root = document.createElement('div');
  root.id = 'menu';
  root.hidden = true;
  document.body.appendChild(root);
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (b && !b.disabled) onAction(b.dataset.act!, b.dataset.arg, root);
  });
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.act) onAction(t.dataset.act, t.value, root);
  });
  addEventListener('keydown', (e) => {
    if (root.hidden || e.code !== 'Enter' || e.repeat || e.defaultPrevented) return;
    const b = root.querySelector<HTMLButtonElement>('button.primary:not([disabled])');
    if (b) { e.preventDefault(); b.click(); }
  });
  let current: Screen['kind'] | null = null;

  const html = (s: Screen): string => {
    switch (s.kind) {
      case 'main':
        return `<h1 class="logo">${GAME_NAME.toUpperCase()}</h1><div class="col">${btn('Single Player', 'single', { primary: true })}${btn('Multiplayer', 'multi')}${btn('Settings', 'settings')}${btn('Reset Progress', 'reset')}</div>`;
      case 'single':
        return `<h2>Single Player</h2><div class="col">${s.canContinue ? btn(`Continue <small>${esc(s.canContinue)}</small>`, 'continue', { primary: true }) : ''}`
          + `${btn('New Game', 'new', { primary: !s.canContinue })}${btn(`Level Select <small>${s.highest} reached</small>`, 'levels')}${btn('Back', 'main')}</div>`;
      case 'levels':
        return `<h2>Level Select</h2><div class="grid">${s.names.map((n, i) => btn(`<b>${i + 1}</b> ${esc(n)}${s.best[i] !== null ? `<small>best ${clock(s.best[i]!)}</small>` : ''}`, 'play', { arg: i + 1, disabled: i + 1 > s.highest, primary: i + 1 === s.highest })).join('')}</div>`
          + `<div class="col">${btn('Back', 'single')}</div>`;
      case 'multi':
        return `<h2>Multiplayer</h2><label class="field">Name <input id="menu-name" maxlength="16" value="${esc(s.name)}"></label>`
          + `${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}<div class="col">${btn('Join lobby', 'join', { primary: true })}${btn('Back', 'main')}</div>`;
      case 'settings':
        return `<h2>Settings</h2><label class="field">Volume <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-act="volume"></label>`
          + `<label class="field">Music <input type="range" min="0" max="1" step="0.05" value="${s.music}" data-act="music"></label>`
          + `<div class="col">${btn('Controls…', 'controls')}${btn('Sounds &amp; feel… <small>F4</small>', 'tuning')}${btn('Credits', 'credits')}`
          + `${s.timing ? btn(`Timing: ${esc(s.timing)} <small>dev · single player</small>`, 'timing') : ''}${btn('Back', 'main', { primary: true })}</div>`;
      case 'controls':
        return `<h2>Controls</h2><table class="binds"><tr><th></th><th>Keyboard</th><th>Pad</th></tr>${s.rows.map((r) => `<tr><td>${esc(r.label)}</td>`
          + `<td>${btn(s.waiting === `key:${r.action}` ? '<i>press a key…</i>' : esc(r.keys) || '—', 'bindKey', { arg: r.action })}</td>`
          + `<td>${btn(s.waiting === `pad:${r.action}` ? '<i>press a button…</i>' : esc(r.pad) || '—', 'bindPad', { arg: r.action })}</td></tr>`).join('')}</table>`
          + `<div class="sub">Esc cancels a rebind. The left stick always rolls and turns, the right stick always looks.</div>`
          + `<div class="row">${btn('Reset to defaults', 'bindReset')}${btn('Back', 'settings', { primary: true })}</div>`;
      case 'credits':
        return `<h2>Credits</h2>${s.rows.length ? `<table class="binds"><tr><th>Slot</th><th>Track</th><th>Artist</th><th>Licence</th></tr>${s.rows.map((r) =>
          `<tr><td>${esc(r.slot)}</td><td>${r.source ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.track)}</a>` : esc(r.track)}</td><td>${esc(r.artist)}</td><td>${esc(r.licence)}</td></tr>`).join('')}</table>`
          : '<p>No music yet.</p>'}<p class="sub">${GAME_NAME} v${GAME_VERSION} · made with Three.js and Colyseus</p><div class="col">${btn('Back', 'settings', { primary: true })}</div>`;
      case 'reset':
        return `<h2>Reset progress?</h2><p>Your campaign, level select and best times are deleted.</p><div class="row">${btn('Reset', 'resetYes')}${btn('Cancel', 'main', { primary: true })}</div>`;
      case 'pause':
        return `<h2>Paused</h2><div class="col">${btn('Resume', 'resume', { primary: true })}${btn('Restart Level <small>costs a death</small>', 'restart')}${btn('Quit to Menu', 'quit')}</div>`;
      case 'card': {
        const c = s.card;
        const head = s.bonus ? (s.painted ? 'All painted!' : 'Bonus over') : 'Level complete!';
        const rows = [
          ['Items', c.items],
          ...(s.bonus ? [] : [[`Time bonus <small>${c.timeLeftSec} s × 20</small>`, c.timeBonus]]),
          ...(s.painted ? [['Paint bonus', c.paintBonus], [`Time bonus <small>${c.timeLeftSec} s × 20</small>`, c.timeBonus]] : []),
        ] as [string, number][];
        const time = s.bonus ? '' : `<div class="sub">Time ${clock(c.timeSec)} · par ${clock(s.par)}${s.best !== null ? ` · best ${clock(s.best)}` : ''}</div>`;
        return `<h2>${head}</h2><div class="sub">${esc(s.name)}</div>${time}<table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}`
          + `<tr class="total"><td>Total</td><td>${c.total}</td></tr><tr><td>Score</td><td>${s.score}</td></tr></table>`
          + `<div class="col">${s.finished ? btn('Finish', 'finish', { primary: true }) : btn('Next level', 'next', { primary: true })}</div>`;
      }
      case 'gameOver':
        return `<h1 class="over">GAME OVER</h1><div class="sub">${GAME_NAME}</div><p>Back to the checkpoint: level ${s.checkpoint}, ${esc(s.name)} (score ${s.score})</p>`
          + `<div class="col">${btn('Restart from checkpoint', 'next', { primary: true })}${btn('Quit to Menu', 'quit')}</div>`;
      case 'done':
        return `<h1 class="logo">You did it!</h1><p>You finished the ${GAME_NAME} campaign. Final score <b>${s.score}</b></p><div class="col">${btn('Main menu', 'quit', { primary: true })}</div>`;
    }
  };

  return {
    get screen() { return current; },
    show(s: Screen) {
      current = s.kind;
      root.innerHTML = `<div class="mpanel ${s.kind}">${html(s)}</div><div class="version">${GAME_NAME} v${GAME_VERSION}</div>`;
      root.hidden = false;
      root.querySelector<HTMLInputElement>('#menu-name')?.focus();
    },
    hide() { current = null; root.hidden = true; root.innerHTML = ''; },
    /** Gamepad (phase 17): move the focus ring through the enabled buttons, wrapping. */
    focusStep(dir: -1 | 1) {
      const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[data-act]:not([disabled])')];
      if (!buttons.length) return;
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const start = i < 0 ? Math.max(0, buttons.findIndex((b) => b.classList.contains('primary'))) - (dir > 0 ? 1 : 0) : i;
      buttons[(start + dir + buttons.length) % buttons.length].focus();
    },
    /** Gamepad confirm: the focused button, else the primary one. */
    confirm() {
      const f = document.activeElement;
      const b = f instanceof HTMLButtonElement && root.contains(f) ? f : root.querySelector<HTMLButtonElement>('button.primary:not([disabled])');
      b?.click();
    },
    get name() { return root.querySelector<HTMLInputElement>('#menu-name')?.value.trim() ?? ''; },
  };
}
