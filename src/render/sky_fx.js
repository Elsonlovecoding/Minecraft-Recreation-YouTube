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
  const coarse = lattice(16); // big weather systems
  const fine = lattice(4);    // ragged blocky edges
  return (cx, cz) => 0.62 * coarse(cx, cz) + 0.38 * fine(cx, cz);
}

// One merged mesh of flat quads: the classic blocky cloud slabs. Greedy
// row-merge keeps it to a few thousand quads for the whole 2x2-tiled deck.
export function createClouds() {
  const C = CLOUDS;
  const cells = C.TILE_CELLS;
  const field = cloudField(cells, C.SEED);
  // Threshold the field at the requested coverage (sample its distribution
  // rather than assuming one — the two-octave blend is not uniform).
  const samples = [];
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) samples.push(field(x, z));
  }
  const sorted = [...samples].sort((a, b) => b - a);
  const threshold = sorted[Math.floor(C.COVER * sorted.length)];
  const on = (cx, cz) =>
    samples[((cz % cells) + cells) % cells * cells + (((cx % cells) + cells) % cells)] > threshold;

  const span = cells * C.CELL_SIZE;
  const positions = [];
  const indices = [];
  let count = 0;
  // 2x2 tiles of the period, so a mesh anchored within one period step of
  // the camera always covers at least half a period in every direction.
  for (let cz = 0; cz < cells * 2; cz++) {
    let runStart = -1;
    for (let cx = 0; cx <= cells * 2; cx++) {
      const isOn = cx < cells * 2 && on(cx, cz);
      if (isOn && runStart < 0) runStart = cx;
      if (!isOn && runStart >= 0) {
        const x0 = runStart * C.CELL_SIZE;
        const x1 = cx * C.CELL_SIZE;
        const z0 = cz * C.CELL_SIZE;
        const z1 = (cz + 1) * C.CELL_SIZE;
        positions.push(x0, 0, z0, x1, 0, z0, x0, 0, z1, x1, 0, z1);
        indices.push(count, count + 2, count + 1, count + 1, count + 2, count + 3);
        count += 4;
        runStart = -1;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: C.OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // over the dome and celestials, under the world's
                         // transparent passes (which depth-test anyway)

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
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1.5; // after the dome, before sun/moon
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

// The sun: a bright square core with a soft radial glow falling to nothing —
// rendered additively so the halo melts into whatever sky is behind it.
// Painted per pixel: the square's own edge gets a short soft falloff (no
// hard edge, per the brief) and the glow decays smoothly to the quad rim.
export function createSunTexture() {
  const W = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = W;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, W);
  const coreHalf = 0.5 / CELESTIAL.SUN_GLOW_SCALE; // core square half-size, uv units
  const soft = coreHalf * 0.35;                    // the core edge's soft band
  const [cr, cg, cb] = hexRgb(CELESTIAL.SUN_CORE_COLOR);
  const [gr, gg, gb] = hexRgb(CELESTIAL.SUN_GLOW_COLOR);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      const v = (y + 0.5) / W - 0.5;
      const dSquare = Math.max(Math.abs(u), Math.abs(v)); // square distance
      const dRound = Math.hypot(u, v);
      // Core: 1 inside the square, easing to 0 over the soft band.
      const core = 1 - Math.min(1, Math.max(0, (dSquare - coreHalf) / soft));
      // Glow: radial, strongest at the core edge, gone by the quad rim.
      const glow = 0.55 * Math.exp(-Math.max(0, dRound - coreHalf) * 7.0);
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
  return canvasTexture(canvas);
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
