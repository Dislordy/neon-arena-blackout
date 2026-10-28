'use strict';
// Assassin streak power: 5 kills in a row charge the Obliteration Beam (the next shot), which kills everything
// in a 14 m-wide line and sets that half of the alley on fire. Two beams aimed at each other start a Beam Clash.
const crypto = require('crypto');
const Sim = require('../../shared/sim');
const { io, now, r3, v3 } = require('../core');
const { addFeed } = require('../rooms');
const { applyDamage } = require('../combat');

function handleBeam(room, shooter, axisOverride = null, noClash = false) {
  const t = now(), s = shooter.sim;
  const origin = Sim.eyeOf(s), axis = axisOverride || Sim.beamAxis(s.yaw);
  // fired at someone who is charging (or holding) their own beam and aiming back? -> BEAM CLASH
  if (!noClash) { const rival = findClashRival(room, shooter, origin, axis); if (rival) return startClash(room, shooter, rival); }
  for (const target of room.players.values()) {
    if (target === shooter || !target.sim.alive) continue;
    if (Sim.inBeam(origin, axis, target.sim)) applyDamage(room, shooter, target, 9999, 'body', { x: target.sim.x, y: target.sim.y + 1, z: target.sim.z }, 'beam');
  }
  const zone = Sim.fireZoneFor(origin, axis);
  room.fireZone = Object.assign({ by: shooter.id, until: t + Sim.FIRE_ZONE_MS, next: t + 250 }, zone);
  io.to(room.code).emit('beam', { id: shooter.id, o: v3(origin), d: [r3(axis.x), r3(axis.z)], zone, ms: Sim.FIRE_ZONE_MS, clash: noClash });
}

// ------------------------------------------------------------ beam clash
const CLASH_SHOUTS = ['ALL OR NOTHING!', 'NOT TODAY!', 'BURN WITH ME!', 'THIS ENDS NOW!', 'NOTHING STOPS THIS!',
  'THEN TAKE IT ALL!', 'LIGHTS OUT!', 'SEE YOU IN THE STATIC!', 'I DON\'T BREAK!', 'ONE OF US IS GOING HOME!'];
