import * as THREE from 'three';
import type { Level } from '@kula/shared';
import { setupInput } from './input.ts';
import { connect, serverUrl, type Net } from './net.ts';
import { CameraRig, type CameraMode } from './render/camera.ts';
import { ItemsView } from './render/items.ts';
import { findLevel, levelBounds, LevelView } from './render/level.ts';
import { PlayersView } from './render/players.ts';
import { Fx } from './render/fx.ts';
import { createScene } from './render/scene.ts';
import { createDebug } from './ui/debug.ts';
import { createHud } from './ui/hud.ts';
import { createSfx } from './ui/sfx.ts';

/** Render this many ticks behind the estimated server tick, so the current action has always arrived. */
const INTERP_TICKS = 2;
/** The local ball may render closer to the server (less input delay). Overridable with ?localInterp= for experiments. */
const LOCAL_INTERP_TICKS = Number(new URLSearchParams(location.search).get('localInterp') ?? 1);
const ACTIVE = new Set(['countdown', 'playing', 'results']);

const view = createScene();
const hud = createHud();
const debug = createDebug();
const players = new PlayersView(view.scene);
const items = new ItemsView(view.scene);
const rig = new CameraRig(view.camera);
const fx = new Fx(view.scene);
const sfx = createSfx();
players.onLocalMotion = debug.motion;
players.onVanish = (at, color) => { fx.vanish(at, color, performance.now() / 1000); sfx.death(); };

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
  onMute: () => sfx.toggleMute(),
});

const nameOf = (id: string) => (id === net.sessionId ? 'You' : net.state.players.get(id)?.name ?? '?');
const colorOf = (id: string) => net.state.players.get(id)?.color ?? '#fff';
net.onEvent((e) => {
  switch (e.type) {
    case 'key':
      hud.toast(`${nameOf(e.playerId)} got a key (${e.keys}/${level?.keysRequired ?? '?'})`, colorOf(e.playerId));
      sfx.key(e.playerId === net.sessionId);
      break;
    case 'win': sfx.win(e.winnerId === net.sessionId); break;
    case 'push': sfx.thump(); break;
    case 'bounce': sfx.buzz(); break;
    case 'knockout': hud.toast(`${nameOf(e.pusherId)} knocked ${nameOf(e.victimId)} off!`, colorOf(e.pusherId)); break;
    case 'keyDrop': hud.toast(`${nameOf(e.playerId)} dropped a key`, colorOf(e.playerId)); break;
    case 'eliminated':
      hud.toast(e.byId ? `${nameOf(e.byId)} knocked ${nameOf(e.playerId)} out!` : `${nameOf(e.playerId)} ${e.playerId === net.sessionId ? 'are' : 'is'} out`, colorOf(e.playerId));
      sfx.eliminated(e.playerId === net.sessionId);
      break;
    case 'crumbleWarn': sfx.crumbleWarn(); break;
  }
});

if (import.meta.env.DEV) Object.assign(window, { kula: { net, players } }); // console/automation access

let level: Level | null = null;
let levelView: LevelView | null = null;
let bounds = { center: new THREE.Vector3(), radius: 5 };
let last = performance.now();
let lastPhase = '';
let lastCount = -1;

view.renderer.setAnimationLoop((now: number) => {
  const dtMs = Math.min(now - last, 100);
  last = now;
  if (frozen) return;
  net.update(now, dtMs);
  const s = net.state;
  const me = net.sessionId;

  if (s.levelId && level?.id !== s.levelId) {
    level = findLevel(s.levelId);
    if (levelView) view.scene.remove(levelView.group);
    levelView = level ? new LevelView(level) : null;
    players.setSolid(levelView?.solid ?? null);
    if (level && levelView) { view.scene.add(levelView.group); bounds = levelBounds(level); }
  }

  const renderTick = net.estServerTick - INTERP_TICKS;
  const active = ACTIVE.has(s.phase);
  players.update(s, renderTick, me, net.estServerTick - LOCAL_INTERP_TICKS);
  const mine = s.players.get(me);
  items.update(s, active, !!level && !!mine && mine.keys >= level.keysRequired, now / 1000);

  levelView?.update(active ? s.crumbled : 0, active ? s.warnBand : -1, now / 1000);

  // Knocked out of a knockout round: follow whoever did it while they're on screen, otherwise orbit.
  const out = !!mine?.eliminated && active;
  const pose = players.poseOf(out ? mine!.eliminatedBy : me);
  const mode: CameraMode = !active || !mine || mine.spectating || (out && !pose) ? 'orbit' : pose ? 'follow' : 'hold';
  rig.update(dtMs / 1000, mode, pose, bounds.center, bounds.radius);

  // Countdown beeps: one per second, a higher one when play starts.
  const count = Math.ceil((s.phaseEndTick - s.tick) / 20);
  if (s.phase === 'countdown' && count !== lastCount && count > 0) sfx.tick();
  if (s.phase === 'playing' && lastPhase === 'countdown') sfx.go();
  lastCount = count;
  lastPhase = s.phase;

  players.highlight(s.phase === 'results' ? s.winnerId : '', now / 1000);
  fx.update(now / 1000);
  hud.update(s, me, level, sfx.muted);
  view.render();
  debug.update(now, net, renderTick, view.renderer.info.render.calls, players.localAction(me), players.localLate(me), LOCAL_INTERP_TICKS);

  if (screenshot) {
    screenshot = false;
    const a = document.createElement('a');
    a.href = view.renderer.domElement.toDataURL('image/png'); // same frame as render, so the buffer is intact
    a.download = `kula-${s.phase}-${Date.now()}.png`;
    a.click();
  }
});
