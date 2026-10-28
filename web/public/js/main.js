// NEON ARENA: BLACKOUT — client entry point: boots the world and runs the frame loop.
//
//   game/ctx.js          shared state + the class-power hook list    game/settings.js   quality, sensitivity, sound
//   game/view.js         renderer, scene, camera                     game/menus.js      screens, class picker, ☰ menu
//   game/input.js        keyboard, mouse, touch                      game/net.js        shared socket events
//   game/localplayer.js  your prediction tick + shot feedback        game/remotes.js    other runners (interpolation)
//   game/camera.js       first-person camera, menu drift             powers/*.js        one file per class power
import { createWorld } from './world.js';
import { Effects } from './effects.js';
import { Weapon } from './weapon.js';
import { Avatar } from './avatar.js';
import { createPost } from './post.js';
import { Hud } from './hud.js';
import { loadWardenModel } from './warden.js';
import { G, Sim, $, isTouch, input, local, remotes, avatars, damage, powers, callPowers, firstPower } from './game/ctx.js';
import { Q, qualityName } from './game/settings.js';
import { renderer, scene, camera } from './game/view.js';
import { openMenu, closeMenu } from './game/menus.js';
import { touch } from './game/input.js';
import './game/net.js';
import { simTick, ejectShell } from './game/localplayer.js';
import { updateRemotes } from './game/remotes.js';
import { updateCamera, attractCamera } from './game/camera.js';
import warden from './powers/warden.js';
import obliteration from './powers/obliteration.js';
import clash from './powers/clash.js';
import knight from './powers/knight.js';
loadWardenModel(); // the animated Rune-Warden body streams in the background (the hand-built one covers until then)

powers.push(warden, obliteration, clash, knight);
callPowers('socket', G.socket);

// ------------------------------------------------------------------ main loop
let lastFrame = performance.now(), fpsAcc = 0, fpsFrames = 0, fps = 0, netSendAcc = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  const t = now / 1000;
  fpsAcc += dt; fpsFrames++; if (fpsAcc > 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
  const { weapon, post } = G;

  if (G.phase === 'playing') {
    // touch ADS is a toggle button; drop it (and any held buttons) while dead
    if (isTouch) { if (!local.alive && (touch.aim || touch.fire)) { touch.release(); touch.setAim(false); } input.aimDown = touch.aim; }
    local.acc += dt;
    let steps = 0;
    while (local.acc >= Sim.DT && steps < 8) { local.acc -= Sim.DT; simTick(); steps++; }
    if (steps === 8) local.acc = 0;
    netSendAcc += dt;
    if (local.outbox.length && (netSendAcc >= 1 / 30 || local.outbox.length >= 4)) {
      netSendAcc = 0;
      while (local.outbox.length) G.socket.emit('in', local.outbox.splice(0, 10));
    }
    updateRemotes(dt);
    callPowers('frame', dt);
    const cine = firstPower('camera', dt); // a power's cutscene (Beam Clash) can take over the camera
    if (!cine) updateCamera(dt, local.acc / Sim.DT);
    $('gameHud').classList.toggle('cine', cine); $('mobileControls').classList.toggle('cine', cine);
    updateHud(dt, now);
    weapon.update(weaponParams(dt));
    if (cine) weapon.root.visible = false;
    const g = post.grade.uniforms;
    g.damage.value = damage.pulse; g.lowHp.value = local.alive && local.hp <= 35 ? (35 - local.hp) / 35 * 0.8 + 0.2 : 0;
    g.dead.value += ((local.alive ? 0 : 1) - g.dead.value) * (1 - Math.exp(-dt * 4));
    G.scanFlash *= Math.exp(-dt * 3); g.scan.value = G.scanFlash;
    G.beamFlash *= Math.exp(-dt * 2.2); g.flash.value = G.beamFlash;
  } else {
    attractCamera(dt);
    if (weapon) weapon.update({ dt, moveSpeed: 0, grounded: true, aiming: false, mouseDX: 0, mouseDY: 0, reloadTicks: 0, ammo: Sim.MAG_SIZE, alive: false, dashing: false });
    if (post) { const g = post.grade.uniforms; g.damage.value = 0; g.lowHp.value = 0; g.dead.value = 0; }
  }
  input.mouseDX *= 0.5; input.mouseDY *= 0.5;
  if (!G.world) return;
  G.world.update(t, dt, camera);
  G.fx.update(dt, camera);
  camera.updateMatrixWorld();
  G.audio.updateListener(camera);
  post.render(dt);
}

