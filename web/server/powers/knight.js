'use strict';
// Knight: the greatsword turns into a shotgun after each kill; the Ashen Guard blocks frontal hits (a last-moment
// raise parries: no damage, a close melee attacker staggers, the next sword hit is a double-damage riposte);
// 4 kills in a row arm the Cinder Crash, a leap that slams down in a shockwave.
const Sim = require('../../shared/sim');
const { io, now, r3, v3 } = require('../core');
const { addFeed } = require('../rooms');
const { applyDamage } = require('../combat');

const UNBLOCKABLE = new Set(['beam', 'fire', 'crash']);

/** Cinder Crash landing: a shockwave that hurts and hurls everyone nearby (walls shield you). */
function handleCrash(room, shooter) {
  const s = shooter.sim, o = { x: s.x, y: s.y + 1, z: s.z };
  io.to(room.code).emit('crash', { id: shooter.id, p: [r3(s.x), r3(s.y), r3(s.z)] });
  for (const target of room.players.values()) {
    if (target === shooter || !target.sim.alive) continue;
    const ts = target.sim, c = { x: ts.x, y: ts.y + 1, z: ts.z };
    const dx = c.x - o.x, dy = c.y - o.y, dz = c.z - o.z, d = Math.hypot(dx, dy, dz);
    const dmg = Sim.crashDamage(d);
    if (!dmg) continue;
    const wall = Sim.raycastWorld(o, { x: dx / d, y: dy / d, z: dz / d }, d);
    if (wall && wall.t < d - 0.4) continue;
    const killed = applyDamage(room, shooter, target, dmg, 'body', c, 'crash');
    if (!killed) { const h = Math.hypot(dx, dz) || 1, k = Sim.CRASH_KNOCK * (1 - d / Sim.CRASH_RADIUS * 0.5); ts.vx += dx / h * k; ts.vz += dz / h * k; ts.vy = Math.max(ts.vy, 5.5); ts.og = false; }
  }
}

module.exports = {
  // Ashen Guard: runs before every other damage rule
  damage(room, shooter, target, dmg, { weapon, part, point, t }) {
    if (UNBLOCKABLE.has(weapon) || !Sim.guardBlocks(target.sim, shooter.sim.x, shooter.sim.z)) return dmg;
    const melee = weapon === Sim.WEAPON.SWORD || weapon === Sim.WEAPON.CLAWS;
    if (target.sim.guardT <= Sim.PARRY_TICKS && t - (target.guardAt || 0) <= Sim.PARRY_TICKS * Sim.DT * 1000 + 60) { // window in ticks AND real time
      target.riposteUntil = t + Sim.RIPOSTE_MS;
      const close = Math.hypot(shooter.sim.x - target.sim.x, shooter.sim.z - target.sim.z) < 4.5;
      if (melee && close) shooter.sim.stag = Sim.STAGGER_TICKS;
      io.to(room.code).emit('guard', { id: target.id, by: shooter.id, parry: true, stag: melee && close, w: weapon, p: v3(point) });
      io.to(shooter.id).emit('hit', { id: target.id, d: 0, part, k: false, p: v3(point), blocked: true, parried: true, w: weapon });
      return null;
    }
    io.to(room.code).emit('guard', { id: target.id, by: shooter.id, parry: false, w: weapon, p: v3(point) });
    return Math.max(1, Math.round(dmg * Sim.GUARD_FACTOR));
  },
  // riposte: the first sword hit after a parry
  swingDamage(room, shooter, dmg, claws, t) {
    if (claws || !(shooter.riposteUntil > t)) return dmg;
    shooter.riposteUntil = 0; io.to(room.code).emit('riposte', { id: shooter.id });
    return dmg * 2;
  },
  kill(room, shooter) {
    if (Sim.classOf(shooter.sim).key === 'knight' && shooter.sim.alive && shooter.streak >= Sim.CRASH_STREAK && !shooter.sim.crash && !shooter.sim.crashT) {
      shooter.sim.crash = 1; shooter.streak = 0;
      io.to(room.code).emit('crashReady', { id: shooter.id });
      addFeed(room, `${shooter.name}'s blade ignites — CINDER CRASH`, 'kill');
    }
  },
  // every kill reforges the greatsword into the Pyre shotgun
  afterKill(room, shooter) { if (shooter.sim.alive && Sim.grantShotgun(shooter.sim)) io.to(room.code).emit('transform', { id: shooter.id }); },
  death(room, target) { target.sim.crash = 0; target.sim.guard = 0; },
  event(room, p, ev) {
    if (ev.guardUp) p.guardAt = p.sim.guardT <= 1 ? now() : 0; // a fresh raise opens the parry window
    if (ev.crashStart) io.to(room.code).except(p.id).emit('crashLeap', { id: p.id });
    if (ev.crashLand) handleCrash(room, p);
    if (ev.sheathe) io.to(room.code).emit('sheathe', { id: p.id });
  },
  debug(room, p, d) { if (d.grant) Sim.grantShotgun(p.sim); if (d.crash) p.sim.crash = 1; }
};
