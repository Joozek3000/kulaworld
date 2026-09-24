import * as THREE from 'three';
import { Client, Callbacks } from '@colyseus/sdk';
import { VERSION } from '@kula/shared';

const params = new URLSearchParams(location.search);
const name = params.get('name') ?? `P-${Math.floor(1000 + Math.random() * 9000)}`;
const serverUrl = params.get('server') ?? `ws://${location.hostname}:2567`;
const hud = document.getElementById('hud')!;

// Scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(2, 2, 3);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 2));
const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x44aa88 }));
scene.add(cube);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop((t) => {
  cube.rotation.set(t / 1000, t / 1500, 0);
  renderer.render(scene, camera);
});

// Network
try {
  const room = await new Client(serverUrl).joinOrCreate('race', { name });
  const cb = Callbacks.get(room);
  const update = () => { hud.textContent = `${name} · connected / ${room.state.players.size} players · v${VERSION}`; };
  cb.onAdd('players', update);
  cb.onRemove('players', update);
  room.onLeave(() => { hud.textContent = 'disconnected'; });
} catch (e) {
  hud.textContent = `connection failed: ${serverUrl}`;
  console.error(e);
}
