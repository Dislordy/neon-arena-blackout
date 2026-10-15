// NEON ARENA: BLACKOUT — client entry point.
// Client-side prediction + server reconciliation for the local player,
// snapshot interpolation for remote players, effects/audio/HUD orchestration.
import * as THREE from 'three';
import { installHeightFog, createWorld } from './world.js';
import { Effects, groundHeight } from './effects.js';
import { Weapon } from './weapon.js';
import { Avatar } from './avatar.js';
import { AudioEngine } from './audio.js';
import { createPost } from './post.js';
import { Hud, escapeHtml } from './hud.js';
import { TouchControls, goLandscape } from './touch.js';
import { loadWardenModel } from './warden.js';
loadWardenModel(); // the animated Rune-Warden body streams in the background (the hand-built one covers until then)

const Sim = window.NeonSim;
const $ = id => document.getElementById(id);

// ------------------------------------------------------------------ settings & quality
const PRESETS = {
  low: { pixelRatio: 1, textures: 256, shadows: false, shadowSize: 0, spotShadows: false, reflections: false, reflectionScale: 0, bloom: false, msaa: 0, mist: false, rain: 0, particles: 700, dust: 0, flashLights: 1, extraLights: false },
  medium: { pixelRatio: 1.25, textures: 512, shadows: true, shadowSize: 1024, spotShadows: false, reflections: true, reflectionScale: 0.35, bloom: true, msaa: 0, mist: true, rain: 2500, particles: 1400, dust: 300, flashLights: 2, extraLights: false },
  high: { pixelRatio: 1.5, textures: 512, shadows: true, shadowSize: 2048, spotShadows: true, reflections: true, reflectionScale: 0.5, bloom: true, msaa: 4, mist: true, rain: 4000, particles: 2200, dust: 600, flashLights: 3, extraLights: false },
  ultra: { pixelRatio: 2, textures: 1024, shadows: true, shadowSize: 4096, spotShadows: true, reflections: true, reflectionScale: 0.75, bloom: true, msaa: 4, mist: true, rain: 6000, particles: 3200, dust: 900, flashLights: 4, extraLights: true }
};
const store = { get(k, d) { try { const v = localStorage.getItem('nab.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('nab.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } } };
const isTouch = matchMedia('(pointer:coarse)').matches;
const qualityName = new URLSearchParams(location.search).get('quality') || store.get('quality', isTouch ? 'low' : 'medium');
const Q = PRESETS[qualityName] || PRESETS.medium;
let sensitivity = store.get('sens', 1);
const audio = new AudioEngine();
audio.volume = store.get('vol', 0.8);
audio.muted = store.get('muted', false);

$('qualitySel').value = qualityName;
$('qualitySel').onchange = e => { store.set('quality', e.target.value); location.reload(); };
$('sensRange').value = sensitivity;
$('sensRange').oninput = e => { sensitivity = Number(e.target.value); store.set('sens', sensitivity); };
$('volRange').value = audio.volume;
$('volRange').oninput = e => setVolume(Number(e.target.value));
function setVolume(v) {
  audio.setVolume(v); store.set('vol', v); $('volRange').value = $('menuVol').value = v;
  if (v > 0 && audio.muted) setMuted(false);
}
function setMuted(m) {
  audio.setMuted(m); store.set('muted', m);
  $('soundBtn').classList.toggle('off', m); $('soundBtn').setAttribute('aria-pressed', String(!m));
  $('soundLabel').textContent = m ? 'Sound: off' : 'Sound: on';
}
$('menuVol').value = audio.volume; setMuted(audio.muted);

// ------------------------------------------------------------------ renderer & scene
installHeightFog();
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 600);
camera.rotation.order = 'YXZ';
scene.add(camera);

let world, fx, weapon, post, hud;
const avatars = new Map();

// ------------------------------------------------------------------ network state
const socket = io({ transports: ['websocket', 'polling'] });
let myId = null, roomCode = null, isHost = false, meta = null, phase = 'home';
let serverOffset = null, lastSnapAt = 0, ping = 0;
const serverNow = () => performance.now() + (serverOffset || 0);
const renderServerTime = () => serverNow() - Sim.INTERP_DELAY_MS;

const local = {
  sim: Sim.newPlayerState(), prev: Sim.newPlayerState(), seq: 0, pending: [], outbox: [], acc: 0,
  yaw: 0, pitch: 0, recoilPitch: 0, recoilYaw: 0, hp: 100, alive: true, errorOffset: new THREE.Vector3(),
  cd: { shield: 0, scan: 0, shieldOn: 0 }, cdAt: 0, killedBy: '', deadAt: 0, stepDist: 0, wasOg: true,
  shotsInBurst: 0, lastFireT: 0, sh: 50, shRegen: false, streak: 0, circle: null, burnNoticeAt: 0
};
const remotes = new Map(); // id -> { buffer: [], state, stepDist, xrayUntil, lastFlags }

// ------------------------------------------------------------------ input
const keys = {};
let pointerLocked = false, mouseDown = false, aimDown = false, dashQueued = false, reloadQueued = false, mouseDX = 0, mouseDY = 0;
let testFire = false; // automated-test hook (see window.__NAB.input)
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  // beam clash duel: W/A/S/D (or arrows) are the quick-time keys, nothing else works
  if (clash && clash.me >= 0 && !clash.ended) {
    const k = CLASH_MAP[e.code];
    if (k && !e.repeat) clashPress(k);
    if (k || e.code === 'Space') e.preventDefault();
    return;
  }
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat || phase !== 'playing') return;
  if (e.code === 'KeyR') reloadQueued = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') dashQueued = true;
  if (e.code === 'KeyQ') ability('shield');
  if (e.code === 'KeyE') ability('scan');
  if (e.code === 'KeyF' && weapon) weapon.inspect();
  if (e.code === 'Tab') $('scoreboard').classList.remove('hidden');
  if (e.code === 'KeyM') setMuted(!audio.muted);
  if (e.code === 'Escape' && menuOpen) closeMenu();
});
document.addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') $('scoreboard').classList.add('hidden'); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = aimDown = false; });
renderer.domElement.addEventListener('click', () => { if (phase === 'playing' && !isTouch && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock(); });
let skipMouse = 0;
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement; skipMouse = 2;
  if (!pointerLocked) { mouseDown = aimDown = false; if (phase === 'playing' && !menuClosing) openMenu(); }
  menuClosing = false;
});
document.addEventListener('mousemove', e => {
  if (!pointerLocked || phase !== 'playing') return;
  // Browsers can report a huge bogus delta right after the pointer locks; drop it.
  if (skipMouse > 0) { skipMouse--; return; }
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  const k = 0.0021 * sensitivity * (weapon && weapon.scoped ? 0.3 : aimDown ? 0.6 : 1);
  local.yaw -= e.movementX * k; local.pitch = THREE.MathUtils.clamp(local.pitch - e.movementY * k, -1.4, 1.4);
  mouseDX += e.movementX; mouseDY += e.movementY;
});
document.addEventListener('mousedown', e => { if (!pointerLocked) return; if (e.button === 0) mouseDown = true; if (e.button === 2) aimDown = true; });
document.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; if (e.button === 2) aimDown = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerdown', () => { audio.init(); if (world && audio.enabled) audio.startAmbience(world.neonEmitters, world.fireSpots); }, { capture: true });
$('dashBtn').onclick = () => { dashQueued = true; };
$('shieldBtn').onclick = () => ability('shield');
$('scanBtn').onclick = () => ability('scan');
function ability(type) { if (phase === 'playing' && local.alive) socket.emit('ability', { type }); }

