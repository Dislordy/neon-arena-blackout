'use strict';
// The 60 Hz authoritative loop: run queued inputs through the shared simulation, resolve what happened,
// refill shields, respawn the dead, and stream snapshots at 30 Hz.
const Sim = require('../shared/sim');
const C = require('./config');
const { io, rooms, now, r3 } = require('./core');
const { hooks } = require('./hooks');
const { emitMeta, placeAtSpawn } = require('./rooms');
const { recordHistory } = require('./lagcomp');
const { handleShot, handleShotgun, handleSwing } = require('./combat');

function tickRoom(room) {
  const t = now();
  room.tick++;
  for (const p of room.players.values()) {
    p.budget = Math.min(C.MAX_BUDGET, p.budget + Sim.DT);
    let processed = 0;
    while (p.queue.length && p.budget >= Sim.DT - 1e-9 && processed < C.MAX_INPUTS_PER_TICK) {
      const input = p.queue.shift();
      p.budget -= Sim.DT; processed++;
      p.lastSeq = input.s;
      const ev = Sim.stepPlayer(p.sim, input);
      if (ev.fire && ev.shotgun) handleShotgun(room, p, input);
      else if (ev.fire) handleShot(room, p, input, ev);
      if (ev.swing) handleSwing(room, p, input.vt, !!ev.claw);
      for (const h of hooks.event) h(room, p, ev, input);
    }
    // energy shield refills after a few seconds without taking damage
    const K = Sim.classOf(p.sim);
    if (p.sim.alive && p.shield < K.shield && t - p.hurtAt > Sim.SHIELD_REGEN_DELAY_MS) p.shield = Math.min(K.shield, p.shield + Sim.SHIELD_REGEN_PER_S * Sim.DT);
    if (!p.sim.alive && p.respawnAt && t >= p.respawnAt) {
      p.respawnAt = 0;
      placeAtSpawn(room, p);
      io.to(room.code).emit('respawned', { id: p.id });
      emitMeta(room);
    }
  }
  for (const h of hooks.roomTick) h(room, t);
  recordHistory(room, t);
  if (room.tick % Sim.SNAPSHOT_EVERY === 0) sendSnapshots(room, t);
}

/** Snapshot flags (bit -> meaning) read by the client's avatars and HUD. */
function flagsOf(p, t) {
  const s = p.sim;
  return (s.alive ? 1 : 0) | (p.shieldUntil > t ? 2 : 0) | (s.reload > 0 ? 4 : 0) | (s.og ? 8 : 0) | (s.dashT > 0 ? 16 : 0)
    | (t < p.protectUntil ? 32 : 0) | (s.wpn ? 64 : 0) | (p.shield > 0 ? 128 : 0) | (s.ultT > 0 ? 256 : 0) | (s.ult === 1 ? 512 : 0)
    | (s.mon > 0 ? 1024 : 0) | (s.monT > 0 ? 2048 : 0) | (s.guard ? 4096 : 0) | (s.stag > 0 ? 8192 : 0) | (s.crash === 1 ? 16384 : 0) | (s.crashT > 0 ? 32768 : 0);
}
function sendSnapshots(room, t) {
  const others = [];
  for (const p of room.players.values()) {
    const s = p.sim;
    others.push([p.id, r3(s.x), r3(s.y), r3(s.z), r3(s.yaw), r3(s.pitch), flagsOf(p, t), r3(s.vx), r3(s.vz)]);
  }
  for (const p of room.players.values()) {
    io.to(p.id).emit('snap', {
      t: Math.round(t * 10) / 10,
      ack: p.lastSeq,
      me: Sim.copyState(p.sim), hp: p.hp, sh: Math.round(p.shield), st: p.streak || 0, tp: p.teleported || false,
      cd: { shield: Math.max(0, p.shieldCdUntil - t), scan: Math.max(0, p.scanCdUntil - t), shieldOn: Math.max(0, p.shieldUntil - t) },
      ps: others
    });
    p.teleported = false;
  }
}

let lastLoop = now(), acc = 0, timer = null;
function gameLoop() {
  const t = now();
  acc += Math.min(0.25, (t - lastLoop) / 1000);
  lastLoop = t;
  while (acc >= Sim.DT) {
    acc -= Sim.DT;
    for (const room of rooms.values()) if (room.phase === 'playing') tickRoom(room);
  }
}
function startLoop() { if (!timer) { lastLoop = now(); timer = setInterval(gameLoop, 1000 / 120); } }
module.exports = { startLoop };
