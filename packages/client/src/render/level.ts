import * as THREE from 'three';
import { crumbleBands, loadLevel, type Level, type LevelJson } from '@kula/shared';
import { art } from './art.ts';

const files = import.meta.glob<LevelJson>('../../../../levels/*.json', { eager: true, import: 'default' });

export function findLevel(id: string): Level | null {
  const json = Object.values(files).find((j) => j.id === id);
  return json ? loadLevel(json) : null;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const WARN = new THREE.Color(0xff3b3b);
const SHAKE = 0.06; // cells
const m = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0), tint = new THREE.Color();

/**
 * One InstancedMesh of bevelled ceramic blocks; alternating ivory/cobalt glaze works on every gravity face.
 * Knockout crumble (§15): bands the server reports as removed get a zero-scale matrix; the
 * warned band shakes and blinks red. Bands come from the shared `crumbleBands`, the same as the sim's.
 */
export class LevelView {
  readonly group = new THREE.Group();
  private readonly cells: number[][];
  private readonly mesh: THREE.InstancedMesh;
  private readonly bands: number[][]; // instance indices per band
  private crumbled = 0;
  private warnBand = -1;
  private readonly removed = new Set<string>();

  constructor(private readonly level: Level) {
    const keys = [...level.solid];
    this.cells = keys.map((k) => k.split(',').map(Number));
    const index = new Map(keys.map((k, i) => [k, i]));
    this.bands = level.crumble ? crumbleBands(level).map((b) => b.map((k) => index.get(k)!)) : [];

    this.mesh = new THREE.InstancedMesh(art.block?.geometry ?? boxGeo,
      art.block?.material.clone() ?? new THREE.MeshStandardMaterial({ roughness: 0.28 }), this.cells.length);
    this.cells.forEach((_, i) => { this.place(i, 0); this.mesh.setColorAt(i, this.baseColor(i)); });
    this.group.add(this.mesh);
  }

  private baseColor(i: number): THREE.Color {
    const [x, y, z] = this.cells[i];
    return tint.set((x + y + z) & 1 ? 0x2145aa : 0xf1e5cc);
  }

  private place(i: number, shake: number): void {
    const [x, y, z] = this.cells[i];
    const j = shake ? (k: number) => Math.sin(shake * 47 + i * 13 + k) * SHAKE : () => 0;
    this.mesh.setMatrixAt(i, m.makeTranslation(x + j(0), y + j(1), z + j(2)));
  }

  /** Per frame, from the synced `crumbled` (bands removed) and `warnBand`. A new round resets both to none. */
  update(crumbled: number, warnBand: number, timeSec: number): void {
    if (!this.bands.length) return;
    if (crumbled !== this.crumbled || warnBand !== this.warnBand) {
      // Restore everything, then apply the new state (rare: once per band change or round).
      this.bands.forEach((band, b) => band.forEach((i) => {
        const gone = b < crumbled;
        if (gone) this.mesh.setMatrixAt(i, ZERO); else this.place(i, 0);
        this.mesh.setColorAt(i, this.baseColor(i));
      }));
      this.removed.clear();
      for (const band of this.bands.slice(0, crumbled)) for (const i of band) this.removed.add(this.cells[i].join(','));
      this.crumbled = crumbled;
      this.warnBand = warnBand;
    }
    if (warnBand >= 0 && warnBand < this.bands.length) {
      const red = Math.floor(timeSec * 8) % 2 === 0; // blinks 4 times a second
      for (const i of this.bands[warnBand]) {
        this.place(i, timeSec);
        this.mesh.setColorAt(i, red ? WARN : this.baseColor(i));
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Solid for rendering (blob shadows): the level minus crumbled blocks. */
  solid = (x: number, y: number, z: number): boolean => {
    const k = `${x},${y},${z}`;
    return this.level.solid.has(k) && !this.removed.has(k);
  };

  dispose(): void {
    this.mesh.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export function levelBounds(level: Level) {
  const { min, max } = level;
  const center = new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  const radius = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) / 2 + 1;
  return { center, radius };
}
