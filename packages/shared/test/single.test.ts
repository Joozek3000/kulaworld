import { describe, expect, test } from 'vitest';
import {
  ALL_FRUITS, CLOCK_FREEZE_TICKS, createWorld, deathPenalty, FRUITS, isCheckpoint, JUMP_TICKS, levelCard, levelDied, levelDone, loadLevel,
  newCampaign, PAINT_BONUS, ROLL_TICKS, SCORE_COIN, SCORE_FRUIT, SCORE_GEM, SCORE_KEY, setInput, step, TICK_RATE, TIME_BONUS_PER_SEC, validateLevel, vec,
  addPlayer, type Campaign, type ItemJson, type LevelJson, type SimEvent, type TileJson, type World,
} from '../src/index.ts';
import { input, levelJson, player, row, run, serialize } from './util.ts';

// Single player (ARCHITECTURE §22, phase 15b).
type V3 = [number, number, number];
const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
const coin = (cell: V3, up: ItemJson['up'] = '+Y'): ItemJson => ({ cell, up, type: 'coin' });

/** A one-player campaign level: spawn at x0 facing +X, exit far away unless given. */
function sp(blocks: V3[], extra: Partial<LevelJson> = {}, x0 = 0): LevelJson {
  return levelJson(blocks, [[[x0, 1, 0], '+Y', '+X']], {
    mode: 'single', campaign: 1, parSec: 30, timeLimitSec: 60, heat: false,
    exit: { cell: [99, 99, 99], up: '+Y' }, ...extra,
  });
}
function world(json: LevelJson, seed = 1): World {
  const w = createWorld(loadLevel(json), seed);
  addPlayer(w, 'p0', 'p0');
  return w;
}
function press(w: World, i: Parameters<typeof input>[0]): SimEvent[] {
  setInput(w, 'p0', input(i));
  const e = step(w);
  setInput(w, 'p0', input({}));
  return e;
}
const W = { fwdHeld: true }, JUMP = { fwdHeld: true, jump: true };
const items = (events: SimEvent[]) => of(events, 'item').map((e) => [e.item, e.points]);

describe('rules in single player', () => {
  test('no push rules, heat off, no sudden death; a campaign level validates with one spawn', () => {
    const json = sp(row(0, 6), { exit: { cell: [6, 1, 0], up: '+Y' }, crumble: { startSec: 1, intervalSec: 2, warnSec: 1 }, heat: { warnSec: 1, burnSec: 2 } });
    const w = world(json);
    expect([w.rules.push, w.heat, w.knockout]).toEqual([false, null, null]);
    expect(validateLevel(w.level)).toEqual([]);
    expect(validateLevel(loadLevel({ ...json, keys: [{ cell: [3, 1, 0], up: '+Y' }], keysRequired: 0 }))).toEqual([expect.stringMatching(/every key/)]);
  });

  test("crumble never regrows; a pill spot doesn't come back", () => {
    const w = world(sp(row(0, 8), { tiles: [{ block: [1, 0, 0], type: 'crumble', regrowSec: 1 }], pickups: [{ cell: [3, 1, 0], up: '+Y', type: 'bouncy', respawnSec: 1 }] }));
    setInput(w, 'p0', input(W));
    run(w, 4 * ROLL_TICKS);
    setInput(w, 'p0', input({}));
    run(w, 200);
    expect([w.removed.has('1,0,0'), w.pickups]).toEqual([true, []]);
  });
});

