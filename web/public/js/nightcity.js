// Back-alley set dressing: grim spray-paint graffiti, flickering vending machines, piles of
// trash along the walls, a homeless camp, dying vertical neon signs and glitching corporate
// holo-ads looming over the alley. All brands and slogans are original.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './textures.js';

const Sim = window.NeonSim;
const HX = Sim.HALF_X, HZ = Sim.HALF_Z;

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ graffiti
const TAGS = ['NO FUTURE', 'NOBODY IS COMING', 'DEBT = DEATH', 'THEY SELL YOUR LUNGS', 'RIP JAX', 'ORGANS 4 CREDS', 'DONT BREATHE', 'WE ARE THE TRASH', 'FLATLINE', 'EAT THE RICH', 'GHOST', 'RUN'];
const SPRAY = ['#ff2fb9', '#00f5ff', '#ffe600', '#b6ff4a', '#ff5a3c', '#ffffff', '#8a5cff'];
function graffitiTexture(rand, text) {
  return canvasTex(1024, 384, (x, w, h) => {
    const c1 = SPRAY[(rand() * SPRAY.length) | 0], c2 = SPRAY[(rand() * SPRAY.length) | 0];
    // background "throw-up" blobs
    for (let i = 0; i < 26; i++) {
      x.globalAlpha = 0.18 + rand() * 0.25; x.fillStyle = rand() > 0.5 ? c2 : '#111';
      x.beginPath(); x.ellipse(w * (0.15 + rand() * 0.7), h * (0.3 + rand() * 0.4), 30 + rand() * 120, 20 + rand() * 60, rand() * 3, 0, 6.3); x.fill();
    }
    x.globalAlpha = 1;
    // main tag: chunky outlined letters with a soft overspray halo
    x.save(); x.translate(w / 2, h / 2); x.rotate((rand() - 0.5) * 0.18);
    let fs = 170; x.font = `900 ${fs}px Impact, "Arial Black", sans-serif`;
    const tw = x.measureText(text).width; if (tw > w * 0.9) { fs *= w * 0.9 / tw; x.font = `900 ${fs}px Impact, "Arial Black", sans-serif`; }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = c1; x.shadowBlur = 28; x.lineJoin = 'round';
    x.strokeStyle = '#0a0a0a'; x.lineWidth = 26; x.strokeText(text, 0, 0);
    x.shadowBlur = 0; x.strokeStyle = c2; x.lineWidth = 12; x.strokeText(text, 0, 0);
    const g = x.createLinearGradient(0, -fs / 2, 0, fs / 2); g.addColorStop(0, '#fff'); g.addColorStop(0.35, c1); g.addColorStop(1, c1);
    x.fillStyle = g; x.fillText(text, 0, 0);
    // paint drips
    x.fillStyle = c1;
    for (let i = 0; i < 14; i++) { const dx = (rand() - 0.5) * tw * 0.9, len = 20 + rand() * 90; x.fillRect(dx, fs * 0.3, 4 + rand() * 4, len); x.beginPath(); x.arc(dx + 3, fs * 0.3 + len, 5, 0, 6.3); x.fill(); }
    x.restore();
    // speckled overspray
    for (let i = 0; i < 1500; i++) { x.globalAlpha = rand() * 0.5; x.fillStyle = rand() > 0.5 ? c1 : c2; x.fillRect(rand() * w, rand() * h, 2, 2); }
  });
}

