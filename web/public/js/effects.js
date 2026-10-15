// Visual effects: particle systems, spark streaks, bullet tracers, impact decals,
// shell casings, muzzle flashes, death bursts, scan pulses, steam vents, barrel fires, sparking cables and dust.
import * as THREE from 'three';
import * as TX from './textures.js';

const Sim = window.NeonSim;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ point particles
class Particles {
  constructor(capacity, texture, blending, { sizeScale = 300 } = {}) {
    this.n = capacity; this.next = 0;
    this.pos = new Float32Array(capacity * 3); this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity); this.alpha = new Float32Array(capacity); this.rot = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3); this.life = new Float32Array(capacity); this.max = new Float32Array(capacity);
    this.grav = new Float32Array(capacity); this.drag = new Float32Array(capacity); this.s0 = new Float32Array(capacity); this.s1 = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity); this.spin = new Float32Array(capacity); this.bounce = new Uint8Array(capacity);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry = g;
    const additive = blending === THREE.AdditiveBlending;
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: sizeScale } },
      vertexShader: `attribute float size; attribute float alpha; attribute float rot; attribute vec3 color; uniform float scale;
        varying vec3 vC; varying float vA; varying float vR;
        void main(){ vC = color; vA = alpha; vR = rot; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA; varying float vR;
        void main(){ vec2 p = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR); p = mat2(c,-s,s,c) * p + 0.5;
          vec4 t = texture2D(map, p); if (t.a * vA < 0.003) discard;
          gl_FragColor = vec4(vC * ${additive ? 't.a * vA' : '1.0'}, ${additive ? '1.0' : 't.a * vA'}); }`,
      transparent: true, depthWrite: false, blending
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
  }
  spawn(x, y, z, vx, vy, vz, o) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    const c = o.color || [1, 1, 1];
    this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    this.life[i] = this.max[i] = o.life || 1;
    this.grav[i] = o.gravity || 0; this.drag[i] = o.drag || 0;
    this.s0[i] = o.size || 0.1; this.s1[i] = o.endSize !== undefined ? o.endSize : this.s0[i];
    this.a0[i] = o.alpha !== undefined ? o.alpha : 1; this.spin[i] = o.spin || 0; this.rot[i] = Math.random() * 6.28;
    this.bounce[i] = o.bounce ? 1 : 0;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      this.life[i] -= dt;
      const k = 1 - Math.max(0, this.life[i]) / this.max[i];
      const d = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= d; this.vel[j + 1] = this.vel[j + 1] * d - this.grav[i] * dt; this.vel[j + 2] *= d;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.bounce[i] && this.pos[j + 1] < 0.02) { this.pos[j + 1] = 0.02; this.vel[j + 1] *= -0.35; this.vel[j] *= 0.6; this.vel[j + 2] *= 0.6; }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.alpha[i] = this.a0[i] * (1 - k) * Math.min(1, k * 12 + 0.2);
      this.rot[i] += this.spin[i] * dt;
    }
    const a = this.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = a.rot.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ spark streaks
class Sparks {
  constructor(capacity) {
    this.n = capacity; this.next = 0;
    this.pos = new Float32Array(capacity * 3); this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity); this.max = new Float32Array(capacity); this.col = new Float32Array(capacity * 3);
    this.vtx = new Float32Array(capacity * 6); this.vcol = new Float32Array(capacity * 8);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.vtx, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.vcol, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry = g;
    this.lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      vertexShader: 'attribute vec4 color; varying vec4 vC; void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec4 vC; void main(){ gl_FragColor = vec4(vC.rgb * vC.a, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    this.lines.frustumCulled = false;
  }
  spawn(x, y, z, vx, vy, vz, life, color) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = this.max[i] = life; this.col.set(color, i * 3);
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      const j = i * 3, v = i * 6, c = i * 8;
      if (this.life[i] <= 0) { if (this.vcol[c + 3] !== 0) { this.vcol[c + 3] = this.vcol[c + 7] = 0; } continue; }
      this.life[i] -= dt;
      this.vel[j + 1] -= 9.8 * dt;
      const d = Math.exp(-1.5 * dt); this.vel[j] *= d; this.vel[j + 2] *= d;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.01) { this.pos[j + 1] = 0.01; this.vel[j + 1] *= -0.3; }
      const tail = 0.022;
      this.vtx[v] = this.pos[j]; this.vtx[v + 1] = this.pos[j + 1]; this.vtx[v + 2] = this.pos[j + 2];
      this.vtx[v + 3] = this.pos[j] - this.vel[j] * tail; this.vtx[v + 4] = this.pos[j + 1] - this.vel[j + 1] * tail; this.vtx[v + 5] = this.pos[j + 2] - this.vel[j + 2] * tail;
      const a = Math.max(0, this.life[i] / this.max[i]);
      for (let e = 0; e < 2; e++) { this.vcol[c + e * 4] = this.col[j] * 4; this.vcol[c + e * 4 + 1] = this.col[j + 1] * 4; this.vcol[c + e * 4 + 2] = this.col[j + 2] * 4; this.vcol[c + e * 4 + 3] = a * (e ? 0.1 : 1); }
    }
    this.geometry.attributes.position.needsUpdate = this.geometry.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ main FX manager
