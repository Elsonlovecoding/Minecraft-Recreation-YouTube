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
//    matched to the horizon, a square sun and moon riding the dome, and the
//    directional sun light (for later entity phases) tracking the same orbit.
// Vertex AO itself is baked in the mesher (world/chunks.js) from the same
// corner cells that sample this module's light.

import * as THREE from 'three';
import {
  SKY, DAY_NIGHT, CELESTIAL, LIGHTING, TIME, VIEW, RENDER, CHUNK,
} from '../config.js';
import { BLOCKS } from '../world/blocks.js';

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
  varying vec3 vDir;
  void main() {
    vec3 nd = normalize(vDir);
    float h = nd.y;
    vec3 col = mix(horizonColor, midColor, smoothstep(0.0, midStop, h));
    col = mix(col, zenithColor, smoothstep(midStop, 1.0, h));
    col = mix(belowColor, col, smoothstep(-0.2, 0.0, h));
    // Sunrise/sunset: warm glow near the horizon, strongest toward the sun
    float sunAmount = max(dot(nd, sunDirection), 0.0);
    float horizonBand = 1.0 - smoothstep(0.0, 0.45, abs(h));
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
        'attribute vec2 light;\nvarying vec2 vLight;\nvarying vec3 vHeldWorldPos;\n#include <common>')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n'
        + 'vLight = light;\n'
        + 'vHeldWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
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
        + '#include <common>')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        {
          float skyLevel = clamp(vLight.x * 15.0 - uSkyDarken, 0.0, 15.0);
          float blockLevel = vLight.y * 15.0;
          vec3 skyLum = pow(uLightFalloff, 15.0 - skyLevel) * uSkyTint;
          vec3 blockLum = pow(uLightFalloff, 15.0 - blockLevel) * uTorchTint;
          // Held-torch dynamic light (Phase 14): one level lost per block of
          // euclidean distance from the player — the same falloff curve as
          // baked light, smooth instead of cell-quantised, and applied here
          // at render time so it costs zero remeshing as the player moves.
          float heldLevel = clamp(uHeldLightLevel - distance(vHeldWorldPos, uHeldLightPos), 0.0, 15.0);
          vec3 heldLum = pow(uLightFalloff, 15.0 - heldLevel) * uHeldLightTint;
          diffuseColor.rgb *= max(max(skyLum, blockLum), heldLum);
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

// The square sun and moon, children of the sky dome so they follow the
// camera automatically. Drawn after the dome (renderOrder), depth-tested so
// terrain still occludes them, and never fogged.
function createCelestials(sky) {
  const make = (size, color, order) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        color, fog: false, toneMapped: false, depthWrite: false,
      }),
    );
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    sky.add(mesh);
    return mesh;
  };
  return {
    sun: make(CELESTIAL.SUN_SIZE, CELESTIAL.SUN_COLOR, -1),
    moon: make(CELESTIAL.MOON_SIZE, CELESTIAL.MOON_COLOR, -1),
  };
}

// Drives everything time-of-day: sky palette, fog colour (always the horizon
// colour), baked-light uniforms, sun/moon positions, and the directional
// light. Call update(delta, focus) once per frame; focus is the camera
// position. t convention: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight.
export function createDayNightCycle({ sky, fog, sun, ambient }) {
  const frames = DAY_NIGHT.KEYFRAMES.map((k) => ({
    t: k.T,
    zenith: new THREE.Color(k.ZENITH),
    mid: new THREE.Color(k.MID),
    horizon: new THREE.Color(k.HORIZON),
    below: new THREE.Color(k.BELOW),
    sunLevel: k.SUN_LEVEL,
    skyDarken: k.SKY_DARKEN,
    glow: k.GLOW,
  }));
  const maxDarken = Math.max(1, ...frames.map((f) => f.skyDarken));
  const celestials = createCelestials(sky);

  const white = new THREE.Color(1, 1, 1);
  const nightTint = new THREE.Color(LIGHTING.NIGHT_SKY_TINT);
  const horizon = new THREE.Color();
  const sunDir = new THREE.Vector3();
  const lightDir = new THREE.Vector3();

  let time = TIME.START_TIME * TIME.DAY_LENGTH_SECONDS;
  let lastSkyDarken = 0;

  return {
    get timeOfDay() {
      return time / TIME.DAY_LENGTH_SECONDS;
    },
    // Current skylight darkening (0 day .. 11 deep night) — the hostile
    // spawner combines it with baked sky light for the effective level.
    get skyDarken() {
      return lastSkyDarken;
    },
    // Jump to a day fraction (dev scaffolding: window.__dayNight.setTimeOfDay(0.5))
    setTimeOfDay(t) {
      time = (((t % 1) + 1) % 1) * TIME.DAY_LENGTH_SECONDS;
    },
    update(delta, focus) {
      time = (time + delta) % TIME.DAY_LENGTH_SECONDS;
      const t = time / TIME.DAY_LENGTH_SECONDS;

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
      const skyDarken = a.skyDarken + (b.skyDarken - a.skyDarken) * f;
      const glow = a.glow + (b.glow - a.glow) * f;
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
      // every point of the cycle.
      fog.color.copy(horizon);

      // Baked-light uniforms: skylight dims (and cools) toward night.
      lastSkyDarken = skyDarken;
      CHUNK_LIGHT_UNIFORMS.uSkyDarken.value = skyDarken;
      CHUNK_LIGHT_UNIFORMS.uSkyTint.value
        .lerpColors(white, nightTint, skyDarken / maxDarken);

      // Directional light rides the sun by day, the moon by night.
      lightDir.copy(sunDir);
      if (lightDir.y <= 0) lightDir.negate();
      updateSun(sun, focus, lightDir);
      sun.intensity = LIGHTING.SUN_INTENSITY * sunLevel;
      ambient.intensity = LIGHTING.AMBIENT_INTENSITY * sunLevel;

      // Sun and moon quads ride the dome opposite each other.
      celestials.sun.position.copy(sunDir).multiplyScalar(CELESTIAL.DISTANCE);
      celestials.sun.lookAt(focus);
      celestials.moon.position.copy(sunDir).multiplyScalar(-CELESTIAL.DISTANCE);
      celestials.moon.lookAt(focus);
    },
  };
}