// ------------------------------------------------------------------ vending machine front
function vendingTexture(brand, color) {
  return canvasTex(256, 448, (x, w, h) => {
    x.fillStyle = '#05070c'; x.fillRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 0, 0, 110); g.addColorStop(0, color); g.addColorStop(1, '#000');
    x.fillStyle = g; x.fillRect(10, 10, w - 20, 100);
    x.fillStyle = '#fff'; x.font = '800 40px Orbitron, Arial'; x.textAlign = 'center'; x.shadowColor = color; x.shadowBlur = 16;
    x.fillText(brand, w / 2, 62); x.font = '600 18px Rajdhani, Arial'; x.fillText('ICE COLD · 24/7 · ¥200', w / 2, 92);
    x.shadowBlur = 0;
    // product window with rows of cans
    x.fillStyle = '#0c1422'; x.fillRect(16, 124, w - 72, 270);
    const cols = ['#ff2f4f', '#00e5ff', '#ffd400', '#b6ff4a', '#ff7ad9', '#ffffff'];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      const cx = 30 + c * 34, cy = 138 + r * 52;
      x.fillStyle = cols[(r * 2 + c) % cols.length]; x.fillRect(cx, cy, 22, 38);
      x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(cx + 3, cy + 3, 4, 32);
      x.fillStyle = '#ff2fb9'; x.fillRect(cx - 4, cy + 42, 30, 3);
    }
    // keypad + coin slot
    x.fillStyle = '#1a2233'; x.fillRect(w - 50, 124, 34, 270);
    for (let i = 0; i < 12; i++) { x.fillStyle = i % 4 ? '#00e5ff' : '#ff2f4f'; x.fillRect(w - 44 + (i % 3) * 9, 140 + ((i / 3) | 0) * 14, 6, 8); }
    x.fillStyle = '#000'; x.fillRect(20, h - 44, w - 40, 30);
    x.fillStyle = color; x.fillRect(20, h - 46, w - 40, 3);
  });
}

// ------------------------------------------------------------------ vertical neon sign
function verticalSignTexture(chars, color) {
  return canvasTex(160, 160 * chars.length + 40, (x, w, h) => {
    x.fillStyle = 'rgba(8,4,14,0.92)'; x.fillRect(0, 0, w, h);
    x.strokeStyle = color; x.lineWidth = 6; x.shadowColor = color; x.shadowBlur = 18; x.strokeRect(8, 8, w - 16, h - 16);
    x.font = `700 118px "Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    [...chars].forEach((ch, i) => {
      x.shadowBlur = 24; x.fillStyle = color; x.fillText(ch, w / 2, 100 + i * 160);
      x.shadowBlur = 4; x.fillStyle = '#fff'; x.globalAlpha = 0.85; x.fillText(ch, w / 2, 100 + i * 160); x.globalAlpha = 1;
    });
  });
}

// ------------------------------------------------------------------ animated holo-ad
const ADS = [
  { title: 'HELIX BIOWARE', sub: 'WE BUY ORGANS · CASH TODAY · 臓器', color: '#00f5ff' },
  { title: 'PURE AIR+', sub: 'BREATHE PREMIUM · 1 HOUR ¥900', color: '#b6ff4a' },
  { title: 'DEBTLOCK', sub: 'YOUR DEBT · YOUR CHILDREN · FOREVER', color: '#ff3b3b' },
  { title: 'ORBITAL AIR', sub: 'LEAVE THE CITY · IF YOU CAN AFFORD IT', color: '#ffd400' },
  { title: 'SYNAPSE+', sub: 'FORGET EVERYTHING · 忘れて', color: '#ff2fb9' },
  { title: 'MOKU RAMEN', sub: 'REAL MEAT* · *MOSTLY · 24H', color: '#ff5a3c' }
];
function adMaterial(ad, seed) {
  const map = canvasTex(1024, 512, (x, w, h) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    const g = x.createRadialGradient(w * 0.3, h * 0.45, 20, w * 0.3, h * 0.45, 420); g.addColorStop(0, ad.color); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalAlpha = 0.45; x.fillStyle = g; x.fillRect(0, 0, w, h); x.globalAlpha = 1;
    // abstract product shape
    x.strokeStyle = '#fff'; x.lineWidth = 6; x.shadowColor = ad.color; x.shadowBlur = 30;
    x.beginPath(); x.arc(w * 0.22, h * 0.48, 120, 0, 6.3); x.stroke();
    x.beginPath(); x.arc(w * 0.22, h * 0.48, 70 + (seed % 3) * 12, 0, 6.3); x.stroke();
    let fs = 120; x.font = `800 ${fs}px Orbitron, Arial`;
    const tw = x.measureText(ad.title).width, maxW = w * 0.56; if (tw > maxW) { fs *= maxW / tw; x.font = `800 ${fs}px Orbitron, Arial`; }
    x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.shadowBlur = 24; x.fillText(ad.title, w * 0.42, h * 0.42);
    x.font = '600 34px Rajdhani, "Noto Sans CJK JP", Arial'; x.fillStyle = ad.color; x.shadowBlur = 12; x.fillText(ad.sub, w * 0.42, h * 0.62);
    x.fillStyle = ad.color; x.fillRect(w * 0.42, h * 0.72, w * 0.5, 6);
  });
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, time: { value: seed * 3.1 }, color: { value: new THREE.Color(ad.color) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float time; uniform vec3 color; varying vec2 vUv;
      float h(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        vec2 uv = vUv;
        float slot = floor(time * 4.0);
        float glitch = step(0.93, h(slot)) * step(0.5, h(floor(uv.y * 30.0) + slot));
        uv.x += glitch * (h(slot + uv.y) - 0.5) * 0.08;
        vec3 c = texture2D(map, uv).rgb;
        c.r = texture2D(map, uv + vec2(0.004 * (1.0 + glitch * 4.0), 0.0)).r;
        float scan = 0.82 + 0.18 * sin(uv.y * 600.0 + time * 10.0);
        float flick = 0.85 + 0.15 * step(0.2, h(floor(time * 15.0)));
        float sweep = smoothstep(0.0, 0.03, abs(fract(uv.x - time * 0.12) - 0.5)) * 0.25 + 0.75;
        vec3 outc = c * scan * flick * sweep * 1.5 + color * 0.03;
        float edge = 1.0 - step(0.008, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
        gl_FragColor = vec4(outc + color * edge * 3.0, 1.0);
      }`,
    side: THREE.DoubleSide, fog: false
  });
}

