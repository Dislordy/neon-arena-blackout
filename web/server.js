'use strict';
/*
 * NEON ARENA: BLACKOUT — authoritative game server.
 *
 * Clients only send *inputs* (movement keys, view angles, buttons). The server
 * runs the shared simulation (shared/sim.js) at 60 Hz, owns every player's
 * position, ammo, health and score, performs hit detection with lag
 * compensation against a position history, and streams snapshots back.
 */
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { Server } = require('socket.io');
const Sim = require('./shared/sim');

const PORT = process.env.PORT || 3000;
const MATCH_MS = Number(process.env.MATCH_MS) || 4 * 60 * 1000;
const RESPAWN_MS = 2500;
const SPAWN_PROTECT_MS = 1600;
const MAX_PLAYERS = 8;
const MAX_QUEUE = 40;                  // max buffered input commands per player
const MAX_BUDGET = 0.3;                // seconds of simulation a client can "bank" (jitter tolerance)
const MAX_INPUTS_PER_TICK = 8;
const HISTORY_MS = 1000;
const ABILITIES = {
  shield: { duration: 2200, cooldown: 9000 },
  scan: { duration: 1400, cooldown: 12000 }
};
const COLORS = ['#00f5ff', '#ff36c7', '#b6ff4a', '#ffb347', '#9b7bff', '#ff5f6d', '#56e39f', '#f4f7ff'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 16 * 1024 });

