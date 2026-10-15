'use strict';
// Integration test: boots the authoritative server and drives it with two socket clients.
process.env.MATCH_MS = '60000';
const assert = require('assert');
const { io: ioc } = require('socket.io-client');
const Sim = require('../shared/sim');
const { server, rooms } = require('../server');

const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (sock, ev) => new Promise(r => sock.once(ev, r));
const emitAck = (sock, ev, data) => new Promise(r => sock.emit(ev, data, r));

class Bot {
  constructor(url) {
    this.sock = ioc(url, { transports: ['websocket'], forceNew: true });
    this.seq = 0; this.snap = null; this.hits = []; this.hurts = []; this.shots = [];
    this.sock.on('snap', s => { this.snap = s; });
    this.sock.on('hit', h => this.hits.push(h));
    this.sock.on('hurt', h => this.hurts.push(h));
    this.sock.on('shot', s => this.shots.push(s));
  }
  send(n, o = {}) {
    const batch = [];
    for (let i = 0; i < n; i++) batch.push(Object.assign({ s: ++this.seq, mx: 0, mz: 0, yaw: 0, pitch: 0, b: 0 }, typeof o === 'function' ? o(i) : o));
    for (let i = 0; i < batch.length; i += 10) this.sock.emit('in', batch.slice(i, i + 10));
  }
  async stream(ticks, o) { // real-time input stream (60 Hz), like a real client
    for (let i = 0; i < ticks; i += 2) { this.send(2, o); await wait(1000 / 30); }
  }
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://localhost:' + server.address().port;
  const a = new Bot(url), b = new Bot(url);
  await Promise.all([once(a.sock, 'connect'), once(b.sock, 'connect')]);
  const created = await emitAck(a.sock, 'createRoom', { name: 'Alpha' });
  assert.ok(created.ok);
  const joined = await emitAck(b.sock, 'joinRoom', { name: 'Bravo', code: created.code });
  assert.ok(joined.ok);
  const room = rooms.get(created.code);
  a.sock.emit('startMatch');
  await wait(200);
  assert.strictEqual(room.phase, 'playing');
  const pa = room.players.get(a.sock.id), pb = room.players.get(b.sock.id);

  await test('snapshots stream with acks', async () => {
    await a.stream(30, {});
    await wait(120);
    assert.ok(a.snap, 'no snapshot');
    assert.strictEqual(a.snap.ack, a.seq);
    assert.strictEqual(a.snap.ps.length, 2);
  });

  await test('server owns movement: client cannot teleport', async () => {
    const before = { x: pa.sim.x, z: pa.sim.z };
    // A cheating client sends a bogus position; only inputs are read, so this is ignored.
    a.sock.emit('in', [{ s: ++a.seq, x: 999, z: 999, mx: 0, mz: 0, yaw: 0, pitch: 0, b: 0 }]);
    await wait(100);
    assert.ok(Math.hypot(pa.sim.x - before.x, pa.sim.z - before.z) < 0.01);
  });

  await test('input flooding (speed hack) is rate limited', async () => {
    const before = { x: pa.sim.x, z: pa.sim.z };
    const t0 = Date.now();
    // 600 forward inputs (=10 s of movement) sent instantly
    for (let k = 0; k < 60; k++) a.send(10, { mz: 1, yaw: 0 });
    await wait(500);
    const dt = (Date.now() - t0) / 1000;
    const moved = Math.hypot(pa.sim.x - before.x, pa.sim.z - before.z);
    assert.ok(moved < Sim.MOVE_SPEED * (dt + 0.35) + 0.5, `moved ${moved.toFixed(2)} m in ${dt.toFixed(2)} s`);
    pa.queue.length = 0;
  });

  // Place players deterministically for combat tests.
  function place(p, x, z, yaw, cls = 0) {
    p.queue.length = 0;
    p.sim = Object.assign(Sim.newPlayerState(x, z, cls), { yaw });
    const C = Sim.CLASSES[cls];
    p.hp = C.hp; p.shield = C.shield; p.hurtAt = 0; p.protectUntil = 0; p.history = []; p.shieldUntil = 0;
  }

  await test('walls block shots', async () => {
    // Core spans -2..2. A at x=6, B at x=-6, A looks along -x (yaw=+90deg).
    place(pa, 6, 0, Math.PI / 2); place(pb, -6, 0, -Math.PI / 2);
    await wait(60);
    a.hits.length = 0;
    a.send(1, { yaw: Math.PI / 2, b: Sim.BTN.FIRE });
    await wait(150);
    assert.strictEqual(a.hits.length, 0);
    assert.strictEqual(pb.hp, 100);
  });

  await test('clear line of fire hits; shield soaks first; five body shots eliminate a soldier', async () => {
    place(pa, -12, -26, 0); place(pb, -12, -36, Math.PI);
    await wait(80);
    a.hits.length = 0; b.hurts.length = 0;
    const pitch = Math.atan2(1.15 - Sim.EYE_HEIGHT, 10); // aim at the chest
    // hold fire for ~1.1 s; fire rate is server-limited
    await a.stream(66, { yaw: 0, pitch, b: Sim.BTN.FIRE });
    await wait(150);
    assert.ok(a.hits.length >= 5, 'hits=' + a.hits.length);
    assert.strictEqual(a.hits[0].part, 'body');
    assert.ok(a.hits[0].sh, 'first hit lands on the shield');
    assert.strictEqual(b.hurts[0].hp, 100, 'shield absorbed the first shot');
    assert.ok(a.hits.some(h => h.brk), 'shield break is reported');
    assert.ok(b.hurts.length >= 5);
    assert.ok(!pb.sim.alive, 'target should be eliminated');
    assert.strictEqual(pa.kills, 1);
    assert.ok(a.hits.some(h => h.k));
    assert.ok(b.shots.length >= 3, 'other players receive shot events');
    assert.ok(a.shots.every(s => s.id !== a.sock.id), 'shooter is not echoed its own shots');
  });

