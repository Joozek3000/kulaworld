# Sound overrides

Drop `<name>.ogg` (or `<name>.wav`) here to replace the synth for that sound. No code changes needed; reload the page.
It is fetched the first time the sound plays, and the synth covers that first play.

Names: bounce, takeoff, roll (replaces the rolling rumble loop), squeak, hit, boing, bump, fall, pop,
key, exit, countdown, go, win, lose, crumbleWarn, crumble, eliminated.

Every play still gets a random pitch (±6 %) and volume (±10 %), and other players' sounds are positional.

## Current bounce

`bounce.wav` is the regular cut of Pretzl / Florian Pretz's RubberBallBouncing, selected by the user as a temporary sound.
Source: https://pixabay.com/sound-effects/film-special-effects-rubberballbouncing-251948/
License record: https://pixabay.com/service/license-summary/
Original and edit settings: `assets/audio/temporary-bounce/` at the repository root.

Trimmed to 0.29 s, filtered and faded; mono 44.1 kHz / 16-bit PCM, -8 dBFS peak. The engine retains its first-play synth fallback while fetching the override. Soft/hard alternatives and edit masters are saved beside the original, not selected automatically by the engine. No runtime audio code was changed.
