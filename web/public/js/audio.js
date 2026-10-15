// Procedurally synthesised audio with HRTF positional panning, distance-based
// gunshot variants, wall occlusion (low-pass muffling) and a convolution reverb bus.
const Sim = window.NeonSim;

// ------------------------------------------------------------------ DSP helpers
const TAU = Math.PI * 2;
function lp(buf, fc, sr) { const a = 1 - Math.exp(-TAU * fc / sr); let y = 0; for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; } return buf; }
function hp(buf, fc, sr) { const a = 1 - Math.exp(-TAU * fc / sr); let y = 0; for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = buf[i] - y; } return buf; }
function noise(n, seed = 1) { const b = new Float32Array(n); let s = seed * 9301 + 49297; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; b[i] = (s / 2147483647) * 2 - 1; } return b; }
function normalize(b, peak = 0.9) { let m = 0; for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i])); if (m > 0) for (let i = 0; i < b.length; i++) b[i] *= peak / m; return b; }
function softclip(b, drive = 1.5) { for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive); return b; }
function fadeEdges(b, sr, ms = 3) { const n = Math.min(b.length >> 1, Math.round(sr * ms / 1000)); for (let i = 0; i < n; i++) { const k = i / n; b[i] *= k; b[b.length - 1 - i] *= k; } return b; }
function sweepSine(n, sr, f0, f1, decay, { k = 1, phase = 0, shape = 'sin' } = {}) {
  const b = new Float32Array(n); let ph = phase;
  for (let i = 0; i < n; i++) {
    const t = i / sr, f = f1 + (f0 - f1) * Math.exp(-t * k * 10);
    ph += TAU * f / sr;
    const s = shape === 'saw' ? ((ph / TAU) % 1) * 2 - 1 : Math.sin(ph);
    b[i] = s * Math.exp(-t * decay);
  }
  return b;
}
function partials(n, sr, freqs, decays, amps) {
  const b = new Float32Array(n);
  for (let p = 0; p < freqs.length; p++) for (let i = 0; i < n; i++) b[i] += Math.sin(TAU * freqs[p] * i / sr) * Math.exp(-i / sr * decays[p]) * amps[p];
  return b;
}
function mixInto(dst, src, gain = 1, offset = 0) { for (let i = 0; i < src.length && i + offset < dst.length; i++) dst[i + offset] += src[i] * gain; return dst; }
function env(b, sr, fn) { for (let i = 0; i < b.length; i++) b[i] *= fn(i / sr); return b; }

