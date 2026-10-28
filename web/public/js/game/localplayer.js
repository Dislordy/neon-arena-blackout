// Your own runner: the fixed 60 Hz prediction tick (the same simulation the server runs) and the instant
// feedback for what it predicts — muzzle flash, tracers, recoil, footsteps. The server still decides every hit.
import * as THREE from 'three';
import { G, Sim, isTouch, input, local, remotes, camShake, renderServerTime, aimYaw, aimPitch, cameraEye, impactSound, callPowers } from './ctx.js';

const keys = input.keys;
export function simTick() {
  const touch = G.touch;
  let mx = 0, mz = 0;
  if (G.menuOpen) { for (const k in keys) keys[k] = false; touch.release(); }
  if (keys.KeyW || keys.ArrowUp) mz += 1; if (keys.KeyS || keys.ArrowDown) mz -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1; if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  mx += touch.move.x; mz += touch.move.z;
  let b = 0;
  if (keys.Space || touch.jump) b |= Sim.BTN.JUMP;
  if (input.dashQueued) { b |= Sim.BTN.DASH; input.dashQueued = false; }
  if (input.reloadQueued) { b |= Sim.BTN.RELOAD; input.reloadQueued = false; }
  const firing = (input.mouseDown && input.pointerLocked) || (touch.fire && local.alive) || input.testFire;
  if (firing) b |= Sim.BTN.FIRE;
  if (input.aimDown) b |= Sim.BTN.ADS;
  const cmd = { s: ++local.seq, mx: Math.round(mx * 100) / 100, mz: Math.round(mz * 100) / 100, yaw: aimYaw(), pitch: aimPitch(), b };
  if (firing) cmd.vt = Math.round(renderServerTime());
  Sim.copyState(local.sim, local.prev);
  const wasOg = local.sim.og;
  const ev = Sim.stepPlayer(local.sim, cmd);
  local.pending.push(cmd); local.outbox.push(cmd);
  if (local.pending.length > 240) local.pending.shift();
  handleLocalEvents(ev, wasOg, cmd);
}

