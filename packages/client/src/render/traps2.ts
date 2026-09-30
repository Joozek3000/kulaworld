import * as THREE from 'three';
import { cellKey, dirVec, vanishOn, type Dir, type Level, type Tile, type Vanish } from '@kula/shared';
import { onFace } from './traps.ts';
import { art, environmentFor } from './art.ts';
import { markOccluder } from './xray.ts';

/**
 * Phase 13b traps, procedural, in the ceramic/lavender look: teleporter ring pads (pair colour, a turning swirl), laser
 * emitters and beams (additive, flickering; off beams are faint dotted guides), switch buttons, invisible blocks
 * (a glassy shimmer near the local ball) and vanishing blocks (fade out and in on schedule, flicker before going).
 * LevelView draws the level without the invisible and vanishing blocks; this draws those.
 */

const GROUP_COLORS: Record<string, number> = {
  red: 0xff3b4a, green: 0x3ddc84, blue: 0x3b8cff, yellow: 0xffd23b, purple: 0xb05cff, orange: 0xff9a3b, cyan: 0x3be8ff, pink: 0xff5cc8,
};
const PAIR_COLORS = [0x62dcff, 0xc38bff, 0xffb86a, 0x7dffa8];
const LAVENDER = 0xcbb8f0, IVORY = 0xf1e5cc;
/** A laser group's colour: by name, else a stable pick from the palette. */
export function groupColor(g: string): number {
  if (GROUP_COLORS[g] !== undefined) return GROUP_COLORS[g];
  const all = Object.values(GROUP_COLORS);
  return all[[...g].reduce((h, c) => h + c.charCodeAt(0), 0) % all.length];
}

const ringGeo = new THREE.TorusGeometry(0.32, 0.045, 10, 36);
const arcGeo = new THREE.TorusGeometry(0.18, 0.022, 6, 20, Math.PI * 0.9);
const padGeo = new THREE.CircleGeometry(0.34, 28);
const buttonGeo = new THREE.CylinderGeometry(0.24, 0.27, 0.1, 24);
const baseGeo = new THREE.CylinderGeometry(0.33, 0.35, 0.03, 24);
const nubGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.12, 12);
const dotGeo = new THREE.SphereGeometry(0.035, 6, 4);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const edgesGeo = new THREE.EdgesGeometry(boxGeo);
/** Vanishing blocks flicker this many ticks (0.5 s) before they go, and fade over FADE_TICKS at each end. */
const FLICKER_TICKS = 10, FADE_TICKS = 2;
const Y = new THREE.Vector3(0, 1, 0);

interface Pad { swirl: THREE.Group }
interface Button { group: string; mesh: THREE.Mesh; pressedAt: number }
interface Beam { group: string; beam: THREE.Mesh; glow: THREE.Mesh; dots: THREE.Group; a: THREE.Vector3; b: THREE.Vector3; mat: THREE.MeshBasicMaterial }
interface Block { key: string; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; edges: THREE.LineSegments; edgeMat: THREE.LineBasicMaterial; vanish?: Vanish }

export class Traps2View {
  readonly group = new THREE.Group();
  /** Hook for the sunglasses pickup (phase 15a): show every invisible block, wherever the local ball is. */
  revealInvisible = false;
  private readonly pads: Pad[] = [];
  private readonly buttons: Button[] = [];
  private readonly beams: Beam[] = [];
  private readonly blocks: Block[] = [];
  private readonly blockAt = new Map<string, Block>();
  private readonly owned: { dispose(): void }[] = [];
  private renderTick = 0;

