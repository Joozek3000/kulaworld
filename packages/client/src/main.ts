import * as THREE from 'three';
import { Action, campaignLevels, isTimingName, matchPlaces, MATCH_LENGTHS, newCampaign, normalizeCode, TICK_RATE, type Campaign, type TimingName, type InputMsg, type Level, type SimEvent } from '@kula/shared';
import { setupInput } from './input.ts';
import { ACTION_LABELS, ACTIONS, keyLabel, loadBindings, PAD_GLYPHS, rebind, resetBindings, saveBindings, type BindAction } from './bindings.ts';
import { connect, inviteCode, joinErrorText, playerName, VERSION_MESSAGE, type GameSource, type JoinHow, type Net, type StandingS } from './net.ts';
import { campaignFrom, loadSave, resetSave, SinglePlayer, type Outcome } from './campaign.ts';
import { SingleTilesView } from './render/single.ts';
import { Podium, PODIUM_AT, type PodiumEntry } from './render/podium.ts';
import { createMenu, FRUIT_ICONS } from './ui/menu.ts';
import { GAME_NAME } from './config.ts';

document.title = GAME_NAME;
import { CameraRig, LOOK_PITCH_MAX, LOOK_YAW_MAX, type CameraMode } from './render/camera.ts';
import { createOffscreen } from './ui/offscreen.ts';
import { ItemsView } from './render/items.ts';
import { allLevels, findLevel, levelBounds, LevelView } from './render/level.ts';
import { PillsView } from './render/pills.ts';
import { PlayersView } from './render/players.ts';
import { TrapsView } from './render/traps.ts';
import { groupColor, staticLevel, Traps2View } from './render/traps2.ts';
import { Fx } from './render/fx.ts';
import { createScene } from './render/scene.ts';
import { levelPreview } from './render/preview.ts';
import { createDebug } from './ui/debug.ts';
import { createHud, PODIUM_SEC, type SingleHud } from './ui/hud.ts';
import { createTuningPanel } from './ui/tuning.ts';
import { AudioEngine } from './audio/engine.ts';
import { Music, type MusicSlot } from './audio/music.ts';
import { latency } from './ui/latency.ts';
import { LocalPrediction } from './predict/local.ts';
import { loadArt } from './render/art.ts';
import { createTouchUI, loadTouchSettings, saveTouchSettings, touchShown, type TouchSettings } from './input/touch.ts';
import { applyGraphics, FpsGuard, loadGraphics, saveGraphics, type GraphicsMode } from './render/graphics.ts';

/** Render this many ticks behind the estimated server tick, so the current action has always arrived. */
const INTERP_TICKS = 2;
/** The local ball may render closer to the server (less input delay). Overridable with ?localInterp= for experiments. */
const LOCAL_INTERP_TICKS = Number(new URLSearchParams(location.search).get('localInterp') ?? 1);
const ACTIVE = new Set(['countdown', 'playing', 'results']);
/** Forward held but nothing started for this long = blocked by a wall (or an unpushable player): a bump. */
const BUMP_AFTER_MS = 150;
const BUMP_EVERY_MS = 300;

/** The game being shown: the server (multiplayer) or the local campaign; null in the main menu. */
let net: GameSource | null = null;
let online: Net | null = null;
let sp: SinglePlayer | null = null;
let predict: LocalPrediction | null = null;
const hud = createHud({
  onVote: (i) => net?.sendVote(i), preview: levelPreview, findLevel,
  onLength: (i) => net?.sendLength?.(i), onRematch: (yes) => net?.sendRematch?.(yes), // matches (phase 18)
  // Online rooms (phase 19): the host's bot controls, the invite link, leaving.
  onBot: (what) => online?.room.send(what), onBotLevel: (level) => online?.room.send('botLevel', level),
  onCopy: (link) => navigator.clipboard.writeText(link).then(() => hud.toast('Invite link copied', '#fff'), () => hud.toast(link, '#fff')),
  onLeave: () => void online?.room.leave(),
});
await loadArt();
const view = createScene();
view.setSky();
const debug = createDebug();
const players = new PlayersView(view.scene);
const items = new ItemsView(view.scene);
const pills = new PillsView(view.scene);
const podium = new Podium(view.scene); // the end of a match (phase 18)
const rig = new CameraRig(view.camera);
const fx = new Fx(view.scene);
const audio = new AudioEngine();
const music = new Music(); // phase 17: slot music on its own bus
audio.onStart = (ctx, bus) => music.attach(ctx, bus);
const tuningPanel = createTuningPanel(audio); // F4 in dev, and Settings → Sounds & feel (15b)
players.onLocalMotion = debug.motion;
players.onVanish = (at, color) => fx.vanish(at, color, performance.now() / 1000);
// Ball sounds come from what's on screen (render time), not from when a patch or event arrives.
players.onFeel = (e) => {
  const at = e.local ? null : e.at; // the local ball isn't spatialised
  switch (e.kind) {
    case 'takeoff': audio.play('takeoff', { at }); break;
    case 'land': // pills (15a): a heavy ball thuds, a bouncy one boings
      if (e.pills?.has('heavy')) audio.play('thud', { at, intensity: e.intensity });
      else audio.play('bounce', { at, intensity: e.intensity });
      if (e.pills?.has('bouncy')) audio.play('boing', { at, gain: 0.6 });
      break;
    case 'roll': audio.play('roll', { at }); break;
    case 'flip': audio.play('squeak', { at }); break;
    case 'climb': audio.play('squeak', { at, gain: 0.8 }); break; // rubber into the corner (phase 11)
    case 'fall': audio.play('fall', { at }); break;
    case 'hit': audio.play('hit', { at, intensity: e.intensity, gain: (e.victimLocal ? 1.5 : 1) * (e.headOn ? 1.3 : 1) }); break; // head-on: a bit louder (§20)
    case 'boing': audio.play(heavyNear(e.at) ? 'clang' : 'boing', { at }); break; // bounced off a heavy ball: clang (15a)
    case 'stomp': audio.play('stomp', { at, intensity: e.intensity, gain: e.victimLocal ? 1.5 : 1 }); break;
    case 'clash': audio.play('boing', { at, gain: 1.2 }); break;
    case 'pop': audio.play('pop', { at }); break;
    case 'clack': audio.play('clack', { at, intensity: e.intensity }); break;
    case 'slide': audio.play('slide', { at }); break;
    case 'launch': audio.play('pwomp', { at }); if (e.local) rig.kick(); break;
    case 'charge': audio.play('hum', { at }); break; // held on a boost pad (phase 14c)
    case 'vwoop': audio.play('vwoop', { at }); break; // a teleport (13b)
    case 'whoosh': audio.play('whoosh', { at }); break;
    case 'edge': audio.play('edge', { gain: 0.7 }); break; // an enemy just around your edge (phase 13a)
  }
};

