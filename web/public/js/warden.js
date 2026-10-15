// The Rune-Warden: the Soldier's monster form (3 kills in a row). An original design — a pale, hulking
// giant with crimson runes carved into its skin, bandaged forearms, a bone blade growing from the right
// arm, a torn dark cloth skirt, swept-back horn fins and a halo of iron rune plates that turns every
// time it adapts to a weapon. Built at runner proportions, then scaled up by Sim.MON_SCALE.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

/** Returns { group, hips, legs: [{hip, knee}], torso, head, halo, haloSpin, armL/armR: {sh, el, hand}, blade, skirt, sash, runeMat, glow } */
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
  const skirt = new THREE.Group(); hips.add(skirt);                                             // pivots at the belt so it can sway
  add(skirt, cyl(0.24, 0.42, 0.62, 18, true), S.cloth, 0, -0.27, 0);                           // torn dark skirt
  add(hips, new THREE.TorusGeometry(0.235, 0.025, 6, 20), S.wrap, 0, 0.03, 0, Math.PI / 2);   // rope belt
  const sash = new THREE.Group(); sash.position.set(0.12, 0.01, -0.24); hips.add(sash);
  add(sash, new THREE.PlaneGeometry(0.16, 0.5), S.wrap, 0, -0.25, 0, 0.1, 0, 0.05);           // hanging sash
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
  const { halo, haloSpin } = makeHalo(S, glow); halo.position.y = 0.52; head.add(halo);

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
  return { group: g, hips, legs, torso, head, halo, haloSpin, armL, armR, blade, skirt, sash, runeMat, glow };
}

/** Iron rune-plate halo: { halo (position it), haloSpin (rotate it) }. */
function makeHalo(S, glow) {
  const halo = new THREE.Group(), haloSpin = new THREE.Group(); halo.add(haloSpin);
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; parent.add(m); return m; };
  add(haloSpin, new THREE.TorusGeometry(0.32, 0.018, 6, 40), S.iron, 0, 0, 0, Math.PI / 2);
  add(haloSpin, new THREE.TorusGeometry(0.22, 0.008, 6, 32), glow, 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2, plate = new THREE.Group(); plate.position.set(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32); plate.rotation.y = -a; haloSpin.add(plate);
    add(plate, new RoundedBoxGeometry(0.06, 0.1, 0.03, 2, 0.01), S.iron);
    add(plate, new THREE.BoxGeometry(0.02, 0.05, 0.035), glow);
    const spoke = add(haloSpin, new THREE.BoxGeometry(0.2, 0.008, 0.008), S.iron, Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12); spoke.rotation.y = -a;
  }
  return { halo, haloSpin };
}

// ------------------------------------------------------------------ animated Warden (web/public/models/warden.glb)
// The movement comes from an imported, animated creature skeleton (see web/tools/convert-warden.mjs); the body is
// ours: every Warden part below rides on those bones. It loads in the background; until it is ready (or if it
// fails) the Warden falls back to the hand-posed body above.
const HEAD_HEIGHT = 2.44;             // metres: where the skull sits when standing (sets the overall size)
let model = null, loading = null;
export function loadWardenModel(url = '/models/warden.glb') {
  if (!loading) loading = new GLTFLoader().loadAsync(url).then(g => (model = prepare(g))).catch(e => { console.warn('Rune-Warden animations unavailable, using the built-in body:', e && e.message); return null; });
  return loading;
}
export const wardenModelReady = () => !!model;
function prepare(g) {
  const root = g.scene; root.updateMatrixWorld(true);
  const clips = {}; for (const c of g.animations) clips[c.name] = c;
  // upper-body copies (chest, arms, head) so attacks and flinches can play on top of walking.
  // The hands are separate (IK-style) bones in this rig, so they count as upper body too.
  const upper = new Set(); root.getObjectByName('Chest').traverse(o => upper.add(o.name));
  root.traverse(o => { if (/^(Hand|Fing|Find|ElbowIK)/.test(o.name)) upper.add(o.name); });
  for (const n of ['punch', 'bite', 'hit', 'roar']) { const c = clips[n].clone(); c.name = n + '_upper'; c.tracks = c.tracks.filter(t => upper.has(t.name.split('.')[0])); clips[c.name] = c; }
  const head = new THREE.Vector3(); root.getObjectByName('Head').getWorldPosition(head);
  return { root, clips, scale: HEAD_HEIGHT / head.y };
}
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(),
  _a = new THREE.Vector3(), _b = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _basis = new THREE.Matrix4();
/**
 * A fresh animated Warden: { group, mixer, act: {clipName: action}, pose(), runeMat, glow, halo, haloSpin, head, feet }.
 * Call pose() after mixer.update() to move the body parts onto the bones.
 */
