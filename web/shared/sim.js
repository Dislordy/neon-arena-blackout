/*
 * NEON ARENA: BLACKOUT — shared simulation.
 *
 * This file is loaded by BOTH the Node server (require) and the browser
 * (<script src="/shared/sim.js">, exposed as window.NeonSim). Because the
 * server and the client run the exact same movement, collision and weapon
 * code, the client can predict its own movement instantly while the server
 * stays the single source of truth for position, ammo, hits and damage.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NeonSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- constants
  const TICK_RATE = 60;
  const DT = 1 / TICK_RATE;
  const SNAPSHOT_EVERY = 2;            // 30 Hz snapshots
  const INTERP_DELAY_MS = 100;         // remote players are rendered 100 ms in the past
  const MAX_REWIND_MS = 300;           // lag compensation window

  const PLAYER_RADIUS = 0.35;
  const PLAYER_HEIGHT = 1.8;
  const EYE_HEIGHT = 1.62;
  const STEP_HEIGHT = 0.45;

  const MOVE_SPEED = 6.2;
  const GROUND_ACCEL = 14;
  const AIR_ACCEL = 2.5;
  const GRAVITY = 19;
  const JUMP_VELOCITY = 7.2;
  const DASH_SPEED = 19;
  const DASH_TICKS = 13;               // ~0.22 s
  const DASH_COOLDOWN_TICKS = 5 * TICK_RATE;

  const MAG_SIZE = 24;
  const FIRE_TICKS = 11;               // ~183 ms between shots (~330 RPM)
  const RELOAD_TICKS = 81;             // 1.35 s
  const MAX_RANGE = 90;

  const BTN = { JUMP: 1, DASH: 2, FIRE: 4, RELOAD: 8, ADS: 16 };

  // ---------------------------------------------------------------- classes
  // Every runner has health + a regenerating energy shield that soaks damage first.
  const SHIELD_REGEN_DELAY_MS = 3500;   // no damage for this long -> shield starts refilling
  const SHIELD_REGEN_PER_S = 25;
  const WEAPON = { RIFLE: 'rifle', SWORD: 'sword', SHOTGUN: 'shotgun' };
  const CLASSES = [
    { id: 0, key: 'soldier', name: 'SOLDIER', hp: 100, shield: 50, speed: MOVE_SPEED, dashes: 1, dashRecharge: DASH_COOLDOWN_TICKS, dashGap: 0, weapon: WEAPON.RIFLE },
    // three dash charges that refill one at a time
    { id: 1, key: 'assassin', name: 'ASSASSIN', hp: 85, shield: 50, speed: 6.7, dashes: 3, dashRecharge: Math.round(2.8 * TICK_RATE), dashGap: 16, weapon: WEAPON.RIFLE },
    // greatsword; every kill turns it into a shotgun until the shells run out
    { id: 2, key: 'knight', name: 'KNIGHT', hp: 130, shield: 50, speed: 6.0, dashes: 1, dashRecharge: DASH_COOLDOWN_TICKS, dashGap: 0, weapon: WEAPON.SWORD }
  ];
  const classOf = p => CLASSES[p && p.cls | 0] || CLASSES[0];

  // Knight weapons
  const SWORD_TICKS = 33;              // 0.55 s between swings
  const SWORD_RANGE = 2.7;             // metres from the eye to the target's chest
  const SWORD_ARC_COS = Math.cos(0.7); // ~40 degree half-angle cone
  const SWORD_DAMAGE = 60;
  const SWORD_LUNGE = 3.5;             // small forward step on each swing
  const SHOTGUN_SHELLS = 6;
  const SHOTGUN_TICKS = 48;            // 0.8 s pump
  const SHOTGUN_PELLETS = 8;
  const SHOTGUN_SPREAD = 0.065;        // radians
  const SHOTGUN_RANGE = 35;
  const TRANSFORM_TICKS = 24;          // sword -> shotgun transformation time (can't fire meanwhile)

  const ARENA_HALF = 28;               // perimeter wall centre line
  const WALL_HEIGHT = 7;

  // --------------------------------------------------------------------- map
  // Every solid object in the arena is an axis-aligned box. The client builds
  // detailed visuals on top of these, the server uses them for collision and
  // for blocking bullets.
  const boxes = [];
  function add(kind, cx, cz, sx, sz, h, y0 = 0, extra = {}) {
    boxes.push(Object.assign({
      kind,
      min: [cx - sx / 2, y0, cz - sz / 2],
      max: [cx + sx / 2, y0 + h, cz + sz / 2]
    }, extra));
  }
  // Adds a box and its 180-degree rotated twin so both halves of the map play the same.
  function addSym(kind, cx, cz, sx, sz, h, y0 = 0, extra = {}) {
    add(kind, cx, cz, sx, sz, h, y0, extra);
    add(kind, -cx, -cz, sx, sz, h, y0, Object.assign({}, extra, extra.dir ? { dir: [-extra.dir[0], -extra.dir[1]] } : {}));
  }

  // Perimeter
  const A = ARENA_HALF;
  add('perimeter', 0, -A, 2 * A + 1, 1, WALL_HEIGHT);
  add('perimeter', 0, A, 2 * A + 1, 1, WALL_HEIGHT);
  add('perimeter', -A, 0, 1, 2 * A + 1, WALL_HEIGHT);
  add('perimeter', A, 0, 1, 2 * A + 1, WALL_HEIGHT);

  // Central reactor core
  add('core', 0, 0, 4, 4, 5.5);

  // Buildings
  addSym('block', -14, -12, 6, 5, 4.5);
  addSym('block', 14, -13, 5, 7, 4);
  addSym('block', -20.5, 0, 3, 6, 3.8);
  addSym('tower', -6.5, -6.5, 2.4, 2.4, 4.2);

  // Mid lanes cover walls
  addSym('wall', -8, 0, 1.2, 7, 2.6);
  addSym('wall', 0, -9, 7, 1.2, 2.6);
  addSym('wall', 0, -18.5, 8, 1.6, 3);

  // Jumpable crates (1.1 m) and a few stacks
  addSym('crate', -4, -5, 1.4, 1.4, 1.1);
  addSym('crate', -11, 5, 1.4, 1.4, 1.1);
  addSym('crate', -11.2, 5.1, 1.2, 1.2, 1.0, 1.1);
  addSym('crate', -3, 14, 1.4, 1.4, 1.1);
  addSym('crate', -22.5, -8, 1.4, 1.4, 1.1);
  addSym('crate', -22.5, 8, 1.4, 1.4, 1.1);
  addSym('crate', -9.5, -21.5, 1.4, 1.4, 1.1);
  addSym('crate', -8.1, -21.6, 1.2, 1.2, 1.1);

  // Barrels (collide as boxes, drawn as cylinders)
  addSym('barrel', -5.6, -3.4, 0.8, 0.8, 1.2);
  addSym('barrel', -17, -4.2, 0.8, 0.8, 1.2);
  addSym('barrel', -17.9, -4.6, 0.8, 0.8, 1.2);
  addSym('barrel', 9, -17, 0.8, 0.8, 1.2);
  addSym('barrel', -24.8, -16, 0.8, 0.8, 1.2);

  // Street vending machines against the north/south walls (front faces into the arena)
  addSym('vending', -7, -26.95, 1.2, 0.9, 2.1, 0, { dir: [0, 1] });
  addSym('vending', 18.5, -26.95, 1.2, 0.9, 2.1, 0, { dir: [0, 1] });

  // Elevated catwalks along the perimeter with staircases leading up to them
  const CATWALK_Y = 3.05, CATWALK_TOP = 3.3, STEP_RISE = 0.3, STEP_RUN = 0.42;
  function catwalkWithStairs(x0, x1, z0, z1, stairX, stairZ0, stairZ1, stairDir) {
    // catwalk deck
    addSym('catwalk', (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, CATWALK_TOP - CATWALK_Y, CATWALK_Y);
    // stairs descend from stairX along +/-x
    const steps = Math.round(CATWALK_TOP / STEP_RISE) - 1;
    for (let i = 0; i < steps; i++) {
      const top = CATWALK_TOP - STEP_RISE * (i + 1);
      const sx0 = stairX + stairDir * STEP_RUN * i;
      const cx = sx0 + stairDir * STEP_RUN / 2;
      addSym('stair', cx, (stairZ0 + stairZ1) / 2, STEP_RUN, stairZ1 - stairZ0, top);
    }
  }
  // North-west catwalk hugging the north wall, stairs heading east.
  catwalkWithStairs(-25, -15, -27.5, -24, -15, -27.5, -25.9, 1);
  // West catwalk hugging the west wall (south half), stairs heading north (along -z) are
  // expressed with a rotated helper to keep code compact.
  (function westCatwalk() {
    addSym('catwalk', -25.75, 19, 3.5, 10, CATWALK_TOP - CATWALK_Y, CATWALK_Y);
    const steps = Math.round(CATWALK_TOP / STEP_RISE) - 1;
    for (let i = 0; i < steps; i++) {
      const top = CATWALK_TOP - STEP_RISE * (i + 1);
      const cz = 14 - STEP_RUN * i - STEP_RUN / 2;
      addSym('stair', -26.7, cz, 1.6, STEP_RUN, top);
    }
  })();

  // Spawn points (validated by the test-suite to be clear of geometry)
  const spawns = [
    [-18, -20], [18, 20], [-24, 2], [24, -2], [-10, -14], [10, 14], [-15, 21],
    [15, -21], [-3.5, -12.5], [3.5, 12.5], [-12, -2], [12, 2], [-24, -21], [24, 21]
  ].map(([x, z]) => ({ x, z }));

  // ------------------------------------------------------------------ helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function newPlayerState(x = 0, z = 0, cls = 0) {
    const C = CLASSES[cls | 0] || CLASSES[0];
    return {
      x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, og: true, alive: true,
      cls: C.id, dashT: 0, dashCd: 0, dashN: C.dashes, dashGap: 0, ddx: 0, ddz: 0,
      wpn: 0, ammo: C.weapon === WEAPON.RIFLE ? MAG_SIZE : 0, reload: 0, fireCd: 0
    };
  }
  const SIM_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'og', 'alive', 'cls', 'dashT', 'dashCd', 'dashN', 'dashGap', 'ddx', 'ddz', 'wpn', 'ammo', 'reload', 'fireCd'];
  /** Which weapon is in this player's hands right now. */
  function weaponOf(p) { const C = classOf(p); return C.weapon === WEAPON.SWORD && p.wpn === 1 ? WEAPON.SHOTGUN : C.weapon; }
  /** Knight kill reward: the sword transforms into a loaded shotgun (a kill while holding it reloads it). */
  function grantShotgun(p) {
    if (classOf(p).weapon !== WEAPON.SWORD) return false;
    p.wpn = 1; p.ammo = SHOTGUN_SHELLS; p.fireCd = Math.max(p.fireCd, TRANSFORM_TICKS); p.reload = 0;
    return true;
  }
  function copyState(src, dst = {}) { for (const k of SIM_KEYS) dst[k] = src[k]; return dst; }

  function overlaps(x, y, z, b) {
    return x - PLAYER_RADIUS < b.max[0] && x + PLAYER_RADIUS > b.min[0] &&
      z - PLAYER_RADIUS < b.max[2] && z + PLAYER_RADIUS > b.min[2] &&
      y < b.max[1] && y + PLAYER_HEIGHT > b.min[1];
  }
  function isFree(x, y, z) {
    for (let i = 0; i < boxes.length; i++) if (overlaps(x, y, z, boxes[i])) return false;
    return true;
  }
  const EPS = 1e-4;

  function moveHorizontal(p, axis, delta) {
    if (delta === 0) return;
    const ai = axis === 'x' ? 0 : 2;
    p[axis] += delta;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!overlaps(p.x, p.y, p.z, b)) continue;
      const rise = b.max[1] - p.y;
      if (p.og && rise > 0 && rise <= STEP_HEIGHT && isFree(p.x, b.max[1] + EPS, p.z)) {
        p.y = b.max[1] + EPS;
        continue;
      }
      if (delta > 0) p[axis] = b.min[ai] - PLAYER_RADIUS - EPS;
      else p[axis] = b.max[ai] + PLAYER_RADIUS + EPS;
      if (axis === 'x') p.vx = 0; else p.vz = 0;
    }
  }
  function moveVertical(p, delta) {
    p.y += delta;
    let grounded = false;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!overlaps(p.x, p.y, p.z, b)) continue;
      if (delta <= 0) { p.y = b.max[1] + EPS; grounded = true; }
      else p.y = b.min[1] - PLAYER_HEIGHT - EPS;
      p.vy = 0;
    }
    if (p.y <= 0) { p.y = 0; p.vy = Math.max(0, p.vy); grounded = true; }
    return grounded;
  }
  // Highest supporting surface within `range` under the player's feet, or null.
  function groundBelow(p, range) {
    let best = p.y - range <= 0 ? 0 : null;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (p.x - PLAYER_RADIUS >= b.max[0] || p.x + PLAYER_RADIUS <= b.min[0] ||
        p.z - PLAYER_RADIUS >= b.max[2] || p.z + PLAYER_RADIUS <= b.min[2]) continue;
      const top = b.max[1];
      if (top <= p.y + EPS * 2 && top >= p.y - range && (best === null || top > best)) best = top;
    }
    return best;
  }

  /**
   * Advance one player by exactly one tick using one input command.
   * Input: { mx, mz (strafe/forward, -1..1), yaw, pitch, b (button bitmask) }
   * Returns gameplay events produced this tick (used for effects/hit detection).
   */
  function stepPlayer(p, input) {
    const ev = { fire: false, dry: false, jump: false, land: false, dash: false, reloadStart: false, reloaded: false, swing: false, sheathe: false };
    const yaw = Number(input.yaw), pitch = Number(input.pitch);
    if (Number.isFinite(yaw)) p.yaw = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    if (Number.isFinite(pitch)) p.pitch = clamp(pitch, -1.45, 1.45);
    if (!p.alive) return ev;
    const b = input.b | 0;

    const C = classOf(p), weapon = weaponOf(p);
    if (p.fireCd > 0) p.fireCd--;
    if (p.dashGap > 0) p.dashGap--;
    // dash charges refill one at a time
    if (p.dashN < C.dashes) {
      if (p.dashCd > 0) p.dashCd--;
      if (p.dashCd === 0) { p.dashN++; if (p.dashN < C.dashes) p.dashCd = C.dashRecharge; }
    }
    if (p.reload > 0) { p.reload--; if (p.reload === 0) { p.ammo = MAG_SIZE; ev.reloaded = true; } }

    let mx = clamp(Number(input.mx) || 0, -1, 1), mz = clamp(Number(input.mz) || 0, -1, 1);
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const wx = cy * mx - sy * mz, wz = -sy * mx - cy * mz;

    if ((b & BTN.DASH) && p.dashN > 0 && p.dashGap === 0 && p.dashT === 0) {
      let dx = wx, dz = wz;
      const l = Math.hypot(dx, dz);
      if (l < 0.1) { dx = -sy; dz = -cy; } else { dx /= l; dz /= l; }
      if (p.dashN === C.dashes) p.dashCd = C.dashRecharge; // start refilling
      p.dashN--; p.dashGap = C.dashGap;
      p.ddx = dx; p.ddz = dz; p.dashT = DASH_TICKS; ev.dash = true;
    }
    if (p.dashT > 0) {
      p.dashT--;
      p.vx = p.ddx * DASH_SPEED; p.vz = p.ddz * DASH_SPEED;
      if (p.dashT === 0) { p.vx *= 0.35; p.vz *= 0.35; }
    } else {
      const k = 1 - Math.exp(-(p.og ? GROUND_ACCEL : AIR_ACCEL) * DT);
      p.vx += (wx * C.speed - p.vx) * k;
      p.vz += (wz * C.speed - p.vz) * k;
    }

    const wasGrounded = p.og;
    if ((b & BTN.JUMP) && p.og) { p.vy = JUMP_VELOCITY; p.og = false; ev.jump = true; }
    p.vy -= GRAVITY * DT * (p.dashT > 0 ? 0.25 : 1);

    moveHorizontal(p, 'x', p.vx * DT);
    moveHorizontal(p, 'z', p.vz * DT);
    const vyBefore = p.vy;
    let grounded = moveVertical(p, p.vy * DT);
    if (!grounded && wasGrounded && !ev.jump && p.vy <= 0) {
      const g = groundBelow(p, STEP_HEIGHT);
      if (g !== null) { p.y = g + (g > 0 ? EPS : 0); p.vy = 0; grounded = true; }
    }
    if (grounded && !wasGrounded && vyBefore < -4) ev.land = true;
    p.og = grounded;
    // hard safety clamp inside the perimeter
    const lim = ARENA_HALF - 0.5 - PLAYER_RADIUS;
    p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim);

    if (weapon === WEAPON.RIFLE) {
      if ((b & BTN.RELOAD) && p.reload === 0 && p.ammo < MAG_SIZE) { p.reload = RELOAD_TICKS; ev.reloadStart = true; }
      if ((b & BTN.FIRE) && p.fireCd === 0 && p.reload === 0) {
        if (p.ammo > 0) { p.ammo--; p.fireCd = FIRE_TICKS; ev.fire = true; }
        else { p.reload = RELOAD_TICKS; p.fireCd = FIRE_TICKS; ev.dry = true; ev.reloadStart = true; }
      }
    } else if (weapon === WEAPON.SWORD) {
      if ((b & BTN.FIRE) && p.fireCd === 0) {
        p.fireCd = SWORD_TICKS; ev.swing = true;
        if (p.og && p.dashT === 0) { p.vx -= sy * SWORD_LUNGE; p.vz -= cy * SWORD_LUNGE; }
      }
    } else { // shotgun: fire the shells, then it folds back into the sword
      if ((b & BTN.FIRE) && p.fireCd === 0 && p.ammo > 0) { p.ammo--; p.fireCd = SHOTGUN_TICKS; ev.fire = true; ev.shotgun = true; }
      else if (p.ammo === 0 && p.fireCd === 0) { p.wpn = 0; ev.sheathe = true; }
    }
    return ev;
  }

  // ------------------------------------------------------------ ray casting
  function aimDirection(yaw, pitch) {
    const cp = Math.cos(pitch);
    return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
  }
  function eyeOf(p) { return { x: p.x, y: p.y + EYE_HEIGHT, z: p.z }; }

  function rayBox(o, d, b, maxT) {
    let tmin = 0, tmax = maxT, axisHit = -1, sign = 0;
    const O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(D[a]) < 1e-9) {
        if (O[a] < b.min[a] || O[a] > b.max[a]) return null;
        continue;
      }
      const inv = 1 / D[a];
      let t1 = (b.min[a] - O[a]) * inv, t2 = (b.max[a] - O[a]) * inv, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axisHit = a; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (axisHit < 0) return null; // ray starts inside the box
    const n = [0, 0, 0]; n[axisHit] = sign;
    return { t: tmin, n };
  }
  /** Nearest world surface along a ray (boxes + floor). */
  function raycastWorld(o, d, maxT = MAX_RANGE) {
    let best = null;
    for (let i = 0; i < boxes.length; i++) {
      const h = rayBox(o, d, boxes[i], best ? best.t : maxT);
      if (h && (!best || h.t < best.t)) best = { t: h.t, n: h.n, kind: boxes[i].kind, index: i };
    }
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t > 0 && t < (best ? best.t : maxT)) best = { t, n: [0, 1, 0], kind: 'floor', index: -1 };
    }
    return best;
  }
  function raySphere(o, d, c, r) {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const bq = ox * d.x + oy * d.y + oz * d.z;
    const cq = ox * ox + oy * oy + oz * oz - r * r;
    const disc = bq * bq - cq;
    if (disc < 0) return null;
    const t = -bq - Math.sqrt(disc);
    return t >= 0 ? t : null;
  }
  // Ray vs vertical capsule (segment from y0 to y1 at x,z with radius r).
  function rayCapsule(o, d, x, z, y0, y1, r) {
    // closest points between ray o+t*d and segment a+s*(b-a)
    const ux = d.x, uy = d.y, uz = d.z;
    const vy = y1 - y0;
    const wx = o.x - x, wy = o.y - y0, wz = o.z - z;
    const a = 1, bb = uy * vy, c = vy * vy, dd = ux * wx + uy * wy + uz * wz, e = vy * wy;
    const den = a * c - bb * bb;
    let s = den > 1e-9 ? (a * e - bb * dd) / den : 0;
    s = clamp(s, 0, 1);
    let t = (bb * s - dd) / a;
    if (t < 0) t = 0;
    s = clamp((t * bb + e) / c, 0, 1);
    const px = o.x + ux * t - x, py = o.y + uy * t - (y0 + vy * s), pz = o.z + uz * t - z;
    const dist2 = px * px + py * py + pz * pz;
    if (dist2 > r * r) return null;
    return Math.max(0, t - Math.sqrt(r * r - dist2));
  }
  /** Ray vs player hitboxes (head sphere + torso capsule + legs capsule). */
  function rayPlayer(o, d, pos, maxT = MAX_RANGE) {
    let best = null;
    const ht = raySphere(o, d, { x: pos.x, y: pos.y + 1.6, z: pos.z }, 0.2);
    if (ht !== null && ht < maxT) best = { t: ht, part: 'head' };
    const bt = rayCapsule(o, d, pos.x, pos.z, pos.y + 0.95, pos.y + 1.32, 0.33);
    if (bt !== null && bt < maxT && (!best || bt < best.t)) best = { t: bt, part: 'body' };
    const lt = rayCapsule(o, d, pos.x, pos.z, pos.y + 0.18, pos.y + 0.95, 0.24);
    if (lt !== null && lt < maxT && (!best || lt < best.t)) best = { t: lt, part: 'legs' };
    return best;
  }
  /**
   * Damage model.
   * rifle: headshots x2, legs x0.75, falloff past 25 m (to 65% at 70 m).
   * shotgun (per pellet): 13 body / 20 head / 10 legs, full up to 8 m, down to 25% at 25 m.
   * sword: flat SWORD_DAMAGE.
   * shielded = the SHIELD ability is active (hardened: 30% damage).
   */
  function damageFor(part, dist, shielded, weapon = WEAPON.RIFLE) {
    let dmg;
    if (weapon === WEAPON.SWORD) dmg = SWORD_DAMAGE;
    else if (weapon === WEAPON.SHOTGUN) {
      dmg = part === 'head' ? 20 : part === 'legs' ? 10 : 13;
      dmg *= dist <= 8 ? 1 : Math.max(0.25, 1 - (dist - 8) / 17 * 0.75);
    } else {
      dmg = part === 'head' ? 68 : part === 'legs' ? 26 : 34;
      dmg *= dist <= 25 ? 1 : Math.max(0.65, 1 - (dist - 25) / 45 * 0.35);
    }
    if (shielded) dmg *= 0.3;
    return Math.max(1, Math.round(dmg));
  }

  /**
   * Shotgun pellet directions. Seeded by the input sequence number so the server and the
   * shooter's own client produce exactly the same spread pattern.
   */
  function pelletDirs(yaw, pitch, seed) {
    const out = [], f = aimDirection(yaw, pitch);
    // right/up basis around the aim direction
    let rx = -f.z, rz = f.x; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const ux = -rz * f.y, uy = rz * f.x - rx * f.z, uz = rx * f.y;
    let s = ((seed | 0) * 2654435761 >>> 0) || 1;
    const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
    for (let i = 0; i < SHOTGUN_PELLETS; i++) {
      // first pellet dead centre, the rest on a jittered ring
      const r = i === 0 ? 0 : SHOTGUN_SPREAD * (0.45 + 0.55 * rnd()), a = i / (SHOTGUN_PELLETS - 1) * Math.PI * 2 + rnd() * 0.6;
      const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
      const x = f.x + rx * ox + ux * oy, y = f.y + uy * oy, z = f.z + rz * ox + uz * oy, l = Math.hypot(x, y, z);
      out.push({ x: x / l, y: y / l, z: z / l });
    }
    return out;
  }

  /**
   * Sword hit test: is this target within reach and inside the swing's cone?
   * Returns { t: distance, part } or null. Walls are checked by the caller.
   */
  function swordReach(eye, dir, pos) {
    let best = null;
    for (const [part, h] of [['head', 1.6], ['body', 1.15], ['legs', 0.6]]) {
      const dx = pos.x - eye.x, dy = pos.y + h - eye.y, dz = pos.z - eye.z, d = Math.hypot(dx, dy, dz);
      if (d > SWORD_RANGE + PLAYER_RADIUS) continue;
      const cos = d < 0.3 ? 1 : (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (cos < SWORD_ARC_COS) continue;
      if (!best || cos > best.cos) best = { t: d, part: part === 'head' ? 'head' : 'body', cos, point: { x: pos.x, y: pos.y + h, z: pos.z } };
    }
    return best;
  }

  return {
    TICK_RATE, DT, SNAPSHOT_EVERY, INTERP_DELAY_MS, MAX_REWIND_MS,
    PLAYER_RADIUS, PLAYER_HEIGHT, EYE_HEIGHT, STEP_HEIGHT, MOVE_SPEED, JUMP_VELOCITY,
    DASH_TICKS, DASH_COOLDOWN_TICKS, MAG_SIZE, FIRE_TICKS, RELOAD_TICKS, MAX_RANGE, BTN,
    CLASSES, WEAPON, classOf, weaponOf, grantShotgun, SHIELD_REGEN_DELAY_MS, SHIELD_REGEN_PER_S,
    SWORD_TICKS, SWORD_RANGE, SWORD_DAMAGE, SHOTGUN_SHELLS, SHOTGUN_TICKS, SHOTGUN_PELLETS, SHOTGUN_RANGE, TRANSFORM_TICKS,
    pelletDirs, swordReach,
    ARENA_HALF, WALL_HEIGHT, CATWALK_TOP, boxes, spawns,
    newPlayerState, copyState, stepPlayer, isFree, aimDirection, eyeOf,
    rayBox, raycastWorld, rayPlayer, damageFor, clamp
  };
});