/** A heavy ball (15a) within reach of `at`: whoever bounced there bounced off iron. */
function heavyNear(at: THREE.Vector3): boolean {
  let near = false;
  net?.state.players?.forEach((p) => {
    if (p.effects?.has('heavy') && Math.hypot(p.fromX - at.x, p.fromY - at.y, p.fromZ - at.z) < 1.8) near = true;
  });
  return near;
}
const PILL_NAMES: Record<string, string> = { bouncy: 'Bouncy', lethargy: 'Lethargy', heavy: 'Heavy', sunglasses: 'Sunglasses' };

/** Multiplayer (from the menu): join a room as `name`. Prediction and the latency audit are network-only. */
async function joinOnline(name: string, how: JoinHow): Promise<void> {
  const n = await connect(name, how);
  online = n;
  net = n;
  n.onEvent(onEvent);
  n.onNotice((text) => hud.toast(text, '#ffd166'));
  // Reconnection (phase 19): an overlay while the SDK retries; prediction starts over once the seat is back.
  n.room.onDrop(() => { reconnecting.hidden = false; });
  n.room.onReconnect(() => { reconnecting.hidden = true; predict?.reset(); });
  n.room.onLeave((code) => {
    reconnecting.hidden = true;
    if (online !== n) return;
    leaveOnline();
    // 4000: we left (the Leave button); 4001: the server shut down (a deploy).
    showMulti(code === 4000 ? undefined : code === 4001 ? 'The server restarted. Join again.' : 'Disconnected from the server');
  });
  const pr = (predict = new LocalPrediction(n, findLevel));
  n.stamp = (i) => {
    const msg: InputMsg = pr.enabled ? pr.stamp(i) : i;
    latency.sent(performance.now(), msg.tick === undefined ? undefined : pr.lastStampAheadMs);
    return msg;
  };
  pr.onLocalStart = (at) => latency.predStart(at);
  // Without prediction, (c) is when the server's action for the press shows up in a patch.
  let lastServerStart = '';
  n.onPatch(() => {
    const p = n.state.players.get(n.sessionId);
    const sig = p ? `${p.action}:${p.startTick}` : '';
    if (sig !== lastServerStart) { lastServerStart = sig; if (p && p.action !== Action.Idle && !pr.predicting) latency.predStart(performance.now()); }
  });
}

const reconnecting = document.createElement('div');
reconnecting.id = 'reconnecting';
reconnecting.textContent = 'Reconnecting…';
reconnecting.hidden = true;
document.body.appendChild(reconnecting);

/** Back to the menu from a room (it's already left or leaving). */
function leaveOnline(): void {
  online = null;
  net = null;
  predict = null;
  hud.clear();
}

/** The player's name (phase 19): ?name=, else the last one used, else a random one. */
let myName = playerName;
try { if (!new URLSearchParams(location.search).has('name')) myName = localStorage.getItem('kula.name') || playerName; } catch { /* storage unavailable */ }
function showMulti(error?: string, code?: string): void {
  menu.show({ kind: 'multi', name: myName, error, code });
}
function join(how: JoinHow): void {
  myName = menu.name || myName;
  try { localStorage.setItem('kula.name', myName); } catch { /* storage unavailable */ }
  const code = 'code' in how && how.code === inviteCode.toUpperCase() ? how.code : undefined;
  menu.show({ kind: 'multi', name: myName, code, busy: true });
  joinOnline(myName, how).then(() => menu.hide(), (e) => {
    const text = joinErrorText(e);
    if (text === VERSION_MESSAGE) menu.show({ kind: 'update' });
    else showMulti(text, code);
  });
}

/** Free look (phase 17): while Q is held the mouse orbits the camera about your ball; release springs it back. */
let lookHeld = false;
addEventListener('mousemove', (e) => {
  if (!lookHeld) return;
  rig.lookYaw = Math.max(-LOOK_YAW_MAX, Math.min(LOOK_YAW_MAX, rig.lookYaw - e.movementX * 0.006));
  rig.lookPitch = Math.max(-LOOK_PITCH_MAX, Math.min(LOOK_PITCH_MAX, rig.lookPitch + e.movementY * 0.005));
});
addEventListener('blur', () => { lookHeld = false; rig.lookYaw = rig.lookPitch = 0; });
const offscreen = createOffscreen();
const offscreenBall = offscreen.ball;