describe('items', () => {
  test('collected by every finish kind: roll, flip, climb, jump landing, fall landing, hop, ice slide, teleport arrival', () => {
    const roll = world(sp(row(0, 6), { items: [coin([1, 1, 0])] }));
    expect(items([...press(roll, W), ...run(roll, ROLL_TICKS)])).toEqual([['coin', SCORE_COIN]]);
    const flip = world(sp(row(0, 6), { items: [{ cell: [7, 0, 0], up: '+X', type: 'gem' }] }, 6));
    expect(items([...press(flip, W), ...run(flip, 10)])).toEqual([['gem', SCORE_GEM]]);
    // A climb: the ball stays in its cell and turns up the wall; the item on the wall face in that cell is taken.
    const climb = world(sp([...row(0, 6), [2, 1, 0]], { items: [coin([1, 1, 0], '-X')] }, 1));
    expect(items([...press(climb, W), ...run(climb, 6)])).toEqual([['coin', SCORE_COIN]]);
    // A jump flies over (1,1,0) and lands on (2,1,0): only the landing counts.
    const jump = world(sp(row(0, 6), { items: [coin([1, 1, 0]), { cell: [2, 1, 0], up: '+Y', type: 'fruit', fruit: 'apple' }] }));
    expect(items([...press(jump, JUMP), ...run(jump, JUMP_TICKS)])).toEqual([['fruit', SCORE_FRUIT]]);
    expect(jump.single!.fruits).toBe(1 << FRUITS.indexOf('apple'));
    const fall = world(sp([...row(0, 2), [4, -2, 0]], { items: [coin([4, 0, 0]), coin([4, -1, 0])] }, 2));
    const fell = [...press(fall, JUMP), ...run(fall, 20)];
    expect([items(fell), fall.single!.taken]).toEqual([[['coin', SCORE_COIN]], [false, true]]);
    // A hop in place: it lands in the cell again.
    const hop = world(sp(row(0, 6), { items: [coin([0, 1, 0])] }));
    expect(items([...press(hop, { jump: true }), ...run(hop, JUMP_TICKS)])).toEqual([['coin', SCORE_COIN]]);
    const ice = world(sp(row(0, 6), { items: [coin([3, 1, 0])], tiles: [1, 2].map((x): TileJson => ({ block: [x, 0, 0], type: 'ice' })) }));
    expect(items([...press(ice, W), ...run(ice, 3 * ROLL_TICKS)])).toEqual([['coin', SCORE_COIN]]);
    const tiles: TileJson[] = [{ block: [3, 0, 0], face: '+Y', type: 'teleport', pair: 'A' }, { block: [12, 0, 5], face: '+Y', type: 'teleport', pair: 'A' }];
    const warp = world(sp([...row(0, 6), ...row(10, 14, 0, 5)], { items: [coin([12, 1, 5])], tiles }, 2));
    expect(items([...press(warp, W), ...run(warp, 12)])).toEqual([['coin', SCORE_COIN]]);
  });

  test('each item once; keys score too', () => {
    const w = world(sp(row(0, 6), { items: [coin([1, 1, 0])], keys: [{ cell: [2, 1, 0], up: '+Y' }], keysRequired: 1 }));
    setInput(w, 'p0', input(W));
    run(w, 2 * ROLL_TICKS + 1);
    setInput(w, 'p0', input({}));
    run(w, 10);
    expect(w.single!.gained).toBe(SCORE_COIN + SCORE_KEY);
  });
});

