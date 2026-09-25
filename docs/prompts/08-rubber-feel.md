# Phase 08: Rubber ball feel (sounds + squash & stretch)

Read first: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§10 rendering, §14), `docs/DECISIONS.md`, `docs/reports/07b-report.md`. Look at the current `client/src/ui/sfx.ts`, `render/players.ts` and `render/fx.ts`.

## Why
Jakub playtested and said combat "doesn't feel right". The first fix is feel: the balls should sound and move like rubber dodgeballs. This phase is client-only; don't change the sim.

## Task 1: Sound engine (`client/src/audio/`)
- **Two sources per sound:**
  - a procedural WebAudio synth by default, so no asset files are needed
  - an optional sample override: if `public/sfx/<name>.ogg` (or `.wav`) exists, play that instead. Load it lazily and fall back to the synth if it's missing. Jakub can then drop in real samples later without touching code.
- **Variation:** every play gets a random pitch of ±6% and a volume of ±10%, so repeats don't sound robotic.
- **Positional audio:** other players' sounds go through a `PannerNode` at the ball's position, with the listener on the camera. Distance falls off with rolloff and a max distance of ~30 cells. Local-player sounds aren't spatialised.
- **Mixer:** master, sfx and ui buses. M mutes, and `[` / `]` change master volume (persisted in localStorage, wrapped in try/catch). Resume the AudioContext on the first key press.
- **Rubber/dodgeball sound set.** Synth recipes are guidance; tune them by ear.

| name | trigger | character (synth idea) |
|---|---|---|
| `bounce` | a hop or jump landing (any ball) | a rubbery "bonk": sine ~180 Hz with a fast pitch drop (×2 → ×1 in 60 ms) + a short band-passed noise slap + a soft low thud. Pitch and volume scale with landing speed; a fall landing is louder and deeper. |
| `takeoff` | hop or jump start | a short soft "fwup": a filtered noise swell, quiet |
| `roll` | while rolling (a continuous loop per rolling ball) | a low rubber rumble: brown noise → lowpass ~300 Hz, with gain following roll speed, plus a very faint squeak tick at each tile start |
| `squeak` | edge flip | a rubber-on-edge squeak: a sine glide up ~700→1100 Hz with slight vibrato, 120 ms |
| `hit` | a `push` event | the big dodgeball **THWACK**: a sharp noise slap (highpass 1.5 kHz, 30 ms) + a boomy rubber body (sine 110 Hz with a pitch drop) + a short "boing" tail. Louder for the victim if it's the local player. |
| `boing` | a `bounce` event (failed push) | a cartoon boing: sine ~250 Hz with 12 Hz vibrato decaying over 300 ms |
| `bump` | local fwd blocked by a wall (no action started although fwd is held; rate-limit to 1 per 300 ms) | a dull, quiet rubber thud |
| `fall` | a ball starts falling off the map | a descending whistle (sine glide 900→200 Hz over the fall), spatial |
| `pop` | death | a distant rubbery pop |
| `key`, `exit`, `countdown`, `go`, `win`, `lose`, `crumbleWarn`, `crumble`, `eliminated` | as now | Restyle to fit: marimba/plucky tones instead of plain beeps, and a crumbly low noise for crumble. |

- Derive triggers from the rendered state transitions the client already tracks (segment history), not only from server events. That way sounds line up with what you *see* (render time), not with when a patch arrives.

## Task 2: Squash & stretch (render only)
- **Transform structure:** each ball gets an outer group that owns the squash/stretch scale in an axis-aligned frame. The existing spin rotation stays on the inner mesh, so the squash axis doesn't rotate with the spin. Volume is preserved: stretch `s` along the axis and `1/√s` on the other two.
- **Spring:** per ball, a damped spring on the scale value (stiffness ~300, damping ~12, frame-rate independent). Events kick it:
  - **Landing** (hop, jump or fall ends): squash along U to 0.65–0.8 depending on landing speed, then spring back with overshoot (a visible jiggle).
  - **Takeoff:** 1 tick of anticipation squash (0.85), then stretch along U (1.15) during the rise, easing to 1 at the apex. It stretches again slightly on the way down.
  - **Jump arc:** stretch aligned with the velocity direction (not just U) while airborne.
  - **Push contact:** at the moment of contact (render time), both balls squash along the contact axis (0.75). The victim then stretches along the knock direction during the slide and squashes on stop.
  - **Bounce (failed push):** the pusher squashes hard against the victim (0.7), then jiggles back.
  - **Stunned:** a small continuous wobble on two axes (it replaces or complements the current tilt wobble).
  - **Roll:** a subtle 3% squash pulse at each tile start (optional, keep it only if it looks good).
- **Shadow:** it follows the squash (wider when squashed) and shrinks with height, as now.
- **Hit-stop:** a tiny freeze of 2 frames (~35 ms) of the two balls' render time at push contact, local only and visual only. Make it a constant so it can be set to 0.

## Task 3: Tuning panel (dev only)
- F4 opens a small panel with sliders for: master volume, per-sound gain, squash amount, spring stiffness/damping, and hit-stop ms.
- Values persist in localStorage (with try/catch), plus a "copy as JSON" button so Jakub can send his tuned numbers back.

## Acceptance checklist
- [ ] No sim or server changes; all tests pass; typecheck is clean.
- [ ] Hop in place: a takeoff swoosh, a stretch up, a squash on landing with a jiggle, and a rubbery bonk
- [ ] Hold W: a soft rumble and tile ticks; the flip squeak on edges
- [ ] Push a bot: a THWACK, both squash, the victim stretches while sliding; failed push → boing and a hard squash
- [ ] Other balls' sounds are positional (left/right, quieter when far)
- [ ] Dropping a file `public/sfx/hit.ogg` replaces the synth `hit` without code changes
- [ ] 8 players: still ~60 fps; audio has no crackling (cap concurrent voices, e.g. 24, and drop the quietest)

## Report: `docs/reports/08-report.md`
- The sound list with the synth recipe as implemented
- A short screen recording or a GIF-like frame strip (4–6 frames) of hop squash and push contact
- Default tuning values
- Open questions

Then commit: `phase 08: rubber feel (audio + squash/stretch)`.
