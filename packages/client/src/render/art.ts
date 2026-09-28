import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const BALL_MODELS = ['ball-orange-bands', 'ball-blue-panels', 'ball-jade-cross', 'ball-raspberry-caps'] as const;
const CERAMIC_MODELS = ['block-ivory', ...BALL_MODELS, 'key-marigold', 'exit-open', 'exit-locked'] as const;
export const BLOCK_MODELS = ['tile-celadon', 'tile-limestone', 'tile-basalt', 'tile-terracotta', 'block-ice', 'block-fire', 'block-crumble'] as const;
const ENVIRONMENT_MODELS = [...BLOCK_MODELS, 'block-crumble-fragments', 'trap-spikes-raised', 'trap-spikes-retracted', 'tile-arrow', 'pad-boost-far', 'pad-boost-high'] as const;
export const MODEL_NAMES = [...CERAMIC_MODELS, ...ENVIRONMENT_MODELS] as const;
export type ModelName = typeof MODEL_NAMES[number];
export const ENVIRONMENTS = [
  { id: 'peach-dawn', tile: 'tile-celadon', fog: 0xdac6bd, key: 0xffe0be, fill: 0xb7d6ee, rim: 0xffd6bd, ground: 0x757185, exposure: 1.0 },
  { id: 'teal-moon', tile: 'tile-basalt', fog: 0x475f77, key: 0xb9dfed, fill: 0xabc8cd, rim: 0x77d9c8, ground: 0x566779, exposure: 1.1 },
  { id: 'amber-afterglow', tile: 'tile-terracotta', fog: 0xc9978e, key: 0xffd0a0, fill: 0xb4beea, rim: 0xffab78, ground: 0x766078, exposure: 1.0 },
] as const;

/** Presentation only: numbered maps cycle through the three looks; no level/sim metadata changes. */
export function environmentFor(id = '') {
  const number = Number(id.match(/-(\d+)$/)?.[1] ?? 1);
  return ENVIRONMENTS[id.includes('cube') ? 1 : (Math.max(1, number) - 1) % ENVIRONMENTS.length];
}

export const art: {
  models: Partial<Record<ModelName, THREE.Group>>;
  block?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  blocks: Partial<Record<ModelName, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]>>;
  skies: Partial<Record<string, THREE.Texture>>;
  sky?: THREE.Texture;
} = { models: {}, blocks: {}, skies: {} };

/** Load once before joining. Failed assets retain the primitive/gradient fallback. */
export async function loadArt(): Promise<void> {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL;
  await Promise.all([
    ...MODEL_NAMES.map(async (name) => {
      try {
        const kit = (CERAMIC_MODELS as readonly string[]).includes(name) ? 'ceramic-kit-v01' : 'environment-kit-v02';
        art.models[name] = (await loader.loadAsync(`${base}models/${kit}/${name}.glb`)).scene;
      } catch (error) { console.warn(`Art fallback: ${name}`, error); }
    }),
    (async () => {
      try {
        art.sky = await new THREE.TextureLoader().loadAsync(`${base}sky/lavender-clouds.jpg`);
        art.sky.colorSpace = THREE.SRGBColorSpace;
        art.sky.mapping = THREE.EquirectangularReflectionMapping;
      } catch (error) { console.warn('Art fallback: lavender sky', error); }
    })(),
    ...ENVIRONMENTS.map(async ({ id }) => {
      try {
        const texture = await new THREE.TextureLoader().loadAsync(`${base}sky/${id}.jpg`);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.mapping = THREE.EquirectangularReflectionMapping;
        art.skies[id] = texture;
      } catch (error) { console.warn(`Art fallback: ${id}`, error); }
    }),
  ]);
  const block = art.models['block-ivory'];
  block?.updateMatrixWorld(true);
  block?.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const material = (object.material as THREE.MeshStandardMaterial).clone();
      material.color.set(0xffffff); // Cell instance colours supply the glaze tint.
      art.block = new THREE.Mesh(object.geometry.clone().applyMatrix4(object.matrixWorld), material);
    }
  });
  // Bake node transforms once, then batch every block of a material in LevelView.
  for (const name of BLOCK_MODELS) {
    const model = art.models[name];
    if (!model) continue;
    model.updateMatrixWorld(true);
    const parts = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshStandardMaterial;
      const geometries = parts.get(material) ?? [];
      geometries.push(object.geometry.clone().applyMatrix4(object.matrixWorld));
      parts.set(material, geometries);
    });
    art.blocks[name] = [...parts].map(([material, geometries]) => {
      const geometry = mergeGeometries(geometries)!;
      for (const source of geometries) source.dispose();
      return new THREE.Mesh(geometry, material);
    });
  }
}
