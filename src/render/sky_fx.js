// render/sky_fx.js — the Phase 24 sky furniture: the cloud layer, the night
// starfield, and the generated sun/moon textures (a square sun inside a soft
// atmospheric glow; the eight-phase square moon). Split out of
// render/lighting.js per the ARCHITECTURE size cap — lighting.js keeps the
// light propagation and the day/night CYCLE (which drives everything here);
// this module only builds the objects and exposes small update hooks.
//
// Colour-exactness contract (see the sky-dome comment in lighting.js): every
// material here is toneMapped: false, and everything that must melt into the
// sky rather than end against it is fog: false — the cloud deck sits far
// beyond FOG_FAR, where linear fog would erase it entirely.

import * as THREE from 'three';
import { CLOUDS, STARS, CELESTIAL } from '../config.js';
import { mulberry32 } from '../world/noise.js';

// ---------------------------------------------------------------------------
// Celestial depth (Phase 26)
// ---------------------------------------------------------------------------

// Pins a material's geometry to the far plane in the vertex shader. The sun,
// moon and stars are "at infinity": ANY cloud fragment must occlude them. A
// plain depth test cannot guarantee that — the sun quad sits at
// CELESTIAL.DISTANCE (820), and a low sun's ray crosses the y=192 cloud deck
// ~125/sin(elevation) blocks out, which is FARTHER than 820 below ~9° of
// elevation: exactly the sunset case the "sun renders through clouds" report
// described. With gl_Position.z forced to w (minus an epsilon so the far
// clip keeps it), every depth-writing fragment in the scene wins against
// them, and the cloud deck (depthWrite, below) occludes per pixel.
export function forceFarDepth(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n\tgl_Position.z = gl_Position.w * 0.999999;',
    );
  };
}

// ---------------------------------------------------------------------------
// Clouds
// ---------------------------------------------------------------------------

// Wrapping value noise on the cloud-cell lattice: bilinear between hashed
// lattice corners, period `cells / step` — so the pattern tiles seamlessly
// and the 2x2-tiled mesh can re-anchor in period steps without a visible jump.
function cloudField(cells, seed) {
  const lattice = (step) => {
    const n = cells / step;
    const rng = mulberry32(seed ^ step);
    const grid = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) grid[i] = rng();
    return (cx, cz) => {
      const fx = cx / step;
      const fz = cz / step;
      const x0 = Math.floor(fx) % n;
      const z0 = Math.floor(fz) % n;
      const x1 = (x0 + 1) % n;
      const z1 = (z0 + 1) % n;
      const tx = fx - Math.floor(fx);
      const tz = fz - Math.floor(fz);
      const a = grid[z0 * n + x0] * (1 - tx) + grid[z0 * n + x1] * tx;
      const b = grid[z1 * n + x0] * (1 - tx) + grid[z1 * n + x1] * tx;
      return a * (1 - tz) + b * tz;
    };
  };
  return {
    coarse: lattice(16), // big weather systems (192-block features)
    fine: lattice(4),    // individual puffs (48-block features)
  };
}

