// Arena construction: PBR materials, lighting + shadows, planar floor reflections,
// height fog, volumetric light shafts, ground mist, rain, skyline and detailed props.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import * as TX from './textures.js';
import { addNightCity } from './nightcity.js';

const Sim = window.NeonSim;

// ------------------------------------------------------------------ height fog
// Replace three.js' distance fog with distance + exponential height fog so the
// arena floor sits in a dense, low-lying layer of mist.
export function installHeightFog() {
  THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vFogWorldPos;\n#endif';
  THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vFogWorldPos = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );\n#endif';
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
 uniform vec3 fogColor;
 varying float vFogDepth;
 varying vec3 vFogWorldPos;
 #ifdef FOG_EXP2
  uniform float fogDensity;
 #else
  uniform float fogNear;
  uniform float fogFar;
 #endif
 const float FOG_H_DENS = 0.075;
 const float FOG_H_FALL = 0.42;
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
 #ifdef FOG_EXP2
  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
 #else
  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
 #endif
 float fogDist = length( vFogWorldPos - cameraPosition );
 float fdy = vFogWorldPos.y - cameraPosition.y;
 float fhc = exp( - FOG_H_FALL * max( cameraPosition.y, 0.0 ) );
 float fhp = exp( - FOG_H_FALL * max( vFogWorldPos.y, 0.0 ) );
 float fhInt = abs( fdy ) > 0.01 ? ( fhc - fhp ) / ( FOG_H_FALL * fdy ) : fhc;
 float hFog = 1.0 - exp( - FOG_H_DENS * fogDist * fhInt );
 fogFactor = clamp( fogFactor + hFog * ( 1.0 - fogFactor ), 0.0, 1.0 );
 gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

// ------------------------------------------------------------------ static batching
// All static geometry is merged per material to keep draw calls low.
class StaticBatcher {
  constructor() { this.buckets = new Map(); }
  add(geometry, material, matrix, { cast = true, receive = true } = {}) {
    const g = geometry.index ? geometry.clone() : geometry.clone();
    g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const key = material.uuid + (cast ? 'c' : '') + (receive ? 'r' : '');
    if (!this.buckets.has(key)) this.buckets.set(key, { material, cast, receive, geos: [] });
    this.buckets.get(key).geos.push(g.index ? g.toNonIndexed() : g);
  }
  box(material, cx, cy, cz, sx, sy, sz, opts = {}, tile = 2, rotY = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1));
    this.add(TX.worldUVBox(sx, sy, sz, tile), material, m, opts);
  }
  flush(parent) {
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      b.geos.forEach(g => g.dispose());
    }
    this.buckets.clear();
  }
}
const M4 = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));

// ------------------------------------------------------------------ neon sign texture
function signTexture(text, color, { w = 1024, h = 256, font = 'Orbitron', sub = '' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let fs = h * (sub ? 0.46 : 0.58);
  ctx.font = `800 ${fs}px ${font}, Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  if (tw > w * 0.86) { fs *= w * 0.86 / tw; ctx.font = `800 ${fs}px ${font}, Arial, sans-serif`; }
  for (const [blur, alpha] of [[40, 0.5], [18, 0.8], [4, 1]]) {
    ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.globalAlpha = alpha;
    ctx.strokeStyle = color; ctx.lineWidth = h * 0.035; ctx.strokeText(text, w / 2, h * (sub ? 0.42 : 0.5));
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 6; ctx.fillStyle = '#ffffff';
  ctx.fillText(text, w / 2, h * (sub ? 0.42 : 0.5));
  if (sub) { ctx.font = `600 ${h * 0.16}px Rajdhani, Arial`; ctx.shadowBlur = 12; ctx.fillStyle = color; ctx.fillText(sub, w / 2, h * 0.82); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ shaders
const lightShaftMaterial = color => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, intensity: { value: 0.55 } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying float vA; varying vec3 vW;
    void main(){ vA = uv.y; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vV = -mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 color; uniform float time; uniform float intensity; varying vec3 vN; varying vec3 vV; varying float vA; varying vec3 vW;
    float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
    float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
    void main(){
      float rim = abs(dot(normalize(vN), normalize(vV)));
      rim = pow(rim, 2.5);
      float along = pow(vA, 1.6);
      float dust = 0.65 + 0.7 * n3(vW * 0.6 + vec3(0.0, -time * 0.4, time * 0.2));
      float a = rim * along * dust * intensity;
      float camFade = smoothstep(0.5, 4.0, length(vV));
      gl_FragColor = vec4(color * a * camFade, 1.0);
    }`,
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});

const mistMaterial = (height, tint) => new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 }, tint: { value: new THREE.Color(tint) }, layerY: { value: height }, bounds: { value: new THREE.Vector2(Sim.HALF_X + 3, Sim.HALF_Z + 26) } },
  vertexShader: `varying vec3 vW; varying vec3 vV; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vV = cameraPosition - w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform float time; uniform vec3 tint; uniform float layerY; uniform vec2 bounds; varying vec3 vW; varying vec3 vV;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
    float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
    void main(){
      vec2 p = vW.xz * 0.09;
      float m = fbm(p + vec2(time*0.03, time*0.017) + layerY) * fbm(p*1.7 - vec2(time*0.02, -time*0.025));
      m = smoothstep(0.12, 0.55, m);
      vec3 V = normalize(vV);
      float grazing = smoothstep(0.0, 0.35, abs(V.y));
      float d = length(vV);
      float near = smoothstep(0.6, 5.0, d) * (1.0 - smoothstep(45.0, 75.0, d));
      float edge = (1.0 - smoothstep(bounds.x - 2.0, bounds.x, abs(vW.x))) * (1.0 - smoothstep(bounds.y - 8.0, bounds.y, abs(vW.z)));
      gl_FragColor = vec4(tint, m * grazing * near * edge * 0.4);
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide
});

const skyMaterial = () => new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 }, flash: { value: 0 } },
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: `uniform float time; uniform float flash; varying vec3 vD;
    float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
    float n3(vec3 q){ vec3 qi = floor(q), qf = fract(q); qf = qf * qf * (3.0 - 2.0 * qf);
      return mix(mix(mix(h(qi), h(qi+vec3(1,0,0)), qf.x), mix(h(qi+vec3(0,1,0)), h(qi+vec3(1,1,0)), qf.x), qf.y),
                 mix(mix(h(qi+vec3(0,0,1)), h(qi+vec3(1,0,1)), qf.x), mix(h(qi+vec3(0,1,1)), h(qi+vec3(1,1,1)), qf.x), qf.y), qf.z); }
    void main(){
      float y = vD.y;
      // choking smog: dirty sodium-orange light pollution under a starless, soot-brown sky
      vec3 zenith = vec3(0.005,0.005,0.007), mid = vec3(0.022,0.017,0.016), horizon = vec3(0.12,0.06,0.03);
      vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.2, y));
      c = mix(c, zenith, smoothstep(0.2, 0.85, y));
      float az = atan(vD.z, vD.x);
      c += vec3(0.05,0.0,0.03) * (0.5+0.5*sin(az*2.0-0.7)) * exp(-max(y,0.0)*10.0);
      // heavy, slow cloud deck lit orange from below
      vec3 q = vD * vec3(2.5, 8.0, 2.5) + vec3(time * 0.006, 0.0, time * 0.002);
      float n = n3(q) * 0.65 + n3(q * 2.3) * 0.35;
      float cl = smoothstep(0.35, 0.8, n) * smoothstep(0.02, 0.2, y);
      c += vec3(0.07, 0.035, 0.02) * cl * (1.0 - smoothstep(0.3, 0.9, y));
      // lightning: clouds light up from inside
      c += vec3(0.55, 0.6, 0.75) * flash * (0.25 + cl * 1.4) * smoothstep(-0.05, 0.3, y);
      gl_FragColor = vec4(c, 1.0);
    }`,
  side: THREE.BackSide, depthWrite: false, fog: false
});

const rainMaterial = () => new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 }, center: { value: new THREE.Vector3() } },
  vertexShader: `attribute float seed; attribute float tip; uniform float time; uniform vec3 center; varying float vA;
    void main(){
      vec3 p = position;
      float fall = 24.0 + seed * 8.0;
      p.y = mod(p.y - time * fall, 26.0) - 2.0;
      p.x = center.x + mod(p.x - center.x + 30.0, 60.0) - 30.0;
      p.z = center.z + mod(p.z - center.z + 30.0, 60.0) - 30.0;
      p += vec3(0.08, 0.6, 0.04) * tip;
      vA = (1.0 - tip * 0.8) * smoothstep(-2.0, 1.5, p.y);
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(0.55,0.7,0.9) * 0.6, vA * 0.35); }',
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
});

