# Environment kit integration

Date: 2026-09-27. User-requested visual integration, outside the numbered gameplay phases.

## Delivered

- Installed all 13 environment-kit-v02 GLBs and three 2K JPEG panoramas in the client public assets. Native Blender sources and full-resolution texture/sky masters remain under `assets/`.
- Base blocks alternate limestone with celadon, basalt or terracotta. Numbered maps cycle Peach Dawn, Teal Moon, Amber Afterglow; cube maps use Teal Moon and other labs default to Peach Dawn. Selection is client presentation only.
- Ice, fire and crumble use their textured whole-block models. Geometry is merged by material once at load, then instanced per model/material across the level. Cell dimensions and simulation collision remain unchanged.
- Exported spikes switch between raised/retracted models using the existing shared tick function. Arrow and boost models align to the supporting face and launch direction. Far/high boost pads stay distinct and their charge glow is isolated per pad. Crumble emits the eight exported shards, hides on the existing vanish tick and scales back on regrowth.
- Gameplay and lobby previews share sky selection, AgX tone mapping and matching hemisphere/key/rim lighting. Key and rim lights follow the camera through gravity changes. Sky JPEGs are tagged sRGB; Three.js bypasses tone mapping for sRGB backgrounds.
- Phase-13b teleporter, laser and switch visuals remain compatible. Vanishing tiles inherit the matching base texture; invisible tiles retain their glass reveal. Lobby cards now include these effects too.
- Failed downloads retain ceramic/primitive block and trap fallbacks, then the older panorama or per-map gradient. Level-owned instance buffers and animated materials are disposed without destroying cached model textures.

## Validation

- `npm test`: 671 passed, 2 skipped across 30 files at the integration checkpoint.
- `npm run build`: all workspace typechecks and the production Vite build pass. Vite still reports its large-chunk advisory; no dependency was added.
- Asset tests parse actual shipped GLBs and cover map cell positions, unit bounds, texture/material bindings, material batching, six-face alignment, spike phase boundaries, crumble hide/shatter/regrowth, isolated boost glow and missing-asset fallbacks. Node tests stub PNG decoding; browser checks cover the real embedded images.
- Browser: Traps Lab renders celadon/limestone, frost blocks, arrows and both boost variants alongside teleport pads and lasers. Ice Garden shows readable basalt/limestone, frost and spike models under Teal Moon. Pillar Garden shows terracotta/limestone, fire X inlays and spike plates under Amber Afterglow. All three palettes render in the lobby cards. The stable production preview reports no console errors/warnings; earlier watched-server restarts from concurrent gameplay edits caused temporary connection failures, resolved by using a server without file watching.
- `git diff --check` passes for the integration files. Unity import and long multiplayer performance soaks were not part of this pass.

## Deviation and scope

The user explicitly requested installation into the game, extending the previously recorded exception to placeholder-only art. Recorded in `docs/DECISIONS.md`. No gameplay/simulation or level-layout changes were made for this task; concurrent gameplay work in the shared workspace is separate. Lighting uses engine-appropriate intensities rather than copying Blender watt values.
