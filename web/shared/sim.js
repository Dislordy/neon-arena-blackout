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
  const WEAPON = { RIFLE: 'rifle', SWORD: 'sword', SHOTGUN: 'shotgun', SNIPER: 'sniper', CLAWS: 'claws' };
  const CLASSES = [
    { id: 0, key: 'soldier', name: 'SOLDIER', hp: 100, shield: 50, speed: MOVE_SPEED, dashes: 1, dashRecharge: DASH_COOLDOWN_TICKS, dashGap: 0, weapon: WEAPON.RIFLE },
    // sniper rifle + three dash charges that refill one at a time; 5 kills in a row charge the Obliteration Beam
    { id: 1, key: 'assassin', name: 'ASSASSIN', hp: 85, shield: 50, speed: 6.7, dashes: 3, dashRecharge: Math.round(2.8 * TICK_RATE), dashGap: 16, weapon: WEAPON.SNIPER },
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

  // Assassin sniper rifle (bolt action)
  const SNIPER_MAG = 5;
  const SNIPER_TICKS = 66;             // 1.1 s bolt cycle
  const SNIPER_RELOAD_TICKS = 126;     // 2.1 s
  const SNIPER_RANGE = 140;
  const SNIPER_HIP_SPREAD = 0.05;      // radians when not scoped (scoped = dead accurate)
  // Obliteration Beam: earned with 5 kills in a row (without dying)
  const ULT_STREAK = 5;
  const ULT_CHARGE_TICKS = 96;         // 1.6 s build-up (rune circle) before the beam fires
  const ULT_SLOW = 0.3;                // move speed while charging
  const BEAM_RADIUS = 7;               // 14 m wide: half the width of the alley
  const BEAM_LENGTH = 140;
  const FIRE_ZONE_MS = 15000;          // the half of the alley the beam went into burns this long
  const FIRE_DPS = 20;
  const FIRE_HEIGHT = 1.5;             // standing above this (fire escapes, bridges) keeps you out of the flames
  // Soldier: 3 kills in a row -> runes crawl over the body -> the Rune-Warden (monster form) for 20 s
  const MON_STREAK = 3;
  const MON_RISE_TICKS = 90;           // 1.5 s transformation (slowed, can't attack)
  const MON_TICKS = 20 * TICK_RATE;    // 20 s as the monster
  const MON_HP = 250;
  const MON_SPEED = 7.4;
  const MON_JUMP = 9.2;                // ~2.2 m jumps
  const MON_SCALE = 1.35;              // bigger body = bigger hitboxes
  const CLAW_TICKS = 30;               // 0.5 s per slash
  const CLAW_RANGE = 3.4;
  const CLAW_ARC_COS = Math.cos(0.9);  // ~50 degree half-angle
  const CLAW_DAMAGE = 85;
  const CLAW_LUNGE = 5;
  const ADAPT_STEP = 0.15, ADAPT_MAX = 4; // each hit from the same weapon type: 15% less next time, up to 60%
  // Beam clash: two beams meet -> quick cutscene + W/A/S/D quick-time duel
  const CLASH_INTRO_MS = 1200;         // cutscene intro before keys count
  const CLASH_QTE_MS = 5000;           // time to hit as many keys of the sequence as you can
  const CLASH_OUTRO_MS = 900;
  const CLASH_MISS_MS = 300;           // wrong key: stunned this long
  const CLASH_SEQ = 60;                // sequence length (more than anyone can hit in 5 s)
  const CLASH_KEYS = ['w', 'a', 's', 'd'];

  // ---------------------------------------------------------------- map size
  // V4.6 "The Alley": a long back-alley between two run-down megablocks.
  // The building fronts on both sides are solid; the two open ends are invisible walls.
  const HALF_X = 16;                   // building fronts at x = +/-16 (alcoves go 3 m deeper)
  const HALF_Z = 56;                   // invisible walls at z = +/-56 (112 m long)
  const FACADE_HEIGHT = 9;             // collision height of the building fronts (visuals go higher)
  const ALCOVE_DEPTH = 3;

  // --------------------------------------------------------------------- map
  // Every solid object is an axis-aligned box. The client builds detailed visuals
  // on top of these, the server uses them for collision and for blocking bullets.
  // Kinds that never stop bullets: 'boundary' (invisible wall), 'fence' (chain-link).
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
    const twin = Object.assign({}, extra);
    if (extra.dir) twin.dir = [-extra.dir[0], -extra.dir[1]];
    if (extra.side) twin.side = -extra.side;
    add(kind, -cx, -cz, sx, sz, h, y0, twin);
  }

  // Building fronts. Defined for the right side (x > 0) and mirrored; recessed alcoves
  // (loading bays / doorways) break them up and give extra cover.
  const ALCOVES_RIGHT = [-42, -10, 34];            // alcove centre z on the right-hand front (left side is mirrored)
  const ALCOVE_W = 5.5, END = HALF_Z + 30;         // fronts continue into the fog past the invisible walls
  (function fronts() {
    let z = -END;
    for (const zc of ALCOVES_RIGHT) {
      const a0 = zc - ALCOVE_W / 2, a1 = zc + ALCOVE_W / 2;
      addSym('facade', HALF_X + 0.5, (z + a0) / 2, 1, a0 - z, FACADE_HEIGHT, 0, { side: 1 });
      // the alcove: back wall + two side walls, with a lintel over the opening
      addSym('facade', HALF_X + ALCOVE_DEPTH + 0.5, zc, 1, ALCOVE_W, FACADE_HEIGHT, 0, { side: 1, alcove: true });
      addSym('facade', HALF_X + ALCOVE_DEPTH / 2, a0 - 0.25, ALCOVE_DEPTH, 0.5, FACADE_HEIGHT, 0, { side: 1, alcove: true });
      addSym('facade', HALF_X + ALCOVE_DEPTH / 2, a1 + 0.25, ALCOVE_DEPTH, 0.5, FACADE_HEIGHT, 0, { side: 1, alcove: true });
      addSym('facade', HALF_X + 0.5, zc, 1, ALCOVE_W, FACADE_HEIGHT - 3.2, 3.2, { side: 1, lintel: true });
      z = a1;
    }
    addSym('facade', HALF_X + 0.5, (z + END) / 2, 1, END - z, FACADE_HEIGHT, 0, { side: 1 });
  })();
  // The open ends of the alley: invisible walls (players stop, bullets fly on into the fog)
  addSym('boundary', 0, HALF_Z + 0.5, 2 * HALF_X, 1, 14);

  // Burnt-out bus blocking the middle of the alley
  add('bus', 0, 0, 2.8, 11, 3.0);

  // Wrecked cars
  addSym('car', -7.5, 9, 2.0, 4.4, 1.45);
  addSym('car', 7, 31, 4.4, 2.0, 1.45);
  addSym('car', -5, 47, 2.0, 4.4, 1.45);

  // Dumpsters against the building fronts (1.25 m: you can jump onto them)
  addSym('dumpster', HALF_X - 0.6, 4, 1.1, 2.2, 1.25, 0, { side: 1 });
  addSym('dumpster', HALF_X - 0.6, 41, 1.1, 2.2, 1.25, 0, { side: 1 });
  addSym('dumpster', -HALF_X + 0.6, 16, 1.1, 2.2, 1.25, 0, { side: -1 });

  // Concrete road barriers (1 m, jumpable)
  addSym('barrier', 6.5, 4, 0.6, 3.2, 1.0);
  addSym('barrier', -9, 26, 3.2, 0.6, 1.0);
  addSym('barrier', 2.5, 38, 3.2, 0.6, 1.0);
  addSym('barrier', 10.5, 50, 0.6, 3.2, 1.0);

  // Chain-link fence: blocks people, not bullets
  addSym('fence', -11, 36, 10, 0.12, 2.6);

  // Jumpable crates (1.1 m) and a few stacks
  addSym('crate', -4, -5, 1.4, 1.4, 1.1);
  addSym('crate', -11, 18, 1.4, 1.4, 1.1);
  addSym('crate', -11.2, 18.1, 1.2, 1.2, 1.0, 1.1);
  addSym('crate', 4.5, 17, 1.4, 1.4, 1.1);
  addSym('crate', 12, 11.5, 1.4, 1.4, 1.1);
  addSym('crate', -2, 33, 1.4, 1.4, 1.1);
  addSym('crate', -0.6, 33.1, 1.2, 1.2, 1.1);
  addSym('crate', 7.5, 44, 1.4, 1.4, 1.1);
  addSym('crate', -9.5, 52, 1.4, 1.4, 1.1);

  // Barrels (collide as boxes, drawn as cylinders). fire: a burning trash barrel.
  addSym('barrel', -6, 3, 0.8, 0.8, 1.2, 0, { fire: true });
  addSym('barrel', 11.5, 23, 0.8, 0.8, 1.2, 0, { fire: true });
  addSym('barrel', -13.8, 31, 0.8, 0.8, 1.2);
  addSym('barrel', -8.6, 40.5, 0.8, 0.8, 1.2, 0, { fire: true });
  addSym('barrel', -9.4, 40.9, 0.8, 0.8, 1.2);
  addSym('barrel', 3.6, 51, 0.8, 0.8, 1.2);

  // Shanty shack (homeless camp at the far end)
  addSym('shack', -13.4, 46, 3, 2.8, 2.4, 0, { side: -1 });

  // Street vending machines against the right-hand front (front faces into the alley)
  addSym('vending', HALF_X - 0.45, 26.4, 0.9, 1.2, 2.1, 0, { dir: [-1, 0] });
  addSym('vending', HALF_X - 0.45, 27.8, 0.9, 1.2, 2.1, 0, { dir: [-1, 0] });

  // Fire escapes along the building fronts, joined by footbridges across the alley.
  const CATWALK_Y = 3.05, CATWALK_TOP = 3.3, STEP_RISE = 0.3, STEP_RUN = 0.42;
  const STEPS = Math.round(CATWALK_TOP / STEP_RISE) - 1;
  /** Stairs along z: the top step starts at z0 and they descend in direction dir (+1/-1). */
  function stairsZ(x0, x1, z0, dir) {
    for (let i = 0; i < STEPS; i++) {
      const top = CATWALK_TOP - STEP_RISE * (i + 1);
      addSym('stair', (x0 + x1) / 2, z0 + dir * (STEP_RUN * i + STEP_RUN / 2), x1 - x0, STEP_RUN, top, 0, { alongZ: true });
    }
  }
  const deck = (x0, x1, z0, z1, extra = {}) => addSym('catwalk', (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, CATWALK_TOP - CATWALK_Y, CATWALK_Y, extra);
  // right-hand fire escape, stairs coming down towards the middle of the alley
  deck(HALF_X - 2.4, HALF_X, 14, 30, { side: 1 });
  stairsZ(HALF_X - 1.6, HALF_X, 14, -1);
  // footbridge across the alley
  deck(-HALF_X + 2.4, HALF_X - 2.4, 21, 23.2, { bridge: true });
  // landing on the left-hand front with its own stairs
  deck(-HALF_X, -HALF_X + 2.4, 18.5, 25.5, { side: -1 });
  stairsZ(-HALF_X, -HALF_X + 1.6, 25.5, 1);

  for (const b of boxes) b.solid = b.kind !== 'boundary' && b.kind !== 'fence';

  // Spawn points (validated by the test-suite to be clear of geometry); mirrored like the map
  const spawns = [[8, 53], [-8, 53], [-12, 40], [3, 27], [-4, 19], [9, 10], [-9, 1]]
    .flatMap(([x, z]) => [{ x, z }, { x: -x, z: -z }]);

  // ------------------------------------------------------------------ helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function newPlayerState(x = 0, z = 0, cls = 0) {
    const C = CLASSES[cls | 0] || CLASSES[0];
    return {
      x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, og: true, alive: true,
      cls: C.id, dashT: 0, dashCd: 0, dashN: C.dashes, dashGap: 0, ddx: 0, ddz: 0,
      wpn: 0, ammo: magOf(C.weapon), reload: 0, fireCd: 0, ult: 0, ultT: 0, lock: 0, mon: 0, monT: 0
    };
  }
  function magOf(weapon) { return weapon === WEAPON.RIFLE ? MAG_SIZE : weapon === WEAPON.SNIPER ? SNIPER_MAG : weapon === WEAPON.SHOTGUN ? SHOTGUN_SHELLS : 0; }
  const SIM_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'og', 'alive', 'cls', 'dashT', 'dashCd', 'dashN', 'dashGap', 'ddx', 'ddz', 'wpn', 'ammo', 'reload', 'fireCd', 'ult', 'ultT', 'lock', 'mon', 'monT'];
  /** Which weapon is in this player's hands right now. */
  function weaponOf(p) { if (p.mon > 0) return WEAPON.CLAWS; const C = classOf(p); return C.weapon === WEAPON.SWORD && p.wpn === 1 ? WEAPON.SHOTGUN : C.weapon; }
  /** Hitbox scale: the Rune-Warden is a lot bigger than a runner. */
  const scaleOf = p => (p && (p.mon > 0 || p.s > 1) ? MON_SCALE : 1);
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
    const ev = { fire: false, dry: false, jump: false, land: false, dash: false, reloadStart: false, reloaded: false, swing: false, sheathe: false, ultStart: false, ultFire: false, monStart: false, monEnd: false };
    const yaw = Number(input.yaw), pitch = Number(input.pitch);
    if (Number.isFinite(yaw)) p.yaw = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    if (Number.isFinite(pitch)) p.pitch = clamp(pitch, -1.45, 1.45);
    if (!p.alive) return ev;
    // locked in a beam clash: you can look around, nothing else
    if (p.lock > 0) { p.lock--; p.vx = p.vz = 0; p.dashT = 0; return ev; }
    const b = input.b | 0;

    const C = classOf(p);
    // Rune-Warden: rising (runes crawl over you), then 20 s of monster, then back to normal
    if (p.monT > 0) { p.monT--; if (p.monT === 0) { p.mon = MON_TICKS; p.fireCd = 0; p.reload = 0; ev.monStart = true; } }
    else if (p.mon > 0) { p.mon--; if (p.mon === 0) { p.fireCd = 12; ev.monEnd = true; } }
    const weapon = weaponOf(p);
    if (p.fireCd > 0) p.fireCd--;
    if (p.dashGap > 0) p.dashGap--;
    // dash charges refill one at a time
    if (p.dashN < C.dashes) {
      if (p.dashCd > 0) p.dashCd--;
      if (p.dashCd === 0) { p.dashN++; if (p.dashN < C.dashes) p.dashCd = C.dashRecharge; }
    }
    if (p.reload > 0) { p.reload--; if (p.reload === 0) { p.ammo = magOf(weapon); ev.reloaded = true; } }

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
      const speed = (p.mon > 0 ? MON_SPEED : C.speed) * (p.ultT > 0 || p.monT > 0 ? ULT_SLOW : 1);
      p.vx += (wx * speed - p.vx) * k;
      p.vz += (wz * speed - p.vz) * k;
    }

    const wasGrounded = p.og;
    if ((b & BTN.JUMP) && p.og) { p.vy = p.mon > 0 ? MON_JUMP : JUMP_VELOCITY; p.og = false; ev.jump = true; }
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
    // hard safety clamp inside the playable area (alcoves included)
    const limX = HALF_X + ALCOVE_DEPTH - PLAYER_RADIUS, limZ = HALF_Z - PLAYER_RADIUS;
    p.x = clamp(p.x, -limX, limX); p.z = clamp(p.z, -limZ, limZ);

    if (p.monT > 0) {
      // transforming: no attacks
    } else if (weapon === WEAPON.CLAWS) {
      if ((b & BTN.FIRE) && p.fireCd === 0) {
        p.fireCd = CLAW_TICKS; ev.swing = true; ev.claw = true;
        if (p.og && p.dashT === 0) { p.vx -= sy * CLAW_LUNGE; p.vz -= cy * CLAW_LUNGE; }
      }
    } else if (weapon === WEAPON.RIFLE) {
      if ((b & BTN.RELOAD) && p.reload === 0 && p.ammo < MAG_SIZE) { p.reload = RELOAD_TICKS; ev.reloadStart = true; }
      if ((b & BTN.FIRE) && p.fireCd === 0 && p.reload === 0) {
        if (p.ammo > 0) { p.ammo--; p.fireCd = FIRE_TICKS; ev.fire = true; }
        else { p.reload = RELOAD_TICKS; p.fireCd = FIRE_TICKS; ev.dry = true; ev.reloadStart = true; }
      }
    } else if (weapon === WEAPON.SNIPER) {
      if (p.ultT > 0) { // building up the Obliteration Beam: it fires on its own when the charge completes
        p.ultT--;
        if (p.ultT === 0) { p.ult = 0; p.fireCd = SNIPER_TICKS; ev.ultFire = true; }
      } else {
        if ((b & BTN.RELOAD) && p.reload === 0 && p.ammo < SNIPER_MAG) { p.reload = SNIPER_RELOAD_TICKS; ev.reloadStart = true; }
        if ((b & BTN.FIRE) && p.fireCd === 0 && p.reload === 0) {
          if (p.ult === 1) { p.ultT = ULT_CHARGE_TICKS; ev.ultStart = true; }
          else if (p.ammo > 0) { p.ammo--; p.fireCd = SNIPER_TICKS; ev.fire = true; ev.sniper = true; ev.scoped = !!(b & BTN.ADS); }
          else { p.reload = SNIPER_RELOAD_TICKS; p.fireCd = SNIPER_TICKS; ev.dry = true; ev.reloadStart = true; }
        }
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
      if (!boxes[i].solid) continue; // invisible walls and chain-link fences don't stop bullets
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
    const k = scaleOf(pos);
    const ht = raySphere(o, d, { x: pos.x, y: pos.y + 1.6 * k, z: pos.z }, 0.2 * k);
    if (ht !== null && ht < maxT) best = { t: ht, part: 'head' };
    const bt = rayCapsule(o, d, pos.x, pos.z, pos.y + 0.95 * k, pos.y + 1.32 * k, 0.33 * k);
    if (bt !== null && bt < maxT && (!best || bt < best.t)) best = { t: bt, part: 'body' };
    const lt = rayCapsule(o, d, pos.x, pos.z, pos.y + 0.18 * k, pos.y + 0.95 * k, 0.24 * k);
    if (lt !== null && lt < maxT && (!best || lt < best.t)) best = { t: lt, part: 'legs' };
    return best;
  }
  /**
   * Damage model.
   * rifle: headshots x2, legs x0.75, falloff past 25 m (to 65% at 70 m).
   * shotgun (per pellet): 13 body / 20 head / 10 legs, full up to 8 m, down to 25% at 25 m.
   * sniper: 150 head (one-shot) / 80 body / 60 legs, no falloff.
   * sword: flat SWORD_DAMAGE. claws (Rune-Warden): flat CLAW_DAMAGE.
   * shielded = the SHIELD ability is active (hardened: 30% damage).
   */
  function damageFor(part, dist, shielded, weapon = WEAPON.RIFLE) {
    let dmg;
    if (weapon === WEAPON.SWORD) dmg = SWORD_DAMAGE;
    else if (weapon === WEAPON.CLAWS) dmg = CLAW_DAMAGE;
    else if (weapon === WEAPON.SNIPER) dmg = part === 'head' ? 150 : part === 'legs' ? 60 : 80;
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

  /** Sniper shot direction: dead accurate when scoped, a seeded random stray from the hip. */
  function sniperDir(yaw, pitch, seed, scoped) {
    const f = aimDirection(yaw, pitch);
    if (scoped) return f;
    let rx = -f.z, rz = f.x; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const ux = -rz * f.y, uy = rz * f.x - rx * f.z, uz = rx * f.y;
    let s = ((seed | 0) * 2246822519 >>> 0) || 7;
    const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
    const r = SNIPER_HIP_SPREAD * Math.sqrt(rnd()), a = rnd() * Math.PI * 2, ox = Math.cos(a) * r, oy = Math.sin(a) * r;
    const x = f.x + rx * ox + ux * oy, y = f.y + uy * oy, z = f.z + rz * ox + uz * oy, l = Math.hypot(x, y, z);
    return { x: x / l, y: y / l, z: z / l };
  }
  /** Obliteration Beam: horizontal direction it fires in (it ignores pitch) */
  function beamAxis(yaw) { return { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) }; }
  /** Is a player standing at pos caught in the beam fired from origin along the (horizontal) axis? */
  function inBeam(origin, axis, pos) {
    const dx = pos.x - origin.x, dz = pos.z - origin.z, t = dx * axis.x + dz * axis.z;
    if (t < 0 || t > BEAM_LENGTH) return false;
    return Math.hypot(dx - axis.x * t, dz - axis.z * t) < BEAM_RADIUS;
  }
  /** Which half of the alley the beam set on fire: the end it was fired towards. */
  function fireZoneFor(origin, axis) {
    if (Math.abs(axis.z) >= Math.abs(axis.x) * 0.5) return { axis: 'z', sign: axis.z >= 0 ? 1 : -1 };
    return { axis: 'x', sign: axis.x >= 0 ? 1 : -1 };
  }
  function inFireZone(zone, pos) {
    if (!zone || pos.y > FIRE_HEIGHT) return false;
    return (zone.axis === 'z' ? pos.z : pos.x) * zone.sign > 0;
  }

  /**
   * Sword hit test: is this target within reach and inside the swing's cone?
   * Returns { t: distance, part } or null. Walls are checked by the caller.
   */
  function swordReach(eye, dir, pos, claws = false) {
    let best = null;
    const k = scaleOf(pos), range = claws ? CLAW_RANGE : SWORD_RANGE, arc = claws ? CLAW_ARC_COS : SWORD_ARC_COS;
    for (const [part, h0] of [['head', 1.6], ['body', 1.15], ['legs', 0.6]]) {
      const h = h0 * k;
      const dx = pos.x - eye.x, dy = pos.y + h - eye.y, dz = pos.z - eye.z, d = Math.hypot(dx, dy, dz);
      if (d > range + PLAYER_RADIUS * k) continue;
      const cos = d < 0.3 ? 1 : (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (cos < arc) continue;
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
    pelletDirs, swordReach, magOf, sniperDir, beamAxis, inBeam, fireZoneFor, inFireZone,
    MON_STREAK, MON_RISE_TICKS, MON_TICKS, MON_HP, MON_SCALE, CLAW_TICKS, CLAW_DAMAGE, CLAW_RANGE, ADAPT_STEP, ADAPT_MAX, scaleOf,
    CLASH_INTRO_MS, CLASH_QTE_MS, CLASH_OUTRO_MS, CLASH_MISS_MS, CLASH_SEQ, CLASH_KEYS,
    SNIPER_MAG, SNIPER_TICKS, SNIPER_RELOAD_TICKS, SNIPER_RANGE, ULT_STREAK, ULT_CHARGE_TICKS, BEAM_RADIUS, BEAM_LENGTH,
    FIRE_ZONE_MS, FIRE_DPS, FIRE_HEIGHT,
    HALF_X, HALF_Z, FACADE_HEIGHT, ALCOVE_DEPTH, CATWALK_TOP, boxes, spawns,
    newPlayerState, copyState, stepPlayer, isFree, aimDirection, eyeOf,
    rayBox, raycastWorld, rayPlayer, damageFor, clamp
  };
});
