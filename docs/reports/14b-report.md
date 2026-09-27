# Phase 14b report: Roll under a hop + trap placement rules

## Summary
- **Roll under a high hop** (§19, folded into §14/§16 and deleted).
  - A ball high in a hop (ticks 3–7 of 10) doesn't reserve its cell. Rolls, flips and knocks go under it. A roll into a low hop is still a push.
  - When a hop lands on a cell with a ball in it or rolling through, the landing is resolved after that tick's moves:
    - A ball that **stopped** there is stomped (fall-stomp rule: bump along the hopper's fwd, left, right, back).
    - A ball **passing** through keeps the hopper up: it re-hops, even with jump released.
  - A forward jump at a high hopper still clashes. A high hopper ends a cradle line.
  - With push off, balls still roll under hoppers, and stopping under one gives the old MVP overlap.
- **Client:** a hopper's shadow sits on top of the ball under it. A roll under plays a new `whoosh` synth. Hop-landing stomps get the stomp hit-stop and sound.
- **Bots:** seek and blocker roll under a high hopper in their way instead of waiting or jumping. The bully never chooses a cell someone is in as a place to stop.
- **Trap rules:** `npm run level:check` now runs every LEVEL-DESIGN.md rule (`checkTrapRules`, `shared/src/level/rules.ts`).
  - Each finding prints its rule id and tile, e.g. `[E] 3.1 12,0,1 +X`.
  - An [E] fails a pool level, both in `level:check` (exit 1) and in `npm test`.
  - A [W] is fine once explained in the level's new `notes` field.
- **Level format:** `notes`, `theme`, a `deathtrap` flag on tiles, and a boost `dir` (now required). All are validated.
- **All 12 pool levels pass every [E] rule.** Every remaining warning is noted in its level (list below). Several levels needed real redesigns (details below).
- **Follow-ups:**
  - Knocked balls slide on ice.
  - Boosts launch only a ball entering along their `dir`, and the chevrons show that direction.
  - BFS tracks the fire count: a plan may cross 2 fire tiles in a row, never a 3rd.
  - Every pool race level has 8 spawns.
  - The lobby backdrop shows the leading candidate, with a fade between levels.
  - Your `.env` `LEVEL` line is still commented out; I didn't touch it.
- **Bug found and fixed:** arrow tiles have been drawn pointing *against* their dir since 13a. The sim was right; only the rendering was flipped.
- **Checks:** `npm run typecheck` and `npm run build` are clean. `npm test` passes **564 tests** (506 before). `npm run level:check` exits 0.

## Task 1: Roll under
Rules as built (ARCHITECTURE §14 "Roll under a high hop", §16):

| Situation | Result |
|---|---|
| Roll into a hopper on ticks 1–2 or 8–10 of its hop (low) | push (unchanged) |
| Roll into a hopper on ticks 3–7 (high) | rolls under, into and through its cell |
| Hop lands; a ball is standing in the cell (pose and target there) and is stompable | stomp: knocked to the first free of hopper fwd/left/right/back, stagger, credit |
| Hop lands; balls are only passing (rolling in or out that tick) | re-hop from that tick, jump not needed |
| Hop lands; the ball standing there is staggered or spawn-protected | re-hop (it gets stomped next time if it stays) |
| Forward jump or boost landing on a high hopper | stomp jump; clashes if still high at landing (unchanged) |
| Cradle line with a high hopper in it | the hopper isn't a middle ball: the roller passes under, then strikes the line behind it |
| Push rules off | roll-under and re-hop work; stopping under a hopper gives the MVP overlap |

Prediction: a roll into a hopper's cell is a move toward a player, so it's deferred to the server, like pushes.

**Tests** (`rollUnder.test.ts`, 11): each row above; the bump direction order (fwd, left, right, back); two balls passing in sequence keep the hopper up (re-hops at 11 and 21, then it lands); a push toward a high hopper knocks the victim in under it; determinism (random inputs, 4 balls, 600 ticks, replayed twice). Three older tests that encoded "a high hop blocks" now expect roll-under.

**Browser** (headless-ish Chrome over the extension; throwaway server :2569 and Vite :5174; your :2567/:5173 untouched). Two balls on a 9×3 test plate: the browser client as one ball, a scripted Colyseus client as the "second window".
- *Bounce in place while the other rolls under you:*
  - The browser hopped (ticks 46–56). The script rolled in at 50–55, under the high hop, and out at 55–60.
  - At the landing (tick 56) it was passing, so the browser's ball re-hopped (56–66). No stomp; the roller carried on to x=6.
- *Stop under a bouncing ball and get stomped:*
  - The script hopped continuously. The browser rolled in (56–61) and stopped.
  - The hop landed at 63: `stomp` (attacker the hopper, victim Browser). The browser's ball was knocked +Z (the hopper's fwd) to (3,1,1) and staggered 67–73.
  - A later run with W held for two rolls passed under and out (to x=4) with no stomp.