describe('timer', () => {
  test('counts down one per tick; at 0 the ball dies (cause time) and the attempt ends', () => {
    const w = world(sp(row(0, 6), { timeLimitSec: 2 }));
    run(w, 39);
    expect(w.single!.timer).toBe(1);
    const events = run(w, 1);
    expect(of(events, 'death').map((e) => e.cause)).toEqual(['time']);
    expect(w.result).toEqual({ winnerId: null, reason: 'death' });
    run(w, 10);
    expect(w.single!.timer).toBe(0);
  });

  test('the hourglass flips it: remaining becomes total − remaining', () => {
    const w = world(sp(row(0, 6), { timeLimitSec: 60, items: [{ cell: [1, 1, 0], up: '+Y', type: 'hourglass' }] }));
    run(w, 99);
    const events = [...press(w, W), ...run(w, ROLL_TICKS)];
    // Taken at tick 105, before that tick's countdown: 1200 − 104 = 1096 left, 104 after the flip, 103 after the tick.
    expect(of(events, 'timer')).toEqual([{ type: 'timer', playerId: 'p0', kind: 'flip', ticks: 104 }]);
    expect(w.single!.timer).toBe(103);
  });

  test('a clock tile freezes it for 5 s, once', () => {
    const w = world(sp(row(0, 6), { tiles: [{ block: [1, 0, 0], face: '+Y', type: 'clock' }] }));
    const events = [...press(w, W), ...run(w, ROLL_TICKS)]; // lands at tick 6
    expect(of(events, 'timer')).toEqual([{ type: 'timer', playerId: 'p0', kind: 'freeze', ticks: CLOCK_FREEZE_TICKS }]);
    const t = w.single!.timer;
    run(w, CLOCK_FREEZE_TICKS - 1);
    expect(w.single!.timer).toBe(t);
    run(w, 10);
    expect(w.single!.timer).toBe(t - 10);
    // Back onto it: already used.
    press(w, { turn: 1 }); run(w, 3); press(w, { turn: 1 }); run(w, 3);
    const again = [...press(w, W), ...run(w, ROLL_TICKS)];
    expect([player(w).pose.cell, of(again, 'timer')]).toEqual([vec(0, 1, 0), []]);
    press(w, { turn: 1 }); run(w, 3); press(w, { turn: 1 }); run(w, 3);
    expect(of([...press(w, W), ...run(w, ROLL_TICKS)], 'timer')).toEqual([]);
  });
});

describe('bonus levels', () => {
  const paint = (x: number): TileJson => ({ block: [x, 0, 0], face: '+Y', type: 'paint' });
  const bonus = (extra: Partial<LevelJson> = {}) => sp(row(0, 6), { bonus: true, exit: undefined, tiles: [1, 2, 3].map(paint), ...extra });

  test('rolling over every paint tile lights it; all lit finishes the level with the paint bonus', () => {
    const w = world(bonus());
    expect(validateLevel(w.level)).toEqual([]);
    setInput(w, 'p0', input(W));
    const events = run(w, 3 * ROLL_TICKS + 1);
    expect(of(events, 'paint').map((e) => `${e.lit}/${e.total}`)).toEqual(['1/3', '2/3', '3/3']);
    expect(w.result).toEqual({ winnerId: 'p0', reason: 'painted' });
    const card = levelCard(w);
    expect(card).toMatchObject({ paintBonus: PAINT_BONUS, timeBonus: card.timeLeftSec * TIME_BONUS_PER_SEC });
  });

  test('time just ends it (no death)', () => {
    const w = world(bonus({ timeLimitSec: 1 }));
    const events = [...press(w, W), ...run(w, 25)];
    expect(of(events, 'death')).toEqual([]);
    expect(w.result).toEqual({ winnerId: null, reason: 'timeout' });
    expect(w.single!.lit.size).toBe(1);
    expect(levelCard(w)).toMatchObject({ paintBonus: 0, timeBonus: 0 });
  });
});

