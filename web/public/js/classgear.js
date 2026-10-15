// Knight gear: the "Cinder Oath" greatsword and the "Pyre" shotgun it folds into after a kill.
// Built from extruded silhouettes like the VX-9. Shared by the first-person viewmodel (full detail)
// and third-person avatars (lite).
import * as THREE from 'three';
import * as TX from './textures.js';
import { materials as gunMaterials, sideProfile } from './gunmodel.js';

let shared = null;
function mats() {
  if (shared) return shared;
  const G = gunMaterials();
  const gm = TX.gunMetalMaps(256);
  shared = {
    ...G,
    // dark, worn blade steel: machined-metal roughness variation, no blotchy plate texture
    steel: new THREE.MeshStandardMaterial({ color: 0x8c939c, roughnessMap: gm.roughnessMap, normalMap: gm.normalMap, roughness: 0.75, metalness: 1, envMapIntensity: 2.2 }),
    edge: new THREE.MeshStandardMaterial({ color: 0xe8edf5, roughness: 0.06, metalness: 1, envMapIntensity: 3 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xa47a2c, roughness: 0.3, metalness: 1, envMapIntensity: 2.2 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.75, metalness: 0 }),
    blackIron: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.45, metalness: 1, envMapIntensity: 1.6 })
  };
  return shared;
}
/** Ember glow used by the knight's weapons (orange-red, "kindled" look). */
export const emberMaterial = (k = 1.8) => new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a1f).multiplyScalar(k) });

/**
 * Greatsword, hilt at the origin, blade along +Y (about 1.05 m of blade).
 * Returns { group, tip, blade, glow }
 */
export function buildSword({ glow = emberMaterial(), lite = false } = {}) {
  const M = mats();
  const G = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, parent = G) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; parent.add(m); return m;
  };
  // blade: wide ricasso, long taper, sharp point; bevelled so the edges catch the neon
  const shape = new THREE.Shape();
  const W = 0.042;
  shape.moveTo(-W * 0.8, 0.04); shape.lineTo(-W, 0.12); shape.lineTo(-W * 0.92, 0.82); shape.lineTo(-W * 0.55, 1.02); shape.lineTo(0, 1.12);
  shape.lineTo(W * 0.55, 1.02); shape.lineTo(W * 0.92, 0.82); shape.lineTo(W, 0.12); shape.lineTo(W * 0.8, 0.04); shape.lineTo(-W * 0.8, 0.04);
  const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.007, bevelSegments: lite ? 1 : 3, curveSegments: 2 });
  bladeGeo.translate(0, 0, -0.003); bladeGeo.computeVertexNormals();
  const blade = add(bladeGeo, M.steel);
  // bright honed edge (slightly larger, thin) peeking out around the blade
  if (!lite) { const e = add(bladeGeo.clone(), M.edge); e.scale.set(1.04, 1.0, 0.5); e.position.y = -0.004; }
  // ember-lit fuller down both faces, broken into runes near the guard
  for (const z of [0.0105, -0.0105]) {
    add(new THREE.BoxGeometry(0.005, 0.66, 0.002), glow, 0, 0.5, z);                // ember-lit fuller
    if (!lite) for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.014, 0.003, 0.002), glow, 0, 0.11 + i * 0.022, z); // rune notches
  }
  // crossguard: black iron bar with gilded, swept-up quillons
  add(new THREE.BoxGeometry(0.11, 0.022, 0.032), M.blackIron, 0, 0.02, 0);
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.009, 0.012, 0.08, 8), M.gold, s * 0.085, 0.032, 0, 0, 0, -s * 1.15);
    add(new THREE.SphereGeometry(0.013, 8, 6), M.gold, s * 0.12, 0.05, 0);
  }
  add(new THREE.SphereGeometry(0.014, 8, 6), glow, 0, 0.02, 0.022); // ember gem
  // grip wrapped in leather, gold rings, heavy pommel
  add(new THREE.CylinderGeometry(0.017, 0.019, 0.24, 10), M.leather, 0, -0.12, 0);
  if (!lite) for (let i = 0; i < 5; i++) add(new THREE.TorusGeometry(0.019, 0.003, 4, 12), M.gold, 0, -0.03 - i * 0.045, 0, Math.PI / 2);
  add(new THREE.SphereGeometry(0.032, 12, 10), M.blackIron, 0, -0.26, 0);
  add(new THREE.SphereGeometry(0.012, 8, 6), glow, 0, -0.26, 0.026);
  const tip = new THREE.Object3D(); tip.position.y = 1.1; G.add(tip);
  G.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return { group: G, tip, blade, glow };
}

