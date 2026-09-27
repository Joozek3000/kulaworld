import * as THREE from 'three';
import { ALL_DIRS, dirVec, spikesUp, type Dir, type Level, type Pose, type Tile } from '@kula/shared';

/**
 * Tiles & traps (ARCHITECTURE §18), procedural, in the ceramic look. Whole-block glazes (ice, fire tint) live in
 * LevelView's instance colours; this draws what sits on the faces: spikes, fire crosses, crumble cracks, the ice
 * gloss shell, arrows and boost pads.
 */

const IVORY = 0xf1e5cc, GOLD = 0xe8b04a, CORAL = 0xff7a59, CRACK = 0x3a2f2a;
const coneGeo = new THREE.ConeGeometry(0.085, 0.3, 10);
const holeGeo = new THREE.CircleGeometry(0.09, 12);
const barGeo = new THREE.BoxGeometry(0.9, 0.07, 0.02);
const crackGeo = new THREE.BoxGeometry(1, 0.025, 0.015);
const shellGeo = new THREE.BoxGeometry(1.012, 1.012, 1.012);
const padGeo = new THREE.CylinderGeometry(0.38, 0.4, 0.05, 28);
const fragGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const SPIKE_OFFSETS = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];

function arrowGeo(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.34); s.lineTo(0.24, 0.06); s.lineTo(0.09, 0.06); s.lineTo(0.09, -0.3);
  s.lineTo(-0.09, -0.3); s.lineTo(-0.09, 0.06); s.lineTo(-0.24, 0.06); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false });
}
function chevronGeo(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.1); s.lineTo(0.12, -0.02); s.lineTo(0.07, -0.02); s.lineTo(0, 0.05); s.lineTo(-0.07, -0.02); s.lineTo(-0.12, -0.02); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false });
}

const v = (d: Dir) => { const u = dirVec(d); return new THREE.Vector3(u.x, u.y, u.z); };
/** A group on the centre of face `face` of `block`: local +Y is the face normal, local +Z is `fwd` (⟂ face). */
export function onFace(block: { x: number; y: number; z: number }, face: Dir, fwd?: Dir): THREE.Group {
  const g = new THREE.Group();
  const n = v(face), f = v(fwd ?? ALL_DIRS.find((d) => d >> 1 !== face >> 1)!), r = new THREE.Vector3().crossVectors(n, f);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, n, f));
  g.position.set(block.x + n.x * 0.5, block.y + n.y * 0.5, block.z + n.z * 0.5);
  return g;
}

interface Spikes { tile: Tile; cones: THREE.Mesh[]; holes: THREE.Mesh[]; h: number }
interface Pad { tile: Tile; mat: THREE.MeshStandardMaterial; glow: number; chevrons: THREE.Mesh[]; run: number }
interface Crumble { key: string; group: THREE.Group }
interface Fragment { mesh: THREE.Mesh; vel: THREE.Vector3; born: number }

export class TrapsView {
  readonly group = new THREE.Group();
  private readonly spikes: Spikes[] = [];
  private readonly pads: Pad[] = [];
  private readonly crumbles: Crumble[] = [];
  private readonly fireMat = new THREE.MeshStandardMaterial({ color: 0xd8321e, emissive: 0xff3a12, emissiveIntensity: 1, roughness: 0.4 });
  private readonly fragMat = new THREE.MeshStandardMaterial({ color: IVORY, roughness: 0.3, transparent: true });
  private readonly frags: Fragment[] = [];
  private readonly shown = new Map<string, boolean>();
  /** Geometry and materials made for this level (the module-level geometries are shared). */
  private readonly owned: { dispose(): void }[] = [];