let screenshot = false;
let frozen = false;
const bindings = loadBindings();
// Ready doubles as the rematch vote at the end of a match (phase 18).
const sendReady = () => {
  const me = net?.state.players.get(net.sessionId);
  if (net?.state.phase === 'matchEnd') net.sendRematch?.(!me?.rematch);
  else net?.sendReady();
};
/** A phone or tablet (19b): touch is the device from the start, so Auto shows the touch controls before any touch. */
const coarse = matchMedia('(pointer: coarse)').matches;
const input = setupInput({ sendInput: (i) => net?.sendInput(i), sendVote: (o) => net?.sendVote(o), sendReady }, {
  onPress: debug.press,
  onDebug: debug.toggle,
  onScreenshot: () => { screenshot = true; },
  onFreeze: () => { frozen = !frozen; },
  onMute: () => audio.toggleMute(),
  onVolume: (d) => { audio.setVolume(audio.volume + d); hud.toast(`Volume ${Math.round(audio.volume * 100)}%`, '#fff'); },
  onTuning: () => { if (import.meta.env.DEV) tuningPanel.toggle(); },
  onPause: () => togglePause(),
  onLook: (held) => { lookHeld = held; if (!held) { rig.lookYaw = 0; rig.lookPitch = 0; } },
  // Right stick (phase 17): its deflection is the look angle; centred springs back (unless Q + mouse is looking).
  onLookStick: (x, y) => { if (!lookHeld) { rig.lookYaw = -x * LOOK_YAW_MAX; rig.lookPitch = y * LOOK_PITCH_MAX; } },
  menuActive: () => menu.screen !== null,
  onMenuNav: (dir) => menu.focusStep(dir),
  onMenuConfirm: () => menu.confirm(),
  onVoteStep: (step) => {
    const me = online?.state.players.get(online.sessionId);
    if (online?.state.phase === 'lobby' && me) online.sendVote(((me.vote < 0 ? (step > 0 ? -1 : 0) : me.vote) + step + 4) % 4);
  },
  onLengthStep: (step) => { // the server only takes it before round 1
    const me = online?.state.players.get(online.sessionId), n = MATCH_LENGTHS.length, v = me?.lengthVote ?? -1;
    if (online?.state.phase === 'lobby' && me) online.sendLength(v < 0 ? (step > 0 ? 0 : n - 1) : (v + step + n) % n);
  },
  onDevice: (d) => hud.padHint(d === 'pad'),
  onKey: (key, at) => {
    const p = online?.state.players.get(online.sessionId);
    if (online) latency.press(key, at, !!p && p.action === Action.Idle && players.localAction(online.sessionId) === Action.Idle, !!predict?.predicting);
  },
}, bindings, coarse ? 'touch' : 'keyboard');

// Touch controls (phase 19b, §25): the d-pad and Jump feed the input like keys; a right-half drag looks around.
const touchSettings = loadTouchSettings();
const touch = createTouchUI({
  act: (a, down) => { input.feed(a, down); if (a === 'jump' && down) haptic(8); },
  look: (dx, dy) => {
    lookHeld = true;
    rig.lookYaw = Math.max(-LOOK_YAW_MAX, Math.min(LOOK_YAW_MAX, -dx * 0.008));
    rig.lookPitch = Math.max(-LOOK_PITCH_MAX, Math.min(LOOK_PITCH_MAX, dy * 0.006));
  },
  lookEnd: () => { lookHeld = false; rig.lookYaw = rig.lookPitch = 0; },
  pause: () => togglePause(),
  ready: sendReady,
});
touch.apply(touchSettings);
const touchOn = () => touchShown(touchSettings.mode, input.device);
/** Vibration (§25: jump, knockout, key) while the touch controls are up and haptics are on. */
function haptic(ms: number): void {
  if (touchSettings.haptics && touchOn()) navigator.vibrate?.(ms);
}
function setTouch(change: Partial<TouchSettings>): void {
  Object.assign(touchSettings, change);
  saveTouchSettings(touchSettings);
  touch.apply(touchSettings);
}
/** Fullscreen and landscape on the first Play tap (19b); either may be refused (iOS Safari), and that's fine. */
let wentFullscreen = false;
function goFullscreen(): void {
  if (wentFullscreen || !touchOn()) return;
  wentFullscreen = true;
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> };
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => orientation.lock?.('landscape')).catch(() => {});
  } catch { /* not supported */ }
}

// Graphics (19b): High, Low, or Auto (High until the frame rate stays under 45 for 5 s).
let graphics: GraphicsMode = loadGraphics();
let lowGraphics = false;
const fpsGuard = new FpsGuard();
function setLow(low: boolean): void {
  lowGraphics = low;
  fx.low = low;
  applyGraphics(view.renderer, view.scene, low);
}
if (graphics === 'low') setLow(true);

/** F3: the last few measured presses, ms after keydown (sent / stamp ahead / predicted start / visible). */
const latencyLines = () => ['press→ (ms)   key  mode    sent  stamp  start  visible',
  ...latency.rows.slice(-4).map((r) => `              ${latency.summary(r).map((c) => c.padStart(5)).join(' ')}`)];

