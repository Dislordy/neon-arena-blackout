// Renderer, scene and the first-person camera (sized to the window).
import * as THREE from 'three';
import { installHeightFog } from '../world.js';
import { G, $ } from './ctx.js';
import { Q } from './settings.js';

installHeightFog();
export const renderer = G.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('scene').appendChild(renderer.domElement);

export const scene = G.scene = new THREE.Scene();
export const camera = G.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 600);
camera.rotation.order = 'YXZ';
scene.add(camera);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  if (G.post) G.post.setSize(innerWidth, innerHeight);
  if (G.weapon) G.weapon.setSize(innerWidth, innerHeight);
  if (G.world) G.world.setSize(innerWidth, innerHeight);
});
