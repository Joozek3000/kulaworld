import * as THREE from 'three';
import type { Level } from '@kula/shared';
import { setupInput } from './input.ts';
import { connect, serverUrl, type Net } from './net.ts';
import { CameraRig, type CameraMode } from './render/camera.ts';
import { ItemsView } from './render/items.ts';
import { buildLevel, findLevel, levelBounds } from './render/level.ts';
import { PlayersView } from './render/players.ts';
import { createScene } from './render/scene.ts';
import { createDebug } from './ui/debug.ts';
import { createHud } from './ui/hud.ts';

/** Render this many ticks behind the estimated server tick, so the current action has always arrived. */
const INTERP_TICKS = 2;
const ACTIVE = new Set(['countdown', 'playing', 'results']);

const view = createScene();
const hud = createHud();
const debug = createDebug();
const players = new PlayersView(view.scene);
const items = new ItemsView(view.scene);
const rig = new CameraRig(view.camera);
players.onLocalMotion = debug.motion;

let net: Net;
try {
  net = await connect();
} catch (e) {
  hud.error(`connection failed: ${serverUrl}`);
  throw e;
}
net.room.onLeave(() => hud.error('disconnected'));

let screenshot = false;
let frozen = false;
setupInput(net, {
  onPress: debug.press,
  onDebug: debug.toggle,
  onScreenshot: () => { screenshot = true; },
  onFreeze: () => { frozen = !frozen; },
});

if (import.meta.env.DEV) Object.assign(window, { kula: { net, players } }); // console/automation access

let level: Level | null = null;
let levelGroup: THREE.Group | null = null;
let bounds = { center: new THREE.Vector3(), radius: 5 };
let last = performance.now();

view.renderer.setAnimationLoop((now: number) => {
  const dtMs = Math.min(now - last, 100);
  last = now;
  if (frozen) return;
  net.update(now, dtMs);
  const s = net.state;
  const me = net.sessionId;

  if (s.levelId && level?.id !== s.levelId) {
    level = findLevel(s.levelId);
    if (levelGroup) view.scene.remove(levelGroup);
    levelGroup = level ? buildLevel(level) : null;
    if (level && levelGroup) { view.scene.add(levelGroup); bounds = levelBounds(level); }
  }

  const renderTick = net.estServerTick - INTERP_TICKS;
  const active = ACTIVE.has(s.phase);
  players.update(s, renderTick, me);
  const mine = s.players.get(me);
  items.update(s, active, !!level && !!mine && mine.keys >= level.keysRequired, now / 1000);

  const pose = players.localPose(me);
  const mode: CameraMode = !active || !mine || mine.spectating ? 'orbit' : pose ? 'follow' : 'hold';
  rig.update(dtMs / 1000, mode, pose, bounds.center, bounds.radius);

  hud.update(s, me);
  view.render();
  debug.update(now, net, renderTick, view.renderer.info.render.calls, players.localAction(me));

  if (screenshot) {
    screenshot = false;
    const a = document.createElement('a');
    a.href = view.renderer.domElement.toDataURL('image/png'); // same frame as render, so the buffer is intact
    a.download = `kula-${s.phase}-${Date.now()}.png`;
    a.click();
  }
});
