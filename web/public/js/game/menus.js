// Screens (home → lobby → match → results), the class picker and the in-game ☰ menu.
import { escapeHtml } from '../hud.js';
import { goLandscape } from '../touch.js';
import { G, Sim, $, store, isTouch, input, local, remotes } from './ctx.js';
import { setMuted, setVolume } from './settings.js';
import { renderer } from './view.js';

const socket = G.socket;

// ------------------------------------------------------------------ classes
const CLASS_INFO = [
  { blurb: 'Rifle · 3 in a row = monster', stats: '100 HP · 1 dash', icon: '<path d="M5 13a7 7 0 0 1 14 0v2H5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15h14M8 11h8" stroke="currentColor" stroke-width="1.8"/><path d="M9 18h6" stroke="currentColor" stroke-width="1.8"/>' },
  { blurb: 'Sniper · 5 in a row = beam', stats: '85 HP · 3 dashes', icon: '<path d="M12 3c-4 3-6 7-6 11a6 6 0 0 0 12 0c0-4-2-8-6-11z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 13l2 1M15 13l-2 1" stroke="currentColor" stroke-width="2"/>' },
  { blurb: 'Greatsword · RMB guard/parry · 4 in a row = Cinder Crash', stats: '130 HP · 1 dash', icon: '<path d="M12 2l2 3v11h-4V5z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 16h12M12 16v5" stroke="currentColor" stroke-width="2"/>' }
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
  if (G.myId) socket.emit('setClass', { cls: c });
  if (G.phase === 'playing' && G.hud) G.hud.notice(c === local.sim.cls ? `${Sim.CLASSES[c].name}` : `${Sim.CLASSES[c].name} · ON NEXT RESPAWN`, 1400);
}
renderPickers();

