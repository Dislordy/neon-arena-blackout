'use strict';
// The HTTP + Socket.IO server, the room table, and small helpers every module uses.
const express = require('express');
const http = require('http');
const path = require('path');
const { performance } = require('perf_hooks');
const { Server } = require('socket.io');

const WEB = path.join(__dirname, '..');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 16 * 1024 });
const rooms = new Map();

// Log page loads (not every asset) so hosting problems are easy to diagnose in the host's logs.
app.use((req, res, next) => {
  if (req.path === '/') { // not /health: the host polls that every few seconds
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace(/\.\d+$/, '.x');
    console.log(`[http] ${req.method} ${req.path} from ${ip} (${String(req.headers['user-agent'] || '').slice(0, 40)})`);
  }
  next();
});
app.use(express.static(path.join(WEB, 'public')));
app.use('/shared', express.static(path.join(WEB, 'shared')));
app.use('/vendor/three', express.static(path.join(WEB, 'node_modules', 'three')));
app.get('/health', (_, res) => res.json({ ok: true, game: 'NEON ARENA: BLACKOUT', rooms: rooms.size }));

const now = () => performance.now();
const wallNow = () => Date.now();
const r3 = v => Math.round(v * 1000) / 1000;
const v3 = p => [r3(p.x), r3(p.y), r3(p.z)];
const endPoint = (o, d, t) => ({ x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t });

module.exports = { app, server, io, rooms, now, wallNow, r3, v3, endPoint };
