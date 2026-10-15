'use strict';
// Unit tests for the shared simulation (movement, collision, ray casting).
const assert = require('assert');
const Sim = require('../shared/sim');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const input = (o = {}) => Object.assign({ mx: 0, mz: 0, yaw: 0, pitch: 0, b: 0 }, o);
function run(p, inp, ticks) { const evs = []; for (let i = 0; i < ticks; i++) evs.push(Sim.stepPlayer(p, inp)); return evs; }

test('every spawn point is clear of geometry', () => {
  for (const s of Sim.spawns) assert.ok(Sim.isFree(s.x, 0, s.z), `spawn ${s.x},${s.z} is blocked`);
});

test('standing player stays grounded', () => {
  const p = Sim.newPlayerState(-12, -24);
  run(p, input(), 30);
  assert.strictEqual(p.y, 0); assert.ok(p.og);
});

test('walking forward moves along -z at roughly MOVE_SPEED', () => {
  const p = Sim.newPlayerState(-12, -24);
  run(p, input({ mz: 1 }), 60);
  assert.ok(Math.abs(p.x + 12) < 1e-6);
  assert.ok(p.z < -24 - 4.5 && p.z > -24 - 6.3, 'z=' + p.z);
});

test('walls block movement', () => {
  // The burnt-out bus spans x -1.4..1.4. Start east of it and walk west (yaw = +90deg looks along -x).
  const p = Sim.newPlayerState(4, 0);
  run(p, input({ mz: 1, yaw: Math.PI / 2 }), 120);
  assert.ok(p.x >= 1.4 + Sim.PLAYER_RADIUS - 1e-3, 'x=' + p.x);
});

test('invisible walls close the ends of the alley, building fronts close the sides', () => {
  const p = Sim.newPlayerState(-12, -50);
  run(p, input({ mz: 1 }), 240);
  assert.ok(p.z >= -Sim.HALF_Z + Sim.PLAYER_RADIUS - 1e-3 && p.z < -Sim.HALF_Z + 0.5, 'z=' + p.z);
  const q = Sim.newPlayerState(-12, -29);
  run(q, input({ mz: 1, yaw: Math.PI / 2 }), 240);
  assert.ok(Math.abs(q.x - (-Sim.HALF_X + Sim.PLAYER_RADIUS)) < 0.01, 'x=' + q.x);
});

test('invisible walls and chain-link fences do not stop bullets; building fronts do', () => {
  const end = Sim.raycastWorld({ x: -12, y: 1.6, z: -50 }, { x: 0, y: 0, z: -1 });
  assert.strictEqual(end, null, 'shot out of the alley end flies on');
  const fence = Sim.boxes.find(b => b.kind === 'fence');
  const fz = (fence.min[2] + fence.max[2]) / 2, fx = (fence.min[0] + fence.max[0]) / 2;
  const through = Sim.raycastWorld({ x: fx, y: 1.2, z: fz + 3 * Math.sign(-fz) }, { x: 0, y: 0, z: Math.sign(fz) }, 6);
  assert.ok(!through || through.kind !== 'fence');
  const wall = Sim.raycastWorld({ x: 0, y: 1.6, z: -29 }, { x: -1, y: 0, z: 0 });
  assert.strictEqual(wall.kind, 'facade');
  // ...but a fence still blocks movement
  const p = Sim.newPlayerState(fx, fz + 2 * Math.sign(-fz));
  run(p, input({ mz: 1, yaw: fz > 0 ? Math.PI : 0 }), 120);
  assert.ok(Math.abs(p.z - fz) > 0.3, 'walked through the fence: z=' + p.z);
});

test('jumping reaches ~1.36 m and lands', () => {
  const p = Sim.newPlayerState(-12, -24);
  let maxY = 0;
  Sim.stepPlayer(p, input({ b: Sim.BTN.JUMP }));
  for (let i = 0; i < 90; i++) { Sim.stepPlayer(p, input()); maxY = Math.max(maxY, p.y); }
  assert.ok(maxY > 1.2 && maxY < 1.5, 'maxY=' + maxY);
  assert.strictEqual(p.y, 0); assert.ok(p.og);
});

