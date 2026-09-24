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
| 05 | Key Race complete | HUD, results, seek bots, first real playtest |
