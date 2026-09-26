# Phase 12b: Cradle push + heat tuning + blocker bot

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` §14 (the new **Cradle push** replaces the phase 12 chain push), `docs/DECISIONS.md`, `docs/reports/12-report.md`.

## Why
Jakub's decision: a chain push shouldn't move the whole line. Like the kinetic toy (Newton's cradle), the striker stops, the middle balls stay put, and only the **last** ball flies.

## Task 1: Cradle push (per ARCHITECTURE §14)
- **Sim:**
  - Replace the whole-line knock with the cradle rule.
  - Add `Action.Strike` (appended) and `STRIKE_TICKS = 4`.
  - `CHAIN_MAX` changes from 4 to 6.
  - Middle balls are unaffected in the sim.
  - Add a `cradle` event (the last ball also gets the normal knock/fall/death/knockout events).
- **Tests** (replace `chain.test.ts`):
  - lines of 2, 3 and 6: only the last moves; P and the middle balls stay; P is in Strike for STRIKE_TICKS, then Idle
  - the last ball falls off an edge → death + knockout credit to P
  - the last ball is blocked by a wall or reserved cell → P bounces
  - the last ball isn't pushable (high hop, stagger) → P bounces
  - a middle ball is moving → P is blocked, no stun
  - a middle ball is staggered or bounce-stunned → still transmits
  - a line of 7 → P bounces
  - a single victim → the normal push (unchanged tests pass)
  - the last ball escapes on the same tick → P bounces
  - determinism
  - with `rules.chain: false` → the phase 11 behaviour
- **Client:**
  - Strike pose: a lunge of 0.2 cells and recoil, reusing the bounce lunge shape but without the stun ring.
  - The middle balls shudder, a quick squash along F travelling down the line, 1 frame apart per ball, so you *see* the impulse pass through.
  - A new `clack` sound per ball in sequence (hard rubber click, rising pitch), then the normal `hit` on the last ball.
- **Prediction:** a cradle involves players, so it's deferred to the server (already the rule for pushes). Check with a test.

## Task 2: Tuning from the 12 report (decisions)
- **Race heat:** race levels warn at 3 s and burn at 5 s. Knockout stays at 2.5 s / 4 s. Put these in the level JSON: race-01 `"heat": {"warnSec": 3, "burnSec": 5}`.
- **Hopping and heat:** hopping in place counts at **half rate** (every 2nd tick). Update the heat tests.
- **Bully `AVOID_MS`:** 1.5 s when its target is within 2 cells, 3 s otherwise.
- **race-01 sudden death:** starts at 75 s (was 90).
- **Beams:** keep race-01's beams 1-wide (the Kula feel). The cradle + heat + ways round handle blocking.

## Task 3: Blocker bot
- A new behaviour `blocker`: it finds the nearest 1-wide corridor cell on the route between the others and the keys/exit (or the arena centre), sits in it facing the likely approach, and only moves to avoid a burn (it steps out and back) or when pushed.
- It uses defensive hops like the others.
- Purpose: reproduce human corridor blocking in soaks.

## Acceptance checklist
- [ ] Tests pass. Typecheck is clean.
- [ ] Browser (test-stomp, heat off copy as before): with 3 balls in a line at the beam end, pushing the first makes only the last one fly off, the middle two stay, and the impulse visibly travels down the line
- [ ] Soak: 12 rounds `race-01,arena-01,arena-02` with `seek,bully,blocker,wander`. Report stalemate seconds with the phase 11 rules vs now, plus cradles, burns and knockouts per round.

## Report: `docs/reports/12b-report.md`
Then commit: `phase 12b: cradle push + tuning + blocker bot`.
