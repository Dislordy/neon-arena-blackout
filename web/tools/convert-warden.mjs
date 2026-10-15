// Rune-Warden animation pipeline: FBX (Blender export of the "Creep" rig) -> compact GLB for the web game.
// Keeps the skeleton (no mesh: the game hangs its own Warden body on the bones) and only the clips we use,
// trimmed to one loop and made in-place (the server moves the body, not the animation).
// usage: node web/tools/convert-warden.mjs path/to/Creep.fbx web/public/models/warden.glb
import fs from 'fs';
const T = new URL('../node_modules/three', import.meta.url).pathname;
globalThis.self = globalThis; globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }), createElement: () => ({ style: {}, getContext: () => null }) };
globalThis.FileReader = class { readAsArrayBuffer(b) { b.arrayBuffer().then(r => { this.result = r; this.onloadend && this.onloadend(); }); } readAsDataURL(b) { b.arrayBuffer().then(r => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(r).toString('base64'); this.onloadend && this.onloadend(); }); } };
const THREE = await import(T + '/build/three.module.js');
const { FBXLoader } = await import(T + '/examples/jsm/loaders/FBXLoader.js');
const { GLTFExporter } = await import(T + '/examples/jsm/exporters/GLTFExporter.js');
const [inp, out] = process.argv.slice(2);
const buf = fs.readFileSync(inp);
const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
// only the skeleton and its motion are kept: the game builds the Rune-Warden's own body on these bones
const mesh = obj.getObjectByProperty('isSkinnedMesh', true);
mesh.parent.remove(mesh);
// clips: [source, new name, start, end, keepRootY]
const want = [['Idle1', 'idle', 0, 4.84], ['Idle2', 'prowl', 0, 4.84], ['Walk1', 'walk', 0, 1.2], ['Crouch', 'crawl', 0, 1.2], ['Roar', 'roar', 0, 4.84],
  ['Punch', 'punch', 0, 1.2], ['Bite', 'bite', 0, 1.6], ['Damage', 'hit', 0, 1.2], ['Death', 'death', 0, 2.4, true], ['JumpOut', 'jump', 0, 1.28], ['JumpIn', 'land', 0, 1.28]];
const fps = 30, clips = [];
for (const [src, name, a, b, keepY] of want) {
  const c = obj.animations.find(c => c.name.includes('|' + src + '_'));
  let sub = THREE.AnimationUtils.subclip(c, name, Math.round(a * fps), Math.round(b * fps), fps);
  sub.tracks = sub.tracks.filter(t => !t.name.endsWith('.scale'));        // no bone scaling in this rig
  for (const t of sub.tracks) if (t.name === 'Torso.position') {           // in-place: the game moves the body
    const v = t.values, n = v.length / 3, x0 = v[0], z0 = v[2];
    for (let i = 0; i < n; i++) { v[i * 3] = x0; if (!keepY) v[i * 3 + 1] = Math.max(-0.6, Math.min(0.6, v[i * 3 + 1])); } // Blender Y = forward, Z = up (pre-rotation)
    if (!keepY && (name === 'jump' || name === 'land')) for (let i = 0; i < n; i++) v[i * 3 + 2] = Math.min(v[i * 3 + 2], 3.4);
  }
  sub.optimize(); clips.push(sub);
  console.log(name, sub.duration.toFixed(2), sub.tracks.length, 'tracks', sub.tracks.reduce((s, t) => s + t.values.length, 0), 'floats');
}
const scene = new THREE.Scene(); scene.add(obj);
const glb = await new Promise((res, rej) => new GLTFExporter().parse(scene, res, rej, { binary: true, animations: clips, onlyVisible: false }));
fs.writeFileSync(out, Buffer.from(glb)); console.log('wrote', out, (glb.byteLength / 1024).toFixed(0) + ' KB');
