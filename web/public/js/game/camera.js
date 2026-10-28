// First-person camera: recoil recovery, head bob, V5 strafe roll and landing rebound, shakes, death cam,
// zoom (ADS / scope / beam charge), plus the slow drift down the alley behind the menus.
import * as THREE from 'three';
import { G, Sim, input, local, damage, camShake, aimYaw, aimPitch } from './ctx.js';

let fovCur = 78, bobPhase = 0, attractT = 0, monCam = 0;
// V5 camera rig: a damped strafe roll and a short landing rebound (position/roll only, so the view
// always points exactly where the server will aim the shot).
let camMoveX = 0, camLandBounce = 0, camLastGrounded = true;
export function updateCamera(dt, alpha) {
  const camera = G.camera, s = local.sim, p = local.prev;
  // recoil recovery
  const rec = 1 - Math.exp(-dt * 7.5);
  local.recoilPitch -= local.recoilPitch * rec; local.recoilYaw -= local.recoilYaw * rec;
  if (local.settlePitch > 0 && performance.now() - local.lastKickT > 260) { // burst over: half the climb settles back
    const d = local.settlePitch * (1 - Math.exp(-dt * 6)); local.settlePitch -= d; local.pitch = THREE.MathUtils.clamp(local.pitch - d, -1.4, 1.4);
  }
  local.errorOffset.multiplyScalar(Math.exp(-dt * 12));
  const x = p.x + (s.x - p.x) * alpha + local.errorOffset.x;
  const y = p.y + (s.y - p.y) * alpha + local.errorOffset.y;
  const z = p.z + (s.z - p.z) * alpha + local.errorOffset.z;
  const speed = Math.hypot(s.vx, s.vz);
  const groundedNow = !!s.og;
  if (!camLastGrounded && groundedNow) camLandBounce = Math.min(1.2, 0.45 + speed * 0.08);
  camLastGrounded = groundedNow;
  camLandBounce *= Math.exp(-dt * 7.5);
  bobPhase += dt * (speed * 1.8);
  const bobK = s.og ? Math.min(1, speed / Sim.MOVE_SPEED) : 0;
  camShake.kick *= Math.exp(-dt * 20); camShake.land *= Math.exp(-dt * 8); camShake.dash *= Math.exp(-dt * 5);
  damage.shake *= Math.exp(-dt * 7); damage.pulse *= Math.exp(-dt * 3.5);
  monCam += ((s.mon > 0 ? 0.75 : 0) - monCam) * (1 - Math.exp(-dt * 4)); // the Warden sees from higher up
  const strafe = s.vx * Math.cos(aimYaw()) - s.vz * Math.sin(aimYaw());
  const moveLeanX = THREE.MathUtils.clamp(strafe / Sim.MOVE_SPEED, -1, 1) * 0.035;
  camMoveX += (moveLeanX - camMoveX) * (1 - Math.exp(-dt * 10));
  const camY = y + Sim.EYE_HEIGHT + monCam + Math.abs(Math.sin(bobPhase)) * 0.04 * bobK - camShake.land * 0.12 - camLandBounce * 0.055 + Math.sin(camLandBounce * Math.PI) * 0.025;
  let roll = Math.sin(bobPhase) * 0.006 * bobK - camMoveX + (Math.random() - 0.5) * damage.shake * 0.03;
  let yaw = aimYaw() + (Math.random() - 0.5) * damage.shake * 0.02;
  let pitch = aimPitch() + camShake.kick * 0.004 + (Math.random() - 0.5) * damage.shake * 0.02;
  if (!local.alive && local.deathPos) {
    // death cam: drop, roll and look at the killer
    const k = Math.min(1, (performance.now() - local.deadAt) / 600);
    camera.position.set(local.deathPos.x, THREE.MathUtils.lerp(local.deathPos.y + Sim.EYE_HEIGHT, local.deathPos.y + 0.45, k), local.deathPos.z);
    if (local.deathLook) {
      const d = local.deathLook.clone().sub(camera.position);
      yaw = THREE.MathUtils.lerp(yaw, Math.atan2(-d.x, -d.z), k * 0.6);
      pitch = THREE.MathUtils.lerp(pitch, Math.atan2(d.y, Math.hypot(d.x, d.z)), k * 0.6);
    }
    roll = 0.35 * k;
  } else camera.position.set(x, camY, z);
  camera.rotation.set(pitch, yaw, roll);
  const w = Sim.weaponOf(s), scoped = G.weapon && G.weapon.scoped;
  const targetFov = (input.aimDown && local.alive && w !== 'sword' ? (scoped ? 22 : w === 'sniper' ? 50 : 56) : 78) + camShake.dash * 10 - (s.ultT > 0 ? (1 - s.ultT / Sim.ULT_CHARGE_TICKS) * 8 : 0);
  fovCur += (targetFov - fovCur) * (1 - Math.exp(-dt * 12));
  if (Math.abs(camera.fov - fovCur) > 0.01) { camera.fov = fovCur; camera.updateProjectionMatrix(); }
}

/** Behind the menus: a slow, uneasy drift down the alley (G.freeCam pins it for screenshots). */
export function attractCamera(dt) {
  const camera = G.camera;
  if (G.freeCam) { camera.position.set(...G.freeCam.pos); camera.lookAt(...G.freeCam.look); return; }
  attractT += dt * 0.025;
  const a = attractT, z = Math.sin(a) * (Sim.HALF_Z - 12), dir = Math.cos(a) >= 0 ? 1 : -1;
  camera.position.set(Math.sin(a * 2.3) * 5, 3.2 + Math.sin(a * 3.1) * 0.8, z);
  camera.lookAt(Math.sin(a * 1.7) * 3, 2.2, z + dir * 18);
}