describe('campaign', () => {
  /** A finished world: `gained` points, `timer` ticks left, fruit bits, result. */
  const done = (gained: number, timer: number, fruits = 0, reason: 'exit' | 'painted' | 'timeout' = 'exit'): World => {
    const w = world(sp(row(0, 2)));
    Object.assign(w.single!, { gained, timer, fruits });
    w.result = { winnerId: 'p0', reason };
    w.tick = 400;
    return w;
  };

  test('score maths: items + time bonus (whole seconds × 20) banked at the exit', () => {
    expect(levelCard(done(3500, 30 * TICK_RATE + 19))).toEqual({ items: 3500, timeBonus: 600, paintBonus: 0, total: 4100, timeLeftSec: 30, timeSec: 20 });
    const c = levelDone(newCampaign(), done(3500, 30 * TICK_RATE + 19), 1);
    expect([c.level, c.score]).toEqual([2, 4100]);
  });

  test('death penalty −(500 + 50 × level): the level restarts from the score it started with', () => {
    expect([deathPenalty(1), deathPenalty(10)]).toEqual([550, 1000]);
    const c: Campaign = { ...newCampaign(), level: 3, score: 5000 };
    expect(levelDied(c)).toEqual({ campaign: { ...c, score: 4350 }, penalty: 650, gameOver: false });
  });

  test('game over when the score would go below 0: back to the last checkpoint with its score', () => {
    const c: Campaign = { ...newCampaign(), level: 7, score: 800, checkpoint: { level: 5, score: 12000 } };
    const r = levelDied(c);
    expect([r.gameOver, r.campaign.level, r.campaign.score]).toEqual([true, 5, 12000]);
    expect(levelDied({ ...c, score: 850 }).gameOver).toBe(false); // exactly 0 is fine
    // Before the first checkpoint (levels 1–4) the score is clamped at 0: no game over.
    expect(levelDied(newCampaign())).toEqual({ campaign: newCampaign(), penalty: 550, gameOver: false });
    expect(levelDied({ ...newCampaign(), level: 4, score: 300 })).toMatchObject({ campaign: { level: 4, score: 0 }, gameOver: false });
    expect(levelDied({ ...newCampaign(), level: 5, score: 300, checkpoint: { level: 5, score: 300 } }).gameOver).toBe(true);
  });

  test('a checkpoint every 5 levels: reaching it saves the level and its starting score', () => {
    expect([1, 4, 5, 9, 10].map(isCheckpoint)).toEqual([false, false, true, false, true]);
    let c: Campaign = newCampaign();
    for (let i = 0; i < 5; i++) c = levelDone(c, done(1000, 0), 1);
    expect([c.level, c.checkpoint]).toEqual([6, { level: 5, score: 4000 }]);
    for (let i = 0; i < 5; i++) c = levelDone(c, done(1000, 0), 1);
    expect(c.checkpoint).toEqual({ level: 10, score: 9000 });
  });

  test('5 fruit kinds unlock the next bonus level after the current one; then the campaign carries on', () => {
    let c: Campaign = newCampaign();
    for (let f = 0; f < 4; f++) c = levelDone(c, done(0, 0, 1 << f), 1);
    expect([c.level, c.fruits, c.bonus]).toEqual([5, 0b1111, -1]);
    c = levelDone(c, done(0, 0, 1 << 4), 1); // the 5th kind, on level 5
    expect([c.level, c.fruits, c.bonus, c.bonusNext]).toEqual([5, 0, 0, 1]);
    c = levelDone(c, done(2000, 20, 0, 'painted'), 1);
    expect([c.level, c.bonus, c.score]).toEqual([6, -1, 2000 + 20 + PAINT_BONUS]); // 1 s left: +20
    // No bonus level left: 5 more kinds are kept, nothing unlocks.
    c = levelDone(c, done(0, 0, ALL_FRUITS), 1);
    expect([c.level, c.bonus, c.fruits]).toEqual([7, -1, ALL_FRUITS]);
    // A fruit taken on an attempt that died doesn't count: only a finished level banks it.
    expect(levelDied({ ...newCampaign(), score: 5000 }).campaign.fruits).toBe(0);
  });
});

test('determinism: a scripted run gives identical worlds', () => {
  const json = sp(row(0, 10), {
    items: [coin([2, 1, 0]), { cell: [4, 1, 0], up: '+Y', type: 'hourglass' }, { cell: [11, 0, 0], up: '+X', type: 'gem' }],
    tiles: [{ block: [6, 0, 0], face: '+Y', type: 'clock' }, { block: [8, 0, 0], type: 'ice' }],
    keys: [{ cell: [5, 1, 0], up: '+Y' }], keysRequired: 1, exit: { cell: [9, -1, 0], up: '-Y' },
  });
  const script = (w: World) => {
    const out: SimEvent[] = [];
    for (let t = 0; t < 300; t++) {
      setInput(w, 'p0', input({ fwdHeld: t % 40 < 30, jump: t % 57 === 0, turn: t === 150 ? 1 : 0 }));
      out.push(...step(w));
    }
    return out;
  };
  const a = world(json), b = world(json);
  const ea = script(a), eb = script(b);
  expect(serialize(b)).toBe(serialize(a));
  expect(eb).toEqual(ea);
  expect(of(ea, 'item').length).toBeGreaterThanOrEqual(2);
});
