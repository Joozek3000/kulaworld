import * as THREE from 'three';
import { Action, type InputMsg, type Level } from '@kula/shared';
import { setupInput } from './input.ts';
import { connect, serverUrl, type Net } from './net.ts';
import { CameraRig, type CameraMode } from './render/camera.ts';
import { ItemsView } from './render/items.ts';
import { findLevel, levelBounds, LevelView } from './render/level.ts';
import { PlayersView } from './render/players.ts';
import { TrapsView } from './render/traps.ts';
import { Fx } from './render/fx.ts';
import { createScene } from './render/scene.ts';
import { levelPreview } from './render/preview.ts';
import { createDebug } from './ui/debug.ts';
import { createHud } from './ui/hud.ts';
import { createTuningPanel } from './ui/tuning.ts';
import { AudioEngine } from './audio/engine.ts';
import { latency } from './ui/latency.ts';
import { LocalPrediction } from './predict/local.ts';
import { loadArt } from './render/art.ts';

/** Render this many ticks behind the estimated server tick, so the current action has always arrived. */
const INTERP_TICKS = 2;
/** The local ball may render closer to the server (less input delay). Overridable with ?localInterp= for experiments. */
const LOCAL_INTERP_TICKS = Number(new URLSearchParams(location.search).get('localInterp') ?? 1);
const ACTIVE = new Set(['countdown', 'playing', 'results']);
/** Forward held but nothing started for this long = blocked by a wall (or an unpushable player): a bump. */
const BUMP_AFTER_MS = 150;
const BUMP_EVERY_MS = 300;

let net: Net;
const hud = createHud({ onVote: (i) => net?.sendVote(i), preview: levelPreview, findLevel });
await loadArt();
const view = createScene();
view.setSky();
const debug = createDebug();
const players = new PlayersView(view.scene);
const items = new ItemsView(view.scene);
const rig = new CameraRig(view.camera);
const fx = new Fx(view.scene);
const audio = new AudioEngine();
const tuningPanel = import.meta.env.DEV ? createTuningPanel(audio) : null;
players.onLocalMotion = debug.motion;
players.onVanish = (at, color) => fx.vanish(at, color, performance.now() / 1000);
// Ball sounds come from what's on screen (render time), not from when a patch or event arrives.
players.onFeel = (e) => {
  const at = e.local ? null : e.at; // the local ball isn't spatialised
  switch (e.kind) {
    case 'takeoff': audio.play('takeoff', { at }); break;
    case 'land': audio.play('bounce', { at, intensity: e.intensity }); break;
    case 'roll': audio.play('roll', { at }); break;
    case 'flip': audio.play('squeak', { at }); break;
    case 'climb': audio.play('squeak', { at, gain: 0.8 }); break; // rubber into the corner (phase 11)
    case 'fall': audio.play('fall', { at }); break;
    case 'hit': audio.play('hit', { at, intensity: e.intensity, gain: e.victimLocal ? 1.5 : 1 }); break;
    case 'boing': audio.play('boing', { at }); break;
    case 'stomp': audio.play('stomp', { at, intensity: e.intensity, gain: e.victimLocal ? 1.5 : 1 }); break;
    case 'clash': audio.play('boing', { at, gain: 1.2 }); break;
    case 'pop': audio.play('pop', { at }); break;
    case 'clack': audio.play('clack', { at, intensity: e.intensity }); break;
    case 'slide': audio.play('slide', { at }); break;
    case 'launch': audio.play('pwomp', { at }); if (e.local) rig.kick(); break;
    case 'charge': audio.play('hum', { at }); break; // held on a boost pad (phase 14c)
    case 'whoosh': audio.play('whoosh', { at }); break;
    case 'edge': audio.play('edge', { gain: 0.7 }); break; // an enemy just around your edge (phase 13a)
  }
};