export function buildCreep(runeColor = 0xff2a3a) {
  const S = assets(), M = model;
  const runeMat = new THREE.MeshStandardMaterial({ color: 0xd9d5cc, roughness: 0.62, metalness: 0, envMapIntensity: 0.8,
    emissive: new THREE.Color(runeColor), emissiveMap: S.runes, emissiveIntensity: 2.2 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(runeColor).multiplyScalar(3) });
  const rig = M.root.clone(true);
  const holder = new THREE.Group(); holder.rotation.y = Math.PI; holder.scale.setScalar(M.scale); holder.add(rig);
  const group = new THREE.Group(); group.add(holder);
  const body = new THREE.Group(); group.add(body);
  const B = n => rig.getObjectByName(n);
  group.updateMatrixWorld(true);
  const restPos = n => B(n).getWorldPosition(new THREE.Vector3());   // metres (the group sits at the origin here)
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  const cyl = (r0, r1, h, seg = 12, open = false) => new THREE.CylinderGeometry(r0, r1, h, seg, 1, open);
  const ball = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
  const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const parts = [];
  // a part pinned to a bone's full orientation (its local +Y runs along the bone)
  const onBone = (name) => { const g = new THREE.Group(); body.add(g); parts.push({ g, bone: B(name) }); return g; };
  // a limb piece from joint a to joint b (+Y from a to b, +Z towards the creature's front); len = rest length
  const seg = (a, b) => { const g = new THREE.Group(); body.add(g); const len = restPos(a).distanceTo(restPos(b)); parts.push({ g, a: B(a), b: B(b) }); return { g, len }; };
  const limb = (a, b, r0, r1, mat = runeMat) => { const { g, len } = seg(a, b); add(g, cyl(r0, r1, len), mat, 0, len / 2, 0); return { g, len }; };

  // ---- hips + torn skirt (Torso bone: +Y up the spine, +Z forward)
  const hips = onBone('Torso');
  add(hips, rbox(0.46, 0.22, 0.32, 0.07), runeMat, 0, 0.02, 0);
  add(hips, cyl(0.27, 0.46, 0.7, 18, true), S.cloth, 0, -0.3, 0);
  add(hips, new THREE.TorusGeometry(0.27, 0.028, 6, 20), S.wrap, 0, 0.06, 0, Math.PI / 2);
  add(hips, new THREE.PlaneGeometry(0.17, 0.6), S.wrap, 0.14, -0.26, 0.27, -0.1, 0, 0.05);
  // ---- abdomen and chest
  const abd = seg('Torso', 'Chest');
  add(abd.g, rbox(0.5, abd.len + 0.1, 0.32, 0.1), runeMat, 0, abd.len / 2, 0.01);
  for (let r2 = 0; r2 < 3; r2++) for (const sx of [-1, 1]) add(abd.g, rbox(0.11, 0.08, 0.05, 0.02), runeMat, sx * 0.07, 0.1 + r2 * 0.1, 0.16);
  for (const sx of [-1, 1]) add(abd.g, new THREE.BoxGeometry(0.012, abd.len * 0.8, 0.01), glow, sx * 0.05, abd.len * 0.45, 0.172);
  const chest = onBone('Chest');
  add(chest, rbox(0.8, 0.4, 0.42, 0.15), runeMat, 0, 0.18, -0.02);
  for (const sx of [-1, 1]) add(chest, ball(0.19, 16, 10), runeMat, sx * 0.16, 0.18, 0.14, 0, 0, 0, 1.1, 0.75, 0.55);
  add(chest, rbox(0.66, 0.24, 0.36, 0.1), runeMat, 0, 0.36, -0.06);
  // ---- neck and head (Head bone: +Y along the snout, -Z out of the top of the skull)
  limb('Neck', 'Head', 0.14, 0.12);
  const head = onBone('Head'); const skull = new THREE.Group(); skull.scale.setScalar(1.3); head.add(skull);
  add(skull, ball(0.16, 16, 12), runeMat, 0, 0.04, -0.03, 0, 0, 0, 1, 1.15, 1);
  add(skull, rbox(0.26, 0.1, 0.06, 0.02), runeMat, 0, 0.12, -0.13, 0.3);                        // heavy brow
  for (const sx of [-1, 1]) {
    add(skull, new THREE.BoxGeometry(0.05, 0.015, 0.012), glow, sx * 0.06, 0.15, -0.09, 0.3);    // eyes
    const fin = new THREE.Group(); fin.position.set(sx * 0.12, -0.02, -0.12); fin.rotation.set(-0.9, 0, sx * 0.55); skull.add(fin);
    add(fin, new THREE.ConeGeometry(0.07, 0.62, 4), S.bone, 0, -0.28, 0, Math.PI, 0, 0, 1, 1, 0.35); // horn fins swept back
  }
  add(skull, rbox(0.2, 0.14, 0.07, 0.02), runeMat, 0, 0.17, 0.02);                              // upper jaw
  for (let i = 0; i < 6; i++) add(skull, new THREE.ConeGeometry(0.012, 0.05, 4), S.bone, -0.075 + i * 0.03, 0.2, 0.08, Math.PI / 2);
  const jaw = onBone('Jaw1'); const jawS = new THREE.Group(); jawS.scale.setScalar(1.3); jaw.add(jawS);              // opens when it roars and bites
  add(jawS, rbox(0.19, 0.2, 0.06, 0.02), runeMat, 0, 0.1, 0.04);
  for (let i = 0; i < 5; i++) add(jawS, new THREE.ConeGeometry(0.012, 0.05, 4), S.bone, -0.06 + i * 0.03, 0.15, 0.0, -Math.PI / 2);
  add(jawS, new THREE.BoxGeometry(0.12, 0.012, 0.01), glow, 0, 0.12, 0.0);                        // burning maw
  // ---- arms: huge shoulders, bandaged forearms, claws; a bone blade grows from the right forearm
  for (const side of ['L', 'R']) {
    const dl = onBone('Arm1' + side); add(dl, ball(0.2, 16, 12), runeMat, 0, 0.02, 0, 0, 0, 0, 1.1, 1, 1.1);
    limb('Arm1' + side, 'Arm2' + side, 0.14, 0.115);
    add(onBone('Arm2' + side), ball(0.12), runeMat);
    const fa = limb('Arm2' + side, 'Hand' + side, 0.115, 0.09);
    for (let i = 0; i < 7; i++) add(fa.g, new THREE.TorusGeometry(0.105 - i * 0.003, 0.02, 5, 16), S.wrap, 0, fa.len * (0.18 + i * 0.1), 0, Math.PI / 2 + (i % 2 ? 0.15 : -0.15));
    if (side === 'R') {
      const sh = new THREE.Shape();
      sh.moveTo(-0.035, 0); sh.quadraticCurveTo(-0.07, 0.5, 0.0, 1.05); sh.quadraticCurveTo(0.035, 0.55, 0.045, 0); sh.lineTo(-0.035, 0);
      const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 10 }); bg.translate(0, 0, -0.011);
      add(fa.g, bg, S.bone, 0.1, fa.len * 0.25, 0, 0, Math.PI / 2, -0.08);
    }
    add(onBone('Hand' + side), rbox(0.16, 0.17, 0.18, 0.05), runeMat, 0, 0.05, 0);
    for (const [f, tip] of [['FingA1', 'FindA2'], ['FingB1', 'FingB3'], ['FingC1', 'FingC3'], ['FingD1', 'FingD2']]) {
      const k = seg(f + side, tip + side);
      add(k.g, cyl(0.028, 0.022, k.len), runeMat, 0, k.len / 2, 0);
      add(k.g, new THREE.ConeGeometry(0.024, 0.22, 5), S.bone, 0, k.len + 0.1, 0);              // hooked claw past the fingertip
    }
  }
  // ---- legs: thick thighs, long digitigrade shins, clawed toes
  for (const side of ['L', 'R']) {
    limb('Leg1' + side, 'Leg2' + side, 0.17, 0.13);
    add(onBone('Leg2' + side), ball(0.12), runeMat);
    limb('Leg2' + side, 'Leg3' + side, 0.11, 0.085);
    const mt = limb('Leg3' + side, 'Foot' + side, 0.085, 0.065);
    add(mt.g, new THREE.TorusGeometry(0.08, 0.022, 6, 16), S.dark, 0, mt.len * 0.2, 0, Math.PI / 2);
    add(onBone('Foot' + side), rbox(0.16, 0.22, 0.1, 0.04), runeMat, 0, 0.06, 0);
    for (const t of ['StepA', 'StepB']) { const k = seg(t + '1' + side, t + '2' + side); add(k.g, cyl(0.04, 0.03, k.len), runeMat, 0, k.len / 2, 0); add(k.g, new THREE.ConeGeometry(0.03, 0.14, 5), S.bone, 0, k.len + 0.05, 0); }
  }
  const { halo, haloSpin } = makeHalo(S, glow); halo.scale.setScalar(1.25); group.add(halo);
  const fwdBone = B('Torso');
  const pose = () => {
    group.updateMatrixWorld(true); _inv.copy(group.matrixWorld).invert();
    _m.multiplyMatrices(_inv, fwdBone.matrixWorld).decompose(_p, _q, _s); const fwd = _z.set(0, 0, 1).applyQuaternion(_q).clone();
    for (const P of parts) {
      if (P.bone) { _m.multiplyMatrices(_inv, P.bone.matrixWorld).decompose(P.g.position, P.g.quaternion, _s); continue; }
      _a.setFromMatrixPosition(_m.multiplyMatrices(_inv, P.a.matrixWorld)); _b.setFromMatrixPosition(_m.multiplyMatrices(_inv, P.b.matrixWorld));
      _y.subVectors(_b, _a).normalize(); _x.crossVectors(_y, fwd); if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0); _x.normalize(); _z.crossVectors(_x, _y);
      P.g.position.copy(_a); P.g.quaternion.setFromRotationMatrix(_basis.makeBasis(_x, _y, _z));
    }
  };
  const mixer = new THREE.AnimationMixer(rig), act = {};
  for (const [n, c] of Object.entries(M.clips)) act[n] = mixer.clipAction(c);
  group.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  pose();
  return { group, mixer, act, pose, runeMat, glow, halo, haloSpin, head: B('Head'), feet: [B('FootL'), B('FootR')] };
}

/** The rune texture (white-on-black glyphs), for the glowing shell that crawls over the Soldier while transforming. */
export function runeTexture() { return assets().runes; }
