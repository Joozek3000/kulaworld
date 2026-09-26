# Phase prompts

Workflow:
1. In Claude Code, opened in `C:\projects\kulaworld`, send: `Execute docs/prompts/01-scaffold.md`
2. Claude Code builds the phase, runs the checks, writes `docs/reports/01-report.md` and commits.
3. You run the manual test steps listed in the report.
4. Back in Cowork, say "review phase 01". The architect reads the report and code, then writes fixes or adjusts the next prompt.
5. Repeat with the next phase.

| # | Phase | Result |
|---|---|---|
| 01 | Scaffold | Monorepo runs, client connects to server |
| 02 | Shared sim | All movement rules + Key Race logic, fully unit-tested, no network |
| 03 | Server + bots | Authoritative room, phases, wander bots, latency sim |
| 04 | Client | Rendered level, smooth players, follow camera, controls |
| 04b | Jump fix + feel | Space = hop in place, W+Space = jump forward; ball sits on tiles |
| 04c | Held jump | Hold Space = continuous bounce, W during bounce = forward jump, blob shadows |
| 05 | Key Race complete | HUD, results, seek bots, first real playtest |
| 05b | Air turns | Left/right mid-bounce turns instantly; spawn shuffle for bot fairness |
| 06 | Push (PvP) | Roll into players to knock them; deaths drop a key; bully bots |
| 07 | Knockout | Stagger fix (no chain pushes), lives, crumbling arenas, mixed-mode rotation |
| 07b | Kula arena | Sky Cross arena (beams, ladder, gap, lower pad), finer crumble bands, gradient sky |
| 08 | Rubber feel | Dodgeball rubber sounds (procedural + sample override), squash & stretch, hit-stop, F4 tuning panel |
| 09 | Prediction | Own ball reacts instantly; server-authoritative reconciliation; no push prediction |
| 10 | Stomp | Jump over players; landing on a player bumps them 1 tile in your jump direction; hop = clash defence |
| 10b | Stomp polish | Human-like bot reactions, W+Space jump grace, marker tuning |
