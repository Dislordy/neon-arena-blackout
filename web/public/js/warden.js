// The Rune-Warden: the Soldier's monster form (3 kills in a row). An original design — a pale, hulking
// giant with crimson runes carved into its skin, bandaged forearms, a bone blade growing from the right
// arm, a torn dark cloth skirt, swept-back horn fins and a halo of iron rune plates that turns every
// time it adapts to a weapon. Built at runner proportions, then scaled up by Sim.MON_SCALE.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

let shared = null;
function assets() {
  if (shared) return shared;
  // carved rune lines (emissive map) — invented glyphs, crimson
  const c = document.createElement('canvas'); c.width = 512; c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512); x.strokeStyle = '#fff'; x.lineCap = 'round';
  let sd = 31; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let i = 0; i < 40; i++) {
    const cx = r() * 512, cy = r() * 512, s = 14 + r() * 26; x.lineWidth = 2 + r() * 3; x.beginPath();
    for (let k = 0; k < 3; k++) { x.moveTo(cx + (r() - 0.5) * s, cy + (r() - 0.5) * s); x.lineTo(cx + (r() - 0.5) * s, cy + (r() - 0.5) * s); }
    if (r() > 0.6) { x.moveTo(cx + s * 0.35, cy); x.arc(cx, cy, s * 0.35, 0, Math.PI * 2); }
    x.stroke();
  }
  for (let i = 0; i < 8; i++) { x.lineWidth = 2; x.beginPath(); x.moveTo(r() * 512, 0); x.bezierCurveTo(r() * 512, 170, r() * 512, 340, r() * 512, 512); x.stroke(); } // vein lines
  const runes = new THREE.CanvasTexture(c); runes.wrapS = runes.wrapT = THREE.RepeatWrapping;
  shared = {
    runes,
    cloth: new THREE.MeshStandardMaterial({ color: 0x252b27, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    wrap: new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.9, metalness: 0 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xe6dfcc, roughness: 0.45, metalness: 0.05, envMapIntensity: 1.2 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.5, metalness: 0.9, envMapIntensity: 1.4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0a0a, roughness: 0.6, metalness: 0.2 })
  };
  return shared;
}