// Log page loads (not every asset) so hosting problems are easy to diagnose in the host's logs.
app.use((req, res, next) => {
  if (req.path === '/') { // not /health: the host polls that every few seconds
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace(/\.\d+$/, '.x');
    console.log(`[http] ${req.method} ${req.path} from ${ip} (${String(req.headers['user-agent'] || '').slice(0, 40)})`);
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));
app.get('/health', (_, res) => res.json({ ok: true, game: 'NEON ARENA: BLACKOUT', rooms: rooms.size }));

const rooms = new Map();
const now = () => performance.now();
const wallNow = () => Date.now();

function makeCode() {
  let code;
  do code = Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  while (rooms.has(code));
  return code;
}
function addFeed(room, message, kind = 'info') {
  room.feed.push({ id: crypto.randomUUID(), message, kind, at: wallNow() });
  room.feed = room.feed.slice(-8);
}
function publicMeta(p) {
  return { id: p.id, name: p.name, color: p.color, score: p.score, kills: p.kills, deaths: p.deaths, alive: p.sim.alive, hp: p.hp, cls: p.sim.cls, next: p.nextCls };
}
const validClass = c => (Number.isInteger(c) && Sim.CLASSES[c] ? c : 0);
/** Full health + shield for the player's class. */
function refill(p) { const C = Sim.classOf(p.sim); p.hp = C.hp; p.shield = C.shield; p.hurtAt = 0; p.adapt = {}; }
function metaState(room) {
  return {
    code: room.code, phase: room.phase, host: room.hostId,
    timeLeft: room.phase === 'playing' ? Math.max(0, Math.ceil((room.endsAt - now()) / 1000)) : 0,
    players: [...room.players.values()].map(publicMeta), feed: room.feed.slice(-5)
  };
}
function emitMeta(room) { io.to(room.code).emit('state', metaState(room)); }

function chooseSpawn(room, self) {
  // Pick the spawn point that is furthest from every living enemy.
  let best = Sim.spawns[0], bestScore = -Infinity;
  for (const s of Sim.spawns) {
    if (!Sim.isFree(s.x, 0, s.z)) continue;
    let minD = 60;
    for (const q of room.players.values()) {
      if (q === self || !q.sim.alive) continue;
      minD = Math.min(minD, Math.hypot(q.sim.x - s.x, q.sim.z - s.z));
    }
    const score = minD + Math.random() * 4;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}
function placeAtSpawn(room, p) {
  const s = chooseSpawn(room, p);
  const keep = { yaw: Math.atan2(s.x, s.z), pitch: 0 }; // face the arena centre
  p.sim = Sim.newPlayerState(s.x, s.z, p.nextCls);
  p.sim.yaw = keep.yaw;
  refill(p);
  p.protectUntil = now() + SPAWN_PROTECT_MS;
  p.history = [];
  p.teleported = true; // tells the client to snap instead of smoothing
}

function stopTimer(room) { if (room.timer) clearInterval(room.timer); room.timer = null; }
function startMatch(room) {
  if (room.players.size < 2 || room.phase === 'playing') return false;
  room.phase = 'playing'; room.endsAt = now() + MATCH_MS; room.feed = []; room.winner = null; room.tick = 0; room.fireZone = null; room.clash = null;
  for (const p of room.players.values()) {
    Object.assign(p, { score: 0, kills: 0, deaths: 0, streak: 0, queue: [], budget: 0, shieldUntil: 0, shieldCdUntil: 0, scanCdUntil: 0, respawnAt: 0 });
  }
  for (const p of room.players.values()) placeAtSpawn(room, p);
  addFeed(room, 'BLACKOUT initiated. Good hunting.');
  stopTimer(room);
  room.timer = setInterval(() => {
    if (!rooms.has(room.code)) return stopTimer(room);
    if (now() >= room.endsAt) endMatch(room); else emitMeta(room);
  }, 500);
  io.to(room.code).emit('matchStarted', { endsIn: MATCH_MS });
  emitMeta(room);
  return true;
}
function endMatch(room) {
  if (room.phase !== 'playing') return;
  room.phase = 'results'; stopTimer(room);
  const ranked = [...room.players.values()].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
  io.to(room.code).emit('matchEnded', {
    winner: ranked[0] ? ranked[0].name : 'Nobody',
    rankings: ranked.map((p, i) => ({ place: i + 1, name: p.name, score: p.score, kills: p.kills, deaths: p.deaths, color: p.color }))
  });
  emitMeta(room);
}
function cleanRoom(code) {
  const room = rooms.get(code);
  if (room && room.players.size === 0) { stopTimer(room); rooms.delete(code); }
}

// ------------------------------------------------------- lag compensation
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

// ------------------------------------------------------------ combat
/** Rewind time for lag compensation: what the shooter was looking at, within limits. */
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
const endPoint = (o, d, t) => ({ x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t });
const v3 = p => [r3(p.x), r3(p.y), r3(p.z)];

/**
 * Apply damage: the energy shield soaks it first, then health.
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
  // Knight's Ashen Guard: frontal hits are blocked; raised at the last moment, they are parried
  if (weapon !== 'beam' && weapon !== 'fire' && weapon !== 'crash' && Sim.guardBlocks(target.sim, shooter.sim.x, shooter.sim.z)) {
    const melee = weapon === Sim.WEAPON.SWORD || weapon === Sim.WEAPON.CLAWS;
    if (target.sim.guardT <= Sim.PARRY_TICKS && t - (target.guardAt || 0) <= Sim.PARRY_TICKS * Sim.DT * 1000 + 60) { // window in ticks AND real time
      target.riposteUntil = t + Sim.RIPOSTE_MS;
      const close = Math.hypot(shooter.sim.x - target.sim.x, shooter.sim.z - target.sim.z) < 4.5;
      if (melee && close) shooter.sim.stag = Sim.STAGGER_TICKS;
      io.to(room.code).emit('guard', { id: target.id, by: shooter.id, parry: true, stag: melee && close, w: weapon, p: v3(point) });
      io.to(shooter.id).emit('hit', { id: target.id, d: 0, part, k: false, p: v3(point), blocked: true, parried: true, w: weapon });
      return false;
    }
    dmg = Math.max(1, Math.round(dmg * Sim.GUARD_FACTOR));
    io.to(room.code).emit('guard', { id: target.id, by: shooter.id, parry: false, w: weapon, p: v3(point) });
  }
  // Rune-Warden adaptation: every hit from the same weapon type does 15% less the next time (up to 60%)
  if (target.sim.mon > 0) {
    const key = weapon || 'rifle', n = (target.adapt[key] || 0);
    dmg = Math.max(1, Math.round(dmg * (1 - Sim.ADAPT_STEP * n)));
    if (n < Sim.ADAPT_MAX) { target.adapt[key] = n + 1; io.to(room.code).emit('adapt', { id: target.id, w: key, n: n + 1 }); }
  }
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
    target.streak = 0; target.sim.ult = 0; target.sim.ultT = 0; target.sim.crash = 0; target.sim.guard = 0; // dying loses the streak and a charged power
    shooter.kills++; shooter.score += part === 'head' ? 125 : 100;
    shooter.streak = (shooter.streak || 0) + 1;
    // Assassin: 5 kills in a row charge the Obliteration Beam (the next shot)
    if (Sim.weaponOf(shooter.sim) === Sim.WEAPON.SNIPER && shooter.sim.alive && shooter.streak >= Sim.ULT_STREAK && !shooter.sim.ult && !shooter.sim.ultT) {
      shooter.sim.ult = 1; shooter.streak = 0;
      io.to(room.code).emit('ultReady', { id: shooter.id });
      addFeed(room, `${shooter.name} has the OBLITERATION BEAM`, 'kill');
    }
    // Soldier: 3 kills in a row awaken the runes -> Rune-Warden
    if (Sim.classOf(shooter.sim).key === 'soldier' && shooter.sim.alive && shooter.streak >= Sim.MON_STREAK && !shooter.sim.mon && !shooter.sim.monT) {
      shooter.sim.monT = Sim.MON_RISE_TICKS; shooter.streak = 0;
      io.to(room.code).emit('monRise', { id: shooter.id });
      addFeed(room, `${shooter.name}'s runes awaken`, 'kill');
    }
    // Knight: 4 kills in a row -> the next attack is a Cinder Crash
    if (Sim.classOf(shooter.sim).key === 'knight' && shooter.sim.alive && shooter.streak >= Sim.CRASH_STREAK && !shooter.sim.crash && !shooter.sim.crashT) {
      shooter.sim.crash = 1; shooter.streak = 0;
      io.to(room.code).emit('crashReady', { id: shooter.id });
      addFeed(room, `${shooter.name}'s blade ignites — CINDER CRASH`, 'kill');
    }
    target.adapt = {};
    const how = weapon === 'beam' ? '✦ OBLITERATED' : weapon === 'crash' ? '☄ crushed' : weapon === Sim.WEAPON.CLAWS ? '☬ torn apart by' : weapon === 'fire' ? '🔥 burned' : weapon === Sim.WEAPON.SWORD ? '⚔' : weapon === Sim.WEAPON.SHOTGUN ? '✸' : part === 'head' ? '⊕ headshot' : '▸';
    addFeed(room, `${shooter.name} ${how} ${target.name}`, 'kill');
    io.to(room.code).emit('killed', { killer: shooter.id, victim: target.id, head: part === 'head', w: weapon, pos: [r3(target.sim.x), r3(target.sim.y), r3(target.sim.z)] });
    // knight reward: the greatsword transforms into a shotgun
    if (shooter.sim.alive && Sim.grantShotgun(shooter.sim)) io.to(room.code).emit('transform', { id: shooter.id });
    emitMeta(room);
  }
  return killed;
}

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

/** Obliteration Beam: everyone in its 14 m-wide path dies (walls don't stop it); that half of the alley burns. */
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

/** Greatsword swing: hits the closest enemy inside the swing cone (lag compensated, blocked by walls). */
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
  if (!claws && shooter.riposteUntil > t) { dmg *= 2; shooter.riposteUntil = 0; io.to(room.code).emit('riposte', { id: shooter.id }); } // after a parry
  applyDamage(room, shooter, best.target, dmg, best.part, best.point, weapon);
}

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
const r3 = v => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------ main loop
let lastLoop = now(), acc = 0;
function gameLoop() {
  const t = now();
  acc += Math.min(0.25, (t - lastLoop) / 1000);
  lastLoop = t;
  while (acc >= Sim.DT) {
    acc -= Sim.DT;
    for (const room of rooms.values()) if (room.phase === 'playing') tickRoom(room);
  }
}
function tickRoom(room) {
  const t = now();
  room.tick++;
  for (const p of room.players.values()) {
    p.budget = Math.min(MAX_BUDGET, p.budget + Sim.DT);
    let processed = 0;
    while (p.queue.length && p.budget >= Sim.DT - 1e-9 && processed < MAX_INPUTS_PER_TICK) {
      const input = p.queue.shift();
      p.budget -= Sim.DT; processed++;
      p.lastSeq = input.s;
      const ev = Sim.stepPlayer(p.sim, input);
      if (ev.fire && ev.shotgun) handleShotgun(room, p, input);
      else if (ev.fire) handleShot(room, p, input, ev);
      if (ev.ultStart) io.to(room.code).except(p.id).emit('ultCharge', { id: p.id });
      if (ev.ultFire) handleBeam(room, p);
      if (ev.swing) handleSwing(room, p, input.vt, !!ev.claw);
      if (ev.guardUp) p.guardAt = p.sim.guardT <= 1 ? now() : 0;   // a fresh raise opens the parry window   // a fresh raise opens the parry window
      if (ev.crashStart) io.to(room.code).except(p.id).emit('crashLeap', { id: p.id });
      if (ev.crashLand) handleCrash(room, p);
      if (ev.monStart) { p.hp = Sim.MON_HP; p.shield = Sim.classOf(p.sim).shield; p.adapt = {}; io.to(room.code).emit('monStart', { id: p.id }); emitMeta(room); }
      if (ev.monEnd) { p.hp = Math.max(1, Math.round(p.hp / Sim.MON_HP * Sim.classOf(p.sim).hp)); p.adapt = {}; io.to(room.code).emit('monEnd', { id: p.id }); emitMeta(room); }
      if (ev.sheathe) io.to(room.code).emit('sheathe', { id: p.id });
    }
    // energy shield refills after a few seconds without taking damage
    const C = Sim.classOf(p.sim);
    if (p.sim.alive && p.shield < C.shield && t - p.hurtAt > Sim.SHIELD_REGEN_DELAY_MS) p.shield = Math.min(C.shield, p.shield + Sim.SHIELD_REGEN_PER_S * Sim.DT);
    if (!p.sim.alive && p.respawnAt && t >= p.respawnAt) {
      p.respawnAt = 0;
      placeAtSpawn(room, p);
      io.to(room.code).emit('respawned', { id: p.id });
      emitMeta(room);
    }
  }
  burnFireZone(room, t);
  updateClash(room, t);
  recordHistory(room, t);
  if (room.tick % Sim.SNAPSHOT_EVERY === 0) sendSnapshots(room, t);
}
function sendSnapshots(room, t) {
  const others = [];
  for (const p of room.players.values()) {
    const s = p.sim;
    const flags = (s.alive ? 1 : 0) | (p.shieldUntil > t ? 2 : 0) | (s.reload > 0 ? 4 : 0) | (s.og ? 8 : 0) | (s.dashT > 0 ? 16 : 0) | (t < p.protectUntil ? 32 : 0) | (s.wpn ? 64 : 0) | (p.shield > 0 ? 128 : 0) | (s.ultT > 0 ? 256 : 0) | (s.ult === 1 ? 512 : 0) | (s.mon > 0 ? 1024 : 0) | (s.monT > 0 ? 2048 : 0) | (s.guard ? 4096 : 0) | (s.stag > 0 ? 8192 : 0) | (s.crash === 1 ? 16384 : 0) | (s.crashT > 0 ? 32768 : 0);
    others.push([p.id, r3(s.x), r3(s.y), r3(s.z), r3(s.yaw), r3(s.pitch), flags, r3(s.vx), r3(s.vz)]);
  }
  for (const p of room.players.values()) {
    const me = Sim.copyState(p.sim);
    io.to(p.id).emit('snap', {
      t: Math.round(t * 10) / 10,
      ack: p.lastSeq,
      me, hp: p.hp, sh: Math.round(p.shield), st: p.streak || 0, tp: p.teleported || false,
      cd: { shield: Math.max(0, p.shieldCdUntil - t), scan: Math.max(0, p.scanCdUntil - t), shieldOn: Math.max(0, p.shieldUntil - t) },
      ps: others
    });
    p.teleported = false;
  }
}
setInterval(gameLoop, 1000 / 120);

// ------------------------------------------------------------ input validation
function sanitizeInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = Number(raw.s);
  if (!Number.isInteger(s) || s < 0) return null;
  const mx = Number(raw.mx), mz = Number(raw.mz), yaw = Number(raw.yaw), pitch = Number(raw.pitch);
  if (![mx, mz, yaw, pitch].every(Number.isFinite)) return null;
  const out = { s, mx: Sim.clamp(mx, -1, 1), mz: Sim.clamp(mz, -1, 1), yaw, pitch: Sim.clamp(pitch, -1.45, 1.45), b: (raw.b | 0) & 31 };
  if (raw.vt !== undefined && Number.isFinite(Number(raw.vt))) out.vt = Number(raw.vt);
  return out;
}

