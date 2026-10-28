// Beam Clash: two Obliteration Beams meet -> a side-on cutscene and a W/A/S/D quick-time duel; whoever presses
// more correct keys pushes the meeting point into the other and obliterates them.
import * as THREE from 'three';
import { G, Sim, $, local, remotes, input, damage, playerName } from '../game/ctx.js';

const CLASH_MAP = { KeyW: 'w', ArrowUp: 'w', KeyA: 'a', ArrowLeft: 'a', KeyS: 's', ArrowDown: 's', KeyD: 'd', ArrowRight: 'd' };
const inDuel = () => G.clash && G.clash.me >= 0 && !G.clash.ended;

function renderClashKeys() {
  const c = G.clash; if (!c) return;
  $('clashKeys').innerHTML = [0, 1, 2, 3].map(i => `<span class="${i ? '' : 'next'}">${c.seq[(c.idx + i) % c.seq.length].toUpperCase()}</span>`).join('');
}
function clashPress(k) {
  const c = G.clash, { audio, touch, socket } = G;
  if (!c || c.me < 0 || c.ended) return;
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

/** Cinematic side-on camera for the two duellists. */
function clashCamera(dt) {
  const c = G.clash, camera = G.camera;
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

export default {
  socket(socket) {
    socket.on('clashStart', c => {
      const { fx, audio, touch } = G;
      fx.clearBeams();
      for (const r of remotes.values()) if (r.circle) { r.circle.cancel(); r.circle = null; }
      if (local.circle) { local.circle.cancel(); local.circle = null; }
      const me = c.a === G.myId ? 0 : c.b === G.myId ? 1 : -1;
      const oa = new THREE.Vector3(...c.oa), ob = new THREE.Vector3(...c.ob);
      G.clash = { ...c, me, oa, ob, t0: performance.now(), idx: 0, missUntil: 0, prog: [0, 0], ended: false, camT: 0,
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
        touch.release(); input.mouseDown = false; G.beamFlash = 0.3; damage.shake = 0.7;
        // each side shouts as their beam meets the other
        c.shouts.forEach((txt, i) => setTimeout(() => {
          if (!G.clash || G.clash.ended) return;
          const sh = $('clashShout'); sh.textContent = `${playerName(i ? c.b : c.a)}: "${txt}"`; sh.style.color = i ? '#ffb3f5' : '#cfd8ff';
          sh.classList.remove('show'); void sh.offsetWidth; sh.classList.add('show');
        }, 100 + i * 550));
      }
    });
    socket.on('clashState', st => { if (G.clash) G.clash.prog = st.p; });
    socket.on('clashEnd', e => {
      const c = G.clash;
      if (!c) return;
      c.ended = true; c.prog = e.p;
      const side = e.tie ? 'tie' : (e.winner === c.a ? 0 : 1);
      c.fx.end(side);
      const r = $('clashResult');
      r.textContent = e.tie ? 'DOUBLE OBLITERATION' : c.me < 0 ? `${playerName(e.winner)} WINS THE CLASH` : e.winner === G.myId ? 'YOU WIN THE CLASH' : 'OVERPOWERED';
      r.classList.remove('show'); void r.offsetWidth; r.classList.add('show');
      $('clashQte').classList.add('hidden');
      if (c.me >= 0) { G.beamFlash = 1; damage.shake = 1; G.touch.buzz(250); }
      setTimeout(() => {
        if (G.clash !== c) return;
        G.clash = null; $('clash').classList.remove('on');
        setTimeout(() => { if (!G.clash) $('clash').classList.add('hidden'); }, 400);
      }, c.outro + 400);
    });
  },
  // during the duel W/A/S/D (or arrows) are the quick-time keys, nothing else works
  keydown(e) {
    if (!inDuel()) return false;
    const k = CLASH_MAP[e.code];
    if (k && !e.repeat) clashPress(k);
    if (k || e.code === 'Space') e.preventDefault();
    return true;
  },
  /** Per frame: timer, tug-of-war meter and the meeting point of the two beams. */
  frame(dt) {
    const c = G.clash; if (!c) return;
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
  },
  // the duellists watch from the side (spectators keep their own view)
  camera(dt) {
    if (!(G.clash && G.clash.me >= 0)) return false;
    clashCamera(dt);
    return true;
  }
};
