// Socket events every class shares: room state, snapshots, shots, hits, deaths, respawns, abilities.
// Class powers register their own events in js/powers/.
import * as THREE from 'three';
import { escapeHtml } from '../hud.js';
import { G, Sim, local, remotes, avatars, damage, cameraEye, impactSound, EMBER, callPowers } from './ctx.js';
import { setScreen, showError, showLobby, showResults, enterMatch } from './menus.js';
import { reconcile } from './localplayer.js';
import { bufferRemote, syncAvatars } from './remotes.js';

const socket = G.socket;
socket.on('connect_error', () => showError('Cannot connect to the game server. Refresh and try again.'));
socket.on('notice', t => G.hud && G.hud.notice(t));

socket.on('state', state => {
  const hud = G.hud;
  G.meta = state;
  syncAvatars(state.players);
  G.isHost = state.host === G.myId;
  if (state.phase === 'lobby') showLobby(state);
  else if (state.phase === 'playing') {
    if (G.phase !== 'playing') enterMatch();
    const me = state.players.find(p => p.id === G.myId);
    if (me && hud) hud.score(me.score);
    if (hud) { hud.timer(state.timeLeft); hud.leaderboard(state.players, G.myId); hud.feed(state.feed); }
  } else if (state.phase === 'results') {
    if (G.phase !== 'results') setScreen('results');
  }
});
socket.on('matchStarted', () => { if (G.phase !== 'playing' && G.world) enterMatch(); });
socket.on('matchEnded', showResults);

socket.on('snap', snap => {
  const nowT = performance.now();
  const sample = snap.t - nowT;
  if (G.serverOffset === null || sample > G.serverOffset) G.serverOffset = sample; else G.serverOffset += (sample - G.serverOffset) * 0.02;
  G.lastSnapAt = nowT;
  local.hp = snap.hp;
  if (snap.sh !== undefined) {
    // shield recharge cue: plays once when the shield starts refilling
    const C = Sim.classOf(snap.me);
    if (snap.sh > local.sh && local.sh < C.shield && !local.shRegen && local.alive) { local.shRegen = true; G.audio.play('shieldUp', { volume: 0.45, reverb: 0.05, bus: 'ui' }); }
    if (snap.sh < local.sh || snap.sh >= C.shield) local.shRegen = snap.sh < C.shield && snap.sh > local.sh;
    local.sh = snap.sh;
    local.streak = snap.st || 0;
  }
  local.cd = snap.cd; local.cdAt = nowT;
  reconcile(snap);
  for (const e of snap.ps) if (e[0] !== G.myId) bufferRemote(e, snap.t);
});

/** Muzzle of another runner's gun if we can see them, else where the server says the shot came from. */
function remoteMuzzle(shot) {
  const shooter = avatars.get(shot.id), r = remotes.get(shot.id);
  return shooter && r && r.state && r.state.alive ? shooter.muzzleWorld(new THREE.Vector3()) : new THREE.Vector3(...shot.o);
}
socket.on('shot', shot => {
  if (shot.w === 'sg') return remoteShotgun(shot);
  const { fx, audio } = G, shooter = avatars.get(shot.id);
  const end = new THREE.Vector3(...shot.e);
  const muzzle = remoteMuzzle(shot);
  const dir = end.clone().sub(muzzle).normalize();
  fx.tracer(muzzle, end, shot.w === 'sn' ? 0xa8b8ff : shooter ? shooter.color : 0xff36c7);
  fx.muzzleFlash(muzzle, dir, shooter ? shooter.color.clone().lerp(new THREE.Color(0xffd0a0), 0.5) : 0xffb070, shot.w === 'sn' ? 0.9 : 0.6);
  if (shot.w === 'sn') audio.sniperShot(muzzle); else audio.gunshot(muzzle);
  if (shot.h) {
    const victim = avatars.get(shot.h);
    if (victim) victim.flinch(dir);
    fx.playerHit(end, dir, victim ? victim.color : 0xffffff, false);
    audio.play('impactBody', { pos: end, volume: 0.7 });
  } else if (shot.n) {
    fx.impact(end, shot.n, shot.k);
    audio.play(impactSound(shot.k), { pos: end, volume: 0.8 });
  }
  // a near-miss whizz past your head
  if (local.alive && !shot.h) {
    const eye = cameraEye();
    const o = new THREE.Vector3(...shot.o), d = end.clone().sub(o), len = d.length(); d.normalize();
    const t = THREE.MathUtils.clamp(eye.clone().sub(o).dot(d), 0, len);
    const closest = o.clone().addScaledVector(d, t);
    if (closest.distanceTo(eye) < 1.6) audio.bulletCrack(closest);
  }
});
function remoteShotgun(shot) {
  const { fx, audio } = G;
  const muzzle = remoteMuzzle(shot);
  const first = new THREE.Vector3(...shot.pe[0].e), dir = first.clone().sub(muzzle).normalize();
  fx.muzzleFlash(muzzle, dir, 0xff9a50, 1.1);
  audio.shotgunBlast(muzzle);
  let impacts = 0;
  for (const p of shot.pe) {
    const end = new THREE.Vector3(...p.e);
    fx.tracer(muzzle, end, EMBER);
    if (p.h) { const v = avatars.get(p.h); if (v) v.flinch(dir); fx.playerHit(end, dir, v ? v.color : 0xffffff, false); }
    else if (p.n && impacts++ < 4) fx.impact(end, p.n, p.k);
  }
  if (shot.pe.some(p => p.h)) audio.play('impactBody', { pos: first, volume: 0.8 });
  else if (impacts) audio.play(impactSound(shot.pe.find(p => p.n)?.k), { pos: first, volume: 0.8 });
}

