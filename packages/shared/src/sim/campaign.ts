import { CHECKPOINT_EVERY, DEATH_PENALTY_BASE, DEATH_PENALTY_PER_LEVEL, PAINT_BONUS, TICK_RATE, TIME_BONUS_PER_SEC } from '../constants.ts';
import { FRUITS, type Level } from '../level/types.ts';
import type { World } from './world.ts';

/**
 * The single-player campaign (ARCHITECTURE §22, phase 15b): what's banked between levels. Pure functions over plain
 * data, so the client can save it as is. `level` is the campaign number of the level being played (a bonus level is
 * played *after* it, `bonus` its index). `score` is the score when the current level started.
 */
export interface Campaign {
  level: number;
  score: number;
  /** Fruit kinds collected (bits, 1 << FRUITS index); all 5 unlock the next bonus level, and are spent on it. */
  fruits: number;
  /** A bonus level is next / being played: its index in the bonus order, else -1. The next unplayed one: `bonusNext`. */
  bonus: number;
  bonusNext: number;
  /** Where game over sends you: a checkpoint level (every CHECKPOINT_EVERY) and the score it started with. */
  checkpoint: { level: number; score: number };
}

export const ALL_FRUITS = (1 << FRUITS.length) - 1;

export const newCampaign = (): Campaign => ({ level: 1, score: 0, fruits: 0, bonus: -1, bonusNext: 0, checkpoint: { level: 1, score: 0 } });

export const deathPenalty = (level: number): number => DEATH_PENALTY_BASE + DEATH_PENALTY_PER_LEVEL * level;
export const isCheckpoint = (level: number): boolean => level % CHECKPOINT_EVERY === 0;

/** The results card of a finished level: points from items and keys, the time bonus, the paint bonus, and the total. */
export interface LevelCard { items: number; timeBonus: number; paintBonus: number; total: number; timeLeftSec: number; timeSec: number }

export function levelCard(world: World): LevelCard {
  const s = world.single!, r = world.result?.reason;
  const won = r === 'exit' || r === 'painted';
  const timeLeftSec = Math.floor(s.timer / TICK_RATE);
  const timeBonus = won ? timeLeftSec * TIME_BONUS_PER_SEC : 0;
  const paintBonus = r === 'painted' ? PAINT_BONUS : 0;
  return { items: s.gained, timeBonus, paintBonus, total: s.gained + timeBonus + paintBonus, timeLeftSec, timeSec: Math.floor(world.tick / TICK_RATE) };
}

/**
 * A level ended without a death (the exit, or a bonus level painted, timed out or fallen off): bank its points,
 * collect its fruit (5 kinds: the next bonus level comes next, if there is one left), and move on. Reaching a
 * checkpoint level saves it. `bonusCount`: how many bonus levels the campaign has.
 */
export function levelDone(c: Campaign, world: World, bonusCount: number): Campaign {
  const score = c.score + levelCard(world).total;
  if (c.bonus >= 0) return advance({ ...c, score, bonus: -1 });
  const fruits = c.fruits | world.single!.fruits;
  if (fruits === ALL_FRUITS && c.bonusNext < bonusCount) return { ...c, score, fruits: 0, bonus: c.bonusNext, bonusNext: c.bonusNext + 1 };
  return advance({ ...c, score, fruits });
}

const advance = (c: Campaign): Campaign => {
  const level = c.level + 1;
  return { ...c, level, checkpoint: isCheckpoint(level) ? { level, score: c.score } : c.checkpoint };
};

/**
 * A death on a normal level: the level restarts with the score it started with, minus the penalty. If that would go
 * below 0 it's game over: back to the last checkpoint with its score. (A death on a bonus level just ends it: levelDone.)
 */
export function levelDied(c: Campaign): { campaign: Campaign; penalty: number; gameOver: boolean } {
  const penalty = deathPenalty(c.level), score = c.score - penalty;
  if (score >= 0) return { campaign: { ...c, score }, penalty, gameOver: false };
  return { campaign: { ...c, level: c.checkpoint.level, score: c.checkpoint.score, bonus: -1 }, penalty, gameOver: true };
}

/** The campaign's levels in order, and its bonus levels in order. */
export function campaignLevels(levels: readonly Level[]): { main: Level[]; bonus: Level[] } {
  const sp = levels.filter((l) => l.mode === 'single' && l.campaign > 0).sort((a, b) => a.campaign - b.campaign);
  return { main: sp.filter((l) => !l.bonus), bonus: sp.filter((l) => l.bonus) };
}
