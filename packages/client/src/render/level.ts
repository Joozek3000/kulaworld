import * as THREE from 'three';
import { crumbleBands, loadLevel, type Level, type LevelJson } from '@kula/shared';
import { art, environmentFor, type ModelName } from './art.ts';

const files = import.meta.glob<LevelJson>('../../../../levels/*.json', { eager: true, import: 'default' });

export function findLevel(id: string): Level | null {
  const json = Object.values(files).find((j) => j.id === id);
  return json ? loadLevel(json) : null;
}
/** Every level in levels/ (the campaign's too, phase 15b). */
export const allLevels = (): Level[] => Object.values(files).map(loadLevel);

/**
 * Islands (phase 17, presentation only): the level's blocks grouped into face-connected components, largest first
 * (ties in level order), as block cellKeys.
 */
export function islands(solid: ReadonlySet<string>): string[][] {
  const seen = new Set<string>(), out: string[][] = [];
  for (const start of solid) {
    if (seen.has(start)) continue;
    const island = [start];
    seen.add(start);
    for (let i = 0; i < island.length; i++) {
      const [x, y, z] = island[i].split(',').map(Number);
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const k = `${x + dx},${y + dy},${z + dz}`;
        if (solid.has(k) && !seen.has(k)) { seen.add(k); island.push(k); }
      }
    }
    out.push(island);
  }
  return out.sort((a, b) => b.length - a.length);
}
const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** The largest island keeps the plain glaze; the others get a pale hue wash, golden-angle apart (halved in 17 follow-ups). */
export function islandTint(index: number, out: THREE.Color): THREE.Color {
  return index === 0 ? out.set(0xffffff) : out.setHSL((index * 0.618034 + 0.08) % 1, 0.55, 0.86).lerp(WHITE, 0.5);
}
const WHITE = new THREE.Color(0xffffff);

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const fallbackMat = new THREE.MeshStandardMaterial({ roughness: 0.28 });
const WARN = new THREE.Color(0xff3b3b);
const SHAKE = 0.06; // cells
const REGROW_SEC = 0.4;
const m = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0), tint = new THREE.Color();

/**
 * Textured blocks batched by model/material; one cell transform drives all parts of a special block.
 * Knockout crumble (§15): bands the server reports as removed get a zero-scale matrix; the
 * warned band shakes and blinks red. Bands come from the shared `crumbleBands`, the same as the sim's.
 */
export class LevelView {
  readonly group = new THREE.Group();
  private readonly cells: number[][];
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly instances: { meshes: THREE.InstancedMesh[]; slot: number; textured: boolean }[] = [];
  private readonly bands: number[][]; // instance indices per band
  private crumbled = 0;
  private warnBand = -1;
  private readonly removed = new Set<string>();
  /** Crumble tiles (§18): blocks gone right now, and when a regrown one started fading back in (seconds). */
  private readonly trapGone = new Set<string>();
  private readonly regrowFrom = new Map<string, number>();
  private readonly index: Map<string, number>;
  private readonly crumbleKeys: string[];
  /** Per cell: its island's glaze tint (phase 17), or a level override. Trap blocks keep their own look. */
  private readonly tints: THREE.Color[];

