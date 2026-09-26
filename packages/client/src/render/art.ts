import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const BALL_MODELS = ['ball-orange-bands', 'ball-blue-panels', 'ball-jade-cross', 'ball-raspberry-caps'] as const;
export const MODEL_NAMES = ['block-ivory', ...BALL_MODELS, 'key-marigold', 'exit-open', 'exit-locked'] as const;
export const art: {
  models: Partial<Record<typeof MODEL_NAMES[number], THREE.Group>>;
  block?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  sky?: THREE.Texture;
} = { models: {} };

/** Load once before joining. Failed assets retain the primitive/gradient fallback. */
export async function loadArt(): Promise<void> {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL;
  await Promise.all([
    ...MODEL_NAMES.map(async (name) => {
      try {
        art.models[name] = (await loader.loadAsync(`${base}models/ceramic-kit-v01/${name}.glb`)).scene;
      } catch (error) { console.warn(`Art fallback: ${name}`, error); }
    }),
    (async () => {
      try {
        art.sky = await new THREE.TextureLoader().loadAsync(`${base}sky/lavender-clouds.jpg`);
        art.sky.colorSpace = THREE.SRGBColorSpace;
        art.sky.mapping = THREE.EquirectangularReflectionMapping;
      } catch (error) { console.warn('Art fallback: lavender sky', error); }
    })(),
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
}
