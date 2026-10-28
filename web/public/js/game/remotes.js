// Other runners: one avatar each, drawn slightly in the past (Sim.INTERP_DELAY_MS) and interpolated between
// server snapshots so they move smoothly even when packets arrive unevenly.
import * as THREE from 'three';
import { Avatar } from '../avatar.js';
import { G, remotes, avatars, renderServerTime, callPowers } from './ctx.js';

/** Snapshot entries for others: [id, x, y, z, yaw, pitch, flags, vx, vz] — keep a short buffer per player. */
export function bufferRemote(e, t) {
  const [id, x, y, z, yaw, pitch, flags, vx, vz] = e;
  let r = remotes.get(id);
  if (!r) { r = { buffer: [], stepDist: 0, xrayUntil: 0, state: null, lastFlags: flags, dashT: 0 }; remotes.set(id, r); }
  r.buffer.push({ t, x, y, z, yaw, pitch, flags, vx, vz });
  if (r.buffer.length > 40) r.buffer.shift();
}

/** Create/replace avatars to match the room's player list (a class change on respawn swaps the body). */
export function syncAvatars(players) {
  const { scene, fx, audio } = G;
  const ids = new Set(players.map(p => p.id));
  for (const [id, a] of avatars) if (!ids.has(id)) { scene.remove(a.group); a.dispose(); avatars.delete(id); remotes.delete(id); }
  for (const p of players) {
    if (p.id === G.myId) continue;
    const old = avatars.get(p.id);
    if (old && old.cls === (p.cls | 0)) continue;
    if (old) { scene.remove(old.group); old.dispose(); avatars.delete(p.id); }
    const a = new Avatar(p.color, p.name, p.cls | 0);
    a.onDissolve = (pos, color) => { fx.embers(pos, color); audio.play('respawn', { pos, volume: 0.5, rate: 0.55 }); };
    callPowers('avatar', a);
    a.group.visible = false;
    scene.add(a.group); avatars.set(p.id, a);
  }
}

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

/** Snapshot flag bits (see flagsOf in server/loop.js) -> what the avatar shows. */
const decode = (s, f) => ({
  x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, vx: s.vx, vz: s.vz,
  alive: !!(f & 1), shield: !!(f & 2), og: !!(f & 8), dash: !!(f & 16), protect: !!(f & 32), shotgun: !!(f & 64),
  charging: !!(f & 256), ultReady: !!(f & 512), mon: f & 1024 ? 1 : 0, monT: f & 2048 ? 1 : 0,
  guard: !!(f & 4096), stag: !!(f & 8192), crashReady: !!(f & 16384), crashing: !!(f & 32768)
});

export function updateRemotes(dt) {
  const { fx, audio, camera } = G;
  const t = renderServerTime(), now = performance.now();
  for (const [id, r] of remotes) {
    const a = avatars.get(id);
    const s = sampleRemote(r, t);
    if (!a || !s) continue;
    const st = decode(s, s.flags);
    callPowers('remoteFrame', r, st, a, dt);
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