/**
 * Pyre shotgun: the greatsword's hilt and guard reforged around twin barrels (muzzle at -Z like the VX-9).
 * Returns { group, muzzle, ejectPort, pump, pumpHome, lamps }
 */
export function buildShotgun({ glow = emberMaterial(), lite = false } = {}) {
  const M = mats();
  const G = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = G) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const cyl = (r0, r1, len, mat, x, y, z, seg = 16, parent = G) => { const g = new THREE.CylinderGeometry(r0, r1, len, seg); g.rotateX(Math.PI / 2); return add(g, mat, x, y, z, parent); };
  // receiver: machined gun metal with a gilded spine
  add(sideProfile([[0.12, 0.05], [0.12, -0.035], [0.05, -0.05], [-0.18, -0.05], [-0.2, -0.02], [-0.2, 0.05], [-0.14, 0.066], [0.08, 0.066]], 0.072), M.metal);
  add(new THREE.BoxGeometry(0.012, 0.008, 0.3), M.gold, 0, 0.072, -0.04);
  // twin barrels with ember heat vents
  for (const x of [-0.019, 0.019]) {
    cyl(0.019, 0.019, 0.5, M.steel, x, 0.022, -0.44, 16);
    cyl(0.021, 0.021, 0.03, M.gold, x, 0.022, -0.69, 16);
  }
  if (!lite) for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.05, 0.004, 0.012), glow, 0, 0.044, -0.3 - i * 0.065);
  // the old crossguard, now a front guard ring
  add(new THREE.BoxGeometry(0.17, 0.026, 0.035), M.blackIron, 0, 0.0, -0.22);
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.014, 8, 6), M.gold, s * 0.09, 0.0, -0.22);
  add(new THREE.SphereGeometry(0.013, 8, 6), glow, 0, 0.0, -0.198);
  // pump (moves on every shot)
  const pump = new THREE.Group(); pump.position.set(0, -0.02, -0.4); G.add(pump);
  cyl(0.03, 0.03, 0.16, M.leather, 0, 0, 0, 12, pump);
  if (!lite) for (let i = 0; i < 4; i++) cyl(0.032, 0.032, 0.008, M.gold, 0, 0, -0.06 + i * 0.04, 12, pump);
  // the sword's leather grip + pommel as the pistol grip
  const grip = add(new THREE.CylinderGeometry(0.018, 0.02, 0.15, 10), M.leather, 0, -0.1, 0.08); grip.rotation.x = 0.35;
  add(new THREE.SphereGeometry(0.028, 10, 8), M.blackIron, 0, -0.175, 0.105);
  add(sideProfile([[0.03, -0.045], [-0.05, -0.045], [-0.05, -0.085], [0.035, -0.09]], 0.01, { holes: [[[0.02, -0.052], [-0.04, -0.052], [-0.04, -0.078], [0.022, -0.08]]], bevel: 0.002 }), M.gold);
  // short stock
  add(sideProfile([[0.12, 0.05], [0.3, 0.035], [0.31, -0.07], [0.27, -0.08], [0.12, -0.03]], 0.046, { holes: lite ? [] : [[[0.16, 0.022], [0.27, 0.014], [0.27, -0.04], [0.16, -0.012]]] }), M.polymer);
  // shell lamps on the left side (one per shell; they go dark as you fire)
  const lamps = [];
  if (!lite) for (let i = 0; i < 6; i++) { const l = add(new THREE.SphereGeometry(0.0055, 8, 6), glow.clone(), -0.038, 0.03, -0.14 + i * 0.03); lamps.push(l); }
  // ember bead sight
  add(new THREE.SphereGeometry(0.006, 8, 6), glow, 0, 0.05, -0.68);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.022, -0.71); G.add(muzzle);
  const ejectPort = new THREE.Object3D(); ejectPort.position.set(0.04, 0.03, 0.0); G.add(ejectPort);
  G.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return { group: G, muzzle, ejectPort, pump, pumpHome: pump.position.clone(), lamps };
}

// ------------------------------------------------------------------ assassin
/** Violet arc-glow used by the assassin's rifle (and its beam charge). */
export const arcMaterial = (k = 2.2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7a8cff).multiplyScalar(k) });

/**
 * "Longwire" sniper rifle: long fluted barrel with a muzzle brake, bolt action, big scope, skeleton stock.
 * Muzzle at -Z like the VX-9. Returns { group, muzzle, ejectPort, bolt, boltHome, mag, magHome, scopeY, lens }
 */
