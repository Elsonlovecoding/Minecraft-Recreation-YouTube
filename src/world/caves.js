// world/caves.js — Phase 9 underground generation: cave carving (two noise
// layers — winding tunnels and open caverns), rare ravines, surface entrances,
// lava pools below OVERWORLD.LAVA_POOL_MAX_Y, granite/diorite/andesite blobs,
// gravel pockets and ore veins per config ORES.
//
// Everything is a pure function of (seed, x, y, z): the 3D fields are sampled
// on a world-aligned lattice (every CAVES.LATTICE_STEP blocks) and
// interpolated per block, so adjacent chunks agree on every border cell
// whatever order they generate in; ravines are per-column 2D math; veins and
// pockets draw from a per-chunk seeded PRNG and only ever write their own
// chunk. TerrainGenerator calls `apply` after the base column fill and before
// decorations, and consults `surfaceOpenAt` so trees and cacti never anchor
// on a carved-away surface.
//
// All tunables live in config.js CAVES / UNDERGROUND / ORES.

import { OVERWORLD, CHUNK, CAVES, ORES, UNDERGROUND } from '../config.js';
import { BLOCK } from './blocks.js';

// ---------------------------------------------------------------------------
// Seeded randomness (same primitives as world/terrain.js, kept local so the
// modules stay independently testable)
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(seed, x, z) {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

function hash01(seed, x, z) {
  return hash2(seed, x, z) / 4294967296;
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Shared lerp helpers — the per-chunk carve loop and the pure surface query
// must combine lattice corners with EXACTLY the same arithmetic so they can
// never disagree about a threshold crossing.
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function bilerp(v00, v10, v01, v11, tx, tz) {
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), tz);
}

// ---------------------------------------------------------------------------
// Seeded simplex noise, 2D and 3D (Gustavson's reference algorithms)
// ---------------------------------------------------------------------------

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

class SimplexNoise {
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
    this.permMod12 = new Uint8Array(512);
    this.permMod8 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
      this.permMod8[i] = this.perm[i] % 8;
    }
  }

  // 2D noise in [-1, 1].
  noise2(xin, yin) {
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
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      t0 *= t0;
      const g = GRAD2[this.permMod8[ii + this.perm[jj]]];
      n += t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      t1 *= t1;
      const g = GRAD2[this.permMod8[ii + i1 + this.perm[jj + j1]]];
      n += t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      t2 *= t2;
      const g = GRAD2[this.permMod8[ii + 1 + this.perm[jj + 1]]];
      n += t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * n;
  }

  // 3D noise in [-1, 1].
  noise3(xin, yin, zin) {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      t0 *= t0;
      const g = GRAD3[this.permMod12[ii + this.perm[jj + this.perm[kk]]]];
      n += t0 * t0 * (g[0] * x0 + g[1] * y0 + g[2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      t1 *= t1;
      const g = GRAD3[this.permMod12[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]]];
      n += t1 * t1 * (g[0] * x1 + g[1] * y1 + g[2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      t2 *= t2;
      const g = GRAD3[this.permMod12[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]]];
      n += t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      t3 *= t3;
      const g = GRAD3[this.permMod12[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]]];
      n += t3 * t3 * (g[0] * x3 + g[1] * y3 + g[2] * z3);
    }
    return 32 * n;
  }
}

