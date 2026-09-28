import * as THREE from 'three';

/**
 * X-ray silhouettes (phase 17): balls, keys, the exit and pills stay visible behind blocks as a flat colour at 60 %.
 * Each mesh gets a child sharing its geometry, drawn only where something nearer already covers it (depth test
 * inverted), nudged towards the camera so it never shows through its own surface. One material per colour.
 */
const materials = new Map<number, THREE.MeshBasicMaterial>();
export const XRAY_OPACITY = 0.6;

export function xrayMaterial(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  const hex = new THREE.Color(color).getHex();
  let m = materials.get(hex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: hex, transparent: true, opacity: XRAY_OPACITY, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    });
    materials.set(hex, m);
  }
  return m;
}

/** Adds a silhouette to every mesh under `root` (once: silhouettes aren't silhouetted again). */
export function addXray(root: THREE.Object3D, color: THREE.ColorRepresentation): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if (o instanceof THREE.Mesh && !o.userData.xray) meshes.push(o); });
  const material = xrayMaterial(color);
  for (const mesh of meshes) {
    const s = new THREE.Mesh(mesh.geometry, material);
    s.userData.xray = true;
    s.renderOrder = 10;
    s.raycast = () => {};
    mesh.add(s);
  }
}
