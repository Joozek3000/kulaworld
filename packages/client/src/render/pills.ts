import * as THREE from 'three';

/** X-ray silhouette colours (phase 17). */
import { dirVec, type Dir } from '@kula/shared';
import type { GameState, ItemS } from '../net.ts';

/**
 * Pills (phase 15a): floating, slowly spinning ceramic capsules, one look and motion per type, and a pop when taken.
 * bouncy: pink/purple, bouncing; lethargy: red/yellow, drooping; heavy: dark iron, a slow heavy bob; sunglasses: a
 * little pair of glasses.
 */
const R = 0.11, HALF = 0.09;
const cap = new THREE.SphereGeometry(R, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, HALF, 0);
const tube = new THREE.CylinderGeometry(R, R, HALF, 16, 1, true).translate(0, HALF / 2, 0);
const lens = new THREE.TorusGeometry(0.075, 0.018, 8, 20);
const bridge = new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6).rotateZ(Math.PI / 2);
const glassGeo = new THREE.CircleGeometry(0.07, 16);
/** Shared glazes, one per colour (the pop clones its own). */
const glazes = new Map<number, THREE.MeshStandardMaterial>();
const ceramic = (color: number, metal = 0) => {
  let m = glazes.get(color);
  if (!m) glazes.set(color, (m = new THREE.MeshStandardMaterial({ color, roughness: metal ? 0.35 : 0.3, metalness: metal })));
  return m;
};
const COLORS: Record<string, [number, number, number?]> = {
  bouncy: [0xff6fb5, 0x9b5de5],
  lethargy: [0xe63946, 0xffd166],
  heavy: [0x3a3f47, 0x5a616b, 0.85],
};
const Y = new THREE.Vector3(0, 1, 0), up = new THREE.Vector3(), q = new THREE.Quaternion();
const POP_SEC = 0.35;

/** Two half capsules in two glazes. */
function capsule(type: string): THREE.Group {
  const [a, b, metal] = COLORS[type] ?? COLORS.bouncy;
  const top = ceramic(a, metal), bottom = ceramic(b, metal);
  const g = new THREE.Group();
  const half = (m: THREE.Material, flip: boolean) => {
    const h = new THREE.Group().add(new THREE.Mesh(cap, m), new THREE.Mesh(tube, m));
    if (flip) h.rotation.x = Math.PI;
    return h;
  };
  g.add(half(top, false), half(bottom, true));
  return g;
}

function glasses(): THREE.Group {
  const m = ceramic(0x1d1d24), frame = ceramic(0xf1e5cc);
  m.side = THREE.DoubleSide;
  const g = new THREE.Group();
  for (const x of [-0.085, 0.085]) {
    const ring = new THREE.Mesh(lens, frame);
    ring.position.x = x;
    const glass = new THREE.Mesh(glassGeo, m);
    glass.position.x = x;
    g.add(ring, glass);
  }
  g.add(new THREE.Mesh(bridge, frame));
  return g;
}

export class PillsView {
  private meshes = new Map<string, { root: THREE.Group; spin: THREE.Group; type: string }>();
  private popping: { root: THREE.Group; materials: THREE.Material[]; start: number }[] = [];

  constructor(private scene: THREE.Scene) {}

  update(state: GameState, visible: boolean, timeSec: number): void {
    const live = new Set<string>();
    state.pickups?.forEach((k, id) => {
      const key = `${id}@${k.x},${k.y},${k.z}`;
      live.add(key);
      let m = this.meshes.get(key);
      if (!m) this.meshes.set(key, (m = this.create(k)));
      m.root.visible = visible;
      this.animate(m.spin, m.type, timeSec + Number(id) * 0.7);
    });
    for (const [key, m] of this.meshes) {
      if (live.has(key)) continue;
      this.meshes.delete(key);
      if (state.phase !== 'playing') { this.scene.remove(m.root); continue; }
      // Taken: it pops (grows and fades).
      const materials: THREE.Material[] = [];
      m.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const mat = (o.material as THREE.Material).clone();
        mat.transparent = true;
        materials.push(mat);
        o.material = mat;
      });
      this.popping.push({ root: m.root, materials, start: timeSec });
    }
    this.popping = this.popping.filter(({ root, materials, start }) => {
      const t = (timeSec - start) / POP_SEC;
      if (t >= 1) { this.scene.remove(root); materials.forEach((x) => x.dispose()); return false; }
      root.scale.setScalar(1 + t * 2);
      materials.forEach((x) => { (x as THREE.MeshStandardMaterial).opacity = 1 - t; });
      return true;
    });
  }

  /** The spin group is in the tile's frame: +Y is the tile's up. */
  private animate(g: THREE.Group, type: string, t: number): void {
    let lift = 0, tilt = 0.9;
    switch (type) {
      case 'bouncy': lift = 0.16 * Math.abs(Math.sin(t * 4)); break; // hops on the tile
      case 'lethargy': lift = -0.06 + 0.03 * Math.sin(t * 1.1); tilt = 1.3 + 0.2 * Math.sin(t * 0.8); break; // sagging over
      case 'heavy': lift = 0.05 * Math.sin(t * 1.2) - 0.02; tilt = 0.6; break; // slow and low
      default: lift = 0.05 * Math.sin(t * 2); tilt = 0; // sunglasses: upright, facing round
    }
    g.position.y = lift;
    g.rotation.set(0, t * (type === 'heavy' ? 0.5 : 0.9), 0);
    g.children[0].rotation.z = tilt;
  }

  private create(k: ItemS): { root: THREE.Group; spin: THREE.Group; type: string } {
    const root = new THREE.Group(), spin = new THREE.Group();
    spin.add(k.kind === 'sunglasses' ? glasses() : capsule(k.kind));
    root.add(spin);
    up.copy(dirVec(k.up as Dir) as THREE.Vector3Like);
    root.position.set(k.x, k.y, k.z).addScaledVector(up, -0.15);
    root.quaternion.copy(q.setFromUnitVectors(Y, up));
    this.scene.add(root);
    return { root, spin, type: k.kind };
  }
}
