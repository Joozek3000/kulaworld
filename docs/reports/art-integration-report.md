# Ceramic art integration report

Date: 2026-09-26. User-requested visual pass, outside the numbered gameplay phases.

## Delivered

- All seven maps render instanced, bevelled ivory/cobalt ceramic blocks using the exported kit geometry. No map JSON or simulation files were changed.
- Four rubber ball patterns preserve server-assigned colours, rolling, squash/stretch, spawn transparency and winner highlighting.
- Ceramic keys retain spinning/pickup fades. Open and locked exits use separate shapes, aligned to any of the six gravity faces.
- Seamless lavender/pink cloud sky: editable procedural Blender world, 4096 x 2048 PNG master and 2048 x 1024 JPEG runtime texture (262 kB). The same panorama supplies soft environment reflections.
- Missing model/image downloads retain primitive/gradient fallbacks. A startup guard waits for the first server snapshot before rendering player state. Level switches release instance buffers and level materials.

## Validation

- `npm test`: 427 passed across 22 files.
- `npm run build`: passes, including typecheck for all workspaces and the production Vite build.
- Three new asset integration tests parse the actual shipped GLBs. They verify unit blocks, radius-0.4 balls, rubber material slots, cell positions on every map, crumble warning/removal/reset, six-face exit alignment and state switching, and isolated key pickup fades.
- Browser: played Race 01 on an isolated server; inspected the sky, ceramic paths, locked gate, floating keys, patterned ball and a jump. Countdown protection and later opaque rubber rendering were visible. Crumble timing remained active. No new browser errors after the startup guard. A harmless GPU shader precision warning appeared while compiling environment lighting.
- All-map geometry is covered by the automated test; the visual playtest used Race 01. Unity import is not yet tested.

## Sources and handoff

- Models: `assets/models/ceramic-kit-v01/ceramic-kit-v01.blend`, individual GLBs and manifest beside it.
- Sky: `assets/art/lavender-sky-v01/lavender-sky-v01.blend` and `lavender-clouds-4k.png`.
- Runtime copies: `packages/client/public/models/ceramic-kit-v01/` and `packages/client/public/sky/`.
- No new dependencies. Models use embedded PBR material colours. The capped block remains an available variant; current maps use one shared block geometry with alternating glaze colours to keep instancing.
- The previously selected temporary bounce recording remains in `assets/audio/temporary-bounce/`; this visual pass does not install a sound override.

## Deviation

The user's explicit request to put the models and skybox into current maps authorizes the departure from placeholder-only art. Recorded in `docs/DECISIONS.md`. The common ceramic panorama overrides per-level gradient colours; those remain the load-failure fallback. No gameplay architecture changes.