test('player can jump onto a crate', () => {
  // crate at (-4,-5) 1.4 wide, 1.1 tall; start south of it, walk north (-z) while jumping
  const p = Sim.newPlayerState(-4, -2.6);
  for (let i = 0; i < 80; i++) Sim.stepPlayer(p, input({ mz: i < 40 ? 1 : 0, b: i < 3 ? Sim.BTN.JUMP : 0 }));
  assert.ok(Math.abs(p.y - 1.1) < 0.01, 'y=' + p.y + ' z=' + p.z);
  assert.ok(p.og);
});

test('fire-escape stairs lead up to the walkway', () => {
  // right-hand stairs: bottom near z=9.8, deck from z=14 to 30 along x 13.6..16. Walk +z (yaw = 180deg).
  const p = Sim.newPlayerState(15.2, 9.2);
  run(p, input({ mz: 1, yaw: Math.PI }), 150);
  assert.ok(Math.abs(p.y - Sim.CATWALK_TOP) < 0.01, 'y=' + p.y);
  assert.ok(p.z > 14, 'z=' + p.z);
});

test('walking down stairs stays grounded (ground snapping)', () => {
  const p = Sim.newPlayerState(15.2, 16); p.y = Sim.CATWALK_TOP + 1e-4;
  let air = 0;
  for (let i = 0; i < 90; i++) { Sim.stepPlayer(p, input({ mz: 1, yaw: 0 })); if (!p.og) air++; }
  assert.strictEqual(p.y, 0); assert.ok(air < 5, 'air ticks=' + air);
});

test('dash bursts and has a cooldown', () => {
  const p = Sim.newPlayerState(-12, -24);
  const ev = Sim.stepPlayer(p, input({ mz: 1, b: Sim.BTN.DASH }));
  assert.ok(ev.dash);
  run(p, input({ mz: 1 }), Sim.DASH_TICKS);
  const ev2 = Sim.stepPlayer(p, input({ b: Sim.BTN.DASH }));
  assert.ok(!ev2.dash, 'dash should be on cooldown');
});

test('fire rate, ammo and reload are enforced by the simulation', () => {
  const p = Sim.newPlayerState(-12, -24);
  let shots = 0;
  for (let i = 0; i < 60; i++) if (Sim.stepPlayer(p, input({ b: Sim.BTN.FIRE })).fire) shots++;
  assert.ok(shots >= 5 && shots <= 6, 'shots in 1s=' + shots);
  for (let i = 0; i < 400; i++) Sim.stepPlayer(p, input({ b: Sim.BTN.FIRE }));
  // Mag emptied, reload kicked in automatically, firing resumed.
  assert.ok(p.ammo >= 0 && p.ammo <= Sim.MAG_SIZE);
  const q = Sim.newPlayerState(-12, -24); q.ammo = 3;
  Sim.stepPlayer(q, input({ b: Sim.BTN.RELOAD }));
  assert.ok(q.reload > 0);
  assert.ok(!Sim.stepPlayer(q, input({ b: Sim.BTN.FIRE })).fire, 'cannot fire while reloading');
  run(q, input(), Sim.RELOAD_TICKS);
  assert.strictEqual(q.ammo, Sim.MAG_SIZE);
});

test('walls block bullets', () => {
  const o = { x: 6, y: 1.6, z: 0 }, d = { x: -1, y: 0, z: 0 };
  const w = Sim.raycastWorld(o, d);
  assert.ok(w && Math.abs(w.t - 4.6) < 1e-6, 'bus side expected at t=4.6');
  assert.deepStrictEqual(w.n, [1, 0, 0]);
});

test('player hitboxes: head, body, legs and misses', () => {
  const pos = { x: 0, y: 0, z: -10 };
  const o = { x: 0, y: 1.6, z: 0 };
  assert.strictEqual(Sim.rayPlayer(o, { x: 0, y: 0, z: -1 }, pos).part, 'head');
  const toBody = { x: 0, y: 1.15 - 1.6, z: -10 }; const l = Math.hypot(toBody.y, toBody.z);
  assert.strictEqual(Sim.rayPlayer(o, { x: 0, y: toBody.y / l, z: toBody.z / l }, pos).part, 'body');
  const toLeg = { y: 0.5 - 1.6, z: -10 }; const l2 = Math.hypot(toLeg.y, toLeg.z);
  assert.strictEqual(Sim.rayPlayer(o, { x: 0, y: toLeg.y / l2, z: toLeg.z / l2 }, pos).part, 'legs');
  assert.strictEqual(Sim.rayPlayer(o, { x: 0.2, y: 0, z: -0.98 }, pos), null);
});

