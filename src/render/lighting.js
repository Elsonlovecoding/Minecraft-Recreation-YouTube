// render/lighting.js — light propagation, AO, day/night.
// Phase 1: sky gradient dome, sun + ambient light, fog matched to the horizon.
// Block-light propagation and per-vertex AO arrive with the chunk mesher.

import * as THREE from 'three';
import { SKY, LIGHTING, VIEW, RENDER } from '../config.js';

// Sky dome: a big inward-facing sphere with a vertical gradient shader.
// Four stops: below-horizon haze, horizon, mid, zenith.
// Deliberately NOT tone-mapped: in r160 built-in materials apply fog AFTER
// tone mapping, with the fog colour uniform in the output colour space — so a
// fully fogged block shows the raw sRGB fog colour. The sky therefore outputs
// its authored colours through the colour-space conversion only, making the
// horizon (= fog colour) an exact match.
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
  sun.position.set(...LIGHTING.SUN_POSITION);
  sun.castShadow = true;
  sun.shadow.mapSize.set(RENDER.SHADOW_MAP_SIZE, RENDER.SHADOW_MAP_SIZE);
  const r = RENDER.SHADOW_RANGE;
  sun.shadow.camera.left = -r;
  sun.shadow.camera.right = r;
  sun.shadow.camera.top = r;
  sun.shadow.camera.bottom = -r;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = RENDER.SHADOW_CAMERA_FAR;
  sun.shadow.bias = RENDER.SHADOW_BIAS;
  return sun;
}

export function createAmbientLight() {
  return new THREE.HemisphereLight(
    LIGHTING.AMBIENT_SKY_COLOR,
    LIGHTING.AMBIENT_GROUND_COLOR,
    LIGHTING.AMBIENT_INTENSITY,
  );
}

// Keeps the sun (and its shadow camera) centred on the player so shadows
// exist wherever the player flies. The focus snaps to a grid so the shadow
// map doesn't shimmer every frame; the light direction never changes.
// The sun's target must be added to the scene alongside the sun.
export function updateSun(sun, focus) {
  const snap = RENDER.SHADOW_FOLLOW_SNAP;
  const fx = Math.round(focus.x / snap) * snap;
  const fy = Math.round(focus.y / snap) * snap;
  const fz = Math.round(focus.z / snap) * snap;
  const [ox, oy, oz] = LIGHTING.SUN_POSITION;
  sun.position.set(fx + ox, fy + oy, fz + oz);
  sun.target.position.set(fx, fy, fz);
}
