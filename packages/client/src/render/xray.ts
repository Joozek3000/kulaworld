import * as THREE from 'three';

/**
 * Your own ball's silhouette (phase 17, cut to the local ball in 18b): behind blocks it stays visible as a flat colour
 * at 60 %, so you don't lose it in free look, climbs or the fly-over. Other balls, items and the crown get none, so
 * hidden positions stay hidden. Each mesh gets a child sharing its geometry, drawn only where something nearer
 * already covers it (depth test inverted), nudged towards the camera so it never shows through its own surface.
 *
 * 19b: only where a level block is that nearer thing (not an enemy ball, the crown or an item in front of you). Blocks
 * draw after the other opaque objects (`markOccluder`), so they pass the depth test only where they're the front
 * surface, and write XRAY_MARK into the stencil there. Transparent balls, drawn later, clear it where they're in front
 * (`clearsMark`). The silhouette draws only on the mark.
 *
 * 19c: a depth bias in world units, not a polygon offset: the silhouette's depth is taken XRAY_BIAS nearer the camera,
 * so a surface counts as covering the ball only if it's more than that in front of it. The tile the ball rests on
 * (the ball dips into it when squashing) never does; a real wall or floor is a whole block (1 cell) thick.
 */
const XRAY_OPACITY = 0.6;
export const XRAY_MARK = 1;
export const XRAY_BIAS = 0.3;

/** A level block's mesh: drawn after other opaque objects, marking the stencil where it's the front surface. */
export function markOccluder(mesh: THREE.Mesh): void {
  mesh.renderOrder = 1;
  Object.assign(mesh.material as THREE.Material, {
    stencilWrite: true, stencilRef: XRAY_MARK, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
}

/** A ball's material: where it's the front surface it clears the mark (matters when it's transparent: a ghost ball). */
export function clearsMark(material: THREE.Material): void {
  Object.assign(material, { stencilWrite: true, stencilRef: 0, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
}

export function addXray(root: THREE.Object3D, color: THREE.ColorRepresentation): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  const material = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: XRAY_OPACITY, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false,
    stencilWrite: true, stencilRef: XRAY_MARK, stencilFunc: THREE.EqualStencilFunc, stencilWriteMask: 0, // test only
  });
  material.userData.depthBias = XRAY_BIAS; // read by the raster test
  // Same pixel, but the depth of the point XRAY_BIAS towards the camera (view space looks down -z).
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 biased = projectionMatrix * vec4(mvPosition.xy, mvPosition.z + ${XRAY_BIAS.toFixed(2)}, 1.0);
      gl_Position.z = biased.z / biased.w * gl_Position.w;`);
  };
  for (const mesh of meshes) {
    const s = new THREE.Mesh(mesh.geometry, material);
    s.userData.xray = true;
    s.renderOrder = 10;
    s.raycast = () => {};
    mesh.add(s);
  }
}
