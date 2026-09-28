import { FRUITS, type LevelCard } from '@kula/shared';

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
  | { kind: 'settings'; volume: number }
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
    if (root.hidden || e.code !== 'Enter' || e.repeat) return;
    const b = root.querySelector<HTMLButtonElement>('button.primary:not([disabled])');
    if (b) { e.preventDefault(); b.click(); }
  });
  let current: Screen['kind'] | null = null;

  const html = (s: Screen): string => {
    switch (s.kind) {
      case 'main':
        return `<h1 class="logo">KULAWORLD</h1><div class="col">${btn('Single Player', 'single', { primary: true })}${btn('Multiplayer', 'multi')}${btn('Settings', 'settings')}${btn('Reset Progress', 'reset')}</div>`;
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
          + `<div class="col">${btn('Sounds &amp; feel… <small>F4</small>', 'tuning')}${btn('Back', 'main', { primary: true })}</div>`;
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
        return `<h1 class="over">GAME OVER</h1><p>Back to the checkpoint: level ${s.checkpoint}, ${esc(s.name)} (score ${s.score})</p>`
          + `<div class="col">${btn('Restart from checkpoint', 'next', { primary: true })}${btn('Quit to Menu', 'quit')}</div>`;
      case 'done':
        return `<h1 class="logo">You did it!</h1><p>The campaign is complete. Final score <b>${s.score}</b></p><div class="col">${btn('Main menu', 'quit', { primary: true })}</div>`;
    }
  };

  return {
    get screen() { return current; },
    show(s: Screen) {
      current = s.kind;
      root.innerHTML = `<div class="mpanel ${s.kind}">${html(s)}</div>`;
      root.hidden = false;
      root.querySelector<HTMLInputElement>('#menu-name')?.focus();
    },
    hide() { current = null; root.hidden = true; root.innerHTML = ''; },
    get name() { return root.querySelector<HTMLInputElement>('#menu-name')?.value.trim() ?? ''; },
  };
}
