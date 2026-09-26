import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { art } from './art.ts';

const DEFAULT_SKY: [string, string] = ['#1a1d2b', '#1a1d2b'];

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
  if (art.sky) {
    sky.mesh.visible = false;
    scene.background = art.sky;
    scene.environment = art.sky;
    scene.environmentIntensity = 0.35;
  }
  const fog = new THREE.Fog(0, 18, 50);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x3a3a4a, 1.4));
  // Key light rides with the camera: with gravity on any face there is no fixed "sky".
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 4, 1);
  camera.add(key);

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
    /** Ceramic panorama overrides per-level gradients, which remain the missing-asset fallback. */
    setSky([top, bottom]: [string, string] = DEFAULT_SKY) {
      sky.uniforms.top.value.set(top);
      sky.uniforms.bottom.value.set(bottom);
      fog.color.copy(sky.uniforms.bottom.value).lerp(sky.uniforms.top.value, 0.35);
      if (art.sky) fog.color.set(0xc8b5d6);
    },
    render() {
      sky.mesh.position.copy(camera.position);
      renderer.render(scene, camera);
      labels.render(scene, camera);
    },
  };
}
