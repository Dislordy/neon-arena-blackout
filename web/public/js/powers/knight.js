// Knight power: the greatsword reforges into the Pyre shotgun on every kill; the Ashen Guard (hold right-click)
// blocks frontal hits and a last-moment raise parries; 4 kills in a row ignite the blade for the Cinder Crash.
import * as THREE from 'three';
import { G, Sim, local, remotes, avatars, damage, camShake, posOf, EMBER } from '../game/ctx.js';

export default {
  cls: 'knight',
  socket(socket) {
    socket.on('transform', t => {
      const { fx, audio, hud } = G;
      if (t.id === G.myId) { audio.play('transform', { volume: 0.8, reverb: 0.2 }); hud.notice('BLADE REFORGED · PYRE SHOTGUN', 1500); return; }
      const a = avatars.get(t.id), st = remotes.get(t.id)?.state;
      if (a) a.flare();
      if (st) { const p = new THREE.Vector3(st.x, st.y + 1.2, st.z); audio.play('transform', { pos: p, volume: 0.9, ref: 3 }); fx.embers(p, EMBER); }
    });
    socket.on('sheathe', t => {
      const { audio, hud } = G;
      const st = t.id === G.myId ? local.sim : remotes.get(t.id)?.state;
      if (t.id === G.myId) { audio.play('transform', { volume: 0.45, rate: 1.25, reverb: 0.1 }); hud.notice('SHELLS SPENT · BLADE RESTORED', 1200); }
      else if (st) audio.play('transform', { pos: new THREE.Vector3(st.x, st.y + 1.2, st.z), volume: 0.5, rate: 1.25, ref: 3 });
    });
    // Ashen Guard: a hit landed on someone's raised blade (parry = raised at the last moment)
    socket.on('guard', g => {
      const { fx, audio, hud, weapon, touch, camera } = G;
      const own = g.id === G.myId, base = posOf(g.id);
      let at = g.p ? new THREE.Vector3(g.p[0], g.p[1], g.p[2]) : base && base.setY(base.y + 1.3);
      if (own) at = camera.position.clone().add(new THREE.Vector3(-0.15, -0.2, -1.5).applyQuaternion(camera.quaternion)); // on your blade, in front of you
      if (at) fx.guardSparks(at, g.parry, own);
      audio.play(g.parry ? 'parry' : 'guardBlock', own ? { volume: g.parry ? 1 : 0.7, reverb: 0.3 } : { pos: at || undefined, volume: g.parry ? 1.5 : 0.9, ref: 4, reverb: 0.3 });
      if (own) {
        if (g.parry) { hud.notice('PARRY! · RIPOSTE READY', 1300); weapon.guardHit(true); G.beamFlash = Math.max(G.beamFlash, 0.08); touch.buzz(60); }
        else { weapon.guardHit(false); camShake.kick = 1.2; touch.buzz(15); }
      } else { const a = avatars.get(g.id); if (a) a.guardHit(g.parry); }
      if (g.by === G.myId && g.parry) { hud.notice(g.stag ? 'PARRIED · STAGGERED' : 'PARRIED', 1200); if (g.stag) { damage.shake = 0.8; camShake.dash = 0.7; } }
    });
    socket.on('riposte', r => { if (r.id === G.myId) G.hud.notice('RIPOSTE ×2', 900); const p = posOf(r.id); if (p) G.fx.blaze(p.setY(p.y + 1.3), 3); });
    // Cinder Crash: ready, leap, and the landing shockwave
    socket.on('crashReady', c => {
      const { audio, hud, touch } = G;
      if (c.id === G.myId) { hud.notice('BLADE IGNITES · NEXT ATTACK: CINDER CRASH', 2000); audio.play('crashReady', { volume: 0.9, reverb: 0.3 }); touch.buzz(80); return; }
      const p = posOf(c.id); if (p) audio.play('crashReady', { pos: p.setY(p.y + 1.2), volume: 1.2, ref: 5 });
    });
    socket.on('crashLeap', c => { const p = posOf(c.id); if (p) G.audio.play('crashLeap', { pos: p.setY(p.y + 1), volume: 1.4, ref: 6, reverb: 0.3 }); });
    socket.on('crash', c => {
      const { fx, audio, touch } = G;
      const p = new THREE.Vector3(c.p[0], c.p[1], c.p[2]), own = c.id === G.myId;
      fx.cinderCrash(p, own);
      audio.play('crashImpact', own ? { volume: 1.1, reverb: 0.5 } : { pos: p.clone().setY(p.y + 0.5), volume: 2, ref: 10, rolloff: 0.6, reverb: 0.5 });
      const d = Math.hypot(p.x - local.sim.x, p.z - local.sim.z);
      if (own || d < 16) { damage.shake = Math.min(1, damage.shake + (own ? 1 : 1 - d / 16)); G.beamFlash = Math.max(G.beamFlash, own ? 0.12 : 0.15 * (1 - d / 16)); touch.buzz(own ? 160 : 60); }
      const a = avatars.get(c.id); if (a) a.slam();
    });
  },
  localEvent(ev) {
    const { audio, weapon, touch } = G;
    if (ev.guardUp) audio.play('guardBlock', { volume: 0.22, rate: 1.7, reverb: 0.1 });
    if (ev.crashStart) { audio.play('crashLeap', { volume: 1.0, reverb: 0.3 }); camShake.dash = 1.3; weapon.crashLeap(); touch.buzz(40); }
    if (ev.crashLand) { weapon.slam(); camShake.land = 2.2; }
  },
  // an ignited blade trails flames
  remoteFrame(r, st, a, dt) {
    if (st.alive && (st.crashReady || st.crashing) && (r.blazeT = (r.blazeT || 0) - dt) <= 0) { r.blazeT = st.crashing ? 0.03 : 0.12; G.fx.blaze(a.bladeWorld(), st.crashing ? 2 : 1); }
  },
  hud(s) { G.hud.cinder(true, Math.min(Sim.CRASH_STREAK, local.streak), s.crash === 1, s.crashT > 0); }
};