// touch controls (phones/tablets): floating stick, drag-to-aim, fire-and-aim button, ability buttons
const touch = new TouchControls({
  onLook: (dx, dy) => {
    const k = 0.0055 * sensitivity * (weapon && weapon.scoped ? 0.3 : touch.aim ? 0.55 : 1);
    local.yaw -= dx * k; local.pitch = THREE.MathUtils.clamp(local.pitch - dy * k, -1.3, 1.3);
    mouseDX += dx * 2; mouseDY += dy * 2;
  },
  onReload: () => { reloadQueued = true; },
  onDash: () => { dashQueued = true; },
  onAbility: type => ability(type),
});
if (isTouch) {
  // landscape + fullscreen on the first tap of a menu button (browsers only allow this after a tap)
  for (const id of ['createBtn', 'joinBtn', 'startBtn']) $(id).addEventListener('click', () => goLandscape());
}
$('goLandscape').addEventListener('click', () => goLandscape());

// ------------------------------------------------------------------ classes
const CLASS_INFO = [
  { blurb: 'Rifle · 3 in a row = monster', stats: '100 HP · 1 dash', icon: '<path d="M5 13a7 7 0 0 1 14 0v2H5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15h14M8 11h8" stroke="currentColor" stroke-width="1.8"/><path d="M9 18h6" stroke="currentColor" stroke-width="1.8"/>' },
  { blurb: 'Sniper · 5 in a row = beam', stats: '85 HP · 3 dashes', icon: '<path d="M12 3c-4 3-6 7-6 11a6 6 0 0 0 12 0c0-4-2-8-6-11z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 13l2 1M15 13l-2 1" stroke="currentColor" stroke-width="2"/>' },
  { blurb: 'Greatsword · kill → shotgun', stats: '130 HP · 1 dash', icon: '<path d="M12 2l2 3v11h-4V5z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 16h12M12 16v5" stroke="currentColor" stroke-width="2"/>' }
];
let classChoice = Sim.CLASSES[store.get('cls', 0)] ? store.get('cls', 0) : 0;
function renderPickers() {
  for (const box of document.querySelectorAll('[data-picker]')) {
    if (!box.children.length) {
      box.innerHTML = Sim.CLASSES.map((C, i) => `<button class="classCard" data-cls="${i}"><svg class="ic" viewBox="0 0 24 24">${CLASS_INFO[i].icon}</svg><b>${C.name}</b><span>${CLASS_INFO[i].blurb}</span><small>${CLASS_INFO[i].stats}</small></button>`).join('');
      box.addEventListener('click', e => { const b = e.target.closest('.classCard'); if (b) pickClass(Number(b.dataset.cls)); });
    }
    for (const b of box.children) b.classList.toggle('selected', Number(b.dataset.cls) === classChoice);
  }
}
function pickClass(c) {
  if (!Sim.CLASSES[c]) return;
  classChoice = c; store.set('cls', c); renderPickers();
  if (myId) socket.emit('setClass', { cls: c });
  if (phase === 'playing' && hud) hud.notice(c === local.sim.cls ? `${Sim.CLASSES[c].name}` : `${Sim.CLASSES[c].name} · ON NEXT RESPAWN`, 1400);
}
renderPickers();