  constructor(private readonly level: Level) {
    const keys = [...level.solid];
    this.cells = keys.map((k) => k.split(',').map(Number));
    const index = (this.index = new Map(keys.map((k, i) => [k, i])));
    this.crumbleKeys = [...level.blockTiles].filter(([, t]) => t.type === 'crumble').map(([k]) => k);
    this.bands = level.crumble ? crumbleBands(level).map((b) => b.map((k) => index.get(k)!)) : [];
    const island = new Map<string, number>();
    islands(level.solid).forEach((cells, n) => { for (const k of cells) island.set(k, n); });
    this.tints = keys.map((k) => {
      const t = level.tints.get(k);
      return t ? new THREE.Color(t) : islandTint(island.get(k)!, new THREE.Color());
    });

    const batches = new Map<ModelName, number[]>();
    this.cells.forEach(([x, y, z], i) => {
      const trap = level.blockTiles.get(keys[i])?.type;
      const name: ModelName = trap === 'ice' || trap === 'fire' || trap === 'crumble'
        ? `block-${trap}` : (x + y + z) & 1 ? environmentFor(level.id).tile : 'tile-limestone';
      const cells = batches.get(name) ?? [];
      cells.push(i);
      batches.set(name, cells);
    });
    for (const [name, cells] of batches) {
      const parts = art.blocks[name];
      const meshes = (parts ?? [art.block ?? new THREE.Mesh(boxGeo, fallbackMat)])
        .map((part) => {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material.clone(), cells.length);
          mesh.name = name;
          mesh.userData.cells = cells.map((i) => keys[i]);
          this.meshes.push(mesh);
          this.group.add(mesh);
          return mesh;
        });
      cells.forEach((i, slot) => { this.instances[i] = { meshes, slot, textured: !!parts }; });
    }
    this.cells.forEach((_, i) => { this.place(i, 0); this.color(i, this.baseColor(i)); });
  }

  private baseColor(i: number): THREE.Color {
    const [x, y, z] = this.cells[i];
    const trap = this.level.blockTiles.get(this.cells[i].join(','))?.type;
    if (this.instances[i].textured) return trap ? tint.set(0xffffff) : tint.copy(this.tints[i]);
    if (trap === 'ice') return tint.set(0xbfe4f5); // pale blue glaze (TrapsView adds the gloss shell)
    if (trap === 'fire') return tint.set(0xf0a88c); // warm terracotta under the red crosses
    return tint.set((x + y + z) & 1 ? 0x2145aa : 0xf1e5cc).multiply(this.tints[i]);
  }

  private place(i: number, shake: number, scale = 1): void {
    const [x, y, z] = this.cells[i];
    const j = shake ? (k: number) => Math.sin(shake * 47 + i * 13 + k) * SHAKE : () => 0;
    this.matrix(i, m.makeScale(scale, scale, scale).setPosition(x + j(0), y + j(1), z + j(2)));
  }

  private matrix(i: number, matrix: THREE.Matrix4): void {
    const { meshes, slot } = this.instances[i];
    for (const mesh of meshes) mesh.setMatrixAt(slot, matrix);
  }

  private color(i: number, color: THREE.Color): void {
    const { meshes, slot } = this.instances[i];
    for (const mesh of meshes) mesh.setColorAt(slot, color);
  }

  private refresh(): void {
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
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
        if (!this.trapGone.has(key)) { this.trapGone.add(key); this.matrix(i, ZERO); }
        continue;
      }
      if (this.trapGone.delete(key)) this.regrowFrom.set(key, timeSec);
      const from = this.regrowFrom.get(key);
      const scale = from === undefined ? 1 : Math.min(1, (timeSec - from) / REGROW_SEC);
      if (scale >= 1) this.regrowFrom.delete(key);
      this.place(i, at !== undefined ? timeSec : 0, scale);
    }
    this.refresh();
  }

  /** Per frame, from the synced `crumbled` (bands removed) and `warnBand`. A new round resets both to none. */
  update(crumbled: number, warnBand: number, timeSec: number): void {
    for (const mesh of this.meshes) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (mesh.name === 'block-fire' && material.emissive.getHex() !== 0) {
        material.emissiveIntensity = 1.2 + 0.35 * Math.sin(timeSec * 13) + 0.15 * Math.sin(timeSec * 31);
      }
    }
    if (!this.bands.length) return;
    if (crumbled !== this.crumbled || warnBand !== this.warnBand) {
      // Restore everything, then apply the new state (rare: once per band change or round).
      this.bands.forEach((band, b) => band.forEach((i) => {
        const gone = b < crumbled;
        if (gone) this.matrix(i, ZERO); else this.place(i, 0);
        this.color(i, this.baseColor(i));
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
        this.color(i, red ? WARN : this.baseColor(i));
      }
    }
    this.refresh();
  }

  /** Solid for rendering (blob shadows): the level minus crumbled blocks. */
  solid = (x: number, y: number, z: number): boolean => {
    const k = `${x},${y},${z}`;
    return this.level.solid.has(k) && !this.removed.has(k) && !this.trapGone.has(k);
  };

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}

export function levelBounds(level: Level) {
  const { min, max } = level;
  const center = new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  const radius = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) / 2 + 1;
  return { center, radius };
}
