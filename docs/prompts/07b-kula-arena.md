# Phase 07b: A Kula World-style arena (replaces the cube)

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§5 movement rules, §15), `docs/reports/07-report.md`.

## Why
Jakub doesn't want the cube as an arena. He wants something that feels like a Kula World level.

## Kula World level style (design brief)
- Floating geometric structures of blocks in an empty sky: plates, 1-wide beams, crosses, ladders, frames, towers, all 1 block thick where possible.
- Everything is traversed by rolling over **convex** edges. The undersides and sides of plates and beams are real play space, not just the top. Remember that concave corners are walls in our rules (§5), so a route must never require rolling into a concave corner.
- Several separate parts at different heights, connected by beams and by 2-tile jump gaps.
- Readable silhouettes: you can see the whole structure from any point, and where your rivals are hanging.

## Task 1: Level `arena-02` "Sky Cross" (replaces the cube; keep the id so `.env` still works)
Design it to this brief:
- A central 5×5 plate, 1 thick.
- Four arms out of the plate's edge midpoints, each different:
  1. A 1-wide beam (length ~4) to a 3×3 pad.
  2. A beam with a 1-cell gap in it (a forward jump over the gap, fatal if missed).
  3. A **ladder**: two parallel 1-wide rails with a gap between them, so you can drop between them onto the underside rails.
  4. An arm that reaches a pad on a **different level** (above or below the plate), using only convex edge flips. For example, a beam whose end wraps down around a hanging column onto a lower pad reached from its underside. Work the geometry out against §5 and prove it with the reachability test.
- 8 spawns, 2 per side of the central plate, on both the top AND underside of the plate, facing inward.
- `lives` 3, `timeLimitSec` 180, `crumble` `{ startSec: 40, intervalSec: 10, warnSec: 2 }`.
- Crumble order (distance bands) should naturally take the pads first, then the arms, then the plate rim, then the core.
- Stay within about 25×12×25 so the orbit camera frames it.

Also:
- Move the old cube arena to `levels/arena-cube.json` (id `arena-cube`). Keep it for tests, out of the default rotation. Update the knockout band test that references it.
- Add a **knockout reachability test**: from every spawn, every other spawn's cell and at least 90% of all standable surfaces are reachable via `findPath` (ignoring players).

## Task 2: Finer crumble bands (07 report, open question 1)
- Group bands by **exact squared distance** from the centre, not rounded distance.
- Then merge consecutive bands until each has ≥ 4 blocks, so there are no 1-block bands.
- Keep it deterministic and integer-only. Update the band tests.
- Report the band sizes for arena-01, arena-02 and arena-cube.

## Task 3: Kula-style sky (small, placeholder)
- Replace the flat background with a vertical gradient sky (a big inverted sphere or scene background shader, 2 colours) plus a faint fog tint to match.
- No textures.
- The colours can be set per level via an optional `"sky": ["#hexTop", "#hexBottom"]`. Give race-01, arena-01 and arena-02 different skies.

## Acceptance checklist
- [ ] `levels/arena-02.json` validates, and the reachability and knockout-reachability tests pass
- [ ] All tests pass. Typecheck is clean.
- [ ] 6 unattended rounds with `LEVEL=arena-02` and `seek,bully,bully,wander`: no errors or STUCK, and rounds end before the timeout
- [ ] Screenshots: an overview of arena-02 (orbit cam), a fight on the plate's underside, and a crumble mid-round

## Report: `docs/reports/07b-report.md`
- An ASCII map of arena-02 (top-down per layer, plus the side view of arm 4)
- How arm 4 is traversed, step by step (which edges you flip over)
- Band sizes before and after the new banding
- Bot round stats
- Open questions

Then commit: `phase 07b: kula-style arena + finer crumble + sky`.
