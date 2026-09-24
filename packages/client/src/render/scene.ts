import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

const BG = 0x1a1d2b;

export function createScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  document.body.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 18, 50);

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
    render() {
      renderer.render(scene, camera);
      labels.render(scene, camera);
    },
  };
}
