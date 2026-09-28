# Credits

## Music
There's no music yet. When you add a track, fill in this table **and** the matching entry in
`packages/client/public/music/credits.json`. The in-game Credits screen and the music player both read that file.

| Slot | Track | Artist | Source | Licence |
|---|---|---|---|---|
| menu | — | — | — | — |
| single | — | — | — | — |
| race | — | — | — | — |
| knockout | — | — | — | — |
| results | — | — | — | — |

Slots:
- `menu`: the main menu and the lobby.
- `single`: single-player levels. `single-1` … `single-4` (a "world" is 5 levels) take priority over it when present.
- `race`, `knockout`: multiplayer rounds.
- `results`: result cards, game over, round results.

Use only tracks whose licence allows it (e.g. CC0, or the Pixabay Content License), and keep the source link.

## Code and tools
- [Three.js](https://threejs.org) (MIT), [Colyseus](https://colyseus.io) (MIT), [Vite](https://vite.dev) (MIT)
- Sound effects are synthesised in code (`packages/client/src/audio/synth.ts`) unless noted in `docs/ART-SOUND.md`.
- Art: see `docs/ART-SOUND.md`.
