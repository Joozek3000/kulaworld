# Phase 18: Matches (+ 17 follow-ups)

Read first: `CLAUDE.md` (commit **and push** after each commit), `docs/ARCHITECTURE.md` §23 (new: this phase's spec), §14–§16 (knockout credit), §15 (knockout), `docs/reports/17-report.md`.

## Task 0: 17 follow-ups (decisions)
1. **Island tints:** make the automatic washes paler (about half the current strength), and soften race-01's override colours to match.
2. **Tint overrides on pool levels whose "islands" are joined by bridges:** add `tint` overrides so the conceptual islands read as distinct areas. Candidates: arena-01, race-02, race-03, race-04, race-05, race-07; use judgement per level. Screenshot each.
3. **Keyboard free look:** keep Q + mouse.
4. **Timing preset:** undecided. Keep `classic` as the default. Jakub will choose later.

Commit the follow-ups separately: `phase 17 follow-ups`.

## Task 1: Scoring (shared, pure)
- `scoreRound(mode, result, events, players) → Map<playerId, { points, breakdown }>` per §23. Race placement is by exit, then keys (ties share the higher place). Knockout placement is by elimination order. Knockout credit bonuses are capped. The crowned-knockout +1 needs the crown holder at the time of the knockout event, so pass the crown holder in, or record it on the event server-side.
- Tests: every row of §23; ties; a timeout with no exit; cap enforcement; the crown bonus; players who left mid-round (0 for that round); determinism of the breakdown.

## Task 2: Match flow (server)
- **Room state:**
  - `match: { round, rounds, points: Map<id, n>, stats: Map<id, Stats> }`
  - phases gain `matchEnd` (podium + stats, ~12 s) before returning to the lobby
- **Lobby:** a match-length vote (3/5/7) shown next to the level vote, only before round 1. After round 1 the lobby shows "Round n of N" and the level vote only.
- **Rematch vote** at `matchEnd`: a majority of connected players → a new match with the same players and points reset; otherwise a fresh lobby.
- **Crown:** computed after each round (the strict leader, or nobody on a tie), synced as `crownId`.
- **Stats per player:** points, round wins, knockouts, pushes, stomps, deaths and keys, accumulated from events.
- **Late join / leave** per §23.
- **Bots:** they vote on match length randomly, and on rematch yes.

## Task 3: Client
- **HUD scoreboard:** match points and "Round n/N"; the round's points gained pop in after each round on the results screen (+5, +1 KO …).
- **Crown model:** a small ceramic crown floating above the leader's ball, in gold. It's included in the x-ray silhouettes and the off-screen arrows (the arrow gets a crown icon). A short "👑 X takes the lead" toast.
- **Podium scene:** the camera cuts to a small podium (three stepped blocks, ceramic style, level-independent) with the top 3 balls in their colours. Confetti particles, a stinger, and the names and points above them. Then the stats card and MVP badges (Most knockouts, Most keys, Survivor = fewest deaths, Bully = most pushes). Rematch vote buttons.
- **Music:** the `results` slot during the podium (if present).
- Single player is unchanged.

## Task 4: Rival bot
- A new behaviour `rival`: it plays the key race like seek, but whenever the crowned player (or, before any crown, the current points leader) is within 4 moves, it hunts them with the bully's push/stomp logic. In knockout it hunts the crown holder first.
- Soaks use `seek,bully,rival,wander`.

## Tests
- Scoring (Task 1).
- A room integration test: a 3-round match with 2 scripted clients and bots. Points accumulate, the crown moves, `matchEnd` comes after round 3, and rematch resets points.
- Late join mid-match gets 0 points; a leaver's points are kept and greyed.
- All older suites pass.

## Acceptance checklist
- [ ] Tests, typecheck, build and `level:check` are clean
- [ ] Browser:
  - vote a 3-round match, play it against `seek,bully,rival`
  - see points pop after each round
  - the crown moves to the leader, is visible through walls, and has an arrow when off-screen
  - podium + stats + MVP at the end
  - rematch starts a new match with points reset
- [ ] Soak (one server + one bot process): 3 full matches of 5 rounds with `seek,bully,rival,wander`, 0 STUCK, no errors. Report the per-match standings, how often the crown changed hands, and how often the crowned player was knocked out.
- [ ] Committed and pushed; say whether CI is green if you can check

## Report: `docs/reports/18-report.md`
- Screenshots: the lobby with the match-length vote, the points pop, the crown (in view and x-ray), the podium, the stats card, tints before/after on 3 levels
- Soak table
- Open questions

Then commit: `phase 18: matches`, and push.