// One merged mesh of cloud VOLUMES (the follow-up rebuild): every cloud is a
// slab CLOUDS.THICKNESS tall — a greedy row-merged top and bottom, plus side
// walls wherever a cell borders open sky — with per-face brightness baked as
// vertex colours (lit top, shadowed underside, mid walls), which is what
// makes the deck read as three-dimensional cumulus instead of paper.
// Front-face culled: from below you see undersides and far walls, from
// creative flight above you see tops, and the faces never alpha-stack
// against each other inside one slab.
export function createClouds() {
  const C = CLOUDS;
  const cells = C.TILE_CELLS;
  const { coarse, fine } = cloudField(cells, C.SEED);
  // Two-stage pattern (the "more realistic" rework): the coarse octave is a
  // WEATHER GATE — only its top WEATHER_SHARE of the deck may hold cloud at
  // all — and inside those regions the fine octave is thresholded to hit the
  // requested global coverage. Requiring BOTH breaks the old merged blend's
  // continent-sized sheet into groups of distinct cumulus puffs with real
  // clear sky between the groups. Both thresholds are read off the sampled
  // distributions rather than assumed — neither field is uniform.
  const coarseSamples = [];
  const fineSamples = [];
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      coarseSamples.push(coarse(x, z));
      fineSamples.push(fine(x, z));
    }
  }
  const at = (arr, cx, cz) =>
    arr[((cz % cells) + cells) % cells * cells + (((cx % cells) + cells) % cells)];
  const sortedCoarse = [...coarseSamples].sort((a, b) => b - a);
  const weatherT = sortedCoarse[Math.floor(C.WEATHER_SHARE * sortedCoarse.length)];
  // Fine threshold from the distribution INSIDE weather regions, so COVER
  // means the same fraction of the whole deck whatever the gate admits.
  const inWeather = [];
  for (let i = 0; i < coarseSamples.length; i++) {
    if (coarseSamples[i] > weatherT) inWeather.push(fineSamples[i]);
  }
  inWeather.sort((a, b) => b - a);
  const wantOn = Math.floor(C.COVER * coarseSamples.length);
  const fineT = inWeather[Math.min(inWeather.length - 1, wantOn)] ?? Infinity;
  const rawOn = (cx, cz) =>
    at(coarseSamples, cx, cz) > weatherT && at(fineSamples, cx, cz) > fineT;
  // A lone cell with no orthogonal neighbour is confetti, not a cloud.
  const on = (cx, cz) =>
    rawOn(cx, cz) && (
      rawOn(cx - 1, cz) || rawOn(cx + 1, cz) || rawOn(cx, cz - 1) || rawOn(cx, cz + 1)
    );

  const span = cells * C.CELL_SIZE;
  const S = C.CELL_SIZE;
  const H = C.THICKNESS;
  // The BRIGHTNESS numbers are what the faces should LOOK like — convert to
  // linear for the vertex-colour multiply, or 0.7 renders as ~0.85 (the
  // sRGB/linear trap that bit the particle colours, the cloud night tint
  // and the stars before this).
  const srgb = (v) => new THREE.Color(v, v, v).convertSRGBToLinear().r;
  const B = {
    TOP: srgb(C.BRIGHTNESS.TOP),
    BOTTOM: srgb(C.BRIGHTNESS.BOTTOM),
    SIDE_X: srgb(C.BRIGHTNESS.SIDE_X),
    SIDE_Z: srgb(C.BRIGHTNESS.SIDE_Z),
  };
  const positions = [];
  const colors = [];
  const indices = [];
  let count = 0;
  // A quad from four corners with a known outward normal; the winding is
  // corrected against the normal so front-face culling always keeps the
  // outside. `b` is the face's baked brightness (multiplied by the
  // day/night material colour at render time).
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const quad = (a, bq, c, d, normal, b) => {
    va.set(bq[0] - a[0], bq[1] - a[1], bq[2] - a[2]);
    vb.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    va.cross(vb);
    const flip = va.x * normal[0] + va.y * normal[1] + va.z * normal[2] < 0;
    const [p1, p3] = flip ? [d, bq] : [bq, d];
    positions.push(...a, ...p1, ...c, ...p3);
    for (let i = 0; i < 4; i++) colors.push(b, b, b);
    indices.push(count, count + 1, count + 2, count, count + 2, count + 3);
    count += 4;
  };
  // 2x2 tiles of the period, so a mesh anchored within one period step of
  // the camera always covers at least half a period in every direction.
  for (let cz = 0; cz < cells * 2; cz++) {
    let runStart = -1;
    for (let cx = 0; cx <= cells * 2; cx++) {
      const isOn = cx < cells * 2 && on(cx, cz);
      if (isOn && runStart < 0) runStart = cx;
      if (!isOn && runStart >= 0) {
        const x0 = runStart * S;
        const x1 = cx * S;
        const z0 = cz * S;
        const z1 = (cz + 1) * S;
        // Top and bottom span the whole merged run.
        quad([x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1], [0, 1, 0], B.TOP);
        quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, -1, 0], B.BOTTOM);
        // Run end caps (the -x/+x walls of the whole run).
        quad([x0, 0, z0], [x0, H, z0], [x0, H, z1], [x0, 0, z1], [-1, 0, 0], B.SIDE_X);
        quad([x1, 0, z0], [x1, H, z0], [x1, H, z1], [x1, 0, z1], [1, 0, 0], B.SIDE_X);
        // z walls per cell, only where the neighbouring row is open sky.
        for (let cc = runStart; cc < cx; cc++) {
          const wx0 = cc * S;
          const wx1 = (cc + 1) * S;
          if (!on(cc, cz - 1)) {
            quad([wx0, 0, z0], [wx1, 0, z0], [wx1, H, z0], [wx0, H, z0], [0, 0, -1], B.SIDE_Z);
          }
          if (!on(cc, cz + 1)) {
            quad([wx0, 0, z1], [wx1, 0, z1], [wx1, H, z1], [wx0, H, z1], [0, 0, 1], B.SIDE_Z);
          }
        }
        runStart = -1;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: C.OPACITY,
    side: THREE.FrontSide,
    // Phase 26 ("the sun renders through clouds"): the deck WRITES depth
    // now, and draws BEFORE the stars and sun/moon quads (renderOrder),
    // which are pinned to the far plane (forceFarDepth above). Anything
    // above the cloud layer fails the depth test wherever a cloud fragment
    // landed first — per-pixel occlusion, the vanilla draw order. Terrain
    // never conflicts: peaks stop at ~140, the deck sits at 192, and the
    // opaque pass has already depth-written before any of this draws.
    depthWrite: true,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = -1.9; // after the dome, BEFORE stars and sun/moon —
                           // the deck must be in the depth buffer when the
                           // far-plane celestials test against it

  let drift = 0;
  const white = new THREE.Color(1, 1, 1);
  const tinted = new THREE.Color();
  return {
    mesh,
    // Steady drift along -x; the mesh re-anchors to the pattern lattice in
    // whole periods around the camera, so coverage always reaches at least
    // span/2 (= 576 blocks) past the player in every direction.
    update(delta, focus) {
      drift = (drift + delta * C.SPEED) % span;
      const ox = -drift + span * Math.round((focus.x + drift - span) / span);
      const oz = span * Math.round((focus.z - span) / span);
      mesh.position.set(ox, C.HEIGHT, oz);
      mesh.updateMatrix();
    },
    // Day/night: clouds darken with the sky and blush toward the horizon
    // colour at dawn/dusk. The maths runs in sRGB so the brightness scale
    // means what it looks like — three stores material colours LINEAR and
    // the renderer converts on output, which would otherwise lift a 0.28
    // night grey to a 0.57 sheet (it did, in the first night screenshot).
    setLight(sunLevel, horizonColor) {
      const b = C.NIGHT_BRIGHTNESS + (1 - C.NIGHT_BRIGHTNESS) * sunLevel;
      tinted.copy(horizonColor).convertLinearToSRGB();
      tinted.lerpColors(white, tinted, C.HORIZON_TINT).multiplyScalar(b);
      material.color.copy(tinted.convertSRGBToLinear());
    },
    setVisible(v) {
      mesh.visible = v;
    },
  };
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

// A fixed hashed starfield on the celestial sphere, parented to the sky dome
// (which follows the camera) inside a group the cycle rotates with the sun's
// orbit angle — the stars wheel across the night like the real thing. The
// field covers the FULL sphere: the wheel turns 360° per day, so any band
// of empty sphere would sweep across the visible sky (the first cut seeded
// only the upper band and midnight showed a half-empty sky).
export function createStars(sky) {
  const S = STARS;
  const rng = mulberry32(S.SEED);
  const positions = new Float32Array(S.COUNT * 3);
  for (let i = 0; i < S.COUNT; i++) {
    const y = rng() * 2 - 1; // uniform over the whole sphere
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    positions[i * 3] = Math.cos(a) * r * S.RADIUS;
    positions[i * 3 + 1] = y * S.RADIUS;
    positions[i * 3 + 2] = Math.sin(a) * r * S.RADIUS;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: S.SIZE,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  // Phase 26: stars sit at the far plane and depth-test, so the cloud deck
  // (which now writes depth, above) occludes them per pixel.
  forceFarDepth(material);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1.5; // after the dome AND the clouds, before sun/moon
  const group = new THREE.Group();
  group.add(points);
  sky.add(group);
  return {
    group,
    setAlpha(a) {
      material.opacity = a;
      points.visible = a > 0.002;
    },
    // The wheel: rotate with the sun's orbit angle around its own axis.
    setAngle(ang) {
      group.rotation.z = ang;
    },
  };
}

// ---------------------------------------------------------------------------
// Sun and moon textures
// ---------------------------------------------------------------------------

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

const hexRgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

// The sun: a bright ROUND disc with a soft radial glow — rendered additively
// so the halo melts into whatever sky is behind it. Two rules keep the quad
// invisible (the follow-up fix — "the sun shouldn't have that box around
// it", and it had one): the glow is WINDOWED so it reaches exactly zero
// before the quad rim (the old exponential still carried alpha ~16/255 at
// the edge, which additive blending drew as a faint square against the
// sky), and the texture filters LINEARLY (Nearest magnification turned the
// smooth gradient into visible stair-stepped blocks). The moon keeps its
// pixel-art Nearest filtering — that one is meant to look blocky.
export function createSunTexture() {
  const W = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = W;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, W);
  const coreR = 0.5 / CELESTIAL.SUN_GLOW_SCALE; // disc radius, uv units
  const soft = coreR * 0.22;                    // the disc edge's soft band
  const RIM = 0.5;                              // quad half-extent in uv
  const [cr, cg, cb] = hexRgb(CELESTIAL.SUN_CORE_COLOR);
  const [gr, gg, gb] = hexRgb(CELESTIAL.SUN_GLOW_COLOR);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      const v = (y + 0.5) / W - 0.5;
      const d = Math.hypot(u, v);
      // Core: 1 inside the disc, easing to 0 over the soft band.
      const core = 1 - Math.min(1, Math.max(0, (d - coreR) / soft));
      // Glow: radial decay from the disc edge, multiplied by a smooth
      // window that is exactly 0 at the quad rim — no rim, no box. The
      // strength is config now (Phase 26 raised it for the reference's
      // big soft halo); the falloff relaxes as the quad grows so the halo
      // uses the room the larger SUN_GLOW_SCALE gives it.
      const fall = Math.exp(-Math.max(0, d - coreR) * (6.0 / (CELESTIAL.SUN_GLOW_SCALE / 2.6)));
      const window_ = Math.max(0, 1 - d / RIM);
      const glow = CELESTIAL.SUN_GLOW_STRENGTH * fall * window_ * window_;
      const a = Math.min(1, core + glow);
      const i = (y * W + x) * 4;
      const t = core; // blend the halo hue toward the core's white centre
      img.data[i] = Math.round(gr + (cr - gr) * t);
      img.data[i + 1] = Math.round(gg + (cg - gg) * t);
      img.data[i + 2] = Math.round(gb + (cb - gb) * t);
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;   // a gradient, not pixel art
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

// The eight moon phases as separate small textures — the vanilla square
// moon, its unlit part left as a faint disc. Phase 0 is full; the
// terminator is the classic ellipse, waning through new (4) and waxing back.
export function createMoonTextures() {
  const P = 32;
  const phases = [];
  const [lr, lg, lb] = hexRgb(CELESTIAL.MOON_LIT_COLOR);
  const darkAlpha = Math.round(CELESTIAL.MOON_DARK_ALPHA * 255);
  for (let phase = 0; phase < CELESTIAL.MOON_PHASES; phase++) {
    const canvas = document.createElement('canvas');
    canvas.width = P;
    canvas.height = P;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(P, P);
    for (let y = 0; y < P; y++) {
      for (let x = 0; x < P; x++) {
        const xn = ((x + 0.5) / P) * 2 - 1;
        const yn = ((y + 0.5) / P) * 2 - 1;
        const bulge = Math.sqrt(Math.max(0, 1 - yn * yn));
        let lit;
        if (phase === 0) lit = true;
        else if (phase === 4) lit = false;
        else if (phase < 4) lit = xn < Math.cos((Math.PI * phase) / 4) * bulge;
        else lit = xn > -Math.cos((Math.PI * (8 - phase)) / 4) * bulge;
        // A hashed speckle keeps the face from reading as flat plastic.
        let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) | 0;
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
        const grain = 0.88 + ((h >>> 8) & 0xff) / 255 * 0.12;
        const i = (y * P + x) * 4;
        if (lit) {
          img.data[i] = Math.round(lr * grain);
          img.data[i + 1] = Math.round(lg * grain);
          img.data[i + 2] = Math.round(lb * grain);
          img.data[i + 3] = 255;
        } else {
          img.data[i] = 24;
          img.data[i + 1] = 28;
          img.data[i + 2] = 44;
          img.data[i + 3] = darkAlpha;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    phases.push(canvasTexture(canvas));
  }
  return phases;
}
