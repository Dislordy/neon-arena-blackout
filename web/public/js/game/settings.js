// Graphics presets, mouse sensitivity and sound settings (remembered in localStorage).
import { AudioEngine } from '../audio.js';
import { G, $, store, isTouch } from './ctx.js';

export const PRESETS = {
  low: { pixelRatio: 1, textures: 256, shadows: false, shadowSize: 0, spotShadows: false, reflections: false, reflectionScale: 0, bloom: false, msaa: 0, mist: false, rain: 0, particles: 700, dust: 0, flashLights: 1, extraLights: false },
  medium: { pixelRatio: 1.25, textures: 512, shadows: true, shadowSize: 1024, spotShadows: false, reflections: true, reflectionScale: 0.35, bloom: true, msaa: 0, mist: true, rain: 2500, particles: 1400, dust: 300, flashLights: 2, extraLights: false },
  high: { pixelRatio: 1.5, textures: 512, shadows: true, shadowSize: 2048, spotShadows: true, reflections: true, reflectionScale: 0.5, bloom: true, msaa: 4, mist: true, rain: 4000, particles: 2200, dust: 600, flashLights: 3, extraLights: false },
  ultra: { pixelRatio: 2, textures: 1024, shadows: true, shadowSize: 4096, spotShadows: true, reflections: true, reflectionScale: 0.75, bloom: true, msaa: 4, mist: true, rain: 6000, particles: 3200, dust: 900, flashLights: 4, extraLights: true }
};
export const qualityName = new URLSearchParams(location.search).get('quality') || store.get('quality', isTouch ? 'low' : 'medium');
export const Q = PRESETS[qualityName] || PRESETS.medium;
export const settings = { sensitivity: store.get('sens', 1) };

const audio = G.audio = new AudioEngine();
audio.volume = store.get('vol', 0.8);
audio.muted = store.get('muted', false);

export function setVolume(v) {
  audio.setVolume(v); store.set('vol', v); $('volRange').value = $('menuVol').value = v;
  if (v > 0 && audio.muted) setMuted(false);
}
export function setMuted(m) {
  audio.setMuted(m); store.set('muted', m);
  $('soundBtn').classList.toggle('off', m); $('soundBtn').setAttribute('aria-pressed', String(!m));
  $('soundLabel').textContent = m ? 'Sound: off' : 'Sound: on';
}

$('qualitySel').value = qualityName;
$('qualitySel').onchange = e => { store.set('quality', e.target.value); location.reload(); };
$('sensRange').value = settings.sensitivity;
$('sensRange').oninput = e => { settings.sensitivity = Number(e.target.value); store.set('sens', settings.sensitivity); };
$('volRange').value = audio.volume;
$('volRange').oninput = e => setVolume(Number(e.target.value));
$('menuVol').value = audio.volume; setMuted(audio.muted);