// ------------------------------------------------------------------ sound designs
const designs = {
  /**
   * VX-9 plasma rifle, layered like a real gunshot recording + a sci-fi energy component.
   * Stereo; v selects one of several variations so full-auto never sounds like a loop.
   */
  shot(sr, v = 0) {
    const n = Math.round(sr * 1.1), mono = new Float32Array(n), sv = 1 + (v - 1.5) * 0.03;
    // 1 crack: very short broadband transient (the "snap")
    mixInto(mono, env(hp(noise(n, 300 + v), 1800, sr), sr, t => Math.exp(-t * 420)), 1.1);
    // 2 punch: pitched-down sub thump you feel in the chest
    mixInto(mono, sweepSine(n, sr, 135 * sv, 46, 16, { k: 3.2 }), 1.5);
    // 3 body: band-limited blast
    mixInto(mono, env(lp(hp(noise(n, 310 + v), 220, sr), 1700, sr), sr, t => Math.exp(-t * 30) * Math.min(1, t * 800)), 0.9);
    // 4 plasma zap: FM sweep gives the cyberpunk energy character
    {
      const z = new Float32Array(Math.round(sr * 0.22)); let pc = 0, pm = 0;
      for (let i = 0; i < z.length; i++) {
        const t = i / sr, fc = (520 + 1900 * Math.exp(-t * 28)) * sv, I = 3.5 * Math.exp(-t * 18);
        pc += TAU * fc / sr; pm += TAU * fc * 1.48 / sr;
        z[i] = Math.sin(pc + I * Math.sin(pm)) * Math.exp(-t * 20) * Math.min(1, t * 2000);
      }
      mixInto(mono, z, 0.45);
    }
    // 5 metallic ring of the receiver/barrel
    mixInto(mono, partials(Math.round(sr * 0.4), sr, [1830 * sv, 2970 * sv, 4410 * sv], [28, 36, 50], [0.22, 0.16, 0.09]));
    // 6 mechanical bolt clack ~38 ms later
    const clackAt = Math.round(sr * (0.036 + v * 0.002));
    mixInto(mono, env(hp(noise(Math.round(sr * 0.05), 320 + v), 2500, sr), sr, t => Math.exp(-t * 260)), 0.35, clackAt);
    mixInto(mono, partials(Math.round(sr * 0.06), sr, [3200, 5100], [120, 160], [0.18, 0.1]), 1, clackAt);
    // stereo: decorrelated air/rumble tail + slap-back echoes off the surrounding buildings
    const slap = lp(mono.slice(0, Math.round(sr * 0.25)), 2400, sr);
    const side = (seed, d1, d2) => {
      const c = mono.slice();
      mixInto(c, env(lp(noise(n, seed), 650, sr), sr, t => Math.exp(-t * 3.2) * Math.min(1, t * 30)), 0.3);
      mixInto(c, slap, 0.24, Math.round(sr * d1));
      mixInto(c, slap, 0.12, Math.round(sr * d2));
      return c;
    };
    const L = side(330 + v, 0.11, 0.29), R = side(340 + v, 0.14, 0.33);
    softclip(L, 1.7); softclip(R, 1.7);
    return stereoFinish(L, R, sr, 0.95);
  },
  /** Distant gunfire: muffled, longer rumble, clear echoes rolling between buildings. */
  shotFar(sr, v = 0) {
    const near = designs.shot(sr, v), n = Math.round(sr * 1.8);
    const one = (src, seed, e1, e2) => {
      const c = new Float32Array(n), f = lp(lp(src.slice(), 1000, sr), 800, sr);
      mixInto(c, f, 1); mixInto(c, f, 0.35, Math.round(sr * e1)); mixInto(c, f, 0.18, Math.round(sr * e2));
      mixInto(c, env(lp(noise(n, seed), 300, sr), sr, t => Math.exp(-t * 2) * Math.min(1, t * 12)), 0.3);
      return c;
    };
    return stereoFinish(one(near.L, 360 + v, 0.24, 0.52), one(near.R, 370 + v, 0.27, 0.57), sr, 0.8);
  },
  dry(sr) {
    const n = Math.round(sr * 0.08), out = new Float32Array(n);
    mixInto(out, env(hp(noise(n, 7), 3000, sr), sr, t => Math.exp(-t * 300)), 0.6);
    mixInto(out, partials(n, sr, [3100, 5300], [120, 160], [0.4, 0.2]));
    return fadeEdges(normalize(out, 0.6), sr);
  },
  magOut(sr) {
    const n = Math.round(sr * 0.35), out = new Float32Array(n);
    mixInto(out, env(lp(hp(noise(n, 8), 800, sr), 4000, sr), sr, t => Math.exp(-t * 18) * Math.min(1, t * 60)), 0.5);
    mixInto(out, partials(Math.round(sr * 0.1), sr, [2300, 3900], [60, 80], [0.5, 0.3]));
    mixInto(out, partials(Math.round(sr * 0.12), sr, [1700, 3100], [50, 70], [0.4, 0.25]), 1, Math.round(sr * 0.12));
    return fadeEdges(normalize(out, 0.7), sr);
  },
  magIn(sr) {
    const n = Math.round(sr * 0.3), out = new Float32Array(n);
    mixInto(out, sweepSine(n, sr, 260, 140, 30), 0.8);
    mixInto(out, env(lp(noise(n, 9), 2500, sr), sr, t => Math.exp(-t * 60)), 0.7);
    mixInto(out, partials(Math.round(sr * 0.08), sr, [2900, 4700], [70, 90], [0.5, 0.3]), 1, Math.round(sr * 0.05));
    return fadeEdges(normalize(out, 0.85), sr);
  },
  charge(sr) {
    const n = Math.round(sr * 0.4), out = new Float32Array(n);
    for (const [off, f] of [[0, 2600], [0.11, 3400]]) {
      const o = Math.round(off * sr);
      mixInto(out, env(hp(noise(Math.round(sr * 0.05), 10 + off * 9), 2000, sr), sr, t => Math.exp(-t * 120)), 0.7, o);
      mixInto(out, partials(Math.round(sr * 0.2), sr, [f, f * 1.47, f * 2.13], [25, 35, 45], [0.35, 0.2, 0.12]), 1, o);
    }
    return fadeEdges(normalize(out, 0.8), sr);
  },
  hit(sr) {
    const n = Math.round(sr * 0.09);
    return fadeEdges(normalize(partials(n, sr, [1900, 3800], [55, 70], [1, 0.4]), 0.6), sr);
  },
  headshot(sr) {
    const n = Math.round(sr * 0.45), out = partials(n, sr, [2350, 4700, 7050, 3130], [9, 12, 16, 10], [1, 0.45, 0.2, 0.3]);
    mixInto(out, env(hp(noise(n, 11), 4000, sr), sr, t => Math.exp(-t * 200)), 0.5);
    return fadeEdges(normalize(out, 0.7), sr);
  },
  kill(sr) {
    const n = Math.round(sr * 0.55), out = new Float32Array(n);
    mixInto(out, env(partials(Math.round(sr * 0.25), sr, [880, 1760], [8, 10], [1, 0.3]), sr, t => Math.min(1, t * 200)));
    mixInto(out, env(partials(Math.round(sr * 0.4), sr, [1320, 2640, 1980], [7, 9, 8], [1, 0.3, 0.2]), sr, t => Math.min(1, t * 200)), 1, Math.round(sr * 0.09));
    return fadeEdges(normalize(out, 0.6), sr);
  },
  impactMetal(sr) {
    const n = Math.round(sr * 0.3), out = partials(n, sr, [1180, 2730, 4330, 6100], [16, 22, 30, 40], [0.6, 0.5, 0.35, 0.2]);
    mixInto(out, env(hp(noise(n, 12), 1500, sr), sr, t => Math.exp(-t * 90)), 0.9);
    return fadeEdges(normalize(out, 0.8), sr);
  },
  impactConcrete(sr) {
    const n = Math.round(sr * 0.22), out = env(lp(noise(n, 13), 2200, sr), sr, t => Math.exp(-t * 45));
    mixInto(out, sweepSine(n, sr, 160, 70, 35), 0.6);
    return fadeEdges(normalize(out, 0.8), sr);
  },
  impactWater(sr) {
    const n = Math.round(sr * 0.25), out = env(hp(noise(n, 14), 1800, sr), sr, t => Math.exp(-t * 28) * Math.min(1, t * 300));
    mixInto(out, sweepSine(n, sr, 900, 2600, 30, { k: 0.6 }), 0.15);
    return fadeEdges(normalize(out, 0.7), sr);
  },
  impactBody(sr) {
    const n = Math.round(sr * 0.2), out = sweepSine(n, sr, 900, 180, 25, { k: 1.5, shape: 'saw' });
    mixInto(out, env(lp(noise(n, 15), 1200, sr), sr, t => Math.exp(-t * 40)), 0.8);
    mixInto(out, sweepSine(n, sr, 120, 60, 30), 0.8);
    return fadeEdges(normalize(softclip(out, 2), 0.8), sr);
  },
  /** Wet footstep on rainy concrete: heel thump + scuff + splash with droplets. */
  step(sr, v = 0) {
    const n = Math.round(sr * 0.22), out = new Float32Array(n);
    mixInto(out, sweepSine(n, sr, 85 + v * 6, 45, 55, { k: 2 }), 0.9);
    mixInto(out, env(lp(hp(noise(n, 20 + v), 500, sr), 2500, sr), sr, t => Math.exp(-t * 70) * Math.min(1, t * 900)), 0.5);
    mixInto(out, env(hp(noise(n, 30 + v), 3000, sr), sr, t => Math.exp(-t * 28) * Math.min(1, t * 300)), 0.42);
    let sd = 41 + v * 7;
    for (let k = 0; k < 4; k++) {
      sd = (sd * 16807) % 2147483647;
      const f = 3000 + (sd % 3500), off = Math.round(sr * (0.01 + (sd % 50) / 1000));
      mixInto(out, partials(Math.round(sr * 0.03), sr, [f], [150], [1]), 0.12, off);
    }
    return fadeEdges(normalize(out, 0.7), sr);
  },
  /** Plate-armour clink layered on other runners' footsteps. */
  clink(sr) {
    const n = Math.round(sr * 0.15), out = partials(n, sr, [2650, 4120, 5900], [45, 60, 80], [0.6, 0.35, 0.2]);
    mixInto(out, env(hp(noise(n, 77), 4000, sr), sr, t => Math.exp(-t * 300)), 0.3);
    return fadeEdges(normalize(out, 0.5), sr);
  },
  land(sr) {
    const n = Math.round(sr * 0.3), out = env(lp(noise(n, 40), 700, sr), sr, t => Math.exp(-t * 25));
    mixInto(out, sweepSine(n, sr, 95, 45, 18), 1);
    mixInto(out, env(hp(noise(n, 41), 3000, sr), sr, t => Math.exp(-t * 20)), 0.3);
    return fadeEdges(normalize(out, 0.75), sr);
  },
  jump(sr) {
    const n = Math.round(sr * 0.2);
    return fadeEdges(normalize(env(lp(hp(noise(n, 42), 400, sr), 2500, sr), sr, t => Math.sin(Math.PI * t / 0.2) ** 2), 0.35), sr);
  },
  dash(sr) {
    const n = Math.round(sr * 0.45), src = noise(n, 43), out = new Float32Array(n);
    // swept band-pass via moving one-pole filters
    let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, fc = 300 + 3500 * Math.sin(Math.PI * Math.min(1, t / 0.4)) ** 2;
      const a = 1 - Math.exp(-TAU * fc / sr), a2 = 1 - Math.exp(-TAU * fc * 0.5 / sr);
      y1 += a * (src[i] - y1); y2 += a2 * (y1 - y2);
      out[i] = (y1 - y2) * Math.sin(Math.PI * Math.min(1, t / 0.45));
    }
    mixInto(out, sweepSine(n, sr, 200, 900, 6, { k: 0.4, shape: 'saw' }), 0.08);
    return fadeEdges(normalize(out, 0.7), sr);
  },
  shield(sr) {
    const n = Math.round(sr * 0.8), out = new Float32Array(n);
    for (const d of [1, 1.006, 0.994]) mixInto(out, env(sweepSine(n, sr, 260 * d, 820 * d, 0, { k: 0.25 }), sr, t => Math.min(1, t * 20) * Math.exp(-t * 3.5)), 0.4);
    mixInto(out, env(hp(noise(n, 44), 5000, sr), sr, t => Math.exp(-t * 6)), 0.1);
    return fadeEdges(normalize(out, 0.6), sr);
  },
  scan(sr) {
    const n = Math.round(sr * 1.6), out = new Float32Array(n);
    for (let r = 0; r < 4; r++) mixInto(out, partials(Math.round(sr * 0.5), sr, [1250, 2500], [9, 14], [1, 0.25]), Math.pow(0.45, r), Math.round(sr * r * 0.28));
    return fadeEdges(normalize(out, 0.6), sr);
  },
  hurt(sr) {
    const n = Math.round(sr * 0.35), out = sweepSine(n, sr, 140, 50, 14);
    mixInto(out, env(lp(noise(n, 45), 900, sr), sr, t => Math.exp(-t * 18)), 0.9);
    return fadeEdges(normalize(softclip(out, 3), 0.9), sr);
  },
  respawn(sr) {
    const n = Math.round(sr * 0.9), out = new Float32Array(n);
    for (const f of [220, 330, 440]) mixInto(out, env(sweepSine(n, sr, f, f * 2, 0, { k: 0.3, shape: 'saw' }), sr, t => Math.min(1, t * 8) * Math.exp(-t * 4)), 0.2);
    return fadeEdges(normalize(lp(out, 3000, sr), 0.5), sr);
  },
  tink(sr) {
    const n = Math.round(sr * 0.12);
    return fadeEdges(normalize(partials(n, sr, [4200, 6900, 9100], [40, 50, 70], [1, 0.6, 0.3]), 0.4), sr);
  },
  death(sr) {
    const n = Math.round(sr * 1.2), out = sweepSine(n, sr, 1200, 60, 3, { k: 0.5, shape: 'saw' });
    mixInto(out, env(lp(noise(n, 46), 1500, sr), sr, t => Math.exp(-t * 4)), 0.8);
    mixInto(out, sweepSine(n, sr, 90, 30, 4), 1);
    return fadeEdges(normalize(lp(softclip(out, 2), 4000, sr), 0.85), sr);
  },
  // loops
  /** Soft stereo rain: filtered pink-ish noise, rooftop rumble and scattered droplets (no harsh hiss). */
  rain(sr) {
    const n = Math.round(sr * 6);
    const drop = f => partials(Math.round(sr * 0.025), sr, [f], [250], [1]);
    const drops = [2600, 3400, 4300, 5200, 6100].map(drop);
    const ch = seed => {
      const body = lp(lp(hp(noise(n, seed), 300, sr), 2600, sr), 3200, sr);
      mixInto(body, lp(lp(noise(n, seed + 10), 180, sr), 220, sr), 2.5);
      let s2 = seed * 13 + 7;
      for (let k = 0; k < 900; k++) {
        s2 = (s2 * 16807) % 2147483647;
        mixInto(body, drops[s2 % drops.length], 0.05 + (s2 % 100) / 800, s2 % (n - drops[0].length));
      }
      return loopable(normalize(body, 0.55), sr);
    };
    return { L: ch(50), R: ch(51) };
  },
  hum(sr) {
    const n = Math.round(sr * 4), out = new Float32Array(n);
    for (const [f, a] of [[55, 0.5], [110, 0.25], [82.5, 0.15], [55.4, 0.4]]) for (let i = 0; i < n; i++) out[i] += Math.sin(TAU * f * i / sr) * a;
    mixInto(out, lp(noise(n, 51), 250, sr), 1.2);
    return loopable(normalize(out, 0.5), sr);
  },
  buzz(sr) {
    const n = Math.round(sr * 1), out = new Float32Array(n);
    for (let h = 1; h <= 8; h++) for (let i = 0; i < n; i++) out[i] += Math.sin(TAU * 120 * h * i / sr) / h * (h % 2 ? 1 : 0.5);
    lp(out, 1800, sr);
    mixInto(out, hp(noise(n, 52), 6000, sr), 0.05);
    return loopable(normalize(out, 0.5), sr);
  }
};
function stereoFinish(L, R, sr, peak) {
  let m = 0; for (let i = 0; i < L.length; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
  const k = m > 0 ? peak / m : 1; for (let i = 0; i < L.length; i++) { L[i] *= k; R[i] *= k; }
  return { L: fadeEdges(L, sr), R: fadeEdges(R, sr) };
}
function loopable(b, sr) {
  // crossfade the tail into the head so the buffer loops seamlessly
  const x = Math.round(sr * 0.2), out = b.slice(0, b.length - x);
  for (let i = 0; i < x; i++) { const k = i / x; out[i] = out[i] * k + b[b.length - x + i] * (1 - k); }
  return out;
}

// ------------------------------------------------------------------ engine
// Mix levels (0..1). Ambience sits well under the action and ducks whenever a gun fires.
const MIX = { ambience: 0.42, sfx: 1.0, ui: 0.85, reverb: 0.28 };
const VARIANTS = { shot: 4, shotFar: 2, step: 6 };

export class AudioEngine {
  constructor() { this.ctx = null; this.buffers = {}; this.voices = 0; this.enabled = false; this.volume = 0.8; }

  /** Create the audio graph. `customCtx` (e.g. an OfflineAudioContext) is used for offline previews/tests. */
  init(customCtx) {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC && !customCtx) return;
    const ctx = this.ctx = customCtx || new AC({ latencyHint: 'interactive' });
    const sr = ctx.sampleRate;
    const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
    // master -> brick-wall limiter -> speakers
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.12;
    this.master = gain(this.volume); this.master.connect(this.limiter); this.limiter.connect(ctx.destination);
    // action bus (guns, movement, impacts) with its own gentle glue compressor
    const glue = ctx.createDynamicsCompressor(); glue.threshold.value = -10; glue.knee.value = 6; glue.ratio.value = 3; glue.attack.value = 0.003; glue.release.value = 0.18;
    this.sfx = gain(MIX.sfx); this.sfx.connect(glue); glue.connect(this.master);
    // ambience bus (rain, hum, neon buzz): bypasses the compressor so it never squashes the action
    this.amb = gain(MIX.ambience); this.amb.connect(this.master);
    // UI bus (hit markers, kill confirms)
    this.ui = gain(MIX.ui); this.ui.connect(this.master);
    // convolution reverb: early reflections off buildings + a diffuse wet-street tail
    this.reverb = ctx.createConvolver();
    const irLen = Math.round(sr * 1.6), ir = ctx.createBuffer(2, irLen, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c), nz = noise(irLen, 60 + c);
      for (let i = 0; i < irLen; i++) d[i] = nz[i] * Math.exp(-i / sr * 3.6) * 0.5 * (i < sr * 0.01 ? i / (sr * 0.01) : 1);
      for (const [ms, a] of [[31 + c * 6, 0.9], [78 + c * 9, 0.6], [142 - c * 7, 0.45], [233 + c * 11, 0.3]]) { const k = Math.round(sr * ms / 1000); if (k < irLen) d[k] += a * (c ? -1 : 1); }
      lp(d, 4200, sr);
    }
    this.reverb.buffer = ir;
    this.reverbGain = gain(MIX.reverb); this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);
    for (const [name, fn] of Object.entries(designs)) {
      const nv = VARIANTS[name];
      if (nv) { for (let v = 0; v < nv; v++) this.buffers[name + v] = this.toBuffer(fn(sr, v)); if (name !== 'step') this.buffers[name] = this.buffers[name + 0]; continue; }
      this.buffers[name] = this.toBuffer(fn(sr));
    }
    this.enabled = true;
  }
  toBuffer(data) {
    const stereo = data.L !== undefined, len = stereo ? data.L.length : data.length;
    const b = this.ctx.createBuffer(stereo ? 2 : 1, len, this.ctx.sampleRate);
    if (stereo) { b.copyToChannel(data.L, 0); b.copyToChannel(data.R, 1); } else b.copyToChannel(data, 0);
    return b;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  /** Briefly lower the ambience (rain/hum) so the action cuts through, then let it swell back. */
  duck(depth = 0.35, hold = 0.15) {
    if (!this.enabled) return;
    const g = this.amb.gain, t = this.ctx.currentTime, target = MIX.ambience * depth;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
    if (g.value > target) g.setTargetAtTime(target, t, 0.012);
    g.setTargetAtTime(MIX.ambience, t + hold, 0.45);
  }

  /** Update the listener from the camera every frame. */
  updateListener(camera) {
    if (!this.enabled) return;
    const L = this.ctx.listener, e = camera.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14], fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    this.listenerPos = { x: px, y: py, z: pz };
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(px, t); L.positionY.setValueAtTime(py, t); L.positionZ.setValueAtTime(pz, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(ux, t); L.upY.setValueAtTime(uy, t); L.upZ.setValueAtTime(uz, t);
    } else { L.setPosition(px, py, pz); L.setOrientation(fx, fy, fz, ux, uy, uz); }
  }

  occluded(pos) {
    const l = this.listenerPos; if (!l) return false;
    const d = { x: pos.x - l.x, y: pos.y - l.y, z: pos.z - l.z }, len = Math.hypot(d.x, d.y, d.z);
    if (len < 0.5) return false;
    d.x /= len; d.y /= len; d.z /= len;
    const h = Sim.raycastWorld(l, d, len - 0.3);
    return !!(h && h.kind !== 'floor');
  }
  distanceTo(pos) { const l = this.listenerPos || pos; return Math.hypot(pos.x - l.x, pos.y - l.y, pos.z - l.z); }

  /**
   * Play a sound. opts: { pos (world position => 3D), volume, rate, vary, reverb, ref, rolloff, bus: 'sfx'|'ui'|'amb' }
   */
  play(name, opts = {}) {
    if (!this.enabled || this.voices > 56) return null;
    const buf = this.buffers[name];
    if (!buf) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const vol = opts.volume !== undefined ? opts.volume : 1;
    src.playbackRate.value = (opts.rate || 1) * (1 + (Math.random() - 0.5) * (opts.vary !== undefined ? opts.vary : 0.06));
    const g = ctx.createGain(); g.gain.value = vol;
    let node = src;
    if (opts.pos) {
      if (this.occluded(opts.pos)) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.5;
        node.connect(f); node = f; g.gain.value = vol * 0.55;
      }
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = opts.ref || 2.5; p.maxDistance = 120; p.rolloffFactor = opts.rolloff || 1.1;
      if (p.positionX) { p.positionX.value = opts.pos.x; p.positionY.value = opts.pos.y; p.positionZ.value = opts.pos.z; } else p.setPosition(opts.pos.x, opts.pos.y, opts.pos.z);
      node.connect(p); node = p;
    }
    const bus = opts.bus === 'ui' ? this.ui : opts.bus === 'amb' ? this.amb : this.sfx;
    node.connect(g); g.connect(bus);
    const rv = opts.reverb !== undefined ? opts.reverb : 0.3;
    if (rv > 0) { const s = ctx.createGain(); s.gain.value = rv; g.connect(s); s.connect(this.reverb); }
    src.start();
    this.voices++;
    src.onended = () => { this.voices--; g.disconnect(); };
    return src;
  }
  pick(name) { return name + ((Math.random() * VARIANTS[name]) | 0); }

  /** Gunfire: your own rifle up front; others positioned, with a muffled/echoing variant at range. */
  gunshot(pos, own = false) {
    if (own) { this.duck(0.3, 0.18); return this.play(this.pick('shot'), { volume: 0.95, reverb: 0.26, vary: 0.03 }); }
    const d = this.distanceTo(pos);
    if (d > 24) { this.duck(0.75, 0.1); return this.play(this.pick('shotFar'), { pos, volume: 1.7, reverb: 0.55, ref: 6, rolloff: 0.9, vary: 0.04 }); }
    this.duck(0.5, 0.14);
    return this.play(this.pick('shot'), { pos, volume: 1.25, reverb: 0.42, ref: 4, vary: 0.04 });
  }
  /** Footsteps: yours are close and clear; other runners' steps carry an armour clink so you can track them. */
  footstep(pos, own = false) {
    if (own) return this.play(this.pick('step'), { volume: 0.6, reverb: 0.05, vary: 0.1 });
    this.play(this.pick('step'), { pos, volume: 1.0, ref: 3, reverb: 0.15, vary: 0.1 });
    if (Math.random() < 0.6) this.play('clink', { pos: { x: pos.x, y: pos.y + 1, z: pos.z }, volume: 0.35, ref: 2.5, reverb: 0.1, vary: 0.25 });
  }

  /** Start ambient loops (rain, city hum, neon buzz at sign positions) on the ambience bus. */
  startAmbience(emitters = []) {
    if (!this.enabled || this.ambience) return;
    this.ambience = [];
    const loop = (name, vol, pos) => {
      const src = this.ctx.createBufferSource(); src.buffer = this.buffers[name]; src.loop = true;
      const g = this.ctx.createGain(); g.gain.value = vol;
      let node = src;
      if (pos) {
        const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.2; p.rolloffFactor = 1.6;
        if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
        src.connect(p); node = p;
      }
      node.connect(g); g.connect(this.amb);
      src.start(0, Math.random() * src.buffer.duration);
      this.ambience.push(src);
    };
    loop('rain', 0.5); loop('hum', 0.22);
    for (const e of emitters.slice(0, 8)) loop('buzz', 0.07, e);
  }
}