// ------------------------------------------------------------------ in-game menu (☰ / Esc)
let menuOpen = false, menuClosing = false, exitArmed = 0;
function openMenu() {
  if (phase !== 'playing' || menuOpen) return;
  menuOpen = true; touch.release(); mouseDown = aimDown = false;
  for (const k in keys) keys[k] = false;
  $('menuRoom').textContent = roomCode || '------'; disarmExit();
  $('gameMenu').classList.remove('hidden'); $('mobileControls').classList.add('off');
  if (document.pointerLockElement) { menuClosing = true; document.exitPointerLock(); }
}
function closeMenu(relock) {
  if (!menuOpen) return;
  menuOpen = false; disarmExit();
  $('gameMenu').classList.add('hidden'); $('scoreboard').classList.add('hidden'); $('scoreboard').classList.remove('tapClose');
  $('mobileControls').classList.toggle('off', phase !== 'playing');
  if (relock && phase === 'playing' && !isTouch && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();
}
function disarmExit() { exitArmed = 0; $('exitBtn').classList.remove('confirm'); $('exitBtn').textContent = 'Exit match'; }
$('menuBtn').addEventListener('click', e => { e.stopPropagation(); openMenu(); });
$('menuBtn').addEventListener('pointerdown', e => e.stopPropagation());
$('resumeBtn').onclick = () => closeMenu(true);
$('soundBtn').onclick = () => { audio.init(); setMuted(!audio.muted); };
$('menuVol').oninput = e => setVolume(Number(e.target.value));
// scoreboard from the menu: swap the menu out, any tap/click brings it back
$('menuScoresBtn').onclick = () => { $('gameMenu').classList.add('hidden'); $('scoreboard').classList.remove('hidden'); $('scoreboard').classList.add('tapClose'); };
$('scoreboard').addEventListener('pointerdown', e => {
  e.stopPropagation(); $('scoreboard').classList.add('hidden'); $('scoreboard').classList.remove('tapClose');
  if (menuOpen) $('gameMenu').classList.remove('hidden');
});
// exit needs two taps so a stray thumb can't throw you out of a match
$('exitBtn').onclick = () => {
  if (performance.now() - exitArmed < 3000) return leave();
  exitArmed = performance.now(); $('exitBtn').classList.add('confirm'); $('exitBtn').textContent = 'Tap again to exit';
  setTimeout(() => { if (exitArmed && performance.now() - exitArmed >= 3000) disarmExit(); }, 3100);
};

// ------------------------------------------------------------------ menus
function setScreen(s) {
  phase = s;
  for (const id of ['home', 'lobby', 'gameHud', 'results']) $(id).classList.add('hidden');
  if (s === 'home') $('home').classList.remove('hidden');
  if (s === 'lobby') $('lobby').classList.remove('hidden');
  if (s === 'playing') $('gameHud').classList.remove('hidden');
  if (s === 'results') $('results').classList.remove('hidden');
  $('mobileControls').classList.toggle('off', s !== 'playing');
  if (s !== 'playing') { touch.release(); closeMenu(); }
  if (s !== 'playing' && document.pointerLockElement) document.exitPointerLock();
}
const showError = t => { $('homeError').textContent = t || ''; };
function connectResult(res) {
  if (!res || !res.ok) { showError(res?.error || 'Connection failed'); return; }
  myId = res.playerId; roomCode = res.code; isHost = res.host;
  $('roomCode').textContent = roomCode;
  $('startBtn').classList.toggle('hidden', !isHost);
  $('lobbyHint').textContent = isHost ? 'You are the host. Start when at least two runners are connected.' : 'Connected. Waiting for the host to start.';
  setScreen('lobby'); showError('');
}
$('createBtn').onclick = () => socket.emit('createRoom', { name: $('nickname').value, cls: classChoice }, connectResult);
$('showJoinBtn').onclick = () => { $('joinRow').classList.toggle('hidden'); $('roomInput').focus(); };
$('joinBtn').onclick = () => socket.emit('joinRoom', { name: $('nickname').value, code: $('roomInput').value, cls: classChoice }, connectResult);
$('roomInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
$('nickname').addEventListener('keydown', e => { if (e.key === 'Enter') $('createBtn').click(); });
$('nickname').value = store.get('name', 'Runner');
$('nickname').addEventListener('change', e => store.set('name', e.target.value));
$('startBtn').onclick = () => socket.emit('startMatch');
$('copyBtn').onclick = async () => { try { await navigator.clipboard.writeText(roomCode); $('copyBtn').textContent = 'CODE COPIED'; } catch { $('copyBtn').textContent = 'ROOM CODE: ' + roomCode; } };
function leave() { if (socket.connected) socket.disconnect(); location.reload(); }
$('leaveBtn').onclick = leave; $('resultsLeaveBtn').onclick = leave;
$('rematchBtn').onclick = () => { socket.emit('rematch'); $('results').classList.add('hidden'); };

// ------------------------------------------------------------------ socket events
socket.on('connect_error', () => showError('Cannot connect to the game server. Refresh and try again.'));
socket.on('notice', t => hud && hud.notice(t));

socket.on('state', state => {
  meta = state;
  syncAvatars(state.players);
  isHost = state.host === myId;
  if (state.phase === 'lobby') {
    if (phase !== 'lobby' && phase !== 'home') setScreen('lobby');
    if (phase === 'home' && myId) setScreen('lobby');
    $('roomCode').textContent = state.code;
    $('lobbyPlayers').innerHTML = state.players.map(p => `<div class="playerpill"><b style="color:${p.color}">◆</b>${escapeHtml(p.name)} <small style="color:var(--yellow)">${(Sim.CLASSES[p.next] || Sim.CLASSES[0]).name}</small>${p.id === state.host ? ' <small style="color:#789">HOST</small>' : ''}</div>`).join('');
    $('startBtn').disabled = state.players.length < 2;
    $('startBtn').textContent = state.players.length < 2 ? 'Start match — need 2 players' : 'Start match';
    $('lobbyHint').textContent = `${state.players.length}/8 runners connected` + (isHost ? ' · you are the host' : '');
    $('startBtn').classList.toggle('hidden', !isHost);
  } else if (state.phase === 'playing') {
    if (phase !== 'playing') enterMatch();
    const me = state.players.find(p => p.id === myId);
    if (me && hud) hud.score(me.score);
    if (hud) { hud.timer(state.timeLeft); hud.leaderboard(state.players, myId); hud.feed(state.feed); }
  } else if (state.phase === 'results') {
    if (phase !== 'results') setScreen('results');
  }
});

function enterMatch() {
  setScreen('playing');
  local.pending.length = 0; local.outbox.length = 0; local.acc = 0;
  for (const r of remotes.values()) r.buffer.length = 0;
  hud.notice('BLACKOUT INITIATED', 1600);
  weapon.respawn();
  if (!isTouch && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();
}
socket.on('matchStarted', () => { if (phase !== 'playing' && world) enterMatch(); });

socket.on('matchEnded', data => {
  $('winnerName').textContent = data.winner;
  $('resultRows').innerHTML = data.rankings.map(r => `<div class="resultrow"><b>#${r.place}</b><span><i style="display:inline-block;width:8px;height:8px;margin-right:6px;background:${r.color}"></i>${escapeHtml(r.name)}<small style="display:block;color:#789">${r.kills} eliminations · ${r.deaths} defeats</small></span><b>${r.score}</b></div>`).join('');
  $('rematchBtn').classList.toggle('hidden', !isHost);
  setScreen('results');
});

socket.on('snap', snap => {
  const nowT = performance.now();
  const sample = snap.t - nowT;
  if (serverOffset === null || sample > serverOffset) serverOffset = sample; else serverOffset += (sample - serverOffset) * 0.02;
  lastSnapAt = nowT;
  local.hp = snap.hp;
  if (snap.sh !== undefined) {
    // shield recharge cue: plays once when the shield starts refilling
    const C = Sim.classOf(snap.me);
    if (snap.sh > local.sh && local.sh < C.shield && !local.shRegen && local.alive) { local.shRegen = true; audio.play('shieldUp', { volume: 0.45, reverb: 0.05, bus: 'ui' }); }
    if (snap.sh < local.sh || snap.sh >= C.shield) local.shRegen = snap.sh < C.shield && snap.sh > local.sh;
    local.sh = snap.sh;
    local.streak = snap.st || 0;
  }
  local.cd = snap.cd; local.cdAt = nowT;
  reconcile(snap);
  for (const e of snap.ps) {
    const [id, x, y, z, yaw, pitch, flags, vx, vz] = e;
    if (id === myId) continue;
    let r = remotes.get(id);
    if (!r) { r = { buffer: [], stepDist: 0, xrayUntil: 0, state: null, lastFlags: flags, dashT: 0 }; remotes.set(id, r); }
    r.buffer.push({ t: snap.t, x, y, z, yaw, pitch, flags, vx, vz });
    if (r.buffer.length > 40) r.buffer.shift();
  }
});

function reconcile(snap) {
  const s = local.sim;
  const wasAlive = local.alive;
  local.pending = local.pending.filter(i => i.s > snap.ack);
  const old = { x: s.x, y: s.y, z: s.z };
  Sim.copyState(snap.me, s);
  for (const input of local.pending) Sim.stepPlayer(s, input);
  local.alive = s.alive;
  if (snap.tp) {
    Sim.copyState(s, local.prev);
    local.errorOffset.set(0, 0, 0);
    local.yaw = snap.me.yaw; local.pitch = 0;
  } else {
    const dx = old.x - s.x, dy = old.y - s.y, dz = old.z - s.z;
    if (dx * dx + dy * dy + dz * dz > 9) { local.errorOffset.set(0, 0, 0); Sim.copyState(s, local.prev); }
    else { local.errorOffset.x += dx; local.errorOffset.y += dy; local.errorOffset.z += dz; local.prev.x -= dx; local.prev.y -= dy; local.prev.z -= dz; }
  }
  if (!wasAlive && local.alive) { /* respawn handled by 'respawned' event */ }
}

socket.on('shot', shot => {
  if (shot.w === 'sg') return remoteShotgun(shot);
  const shooter = avatars.get(shot.id);
  const end = new THREE.Vector3(...shot.e);
  const r = remotes.get(shot.id);
  const muzzle = shooter && r && r.state && r.state.alive ? shooter.muzzleWorld(new THREE.Vector3()) : new THREE.Vector3(...shot.o);
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
const impactSound = k => (k === 'floor' ? 'impactWater' : k === 'facade' || k === 'barrier' || k === 'shack' ? 'impactConcrete' : 'impactMetal');
const EMBER = 0xff7a3a;
function remoteShotgun(shot) {
  const shooter = avatars.get(shot.id), r = remotes.get(shot.id);
  const muzzle = shooter && r && r.state && r.state.alive ? shooter.muzzleWorld(new THREE.Vector3()) : new THREE.Vector3(...shot.o);
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
// ------------------------------------------------------------------ Rune-Warden (soldier monster form)
socket.on('monRise', m => {
  const self = m.id === myId, r = remotes.get(m.id);
  const pose = out => { const st = self ? local.sim : r?.state; if (st) out.set(st.x, st.y, st.z); };
  fx.runeRise(pose, Sim.MON_RISE_TICKS * Sim.DT);
  const st = self ? local.sim : r?.state;
  audio.play('monRise', st && !self ? { pos: new THREE.Vector3(st.x, st.y + 1.2, st.z), volume: 1.4, ref: 6, reverb: 0.4 } : { volume: 0.9, reverb: 0.3 });
  if (self) { hud.notice('THE RUNES AWAKEN', 1500); camShake.dash = 1; }
  else hud.notice(`${playerName(m.id)} IS TURNING INTO SOMETHING`, 1500);
});
function monsterBurst(id) {
  const st = id && id !== myId ? remotes.get(id)?.state : local.sim;
  if (!st) return;
  const pos = new THREE.Vector3(st.x, st.y, st.z);
  fx.runeBurst(pos);
  if (!id || id === myId) { audio.play('monRoar', { volume: 1.0, reverb: 0.5 }); hud.notice('RUNE-WARDEN · 20 SECONDS', 1800); beamFlash = 0.35; damage.shake = 1; touch.buzz(220); }
  else audio.play('monRoar', { pos: pos.clone().setY(pos.y + 2), volume: 1.8, ref: 10, rolloff: 0.6, reverb: 0.6 });
}
socket.on('monStart', m => monsterBurst(m.id));
/** The Warden's heavy footfalls, landings and fist smashes: a thud, a dust ring, and the ground shakes nearby. */
function wardenStomp(pos, str) {
  if (str >= 0.5) fx.ring(pos, 0xff3a2a, 1.2 + str * 2.2, 0.35 + str * 0.2);
  if (str >= 0.5) fx.stomp(pos, str); else fx.footSplash(pos);
  audio.play('land', { pos, volume: 0.4 + str * 0.6, rate: 0.55, ref: 4 });
  const d = Math.hypot(pos.x - local.sim.x, pos.z - local.sim.z);
  if (str >= 0.8 && d < 14) damage.shake = Math.min(1, damage.shake + str * 0.5 * (1 - d / 14));
}
socket.on('monEnd', m => {
  if (m.id === myId) { audio.play('monEnd', { volume: 0.7, reverb: 0.3 }); hud.notice('THE RUNES GO DARK', 1300); return; }
  const st = remotes.get(m.id)?.state;
  if (st) { audio.play('monEnd', { pos: new THREE.Vector3(st.x, st.y + 1.5, st.z), volume: 1.0, ref: 5 }); fx.ring(st, 0xff2a3a, 4, 0.6); }
});
socket.on('adapt', a => {
  const av = avatars.get(a.id), st = a.id === myId ? local.sim : remotes.get(a.id)?.state;
  if (av) av.adapt();
  if (st) audio.play('adaptClank', a.id === myId ? { volume: 0.7, reverb: 0.2 } : { pos: new THREE.Vector3(st.x, st.y + 3.2, st.z), volume: 1.3, ref: 6, reverb: 0.3 });
  const what = { rifle: 'RIFLE', sniper: 'SNIPER', shotgun: 'SHOTGUN', sword: 'GREATSWORD', claws: 'CLAWS', fire: 'FIRE', beam: 'BEAM' }[a.w] || a.w.toUpperCase();
  if (a.id === myId) hud.notice(`ADAPTED · ${what} −${a.n * 15}%`, 1100);
  else if (st) hud.damageNumber(`ADAPTED −${a.n * 15}%`, 'shield', new THREE.Vector3(st.x, st.y + 3.3, st.z));
});

socket.on('ultReady', u => {
  if (u.id === myId) { audio.play('ultReady', { volume: 0.8, bus: 'ui' }); hud.notice('OBLITERATION BEAM READY · NEXT SHOT', 2200); }
});
socket.on('ultCharge', u => {
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
  const name = meta?.players.find(p => p.id === u.id)?.name || 'AN ASSASSIN';
  hud.notice(`${name.toUpperCase()} IS CHARGING A BEAM`, 1500);
});
socket.on('beam', b => {
  const o = new THREE.Vector3(...b.o), axis = { x: b.d[0], y: 0, z: b.d[1] };
  if (b.id !== myId || b.clash) {
    const r = remotes.get(b.id);
    if (r && r.circle) { r.circle.fire(); r.circle = null; }
    fx.beam(o.clone().setY(o.y - 0.3), axis, Sim.BEAM_LENGTH, Sim.BEAM_RADIUS);
    audio.play('beamFire', { pos: o, volume: 2.2, ref: 20, rolloff: 0.4, reverb: 0.7 });
    beamFlash = 0.8; damage.shake = Math.min(1, damage.shake + 0.8);
  }
  // the half of the alley it went into is left burning
  const spots = [], sec = b.ms / 1000;
  const jit = () => (Math.random() - 0.5) * 3;
  if (b.zone.axis === 'z') {
    for (let z = 3; z < Sim.HALF_Z - 1; z += 6.5) for (let x = -Sim.HALF_X + 2; x < Sim.HALF_X - 1; x += 6.2) spots.push({ x: x + jit(), y: 0.05, z: b.zone.sign * (z + jit()) });
  } else {
    for (let x = 2; x < Sim.HALF_X; x += 4.5) for (let z = -Sim.HALF_Z + 3; z < Sim.HALF_Z - 1; z += 6.5) spots.push({ x: b.zone.sign * (x + jit() * 0.4), y: 0.05, z: z + jit() });
  }
  for (let i = spots.length - 1; i >= 0; i--) if (!Sim.isFree(spots[i].x, 0, spots[i].z)) spots.splice(i, 1);
  fx.addTempFires(spots, sec);
  fx.scorch(b.zone, sec);
  for (let i = 0; i < Math.min(5, spots.length); i++) audio.tempLoop('fireLoop', { x: spots[(i * 7) % spots.length].x, y: 0.5, z: spots[(i * 7) % spots.length].z }, 0.9, sec);
  if (Sim.inFireZone(b.zone, local.sim) && b.id !== myId) hud.notice('THE ALLEY IS ON FIRE · GET UP HIGH', 2000);
});
// ------------------------------------------------------------------ beam clash (cutscene + quick-time duel)
let clash = null;
const CLASH_MAP = { KeyW: 'w', ArrowUp: 'w', KeyA: 'a', ArrowLeft: 'a', KeyS: 's', ArrowDown: 's', KeyD: 'd', ArrowRight: 'd' };
const playerName = id => (meta?.players.find(p => p.id === id)?.name || 'RUNNER').toUpperCase();
socket.on('clashStart', c => {
  fx.clearBeams();
  for (const r of remotes.values()) if (r.circle) { r.circle.cancel(); r.circle = null; }
  if (local.circle) { local.circle.cancel(); local.circle = null; }
  const me = c.a === myId ? 0 : c.b === myId ? 1 : -1;
  const oa = new THREE.Vector3(...c.oa), ob = new THREE.Vector3(...c.ob);
  clash = { ...c, me, oa, ob, t0: performance.now(), idx: 0, missUntil: 0, prog: [0, 0], ended: false, camT: 0,
    fx: fx.beamClash(oa.clone().setY(oa.y - 0.3), ob.clone().setY(ob.y - 0.3)) };
  const el = $('clash');
  el.classList.remove('hidden'); el.classList.toggle('spectate', me < 0);
  requestAnimationFrame(() => el.classList.add('on'));
  $('clashA').textContent = playerName(c.a); $('clashB').textContent = playerName(c.b);
  $('clashQte').classList.add('hidden'); $('clashResult').classList.remove('show');
  renderClashKeys();
  const mid = oa.clone().lerp(ob, 0.5);
  audio.play('beamFire', { pos: mid, volume: 1.8, ref: 20, rolloff: 0.4, reverb: 0.6 });
  audio.tempLoop('clashLoop', mid, 1.4, (c.intro + c.qte + 400) / 1000);
  if (me >= 0) {
    touch.release(); mouseDown = false; beamFlash = 0.3; damage.shake = 0.7;
    // each side shouts as their beam meets the other
    c.shouts.forEach((txt, i) => setTimeout(() => {
      if (!clash || clash.ended) return;
      const sh = $('clashShout'); sh.textContent = `${playerName(i ? c.b : c.a)}: "${txt}"`; sh.style.color = i ? '#ffb3f5' : '#cfd8ff';
      sh.classList.remove('show'); void sh.offsetWidth; sh.classList.add('show');
    }, 100 + i * 550));
  }
});
socket.on('clashState', st => { if (clash) clash.prog = st.p; });
socket.on('clashEnd', e => {
  if (!clash) return;
  const c = clash; c.ended = true; c.prog = e.p;
  const side = e.tie ? 'tie' : (e.winner === c.a ? 0 : 1);
  c.fx.end(side);
  const r = $('clashResult');
  r.textContent = e.tie ? 'DOUBLE OBLITERATION' : c.me < 0 ? `${playerName(e.winner)} WINS THE CLASH` : e.winner === myId ? 'YOU WIN THE CLASH' : 'OVERPOWERED';
  r.classList.remove('show'); void r.offsetWidth; r.classList.add('show');
  $('clashQte').classList.add('hidden');
  if (c.me >= 0) { beamFlash = 1; damage.shake = 1; touch.buzz(250); }
  setTimeout(() => {
    if (clash !== c) return;
    clash = null; $('clash').classList.remove('on');
    setTimeout(() => { if (!clash) $('clash').classList.add('hidden'); }, 400);
  }, c.outro + 400);
});
function renderClashKeys() {
  const c = clash; if (!c) return;
  $('clashKeys').innerHTML = [0, 1, 2, 3].map(i => `<span class="${i ? '' : 'next'}">${c.seq[(c.idx + i) % c.seq.length].toUpperCase()}</span>`).join('');
}
function clashPress(k) {
  const c = clash; if (!c || c.me < 0 || c.ended) return;
  const t = performance.now() - c.t0, nowT = performance.now();
  if (t < c.intro || t > c.intro + c.qte || nowT < c.missUntil) return;
  socket.emit('clashKey', { k });
  const el = $('clashKeys');
  if (k === c.seq[c.idx % c.seq.length]) {
    c.idx++;
    audio.play('qteHit', { volume: 0.5, rate: 1 + Math.min(c.idx, 30) * 0.012, bus: 'ui', reverb: 0 });
    el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); touch.buzz(8);
  } else {
    c.missUntil = nowT + Sim.CLASH_MISS_MS;
    audio.play('qteMiss', { volume: 0.6, bus: 'ui', reverb: 0 });
    el.classList.add('miss'); setTimeout(() => el.classList.remove('miss'), Sim.CLASH_MISS_MS); touch.buzz(60);
  }
  renderClashKeys();
}
$('clashPad').addEventListener('pointerdown', e => { const b = e.target.closest('button'); if (b) { e.preventDefault(); e.stopPropagation(); clashPress(b.dataset.k); } });
/** Per frame: timer, tug-of-war meter and the meeting point of the two beams. */
function updateClash(dt) {
  const c = clash; if (!c) return;
  c.camT += dt;
  const t = performance.now() - c.t0, qte = t >= c.intro && !c.ended;
  $('clashQte').classList.toggle('hidden', !qte || c.me < 0);
  let pa = c.prog[0], pb = c.prog[1];
  if (c.me === 0) pa = Math.max(pa, c.idx); else if (c.me === 1) pb = Math.max(pb, c.idx); // your own presses show instantly
  if (qte) {
    $('clashTimer').style.setProperty('--t', Math.max(0, 100 - (t - c.intro) / c.qte * 100).toFixed(1) + '%');
    const top = Math.max(pa, pb, 1);
    $('clashMeterA').style.setProperty('--f', (pa / top * 100).toFixed(0) + '%'); $('clashMeterB').style.setProperty('--f', (pb / top * 100).toFixed(0) + '%');
    $('clashScore').textContent = `${pa} : ${pb}`;
  }
  const bal = (pa - pb) / (pa + pb + 6);
  if (!c.ended) c.fx.update(c.oa.clone().lerp(c.ob, 0.5 + bal * 0.38).setY((c.oa.y + c.ob.y) / 2 - 0.3), Math.abs(bal));
}
/** Cinematic side-on camera for the two duellists. */
function clashCamera(dt) {
  const c = clash;
  const mid = c.oa.clone().lerp(c.ob, 0.5), dir = c.ob.clone().sub(c.oa).setY(0).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(c.me === 0 ? 1 : -1);
  const intro = Math.min(1, c.camT / 0.9), e = intro * intro * (3 - 2 * intro);
  const dist = THREE.MathUtils.lerp(5, Math.min(16, c.oa.distanceTo(c.ob) * 0.45 + 6), e);
  const swing = Math.sin(c.camT * 0.35) * 0.35;
  const off = side.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), swing).multiplyScalar(dist);
  camera.position.copy(mid).add(off);
  // stay inside the alley: if the side view would be inside a building, pull in and go higher instead
  const lx = Sim.HALF_X - 1.2, lz = Sim.HALF_Z - 1, over = Math.max(0, Math.abs(camera.position.x) - lx) + Math.max(0, Math.abs(camera.position.z) - lz);
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -lx, lx); camera.position.z = THREE.MathUtils.clamp(camera.position.z, -lz, lz);
  camera.position.y = mid.y + THREE.MathUtils.lerp(0.6, 3.2, e) + over * 0.5 + (Math.random() - 0.5) * damage.shake * 0.15;
  camera.lookAt(mid.x, mid.y - 0.2, mid.z);
  if (Math.abs(camera.fov - 60) > 0.01) { camera.fov += (60 - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
}

socket.on('swing', w => {
  const a = avatars.get(w.id), st = remotes.get(w.id)?.state;
  if (a) a.swing();
  if (st) audio.swordSwing(new THREE.Vector3(st.x, st.y + 1.3, st.z), false, w.c ? 0.7 : 1);
  if (w.h && w.p) {
    const p = new THREE.Vector3(...w.p), v = avatars.get(w.h);
    const dir = st ? p.clone().sub(new THREE.Vector3(st.x, p.y, st.z)).normalize() : new THREE.Vector3(0, 0, -1);
    if (v) v.flinch(dir);
    fx.playerHit(p, dir, EMBER, false);
    if (w.h !== myId) audio.play('swordHit', { pos: p, volume: 1.0, reverb: 0.25, rate: w.c ? 0.8 : 1 });
  }
});
socket.on('transform', t => {
  if (t.id === myId) { audio.play('transform', { volume: 0.8, reverb: 0.2 }); hud.notice('BLADE REFORGED · PYRE SHOTGUN', 1500); return; }
  const a = avatars.get(t.id), st = remotes.get(t.id)?.state;
  if (a) a.flare();
  if (st) { const p = new THREE.Vector3(st.x, st.y + 1.2, st.z); audio.play('transform', { pos: p, volume: 0.9, ref: 3 }); fx.embers(p, EMBER); }
});
socket.on('sheathe', t => {
  const st = t.id === myId ? local.sim : remotes.get(t.id)?.state;
  if (t.id === myId) { audio.play('transform', { volume: 0.45, rate: 1.25, reverb: 0.1 }); hud.notice('SHELLS SPENT · BLADE RESTORED', 1200); }
  else if (st) audio.play('transform', { pos: new THREE.Vector3(st.x, st.y + 1.2, st.z), volume: 0.5, rate: 1.25, ref: 3 });
});

socket.on('hit', h => {
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
    const name = meta?.players.find(p => p.id === h.id)?.name || 'RUNNER';
    const how = h.w === 'beam' ? 'OBLITERATED' : h.w === 'fire' ? 'BURNED' : 'ELIMINATED';
    hud.killBanner(`<span class="pts">+${h.part === 'head' ? 125 : 100}</span><span class="who">${how} ${escapeHtml(name.toUpperCase())}</span>${h.part === 'head' ? ' <span class="hs">· HEADSHOT</span>' : ''}`);
  }
});

const damage = { pulse: 0, shake: 0 };
socket.on('hurt', h => {
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
  const victim = avatars.get(k.victim), pos = new THREE.Vector3(...k.pos);
  fx.death(pos, victim ? victim.color : 0xffffff);
  audio.play('death', { pos: pos.clone().setY(pos.y + 1), volume: 1, reverb: 0.5 });
  const vr = remotes.get(k.victim);
  if (vr && vr.circle) { vr.circle.cancel(); vr.circle = null; }
  if (k.victim === myId) {
    if (local.circle) { local.circle.cancel(); local.circle = null; }
    local.alive = false; local.deadAt = performance.now();
    local.killedBy = meta?.players.find(p => p.id === k.killer)?.name || '';
    local.deathPos = pos.clone();
    const killer = remotes.get(k.killer);
    local.deathLook = killer && killer.state ? new THREE.Vector3(killer.state.x, killer.state.y + 1.5, killer.state.z) : null;
  }
});
socket.on('respawned', r => {
  if (r.id === myId) { weapon.respawn(); audio.play('respawn', { volume: 0.6 }); hud.notice('REDEPLOYED', 900); }
  else setTimeout(() => { const st = remotes.get(r.id)?.state; if (st) fx.ring(st, avatars.get(r.id)?.color || 0xffffff, 2.5, 0.6); }, 150);
});
socket.on('abilityFx', a => {
  const st = a.id === myId ? local.sim : remotes.get(a.id)?.state;
  if (!st) return;
  const pos = new THREE.Vector3(st.x, st.y + 1, st.z);
  if (a.type === 'shield') { audio.play('shield', a.id === myId ? { volume: 0.6 } : { pos, volume: 0.8 }); if (a.id === myId) hud.notice('SHIELD ACTIVE'); }
  if (a.type === 'scan') { fx.ring(pos, 0xb6ff4a, 40, 1.4); audio.play('scan', a.id === myId ? { volume: 0.5 } : { pos, volume: 0.9 }); }
});
socket.on('scanPulse', d => {
  const until = performance.now() + d.duration;
  for (const q of d.players) { const r = remotes.get(q.id); if (r) r.xrayUntil = until; }
  scanFlash = 1;
  hud.notice(`NEURAL SCAN · ${d.players.length} SIGNAL${d.players.length === 1 ? '' : 'S'}`);
});
let scanFlash = 0, beamFlash = 0;

function syncAvatars(players) {
  const ids = new Set(players.map(p => p.id));
  for (const [id, a] of avatars) if (!ids.has(id)) { scene.remove(a.group); a.dispose(); avatars.delete(id); remotes.delete(id); }
  for (const p of players) {
    if (p.id === myId) continue;
    const old = avatars.get(p.id);
    if (old && old.cls === (p.cls | 0)) continue;
    if (old) { scene.remove(old.group); old.dispose(); avatars.delete(p.id); } // class changed on respawn
    const a = new Avatar(p.color, p.name, p.cls | 0);
    a.onDissolve = (pos, color) => { fx.embers(pos, color); audio.play('respawn', { pos, volume: 0.5, rate: 0.55 }); };
    a.onStomp = wardenStomp;
    a.group.visible = false;
    scene.add(a.group); avatars.set(p.id, a);
  }
}

// ping measurement
setInterval(() => { const t0 = performance.now(); socket.emit('ping2', 0, () => { ping = performance.now() - t0; }); }, 2000);

// ------------------------------------------------------------------ simulation tick (60 Hz, fixed)
const aimYaw = () => local.yaw + local.recoilYaw;
const aimPitch = () => THREE.MathUtils.clamp(local.pitch + local.recoilPitch, -1.45, 1.45);
function cameraEye(out = new THREE.Vector3()) { return out.set(local.sim.x, local.sim.y + Sim.EYE_HEIGHT, local.sim.z); }

function simTick() {
  let mx = 0, mz = 0;
  if (menuOpen) { for (const k in keys) keys[k] = false; touch.release(); }
  if (keys.KeyW || keys.ArrowUp) mz += 1; if (keys.KeyS || keys.ArrowDown) mz -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1; if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  mx += touch.move.x; mz += touch.move.z;
  let b = 0;
  if (keys.Space || touch.jump) b |= Sim.BTN.JUMP;
  if (dashQueued) { b |= Sim.BTN.DASH; dashQueued = false; }
  if (reloadQueued) { b |= Sim.BTN.RELOAD; reloadQueued = false; }
  const firing = (mouseDown && pointerLocked) || (touch.fire && local.alive) || testFire;
  if (firing) b |= Sim.BTN.FIRE;
  if (aimDown) b |= Sim.BTN.ADS;
  const input = { s: ++local.seq, mx: Math.round(mx * 100) / 100, mz: Math.round(mz * 100) / 100, yaw: aimYaw(), pitch: aimPitch(), b };
  if (firing) input.vt = Math.round(renderServerTime());
  Sim.copyState(local.sim, local.prev);
  const wasOg = local.sim.og;
  const ev = Sim.stepPlayer(local.sim, input);
  local.pending.push(input); local.outbox.push(input);
  if (local.pending.length > 240) local.pending.shift();
  handleLocalEvents(ev, wasOg, input);
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _e = new THREE.Vector3();
function handleLocalEvents(ev, wasOg, input) {
  const s = local.sim;
  if (ev.fire && ev.shotgun) {
    // predicted pellets (same seeded spread as the server; the server decides damage)
    cameraEye(_o);
    weapon.fire(aimDown);
    camera.updateMatrixWorld();
    const muzzle = weapon.muzzleWorld(camera, _m).clone();
    let impacts = 0;
    for (const d of Sim.pelletDirs(s.yaw, s.pitch, input.s)) {
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
    local.recoilPitch += (aimDown ? 0.04 : 0.065);
    local.recoilYaw += (Math.random() - 0.5) * 0.012;
    camShake.kick = 2.2;
    touch.buzz(30);
  } else if (ev.fire) {
    const now = performance.now();
    local.shotsInBurst = now - local.lastFireT < 260 ? local.shotsInBurst + 1 : 0;
    local.lastFireT = now;
    // effects from the predicted shot (server decides damage)
    cameraEye(_o);
    const sn = !!ev.sniper, range = sn ? Sim.SNIPER_RANGE : Sim.MAX_RANGE;
    const d = sn ? Sim.sniperDir(s.yaw, s.pitch, input.s, ev.scoped) : Sim.aimDirection(s.yaw, s.pitch); _d.set(d.x, d.y, d.z);
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
    if (sn) { local.recoilPitch += ev.scoped ? 0.035 : 0.06; local.recoilYaw += (Math.random() - 0.5) * 0.01; camShake.kick = 1.8; touch.buzz(25); return finishEvents(ev, wasOg); }
    // shell ejection
    const port = weapon.ejectWorld(camera, _e);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    fx.shell(port, right.multiplyScalar(2 + Math.random()).addScaledVector(up, 1.5 + Math.random()).add(new THREE.Vector3(s.vx, s.vy, s.vz)));
    // recoil pattern: steady vertical climb with a slight horizontal drift that grows during a burst
    const k = aimDown ? 0.6 : 1;
    local.recoilPitch += (0.018 + Math.min(local.shotsInBurst, 8) * 0.0018) * k;
    local.recoilYaw += (Math.sin(local.shotsInBurst * 1.7) * 0.004 + (Math.random() - 0.5) * 0.004) * k;
    camShake.kick = 1;
  }
  finishEvents(ev, wasOg);
}
function finishEvents(ev, wasOg) {
  const s = local.sim;
  // Obliteration Beam: rune circle builds up in front of you, then the beam goes off
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
    beamFlash = 0.75; camShake.kick = 4; damage.shake = 1; touch.buzz(200);
    local.recoilPitch += 0.12;
  }
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

// ------------------------------------------------------------------ remote interpolation
function sampleRemote(r, t) {
  const b = r.buffer;
  if (!b.length) return null;
  if (t <= b[0].t) return { ...b[0] };
  for (let i = b.length - 1; i > 0; i--) {
    const a = b[i - 1], c = b[i];
    if (t >= a.t && t <= c.t) {
      const k = (t - a.t) / (c.t - a.t || 1);
      // don't interpolate across teleports (respawn)
      if (Math.hypot(c.x - a.x, c.z - a.z) > 4) return { ...(k < 0.5 ? a : c) };
      let dy = c.yaw - a.yaw; if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
      return { t, x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yaw: a.yaw + dy * k, pitch: a.pitch + (c.pitch - a.pitch) * k, flags: k < 0.5 ? a.flags : c.flags, vx: a.vx + (c.vx - a.vx) * k, vz: a.vz + (c.vz - a.vz) * k };
    }
  }
  // past the newest snapshot: extrapolate briefly
  const last = b[b.length - 1], ex = Math.min(0.1, (t - last.t) / 1000);
  return { ...last, x: last.x + last.vx * ex, z: last.z + last.vz * ex };
}
function updateRemotes(dt) {
  const t = renderServerTime(), now = performance.now();
  for (const [id, r] of remotes) {
    const a = avatars.get(id);
    const s = sampleRemote(r, t);
    if (!a || !s) continue;
    const st = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, vx: s.vx, vz: s.vz, alive: !!(s.flags & 1), shield: !!(s.flags & 2), og: !!(s.flags & 8), dash: !!(s.flags & 16), protect: !!(s.flags & 32), shotgun: !!(s.flags & 64), charging: !!(s.flags & 256), ultReady: !!(s.flags & 512), mon: s.flags & 1024 ? 1 : 0, monT: s.flags & 2048 ? 1 : 0 };
    // steps & dash trails
    if (st.alive && r.state && st.og) {
      r.stepDist += Math.hypot(st.x - r.state.x, st.z - r.state.z);
      if (r.stepDist > 2.0) { r.stepDist = 0; audio.footstep(new THREE.Vector3(st.x, st.y + 0.1, st.z)); if (st.y < 0.01) fx.footSplash(st); }
    }
    if (st.dash && st.alive) fx.dashTrail(st, a.color);
    if (r.state && r.state.og === false && st.og && st.alive) audio.play('land', { pos: new THREE.Vector3(st.x, st.y, st.z), volume: 0.5 });
    if (r.state && !(r.lastFlags & 16) && (s.flags & 16)) audio.play('dash', { pos: new THREE.Vector3(st.x, st.y + 1, st.z), volume: 0.8 });
    r.lastFlags = s.flags;
    r.state = st;
    a.update(dt, st);
    a.setXray(st.alive && now < r.xrayUntil);
    const dist = Math.hypot(st.x - camera.position.x, st.z - camera.position.z);
    a.tag.visible = dist < 28;
  }
}

// ------------------------------------------------------------------ camera
const camShake = { kick: 0, land: 0, dash: 0 };
let fovCur = 78, bobPhase = 0, attractT = 0, monCam = 0;
function updateCamera(dt, alpha) {
  const s = local.sim, p = local.prev;
  // recoil recovery
  const rec = 1 - Math.exp(-dt * 7.5);
  local.recoilPitch -= local.recoilPitch * rec; local.recoilYaw -= local.recoilYaw * rec;
  local.errorOffset.multiplyScalar(Math.exp(-dt * 12));
  const x = p.x + (s.x - p.x) * alpha + local.errorOffset.x;
  const y = p.y + (s.y - p.y) * alpha + local.errorOffset.y;
  const z = p.z + (s.z - p.z) * alpha + local.errorOffset.z;
  const speed = Math.hypot(s.vx, s.vz);
  bobPhase += dt * (speed * 1.6);
  const bobK = s.og ? Math.min(1, speed / Sim.MOVE_SPEED) : 0;
  camShake.kick *= Math.exp(-dt * 20); camShake.land *= Math.exp(-dt * 8); camShake.dash *= Math.exp(-dt * 5);
  damage.shake *= Math.exp(-dt * 7); damage.pulse *= Math.exp(-dt * 3.5);
  monCam += ((s.mon > 0 ? 0.75 : 0) - monCam) * (1 - Math.exp(-dt * 4)); // the Warden sees from higher up
  let camY = y + Sim.EYE_HEIGHT + monCam + Math.abs(Math.sin(bobPhase)) * 0.035 * bobK - camShake.land * 0.12;
  let roll = Math.sin(bobPhase) * 0.004 * bobK + (Math.random() - 0.5) * damage.shake * 0.03;
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
  const w = Sim.weaponOf(s), scoped = weapon && weapon.scoped;
  const targetFov = (aimDown && local.alive && w !== 'sword' ? (scoped ? 22 : w === 'sniper' ? 50 : 56) : 78) + camShake.dash * 10 - (s.ultT > 0 ? (1 - s.ultT / Sim.ULT_CHARGE_TICKS) * 8 : 0);
  fovCur += (targetFov - fovCur) * (1 - Math.exp(-dt * 12));
  if (Math.abs(camera.fov - fovCur) > 0.01) { camera.fov = fovCur; camera.updateProjectionMatrix(); }
}
let freeCam = null; // debug: { pos:[x,y,z], look:[x,y,z] } pins the menu camera
function attractCamera(dt) {
  if (freeCam) { camera.position.set(...freeCam.pos); camera.lookAt(...freeCam.look); return; }
  // slow, uneasy drift down the alley
  attractT += dt * 0.025;
  const a = attractT, z = Math.sin(a) * (Sim.HALF_Z - 12), dir = Math.cos(a) >= 0 ? 1 : -1;
  camera.position.set(Math.sin(a * 2.3) * 5, 3.2 + Math.sin(a * 3.1) * 0.8, z);
  camera.lookAt(Math.sin(a * 1.7) * 3, 2.2, z + dir * 18);
}

// ------------------------------------------------------------------ main loop
let lastFrame = performance.now(), fpsAcc = 0, fpsFrames = 0, fps = 0, netSendAcc = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  const t = now / 1000;
  fpsAcc += dt; fpsFrames++; if (fpsAcc > 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }

  if (phase === 'playing') {
    // touch ADS is a toggle button; drop it (and any held buttons) while dead
    if (isTouch) { if (!local.alive && (touch.aim || touch.fire)) { touch.release(); touch.setAim(false); } aimDown = touch.aim; }
    local.acc += dt;
    let steps = 0;
    while (local.acc >= Sim.DT && steps < 8) { local.acc -= Sim.DT; simTick(); steps++; }
    if (steps === 8) local.acc = 0;
    netSendAcc += dt;
    if (local.outbox.length && (netSendAcc >= 1 / 30 || local.outbox.length >= 4)) {
      netSendAcc = 0;
      while (local.outbox.length) socket.emit('in', local.outbox.splice(0, 10));
    }
    updateRemotes(dt);
    updateClash(dt);
    const cine = !!(clash && clash.me >= 0);
    if (cine) clashCamera(dt); else updateCamera(dt, local.acc / Sim.DT);
    $('gameHud').classList.toggle('cine', cine); $('mobileControls').classList.toggle('cine', cine);
    // HUD
    const s = local.sim;
    const C = Sim.classOf(s), wpn = Sim.weaponOf(s);
    hud.className(C.name);
    hud.vitals(local.hp, s.mon > 0 ? Sim.MON_HP : C.hp, local.sh, C.shield, local.shRegen);
    hud.ammo(s.ammo, s.reload, wpn);
    hud.status(!pointerLocked && !isTouch ? 'CLICK TO LOCK AIM' : !local.alive ? 'REDEPLOYING…'
      : wpn === 'sword' ? 'HOLD FIRE TO SWING · KILL TO REFORGE' : wpn === 'shotgun' ? `PYRE SHOTGUN · ${s.ammo} LEFT`
      : s.monT > 0 ? 'THE RUNES AWAKEN…' : s.mon > 0 ? `RUNE-WARDEN · ${Math.ceil(s.mon * Sim.DT)}s · HOLD FIRE TO TEAR`
      : s.ultT > 0 ? 'OBLITERATION CHARGING…' : s.ult === 1 ? 'OBLITERATION READY · FIRE TO CHARGE'
      : wpn === 'sniper' && s.reload === 0 && s.ammo > 0 ? (isTouch ? 'TAP ADS TO SCOPE' : 'RIGHT-CLICK TO SCOPE')
      : s.reload > 0 ? 'RELOADING…' : s.ammo === 0 ? 'EMPTY — PRESS R' : 'VX-9 ENERGY RIFLE');
    const since = now - local.cdAt;
    // dash: dark only when no charges are left; the badge shows how many remain
    hud.ability('dashBtn', s.dashN > 0 ? 0 : s.dashCd / C.dashRecharge, s.dashT > 0);
    hud.dashCharges(s.dashN, C.dashes, s.dashN < C.dashes ? s.dashCd / C.dashRecharge : 0);
    if (C.key === 'soldier') hud.runes(true, Math.min(Sim.MON_STREAK, local.streak), s.monT > 0, s.mon > 0 ? Math.ceil(s.mon * Sim.DT) : 0);
    else hud.ult(wpn === 'sniper', Math.min(Sim.ULT_STREAK, local.streak), s.ult === 1, s.ultT > 0);
    hud.scope(!!weapon.scoped && local.alive);
    hud.ability('shieldBtn', Math.max(0, local.cd.shield - since) / 9000, local.cd.shieldOn - since > 0);
    hud.ability('scanBtn', Math.max(0, local.cd.scan - since) / 12000, false);
    const moveSpread = Math.hypot(s.vx, s.vz) * 1.2 + (s.og ? 0 : 8);
    hud.crosshair(moveSpread + local.recoilPitch * 300 + (wpn === 'shotgun' ? 14 : wpn === 'sniper' ? 12 : 0), aimDown && local.alive && wpn !== 'sword');
    hud.net(`${Math.round(ping)} MS · ${fps} FPS · ${qualityName.toUpperCase()}`);
    hud.death(!local.alive, local.killedBy, Math.max(0, 2.5 - (now - local.deadAt) / 1000));
    hud.updateDamageNumbers(dt, camera);
    weapon.update({ dt, moveSpeed: Math.hypot(s.vx, s.vz), grounded: s.og, aiming: aimDown, mouseDX, mouseDY, reloadTicks: s.reload, ammo: s.ammo, alive: local.alive, dashing: s.dashT > 0, mode: wpn,
      charging: s.ultT > 0 ? 1 - s.ultT / Sim.ULT_CHARGE_TICKS : s.monT > 0 ? 1 - s.monT / Sim.MON_RISE_TICKS : 0, ultReady: s.ult === 1 });
    if (cine) weapon.root.visible = false;
    const g = post.grade.uniforms;
    g.damage.value = damage.pulse; g.lowHp.value = local.alive && local.hp <= 35 ? (35 - local.hp) / 35 * 0.8 + 0.2 : 0;
    g.dead.value += ((local.alive ? 0 : 1) - g.dead.value) * (1 - Math.exp(-dt * 4));
    scanFlash *= Math.exp(-dt * 3); g.scan.value = scanFlash;
    beamFlash *= Math.exp(-dt * 2.2); g.flash.value = beamFlash;
  } else {
    attractCamera(dt);
    if (weapon) weapon.update({ dt, moveSpeed: 0, grounded: true, aiming: false, mouseDX: 0, mouseDY: 0, reloadTicks: 0, ammo: Sim.MAG_SIZE, alive: false, dashing: false });
    if (post) { const g = post.grade.uniforms; g.damage.value = 0; g.lowHp.value = 0; g.dead.value = 0; }
  }
  mouseDX *= 0.5; mouseDY *= 0.5;
  if (!world) return;
  world.update(t, dt, camera);
  fx.update(dt, camera);
  camera.updateMatrixWorld();
  audio.updateListener(camera);
  post.render(dt);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  if (post) post.setSize(innerWidth, innerHeight);
  if (weapon) weapon.setSize(innerWidth, innerHeight);
  if (world) world.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ boot
async function boot() {
  $('loadStatus').textContent = 'Generating arena materials…';
  $('createBtn').disabled = $('showJoinBtn').disabled = true;
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]); } catch { /* fonts optional */ }
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  world = createWorld(renderer, scene, Q);
  fx = new Effects(scene, Q);
  fx.onShellBounce = (p, n) => audio.play('tink', { pos: p, volume: 0.25 / (n + 1), rate: 0.9 + Math.random() * 0.3, ref: 1.2 });
  fx.setVents(world.ventSpots); fx.setFires(world.fireSpots); fx.setSparks(world.sparkSpots);
  fx.onSpark = p => audio.play('zap', { pos: p, volume: 0.9, ref: 2, reverb: 0.2 });
  world.onThunder = delay => setTimeout(() => audio.play('thunder', { volume: 0.85, reverb: 0.5, bus: 'amb', vary: 0.1 }), delay * 1000);
  weapon = new Weapon(scene.environment);
  weapon.events = {
    start: () => audio.play('magOut', { volume: 0.25, rate: 1.3, reverb: 0.05 }),
    magOut: () => audio.play('magOut', { volume: 0.55, reverb: 0.1 }),
    magIn: () => audio.play('magIn', { volume: 0.6, reverb: 0.1 }),
    charge: () => audio.play('charge', { volume: 0.6, reverb: 0.1 }),
    bolt: () => {
      audio.play('bolt', { volume: 0.65, reverb: 0.1 });
      const port = weapon.ejectWorld(camera, _e), s = local.sim;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      fx.shell(port, right.multiplyScalar(1.8 + Math.random()).addScaledVector(up, 1.4).add(new THREE.Vector3(s.vx, s.vy, s.vz)));
    },
    pump: () => {
      audio.play('sgPump', { volume: 0.6, reverb: 0.1 });
      const port = weapon.ejectWorld(camera, _e), s = local.sim;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      fx.shell(port, right.multiplyScalar(1.6 + Math.random()).addScaledVector(up, 1.8).add(new THREE.Vector3(s.vx, s.vy, s.vz)));
    }
  };
  post = createPost(renderer, scene, camera, weapon.scene, weapon.camera, Q);
  hud = new Hud();
  // compile shaders up-front (including a throwaway avatar) to avoid hitches when the match starts
  const warms = [0, 1, 2].map(c => { const w = new Avatar('#ffffff', 'warmup', c); w.group.position.set(c * 3, -50, 0); w.shield.visible = true; w.ghost.visible = true; if (w.shotgun) w.shotgun.visible = true; scene.add(w.group); return w; });
  weapon.swordRig.visible = weapon.shotgunRig.visible = weapon.slashArc.visible = true;
  try { renderer.compile(scene, camera); renderer.compile(weapon.scene, weapon.camera); } catch { /* optional */ }
  weapon.swordRig.visible = weapon.shotgunRig.visible = weapon.slashArc.visible = false;
  for (const w of warms) { scene.remove(w.group); w.dispose(); }
  $('loadStatus').textContent = `Graphics: ${qualityName.toUpperCase()} · ${renderer.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL'} ready`;
  $('createBtn').disabled = $('showJoinBtn').disabled = false;
  // debugging / automated-test hooks (do not grant anything the server would not accept from a normal client)
  window.__NAB = { renderer, scene, camera, world, fx, weapon, audio, local, remotes, avatars, socket, Sim, input: { fire: v => { testFire = v; }, aim: v => { aimDown = v; } }, touch, menu: { open: openMenu, close: closeMenu, isOpen: () => menuOpen }, clash: () => clash, setFreeCam: v => { freeCam = v; } };
}
requestAnimationFrame(frame);
boot().catch(err => { console.error(err); $('loadStatus').textContent = 'Failed to initialise graphics: ' + err.message; });