// Fractal sums, normalised to [-1, 1].
function fbm2(noise, x, z, octaves) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.noise2(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function fbm3(noise, x, y, z, octaves) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.noise3(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// A 3D field: seeded noise + anisotropic scales, evaluated at block coords.
class Field3D {
  constructor(random, scaleXZ, scaleY, octaves) {
    this.noise = new SimplexNoise(random);
    this.sx = scaleXZ;
    this.sy = scaleY;
    this.octaves = octaves;
  }

  sample(x, y, z) {
    return fbm3(this.noise, x * this.sx, y * this.sy, z * this.sx, this.octaves);
  }
}

// ---------------------------------------------------------------------------
// Salts (independent hash/PRNG streams per feature)
// ---------------------------------------------------------------------------

const SALT_RAVINE_JITTER = 0x8a71;
const SALT_GRAVEL = 0x67a1;
const SALT_LAVA_LEAK = 0x1afa;
// Per-ore PRNG stream salts (stable — never reorder).
const ORE_SALTS = { coal: 0xc0a1, iron: 0x1207, gold: 0x601d, redstone: 0x8ed5, diamond: 0xd1a3 };
const ORE_BLOCKS = {
  coal: BLOCK.COAL_ORE,
  iron: BLOCK.IRON_ORE,
  gold: BLOCK.GOLD_ORE,
  redstone: BLOCK.REDSTONE_ORE,
  diamond: BLOCK.DIAMOND_ORE,
};

// Base terrain blocks caves may carve through. Water, bedrock and anything
// else (decorations come later anyway) are left alone.
const CARVABLE = new Uint8Array(256);
for (const id of [
  BLOCK.STONE, BLOCK.DIRT, BLOCK.GRASS_BLOCK, BLOCK.SAND, BLOCK.GRAVEL,
  BLOCK.SANDSTONE,
]) CARVABLE[id] = 1;

// Blocks ore veins and variant blobs may replace.
const STONE_FAMILY = new Uint8Array(256);
for (const id of [BLOCK.STONE, BLOCK.GRANITE, BLOCK.DIORITE, BLOCK.ANDESITE]) {
  STONE_FAMILY[id] = 1;
}

const STEP = CAVES.LATTICE_STEP;

export class CaveCarver {
  constructor(seed) {
    this.seed = seed | 0;
    const rand = (salt) => mulberry32(this.seed ^ salt);
    const T = CAVES.TUNNEL;
    const C = CAVES.CAVERN;
    const V = UNDERGROUND.VARIANTS;
    this.tunnelA = new Field3D(rand(0x7a5c1e01), T.SCALE_XZ, T.SCALE_Y, T.OCTAVES);
    this.tunnelB = new Field3D(rand(0x7a5c1e02), T.SCALE_XZ, T.SCALE_Y, T.OCTAVES);
    this.cavern = new Field3D(rand(0xca4e0003), C.SCALE_XZ, C.SCALE_Y, C.OCTAVES);
    this.variantA = new Field3D(rand(0x9a170004), V.SCALE_XZ, V.SCALE_Y, V.OCTAVES);
    this.variantB = new Field3D(rand(0x9a170005), V.SCALE_XZ, V.SCALE_Y, V.OCTAVES);
    this.ravineLine = new SimplexNoise(rand(0x4a710006));
    this.ravineMask = new SimplexNoise(rand(0x4a710007));
    this.entranceMask = new SimplexNoise(rand(0xe4a70008));
    // Phase 10: tunnel girth variation and the lava pool-region mask.
    const G = T.GIRTH;
    this.girth = new Field3D(rand(0x617a0009), G.SCALE_XZ, G.SCALE_Y, G.OCTAVES);
    this.lavaMask = new SimplexNoise(rand(0x1a7a000a));
  }

  // Tunnel radius multiplier from a raw girth-field value: MIN..MAX across
  // the noise range, clamped to at least 1 above the cave band so surface
  // mouths never shrink below walkable.
  _girthFactor(gv, y) {
    const G = CAVES.TUNNEL.GIRTH;
    let g = G.MIN + (G.MAX - G.MIN) * (gv * 0.5 + 0.5);
    if (y > CAVES.MAX_Y && g < 1) g = 1;
    return g;
  }

  // --- ravines (pure per-column 2D) ----------------------------------------

  // Carved depth below the surface at a column (0 = no ravine). The line
  // field's zero-contours supply long winding paths; the mask gates rarity
  // and tapers depth so ravines shallow out at their ends; the V profile
  // narrows them with depth.
  ravineDepthAt(x, z) {
    const R = CAVES.RAVINE;
    const mask = fbm2(this.ravineMask, x * R.MASK_SCALE, z * R.MASK_SCALE, 2);
    const gate = smoothstep(R.MASK_START, R.MASK_FULL, mask);
    if (gate <= 0) return 0;
    const line = fbm2(this.ravineLine, x * R.LINE_SCALE, z * R.LINE_SCALE, 2);
    let q = Math.abs(line) / R.WIDTH;
    q += (hash01(this.seed ^ SALT_RAVINE_JITTER, x, z) - 0.5) * R.EDGE_JITTER;
    if (q >= 1) return 0;
    return R.MAX_DEPTH * gate * Math.min(1, (1 - q) / R.NARROW);
  }

  // --- tunnel radius profile ------------------------------------------------

  // Entrance gate for a column: 0 outside entrance regions (tunnels never
  // pierce above MAX_Y there), rising to MAX_FACTOR inside — mouths stay
  // wide enough to walk into.
  _entranceGate(x, z) {
    const E = CAVES.ENTRANCE;
    const m = fbm2(this.entranceMask, x * E.MASK_SCALE, z * E.MASK_SCALE, 2);
    return E.MAX_FACTOR * smoothstep(E.MASK_START, E.MASK_FULL, m);
  }

  // Radius multiplier at a height: tapers closed at the bottom of the cave
  // band; above MAX_Y the column's entrance gate applies (with a gentle
  // height taper) so tunnels continue to the surface only inside entrance
  // regions.
  _radiusFactor(y, gate = 0) {
    if (y < CAVES.MIN_Y) return 0;
    if (y < CAVES.MIN_Y + CAVES.BOTTOM_FADE_BLOCKS) {
      return (y - CAVES.MIN_Y) / CAVES.BOTTOM_FADE_BLOCKS;
    }
    if (y > CAVES.MAX_Y) {
      return gate * Math.exp(-CAVES.ENTRANCE.DECAY * (y - CAVES.MAX_Y));
    }
    return 1;
  }

  // Cavern threshold at a height (Infinity = never). Loosens with depth,
  // fades out above MAX_Y and closes at the bottom of the band.
  _cavernThreshold(y) {
    const C = CAVES.CAVERN;
    if (y > C.MAX_Y || y < CAVES.MIN_Y) return Infinity;
    let t;
    if (y <= C.FULL_BELOW_Y) t = C.THRESHOLD_DEEP;
    else if (y <= C.SHALLOW_Y) {
      t = lerp(C.THRESHOLD_DEEP, C.THRESHOLD_SHALLOW,
        (y - C.FULL_BELOW_Y) / (C.SHALLOW_Y - C.FULL_BELOW_Y));
    } else {
      t = lerp(C.THRESHOLD_SHALLOW, 1.05, (y - C.SHALLOW_Y) / (C.MAX_Y - C.SHALLOW_Y));
    }
    const fadeIn = CAVES.MIN_Y + CAVES.BOTTOM_FADE_BLOCKS;
    if (y < fadeIn) t += (1 - (y - CAVES.MIN_Y) / CAVES.BOTTOM_FADE_BLOCKS);
    return t;
  }

  // --- pure point query (world-aligned lattice interpolation) --------------

  // Interpolated field value at an arbitrary block position, from the same
  // lattice corner samples the chunk carve uses — a caller anywhere (this
  // chunk, a neighbour's margin) gets bit-identical values.
  _fieldAt(field, x, y, z) {
    const X0 = Math.floor(x / STEP) * STEP;
    const Y0 = Math.floor(y / STEP) * STEP;
    const Z0 = Math.floor(z / STEP) * STEP;
    const tx = (x - X0) / STEP;
    const ty = (y - Y0) / STEP;
    const tz = (z - Z0) / STEP;
    const v0 = bilerp(
      field.sample(X0, Y0, Z0), field.sample(X0 + STEP, Y0, Z0),
      field.sample(X0, Y0, Z0 + STEP), field.sample(X0 + STEP, Y0, Z0 + STEP),
      tx, tz,
    );
    const v1 = bilerp(
      field.sample(X0, Y0 + STEP, Z0), field.sample(X0 + STEP, Y0 + STEP, Z0),
      field.sample(X0, Y0 + STEP, Z0 + STEP), field.sample(X0 + STEP, Y0 + STEP, Z0 + STEP),
      tx, tz,
    );
    return lerp(v0, v1, ty);
  }

  // Would the tunnel layer carve this cell? (pure; used by surfaceOpenAt —
  // the girth lookup interpolates the same lattice arithmetic the chunk
  // carve uses, AND the radius product multiplies in the same order —
  // float multiplication is non-associative, so a different association
  // here would leave agreement to rounding luck)
  _tunnelCarvesAt(x, y, z, gate) {
    const factor = this._radiusFactor(y, gate);
    if (factor <= 0) return false;
    const g = this._girthFactor(this._fieldAt(this.girth, x, y, z), y);
    const r = CAVES.TUNNEL.RADIUS * g * factor; // same order as the carve loop
    const a = this._fieldAt(this.tunnelA, x, y, z);
    const b = this._fieldAt(this.tunnelB, x, y, z);
    return a * a + b * b < r * r;
  }

  // Is a column's surface entrance-eligible? (dry inland grass/stone tops
  // only — sand would float and oceans must stay sealed)
  _entranceEligible(col) {
    return (
      col.height > OVERWORLD.SEA_LEVEL + 1 &&
      col.height <= CAVES.ENTRANCE.MAX_SURFACE_Y &&
      (col.surface.top === BLOCK.GRASS_BLOCK || col.surface.top === BLOCK.STONE)
    );
  }

  // Does anything carve this column's surface block away? Decorations (trees,
  // cacti) consult this so they never anchor over a cave mouth or ravine.
  // Pure — margin anchors outside the chunk get the same answer the owning
  // chunk computes. `colAt` supplies neighbour columns for the ocean shield.
  surfaceOpenAt(col, colAt) {
    const S = CAVES.OCEAN_SHIELD;
    for (let dz = -S.RADIUS; dz <= S.RADIUS; dz++) {
      for (let dx = -S.RADIUS; dx <= S.RADIUS; dx++) {
        if (colAt(col.x + dx, col.z + dz).height <= OVERWORLD.SEA_LEVEL) return false;
      }
    }
    if (col.height > OVERWORLD.SEA_LEVEL + 1 && this.ravineDepthAt(col.x, col.z) > 0) {
      return true;
    }
    if (!this._entranceEligible(col)) return false;
    const gate = this._entranceGate(col.x, col.z);
    return gate > 0 && this._tunnelCarvesAt(col.x, col.height, col.z, gate);
  }

  // --- chunk carve + populate ----------------------------------------------

  // Carves caves and ravines into a freshly filled chunk, then places stone
  // variants, gravel pockets and ore veins. `colAt(wx, wz)` is terrain's
  // cached column lookup (covers the chunk plus its margin).
  apply(chunk, colAt) {
    const size = CHUNK.SIZE;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;
    const sea = OVERWORLD.SEA_LEVEL;
    const S = CAVES.OCEAN_SHIELD;

    // Heights over the chunk plus the shield radius, then per-column data.
    const hr = S.RADIUS;
    const hw = size + 2 * hr;
    const heights = new Int32Array(hw * hw);
    for (let z = 0; z < hw; z++) {
      for (let x = 0; x < hw; x++) {
        heights[z * hw + x] = colAt(x0 + x - hr, z0 + z - hr).height;
      }
    }

    const colH = new Int32Array(size * size);       // surface height
    const colTop = new Int32Array(size * size);     // highest y caves may carve
    const colRav = new Float32Array(size * size);   // ravine depth (0 = none)
    const colGate = new Float64Array(size * size);  // entrance gate factor
    let latTop = CAVES.MIN_Y;
    let maxH = CAVES.MIN_Y;
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const col = colAt(x0 + lx, z0 + lz);
        const i = lz * size + lx;
        const h = col.height;
        colH[i] = h;
        if (h > maxH) maxH = h;

        // Ocean shield: keep a sealed floor under and around any water.
        let minH = h;
        for (let dz = -hr; dz <= hr; dz++) {
          for (let dx = -hr; dx <= hr; dx++) {
            const nh = heights[(lz + hr + dz) * hw + (lx + hr + dx)];
            if (nh < minH) minH = nh;
          }
        }
        const shielded = minH <= sea;

        const gate = !shielded && this._entranceEligible(col)
          ? this._entranceGate(x0 + lx, z0 + lz)
          : 0;
        colGate[i] = gate;
        let top = gate > 0 ? h : Math.min(h, CAVES.MAX_Y);
        if (shielded) top = Math.min(top, minH - S.DEPTH);
        colTop[i] = top;
        if (top > latTop) latTop = top;

        colRav[i] = shielded || h <= sea + 1 ? 0 : this.ravineDepthAt(x0 + lx, z0 + lz);
      }
    }

    // World-aligned lattice samples for the carve band.
    const yLo = Math.floor(CAVES.MIN_Y / STEP) * STEP;
    const yHi = Math.max(yLo + STEP, Math.ceil(latTop / STEP) * STEP);
    const latA = this._buildLattice(this.tunnelA, x0, z0, yLo, yHi);
    const latB = this._buildLattice(this.tunnelB, x0, z0, yLo, yHi);
    const latC = this._buildLattice(this.cavern, x0, z0, yLo, yHi);
    const latG = this._buildLattice(this.girth, x0, z0, yLo, yHi);
    const ny = latA.ny;
    const colValA = new Float64Array(ny);
    const colValB = new Float64Array(ny);
    const colValC = new Float64Array(ny);
    const colValG = new Float64Array(ny);

    const rTun = CAVES.TUNNEL.RADIUS;
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const i = lz * size + lx;
        const top = colTop[i];
        const h = colH[i];
        const rav = colRav[i];
        const gate = colGate[i];
        if (top >= CAVES.MIN_Y) {
          this._blendColumn(latA, lx, lz, colValA);
          this._blendColumn(latB, lx, lz, colValB);
          this._blendColumn(latC, lx, lz, colValC);
          this._blendColumn(latG, lx, lz, colValG);
          for (let y = top; y >= CAVES.MIN_Y; y--) {
            const id = chunk.get(lx, y, lz);
            if (!CARVABLE[id]) continue;
            const j = (y - yLo) / STEP;
            // Clamp so y == yHi reads the top lattice level with ty = 1
            // instead of one past the end.
            const j0 = Math.min(Math.floor(j), ny - 2);
            const ty = j - j0;
            const a = lerp(colValA[j0], colValA[j0 + 1], ty);
            const b = lerp(colValB[j0], colValB[j0 + 1], ty);
            const g = this._girthFactor(lerp(colValG[j0], colValG[j0 + 1], ty), y);
            const r = rTun * g * this._radiusFactor(y, gate);
            let carve = a * a + b * b < r * r;
            if (!carve) {
              const tc = this._cavernThreshold(y);
              if (tc !== Infinity) {
                carve = lerp(colValC[j0], colValC[j0 + 1], ty) > tc;
              }
            }
            if (carve) chunk.set(lx, y, lz, BLOCK.AIR);
          }
        }
        if (rav > 0) {
          const floor = Math.max(Math.ceil(h - rav), CAVES.MIN_Y);
          for (let y = h; y >= floor; y--) {
            const id = chunk.get(lx, y, lz);
            if (!CARVABLE[id]) continue;
            chunk.set(lx, y, lz, BLOCK.AIR);
          }
        }
      }
    }

    this._placeLava(chunk, colH);
    this._placeVariants(chunk, maxH);
    const G = UNDERGROUND.GRAVEL_POCKETS;
    this._placeVeins(chunk, BLOCK.GRAVEL, SALT_GRAVEL, {
      MIN_Y: G.MIN_Y, MAX_Y: G.MAX_Y, ATTEMPTS_PER_CHUNK: G.ATTEMPTS_PER_CHUNK,
      VEIN_MIN: G.SIZE_MIN, VEIN_MAX: G.SIZE_MAX,
    });
    for (const name of Object.keys(ORES)) {
      this._placeVeins(chunk, ORE_BLOCKS[name], ORE_SALTS[name], ORES[name]);
    }
  }

  // Samples one field on the world-aligned lattice covering the chunk:
  // xs/zs every STEP across the chunk (5 columns each side), ys from yLo to
  // yHi inclusive. Layout: (ix * 5 + iz) * ny + iy, y-contiguous.
  _buildLattice(field, x0, z0, yLo, yHi) {
    const n = CHUNK.SIZE / STEP + 1;
    const ny = (yHi - yLo) / STEP + 1;
    const data = new Float64Array(n * n * ny);
    let o = 0;
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        const x = x0 + ix * STEP;
        const z = z0 + iz * STEP;
        for (let iy = 0; iy < ny; iy++) {
          data[o++] = field.sample(x, yLo + iy * STEP, z);
        }
      }
    }
    return { data, ny, yLo, n };
  }

  // Bilinear-blends the 4 lattice columns around a local column into `out`
  // (one value per lattice y level); the per-block y lerp happens after.
  _blendColumn(lat, lx, lz, out) {
    const { data, ny, n } = lat;
    const ix = Math.floor(lx / STEP);
    const iz = Math.floor(lz / STEP);
    const tx = (lx - ix * STEP) / STEP;
    const tz = (lz - iz * STEP) / STEP;
    const c00 = (ix * n + iz) * ny;
    const c10 = ((ix + 1) * n + iz) * ny;
    const c01 = (ix * n + iz + 1) * ny;
    const c11 = ((ix + 1) * n + iz + 1) * ny;
    for (let j = 0; j < ny; j++) {
      out[j] = bilerp(data[c00 + j], data[c10 + j], data[c01 + j], data[c11 + j], tx, tz);
    }
  }

  // --- lava placement (Phase 10) --------------------------------------------

  // Runs after all carving (its wall tests read final in-chunk carve state,
  // never a neighbour chunk, so generation order can't matter):
  //   - at/below CAVES.LAVA.LAKE_MAX_Y every carved cell floods — the deep
  //     lava lakes
  //   - between there and OVERWORLD.LAVA_POOL_MAX_Y, only small occasional
  //     pools: 1-deep puddles on cave floors inside sparse mask regions,
  //     plus rare single-block leaks against cave walls (interior cells
  //     only — border cells never leak, keeping the test in-chunk)
  _placeLava(chunk, colH) {
    const size = CHUNK.SIZE;
    const L = CAVES.LAVA;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;
    const bandTop = OVERWORLD.LAVA_POOL_MAX_Y - 1;
    const solidish = (id) =>
      id !== BLOCK.AIR && id !== BLOCK.LAVA && id !== BLOCK.WATER;
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const top = Math.min(bandTop, colH[lz * size + lx] - 1);
        if (top < CAVES.MIN_Y) continue;
        const wx = x0 + lx;
        const wz = z0 + lz;
        let poolRegion = null; // per-column mask, computed lazily
        for (let y = CAVES.MIN_Y; y <= top; y++) {
          if (chunk.get(lx, y, lz) !== BLOCK.AIR) continue;
          if (y <= L.LAKE_MAX_Y) {
            chunk.set(lx, y, lz, BLOCK.LAVA);
            continue;
          }
          // Floor puddles (scanning upward, a fresh puddle below reads as
          // lava — puddles never stack deeper than 1).
          if (solidish(chunk.get(lx, y - 1, lz))) {
            if (poolRegion === null) {
              poolRegion = fbm2(
                this.lavaMask,
                wx * L.POOL_MASK_SCALE, wz * L.POOL_MASK_SCALE, 2,
              ) > L.POOL_MASK_MIN;
            }
            if (poolRegion) {
              chunk.set(lx, y, lz, BLOCK.LAVA);
              continue;
            }
          }
          // Single-block wall leaks.
          if (
            lx > 0 && lx < size - 1 && lz > 0 && lz < size - 1 &&
            hash01(
              this.seed ^ SALT_LAVA_LEAK ^ Math.imul(y, 0x9e3779b1), wx, wz,
            ) < L.LEAK_CHANCE &&
            (solidish(chunk.get(lx - 1, y, lz)) ||
             solidish(chunk.get(lx + 1, y, lz)) ||
             solidish(chunk.get(lx, y, lz - 1)) ||
             solidish(chunk.get(lx, y, lz + 1)))
          ) {
            chunk.set(lx, y, lz, BLOCK.LAVA);
          }
        }
      }
    }
  }

  // --- stone variants -------------------------------------------------------

  // Granite / diorite / andesite blobs replacing plain stone, from two
  // low-frequency 3D fields (seamless across chunks). Uses the same lattice
  // machinery over the full stone range.
  _placeVariants(chunk, maxH) {
    const size = CHUNK.SIZE;
    const V = UNDERGROUND.VARIANTS;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;
    const yLo = Math.floor(OVERWORLD.MIN_Y / STEP) * STEP;
    const yHi = Math.max(yLo + STEP, Math.ceil(maxH / STEP) * STEP);
    const latA = this._buildLattice(this.variantA, x0, z0, yLo, yHi);
    const latB = this._buildLattice(this.variantB, x0, z0, yLo, yHi);
    const ny = latA.ny;
    const colA = new Float64Array(ny);
    const colB = new Float64Array(ny);

    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        this._blendColumn(latA, lx, lz, colA);
        this._blendColumn(latB, lx, lz, colB);
        for (let y = OVERWORLD.MIN_Y; y <= maxH; y++) {
          if (chunk.get(lx, y, lz) !== BLOCK.STONE) continue;
          const j = (y - yLo) / STEP;
          const j0 = Math.min(Math.floor(j), ny - 2);
          const ty = j - j0;
          const a = lerp(colA[j0], colA[j0 + 1], ty);
          let id = 0;
          if (a > V.PRIMARY_THRESHOLD) id = BLOCK.GRANITE;
          else if (a < -V.PRIMARY_THRESHOLD) id = BLOCK.DIORITE;
          else if (lerp(colB[j0], colB[j0 + 1], ty) > V.ANDESITE_THRESHOLD) {
            id = BLOCK.ANDESITE;
          }
          if (id) chunk.set(lx, y, lz, id);
        }
      }
    }
  }

  // --- veins (ores, gravel pockets) ----------------------------------------

  // Compact random-walk veins from a per-chunk seeded PRNG. Only this
  // chunk's cells are written (walks clip at the border), so generation
  // order can never change the world. Placement replaces the stone family
  // only — never air, cave interiors, dirt or ore already placed.
  _placeVeins(chunk, blockId, salt, cfg) {
    const size = CHUNK.SIZE;
    const rng = mulberry32(hash2(this.seed ^ salt, chunk.cx, chunk.cz));
    const span = cfg.MAX_Y - cfg.MIN_Y;
    for (let attempt = 0; attempt < cfg.ATTEMPTS_PER_CHUNK; attempt++) {
      let cx = Math.floor(rng() * size);
      let cz = Math.floor(rng() * size);
      // BIAS_BOTTOM: min of three uniforms — density ∝ (1-t)², strongly
      // concentrated toward MIN_Y ("the right depth" for diamonds).
      let t = rng();
      if (cfg.BIAS_BOTTOM) t = Math.min(t, rng(), rng());
      let cy = cfg.MIN_Y + Math.round(t * span);
      const target = cfg.VEIN_MIN + Math.floor(rng() * (cfg.VEIN_MAX - cfg.VEIN_MIN + 1));
      let placed = 0;
      let guard = target * 6;
      while (placed < target && guard-- > 0) {
        if (cx >= 0 && cx < size && cz >= 0 && cz < size &&
            cy >= cfg.MIN_Y && cy <= cfg.MAX_Y) {
          if (STONE_FAMILY[chunk.get(cx, cy, cz)]) {
            chunk.set(cx, cy, cz, blockId);
            placed++;
          }
        }
        const axis = Math.floor(rng() * 3);
        const dir = rng() < 0.5 ? -1 : 1;
        if (axis === 0) cx += dir;
        else if (axis === 1) cy += dir;
        else cz += dir;
      }
    }
  }
}