- **Not verified on screen:** the shadow on the roller. I couldn't freeze the frame reliably: the tab's `requestAnimationFrame` is throttled while it isn't being captured, so F8 fired late. The shadow and whoosh are render-only code (`PlayersView.rollUnder`). Worth a look when you play it.

## Task 2: Trap placement rules
Every **[E]** and **[W]** rule in LEVEL-DESIGN.md is implemented. My interpretations are in DECISIONS.md. The main ones:
- Distances are rolls, flips and climbs.
- "Safe route" rules (2.2, 3.3, 5.2) use the bots' planner with every lethal tile, fire included, as a wall.
- 4.2 simulates each lane of 2+ retracting spikes at ROLL_TICKS per tile, **in both directions**, with waiting allowed on tiles without spikes. So a one-way "green wave" fails; that's a choice for you, see question 1.
- 5.1 builds the bots' move graph from every spawn and requires every state to get back to a key, the exit or a spawn.
- 7.3 (2–5 trap types) applies to pool levels only. The other rules run on every level, but only pool levels fail.
- `deathtrap` goes on the ice or boost tile whose forced move may kill. It's checked for "once", "race only" and "not the only route to a key".

**Tests** (`rules.test.ts`, 36):
- The base fixture passes.
- One tiny failing fixture per [E] rule: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 3.3 (twice, once, knockout, only route), 4.1, 4.2, 5.1 (a walled-in arrow loop), 5.2, 6.1 (a thin ice beam), 6.2 (void landing, and 3 moves from a spawn), 7.1, 7.2 (plus the theme exemption), 7.3.
- Spike lane simulation: a phase-staggered lane passes; the same lane unstaggered fails (4 tiles take 15 ticks, the down window is 12); a safe tile in the middle lets you wait; `checkTrapRules` walks lanes both ways.
- Every pool level: no errors and no unnoted warnings.

