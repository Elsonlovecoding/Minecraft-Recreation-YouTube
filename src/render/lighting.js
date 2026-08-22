// render/lighting.js — light propagation, day/night cycle, sky and fog.
// Phase 4:
//  - Flood-filled sky + block light (15 levels) computed per chunk from its
//    3x3 neighbourhood, a pure function of block data, so lighting is
//    deterministic and seam-free no matter which chunk meshes first. The
//    mesher bakes the result into a per-vertex `light` attribute.
//  - Chunk materials are unlit (Minecraft-style): a shader patch combines
//    baked skylight x time-of-day with baked block light x torch tint via
//    shared uniforms, so day/night relights the whole world without remeshing.
//  - A ~20-minute day/night cycle: keyframed sky gradient, fog colour always
//    matched to the horizon, a round glowing sun and an eight-phase round
//    moon riding the dome, and the directional sun light (for later entity
//    phases) tracking the same orbit.
// Vertex AO itself is baked in the mesher (world/chunks.js) from the same
// corner cells that sample this module's light.

import * as THREE from 'three';
import {
  SKY, DAY_NIGHT, CELESTIAL, LIGHTING, TIME, VIEW, RENDER, CHUNK, VISUAL,
  CLOUDS,
} from '../config.js';
import { BLOCKS } from '../world/blocks.js';
// Phase 24: clouds, stars and the generated sun/moon art live in their own
// module (render/sky_fx.js) per the size cap — this file keeps the CYCLE
// that drives them.
import {
  createStars, createSunTexture, createMoonTextures, createMoonGlowTexture,
  forceFarDepth,
} from './sky_fx.js';

// ---------------------------------------------------------------------------
// Sky dome
// ---------------------------------------------------------------------------

// A big inward-facing sphere with a vertical gradient shader. Four stops:
// below-horizon haze, horizon, mid, zenith — plus a warm glow hugging the
// horizon around the sun during sunrise/sunset.
// Deliberately NOT tone-mapped: in r160 built-in materials apply fog AFTER
// tone mapping, with the fog colour uniform in the output colour space — so a
// fully fogged block shows the raw sRGB fog colour. The sky therefore outputs
// its authored colours through the colour-space conversion only, making the
// horizon (= fog colour) an exact match. Chunk materials skip tone mapping
// for the same reason (see patchChunkMaterial).
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
  uniform vec3 sunDirection;
  uniform vec3 glowColor;
  uniform float glowStrength;
  uniform float glowBand;
  varying vec3 vDir;
  void main() {
    vec3 nd = normalize(vDir);
    float h = nd.y;
    vec3 col = mix(horizonColor, midColor, smoothstep(0.0, midStop, h));
    col = mix(col, zenithColor, smoothstep(midStop, 1.0, h));
    col = mix(belowColor, col, smoothstep(-0.2, 0.0, h));
    // Sunrise/sunset: warm glow near the horizon, strongest toward the sun.
    // Phase 27 follow-up: the band is a uniform now — by day it hugs the
    // horizon as always, at night it widens so the same term paints a cool
    // wash of moonlight around the moon wherever it rides.
    float sunAmount = max(dot(nd, sunDirection), 0.0);
    float horizonBand = 1.0 - smoothstep(0.0, glowBand, abs(h));
    col = mix(col, glowColor, glowStrength * horizonBand * pow(sunAmount, 6.0));
    // Sub-quantum noise breaks up 8-bit banding rings in the smooth gradient
    // (most visible in the near-black night sky)
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
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
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      glowColor: { value: new THREE.Color(DAY_NIGHT.GLOW_COLOR) },
      glowStrength: { value: 0 },
      glowBand: { value: 0.45 }, // day: the glow hugs the horizon
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.frustumCulled = false;
  // Sky first, then sun/moon quads, then the world (which depth-tests as
  // usual). Without this the opaque pass sorts front-to-back and the dome
  // would draw over the quads.
  sky.renderOrder = -2;
  return sky;
}

// Distance fog; the day/night cycle keeps its colour matched to the horizon.
export function createFog() {
  return new THREE.Fog(SKY.FOG_COLOR, SKY.FOG_NEAR, SKY.FOG_FAR);
}

// ---------------------------------------------------------------------------
// Sun + ambient (directional light matters for later entity phases; chunk
// meshes are unlit and take their light from the baked attribute instead)
// ---------------------------------------------------------------------------

