'use strict';
// Socket handlers: joining rooms, class choice, inputs, abilities. Class powers add their own through hooks.socket.
const Sim = require('../shared/sim');
const C = require('./config');
const { io, rooms, now, r3 } = require('./core');
const { hooks } = require('./hooks');
const { createRoom, addPlayer, emitMeta, validClass, refill, startMatch, removePlayer } = require('./rooms');

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

io.on('connection', socket => {
  let roomCode = null;
  console.log(`[socket] player connected (${io.engine.clientsCount} online)`);
  const getRoom = () => rooms.get(roomCode);
  const getMe = () => { const r = getRoom(); return r && r.players.get(socket.id); };

  socket.on('ping2', (_, cb) => { if (typeof cb === 'function') cb(now()); });

  function join(room, name, cls, cb) {
    addPlayer(room, socket.id, name, cls);
    roomCode = room.code;
    socket.join(room.code);
    cb({ ok: true, code: room.code, host: room.hostId === socket.id, playerId: socket.id });
    emitMeta(room);
  }
  socket.on('createRoom', ({ name, cls } = {}, cb = () => {}) => {
    if (typeof cb !== 'function') return;
    if (roomCode) return cb({ ok: false, error: 'Leave your current room first.' });
    join(createRoom(socket.id), name, cls, cb);
  });
  socket.on('joinRoom', ({ code, name, cls } = {}, cb = () => {}) => {
    if (typeof cb !== 'function') return;
    code = String(code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Room not found. Check the code and try again.' });
    if (room.players.size >= C.MAX_PLAYERS) return cb({ ok: false, error: `This room is full (${C.MAX_PLAYERS} players maximum).` });
    if (room.phase === 'playing') return cb({ ok: false, error: 'That match is already in progress.' });
    if (roomCode) return cb({ ok: false, error: 'Leave your current room first.' });
    join(room, name, cls, cb);
  });

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
      if (p.queue.length >= C.MAX_QUEUE) break; // flooding: excess commands are dropped
      p.queue.push(input);
    }
  });

  // Everyone's abilities: Q hardens and refills the shield, E scans for enemies through walls.
  socket.on('ability', ({ type } = {}) => {
    const room = getRoom(), p = getMe();
    if (!room || room.phase !== 'playing' || !p || !p.sim.alive) return;
    const t = now(), A = C.ABILITIES;
    if (type === 'shield' && t >= p.shieldCdUntil) {
      p.shieldUntil = t + A.shield.duration; p.shieldCdUntil = t + A.shield.cooldown;
      p.shield = Sim.classOf(p.sim).shield;
      io.to(room.code).emit('abilityFx', { id: p.id, type: 'shield' });
    } else if (type === 'scan' && t >= p.scanCdUntil) {
      p.scanCdUntil = t + A.scan.cooldown;
      const found = [...room.players.values()].filter(q => q !== p && q.sim.alive).map(q => ({ id: q.id, x: r3(q.sim.x), y: r3(q.sim.y), z: r3(q.sim.z) }));
      socket.emit('scanPulse', { players: found, duration: A.scan.duration });
      io.to(room.code).emit('abilityFx', { id: p.id, type: 'scan' });
    }
  });

  socket.on('rematch', () => {
    const room = getRoom();
    if (room && room.phase === 'results' && room.hostId === socket.id) { room.phase = 'lobby'; emitMeta(room); }
  });

  for (const h of hooks.socket) h(socket, { getRoom, getMe });

  // Test-only hooks (screenshots / automated tests). Never enabled on the public server.
  if (C.DEBUG) socket.on('debug', (d = {}) => {
    const room = getRoom(), p = getMe();
    if (!room || !p) return;
    if (d.place) { Object.assign(p.sim, { x: +d.place.x || 0, y: 0, z: +d.place.z || 0, vx: 0, vz: 0, yaw: +d.place.yaw || 0 }); p.teleported = true; p.history = []; }
    for (const h of hooks.debug) h(room, p, d);
    if (d.protect === false) p.protectUntil = 0;
  });

  socket.on('disconnect', () => {
    console.log(`[socket] player left (${io.engine.clientsCount} online)`);
    const room = getRoom();
    if (room) removePlayer(room, socket.id);
  });
});