/** Server snapshot of you: rewind to it and replay the inputs it has not seen yet; small corrections are smoothed. */
export function reconcile(snap) {
  const s = local.sim;
  local.pending = local.pending.filter(i => i.s > snap.ack);
  const old = { x: s.x, y: s.y, z: s.z };
  Sim.copyState(snap.me, s);
  for (const cmd of local.pending) Sim.stepPlayer(s, cmd);
  local.alive = s.alive; // respawn effects come with the 'respawned' event
  if (snap.tp) {
    Sim.copyState(s, local.prev);
    local.errorOffset.set(0, 0, 0);
    local.yaw = snap.me.yaw; local.pitch = 0;
  } else {
    const dx = old.x - s.x, dy = old.y - s.y, dz = old.z - s.z;
    if (dx * dx + dy * dy + dz * dz > 9) { local.errorOffset.set(0, 0, 0); Sim.copyState(s, local.prev); }
    else { local.errorOffset.x += dx; local.errorOffset.y += dy; local.errorOffset.z += dz; local.prev.x -= dx; local.prev.y -= dy; local.prev.z -= dz; }
  }
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _e = new THREE.Vector3();
/**
 * Recoil that matters: part of each kick snaps back (camera jolt), the rest stays on your aim, so long bursts
 * climb and you pull down to control them. When you stop firing, half of the burst's climb settles back.
 * Your aim (yaw/pitch incl. recoil) is what the server uses for the shot, so this is real, not cosmetic.
 */
function kickAim(up, side, keep) {
  if (isTouch) keep *= 0.5; // thumbs can't pull down as precisely as a mouse
  local.recoilPitch += up * (1 - keep); local.recoilYaw += side * (1 - keep);
  local.pitch = THREE.MathUtils.clamp(local.pitch + up * keep, -1.4, 1.4); local.yaw += side * keep;
  local.settlePitch += up * keep * 0.5; local.lastKickT = performance.now();
}
const airKick = () => (local.sim.og ? 1 : 1.3);

/** A spent casing flies out of the ejection port (rifle shots, sniper bolt, shotgun pump). */
export function ejectShell(speed, lift) {
  const { weapon, camera, fx } = G, s = local.sim;
  const port = weapon.ejectWorld(camera, _e);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  fx.shell(port, right.multiplyScalar(speed + Math.random()).addScaledVector(up, lift).add(new THREE.Vector3(s.vx, s.vy, s.vz)));
}

function handleLocalEvents(ev, wasOg, cmd) {
  const s = local.sim, { weapon, camera, fx, audio, touch } = G, aimDown = input.aimDown;
  if (ev.fire && ev.shotgun) {
    // predicted pellets (same seeded spread as the server; the server decides damage)
    cameraEye(_o);
    weapon.fire(aimDown);
    camera.updateMatrixWorld();
    const muzzle = weapon.muzzleWorld(camera, _m).clone();
    let impacts = 0;
    for (const d of Sim.pelletDirs(s.yaw, s.pitch, cmd.s)) {
      const wh = Sim.raycastWorld(_o, d, Sim.SHOTGUN_RANGE);
      let endT = wh ? wh.t : Sim.SHOTGUN_RANGE, hitPlayer = false;
      for (const r of remotes.values()) {
        if (!r.state || !r.state.alive) continue;
        const h = Sim.rayPlayer(_o, d, r.state, endT);
        if (h && h.t < endT) { endT = h.t; hitPlayer = true; }
      }
      const end = _o.clone().addScaledVector(_d.set(d.x, d.y, d.z), endT);
      fx.tracer(muzzle, end, 0xffa060);
      if (!hitPlayer && wh && impacts++ < 5) fx.impact(end, wh.n, wh.kind);
    }
    fx.flashLight(muzzle, 0xff8a40, 18);
    audio.shotgunBlast(null, true);
    kickAim(0.07 * (aimDown ? 0.7 : 1) * airKick(), (Math.random() - 0.5) * 0.024, 0.4); // a heavy shove up
    camShake.kick = 2.2;
    touch.buzz(30);
  } else if (ev.fire) {
    const now = performance.now();
    local.shotsInBurst = now - local.lastFireT < 260 ? local.shotsInBurst + 1 : 0;
    local.lastFireT = now;
    // effects from the predicted shot (server decides damage)
    cameraEye(_o);
    const sn = !!ev.sniper, range = sn ? Sim.SNIPER_RANGE : Sim.MAX_RANGE;
    const d = sn ? Sim.sniperDir(s.yaw, s.pitch, cmd.s, ev.scoped) : Sim.aimDirection(s.yaw, s.pitch); _d.set(d.x, d.y, d.z);
    const wh = Sim.raycastWorld(_o, d, range);
    let endT = wh ? wh.t : range, hitPlayer = null;
    for (const [id, r] of remotes) {
      if (!r.state || !r.state.alive) continue;
      const h = Sim.rayPlayer(_o, d, r.state, endT);
      if (h && h.t < endT) { endT = h.t; hitPlayer = id; }
    }
    const end = _o.clone().addScaledVector(_d, endT);
    weapon.fire(aimDown);
    camera.updateMatrixWorld();
    const muzzle = weapon.muzzleWorld(camera, _m);
    fx.tracer(ev.scoped ? _o.clone().addScaledVector(_d, 0.6).setY(_o.y - 0.08) : muzzle, end, sn ? 0xa8b8ff : 0x7ff8ff);
    fx.flashLight(muzzle, sn ? 0xc0c8ff : 0xffb070, sn ? 16 : 10);
    if (sn) audio.sniperShot(null, true); else audio.gunshot(null, true);
    if (!hitPlayer && wh) { fx.impact(end, wh.n, wh.kind); audio.play(impactSound(wh.kind), { pos: end, volume: 0.7 }); }
    if (sn) { kickAim((ev.scoped ? 0.05 : 0.08) * airKick(), (Math.random() - 0.5) * 0.02, 0.35); camShake.kick = 1.8; touch.buzz(25); return finishEvents(ev, wasOg); }
    ejectShell(2, 1.5 + Math.random());
    // recoil pattern: steady vertical climb with a slight horizontal drift that grows during a burst
    const k = (aimDown ? 0.6 : 1) * airKick(), n = Math.min(local.shotsInBurst, 10);
    kickAim((0.012 + n * 0.0015) * k, (Math.sin(local.shotsInBurst * 1.7) * 0.005 + (Math.random() - 0.5) * 0.004) * k, 0.55);
    camShake.kick = 1;
  }
  finishEvents(ev, wasOg);
}
function finishEvents(ev, wasOg) {
  const s = local.sim, { weapon, fx, audio, touch } = G;
  callPowers('localEvent', ev); // guard raise, Cinder Crash, Obliteration charge/fire…
  if (ev.swing) {
    weapon.swing();
    audio.swordSwing(null, true, ev.claw ? 0.7 : 1);
    camShake.kick = ev.claw ? 0.9 : 0.6;
    touch.buzz(ev.claw ? 18 : 12);
  }
  if (ev.dry) audio.play('dry', { volume: 0.7, reverb: 0 });
  if (ev.jump) audio.play('jump', { volume: 0.6, reverb: 0.1 });
  if (ev.land) { audio.play('land', { volume: 0.85, reverb: 0.15 }); audio.footstep(null, true); weapon.land(1); camShake.land = 1; }
  if (ev.dash) { audio.play('dash', { volume: 0.7, reverb: 0.2 }); camShake.dash = 1; }
  // footsteps
  if (s.og && wasOg) {
    local.stepDist += Math.hypot(s.vx, s.vz) * Sim.DT;
    if (local.stepDist > 2.1) { local.stepDist = 0; audio.footstep(null, true); if (s.y < 0.01) fx.footSplash(s); }
  }
}
