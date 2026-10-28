'use strict';
// Lag compensation: a short position history per player, so hits are checked against what the shooter saw.
const Sim = require('../shared/sim');
const { HISTORY_MS } = require('./config');

function recordHistory(room, t) {
  for (const p of room.players.values()) {
    p.history.push({ t, x: p.sim.x, y: p.sim.y, z: p.sim.z, alive: p.sim.alive, s: Sim.scaleOf(p.sim) });
    while (p.history.length && p.history[0].t < t - HISTORY_MS) p.history.shift();
  }
}
/** Where was this player at server time t? (linear interpolation of history) */
function positionAt(p, t) {
  const h = p.history;
  if (!h.length || t >= h[h.length - 1].t) return { x: p.sim.x, y: p.sim.y, z: p.sim.z, alive: p.sim.alive, s: Sim.scaleOf(p.sim) };
  if (t <= h[0].t) return h[0];
  for (let i = h.length - 1; i > 0; i--) {
    const a = h[i - 1], b = h[i];
    if (t >= a.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, alive: a.alive && b.alive, s: k < 0.5 ? a.s : b.s };
    }
  }
  return h[0];
}
/** Rewind time: what the shooter was looking at, within limits. */
function rewindTime(t, viewTime) {
  return Number.isFinite(viewTime) ? Math.min(t, Math.max(t - Sim.MAX_REWIND_MS, viewTime)) : t - Sim.INTERP_DELAY_MS;
}
/** Closest player hit by a ray (against rewound positions), or null. */
function rayTargets(room, shooter, origin, dir, maxT, rewindT) {
  let best = null;
  for (const target of room.players.values()) {
    if (target === shooter || !target.sim.alive) continue;
    const pos = positionAt(target, rewindT);
    if (!pos.alive) continue;
    const hit = Sim.rayPlayer(origin, dir, pos, maxT);
    if (hit && (!best || hit.t < best.t)) best = { target, t: hit.t, part: hit.part };
  }
  return best;
}
module.exports = { recordHistory, positionAt, rewindTime, rayTargets };
