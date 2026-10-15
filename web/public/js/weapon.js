// First-person energy rifle: detailed PBR model, arms, recoil springs, sway, bob,
// aim-down-sights, keyframed reload, muzzle flash and an on-gun ammo display.
import * as THREE from 'three';
import * as TX from './textures.js';
import { buildRifle } from './gunmodel.js';
import { buildSword, buildShotgun, emberMaterial, buildSniper, arcMaterial } from './classgear.js';
import { buildWarden } from './warden.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const Sim = window.NeonSim;

class Spring {
  constructor(k = 180, c = 18) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  kick(v) { this.v += v; }
  update(dt) {
    // fixed sub-steps keep the spring stable at any frame rate
    const n = Math.ceil(dt / 0.004), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (-this.k * this.x - this.c * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
}
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

export class Weapon {
  constructor(envMap) {
    this.scene = new THREE.Scene();
    this.scene.environment = envMap;
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);
    this.camera.userData.noReflect = true;

    // viewmodel lighting
    this.scene.add(new THREE.HemisphereLight(0x7a8cc0, 0x1a1024, 2.2));
    const key = new THREE.DirectionalLight(0xd0dcff, 3.2); key.position.set(1, 2, 0.6); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff3dc8, 2.6); rim.position.set(-2, 0.8, -1); this.scene.add(rim);
    const rim2 = new THREE.DirectionalLight(0x00e5ff, 2.2); rim2.position.set(2, -0.2, -1.5); this.scene.add(rim2);
    this.flashLight = new THREE.PointLight(0xffb070, 0, 2.5, 2); this.scene.add(this.flashLight);

    this.root = new THREE.Group(); this.scene.add(this.root);   // sway/bob/recoil applied here
    this.gun = new THREE.Group(); this.root.add(this.gun);
    this.buildRifle();
    this.buildArms();
    this.buildKnightGear();
    this.mode = 'rifle'; this.swingT = -1; this.swingDir = 1; this.pumpT = -1; this.surge = 0;

    this.recoilZ = new Spring(220, 22); this.recoilRot = new Spring(160, 16); this.recoilYaw = new Spring(140, 14); this.recoilRoll = new Spring(120, 12);
    this.landY = new Spring(120, 14);
    this.swayX = 0; this.swayY = 0; this.bobPhase = 0; this.bobAmt = 0;
    this.aim = 0; this.equip = 0; this.flash = 0; this.lowerT = 0;
    this.hip = new THREE.Vector3(0.15, -0.17, -0.46);
    this.ads = new THREE.Vector3(0, -this.sightY, -0.3);
    this.reloadT = -1; this.lastAmmo = -1; this.inspectT = -1; this.heat = 0;
    this.events = {}; // callbacks for reload sound cues
  }