export function createSunLight() {
  const sun = new THREE.DirectionalLight(0xffffff, LIGHTING.SUN_INTENSITY);
  sun.position.set(LIGHTING.SUN_DISTANCE, LIGHTING.SUN_DISTANCE, 0);
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

// Keeps the sun (and its shadow camera) centred on the player so the
// directional light exists wherever the player flies, aimed along `dir`
// (unit vector toward the sun/moon). The focus snaps to a grid so the shadow
// map doesn't shimmer every frame. The sun's target must be in the scene.
export function updateSun(sun, focus, dir) {
  const snap = RENDER.SHADOW_FOLLOW_SNAP;
  const fx = Math.round(focus.x / snap) * snap;
  const fy = Math.round(focus.y / snap) * snap;
  const fz = Math.round(focus.z / snap) * snap;
  const d = LIGHTING.SUN_DISTANCE;
  sun.position.set(fx + dir.x * d, fy + dir.y * d, fz + dir.z * d);
  sun.target.position.set(fx, fy, fz);
}

// ---------------------------------------------------------------------------
// Chunk material lighting (shader patch)
// ---------------------------------------------------------------------------

// Uniforms shared by every chunk material; the day/night cycle writes them
// once per frame and the whole world relights without any remeshing.
// uHeldLight* is the Phase 14 held-torch dynamic light: a point light that
// follows the player, applied per fragment at render time — the flood fill
// never sees it, so no chunk ever remeshes because the player moved.
export const CHUNK_LIGHT_UNIFORMS = {
  uSkyDarken: { value: 0 },                                   // 0 day .. 11 night
  uSkyTint: { value: new THREE.Color(1, 1, 1) },              // white -> moonlight
  uTorchTint: { value: new THREE.Color(LIGHTING.TORCH_TINT) },
  uLightFalloff: { value: LIGHTING.LIGHT_FALLOFF },
  uHeldLightPos: { value: new THREE.Vector3(0, -1e6, 0) },    // player eye
  uHeldLightLevel: { value: 0 },                              // 0 = off, torch 14
  uHeldLightTint: { value: new THREE.Color(LIGHTING.HELD_LIGHT_TINT) },
  // Phase 16: a dimension-wide floor on the effective SKY level (the
  // Nether's "constant dim red ambient" — under its bedrock ceiling the
  // baked sky light is zero everywhere, and without a floor enclosed
  // netherrack would render pitch black). 0 in the overworld.
  uMinSkyLevel: { value: 0 },
  // Phase 26 — the shadow feel (config VISUAL.SHADOW): daylight shadows
  // lean slightly cool and carry a faint warm ground bounce. Constants in
  // uniforms so the whole look stays one config edit away from neutral.
  uShadowCool: { value: new THREE.Color(VISUAL.SHADOW.COOL_COLOR) },
  uShadowCoolStrength: { value: VISUAL.SHADOW.COOL_STRENGTH },
  uBounceColor: { value: new THREE.Color(VISUAL.SHADOW.BOUNCE_COLOR) },
  uBounceStrength: { value: VISUAL.SHADOW.BOUNCE_STRENGTH },
  // Cloud SHADOWS drifting over the terrain (the "lively, like shaders"
  // pass): the chunk shader samples a cheap copy of the sky's cloud field
  // at the fragment's column projected along the sun, and dims the SKY
  // contribution only — torchlight and caves are untouched. The cycle
  // writes drift/slant/strength every frame; strength is 0 at night and
  // under the fixed-sky dimensions.
  uCloudShadow: { value: 0 },
  uCloudDrift: { value: new THREE.Vector2(0, 0) },
  uCloudSlant: { value: new THREE.Vector2(0, 0) },
  // Wind ("lively leaves"): the vertex stage displaces wave-weighted
  // vertices (leaves, cross-plant tops — a per-vertex attribute baked by
  // the mesher) through a world-space wind field. Time accumulates in the
  // cycle; amplitude is one config knob.
  uWindTime: { value: 0 },
  uWindAmp: { value: VISUAL.WIND.AMPLITUDE },
  // Directional sun/moon modelling (the shader look, config
  // VISUAL.SUNLIGHT): faces toward the light brighten, faces away fall
  // into shade, swinging with the sun through the day and handing over to
  // a fainter moon at night. The cycle writes both every frame; strength
  // is 0 under fixed dimension skies.
  uSunFace: { value: 0 },
  uSunFaceDir: { value: new THREE.Vector3(0, 1, 0) },
};

// The held light's brightness at `dist` blocks from the player — the same
// level-per-block falloff the shader computes, for JS consumers (the mob
// tint in entities/mobs.js). Returns 0..1.
export function heldLightBrightness(level, dist) {
  if (level <= 0) return 0;
  const l = Math.max(0, Math.min(15, level - dist));
  return LIGHTING.LIGHT_FALLOFF ** (15 - l);
}

// Turns a MeshBasicMaterial into a Minecraft-style lit chunk material. The
// mesher supplies a per-vertex `light` attribute: vec2(sky, block) light
// levels normalised to 0..1. Final brightness is
//   max(falloff^(15 - (sky*15 - skyDarken)) * skyTint,
//       falloff^(15 -  block*15)            * torchTint)
// multiplied into the vertex colour (which already carries per-face
// brightness x AO). Sky light dims with time of day; block light doesn't —
// torches hold their brightness through the night, exactly like the game.
export function patchChunkMaterial(material) {
  material.toneMapped = false; // see the sky-dome comment: keeps fog exact
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, CHUNK_LIGHT_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        'attribute vec2 light;\n'
        + 'attribute float wave;\n'
        + 'varying vec2 vLight;\n'
        + 'varying vec3 vHeldWorldPos;\n'
        + 'uniform float uWindTime;\n'
        + 'uniform float uWindAmp;\n'
        + '#include <common>')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        vLight = light;
        vHeldWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        // WIND (the "lively leaves" pass): wave-weighted vertices (leaves,
        // cross-plant tops) sway through a world-space field — several
        // incommensurate sines plus a slow travelling gust, so a canopy
        // ripples rather than rocking in one rhythm. World-space phase
        // keeps neighbouring blocks and chunks moving as one body.
        if (wave > 0.003) {
          vec3 wp = vHeldWorldPos;
          float t = uWindTime;
          float sway = sin(wp.x * 0.31 + wp.y * 0.13 + t * 1.9)
                     * cos(wp.z * 0.27 + t * 1.4) * 0.6
                     + sin((wp.x + wp.z) * 0.09 + t * 0.7) * 0.4;
          float gust = 0.66 + 0.34 * sin(wp.x * 0.021 + wp.z * 0.017 + t * 0.31);
          float amp = wave * uWindAmp * gust;
          transformed.x += sway * amp;
          transformed.z += cos(wp.x * 0.23 + wp.y * 0.11 + t * 1.1) * sway * amp * 0.8;
          transformed.y += sin(wp.z * 0.29 + wp.x * 0.07 + t * 1.6) * amp * 0.3;
          vHeldWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        'varying vec2 vLight;\n'
        + 'varying vec3 vHeldWorldPos;\n'
        + 'uniform float uSkyDarken;\n'
        + 'uniform vec3 uSkyTint;\n'
        + 'uniform vec3 uTorchTint;\n'
        + 'uniform float uLightFalloff;\n'
        + 'uniform vec3 uHeldLightPos;\n'
        + 'uniform float uHeldLightLevel;\n'
        + 'uniform vec3 uHeldLightTint;\n'
        + 'uniform float uMinSkyLevel;\n'
        + 'uniform vec3 uShadowCool;\n'
        + 'uniform float uShadowCoolStrength;\n'
        + 'uniform vec3 uBounceColor;\n'
        + 'uniform float uBounceStrength;\n'
        + 'uniform float uCloudShadow;\n'
        + 'uniform vec2 uCloudDrift;\n'
        + 'uniform vec2 uCloudSlant;\n'
        + 'uniform float uSunFace;\n'
        + 'uniform vec3 uSunFaceDir;\n'
        // A cheap 3-octave copy of the sky's cloud field (same hash, same
        // seed, same gate/threshold layout — no warp or erosion; shadows
        // are blurry) so cloud shadows land under the clouds that cast
        // them and DRIFT with them. Constants baked from config at patch
        // time; ~5 noise evaluations per terrain fragment.
        + `float csHash(vec2 c) {
          c = mod(c, 512.0);
          return fract(sin(dot(c, vec2(127.1, 311.7)) + ${CLOUDS.SEED.toFixed(4)}) * 43758.5453);
        }
        float csNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u2 = f * f * (3.0 - 2.0 * f);
          return mix(mix(csHash(i), csHash(i + vec2(1.0, 0.0)), u2.x),
                     mix(csHash(i + vec2(0.0, 1.0)), csHash(i + vec2(1.0, 1.0)), u2.x), u2.y);
        }
        float csCloud(vec2 wxz) {
          vec2 np = (wxz + uCloudSlant) * ${CLOUDS.SCALE.toFixed(8)} + uCloudDrift;
          float gate = smoothstep(0.32, 0.70,
            csNoise(np * ${CLOUDS.GATE_SCALE.toFixed(5)}) * 0.65
            + csNoise(np * ${(CLOUDS.GATE_SCALE * 2.63).toFixed(5)} + 41.3) * 0.35);
          float t = 1.0 - ${CLOUDS.COVER.toFixed(4)} * (0.62 + 0.38 * gate);
          float f2 = (csNoise(np) * 0.5 + csNoise(np * 2.03 + 17.7) * 0.25
            + csNoise(np * 4.1209 + 53.6) * 0.125) * 1.14;
          return smoothstep(t, t + ${VISUAL.CLOUD_SHADOW.SOFTNESS.toFixed(4)}, f2);
        }
        `
        + '#include <common>')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        {
          float skyLevel = clamp(max(vLight.x * 15.0 - uSkyDarken, uMinSkyLevel), 0.0, 15.0);
          float blockLevel = vLight.y * 15.0;
          vec3 skyLum = pow(uLightFalloff, 15.0 - skyLevel) * uSkyTint;
          // How open to the sky this column is — scales every outdoor
          // effect below so interiors and caves feel nothing.
          float openCol = pow(uLightFalloff, 15.0 - vLight.x * 15.0);
          // Drifting cloud shadows (see csCloud above): dim the sky's
          // contribution under cloud.
          if (uCloudShadow > 0.001) {
            skyLum *= 1.0 - uCloudShadow * openCol * csCloud(vHeldWorldPos.xz);
          }
          // DIRECTIONAL sun/moon modelling (the shader look): the flat
          // face normal comes from screen-space derivatives — the meshes
          // carry no normals — and faces toward the light brighten while
          // faces away fall into shade, swinging as the sun crosses the
          // sky. Wind-swayed leaves get gently varying normals for free,
          // so canopies shimmer as they move.
          if (uSunFace > 0.001) {
            // The cross product DEGENERATES on a face seen edge-on: both
            // screen derivatives then run along the same world line, so
            // the cross collapses toward zero and normalize() returns
            // inf/NaN — which blew the fragment out and bloom smeared it
            // into a lattice of glowing dots (the "yellow circle" seen
            // while sprint-jumping past tree trunks). Test the length
            // BEFORE dividing, and clamp the result: no valid normal
            // means no directional term for that pixel, never a blowout.
            vec3 cn = cross(dFdx(vHeldWorldPos), dFdy(vHeldWorldPos));
            float cl = length(cn);
            if (cl > 1e-7) {
              vec3 fn = cn / cl;
              if (!gl_FrontFacing) fn = -fn;
              float facing = clamp(dot(fn, uSunFaceDir), -1.0, 1.0);
              // ENERGY-NEUTRAL: the multiplier peaks at exactly 1.0 on a
              // fully sun-facing surface and only DARKENS from there, so
              // the modelling can never push a surface BRIGHTER than the
              // baked sky light. That matters beyond taste: brightening
              // warm surfaces (wood, dirt) nudged them over the bloom
              // pass's emissive detector, which then smeared them into a
              // lattice of glowing dots — the "yellow circle" flashing
              // past tree trunks while sprint-jumping. Contrast comes
              // from the shaded side, which is how the effect reads
              // anyway.
              float shade = facing > 0.0 ? facing : facing * 0.7;
              skyLum *= (1.0 + uSunFace * openCol * shade)
                      / (1.0 + uSunFace * openCol);
            }
          }
          vec3 blockLum = pow(uLightFalloff, 15.0 - blockLevel) * uTorchTint;
          // Held-torch dynamic light (Phase 14): one level lost per block of
          // euclidean distance from the player — the same falloff curve as
          // baked light, smooth instead of cell-quantised, and applied here
          // at render time so it costs zero remeshing as the player moves.
          float heldLevel = clamp(uHeldLightLevel - distance(vHeldWorldPos, uHeldLightPos), 0.0, 15.0);
          vec3 heldLum = pow(uLightFalloff, 15.0 - heldLevel) * uHeldLightTint;
          vec3 lum = max(max(skyLum, blockLum), heldLum);
          // Phase 26 — shadow feel, daylight only (config VISUAL.SHADOW).
          // "Shade" is the baked per-face brightness x AO in the vertex
          // colour: 0 on a full-lit top face, rising on sides, bottoms and
          // occluded corners. Those faces take a slight COOL lean (open-sky
          // shadow is blue-lit) and a small WARM additive bounce (sunlit
          // ground scatters light back up), both scaled by how much day is
          // overhead and by the column's sky access, so caves, the night
          // and the fixed-sky dimensions are untouched.
          #ifdef USE_COLOR
            float shade = clamp(1.0 - vColor.r, 0.0, 1.0);
            float dayF = clamp(1.0 - uSkyDarken / 11.0, 0.0, 1.0) *
              step(uMinSkyLevel, 0.5); // no bounce under a fixed dimension sky
            float openSky = pow(uLightFalloff, 15.0 - vLight.x * 15.0);
            lum = mix(lum, lum * uShadowCool, uShadowCoolStrength * shade * dayF);
            lum += uBounceColor * (uBounceStrength * shade * dayF * openSky);
          #endif
          diffuseColor.rgb *= lum;
        }`);
  };
}

// ---------------------------------------------------------------------------
// Light propagation (flood fill, 15 levels)
// ---------------------------------------------------------------------------
//
// Lighting for one chunk is computed over its 3x3 chunk window (48x48
// columns, full height). Light travels at most MAX_LIGHT blocks, and the
// window has a 16-block margin all around the centre chunk, so no source
// outside the window can influence the centre chunk — the result is exact
// and identical from every neighbouring chunk's own window (seam-free).
//
// Rules (vanilla):
//  - Sky light is 15 above the highest attenuating block of a column and
//    propagates straight down through air without loss.
//  - Any other step (sideways, up, down at <15, through water/leaves) costs
//    max(1, opacity of the block entered).
//  - Block light starts at the emitter's level and decays the same way.

const SIZE = CHUNK.SIZE;
const HEIGHT = CHUNK.HEIGHT;
const W = SIZE * 3;                       // window edge in columns
const WCOLS = W * W;
const WCELLS = WCOLS * HEIGHT;
const MAX_LIGHT = LIGHTING.MAX_LIGHT;

// Flattened per-id tables for the hot loops.
const OPACITY = new Uint8Array(BLOCKS.length);
const EMIT = new Uint8Array(BLOCKS.length);
for (let id = 0; id < BLOCKS.length; id++) {
  OPACITY[id] = BLOCKS[id].opacity;
  EMIT[id] = BLOCKS[id].light;
}

// Scratch buffers reused for every window (~3.5MB total, allocated once).
const wBlocks = new Uint8Array(WCELLS);
const wSky = new Uint8Array(WCELLS);
const wBlockLight = new Uint8Array(WCELLS);
const wHeights = new Int32Array(WCOLS);
let wBlockLightDirty = false; // previous window wrote block light

// BFS queue of window cell indices, grown on demand.
let queueBuf = new Int32Array(1 << 16);
let qTail = 0;

function qPush(idx) {
  if (qTail === queueBuf.length) {
    const bigger = new Int32Array(queueBuf.length * 2);
    bigger.set(queueBuf);
    queueBuf = bigger;
  }
  queueBuf[qTail++] = idx;
}

// Spreads queued light through the window until stable. `skyMode` enables
// the free straight-down propagation of full sky light.
function propagate(light, skyMode) {
  let head = 0;
  while (head < qTail) {
    const idx = queueBuf[head++];
    const L = light[idx];
    if (L <= 1) continue; // can't raise any neighbour
    const iy = idx % HEIGHT;
    const col = (idx - iy) / HEIGHT;
    const wx = col % W;
    const wz = (col - wx) / W;
    let n, op, nL;
    if (iy > 0) { // down: full sky light falls without loss
      n = idx - 1;
      op = OPACITY[wBlocks[n]];
      nL = skyMode && L === MAX_LIGHT && op === 0 ? MAX_LIGHT : L - (op > 1 ? op : 1);
      if (nL > light[n]) { light[n] = nL; qPush(n); }
    }
    if (iy < HEIGHT - 1) { // up
      n = idx + 1;
      op = OPACITY[wBlocks[n]];
      nL = L - (op > 1 ? op : 1);
      if (nL > light[n]) { light[n] = nL; qPush(n); }
    }
    if (wx > 0) {
      n = idx - HEIGHT;
      op = OPACITY[wBlocks[n]];
      nL = L - (op > 1 ? op : 1);
      if (nL > light[n]) { light[n] = nL; qPush(n); }
    }
    if (wx < W - 1) {
      n = idx + HEIGHT;
      op = OPACITY[wBlocks[n]];
      nL = L - (op > 1 ? op : 1);
      if (nL > light[n]) { light[n] = nL; qPush(n); }
    }
    if (wz > 0) {
      n = idx - W * HEIGHT;
      op = OPACITY[wBlocks[n]];
      nL = L - (op > 1 ? op : 1);
      if (nL > light[n]) { light[n] = nL; qPush(n); }
    }
    if (wz < W - 1) {
      n = idx + W * HEIGHT;
      op = OPACITY[wBlocks[n]];
      nL = L - (op > 1 ? op : 1);
      if (nL > light[n]) { light[n] = nL; qPush(n); }
    }
  }
  qTail = 0;
}

// Per-chunk lighting metadata, built lazily and cached on the chunk (Chunk.set
// invalidates it): the sky heightmap (topmost light-attenuating cell per
// column, -1 if none) and the emitter cell list.
export function getChunkLightMeta(chunk) {
  let meta = chunk._lightMeta;
  if (meta) return meta;
  const blocks = chunk.blocks;
  const heights = new Int16Array(SIZE * SIZE);
  const emitters = [];
  for (let col = 0; col < SIZE * SIZE; col++) {
    const base = col * HEIGHT;
    let top = -1;
    for (let iy = HEIGHT - 1; iy >= 0; iy--) {
      const id = blocks[base + iy];
      if (id === 0) continue;
      if (top < 0 && OPACITY[id] > 0) top = iy;
      if (EMIT[id] > 0) emitters.push(base + iy);
    }
    heights[col] = top;
  }
  meta = { heights, emitters };
  chunk._lightMeta = meta;
  return meta;
}

// Computes sky and block light for a 3x3 chunk window. `nbrs` is the mesher's
// neighbour array, dz-major: nbrs[(dz+1)*3 + (dx+1)], centre at nbrs[4]. Cell
// data is read directly from each chunk's y-fastest blocks array (the layout
// world/chunks.js defines). Returns { sky, block, blocks }: flat Uint8Arrays
// indexed ((wz*48 + wx)*HEIGHT + iy) with wx = lx+16, wz = lz+16,
// iy = y - MIN_Y; `blocks` is the window's block ids, so the mesher can
// sample ids and light with one index. The arrays are shared scratch —
// valid only until the next call.
export function computeLightWindow(nbrs) {
  // 1. Flatten the window's blocks, heightmaps and emitter lists.
  const metas = [];
  for (let nz = 0; nz < 3; nz++) {
    for (let nx = 0; nx < 3; nx++) {
      const chunk = nbrs[nz * 3 + nx];
      const meta = getChunkLightMeta(chunk);
      metas.push(meta);
      const blocks = chunk.blocks;
      for (let lz = 0; lz < SIZE; lz++) {
        for (let lx = 0; lx < SIZE; lx++) {
          const srcBase = (lz * SIZE + lx) * HEIGHT;
          const wcol = (nz * SIZE + lz) * W + (nx * SIZE + lx);
          wBlocks.set(blocks.subarray(srcBase, srcBase + HEIGHT), wcol * HEIGHT);
          wHeights[wcol] = meta.heights[lz * SIZE + lx];
        }
      }
    }
  }

  // 2. Sky light: direct vertical fill per column, then flood the frontier.
  wSky.fill(0);
  for (let wz = 0; wz < W; wz++) {
    for (let wx = 0; wx < W; wx++) {
      const wcol = wz * W + wx;
      const base = wcol * HEIGHT;
      const h = wHeights[wcol];
      wSky.fill(MAX_LIGHT, base + h + 1, base + HEIGHT);
      // Partial light continuing down through water/leaves.
      let cur = MAX_LIGHT;
      for (let iy = h; iy >= 0 && cur > 0; iy--) {
        const op = OPACITY[wBlocks[base + iy]];
        cur = Math.max(0, cur - (op > 1 ? op : 1));
        if (cur > 0) {
          wSky[base + iy] = cur;
          qPush(base + iy);
        }
      }
      // Full-sky cells bordering a higher neighbour column sideways-light it.
      let hn = h;
      if (wx > 0) hn = Math.max(hn, wHeights[wcol - 1]);
      if (wx < W - 1) hn = Math.max(hn, wHeights[wcol + 1]);
      if (wz > 0) hn = Math.max(hn, wHeights[wcol - W]);
      if (wz < W - 1) hn = Math.max(hn, wHeights[wcol + W]);
      if (hn >= HEIGHT) hn = HEIGHT - 1;
      for (let iy = h + 1; iy <= hn; iy++) qPush(base + iy);
    }
  }
  propagate(wSky, true);

  // 3. Block light: flood from emitters (torches 14, glowstone 15, lava 15).
  if (wBlockLightDirty) {
    wBlockLight.fill(0);
    wBlockLightDirty = false;
  }
  for (let n = 0; n < 9; n++) {
    const emitters = metas[n].emitters;
    if (emitters.length === 0) continue;
    const nx = n % 3;
    const nz = (n - nx) / 3;
    for (const localIdx of emitters) {
      const iy = localIdx % HEIGHT;
      const col = (localIdx - iy) / HEIGHT;
      const lx = col % SIZE;
      const lz = (col - lx) / SIZE;
      const widx = ((nz * SIZE + lz) * W + (nx * SIZE + lx)) * HEIGHT + iy;
      wBlockLight[widx] = EMIT[wBlocks[widx]];
      qPush(widx);
      wBlockLightDirty = true;
    }
  }
  if (wBlockLightDirty) propagate(wBlockLight, false);

  return { sky: wSky, block: wBlockLight, blocks: wBlocks };
}

// ---------------------------------------------------------------------------
// Day/night cycle
// ---------------------------------------------------------------------------

// The sun and moon, children of the sky dome so they follow the camera
// automatically. Drawn after the dome (renderOrder), depth-tested so
// terrain still occludes them, and never fogged. Phase 24: the sun is a
// generated texture — a square core in a soft additive glow, no hard edge —
// and the moon carries the eight-phase textures, swapped by setMoonPhase.
// Phase 26 ("the sun renders through clouds"): both quads are pinned to the
// FAR PLANE (sky_fx.js forceFarDepth) and drawn after the cloud deck, which
// writes depth now — so clouds occlude the sun and moon per pixel, exactly
// as terrain always has. Their renderOrder must stay above the clouds' -1.9
// and the stars' -1.5.
function createCelestials(sky) {
  const make = (size, material) => {
    forceFarDepth(material);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
    mesh.renderOrder = -1.2;
    mesh.frustumCulled = false;
    sky.add(mesh);
    return mesh;
  };
  const sun = make(
    CELESTIAL.SUN_SIZE * CELESTIAL.SUN_GLOW_SCALE,
    new THREE.MeshBasicMaterial({
      map: createSunTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
      depthWrite: false,
    }),
  );
  // Phase 27 follow-up: the moon hangs in a soft cool HALO — an additive
  // glow quad drawn just before the round moon disc (and, like it, pinned
  // to the far plane, so the cloud layer's dense cores occlude both).
  const moonGlow = make(
    CELESTIAL.MOON_SIZE * CELESTIAL.MOON_GLOW_SCALE,
    new THREE.MeshBasicMaterial({
      map: createMoonGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
      depthWrite: false,
    }),
  );
  moonGlow.renderOrder = -1.22; // just under the moon itself
  const moonTextures = createMoonTextures();
  const moon = make(
    CELESTIAL.MOON_SIZE,
    new THREE.MeshBasicMaterial({
      map: moonTextures[0],
      transparent: true,
      fog: false,
      toneMapped: false,
      depthWrite: false,
    }),
  );
  let moonPhase = 0;
  return {
    sun,
    moon,
    moonGlow,
    setMoonPhase(phase) {
      const p = ((phase % moonTextures.length) + moonTextures.length) % moonTextures.length;
      if (p === moonPhase) return;
      moonPhase = p;
      moon.material.map = moonTextures[p];
      moon.material.needsUpdate = true;
    },
  };
}

// Drives everything time-of-day: sky palette, fog colour (always the horizon
// colour), baked-light uniforms, sun/moon positions, and the directional
// light. Call update(delta, focus) once per frame; focus is the camera
// position. t convention: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight.
export function createDayNightCycle({ sky, fog, sun, ambient, clouds = null }) {
  const frames = DAY_NIGHT.KEYFRAMES.map((k) => ({
    t: k.T,
    zenith: new THREE.Color(k.ZENITH),
    mid: new THREE.Color(k.MID),
    horizon: new THREE.Color(k.HORIZON),
    below: new THREE.Color(k.BELOW),
    sunLevel: k.SUN_LEVEL,
    skyDarken: k.SKY_DARKEN,
    glow: k.GLOW,
    stars: k.STARS ?? 0,
    tint: new THREE.Color(k.TINT ?? 0xffffff),
    haze: k.HAZE ?? 0, // Phase 26: 0 = clear FOG_NEAR/FAR, 1 = HAZE_NEAR/FAR
  }));
  const celestials = createCelestials(sky);
  const stars = createStars(sky);

  const horizon = new THREE.Color();
  const sunDir = new THREE.Vector3();
  const lightDir = new THREE.Vector3();

  let time = TIME.START_TIME * TIME.DAY_LENGTH_SECONDS;
  let day = 0; // Phase 24: whole days elapsed — the moon-phase clock
  let lastSkyDarken = 0;
  let lastSunLevel = 1; // Phase 26: post/water read the sun state per frame
  let dimSky = null; // Phase 15: fixed-sky override while in another dimension

  return {
    get timeOfDay() {
      return time / TIME.DAY_LENGTH_SECONDS;
    },
    get dayIndex() {
      return day;
    },
    // Phase 26 — read-only sun state for the post pipeline (god rays) and
    // the water uniforms: the interpolated keyframe sun level and the unit
    // direction toward the sun. The vector is the cycle's own working
    // object — copy it, never mutate it.
    get sunLevel() {
      return lastSunLevel;
    },
    get sunDirection() {
      return sunDir;
    },
    // Whether the normal overworld sky is up (false under a fixed-sky
    // dimension profile — the Nether's red gloom, the End's purple).
    get skyActive() {
      return !dimSky;
    },
    // Current skylight darkening (0 day .. 11 deep night) — the hostile
    // spawner combines it with baked sky light for the effective level.
    get skyDarken() {
      return lastSkyDarken;
    },
    // The active dimension's ambient floor on the effective sky level
    // (Phase 16 — the Nether's dim red; 0 in the overworld). The mob tint
    // in entities/mobs.js reads it so mobs match the terrain shader.
    get ambientLight() {
      return dimSky?.AMBIENT_LIGHT ?? 0;
    },
    // Jump to a day fraction (dev scaffolding: window.__dayNight.setTimeOfDay(0.5))
    // A real jump BACKWARD wraps into the next day (sleeping through a night
    // lands in the next morning), so the moon phase advances like vanilla's.
    // A jump of under 2% of a day doesn't count — re-pinning the clock to
    // roughly "now" must not spin the moon.
    setTimeOfDay(t) {
      const next = (((t % 1) + 1) % 1) * TIME.DAY_LENGTH_SECONDS;
      if (next < time - 0.02 * TIME.DAY_LENGTH_SECONDS) day++;
      time = next;
    },
    // Phase 15 (dimensions): a fixed-sky dimension profile — e.g. config
    // NETHER_SKY: { FOG_COLOR, FOG_NEAR, FOG_FAR, SKY_DARKEN, SKY_TINT } —
    // overrides the keyframed sky every frame while set: the dome renders
    // flat fog colour (an exact horizon/fog match, same reason the dome is
    // never tone-mapped), sun and moon hide, and the baked skylight holds a
    // constant darken and tint. Time itself keeps advancing, so returning
    // to the overworld lands at the right point of the day. Pass null to
    // restore the normal cycle.
    setDimensionSky(profile) {
      dimSky = profile ?? null;
      celestials.sun.visible = !dimSky;
      celestials.moon.visible = !dimSky;
      celestials.moonGlow.visible = !dimSky;
      clouds?.setVisible(!dimSky);      // no cloud layer under a nether roof
      if (dimSky) stars.setAlpha(0);    // ...and no stars either
      if (!dimSky) {
        fog.near = SKY.FOG_NEAR;
        fog.far = SKY.FOG_FAR;
      }
    },
    update(delta, focus) {
      time += delta;
      if (time >= TIME.DAY_LENGTH_SECONDS) {
        time -= TIME.DAY_LENGTH_SECONDS;
        day++; // a new day — the moon turns a phase
      }
      const t = time / TIME.DAY_LENGTH_SECONDS;

      // Wind clock for the waving leaves/plants — wrapped so the shader's
      // sine arguments never lose float precision over long sessions.
      CHUNK_LIGHT_UNIFORMS.uWindTime.value =
        (CHUNK_LIGHT_UNIFORMS.uWindTime.value + delta * VISUAL.WIND.SPEED) % 6283.185;

      // Bracketing keyframes (wrapping past the last one back to the first).
      let a = frames[frames.length - 1];
      let b = frames[0];
      for (let i = 0; i < frames.length; i++) {
        if (frames[i].t <= t) {
          a = frames[i];
          b = frames[(i + 1) % frames.length];
        }
      }
      const span = (b.t - a.t + 1) % 1 || 1;
      const f = ((t - a.t + 1) % 1) / span;

      const sunLevel = a.sunLevel + (b.sunLevel - a.sunLevel) * f;
      lastSunLevel = sunLevel;
      const skyDarken = a.skyDarken + (b.skyDarken - a.skyDarken) * f;
      const glow = a.glow + (b.glow - a.glow) * f;
      const starAlpha = a.stars + (b.stars - a.stars) * f;
      horizon.lerpColors(a.horizon, b.horizon, f);

      // Sun orbit: rises east (+x) at t=0, overhead at noon, sets west.
      const ang = t * Math.PI * 2;
      sunDir.set(Math.cos(ang), Math.sin(ang), LIGHTING.SUN_TILT).normalize();

      // Sky dome: follow the camera, take the interpolated palette.
      sky.position.copy(focus);
      const u = sky.material.uniforms;
      u.zenithColor.value.lerpColors(a.zenith, b.zenith, f);
      u.midColor.value.lerpColors(a.mid, b.mid, f);
      u.horizonColor.value.copy(horizon);
      u.belowColor.value.lerpColors(a.below, b.below, f);
      u.sunDirection.value.copy(sunDir);
      u.glowStrength.value = glow;

      // Fog always matches the horizon, so terrain fades into the sky at
      // every point of the cycle. Phase 26: its REACH rides the keyframes'
      // HAZE channel — clear through the middle of the day, heavy warm
      // atmosphere while the sun is low (the golden-hour reference). The
      // lava-view override in main.js runs after this and still wins, and
      // the dimension branch below overwrites both when a fixed sky is up.
      fog.color.copy(horizon);
      const haze = a.haze + (b.haze - a.haze) * f;
      fog.near = SKY.FOG_NEAR + (SKY.HAZE_NEAR - SKY.FOG_NEAR) * haze;
      fog.far = SKY.FOG_FAR + (SKY.HAZE_FAR - SKY.FOG_FAR) * haze;

      // Baked-light uniforms. The skylight TINT rides its own keyframe
      // channel now (Phase 24): white at midday, warm through dawn and dusk,
      // cool at night — the light on the terrain agrees with the sky it
      // stands under at every point of the cycle.
      lastSkyDarken = skyDarken;
      CHUNK_LIGHT_UNIFORMS.uSkyDarken.value = skyDarken;
      CHUNK_LIGHT_UNIFORMS.uMinSkyLevel.value = 0;
      CHUNK_LIGHT_UNIFORMS.uSkyTint.value.lerpColors(a.tint, b.tint, f);

      // Directional light rides the sun by day, the moon by night.
      lightDir.copy(sunDir);
      if (lightDir.y <= 0) lightDir.negate();
      updateSun(sun, focus, lightDir);
      sun.intensity = LIGHTING.SUN_INTENSITY * sunLevel;
      ambient.intensity = LIGHTING.AMBIENT_INTENSITY * sunLevel;

      // Sun and moon quads ride the dome opposite each other; the moon's
      // halo rides with the moon.
      celestials.sun.position.copy(sunDir).multiplyScalar(CELESTIAL.DISTANCE);
      celestials.sun.lookAt(focus);
      celestials.moon.position.copy(sunDir).multiplyScalar(-CELESTIAL.DISTANCE);
      celestials.moon.lookAt(focus);
      celestials.moonGlow.position.copy(celestials.moon.position);
      celestials.moonGlow.lookAt(focus);

      // Phase 27 follow-up — MOONLIGHT on the dome: once the sun is down,
      // the dome's glow term switches to the moon — a wide, gentle wash of
      // cool light around it (glowBand relaxes so it works high in the
      // sky), fading in with the stars so dusk hands over smoothly.
      const night = sunDir.y < -0.05;
      if (night && !dimSky) {
        u.sunDirection.value.copy(sunDir).negate();
        u.glowStrength.value = Math.max(glow, CELESTIAL.MOON_SKY_GLOW * starAlpha);
        u.glowColor.value.setHex(CELESTIAL.MOON_SKY_GLOW_COLOR);
        u.glowBand.value = CELESTIAL.MOON_SKY_GLOW_BAND;
      } else {
        u.glowColor.value.setHex(DAY_NIGHT.GLOW_COLOR);
        u.glowBand.value = 0.45;
      }

      // Phase 24: the star wheel turns with the same orbit and fades with
      // its keyframe channel; the moon wears the day's phase; the cloud
      // layer drifts, takes the sky's light and (Phase 27 follow-up) the
      // sun's direction for its self-shading and silver linings.
      stars.setAngle(ang);
      stars.setAlpha(dimSky ? 0 : starAlpha);
      celestials.setMoonPhase(day % CELESTIAL.MOON_PHASES);
      if (!dimSky) {
        clouds?.update(delta, focus);
        clouds?.setLight(sunLevel, horizon);
        clouds?.setSun?.(sunDir, sunLevel);
        // Cloud shadows on the terrain track the SAME drifting field the
        // sky renders, projected along the sun. Off at night (the moon is
        // too dim to cast readable cloud shade) and under fixed skies.
        const CS = VISUAL.CLOUD_SHADOW;
        CHUNK_LIGHT_UNIFORMS.uCloudDrift.value.set(clouds?.getDrift?.() ?? 0, 0);
        const sy = Math.max(sunDir.y, CS.MIN_SUN_Y);
        CHUNK_LIGHT_UNIFORMS.uCloudSlant.value.set(
          (sunDir.x / sy) * CS.PROJECT_HEIGHT,
          (sunDir.z / sy) * CS.PROJECT_HEIGHT,
        );
        CHUNK_LIGHT_UNIFORMS.uCloudShadow.value =
          sunDir.y > 0 ? CS.STRENGTH * sunLevel : 0;
        // Directional face modelling rides the same light the shadows and
        // the directional scene light use: the sun by day, a fainter moon
        // by night (lightDir is already flipped above the horizon).
        CHUNK_LIGHT_UNIFORMS.uSunFaceDir.value.copy(lightDir);
        CHUNK_LIGHT_UNIFORMS.uSunFace.value = sunDir.y > 0
          ? VISUAL.SUNLIGHT.STRENGTH * sunLevel
          : VISUAL.SUNLIGHT.STRENGTH * VISUAL.SUNLIGHT.MOON_FACTOR * starAlpha;
      }

      // Dimension override (Phase 15): everything above still ran — the
      // clock advanced and the overworld palette stands ready for the
      // return trip — but the visible sky is the dimension's fixed profile.
      if (dimSky) {
        u.zenithColor.value.setHex(dimSky.FOG_COLOR);
        u.midColor.value.setHex(dimSky.FOG_COLOR);
        u.horizonColor.value.setHex(dimSky.FOG_COLOR);
        u.belowColor.value.setHex(dimSky.FOG_COLOR);
        u.glowStrength.value = 0;
        fog.color.setHex(dimSky.FOG_COLOR);
        fog.near = dimSky.FOG_NEAR;
        fog.far = dimSky.FOG_FAR;
        lastSkyDarken = dimSky.SKY_DARKEN;
        CHUNK_LIGHT_UNIFORMS.uSkyDarken.value = dimSky.SKY_DARKEN;
        CHUNK_LIGHT_UNIFORMS.uMinSkyLevel.value = dimSky.AMBIENT_LIGHT ?? 0;
        CHUNK_LIGHT_UNIFORMS.uSkyTint.value.setHex(dimSky.SKY_TINT);
        CHUNK_LIGHT_UNIFORMS.uCloudShadow.value = 0;
        CHUNK_LIGHT_UNIFORMS.uSunFace.value = 0;
      }
    },
  };
}
