# Phase 18 report: Matches (+ 17 follow-ups)

## Summary
- **Task 0: 17 follow-ups** (`phase 17 follow-ups`, pushed on its own)
  - **Paler tints:** the automatic island wash is blended 50 % toward white, and race-01's and sp-10's overrides are softened the same way.
  - **Overrides on bridged pool levels:** race-02's four outer gardens, three of race-05's four corner islands, race-04's summit, race-07's annex, and arena-01's middle band. race-03 (one plate with pillars) stays plain. Before/after shots below.
  - **Free look** stays Q + mouse. **Timing** stays `classic` by default.
- **Task 1: Scoring** (`shared/src/match.ts`, pure)
  - `scoreRound(mode, result, events, players, crownId)` returns, per player, `{ points, place, breakdown }` per §23.
  - Placement:
    - Race: the exit winner first, then by keys; ties share the higher place.
    - Knockout: by elimination order; those still alive at a timeout rank by lives, then knockouts.
  - KO bonuses are capped (race +2, knockout +3). The crowned-KO +1 is outside the cap.
  - Also in the module: `crownOf` (the strict leader, a tie → nobody), `addRoundStats` (the stats from events), and `mvps`.
- **Task 2: Match flow (server)**
  - New schema: `matchRound`, `matchRounds`, `crownId`, `lengthVotes`, and a `standings` map. Each line has the points, the last round's gain and breakdown, the stats, and `left`.
  - A new `matchEnd` phase (12 s).
  - The length vote (3/5/7) happens in the lobby before round 1 only; `MATCH_ROUNDS` in `.env` is the default.
  - The rematch vote at `matchEnd` passes with more than half of the connected players: same length, points reset, leavers dropped. Otherwise the next lobby starts a fresh match.
  - The crown is recomputed after each round and stays fixed for the next one; the room passes it to scoring.
  - A mid-match joiner gets a 0-point line and plays from the next lobby. A leaver's line stays, marked `left`.
  - The server log gets a `match round n/N: …, crown …` line per round and `match over: rematch x/y`.
- **Task 3: Client**
  - **Lobby:** match-length cards (with vote dots) before round 1. After that, "Round n of N" and the board.
  - **In play:** "Round n/N" above the board, with points and 👑 on each line.
  - **Results:** the board with the round's gain popping in (`+5 Exit +5 · KO ×1 +1 · 👑 KO +1`).
  - **Crown:** a gold ceramic crown floating above the leader's ball. It has an x-ray silhouette like the balls, and the leader's off-screen arrow gets a 👑. A toast reads "👑 X takes the lead".
  - **Podium:** the camera cuts to a level-independent podium (three stepped ceramic blocks, trims, the top 3 balls in their colours, 2D name/points labels, confetti, the win stinger, the `results` music slot).
  - After 5 s the stats card comes up (points, wins, KOs, pushes, stomps, deaths, keys), with MVP badges (Most knockouts, Most keys, Survivor, Bully) and Rematch / New lobby buttons. Ready (R, pad Ⓑ) also toggles the rematch vote.
  - Single player is unchanged.
- **Task 4: Rival bot:** `rival` plays the key race like seek, and uses the bully's tactics (push, stomp, side hits, trap pushes), aimed only at the crowned player (or, before a crown, the points leader), when that player is within 4 moves (BFS to a push spot). In knockout it hunts that target first, anywhere. Bots vote a random length (`--length 3|5|7` fixes it) and always vote for a rematch.

