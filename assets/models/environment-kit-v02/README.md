# Environment kit v02

Original Blender assets for the existing ceramic direction. **13 standalone GLBs**, seven baked PBR sets, an editable Blender source and review renders. Integrated into the Three.js client on 2026-09-27; see `docs/reports/environment-integration-report.md`.

## Contents

| Existing role | Model |
| --- | --- |
| Decorative base blocks | `tile-celadon`, `tile-limestone`, `tile-basalt`, `tile-terracotta` |
| Ice, whole block | `block-ice`: frosted cyan glaze and six-face frost marks |
| Fire, whole block | `block-fire`: kiln ceramic and six-face emissive red/orange X inlays |
| Crumble, whole block | `block-crumble`: baked fractures; `block-crumble-fragments`: eight named pieces |
| Static/retracting spikes | `trap-spikes-raised`, `trap-spikes-retracted`: four ivory spikes, socket plate and state strips |
| One-way arrow | `tile-arrow`: gold arrow and ivory side rails |
| Boost, far | `pad-boost-far`: coral, three directional chevrons and speed rails |
| Boost, high | `pad-boost-high`: violet, two directional chevrons and ascending side steps |

This pack covers the six original trap/tile types. The subsequently added teleporter, laser and switch types keep their procedural models in the client; invisible and scheduled vanishing blocks reuse the base block geometry with their existing reveal/fade behaviour.

## Placement and state

- One unit equals one game cell. Base block geometry is exactly 1 x 1 x 1. Decorative ice/fire markings protrude slightly beyond the block surface; collision must continue to use the existing unit block.
- GLB is **Y-up**. Block roots sit at the block centre. Face roots sit at the supporting face centre, with **+Y outward and +Z forward**. This matches `TrapsView.onFace`.
- Place face assets at `block + normal * 0.5`; do not add another half-cell offset. Rotate the arrow and both boost models using the tile's `dir`.
- Face models replace the current face overlay. Whole-block models replace its block appearance plus matching procedural decorations; avoid drawing the existing overlays a second time.
- Spike meshes, socket meshes, chevrons, charge ring and crumble shards are named separately. Drive visibility, retraction, glow and fragment motion from the game's existing synchronized state; the exports contain no animation that might invent trap timing.
- Raised and retracted spikes have distinct shape and strip colour. Swap complete state assets, or animate named spike children and the strips. Do not use the raised tips while the server reports a safe tile.
- The Blender gallery moves roots for presentation. The GLBs were exported before layout and have centred roots. `asset-manifest.json` gives triangle counts; `validation.json` records measured bounds.

## Materials and textures

`textures/` contains **1024 x 1024 base colour, roughness and tangent normal** maps for each of the four base materials and three special blocks. The GLBs embed these maps, with roughness packed into the standard glTF metallic/roughness texture by Blender. Standalone roughness maps remain available for other engines.

Base colour is sRGB; roughness and normal are linear/non-colour. Normal maps use the OpenGL/glTF +Y convention. They are UV atlases for these meshes, not generic repeating floor images. Use each model's exported UVs. Procedural master materials are retained in the Blender source alongside the baked materials.

Ice is deliberately opaque with a frosted surface, avoiding sorting problems around stacked blocks. Fire emission is an inlay; bloom is optional. Low-light scenes still need fill light so ivory spikes and red fire markings remain readable on every gravity face. Base material differences are decorative and must not imply extra slipperiness, damage or movement rules.

## Skies and lighting

`assets/art/sky-pack-v02/` contains Peach Dawn, Teal Moon and Amber Afterglow, with 4K PNG/linear EXR masters, 2K JPEG previews/runtime candidates, native worlds and lighting preset data. The three `Lighting / ...` scenes in `environment-kit-v02.blend` show identical geometry with different base materials, worlds and key/fill/rim lighting.

The reference lights use Blender watts and metre/cell scene dimensions. Their colours and ratios are art targets, not numerically interchangeable Three.js/Unity light intensities. For gameplay, preserve the existing camera-relative fill so changing gravity does not make the ball and hazards disappear into shadow.

## Checks

Run `python assets/models/environment-kit-v02/validate_exports.py` from the repository root. It checks GLB structure, one root per model, geometry bounds, face orientation dimensions, triangle totals, UV availability and embedded texture sizes. Review renders are in `previews/`. Runtime trap timing and Unity import are not validated by this asset pass.
