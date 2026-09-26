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
const REGROW_SEC = 0.4;
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
  /** Crumble tiles (§18): blocks gone right now, and when a regrown one started fading back in (seconds). */
  private readonly trapGone = new Set<string>();
  private readonly regrowFrom = new Map<string, number>();
  private readonly index: Map<string, number>;
  private readonly crumbleKeys: string[];

  constructor(private readonly level: Level) {
    const keys = [...level.solid];
    this.cells = keys.map((k) => k.split(',').map(Number));
    const index = (this.index = new Map(keys.map((k, i) => [k, i])));
    this.crumbleKeys = [...level.blockTiles].filter(([, t]) => t.type === 'crumble').map(([k]) => k);
    this.bands = level.crumble ? crumbleBands(level).map((b) => b.map((k) => index.get(k)!)) : [];

    this.mesh = new THREE.InstancedMesh(art.block?.geometry ?? boxGeo,
      art.block?.material.clone() ?? new THREE.MeshStandardMaterial({ roughness: 0.28 }), this.cells.length);
    this.cells.forEach((_, i) => { this.place(i, 0); this.mesh.setColorAt(i, this.baseColor(i)); });
    this.group.add(this.mesh);
  }

  private baseColor(i: number): THREE.Color {
    const [x, y, z] = this.cells[i];
    const trap = this.level.blockTiles.get(this.cells[i].join(','))?.type;
    if (trap === 'ice') return tint.set(0xbfe4f5); // pale blue glaze (TrapsView adds the gloss shell)
    if (trap === 'fire') return tint.set(0xf0a88c); // warm terracotta under the red crosses
    return tint.set((x + y + z) & 1 ? 0x2145aa : 0xf1e5cc);
  }

  private place(i: number, shake: number, scale = 1): void {
    const [x, y, z] = this.cells[i];
    const j = shake ? (k: number) => Math.sin(shake * 47 + i * 13 + k) * SHAKE : () => 0;
    this.mesh.setMatrixAt(i, m.makeScale(scale, scale, scale).setPosition(x + j(0), y + j(1), z + j(2)));
  }

  /**
   * Crumble tiles (§18), per frame from the synced `crumbling` (block → vanish tick): a pending block shakes, a gone
   * one is hidden (and not solid for shadows), a regrown one scales back in over REGROW_SEC.
   */
  updateTraps(crumbling: { get(k: string): number | undefined }, serverTick: number, timeSec: number): void {
    if (!this.crumbleKeys.length) return;
    for (const key of this.crumbleKeys) {
      const i = this.index.get(key)!, at = crumbling.get(key);
      if (at !== undefined && at <= serverTick) {
        if (!this.trapGone.has(key)) { this.trapGone.add(key); this.mesh.setMatrixAt(i, ZERO); }
        continue;
      }
      if (this.trapGone.delete(key)) this.regrowFrom.set(key, timeSec);
      const from = this.regrowFrom.get(key);
      const scale = from === undefined ? 1 : Math.min(1, (timeSec - from) / REGROW_SEC);
      if (scale >= 1) this.regrowFrom.delete(key);
      this.place(i, at !== undefined ? timeSec : 0, scale);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
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
    return this.level.solid.has(k) && !this.removed.has(k) && !this.trapGone.has(k);
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
