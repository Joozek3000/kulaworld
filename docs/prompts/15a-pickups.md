# Phase 15a: Pickups & pills (+ 13b follow-ups)

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` §21 (new: this phase's spec), §14/§16/§18/§20, `docs/LEVEL-DESIGN.md` §11 (new), `docs/reports/13b-report.md`.

**Working tree:** the art agent's WIP (`art.ts`, `level.ts`, `docs/ART-SOUND.md`, the untracked sky/env assets) is still uncommitted. As before, don't commit it and don't edit those files. Test without it.

## Task 0: 13b follow-ups (decisions on the 13b report's open questions)
1. **race-07 plays short:** move keys so at most 2 are free and at least 5 are caged. With keysRequired 3, everyone has to deal with a cage. Re-run level:check.
2. **Bots and switches:**
   - Seek must be able to open a cage for itself: its planner searches (pose, laser state) with switch presses as moves (reuse the level checker's search).
   - The bully's switch play can detour up to 8 moves (was 4).
3. **Teleport arrival under a high hopper:** a high hopper over the partner pad doesn't count as occupied. The arrival goes under it, with the roll-under/landing rules (§14): if the arriving ball stays, it gets stomped on the hop's landing. Add a test.

## Task 1: Sim (per §21)
- Level format: `pickups` and `randomPickups`, validated.
- Collection on action finish (every finish kind, including knock and teleport arrival).
- Respawn timers, and seeded random spawns on candidate tiles that obey LEVEL-DESIGN §11.
- `effects` per player. Refresh on the same type; cleared on death.
- **Bouncy:** a fwd roll becomes a 2-tile bounce (the jump rules: over, stomp, fall, lasers); fwd+jump becomes a 3-tile jump. Hops are unchanged. BFS and `resultPose` use the current effects.
- **Lethargy:** durations ×1.6, rounded up, for every action you start (not knocks done *to* you).
- **Heavy:** you're not pushable/stompable/hittable, and attackers bounce. Your push knocks up to 2 tiles (1 if blocked after 1). Cradle as the striker: the last ball flies 2.
- **Sunglasses:** no sim effect (a client reveal).
- Events: `pickup {playerId, type}`, `effectEnd`.
- Schema: pickups on the map (id, cell, up, type), and per-player effects.
- The predictor applies your own effects.

## Task 2: Tests
- Pickup by each finish kind (including a knock onto a pill); respawn timing; random spawns are deterministic and only on valid tiles
- **Bouncy:** a 2-tile bounce over a gap; a 3-tile jump; a bounce stomp; a bounce into a laser → death; it expires on time
- **Lethargy:** exact durations; it doesn't slow knocks applied to you; the predictor matches (0 mispredictions solo while lethargic)
- **Heavy:** push/stomp/edge/side-hit on a heavy ball → the attacker bounces; a heavy push knocks 2; blocked after 1 → 1; a heavy cradle striker
- Refresh; clear on death
- Determinism with pickups
- The checker's §11 fixtures
- All older suites pass

## Task 3: Levels
Add pickups to pool levels, obeying §11:
- **knockout arenas:** `randomPickups` (every 20 s, max 2, types bouncy/heavy/lethargy/sunglasses where invisible blocks exist)
- **race levels:** 1–3 fixed spots each (bouncy on routes with gaps; sunglasses on race-05 and arena-01, which have invisible blocks; lethargy as a trap next to a key on 2 levels)
- `level:stats` gains a pickups column

## Task 4: Client
- **Pills:** a floating, slowly spinning capsule in the ceramic style.
  - bouncy: pink/purple, with a bounce bob
  - lethargy: red/yellow, drooping
  - heavy: dark iron grey, with a slow heavy bob
  - sunglasses: little glasses
- **Collect FX:** pop + chime (lethargy: a descending "wah").
- **Active effects on the ball:**
  - bouncy: extra squash and stretch, a springier sound
  - lethargy: a desaturated tint, wobbly camera sway (small), slower rolling sound
  - heavy: a dark metallic material, a deeper thud on landing, "clang" bounces
  - sunglasses: invisible blocks visible everywhere for you, and a sunglasses icon
- **HUD:** effect icons with countdown rings (local player), and small icons on other players' name labels.

## Task 5: Bots
- seek: takes good pills within 4 moves if it doesn't cost the key race
- everyone: avoids lethargy
- bully: values heavy and bouncy, and pushes victims onto lethargy
- they use their bouncy and heavy effects in planning

## Acceptance checklist
- [ ] Tests, typecheck, build and `level:check` are clean (the pool has 0 errors)
- [ ] Browser: grab each pill and see the effect + HUD timer; get knocked onto a lethargy pill; heavy makes a scripted attacker bounce off you; bouncy lets you stomp from 2 tiles with a plain roll
- [ ] Soak (one server + one bot process): 12 pool rounds, 0 STUCK, no errors. Report pickups collected by type and bot, and knockouts involving heavy/bouncy.

## Report: `docs/reports/15a-report.md`
Then commit: `phase 15a: pickups & pills`.