test('damage model', () => {
  assert.strictEqual(Sim.damageFor('body', 10, false), 34);
  assert.strictEqual(Sim.damageFor('head', 10, false), 68);
  assert.ok(Sim.damageFor('body', 80, false) < 34);
  assert.ok(Sim.damageFor('body', 10, true) < 12);
});

test('assassin has three dash charges that refill one at a time', () => {
  const p = Sim.newPlayerState(-12, -24, 1);
  let dashes = 0;
  for (let i = 0; i < 70; i++) if (Sim.stepPlayer(p, input({ mz: i % 2 ? 0 : 1, b: Sim.BTN.DASH })).dash) dashes++;
  assert.strictEqual(dashes, 3);
  assert.strictEqual(p.dashN, 0);
  run(p, input(), Sim.CLASSES[1].dashRecharge);
  assert.strictEqual(p.dashN, 1, 'one charge back after one recharge period');
  run(p, input(), Sim.CLASSES[1].dashRecharge * 2);
  assert.strictEqual(p.dashN, 3);
});

test('class speeds differ', () => {
  const dist = cls => { const p = Sim.newPlayerState(-12, -24, cls); run(p, input({ mz: 1 }), 60); return -24 - p.z; };
  assert.ok(dist(1) > dist(0) && dist(0) > dist(2));
});

test('knight swings the sword (no ammo, no reload) and the shotgun folds back when empty', () => {
  const p = Sim.newPlayerState(-12, -24, 2);
  assert.strictEqual(Sim.weaponOf(p), 'sword');
  let swings = 0;
  for (let i = 0; i < 120; i++) { const ev = Sim.stepPlayer(p, input({ b: Sim.BTN.FIRE | Sim.BTN.RELOAD })); if (ev.swing) swings++; assert.ok(!ev.fire); }
  assert.ok(swings >= 3 && swings <= 4, 'swings in 2s=' + swings);
  assert.strictEqual(p.reload, 0);
  assert.ok(Sim.grantShotgun(p));
  assert.strictEqual(Sim.weaponOf(p), 'shotgun');
  let shots = 0, sheathed = false;
  for (let i = 0; i < 600 && !sheathed; i++) { const ev = Sim.stepPlayer(p, input({ b: Sim.BTN.FIRE })); if (ev.fire) shots++; if (ev.sheathe) sheathed = true; }
  assert.strictEqual(shots, Sim.SHOTGUN_SHELLS);
  assert.ok(sheathed); assert.strictEqual(Sim.weaponOf(p), 'sword');
  assert.ok(!Sim.grantShotgun(Sim.newPlayerState(0, 0, 0)), 'only knights get the shotgun');
});

test('shotgun pellets are deterministic per input and stay inside the spread', () => {
  const a = Sim.pelletDirs(0.3, 0.1, 42), b = Sim.pelletDirs(0.3, 0.1, 42), c = Sim.pelletDirs(0.3, 0.1, 43);
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
  const f = Sim.aimDirection(0.3, 0.1);
  for (const d of a) {
    assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9);
    assert.ok(Math.acos(Math.min(1, d.x * f.x + d.y * f.y + d.z * f.z)) <= 0.066);
  }
});

test('sword reach: close and in front hits, behind or far misses', () => {
  const eye = { x: 0, y: 1.62, z: 0 }, fwd = Sim.aimDirection(0, 0);
  assert.ok(Sim.swordReach(eye, fwd, { x: 0, y: 0, z: -2 }));
  assert.ok(!Sim.swordReach(eye, fwd, { x: 0, y: 0, z: 2 }), 'behind');
  assert.ok(!Sim.swordReach(eye, fwd, { x: 0, y: 0, z: -4 }), 'too far');
  assert.ok(!Sim.swordReach(eye, fwd, { x: 2, y: 0, z: -0.5 }), 'outside the arc');
});

