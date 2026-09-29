import * as THREE from 'three';

/**
 * Your own ball's silhouette (phase 17, cut to the local ball in 18b): behind blocks it stays visible as a flat colour
 * at 60 %, so you don't lose it in free look, climbs or the fly-over. Other balls, items and the crown get none, so
 * hidden positions stay hidden. Each mesh gets a child sharing its geometry, drawn only where something nearer
 * already covers it (depth test inverted), nudged towards the camera so it never shows through its own surface.
 */
const XRAY_OPACITY = 0.6;

export function addXray(root: THREE.Object3D, color: THREE.ColorRepresentation): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  const material = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: XRAY_OPACITY, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  for (const mesh of meshes) {
    const s = new THREE.Mesh(mesh.geometry, material);
    s.userData.xray = true;
    s.renderOrder = 10;
    s.raycast = () => {};
    mesh.add(s);
  }
}
