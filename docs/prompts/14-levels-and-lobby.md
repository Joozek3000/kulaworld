# Phase 14: Level pack + lobby level vote

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§9 level format, §15 knockout, §18 tiles), `docs/DECISIONS.md`, `docs/reports/13a-report.md`, `docs/ART-SOUND.md`.

## Why
Jakub only saw 2 traps: the rotation (`LEVEL` in `.env`) had 3 levels, and only arena-01 had traps. race-02 and traps-lab weren't in it. The game needs more levels that actually use the traps, and players need to choose levels in-game instead of editing `.env`.

## Task 1: Lobby level vote
- **Server:**
  - The level pool is every level in `levels/` whose file has `"pool": true` (add the field), or the `LEVEL` list if set. `LEVEL` becomes an optional override for testing.
  - In the lobby, the room offers **3 candidates**: a random mix from the pool, not the last played level, at least one race and one knockout when the pool allows. It also offers a "Random" option.
  - Players vote with keys 1–4 (or by clicking). At countdown start the majority wins; ties are broken by the seeded RNG. No votes → random.
  - Sync the candidates and the per-candidate vote count in the schema.
  - Bots vote randomly.
- **Client lobby panel:**
  - 3 level cards, each with the name, mode (Race / Knockout), the trap icons used, and a **live mini-preview**: a small offscreen render of the level from a fixed 3/4 angle, cached per level.
  - Vote counts and your own vote are highlighted.
  - The existing ready flow is unchanged: vote, then R.
- **Results screen:** shows "Next: vote in lobby".
- **Tests:** candidate selection rules (no repeat, mode mix), tie-break determinism, votes cleared on the new lobby, a leaving player's vote removed.

## Task 2: Level pack (8 new levels + trap pass on the old ones)
Each level is Kula-style (floating structures, 1-thick where possible, underside/side play, convex routes; climbs are allowed now) in the ceramic/lavender look. Each gets its own `sky` pair and `"pool": true`.

**Race** (7 keys, keysRequired 3, 90–120 s, heat 3/5, sudden death at time − 30):
1. `race-03` "Pillar Garden": a floor of short pillars to climb over, fire tiles on pillar tops, retracting-spike alleys between them.
2. `race-04` "Sky Ladder": a tall vertical structure, with keys spread up the faces. Climbs + flips, crumble rungs, and one boost to the top.
3. `race-05` "Underside": most of the route is on the undersides of plates. Arrow tiles force one-way loops, and a few invisible routes are left for 13b.
4. `race-06` "Boost Relay": islands linked by boost pads, an ice runway, and spike-guarded keys.

**Knockout** (lives 3, crumble on):
5. `arena-03` "Ice Rink": a 9×9 ice plate with a non-ice rim, and a static spike ring on the rim's outer side faces. Pushes slide far.
6. `arena-04` "Crumble Tower": 3 stacked plates linked by columns, with crumble tiles on the middle plate and a boost from bottom to top.
7. `arena-05` "Fire Ring": a donut plate with a fire ring and a safe centre, plus boosts across the hole.
8. `arena-06` "Pillar Field": a 9×9 floor with 2-high pillars (climb and hide), and retracting spikes on some pillar tops.

**Trap pass on existing levels:**
- race-01: a crumble bridge on one connecting beam, and one boost shortcut
- arena-02: spikes on the pad arm's outer faces, and ice on the ladder rails
- Keep test-* and arena-cube out of the pool (`pool: false`), and traps-lab too.

**Per level:**
- validate
- the reachability tests (race: every key + exit from every spawn; knockout: spawn↔spawn + ≥ 90 % of surfaces)
- the level lint (no corridor without a way round)
- a 4-bot soak of 3 rounds with no STUCK
- one overview screenshot for the report

## Task 3: Trap usage check
Add `npm run level:stats`. It prints per pool level: mode, blocks, trap counts by type, keys, and spawns. The report includes the table so we can see every trap type appears in ≥ 2 pool levels.

## Acceptance checklist
- [ ] All tests pass. Typecheck and build are clean.
- [ ] Browser: the lobby shows 3 cards with previews, voting works with keys and clicks, and the winning level loads
- [ ] Soak: 16 rounds with `seek,bully,blocker,wander`, with the pool (no LEVEL override) and bots voting. No errors or STUCK; list the levels played and deaths by cause.
- [ ] Every trap type from 13a appears in ≥ 2 pool levels

## Report: `docs/reports/14-report.md`
- A level gallery (a screenshot per level)
- The `level:stats` table
- Soak results
- Open questions

Then commit: `phase 14: level pack + lobby vote`.