  constructor(level: Level) {
    const coneMat = new THREE.MeshStandardMaterial({ color: IVORY, roughness: 0.22 });
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x241c2e, transparent: true, opacity: 0.55, depthWrite: false });
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.22, depthWrite: false });
    const arrowMat = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3 });
    const crackMat = new THREE.MeshBasicMaterial({ color: CRACK, transparent: true });
    const arrow = arrowGeo(), chevron = chevronGeo();
    this.owned.push(coneMat, holeMat, iceMat, arrowMat, crackMat, arrow, chevron, this.fireMat, this.fragMat);
    const open = (b: { x: number; y: number; z: number }, d: Dir) => { const u = dirVec(d); return !level.solid.has(`${b.x + u.x},${b.y + u.y},${b.z + u.z}`); };

    for (const t of level.tiles) {
      const b = t.block;
      switch (t.type) {
        case 'spikes': {
          const g = onFace(b, t.face!), s: Spikes = { tile: t, cones: [], holes: [], h: 1 };
          for (const [x, z] of SPIKE_OFFSETS) {
            const hole = new THREE.Mesh(holeGeo, holeMat);
            hole.rotation.x = -Math.PI / 2;
            hole.position.set(x, 0.004, z);
            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.position.set(x, 0.15, z);
            g.add(hole, cone);
            s.holes.push(hole);
            s.cones.push(cone);
          }
          this.spikes.push(s);
          this.group.add(g);
          break;
        }
        case 'arrow': {
          const g = onFace(b, t.face!, t.dir!), m = new THREE.Mesh(arrow, arrowMat);
          m.rotation.set(-Math.PI / 2, 0, Math.PI); // shape +Y → local +Z (the arrow dir), extruded along the normal
          m.position.y = 0.002;
          g.add(m);
          this.group.add(g);
          break;
        }
        case 'boost': {
          // Local +Z is the pad's dir (phase 14b): it launches only a ball rolling on along it.
          const g = onFace(b, t.face!, t.dir!), mat = new THREE.MeshStandardMaterial({ color: CORAL, emissive: CORAL, emissiveIntensity: 0.1, roughness: 0.3 });
          this.owned.push(mat);
          const pad = new THREE.Mesh(padGeo, mat);
          pad.position.y = 0.025;
          g.add(pad);
          const chevrons: THREE.Mesh[] = [];
          for (let k = 0; k < 3; k++) { // three chevrons running along dir (update() moves them): "you fly this way"
            const c = new THREE.Mesh(chevron, arrowMat);
            c.rotation.set(-Math.PI / 2, 0, Math.PI); // as the arrow: tip along local +Z
            c.position.y = 0.052;
            g.add(c);
            chevrons.push(c);
          }
          this.pads.push({ tile: t, mat, glow: 0, chevrons, run: 0 });
          this.group.add(g);
          break;
        }
        case 'ice': {
          const m = new THREE.Mesh(shellGeo, iceMat);
          m.position.set(b.x, b.y, b.z);
          this.group.add(m);
          break;
        }
        case 'fire':
          for (const d of ALL_DIRS) {
            if (!open(b, d)) continue;
            const g = onFace(b, d);
            for (const a of [Math.PI / 4, -Math.PI / 4]) {
              const bar = new THREE.Mesh(barGeo, this.fireMat);
              bar.rotation.set(-Math.PI / 2, 0, a);
              bar.position.y = 0.011;
              g.add(bar);
            }
            this.group.add(g);
          }
          break;
        case 'crumble': {
          const group = new THREE.Group(), mat = crackMat;
          group.position.set(b.x, b.y, b.z);
          for (const d of ALL_DIRS) {
            if (!open(b, d)) continue;
            const g = onFace({ x: 0, y: 0, z: 0 }, d);
            // A fixed zigzag of three cracks per face.
            for (const [x, z, len, ang] of [[-0.12, -0.1, 0.5, 0.5], [0.12, 0.08, 0.45, -0.7], [0.02, 0.28, 0.3, 0.2]]) {
              const c = new THREE.Mesh(crackGeo, mat);
              c.scale.x = len;
              c.rotation.set(0, ang, 0);
              c.position.set(x, 0.009, z);
              g.add(c);
            }
            group.add(g);
          }
          this.crumbles.push({ key: `${b.x},${b.y},${b.z}`, group });
          this.group.add(group);
          break;
        }
      }
    }
  }

  /**
   * Per frame. `renderTick` drives the spikes; `crumbling` (block → vanish tick) and `serverTick` the crumble cracks
   * (shake while pending, gone, fade back in on regrow); `onto` is where balls are rolling onto right now (boost glow),
   * `charging` where balls are held on a pad (brightest glow, phase 14c).
   */
  update(renderTick: number, serverTick: number, crumbling: { get(k: string): number | undefined }, onto: Pose[], dt: number, timeSec: number, charging: Pose[] = []): void {
    const k = Math.min(1, dt * 18);
    for (const s of this.spikes) {
      s.h += ((spikesUp(s.tile, Math.floor(renderTick)) ? 1 : 0) - s.h) * k;
      for (const c of s.cones) { c.scale.y = Math.max(0.02, s.h); c.position.y = 0.15 * s.h - 0.01; c.visible = s.h > 0.03; }
    }
    this.fireMat.emissiveIntensity = 0.7 + 0.35 * Math.sin(timeSec * 13) + 0.15 * Math.sin(timeSec * 31);
    for (const p of this.pads) {
      const b = p.tile.block, u = dirVec(p.tile.face!);
      const on = (o: Pose) => o.up === p.tile.face && o.cell.x === b.x + u.x && o.cell.y === b.y + u.y && o.cell.z === b.z + u.z;
      const want = charging.some(on) ? 1.6 : onto.some(on) ? 1 : 0; // any direction launches now (phase 14c)
      p.glow += (want - p.glow) * Math.min(1, dt * (want > p.glow ? 20 : 4));
      p.mat.emissiveIntensity = 0.1 + 1.4 * p.glow;
      // The chevrons run along dir all the time, faster while the pad glows; each wraps round in the pad's length.
      p.run = (p.run + dt * (0.35 + 1.2 * p.glow)) % 0.6;
      p.chevrons.forEach((c, k) => { c.position.z = ((p.run + 0.2 * k) % 0.6) - 0.3; });
    }
    for (const c of this.crumbles) {
      const at = crumbling.get(c.key);
      const gone = at !== undefined && at <= serverTick;
      const was = this.shown.get(c.key) ?? true;
      if (gone && was) this.shatter(c, timeSec);
      this.shown.set(c.key, !gone);
      c.group.visible = !gone;
      const [x, y, z] = c.key.split(',').map(Number);
      const shake = at !== undefined && !gone ? 0.05 : 0;
      c.group.position.set(x + shake * Math.sin(timeSec * 61), y + shake * Math.sin(timeSec * 53 + 1), z + shake * Math.sin(timeSec * 47 + 2));
    }
    for (let i = this.frags.length - 1; i >= 0; i--) {
      const f = this.frags[i], age = timeSec - f.born;
      f.vel.y -= 9 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += dt * 5;
      (f.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - age / 0.9);
      if (age > 0.9) { this.group.remove(f.mesh); (f.mesh.material as THREE.Material).dispose(); this.frags.splice(i, 1); }
    }
  }

  /** The block breaks into eight ceramic chips that tumble away and fade. */
  private shatter(c: Crumble, timeSec: number): void {
    const [x, y, z] = c.key.split(',').map(Number);
    for (let i = 0; i < 8; i++) {
      const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1, sz = i & 4 ? 1 : -1;
      const mesh = new THREE.Mesh(fragGeo, this.fragMat.clone());
      mesh.position.set(x + sx * 0.25, y + sy * 0.25, z + sz * 0.25);
      this.group.add(mesh);
      this.frags.push({ mesh, vel: new THREE.Vector3(sx * 0.8, 1 + sy * 0.4, sz * 0.8), born: timeSec });
    }
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    for (const f of this.frags) (f.mesh.material as THREE.Material).dispose();
  }
}