/** Returns { group, hips, legs: [{hip, knee}], torso, head, halo, haloSpin, armL, armR, elbowL, elbowR, runeMat, glow } */
export function buildWarden(runeColor = 0xff2a3a) {
  const S = assets();
  const runeMat = new THREE.MeshStandardMaterial({
    color: 0xd9d5cc, roughness: 0.62, metalness: 0, envMapIntensity: 0.8,
    emissive: new THREE.Color(runeColor), emissiveMap: S.runes, emissiveIntensity: 2.2
  });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(runeColor).multiplyScalar(3) });
  const g = new THREE.Group();
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
    m.castShadow = true; parent.add(m); return m;
  };
  const cyl = (r0, r1, h, s = 14, open = false) => new THREE.CylinderGeometry(r0, r1, h, s, 1, open);
  const ball = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
  const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

  // ---- hips, skirt, legs
  const hips = new THREE.Group(); hips.position.y = 0.95; g.add(hips);
  add(hips, rbox(0.4, 0.18, 0.26, 0.06), runeMat);
  add(hips, cyl(0.24, 0.42, 0.62, 18, true), S.cloth, 0, -0.27, 0);                           // torn dark skirt
  add(hips, new THREE.TorusGeometry(0.235, 0.025, 6, 20), S.wrap, 0, 0.03, 0, Math.PI / 2);   // rope belt
  add(hips, new THREE.PlaneGeometry(0.16, 0.5), S.wrap, 0.12, -0.24, -0.24, 0.1, 0, 0.05);    // hanging sash
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.13, -0.05, 0); hips.add(hip);
    add(hip, cyl(0.12, 0.09, 0.45), runeMat, 0, -0.22, 0);
    const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
    add(knee, ball(0.09), runeMat);
    add(knee, cyl(0.09, 0.065, 0.42), runeMat, 0, -0.21, 0);
    add(knee, new THREE.TorusGeometry(0.07, 0.02, 6, 16), S.dark, 0, -0.38, 0, Math.PI / 2); // ankle band
    add(knee, rbox(0.12, 0.06, 0.26, 0.03), runeMat, 0, -0.45, -0.06);                       // bare foot
    legs.push({ hip, knee });
  }

  // ---- torso: a broad, muscled V
  const torso = new THREE.Group(); torso.position.y = 0.06; hips.add(torso);
  add(torso, rbox(0.5, 0.3, 0.3, 0.1), runeMat, 0, 0.2, 0.01);                                 // abdomen
  for (let r2 = 0; r2 < 3; r2++) for (const sx of [-1, 1]) add(torso, rbox(0.1, 0.075, 0.05, 0.02), runeMat, sx * 0.065, 0.09 + r2 * 0.085, -0.15);
  add(torso, rbox(0.72, 0.36, 0.38, 0.14), runeMat, 0, 0.47, 0.0);                             // chest + lats
  for (const sx of [-1, 1]) add(torso, ball(0.17, 16, 10), runeMat, sx * 0.14, 0.5, -0.12, 0, 0, 0, 1.1, 0.75, 0.55); // pecs
  add(torso, rbox(0.62, 0.22, 0.32, 0.1), runeMat, 0, 0.66, 0.03);                             // traps
  add(torso, cyl(0.1, 0.13, 0.12), runeMat, 0, 0.78, 0);                                       // thick neck
  for (const sx of [-1, 1]) add(torso, new THREE.BoxGeometry(0.012, 0.3, 0.01), glow, sx * 0.05, 0.25, -0.162); // glowing rune lines down the stomach

  // ---- head: small, heavy-browed, a glowing maw; horn fins swept back
  const head = new THREE.Group(); head.position.y = 0.88; torso.add(head);
  add(head, ball(0.13, 16, 12), runeMat, 0, 0.06, 0, 0, 0, 0, 0.95, 1.1, 1.05);
  add(head, rbox(0.22, 0.05, 0.08, 0.02), runeMat, 0, 0.11, -0.1);                             // brow
  add(head, new THREE.BoxGeometry(0.1, 0.012, 0.01), glow, 0, 0.0, -0.13);                     // maw
  for (const sx of [-1, 1]) {
    add(head, new THREE.BoxGeometry(0.04, 0.012, 0.01), glow, sx * 0.05, 0.075, -0.128);       // eyes
    const fin = new THREE.Group(); fin.position.set(sx * 0.11, 0.1, 0.02); fin.rotation.set(-0.4, sx * 0.5, sx * 0.9); head.add(fin);
    add(fin, new THREE.ConeGeometry(0.05, 0.42, 4), S.bone, 0, 0.2, 0, 0, 0, 0, 1, 1, 0.35);
  }
  // halo of rune plates (turns 60 degrees each time the Warden adapts)
  const halo = new THREE.Group(); halo.position.y = 0.52; head.add(halo);
  const haloSpin = new THREE.Group(); halo.add(haloSpin);
  add(haloSpin, new THREE.TorusGeometry(0.32, 0.018, 6, 40), S.iron, 0, 0, 0, Math.PI / 2);
  add(haloSpin, new THREE.TorusGeometry(0.22, 0.008, 6, 32), glow, 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2, plate = new THREE.Group(); plate.position.set(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32); plate.rotation.y = -a; haloSpin.add(plate);
    add(plate, rbox(0.06, 0.1, 0.03, 0.01), S.iron);
    add(plate, new THREE.BoxGeometry(0.02, 0.05, 0.035), glow);
    const spoke = add(haloSpin, new THREE.BoxGeometry(0.2, 0.008, 0.008), S.iron, Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12); spoke.rotation.y = -a;
  }

  // ---- arms: huge shoulders, bandaged forearms, claws; a bone blade from the right forearm
  const arm = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.42, 0.6, 0); torso.add(sh);
    add(sh, ball(0.16, 16, 12), runeMat, 0, 0, 0, 0, 0, 0, 1.1, 1, 1);                          // deltoid
    add(sh, cyl(0.12, 0.1, 0.38), runeMat, 0, -0.2, 0);
    const el = new THREE.Group(); el.position.y = -0.4; sh.add(el);
    add(el, ball(0.1), runeMat);
    add(el, cyl(0.1, 0.08, 0.36), runeMat, 0, -0.18, 0);
    for (let i = 0; i < 6; i++) add(el, new THREE.TorusGeometry(0.093 - i * 0.003, 0.018, 5, 16), S.wrap, 0, -0.06 - i * 0.05, 0, Math.PI / 2 + (i % 2 ? 0.15 : -0.15));
    const hand = new THREE.Group(); hand.position.y = -0.4; el.add(hand);
    add(hand, rbox(0.13, 0.13, 0.15, 0.04), runeMat);
    for (let f = 0; f < 4; f++) add(hand, new THREE.ConeGeometry(0.018, 0.12, 5), S.bone, -0.045 + f * 0.03, -0.1, -0.05, Math.PI * 0.85);
    return { sh, el, hand };
  };
  const armL = arm(-1), armR = arm(1);
  // bone blade: a long curved spike growing out past the right hand
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.03, 0); bladeShape.quadraticCurveTo(-0.06, -0.45, 0.0, -0.95); bladeShape.quadraticCurveTo(0.03, -0.5, 0.04, 0); bladeShape.lineTo(-0.03, 0);
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 10 });
  bladeGeo.translate(0, 0, -0.01);
  const blade = add(armR.el, bladeGeo, S.bone, 0.09, -0.12, 0, 0, Math.PI / 2, 0.08);
  armL.sh.rotation.set(0.15, 0, 0.18); armR.sh.rotation.set(0.15, 0, -0.18);

  g.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  return { group: g, hips, legs, torso, head, halo, haloSpin, armL, armR, blade, runeMat, glow };
}

/** The rune texture (white-on-black glyphs), for the glowing shell that crawls over the Soldier while transforming. */
export function runeTexture() { return assets().runes; }
