'use strict';
// Combat: damage (shield first, then health), kills and streaks, and the shared weapons (rifle, sniper, shotgun, melee).
// Class-specific rules (guard, adaptation, streak powers) plug in through server/hooks.js.
const Sim = require('../shared/sim');
const { RESPAWN_MS } = require('./config');
const { io, now, r3, v3, endPoint } = require('./core');
const { hooks } = require('./hooks');
const { addFeed, emitMeta } = require('./rooms');
const { positionAt, rewindTime, rayTargets } = require('./lagcomp');

// kill-feed wording per weapon ('▸' for a plain rifle kill)
const KILL_WORDS = { beam: '✦ OBLITERATED', crash: '☄ crushed', claws: '☬ torn apart by', fire: '🔥 burned', sword: '⚔', shotgun: '✸' };

/**
 * Apply damage: class hooks first (guard/parry, adaptation), then the energy shield soaks it, then health.
 * Returns true if the target was eliminated.
 */
function applyDamage(room, shooter, target, raw, part, point, weapon) {
  const t = now();
  if (t < target.protectUntil) {
    io.to(shooter.id).emit('hit', { id: target.id, d: 0, part, k: false, p: v3(point), blocked: true, w: weapon });
    return false;
  }
  const hardened = target.shieldUntil > t;
  let dmg = raw;
  const ctx = { weapon, part, point, t };
  for (const h of hooks.damage) { dmg = h(room, shooter, target, dmg, ctx); if (dmg === null) return false; }
  const absorbed = Math.min(target.shield, dmg);
  const hadShield = target.shield > 0;
  target.shield -= absorbed;
  target.hp = Math.max(0, target.hp - (dmg - absorbed));
  target.hurtAt = t;
  const killed = target.hp <= 0;
  const broke = hadShield && target.shield <= 0;
  io.to(shooter.id).emit('hit', { id: target.id, d: dmg, part, k: killed, p: v3(point), shielded: hardened, sh: absorbed > 0, brk: broke, w: weapon });
  io.to(target.id).emit('hurt', { d: dmg, part, hp: target.hp, sh: Math.round(target.shield), brk: broke, from: [r3(shooter.sim.x), r3(shooter.sim.z)], by: shooter.id, w: weapon });
  if (killed) {
    target.sim.alive = false; target.deaths++;
    target.respawnAt = t + RESPAWN_MS;
    target.streak = 0; // dying loses the streak (and, via the death hooks, any charged power)
    for (const h of hooks.death) h(room, target);
    shooter.kills++; shooter.score += part === 'head' ? 125 : 100;
    shooter.streak = (shooter.streak || 0) + 1;
    for (const h of hooks.kill) h(room, shooter, target, weapon);
    const how = KILL_WORDS[weapon] || (part === 'head' ? '⊕ headshot' : '▸');
    addFeed(room, `${shooter.name} ${how} ${target.name}`, 'kill');
    io.to(room.code).emit('killed', { killer: shooter.id, victim: target.id, head: part === 'head', w: weapon, pos: [r3(target.sim.x), r3(target.sim.y), r3(target.sim.z)] });
    for (const h of hooks.afterKill) h(room, shooter, target, weapon);
    emitMeta(room);
  }
  return killed;
}

/** Rifle / sniper: one lag-compensated ray. */
function handleShot(room, shooter, input, ev) {
  const t = now();
  const s = shooter.sim;
  const sniper = !!ev.sniper, range = sniper ? Sim.SNIPER_RANGE : Sim.MAX_RANGE;
  const origin = Sim.eyeOf(s);
  const dir = sniper ? Sim.sniperDir(s.yaw, s.pitch, input.s, ev.scoped) : Sim.aimDirection(s.yaw, s.pitch);
  const world = Sim.raycastWorld(origin, dir, range);
  const maxT = world ? world.t : range;
  const best = rayTargets(room, shooter, origin, dir, maxT, rewindTime(t, input.vt));
  const end = endPoint(origin, dir, best ? best.t : maxT);
  const shot = {
    id: shooter.id, o: v3(origin), e: v3(end),
    n: !best && world ? world.n : null,
    k: !best && world ? world.kind : null,
    h: best ? best.target.id : null
  };
  if (sniper) shot.w = 'sn';
  io.to(room.code).except(shooter.id).emit('shot', shot);
  if (!best) return;
  const weapon = sniper ? Sim.WEAPON.SNIPER : Sim.WEAPON.RIFLE;
  applyDamage(room, shooter, best.target, Sim.damageFor(best.part, best.t, best.target.shieldUntil > t, weapon), best.part, end, weapon);
}

