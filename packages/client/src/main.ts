import * as THREE from 'three';
import { Action, campaignLevels, newCampaign, type Campaign, type InputMsg, type Level, type SimEvent } from '@kula/shared';
import { setupInput } from './input.ts';
import { connect, playerName, serverUrl, type GameSource, type Net } from './net.ts';
import { campaignFrom, loadSave, resetSave, SinglePlayer, type Outcome } from './campaign.ts';
import { SingleTilesView } from './render/single.ts';
import { createMenu, FRUIT_ICONS } from './ui/menu.ts';
import { CameraRig, type CameraMode } from './render/camera.ts';
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
import { createHud, type SingleHud } from './ui/hud.ts';
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

/** The game being shown: the server (multiplayer) or the local campaign; null in the main menu. */
let net: GameSource | null = null;
let online: Net | null = null;
let sp: SinglePlayer | null = null;
let predict: LocalPrediction | null = null;
const hud = createHud({ onVote: (i) => net?.sendVote(i), preview: levelPreview, findLevel });
await loadArt();
const view = createScene();
view.setSky();
const debug = createDebug();
const players = new PlayersView(view.scene);
const items = new ItemsView(view.scene);
const pills = new PillsView(view.scene);
const rig = new CameraRig(view.camera);
const fx = new Fx(view.scene);
const audio = new AudioEngine();
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

/** Multiplayer (from the menu): join the lobby as `name`. Prediction and the latency audit are network-only. */
async function joinOnline(name: string): Promise<void> {
  const n = await connect(name);
  online = n;
  net = n;
  n.onEvent(onEvent);
  n.room.onLeave(() => hud.error('disconnected'));
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

let screenshot = false;
let frozen = false;
const input = setupInput({
  sendInput: (i) => net?.sendInput(i), sendReady: () => net?.sendReady(), sendVote: (o) => net?.sendVote(o),
}, {
  onPress: debug.press,
  onDebug: debug.toggle,
  onScreenshot: () => { screenshot = true; },
  onFreeze: () => { frozen = !frozen; },
  onMute: () => audio.toggleMute(),
  onVolume: (d) => { audio.setVolume(audio.volume + d); hud.toast(`Volume ${Math.round(audio.volume * 100)}%`, '#fff'); },
  onTuning: () => { if (import.meta.env.DEV) tuningPanel.toggle(); },
  onPause: () => togglePause(),
  onKey: (key, at) => {
    const p = online?.state.players.get(online.sessionId);
    if (online) latency.press(key, at, !!p && p.action === Action.Idle && players.localAction(online.sessionId) === Action.Idle, !!predict?.predicting);
  },
});

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
    case 'win': audio.play(e.winnerId === me ? 'win' : 'lose', {}, 'ui'); break;
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
    case 'continue': return startSingle(save.campaign!);
    case 'new': return startSingle(newCampaign());
    case 'play': return startSingle(campaignFrom(Number(arg), save.campaign?.fruits ?? 0));
    case 'multi': return menu.show({ kind: 'multi', name: playerName });
    case 'join': {
      const name = menu.name || playerName;
      joinOnline(name).then(() => menu.hide(), () => menu.show({ kind: 'multi', name, error: `Can't reach the server (${serverUrl})` }));
      return;
    }
    case 'settings': return menu.show({ kind: 'settings', volume: audio.volume });
    case 'volume': audio.setVolume(Number(arg)); return;
    case 'tuning': tuningPanel.toggle(); return;
    case 'reset': return menu.show({ kind: 'reset' });
    case 'resetYes': save = resetSave(); return menu.show({ kind: 'main' });
    case 'resume': return togglePause();
    case 'restart': return outcome(sp!.restart());
    case 'next': menu.hide(); sp?.next(); return;
    case 'finish': return menu.show({ kind: 'done', score: sp!.campaign.score });
    case 'quit': return quitToMenu();
  }
});

function startSingle(c: Campaign): void {
  menu.hide();
  sp = new SinglePlayer(c, LEVELS, save, outcome);
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
      sp!.next();
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

/** Esc in single player: pause (the local clock stops) or resume. */
function togglePause(): void {
  if (!sp || !net) return;
  const game = sp.game;
  if (menu.screen === 'pause') { menu.hide(); game.paused = false; }
  else if (!menu.screen && game.state.phase !== 'results') { game.paused = true; menu.show({ kind: 'pause' }); }
}

function quitToMenu(): void {
  if (sp) menuLevelId = sp.level.id;
  sp = null;
  net = null;
  hud.clear();
  menu.show({ kind: 'main' });
}
hud.clear();
menu.show({ kind: 'main' });

if (import.meta.env.DEV) Object.assign(window, { kula: { get net() { return net; }, get sp() { return sp; }, players, audio, input, get predict() { return predict; }, debug, latency } }); // console/automation access

let level: Level | null = null;
let levelView: LevelView | null = null;
let trapsView: TrapsView | null = null;
let traps2View: Traps2View | null = null;
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
    players.setSolid(solid);
    players.heat = level?.heat ?? null;
    rig.setSolid(solid);
    if (level && levelView) { view.scene.add(levelView.group); bounds = levelBounds(level); }
    view.setSky(level?.sky ?? undefined, level?.id);
  }
}

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
  audio.endRolls(EMPTY_SET as Set<string>);
  view.render();
}
const EMPTY_SET: ReadonlySet<string> = new Set();
const spHud: SingleHud = { score: 0, fruits: 0, label: '' };

view.renderer.setAnimationLoop((now: number) => {
  const dtMs = Math.min(now - last, 100);
  last = now;
  if (frozen) return;
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