// ------------------------------------------------------------------ in-game menu (☰ / Esc)
let menuClosing = false, exitArmed = 0;
export function openMenu() {
  if (G.phase !== 'playing' || G.menuOpen) return;
  G.menuOpen = true; G.touch.release(); input.mouseDown = input.aimDown = false;
  for (const k in input.keys) input.keys[k] = false;
  $('menuRoom').textContent = G.roomCode || '------'; disarmExit();
  $('gameMenu').classList.remove('hidden'); $('mobileControls').classList.add('off');
  if (document.pointerLockElement) { menuClosing = true; document.exitPointerLock(); }
}
export function closeMenu(relock) {
  if (!G.menuOpen) return;
  G.menuOpen = false; disarmExit();
  $('gameMenu').classList.add('hidden'); $('scoreboard').classList.add('hidden'); $('scoreboard').classList.remove('tapClose');
  $('mobileControls').classList.toggle('off', G.phase !== 'playing');
  if (relock) lockPointer();
}
function disarmExit() { exitArmed = 0; $('exitBtn').classList.remove('confirm'); $('exitBtn').textContent = 'Exit match'; }
export function lockPointer() { if (G.phase === 'playing' && !isTouch && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock(); }
// losing the pointer lock mid-match (Esc) opens the menu
document.addEventListener('pointerlockchange', () => {
  input.pointerLocked = document.pointerLockElement === renderer.domElement; input.skipMouse = 2;
  if (!input.pointerLocked) { input.mouseDown = input.aimDown = false; if (G.phase === 'playing' && !menuClosing) openMenu(); }
  menuClosing = false;
});
$('menuBtn').addEventListener('click', e => { e.stopPropagation(); openMenu(); });
$('menuBtn').addEventListener('pointerdown', e => e.stopPropagation());
$('resumeBtn').onclick = () => closeMenu(true);
$('soundBtn').onclick = () => { G.audio.init(); setMuted(!G.audio.muted); };
$('menuVol').oninput = e => setVolume(Number(e.target.value));
// scoreboard from the menu: swap the menu out, any tap/click brings it back
$('menuScoresBtn').onclick = () => { $('gameMenu').classList.add('hidden'); $('scoreboard').classList.remove('hidden'); $('scoreboard').classList.add('tapClose'); };
$('scoreboard').addEventListener('pointerdown', e => {
  e.stopPropagation(); $('scoreboard').classList.add('hidden'); $('scoreboard').classList.remove('tapClose');
  if (G.menuOpen) $('gameMenu').classList.remove('hidden');
});
// exit needs two taps so a stray thumb can't throw you out of a match
$('exitBtn').onclick = () => {
  if (performance.now() - exitArmed < 3000) return leave();
  exitArmed = performance.now(); $('exitBtn').classList.add('confirm'); $('exitBtn').textContent = 'Tap again to exit';
  setTimeout(() => { if (exitArmed && performance.now() - exitArmed >= 3000) disarmExit(); }, 3100);
};

// ------------------------------------------------------------------ screens
export function setScreen(s) {
  G.phase = s;
  for (const id of ['home', 'lobby', 'gameHud', 'results']) $(id).classList.add('hidden');
  if (s === 'home') $('home').classList.remove('hidden');
  if (s === 'lobby') $('lobby').classList.remove('hidden');
  if (s === 'playing') $('gameHud').classList.remove('hidden');
  if (s === 'results') $('results').classList.remove('hidden');
  $('mobileControls').classList.toggle('off', s !== 'playing');
  if (s !== 'playing') { G.touch.release(); closeMenu(); }
  if (s !== 'playing' && document.pointerLockElement) document.exitPointerLock();
}
export const showError = t => { $('homeError').textContent = t || ''; };
function connectResult(res) {
  if (!res || !res.ok) { showError(res?.error || 'Connection failed'); return; }
  G.myId = res.playerId; G.roomCode = res.code; G.isHost = res.host;
  $('roomCode').textContent = G.roomCode;
  $('startBtn').classList.toggle('hidden', !G.isHost);
  $('lobbyHint').textContent = G.isHost ? 'You are the host. Start when at least two runners are connected.' : 'Connected. Waiting for the host to start.';
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
$('copyBtn').onclick = async () => { try { await navigator.clipboard.writeText(G.roomCode); $('copyBtn').textContent = 'CODE COPIED'; } catch { $('copyBtn').textContent = 'ROOM CODE: ' + G.roomCode; } };
export function leave() { if (socket.connected) socket.disconnect(); location.reload(); }
$('leaveBtn').onclick = leave; $('resultsLeaveBtn').onclick = leave;
$('rematchBtn').onclick = () => { socket.emit('rematch'); $('results').classList.add('hidden'); };
if (isTouch) {
  // landscape + fullscreen on the first tap of a menu button (browsers only allow this after a tap)
  for (const id of ['createBtn', 'joinBtn', 'startBtn']) $(id).addEventListener('click', () => goLandscape());
}
$('goLandscape').addEventListener('click', () => goLandscape());

/** Lobby list of runners and the host's start button. */
export function showLobby(state) {
  if (G.phase !== 'lobby' && G.phase !== 'home') setScreen('lobby');
  if (G.phase === 'home' && G.myId) setScreen('lobby');
  $('roomCode').textContent = state.code;
  $('lobbyPlayers').innerHTML = state.players.map(p => `<div class="playerpill"><b style="color:${p.color}">◆</b>${escapeHtml(p.name)} <small style="color:var(--yellow)">${(Sim.CLASSES[p.next] || Sim.CLASSES[0]).name}</small>${p.id === state.host ? ' <small style="color:#789">HOST</small>' : ''}</div>`).join('');
  $('startBtn').disabled = state.players.length < 2;
  $('startBtn').textContent = state.players.length < 2 ? 'Start match — need 2 players' : 'Start match';
  $('lobbyHint').textContent = `${state.players.length}/8 runners connected` + (G.isHost ? ' · you are the host' : '');
  $('startBtn').classList.toggle('hidden', !G.isHost);
}
export function enterMatch() {
  setScreen('playing');
  local.pending.length = 0; local.outbox.length = 0; local.acc = 0;
  for (const r of remotes.values()) r.buffer.length = 0;
  G.hud.notice('BLACKOUT INITIATED', 1600);
  G.weapon.respawn();
  lockPointer();
}
export function showResults(data) {
  $('winnerName').textContent = data.winner;
  $('resultRows').innerHTML = data.rankings.map(r => `<div class="resultrow"><b>#${r.place}</b><span><i style="display:inline-block;width:8px;height:8px;margin-right:6px;background:${r.color}"></i>${escapeHtml(r.name)}<small style="display:block;color:#789">${r.kills} eliminations · ${r.deaths} defeats</small></span><b>${r.score}</b></div>`).join('');
  $('rematchBtn').classList.toggle('hidden', !G.isHost);
  setScreen('results');
}