/** Shotgun: 8 pellets (same seeded spread as the shooter's client); damage is summed per target. */
function handleShotgun(room, shooter, input) {
  const t = now();
  const s = shooter.sim;
  const origin = Sim.eyeOf(s);
  const rewindT = rewindTime(t, input.vt);
  const pellets = [], perTarget = new Map();
  for (const dir of Sim.pelletDirs(s.yaw, s.pitch, input.s)) {
    const world = Sim.raycastWorld(origin, dir, Sim.SHOTGUN_RANGE);
    const maxT = world ? world.t : Sim.SHOTGUN_RANGE;
    const best = rayTargets(room, shooter, origin, dir, maxT, rewindT);
    const end = endPoint(origin, dir, best ? best.t : maxT);
    pellets.push({ e: v3(end), n: !best && world ? world.n : null, k: !best && world ? world.kind : null, h: best ? best.target.id : null });
    if (best) {
      const agg = perTarget.get(best.target) || { dmg: 0, head: false, point: end };
      agg.dmg += Sim.damageFor(best.part, best.t, best.target.shieldUntil > t, Sim.WEAPON.SHOTGUN);
      agg.head = agg.head || best.part === 'head';
      perTarget.set(best.target, agg);
    }
  }
  io.to(room.code).except(shooter.id).emit('shot', { id: shooter.id, o: v3(origin), w: 'sg', pe: pellets });
  for (const [target, agg] of perTarget) if (target.sim.alive) applyDamage(room, shooter, target, agg.dmg, agg.head ? 'head' : 'body', agg.point, Sim.WEAPON.SHOTGUN);
}

/** Greatsword swing / Rune-Warden claws: the closest enemy inside the cone (lag compensated, blocked by walls). */
function handleSwing(room, shooter, viewTime, claws = false) {
  const t = now();
  const s = shooter.sim;
  const eye = Sim.eyeOf(s);
  const dir = Sim.aimDirection(s.yaw, s.pitch);
  const rewindT = rewindTime(t, viewTime);
  let best = null;
  for (const target of room.players.values()) {
    if (target === shooter || !target.sim.alive) continue;
    const pos = positionAt(target, rewindT);
    if (!pos.alive) continue;
    const hit = Sim.swordReach(eye, dir, pos, claws);
    if (!hit) continue;
    const d = { x: (hit.point.x - eye.x) / hit.t, y: (hit.point.y - eye.y) / hit.t, z: (hit.point.z - eye.z) / hit.t };
    const wall = Sim.raycastWorld(eye, d, hit.t);
    if (wall && wall.t < hit.t - 0.3) continue;
    if (!best || hit.t < best.t) best = { target, ...hit };
  }
  const weapon = claws ? Sim.WEAPON.CLAWS : Sim.WEAPON.SWORD;
  io.to(room.code).except(shooter.id).emit('swing', { id: shooter.id, h: best ? best.target.id : null, p: best ? v3(best.point) : null, c: claws });
  if (!best) return;
  let dmg = Sim.damageFor(best.part, best.t, best.target.shieldUntil > t, weapon);
  for (const h of hooks.swingDamage) dmg = h(room, shooter, dmg, claws, t);
  applyDamage(room, shooter, best.target, dmg, best.part, best.point, weapon);
}

module.exports = { applyDamage, handleShot, handleShotgun, handleSwing };