try {
  net = await connect();
} catch (e) {
  hud.error(`connection failed: ${serverUrl}`);
  throw e;
}
net.room.onLeave(() => hud.error('disconnected'));
const predict = new LocalPrediction(net, findLevel);
net.stamp = (i) => {
  const msg: InputMsg = predict.enabled ? predict.stamp(i) : i;
  latency.sent(performance.now(), msg.tick === undefined ? undefined : predict.lastStampAheadMs);
  return msg;
};
predict.onLocalStart = (at) => latency.predStart(at);
// Without prediction, (c) is when the server's action for the press shows up in a patch.
let lastServerStart = '';
net.onPatch(() => {
  const p = net.state.players.get(net.sessionId);
  const sig = p ? `${p.action}:${p.startTick}` : '';
  if (sig !== lastServerStart) { lastServerStart = sig; if (p && p.action !== Action.Idle && !predict.predicting) latency.predStart(performance.now()); }
});

let screenshot = false;
let frozen = false;
const input = setupInput(net, {
  onPress: debug.press,
  onDebug: debug.toggle,
  onScreenshot: () => { screenshot = true; },
  onFreeze: () => { frozen = !frozen; },
  onMute: () => audio.toggleMute(),
  onVolume: (d) => { audio.setVolume(audio.volume + d); hud.toast(`Volume ${Math.round(audio.volume * 100)}%`, '#fff'); },
  onTuning: () => tuningPanel?.toggle(),
  onKey: (key, at) => {
    const p = net.state.players.get(net.sessionId);
    latency.press(key, at, !!p && p.action === Action.Idle && players.localAction(net.sessionId) === Action.Idle, predict.predicting);
  },
});

/** F3: the last few measured presses, ms after keydown (sent / stamp ahead / predicted start / visible). */
const latencyLines = () => ['press→ (ms)   key  mode    sent  stamp  start  visible',
  ...latency.rows.slice(-4).map((r) => `              ${latency.summary(r).map((c) => c.padStart(5)).join(' ')}`)];

const nameOf = (id: string) => (id === net.sessionId ? 'You' : net.state.players.get(id)?.name ?? '?');
const colorOf = (id: string) => net.state.players.get(id)?.color ?? '#fff';
/** Death toasts by cause (§18). Falls from a push already get the knockout toast. */
const DEATH_TOAST: Partial<Record<string, (who: string) => string>> = {
  spikes: (who) => `${who} got spiked`,
  fire: (who) => `${who} popped on fire`,
  fall: (who) => `${who} fell off`,
};
/** Fall toasts wait a moment: a `knockout` event right after the death replaces them with its own toast. */
const pendingFall = new Map<string, ReturnType<typeof setTimeout>>();
net.onEvent((e) => {
  switch (e.type) {
    case 'knockout': clearTimeout(pendingFall.get(e.victimId)); pendingFall.delete(e.victimId); break;
    case 'death': {
      const toast = DEATH_TOAST[e.cause];
      if (!toast) break;
      const show = () => { pendingFall.delete(e.playerId); hud.toast(toast(nameOf(e.playerId)), colorOf(e.playerId)); };
      if (e.cause === 'fall') pendingFall.set(e.playerId, setTimeout(show, 150));
      else show();
      break;
    }
  }
  switch (e.type) {
    case 'key':
      hud.toast(`${nameOf(e.playerId)} got a key (${e.keys}/${level?.keysRequired ?? '?'})`, colorOf(e.playerId));
      audio.play('key', { mine: e.playerId === net.sessionId }, 'ui');
      break;
    case 'win': audio.play(e.winnerId === net.sessionId ? 'win' : 'lose', {}, 'ui'); break;
    case 'stomp': hud.toast(`${nameOf(e.attackerId)} stomped ${nameOf(e.victimId)}!`, colorOf(e.attackerId)); break;
    case 'knockout': hud.toast(`${nameOf(e.pusherId)} knocked ${nameOf(e.victimId)} off!`, colorOf(e.pusherId)); break;
    case 'keyDrop': hud.toast(`${nameOf(e.playerId)} dropped a key`, colorOf(e.playerId)); break;
    case 'eliminated':
      hud.toast(e.byId ? `${nameOf(e.byId)} knocked ${nameOf(e.playerId)} out!` : `${nameOf(e.playerId)} ${e.playerId === net.sessionId ? 'are' : 'is'} out`, colorOf(e.playerId));
      audio.play('eliminated', { mine: e.playerId === net.sessionId }, 'ui');
      break;
    case 'crumbleWarn': audio.play('crumbleWarn', {}, 'ui'); break;
    case 'crumble': audio.play('crumble', {}, 'ui'); break;
    case 'burn': {
      const at = players.ballAt(e.playerId);
      if (at) fx.puff(at, performance.now() / 1000);
      hud.toast(`${nameOf(e.playerId)} ${e.playerId === net.sessionId ? 'were' : 'was'} too slow: burnt!`, colorOf(e.playerId));
      break;
    }
  }
});

