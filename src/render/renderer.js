// render/renderer.js — Three.js setup: renderer, camera, tone mapping,
// shadows, resize handling. Phase 26: the post pipeline itself lives in
// render/post_fx.js; this file only keeps the renderer's global state
// consistent with it.

import * as THREE from 'three';
import { VIEW, RENDER, VISUAL } from '../config.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Phase 26: with the post pipeline on, the scene renders into a target —
  // where three r160 disables tone mapping regardless of this setting (all
  // the game's OWN materials opted out with toneMapped: false long ago; only
  // entity/particle defaults ever rode it). NoToneMapping here keeps the
  // hand overlay pass — which still draws straight to the canvas, after the
  // composite — matched to the entities instead of ACES-curving the one
  // thing the pipeline doesn't touch.
  renderer.toneMapping = VISUAL.POST_ENABLED
    ? THREE.NoToneMapping
    : THREE.ACESFilmicToneMapping;
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
