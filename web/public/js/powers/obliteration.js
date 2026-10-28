// Assassin power — the Obliteration Beam: 5 kills in a row, the next shot charges a rune circle, then a huge beam
// leaves half of the alley burning. (Two beams meeting start a Beam Clash: powers/clash.js.)
import * as THREE from 'three';
import { G, Sim, local, remotes, damage, camShake, cameraEye } from '../game/ctx.js';

/** Fill the burning half of the alley with temporary fires (they skip spots inside walls). */
function burnZone(zone, ms) {
  const { fx, audio } = G;
  const spots = [], sec = ms / 1000;
  const jit = () => (Math.random() - 0.5) * 3;
  if (zone.axis === 'z') {
    for (let z = 3; z < Sim.HALF_Z - 1; z += 6.5) for (let x = -Sim.HALF_X + 2; x < Sim.HALF_X - 1; x += 6.2) spots.push({ x: x + jit(), y: 0.05, z: zone.sign * (z + jit()) });
  } else {
    for (let x = 2; x < Sim.HALF_X; x += 4.5) for (let z = -Sim.HALF_Z + 3; z < Sim.HALF_Z - 1; z += 6.5) spots.push({ x: zone.sign * (x + jit() * 0.4), y: 0.05, z: z + jit() });
  }
  for (let i = spots.length - 1; i >= 0; i--) if (!Sim.isFree(spots[i].x, 0, spots[i].z)) spots.splice(i, 1);
  fx.addTempFires(spots, sec);
  fx.scorch(zone, sec);
  for (let i = 0; i < Math.min(5, spots.length); i++) audio.tempLoop('fireLoop', { x: spots[(i * 7) % spots.length].x, y: 0.5, z: spots[(i * 7) % spots.length].z }, 0.9, sec);
}

export default {
  cls: 'assassin',
  socket(socket) {
    socket.on('ultReady', u => {
      if (u.id === G.myId) { G.audio.play('ultReady', { volume: 0.8, bus: 'ui' }); G.hud.notice('OBLITERATION BEAM READY · NEXT SHOT', 2200); }
    });
    // someone else's rune circle builds up in front of them
    socket.on('ultCharge', u => {
      const { fx, audio, hud } = G;
      const r = remotes.get(u.id);
      if (!r) return;
      if (r.circle) r.circle.cancel();
      r.circle = fx.magicCircle(out => {
        const st = r.state; if (!st) return;
        const f = Sim.aimDirection(st.yaw, st.pitch); out.dir.set(f.x, f.y, f.z);
        out.pos.set(st.x, st.y + 1.45, st.z).addScaledVector(out.dir, 2.2);
      }, Sim.ULT_CHARGE_TICKS * Sim.DT);
      const st = r.state;
      if (st) audio.play('ultCharge', { pos: new THREE.Vector3(st.x, st.y + 1.5, st.z), volume: 1.6, ref: 8, rolloff: 0.6, reverb: 0.4 });
      const name = G.meta?.players.find(p => p.id === u.id)?.name || 'AN ASSASSIN';
      hud.notice(`${name.toUpperCase()} IS CHARGING A BEAM`, 1500);
    });
    socket.on('beam', b => {
      const { fx, audio, hud } = G;
      const o = new THREE.Vector3(...b.o), axis = { x: b.d[0], y: 0, z: b.d[1] };
      if (b.id !== G.myId || b.clash) { // your own beam was already drawn when you fired it
        const r = remotes.get(b.id);
        if (r && r.circle) { r.circle.fire(); r.circle = null; }
        fx.beam(o.clone().setY(o.y - 0.3), axis, Sim.BEAM_LENGTH, Sim.BEAM_RADIUS);
        audio.play('beamFire', { pos: o, volume: 2.2, ref: 20, rolloff: 0.4, reverb: 0.7 });
        G.beamFlash = 0.8; damage.shake = Math.min(1, damage.shake + 0.8);
      }
      burnZone(b.zone, b.ms); // the half of the alley it went into is left burning
      if (Sim.inFireZone(b.zone, local.sim) && b.id !== G.myId) hud.notice('THE ALLEY IS ON FIRE · GET UP HIGH', 2000);
    });
  },
  // your own charge and beam, straight from the predicted simulation
  localEvent(ev) {
    const { fx, audio, hud, touch } = G, s = local.sim;
    if (ev.ultStart) {
      if (local.circle) local.circle.cancel();
      local.circle = fx.magicCircle(out => {
        const f = Sim.aimDirection(local.yaw + local.recoilYaw, local.pitch);
        out.dir.set(f.x, f.y, f.z); cameraEye(out.pos).addScaledVector(out.dir, 2.4); out.pos.y -= 0.15;
      }, Sim.ULT_CHARGE_TICKS * Sim.DT);
      audio.play('ultCharge', { volume: 0.9, reverb: 0.3 });
      hud.notice('OBLITERATION · CHARGING', 1500);
    }
    if (ev.ultFire) {
      if (local.circle) { local.circle.fire(); local.circle = null; }
      const o = cameraEye(new THREE.Vector3()), a = Sim.beamAxis(s.yaw);
      fx.beam(o.setY(o.y - 0.3), a, Sim.BEAM_LENGTH, Sim.BEAM_RADIUS);
      audio.play('beamFire', { volume: 1.0, reverb: 0.6 });
      audio.duck(0.05, 1.5);
      G.beamFlash = 0.75; camShake.kick = 4; damage.shake = 1; touch.buzz(200);
      local.recoilPitch += 0.12;
    }
  },
  // a charge dies with its owner
  killed(k) {
    const vr = remotes.get(k.victim);
    if (vr && vr.circle) { vr.circle.cancel(); vr.circle = null; }
    if (k.victim === G.myId && local.circle) { local.circle.cancel(); local.circle = null; }
  },
  hud(s, wpn) { G.hud.ult(wpn === 'sniper', Math.min(Sim.ULT_STREAK, local.streak), s.ult === 1, s.ultT > 0); }
};
