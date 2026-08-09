// world/caves.js — Phase 9 underground generation: cave carving (two noise
// layers — winding tunnels and open caverns — plus the Phase 15 mega-cavern
// pass: rare, genuinely huge multi-level chambers), rare ravines, surface
// entrances, lava pools below OVERWORLD.LAVA_POOL_MAX_Y, waterfall springs in
// mega caverns, granite/diorite/andesite blobs, gravel pockets and ore veins
// per config ORES. The seeded noise machinery lives in world/noise.js
// (Phase 15 split per the ARCHITECTURE size cap).
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
import {
  mulberry32, hash2, hash01, smoothstep, lerp, bilerp, SimplexNoise, fbm2,
  Field3D,
} from './noise.js';

// ---------------------------------------------------------------------------
// Salts (independent hash/PRNG streams per feature)
// ---------------------------------------------------------------------------

const SALT_RAVINE_JITTER = 0x8a71;
const SALT_GRAVEL = 0x67a1;
const SALT_LAVA_LEAK = 0x1afa;
const SALT_WATERFALL = 0x7fa11;
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
    // Phase 15: the mega-cavern pass — its own 3D field plus the 2D rarity
    // region mask (a distinct large-cave layer, not wider tunnels).
    const M = CAVES.MEGA;
    this.mega = new Field3D(rand(0x3e6a000b), M.SCALE_XZ, M.SCALE_Y, M.OCTAVES);
    this.megaRegion = new SimplexNoise(rand(0x3e6a000c));
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

  // --- mega caverns (Phase 15) ----------------------------------------------

  // Region gate for the mega-cavern pass at a column: 0 almost everywhere
  // (they are uncommon), rising to 1 inside a mega region's core.
  _megaGate(x, z) {
    const M = CAVES.MEGA;
    const m = fbm2(this.megaRegion, x * M.REGION_SCALE, z * M.REGION_SCALE, 2);
    return smoothstep(M.REGION_START, M.REGION_FULL, m);
  }

  // Mega-cavern carve threshold at a height (Infinity = never). The region
  // gate lowers it from CEILING (unreachable) toward THRESHOLD; the band
  // edges ramp it back up so chamber floors and ceilings close smoothly.
  _megaThreshold(y, gate) {
    const M = CAVES.MEGA;
    if (gate <= 0 || y < M.MIN_Y || y > M.MAX_Y) return Infinity;
    let t = M.CEILING + (M.THRESHOLD - M.CEILING) * gate;
    const edge = Math.min(y - M.MIN_Y, M.MAX_Y - y);
    if (edge < M.EDGE_FADE) {
      t += (M.CEILING - M.THRESHOLD) * (1 - edge / M.EDGE_FADE);
    }
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
    const colMega = new Float64Array(size * size);  // mega-cavern region gate
    let anyMega = false;
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

        // Mega caverns sit far below every surface (MAX_Y 26 vs sea 62), so
        // the ocean shield's colTop clamp already protects sea floors; the
        // gate is per-column only for the region mask.
        const mg = this._megaGate(x0 + lx, z0 + lz);
        colMega[i] = mg;
        if (mg > 0) anyMega = true;
      }
    }

    // World-aligned lattice samples for the carve band.
    const yLo = Math.floor(CAVES.MIN_Y / STEP) * STEP;
    const yHi = Math.max(yLo + STEP, Math.ceil(latTop / STEP) * STEP);
    const latA = this._buildLattice(this.tunnelA, x0, z0, yLo, yHi);
    const latB = this._buildLattice(this.tunnelB, x0, z0, yLo, yHi);
    const latC = this._buildLattice(this.cavern, x0, z0, yLo, yHi);
    const latG = this._buildLattice(this.girth, x0, z0, yLo, yHi);
    // The mega lattice only exists where a mega region touches the chunk —
    // most of the world skips the whole pass.
    const latM = anyMega ? this._buildLattice(this.mega, x0, z0, yLo, yHi) : null;
    const ny = latA.ny;
    const colValA = new Float64Array(ny);
    const colValB = new Float64Array(ny);
    const colValC = new Float64Array(ny);
    const colValG = new Float64Array(ny);
    const colValM = new Float64Array(ny);

    const rTun = CAVES.TUNNEL.RADIUS;
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const i = lz * size + lx;
        const top = colTop[i];
        const h = colH[i];
        const rav = colRav[i];
        const gate = colGate[i];
        const megaGate = colMega[i];
        if (top >= CAVES.MIN_Y) {
          this._blendColumn(latA, lx, lz, colValA);
          this._blendColumn(latB, lx, lz, colValB);
          this._blendColumn(latC, lx, lz, colValC);
          this._blendColumn(latG, lx, lz, colValG);
          if (latM && megaGate > 0) this._blendColumn(latM, lx, lz, colValM);
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
            if (!carve && latM && megaGate > 0) {
              const tm = this._megaThreshold(y, megaGate);
              if (tm !== Infinity) {
                carve = lerp(colValM[j0], colValM[j0 + 1], ty) > tm;
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
    this._placeWaterfalls(chunk, colMega);
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

  // --- waterfall springs (Phase 15) -----------------------------------------

  // Rare water columns pouring down mega-cavern walls into a small floor
  // pool. Water is still static in this game, so the column IS the fall —
  // a translucent pillar hugging the wall, swimmable like any water. Runs
  // after all carving and lava placement (reads the chunk's final state);
  // per-chunk seeded PRNG, in-chunk writes only, so generation order can
  // never change the world.
  _placeWaterfalls(chunk, colMega) {
    const size = CHUNK.SIZE;
    const W = CAVES.WATERFALL;
    const rng = mulberry32(hash2(this.seed ^ SALT_WATERFALL, chunk.cx, chunk.cz));
    for (let attempt = 0; attempt < W.ATTEMPTS_PER_CHUNK; attempt++) {
      // Interior cells only: every neighbour test below stays in-chunk.
      const lx = 1 + Math.floor(rng() * (size - 2));
      const lz = 1 + Math.floor(rng() * (size - 2));
      const roll = rng(); // drawn unconditionally — the PRNG stream stays
                          // aligned however the gates below resolve
      if (colMega[lz * size + lx] < W.MIN_GATE) continue;
      if (roll >= W.CHANCE) continue;
      // Walk the band downward for the first ledge that can host a spring:
      // an air cell against a wall with a real drop beneath it.
      for (let y = W.MAX_Y; y >= W.MIN_Y; y--) {
        if (chunk.get(lx, y, lz) !== BLOCK.AIR) continue;
        if (
          !STONE_FAMILY[chunk.get(lx - 1, y, lz)] &&
          !STONE_FAMILY[chunk.get(lx + 1, y, lz)] &&
          !STONE_FAMILY[chunk.get(lx, y, lz - 1)] &&
          !STONE_FAMILY[chunk.get(lx, y, lz + 1)]
        ) continue;
        let drop = 0;
        while (
          drop < W.MAX_FALL &&
          chunk.get(lx, y - 1 - drop, lz) === BLOCK.AIR
        ) drop++;
        if (drop < W.MIN_DROP) continue; // a puddle ledge — keep walking down
        // A fall that never found a floor within MAX_FALL would dangle in
        // mid-air (static water doesn't extend itself) — skip the attempt.
        if (drop >= W.MAX_FALL && chunk.get(lx, y - 1 - drop, lz) === BLOCK.AIR) {
          break;
        }
        // The column: spring cell down to the landing cell.
        for (let d = 0; d <= drop - 1; d++) {
          chunk.set(lx, y - d, lz, BLOCK.WATER);
        }
        // A small pool where it lands: the landing cell plus in-chunk
        // neighbours that are open floor.
        const py = y - drop;
        if (chunk.get(lx, py, lz) === BLOCK.AIR) chunk.set(lx, py, lz, BLOCK.WATER);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = lx + dx;
          const nz = lz + dz;
          if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
          if (
            chunk.get(nx, py, nz) === BLOCK.AIR &&
            STONE_FAMILY[chunk.get(nx, py - 1, nz)]
          ) chunk.set(nx, py, nz, BLOCK.WATER);
        }
        break; // one fall per successful attempt
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