const nameOf = (id: string) => (id === net?.sessionId ? 'You' : net?.state.players.get(id)?.name ?? '?');
const colorOf = (id: string) => net?.state.players.get(id)?.color ?? '#fff';
/** Death toasts by cause (§18). Falls from a push already get the knockout toast. */
const DEATH_TOAST: Partial<Record<string, (who: string) => string>> = {
  spikes: (who) => `${who} got spiked`,
  fire: (who) => `${who} popped on fire`,
  fall: (who) => `${who} fell off`,
  laser: (who) => `${who} got zapped`,
};
/** Fall toasts wait a moment: a `knockout` event right after the death replaces them with its own toast. */
const pendingFall = new Map<string, ReturnType<typeof setTimeout>>();
function onEvent(e: SimEvent): void {
  const me = net?.sessionId;
  // Rumble (phase 17) on the pad when a push, stomp, bounce or death involves you.
  switch (e.type) {
    case 'push': if (e.victimId === me || e.pusherId === me) input.rumble(e.victimId === me ? 0.8 : 0.4, 120); break;
    case 'stomp': if (e.victimId === me || e.attackerId === me) input.rumble(e.victimId === me ? 1 : 0.5, 180); break;
    case 'bounce': if (e.playerId === me) input.rumble(0.3, 80); break;
    case 'death': if (e.playerId === me) input.rumble(1, 350); break;
    case 'knockout': if (e.victimId === me || e.pusherId === me) haptic(e.victimId === me ? 60 : 30); break; // touch (19b)
    case 'key': if (e.playerId === me) haptic(20); break;
  }
  switch (e.type) {
    case 'knockout': clearTimeout(pendingFall.get(e.victimId)); pendingFall.delete(e.victimId); break;
    case 'death': {
      const toast = DEATH_TOAST[e.cause];
      if (!toast) break;
      const show = () => { pendingFall.delete(e.playerId); hud.toast(toast(nameOf(e.playerId)), colorOf(e.playerId)); };
      if (e.cause === 'fall') pendingFall.set(e.playerId, setTimeout(show, 150));
      else show();
      if (e.cause === 'laser') audio.play('zap', { at: e.playerId === me ? null : new THREE.Vector3(e.cell.x, e.cell.y, e.cell.z) });
      break;
    }
  }
  switch (e.type) {
    case 'key':
      hud.toast(`${nameOf(e.playerId)} got a key (${e.keys}/${level?.keysRequired ?? '?'})`, colorOf(e.playerId));
      audio.play('key', { mine: e.playerId === me }, 'ui');
      break;
    case 'win': audio.play(e.winnerId === me ? 'win' : 'lose', {}, 'ui'); music.duck(); break;
    case 'stomp': hud.toast(`${nameOf(e.attackerId)} stomped ${nameOf(e.victimId)}!`, colorOf(e.attackerId)); break;
    case 'knockout': hud.toast(`${nameOf(e.pusherId)} knocked ${nameOf(e.victimId)} off!`, colorOf(e.pusherId)); break;
    case 'keyDrop': hud.toast(`${nameOf(e.playerId)} dropped a key`, colorOf(e.playerId)); break;
    case 'eliminated':
      hud.toast(e.byId ? `${nameOf(e.byId)} knocked ${nameOf(e.playerId)} out!` : `${nameOf(e.playerId)} ${e.playerId === me ? 'are' : 'is'} out`, colorOf(e.playerId));
      audio.play('eliminated', { mine: e.playerId === me }, 'ui');
      break;
    case 'laser': { // a switch (13b): the button clicks down, and everyone hears which lasers changed
      const name = e.group[0].toUpperCase() + e.group.slice(1);
      hud.toast(`${name} lasers ${e.on ? 'ON' : 'OFF'}`, `#${groupColor(e.group).toString(16).padStart(6, '0')}`);
      traps2View?.press(e.group, performance.now() / 1000);
      audio.play('click', { at: e.playerId === me ? null : players.ballAt(e.playerId) });
      break;
    }
    case 'pickup': { // pills (15a): a chime, or the lethargy "wah"; the pill pops in PillsView
      const mine = e.playerId === me;
      audio.play(e.pickup === 'lethargy' ? 'wah' : 'chime', { at: mine ? null : players.ballAt(e.playerId), mine });
      hud.toast(`${nameOf(e.playerId)} got ${PILL_NAMES[e.pickup]}${e.pickup === 'lethargy' ? '…' : '!'}`, colorOf(e.playerId));
      break;
    }
    case 'effectEnd':
      if (e.playerId === me) hud.toast(`${PILL_NAMES[e.effect]} wore off`, colorOf(e.playerId));
      break;
    case 'crumbleWarn': audio.play('crumbleWarn', {}, 'ui'); break;
    case 'crumble': audio.play('crumble', {}, 'ui'); break;
    case 'burn': {
      const at = players.ballAt(e.playerId);
      if (at) fx.puff(at, performance.now() / 1000);
      hud.toast(`${nameOf(e.playerId)} ${e.playerId === me ? 'were' : 'was'} too slow: burnt!`, colorOf(e.playerId));
      break;
    }
    // Single player (§22).
    case 'item':
      audio.play(e.item === 'coin' ? 'chime' : 'key', { mine: true }, 'ui');
      hud.toast(e.item === 'fruit' ? `${FRUIT_ICONS[e.fruit]} Fruit! +${e.points}` : e.item === 'hourglass' ? '⏳ Hourglass: time flipped!' : `+${e.points}`, e.item === 'gem' ? '#3fd0ff' : '#f2c230');
      break;
    case 'timer': if (e.kind === 'freeze') { hud.toast('⏸ Clock: time frozen for 5 s', '#8fd3ff'); audio.play('chime', { mine: true }, 'ui'); } break;
    case 'paint': audio.play('click', { at: null }); break;
  }
}

const DEATH_TIME = (who: string) => `${who} ran out of time`;
DEATH_TOAST.time = DEATH_TIME;

