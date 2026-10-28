// Keyboard, mouse (pointer lock) and touch controls. They only set flags and view angles; simTick() turns them
// into input commands for the server.
import * as THREE from 'three';
import { TouchControls } from '../touch.js';
import { G, $, input, local, firstPower } from './ctx.js';
import { settings, setMuted } from './settings.js';
import { closeMenu, lockPointer } from './menus.js';
import { renderer } from './view.js';

const keys = input.keys;
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (firstPower('keydown', e)) return; // e.g. the beam-clash duel takes over W/A/S/D
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat || G.phase !== 'playing') return;
  if (e.code === 'KeyR') input.reloadQueued = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.dashQueued = true;
  if (e.code === 'KeyQ') ability('shield');
  if (e.code === 'KeyE') ability('scan');
  if (e.code === 'KeyF' && G.weapon) G.weapon.inspect();
  if (e.code === 'Tab') $('scoreboard').classList.remove('hidden');
  if (e.code === 'KeyM') setMuted(!G.audio.muted);
  if (e.code === 'Escape' && G.menuOpen) closeMenu();
});
document.addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') $('scoreboard').classList.add('hidden'); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; input.mouseDown = input.aimDown = false; });
renderer.domElement.addEventListener('click', lockPointer);
document.addEventListener('mousemove', e => {
  if (!input.pointerLocked || G.phase !== 'playing') return;
  // Browsers can report a huge bogus delta right after the pointer locks; drop it.
  if (input.skipMouse > 0) { input.skipMouse--; return; }
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  const k = 0.0021 * settings.sensitivity * (G.weapon && G.weapon.scoped ? 0.3 : input.aimDown ? 0.6 : 1);
  local.yaw -= e.movementX * k; local.pitch = THREE.MathUtils.clamp(local.pitch - e.movementY * k, -1.4, 1.4);
  input.mouseDX += e.movementX; input.mouseDY += e.movementY;
});
document.addEventListener('mousedown', e => { if (!input.pointerLocked) return; if (e.button === 0) input.mouseDown = true; if (e.button === 2) input.aimDown = true; });
document.addEventListener('mouseup', e => { if (e.button === 0) input.mouseDown = false; if (e.button === 2) input.aimDown = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
// browsers only allow sound after a tap/click
document.addEventListener('pointerdown', () => { G.audio.init(); if (G.world && G.audio.enabled) G.audio.startAmbience(G.world.neonEmitters, G.world.fireSpots); }, { capture: true });
$('dashBtn').onclick = () => { input.dashQueued = true; };
$('shieldBtn').onclick = () => ability('shield');
$('scanBtn').onclick = () => ability('scan');
export function ability(type) { if (G.phase === 'playing' && local.alive) G.socket.emit('ability', { type }); }

// touch controls (phones/tablets): floating stick, drag-to-aim, fire-and-aim button, ability buttons
const touch = G.touch = new TouchControls({
  onLook: (dx, dy) => {
    const k = 0.0055 * settings.sensitivity * (G.weapon && G.weapon.scoped ? 0.3 : touch.aim ? 0.55 : 1);
    local.yaw -= dx * k; local.pitch = THREE.MathUtils.clamp(local.pitch - dy * k, -1.3, 1.3);
    input.mouseDX += dx * 2; input.mouseDY += dy * 2;
  },
  onReload: () => { input.reloadQueued = true; },
  onDash: () => { input.dashQueued = true; },
  onAbility: type => ability(type),
});
export { touch };
