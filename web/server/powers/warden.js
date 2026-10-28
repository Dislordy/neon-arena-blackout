'use strict';
// Soldier streak power: 3 kills in a row awaken the runes -> 20 s as the Rune-Warden (250 HP, claws), which adapts:
// every hit from the same weapon type does 15% less than the last (up to 60%).
const Sim = require('../../shared/sim');
const { io } = require('../core');
const { addFeed, emitMeta } = require('../rooms');

module.exports = {
  damage(room, shooter, target, dmg, { weapon }) {
    if (target.sim.mon <= 0) return dmg;
    const key = weapon || 'rifle', n = (target.adapt[key] || 0);
    if (n < Sim.ADAPT_MAX) { target.adapt[key] = n + 1; io.to(room.code).emit('adapt', { id: target.id, w: key, n: n + 1 }); }
    return Math.max(1, Math.round(dmg * (1 - Sim.ADAPT_STEP * n)));
  },
  kill(room, shooter) {
    if (Sim.classOf(shooter.sim).key === 'soldier' && shooter.sim.alive && shooter.streak >= Sim.MON_STREAK && !shooter.sim.mon && !shooter.sim.monT) {
      shooter.sim.monT = Sim.MON_RISE_TICKS; shooter.streak = 0;
      io.to(room.code).emit('monRise', { id: shooter.id });
      addFeed(room, `${shooter.name}'s runes awaken`, 'kill');
    }
  },
  death(room, target) { target.adapt = {}; },
  event(room, p, ev) {
    if (ev.monStart) { p.hp = Sim.MON_HP; p.shield = Sim.classOf(p.sim).shield; p.adapt = {}; io.to(room.code).emit('monStart', { id: p.id }); emitMeta(room); }
    if (ev.monEnd) { p.hp = Math.max(1, Math.round(p.hp / Sim.MON_HP * Sim.classOf(p.sim).hp)); p.adapt = {}; io.to(room.code).emit('monEnd', { id: p.id }); emitMeta(room); }
  },
  debug(room, p, d) { if (d.mon) { p.sim.monT = d.mon === 'rise' ? Sim.MON_RISE_TICKS : 2; io.to(room.code).emit('monRise', { id: p.id }); } }
};
