# Phase 13a: Tiles & traps, part 1 (+ edge-glow readability)

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` §18 (new: this phase's spec), §5, §14, §15, §17, `docs/DECISIONS.md`, `docs/reports/12c-report.md`, `docs/ART-SOUND.md` (current art direction: ceramic kit + lavender sky).

**Before starting:** the working tree has an uncommitted audio pass by another agent (`assets/audio/temporary-bounce/*`, `docs/ART-SOUND.md`, `packages/client/public/sfx/README.md`). If tests and build pass with it, commit it first as `audio: temporary bounce v01`. Otherwise leave it and say so.

## Task 0: Edge-glow readability (12c open questions)
Decisions:
- **Edge pushes stay lethal.** Jakub will judge in human play.
- **Make the warning clearer:**
  - thicken the glow line to 0.12
  - add a soft pulse
  - tint the enemy's tile outline (a thin ring on the tile in their colour)
  - play a quiet creak/tick cue once when an enemy first appears around your edge (a new synth sound `edge`, sample-overridable)
- The blocker stays as it is.

## Task 1: Level format + sim (§18 "13a rules")
- Add a `tiles` array, validated: known types, block exists, face dir valid, arrow dir ⟂ face, spike timing sane, no two types on the same face (whole-block types conflict with face types on that block, except arrow/boost/spikes on a crumble block, which are allowed).
- **Spikes** (static and retracting), **fire** (count of 3), **crumble** (delay, regrow), **ice** (forced slides, jump-without-W), **arrow** (fwd restriction), **boost** (far/high).
- **Death causes** on `death` events.
- **`findPath`/`resultPose`:** follow ice slides and boosts, and reject lethal results. Retracting spikes count as always lethal for planning.
- **Predictor:** runs these rules. Crumble state syncs like `removed`, and a test shows 0 mispredictions sliding across ice solo.

## Task 2: Tests (shared)
One tiny world per rule:
- **Spikes:**
  - roll onto static spikes → death
  - jump over → alive
  - retracting spikes: rolling on while down is safe; standing when they rise → death; exact tick boundaries
- **Fire:** 1 or 2 fire landings then a normal tile → reset; 3 in a row → pop
- **Crumble:** it vanishes 4 ticks after you leave; you're still standing on it until you leave; regrow after regrowSec only if the cell is empty; a ball on it at removal falls
- **Ice:**
  - a roll onto ice slides until off the ice
  - a slide into a wall → climb
  - a slide off an edge → flip (it's a roll)
  - a slide into a player → push
  - input during a slide is ignored except air turns (n/a)
  - jump on ice without W → forward jump
- **Arrow:** a wrong fwd is blocked; the right one works; turning and hopping allowed
- **Boost:** far lands 3 ahead; high lands 2 ahead + 1 up; a boost into a player stomps (§16 rules); a boost into void falls
- **Determinism** with all tile types (4 players, 2000 ticks)
- **BFS:** a path across ice to a key; a path avoiding spikes; a path using a boost
- The race/knockout suites pass

## Task 3: Server/schema
- Tile definitions come from the level file, which the client already loads, so they aren't synced.
- Dynamic state is synced: crumbled/regrown blocks (reuse `removed`) and per-player `fireCount`.
- Spike phase is derived from the tick, so there's nothing to sync.

## Task 4: Client (ceramic style, procedural first)
Keep models simple and in the ceramic/lavender look. Put any GLB placeholders in `packages/client/public/models/traps-v01/` only if they're trivially generated; procedural geometry is fine.
- **Spikes:** a cluster of 4 short ceramic cones. They animate up and down on schedule, with a shadow hint when down.
- **Fire:** an emissive red crisscross decal on the block faces, and a flicker. The ball inflates slightly per fire count (visual only), and pops at 3.
- **Crumble:** a cracked glaze decal. It shakes for the 4 ticks before vanishing, then fragments fall. It fades back in on regrow.
- **Ice:** a glossy pale-blue glaze. Sliding balls get a streak and a "ssss" slide sound.
- **Arrow:** an embossed arrow decal.
- **Boost:** a round pad with chevrons that glows before the launch, plus a "pwomp" launch sound.
- **Death toasts** by cause ("A popped on fire", "B got spiked").

## Task 5: Levels
- **`traps-lab.json`** (race mode, not in the rotation): one lane per trap type with a key at the end of each, so Jakub can try each in isolation.
- **`race-02.json` "Ice Garden"**: a real race level built around ice slides, one boost shortcut, retracting-spike lanes, a crumble bridge and an arrow-forced route. 7 keys, keysRequired 3, sky of your choice from the art direction.
- Add a few spikes and one boost pad to **arena-01**, sparingly.

## Task 6: Bots
- They avoid lethal tiles via BFS.
- The bully likes pushing victims toward spikes or fire (a score bonus when a victim is adjacent to a lethal tile along the push direction).
- The blocker avoids sitting on crumble or fire.

## Acceptance checklist
- [ ] Audio pass committed (or reported). All tests pass. Typecheck and build are clean.
- [ ] Browser on traps-lab: every lane behaves as specified, and every death shows its cause toast
- [ ] Soak: 12 rounds `race-02,arena-01,race-01` with `seek,bully,blocker,wander`. No errors or STUCK. Report deaths by cause and bot deaths on traps.
- [ ] Prediction: solo on race-02 at LATENCY_MS 150, 0 mispredictions over 60 s including ice slides and boosts

## Report: `docs/reports/13a-report.md`
- Screenshots of each trap type
- A race-02 overview
- Deaths by cause
- Open questions for 13b (teleporters, lasers/switches, invisible/vanishing)

Then commit: `phase 13a: traps part 1`.