// melee: the Knight's greatsword and the Rune-Warden's claws
socket.on('swing', w => {
  const { fx, audio } = G, a = avatars.get(w.id), st = remotes.get(w.id)?.state;
  if (a) a.swing();
  if (st) audio.swordSwing(new THREE.Vector3(st.x, st.y + 1.3, st.z), false, w.c ? 0.7 : 1);
  if (w.h && w.p) {
    const p = new THREE.Vector3(...w.p), v = avatars.get(w.h);
    const dir = st ? p.clone().sub(new THREE.Vector3(st.x, p.y, st.z)).normalize() : new THREE.Vector3(0, 0, -1);
    if (v) v.flinch(dir);
    fx.playerHit(p, dir, EMBER, false);
    if (w.h !== G.myId) audio.play('swordHit', { pos: p, volume: 1.0, reverb: 0.25, rate: w.c ? 0.8 : 1 });
  }
});

// you hit someone
socket.on('hit', h => {
  const { fx, audio, hud } = G;
  const pos = new THREE.Vector3(...h.p);
  const victim = avatars.get(h.id);
  if (victim && !h.blocked) victim.flinch(new THREE.Vector3().subVectors(pos, cameraEye()).normalize());
  if (h.blocked) { if (h.w !== 'fire') { hud.hitmarker('blocked'); hud.damageNumber('IMMUNE', 'shield', pos); } return; }
  if (h.w === 'fire' && !h.k) return; // your flames are burning someone: no hit-marker spam
  fx.playerHit(pos, new THREE.Vector3().subVectors(pos, cameraEye()).normalize(), h.w === 'sword' ? EMBER : victim ? victim.color : 0xffffff, h.part === 'head');
  hud.hitmarker(h.k ? 'kill' : h.part === 'head' ? 'head' : '');
  hud.damageNumber(String(h.d), h.part === 'head' ? 'head' : h.shielded || h.sh ? 'shield' : '', pos);
  audio.play(h.part === 'head' ? 'headshot' : 'hit', { volume: 0.55, vary: 0.02, reverb: 0, bus: 'ui' });
  if (h.w === 'sword') audio.play('swordHit', { volume: 0.9, reverb: 0.15, vary: 0.05 });
  if (h.sh) audio.play('shieldHit', { pos, volume: 0.6, vary: 0.08 });
  if (h.brk) { audio.play('shieldBreak', { pos, volume: 0.8 }); hud.damageNumber('SHIELD BREAK', 'shield', pos.clone().setY(pos.y + 0.3)); }
  if (h.k) {
    setTimeout(() => audio.play('kill', { volume: 0.6, reverb: 0.1, vary: 0, bus: 'ui' }), 70);
    const name = G.meta?.players.find(p => p.id === h.id)?.name || 'RUNNER';
    const how = h.w === 'beam' ? 'OBLITERATED' : h.w === 'fire' ? 'BURNED' : 'ELIMINATED';
    hud.killBanner(`<span class="pts">+${h.part === 'head' ? 125 : 100}</span><span class="who">${how} ${escapeHtml(name.toUpperCase())}</span>${h.part === 'head' ? ' <span class="hs">· HEADSHOT</span>' : ''}`);
  }
});

