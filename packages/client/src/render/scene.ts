import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { art, environmentFor } from './art.ts';

const DEFAULT_SKY: [string, string] = ['#1a1d2b', '#1a1d2b'];
/** Fog (phase 17): nothing fades within this many cells of the camera; fading then takes FOG_DEPTH cells. */
const FOG_NEAR = 14, FOG_DEPTH = 40;
const studioMaps = new WeakMap<THREE.WebGLRenderer, THREE.WebGLRenderTarget>();
const KEY_DIRECTION = new THREE.Vector3(-8, 12, 8).normalize();

/** Fit the shadow to the displayed level, including distant fly-overs and every camera/gravity orientation. */
export function fitKeyShadow(key: THREE.DirectionalLight, camera: THREE.Camera, center: THREE.Vector3, radius: number): void {
  const extent = Math.max(6, radius * 1.8);
  camera.updateWorldMatrix(true, false);
  camera.worldToLocal(key.target.position.copy(center));
  key.position.copy(key.target.position).addScaledVector(KEY_DIRECTION, extent * 2);
  Object.assign(key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 0.1, far: extent * 6 });
  key.shadow.camera.updateProjectionMatrix();
}

/** Shared by gameplay and lobby cards. Camera fill keeps every gravity face readable. */
export function createEnvironment(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
  // Keep the readable palette, but give the glaze broad HDR highlights instead of reflecting the flat JPEG sky.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  let studio = studioMaps.get(renderer);
  if (!studio) {
    const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
    studio = pmrem.fromScene(room, 0.04);
    studioMaps.set(renderer, studio);
    room.dispose();
    pmrem.dispose();
  }
  const fill = new THREE.HemisphereLight(0xffffff, 0x777777, 0.4);
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(-8, 12, 8);
  rim.position.set(-4, 1, -3);
  key.target.position.set(0, 0, -4);
  rim.target.position.set(0, 0, -4);
  camera.add(key, rim, key.target, rim.target);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 0.5, far: 80 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.normalBias = 0.018;
  key.shadow.bias = -0.00008;
  key.shadow.radius = 3;
  key.shadow.intensity = 0.8;
  scene.add(fill);
  const set = (id?: string) => {
    const theme = environmentFor(id);
    const texture = art.skies[theme.id] ?? art.sky;
    scene.background = texture ?? new THREE.Color(theme.fog);
    scene.environment = studio.texture;
    scene.environmentIntensity = 0.45;
    renderer.toneMappingExposure = theme.exposure;
    fill.color.set(theme.fill);
    fill.groundColor.set(theme.ground);
    key.color.set(theme.key);
    rim.color.set(theme.rim);
    return { theme, texture };
  };
  return { set, fit: (center: THREE.Vector3, radius: number) => fitKeyShadow(key, camera, center, radius), dispose: () => key.shadow.dispose() };
}

/** Vertical two-colour gradient on an inverted sphere that rides with the camera (world +Y is "top"). */
function createSky() {
  const uniforms = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying float h;
      void main() { h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying float h;
      void main() {
        gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.8, 0.8, h)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

export function createScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true }); // stencil: the silhouette's block mark (19b)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  document.body.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const sky = createSky();
  scene.add(sky.mesh);
  // Fog only fades structure well beyond the level (phase 17): fitFog moves it out with the camera distance.
  const fog = new THREE.Fog(0, FOG_NEAR, FOG_NEAR + FOG_DEPTH);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  scene.add(camera);
  const environment = createEnvironment(scene, camera, renderer);

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    labels.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  return {
    renderer, scene, camera,
    /** Per-map panorama and lighting; gradients remain the missing-asset fallback. */
    setSky([top, bottom]: [string, string] = DEFAULT_SKY, levelId?: string) {
      const { theme, texture } = environment.set(levelId);
      sky.mesh.visible = !texture;
      sky.uniforms.top.value.set(top);
      sky.uniforms.bottom.value.set(bottom);
      fog.color.copy(sky.uniforms.bottom.value).lerp(sky.uniforms.top.value, 0.35);
      if (texture) fog.color.set(theme.fog);
    },
    /**
     * Keeps everything within FOG_NEAR cells of the camera crisp, and from afar (the overview) the level's near side:
     * the fog starts there and fades over FOG_DEPTH (or the level's size, if bigger). Per frame, no allocations.
     */
    fitFog(center: THREE.Vector3, radius: number) {
      environment.fit(center, radius);
      fog.near = Math.max(FOG_NEAR, camera.position.distanceTo(center) - radius);
      fog.far = fog.near + Math.max(FOG_DEPTH, radius * 2);
    },
    render() {
      sky.mesh.position.copy(camera.position);
      renderer.render(scene, camera);
      labels.render(scene, camera);
    },
  };
}
