// Third-person runners, one look per class:
//   SOLDIER  — tactical cyber-trooper: visored helmet, chest rig, shoulder pads, VX-9 rifle
//   ASSASSIN — slim, deep hood and mask with glowing eyes, long tattered cloak, VX-9 rifle
//   KNIGHT   — heavy plate, horned great helm, twin pauldrons, tabard + cloak, greatsword / shotgun
// Cloth reacts to wind and motion. Procedural walk / strafe / jump, idle breathing, hit flinches,
// sword swings, a collapse-and-dissolve death, shield bubble, x-ray ghost.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js';
import { buildRifle } from './gunmodel.js';
import { buildSword, buildShotgun, emberMaterial } from './classgear.js';

let shared = null;
function sharedAssets() {
  if (shared) return shared;
  const plate = TX.armorPlateMaps(256, [0.3, 0.29, 0.31]);
  const cloth = TX.clothMaps(256, [0.07, 0.065, 0.07]);
  const cape = TX.clothMaps(256, [0.06, 0.05, 0.055], true);
  shared = {
    plateMaps: plate, clothMaps: cloth, capeMaps: cape,
    leather: new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.72, metalness: 0 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xa47a2c, roughness: 0.32, metalness: 1, envMapIntensity: 2 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xcfd6e2, roughness: 0.1, metalness: 1, envMapIntensity: 2.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.6, metalness: 0.4 }),
    xray: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb6ff4a).multiplyScalar(1.5), transparent: true, opacity: 0.55, depthTest: false, depthWrite: false })
  };
  return shared;
}

const shieldShader = color => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, strength: { value: 0 } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 color; uniform float time; uniform float strength; varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){
      float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
      vec2 h = vec2(atan(vP.z, vP.x) * 6.0, vP.y * 12.0);
      vec2 g = abs(fract(h + vec2(0.0, time * 0.5)) - 0.5);
      float hex = smoothstep(0.42, 0.48, max(g.x, g.y));
      float scan = 0.5 + 0.5 * sin(vP.y * 20.0 - time * 6.0);
      float a = (f * 1.4 + hex * 0.35 * f + scan * 0.05) * strength;
      gl_FragColor = vec4(color * a * 2.5, 1.0);
    }`,
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});

function nameSprite(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '700 30px Rajdhani, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = color; x.shadowBlur = 10; x.fillStyle = '#ffffff'; x.fillText(name.toUpperCase(), 128, 30);
  x.fillStyle = color; x.fillRect(78, 52, 100, 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(1.3, 0.325, 1);
  return s;
}

/** Fresnel rim light in the runner's colour, injected into a standard material. */
function withRim(mat, rimColor, strength = 1) {
  const c = mat.clone();
  c.onBeforeCompile = sh => {
    sh.uniforms.rimColor = { value: rimColor.clone().multiplyScalar(strength) };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 rimColor;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += rimColor * pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );');
  };
  c.customProgramCacheKey = () => 'rim';
  return c;
}

/** Cloth that sways in the wind and streams back when running (vertex-shader animation). */
function clothMaterial(maps, tint, uniforms, { tattered = false, rimColor = null } = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, color: tint, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
    alphaMap: tattered ? maps.alphaMap : null, alphaTest: tattered ? 0.5 : 0
  });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uSpeed = uniforms.uSpeed;
    if (rimColor) sh.uniforms.rimColor = { value: rimColor.clone().multiplyScalar(0.5) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSpeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float hang = clamp(-position.y / 1.2, 0.0, 1.0);
        float wave = sin(uTime * 3.1 + position.x * 7.0 + hang * 5.0) * 0.035 + sin(uTime * 1.7 + hang * 3.0) * 0.025;
        transformed.z += hang * hang * (0.06 + uSpeed * 0.55) + wave * hang * (1.0 + uSpeed);
        transformed.y += hang * hang * uSpeed * 0.18;
        transformed.x += sin(uTime * 2.3 + hang * 4.0) * 0.015 * hang;`);
    if (rimColor) sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 rimColor;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += rimColor * pow( 1.0 - saturate( abs( dot( normal, normalize( vViewPosition ) ) ) ), 3.0 );');
  };
  m.customProgramCacheKey = () => 'cloth' + (tattered ? 't' : '') + (rimColor ? 'r' : '');
  return m;
}

