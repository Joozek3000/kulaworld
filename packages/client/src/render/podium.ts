import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/**
 * The end-of-match podium (phase 18, §23): three stepped ceramic blocks with the top 3 places' balls in their colours,
 * names and points above them, and confetti. Players sharing a place (18b) stand side by side on a wider step.
 * Level-independent: it lives far above any level, and the camera cuts to it.
 */
export const PODIUM_AT = new THREE.Vector3(0, 400, 0);
const HEIGHTS = [1.3, 0.9, 0.55]; // the top step, then the next two
const BALL_W = 1.1, STEP_PAD = 0.5, GAP = 0.2;
const CONFETTI = 160;
const GLAZE = 0xf1e5cc, TRIM = 0xe8b04a;
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);

/** `place`: the match place (ties share it: 1, 1, 3). */
export interface PodiumEntry { name: string; color: string; points: number; place: number }

export class Podium {
  readonly group = new THREE.Group();
  /** The steps, balls and labels of the current show (rebuilt each time). */
  private readonly stand = new THREE.Group();
  private balls: { mesh: THREE.Mesh; h: number }[] = [];
  private labels: CSS2DObject[] = [];
  private readonly stepMat = new THREE.MeshStandardMaterial({ color: GLAZE, roughness: 0.3 });
  private readonly trimMat = new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.25, metalness: 0.3 });
  private readonly ballGeo = new THREE.SphereGeometry(0.45, 32, 20);
  private readonly confetti: THREE.InstancedMesh;
  private readonly bits: { pos: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3; rot: THREE.Vector3 }[] = [];
  shown = false;

  constructor(scene: THREE.Scene) {
    this.group.position.copy(PODIUM_AT);
    this.group.visible = false;
    this.group.add(this.stand);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.2, 48), new THREE.MeshStandardMaterial({ color: 0xd9cdef, roughness: 0.5 }));
    floor.position.y = -0.1;
    this.group.add(floor);
    const colours = [0xff5d8f, 0xffd166, 0x6ff0c0, 0x7aa7ff, 0xc39bff, 0xffffff];
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.07), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONFETTI);
    for (let i = 0; i < CONFETTI; i++) {
      this.confetti.setColorAt(i, new THREE.Color(colours[i % colours.length]));
      this.bits.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Vector3() });
    }
    this.confetti.frustumCulled = false;
    this.group.add(this.confetti);
    scene.add(this.group);
  }

  /**
   * Shows the top 3 places (`entries` sorted by place; fewer steps if fewer played) and throws the confetti. Each
   * distinct place gets the next step down, so a shared 1st is followed by 3rd on the second step.
   */
  show(entries: readonly PodiumEntry[]): void {
    this.clearStand();
    const steps: PodiumEntry[][] = [];
    for (const e of entries) {
      if (steps.length && steps[steps.length - 1][0].place === e.place) steps[steps.length - 1].push(e);
      else if (steps.length < HEIGHTS.length) steps.push([e]);
      else break;
    }
    // Left to right: 2nd, 1st, 3rd, each step as wide as its balls.
    const order = [1, 0, 2].filter((i) => steps[i]), width = (i: number) => steps[i].length * BALL_W + STEP_PAD;
    let x = -(order.reduce((w, i) => w + width(i), 0) + GAP * (order.length - 1)) / 2;
    for (const i of order) {
      const w = width(i), h = HEIGHTS[i], cx = x + w / 2;
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.6), this.stepMat);
      block.position.set(cx, h / 2, 0);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, 1.64), this.trimMat);
      trim.position.set(cx, h - 0.04, 0);
      this.stand.add(block, trim);
      steps[i].forEach((t, k) => {
        const bx = cx + (k - (steps[i].length - 1) / 2) * BALL_W;
        const mesh = new THREE.Mesh(this.ballGeo, new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.35 }));
        mesh.position.set(bx, h + 0.45, 0);
        const div = document.createElement('div');
        div.className = 'podium-label';
        const b = document.createElement('b');
        b.textContent = `${t.place}. ${t.name}`; // names as text (phase 19)
        div.append(b, document.createElement('br'), `${t.points} pts`);
        div.style.borderColor = t.color;
        const label = new CSS2DObject(div);
        label.position.set(bx, h + 1.25 + (k % 2) * 0.45, 0); // stagger shared labels so they don't overlap
        this.stand.add(mesh, label);
        this.balls.push({ mesh, h });
        this.labels.push(label);
      });
      x += w + GAP;
    }
    for (const b of this.bits) {
      b.pos.set((Math.random() - 0.5) * 6, 4 + Math.random() * 4, (Math.random() - 0.5) * 3);
      b.vel.set((Math.random() - 0.5) * 1.5, -0.5 - Math.random(), (Math.random() - 0.5) * 1.5);
      b.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      b.rot.set(0, 0, 0);
    }
    this.group.visible = this.shown = true;
  }

  /** The names and points above the balls (hidden once the stats card covers the podium). */
  labelsVisible(on: boolean): void {
    for (const l of this.labels) l.visible = on;
  }

  hide(): void {
    if (!this.shown) return;
    this.group.visible = this.shown = false;
    this.clearStand();
  }

  /** Drops the last show (CSS2D labels take their elements with them when removed). */
  private clearStand(): void {
    this.stand.traverse((o) => {
      if (o instanceof THREE.Mesh) { if (o.geometry !== this.ballGeo) o.geometry.dispose(); if (o.material !== this.stepMat && o.material !== this.trimMat) (o.material as THREE.Material).dispose(); }
    });
    this.stand.clear();
    this.balls = [];
    this.labels = [];
  }

  /** Confetti falls and flutters (per frame, no allocations); the balls bob a little. */
  update(dt: number, timeSec: number): void {
    if (!this.shown) return;
    this.bits.forEach((b, i) => {
      b.vel.y = Math.max(b.vel.y - dt * 0.8, -1.2);
      b.pos.addScaledVector(b.vel, dt);
      b.pos.x += Math.sin(timeSec * 3 + i) * dt * 0.4;
      if (b.pos.y < -0.5) b.pos.y += 8;
      b.rot.addScaledVector(b.spin, dt);
      this.confetti.setMatrixAt(i, m4.compose(p.copy(b.pos), q.setFromEuler(e.set(b.rot.x, b.rot.y, b.rot.z)), one));
    });
    this.confetti.instanceMatrix.needsUpdate = true;
    this.balls.forEach((b, i) => { b.mesh.position.y = b.h + 0.45 + Math.abs(Math.sin(timeSec * 3 + i)) * 0.12; });
  }

  /** The camera looks at the podium from the front, slightly above. */
  place(camera: THREE.Camera): void {
    camera.position.set(PODIUM_AT.x, PODIUM_AT.y + 2.6, PODIUM_AT.z + 6.8);
    camera.lookAt(PODIUM_AT.x, PODIUM_AT.y + 1.2, PODIUM_AT.z);
  }
}