### Level changes
Two patterns caused most of the errors:
- **Flip landings (3.1).** Any tile on a 1-wide beam, a 1×1 pillar top or a plate's edge row is one you can arrive on by flipping over an edge. So lethal tiles have to sit on interior tiles.
- **Thin ice (6.1).** A slide *across* a 1-thick, 1- or 2-wide ice beam flips round the beam's cross-section forever, because forced slides ignore input. That's a real sim soft-lock (arena-02's rails, race-02's bridge, race-06's runway), not just a checker finding.

| Level | Changes |
|---|---|
| arena-01 | Spawns (4,1,0) → (3,1,0) and (4,1,8) → (5,1,8): they were 2 moves from the retracting spikes. The boost moved from (1,0,4) to the centre (4,0,4) `dir +X`: it was 1 move from the west spawn. |
| arena-02 | The pad's outer-side-face spikes (all flip landings) → static spikes on the pad's centre tile, top and underside. The ice rails (they looped, and were 1 move from spawns) → crumble on the rails' middle blocks (z=7..8). |
| arena-03 | **Rebuilt.** 15×15 plate: the 9×9 ice centre (`"theme": "ice"`) and a 3-wide plain rim, so ice is 3 moves from every spawn. The rim's outer-face spikes (flip landings, 36 of them, 12.6 % lethal) → 12 static spikes on the underside rim's middle ring at each side's midpoint (interior tiles). Spawns moved to the outer ring. |
| arena-04 | Boost `dir +Y` only. |
| arena-05 | The fire ring (1 move from spawns, 20 % lethal) → four 5-tile fire segments on the middle ring (ring 2), one per side (8.5 % lethal, 4+ moves from spawns, no flip landings). Boost dirs set. |
| arena-06 | The spikes on 1×1 pillar tops (flip landings) → retracting spikes on 4 floor tiles off the pillars' diagonals (2,2)/(6,6) phase 0 and (2,6)/(6,2) phase 30. Added crumble on the 4 corner pillars' top blocks (it had only 1 trap type). |
| race-01 | +4 spawns on the start island's edge middles. Boost `dir +Z`. |
| race-02 | The ice bridge widened from 2 to 4 (x 7..10), ice only on the middle two columns. The spike beam widened from 1 to 3 (x 7..9), spikes on the middle column. +4 spawns (west, east, south and north islands). Boost `dir +X`. |
| race-03 | Spike rows trimmed to x=3,4,6,7: the tiles at x=0,1,9,10 were flip landings and 1–2 moves from the side spawns; lethal share 10 % → 7.8 %. +4 spawns (rotationally symmetric). |
| race-04 | +4 spawns on the base plate. Boost `dir +Y` (the throw toward the top). |
| race-05 | The beam-top spikes (1-wide beams: all flip landings) → one crumble block per beam, `regrowSec 8` (a crossed beam breaks behind you for 8 s). Removed the arrow on the exit tile (2.1). +4 spawns (plate corners, symmetric). |
| race-06 | **Rebuilt.** 5×5 islands (was 3×3; every tile was an edge, every pad 1 move from a spawn, the exit on ice). Same idea: paired far boosts on the edge middles across 2-wide gaps; 7 keys (4 corner keys behind 2 interior spikes each, reachable over the outer edge; 2 undersides; 1 side face); an ice runway across the centre on 3-wide bridges, ice only down the middle row; the exit under the centre island. 8 spawns: each edge island's outer middle, on top and underneath. Time 110 s; sudden death 76 s / every 1 s / warn 0.75 s (33 bands fit). |
| traps-lab | Boost dirs only. It's out of the pool; it still reports 52 [E] errors (the lab deliberately shows traps in bad places). |

### Remaining warnings (all in `notes`)

| Level | Warning ids | Why it's fine |
|---|---|---|
| arena-01 | 3.4 `4,0,2 +Y`, `4,0,6 +Y` | Only a ball climbing out of the hole beside the spikes meets them around a corner; from the floor they're in plain view. |
| arena-02 | 7.5 `11,0,2 +Y`, `11,0,2 -Y` | The east beam leads straight into the pad: shoving someone down it onto the centre spikes is the pad's point. |
| arena-03 | 7.5 × 8 (underside spikes `1,0,6`, `1,0,8`, `6,0,1`, `8,0,1`, `6,0,13`, `8,0,13`, `13,0,6`, `13,0,8`, all `-Y`) | A push along the underside rim is how they're used. |
| arena-05 | 4.3 × 8 (each segment's first tile, top and bottom) | The segments run along the ring, not across a route: crossing the ring is 1 fire tile, and the gaps are fire-free. |
| arena-05 | 7.5 × 16 (both ends of each segment, top and bottom) | Pushing someone along the ring into fire is the Fire Ring's point. |
| arena-06 | 7.5 `2,0,2`, `2,0,6`, `6,0,2`, `6,0,6` (+Y) | The spike tiles sit in the open lanes between the pillars on purpose. |
| race-02 | 3.4 `8,0,2 +Y`, `8,0,4 +Y` | Only reached around a corner by climbing up the side of the 3-wide beam; along the beam they're visible. |
| race-02 | 7.5 `8,0,2 +Y`, `8,0,4 +Y` | The spike beam is a timing gauntlet; a push along it is fair game. |
| race-03 | 7.5 × 8 (every spike tile, +Y) | The spike rows cross the open floor on purpose; the pillar gaps are the safe crossings. |

### `level:stats` (after)
| level | mode | blocks | spikes | fire | crumble | ice | arrow | boost | keys | spawns |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| arena-01 Arena 01 | knockout | 77 | 2 | · | · | · | · | 1 | · | 8 |
| arena-02 Arena 02: Sky Cross | knockout | 82 | 2 | · | 4 | · | · | · | · | 8 |
| arena-03 Ice Rink | knockout | 225 | 12 | · | · | 81 | · | · | · | 8 |
| arena-04 Crumble Tower | knockout | 163 | · | · | 9 | · | · | 1 | · | 8 |
| arena-05 Fire Ring | knockout | 185 | · | 20 | · | · | · | 8 | · | 8 |
| arena-06 Pillar Field | knockout | 97 | 4 | · | 4 | · | · | · | · | 8 |
| race-01 Race 01: Four Islands | race | 158 | · | · | 3 | · | · | 1 | 7 (need 3) | 8 |
| race-02 Ice Garden | race | 184 | 2 | · | 5 | 22 | 4 | 1 | 7 (need 3) | 8 |
| race-03 Pillar Garden | race | 139 | 8 | 4 | · | · | · | · | 7 (need 3) | 8 |
| race-04 Sky Ladder | race | 113 | · | · | 6 | · | · | 1 | 7 (need 3) | 8 |
| race-05 Underside | race | 80 | · | · | 4 | · | 23 | · | 7 (need 3) | 8 |
| race-06 Boost Relay | race | 237 | 8 | · | · | 9 | · | 20 | 7 (need 3) | 8 |
| **levels using it** |  |  | 7 | 2 | 7 | 3 | 2 | 7 |  |  |

## Task 3: Follow-ups
1. **Knocked balls slide on ice** (§18).
   - A knock that ends on ice turns the ball to the knock direction and continues as a forced slide: climbing at walls, flipping at edges, pushing into balls.
   - The stagger starts when the slide stops. If the slide is blocked, the stagger starts that tick.
   - Tests: a knock onto ice slides to the rim, facing the knock direction; a knock-slide into a ball pushes it (knocked to x=7, the slider ends at x=6); the stagger comes after the slide, with the action sequence Knocked → Roll → Stunned (stagger) → Idle.
2. **race-05 invisible beam:** noted in §18's 13b rules (z=5, x=2..9). Not built.
3. **Boost `dir`:**
   - Required and validated (⟂ face).
   - A pad launches only when the finished roll or flip arrives moving along it; from any other direction, or by climb or knock, it's a plain tile.
   - Every pad got a dir: across its gap, or the phase 14 design intent (arena-01 +X, arena-04 +Y, race-01 +Z, race-02 +X, race-04 +Y, arena-05 and race-06 across each gap, traps-lab +X).
   - The pad shows 3 chevrons pointing along its dir and only glows for a ball rolling on along it. Test: along launches, against and sideways don't.
4. **Fire in BFS:**
   - Plans carry `fire`; a plan may take up to 2 fire landings in a row, and bots pass their own count.
   - Tests on race-03 (a fire pillar top) and arena-05 (the middle of a 5-long segment), and on small fixtures:
     - a key reachable across fire, and not with fire as a wall;
     - no plan ever above 2;
     - the path replayed in the real sim matches the plan's fire count at every step;
     - 6 fire in a row is unplannable;
     - starting on 2 fire, the plan detours by a side face to reset the count first.
5. **8 spawns** in every pool race level, all passing rule 1 (checked by `level:check`). The spawn-shuffle tests now use the level's spawn count.
6. **Lobby backdrop:** the scene behind the vote panel shows the leading candidate (most votes; the first on a tie or with no votes), with a 150 ms fade through black. Typechecked and built; not screenshotted this phase.
7. **LEVEL-DESIGN.md:** the current text is implemented, including 7.2 with `theme` and 6.2 with the boost dir. arena-03 got `"theme": "ice"`. race-06 didn't need `"theme": "boost"`: 20 pads plus 9 ice blocks come to about 12 % of its standable tiles.
8. `.env` `LEVEL` left commented out.

## Soak
Pool soak: 4 bots (`seek,bully,blocker,wander`, skill 0.5), no `LEVEL` override, bots voting, MIN_PLAYERS 4, throwaway server on :2568. It ran about 30 min and I stopped it after round 20 (the checklist asks for 12).

**20 rounds, 0 STUCK, 0 errors** (server log and bot log).

| Level | Rounds | Winner |
|---|---:|---|
| race-02 | 4 | seek (exit) ×4 |
| race-03 | 1 | seek (exit) |
| race-04 | 2 | seek (exit) ×2 |
| race-05 | 2 | seek (exit) ×2 |
| race-06 | 1 | seek (exit) |
| arena-01 | 1 | bully (last alive) |
| arena-02 | 2 | bully ×2 |
| arena-03 | 2 | bully ×2 |
| arena-04 | 1 | bully |
| arena-05 | 2 | bully ×2 |
| arena-06 | 2 | bully ×2 |

- 11 of the 12 pool levels were played; the vote never picked race-01.
- 354 pushes, 8 cradles and 11 stomps, plus clashes. Deaths by cause: 87 fall, 2 spikes; no fire or burn.
- The rebuilt levels (arena-03, arena-05, race-06) all ran to a normal finish.

## Deviations (details in DECISIONS.md)
1. **Hop landings with a ball underneath are resolved after the tick's moves,** so "passing" doesn't depend on player order. The hopper then decides from the next tick (a 1-tick pause).
2. **A standing ball that can't be stomped** (staggered or protected) makes the hopper re-hop, rather than the fall rule's overlap.
3. **4.2 checks lanes both ways.**
4. **`notes` is keyed by any finding id**, not just 7.5.
5. Fixed the **backwards arrow rendering** from 13a.
6. Level redesigns beyond "move a tile": arena-03, race-06 and arena-05 are structurally new (see the table).

## Open questions
1. **Spike lanes both ways (4.2):** a one-way green wave fails the check. Is that what you want, or should a lane pass if *either* direction works (a deliberate one-way timing run)?
2. **Crumble on race-05's beams** replaced the beam-top spikes: a ball crossing a beam top breaks it for 8 s, cutting the ring. It passes every rule, but it changes the level's feel. Keep it, or try arrows on the beam tops instead?
3. **Rule 3.1 is strict:** no lethal tile on any edge tile. The spike-rimmed designs (Ice Rink, Sky Cross's pad) are impossible now; they moved inward or underneath. If you want "spiked edges" back as a style, it would need a 3.1 exception (like `deathtrap`) or an `edgeSpikes` flag.
4. **traps-lab** fails 52 [E] rules. It's a lab out of the pool, so the errors are informational. Should it be cleaned up or stay a "wrong on purpose" showcase?