// Main menu, the single-player flow and the pause menu (phase 15b).
const LEVELS = allLevels();
const CAMPAIGN = campaignLevels(LEVELS);
let save = loadSave();
let menuLevelId = CAMPAIGN.main[0]?.id ?? '';
const menu = createMenu((act, arg) => {
  switch (act) {
    case 'main': return menu.show({ kind: 'main' });
    case 'single': {
      const c = save.campaign;
      return menu.show({ kind: 'single', canContinue: c ? `Level ${c.level} · ${c.score}` : null, highest: save.highest, names: CAMPAIGN.main.map((l) => l.name) });
    }
    case 'levels': return menu.show({ kind: 'levels', highest: save.highest, names: CAMPAIGN.main.map((l) => l.name), best: CAMPAIGN.main.map((l) => save.best[l.id] ?? null) });
    case 'continue': goFullscreen(); return startSingle(save.campaign!);
    case 'new': goFullscreen(); return startSingle(newCampaign());
    case 'play': goFullscreen(); return startSingle(campaignFrom(Number(arg), save.campaign?.fruits ?? 0));
    case 'multi': return showMulti();
    case 'quick': goFullscreen(); return join({ quick: true });
    case 'create': goFullscreen(); return join({ create: true });
    case 'joinCode': {
      goFullscreen();
      const code = normalizeCode(arg ?? menu.code);
      myName = menu.name || myName;
      return code ? join({ code }) : showMulti('A room code is 4 letters, like KQRT');
    }
    case 'refresh': location.reload(); return;
    case 'settings': return showSettings();
    case 'volume': audio.setVolume(Number(arg)); return;
    case 'music': audio.setMusicVolume(Number(arg)); return;
    case 'controls': return showControls(null);
    case 'graphics': { // Auto → High → Low
      graphics = graphics === 'auto' ? 'high' : graphics === 'high' ? 'low' : 'auto';
      saveGraphics(graphics);
      setLow(graphics === 'low');
      return showSettings();
    }
    case 'touchSettings': return menu.show({ kind: 'touch', s: touchSettings });
    case 'touchMode':
      setTouch({ mode: touchSettings.mode === 'auto' ? 'on' : touchSettings.mode === 'on' ? 'off' : 'auto' });
      return menu.screen === 'controls' ? showControls(null) : menu.show({ kind: 'touch', s: touchSettings });
    case 'touchLayout': setTouch({ layout: touchSettings.layout === 'buttons' ? 'stick' : 'buttons' }); return menu.show({ kind: 'touch', s: touchSettings });
    case 'touchFloating': setTouch({ floating: !touchSettings.floating }); return menu.show({ kind: 'touch', s: touchSettings });
    case 'touchSize': setTouch({ size: touchSettings.size === 'S' ? 'M' : touchSettings.size === 'M' ? 'L' : 'S' }); return menu.show({ kind: 'touch', s: touchSettings });
    case 'touchLefty': setTouch({ lefty: !touchSettings.lefty }); return menu.show({ kind: 'touch', s: touchSettings });
    case 'touchHaptics': setTouch({ haptics: !touchSettings.haptics }); haptic(30); return menu.show({ kind: 'touch', s: touchSettings });
    case 'touchStats': setTouch({ stats: !touchSettings.stats }); return menu.show({ kind: 'touch', s: touchSettings });
    case 'touchOpacity': setTouch({ opacity: Number(arg) }); return;
    case 'mute': audio.toggleMute(); return menu.show({ kind: 'pause', muted: audio.muted, online: !sp });
    case 'bindKey': case 'bindPad': {
      const action = arg as BindAction;
      showControls(`${act === 'bindKey' ? 'key' : 'pad'}:${action}`);
      input.captureNext((c) => {
        if ('code' in c ? c.code : true) rebind(bindings, action, c);
        saveBindings(bindings);
        showControls(null);
      });
      return;
    }
    case 'bindReset': resetBindings(bindings); saveBindings(bindings); return showControls(null);
    case 'credits': return menu.show({ kind: 'credits', rows: music.credits });
    case 'timing': spTiming = spTiming === 'classic' ? 'snappy' : 'classic'; try { localStorage.setItem('kula.timing', spTiming); } catch { /* storage unavailable */ } return showSettings();
    case 'tuning': tuningPanel.toggle(); return;
    case 'reset': return menu.show({ kind: 'reset' });
    case 'resetYes': save = resetSave(); return menu.show({ kind: 'main' });
    case 'resume': return togglePause();
    case 'restart': return outcome(sp!.restart());
    case 'next': menu.hide(); sp?.next(); return;
    case 'finish': return menu.show({ kind: 'done', score: sp!.campaign.score });
    case 'quit':
      if (online) { menu.hide(); void online.room.leave(); return; } // onLeave shows the Multiplayer menu
      return quitToMenu();
  }
});

/** Dev only (phase 17): single player's movement timing preset, for playtesting. */
let spTiming: TimingName = 'classic';
try { const t = localStorage.getItem('kula.timing'); if (import.meta.env.DEV && isTimingName(t)) spTiming = t; } catch { /* storage unavailable */ }
function showSettings(): void {
  menu.show({ kind: 'settings', volume: audio.volume, music: audio.musicVolume, timing: import.meta.env.DEV ? spTiming : null, graphics, touch: touchOn() });
}
function showControls(waiting: string | null): void {
  menu.show({
    kind: 'controls', waiting, touchMode: touchSettings.mode,
    rows: ACTIONS.map((a) => ({ action: a, label: ACTION_LABELS[a], keys: bindings.keys[a].map(keyLabel).join(' / '), pad: bindings.pad[a].map((b) => PAD_GLYPHS[b] ?? `#${b}`).join(' / ') })),
  });
}

function startSingle(c: Campaign): void {
  menu.hide();
  sp = new SinglePlayer(c, LEVELS, save, outcome, spTiming);
  sp.game.onEvent(onEvent);
  net = sp.game;
}

/** An attempt ended: a death restarts the level with the penalty shown; the rest get a screen. */
function outcome(o: Outcome): void {
  const game = sp!.game;
  switch (o.kind) {
    case 'death':
      hud.toast(`−${o.penalty} · restarting`, '#ff6b5b');
      menu.hide();
      sp!.next(false); // a restart skips the fly-over
      break;
    case 'gameOver':
      game.paused = true;
      menu.show({ kind: 'gameOver', checkpoint: o.checkpoint, name: sp!.current().name, score: o.score });
      break;
    case 'card':
      game.paused = true;
      menu.show({
        kind: 'card', name: o.level.name, card: o.card, bonus: o.bonus, painted: game.world.result?.reason === 'painted', par: o.level.parSec,
        best: o.best, score: o.score, finished: o.finished,
      });
      break;
  }
}