test('weapon damage: shotgun falls off hard, sword is flat', () => {
  assert.strictEqual(Sim.damageFor('body', 5, false, 'shotgun'), 13);
  assert.ok(Sim.damageFor('body', 25, false, 'shotgun') <= 4);
  assert.strictEqual(Sim.damageFor('body', 2, false, 'sword'), Sim.SWORD_DAMAGE);
});

test('assassin sniper: 5-round bolt action, reloads, scoped shots are dead accurate', () => {
  const p = Sim.newPlayerState(-12, -24, 1);
  assert.strictEqual(Sim.weaponOf(p), 'sniper');
  assert.strictEqual(p.ammo, Sim.SNIPER_MAG);
  let shots = 0;
  for (let i = 0; i < 120; i++) if (Sim.stepPlayer(p, input({ b: Sim.BTN.FIRE })).fire) shots++;
  assert.strictEqual(shots, 2, '2 s of fire = 2 bolt-action shots');
  p.ammo = 0; p.fireCd = 0;
  assert.ok(Sim.stepPlayer(p, input({ b: Sim.BTN.FIRE })).reloadStart);
  run(p, input(), Sim.SNIPER_RELOAD_TICKS);
  assert.strictEqual(p.ammo, Sim.SNIPER_MAG);
  const f = Sim.aimDirection(0.4, 0.1);
  assert.deepStrictEqual(Sim.sniperDir(0.4, 0.1, 9, true), f);
  const hip = Sim.sniperDir(0.4, 0.1, 9, false), ang = Math.acos(Math.min(1, hip.x * f.x + hip.y * f.y + hip.z * f.z));
  assert.ok(ang > 0 && ang <= 0.051, 'hip spread ' + ang);
  assert.deepStrictEqual(hip, Sim.sniperDir(0.4, 0.1, 9, false), 'seeded: client and server agree');
  assert.strictEqual(Sim.damageFor('head', 120, false, 'sniper'), 150);
});

test('obliteration beam: charge-up slows you, then it fires on its own', () => {
  const p = Sim.newPlayerState(-12, -24, 1); p.ult = 1;
  const ev = Sim.stepPlayer(p, input({ b: Sim.BTN.FIRE }));
  assert.ok(ev.ultStart && !ev.fire); assert.strictEqual(p.ammo, Sim.SNIPER_MAG, 'the beam costs no ammo');
  let fired = 0, z0 = p.z;
  for (let i = 0; i < Sim.ULT_CHARGE_TICKS + 5; i++) if (Sim.stepPlayer(p, input({ mz: 1 })).ultFire) fired = i + 1;
  assert.strictEqual(fired, Sim.ULT_CHARGE_TICKS);
  assert.ok(z0 - p.z < 6.7 * 1.7 * 0.45, 'slowed while charging: moved ' + (z0 - p.z));
  assert.strictEqual(p.ult, 0);
});

test('beam path and the burning half of the alley', () => {
  const o = { x: 0, y: 1.6, z: -50 }, axis = Sim.beamAxis(Math.PI); // looking +z down the alley
  assert.ok(Sim.inBeam(o, axis, { x: 5, y: 0, z: 30 }));
  assert.ok(!Sim.inBeam(o, axis, { x: 10, y: 0, z: 30 }), 'outside the 14 m beam');
  assert.ok(!Sim.inBeam(o, axis, { x: 0, y: 0, z: -55 }), 'behind the shooter');
  const zone = Sim.fireZoneFor(o, axis);
  assert.deepStrictEqual(zone, { axis: 'z', sign: 1 });
  assert.ok(Sim.inFireZone(zone, { x: 3, y: 0, z: 20 }));
  assert.ok(!Sim.inFireZone(zone, { x: 3, y: 0, z: -20 }));
  assert.ok(!Sim.inFireZone(zone, { x: 15, y: Sim.CATWALK_TOP, z: 20 }), 'fire escapes are safe');
});

console.log(`sim: ${passed} passed`);
