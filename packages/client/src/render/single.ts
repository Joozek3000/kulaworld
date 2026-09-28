import * as THREE from 'three';
import { add, dirVec, tileKey, type Level } from '@kula/shared';
import { onFace } from './traps.ts';

/**
 * Single-player tiles (phase 15b, §22), placeholder primitives: paint tiles are a lavender inlay that turns bright
 * mint once lit; a clock tile is a white dial with two hands that greys out once used.
 */
const inlayGeo = new THREE.PlaneGeometry(0.82, 0.82);
const dialGeo = new THREE.CircleGeometry(0.32, 28);
const handGeo = new THREE.BoxGeometry(0.03, 0.02, 0.22);
const UNLIT = 0xb7a8e0, LIT = 0x6ff0c0, DIAL = 0xfdfaf2, USED = 0x8a8799;

interface Face { key: string; mat: THREE.MeshStandardMaterial; hand?: THREE.Object3D }

export class SingleTilesView {
  readonly group = new THREE.Group();
  private readonly paint: Face[] = [];
  private readonly clocks: Face[] = [];
  private readonly owned: THREE.Material[] = [];

  constructor(level: Level) {
    for (const t of level.tiles) {
      if (t.type !== 'paint' && t.type !== 'clock') continue;
      const g = onFace(t.block, t.face!);
      const key = tileKey(add(t.block, dirVec(t.face!)), t.face!);
      const mat = new THREE.MeshStandardMaterial({ color: t.type === 'paint' ? UNLIT : DIAL, roughness: 0.35, emissive: 0x000000 });
      this.owned.push(mat);
      const m = new THREE.Mesh(t.type === 'paint' ? inlayGeo : dialGeo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.006;
      g.add(m);
      if (t.type === 'paint') this.paint.push({ key, mat });
      else {
        const hands = new THREE.Group();
        const handMat = new THREE.MeshBasicMaterial({ color: 0x3a2f4a });
        this.owned.push(handMat);
        const long = new THREE.Mesh(handGeo, handMat);
        long.position.z = 0.1;
        const short = long.clone();
        short.scale.z = 0.6;
        short.rotation.y = Math.PI / 2;
        short.position.set(0.06, 0, 0);
        hands.add(long, short);
        hands.position.y = 0.02;
        g.add(hands);
        this.clocks.push({ key, mat, hand: hands });
      }
      this.group.add(g);
    }
  }

  /** `lit`/`used`: tileKeys (the ball's cell and up); `timeSec` spins the clock hands while a clock is unused. */
  update(lit: ReadonlySet<string>, used: ReadonlySet<string>, timeSec: number): void {
    for (const f of this.paint) {
      const on = lit.has(f.key);
      f.mat.color.setHex(on ? LIT : UNLIT);
      f.mat.emissive.setHex(on ? 0x1d6b52 : 0x000000);
    }
    for (const f of this.clocks) {
      const u = used.has(f.key);
      f.mat.color.setHex(u ? USED : DIAL);
      if (!u) f.hand!.rotation.y = -timeSec * 2;
    }
  }

  dispose(): void {
    this.owned.forEach((m) => m.dispose());
  }
}