/**
 * Esc (or the touch Pause button): in single player, pause (the local clock stops) or resume. Multiplayer (19b) gets
 * the same menu over the running round, for Mute and Leave.
 */
function togglePause(): void {
  if (!net) return;
  if (menu.screen === 'pause') { menu.hide(); if (sp) sp.game.paused = false; }
  else if (!menu.screen && !(sp && sp.game.state.phase === 'results')) {
    if (sp) sp.game.paused = true;
    menu.show({ kind: 'pause', muted: audio.muted, online: !sp });
  }
}
// Turned to portrait mid-level (19b): the "Rotate your device" overlay covers the game, so single player pauses too.
matchMedia('(orientation: portrait)').addEventListener('change', (e) => {
  if (e.matches && touchOn() && sp && !menu.screen && sp.game.state.phase === 'playing') togglePause();
});

function quitToMenu(): void {
  if (sp) menuLevelId = sp.level.id;
  sp = null;
  net = null;
  hud.clear();
  menu.show({ kind: 'main' });
}
hud.clear();
// An invite link (?room=CODE) goes straight to the name field, ready to join that room.
if (normalizeCode(inviteCode)) showMulti(undefined, normalizeCode(inviteCode));
else menu.show({ kind: 'main' });

if (import.meta.env.DEV) Object.assign(window, { kula: { get net() { return net; }, get sp() { return sp; }, set backdrop(id: string) { menuLevelId = id; }, players, audio, input, music, rig, bindings, camera: view.camera, view, get predict() { return predict; }, debug, latency } }); // console/automation access

let level: Level | null = null;
let levelView: LevelView | null = null;
let trapsView: TrapsView | null = null;
let traps2View: Traps2View | null = null;
let opaque: ((x: number, y: number, z: number) => boolean) | null = null;
let singleView: SingleTilesView | null = null;
let nextBuzz = 0;
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
function backdropId(s: GameSource['state']): string {
  const c = s.candidates;
  if (s.phase !== 'lobby' || !c?.length) return s.levelId;
  let best = 0;
  for (let i = 1; i < c.length; i++) if ((s.voteCounts?.[i] ?? 0) > (s.voteCounts?.[best] ?? 0)) best = i;
  return c[best];
}

/** Shows level `want` (a quick fade when one is already up). */
function showLevel(want: string, now: number): void {
  if (want && level?.id === want && fadeUntil) { fadeUntil = 0; fade.style.opacity = '0'; } // the lead went back
  else if (want && level && level.id !== want && !fadeUntil) { fadeUntil = now + FADE_MS; fade.style.opacity = '1'; }
  if (want && level?.id !== want && (!level || now >= fadeUntil)) {
    if (fadeUntil) { fadeUntil = 0; fade.style.opacity = '0'; }
    level = findLevel(want);
    if (levelView) { view.scene.remove(levelView.group); levelView.dispose(); }
    if (singleView) { view.scene.remove(singleView.group); singleView.dispose(); }
    singleView = level?.mode === 'single' ? new SingleTilesView(level) : null;
    if (singleView) view.scene.add(singleView.group);
    if (trapsView) { view.scene.remove(trapsView.group); trapsView.dispose(); }
    if (traps2View) { view.scene.remove(traps2View.group); traps2View.dispose(); }
    levelView = level ? new LevelView(staticLevel(level)) : null; // invisible and vanishing blocks are Traps2View's (13b)
    trapsView = level ? new TrapsView(level) : null;
    traps2View = level ? new Traps2View(level) : null;
    if (trapsView) view.scene.add(trapsView.group);
    if (traps2View) view.scene.add(traps2View.group);
    players.setLevel(level);
    const lv = levelView, t2 = traps2View;
    const solid = lv && t2 ? (x: number, y: number, z: number) => lv.solid(x, y, z) || t2.solid(x, y, z) : null;
    // Line of sight (18c): what's drawn right now; cells outside the level's box are skipped before any key is built.
    // ponytail: string-keyed lookups inside the box (a few hundred strings/s at 8 players); a packed grid if it shows up.
    const lo = level?.min, hi = level?.max;
    opaque = lv && t2 && lo && hi ? (x: number, y: number, z: number) => x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y && z >= lo.z && z <= hi.z
      && (lv.solid(x, y, z) || t2.opaque(x, y, z)) : null;
    players.setSolid(solid);
    players.heat = level?.heat ?? null;
    rig.setSolid(solid);
    if (level && levelView) { view.scene.add(levelView.group); bounds = levelBounds(level); }
    view.setSky(level?.sky ?? undefined, level?.id);
  }
}

/**
 * The level fly-over (phase 17): progress 0..1 through the countdown, or -1 when there's none. Single player: a new
 * level's long READY (not a restart after a death). Multiplayer: the round countdown, from the first countdown tick
 * seen. Any key skips it (in single player the READY itself ends too).
 */
let flyFrom = NaN, flySkipped = false;
function flyProgress(s: GameSource['state'], renderTick: number): number {
  if (s.phase !== 'countdown') { flyFrom = NaN; flySkipped = false; return -1; }
  if (flySkipped) return -1;
  if (sp) return sp.game.readyTicks > TICK_RATE ? Math.min(1, Math.max(0, 1 + renderTick / sp.game.readyTicks)) : -1;
  if (Number.isNaN(flyFrom)) flyFrom = s.tick;
  return flyFrom < 0 ? Math.min(1, Math.max(0, 1 - renderTick / flyFrom)) : -1;
}
const skipFly = (e: { repeat?: boolean }) => {
  if (e.repeat || net?.state.phase !== 'countdown' || flySkipped) return;
  flySkipped = true;
  sp?.game.skipReady();
};
addEventListener('keydown', skipFly);
addEventListener('touchstart', () => skipFly({}), { capture: true, passive: true }); // a tap skips it too (19b)

