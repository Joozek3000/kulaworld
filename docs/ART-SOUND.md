# Art and sound working brief

Updated: 2026-09-26. Selected direction: **dreamy ceramic**.

This task owns models, visual assets and sound. The user subsequently requested a skybox and integration of the models into the current maps, authorizing the client rendering changes for that work. Three.js is the current target; keep the Blender sources and engine-neutral exports for a possible Unity migration.

## Active visual direction

- Ivory and cobalt glazed blocks, gently bevelled, exactly one cell wide.
- Rubber balls, radius 0.4, with four mesh patterns. Runtime recolours the primary slot to the server-assigned player colour so balls, nameplates and landing markers agree.
- Marigold ceramic keys and separate open/locked exit rings. A physical crossbar identifies a locked exit; mint tabs identify an open exit.
- Seamless lavender cloud panorama with warm pink haze. Clouds surround all six gravity directions; there is no ground plane in the sky.
- The shared renderer applies this kit to all seven maps. Their layouts, collisions, rules and spawn positions are unchanged. Crumble/heat warnings, marker colours, squash/stretch and pickup fades remain active.

## Asset locations

- `assets/models/ceramic-kit-v01/`: editable Blender source, ten GLBs, manifest and preview.
- `assets/art/lavender-sky-v01/`: procedural Blender world and 4096 x 2048 lossless panorama.
- `packages/client/public/models/ceramic-kit-v01/`: runtime model copies. The instanced block uses the ivory model geometry with ivory/cobalt instance tints; the capped-block variant is available for later art use.
- `packages/client/public/sky/lavender-clouds.jpg`: 2048 x 1024 runtime panorama, also used for subtle ceramic reflections.
- `assets/art/ceramic-study/`: earlier visual study.

GLBs use +Y up, embedded PBR colours, no textures. Exit origins sit on their supporting face. In Unity the panorama can be assigned to a panoramic skybox material; this pass does not create a Unity project or claim Unity import validation.

## Sound choice

The user accepted Pretzl's **RubberBallBouncing** on Pixabay as a temporary free bounce:
https://pixabay.com/sound-effects/film-special-effects-rubberballbouncing-251948/

The original MP3 and source/license record are in `assets/audio/temporary-bounce/`. It has been decoded successfully but is not yet trimmed into a single impact or installed as a runtime override. The earlier generated sound study is exploratory, not the selected bounce. No paid samples are used.

The existing audio engine supports `.ogg`/`.wav` overrides in `packages/client/public/sfx/`; retain render-time sound timing when preparing the selected recording for the game.

## Validation

See `docs/reports/art-integration-report.md`. The user-requested departure from placeholder-only art is recorded in `docs/DECISIONS.md`.