// ------------------------------------------------------------ sockets
io.on('connection', socket => {
  let roomCode = null;
  console.log(`[socket] player connected (${io.engine.clientsCount} online)`);
  socket.on('disconnect', () => console.log(`[socket] player left (${io.engine.clientsCount} online)`));
  const getRoom = () => rooms.get(roomCode);
  const getMe = () => { const r = getRoom(); return r && r.players.get(socket.id); };

  socket.on('ping2', (_, cb) => { if (typeof cb === 'function') cb(now()); });

  socket.on('createRoom', ({ name, cls } = {}, cb = () => {}) => {
    if (typeof cb !== 'function') return;
    if (roomCode) return cb({ ok: false, error: 'Leave your current room first.' });
    const code = makeCode();
    const room = { code, hostId: socket.id, phase: 'lobby', players: new Map(), feed: [], endsAt: 0, timer: null, tick: 0 };
    rooms.set(code, room);
    joinRoom(room, name, cls, cb);
  });
  socket.on('joinRoom', ({ code, name, cls } = {}, cb = () => {}) => {
    if (typeof cb !== 'function') return;
    code = String(code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Room not found. Check the code and try again.' });
    if (room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'This room is full (8 players maximum).' });
    if (room.phase === 'playing') return cb({ ok: false, error: 'That match is already in progress.' });
    if (roomCode) return cb({ ok: false, error: 'Leave your current room first.' });
    joinRoom(room, name, cls, cb);
  });
  function joinRoom(room, rawName, rawCls, cb) {
    const name = String(rawName || 'Runner').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Runner';
    const used = new Set([...room.players.values()].map(p => p.color));
    const color = COLORS.find(c => !used.has(c)) || COLORS[room.players.size % COLORS.length];
    const cls = validClass(rawCls);
    const p = {
      id: socket.id, name, color, score: 0, kills: 0, deaths: 0, streak: 0, hp: 100, shield: 0, hurtAt: 0, nextCls: cls,
      sim: Sim.newPlayerState(0, 0, cls), queue: [], budget: 0, lastSeq: -1, history: [],
      protectUntil: 0, shieldUntil: 0, shieldCdUntil: 0, scanCdUntil: 0, respawnAt: 0, teleported: true
    };
    refill(p);
    room.players.set(socket.id, p);
    roomCode = room.code;
    socket.join(room.code);
    addFeed(room, `${name} connected`);
    cb({ ok: true, code: room.code, host: room.hostId === socket.id, playerId: socket.id });
    emitMeta(room);
  }

  // Class choice: applies at once in the lobby, otherwise on the next respawn.
  socket.on('setClass', ({ cls } = {}) => {
    const room = getRoom(), p = getMe();
    if (!room || !p) return;
    p.nextCls = validClass(cls);
    if (room.phase !== 'playing') { p.sim = Sim.newPlayerState(0, 0, p.nextCls); refill(p); }
    emitMeta(room);
  });

  socket.on('startMatch', () => {
    const room = getRoom();
    if (!room || room.hostId !== socket.id) return;
    if (!startMatch(room)) socket.emit('notice', 'At least two players are needed to start.');
  });

  // Batched input commands: [{ s, mx, mz, yaw, pitch, b, vt? }, ...]
  socket.on('in', batch => {
    const room = getRoom(), p = getMe();
    if (!room || !p || room.phase !== 'playing' || !Array.isArray(batch) || batch.length > 12) return;
    for (const raw of batch) {
      const input = sanitizeInput(raw);
      if (!input || input.s <= p.lastSeq) continue;
      const lastQueued = p.queue.length ? p.queue[p.queue.length - 1].s : p.lastSeq;
      if (input.s <= lastQueued) continue; // duplicates / reordering
      if (p.queue.length >= MAX_QUEUE) break; // flooding: excess commands are dropped
      p.queue.push(input);
    }
  });

  socket.on('ability', ({ type } = {}) => {
    const room = getRoom(), p = getMe();
    if (!room || room.phase !== 'playing' || !p || !p.sim.alive) return;
    const t = now();
    if (type === 'shield' && t >= p.shieldCdUntil) {
      p.shieldUntil = t + ABILITIES.shield.duration; p.shieldCdUntil = t + ABILITIES.shield.cooldown;
      p.shield = Sim.classOf(p.sim).shield; // and instantly recharges the energy shield
      io.to(room.code).emit('abilityFx', { id: p.id, type: 'shield' });
    } else if (type === 'scan' && t >= p.scanCdUntil) {
      p.scanCdUntil = t + ABILITIES.scan.cooldown;
      const found = [...room.players.values()].filter(q => q !== p && q.sim.alive).map(q => ({ id: q.id, x: r3(q.sim.x), y: r3(q.sim.y), z: r3(q.sim.z) }));
      socket.emit('scanPulse', { players: found, duration: ABILITIES.scan.duration });
      io.to(room.code).emit('abilityFx', { id: p.id, type: 'scan' });
    }
  });

  // Test-only hooks (screenshots / automated tests). Never enabled on the public server.
  if (process.env.NAB_DEBUG === '1') socket.on('debug', (d = {}) => {
    const room = getRoom(), p = getMe();
    if (!room || !p) return;
    if (d.place) { Object.assign(p.sim, { x: +d.place.x || 0, y: 0, z: +d.place.z || 0, vx: 0, vz: 0, yaw: +d.place.yaw || 0 }); p.teleported = true; p.history = []; }
    if (d.grant) Sim.grantShotgun(p.sim);
    if (d.ult) p.sim.ult = 1;
    if (d.crash) p.sim.crash = 1;
    if (d.mon) { p.sim.monT = d.mon === 'rise' ? Sim.MON_RISE_TICKS : 2; io.to(room.code).emit('monRise', { id: p.id }); }
    if (d.protect === false) p.protectUntil = 0;
  });

  socket.on('clashKey', ({ k } = {}) => {
    const room = getRoom(), p = getMe();
    if (room && p && room.phase === 'playing' && Sim.CLASH_KEYS.includes(k)) clashKey(room, p, k);
  });

  socket.on('rematch', () => {
    const room = getRoom();
    if (room && room.phase === 'results' && room.hostId === socket.id) { room.phase = 'lobby'; emitMeta(room); }
  });

  socket.on('disconnect', () => {
    const room = getRoom();
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p) { addFeed(room, `${p.name} disconnected`); room.players.delete(socket.id); }
    if (room.hostId === socket.id) { const next = room.players.keys().next(); room.hostId = next.done ? null : next.value; }
    if (room.phase === 'playing' && room.players.size < 2) { room.phase = 'lobby'; stopTimer(room); addFeed(room, 'Match paused: waiting for another runner.'); }
    emitMeta(room);
    cleanRoom(room.code);
  });
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`NEON ARENA: BLACKOUT running on port ${PORT}`));
}
module.exports = { server, rooms, io };
