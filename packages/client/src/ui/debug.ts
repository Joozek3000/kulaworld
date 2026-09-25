import { Action, dirName, type Dir } from '@kula/shared';
import type { Net } from '../net.ts';

const ACTION_NAMES = Object.fromEntries(Object.entries(Action).map(([k, v]) => [v, k]));

/** F3 overlay (ARCHITECTURE §11) plus FPS, draw calls and measured input→motion latency. */
export function createDebug() {
  const el = document.createElement('pre');
  el.id = 'debug';
  el.hidden = true;
  document.body.appendChild(el);
  let frames = 0, fps = 0, windowStart = performance.now(), lastPaint = 0;
  let pressAt = 0, latency = 0;
  const samples: number[] = [];

  return {
    toggle() { el.hidden = !el.hidden; },
    /** A gameplay key was pressed. */
    press() { if (!pressAt) pressAt = performance.now(); },
    /** The local ball started a new moving action on screen. */
    motion() { if (pressAt) { latency = performance.now() - pressAt; pressAt = 0; samples.push(latency); } },
    /** Every measured input→motion latency (ms), for automated checks. */
    samples,
    update(now: number, net: Net, renderTick: number, drawCalls: number, localAction: number | null, late: { count: number; max: number }, localInterp: number, extra: string[] = []) {
      frames++;
      if (now - windowStart >= 1000) { fps = (frames * 1000) / (now - windowStart); frames = 0; windowStart = now; }
      if (pressAt && now - pressAt > 2000) pressAt = 0; // press that didn't move (blocked, or not playing)
      if (el.hidden || now - lastPaint < 200) return;
      lastPaint = now;
      const me = net.state.players.get(net.sessionId);
      const cell = me ? `${me.fromX},${me.fromY},${me.fromZ}` : '-';
      const upFwd = me ? `${dirName(me.fromUp as Dir)} / ${dirName(me.fromFwd as Dir)}` : '-';
      el.textContent = [
        `fps           ${fps.toFixed(0)}   draw calls ${drawCalls}`,
        `phase         ${net.state.phase}   server tick ${net.state.tick}`,
        `estServerTick ${net.estServerTick.toFixed(2)}   renderTick ${renderTick.toFixed(2)}`,
        `ping          ${net.ping} ms   patches ${net.patchRate.toFixed(1)}/s`,
        `input→motion  ${latency ? `${latency.toFixed(0)} ms` : '-'}   local interp ${localInterp}`,
        `late segs     ${late.count} (max ${late.max.toFixed(2)} ticks)`,
        `me            ${localAction === null ? '-' : ACTION_NAMES[localAction]} (server ${me ? ACTION_NAMES[me.action] : '-'})`,
        `cell          ${cell}   up/fwd ${upFwd}`,
        ...extra,
      ].join('\n');
    },
  };
}