/** The music slot(s) for what's on screen (phase 17), best first. */
const SLOTS: Record<string, MusicSlot[]> = { menu: ['menu'], results: ['results'], race: ['race'], knockout: ['knockout'] };
const SINGLE_SLOTS = [1, 2, 3, 4].map((w) => [`single-${w}`, 'single'] as MusicSlot[]);
function musicSlots(): MusicSlot[] {
  if (!net) return SLOTS.menu;
  if (sp) {
    const shown = menu.screen;
    if (shown === 'card' || shown === 'gameOver' || shown === 'done') return SLOTS.results;
    return SINGLE_SLOTS[Math.min(3, Math.floor((sp.campaign.level - 1) / 5))]; // a "world" is 5 levels
  }
  const s = net.state;
  return s.phase === 'results' || s.phase === 'matchEnd' ? SLOTS.results : s.phase === 'lobby' ? SLOTS.menu : s.mode === 'knockout' ? SLOTS.knockout : SLOTS.race;
}

/** The last crown seen (phase 18), for the "takes the lead" toast; undefined until the first state. */
let lastCrown: string | undefined;

/** The main menu (15b): an empty level orbiting slowly behind the panel. */
const NO_GAME = { phase: 'lobby', tick: 0, phaseEndTick: 0, levelId: '', winnerId: '', players: new Map(), items: new Map(), pickups: new Map(),
  mode: 'single', crumbled: 0, warnBand: -1, nextCrumbleTick: -1, hot: new Map(), crumbling: new Map(), lasers: new Map(), candidates: [], voteCounts: [] } as const;
function menuBackdrop(now: number, dtMs: number): void {
  showLevel(menuLevelId, now);
  const s = NO_GAME as unknown as GameSource['state'];
  players.update(s, 0, '', 0, dtMs / 1000, now);
  items.update(s, false, false, now / 1000);
  pills.update(s, false, now / 1000);
  singleView?.update(EMPTY_SET, EMPTY_SET, now / 1000);
  levelView?.updateTraps({ get: () => undefined }, 0, now / 1000);
  rig.update(dtMs / 1000, 'orbit', null, bounds.center, bounds.radius);
  view.fitFog(bounds.center, bounds.radius);
  offscreen.begin(view.camera, null);
  offscreen.end();
  audio.endRolls(EMPTY_SET as Set<string>);
  view.render();
}
const EMPTY_SET: ReadonlySet<string> = new Set();

/** Per frame (19b): which touch controls show, the portrait overlay's in-game flag, the FPS/ping readout. */
let statsAt = 0;
function updateTouch(): void {
  const shown = touchOn(), s = net?.state, me = net && s?.players ? s.players.get(net.sessionId) : undefined;
  const inGame = !!s && !menu.screen;
  const statsUp = s?.phase === 'matchEnd' && s.tick >= PODIUM_SEC * TICK_RATE; // the rematch vote is up
  touch.update({
    shown: shown && inGame,
    play: s?.phase === 'countdown' || s?.phase === 'playing',
    ready: sp || !s ? null : s.phase === 'lobby' ? 'ready' : statsUp ? 'rematch' : null,
    readyOn: !!(s?.phase === 'lobby' ? me?.ready : me?.rematch),
  });
  hud.touch = shown;
  document.body.classList.toggle('in-game', inGame);
  const now = performance.now();
  if (touchSettings.stats && now - statsAt > 500) {
    statsAt = now;
    touch.stats(`${Math.round(fpsGuard.fps)} fps${online ? `\n${online.ping} ms` : ''}${lowGraphics ? '\nlow' : ''}`);
  }
}
const spHud: SingleHud = { score: 0, fruits: 0, label: '' };