function statusLine(s, wpn) {
  if (!input.pointerLocked && !isTouch) return 'CLICK TO LOCK AIM';
  if (!local.alive) return 'REDEPLOYING…';
  if (wpn === 'sword') return 'HOLD FIRE TO SWING · KILL TO REFORGE';
  if (wpn === 'shotgun') return `PYRE SHOTGUN · ${s.ammo} LEFT`;
  if (s.monT > 0) return 'THE RUNES AWAKEN…';
  if (s.mon > 0) return `RUNE-WARDEN · ${Math.ceil(s.mon * Sim.DT)}s · HOLD FIRE TO TEAR`;
  if (s.ultT > 0) return 'OBLITERATION CHARGING…';
  if (s.ult === 1) return 'OBLITERATION READY · FIRE TO CHARGE';
  if (wpn === 'sniper' && s.reload === 0 && s.ammo > 0) return isTouch ? 'TAP ADS TO SCOPE' : 'RIGHT-CLICK TO SCOPE';
  if (s.reload > 0) return 'RELOADING…';
  return s.ammo === 0 ? 'EMPTY — PRESS R' : 'VX-9 ENERGY RIFLE';
}
function updateHud(dt, now) {
  const hud = G.hud, s = local.sim;
  const C = Sim.classOf(s), wpn = Sim.weaponOf(s);
  hud.className(C.name);
  hud.vitals(local.hp, s.mon > 0 ? Sim.MON_HP : C.hp, local.sh, C.shield, local.shRegen);
  hud.ammo(s.ammo, s.reload, wpn);
  hud.status(statusLine(s, wpn));
  const since = now - local.cdAt;
  // dash: dark only when no charges are left; the badge shows how many remain
  hud.ability('dashBtn', s.dashN > 0 ? 0 : s.dashCd / C.dashRecharge, s.dashT > 0);
  hud.dashCharges(s.dashN, C.dashes, s.dashN < C.dashes ? s.dashCd / C.dashRecharge : 0);
  const power = powers.find(p => p.cls === C.key); // the class's streak meter (runes / beam / embers)
  if (power) power.hud(s, wpn);
  hud.scope(!!G.weapon.scoped && local.alive);
  hud.ability('shieldBtn', Math.max(0, local.cd.shield - since) / 9000, local.cd.shieldOn - since > 0);
  hud.ability('scanBtn', Math.max(0, local.cd.scan - since) / 12000, false);
  const moveSpread = Math.hypot(s.vx, s.vz) * 1.2 + (s.og ? 0 : 8);
  hud.crosshair(moveSpread + local.recoilPitch * 300 + (wpn === 'shotgun' ? 14 : wpn === 'sniper' ? 12 : 0), input.aimDown && local.alive && wpn !== 'sword');
  hud.net(`${Math.round(G.ping)} MS · ${fps} FPS · ${qualityName.toUpperCase()}`);
  hud.death(!local.alive, local.killedBy, Math.max(0, 2.5 - (now - local.deadAt) / 1000));
  hud.updateDamageNumbers(dt, camera);
}
function weaponParams(dt) {
  const s = local.sim;
  return { dt, moveSpeed: Math.hypot(s.vx, s.vz), grounded: s.og, aiming: input.aimDown, mouseDX: input.mouseDX, mouseDY: input.mouseDY, reloadTicks: s.reload, ammo: s.ammo, alive: local.alive, dashing: s.dashT > 0, mode: Sim.weaponOf(s),
    charging: s.ultT > 0 ? 1 - s.ultT / Sim.ULT_CHARGE_TICKS : s.monT > 0 ? 1 - s.monT / Sim.MON_RISE_TICKS : 0, ultReady: s.ult === 1,
    guard: !!s.guard, stag: s.stag > 0, blaze: s.crash === 1 || s.crashT > 0 };
}