  await test('server-side fire-rate limit cannot be bypassed', async () => {
    place(pa, -12, -26, 0);
    const ammo0 = pa.sim.ammo;
    a.send(10, { b: Sim.BTN.FIRE }); // 10 ticks of fire held -> at most 1 shot
    await wait(300);
    assert.ok(ammo0 - pa.sim.ammo <= 1, 'fired ' + (ammo0 - pa.sim.ammo));
  });

  await test('dead player respawns with full health', async () => {
    await b.stream(200, {});
    await wait(100);
    assert.ok(pb.sim.alive);
    assert.strictEqual(pb.hp, 100);
    assert.ok(Sim.isFree(pb.sim.x, pb.sim.y, pb.sim.z));
  });

  await test('lag compensation: shots are resolved against rewound positions', async () => {
    place(pa, -12, -26, 0); place(pb, -12, -36, 0);
    // build 300 ms of history with B standing at z=-20, then move B sideways instantly
    const t0 = require('perf_hooks').performance.now();
    await wait(250);
    pb.sim.x = -8; // B is no longer in the line of fire "now"
    a.hits.length = 0;
    const pitch = Math.atan2(1.15 - Sim.EYE_HEIGHT, 10);
    a.send(1, { yaw: 0, pitch, b: Sim.BTN.FIRE, vt: t0 + 100 }); // client was viewing the past
    await wait(150);
    assert.strictEqual(a.hits.length, 1, 'rewound shot should hit');
    // A view time far in the past is clamped to MAX_REWIND_MS -> no hit
    place(pa, -12, -26, 0); pb.history = []; pb.sim.x = -8; pb.hp = 100;
    await wait(400); a.hits.length = 0;
    a.send(1, { yaw: 0, pitch, b: Sim.BTN.FIRE, vt: 0 });
    await wait(150);
    assert.strictEqual(a.hits.length, 0, 'over-long rewinds must be clamped');
  });

  await test('energy shield regenerates after a few seconds without damage', async () => {
    place(pb, -12, -36, 0);
    pb.shield = 10; pb.hurtAt = require('perf_hooks').performance.now() - Sim.SHIELD_REGEN_DELAY_MS - 10;
    await wait(500);
    assert.ok(pb.shield > 18 && pb.shield <= 50, 'shield=' + pb.shield);
    pb.shield = 10; pb.hurtAt = require('perf_hooks').performance.now();
    await wait(300);
    assert.strictEqual(pb.shield, 10, 'no regen right after damage');
  });

  await test('knight: more health, sword kills, then the sword becomes a shotgun', async () => {
    place(pa, -12, -34, 0, 2); place(pb, -12, -36, Math.PI);
    assert.strictEqual(pa.hp, 130);
    await wait(80);
    a.hits.length = 0;
    const pitch = Math.atan2(1.15 - Sim.EYE_HEIGHT, 2);
    // 0.55 s per swing; soldier has 150 effective HP -> 3 swings. Stream ~2 s of held attack.
    await a.stream(120, { yaw: 0, pitch, b: Sim.BTN.FIRE });
    await wait(150);
    assert.ok(a.hits.filter(h => h.w === 'sword').length >= 3, 'sword hits=' + a.hits.length);
    assert.ok(!pb.sim.alive, 'target should be eliminated by the sword');
    assert.strictEqual(pa.sim.wpn, 1, 'sword transformed into the shotgun');
    assert.ok(pa.sim.ammo > 0 && pa.sim.ammo <= Sim.SHOTGUN_SHELLS);
  });

  await test('knight shotgun: pellets hit hard up close and shells run out', async () => {
    place(pa, -12, -32, 0, 2); place(pb, -12, -36, Math.PI);
    Sim.grantShotgun(pa.sim); pa.sim.fireCd = 0;
    await wait(80);
    a.hits.length = 0; b.shots.length = 0;
    const pitch = Math.atan2(1.15 - Sim.EYE_HEIGHT, 4);
    a.send(1, { yaw: 0, pitch, b: Sim.BTN.FIRE });
    await wait(150);
    const h = a.hits.find(x => x.w === 'shotgun');
    assert.ok(h && h.d >= 60, 'pellets at 4 m should total 60+ damage, got ' + (h && h.d));
    assert.ok(b.shots.some(s => s.w === 'sg' && s.pe.length === Sim.SHOTGUN_PELLETS), 'others receive all pellets');
    assert.strictEqual(pa.sim.ammo, Sim.SHOTGUN_SHELLS - 1);
  });

  await test('class choice applies on respawn', async () => {
    b.sock.emit('setClass', { cls: 1 });
    await wait(80);
    assert.strictEqual(pb.nextCls, 1);
    pb.sim.alive = false; pb.respawnAt = 1;
    await wait(120);
    assert.ok(pb.sim.alive);
    assert.strictEqual(pb.sim.cls, 1);
    assert.strictEqual(pb.hp, 85);
    assert.strictEqual(pb.sim.dashN, 3);
  });

  a.sock.close(); b.sock.close();
  console.log(`server: ${passed} passed`);
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})().catch(e => { console.error(e); process.exit(1); });
