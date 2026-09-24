import * as THREE from 'three';
import { loadLevel, type Level, type LevelJson } from '@kula/shared';

const files = import.meta.glob<LevelJson>('../../../../levels/*.json', { eager: true, import: 'default' });

export function findLevel(id: string): Level | null {
  const json = Object.values(files).find((j) => j.id === id);
  return json ? loadLevel(json) : null;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const edgeVerts = new THREE.EdgesGeometry(boxGeo).getAttribute('position').array;

/** One InstancedMesh for all blocks (checkerboard shading) plus one LineSegments for all edges. */
export function buildLevel(level: Level): THREE.Group {
  const group = new THREE.Group();
  const cells = [...level.solid].map((k) => k.split(',').map(Number));

  const mesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), cells.length);
  const m = new THREE.Matrix4();
  const light = new THREE.Color(0x9aa4c8), dark = new THREE.Color(0x7c86ab);
  cells.forEach(([x, y, z], i) => {
    mesh.setMatrixAt(i, m.makeTranslation(x, y, z));
    mesh.setColorAt(i, (x + y + z) & 1 ? dark : light);
  });
  group.add(mesh);

  const pos = new Float32Array(cells.length * edgeVerts.length);
  cells.forEach(([x, y, z], i) => {
    for (let j = 0; j < edgeVerts.length; j += 3) {
      const o = i * edgeVerts.length + j;
      pos[o] = edgeVerts[j] * 1.002 + x;
      pos[o + 1] = edgeVerts[j + 1] * 1.002 + y;
      pos[o + 2] = edgeVerts[j + 2] * 1.002 + z;
    }
  });
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2a2e44 })));
  return group;
}

export function levelBounds(level: Level) {
  const { min, max } = level;
  const center = new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  const radius = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) / 2 + 1;
  return { center, radius };
}
