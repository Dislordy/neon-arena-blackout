const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));
app.get('/health', (_, res) => res.json({ ok: true, game: 'NEON ARENA: BLACKOUT' }));

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const now = () => Date.now();
function makeCode() {
  let code;
  do { code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function publicPlayer(p) {
  return { id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, hp: p.hp, score: p.score, kills: p.kills, deaths: p.deaths, alive: p.alive, color: p.color, reloading: p.reloading };
}
function snapshot(room) {
  return { code: room.code, phase: room.phase, timeLeft: Math.max(0, Math.ceil((room.endsAt - now()) / 1000)), players: [...room.players.values()].map(publicPlayer), feed: room.feed.slice(-5) };
}
function emitRoom(room) { io.to(room.code).emit('state', snapshot(room)); }
function addFeed(room, message) { room.feed.push({ id: crypto.randomUUID(), message, at: now() }); room.feed = room.feed.slice(-8); }
function spawnPoint(index) {
  const a = index * Math.PI * (3 - Math.sqrt(5));
  const r = 5 + (index % 3) * 1.5;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}
function stopTimer(room) { if (room.timer) clearInterval(room.timer); room.timer = null; }
function endMatch(room) {
  if (room.phase !== 'playing') return;
  room.phase = 'results'; stopTimer(room);
  const ranked = [...room.players.values()].sort((a,b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
  room.winner = ranked[0] ? ranked[0].id : null;
  io.to(room.code).emit('matchEnded', { winner: ranked[0] ? ranked[0].name : 'Nobody', rankings: ranked.map((p,i) => ({ place:i+1, name:p.name, score:p.score, kills:p.kills, deaths:p.deaths })) });
  emitRoom(room);
}
function startMatch(room) {
  if (room.players.size < 2 || room.phase === 'playing') return false;
  room.phase = 'playing'; room.endsAt = now() + 4 * 60 * 1000; room.feed = []; room.winner = null;
  let i = 0;
  for (const p of room.players.values()) {
    const s = spawnPoint(i++); Object.assign(p, { x:s.x, y:1.2, z:s.z, hp:100, score:0, kills:0, deaths:0, alive:true, invulnerableUntil:now()+1800, lastShot:0, ammo:24, reloading:false, reloadUntil:0, shieldUntil:0, dashUntil:0, scanUntil:0 });
  }
  addFeed(room, 'BLACKOUT initiated. Good hunting.');
  stopTimer(room);
  room.timer = setInterval(() => {
    if (!rooms.has(room.code)) return stopTimer(room);
    if (now() >= room.endsAt) endMatch(room); else emitRoom(room);
  }, 500);
  emitRoom(room); return true;
}
function cleanRoom(code) {
  const room = rooms.get(code);
  if (room && room.players.size === 0) { stopTimer(room); rooms.delete(code); }
}

io.on('connection', socket => {
  let roomCode = null;
  socket.on('createRoom', ({ name } = {}, cb = () => {}) => {
    if (roomCode) return cb({ ok:false, error:'Leave your current room first.' });
    const code = makeCode();
    const room = { code, hostId:socket.id, phase:'lobby', players:new Map(), feed:[], endsAt:0, timer:null, winner:null };
    rooms.set(code, room);
    joinRoom(socket, room, name, cb);
  });
  socket.on('joinRoom', ({ code, name } = {}, cb = () => {}) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ ok:false, error:'Room not found. Check the code and try again.' });
    if (room.players.size >= 8) return cb({ ok:false, error:'This room is full (8 players maximum).' });
    if (room.phase === 'playing') return cb({ ok:false, error:'That match is already in progress.' });
    if (roomCode) return cb({ ok:false, error:'Leave your current room first.' });
    joinRoom(socket, room, name, cb);
  });
  function joinRoom(sock, room, rawName, cb) {
    const name = String(rawName || 'Runner').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,16) || 'Runner';
    const colors = ['#00f5ff','#ff36c7','#b6ff4a','#ffb347','#9b7bff','#ff5f6d','#56e39f','#f4f7ff'];
    const index = room.players.size;
    const s = spawnPoint(index);
    const p = { id:sock.id, name, x:s.x, y:1.2, z:s.z, yaw:0, pitch:0, hp:100, score:0, kills:0, deaths:0, alive:true, color:colors[index % colors.length], lastShot:0, ammo:24, reloading:false, reloadUntil:0, invulnerableUntil:now()+1500, shieldUntil:0, dashUntil:0, scanUntil:0, lastInputAt:now() };
    room.players.set(sock.id,p); roomCode = room.code; sock.join(room.code);
    addFeed(room, `${name} connected`); cb({ ok:true, code:room.code, host:room.hostId===sock.id, playerId:sock.id }); emitRoom(room);
  }
  socket.on('startMatch', () => {
    const room = rooms.get(roomCode); if (!room || room.hostId !== socket.id) return;
    if (!startMatch(room)) socket.emit('notice', 'At least two players are needed to start.');
  });
  socket.on('input', input => {
    const room = rooms.get(roomCode); const p = room && room.players.get(socket.id);
    if (!room || !p || room.phase !== 'playing' || !p.alive || !input) return;
    // The prototype accepts client-simulated movement, clamps the playfield, and validates combat server-side.
    const x = Number(input.x), z = Number(input.z), yaw = Number(input.yaw), pitch = Number(input.pitch);
    if ([x,z,yaw,pitch].every(Number.isFinite)) {
      const maxR = 24, len = Math.hypot(x,z);
      p.x = len > maxR ? x * maxR / len : x;
      p.z = len > maxR ? z * maxR / len : z;
      p.y = Math.max(0.7, Math.min(7, Number(input.y) || 1.2));
      p.yaw = yaw; p.pitch = Math.max(-1.35,Math.min(1.35,pitch)); p.lastInputAt = now();
    }
  });
  socket.on('shoot', ({ origin, direction } = {}) => {
    const room = rooms.get(roomCode), shooter = room && room.players.get(socket.id);
    if (!room || room.phase !== 'playing' || !shooter || !shooter.alive) return;
    const t = now();
    if (shooter.reloading && t < shooter.reloadUntil) return;
    if (shooter.reloading && t >= shooter.reloadUntil) { shooter.reloading = false; shooter.ammo = 24; }
    if (t - shooter.lastShot < 180 || shooter.ammo <= 0) return;
    shooter.lastShot = t; shooter.ammo--;
    if (!origin || !direction || ![origin.x,origin.y,origin.z,direction.x,direction.y,direction.z].every(v=>Number.isFinite(Number(v)))) return;
    const dLen = Math.hypot(direction.x,direction.y,direction.z) || 1;
    const d = { x:direction.x/dLen, y:direction.y/dLen, z:direction.z/dLen };
    let best = null, bestDist = 70;
    for (const target of room.players.values()) {
      if (target.id === shooter.id || !target.alive || t < target.invulnerableUntil) continue;
      const dx=target.x-origin.x, dy=(target.y+0.1)-origin.y, dz=target.z-origin.z;
      const along=dx*d.x+dy*d.y+dz*d.z;
      if (along < 0 || along > 70) continue;
      const px=dx-along*d.x, py=dy-along*d.y, pz=dz-along*d.z;
      const radius = target.shieldUntil > t ? 1.15 : 0.82;
      if (Math.hypot(px,py,pz) < radius && along < bestDist) { best=target; bestDist=along; }
    }
    io.to(room.code).emit('shotFx', { id:socket.id, origin, direction:d, hitId:best && best.id });
    if (best) {
      const damage = best.shieldUntil > t ? 10 : 34;
      best.hp -= damage;
      io.to(best.id).emit('hitTaken', { damage, hp:Math.max(0,best.hp) });
      io.to(shooter.id).emit('hitConfirm', { eliminated:best.hp<=0 });
      if (best.hp <= 0) {
        best.alive=false; best.deaths++; shooter.kills++; shooter.score += 100; best.hp=0;
        addFeed(room, `${shooter.name} eliminated ${best.name}`); emitRoom(room);
        setTimeout(() => {
          const current = rooms.get(room.code), target = current && current.players.get(best.id);
          if (!current || current.phase !== 'playing' || !target) return;
          const idx = [...current.players.keys()].indexOf(target.id), sp = spawnPoint(idx+Math.floor(Math.random()*5));
          Object.assign(target,{x:sp.x,z:sp.z,y:1.2,hp:100,alive:true,invulnerableUntil:now()+1800,ammo:24,reloading:false});
          emitRoom(current);
        }, 2200);
      }
      emitRoom(room);
    }
  });
  socket.on('reload', () => {
    const room=rooms.get(roomCode), p=room&&room.players.get(socket.id);
    if (!room || room.phase!=='playing' || !p || !p.alive || p.reloading || p.ammo===24) return;
    p.reloading=true; p.reloadUntil=now()+1350; emitRoom(room);
    setTimeout(()=>{ const r=rooms.get(roomCode), q=r&&r.players.get(socket.id); if(q&&q.reloading&&now()>=q.reloadUntil){q.reloading=false;q.ammo=24;emitRoom(r);} },1400);
  });
  socket.on('ability', ({ type } = {}) => {
    const room=rooms.get(roomCode), p=room&&room.players.get(socket.id); if(!room||room.phase!=='playing'||!p||!p.alive)return;
    const t=now();
    if(type==='shield' && (!p.shieldCooldownUntil||t>=p.shieldCooldownUntil)){p.shieldUntil=t+1800;p.shieldCooldownUntil=t+9000;socket.emit('notice','SHIELD ACTIVE');}
    else if(type==='dash' && (!p.dashCooldownUntil||t>=p.dashCooldownUntil)){p.dashUntil=t+350;p.dashCooldownUntil=t+5000;socket.emit('notice','DASH READY');}
    else if(type==='scan' && (!p.scanCooldownUntil||t>=p.scanCooldownUntil)){p.scanUntil=t+1200;p.scanCooldownUntil=t+12000;socket.emit('scanPulse',{players:[...room.players.values()].filter(q=>q.id!==p.id&&q.alive).map(q=>({id:q.id,x:q.x,y:q.y,z:q.z}))});}
    emitRoom(room);
  });
  socket.on('rematch', () => { const room=rooms.get(roomCode); if(room&&room.phase==='results'&&room.hostId===socket.id) { room.phase='lobby'; emitRoom(room); } });
  socket.on('disconnect', () => {
    const room=rooms.get(roomCode); if(!room)return;
    const p=room.players.get(socket.id); if(p){addFeed(room,`${p.name} disconnected`);room.players.delete(socket.id);}
    if(room.hostId===socket.id){const next=room.players.keys().next();room.hostId=next.done?null:next.value;}
    if(room.phase==='playing'&&room.players.size<2) { room.phase='lobby'; stopTimer(room); addFeed(room,'Match paused: waiting for another runner.'); }
    emitRoom(room); cleanRoom(room.code);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`NEON ARENA: BLACKOUT running on port ${PORT}`));