// ------------------------------------------------------------------ build
export function addNightCity(root, Q) {
  const rand = mulberry32(2077);
  const updaters = [];
  const decalMat = map => new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3 });

  // graffiti on the building fronts (only where nothing is standing in front of it)
  let gi = 0;
  for (let z = -HZ + 3; z < HZ - 2; z += 5 + rand() * 5) {
    const s = rand() < 0.5 ? -1 : 1, x = s * (HX - 0.012);
    if (!Sim.isFree(x - s * 0.5, 0, z) || !Sim.isFree(x - s * 0.5, 0, z + 2.2) || !Sim.isFree(x - s * 0.5, 0, z - 2.2)) continue;
    const w = 3.4 + rand() * 1.6;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.375), decalMat(graffitiTexture(rand, TAGS[gi++ % TAGS.length])));
    m.position.set(x, 1.3 + rand() * 0.8, z); m.rotation.y = -s * Math.PI / 2; m.receiveShadow = true; root.add(m);
  }
  // spray paint on the bus and the barriers
  for (const b of Sim.boxes) {
    if (b.kind !== 'bus' && !(b.kind === 'barrier' && rand() < 0.6)) continue;
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, alongZ = b.max[2] - b.min[2] > b.max[0] - b.min[0];
    const L = alongZ ? b.max[2] - b.min[2] : b.max[0] - b.min[0], W = alongZ ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
    for (const s of [-1, 1]) {
      const w = Math.min(L * 0.7, 4), m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.375), decalMat(graffitiTexture(rand, TAGS[gi++ % TAGS.length])));
      const off = (b.kind === 'bus' ? W / 2 + 0.01 : W * 0.35 + 0.012) * s, y = b.kind === 'bus' ? 1.0 : 0.55;
      if (alongZ) { m.position.set(cx + off, y, cz); m.rotation.y = s * Math.PI / 2; } else { m.position.set(cx, y, cz + off); m.rotation.y = s > 0 ? 0 : Math.PI; }
      m.scale.setScalar(b.kind === 'bus' ? 1 : 0.32); root.add(m);
    }
  }

  // vending machines (colliders live in shared/sim.js); one is smashed and dark
  const brands = [['VOLTA COLA', '#ff2f4f'], ['SYNTHI-POP', '#00e5ff'], ['KAZE TEA', '#b6ff4a'], ['NOVA ENERGY', '#ffd400']];
  const shell = new THREE.MeshStandardMaterial({ color: 0x1d2330, roughness: 0.45, metalness: 0.8, envMapIntensity: 1.2 });
  let vi = 0;
  for (const b of Sim.boxes) {
    if (b.kind !== 'vending') continue;
    const [brand, col] = brands[vi++ % brands.length];
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, sy = b.max[1];
    const front = Math.abs(b.dir[0]) ? b.max[2] - b.min[2] : b.max[0] - b.min[0], depth = Math.abs(b.dir[0]) ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
    const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = Math.atan2(b.dir[0], b.dir[1]); root.add(g);
    const body = new THREE.Mesh(new THREE.BoxGeometry(front, sy, depth), shell); body.position.y = sy / 2; body.castShadow = body.receiveShadow = true; g.add(body);
    const broken = vi % 2 === 0;
    const fm = new THREE.MeshBasicMaterial({ map: vendingTexture(brand, col), color: new THREE.Color(1.4, 1.4, 1.4) });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(front - 0.1, sy - 0.15), fm);
    panel.position.set(0, sy / 2, depth / 2 + 0.006); g.add(panel);
    const ph = vi * 3.7;
    updaters.push(t => { const f = broken ? (Math.sin(t * 47 + ph) > 0.7 ? 0.9 : 0.08) : (Math.sin(t * 31 + ph) > 0.992 ? 0.3 : 1); fm.color.setScalar(1.4 * f); });
  }

  // trash everywhere: bags, soggy boxes, newspapers piled against the walls
  const bagMat = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15 });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 0.95, metalness: 0 });
  const paperMat = new THREE.MeshStandardMaterial({ color: 0x6a665c, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  const bagGeos = [], boxGeos = [], paperGeos = [];
  for (let z = -HZ - 4; z < HZ + 4; z += 2.2 + rand() * 3) {
    const s = rand() < 0.5 ? -1 : 1, x = s * (HX - 0.55);
    if (!Sim.isFree(x, 0, z)) continue;
    for (let i = 0; i < 2 + (rand() * 4 | 0); i++) {
      const g = new THREE.SphereGeometry(0.26 + rand() * 0.14, 10, 8);
      g.scale(1, 0.6 + rand() * 0.25, 0.9); g.rotateY(rand() * 3);
      g.translate(x + (rand() - 0.5) * 0.7, 0.18, z + (rand() - 0.5) * 1.2); bagGeos.push(g);
    }
    if (rand() < 0.6) { const sz = 0.3 + rand() * 0.3, g = new THREE.BoxGeometry(sz, sz * 0.7, sz); g.rotateY(rand() * 3); g.rotateZ((rand() - 0.5) * 0.4); g.translate(x - s * 0.3, sz * 0.33, z + (rand() - 0.5)); boxGeos.push(g); }
  }
  for (let i = 0; i < 70; i++) { // loose wet paper in the street
    const x = (rand() - 0.5) * 2 * (HX - 1), z = (rand() - 0.5) * 2 * HZ;
    if (!Sim.isFree(x, 0, z)) continue;
    const g = new THREE.PlaneGeometry(0.3 + rand() * 0.2, 0.22 + rand() * 0.15); g.rotateX(-Math.PI / 2); g.rotateY(rand() * 6); g.translate(x, 0.008, z); paperGeos.push(g);
  }
  const strip = gs => mergeGeometries(gs.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g.toNonIndexed(); }), false);
  const bags = new THREE.Mesh(strip(bagGeos), bagMat); bags.castShadow = bags.receiveShadow = true; root.add(bags);
  const cboxes = new THREE.Mesh(strip(boxGeos), boxMat); cboxes.castShadow = cboxes.receiveShadow = true; root.add(cboxes);
  if (paperGeos.length) { const papers = new THREE.Mesh(strip(paperGeos), paperMat); papers.receiveShadow = true; root.add(papers); }

  // homeless camp around the shacks: soaked mattresses, a tarp lean-to, shopping cart
  const mattressMat = new THREE.MeshStandardMaterial({ color: 0x5c5444, roughness: 0.95, metalness: 0 });
  const tarpMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  const cartMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.35, metalness: 0.9, wireframe: true });
  for (const b of Sim.boxes) {
    if (b.kind !== 'shack') continue;
    const s = b.side, cz = (b.min[2] + b.max[2]) / 2, wallX = s * (HX - 0.05);
    for (const [dz, rot] of [[-3.2, 0.2], [3.4, -0.1]]) {
      if (!Sim.isFree(s * (HX - 1.2), 0, cz + dz)) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 1.9), mattressMat); m.position.set(s * (HX - 0.9), 0.08, cz + dz); m.rotation.y = rot; m.receiveShadow = true; root.add(m);
    }
    const lean = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.0), tarpMat); lean.position.set(wallX - s * 0.6, 1.0, cz - 3.2); lean.rotation.set(0, Math.PI / 2, s * 0.5); root.add(lean);
    const cart = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.85, 3, 3, 4), cartMat); cart.position.set(s * (HX - 2.6), 0.55, cz + 3.0); cart.rotation.y = 0.4; root.add(cart);
  }

  // vertical neon signs stacked high on the fronts, sticking out so they read down the alley (several dying)
  const vSigns = [['ホテル', '#ff2fb9', -1, -40], ['バー', '#00f5ff', 1, -26], ['質屋', '#ffd400', -1, -12], ['診療所', '#b6ff4a', 1, 3],
    ['ラーメン', '#ff5a3c', -1, 18], ['夜', '#8a5cff', 1, 33], ['クラブ', '#ff2fb9', -1, 47]];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x111318, metalness: 0.9, roughness: 0.4 });
  vSigns.forEach(([txt, col, s, z], i) => {
    const h = 1.0 * [...txt].length + 0.3, y = 8 + (i % 3) * 1.5 + h / 2, x = s * (HX - 0.9);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, h), new THREE.MeshBasicMaterial({ map: verticalSignTexture(txt, col), color: new THREE.Color(1.8, 1.8, 1.8), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = Math.PI / 2; root.add(m);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.06), poleMat); arm.position.set(s * (HX - 0.5), y + h / 2 - 0.2, z); root.add(arm);
    const dying = i % 3 === 0;
    updaters.push(t => { m.material.color.setScalar(dying ? (Math.sin(t * 23 + i) > 0.3 ? 1.8 : 0.1) : Math.sin(t * 17 + i * 4) > 0.985 ? 0.4 : 1.8); });
  });

  // corporate holo-ads looming over the alley from the upper floors, plus one at each far end
  const adSpots = [[-1, -30, 17], [1, -6, 19], [-1, 22, 16], [1, 42, 18]].map(([s, z, y]) => ({ x: s * (HX - 0.3), y, z, ry: -s * Math.PI / 2, w: 11 }));
  adSpots.push({ x: 0, y: 20, z: -HZ - 28, ry: 0, w: 16 }, { x: 0, y: 20, z: HZ + 28, ry: Math.PI, w: 16 });
  adSpots.forEach((a, i) => {
    const ad = new THREE.Mesh(new THREE.PlaneGeometry(a.w, a.w / 2), adMaterial(ADS[i % ADS.length], i));
    ad.position.set(a.x, a.y, a.z); ad.rotation.y = a.ry; root.add(ad);
    updaters.push((t, dt) => { ad.material.uniforms.time.value += dt; });
  });

  return { update(t, dt) { for (const u of updaters) u(t, dt); } };
}