// ------------------------------------------------------------------ world
export function createWorld(renderer, scene, quality) {
  const Q = quality;
  const T0 = performance.now();
  TX.setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const texSize = Q.textures;
  const updaters = [];
  const batch = new StaticBatcher();
  const root = new THREE.Group(); root.name = 'alley'; scene.add(root);
  const neonEmitters = [];   // positions for neon buzz audio
  const fireSpots = [];      // burning barrels (flames, embers, crackle audio)
  const ventSpots = [];      // steam from grates and manholes
  const sparkSpots = [];     // broken cables that spit sparks
  const HX = Sim.HALF_X, HZ = Sim.HALF_Z, AD = Sim.ALCOVE_DEPTH, VIS_Z = HZ + 30;
  const rand = TX.mulberry32(4606);
  const pick = arr => arr[(rand() * arr.length) | 0];
  // how many real lights each quality level can afford (everything else is emissive-only)
  const budget = Q.extraLights ? { lamps: 7, fires: 6, police: 2, signs: 4 }
    : Q.spotShadows ? { lamps: 6, fires: 4, police: 2, signs: 2 }
      : Q.shadows ? { lamps: 4, fires: 3, police: 2, signs: 0 }
        : { lamps: 3, fires: 2, police: 0, signs: 0 };

  // ---------- environment (IBL): a dim, sodium-lit city instead of bright neon
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: 0x050403, side: THREE.BackSide })));
  const envPanel = (c, x, y, z, w, h, k = 6) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, y * 0.4, 0); envScene.add(m); };
  envPanel(0xff8a30, 30, 6, -20, 18, 3, 4); envPanel(0xff2fb9, -28, 8, 18, 10, 3, 3); envPanel(0x2a7078, 10, 10, 34, 12, 2, 1.5);
  envPanel(0xffa040, -25, 4, -30, 10, 2, 3); envPanel(0x403020, 0, 40, 0, 40, 40, 0.12); envPanel(0xff7020, 32, 3, 25, 10, 2, 3);
  envPanel(0x302820, 0, -6, 0, 60, 60, 0.35);
  const envRT = pmrem.fromScene(envScene, 0.035);
  scene.environment = envRT.texture;
  envScene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });

  // ---------- sky & fog: thick, dirty smog that swallows the ends of the alley
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), skyMaterial());
  sky.frustumCulled = false; sky.renderOrder = -1000; scene.add(sky);
  // a murky, lit-from-within smog: far things become silhouettes instead of vanishing into black
  scene.background = new THREE.Color(0x0a0908);
  scene.fog = new THREE.FogExp2(0x332d25, 0.02);
  updaters.push(t => { sky.material.uniforms.time.value = t; });

  // ---------- materials
  const std = (maps, o = {}) => new THREE.MeshStandardMaterial(Object.assign({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap, metalnessMap: maps.metalnessMap,
    roughness: 1, metalness: 1, envMapIntensity: 0.9
  }, o));
  const floorM = TX.floorMaps(Math.max(512, texSize * 2));
  const metalM = TX.metalPanelMaps(texSize);
  const metalDarkM = TX.metalPanelMaps(texSize, [0.12, 0.13, 0.16]);
  const concreteM = TX.concreteMaps(texSize);
  const brickM = [TX.brickMaps(texSize), TX.brickMaps(texSize, [0.22, 0.16, 0.13]), TX.brickMaps(texSize, [0.18, 0.18, 0.19])];
  const shutterM = [TX.shutterMaps(texSize), TX.shutterMaps(texSize, [0.3, 0.27, 0.22]), TX.shutterMaps(texSize, [0.08, 0.17, 0.09])];
  const burntM = [TX.burntMetalMaps(texSize), TX.burntMetalMaps(texSize, [0.08, 0.12, 0.2]), TX.burntMetalMaps(texSize, [0.3, 0.27, 0.22])];
  const chainM = TX.chainLinkMaps(256);
  const grateM = TX.grateMaps(256);
  const hazardM = TX.hazardMaps(256);
  const windowsM = TX.windowMaps(texSize);
  const crateVariants = [
    TX.crateMaps(texSize, [0.62, 0.2, 0.06], 'NX-07'),
    TX.crateMaps(texSize, [0.05, 0.3, 0.33], 'KZ-41'),
    TX.crateMaps(texSize, [0.2, 0.21, 0.23], 'BLK-3')
  ];
  const barrelVariants = [TX.barrelMaps(256, [0.45, 0.06, 0.05]), TX.barrelMaps(256, [0.07, 0.18, 0.4])];

  const mats = {
    metal: std(metalM, { normalScale: new THREE.Vector2(0.8, 0.8) }),
    metalDark: std(metalDarkM),
    concrete: std(concreteM, { metalness: 0, envMapIntensity: 0.5 }),
    bricks: brickM.map(m => std(m, { metalness: 0, envMapIntensity: 0.8 })),
    shutters: shutterM.map(m => std(m)),
    burnt: burntM.map(m => std(m)),
    chain: std(chainM, { alphaMap: chainM.alphaMap, alphaTest: 0.5, side: THREE.DoubleSide }),
    grate: std(grateM, { alphaMap: grateM.alphaMap, alphaTest: 0.5, side: THREE.DoubleSide }),
    hazard: std(hazardM),
    windows: std(windowsM, { emissive: 0xffffff, emissiveMap: windowsM.emissiveMap, emissiveIntensity: 0.9, envMapIntensity: 0.4 }),
    crates: crateVariants.map(m => std(m)),
    barrels: barrelVariants.map(m => std(m)),
    trimDark: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.5, metalness: 0.85 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9, metalness: 0 }),
    plywood: new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.9, metalness: 0 }),
    tarp: new THREE.MeshStandardMaterial({ color: 0x1d3550, roughness: 0.75, metalness: 0, side: THREE.DoubleSide }),
    void: new THREE.MeshBasicMaterial({ color: 0x010101 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1218, roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.3 }),
    windowWarm: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(0.9) }),
    windowSick: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9cffb0).multiplyScalar(0.55) }),
    neon: {}
  };
  const neon = (hex, k = 4) => {
    if (!mats.neon[hex + k]) mats.neon[hex + k] = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: true });
    return mats.neon[hex + k];
  };
  const CYAN = 0x00f5ff, PINK = 0xff2fb9, LIME = 0xb6ff4a, AMBER = 0xffa23a, SODIUM = 0xff9a3c, RED = 0xff2020, SICK = 0x9cffb0;

  // ---------- wet asphalt floor with planar reflections in puddles
  const FW = 2 * (HX + AD), FL = 2 * VIS_Z;
  const floorGeo = new THREE.PlaneGeometry(FW, FL, 1, 1);
  const uvs = floorGeo.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * FW / 4, uvs.getY(i) * FL / 4);
  const floorMat = std(floorM, { metalness: 0, envMapIntensity: Q.reflections ? 0.35 : 0.9, normalScale: new THREE.Vector2(0.9, 0.9), color: 0x9a948c });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; root.add(floor);
  let reflector = null;
  const hideInReflection = [floor];
  if (Q.reflections) {
    const w = Math.round(innerWidth * Q.reflectionScale), h = Math.round(innerHeight * Q.reflectionScale);
    reflector = new Reflector(floorGeo, { textureWidth: w, textureHeight: h, clipBias: 0.002, multisample: 0 });
    reflector.rotation.x = -Math.PI / 2;
    reflector.material.colorWrite = false; reflector.material.depthWrite = false;
    reflector.renderOrder = -500;
    const orig = reflector.onBeforeRender;
    reflector.onBeforeRender = function (r, s, c) {
      if (c.isArrayCamera || c.userData.noReflect) return;
      for (const o of hideInReflection) o.visible = false;
      orig.call(this, r, s, c);
      for (const o of hideInReflection) o.visible = true;
    };
    root.add(reflector);
    const texMatrix = reflector.material.uniforms.textureMatrix.value;
    floorMat.onBeforeCompile = shader => {
      shader.uniforms.tReflect = { value: reflector.getRenderTarget().texture };
      shader.uniforms.reflMatrix = { value: texMatrix };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 reflMatrix;\nvarying vec4 vReflUv;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvReflUv = reflMatrix * vec4( position, 1.0 );');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tReflect;\nvarying vec4 vReflUv;')
        .replace('#include <opaque_fragment>', `
          {
            vec4 ruv = vReflUv;
            ruv.xy += normal.xy * 0.045 * ruv.w;
            float br = roughnessFactor * 0.018 * ruv.w;
            vec3 refl = texture2DProj( tReflect, ruv ).rgb * 0.4;
            refl += texture2DProj( tReflect, ruv + vec4( br, 0.0, 0.0, 0.0 ) ).rgb * 0.15;
            refl += texture2DProj( tReflect, ruv - vec4( br, 0.0, 0.0, 0.0 ) ).rgb * 0.15;
            refl += texture2DProj( tReflect, ruv + vec4( 0.0, br * 1.6, 0.0, 0.0 ) ).rgb * 0.15;
            refl += texture2DProj( tReflect, ruv - vec4( 0.0, br * 1.6, 0.0, 0.0 ) ).rgb * 0.15;
            float wet = 1.0 - roughnessFactor; wet *= wet * 1.1;
            float ndv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
            float fres = 0.08 + 0.92 * pow( 1.0 - ndv, 4.0 );
            float k = clamp( wet * fres * 1.15, 0.0, 0.92 );
            outgoingLight = outgoingLight * ( 1.0 - k * 0.6 ) + refl * k;
          }
          #include <opaque_fragment>`);
    };
  }
  // drainage gutter down the middle of the alley, manholes, grates (some steaming)
  batch.box(mats.grate, 0, 0.004, 0, 0.5, 0.008, FL, { cast: false }, 1);
  for (let z = -HZ + 6; z < HZ; z += 17) {
    const x = (rand() - 0.5) * 18;
    if (Sim.isFree(x, 0, z)) {
      batch.add(new THREE.CylinderGeometry(0.42, 0.42, 0.012, 20), mats.metalDark, M4(x, 0.006, z), { cast: false });
      ventSpots.push({ x, z });
    }
  }

  const shopSigns = ['PAWN', 'LOANS 0% *', 'CLINIC 24H', 'NOODLE', 'ROOMS', 'CHROME DOC', 'BAR', 'CASH 4 PARTS', 'REPAIRS', 'NO VACANCY'];
  const signCols = [PINK, CYAN, AMBER, LIME, 0xff4040];
  let signLights = 0, signIdx = 0;

  // ---------- colliders -> visuals
  for (const b of Sim.boxes) {
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    switch (b.kind) {
      case 'boundary': break; // invisible wall
      case 'facade': buildFacade(b, cx, cy, cz, sx, sy, sz); break;
      case 'bus': buildBus(cx, cz, sx, sy, sz); break;
      case 'car': buildCar(cx, cz, sx, sy, sz, (Math.abs(cx * 7 + cz) | 0) % 3); break;
      case 'dumpster': buildDumpster(b, cx, cz, sx, sy, sz); break;
      case 'barrier': buildBarrier(cx, cz, sx, sy, sz); break;
      case 'fence': buildFence(cx, cz, sx, sy, sz); break;
      case 'shack': buildShack(b, cx, cz, sx, sy, sz); break;
      case 'crate': {
        const h = Math.abs(Math.sin(cx * 12.9 + cz * 78.2)) * 3 | 0;
        batch.add(new THREE.BoxGeometry(sx - 0.08, sy - 0.08, sz - 0.08), mats.crates[h % 3], M4(cx, cy, cz));
        for (const ix of [-1, 1]) for (const iz of [-1, 1]) batch.box(mats.trimDark, cx + ix * (sx / 2 - 0.05), cy, cz + iz * (sz / 2 - 0.05), 0.1, sy, 0.1);
        for (const yy of [y0 + 0.05, y1 - 0.05]) {
          batch.box(mats.trimDark, cx, yy, cz - sz / 2 + 0.05, sx, 0.1, 0.1); batch.box(mats.trimDark, cx, yy, cz + sz / 2 - 0.05, sx, 0.1, 0.1);
          batch.box(mats.trimDark, cx - sx / 2 + 0.05, yy, cz, 0.1, 0.1, sz); batch.box(mats.trimDark, cx + sx / 2 - 0.05, yy, cz, 0.1, 0.1, sz);
        }
        break;
      }
      case 'barrel': {
        const mat = b.fire ? mats.burnt[0] : mats.barrels[(Math.abs(cx * 3 + cz) | 0) % 2];
        batch.add(new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 20, 1, b.fire), mat, M4(cx, cy, cz, 0, cx + cz, 0));
        if (!b.fire) batch.add(new THREE.CylinderGeometry(sx / 2 - 0.03, sx / 2 - 0.03, 0.02, 20), mats.trimDark, M4(cx, y1 + 0.01, cz));
        else { batch.add(new THREE.CylinderGeometry(sx / 2 - 0.04, sx / 2 - 0.04, 0.02, 20), neon(0xff5a10, 2.5), M4(cx, y1 - 0.15, cz), { cast: false }); fireSpots.push({ x: cx, y: y1 - 0.1, z: cz }); }
        for (const yy of [y0 + 0.02, y1 - 0.02]) batch.add(new THREE.TorusGeometry(sx / 2, 0.025, 6, 20), mats.metal, M4(cx, yy, cz, Math.PI / 2));
        break;
      }
      case 'catwalk': buildCatwalk(b, cx, cy, cz, sx, sy, sz); break;
      case 'stair': {
        batch.box(mats.metalDark, cx, cy, cz, sx, sy, sz, {}, 1);
        batch.box(mats.grate, cx, y1 + 0.005, cz, sx, 0.01, sz, { cast: false }, 1);
        if (sz > sx) for (const sgn of [-1, 1]) batch.box(neon(AMBER, 1.4), cx + sgn * (sx / 2 + 0.006), y1 - 0.03, cz, 0.012, 0.03, sz - 0.1, { cast: false });
        else for (const sgn of [-1, 1]) batch.box(neon(AMBER, 1.4), cx, y1 - 0.03, cz + sgn * (sz / 2 + 0.006), sx - 0.1, 0.03, 0.012, { cast: false });
        break;
      }
    }
  }

  // ---------- building fronts
  // Each front collider becomes a tall, filthy tenement face: brick, ground-floor shutters and doors,
  // rows of mostly dark / boarded windows, drainpipes, AC units, pipes, and the odd dying sign.
  function buildFacade(b, cx, cy, cz, sx, sy, sz) {
    const s = b.side, face = s * HX;
    if (b.alcove && sz > sx) { // back wall of a loading bay: big roller shutter and a red warning lamp
      const fx = s * (HX + AD);
      batch.box(mats.concrete, cx, 4.5, cz, sx, 9, sz, {}, 4);
      batch.box(pick(mats.shutters), fx - s * 0.04, 1.5, cz, 0.08, 3.0, sz - 0.9, {}, 2);
      batch.box(mats.trimDark, fx - s * 0.12, 3.1, cz, 0.25, 0.25, sz - 0.6);
      batch.box(mats.hazard, fx - s * 0.02, 0.15, cz, 0.04, 0.3, sz - 0.4, {}, 1);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), neon(RED, 6)); lamp.position.set(fx - s * 0.15, 2.95, cz + sz * 0.38); root.add(lamp);
      updaters.push(t => { lamp.visible = Math.sin(t * 2.4 + cz) > 0; });
      return;
    }
    if (b.alcove) { batch.box(mats.concrete, cx, 4.5, cz, sx, 9, sz, {}, 4); return; } // alcove side walls
    if (b.lintel) {
      // concrete beam over the bay with a buzzing, failing tube light underneath
      batch.box(mats.concrete, cx, 3.2 + 0.6, cz, sx + 0.1, 1.2, sz, {}, 4);
      batch.box(mats.hazard, face - s * 0.06, 3.35, cz, 0.04, 0.25, sz, {}, 1);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 1.6), neon(SICK, 3)); tube.position.set(s * (HX + 1.2), 3.15, cz); root.add(tube);
      let seed = cz;
      updaters.push(t => { tube.visible = Math.sin(t * 41 + seed) > -0.3 || Math.sin(t * 3.1 + seed) > 0.6; });
      neonEmitters.push(tube.position.clone());
      buildFront(face, s, cz - sz / 2, cz + sz / 2, 4.4);
      return;
    }
    buildFront(face, s, cz - sz / 2, cz + sz / 2, 0);
  }
  function buildFront(face, s, za, zb, y0) {
    let z = za;
    while (z < zb - 0.01) {
      const len = Math.min(zb - z, 8 + rand() * 7), zc = z + len / 2, H = 15 + rand() * 17;
      const brick = pick(mats.bricks);
      batch.box(brick, s * (HX + 4), (y0 + H) / 2, zc, 8, H - y0, len, {}, 2);
      batch.box(mats.trimDark, s * (HX + 3.85), H + 0.2, zc, 8.4, 0.4, len + 0.1);       // cornice
      if (Math.abs(zc) > HZ + 22) { z += len; continue; } // far into the fog: just the mass
      // upper floors: rows of windows (mostly dark, some boarded up, a few dimly lit)
      for (let y = Math.max(5.2, y0 + 1.6); y < H - 1.4; y += 3.4) {
        for (let w = z + 1.3; w < z + len - 1.0; w += 2.6) {
          const r = rand(), wx = face - s * 0.02;
          const mat = r < 0.05 ? mats.windowWarm : r < 0.08 ? mats.windowSick : r < 0.32 ? mats.plywood : mats.glass;
          batch.box(mat, wx, y, w, 0.04, 1.6, 1.15, { cast: false });
          batch.box(mats.concrete, face - s * 0.07, y - 0.86, w, 0.14, 0.1, 1.35, { cast: false }, 2);
        }
      }
      if (y0 === 0) {
        batch.box(mats.concrete, face - s * 0.04, 1.8, zc, 0.08, 3.6, len, {}, 4);             // grimy plinth
        batch.box(mats.trimDark, face - s * 0.08, 3.75, zc, 0.16, 0.18, len);
        // ground floor: shutters, doors with dying lamps, barred windows
        for (let w = z + 2.2; w < z + len - 1.8; w += 4.2 + rand() * 1.5) {
          if (!Sim.isFree(face - s * 0.6, 0, w)) continue; // something (fire escape stairs, dumpster) is in front
          const kind = rand();
          if (kind < 0.4) {
            batch.box(pick(mats.shutters), face - s * 0.08, 1.4, w, 0.06, 2.8, 2.8, {}, 2);
            batch.box(mats.trimDark, face - s * 0.16, 2.95, w, 0.28, 0.3, 3.0);
          } else if (kind < 0.75) {
            batch.box(mats.void, face - s * 0.03, 1.1, w, 0.05, 2.2, 1.1);
            batch.box(mats.trimDark, face - s * 0.07, 2.28, w, 0.12, 0.12, 1.4);
            for (const e of [-0.62, 0.62]) batch.box(mats.trimDark, face - s * 0.07, 1.1, w + e, 0.12, 2.2, 0.12);
            const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.3), neon(SODIUM, 3)); lamp.position.set(face - s * 0.15, 2.6, w); root.add(lamp);
            if (rand() < 0.5) { const ph = rand() * 10; updaters.push(t => { lamp.visible = Math.sin(t * 29 + ph) > -0.6 && Math.sin(t * 0.9 + ph) > -0.8; }); }
          } else {
            batch.box(mats.glass, face - s * 0.03, 1.7, w, 0.04, 1.2, 1.6, { cast: false });
            for (let k = -3; k <= 3; k++) batch.box(mats.metalDark, face - s * 0.09, 1.7, w + k * 0.24, 0.04, 1.3, 0.04);
          }
        }
        // shop sign sticking out from the wall (visible down the alley), many half dead
        if (rand() < 0.55) {
          const txt = shopSigns[signIdx % shopSigns.length], col = signCols[signIdx % signCols.length]; signIdx++;
          const w = z + len * (0.3 + rand() * 0.4), y = 4.6 + rand() * 1.2;
          const sMat = new THREE.MeshBasicMaterial({ map: signTexture(txt, '#' + new THREE.Color(col).getHexString(), { w: 512, h: 160 }), transparent: true, color: new THREE.Color(1.8, 1.8, 1.8), depthWrite: false, side: THREE.DoubleSide });
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.62), sMat);
          sign.position.set(face - s * 1.15, y, w); sign.rotation.y = Math.PI / 2; root.add(sign);
          batch.box(mats.trimDark, face - s * 1.15, y, w, 2.1, 0.7, 0.06);
          batch.box(mats.metalDark, face - s * 0.1, y + 0.4, w, 0.2, 0.06, 0.06);
          const dead = rand() < 0.3, ph = rand() * 20;
          let sl = null;
          if (!dead && signLights < budget.signs) { signLights++; sl = new THREE.PointLight(col, 5, 6, 2); sl.position.set(face - s * 1.6, y - 0.3, w); root.add(sl); }
          updaters.push(t => {
            const f = dead ? (Math.sin(t * 53 + ph) > 0.96 ? 0.6 : 0.05) : (Math.sin(t * 37 + ph) > 0.95 || Math.sin(t * 0.6 + ph) > 0.97 ? 0.2 : 1);
            sMat.color.setScalar(1.8 * f); if (sl) sl.intensity = 5 * f;
          });
          if (!dead) neonEmitters.push(sign.position.clone());
        }
        // drainpipe, pipe runs and AC units
        batch.add(new THREE.CylinderGeometry(0.07, 0.07, H, 8), mats.metalDark, M4(face - s * 0.12, H / 2, z + 0.4));
        batch.add(new THREE.CylinderGeometry(0.1, 0.1, len, 8), mats.metal, M4(face - s * 0.2, 4.1, zc, Math.PI / 2, 0, 0));
        for (let k = 0; k < 1 + (rand() * 3 | 0); k++) {
          const ay = 5.5 + rand() * 9, az = z + 1 + rand() * (len - 2);
          batch.box(mats.metal, face - s * 0.35, ay, az, 0.7, 0.6, 0.9, {}, 1);
          batch.box(mats.grate, face - s * 0.705, ay, az, 0.01, 0.45, 0.6, { cast: false }, 1);
        }
      }
      z += len;
    }
  }

  // ---------- burnt-out bus in the middle of the alley (smoke still rising from it)
  function buildBus(cx, cz, sx, sy, sz) {
    const body = mats.burnt[1];
    batch.box(body, cx, 0.35 + 1.0, cz, sx, 2.0, sz, {}, 2);                         // lower body
    batch.box(body, cx, sy - 0.12, cz, sx - 0.08, 0.24, sz - 0.1, {}, 2);            // roof
    for (const zz of [-sz / 2 + 0.6, -sz / 4, sz / 4, sz / 2 - 0.6]) for (const s of [-1, 1]) batch.box(body, cx + s * (sx / 2 - 0.05), 2.1, cz + zz, 0.1, 1.3, 0.25);
    for (const s of [-1, 1]) { // shattered windows: a black void with a few jagged panes left
      batch.box(mats.void, cx + s * (sx / 2 - 0.08), 2.1, cz, 0.05, 1.2, sz - 0.6);
      for (let k = 0; k < 3; k++) batch.box(mats.glass, cx + s * (sx / 2 - 0.02), 2.0 + rand() * 0.3, cz + (rand() - 0.5) * (sz - 2), 0.02, 0.5 + rand() * 0.5, 0.6 + rand() * 0.6, { cast: false });
    }
    for (const s of [-1, 1]) batch.box(mats.void, cx, 2.0, cz + s * (sz / 2 - 0.04), sx - 0.4, 1.1, 0.05);
    for (const zz of [-sz / 2 + 1.6, sz / 2 - 2.2]) for (const s of [-1, 1]) batch.add(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 16), mats.rubber, M4(cx + s * (sx / 2 - 0.12), 0.45, cz + zz, 0, 0, Math.PI / 2));
    batch.box(mats.hazard, cx, 0.5, cz + sz / 2 + 0.02, sx - 0.3, 0.2, 0.04, {}, 1);
    fireSpots.push({ x: cx, y: 1.0, z: cz - sz / 2 + 1.4, small: true }); // something still burning inside
    ventSpots.push({ x: cx, z: cz + 2, y: sy, dark: true });
  }
  function buildCar(cx, cz, sx, sy, sz, v) {
    const alongZ = sz > sx, L = alongZ ? sz : sx, W = alongZ ? sx : sz;
    const body = mats.burnt[v];
    const box = (mat, x, y, z, w, h, l, opts) => batch.box(mat, cx + (alongZ ? x : z), y, cz + (alongZ ? z : x), alongZ ? w : l, h, alongZ ? l : w, opts, 2);
    box(body, 0, 0.6, 0, W, 0.7, L);
    box(body, 0, 1.18, -L * 0.05, W * 0.86, 0.46, L * 0.52);
    box(mats.void, 0, 1.2, -L * 0.05, W * 0.88, 0.32, L * 0.48);                       // gutted cabin
    box(body, 0, 1.43, -L * 0.05, W * 0.84, 0.04, L * 0.5);
    for (const zz of [-L * 0.32, L * 0.32]) for (const s of [-1, 1]) {
      const m = alongZ ? M4(cx + s * (W / 2 - 0.1), 0.3, cz + zz, 0, 0, Math.PI / 2) : M4(cx + zz, 0.3, cz + s * (W / 2 - 0.1), Math.PI / 2, 0, 0);
      if (rand() < 0.75) batch.add(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14), mats.rubber, m);
    }
  }
  function buildDumpster(b, cx, cz, sx, sy, sz) {
    const s = b.side, mat = mats.shutters[2];
    batch.box(mat, cx, 0.2 + (sy - 0.2) / 2, cz, sx, sy - 0.2, sz, {}, 2);
    batch.box(mats.trimDark, cx, sy - 0.05, cz, sx + 0.06, 0.1, sz + 0.06);
    // lid flung open against the wall
    batch.add(new THREE.BoxGeometry(0.05, sx, sz), mat, M4(cx + s * (sx / 2 + 0.05), sy + sx / 2 - 0.1, cz, 0, 0, -s * 0.25));
    for (const iz of [-1, 1]) for (const ix of [-1, 1]) batch.add(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10), mats.rubber, M4(cx + ix * (sx / 2 - 0.15), 0.08, cz + iz * (sz / 2 - 0.2), Math.PI / 2));
  }
  function buildBarrier(cx, cz, sx, sy, sz) {
    const alongZ = sz > sx, L = alongZ ? sz : sx, W = alongZ ? sx : sz;
    const box = (mat, y, w, h, l = L, tile = 2) => batch.box(mat, cx, y, cz, alongZ ? w : l, h, alongZ ? l : w, {}, tile);
    box(mats.concrete, 0.15, W, 0.3);
    box(mats.concrete, 0.55, W * 0.7, 0.5);
    box(mats.concrete, 0.9, W * 0.45, 0.2);
    for (const s of [-1, 1]) batch.box(mats.hazard, cx + (alongZ ? s * (W * 0.35 + 0.005) : 0), 0.62, cz + (alongZ ? 0 : s * (W * 0.35 + 0.005)), alongZ ? 0.01 : L - 0.2, 0.18, alongZ ? L - 0.2 : 0.01, {}, 1);
  }
  function buildFence(cx, cz, sx, sy, sz) {
    const alongX = sx > sz, L = alongX ? sx : sz;
    batch.box(mats.chain, cx, sy / 2, cz, alongX ? L : 0.01, sy, alongX ? 0.01 : L, { cast: false }, 1);
    for (let s = -L / 2; s <= L / 2 + 0.01; s += 2.5) {
      const px = alongX ? cx + s : cx, pz = alongX ? cz : cz + s;
      batch.add(new THREE.CylinderGeometry(0.035, 0.035, sy + 0.25, 8), mats.metal, M4(px, (sy + 0.25) / 2, pz));
    }
    // razor wire along the top
    for (let s = -L / 2 + 0.15; s < L / 2; s += 0.32) {
      const px = alongX ? cx + s : cx, pz = alongX ? cz : cz + s;
      batch.add(new THREE.TorusGeometry(0.16, 0.006, 4, 14), mats.metal, M4(px, sy + 0.2, pz, 0, alongX ? Math.PI / 2 : 0, 0), { cast: false });
    }
    batch.add(new THREE.CylinderGeometry(0.02, 0.02, L, 6), mats.metal, alongX ? M4(cx, sy, cz, 0, 0, Math.PI / 2) : M4(cx, sy, cz, Math.PI / 2, 0, 0));
  }
  function buildShack(b, cx, cz, sx, sy, sz) {
    const s = b.side, front = cx - s * (sx / 2); // faces the middle of the alley
    batch.box(mats.shutters[1], cx, (sy - 0.2) / 2, cz, sx - 0.1, sy - 0.2, sz - 0.1, {}, 2);
    batch.add(new THREE.BoxGeometry(sx + 0.8, 0.05, sz + 0.6), mats.tarp, M4(cx, sy, cz, 0, 0, s * 0.12));
    batch.box(mats.void, front - s * 0.02, 0.95, cz, 0.04, 1.9, 0.9);
    batch.add(new THREE.PlaneGeometry(0.9, 1.4), mats.tarp, M4(front - s * 0.06, 1.2, cz + 0.15, 0, Math.PI / 2, 0.05), { cast: false });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), neon(0xffc070, 4)); bulb.position.set(front - s * 0.3, 2.1, cz - 0.6); root.add(bulb);
    updaters.push(t => { bulb.material.color.setScalar(Math.sin(t * 13) > 0.9 ? 1.5 : 4); });
    for (let k = 0; k < 3; k++) batch.box(mats.plywood, front - s * (0.5 + k * 0.05), 0.07 + k * 0.14, cz + sz / 2 + 0.7, 1.2, 0.12, 1.0, {}, 1); // pallets
  }

  // ---------- fire escapes and footbridges
  function buildCatwalk(b, cx, cy, cz, sx, sy, sz) {
    batch.box(mats.grate, cx, b.max[1] - 0.02, cz, sx, 0.04, sz, {}, 1);
    const alongX = sx > sz, len = alongX ? sx : sz;
    if (alongX) { for (const s of [-1, 1]) batch.box(mats.metalDark, cx, cy, cz + s * (sz / 2 - 0.06), sx, sy, 0.12, {}, 1); }
    else { for (const s of [-1, 1]) batch.box(mats.metalDark, cx + s * (sx / 2 - 0.06), cy, cz, 0.12, sy, sz, {}, 1); }
    for (let s = -len / 2 + 0.5; s <= len / 2 - 0.4; s += 1.25) {
      if (alongX) batch.box(mats.metalDark, cx + s, cy - 0.05, cz, 0.08, 0.12, sz); else batch.box(mats.metalDark, cx, cy - 0.05, cz + s, sx, 0.12, 0.08);
    }
    const ry = b.max[1];
    // railings: both sides of a bridge, the alley side of a fire escape
    const sides = b.bridge ? [-1, 1] : [alongX ? (cz < 0 ? 1 : -1) : (cx < 0 ? 1 : -1)];
    for (const inner of sides) {
      for (let s = -len / 2 + 0.15; s <= len / 2 - 0.1; s += 1.2) {
        const px = alongX ? cx + s : cx + inner * (sx / 2 - 0.05), pz = alongX ? cz + inner * (sz / 2 - 0.05) : cz + s;
        batch.box(mats.metal, px, ry + 0.5, pz, 0.05, 1.0, 0.05, {}, 1);
      }
      for (const h of [0.5, 1.0]) {
        const px = alongX ? cx : cx + inner * (sx / 2 - 0.05), pz = alongX ? cz + inner * (sz / 2 - 0.05) : cz;
        batch.add(new THREE.CylinderGeometry(0.025, 0.025, len, 6), mats.metal, alongX ? M4(px, ry + h, pz, 0, 0, Math.PI / 2) : M4(px, ry + h, pz, Math.PI / 2, 0, 0));
      }
    }
    if (b.bridge) {
      // hung from the buildings on cables; laundry and a tarp drape over it
      for (const e of [-1, 1]) for (const sz2 of [-1, 1]) cable(new THREE.Vector3(e * (len / 2 - 0.2), ry + 1.0, cz + sz2 * (sz / 2)), new THREE.Vector3(e * HX, 9, cz + sz2 * (sz / 2)), 0.05);
      for (let k = 0; k < 6; k++) {
        const x = (rand() - 0.5) * (len - 3), c = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rand(), 0.3, 0.18), roughness: 0.9, side: THREE.DoubleSide });
        batch.add(new THREE.PlaneGeometry(0.55, 0.7), c, M4(x, ry - 0.45, cz + sz / 2 + 0.05, 0, 0, (rand() - 0.5) * 0.2), { cast: false });
      }
    } else {
      // diagonal brackets bolted to the wall instead of ground pillars
      const wallX = cx + (cx > 0 ? 1 : -1) * (sx / 2), out = cx > 0 ? -1 : 1;
      for (let s = -len / 2 + 0.6; s <= len / 2 - 0.5; s += 2.6) {
        const m = M4(wallX + out * 0.55, b.min[1] - 0.55, cz + s, 0, 0, out * 0.785);
        batch.add(new THREE.BoxGeometry(0.08, 1.55, 0.08), mats.metalDark, m);
      }
    }
    // one sickly tube light under the deck
    const px = alongX ? cx : cx + (cx > 0 ? -1 : 1) * (sx / 2 - 0.3), pz = cz;
    batch.box(neon(SICK, 1.6), px, b.min[1] - 0.03, pz, alongX ? Math.min(3, len - 0.4) : 0.05, 0.03, alongX ? 0.05 : Math.min(3, len - 0.4), { cast: false });
  }

  // ---------- cables strung across the alley (and a few snapped ones that spark)
  function cable(a, b, sag) {
    const pts = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20; const p = new THREE.Vector3().lerpVectors(a, b, t); p.y -= Math.sin(Math.PI * t) * sag; pts.push(p); }
    batch.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.022, 5, false), mats.rubber, new THREE.Matrix4(), { cast: true, receive: false });
  }
  for (let z = -HZ - 10; z < HZ + 10; z += 5 + rand() * 6) {
    const y1 = 7 + rand() * 9, y2 = 7 + rand() * 9;
    cable(new THREE.Vector3(-HX, y1, z), new THREE.Vector3(HX, y2, z + (rand() - 0.5) * 6), 0.8 + rand() * 1.8);
  }
  for (const [x, z] of [[-HX, -38], [HX, 6], [HX, 38], [-HX, -6]]) {
    const top = new THREE.Vector3(x, 8.5, z), end = new THREE.Vector3(x * 0.82, 3.6, z + 1.2);
    cable(top, end, -0.4);
    sparkSpots.push({ x: end.x, y: end.y, z: end.z });
  }

  // ---------- police cordon past each end of the alley (explains the invisible wall)
  const tapeTex = (() => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#e8c200'; x.fillRect(0, 0, 1024, 64); x.fillStyle = '#111'; x.font = '800 34px Arial'; x.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) x.fillText('SECTOR PATROL · DO NOT CROSS ·', 10 + i * 340, 33);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.x = 4; return t;
  })();
  const tapeMat = new THREE.MeshStandardMaterial({ map: tapeTex, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  let policeLights = 0;
  for (const e of [-1, 1]) {
    const zt = e * (HZ + 1.5);
    for (const [y, sag] of [[1.0, 0.25], [1.25, 0.3]]) {
      const g = new THREE.PlaneGeometry(2 * HX, 0.08, 24, 1); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = p.getX(i) / HX; p.setY(i, p.getY(i) - (1 - k * k) * sag); }
      const m = new THREE.Mesh(g, tapeMat); m.position.set(0, y, zt); root.add(m);
    }
    for (const x of [-6, 5.5]) { // sawhorse barricades
      batch.box(mats.hazard, x, 0.95, zt + e * 0.8, 2.2, 0.22, 0.06, {}, 1);
      for (const s of [-1, 1]) batch.add(new THREE.BoxGeometry(0.06, 1.0, 0.06), mats.metalDark, M4(x + s * 0.9, 0.5, zt + e * 0.8, e * 0.25, 0, 0));
    }
    // abandoned patrol car with its light bar still flashing
    const pz = e * (HZ + 8), px = -3 * e;
    buildCar(px, pz, 4.6, 1.45, 2.0, 1);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.25), neon(RED, 8)); red.position.set(px - 0.4, 1.55, pz); root.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.25), neon(0x2050ff, 8)); blue.position.set(px + 0.4, 1.55, pz); root.add(blue);
    let pl = null;
    if (policeLights < budget.police) { policeLights++; pl = new THREE.PointLight(RED, 30, 16, 2); pl.position.set(px, 2.2, pz); root.add(pl); }
    updaters.push(t => {
      const ph = (t * 2.2 + (e > 0 ? 0.5 : 0)) % 1, onR = ph < 0.25 || (ph > 0.33 && ph < 0.42), onB = ph > 0.5 && ph < 0.75;
      red.visible = onR; blue.visible = onB;
      if (pl) { pl.color.setHex(onB ? 0x2050ff : RED); pl.intensity = onR || onB ? 30 : 0; }
    });
  }

  // ---------- skyline beyond the tenements (merged buildings with dim windows)
  const sky1 = new StaticBatcher();
  const antennaLights = [];
  for (let i = 0; i < 110; i++) {
    const ang = rand() * Math.PI * 2, dist = 50 + rand() * 95;
    const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist * 1.3;
    if (Math.abs(x) < HX + 14 && Math.abs(z) < VIS_Z + 10) continue;
    const w = 6 + rand() * 10, d = 6 + rand() * 10, h = 25 + rand() * (dist > 100 ? 70 : 45);
    sky1.box(mats.windows, x, h / 2 - 1, z, w, h, d, { cast: false, receive: false }, 22, rand() * Math.PI);
    if (rand() > 0.5) antennaLights.push(new THREE.Vector3(x, h + 0.5, z));
  }
  sky1.flush(root);
  const alGeo = new THREE.BufferGeometry().setFromPoints(antennaLights);
  const alMat = new THREE.PointsMaterial({ color: new THREE.Color(3, 0.2, 0.2), size: 0.9, map: TX.radialSprite(64, 0, 2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  root.add(new THREE.Points(alGeo, alMat));
  updaters.push(t => { alMat.opacity = 0.4 + 0.6 * (Math.sin(t * 2.2) > 0 ? 1 : 0.2); });

  // ---------- flying traffic high above (far, fewer)
  const traffic = [];
  const carGeo = new THREE.BoxGeometry(2.4, 0.6, 1.1);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(carGeo, mats.metalDark));
    const lightCol = i % 2 ? 0xff2fb9 : 0xffa040;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 1.0), neon(lightCol, 8)); tail.position.x = -1.22; g.add(tail);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.9), neon(0xffffff, 6)); head.position.x = 1.22; g.add(head);
    root.add(g);
    traffic.push({ g, r: 50 + rand() * 50, h: 38 + rand() * 25, speed: (0.04 + rand() * 0.05) * (i % 2 ? 1 : -1), phase: rand() * Math.PI * 2, ecc: 1.2 + rand() * 0.4 });
  }
  updaters.push(t => {
    for (const c of traffic) {
      const a = c.phase + t * c.speed;
      c.g.position.set(Math.cos(a) * c.r * 0.5, c.h + Math.sin(t * 0.5 + c.phase) * 1.5, Math.sin(a) * c.r * c.ecc);
      const ahead = c.phase + (t + 0.1) * c.speed;
      c.g.lookAt(Math.cos(ahead) * c.r * 0.5, c.g.position.y, Math.sin(ahead) * c.r * c.ecc);
      c.g.rotateY(-Math.PI / 2);
    }
  });

  // ---------- lighting: dim, dirty, unreliable
  const hemi = new THREE.HemisphereLight(0x5c6676, 0x221d16, 2.0);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x9aa8c0, 1.4);
  moon.position.set(-14, 45, 10); moon.target.position.set(0, 0, 0);
  if (Q.shadows) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    const c = moon.shadow.camera; c.left = -26; c.right = 26; c.top = 64; c.bottom = -64; c.near = 5; c.far = 110;
    moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.04; moon.shadow.radius = 2;
  }
  scene.add(moon, moon.target);

  // wall-mounted sodium street lamps; a few of them dying
  let lampLights = 0;
  for (let i = 0, z = -HZ + 6; z <= HZ - 6; z += 14.8, i++) {
    const s = i % 2 ? 1 : -1, x = s * (HX - 1.1), h = 5.4;
    batch.box(mats.metalDark, s * (HX - 0.55), h + 0.1, z, 1.1, 0.08, 0.08);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.28), mats.trimDark); head.position.set(x, h, z); root.add(head);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.2), neon(SODIUM, 6)); bulb.position.set(x, h - 0.07, z); root.add(bulb);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 2.0, h, 24, 1, true), lightShaftMaterial(0xffa050));
    cone.position.set(x, h / 2, z); cone.material.uniforms.intensity.value = 0.28; root.add(cone);
    hideInReflection.push(cone);
    let spot = null;
    if (lampLights < budget.lamps && i % Math.max(1, Math.round(8 / budget.lamps)) === 0) {
      lampLights++;
      spot = new THREE.SpotLight(SODIUM, 120, 16, 0.9, 0.7, 2); spot.position.set(x, h - 0.1, z); spot.target.position.set(x - s * 1.5, 0, z); scene.add(spot, spot.target);
    }
    const dying = i % 3 === 1, ph = i * 7.3;
    updaters.push(t => {
      cone.material.uniforms.time.value = t;
      let f = 1;
      if (dying) f = Math.sin(t * 31 + ph) > 0.2 && Math.sin(t * 1.3 + ph) > -0.5 ? 1 : 0.06;
      bulb.visible = f > 0.5; cone.material.uniforms.intensity.value = 0.28 * f; if (spot) spot.intensity = 120 * f;
    });
  }

  // flickering firelight from the burning barrels
  let fireLights = 0;
  for (const f of fireSpots) {
    if (f.small || fireLights >= budget.fires) continue;
    fireLights++;
    const l = new THREE.PointLight(0xff7a2a, 14, 9, 2); l.position.set(f.x, f.y + 0.6, f.z); root.add(l);
    const ph = rand() * 10;
    updaters.push(t => { l.intensity = 11 + Math.sin(t * 13 + ph) * 2.5 + Math.sin(t * 31 + ph * 2) * 1.5 + (Math.sin(t * 7.7 + ph) > 0.9 ? 3 : 0); });
  }

  // police drone hovering over the alley, sweeping it with a searchlight
  const drone = new THREE.Group(); root.add(drone);
  const dBody = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 2.6), mats.metalDark); drone.add(dBody);
  for (const s of [-1, 1]) for (const e of [-1, 1]) {
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.02, 16), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.35 }));
    rotor.position.set(s * 1.2, 0.25, e * 1.3); drone.add(rotor);
  }
  const dRed = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), neon(RED, 8)); dRed.position.set(0, -0.25, 1.3); drone.add(dRed);
  const dLens = new THREE.Mesh(new THREE.CircleGeometry(0.25, 16), neon(0xdde8ff, 10)); dLens.position.set(0, -0.21, -0.6); dLens.rotation.x = Math.PI / 2; drone.add(dLens);
  const spot = new THREE.SpotLight(0xdde8ff, 3200, 0, 0.16, 0.5, 2);
  if (Q.shadows && Q.spotShadows) { spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.04; spot.shadow.camera.near = 5; spot.shadow.camera.far = 70; }
  scene.add(spot, spot.target);
  const coneLen = 32;
  const searchCone = new THREE.Mesh(new THREE.CylinderGeometry(0.3, Math.tan(0.16) * coneLen * 1.05, coneLen, 40, 1, true), lightShaftMaterial(0xcfe0ff));
  searchCone.geometry.translate(0, -coneLen / 2, 0); searchCone.geometry.rotateX(-Math.PI / 2);
  root.add(searchCone); hideInReflection.push(searchCone);
  const _t = new THREE.Vector3();
  updaters.push(t => {
    const dz = Math.sin(t * 0.045) * (HZ - 8), dx = Math.sin(t * 0.13) * 4;
    drone.position.set(dx, 24 + Math.sin(t * 0.7) * 0.6, dz);
    drone.rotation.set(Math.sin(t * 0.9) * 0.05, Math.sin(t * 0.045) > 0 ? 0 : Math.PI, Math.sin(t * 0.6) * 0.06);
    dRed.visible = Math.sin(t * 6) > 0.7;
    _t.set(Math.sin(t * 0.37) * (HX - 4), 0, dz + Math.sin(t * 0.23) * 12);
    spot.position.copy(drone.position).add(new THREE.Vector3(0, -0.3, 0));
    spot.target.position.copy(_t); spot.target.updateMatrixWorld();
    searchCone.position.copy(spot.position); searchCone.lookAt(_t); searchCone.material.uniforms.time.value = t;
  });

  // ---------- lightning (thunder is played by the game a moment later)
  let nextBolt = 8 + rand() * 12, boltT = -1;
  const world = { onThunder: null };
  updaters.push((t, dt) => {
    if (boltT < 0 && t > nextBolt) { boltT = 0; nextBolt = t + 14 + rand() * 26; if (world.onThunder) world.onThunder(0.8 + rand() * 2.5); }
    let f = 0;
    if (boltT >= 0) {
      boltT += dt;
      f = boltT < 0.08 ? 1 : boltT < 0.16 ? 0.15 : boltT < 0.24 ? 0.8 : Math.max(0, 0.8 - (boltT - 0.24) * 3);
      if (boltT > 0.6) boltT = -1;
    }
    sky.material.uniforms.flash.value = f;
    hemi.intensity = 2.0 + f * 4;
  });

  // ---------- ground mist layers (sickly, low)
  const mists = [];
  if (Q.mist) {
    for (const [y, tint] of [[0.25, 0x2a2a24], [0.8, 0x23201c], [1.6, 0x1c1f1c]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(FW + 6, 2 * VIS_Z), mistMaterial(y, tint));
      m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 5; root.add(m); mists.push(m);
      hideInReflection.push(m);
    }
    updaters.push(t => { for (const m of mists) m.material.uniforms.time.value = t; });
  }

  // ---------- spawn markings (worn paint rings)
  const markMat = new THREE.MeshStandardMaterial({ color: 0xa8a090, roughness: 0.7, metalness: 0, transparent: true, opacity: 0.35, polygonOffset: true, polygonOffsetFactor: -1, depthWrite: false });
  for (const sp of Sim.spawns) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.78, 40), markMat);
    r.rotation.x = -Math.PI / 2; r.position.set(sp.x, 0.003, sp.z); root.add(r); hideInReflection.push(r);
  }

  // ---------- rain
  let rain = null;
  if (Q.rain) {
    const N = Q.rain;
    const pos = new Float32Array(N * 6), seed = new Float32Array(N * 2), tip = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 60, y = Math.random() * 26, z = (Math.random() - 0.5) * 60, s = Math.random();
      pos.set([x, y, z, x, y, z], i * 6); seed[i * 2] = seed[i * 2 + 1] = s; tip[i * 2] = 0; tip[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
    rain = new THREE.LineSegments(g, rainMaterial()); rain.frustumCulled = false; rain.renderOrder = 10; root.add(rain);
    hideInReflection.push(rain);
  }

  batch.flush(root);
  const city = addNightCity(root, Q);
  updaters.push((t, dt) => city.update(t, dt));
  console.info(`[world] built in ${(performance.now() - T0).toFixed(0)} ms`);

  return Object.assign(world, {
    root, reflector, neonEmitters, fireSpots, ventSpots, sparkSpots, mats,
    update(t, dt, camera) {
      for (const u of updaters) u(t, dt);
      if (rain) { rain.material.uniforms.time.value = t; rain.material.uniforms.center.value.set(camera.position.x, 0, camera.position.z); }
    },
    setSize(w, h) { if (reflector) reflector.getRenderTarget().setSize(Math.round(w * Q.reflectionScale), Math.round(h * Q.reflectionScale)); }
  });
}
