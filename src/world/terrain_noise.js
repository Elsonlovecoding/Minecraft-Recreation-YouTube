// world/terrain_noise.js — the overworld heightmap's seeded noise machinery:
// integer coordinate hashes, 2D simplex noise and its fractal sum, moved
// VERBATIM out of world/terrain.js in Phase 24 per the ARCHITECTURE size cap
// (the rivers/surface-rules/vegetation pass grew terrain.js past it).
//
// Determinism contract (the world/noise.js rule): none of these functions
// may change behaviour — every generated world depends on their exact
// arithmetic. This is deliberately terrain.js's OWN copy, independent of
// world/noise.js's 3D machinery: the two modules stay independently
// testable and their seed streams never couple. Only mulberry32 is shared
// (world/noise.js) — it always was byte-identical in both.

import { mulberry32 } from './noise.js';

export { mulberry32 };

// Stateless integer coordinate hash → uint32. Deterministic per (seed, x, z),
// used for per-column decisions (trees, cacti, bedrock, dithering).
export function hash2(seed, x, z) {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

export function hash01(seed, x, z) {
  return hash2(seed, x, z) / 4294967296;
}

export function hash3_01(seed, x, y, z) {
  return hash01(seed ^ Math.imul(y, 0x9e3779b1), x, z);
}

// ---------------------------------------------------------------------------
// 2D simplex noise (Gustavson's reference algorithm), seeded permutation
// ---------------------------------------------------------------------------

const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

export class Simplex2D {
  constructor(random) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    this.permMod8 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod8[i] = this.perm[i] % 8;
    }
  }

  // Returns noise in [-1, 1].
  noise(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.permMod8[ii + this.perm[jj]];
    const gi1 = this.permMod8[ii + i1 + this.perm[jj + j1]];
    const gi2 = this.permMod8[ii + 1 + this.perm[jj + 1]];

    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      t0 *= t0;
      n += t0 * t0 * (GRAD2[gi0][0] * x0 + GRAD2[gi0][1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      t1 *= t1;
      n += t1 * t1 * (GRAD2[gi1][0] * x1 + GRAD2[gi1][1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      t2 *= t2;
      n += t2 * t2 * (GRAD2[gi2][0] * x2 + GRAD2[gi2][1] * y2);
    }
    return 70 * n;
  }
}

// Fractal Brownian motion over a Simplex2D instance, normalised to [-1, 1].
export function fbm(noise, x, z, octaves, persistence = 0.5, lacunarity = 2) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.noise(x * freq, z * freq);
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