export class Avatar {
  constructor(color, name, cls = 0) {
    const S = sharedAssets();
    this.cls = cls;
    const knight = cls === 2, assassin = cls === 1, soldier = !knight && !assassin;
    this.color = new THREE.Color(color);
    this.glow = new THREE.MeshBasicMaterial({ color: this.color.clone().multiplyScalar(3) });
    this.glowSoft = new THREE.MeshBasicMaterial({ color: this.color.clone().multiplyScalar(1.4) });
    this.uniforms = { uTime: { value: Math.random() * 10 }, uSpeed: { value: 0 } };
    const P = S.plateMaps;
    const plate = withRim(new THREE.MeshStandardMaterial({ map: P.map, normalMap: P.normalMap, roughnessMap: P.roughnessMap, metalnessMap: P.metalnessMap, roughness: 1, metalness: 1, envMapIntensity: 1.9 }), this.color, 0.55);
    const suit = withRim(new THREE.MeshStandardMaterial({ map: S.clothMaps.map, normalMap: S.clothMaps.normalMap, roughness: 0.95, metalness: 0 }), this.color, 0.3);
    const chrome = withRim(S.chrome, this.color, 0.5);
    const capeMat = clothMaterial(S.capeMaps, new THREE.Color(0xffffff), this.uniforms, { tattered: true, rimColor: this.color.clone().multiplyScalar(0.4) });
    const tabardMat = clothMaterial(S.clothMaps, this.color.clone().lerp(new THREE.Color(0x111111), 0.7), this.uniforms, { rimColor: this.color.clone().multiplyScalar(0.4) });
    this.ownMats = [plate, suit, chrome, capeMat, tabardMat];

    const g = this.group = new THREE.Group();
    this.body = new THREE.Group(); g.add(this.body); // rotated as a whole by the death animation
    this.frame = new THREE.Group(); this.body.add(this.frame); // class build (broad knight, slim assassin)
    if (knight) this.frame.scale.set(1.07, 1.04, 1.07); else if (assassin) this.frame.scale.set(0.92, 1.0, 0.92);
    const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
      m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    };
    const rbox = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
    const cyl = (r0, r1, h, s = 14, open = false) => new THREE.CylinderGeometry(r0, r1, h, s, 1, open);
    const dome = (r, scale) => { const geo = new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2); geo.scale(...scale); return geo; };

    // ---------------- hips, belt, tabard and legs
    this.hips = new THREE.Group(); this.hips.position.y = 0.95; this.frame.add(this.hips);
    add(this.hips, rbox(0.34, 0.16, 0.22, 0.05), suit);
    const belt = add(this.hips, cyl(0.2, 0.2, 0.055, 20, true), S.leather, 0, 0.05, 0); belt.scale.z = 0.66;
    add(this.hips, rbox(0.07, 0.06, 0.02, 0.01), S.gold, 0, 0.05, -0.135);
    add(this.hips, rbox(0.06, 0.07, 0.05, 0.01), S.leather, 0.17, 0.0, -0.02); // pouch
    if (knight) {
      const tabard = add(this.hips, new THREE.PlaneGeometry(0.22, 0.55, 2, 8).translate(0, -0.275, 0), tabardMat, 0, 0.02, -0.13);
      tabard.castShadow = false;
      const tabardBack = add(this.hips, new THREE.PlaneGeometry(0.26, 0.6, 2, 8).translate(0, -0.3, 0), tabardMat, 0, 0.02, 0.12, 0, Math.PI, 0);
      tabardBack.castShadow = false;
    } else if (soldier) {
      for (const sx of [-0.12, 0.12]) add(this.hips, rbox(0.08, 0.09, 0.05, 0.01), S.leather, sx, -0.02, -0.12); // thigh pouches
    } else {
      // assassin: a short split loincloth and a dagger at the small of the back
      const lc = add(this.hips, new THREE.PlaneGeometry(0.16, 0.4, 2, 6).translate(0, -0.2, 0), tabardMat, 0, 0.02, -0.12); lc.castShadow = false;
      add(this.hips, rbox(0.03, 0.03, 0.3, 0.008), S.dark, 0, 0.05, 0.14, 0, Math.PI / 2, 0.3);
      add(this.hips, new THREE.BoxGeometry(0.24, 0.006, 0.01), this.glow, 0, 0.05, 0.155, 0, 0, 0.3);
    }
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(side * 0.11, -0.05, 0); this.hips.add(hip);
      add(hip, cyl(0.085, 0.07, 0.44), suit, 0, -0.22, 0);
      if (knight) {
        add(hip, rbox(0.15, 0.2, 0.035, 0.012), plate, 0, -0.1, -0.085, 0.12);          // front tasset
        add(hip, rbox(0.035, 0.18, 0.13, 0.012), plate, side * 0.085, -0.09, 0, 0, 0, side * 0.12); // side tasset
      } else if (soldier) add(hip, rbox(0.11, 0.16, 0.03, 0.01), plate, 0, -0.14, -0.08, 0.1); // thigh plate
      const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
      add(knee, new THREE.SphereGeometry(0.07, 12, 8), plate, 0, 0, -0.03, 0, 0, 0, 1, 1, 0.8); // knee cop
      add(knee, rbox(0.05, 0.06, 0.012, 0.005), plate, side * 0.06, 0, -0.03, 0, side * 0.5, 0); // cop wing
      add(knee, cyl(0.07, 0.055, 0.42), suit, 0, -0.21, 0);
      if (assassin) { // wrapped shins and soft boots
        for (let i = 0; i < 4; i++) add(knee, cyl(0.062, 0.058, 0.03, 10), S.leather, 0, -0.08 - i * 0.07, 0);
        add(knee, rbox(0.1, 0.07, 0.22, 0.03), S.dark, 0, -0.44, -0.04);
      } else {
        add(knee, rbox(0.105, 0.32, 0.115, 0.04), plate, 0, -0.19, -0.015); // greave
        add(knee, rbox(0.12, 0.085, 0.25, 0.03), plate, 0, -0.435, -0.05);  // sabaton
      }
      add(knee, rbox(0.1, 0.03, 0.06, 0.012), plate, 0, -0.42, -0.165, 0.3);
      add(knee, rbox(0.012, 0.18, 0.01, 0.004), this.glow, side * 0.055, -0.19, -0.075); // neon inlay
      this.legs.push({ hip, knee });
    }

    // ---------------- torso (pitches with aim)
    this.torso = new THREE.Group(); this.torso.position.y = 0.06; this.hips.add(this.torso);
    add(this.torso, rbox(0.38, 0.44, 0.24, 0.06), suit, 0, 0.26, 0);
    for (let i = 0; i < 4; i++) add(this.torso, rbox(0.04, 0.035, 0.03, 0.008), this.glow, 0, 0.42 - i * 0.07, 0.155); // cyber spine
    const pauldron = (side, big) => { // overlapping lames, each a little wider and lower, with a gilded rim
      const lp = new THREE.Group(); lp.position.set(side * 0.26, 0.48, 0); lp.rotation.z = -side * 0.35; this.torso.add(lp);
      const k = big ? 1.12 : 1;
      add(lp, dome(0.15 * k, [1.25, 0.8, 1.15]), plate);
      add(lp, dome(0.15 * k, [1.32, 0.42, 1.2]), plate, side * 0.012, -0.04, 0, 0, 0, -side * 0.12);
      add(lp, dome(0.15 * k, [1.38, 0.32, 1.25]), plate, side * 0.024, -0.075, 0, 0, 0, -side * 0.24);
      add(lp, new THREE.TorusGeometry(0.19 * k, 0.008, 6, 24), S.gold, 0, 0.0, 0, Math.PI / 2, 0, 0, 1, 0.93, 1);
      if (big) for (const z of [-0.06, 0.06]) add(lp, new THREE.ConeGeometry(0.02, 0.09, 6), S.dark, side * 0.02, 0.12, z); // spikes
      return lp;
    };
    const chromeShoulder = () => {
      add(this.torso, new THREE.SphereGeometry(0.085, 14, 10), chrome, 0.25, 0.47, 0);
      add(this.torso, new THREE.TorusGeometry(0.09, 0.006, 6, 20), this.glow, 0.25, 0.47, 0, 0, Math.PI / 2, 0);
    };
    const cloak = (len, width) => { // tattered cloak hanging from the shoulders
      const capeGeo = new THREE.PlaneGeometry(width, len, 6, 14).translate(0, -len / 2, 0);
      const cp = capeGeo.attributes.position;
      for (let i = 0; i < cp.count; i++) { const hang = -cp.getY(i) / len; cp.setX(i, cp.getX(i) * (0.62 + 0.45 * hang)); cp.setZ(i, Math.abs(cp.getX(i)) * -0.25 * (1 - hang)); }
      capeGeo.computeVertexNormals();
      this.cape = add(this.torso, capeGeo, capeMat, 0, 0.5, 0.2, 0.06);
      this.cape.castShadow = false;
    };
    if (knight) {
      add(this.torso, rbox(0.46, 0.33, 0.18, 0.07), plate, 0, 0.33, -0.055, 0.06);           // breastplate
      add(this.torso, rbox(0.022, 0.27, 0.025, 0.008), plate, 0, 0.33, -0.147, 0.06);          // central ridge
      add(this.torso, new THREE.BoxGeometry(0.44, 0.012, 0.014), S.gold, 0, 0.175, -0.135);
      for (let i = 0; i < 3; i++) add(this.torso, rbox(0.37 - i * 0.02, 0.065, 0.21, 0.025), plate, 0, 0.14 - i * 0.055, -0.015); // faulds
      add(this.torso, rbox(0.42, 0.34, 0.08, 0.03), plate, 0, 0.32, 0.11);                     // backplate
      add(this.torso, cyl(0.12, 0.16, 0.09, 16), plate, 0, 0.53, 0);                          // gorget
      pauldron(-1, true); pauldron(1, true);
      cloak(1.2, 0.62);
    } else if (soldier) {
      add(this.torso, rbox(0.42, 0.3, 0.2, 0.05), plate, 0, 0.3, -0.03);                      // armoured vest
      for (const x of [-0.12, 0, 0.12]) add(this.torso, rbox(0.085, 0.1, 0.05, 0.012), S.leather, x, 0.22, -0.14); // mag pouches
      add(this.torso, new THREE.BoxGeometry(0.3, 0.012, 0.012), this.glow, 0, 0.42, -0.135);   // status strip
      add(this.torso, rbox(0.2, 0.26, 0.09, 0.03), S.dark, 0, 0.3, 0.14);                     // power pack
      add(this.torso, cyl(0.012, 0.012, 0.22, 8), this.glow, 0.07, 0.32, 0.19);
      add(this.torso, cyl(0.12, 0.15, 0.08, 16), suit, 0, 0.52, 0);                           // collar
      for (const side of [-1, 1]) add(this.torso, rbox(0.15, 0.08, 0.18, 0.035), plate, side * 0.26, 0.47, 0, 0, 0, -side * 0.35); // shoulder pads
    } else {
      add(this.torso, rbox(0.36, 0.3, 0.2, 0.06), S.leather, 0, 0.3, -0.03);                  // leather jerkin
      add(this.torso, new THREE.BoxGeometry(0.05, 0.5, 0.012), S.dark, 0, 0.3, -0.135, 0, 0, 0.6); // cross strap
      add(this.torso, new THREE.BoxGeometry(0.008, 0.46, 0.006), this.glow, 0, 0.3, -0.142, 0, 0, 0.6);
      add(this.torso, cyl(0.15, 0.24, 0.14, 18, true), suit, 0, 0.5, 0.02);                    // hood mantle / scarf
      chromeShoulder();
      add(this.torso, rbox(0.12, 0.1, 0.14, 0.04), suit, -0.25, 0.46, 0, 0, 0, 0.35);          // wrapped left shoulder
      cloak(1.45, 0.66);
    }

    // ---------------- head: hooded great helm with a neon visor slit
    this.head = new THREE.Group(); this.head.position.y = 0.58; this.torso.add(this.head);
    add(this.head, cyl(0.06, 0.07, 0.08), S.dark, 0, -0.04, 0);
    const hood = (deep) => add(this.head, new THREE.SphereGeometry(0.165, 18, 12, Math.PI * 1.72, Math.PI * 1.56, 0, Math.PI * (deep ? 0.68 : 0.6)), suit, 0, 0.075, deep ? 0.0 : 0.025, -0.15, 0, 0, deep ? 1.08 : 1.0, deep ? 1.2 : 1.1, deep ? 1.25 : 1.12);
    if (knight) { // horned great helm with a neon visor slit
      add(this.head, cyl(0.135, 0.145, 0.21, 18), plate, 0, 0.06, 0);
      add(this.head, dome(0.135, [1, 0.75, 1]), plate, 0, 0.165, 0);
      add(this.head, rbox(0.21, 0.18, 0.05, 0.02), plate, 0, 0.05, -0.125);                     // face plate
      add(this.head, rbox(0.02, 0.18, 0.03, 0.008), plate, 0, 0.06, -0.155);                    // nasal ridge
      add(this.head, new THREE.BoxGeometry(0.17, 0.012, 0.01), this.glow, 0, 0.085, -0.153);    // visor slit
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) add(this.head, new THREE.BoxGeometry(0.012, 0.004, 0.006), S.dark, s * (0.03 + i * 0.02), 0.01, -0.152); // breaths
      add(this.head, rbox(0.025, 0.06, 0.24, 0.01), S.gold, 0, 0.25, 0);                        // crest
      for (const s of [-1, 1]) { // curved horns
        const horn = new THREE.Group(); horn.position.set(s * 0.13, 0.15, 0); horn.rotation.z = -s * 0.9; this.head.add(horn);
        add(horn, new THREE.ConeGeometry(0.03, 0.2, 8), S.dark, 0, 0.1, 0);
        add(horn, new THREE.ConeGeometry(0.018, 0.12, 6), S.dark, 0, 0.24, 0.03, 0.5);
      }
    } else if (soldier) { // tactical helmet: rounded shell, wide visor band, rebreather
      add(this.head, dome(0.14, [1.05, 0.95, 1.1]), plate, 0, 0.07, 0.005);
      add(this.head, cyl(0.145, 0.145, 0.06, 20, true), plate, 0, 0.06, 0.005);
      add(this.head, rbox(0.2, 0.055, 0.04, 0.015), S.dark, 0, 0.075, -0.125);                  // visor housing
      add(this.head, new THREE.BoxGeometry(0.18, 0.026, 0.008), this.glow, 0, 0.075, -0.147);   // visor
      add(this.head, rbox(0.11, 0.08, 0.07, 0.025), S.dark, 0, -0.005, -0.1);                   // rebreather
      for (const s of [-1, 1]) add(this.head, cyl(0.025, 0.025, 0.03, 10), chrome, s * 0.065, -0.01, -0.11, Math.PI / 2, 0, 0);
      add(this.head, cyl(0.006, 0.006, 0.18, 6), S.dark, -0.1, 0.2, 0.06, 0.2);                 // antenna
      add(this.head, new THREE.SphereGeometry(0.01, 6, 4), this.glow, -0.1, 0.29, 0.08);
    } else { // assassin: cloth face mask under a deep hood, two glowing eyes
      add(this.head, new THREE.SphereGeometry(0.12, 16, 12), S.dark, 0, 0.07, 0, 0, 0, 0, 0.95, 1.08, 1.0);
      add(this.head, rbox(0.17, 0.09, 0.05, 0.02), suit, 0, 0.0, -0.1);                         // mask
      for (const s of [-1, 1]) add(this.head, new THREE.BoxGeometry(0.035, 0.01, 0.008), this.glow, s * 0.042, 0.085, -0.115, 0, 0, s * -0.25); // eyes
      hood(true);
    }
    add(this.head, cyl(0.012, 0.012, 0.05, 8), chrome, 0.14, 0.06, 0.02, 0, 0, Math.PI / 2);   // neural jack
    add(this.head, new THREE.SphereGeometry(0.008, 6, 4), this.glow, 0.168, 0.06, 0.02);

    // ---------------- arms + rifle
    this.armsG = new THREE.Group(); this.armsG.position.y = 0.42; this.torso.add(this.armsG);
    const arm = (side, upperRot, foreRot, cyber) => {
      const sh = new THREE.Group(); sh.position.set(side * 0.27, 0, 0); sh.rotation.set(...upperRot); this.armsG.add(sh);
      const skin = cyber ? chrome : suit;
      add(sh, cyl(0.058, 0.05, 0.3), skin, 0, -0.15, 0);
      if (cyber) for (const a of [0.8, -0.8]) add(sh, new THREE.BoxGeometry(0.004, 0.2, 0.004), this.glow, Math.sin(a) * 0.056, -0.15, Math.cos(a) * 0.056);
      const el = new THREE.Group(); el.position.y = -0.3; el.rotation.set(...foreRot); sh.add(el);
      add(el, new THREE.SphereGeometry(0.055, 10, 8), cyber ? chrome : plate);
      add(el, cyl(0.05, 0.045, 0.28), skin, 0, -0.14, 0);
      if (cyber) add(el, new THREE.TorusGeometry(0.05, 0.005, 6, 16), this.glow, 0, -0.06, 0, Math.PI / 2);
      else add(el, rbox(0.085, 0.2, 0.085, 0.025), plate, 0, -0.15, 0);  // vambrace
      add(el, rbox(0.075, 0.085, 0.095, 0.02), cyber ? chrome : plate, 0, -0.3, 0); // hand / gauntlet
      const hand = new THREE.Object3D(); hand.position.y = -0.3; el.add(hand);
      return { sh, el, hand };
    };
    this.rArm = arm(1, [1.05, 0, -0.12], [0.55, 0, 0], true);
    this.lArm = arm(-1, [1.3, 0, 0.55], [0.3, 0, 0], false);
    // arm poses: holding a long gun, or the greatsword raised in a guard
    this.poses = {
      gun: { r: [1.05, 0, -0.12, 0.55], l: [1.3, 0, 0.55, 0.3] },
      sword: { r: [0.5, 0, -0.55, 0.7], l: [0.25, 0, 0.25, 0.5] }
    };
    if (knight) {
      this.ember = emberMaterial(2.4);
      const sw = buildSword({ glow: this.ember, lite: true });
      this.sword = sw.group; this.sword.position.set(0, -0.03, 0); this.sword.rotation.set(-Math.PI / 2 - 0.55, 0, 0.7);
      this.rArm.hand.add(this.sword);
      const sg = buildShotgun({ glow: this.ember, lite: true });
      this.shotgun = sg.group; this.shotgun.position.set(0.08, -0.2, -0.3); this.armsG.add(this.shotgun);
      this.sgMuzzle = sg.muzzle;
      this.shotgun.visible = false;
      this.muzzle = sg.muzzle;
      this.setPose('sword');
    } else {
      const rifle = buildRifle({ energy: this.glow, lite: true });
      this.rifle = rifle.group; this.rifle.position.set(0.08, -0.2, -0.3); this.armsG.add(this.rifle);
      this.muzzle = rifle.muzzle;
    }
    this.armsG.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.gunMode = !knight; this.swingT = -1; this.swingSide = 1;

    // shield bubble, x-ray ghost, name tag
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), shieldShader(this.color));
    this.shield.scale.set(0.75, 1.1, 0.75); this.shield.position.y = 0.95; this.shield.visible = false; g.add(this.shield);
    this.ghost = new THREE.Group();
    const gb = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 10), S.xray); gb.position.y = 0.85; this.ghost.add(gb);
    const gh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), S.xray); gh.position.y = 1.6; this.ghost.add(gh);
    this.ghost.traverse(o => { o.renderOrder = 999; }); this.ghost.visible = false; g.add(this.ghost);
    this.tag = nameSprite(name, '#' + this.color.getHexString()); this.tag.position.y = 2.15; g.add(this.tag);

    this.walkPhase = 0; this.moveBlend = 0; this.airBlend = 0; this.shieldK = 0; this.time = 0;
    this.speed = 0; this.flinchT = 0; this.flinchSide = 0; this.deathT = -1; this.wasAlive = true;
    this.onDissolve = null; // set by the game to spawn embers when a body dissolves
  }

  setPose(name) {
    const P = this.poses[name];
    this.rArm.sh.rotation.set(P.r[0], P.r[1], P.r[2]); this.rArm.el.rotation.x = P.r[3];
    this.lArm.sh.rotation.set(P.l[0], P.l[1], P.l[2]); this.lArm.el.rotation.x = P.l[3];
    this.pose = name;
  }
  /** Knight: switch between greatsword (false) and shotgun (true). */
  setShotgun(on) {
    if (this.cls !== 2 || this.gunMode === on) return;
    this.gunMode = on; this.sword.visible = !on; this.shotgun.visible = on;
    this.setPose(on ? 'gun' : 'sword');
  }
  /** Greatsword swing (third person). */
  swing() { this.swingT = 0; this.swingSide = -this.swingSide; }

  /** Small hit reaction; dir is the shot direction in world space (optional). */
  flinch(dir) {
    this.flinchT = 1;
    if (dir) { const sy = Math.sin(this.group.rotation.y), cy = Math.cos(this.group.rotation.y); this.flinchSide = Math.sign(dir.x * cy - dir.z * sy) || 1; }
  }

  /** st: { x,y,z, yaw, pitch, vx, vz, og, alive, shield, protect, dash } */
  update(dt, st) {
    this.time += dt;
    const g = this.group;
    g.position.set(st.x, st.y, st.z);

    // ---- death: buckle at the knees, topple forward, then dissolve into embers
    if (!st.alive) {
      if (this.wasAlive) { this.deathT = 0; this.wasAlive = false; }
      if (this.deathT >= 0) {
        this.deathT += dt;
        const k1 = Math.min(1, this.deathT / 0.35), k2 = Math.min(1, Math.max(0, (this.deathT - 0.3) / 0.55));
        const e1 = k1 * k1 * (3 - 2 * k1), e2 = k2 * k2;
        for (const L of this.legs) { L.hip.rotation.x = 1.25 * e1; L.knee.rotation.x = -2.0 * e1; }
        this.hips.position.y = 0.95 - 0.45 * e1;
        this.torso.rotation.x = -0.5 * e1;
        this.armsG.rotation.x = -0.6 * e1;
        this.body.rotation.x = -1.35 * e2;
        this.body.position.z = -0.55 * e2;
        this.uniforms.uSpeed.value = 0.3 * e2;
        if (this.deathT > 1.05) {
          if (this.onDissolve) this.onDissolve(new THREE.Vector3(st.x, st.y + 0.3, st.z - 0.5), this.color);
          this.deathT = -1; g.visible = false;
        } else g.visible = true;
      } else g.visible = false;
      this.uniforms.uTime.value += dt;
      return;
    }
    if (!this.wasAlive) { // respawned: reset the pose
      this.wasAlive = true; this.body.rotation.set(0, 0, 0); this.body.position.set(0, 0, 0); this.deathT = -1;
    }
    g.visible = true;
    g.rotation.y = st.yaw;

    // local velocity relative to facing
    const sy = Math.sin(st.yaw), cy = Math.cos(st.yaw);
    const fwd = -(st.vx * sy + st.vz * cy), side = st.vx * cy - st.vz * sy;
    const speed = Math.hypot(st.vx, st.vz);
    this.speed = speed;
    this.moveBlend += ((st.og ? Math.min(1, speed / 6) : 0) - this.moveBlend) * (1 - Math.exp(-dt * 10));
    this.airBlend += ((st.og ? 0 : 1) - this.airBlend) * (1 - Math.exp(-dt * 10));
    const dir = fwd >= -0.3 ? 1 : -1;
    this.walkPhase += dt * speed * 1.55 * dir;
    const p = this.walkPhase, k = this.moveBlend;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], ph = p + i * Math.PI;
      L.hip.rotation.x = Math.sin(ph) * 0.65 * k + this.airBlend * (i ? 0.7 : 0.3);
      L.hip.rotation.z = THREE.MathUtils.clamp(side / 6, -1, 1) * 0.15 * k * (i ? 1 : -1);
      L.knee.rotation.x = -(Math.max(0, Math.sin(ph + 1.3)) * 0.9 * k + this.airBlend * (i ? 1.2 : 0.6));
    }
    const breathe = Math.sin(this.time * 1.9) * 0.006 * (1 - k);
    this.flinchT = Math.max(0, this.flinchT - dt * 5);
    const fl = this.flinchT * this.flinchT;
    this.hips.position.y = 0.95 - Math.abs(Math.cos(p)) * 0.04 * k - this.airBlend * 0.05;
    this.hips.rotation.y = Math.sin(p) * 0.08 * k;
    this.torso.position.y = 0.06 + breathe;
    this.torso.rotation.y = -Math.sin(p) * 0.1 * k + fl * 0.25 * this.flinchSide;
    this.torso.rotation.z = -THREE.MathUtils.clamp(side / 6, -1, 1) * 0.06 + fl * 0.12 * this.flinchSide;
    this.torso.rotation.x = st.pitch * 0.55 - 0.05 * k - (st.dash ? 0.25 : 0) + fl * 0.25;
    this.head.rotation.x = st.pitch * 0.35 - fl * 0.2;
    this.armsG.rotation.x = st.pitch * 0.45; // arms + rifle carry the rest of the aim pitch
    if (this.cls === 2) this.setShotgun(!!st.shotgun);
    if (this.swingT >= 0) { // raise, cut across, recover
      this.swingT += dt / 0.5;
      const t = Math.min(1, this.swingT), up = Math.sin(Math.min(1, t / 0.25) * Math.PI / 2) * (1 - Math.min(1, Math.max(0, (t - 0.25) / 0.15)));
      const cut = Math.min(1, Math.max(0, (t - 0.22) / 0.15)) * (1 - Math.min(1, Math.max(0, (t - 0.5) / 0.5)));
      const P = this.poses.sword.r;
      this.rArm.sh.rotation.set(P[0] + up * 1.6 - cut * 0.5, P[1] + cut * 0.6 * this.swingSide, P[2] - up * 0.4 * this.swingSide + cut * 0.7 * this.swingSide);
      this.rArm.el.rotation.x = P[3] - up * 0.5 + cut * 0.3;
      this.torso.rotation.y += cut * 0.45 * this.swingSide - up * 0.2 * this.swingSide;
      if (this.swingT >= 1) { this.swingT = -1; this.setPose('sword'); }
    }
    // cloth streams back with speed (forward motion only) and flutters in the wind
    const capeTarget = Math.min(1, Math.max(0, fwd) / 6 + Math.abs(side) / 12) + (st.dash ? 0.8 : 0) + this.airBlend * 0.4;
    this.uniforms.uSpeed.value += (capeTarget - this.uniforms.uSpeed.value) * (1 - Math.exp(-dt * 4));
    this.uniforms.uTime.value += dt;
    // shield
    this.shieldK += ((st.shield ? 1 : 0) - this.shieldK) * (1 - Math.exp(-dt * 8));
    this.shield.visible = this.shieldK > 0.02;
    this.shield.material.uniforms.strength.value = this.shieldK;
    this.shield.material.uniforms.time.value = this.time;
    // spawn protection shimmer
    const prot = st.protect ? 0.5 + 0.5 * Math.sin(this.time * 18) : 1;
    this.glow.color.copy(this.color).multiplyScalar(3 * prot + (st.protect ? 1 : 0) + fl * 3);
    if (this.ember) this.ember.color.setRGB(2.4, 0.86, 0.29).multiplyScalar(1 + Math.sin(this.time * 4) * 0.12 + (this.surge = Math.max(0, (this.surge || 0) - dt * 1.5)) * 2);
  }
  /** Ember flare when the sword transforms. */
  flare() { this.surge = 1; }
  muzzleWorld(out = new THREE.Vector3()) { this.group.updateMatrixWorld(true); return this.muzzle.getWorldPosition(out); }
  setXray(on) { this.ghost.visible = on; }
  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.glow.dispose(); this.glowSoft.dispose(); this.ownMats.forEach(m => m.dispose()); if (this.ember) this.ember.dispose();
    this.shield.material.dispose(); this.tag.material.map.dispose(); this.tag.material.dispose();
  }
}