## Checks
- `npm test`: **1019 passed** (4 skipped by design). `npm run typecheck`, `npm run build` and `npm run level:check` are clean.
- **New tests**
  - `shared/test/match.test.ts` (12):
    - every §23 row (race 5/3/2/1/0, knockout 5/3/2/1)
    - ties sharing places
    - a timeout with no exit
    - both KO caps
    - the crown bonus in both modes (and not for the crown holder's own KOs)
    - a leaver scoring nothing
    - determinism whatever the player order
    - crown ties, stats and MVPs
  - `server/test/match.test.ts`: a 3-round match through the real room.
    - The length vote, and length votes ignored after round 1.
    - Points accumulate (5, then 7 with a crowned KO), and the crown moves A → B.
    - A late joiner gets 0 and plays round 3; a leaver at `matchEnd` keeps 5, marked left.
    - `matchEnd` comes after round 3, and a 2/2 rematch resets points (same length, the leaver gone).
    - Rounds are ended by forcing results, as the older vote test does. Bots aren't in this test; they're covered by the browser run and the soak.
- **CI:** pushed; I can't see the private repo's Actions from here, so I can't say whether it's green.

## Browser
Headless Chrome on the GPU over CDP; Vite on :5175; a throwaway server on :2568 (pool `race-01,race-02,race-05,race-06`, `MIN_PLAYERS=4`); 3 bots (`seek,bully,rival`, `--length 3`); the browser played as "Jakub".
- **Length vote:** clicked "3 rounds", with the counts showing 4/0/0. The match ran 3 rounds.
- **Points pop** after each round: e.g. round 2 `rival-3 7 +4 2nd +3 · KO ×1 +1` and `bully-2 4 +3 KO ×2 +2 · 👑 KO +1`.
- **Crown:**
  - It moved rival-3 → nobody (an 8–8 tie) → seek-1 in one run, and went to seek-1 in the other.
  - Seen above the crowned ball, through a wall (x-ray), and on a crowned off-screen arrow.
- **Podium, then stats card with MVPs:** e.g. seek-1 *Most keys*; bully-2 *Most knockouts* and *Bully*.
- **Rematch:** 4/4 yes → a lobby with every line at 0, round 0 of 3, no crown.
- No console errors, 0 STUCK.
- **Fixed after the first run:**
  - The crown was too small to read at play distance; it's now 1.7× bigger and higher.
  - The podium title overlapped the labels, and the labels overlapped the stats card; the title is now pinned to the top and the labels hide when the card comes up.

## Soak
One server on :2569 (pool, `MIN_PLAYERS=4`, `MATCH_ROUNDS=5`) and one bot process (`--count 4 --behaviour seek,bully,rival,wander --skill 0.5 --length 5`). **3 full matches of 5 rounds (15 rounds, plus the start of a 4th after the rematch), 0 STUCK, no errors.**

| Match | Round | Level | Round winner | Crown during the round (KO'd ×) | Board after the round |
|---|---:|---|---|---|---|
| 1 | 1 | arena-06 | rival (lastAlive) | — | rival 8, bully 5, seek 4, wander 1 |
| 1 | 2 | arena-04 | seek (lastAlive) | rival (×3) | rival 14, seek 12, bully 12, wander 2 |
| 1 | 3 | race-02 | rival (exit) | rival (0) | rival 19, seek 15, bully 14, wander 2 |
| 1 | 4 | race-03 | seek (exit) | rival (0) | rival 22, seek 20, bully 14, wander 2 |
| 1 | 5 | arena-01 | bully (lastAlive) | rival (×3) | **bully 24, rival 24**, seek 23, wander 5 (crown: nobody) |
| 2 | 1 | race-01 | rival (exit) | — | rival 6, seek 3, bully 0, wander 0 |
| 2 | 2 | race-06 | seek (exit) | rival (×1) | rival 9, seek 8, bully 3, wander 0 |
| 2 | 3 | arena-01 | bully (lastAlive) | rival (×3) | bully 14, rival 14, seek 11, wander 2 (nobody) |
| 2 | 4 | race-01 | seek (exit) | — | 16 / 16 / 16, wander 2 (nobody) |
| 2 | 5 | arena-05 | bully (lastAlive) | — | **bully 23**, rival 22, seek 19, wander 3 |
| 3 | 1 | arena-04 | seek (lastAlive) | — | seek 7, rival 6, bully 5, wander 1 |
| 3 | 2 | arena-05 | bully (lastAlive) | seek (×2) | bully 14, rival 11, seek 10, wander 2 |
| 3 | 3 | race-02 | rival (exit) | bully (×1) | rival 18, bully 15, seek 10, wander 2 |
| 3 | 4 | race-04 | rival (exit) | rival (0) | rival 23, bully 15, seek 13, wander 2 |
| 3 | 5 | arena-03 | bully (lastAlive) | rival (×2) | **rival 25**, bully 24, seek 18, wander 6 |

- **Final standings:**
  - Match 1: bully 24 = rival 24 (a tie), seek 23, wander 5.
  - Match 2: bully 23, rival 22, seek 19, wander 3.
  - Match 3: rival 25, bully 24, seek 18, wander 6.
- **The crown changed hands 8 times** in 15 rounds (tie → nobody counted as a change).
- **The crowned player was knocked out 15 times** in the 10 rounds that had a crown holder; all but 3 of those KOs happened in knockout rounds.
- The matches are close: the leader is a real target, and knockout rounds (with KO bonuses) swing the board.
- The rematch vote passed 4/4 every time, since bots always vote yes.

## Screenshots
- **Tints before → after:**
  - race-01 ![](img/18-tints-before-race-01.jpg) ![](img/18-tints-after-race-01.jpg)
  - race-02 ![](img/18-tints-before-race-02.jpg) ![](img/18-tints-after-race-02.jpg)
  - race-05 ![](img/18-tints-before-race-05.jpg) ![](img/18-tints-after-race-05.jpg)
  - Also race-04 ![](img/18-tints-after-race-04.jpg), race-07 ![](img/18-tints-after-race-07.jpg), arena-01 ![](img/18-tints-after-arena-01.jpg); before: ![](img/18-tints-before-race-04.jpg) ![](img/18-tints-before-race-07.jpg) ![](img/18-tints-before-arena-01.jpg)
- Lobby with the match-length vote: ![](img/18-lobby-length.jpg); the lobby after round 1: ![](img/18-lobby-round2.jpg)
- Points pop: ![](img/18-points-pop.jpg) ![](img/18-points-pop-b.jpg)
- Crown in view: ![](img/18-crown.jpg); through a wall (x-ray, on a side face): ![](img/18-crown-xray.jpg); crowned off-screen arrow (bottom left): ![](img/18-crown-arrow.jpg)
- Podium: ![](img/18-podium.jpg)
- Stats card + MVP badges + rematch: ![](img/18-stats.jpg)
- After the rematch (points reset): ![](img/18-rematch-lobby.jpg)

## Deviations (details in DECISIONS.md)
1. **Race points need a key:** a non-winner scores place points only with ≥ 1 key. Read literally, "ties share the higher place" would give every 0-key player 3.
2. **Length-vote tie:** the default wins if it's among the tied, otherwise the shortest. The length vote is click-only (bots send it); the pad can't cast it yet.
3. **The crown only goes to players still in the room.**
4. **The rival** hunts only its target while that target is within 4 moves, and plays seek otherwise.
5. **The room test forces round results** instead of running bots; bots are covered by the browser run and the soak.

## Open questions
1. **Match winner on a tie:** match 1 ended 24–24. The crown correctly went to nobody, but the podium put the tied players in board order. Should a tie be broken (round wins, then knockouts), or should they share 1st on the podium?
2. **Knockout points dominate:** knockout rounds give up to +9 (5 + 3 KO + crown) against race's usual 5–7, so bully-style bots top matches with mixed pools. Is that intended, or should race exits be worth more (e.g. 6)?
3. **Rematch majority:** "more than half of the connected players". Should a 2-player tie (1 yes, 1 no) go to a rematch instead?
4. **The pad has no way to vote the match length yet** (LB/RB are free for it).
5. **CI:** please check the Actions tab; I can't see it on the private repo.
