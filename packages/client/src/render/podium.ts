import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/**
 * The end-of-match podium (phase 18, §23): three stepped ceramic blocks with the top 3 balls in their colours, names
 * and points above them, and confetti. Level-independent: it lives far above any level, and the camera cuts to it.
 */
export const PODIUM_AT = new THREE.Vector3(0, 400, 0);
const STEPS = [{ x: 0, h: 1.3 }, { x: -1.8, h: 0.9 }, { x: 1.8, h: 0.55 }]; // 1st, 2nd, 3rd
const CONFETTI = 160;
const GLAZE = 0xf1e5cc, TRIM = 0xe8b04a;
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);

export interface PodiumEntry { name: string; color: string; points: number }

export class Podium {
  readonly group = new THREE.Group();
  private readonly balls: THREE.Mesh[] = [];
  private readonly labels: CSS2DObject[] = [];
  private readonly confetti: THREE.InstancedMesh;
  private readonly bits: { pos: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3; rot: THREE.Vector3 }[] = [];
  shown = false;

  constructor(scene: THREE.Scene) {
    this.group.position.copy(PODIUM_AT);
    this.group.visible = false;
    const stepMat = new THREE.MeshStandardMaterial({ color: GLAZE, roughness: 0.3 }), trimMat = new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.25, metalness: 0.3 });
    for (const s of STEPS) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(1.6, s.h, 1.6), stepMat);
      block.position.set(s.x, s.h / 2, 0);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.08, 1.64), trimMat);
      trim.position.set(s.x, s.h - 0.04, 0);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 32, 20), new THREE.MeshStandardMaterial({ roughness: 0.35 }));
      ball.position.set(s.x, s.h + 0.45, 0);
      const div = document.createElement('div');
      div.className = 'podium-label';
      const label = new CSS2DObject(div);
      label.position.set(s.x, s.h + 1.25, 0);
      this.group.add(block, trim, ball, label);
      this.balls.push(ball);
      this.labels.push(label);
    }
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

  /** Shows the top 3 (fewer if fewer played) and throws the confetti. */
  show(top: readonly PodiumEntry[]): void {
    this.balls.forEach((b, i) => {
      const t = top[i];
      b.visible = !!t;
      this.labels[i].visible = !!t;
      if (!t) return;
      (b.material as THREE.MeshStandardMaterial).color.set(t.color);
      const el = this.labels[i].element;
      el.innerHTML = `<b>${i + 1}. ${t.name.replace(/[&<>"']/g, '')}</b><br>${t.points} pts`;
      el.style.borderColor = t.color;
    });
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
    this.labels.forEach((l, i) => { l.visible = on && this.balls[i].visible; });
  }

  hide(): void {
    if (!this.shown) return;
    this.group.visible = this.shown = false;
    for (const l of this.labels) l.visible = false;
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
    this.balls.forEach((b, i) => { b.position.y = STEPS[i].h + 0.45 + Math.abs(Math.sin(timeSec * 3 + i)) * 0.12; });
  }

  /** The camera looks at the podium from the front, slightly above. */
  place(camera: THREE.Camera): void {
    camera.position.set(PODIUM_AT.x, PODIUM_AT.y + 2.6, PODIUM_AT.z + 6.8);
    camera.lookAt(PODIUM_AT.x, PODIUM_AT.y + 1.2, PODIUM_AT.z);
  }
}
