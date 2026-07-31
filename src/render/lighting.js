// render/lighting.js — light propagation, AO, day/night.
// Phase 1: sky gradient dome, sun + ambient light, fog matched to the horizon.
// Block-light propagation and per-vertex AO arrive with the chunk mesher.

import * as THREE from 'three';
import { SKY, LIGHTING, VIEW, RENDER } from '../config.js';

// Sky dome: a big inward-facing sphere with a vertical gradient shader.
// Four stops: below-horizon haze, horizon, mid, zenith. The shader includes
// the renderer's tone mapping and colour space chunks so a fully fogged block
// (fog colour = horizon colour) matches the sky exactly.
const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Keep the dome centred on the camera regardless of its world position
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 zenithColor;
  uniform vec3 midColor;
  uniform vec3 horizonColor;
  uniform vec3 belowColor;
  uniform float midStop;
  varying vec3 vDir;
  void main() {
    float h = normalize(vDir).y;
    vec3 col = mix(horizonColor, midColor, smoothstep(0.0, midStop, h));
    col = mix(col, zenithColor, smoothstep(midStop, 1.0, h));
    col = mix(belowColor, col, smoothstep(-0.2, 0.0, h));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSky() {
  const geometry = new THREE.SphereGeometry(VIEW.FAR * 0.9, 32, 16);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      zenithColor: { value: new THREE.Color(SKY.ZENITH_COLOR) },
      midColor: { value: new THREE.Color(SKY.MID_COLOR) },
      horizonColor: { value: new THREE.Color(SKY.HORIZON_COLOR) },
      belowColor: { value: new THREE.Color(SKY.BELOW_COLOR) },
      midStop: { value: SKY.MID_STOP },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.frustumCulled = false;
  return sky;
}

// Distance fog matched to the sky's horizon colour.
export function createFog() {
  return new THREE.Fog(SKY.FOG_COLOR, SKY.FOG_NEAR, SKY.FOG_FAR);
}

// Sun (shadow-casting directional) plus hemisphere ambient. Day/night motion
// comes with the time-of-day system in a later phase.
export function createSunLight() {
  const sun = new THREE.DirectionalLight(0xffffff, LIGHTING.SUN_INTENSITY);
  sun.position.set(60, 100, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(RENDER.SHADOW_MAP_SIZE, RENDER.SHADOW_MAP_SIZE);
  const r = RENDER.SHADOW_RANGE;
  sun.shadow.camera.left = -r;
  sun.shadow.camera.right = r;
  sun.shadow.camera.top = r;
  sun.shadow.camera.bottom = -r;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0005;
  return sun;
}

export function createAmbientLight() {
  // Sky-blue from above, earthy bounce from below
  return new THREE.HemisphereLight(0xcfe5ff, 0x8a7a5a, LIGHTING.AMBIENT_INTENSITY);
}