  buildRifle() {
    this.energyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x00f5ff).multiplyScalar(2.2) });
    const rifle = buildRifle({ energy: this.energyMat });
    const G = this.gun;
    G.add(rifle.group);
    const metal = rifle.mats.metal;
    const box = (w, h, d, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.x = rx; G.add(o); return o; };
    this.muzzle = rifle.muzzle; this.mag = rifle.mag; this.magHome = rifle.magHome; this.rifleMuzzle = rifle.muzzle;
    this.handle = rifle.handle; this.handleHome = rifle.handleHome; this.coils = rifle.coils; this.cell = rifle.cell;
    // dangling charm on the sling point: a little neon skull on a chain (simple pendulum)
    this.charm = new THREE.Group(); rifle.charmPivot.add(this.charm);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.045, 4), rifle.mats.chrome); chain.position.y = -0.0225; this.charm.add(chain);
    const skull = new THREE.Group(); skull.position.y = -0.052; this.charm.add(skull);
    const charmGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2fb9).multiplyScalar(2.5) });
    skull.add(new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), charmGlow));
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.006, 0.008), charmGlow); jaw.position.y = -0.008; skull.add(jaw);
    this.charmAng = new THREE.Vector2(); this.charmVel = new THREE.Vector2(); this.prevRootPos = new THREE.Vector3();
    // holographic sight
    this.sightY = 0.088;
    box(0.008, 0.05, 0.05, metal, -0.026, 0.078, -0.03); box(0.008, 0.05, 0.05, metal, 0.026, 0.078, -0.03);
    box(0.06, 0.008, 0.05, metal, 0, 0.104, -0.03);
    box(0.06, 0.02, 0.07, metal, 0, 0.062, -0.03);
    const rc = document.createElement('canvas'); rc.width = rc.height = 128;
    const rx = rc.getContext('2d'); rx.strokeStyle = '#ff2fb9'; rx.fillStyle = '#ff2fb9'; rx.shadowColor = '#ff2fb9'; rx.shadowBlur = 8; rx.lineWidth = 5;
    rx.beginPath(); rx.arc(64, 64, 40, 0, Math.PI * 2); rx.stroke(); rx.beginPath(); rx.arc(64, 64, 6, 0, Math.PI * 2); rx.fill();
    for (const a of [0, 1, 2, 3]) { rx.save(); rx.translate(64, 64); rx.rotate(a * Math.PI / 2); rx.fillRect(-2, -58, 4, 12); rx.restore(); }
    const rtex = new THREE.CanvasTexture(rc); rtex.colorSpace = THREE.SRGBColorSpace;
    this.reticle = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.045), new THREE.MeshBasicMaterial({ map: rtex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2, 2, 2) }));
    this.reticle.position.set(0, this.sightY, -0.04); G.add(this.reticle);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.046, 0.04), new THREE.MeshPhysicalMaterial({ color: 0x66ffee, transparent: true, opacity: 0.12, roughness: 0, metalness: 0, clearcoat: 1, envMapIntensity: 2 }));
    glass.position.set(0, 0.08, -0.05); G.add(glass);
    // on-gun ammo display
    this.ammoCanvas = document.createElement('canvas'); this.ammoCanvas.width = 128; this.ammoCanvas.height = 64;
    this.ammoTex = new THREE.CanvasTexture(this.ammoCanvas); this.ammoTex.colorSpace = THREE.SRGBColorSpace;
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.03), new THREE.MeshBasicMaterial({ map: this.ammoTex, color: new THREE.Color(2.2, 2.2, 2.2), transparent: true }));
    disp.position.set(-0.0362, 0.02, 0.05); disp.rotation.y = -Math.PI / 2; G.add(disp);
    // muzzle flash: crossed planes + front sprite
    const ft = TX.flashSprite(256);
    const fm = new THREE.MeshBasicMaterial({ map: ft, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(4, 3, 2.2) });
    this.flashGroup = new THREE.Group(); this.flashGroup.position.copy(this.muzzle.position); G.add(this.flashGroup);
    for (const r of [0, Math.PI / 2]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.36), fm); p.rotation.set(Math.PI / 2, r, 0); p.position.z = -0.14; this.flashGroup.add(p); }
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), fm); front.position.z = -0.02; this.flashGroup.add(front);
    this.flashFront = front;
    this.flashGroup.visible = false;
    this.ejectPort = rifle.ejectPort; this.rifleEject = rifle.ejectPort;
    G.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  }

  buildArms() {
    // Right: chrome cyberware forearm with glowing seams. Left: a battered plate gauntlet over cloth wraps.
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc9d2e0, roughness: 0.12, metalness: 1, envMapIntensity: 2.6 });
    const chromeDark = new THREE.MeshStandardMaterial({ color: 0x8a94a6, roughness: 0.2, metalness: 1, envMapIntensity: 2.2 });
    const glowStrip = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5f56).multiplyScalar(3) });
    const pm = TX.armorPlateMaps(256, [0.16, 0.16, 0.18]);
    const plate = new THREE.MeshStandardMaterial({ map: pm.map, normalMap: pm.normalMap, roughnessMap: pm.roughnessMap, metalnessMap: pm.metalnessMap, roughness: 1, metalness: 1, envMapIntensity: 1.6 });
    const cm = TX.clothMaps(128, [0.11, 0.09, 0.08]);
    const wrap = new THREE.MeshStandardMaterial({ map: cm.map, normalMap: cm.normalMap, roughness: 0.95, metalness: 0 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.7, metalness: 0 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xb8892e, roughness: 0.3, metalness: 1, envMapIntensity: 2 });
    const mesh = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m; };
    const fingers = (g, mat) => {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) g.add(mesh(new RoundedBoxGeometry(0.011, 0.012, 0.022, 2, 0.003), mat, -0.018 + i * 0.012, -0.012 - j * 0.014, -0.05 - j * 0.012, 0.5 + j * 0.5));
      g.add(mesh(new RoundedBoxGeometry(0.012, 0.012, 0.03, 2, 0.003), mat, 0.03, -0.005, -0.03, 0.2, -0.5));
    };
    const cyberArm = () => {
      const g = new THREE.Group();
      g.add(mesh(new RoundedBoxGeometry(0.055, 0.04, 0.08, 3, 0.012), chromeDark, 0, 0, 0));
      fingers(g, chrome);
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.32, 16), chrome, 0, 0, 0.2, Math.PI / 2));
      g.add(mesh(new RoundedBoxGeometry(0.075, 0.03, 0.18, 2, 0.01), chromeDark, 0, 0.035, 0.16));
      g.add(mesh(new THREE.BoxGeometry(0.006, 0.006, 0.14), glowStrip, 0, 0.052, 0.16));
      for (const [ang, z] of [[0.9, 0.12], [-0.9, 0.22], [2.4, 0.3]]) g.add(mesh(new THREE.BoxGeometry(0.004, 0.004, 0.09), glowStrip, Math.sin(ang) * 0.042, Math.cos(ang) * 0.042 - 0.005, z));
      g.add(mesh(new THREE.TorusGeometry(0.04, 0.004, 6, 20), glowStrip, 0, 0, 0.06));
      // exposed hydraulic pistons along the underside
      for (const sx of [-0.018, 0.018]) g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 6), chrome, sx, -0.04, 0.2, Math.PI / 2));
      return g;
    };
    const gauntlet = () => {
      const g = new THREE.Group();
      g.add(mesh(new RoundedBoxGeometry(0.058, 0.042, 0.08, 3, 0.012), plate, 0, 0, 0));
      fingers(g, plate);
      g.add(mesh(new THREE.CylinderGeometry(0.036, 0.044, 0.32, 14), wrap, 0, 0, 0.2, Math.PI / 2));
      // overlapping lames up the forearm with a gilded edge
      for (let i = 0; i < 4; i++) {
        const l = mesh(new RoundedBoxGeometry(0.086 - i * 0.002, 0.034, 0.06, 2, 0.012), plate, 0, 0.022, 0.06 + i * 0.05, -0.08);
        g.add(l);
        g.add(mesh(new THREE.BoxGeometry(0.08, 0.004, 0.006), gold, 0, 0.04, 0.032 + i * 0.05));
      }
      for (const z of [0.1, 0.24]) g.add(mesh(new THREE.TorusGeometry(0.046, 0.006, 6, 18), leather, 0, 0, z));
      return g;
    };
    const finish = g => { g.traverse(o => { if (o.isMesh) o.frustumCulled = false; }); return g; };
    this.makeCyberArm = () => finish(cyberArm()); this.makeGauntlet = () => finish(gauntlet());
    this.rightArm = finish(cyberArm()); this.rightArm.position.set(0.0, -0.09, 0.08); this.rightArm.rotation.set(0.35, 0.25, 0); this.gun.add(this.rightArm);
    this.leftArm = finish(gauntlet()); this.leftHome = new THREE.Vector3(-0.005, -0.045, -0.36); this.leftArm.position.copy(this.leftHome);
    this.leftArm.rotation.set(0.25, -0.55, 0.3); this.leftHomeRot = this.leftArm.rotation.clone(); this.gun.add(this.leftArm);
  }

  /** Knight: greatsword (one-handed, Souls-style) and the shotgun it transforms into. */
  buildKnightGear() {
    this.ember = emberMaterial(1.7); this.emberBase = this.ember.color.clone();
    // ---- greatsword
    this.swordRig = new THREE.Group(); this.root.add(this.swordRig);
    this.swordHome = new THREE.Vector3(0.14, -0.1, 0.02);
    this.swordRest = [0, 0, 0, -0.95, 0.15, 0.16];
    this.swordPivot = new THREE.Group(); this.swordPivot.position.copy(this.swordHome); this.swordRig.add(this.swordPivot);
    this.sword = buildSword({ glow: this.ember });
    this.sword.group.position.y = 0.06; this.sword.group.scale.setScalar(0.74); this.swordPivot.add(this.sword.group);
    this.swordArm = this.makeCyberArm(); this.swordArm.position.copy(this.swordHome); this.swordArm.rotation.set(0.5, 0.3, 0); this.swordRig.add(this.swordArm);
    // slash arc: an ember ribbon that flashes along the swing
    const ac = document.createElement('canvas'); ac.width = 256; ac.height = 16;
    const ax = ac.getContext('2d'), gr = ax.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, 'rgba(255,90,31,0)'); gr.addColorStop(0.7, 'rgba(255,140,60,.55)'); gr.addColorStop(1, 'rgba(255,230,200,1)');
    ax.fillStyle = gr; ax.fillRect(0, 0, 256, 16);
    const at = new THREE.CanvasTexture(ac); at.colorSpace = THREE.SRGBColorSpace;
    // the arc is the path of the sword tip around the hand: from straight up (80 deg) to down-left (200 deg)
    const A0 = 1.4, AL = 2.1;
    const arcGeo = new THREE.RingGeometry(0.4, 0.5, 40, 1, A0, AL);
    const uv = arcGeo.attributes.uv, pos = arcGeo.attributes.position; // u runs along the arc: bright head at the end
    for (let i = 0; i < uv.count; i++) { let a = Math.atan2(pos.getY(i), pos.getX(i)); if (a < 0) a += Math.PI * 2; uv.setXY(i, (a - A0) / AL, 0.5); }
    this.slashArc = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ map: at, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.6, 1.3, 1.1), opacity: 0 }));
    this.slashArc.frustumCulled = false; this.slashArc.visible = false; this.scene.add(this.slashArc);
    // ---- shotgun
    this.shotgunRig = new THREE.Group(); this.root.add(this.shotgunRig);
    this.sg = buildShotgun({ glow: this.ember }); this.shotgunRig.add(this.sg.group);
    const ra = this.makeCyberArm(); ra.position.set(0.0, -0.11, 0.1); ra.rotation.set(0.4, 0.25, 0); this.shotgunRig.add(ra);
    const la = this.makeGauntlet(); la.position.set(-0.01, -0.035, 0.02); la.rotation.set(0.25, -0.55, 0.3); this.sg.pump.add(la);
    this.adsShotgun = new THREE.Vector3(0, -0.05, -0.34);
    this.swordRig.visible = this.shotgunRig.visible = false;
    // ---- assassin sniper rifle
    this.arc = arcMaterial(2.0); this.arcBase = this.arc.color.clone();
    this.sniperRig = new THREE.Group(); this.root.add(this.sniperRig);
    this.sn = buildSniper({ glow: this.arc }); this.sniperRig.add(this.sn.group);
    const sra = this.makeCyberArm(); sra.position.set(0.0, -0.11, 0.1); sra.rotation.set(0.4, 0.25, 0); this.sniperRig.add(sra);
    const sla = this.makeGauntlet(); sla.position.set(-0.005, -0.05, -0.42); sla.rotation.set(0.25, -0.55, 0.3); this.sniperRig.add(sla);
    this.adsSniper = new THREE.Vector3(0, -this.sn.scopeY, -0.2);
    this.sniperRig.visible = false;
    this.boltT = -1; this.charge = 0;
    this.guardK = 0; this.leapK = 0; this.slamT = -1; this.joltT = -1; this.joltK = 1; this.guarding = false; this.leaping = false;
    // ---- Rune-Warden: your own monstrous forearms (borrowed from the third-person model)
    this.clawRig = new THREE.Group(); this.root.add(this.clawRig);
    const w = buildWarden();
    // long hooked claw fingers, like the animated Warden's
    for (const A of [w.armL, w.armR]) {
      A.hand.children.filter(o => o.geometry && o.geometry.type === 'ConeGeometry').forEach((o, f) => { o.scale.set(1.2, 2.4, 1.2); o.position.x *= 1.6; o.position.y -= 0.03; o.rotation.z += (f - 1.5) * 0.18; });
    }
    this.clawHands = [w.armR.hand, w.armL.hand]; this.clawIntro = 9; this.clawN = 0; this.clawAir = 0;
    this.clawArms = [w.armR.el, w.armL.el].map((el, i) => {
      el.parent.remove(el); const holder = new THREE.Group(); holder.add(el); el.position.set(0, 0, 0); el.rotation.set(0, 0, 0);
      // elbows just below/behind the view edges, forearms reaching forward and slightly inward
      holder.userData.home = i ? new THREE.Vector3(-0.55, -0.1, 0.12) : new THREE.Vector3(0.25, -0.1, 0.12);
      holder.userData.rot = i ? new THREE.Euler(1.62, -0.22, 0.5, "YXZ") : new THREE.Euler(1.62, 0.22, -0.5, "YXZ");
      holder.rotation.order = 'YXZ';
      holder.position.copy(holder.userData.home); holder.rotation.copy(holder.userData.rot); holder.scale.setScalar(0.6);
      holder.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
      this.clawRig.add(holder); return holder;
    });
    this.wardenGlow = w.glow;
    const cc = document.createElement('canvas'); cc.width = 256; cc.height = 16;
    const cx = cc.getContext('2d'), cg = cx.createLinearGradient(0, 0, 256, 0);
    cg.addColorStop(0, 'rgba(255,20,40,0)'); cg.addColorStop(0.7, 'rgba(255,40,60,.6)'); cg.addColorStop(1, 'rgba(255,200,205,1)');
    cx.fillStyle = cg; cx.fillRect(0, 0, 256, 16);
    this.swordArcTex = this.slashArc.material.map;
    this.clawArcTex = new THREE.CanvasTexture(cc); this.clawArcTex.colorSpace = THREE.SRGBColorSpace;
    this.clawRig.visible = false; this.clawT = -1; this.clawSide = 1;
  }

  /** 'rifle' | 'sword' | 'shotgun' */
  setMode(mode) {
    if (mode === this.mode) return;
    const prev = this.mode; this.mode = mode;
    this.gun.visible = mode === 'rifle'; this.swordRig.visible = mode === 'sword'; this.shotgunRig.visible = mode === 'shotgun';
    this.sniperRig.visible = mode === 'sniper'; this.clawRig.visible = mode === 'claws';
    const host = mode === 'shotgun' ? this.sg : mode === 'sniper' ? this.sn : null;
    if (host) { this.muzzle = host.muzzle; this.ejectPort = host.ejectPort; host.group.add(this.flashGroup); this.flashGroup.position.copy(host.muzzle.position); }
    else { this.muzzle = this.rifleMuzzle; this.ejectPort = this.rifleEject; this.gun.add(this.flashGroup); this.flashGroup.position.copy(this.rifleMuzzle.position); }
    this.swingT = -1; this.pumpT = -1; this.inspectT = -1; this.slashArc.visible = false;
    if (mode === 'claws') { this.clawIntro = 0; this.clawN = 0; }
    if (prev !== 'rifle' || mode !== 'rifle') { this.equip = 0; if (mode === 'shotgun' || prev === 'shotgun') this.surge = 1; }
  }

  /** Knight: a hit landed on your guard (parry = a sharp ring and a bigger jolt). */
  guardHit(parry) { this.joltT = 0; this.joltK = parry ? 1.5 : 1; if (parry) this.surge = 1; }
  /** Cinder Crash: blade overhead for the leap... */
  crashLeap() { this.leaping = true; this.surge = 1; }
  /** ...and down into the street. */
  slam() { this.leaping = false; this.slamT = 0; this.landY.kick(-1.2); this.surge = 1; }

  /** Greatsword swing (alternates forehand / backhand). */
  swing() {
    if (this.mode === 'claws') { this.clawT = 0; this.clawSide = -this.clawSide; this.clawN++; this.clawSlamming = this.clawN % 3 === 0; this.slamKicked = false; return; }
    this.swingT = 0; this.swingDir = -this.swingDir; this.inspectT = -1;
  }

  drawAmmo(ammo, reloading) {
    const c = this.ammoCanvas.getContext('2d');
    c.clearRect(0, 0, 128, 64);
    c.fillStyle = 'rgba(0,20,30,.85)'; c.fillRect(0, 0, 128, 64);
    const low = ammo <= 6;
    c.fillStyle = reloading ? '#ffa23a' : low ? '#ff3b6b' : '#00f5ff';
    c.font = '700 40px Orbitron, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(reloading ? '--' : String(ammo).padStart(2, '0'), 64, 34);
    this.ammoTex.needsUpdate = true;
    const k = reloading ? 0.5 : low ? 1.8 : 2.2;
    this.energyBase = new THREE.Color(low && !reloading ? 0xff3b6b : 0x00f5ff).multiplyScalar(k);
  }

  fire(aiming) {
    if (this.mode === 'sniper') {
      const k = aiming ? 0.5 : 1;
      this.recoilZ.kick(3.0 * k); this.recoilRot.kick((10 + Math.random() * 2) * k);
      this.recoilYaw.kick((Math.random() - 0.5) * 2 * k); this.recoilRoll.kick((Math.random() - 0.5) * 5 * k);
      this.flash = 0.06; this.flashGroup.visible = !aiming; this.flashGroup.rotation.z = Math.random() * Math.PI;
      this.flashGroup.scale.setScalar(1.2); this.flashLight.intensity = 5;
      this.boltT = 0; this.inspectT = -1;
      return;
    }
    if (this.mode === 'shotgun') {
      const k = aiming ? 0.7 : 1;
      this.recoilZ.kick(3.4 * k); this.recoilRot.kick((13 + Math.random() * 3) * k);
      this.recoilYaw.kick((Math.random() - 0.5) * 4 * k); this.recoilRoll.kick((Math.random() - 0.5) * 10 * k);
      this.flash = 0.07; this.flashGroup.visible = true; this.flashGroup.rotation.z = Math.random() * Math.PI;
      this.flashGroup.scale.setScalar(1.3 + Math.random() * 0.4); this.flashLight.intensity = 6;
      this.pumpT = 0; this.surge = Math.min(1, this.surge + 0.6); this.inspectT = -1;
      return;
    }
    const k = aiming ? 0.55 : 1;
    this.recoilZ.kick(1.6 * k);
    this.recoilRot.kick((5 + Math.random() * 2) * k);
    this.recoilYaw.kick((Math.random() - 0.5) * 3 * k);
    this.recoilRoll.kick((Math.random() - 0.5) * 6 * k);
    this.flash = 0.05;
    this.flashGroup.visible = true;
    this.flashGroup.rotation.z = Math.random() * Math.PI;
    this.flashGroup.scale.setScalar(0.8 + Math.random() * 0.5);
    this.flashLight.intensity = 3;
    this.heat = Math.min(1.5, (this.heat || 0) + 0.45);
    this.inspectT = -1;
  }
  /** Weapon inspect (F): turn the rifle over to admire it. */
  inspect() { if (this.inspectT < 0 && this.reloadT < 0 && this.aim < 0.2) this.inspectT = 0; }
  land(strength) { this.landY.kick(-Math.min(1.5, strength) * 0.6); }
  respawn() { this.equip = 0; }

  /** World-space position of the muzzle, mapped from viewmodel space into the main camera. */
  muzzleWorld(mainCamera, out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    this.muzzle.getWorldPosition(out); // in viewmodel camera space (vm camera sits at the origin)
    return mainCamera.localToWorld(out);
  }
  ejectWorld(mainCamera, out = new THREE.Vector3()) {
    this.ejectPort.getWorldPosition(out);
    return mainCamera.localToWorld(out);
  }

  /**
   * s: { dt, moveSpeed, grounded, aiming, mouseDX, mouseDY, reloadTicks, ammo, alive, dashing }
   */
  update(s) {
    const dt = s.dt;
    if (s.mode) this.setMode(s.mode);
    const rifle = this.mode === 'rifle';
    // ammo display
    const reloading = rifle && s.reloadTicks > 0;
    const key = s.ammo * 2 + (reloading ? 1 : 0);
    if (rifle && key !== this.lastAmmo) { this.lastAmmo = key; this.drawAmmo(s.ammo, reloading); }
    if (this.mode === 'shotgun') this.sg.lamps.forEach((l, i) => { l.visible = i < s.ammo; });

    const snReload = this.mode === 'sniper' && s.reloadTicks > 0;
    this.aim = lerp(this.aim, s.aiming && !reloading && !snReload && s.alive && this.mode !== 'sword' && this.mode !== 'claws' && this.boltT < 0 ? 1 : 0, 1 - Math.exp(-dt * (this.mode === 'sniper' ? 10 : 14)));
    this.equip = Math.min(1, this.equip + dt * 2.2);
    this.lowerT = lerp(this.lowerT, s.alive ? 0 : 1, 1 - Math.exp(-dt * 6));
    const aimK = 1 - this.aim * 0.85;

    // sway: weapon lags behind mouse motion
    this.swayX = lerp(this.swayX, THREE.MathUtils.clamp(-s.mouseDX * 0.0009, -0.05, 0.05) * aimK, 1 - Math.exp(-dt * 10));
    this.swayY = lerp(this.swayY, THREE.MathUtils.clamp(s.mouseDY * 0.0009, -0.05, 0.05) * aimK, 1 - Math.exp(-dt * 10));
    // bob
    const speedK = Math.min(1, s.moveSpeed / Sim.MOVE_SPEED) * (s.grounded ? 1 : 0.15);
    this.bobAmt = lerp(this.bobAmt, speedK, 1 - Math.exp(-dt * 8));
    this.bobPhase += dt * (6 + s.moveSpeed * 0.9);
    const bobX = Math.sin(this.bobPhase) * 0.011 * this.bobAmt * aimK;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.009 * this.bobAmt * aimK;
    const idle = Math.sin(performance.now() * 0.0012) * 0.0025 * aimK;

    const rz = this.recoilZ.update(dt), rr = this.recoilRot.update(dt), ry = this.recoilYaw.update(dt), rl = this.recoilRoll.update(dt), ly = this.landY.update(dt);

    // reload keyframes (synced to the simulation's reload timer)
    let rlT = -1;
    if (reloading) rlT = 1 - s.reloadTicks / Sim.RELOAD_TICKS;
    this.animateReload(rlT);
    if (this.mode === 'sword') this.animateSwing(dt);
    if (this.mode === 'claws') this.animateClaws(dt, s);
    if (this.mode === 'shotgun') this.animatePump(dt);
    if (this.mode === 'sniper') { this.animateBolt(dt, snReload ? 1 - s.reloadTicks / Sim.SNIPER_RELOAD_TICKS : -1); if (snReload) rlT = 1 - s.reloadTicks / Sim.SNIPER_RELOAD_TICKS; }
    // Obliteration Beam charge-up: the rifle hums, trembles and its arc lights burn brighter
    this.charge = s.charging || 0;
    this.arc.color.copy(this.arcBase).multiplyScalar(1 + this.charge * 5 + (s.ultReady ? 0.6 + Math.sin(performance.now() * 0.008) * 0.4 : 0));
    // ember glow surges on transformation and shotgun blasts
    this.surge = Math.max(0, this.surge - dt * 1.8);
    this.ember.color.copy(this.emberBase).multiplyScalar(1 + this.surge * 2.5 + Math.sin(performance.now() * 0.005) * 0.1 + (s.blaze ? 2.2 + Math.sin(performance.now() * 0.012) * 0.7 : 0));
    this.guarding = !!s.guard && this.mode === 'sword'; this.knightDt = dt;
    if (!s.blaze) this.leaping = false;

    const base = new THREE.Vector3().lerpVectors(this.hip, this.mode === 'shotgun' ? this.adsShotgun : this.mode === 'sniper' ? this.adsSniper : this.ads, ease(this.aim));
    if (this.charge > 0) { const k = this.charge * 0.006; base.x += (Math.random() - 0.5) * k; base.y += (Math.random() - 0.5) * k; base.z += 0.04 * this.charge; }
    const tiltIn = rlT >= 0 ? ease(seg(rlT, 0, 0.15)) * (1 - ease(seg(rlT, 0.82, 1))) : 0;
    const dashTilt = s.dashing ? 1 : 0;
    this.dashT = lerp(this.dashT || 0, dashTilt, 1 - Math.exp(-dt * 12));
    this.root.position.set(
      base.x + bobX + this.swayX * 0.6,
      base.y + bobY + idle + ly * 0.05 - (1 - ease(this.equip)) * 0.3 - this.lowerT * 0.4 - tiltIn * 0.03,
      base.z + rz * 0.035 * (1 - this.aim * 0.4)
    );
    this.root.rotation.set(
      rr * 0.035 + this.swayY + tiltIn * 0.35 - (1 - ease(this.equip)) * 0.6 + this.dashT * 0.1,
      ry * 0.02 + this.swayX + tiltIn * 0.25,
      rl * 0.01 + bobX * 1.5 + tiltIn * 0.55 - this.dashT * 0.25
    );
    // inspect animation: keyframed pose offsets, cancelled by aiming, reloading or dying
    if (this.inspectT >= 0) {
      if (reloading || s.aiming || !s.alive) this.inspectT = -1;
      else {
        this.inspectT += dt / 2.6;
        const K = [[0, [0, 0, 0, 0, 0, 0]], [0.18, [-0.1, 0.06, 0.1, 0.15, 1.0, 0.45]], [0.48, [-0.1, 0.07, 0.1, 0.2, 1.1, 0.5]],
          [0.66, [0.0, 0.07, 0.08, 0.1, -0.7, -0.55]], [0.86, [0.0, 0.06, 0.08, 0.05, -0.75, -0.5]], [1, [0, 0, 0, 0, 0, 0]]];
        const t = Math.min(1, this.inspectT);
        let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
        const k = ease(seg(t, K[i][0], K[i + 1][0])), a = K[i][1], b = K[i + 1][1], v = a.map((x, j) => lerp(x, b[j], k));
        this.root.position.x += v[0]; this.root.position.y += v[1]; this.root.position.z += v[2];
        this.root.rotation.x += v[3]; this.root.rotation.y += v[4]; this.root.rotation.z += v[5];
        if (this.inspectT >= 1) this.inspectT = -1;
      }
    }
    // charm pendulum: hangs "down" in view space and swings with the rifle's motion
    const vel = this.root.position.clone().sub(this.prevRootPos).divideScalar(Math.max(dt, 1e-3));
    this.prevRootPos.copy(this.root.position);
    const n = Math.ceil(dt / 0.004), h = dt / n;
    for (let j = 0; j < n; j++) {
      this.charmVel.x += (-60 * Math.sin(this.charmAng.x) - 3 * this.charmVel.x) * h;
      this.charmVel.y += (-60 * Math.sin(this.charmAng.y) - 3 * this.charmVel.y) * h;
      this.charmAng.x += this.charmVel.x * h; this.charmAng.y += this.charmVel.y * h;
    }
    if (this.lastVel) { this.charmVel.x += (vel.z - this.lastVel.z) * 1.5; this.charmVel.y -= (vel.x - this.lastVel.x) * 1.5; }
    this.lastVel = vel;
    this.charm.rotation.set(-this.root.rotation.x + this.charmAng.x, 0, -this.root.rotation.z + this.charmAng.y);
    // plasma coils run hotter while firing, with a travelling pulse down the barrel
    this.heat = Math.max(0, this.heat - dt * 1.6);
    if (this.energyBase) this.energyMat.color.copy(this.energyBase).multiplyScalar(1 + this.heat * 1.4 + Math.sin(performance.now() * 0.004) * 0.08);
    const tt = performance.now() * 0.012;
    this.coils.forEach((c, j) => { const p = 1 + Math.max(0, Math.sin(tt - j * 0.9)) * 0.12 * (0.3 + this.heat); c.scale.set(p, p, 1); });
    // muzzle flash decay
    if (this.flash > 0) {
      this.flash -= dt;
      this.flashFront.material.opacity = 1;
      if (this.flash <= 0) this.flashGroup.visible = false;
    }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 70);
    this.flashLight.position.set(this.root.position.x, this.root.position.y + 0.05, this.root.position.z - 0.6);
    this.reticle.material.opacity = 0.3 + this.aim * 0.7;
    this.reticle.visible = rifle;
    // looking through the sniper scope: the HUD draws the scope, the rifle itself is hidden
    this.scoped = this.mode === 'sniper' && this.aim > 0.9;
    this.root.visible = this.lowerT < 0.97 && !this.scoped;
    // FOV for ADS (viewmodel camera)
    this.camera.fov = lerp(60, 48, this.aim); this.camera.updateProjectionMatrix();
  }

  animateSwing(dt) {
    const P = this.swordPivot;
    let v = this.swordRest;
    if (this.swingT >= 0) {
      this.swingT += dt / (Sim.SWORD_TICKS * Sim.DT);
      const R = this.swordRest;
      const K = this.swingDir > 0
        ? [[0, R], [0.14, [0.05, 0.07, 0.04, 0.3, 0.2, -0.55]], [0.32, [-0.24, -0.14, -0.14, -1.75, -0.3, 1.35]], [0.5, [-0.2, -0.1, -0.1, -1.5, -0.2, 1.2]], [1, R]]
        : [[0, R], [0.14, [-0.12, 0.05, 0.02, 0.1, -0.2, 1.3]], [0.32, [0.14, -0.12, -0.14, -1.6, 0.3, -0.9]], [0.5, [0.12, -0.1, -0.1, -1.4, 0.2, -0.8]], [1, R]];
      const t = Math.min(1, this.swingT);
      let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
      const k = ease(seg(t, K[i][0], K[i + 1][0]));
      v = K[i][1].map((x, j) => lerp(x, K[i + 1][1][j], k));
      // slash arc shows during the fast part of the swing
      const arcK = seg(t, 0.17, 0.25) * (1 - seg(t, 0.32, 0.46));
      this.slashArc.visible = arcK > 0.01;
      this.slashArc.material.opacity = arcK;
      // centred on the sword hand (lower right for a forehand, mirrored for a backhand)
      this.slashArc.material.map = this.swordArcTex; this.slashArc.material.color.setRGB(1.6, 1.3, 1.1);
      this.slashArc.position.set(this.swingDir > 0 ? 0.24 : -0.24, -0.3, -0.85);
      this.slashArc.rotation.set(0.15, 0, 0);
      this.slashArc.scale.set(this.swingDir > 0 ? 1 : -1, 1, 1);
      if (this.swingT >= 1) { this.swingT = -1; this.slashArc.visible = false; }
    }
    // Knight: guard (blade across the body), parry/block jolt, Cinder Crash leap (blade overhead) and slam
    const kd = this.knightDt || 0, ek = k => 1 - Math.exp(-kd * k);
    this.guardK += ((this.guarding ? 1 : 0) - this.guardK) * ek(16);
    this.leapK += ((this.leaping ? 1 : 0) - this.leapK) * ek(10);
    let slam = 0;
    if (this.slamT >= 0) { this.slamT += kd; slam = Math.min(1, this.slamT / 0.07) * (1 - Math.max(0, (this.slamT - 0.35) / 0.3)); if (this.slamT > 0.65) this.slamT = -1; }
    let jolt = 0;
    if (this.joltT >= 0) { this.joltT += kd; jolt = Math.exp(-this.joltT * 12) * this.joltK; if (this.joltT > 0.4) this.joltT = -1; }
    if (this.swingT < 0) {
      const G = [-0.06, 0.07, -0.06, -0.2, 0.25, 1.45], U = [0.0, 0.2, 0.06, 0.55, 0.0, 0.25], D = [-0.06, -0.08, -0.16, -1.8, 0.0, 0.1];
      v = v.map((x, j) => x + (G[j] - x) * this.guardK);
      v = v.map((x, j) => x + (U[j] - x) * this.leapK * (1 - slam));
      v = v.map((x, j) => x + (D[j] - x) * slam);
      v = v.slice(); v[1] -= jolt * 0.05; v[2] += jolt * 0.06; v[3] += jolt * 0.25; v[5] += (Math.random() - 0.5) * jolt * 0.1;
    }
    P.position.set(this.swordHome.x + v[0], this.swordHome.y + v[1], this.swordHome.z + v[2]);
    P.rotation.set(v[3], v[4], v[5]);
    // the forearm follows the wrist part-way
    this.swordArm.position.copy(P.position);
    this.swordArm.rotation.set(0.5 + (v[3] - this.swordRest[3]) * 0.35, 0.3 + v[4] * 0.4, (v[5] - this.swordRest[5]) * 0.3);
  }

  /**
   * Rune-Warden arms. On transforming they surge up into view, spread wide (the roar) and hammer down;
   * then they heave with breath, flex, swing with each lumbering step and rise when airborne.
   * Slashes alternate arms; every third attack is an overhead double-fist slam.
   */
  animateClaws(dt, s) {
    const now = performance.now() * 0.001, seg2 = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
    this.clawIntro += dt;
    const it = this.clawIntro, rise = ease(seg2(it, 0, 0.35)), spread = ease(seg2(it, 0.3, 0.6)) * (1 - ease(seg2(it, 0.95, 1.1)));
    const slamI = ease(seg2(it, 1.1, 1.25)) * (1 - ease(seg2(it, 1.4, 1.8)));
    this.clawAir = lerp(this.clawAir, s && !s.grounded ? 1 : 0, 1 - Math.exp(-dt * 8));
    const breath = Math.sin(now * 1.8), walk = this.bobAmt, ph = this.bobPhase * 0.5;
    this.clawArms.forEach((h, i) => {
      const sd = i ? -1 : 1;
      h.position.copy(h.userData.home); h.rotation.copy(h.userData.rot);
      h.position.y += breath * 0.012 * (i ? -1 : 1) - (1 - rise) * 0.45 + this.clawAir * 0.06 + spread * 0.05 - slamI * 0.1;
      h.position.x += sd * spread * 0.05;
      h.position.z += Math.sin(ph + i * Math.PI) * 0.05 * walk;
      h.rotation.x += Math.sin(ph + i * Math.PI) * 0.12 * walk + this.clawAir * 0.2 + spread * 0.35 - slamI * 0.25;
      h.rotation.y -= sd * spread * 0.12;
      h.rotation.z += sd * (spread * 0.4 + Math.sin(now * 23) * 0.04 * spread);
      this.clawHands[i].rotation.x = Math.sin(now * 2.1 + i * 1.7) * 0.18 - spread * 0.5;
    });
    this.wardenGlow.color.setRGB(3, 0.35, 0.45).multiplyScalar(1 + Math.sin(now * 4) * 0.2 + spread * 1.5);
    if (it > 1.12 && it < 1.25 && !this.introSlam) { this.introSlam = true; this.landY.kick(-0.9); }
    if (it < 1) this.introSlam = false;
    if (this.clawT < 0) { this.slashArc.visible = false; return; }
    this.clawT += dt / (Sim.CLAW_TICKS * Sim.DT);
    const t = Math.min(1, this.clawT), side = this.clawSide;
    const up = ease(seg(t, 0, 0.25)) * (1 - ease(seg(t, 0.25, 0.4))), cut = ease(seg(t, 0.22, 0.4)) * (1 - ease(seg(t, 0.55, 1)));
    if (this.clawSlamming) {
      for (const H of this.clawArms) { H.position.y += up * 0.3 - cut * 0.2; H.position.z -= cut * 0.15; H.rotation.x += up * 0.9 - cut * 0.9; }
      this.clawArms[0].position.x -= cut * 0.08; this.clawArms[1].position.x += cut * 0.08;
    } else {
      const H = this.clawArms[side > 0 ? 0 : 1];
      H.position.x += side * (up * 0.1 - cut * 0.3); H.position.y += up * 0.16 - cut * 0.04; H.position.z -= cut * 0.12;
      H.rotation.x += up * 0.55 - cut * 0.2; H.rotation.y += side * (-up * 0.25 + cut * 0.9); H.rotation.z += side * cut * 0.6;
    }
    const arcK = seg(t, 0.22, 0.3) * (1 - seg(t, 0.38, 0.55));
    this.slashArc.visible = arcK > 0.01; this.slashArc.material.opacity = arcK;
    this.slashArc.material.map = this.clawArcTex; this.slashArc.material.color.setRGB(1.8, 0.5, 0.6);
    if (this.clawSlamming) { this.slashArc.position.set(0, -0.25, -0.85); this.slashArc.rotation.set(0.15, 0, -0.35); this.slashArc.scale.set(1, 1, 1); }
    else { this.slashArc.position.set(side > 0 ? 0.24 : -0.24, -0.3, -0.85); this.slashArc.rotation.set(0.15, 0, 0); this.slashArc.scale.set(side > 0 ? 1 : -1, 1, 1); }
    if (this.clawSlamming && t > 0.4 && !this.slamKicked) { this.slamKicked = true; this.landY.kick(-0.5); }
    if (this.clawT >= 1) { this.clawT = -1; this.slashArc.visible = false; }
  }

  /** Bolt cycle after each sniper shot (and a mag swap during reloads). */
  animateBolt(dt, reloadT) {
    const B = this.sn.bolt, H = this.sn.boltHome;
    if (this.boltT >= 0) {
      const prev = this.boltT;
      this.boltT += dt / (Sim.SNIPER_TICKS * Sim.DT);
      if (prev < 0.3 && this.boltT >= 0.3 && this.events.bolt) this.events.bolt();
      const up = ease(seg(this.boltT, 0.25, 0.35)) * (1 - ease(seg(this.boltT, 0.65, 0.75)));
      const back = ease(seg(this.boltT, 0.35, 0.48)) * (1 - ease(seg(this.boltT, 0.52, 0.65)));
      B.position.set(H.x, H.y, H.z + back * 0.07); B.rotation.z = -up * 1.2;
      if (this.boltT >= 1) { this.boltT = -1; B.position.copy(H); B.rotation.z = 0; }
    }
    const M = this.sn.mag, MH = this.sn.magHome;
    if (reloadT >= 0) {
      const drop = ease(seg(reloadT, 0.15, 0.35)) * (1 - ease(seg(reloadT, 0.55, 0.75)));
      M.position.set(MH.x, MH.y - drop * 0.3, MH.z); M.visible = !(reloadT > 0.35 && reloadT < 0.55);
    } else { M.position.copy(MH); M.visible = true; }
  }

  animatePump(dt) {
    const pump = this.sg.pump;
    if (this.pumpT < 0) { pump.position.copy(this.sg.pumpHome); return; }
    const prev = this.pumpT;
    this.pumpT += dt / (Sim.SHOTGUN_TICKS * Sim.DT);
    if (prev < 0.4 && this.pumpT >= 0.4 && this.events.pump) this.events.pump();
    const back = ease(seg(this.pumpT, 0.25, 0.42)) * (1 - ease(seg(this.pumpT, 0.5, 0.68)));
    pump.position.set(this.sg.pumpHome.x, this.sg.pumpHome.y, this.sg.pumpHome.z + back * 0.08);
    if (this.pumpT >= 1) this.pumpT = -1;
  }

  animateReload(t) {
    if (t < 0) {
      this.mag.position.copy(this.magHome); this.mag.rotation.set(0, 0, 0); this.mag.visible = true;
      this.leftArm.position.lerp(this.leftHome, 0.35); this.leftArm.rotation.set(
        lerp(this.leftArm.rotation.x, this.leftHomeRot.x, 0.35), lerp(this.leftArm.rotation.y, this.leftHomeRot.y, 0.35), lerp(this.leftArm.rotation.z, this.leftHomeRot.z, 0.35));
      this.handle.position.copy(this.handleHome);
      this.reloadT = -1;
      return;
    }
    const prev = this.reloadT; this.reloadT = t;
    const cue = (at, name) => { if (prev < at && t >= at && this.events[name]) this.events[name](); };
    cue(0.0001, 'start'); cue(0.22, 'magOut'); cue(0.62, 'magIn'); cue(0.8, 'charge');
    // 0.00-0.15 tilt (root), 0.15-0.35 hand to mag & pull out, 0.35-0.5 mag gone, 0.5-0.65 new mag in, 0.7-0.85 charge handle
    const out = ease(seg(t, 0.16, 0.34)), back = ease(seg(t, 0.44, 0.62));
    const magDrop = out * (1 - back);
    this.mag.position.set(this.magHome.x, this.magHome.y - magDrop * 0.35, this.magHome.z + magDrop * 0.05);
    this.mag.rotation.set(-magDrop * 0.4, 0, magDrop * 0.3);
    this.mag.visible = !(t > 0.34 && t < 0.44);
    // left hand travels to the magazine well and back
    const toMag = ease(seg(t, 0.08, 0.2)) * (1 - ease(seg(t, 0.64, 0.74)));
    const handTarget = new THREE.Vector3(this.mag.position.x - 0.01, this.mag.position.y - 0.1, this.mag.position.z + 0.02);
    this.leftArm.position.lerpVectors(this.leftHome, handTarget, toMag);
    this.leftArm.rotation.set(lerp(this.leftHomeRot.x, -0.2, toMag), lerp(this.leftHomeRot.y, -0.2, toMag), lerp(this.leftHomeRot.z, 0.6, toMag));
    // charging handle
    const pull = seg(t, 0.78, 0.84) * (1 - seg(t, 0.84, 0.9));
    this.handle.position.set(this.handleHome.x, this.handleHome.y, this.handleHome.z + pull * 0.06);
  }

  setSize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
}
