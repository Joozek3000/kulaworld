import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { art, environmentFor } from './art.ts';

const DEFAULT_SKY: [string, string] = ['#1a1d2b', '#1a1d2b'];

/** Shared by gameplay and lobby cards. Camera fill keeps every gravity face readable. */
export function createEnvironment(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
  renderer.toneMapping = THREE.AgXToneMapping;
  const fill = new THREE.HemisphereLight(0xffffff, 0x777777, 1.6);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2, 4, 1);
  rim.position.set(-4, 1, -3);
  key.target.position.set(0, 0, -4);
  rim.target.position.set(0, 0, -4);
  camera.add(key, rim, key.target, rim.target);
  scene.add(fill);
  return (id?: string) => {
    const theme = environmentFor(id);
    const texture = art.skies[theme.id] ?? art.sky;
    scene.background = texture ?? new THREE.Color(theme.fog);
    scene.environment = texture ?? null;
    scene.environmentIntensity = 0.4;
    renderer.toneMappingExposure = theme.exposure;
    fill.color.set(theme.fill);
    fill.groundColor.set(theme.ground);
    key.color.set(theme.key);
    rim.color.set(theme.rim);
    return { theme, texture };
  };
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
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  document.body.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const sky = createSky();
  scene.add(sky.mesh);
  const fog = new THREE.Fog(0, 18, 50);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  scene.add(camera);
  const setEnvironment = createEnvironment(scene, camera, renderer);

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
      const { theme, texture } = setEnvironment(levelId);
      sky.mesh.visible = !texture;
      sky.uniforms.top.value.set(top);
      sky.uniforms.bottom.value.set(bottom);
      fog.color.copy(sky.uniforms.bottom.value).lerp(sky.uniforms.top.value, 0.35);
      if (texture) fog.color.set(theme.fog);
    },
    render() {
      sky.mesh.position.copy(camera.position);
      renderer.render(scene, camera);
      labels.render(scene, camera);
    },
  };
}
