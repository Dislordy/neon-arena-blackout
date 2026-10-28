// Shared client state. Every game module imports what it needs from here instead of passing it around.
// `G` holds the values that change during a session (screen phase, the world and effects once booted, flashes);
// `local`, `remotes`, `avatars`, `input`, `damage` and `camShake` are objects that are mutated in place.
import * as THREE from 'three';

export const Sim = window.NeonSim;
export const $ = id => document.getElementById(id);
export const store = {
  get(k, d) { try { const v = localStorage.getItem('nab.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nab.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
};
export const isTouch = matchMedia('(pointer:coarse)').matches;

export const G = {
  socket: io({ transports: ['websocket', 'polling'] }),
  myId: null, roomCode: null, isHost: false, meta: null, phase: 'home',
  serverOffset: null, lastSnapAt: 0, ping: 0,
  // created in main.js / boot()
  renderer: null, scene: null, camera: null, audio: null, touch: null,
  world: null, fx: null, weapon: null, post: null, hud: null,
  menuOpen: false, clash: null, freeCam: null,
  scanFlash: 0, beamFlash: 0
};

export const local = {
  sim: Sim.newPlayerState(), prev: Sim.newPlayerState(), seq: 0, pending: [], outbox: [], acc: 0,
  yaw: 0, pitch: 0, recoilPitch: 0, recoilYaw: 0, hp: 100, alive: true, errorOffset: new THREE.Vector3(),
  cd: { shield: 0, scan: 0, shieldOn: 0 }, cdAt: 0, killedBy: '', deadAt: 0, stepDist: 0, wasOg: true,
  shotsInBurst: 0, lastFireT: 0, settlePitch: 0, lastKickT: 0, sh: 50, shRegen: false, streak: 0, circle: null, burnNoticeAt: 0
};
export const remotes = new Map(); // id -> { buffer: [], state, stepDist, xrayUntil, lastFlags }
export const avatars = new Map();
export const input = {
  keys: {}, pointerLocked: false, mouseDown: false, aimDown: false, dashQueued: false, reloadQueued: false,
  mouseDX: 0, mouseDY: 0, skipMouse: 0, testFire: false // testFire: automated-test hook (see window.__NAB.input)
};
export const damage = { pulse: 0, shake: 0 };
export const camShake = { kick: 0, land: 0, dash: 0 };

export const serverNow = () => performance.now() + (G.serverOffset || 0);
export const renderServerTime = () => serverNow() - Sim.INTERP_DELAY_MS;
export const aimYaw = () => local.yaw + local.recoilYaw;
export const aimPitch = () => THREE.MathUtils.clamp(local.pitch + local.recoilPitch, -1.45, 1.45);
export function cameraEye(out = new THREE.Vector3()) { return out.set(local.sim.x, local.sim.y + Sim.EYE_HEIGHT, local.sim.z); }
export const playerName = id => (G.meta?.players.find(p => p.id === id)?.name || 'RUNNER').toUpperCase();
/** Latest known sim state of a player (yours is predicted, others' interpolated). */
export const stateOf = id => (id === G.myId ? local.sim : remotes.get(id)?.state);
export const posOf = id => { const st = stateOf(id); return st ? new THREE.Vector3(st.x, st.y, st.z) : null; };

export const EMBER = 0xff7a3a;
export const impactSound = k => (k === 'floor' ? 'impactWater' : k === 'facade' || k === 'barrier' || k === 'shack' ? 'impactConcrete' : 'impactMetal');

/*
 * Class powers (js/powers/*.js) plug in here. A power is an object with any of:
 *   cls          class key whose streak meter it draws (hud)
 *   socket(s)    register its socket events            keydown(e)      -> true if it used the key
 *   avatar(a)    decorate a new remote avatar          localEvent(ev)  your own predicted sim events
 *   remoteFrame(r, st, avatar, dt)                     frame(dt)       per-frame update while playing
 *   camera(dt)   -> true if it drove the camera        hud(s, wpn)     streak meter (only for its class)
 *   killed(k)    someone died
 */
export const powers = [];
export function callPowers(name, ...args) { for (const p of powers) if (p[name]) p[name](...args); }
export function firstPower(name, ...args) { for (const p of powers) if (p[name] && p[name](...args)) return true; return false; }