if (import.meta.env.DEV) Object.assign(window, { kula: { net, players, audio, input, predict, debug, latency } }); // console/automation access

let level: Level | null = null;
let levelView: LevelView | null = null;
let trapsView: TrapsView | null = null;
let bounds = { center: new THREE.Vector3(), radius: 5 };
let last = performance.now();
let lastPhase = '';
let lastCount = -1;
let wasUnlocked = false;
let lastLocalPose = '';
const nextSizzle = new Map<string, number>();
let blockedSince = 0, lastBump = 0;
const FADE_MS = 150;
const fade = document.createElement('div');
fade.style.cssText = `position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity ${FADE_MS}ms`;
view.renderer.domElement.after(fade); // over the scene, under the labels and the HUD
let fadeUntil = 0;
/** The level to show: the round's, or in the lobby the candidate with the most votes (the first one on a tie or none). */
function backdropId(s: typeof net.state): string {
  const c = s.candidates;
  if (s.phase !== 'lobby' || !c?.length) return s.levelId;
  let best = 0;
  for (let i = 1; i < c.length; i++) if ((s.voteCounts?.[i] ?? 0) > (s.voteCounts?.[best] ?? 0)) best = i;
  return c[best];
}

view.renderer.setAnimationLoop((now: number) => {
  const dtMs = Math.min(now - last, 100);
  last = now;
  if (frozen) return;
  const s = net.state;
  if (!s.players || !s.items) return; // The first server snapshot can arrive after join resolves.
  net.update(now, dtMs);
  const me = net.sessionId;

  // Lobby backdrop (phase 14b): the scene shows the leading vote candidate, with a quick fade between levels.
  const want = backdropId(s);
  if (want && level?.id === want && fadeUntil) { fadeUntil = 0; fade.style.opacity = '0'; } // the lead went back
  else if (want && level && level.id !== want && !fadeUntil) { fadeUntil = now + FADE_MS; fade.style.opacity = '1'; }
  if (want && level?.id !== want && (!level || now >= fadeUntil)) {
    if (fadeUntil) { fadeUntil = 0; fade.style.opacity = '0'; }
    level = findLevel(want);
    if (levelView) { view.scene.remove(levelView.group); levelView.dispose(); }
    if (trapsView) { view.scene.remove(trapsView.group); trapsView.dispose(); }
    levelView = level ? new LevelView(level) : null;
    trapsView = level ? new TrapsView(level) : null;
    if (trapsView) view.scene.add(trapsView.group);
    players.setLevel(level);
    players.setSolid(levelView?.solid ?? null);
    players.heat = level?.heat ?? null;
    rig.setSolid(levelView?.solid ?? null);
    if (level && levelView) { view.scene.add(levelView.group); bounds = levelBounds(level); }
    view.setSky(level?.sky ?? undefined);
  }

  const renderTick = net.estServerTick - INTERP_TICKS;
  const active = ACTIVE.has(s.phase);
  // Prediction (§17): the local ball runs on its predicted timeline at predTick; otherwise it trails the server.
  predict.update(dtMs);
  const predicting = predict.predicting && !!s.players.get(me);
  const localTick = predicting ? predict.renderTick : net.estServerTick - LOCAL_INTERP_TICKS;
  players.update(s, renderTick, me, localTick, dtMs / 1000, now, predicting ? predict.localPlayer(s.players.get(me)!) : null, predict.takeCorrection());
  // Latency audit (d): the first frame whose local ball differs from the last frame's (> 0.01 in position/rotation).
  const lp = players.poseOf(me);
  if (lp) {
    const sig = [...lp.position, ...lp.quat, lp.spin].map((v) => Math.round(v * 100)).join(',');
    if (lastLocalPose && sig !== lastLocalPose) latency.visible(now);
    lastLocalPose = sig;
  } else lastLocalPose = '';
  const mine = s.players.get(me);
  const unlocked = !!level?.exit && !!mine && mine.keys >= level.keysRequired;
  items.update(s, active, unlocked, now / 1000);
  if (unlocked && !wasUnlocked && s.phase === 'playing') audio.play('exit', {}, 'ui');
  wasUnlocked = unlocked;

  levelView?.update(active ? s.crumbled : 0, active ? s.warnBand : -1, now / 1000);
  // Trap tiles (§18): spikes follow the render tick; crumble tiles the server tick (they vanish on its schedule).
  const noCrumbling = { get: () => undefined };
  const crumbling = active && s.crumbling ? s.crumbling : noCrumbling;
  levelView?.updateTraps(crumbling, s.tick, now / 1000);
  trapsView?.update(renderTick, s.tick, crumbling, players.rollingOnto(), dtMs / 1000, now / 1000, players.chargingOn());

  // Knocked out of a knockout round: follow whoever did it while they're on screen, otherwise orbit.
  const out = !!mine?.eliminated && active;
  const pose = players.poseOf(out ? mine!.eliminatedBy : me);
  const mode: CameraMode = !active || !mine || mine.spectating || (out && !pose) ? 'orbit' : pose ? 'follow' : 'hold';
  rig.update(dtMs / 1000, mode, pose, bounds.center, bounds.radius);

  audio.setListener(view.camera);
  // Hot tiles sizzle, faster and louder as they heat (phase 12).
  for (const h of players.hotBalls()) {
    if (now < (nextSizzle.get(h.id) ?? 0)) continue;
    nextSizzle.set(h.id, now + 320 - 200 * h.level);
    audio.play('sizzle', { at: h.local ? null : h.at, intensity: h.level });
  }
  const rolls = players.rolling();
  for (const r of rolls) audio.roll(r.id, r.speed, r.at, r.local);
  audio.endRolls(new Set(rolls.map((r) => r.id)));

  // Bump: forward held while Idle (server and screen) for a moment: an unpushable player in the way (walls are
  // climbed since phase 11, so this no longer fires for them).
  const blocked = s.phase === 'playing' && input.fwdHeld && mine?.action === Action.Idle && players.localAction(me) === Action.Idle;
  if (!blocked) blockedSince = 0;
  else if (!blockedSince) blockedSince = now;
  else if (now - blockedSince > BUMP_AFTER_MS && now - lastBump > BUMP_EVERY_MS) { audio.play('bump'); lastBump = now; }

  // Countdown plucks: one per second, a higher one when play starts.
  const count = Math.ceil((s.phaseEndTick - s.tick) / 20);
  if (s.phase === 'countdown' && count !== lastCount && count > 0) audio.play('countdown', {}, 'ui');
  if (s.phase === 'playing' && lastPhase === 'countdown') audio.play('go', {}, 'ui');
  lastCount = count;
  lastPhase = s.phase;

  players.highlight(s.phase === 'results' ? s.winnerId : '', now / 1000);
  fx.update(now / 1000);
  hud.update(s, me, level, audio.muted);
  view.render();
  debug.update(now, net, renderTick, view.renderer.info.render.calls, players.localAction(me), players.localLate(me), LOCAL_INTERP_TICKS,
    predict.enabled ? [
      `predict       ${predicting ? 'on' : 'paused'}   predTick ${predict.predTick.toFixed(2)}   lead ${predict.lead.toFixed(2)}`,
      `mispredict    ${predict.mispredictionsPerMin}/min (${predict.mispredictions} total)   deferred ${predict.deferred}   last fix ${players.localCorrection(me).toFixed(2)} cells`,
      ...latencyLines(),
    ] : ['predict       off (?predict=0)', ...latencyLines()]);

  if (screenshot) {
    screenshot = false;
    const a = document.createElement('a');
    a.href = view.renderer.domElement.toDataURL('image/png'); // same frame as render, so the buffer is intact
    a.download = `kula-${s.phase}-${Date.now()}.png`;
    a.click();
  }
});
