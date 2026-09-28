import {
  campaignLevels, levelCard, levelDied, levelDone, newCampaign, type Campaign, type Level, type LevelCard, type TimingName,
} from '@kula/shared';
import { LocalGame } from './local.ts';

/** Saved progress (§22): localStorage, try/catch everywhere; without storage the game still plays, it just forgets. */
export interface Save {
  /** The campaign in progress (Continue), or null. It carries the checkpoint, its score and the fruits. */
  campaign: Campaign | null;
  /** The highest campaign level reached (Level Select offers 1..highest). */
  highest: number;
  /** Best completion time per level id, in seconds. */
  best: Record<string, number>;
}
const KEY = 'kula.save';

export function loadSave(): Save {
  const empty: Save = { campaign: null, highest: 1, best: {} };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Save> | null;
    if (!s || typeof s !== 'object') return empty;
    return {
      campaign: s.campaign && typeof s.campaign.level === 'number' ? s.campaign : null,
      highest: typeof s.highest === 'number' && s.highest >= 1 ? s.highest : 1,
      best: s.best && typeof s.best === 'object' ? s.best : {},
    };
  } catch { return empty; }
}
export function writeSave(s: Save): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
export function resetSave(): Save {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  return loadSave();
}

/** What the single-player flow asks the UI to show once an attempt is over. */
export type Outcome =
  | { kind: 'card'; level: Level; card: LevelCard; bonus: boolean; best: number | null; score: number; finished: boolean }
  | { kind: 'death'; penalty: number; score: number }
  | { kind: 'gameOver'; penalty: number; checkpoint: number; score: number };

/** A result shows this long (the pop, the exit) before the card or the restart. */
const OUTCOME_DELAY_TICKS = 25;

/**
 * The campaign flow (phase 15b): plays the campaign's current level in a LocalGame, and when the attempt ends banks it
 * (levelDone / levelDied from shared), saves, and reports an Outcome. `next()` then starts whatever the campaign says
 * comes next: the same level again after a death, the checkpoint after a game over, the next or a bonus level.
 */
export class SinglePlayer {
  readonly game: LocalGame;
  private reported = false;
  /** The tick the attempt's result came in, or -1. */
  private resultAt = -1;

  /** The level on screen and its HUD label; they stay put while its card shows (the campaign has moved on by then). */
  level: Level;
  label = '';

  constructor(
    public campaign: Campaign, private readonly levels: readonly Level[], public save: Save, private readonly onOutcome: (o: Outcome) => void,
    timing: TimingName = 'classic',
  ) {
    this.level = this.current();
    this.game = new LocalGame(this.level, 'You', timing);
    this.relabel();
    this.persist();
  }

  private relabel(): void {
    this.level = this.current();
    this.label = this.campaign.bonus >= 0 ? `Bonus · ${this.level.name}` : `${this.campaign.level}. ${this.level.name}`;
  }

  /** The level being played: the bonus level if one is up, else the campaign level. */
  current(): Level {
    const { main, bonus } = campaignLevels(this.levels);
    return this.campaign.bonus >= 0 ? bonus[this.campaign.bonus] : main[Math.min(this.campaign.level, main.length) - 1];
  }
  get levelCount(): number { return campaignLevels(this.levels).main.length; }
  /** The score shown in the HUD: banked plus this attempt's points (already banked once the attempt is settled). */
  get score(): number { return this.campaign.score + (this.reported ? 0 : this.game.state.single.gained); }
  get finished(): boolean { return this.campaign.level > this.levelCount; }

  update(now: number, dtMs: number): void {
    this.game.update(now, dtMs);
    const r = this.game.result;
    if (!r || this.reported || this.game.paused) return;
    if (this.resultAt < 0) this.resultAt = this.game.world.tick;
    if (this.game.world.tick - this.resultAt < OUTCOME_DELAY_TICKS) return;
    this.reported = true;
    this.onOutcome(this.settle());
  }

  /** Banks the finished attempt into the campaign and saves. */
  private settle(): Outcome {
    const w = this.game.world, level = this.level, bonus = this.campaign.bonus >= 0;
    if (w.result!.reason === 'death' && !bonus) return this.died();
    const card = levelCard(w);
    let best: number | null = null;
    if (w.result!.reason === 'exit') {
      const t = card.timeSec, was = this.save.best[level.id];
      best = was === undefined ? t : Math.min(was, t);
      this.save.best[level.id] = best;
    }
    this.campaign = levelDone(this.campaign, w, campaignLevels(this.levels).bonus.length);
    this.persist();
    return { kind: 'card', level, card, bonus, best, score: this.campaign.score, finished: this.finished };
  }

  /** Starts what the campaign says is next (after a card, a death or a game over). A restart after a death skips the fly-over. */
  next(flyover = true): void {
    if (this.finished) return;
    this.reported = false;
    this.resultAt = -1;
    this.game.paused = false;
    this.relabel();
    this.game.start(this.level, flyover);
  }

  /** Pause menu: restarting costs a life-penalty, as a death (§22). */
  restart(): Outcome {
    this.reported = true;
    return this.died();
  }

  private died(): Outcome {
    const r = levelDied(this.campaign);
    this.campaign = r.campaign;
    this.persist();
    return r.gameOver ? { kind: 'gameOver', penalty: r.penalty, checkpoint: r.campaign.level, score: r.campaign.score } : { kind: 'death', penalty: r.penalty, score: r.campaign.score };
  }

  private persist(): void {
    this.save.campaign = this.finished ? null : this.campaign;
    this.save.highest = Math.max(this.save.highest, Math.min(this.campaign.level, this.levelCount));
    writeSave(this.save);
  }
}

/** A fresh campaign starting at `level` (Level Select): its own checkpoint there, score 0, the saved fruits kept. */
export const campaignFrom = (level: number, fruits = 0): Campaign => ({ ...newCampaign(), level, fruits, checkpoint: { level, score: 0 } });
