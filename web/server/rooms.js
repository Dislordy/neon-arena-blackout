'use strict';
// Rooms: codes, players, the scoreboard/feed, spawning, and the match timer.
const crypto = require('crypto');
const Sim = require('../shared/sim');
const C = require('./config');
const { io, rooms, now, wallNow } = require('./core');
const { hooks } = require('./hooks');

function makeCode() {
  let code;
  do code = Array.from({ length: 6 }, () => C.CODE_CHARS[crypto.randomInt(C.CODE_CHARS.length)]).join('');
  while (rooms.has(code));
  return code;
}
function createRoom(hostId) {
  const room = { code: makeCode(), hostId, phase: 'lobby', players: new Map(), feed: [], endsAt: 0, timer: null, tick: 0 };
  rooms.set(room.code, room);
  return room;
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
function refill(p) { const K = Sim.classOf(p.sim); p.hp = K.hp; p.shield = K.shield; p.hurtAt = 0; p.adapt = {}; }
function metaState(room) {
  return {
    code: room.code, phase: room.phase, host: room.hostId,
    timeLeft: room.phase === 'playing' ? Math.max(0, Math.ceil((room.endsAt - now()) / 1000)) : 0,
    players: [...room.players.values()].map(publicMeta), feed: room.feed.slice(-5)
  };
}
function emitMeta(room) { io.to(room.code).emit('state', metaState(room)); }

/** A new runner in a room (picks a free colour and a clean name). */
function addPlayer(room, id, rawName, rawCls) {
  const name = String(rawName || 'Runner').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Runner';
  const used = new Set([...room.players.values()].map(p => p.color));
  const color = C.COLORS.find(c => !used.has(c)) || C.COLORS[room.players.size % C.COLORS.length];
  const cls = validClass(rawCls);
  const p = {
    id, name, color, score: 0, kills: 0, deaths: 0, streak: 0, hp: 100, shield: 0, hurtAt: 0, nextCls: cls,
    sim: Sim.newPlayerState(0, 0, cls), queue: [], budget: 0, lastSeq: -1, history: [],
    protectUntil: 0, shieldUntil: 0, shieldCdUntil: 0, scanCdUntil: 0, respawnAt: 0, teleported: true
  };
  refill(p);
  room.players.set(id, p);
  addFeed(room, `${name} connected`);
  return p;
}

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
  p.sim = Sim.newPlayerState(s.x, s.z, p.nextCls);
  p.sim.yaw = Math.atan2(s.x, s.z); // face the arena centre
  refill(p);
  p.protectUntil = now() + C.SPAWN_PROTECT_MS;
  p.history = [];
  p.teleported = true; // tells the client to snap instead of smoothing
}

function stopTimer(room) { if (room.timer) clearInterval(room.timer); room.timer = null; }
function startMatch(room) {
  if (room.players.size < 2 || room.phase === 'playing') return false;
  room.phase = 'playing'; room.endsAt = now() + C.MATCH_MS; room.feed = []; room.winner = null; room.tick = 0;
  for (const h of hooks.matchStart) h(room);
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
  io.to(room.code).emit('matchStarted', { endsIn: C.MATCH_MS });
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
/** A runner left: hand over the host, pause a match that no longer has two players, drop empty rooms. */
function removePlayer(room, id) {
  const p = room.players.get(id);
  if (p) { addFeed(room, `${p.name} disconnected`); room.players.delete(id); }
  if (room.hostId === id) { const next = room.players.keys().next(); room.hostId = next.done ? null : next.value; }
  if (room.phase === 'playing' && room.players.size < 2) { room.phase = 'lobby'; stopTimer(room); addFeed(room, 'Match paused: waiting for another runner.'); }
  emitMeta(room);
  if (room.players.size === 0) { stopTimer(room); rooms.delete(room.code); }
}

module.exports = { createRoom, addFeed, emitMeta, validClass, refill, addPlayer, placeAtSpawn, startMatch, endMatch, removePlayer };
