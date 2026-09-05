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
// The chunk material patch (patchChunkMaterial + CHUNK_LIGHT_UNIFORMS +
// heldLightBrightness) lives in render/chunk_shader.js since the size-cap
// split; this file drives it.

import * as THREE from 'three';
import {
  SKY, DAY_NIGHT, CELESTIAL, LIGHTING, TIME, VIEW, RENDER, CHUNK, VISUAL,
} from '../config.js';
import { BLOCKS } from '../world/blocks.js';
// Phase 24: clouds, stars and the generated sun/moon art live in their own
// module (render/sky_fx.js) per the size cap — this file keeps the CYCLE
// that drives them.
import {
  createStars, createSunTexture, createMoonTextures, createMoonGlowTexture,
  forceFarDepth,
} from './sky_fx.js';
// The chunk material patch + its uniforms moved to render/chunk_shader.js
// (the mandated size-cap cut); the cycle below still writes the uniforms.
import { CHUNK_LIGHT_UNIFORMS } from './chunk_shader.js';

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
  uniform vec3 moonDirection;
  uniform vec3 moonGlowColor;
  uniform float moonGlowStrength;
  uniform float moonGlowBand;
  varying vec3 vDir;
  void main() {
    vec3 nd = normalize(vDir);
    float h = nd.y;
    vec3 col = mix(horizonColor, midColor, smoothstep(0.0, midStop, h));
    col = mix(col, zenithColor, smoothstep(midStop, 1.0, h));
    col = mix(belowColor, col, smoothstep(-0.2, 0.0, h));
    // Sunrise/sunset: warm glow near the horizon, strongest toward the sun.
    float sunAmount = max(dot(nd, sunDirection), 0.0);
    float horizonBand = 1.0 - smoothstep(0.0, glowBand, abs(h));
    col = mix(col, glowColor, glowStrength * horizonBand * pow(sunAmount, 6.0));
    // Moonlight: its OWN wash around the moon (a wide band — the moon
    // rides high), fading in with the stars. The twilight pass gave it a
    // separate term: the one shared glow used to snap from sunset gold to
    // moon silver the frame the sun dipped 3° under, while its strength
    // was still 0.9 — a visible pop at every dusk.
    float moonAmount = max(dot(nd, moonDirection), 0.0);
    float moonBand = 1.0 - smoothstep(0.0, moonGlowBand, abs(h));
    col = mix(col, moonGlowColor, moonGlowStrength * moonBand * pow(moonAmount, 6.0));
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
      glowBand: { value: 0.45 }, // the sun's glow hugs the horizon
      moonDirection: { value: new THREE.Vector3(0, -1, 0) },
      moonGlowColor: { value: new THREE.Color(CELESTIAL.MOON_SKY_GLOW_COLOR) },
      moonGlowStrength: { value: 0 },
      moonGlowBand: { value: CELESTIAL.MOON_SKY_GLOW_BAND },
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
  const WHITE = new THREE.Color(1, 1, 1);

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
    // The save pass restores the whole clock, day count included (it is
    // the moon-phase clock, and a world's age should survive a reload).
    setDay(d) {
      day = Math.max(0, Math.floor(d) || 0);
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
      // Eased interpolation (config DAY_NIGHT.EASE): a straight lerp's
      // rate of change jumps at every keyframe, which the eye reads as the
      // sky "changing gear" through dusk; blending toward smoothstep
      // rounds each corner off.
      const lin = ((t - a.t + 1) % 1) / span;
      const f = lin + (lin * lin * (3 - 2 * lin) - lin) * DAY_NIGHT.EASE;

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
      // The vibrant sun: the disc reddens toward the horizon (the additive
      // quad's colour multiplies its texture — white once the sun is well
      // up), and the moon's halo fades in with the stars instead of
      // hanging in the daytime sky.
      const sunHigh = THREE.MathUtils.smoothstep(sunDir.y, -0.02, CELESTIAL.SUN_HIGH_ELEVATION);
      celestials.sun.material.color.setHex(CELESTIAL.SUN_LOW_TINT).lerp(WHITE, sunHigh);
      celestials.moonGlow.material.opacity = 0.2 + 0.8 * starAlpha;

      // Phase 27 follow-up — MOONLIGHT on the dome: a wide, gentle wash of
      // cool light around the moon, on its own shader term (the twilight
      // pass), fading in with the stars once the sun is under so dusk
      // hands over smoothly — the sun's golden glow and the moon's silver
      // wash overlap through the blue hour instead of swapping.
      u.moonDirection.value.copy(sunDir).negate();
      u.moonGlowStrength.value = dimSky ? 0
        : CELESTIAL.MOON_SKY_GLOW * starAlpha * THREE.MathUtils.smoothstep(-sunDir.y, 0.0, 0.12);

      // Phase 24: the star wheel turns with the same orbit and fades with
      // its keyframe channel; the moon wears the day's phase; the cloud
      // layer drifts, takes the sky's light and (Phase 27 follow-up) the
      // sun's direction for its self-shading and silver linings.
      stars.setAngle(ang);
      stars.setAlpha(dimSky ? 0 : starAlpha);
      celestials.setMoonPhase(day % CELESTIAL.MOON_PHASES);
      if (!dimSky) {
        clouds?.update(delta, focus);
        clouds?.setLight(sunLevel, horizon, u.midColor.value);
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
        // Dawn valley mist (config VISUAL.MIST): a triangular window
        // around sunrise (t=0, wrapping) and a fainter one at dusk
        // (t=0.5). Low ground multiplies its fog depth up by this in the
        // vertex patch, so valleys drown while hilltops stand clear.
        const M = VISUAL.MIST;
        const dawnDist = Math.min(t, 1 - t); // wrapped distance to sunrise
        const dawn = Math.max(0, 1 - dawnDist / M.DAWN_WIDTH);
        const dusk = Math.max(0, 1 - Math.abs(t - 0.5) / M.DUSK_WIDTH);
        CHUNK_LIGHT_UNIFORMS.uMist.value =
          M.STRENGTH * Math.max(dawn, dusk * M.DUSK_FACTOR);
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
        CHUNK_LIGHT_UNIFORMS.uMist.value = 0; // no dawn under a fixed sky
      }
    },
  };
}
