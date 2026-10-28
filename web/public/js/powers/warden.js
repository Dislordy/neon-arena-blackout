// Soldier power — the Rune-Warden: 3 kills in a row raise the runes, then a 20 s monster form with claws that
// adapts to weapons used on it repeatedly. (The monster's body itself is js/warden.js.)
import * as THREE from 'three';
import { G, Sim, local, remotes, avatars, damage, camShake, playerName } from '../game/ctx.js';

function monsterBurst(id) {
  const { fx, audio, hud, touch } = G;
  const st = id && id !== G.myId ? remotes.get(id)?.state : local.sim;
  if (!st) return;
  const pos = new THREE.Vector3(st.x, st.y, st.z);
  fx.runeBurst(pos);
  if (!id || id === G.myId) { audio.play('monRoar', { volume: 1.0, reverb: 0.5 }); hud.notice('RUNE-WARDEN · 20 SECONDS', 1800); G.beamFlash = 0.35; damage.shake = 1; touch.buzz(220); }
  else audio.play('monRoar', { pos: pos.clone().setY(pos.y + 2), volume: 1.8, ref: 10, rolloff: 0.6, reverb: 0.6 });
}

/** The Warden's heavy footfalls, landings and fist smashes: a thud, a dust ring, and the ground shakes nearby. */
function wardenStomp(pos, str) {
  const { fx, audio } = G;
  if (str >= 0.5) fx.ring(pos, 0xff3a2a, 1.2 + str * 2.2, 0.35 + str * 0.2);
  if (str >= 0.5) fx.stomp(pos, str); else fx.footSplash(pos);
  audio.play('land', { pos, volume: 0.4 + str * 0.6, rate: 0.55, ref: 4 });
  const d = Math.hypot(pos.x - local.sim.x, pos.z - local.sim.z);
  if (str >= 0.8 && d < 14) damage.shake = Math.min(1, damage.shake + str * 0.5 * (1 - d / 14));
}

const WEAPON_NAMES = { rifle: 'RIFLE', sniper: 'SNIPER', shotgun: 'SHOTGUN', sword: 'GREATSWORD', claws: 'CLAWS', fire: 'FIRE', beam: 'BEAM', crash: 'CINDER CRASH' };

export default {
  cls: 'soldier',
  socket(socket) {
    socket.on('monRise', m => {
      const { fx, audio, hud } = G;
      const self = m.id === G.myId, r = remotes.get(m.id);
      const pose = out => { const st = self ? local.sim : r?.state; if (st) out.set(st.x, st.y, st.z); };
      fx.runeRise(pose, Sim.MON_RISE_TICKS * Sim.DT);
      const st = self ? local.sim : r?.state;
      audio.play('monRise', st && !self ? { pos: new THREE.Vector3(st.x, st.y + 1.2, st.z), volume: 1.4, ref: 6, reverb: 0.4 } : { volume: 0.9, reverb: 0.3 });
      if (self) { hud.notice('THE RUNES AWAKEN', 1500); camShake.dash = 1; }
      else hud.notice(`${playerName(m.id)} IS TURNING INTO SOMETHING`, 1500);
    });
    socket.on('monStart', m => monsterBurst(m.id));
    socket.on('monEnd', m => {
      const { fx, audio, hud } = G;
      if (m.id === G.myId) { audio.play('monEnd', { volume: 0.7, reverb: 0.3 }); hud.notice('THE RUNES GO DARK', 1300); return; }
      const st = remotes.get(m.id)?.state;
      if (st) { audio.play('monEnd', { pos: new THREE.Vector3(st.x, st.y + 1.5, st.z), volume: 1.0, ref: 5 }); fx.ring(st, 0xff2a3a, 4, 0.6); }
    });
    // the Warden hardened against a weapon it keeps getting hit with
    socket.on('adapt', a => {
      const { audio, hud } = G, own = a.id === G.myId;
      const av = avatars.get(a.id), st = own ? local.sim : remotes.get(a.id)?.state;
      if (av) av.adapt();
      if (st) audio.play('adaptClank', own ? { volume: 0.7, reverb: 0.2 } : { pos: new THREE.Vector3(st.x, st.y + 3.2, st.z), volume: 1.3, ref: 6, reverb: 0.3 });
      const what = WEAPON_NAMES[a.w] || a.w.toUpperCase();
      if (own) hud.notice(`ADAPTED · ${what} −${a.n * 15}%`, 1100);
      else if (st) hud.damageNumber(`ADAPTED −${a.n * 15}%`, 'shield', new THREE.Vector3(st.x, st.y + 3.3, st.z));
    });
  },
  avatar(a) { a.onStomp = wardenStomp; },
  hud(s) { G.hud.runes(true, Math.min(Sim.MON_STREAK, local.streak), s.monT > 0, s.mon > 0 ? Math.ceil(s.mon * Sim.DT) : 0); }
};