export function buildSniper({ glow = arcMaterial(), lite = false } = {}) {
  const M = mats();
  const G = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = G) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const cyl = (r0, r1, len, mat, x, y, z, seg = 16, parent = G) => { const g = new THREE.CylinderGeometry(r0, r1, len, seg); g.rotateX(Math.PI / 2); return add(g, mat, x, y, z, parent); };
  // receiver + chassis
  add(sideProfile([[0.14, 0.045], [0.14, -0.03], [0.06, -0.045], [-0.24, -0.045], [-0.26, -0.02], [-0.26, 0.04], [-0.2, 0.05], [0.1, 0.05]], 0.05), M.metal);
  add(sideProfile([[-0.24, 0.0], [-0.24, -0.05], [-0.6, -0.045], [-0.62, -0.02], [-0.62, 0.01]], 0.058, { holes: lite ? [] : [0, 1, 2, 3, 4].map(k => [[-0.29 - k * 0.06, -0.012], [-0.32 - k * 0.06, -0.012], [-0.32 - k * 0.06, -0.034], [-0.29 - k * 0.06, -0.034]]) }), M.polymer);
  // fluted barrel and muzzle brake
  cyl(0.012, 0.014, 0.78, M.metal, 0, 0.012, -0.78, 12);
  if (!lite) for (let i = 0; i < 6; i++) { const f = add(new THREE.BoxGeometry(0.004, 0.004, 0.5), glow, Math.cos(i) * 0.0135, 0.012 + Math.sin(i) * 0.0135, -0.72); f.castShadow = false; }
  cyl(0.02, 0.02, 0.07, M.metal, 0, 0.012, -1.2, 10);
  if (!lite) for (const z of [-1.18, -1.21]) add(new THREE.BoxGeometry(0.05, 0.008, 0.012), M.rubber, 0, 0.012, z);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -1.24); G.add(muzzle);
  // scope with glowing lens
  const scopeY = 0.1;
  cyl(0.024, 0.024, 0.32, M.metal, 0, scopeY, -0.08, 18);
  cyl(0.034, 0.028, 0.08, M.metal, 0, scopeY, -0.27, 18);
  cyl(0.03, 0.026, 0.06, M.metal, 0, scopeY, 0.1, 18);
  for (const z of [-0.14, 0.02]) add(new THREE.BoxGeometry(0.022, 0.05, 0.03), M.metal, 0, scopeY - 0.035, z);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), M.metal, 0, scopeY + 0.035, -0.06); // turret
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), glow); lens.position.set(0, scopeY, -0.311); lens.rotation.y = Math.PI; G.add(lens);
  // bolt (animated) + magazine
  const bolt = new THREE.Group(); bolt.position.set(0.03, 0.03, 0.06); G.add(bolt);
  cyl(0.008, 0.008, 0.05, M.chrome, 0.02, 0, 0, 8, bolt).rotation.set(0, Math.PI / 2, 0);
  add(new THREE.SphereGeometry(0.012, 10, 8), M.chrome, 0.045, -0.005, 0, bolt);
  const mag = new THREE.Group(); mag.position.set(0, -0.05, -0.1); G.add(mag);
  add(new THREE.BoxGeometry(0.03, 0.08, 0.07), M.polymer, 0, -0.04, 0, mag);
  add(new THREE.BoxGeometry(0.032, 0.01, 0.072), glow, 0, -0.075, 0, mag).castShadow = false;
  // grip, trigger guard, skeleton stock with cheek rest
  add(sideProfile([[0.06, -0.04], [0.11, -0.04], [0.14, -0.15], [0.12, -0.165], [0.075, -0.16], [0.055, -0.08]], 0.032, { bevel: 0.006 }), M.polymer);
  add(sideProfile([[0.14, 0.04], [0.42, 0.04], [0.44, 0.02], [0.44, -0.1], [0.41, -0.11], [0.36, -0.06], [0.14, -0.03]], 0.04,
    { holes: [[[0.19, 0.012], [0.35, 0.012], [0.35, -0.04], [0.19, -0.015]]] }), M.polymer);
  add(new THREE.BoxGeometry(0.044, 0.025, 0.14), M.rubber, 0, 0.058, 0.3); // cheek rest
  add(new THREE.BoxGeometry(0.05, 0.13, 0.02), M.rubber, 0, -0.035, 0.45);
  // folded bipod under the handguard
  if (!lite) for (const s of [-1, 1]) { const leg = cyl(0.005, 0.005, 0.2, M.metal, s * 0.015, -0.055, -0.5, 6); leg.rotation.z = s * 0.1; }
  add(new THREE.BoxGeometry(0.002, 0.012, 0.2), glow, 0.026, 0.0, -0.1).castShadow = false; // side arc strip
  const ejectPort = new THREE.Object3D(); ejectPort.position.set(0.035, 0.03, 0.02); G.add(ejectPort);
  G.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return { group: G, muzzle, ejectPort, bolt, boltHome: bolt.position.clone(), mag, magHome: mag.position.clone(), scopeY, lens };
}