// ------------------------------------------------------------------ boot
async function boot() {
  $('loadStatus').textContent = 'Generating arena materials…';
  $('createBtn').disabled = $('showJoinBtn').disabled = true;
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]); } catch { /* fonts optional */ }
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const audio = G.audio;
  const world = G.world = createWorld(renderer, scene, Q);
  const fx = G.fx = new Effects(scene, Q);
  fx.onShellBounce = (p, n) => audio.play('tink', { pos: p, volume: 0.25 / (n + 1), rate: 0.9 + Math.random() * 0.3, ref: 1.2 });
  fx.setVents(world.ventSpots); fx.setFires(world.fireSpots); fx.setSparks(world.sparkSpots);
  fx.onSpark = p => audio.play('zap', { pos: p, volume: 0.9, ref: 2, reverb: 0.2 });
  world.onThunder = delay => setTimeout(() => audio.play('thunder', { volume: 0.85, reverb: 0.5, bus: 'amb', vary: 0.1 }), delay * 1000);
  const weapon = G.weapon = new Weapon(scene.environment);
  weapon.events = {
    start: () => audio.play('magOut', { volume: 0.25, rate: 1.3, reverb: 0.05 }),
    magOut: () => audio.play('magOut', { volume: 0.55, reverb: 0.1 }),
    magIn: () => audio.play('magIn', { volume: 0.6, reverb: 0.1 }),
    charge: () => audio.play('charge', { volume: 0.6, reverb: 0.1 }),
    bolt: () => { audio.play('bolt', { volume: 0.65, reverb: 0.1 }); ejectShell(1.8, 1.4); },
    pump: () => { audio.play('sgPump', { volume: 0.6, reverb: 0.1 }); ejectShell(1.6, 1.8); }
  };
  G.post = createPost(renderer, scene, camera, weapon.scene, weapon.camera, Q);
  G.hud = new Hud();
  // compile shaders up-front (including a throwaway avatar) to avoid hitches when the match starts
  const warms = [0, 1, 2].map(c => { const w = new Avatar('#ffffff', 'warmup', c); w.group.position.set(c * 3, -50, 0); w.shield.visible = true; w.ghost.visible = true; if (w.shotgun) w.shotgun.visible = true; scene.add(w.group); return w; });
  weapon.swordRig.visible = weapon.shotgunRig.visible = weapon.slashArc.visible = true;
  try { renderer.compile(scene, camera); renderer.compile(weapon.scene, weapon.camera); } catch { /* optional */ }
  weapon.swordRig.visible = weapon.shotgunRig.visible = weapon.slashArc.visible = false;
  for (const w of warms) { scene.remove(w.group); w.dispose(); }
  $('loadStatus').textContent = `Graphics: ${qualityName.toUpperCase()} · ${renderer.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL'} ready`;
  $('createBtn').disabled = $('showJoinBtn').disabled = false;
  // debugging / automated-test hooks (do not grant anything the server would not accept from a normal client)
  window.__NAB = { renderer, scene, camera, world, fx, weapon, audio, local, remotes, avatars, socket: G.socket, Sim, input: { fire: v => { input.testFire = v; }, aim: v => { input.aimDown = v; } }, touch, menu: { open: openMenu, close: closeMenu, isOpen: () => G.menuOpen }, clash: () => G.clash, setFreeCam: v => { G.freeCam = v; } };
}
requestAnimationFrame(frame);
boot().catch(err => { console.error(err); $('loadStatus').textContent = 'Failed to initialise graphics: ' + err.message; });
