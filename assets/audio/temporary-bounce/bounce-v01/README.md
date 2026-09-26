# Rubber bounce edits v01

Edited from the user-selected Pretzl / Florian Pretz recording in the parent folder. Source URL and license record are in `../source.json`; keep that record with these derivatives.

| Cut | Length | Peak | Treatment |
| --- | --- | --- | --- |
| Soft | 0.24 s | -14 dBFS | Quieter, darker attack, shorter tail |
| Regular | 0.29 s | -8 dBFS | Close to the source character; installed in the game |
| Hard | 0.35 s | -4.5 dBFS | Fuller low body, stronger attack and longer tail |

All cuts remove 20 ms of lead-in, filter low-frequency rumble and fade their boundaries. No pitch shifting, added impacts or artificial reverb. `processing.json` records exact FFmpeg filters and measured levels. 24-bit PCM edit masters preserve the processing; they do not restore information missing from the original MP3. Runtime alternatives are mono 44.1 kHz / 16-bit PCM WAV.

`bounce-comparison.wav` plays **soft, regular, hard**, with one second between cuts. It is an audition strip, not a gameplay sample.

The game uses a copy of `bounce-regular.wav` as `packages/client/public/sfx/bounce.wav`. Its existing single-file override does not switch among variants by landing intensity. To audition another cut in-game, replace that copy and reload; preserve the original MP3 and edit masters. Gameplay and sound-engine code are unchanged.

Checks: all three cuts decode, no sample clips, file boundaries approach zero, and audible onset is within 10 ms. Peak/RMS levels increase from soft to regular to hard.

Validation on 2026-09-26: the browser requested bounce.wav through the existing F4 audition control; repeated audition and a jump were exercised with no browser errors at that point. The production copy matches the source cut byte-for-byte. npm test passed 427 tests; npm run build passed, including typecheck. Later unrelated shared-simulation edits restarted the test server during cleanup.