export class Effects {
  constructor(scene, quality) {
    this.scene = scene; this.Q = quality;
    const glowTex = TX.radialSprite(64, 0, 2.2), smokeTex = TX.smokeSprite(128);
    this.glow = new Particles(quality.particles, glowTex, THREE.AdditiveBlending);
    this.smoke = new Particles(Math.round(quality.particles / 2), smokeTex, THREE.NormalBlending);
    this.debris = new Particles(Math.round(quality.particles / 3), TX.radialSprite(32, 0.6, 1), THREE.NormalBlending);
    this.sparks = new Sparks(Math.round(quality.particles / 2));
    this.smoke.points.renderOrder = 8; this.glow.points.renderOrder = 9; this.sparks.lines.renderOrder = 9;
    scene.add(this.glow.points, this.smoke.points, this.debris.points, this.sparks.lines);

    // tracers
    this.tracers = [];
    const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true); tracerGeo.rotateX(Math.PI / 2); tracerGeo.translate(0, 0, 0.5);
    const beamGeo = tracerGeo.clone();
    for (let i = 0; i < 32; i++) {
      const bolt = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      bolt.visible = beam.visible = false; bolt.frustumCulled = beam.frustumCulled = false;
      scene.add(bolt, beam);
      this.tracers.push({ bolt, beam, life: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), dist: 0, travel: 0 });
    }
    this.tracerIdx = 0;

    // decals
    this.decalMax = 160;
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({
      map: TX.bulletHoleSprite(128), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.95, metalness: 0
    }), this.decalMax);
    this.decals.count = 0; this.decalIdx = 0; this.decals.frustumCulled = false; this.decals.receiveShadow = true;
    scene.add(this.decals);

    // shell casings
    this.shellMax = 40;
    const brass = new THREE.MeshStandardMaterial({ color: 0xc8963e, metalness: 1, roughness: 0.28 });
    const sg = new THREE.CylinderGeometry(0.009, 0.009, 0.045, 8); sg.rotateZ(Math.PI / 2);
    this.shellMesh = new THREE.InstancedMesh(sg, brass, this.shellMax);
    this.shellMesh.castShadow = false; this.shellMesh.frustumCulled = false;
    this.shells = Array.from({ length: this.shellMax }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 }));
    this.shellIdx = 0;
    for (let i = 0; i < this.shellMax; i++) this.shellMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    scene.add(this.shellMesh);

    // muzzle flashes (world) + pooled flash lights. Light count is fixed so shaders never recompile.
    this.flashTex = TX.flashSprite(128);
    this.flashes = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false; scene.add(s); this.flashes.push({ s, life: 0 });
    }
    this.flashIdx = 0;
    this.lights = [];
    for (let i = 0; i < quality.flashLights; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 9, 2); scene.add(l); this.lights.push({ l, life: 0, max: 0.06, peak: 0 });
    }
    this.lightIdx = 0;

    // shockwave rings (death, scan)
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); this.rings.push({ m, life: 0, max: 1, r: 1 });
    }
    this.ringIdx = 0;

    // ambient dust motes (GPU animated)
    const N = quality.dust;
    if (N) {
      const p = new Float32Array(N * 3), seed = new Float32Array(N);
      for (let i = 0; i < N; i++) { p.set([(Math.random() - 0.5) * 2 * Sim.HALF_X, Math.random() * 7, (Math.random() - 0.5) * 2 * Sim.HALF_Z], i * 3); seed[i] = Math.random(); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
      this.dust = new THREE.Points(g, new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, map: { value: glowTex } },
        vertexShader: `attribute float seed; uniform float time; varying float vA;
          void main(){ vec3 p = position; float t = time * (0.15 + seed * 0.2) + seed * 50.0;
            p += vec3(sin(t)*0.8, sin(t*0.7+seed*9.0)*0.5, cos(t*0.8)*0.8);
            vec4 mv = modelViewMatrix * vec4(p,1.0); float d = -mv.z;
            vA = smoothstep(0.5, 3.0, d) * (1.0 - smoothstep(14.0, 26.0, d)) * (0.4 + 0.6 * sin(t*3.0)*sin(t*3.0));
            gl_PointSize = (2.0 + seed * 3.0) * 6.0 / max(d, 0.5); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: 'uniform sampler2D map; varying float vA; void main(){ float a = texture2D(map, gl_PointCoord).a * vA; gl_FragColor = vec4(vec3(0.7,0.8,1.0) * a * 0.9, 1.0); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      this.dust.frustumCulled = false; scene.add(this.dust);
    }
    this.vents = []; this.fires = []; this.sparkSpots = []; this.sparkT = 3;
    this.onSpark = null; // (pos) => sound
    this.time = 0;
  }

  /** World hooks: steam vents [{x,z,y?,dark?}], burning barrels [{x,y,z,small?}], snapped cables [{x,y,z}]. */
  setVents(list) { this.vents = list.map(v => ({ ...v, t: Math.random() })); }
  setFires(list) { this.fires = list.map(f => ({ ...f, t: 0, e: Math.random() })); }
  /** Temporary fires (the burning half of the alley after an Obliteration Beam). */
  addTempFires(list, seconds) {
    const until = this.time + seconds;
    for (const f of list) this.fires.push({ ...f, t: Math.random() * 0.2, e: Math.random(), until, big: true });
    this.burnUntil = Math.max(this.burnUntil || 0, until); this.burnSpots = list;
  }

  // ---------------------------------------------------------------- Obliteration Beam
  /** Rune circle that builds up in front of the shooter. pose(out) fills { pos, dir } every frame. */
  magicCircle(pose, duration) {
    if (!this.circleTex) this.circleTex = runeCircleTextures();
    const g = new THREE.Group(); this.scene.add(g);
    const mk = (tex, size, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(0x6f8dff).multiplyScalar(k), fog: false }));
      m.frustumCulled = false; m.renderOrder = 12; g.add(m); return m;
    };
    const outer = mk(this.circleTex.outer, 3.2, 3), inner = mk(this.circleTex.inner, 1.9, 4);
    inner.position.z = 0.15;
    const c = { g, outer, inner, pose, t: 0, duration, state: 'charge', fade: 0, p: { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) } };
    c.fire = () => { c.state = 'fire'; c.fade = 0; };
    c.cancel = () => { c.state = 'gone'; };
    (this.circles || (this.circles = [])).push(c);
    return c;
  }
  /** The beam itself: a white-hot core inside a 14 m-wide blue column, with sparkles streaming off it. */
  beam(origin, axis, length, radius) {
    if (!this.beamMat) this.beamMat = beamMaterial();
    const g = new THREE.Group(); this.scene.add(g);
    const geo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true); geo.translate(0, 0.5, 0); geo.rotateX(Math.PI / 2);
    const core = new THREE.Mesh(geo, this.beamMat.clone()); core.scale.set(radius * 0.32, radius * 0.32, length); core.material.uniforms.core.value = 1;
    const shell = new THREE.Mesh(geo, this.beamMat.clone()); shell.scale.set(radius, radius * 0.75, length);
    for (const m of [core, shell]) { m.frustumCulled = false; m.renderOrder = 11; g.add(m); }
    g.position.copy(origin); g.lookAt(origin.x + axis.x, origin.y, origin.z + axis.z);
    (this.beams || (this.beams = [])).push({ g, core, shell, t: 0, origin: origin.clone(), axis: new THREE.Vector3(axis.x, 0, axis.z), length, radius });
    this.ring(origin, 0x8fa8ff, radius * 2.5, 0.9);
    for (let i = 0; i < 6; i++) this.flashLight(_v.set(origin.x + axis.x * i * 12, 2, origin.z + axis.z * i * 12), 0xbfd0ff, 140, 0.6);
  }
  /** Rune-Warden awakening: crimson rune sparks crawl up the body for `seconds`. pose(out) fills a position. */
  runeRise(pose, seconds) { (this.rises || (this.rises = [])).push({ pose, t: 0, life: seconds, p: new THREE.Vector3() }); }
  /** ...and the moment the monster bursts out. */
  runeBurst(pos) {
    for (const [r, l] of [[6, 0.6], [10, 0.9]]) this.ring(pos, 0xff2a3a, r, l);
    for (let i = 0; i < 70; i++) {
      const th = Math.random() * 6.283, ph = Math.random() * 3.14, sp = 3 + Math.random() * 8;
      this.glow.spawn(pos.x, pos.y + 1.2, pos.z, Math.cos(th) * Math.sin(ph) * sp, Math.cos(ph) * sp * 0.7 + 2, Math.sin(th) * Math.sin(ph) * sp, { life: 0.6 + Math.random() * 0.6, size: 0.09, endSize: 0, color: [2.6, 0.3, 0.4], drag: 2, gravity: 3 });
    }
    for (let i = 0; i < 10; i++) this.smoke.spawn(pos.x + rnd(0.6), pos.y + 0.3 + Math.random() * 1.6, pos.z + rnd(0.6), rnd(1.5), 0.8, rnd(1.5), { life: 2.2, size: 0.5, endSize: 2.6, alpha: 0.22, color: [0.2, 0.08, 0.08], drag: 1, spin: rnd(0.5) });
    this.glow.spawn(pos.x, pos.y + 1.4, pos.z, 0, 0, 0, { life: 0.3, size: 3.2, endSize: 0.4, color: [2.6, 0.5, 0.6] });
    this.flashLight(_v.set(pos.x, pos.y + 1.5, pos.z), 0xff3040, 80, 0.4);
  }
  /** Remove beams still on screen (a clash takes over). */
  clearBeams() { if (this.beams) for (const B of this.beams) B.t = Math.max(B.t, 1.4); }
  /**
   * Beam clash: two beams pushing against each other with a blinding flare where they meet.
   * Returns { update(point, k), end(side) } — side 0/1 = which beam won, 'tie' = both detonate.
   */
  beamClash(oa, ob) {
    if (!this.beamMat) this.beamMat = beamMaterial();
    const geo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true); geo.translate(0, 0.5, 0); geo.rotateX(Math.PI / 2);
    const tints = [new THREE.Color(0.25, 0.42, 1.4), new THREE.Color(1.1, 0.3, 1.3)];
    const side = (o, i) => {
      const g = new THREE.Group(); g.position.copy(o); this.scene.add(g);
      const core = new THREE.Mesh(geo, this.beamMat.clone()); core.material.uniforms.core.value = 1;
      const shell = new THREE.Mesh(geo, this.beamMat.clone()); shell.material.uniforms.tint.value = tints[i];
      // drawn on top of everything: the clash is the star of the cutscene, even behind the bus
      for (const m of [core, shell]) { m.frustumCulled = false; m.renderOrder = 14; m.material.depthTest = false; g.add(m); }
      return { g, core, shell, o: o.clone() };
    };
    const S = [side(oa, 0), side(ob, 1)];
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.radialSprite(128, 0, 2.6), color: new THREE.Color(2.2, 2.2, 2.6), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false }));
    flare.renderOrder = 15; this.scene.add(flare);
    const C = { S, flare, point: oa.clone().lerp(ob, 0.5), k: 1, t: 0, ending: -1, winner: null };
    C.update = (point, k) => { C.point.copy(point); C.k = k; };
    C.end = (w) => { C.ending = 0; C.winner = w; };
    (this.clashes || (this.clashes = [])).push(C);
    return C;
  }

  /** Charred ground over the burning half of the alley. zone = { axis, sign } */
  scorch(zone, seconds) {
    if (!this.scorchTex) this.scorchTex = scorchTexture();
    const lenZ = zone.axis === 'z', w = lenZ ? 2 * Sim.HALF_X : Sim.HALF_X, l = lenZ ? Sim.HALF_Z : 2 * Sim.HALF_Z;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshStandardMaterial({ map: this.scorchTex, transparent: true, opacity: 0, depthWrite: false, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2;
    if (lenZ) m.position.set(0, 0.012, zone.sign * Sim.HALF_Z / 2); else { m.position.set(zone.sign * Sim.HALF_X / 2, 0.012, 0); }
    m.receiveShadow = true; this.scene.add(m);
    (this.scorches || (this.scorches = [])).push({ m, t: 0, life: seconds + 8 });
  }
  setSparks(list) { this.sparkSpots = list; }

  // ---------------------------------------------------------------- spawners
  flashLight(pos, color = 0xffaa66, peak = 14, life = 0.06) {
    if (!this.lights.length) return;
    const L = this.lights[this.lightIdx]; this.lightIdx = (this.lightIdx + 1) % this.lights.length;
    L.l.position.copy(pos); L.l.color.set(color); L.life = L.max = life; L.peak = peak;
  }
  muzzleFlash(pos, dir, color = 0xffb070, scale = 0.55) {
    const F = this.flashes[this.flashIdx]; this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    F.s.position.copy(pos); F.s.material.color.set(color).multiplyScalar(3); F.s.material.rotation = Math.random() * 6.28;
    F.s.scale.setScalar(scale * (0.8 + Math.random() * 0.4)); F.s.visible = true; F.life = 0.045;
    this.flashLight(pos, color, 16);
    for (let i = 0; i < 3; i++) this.smoke.spawn(pos.x + dir.x * 0.2, pos.y + dir.y * 0.2, pos.z + dir.z * 0.2, dir.x * 1.2 + rnd(0.3), dir.y * 1.2 + 0.3 + rnd(0.2), dir.z * 1.2 + rnd(0.3),
      { life: 0.7 + Math.random() * 0.4, size: 0.12, endSize: 0.6, alpha: 0.18, color: [0.6, 0.62, 0.68], drag: 2.5, spin: rnd(1) });
  }
  tracer(from, to, color = 0x7ff8ff) {
    const T = this.tracers[this.tracerIdx]; this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    T.from.copy(from); T.to.copy(to); T.dist = from.distanceTo(to); T.travel = 0; T.life = 0.35;
    const c = new THREE.Color(color);
    T.bolt.material.color.copy(c).multiplyScalar(6); T.beam.material.color.copy(c).multiplyScalar(0.9);
    T.bolt.visible = T.beam.visible = true;
    T.beam.position.copy(from); T.beam.lookAt(to); T.beam.scale.set(0.006, 0.006, T.dist);
  }
  shell(pos, vel) {
    const S = this.shells[this.shellIdx]; this.shellIdx = (this.shellIdx + 1) % this.shellMax;
    S.p.copy(pos); S.v.copy(vel); S.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); S.w.set(rnd(25), rnd(25), rnd(25)); S.life = 3.5; S.bounces = 0;
    return S;
  }
  decal(point, normal) {
    _v.set(normal[0], normal[1], normal[2]);
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28));
    const s = 0.7 + Math.random() * 0.6;
    _m.compose(_s.set(point.x + _v.x * 0.004, point.y + _v.y * 0.004, point.z + _v.z * 0.004), _q, new THREE.Vector3(s, s, s));
    this.decals.setMatrixAt(this.decalIdx, _m);
    this.decalIdx = (this.decalIdx + 1) % this.decalMax;
    this.decals.count = Math.min(this.decalMax, this.decals.count + 1);
    this.decals.instanceMatrix.needsUpdate = true;
  }
  /** Bullet impact on world geometry. kind = Sim box kind or 'floor'. */
  impact(point, normal, kind) {
    const n = normal || [0, 1, 0];
    const nx = n[0], ny = n[1], nz = n[2];
    this.decal(point, n);
    const wet = kind === 'floor';
    const metal = !wet && !['facade', 'barrier', 'shack'].includes(kind);
    // hot glow at the hole
    this.glow.spawn(point.x + nx * 0.02, point.y + ny * 0.02, point.z + nz * 0.02, 0, 0, 0, { life: 0.35, size: 0.22, endSize: 0.05, color: [1.6, 0.8, 0.35] });
    const count = metal ? 14 : 7;
    for (let i = 0; i < count; i++) {
      const sp = 3 + Math.random() * 6;
      this.sparks.spawn(point.x, point.y, point.z, (nx + rnd(0.9)) * sp, (ny + rnd(0.9) + 0.3) * sp, (nz + rnd(0.9)) * sp, 0.25 + Math.random() * 0.45, [1, 0.62 + Math.random() * 0.2, 0.25]);
    }
    if (wet) {
      for (let i = 0; i < 10; i++) this.debris.spawn(point.x, 0.03, point.z, rnd(1.2), 1.5 + Math.random() * 2.2, rnd(1.2), { life: 0.5, size: 0.025, color: [0.5, 0.6, 0.75], gravity: 9.8, alpha: 0.7, bounce: false });
    } else {
      for (let i = 0; i < 6; i++) this.debris.spawn(point.x, point.y, point.z, (nx + rnd(0.8)) * 2.5, (ny + rnd(0.8)) * 2.5 + 1, (nz + rnd(0.8)) * 2.5, { life: 0.9, size: 0.02 + Math.random() * 0.02, color: metal ? [0.12, 0.12, 0.14] : [0.3, 0.3, 0.32], gravity: 9.8, bounce: true });
    }
    for (let i = 0; i < 2; i++) this.smoke.spawn(point.x + nx * 0.1, point.y + ny * 0.1, point.z + nz * 0.1, nx * 0.6 + rnd(0.2), ny * 0.6 + 0.25, nz * 0.6 + rnd(0.2),
      { life: 1.2 + Math.random() * 0.6, size: 0.15, endSize: 0.9, alpha: wet ? 0.12 : 0.22, color: [0.5, 0.52, 0.58], drag: 1.8, spin: rnd(0.8) });
  }
  /** Bullet hitting a player: energy burst in their colour. */
  playerHit(point, dir, color, head) {
    const c = new THREE.Color(color);
    const col = [c.r * 2, c.g * 2, c.b * 2];
    for (let i = 0; i < (head ? 22 : 12); i++) {
      const sp = 1.5 + Math.random() * 4;
      this.glow.spawn(point.x, point.y, point.z, (-dir.x + rnd(1)) * sp, (rnd(1) + 0.4) * sp, (-dir.z + rnd(1)) * sp, { life: 0.35 + Math.random() * 0.3, size: 0.06, endSize: 0.01, color: col, drag: 3, gravity: 3 });
    }
    for (let i = 0; i < 8; i++) this.sparks.spawn(point.x, point.y, point.z, (dir.x + rnd(1)) * 5, (dir.y + rnd(1)) * 5 + 1, (dir.z + rnd(1)) * 5, 0.3, [c.r, c.g, c.b]);
    this.glow.spawn(point.x, point.y, point.z, 0, 0, 0, { life: 0.15, size: head ? 0.9 : 0.55, endSize: 0.1, color: col });
  }
  /** Body dissolving into drifting embers and ash (souls-like). */
  embers(pos, color) {
    const c = new THREE.Color(color);
    for (let i = 0; i < 90; i++) {
      const warm = Math.random() < 0.65;
      const col = warm ? [2.4, 0.9 + Math.random() * 0.5, 0.25] : [c.r * 2.5, c.g * 2.5, c.b * 2.5];
      this.glow.spawn(pos.x + rnd(0.45), pos.y + Math.random() * 1.0, pos.z + rnd(0.7), rnd(0.35), 0.5 + Math.random() * 1.2, rnd(0.35),
        { life: 1.6 + Math.random() * 1.8, size: 0.025 + Math.random() * 0.035, endSize: 0, color: col, drag: 0.6, gravity: -0.25 });
    }
    for (let i = 0; i < 6; i++) this.smoke.spawn(pos.x + rnd(0.4), pos.y + Math.random() * 0.6, pos.z + rnd(0.6), rnd(0.2), 0.35, rnd(0.2),
      { life: 2.6, size: 0.35, endSize: 1.8, alpha: 0.2, color: [0.18, 0.16, 0.16], drag: 0.6, spin: rnd(0.4) });
    this.glow.spawn(pos.x, pos.y + 0.4, pos.z, 0, 0, 0, { life: 0.5, size: 1.6, endSize: 0.2, color: [1.6, 0.6, 0.2] });
  }
  death(pos, color) {
    const c = new THREE.Color(color), col = [c.r * 2.5, c.g * 2.5, c.b * 2.5];
    for (let i = 0; i < 35; i++) {
      const th = Math.random() * 6.28, ph = Math.random() * 3.14, sp = 2 + Math.random() * 6;
      this.glow.spawn(pos.x, pos.y + 1, pos.z, Math.cos(th) * Math.sin(ph) * sp, Math.cos(ph) * sp + 2, Math.sin(th) * Math.sin(ph) * sp, { life: 0.6 + Math.random() * 0.8, size: 0.09, endSize: 0, color: col, drag: 2, gravity: 4 });
    }
    for (let i = 0; i < 30; i++) this.sparks.spawn(pos.x, pos.y + 1, pos.z, rnd(8), Math.random() * 8, rnd(8), 0.6 + Math.random() * 0.5, [c.r, c.g, c.b]);
    for (let i = 0; i < 8; i++) this.smoke.spawn(pos.x + rnd(0.4), pos.y + 0.4 + Math.random() * 1.2, pos.z + rnd(0.4), rnd(0.6), 0.6, rnd(0.6), { life: 2, size: 0.4, endSize: 2, alpha: 0.25, color: [0.35, 0.36, 0.42], drag: 1, spin: rnd(0.5) });
    this.glow.spawn(pos.x, pos.y + 1, pos.z, 0, 0, 0, { life: 0.25, size: 1.8, endSize: 0.3, color: col });
    this.ring(pos, color, 4, 0.5);
    this.flashLight(_v.set(pos.x, pos.y + 1, pos.z), color, 60, 0.35);
  }
  ring(pos, color, radius, life) {
    const R = this.rings[this.ringIdx]; this.ringIdx = (this.ringIdx + 1) % this.rings.length;
    R.m.position.set(pos.x, 0.05, pos.z); R.m.material.color.set(color).multiplyScalar(3); R.life = R.max = life; R.r = radius; R.m.visible = true;
  }
  dashTrail(pos, color) {
    const c = new THREE.Color(color);
    for (let i = 0; i < 4; i++) this.glow.spawn(pos.x + rnd(0.3), pos.y + 0.3 + Math.random() * 1.3, pos.z + rnd(0.3), 0, 0.2, 0, { life: 0.35, size: 0.12, endSize: 0, color: [c.r * 2, c.g * 2, c.b * 2] });
  }
  /** Rune-Warden stomp / landing / fist smash: dust billows out, grit and rune sparks kick up. */
  stomp(pos, str) {
    for (let i = 0; i < Math.round(7 * str); i++) this.smoke.spawn(pos.x + rnd(0.8), 0.15, pos.z + rnd(0.8), rnd(2.6) * str, 0.4 + Math.random() * 0.6, rnd(2.6) * str,
      { life: 1.2, size: 0.4, endSize: 1.8 * str, alpha: 0.2, color: [0.35, 0.3, 0.27], drag: 2, spin: rnd(0.5) });
    for (let i = 0; i < Math.round(14 * str); i++) this.debris.spawn(pos.x + rnd(0.5), 0.05, pos.z + rnd(0.5), rnd(3) * str, 2 + Math.random() * 3 * str, rnd(3) * str,
      { life: 0.7, size: 0.03, color: [0.3, 0.28, 0.26], gravity: 9.8, alpha: 0.9 });
    for (let i = 0; i < Math.round(8 * str); i++) this.glow.spawn(pos.x + rnd(0.6), 0.1, pos.z + rnd(0.6), rnd(3), 1 + Math.random() * 2, rnd(3),
      { life: 0.4 + Math.random() * 0.3, size: 0.05, endSize: 0, color: [2.6, 0.3, 0.35], drag: 2, gravity: 4 });
  }
  footSplash(pos) {
    for (let i = 0; i < 4; i++) this.debris.spawn(pos.x + rnd(0.15), 0.03, pos.z + rnd(0.15), rnd(0.8), 0.8 + Math.random(), rnd(0.8), { life: 0.35, size: 0.018, color: [0.45, 0.55, 0.7], gravity: 9.8, alpha: 0.5 });
  }

  // ---------------------------------------------------------------- update
  update(dt, camera) {
    this.time += dt;
    this.glow.update(dt); this.smoke.update(dt); this.debris.update(dt); this.sparks.update(dt);
    for (const T of this.tracers) {
      if (T.life <= 0) continue;
      T.life -= dt;
      T.travel += dt * 320;
      const head = Math.min(T.dist, T.travel), tail = Math.max(0, head - 6);
      if (tail >= T.dist || T.life <= 0) { T.bolt.visible = false; }
      else {
        _v.subVectors(T.to, T.from).normalize();
        T.bolt.position.copy(T.from).addScaledVector(_v, tail);
        T.bolt.lookAt(T.to);
        T.bolt.scale.set(0.012, 0.012, Math.max(0.01, head - tail));
      }
      const a = Math.max(0, T.life / 0.35);
      T.beam.material.opacity = a * a * 0.5;
      if (T.life <= 0) { T.beam.visible = false; T.bolt.visible = false; }
    }
    for (const F of this.flashes) if (F.life > 0) { F.life -= dt; if (F.life <= 0) F.s.visible = false; }
    for (const L of this.lights) {
      if (L.life > 0) { L.life -= dt; L.l.intensity = Math.max(0, L.life / L.max) * L.peak; }
      else if (L.l.intensity !== 0) L.l.intensity = 0;
    }
    for (const R of this.rings) {
      if (R.life <= 0) continue;
      R.life -= dt; const k = 1 - R.life / R.max;
      const s = 0.2 + (1 - Math.pow(1 - k, 3)) * R.r; R.m.scale.set(s, s, s);
      R.m.material.opacity = Math.max(0, 1 - k);
      if (R.life <= 0) R.m.visible = false;
    }
    // shells: simple rigid-body-ish bounce on the floor and box tops
    for (let i = 0; i < this.shellMax; i++) {
      const S = this.shells[i];
      if (S.life <= 0) continue;
      S.life -= dt;
      S.v.y -= 9.8 * dt; S.p.addScaledVector(S.v, dt);
      const ground = groundHeight(S.p.x, S.p.z, S.p.y);
      if (S.p.y < ground + 0.01) {
        S.p.y = ground + 0.01;
        if (S.v.y < -0.6 && S.bounces < 3 && this.onShellBounce) this.onShellBounce(S.p, S.bounces);
        S.bounces++;
        S.v.y *= -0.35; S.v.x *= 0.55; S.v.z *= 0.55; S.w.multiplyScalar(0.5);
        if (Math.abs(S.v.y) < 0.3) { S.v.y = 0; S.w.set(0, S.w.y * 0.9, 0); S.r.x = 0; S.r.z = Math.PI / 2; }
      }
      S.r.x += S.w.x * dt; S.r.y += S.w.y * dt; S.r.z += S.w.z * dt;
      const sc = S.life < 0.5 ? S.life * 2 : 1;
      _m.compose(S.p, _q.setFromEuler(S.r), _s.set(sc, sc, sc));
      this.shellMesh.setMatrixAt(i, _m);
      if (S.life <= 0) this.shellMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
    this.shellMesh.instanceMatrix.needsUpdate = true;
    // steam vents (and black smoke from the burnt bus)
    for (const V of this.vents) {
      V.t -= dt;
      if (V.t > 0) continue;
      if (V.dark) { V.t = 0.2 + Math.random() * 0.15; this.smoke.spawn(V.x + rnd(0.6), V.y || 0.05, V.z + rnd(1.5), rnd(0.2), 0.9 + Math.random() * 0.5, rnd(0.2), { life: 5, size: 0.6, endSize: 4, alpha: 0.18, color: [0.07, 0.065, 0.06], drag: 0.25, spin: rnd(0.3) }); }
      else { V.t = 0.12 + Math.random() * 0.1; this.smoke.spawn(V.x + rnd(0.4), 0.05, V.z + rnd(0.2), rnd(0.15), 0.6 + Math.random() * 0.5, rnd(0.15), { life: 3 + Math.random(), size: 0.3, endSize: 2.2, alpha: 0.1, color: [0.5, 0.52, 0.5], drag: 0.4, spin: rnd(0.3) }); }
    }
    // barrel fires: licking flames, rising embers, a thin column of smoke
    for (const F of this.fires) {
      F.t -= dt; F.e -= dt;
      const k = F.small ? 0.6 : F.big ? 1.6 : 1;
      for (let n = 0; F.t <= 0 && n < 6; n++) { // catch up at low frame rates
        F.t += F.big ? 0.06 : 0.035 / k;
        if (F.big) this.glow.spawn(F.x + rnd(0.8), F.y, F.z + rnd(0.8), rnd(0.3), 1.8 + Math.random() * 1.2, rnd(0.3),
          { life: 0.5 + Math.random() * 0.4, size: 1.1, endSize: 0.15, color: [2.0, 0.6 + Math.random() * 0.3, 0.12], drag: 1.0, gravity: -1.0 });
        else this.glow.spawn(F.x + rnd(0.22 * k), F.y, F.z + rnd(0.22 * k), rnd(0.15), 1.1 + Math.random() * 0.8, rnd(0.15),
          { life: 0.35 + Math.random() * 0.25, size: 0.42 * k, endSize: 0.05, color: [2.2, 0.75 + Math.random() * 0.35, 0.18], drag: 1.2, gravity: -1.2 });
        if (Math.random() < 0.25) this.smoke.spawn(F.x + rnd(0.2), F.y + 0.7, F.z + rnd(0.2), rnd(0.1), 0.9, rnd(0.1), { life: 3, size: 0.25, endSize: 1.6, alpha: 0.16, color: [0.08, 0.07, 0.06], drag: 0.3, spin: rnd(0.4) });
      }
      if (F.e <= 0) {
        F.e = Math.max(F.e, -0.2) + 0.08 + Math.random() * 0.25;
        this.glow.spawn(F.x + rnd(0.2), F.y + 0.2, F.z + rnd(0.2), rnd(0.6), 1.5 + Math.random() * 1.8, rnd(0.6), { life: 1.4 + Math.random(), size: 0.03, endSize: 0, color: [2.6, 1.0, 0.3], drag: 0.6, gravity: -0.4 });
      }
    }
    // snapped cables spit sparks every few seconds
    if (this.sparkSpots.length) {
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 1.5 + Math.random() * 4;
        const S = this.sparkSpots[(Math.random() * this.sparkSpots.length) | 0];
        for (let i = 0; i < 18; i++) this.sparks.spawn(S.x, S.y, S.z, rnd(3), Math.random() * 2, rnd(3), 0.5 + Math.random() * 0.5, [1, 0.85, 0.5]);
        this.glow.spawn(S.x, S.y, S.z, 0, 0, 0, { life: 0.12, size: 0.7, endSize: 0.1, color: [2.5, 2.5, 3] });
        this.flashLight(_v.set(S.x, S.y, S.z), 0xc8d8ff, 18, 0.1);
        if (this.onSpark) this.onSpark(S);
      }
    }
    // rain splashes around the camera
    if (this.Q.rain) {
      const n = Math.round(this.Q.rain / 250);
      for (let i = 0; i < n; i++) {
        const x = camera.position.x + rnd(16), z = camera.position.z + rnd(16);
        const y = groundHeight(x, z, 30);
        this.debris.spawn(x, y + 0.02, z, rnd(0.5), 0.6 + Math.random() * 0.6, rnd(0.5), { life: 0.22, size: 0.012, color: [0.55, 0.65, 0.8], gravity: 9.8, alpha: 0.45 });
      }
    }
    // rune circles: grow, spin, draw sparks inward; flare and vanish when the beam fires
    if (this.circles) for (let i = this.circles.length - 1; i >= 0; i--) {
      const c = this.circles[i];
      c.pose(c.p);
      c.g.position.copy(c.p.pos); c.g.lookAt(c.p.pos.x + c.p.dir.x, c.p.pos.y + c.p.dir.y, c.p.pos.z + c.p.dir.z);
      if (c.state === 'charge') {
        c.t += dt; const k = Math.min(1, c.t / c.duration), e = 1 - Math.pow(1 - Math.min(1, k * 1.4), 3);
        c.g.scale.setScalar(0.05 + e * (1 + Math.sin(this.time * 18) * 0.03 * k));
        c.outer.rotation.z += dt * (0.6 + k * 2); c.inner.rotation.z -= dt * (1.2 + k * 4);
        c.outer.material.opacity = c.inner.material.opacity = Math.min(1, k * 3);
        const R = 1.5 * e;
        for (let n = 0; n < 2 + k * 6; n++) { // sparks drawn into the circle
          const a = Math.random() * 6.283, r = R * (1 + Math.random() * 0.6);
          _v.set(Math.cos(a) * r, Math.sin(a) * r, 0).applyQuaternion(c.g.quaternion).add(c.p.pos);
          const toC = c.p.pos.clone().sub(_v).multiplyScalar(2.5);
          this.glow.spawn(_v.x, _v.y, _v.z, toC.x, toC.y, toC.z, { life: 0.4, size: 0.05, endSize: 0, color: [0.8, 1.0, 2.6], drag: 0.5 });
        }
        if (Math.random() < 0.5) this.flashLight(c.p.pos, 0x8fa8ff, 10 + k * 60, 0.12);
        if (c.t > c.duration + 1.5) c.state = 'gone'; // never fired (shooter died)
      } else if (c.state === 'fire') {
        c.fade += dt; c.g.scale.multiplyScalar(1 + dt * 3);
        c.outer.material.opacity = c.inner.material.opacity = Math.max(0, 1 - c.fade / 0.5);
        if (c.fade > 0.5) c.state = 'gone';
      }
      if (c.state === 'gone') { this.scene.remove(c.g); c.outer.geometry.dispose(); c.inner.geometry.dispose(); c.outer.material.dispose(); c.inner.material.dispose(); this.circles.splice(i, 1); }
    }
    if (this.beams) for (let i = this.beams.length - 1; i >= 0; i--) {
      const B = this.beams[i]; B.t += dt;
      const a = B.t < 0.08 ? B.t / 0.08 : B.t < 0.7 ? 1 : Math.max(0, 1 - (B.t - 0.7) / 0.9);
      for (const m of [B.core, B.shell]) { m.material.uniforms.time.value = this.time; m.material.uniforms.alpha.value = a; }
      B.shell.scale.x = B.radius * (1 + Math.sin(B.t * 40) * 0.04); B.shell.scale.y = B.radius * 0.75 * (1 + Math.cos(B.t * 37) * 0.04);
      if (a > 0.3) for (let n = 0; n < 24; n++) { // sparkles streaming off the beam
        const d = Math.random() * B.length, ang = Math.random() * 6.283, r = B.radius * (0.3 + Math.random() * 0.8);
        const x = B.origin.x + B.axis.x * d - B.axis.z * Math.cos(ang) * r, z = B.origin.z + B.axis.z * d + B.axis.x * Math.cos(ang) * r, y = B.origin.y + Math.sin(ang) * r * 0.7;
        this.glow.spawn(x, Math.max(0.1, y), z, B.axis.x * 6 + rnd(1), rnd(1), B.axis.z * 6 + rnd(1), { life: 0.5 + Math.random() * 0.5, size: 0.06 + Math.random() * 0.06, endSize: 0, color: [1.2, 1.5, 3.0], drag: 1 });
      }
      if (B.t > 1.6) { this.scene.remove(B.g); B.core.material.dispose(); B.shell.material.dispose(); this.beams.splice(i, 1); }
    }
    if (this.rises) for (let i = this.rises.length - 1; i >= 0; i--) {
      const R = this.rises[i]; R.t += dt; R.pose(R.p);
      const k = Math.min(1, R.t / R.life);
      for (let n = 0; n < 2 + k * 6; n++) {
        const a = Math.random() * 6.283, r = 0.35 + Math.random() * 0.15;
        this.glow.spawn(R.p.x + Math.cos(a) * r, R.p.y + Math.random() * 1.8, R.p.z + Math.sin(a) * r, 0, 0.8 + Math.random(), 0, { life: 0.5, size: 0.05 + k * 0.04, endSize: 0, color: [2.6, 0.25 + Math.random() * 0.2, 0.35], drag: 1 });
      }
      if (Math.random() < 0.3) this.flashLight(_v.set(R.p.x, R.p.y + 1.2, R.p.z), 0xff2a3a, 10 + k * 30, 0.12);
      if (R.t >= R.life) this.rises.splice(i, 1);
    }
    if (this.clashes) for (let i = this.clashes.length - 1; i >= 0; i--) {
      const C = this.clashes[i]; C.t += dt;
      let a = 1, p = C.point;
      if (C.ending >= 0) {
        C.ending += dt;
        if (C.winner === 'tie') a = Math.max(0, 1 - C.ending / 0.5);
        else { // the winning beam punches through to the loser
          const target = C.S[1 - C.winner].o; p = C.point.lerp(target, Math.min(1, dt * 6));
          if (C.ending > 0.35) a = Math.max(0, 1 - (C.ending - 0.35) / 0.4);
        }
      }
      C.S.forEach((B, j) => {
        const to = (C.ending >= 0 && C.winner === j) ? C.S[1 - j].o : p, len = Math.max(0.5, B.o.distanceTo(to));
        B.g.lookAt(to.x, B.o.y, to.z);
        const lose = C.ending >= 0 && C.winner !== 'tie' && C.winner !== j ? Math.max(0, 1 - C.ending * 4) : 1;
        const wob = 1 + Math.sin(this.time * 40 + j) * 0.06;
        B.core.scale.set(0.7 * wob, 0.7 * wob, len); B.shell.scale.set(2.4 * wob, 2.0 * wob, len);
        B.core.material.uniforms.alpha.value = a * lose * 0.8; B.shell.material.uniforms.alpha.value = a * lose * 0.6;
        for (const m of [B.core, B.shell]) m.material.uniforms.time.value = this.time;
      });
      // the meeting point: a pulsing star of light throwing sparks and shockwave rings
      C.flare.position.copy(p); C.flare.scale.setScalar((4.4 + Math.sin(this.time * 30) * 0.8 + C.k * 2) * (C.ending >= 0 && C.winner === 'tie' ? 1 + C.ending * 8 : 1));
      C.flare.material.opacity = a * 0.8;
      if (a > 0.2) {
        for (let n = 0; n < 14; n++) {
          const th = Math.random() * 6.283, ph = Math.random() * 3.14, sp = 6 + Math.random() * 14;
          this.glow.spawn(p.x, p.y, p.z, Math.cos(th) * Math.sin(ph) * sp, Math.cos(ph) * sp * 0.6, Math.sin(th) * Math.sin(ph) * sp, { life: 0.4 + Math.random() * 0.3, size: 0.12, endSize: 0, color: Math.random() < 0.5 ? [1.2, 1.5, 3] : [2.4, 0.8, 2.6], drag: 2 });
        }
        if (Math.random() < 0.08) this.ring(p, 0xcfd8ff, 9, 0.5);
        if (Math.random() < 0.4) this.flashLight(p, 0xcfd8ff, 45, 0.12);
      }
      if (C.ending > 0.9 || C.t > 12) {
        for (const B of C.S) { this.scene.remove(B.g); B.core.material.dispose(); B.shell.material.dispose(); }
        this.scene.remove(C.flare); C.flare.material.dispose(); this.clashes.splice(i, 1);
      }
    }
    if (this.scorches) for (let i = this.scorches.length - 1; i >= 0; i--) {
      const S = this.scorches[i]; S.t += dt;
      S.m.material.opacity = Math.min(0.85, S.t * 2) * Math.min(1, Math.max(0, (S.life - S.t) / 4));
      if (S.t > S.life) { this.scene.remove(S.m); S.m.geometry.dispose(); S.m.material.dispose(); this.scorches.splice(i, 1); }
    }
    // the burning half: flickering firelight hops between the flames; spent fires go out
    if (this.burnUntil > this.time && this.burnSpots && Math.random() < 0.35) {
      const f = this.burnSpots[(Math.random() * this.burnSpots.length) | 0];
      this.flashLight(_v.set(f.x, 1.2, f.z), 0xff7a2a, 30 + Math.random() * 20, 0.18);
    }
    if (this.fires.some(f => f.until && f.until < this.time)) this.fires = this.fires.filter(f => !f.until || f.until >= this.time);
    if (this.dust) this.dust.material.uniforms.time.value = this.time;
  }
}

// ------------------------------------------------------------------ beam assets
function runeCircleTextures() {
  const make = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 1024; const x = c.getContext('2d'); x.translate(512, 512); x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.shadowColor = '#9fb4ff'; x.shadowBlur = 18; draw(x); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const ring = (x, r, w) => { x.lineWidth = w; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke(); };
  const glyph = (x, sx, sy, s, seed) => { // invented runes: a few strokes per glyph
    let k = seed;
    const r = () => { k = (k * 16807) % 2147483647; return (k % 1000) / 1000; };
    x.lineWidth = 3; x.beginPath();
    for (let i = 0; i < 3; i++) { x.moveTo(sx + (r() - 0.5) * s, sy + (r() - 0.5) * s); x.lineTo(sx + (r() - 0.5) * s, sy + (r() - 0.5) * s); }
    if (r() > 0.5) { x.moveTo(sx + s * 0.3, sy); x.arc(sx, sy, s * 0.3, 0, Math.PI * 2); }
    x.stroke();
  };
  const outer = make(x => {
    ring(x, 500, 10); ring(x, 470, 4); ring(x, 380, 6); ring(x, 360, 3);
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; x.save(); x.rotate(a); glyph(x, 0, -425, 34, i * 97 + 13); x.restore(); }
    for (let i = 0; i < 6; i++) { // six small circles on the ring, like seals
      const a = i / 6 * Math.PI * 2; x.save(); x.rotate(a); x.translate(0, -265); ring(x, 52, 5); ring(x, 30, 3); glyph(x, 0, 0, 30, i * 31 + 7); x.restore();
    }
  });
  const inner = make(x => {
    ring(x, 330, 6);
    x.lineWidth = 5; x.beginPath(); // hexagram
    for (const off of [0, Math.PI / 3]) { for (let i = 0; i <= 3; i++) { const a = off + i / 3 * Math.PI * 2 - Math.PI / 2; const px = Math.cos(a) * 320, py = Math.sin(a) * 320; if (i) x.lineTo(px, py); else x.moveTo(px, py); } }
    x.stroke();
    ring(x, 160, 5); ring(x, 90, 8);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; x.save(); x.rotate(a); glyph(x, 0, -125, 24, i * 53 + 3); x.restore(); }
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 120); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.arc(0, 0, 120, 0, Math.PI * 2); x.fill();
  });
  return { outer, inner };
}
function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, alpha: { value: 1 }, core: { value: 0 }, tint: { value: new THREE.Color(0.25, 0.4, 1.3) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float time; uniform float alpha; uniform float core; uniform vec3 tint; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float facing = pow(abs(dot(normalize(vN), normalize(vV))), mix(3.0, 1.2, core));
        float flow = n(vec2(vUv.x * 18.0, vUv.y * 60.0 - time * 40.0)) * 0.5 + n(vec2(vUv.x * 40.0, vUv.y * 140.0 - time * 70.0)) * 0.5;
        float tip = smoothstep(0.0, 0.01, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
        // fade surfaces right next to the camera so standing beside (or inside) the beam isn't a white wall
        float near = smoothstep(1.5, 12.0, length(vV));
        vec3 col = mix(tint, vec3(1.6, 1.75, 2.1), core);
        float a = facing * (0.35 + flow * 0.65) * tip * alpha * near * (core > 0.5 ? 1.1 : 0.32);
        gl_FragColor = vec4(col * a, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
  });
}
function scorchTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  for (let i = 0; i < 260; i++) {
    const px = Math.random() * 512, py = Math.random() * 512, r = 10 + Math.random() * 60;
    const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(8,6,5,0.75)'); g.addColorStop(1, 'rgba(8,6,5,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
  }
  for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(255,${80 + Math.random() * 60 | 0},20,${0.3 + Math.random() * 0.4})`; x.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3); } // glowing cinders
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 5);
  return t;
}
const rnd = s => (Math.random() * 2 - 1) * s;
/** Height of the highest walkable surface under (x,z) that is below y. */
export function groundHeight(x, z, y) {
  let g = 0;
  for (const b of Sim.boxes) {
    if (b.solid && x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] && b.max[1] <= y + 0.05 && b.max[1] > g) g = b.max[1];
  }
  return g;
}