  constructor(private readonly level: Level) {
    const pairs = [...new Set(level.tiles.filter((t) => t.type === 'teleport').map((t) => t.pair))];
    for (const t of level.tiles) {
      if (t.type === 'teleport') this.pad(t, PAIR_COLORS[pairs.indexOf(t.pair) % PAIR_COLORS.length]);
      if (t.type === 'switch') this.button(t);
    }
    for (const l of level.lasers) this.laser(l.group, l.from, l.dir, l.length);
    for (const key of [...level.invisible, ...level.vanish.keys()]) this.block(key, level.vanish.get(key));
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial && !object.material.transparent) {
        object.castShadow = object.receiveShadow = true;
      }
    });
  }

  private mat<T extends { dispose(): void }>(m: T): T { this.owned.push(m); return m; }

  /** A glowing ring pad with a turning three-armed swirl, in its pair's colour (both ends match). */
  private pad(t: Tile, color: number): void {
    const g = onFace(t.block, t.face!);
    const glow = this.mat(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.3 }));
    const floor = this.mat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
    const ring = new THREE.Mesh(ringGeo, glow);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    const disc = new THREE.Mesh(padGeo, floor);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.006;
    const swirl = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const arc = new THREE.Mesh(arcGeo, glow);
      arc.rotation.set(-Math.PI / 2, 0, (k * 2 * Math.PI) / 3);
      swirl.add(arc);
    }
    swirl.position.y = 0.02;
    g.add(ring, disc, swirl);
    this.pads.push({ swirl });
    this.group.add(g);
  }

  /** A round button in its group's colour on a dark ceramic base. */
  private button(t: Tile): void {
    const g = onFace(t.block, t.face!), color = groupColor(t.group);
    const base = new THREE.Mesh(baseGeo, this.mat(new THREE.MeshStandardMaterial({ color: 0x3a3350, roughness: 0.4 })));
    base.position.y = 0.015;
    const mesh = new THREE.Mesh(buttonGeo, this.mat(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.25 })));
    mesh.position.y = 0.08;
    g.add(base, mesh);
    this.buttons.push({ group: t.group, mesh, pressedAt: -Infinity });
    this.group.add(g);
  }

  /** Emitter nubs at both ends, a thin additive beam with a soft glow, and dotted guides for when it's off. */
  private laser(group: string, from: { x: number; y: number; z: number }, dir: Dir, length: number): void {
    const color = groupColor(group), D = dirVec(dir), d = new THREE.Vector3(D.x, D.y, D.z);
    const a = new THREE.Vector3(from.x, from.y, from.z).addScaledVector(d, -0.5), b = a.clone().addScaledVector(d, length);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, d), mid = a.clone().lerp(b, 0.5);
    const nubMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x4a4260, emissive: color, emissiveIntensity: 0.4, roughness: 0.35 }));
    for (const [at, sign] of [[a, 1], [b, -1]] as const) {
      const nub = new THREE.Mesh(nubGeo, nubMat);
      nub.quaternion.setFromUnitVectors(Y, d.clone().multiplyScalar(sign));
      nub.position.copy(at).addScaledVector(d, sign * 0.06);
      this.group.add(nub);
    }
    const mat = this.mat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glowMat = this.mat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    const beamGeo = this.mat(new THREE.CylinderGeometry(0.03, 0.03, length, 8));
    const glowGeo = this.mat(new THREE.CylinderGeometry(0.09, 0.09, length, 12));
    const beam = new THREE.Mesh(beamGeo, mat), glow = new THREE.Mesh(glowGeo, glowMat);
    for (const m of [beam, glow]) { m.quaternion.copy(q); m.position.copy(mid); this.group.add(m); }
    const dots = new THREE.Group(), dotMat = this.mat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
    for (let k = 0.25; k < length; k += 0.5) {
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(a).addScaledVector(d, k);
      dots.add(dot);
    }
    this.group.add(dots);
    this.beams.push({ group, beam, glow, dots, a, b, mat });
  }

  /** An invisible (lavender glass) or vanishing (ivory glaze) block with its own material, for per-block opacity. */
  private block(key: string, vanish?: Vanish): void {
    const [x, y, z] = key.split(',').map(Number);
    const tile = art.blocks[(x + y + z) & 1 ? environmentFor(this.level.id).tile : 'tile-limestone']?.[0];
    const mat = this.mat(vanish && tile ? tile.material.clone() : new THREE.MeshStandardMaterial({ color: vanish ? IVORY : LAVENDER, roughness: vanish ? 0.28 : 0.08, metalness: 0.1 }));
    mat.transparent = true;
    mat.depthWrite = !!vanish;
    const edgeMat = this.mat(new THREE.LineBasicMaterial({ color: vanish ? 0x8a7bb0 : 0xffffff, transparent: true }));
    const mesh = new THREE.Mesh(tile?.geometry ?? boxGeo, mat), edges = new THREE.LineSegments(edgesGeo, edgeMat);
    mesh.position.set(x, y, z);
    edges.position.set(x, y, z);
    if (vanish) markOccluder(mesh); // a vanishing block hides your ball like any block; an invisible one doesn't (19b)
    this.group.add(mesh, edges);
    const b: Block = { key, mesh, mat, edges, edgeMat, vanish };
    this.blocks.push(b);
    this.blockAt.set(key, b);
  }

  /** A switch of `group` was pressed: its buttons push down with a click (main.ts plays it). */
  press(group: string, timeSec: number): void {
    for (const b of this.buttons) if (b.group === group) b.pressedAt = timeSec;
  }

  /**
   * Per frame. `on(group)`: the synced laser state; `local`: the local ball (invisible blocks show near it; null
   * hides them all unless revealed).
   */
  update(renderTick: number, on: (group: string) => boolean, local: THREE.Vector3 | null, timeSec: number): void {
    this.renderTick = renderTick;
    for (const [i, p] of this.pads.entries()) p.swirl.rotation.y = -timeSec * 2.2 + i;
    for (const b of this.buttons) {
      const t = (timeSec - b.pressedAt) / 0.25; // down fast, back up over a quarter second
      b.mesh.position.y = 0.08 - 0.06 * (t >= 0 && t < 1 ? Math.sin(Math.PI * Math.min(1, t * 2) / 2) * (1 - t) : 0);
    }
    for (const [i, b] of this.beams.entries()) {
      const lit = on(b.group);
      b.beam.visible = b.glow.visible = lit;
      b.dots.visible = !lit;
      if (lit) b.mat.opacity = 0.75 + 0.2 * Math.sin(timeSec * 53 + i) * Math.sin(timeSec * 17 + 2 * i);
    }
    for (const b of this.blocks) {
      let alpha: number;
      if (b.vanish) {
        const v = b.vanish, pos = (((renderTick + v.phase) % v.period) + v.period) % v.period;
        if (pos >= v.on) alpha = 0.06; // gone: a faint ghost where it comes back
        else {
          const left = v.on - pos; // ticks until it goes
          alpha = Math.min(1, pos / FADE_TICKS + 0.06, left / FADE_TICKS);
          if (left < FLICKER_TICKS && Math.floor(timeSec * 16) % 2) alpha *= 0.35;
        }
        b.mat.opacity = alpha;
        b.mat.transparent = alpha < 1;
        b.mesh.castShadow = alpha >= 1;
        b.mesh.receiveShadow = true;
        b.edgeMat.opacity = alpha;
      } else {
        const d = !local ? Infinity : Math.max(Math.abs(b.mesh.position.x - local.x), Math.abs(b.mesh.position.y - local.y), Math.abs(b.mesh.position.z - local.z));
        alpha = this.revealInvisible ? 1 : d <= 2 ? 1 : d < 3 ? 3 - d : 0;
        b.mat.opacity = alpha * (0.45 + 0.1 * Math.sin(timeSec * 5 + b.mesh.position.x)); // glassy shimmer
        b.edgeMat.opacity = alpha * (0.6 + 0.3 * Math.sin(timeSec * 7 + b.mesh.position.z));
      }
      b.mesh.visible = b.edges.visible = alpha > 0.01;
    }
  }

  /** Solid for rendering (shadows, camera): invisible blocks, and vanishing ones while they're there. */
  solid = (x: number, y: number, z: number): boolean => {
    const k = cellKey({ x, y, z }), v = this.level.vanish.get(k);
    return v ? vanishOn(v, Math.floor(this.renderTick)) : this.level.invisible.has(k);
  };

  /**
   * What the camera can't see through right now (18c line of sight): vanishing blocks while they're there, and
   * invisible blocks only while they're drawn (near the local ball, or with sunglasses).
   */
  opaque = (x: number, y: number, z: number): boolean => {
    const b = this.blockAt.get(cellKey({ x, y, z }));
    return !!b && (b.vanish ? vanishOn(b.vanish, Math.floor(this.renderTick)) : b.mesh.visible);
  };

  /** The nearest point on an active beam to `p`, or null (the positional buzz). */
  nearestBeam(p: THREE.Vector3, on: (group: string) => boolean): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bestD = Infinity;
    const seg = new THREE.Line3(), out = new THREE.Vector3();
    for (const b of this.beams) {
      if (!on(b.group)) continue;
      seg.set(b.a, b.b).closestPointToPoint(p, true, out);
      const d = out.distanceTo(p);
      if (d < bestD) { bestD = d; best = out.clone(); }
    }
    return best;
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
  }
}

/** The level LevelView draws: without the invisible and vanishing blocks (Traps2View draws those). */
export function staticLevel(level: Level): Level {
  if (!level.invisible.size && !level.vanish.size) return level;
  return { ...level, solid: new Set([...level.solid].filter((k) => !level.invisible.has(k) && !level.vanish.has(k))) };
}