// someone hit you
socket.on('hurt', h => {
  const { audio, hud } = G;
  local.hp = h.hp;
  if (h.sh !== undefined) { local.sh = h.sh; local.shRegen = false; }
  if (h.brk) { audio.play('shieldBreak', { volume: 0.7, bus: 'ui' }); hud.notice('SHIELD BROKEN', 900); }
  else if (h.sh > 0) audio.play('shieldHit', { volume: 0.45, vary: 0.08, bus: 'ui' });
  if (h.w === 'sword') audio.play('swordHit', { volume: 0.9, reverb: 0.1 });
  if (h.w === 'fire') {
    const nowT = performance.now();
    if (nowT - local.burnNoticeAt > 2500) { local.burnNoticeAt = nowT; hud.notice('BURNING · GET OUT OR GET UP HIGH', 1400); audio.play('hurt', { volume: 0.5, reverb: 0.1 }); }
    damage.pulse = Math.min(0.5, damage.pulse + 0.06);
    return;
  }
  const shieldOnly = h.sh > 0 && !h.brk; // the shield took all of it: lighter screen hit
  damage.pulse = Math.min(0.8, damage.pulse + h.d / (shieldOnly ? 160 : 60)); damage.shake = Math.min(1, damage.shake + h.d / 40);
  const dx = h.from[0] - local.sim.x, dz = h.from[1] - local.sim.z;
  const worldAng = Math.atan2(-dx, -dz); // yaw that would face the attacker
  hud.damageDirection(-(worldAng - local.yaw));
  audio.play('hurt', { volume: shieldOnly ? 0.3 : 0.7, reverb: 0.1 });
});

socket.on('killed', k => {
  const { fx, audio } = G;
  const victim = avatars.get(k.victim), pos = new THREE.Vector3(...k.pos);
  fx.death(pos, victim ? victim.color : 0xffffff);
  audio.play('death', { pos: pos.clone().setY(pos.y + 1), volume: 1, reverb: 0.5 });
  callPowers('killed', k);
  if (k.victim === G.myId) {
    local.alive = false; local.deadAt = performance.now();
    local.killedBy = G.meta?.players.find(p => p.id === k.killer)?.name || '';
    local.deathPos = pos.clone();
    const killer = remotes.get(k.killer);
    local.deathLook = killer && killer.state ? new THREE.Vector3(killer.state.x, killer.state.y + 1.5, killer.state.z) : null;
  }
});
socket.on('respawned', r => {
  const { fx, audio, hud, weapon } = G;
  if (r.id === G.myId) { weapon.respawn(); audio.play('respawn', { volume: 0.6 }); hud.notice('REDEPLOYED', 900); }
  else setTimeout(() => { const st = remotes.get(r.id)?.state; if (st) fx.ring(st, avatars.get(r.id)?.color || 0xffffff, 2.5, 0.6); }, 150);
});

// everyone's abilities: Q shield, E neural scan
socket.on('abilityFx', a => {
  const { fx, audio, hud } = G, own = a.id === G.myId;
  const st = own ? local.sim : remotes.get(a.id)?.state;
  if (!st) return;
  const pos = new THREE.Vector3(st.x, st.y + 1, st.z);
  if (a.type === 'shield') { audio.play('shield', own ? { volume: 0.6 } : { pos, volume: 0.8 }); if (own) hud.notice('SHIELD ACTIVE'); }
  if (a.type === 'scan') { fx.ring(pos, 0xb6ff4a, 40, 1.4); audio.play('scan', own ? { volume: 0.5 } : { pos, volume: 0.9 }); }
});
socket.on('scanPulse', d => {
  const until = performance.now() + d.duration;
  for (const q of d.players) { const r = remotes.get(q.id); if (r) r.xrayUntil = until; }
  G.scanFlash = 1;
  G.hud.notice(`NEURAL SCAN · ${d.players.length} SIGNAL${d.players.length === 1 ? '' : 'S'}`);
});

// ping measurement
setInterval(() => { const t0 = performance.now(); socket.emit('ping2', 0, () => { G.ping = performance.now() - t0; }); }, 2000);
