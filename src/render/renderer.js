// render/renderer.js — Three.js setup: renderer, camera, tone mapping,
// shadows, resize handling. Post-processing hooks come in a later phase.

import * as THREE from 'three';
import { VIEW, RENDER } from '../config.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDER.TONE_MAPPING_EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function createCamera() {
  return new THREE.PerspectiveCamera(
    VIEW.FOV,
    window.innerWidth / window.innerHeight,
    VIEW.NEAR,
    VIEW.FAR,
  );
}

// Keeps the renderer and camera matched to the window size.
export function attachResizeHandler(renderer, camera) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.MAX_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