function findClashRival(room, shooter, origin, axis) {
  if (room.clash) return null;
  for (const q of room.players.values()) {
    if (q === shooter || !q.sim.alive || !(q.sim.ultT > 0 || q.sim.ult === 1)) continue;
    if (!Sim.inBeam(origin, axis, q.sim)) continue;
    if (!Sim.inBeam(Sim.eyeOf(q.sim), Sim.beamAxis(q.sim.yaw), shooter.sim)) continue; // must be aiming back
    return q;
  }
  return null;
}
function startClash(room, a, b) {
  const t = now(), total = Sim.CLASH_INTRO_MS + Sim.CLASH_QTE_MS + Sim.CLASH_OUTRO_MS;
  const seq = Array.from({ length: Sim.CLASH_SEQ }, () => Sim.CLASH_KEYS[crypto.randomInt(4)]);
  for (const p of [a, b]) {
    p.sim.lock = Math.ceil((total + 300) / 1000 * Sim.TICK_RATE); p.sim.ultT = 0; p.sim.ult = 0;
    p.protectUntil = Math.max(p.protectUntil, t + total + 300);
  }
  const shouts = [0, 1].map(() => CLASH_SHOUTS[crypto.randomInt(CLASH_SHOUTS.length)]);
  room.clash = {
    a: a.id, b: b.id, seq, prog: { [a.id]: 0, [b.id]: 0 }, miss: { [a.id]: 0, [b.id]: 0 }, rate: { [a.id]: [], [b.id]: [] },
    qteFrom: t + Sim.CLASH_INTRO_MS, qteTo: t + Sim.CLASH_INTRO_MS + Sim.CLASH_QTE_MS, nextState: t
  };
  addFeed(room, `BEAM CLASH · ${a.name} vs ${b.name}`, 'kill');
  io.to(room.code).emit('clashStart', {
    a: a.id, b: b.id, oa: v3(Sim.eyeOf(a.sim)), ob: v3(Sim.eyeOf(b.sim)), seq, shouts,
    intro: Sim.CLASH_INTRO_MS, qte: Sim.CLASH_QTE_MS, outro: Sim.CLASH_OUTRO_MS
  });
}
function clashKey(room, p, k) {
  const c = room.clash, t = now();
  if (!c || (p.id !== c.a && p.id !== c.b) || t < c.qteFrom || t > c.qteTo) return;
  const r = c.rate[p.id]; r.push(t); while (r.length && r[0] < t - 1000) r.shift();
  if (r.length > 20 || t < c.miss[p.id]) return;                  // humanly impossible rates / stunned
  if (k === c.seq[c.prog[p.id] % c.seq.length]) c.prog[p.id]++;
  else c.miss[p.id] = t + Sim.CLASH_MISS_MS;
}
function updateClash(room, t) {
  const c = room.clash;
  if (!c) return;
  const A = room.players.get(c.a), B = room.players.get(c.b);
  if (!A || !B) return endClash(room, A || B, A ? B : A, false); // someone left: the other wins
  if (t >= c.nextState && t <= c.qteTo + 50) { c.nextState = t + 100; io.to(room.code).emit('clashState', { p: [c.prog[c.a], c.prog[c.b]] }); }
  if (t < c.qteTo) return;
  const pa = c.prog[c.a], pb = c.prog[c.b];
  if (pa === pb) endClash(room, A, B, true); else if (pa > pb) endClash(room, A, B, false); else endClash(room, B, A, false);
}
function endClash(room, winner, loser, tie) {
  const c = room.clash; room.clash = null;
  const outroTicks = Math.ceil(Sim.CLASH_OUTRO_MS / 1000 * Sim.TICK_RATE);
  for (const p of [winner, loser]) if (p) { p.sim.lock = Math.min(p.sim.lock, outroTicks); p.protectUntil = 0; }
  io.to(room.code).emit('clashEnd', { winner: winner ? winner.id : null, loser: loser ? loser.id : null, tie, p: [c.prog[c.a], c.prog[c.b]], a: c.a });
  if (!winner) return;
  if (tie) { // both beams detonate in the middle: double obliteration
    const mid = loser ? { x: (winner.sim.x + loser.sim.x) / 2, y: 1.5, z: (winner.sim.z + loser.sim.z) / 2 } : winner.sim;
    applyDamage(room, loser, winner, 9999, 'body', mid, 'beam');
    if (loser) applyDamage(room, winner, loser, 9999, 'body', mid, 'beam');
    return;
  }
  // the winner's beam overpowers the loser's and carries on through them
  let axis = null;
  if (loser) { const dx = loser.sim.x - winner.sim.x, dz = loser.sim.z - winner.sim.z, l = Math.hypot(dx, dz) || 1; axis = { x: dx / l, y: 0, z: dz / l }; }
  handleBeam(room, winner, axis, true);
}
/** The burning half of the alley: damage ticks four times a second for everyone but the shooter. */
function burnFireZone(room, t) {
  const z = room.fireZone;
  if (!z) return;
  const owner = room.players.get(z.by);
  if (t >= z.until || !owner) { room.fireZone = null; return; }
  if (t < z.next) return;
  z.next = t + 250;
  for (const p of room.players.values()) {
    if (p === owner || !p.sim.alive || !Sim.inFireZone(z, p.sim)) continue;
    applyDamage(room, owner, p, Sim.FIRE_DPS / 4, 'body', { x: p.sim.x, y: p.sim.y + 0.5, z: p.sim.z }, 'fire');
  }
}

module.exports = {
  kill(room, shooter) {
    if (Sim.weaponOf(shooter.sim) === Sim.WEAPON.SNIPER && shooter.sim.alive && shooter.streak >= Sim.ULT_STREAK && !shooter.sim.ult && !shooter.sim.ultT) {
      shooter.sim.ult = 1; shooter.streak = 0;
      io.to(room.code).emit('ultReady', { id: shooter.id });
      addFeed(room, `${shooter.name} has the OBLITERATION BEAM`, 'kill');
    }
  },
  death(room, target) { target.sim.ult = 0; target.sim.ultT = 0; },
  event(room, p, ev) {
    if (ev.ultStart) io.to(room.code).except(p.id).emit('ultCharge', { id: p.id });
    if (ev.ultFire) handleBeam(room, p);
  },
  roomTick(room, t) { burnFireZone(room, t); updateClash(room, t); },
  matchStart(room) { room.fireZone = null; room.clash = null; },
  socket(socket, { getRoom, getMe }) {
    socket.on('clashKey', ({ k } = {}) => {
      const room = getRoom(), p = getMe();
      if (room && p && room.phase === 'playing' && Sim.CLASH_KEYS.includes(k)) clashKey(room, p, k);
    });
  },
  debug(room, p, d) { if (d.ult) p.sim.ult = 1; }
};