view.renderer.setAnimationLoop((now: number) => {
  const rawDt = now - last, dtMs = Math.min(rawDt, 100);
  last = now;
  if (frozen) return;
  if (fpsGuard.frame(rawDt) && graphics === 'auto' && !lowGraphics) { setLow(true); hud.toast('Graphics set to Low for a smoother game', '#fff'); }
  updateTouch();
  input.poll(); // the gamepad (phase 17)
  music.play(musicSlots());
  if (!net) { menuBackdrop(now, dtMs); return; }
  const s = net.state;
  if (!s.players || !s.items) return; // The first server snapshot can arrive after join resolves.
  if (sp) sp.update(now, dtMs); // single player: the local sim steps here (and settles results)
  else net.update(now, dtMs);
  const me = net.sessionId;

  // Lobby backdrop (phase 14b): the scene shows the leading vote candidate, with a quick fade between levels.
  showLevel(backdropId(s), now);

  // Single player renders at the local tick itself (no server to wait for, no prediction).
  const renderTick = net.estServerTick - (sp ? 0 : INTERP_TICKS);
  const active = ACTIVE.has(s.phase);
  // Prediction (§17): the local ball runs on its predicted timeline at predTick; otherwise it trails the server.
  predict?.update(dtMs);
  const predicting = !!predict?.predicting && !!s.players.get(me);
  const localTick = predicting ? predict!.renderTick : sp ? renderTick : net.estServerTick - LOCAL_INTERP_TICKS;
  players.update(s, renderTick, me, localTick, dtMs / 1000, now, predicting ? predict!.localPlayer(s.players.get(me)!) : null, !!predict?.takeCorrection());
  // Latency audit (d): the first frame whose local ball differs from the last frame's (> 0.01 in position/rotation).
  const lp = players.poseOf(me);
  if (lp) {
    const sig = [...lp.position, ...lp.quat, lp.spin].map((v) => Math.round(v * 100)).join(',');
    if (lastLocalPose && sig !== lastLocalPose) latency.visible(now);
    lastLocalPose = sig;
  } else lastLocalPose = '';
  const mine = s.players.get(me);
  const unlocked = !!level?.exit && !!mine && mine.keys >= level.keysRequired;
  items.highlight = flyProgress(s, renderTick) >= 0 ? 1 : 0; // the fly-over shows off keys, exit and items
  items.update(s, active, unlocked, now / 1000);
  pills.update(s, active, now / 1000);
  if (unlocked && !wasUnlocked && s.phase === 'playing') audio.play('exit', {}, 'ui');
  wasUnlocked = unlocked;

  levelView?.update(active ? s.crumbled : 0, active ? s.warnBand : -1, now / 1000);
  // Trap tiles (§18): spikes follow the render tick; crumble tiles the server tick (they vanish on its schedule).
  const noCrumbling = { get: () => undefined };
  const crumbling = active && s.crumbling ? s.crumbling : noCrumbling;
  levelView?.updateTraps(crumbling, s.tick, now / 1000);
  trapsView?.update(renderTick, s.tick, crumbling, players.rollingOnto(), dtMs / 1000, now / 1000, players.chargingOn());
  // Phase 13b: laser groups as synced (the level's defaults outside a round), invisible blocks near the local ball.
  const laserOn = (g: string) => (active && s.lasers?.has(g) ? s.lasers.get(g) === 1 : !!level?.lasers.find((l) => l.group === g)?.on);
  const localAt = players.poseOf(me)?.position;
  // Pills (15a): sunglasses show every invisible block; lethargy sways the camera.
  if (traps2View) traps2View.revealInvisible = active && !!mine?.effects?.has('sunglasses');
  rig.sway = active && mine?.effects?.has('lethargy') ? 1 : 0;
  traps2View?.update(renderTick, laserOn, localAt ? new THREE.Vector3(...localAt) : null, now / 1000);
  // Active beams buzz nearby (positional), a little faster the closer you are.
  const beamAt = traps2View && localAt && s.phase === 'playing' ? traps2View.nearestBeam(new THREE.Vector3(...localAt), laserOn) : null;
  const beamDist = beamAt ? beamAt.distanceTo(new THREE.Vector3(...localAt!)) : Infinity;
  if (beamAt && beamDist < 6 && now >= nextBuzz) { audio.play('buzz', { at: beamAt, intensity: 1 - beamDist / 6 }); nextBuzz = now + 300 + 60 * beamDist; }

  // Knocked out of a knockout round: follow whoever did it while they're on screen, otherwise orbit.
  const out = !!mine?.eliminated && active;
  const pose = players.poseOf(out ? mine!.eliminatedBy : me);
  const mode: CameraMode = !active || !mine || mine.spectating || (out && !pose) ? 'orbit' : pose ? 'follow' : 'hold';
  const fly = flyProgress(s, renderTick);
  // Matches (phase 18): the crown follows the leader; the end of a match cuts to the podium.
  players.crownId = s.crownId ?? '';
  if (s.crownId !== lastCrown) {
    if (s.crownId && lastCrown !== undefined) hud.toast(`👑 ${nameOf(s.crownId)} take${s.crownId === me ? '' : 's'} the lead`, colorOf(s.crownId));
    lastCrown = s.crownId;
  }
  if (s.phase === 'matchEnd') {
    if (!podium.shown) {
      const list: StandingS[] = [];
      s.standings?.forEach((st) => list.push(st));
      const top: PodiumEntry[] = [...matchPlaces(list)].map(([st, place]) => ({ name: st.name, color: st.color, points: st.points, place }));
      podium.show(top.sort((a, b) => a.place - b.place || a.name.localeCompare(b.name)));
      audio.play('win', {}, 'ui');
    }
    podium.update(dtMs / 1000, now / 1000);
    podium.labelsVisible(s.tick < PODIUM_SEC * TICK_RATE); // the stats card takes over after PODIUM_SEC
    podium.place(view.camera);
    view.fitFog(PODIUM_AT, 6);
  } else {
    podium.hide();
    if (fly >= 0) rig.flyover(fly, pose, bounds.center, bounds.radius);
    else rig.update(dtMs / 1000, mode, pose, bounds.center, bounds.radius);
    view.fitFog(bounds.center, bounds.radius);
  }
  if (s.phase !== 'matchEnd') players.updateSight(view.camera.position, now, opaque); // labels in line of sight (18c)
  // Off-screen enemy arrows (multiplayer only; phase 17).
  offscreen.begin(view.camera, !sp && active && !!mine && !mine.spectating ? players.positionOf(me) : null);
  if (!sp && active) players.eachBall(offscreenBall);
  offscreen.end();

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
  if (sp) {
    const v = sp.game.state.single;
    singleView?.update(v.lit, v.clocks, now / 1000);
    spHud.score = sp.score;
    spHud.fruits = sp.campaign.fruits;
    spHud.label = sp.label;
    hud.update(s, me, level, audio.muted, spHud);
  } else hud.update(s, me, level, audio.muted);
  view.render();
  debug.update(now, net, renderTick, view.renderer.info.render.calls, players.localAction(me), players.localLate(me), LOCAL_INTERP_TICKS,
    predict?.enabled ? [
      `predict       ${predicting ? 'on' : 'paused'}   predTick ${predict.predTick.toFixed(2)}   lead ${predict.lead.toFixed(2)}`,
      `mispredict    ${predict.mispredictionsPerMin}/min (${predict.mispredictions} total)   deferred ${predict.deferred}   last fix ${players.localCorrection(me).toFixed(2)} cells`,
      ...latencyLines(),
    ] : [sp ? 'predict       off (single player: local sim)' : 'predict       off (?predict=0)', ...latencyLines()]);

  if (screenshot) {
    screenshot = false;
    const a = document.createElement('a');
    a.href = view.renderer.domElement.toDataURL('image/png'); // same frame as render, so the buffer is intact
    a.download = `kula-${s.phase}-${Date.now()}.png`;
    a.click();
  }
});
