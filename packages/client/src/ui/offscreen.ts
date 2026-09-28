import * as THREE from 'three';

/** Off-screen indicators (phase 17, multiplayer): an arrow at the screen edge towards each nearby enemy out of view. */
const RANGE = 8; // cells from your ball
const MARGIN = 28; // px from the screen edge
const v = new THREE.Vector3();

export function createOffscreen() {
  const root = document.createElement('div');
  root.id = 'offscreen';
  document.body.appendChild(root);
  const arrows = new Map<string, HTMLDivElement>();
  const used = new Set<string>();
  let camera: THREE.Camera, me: THREE.Vector3 | null = null;

  /** One ball: shows (or hides) its arrow. Call between begin() and end(). */
  const ball = (id: string, at: THREE.Vector3, color: string, local: boolean, crowned = false) => {
    if (local || !me) return;
    const d = at.distanceTo(me);
    if (d > RANGE) return;
    v.copy(at).project(camera);
    const behind = v.z > 1;
    if (!behind && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) return; // on screen
    if (behind) v.multiplyScalar(-1);
    // Push the direction out to the screen edge.
    const w = innerWidth / 2 - MARGIN, h = innerHeight / 2 - MARGIN, s = 1 / Math.max(Math.abs(v.x), Math.abs(v.y), 1e-6);
    const x = w + v.x * s * w, y = h - v.y * s * h;
    let el = arrows.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'offscreen-arrow';
      root.appendChild(el);
      arrows.set(id, el);
    }
    el.style.color = color;
    el.classList.toggle('crowned', crowned); // phase 18: the leader's arrow wears a crown
    el.style.opacity = String(1 - (d / RANGE) * 0.7);
    el.style.transform = `translate(${x + MARGIN}px, ${y + MARGIN}px) rotate(${Math.atan2(-v.y, v.x)}rad)`;
    el.hidden = false;
    used.add(id);
  };

  return {
    ball,
    /** Start a frame: `local` is your ball's position (null: no arrows). */
    begin(cam: THREE.Camera, local: THREE.Vector3 | null) { camera = cam; me = local; used.clear(); },
    end() { for (const [id, el] of arrows) if (!used.has(id)) el.hidden = true; },
  };
}
