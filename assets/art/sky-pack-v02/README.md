# Sky pack v02

Three original procedural worlds with matching key/fill/rim lighting references:

- **Peach Dawn**: powder-blue overhead, warm peach haze, soft sun. Paired with celadon and limestone.
- **Teal Moon**: teal cloud banks, dark blue dome, moon and sparse stars. Cool key plus a teal rim; enough fill to read the traps. Paired with basalt and limestone.
- **Amber Afterglow**: amber horizon and mauve-blue upper sky, low warm sun. Warm key balanced by cool fill. Paired with terracotta and limestone.

Each world has a **4096 x 2048 PNG** display master, a **4096 x 2048 half-float EXR** linear environment master, and a **2048 x 1024 JPEG** display/runtime candidate. The full sphere is authored with 3D procedural coordinates: no left/right seam, no ground plane and no missing bottom hemisphere when gravity flips.

`sky-pack-v02.blend` contains editable world nodes, panorama cameras and matching area-light rigs. `lighting-presets.json` records the reference rigs. The models under those lights are shown in `assets/models/environment-kit-v02/previews/` and in that kit's Blender scenes.

PNG/JPEG are already display-transformed (AgX) and should be treated as sRGB display backgrounds. EXR is linear HDR, suitable for environment lighting and engine-side tone mapping. Do not apply the display transform twice to the JPEG. The 2K JPEGs are integrated into the Three.js client as sRGB equirectangular skies with matching lights; the EXRs remain lighting masters for future engine work. Unity import has not been tested.

Blender watts, exposure and world strength are reference settings, not direct Three.js/Unity intensity values. Keep a camera-relative fill in the game for readability on all six gravity faces. The night theme is an atmosphere choice, not a reason to hide gameplay-critical warnings.

No third-party textures or sky photographs were used. Native authoring scripts are included as an additional record; the `.blend` files are the editable masters.
