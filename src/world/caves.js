// world/caves.js — Phase 9 underground generation: cave carving (two noise
// layers — winding tunnels and open caverns), rare ravines, surface entrances,
// lava, underground water springs and pools, granite/diorite/andesite blobs,
// gravel/clay banks, gravel pockets and ore veins per config ORES. The seeded
// noise machinery lives in world/noise.js (Phase 15 split per the ARCHITECTURE
// size cap) and the Phase 23 GREAT CAVERN pass in world/caverns.js (same cap).
//
// Phase 23 changed three things here:
//   - the Phase 15 MEGA noise layer is gone. It was the third attempt to grow
//     big rooms by thresholding a field and it never produced one; big rooms
//     are now PLACED by world/caverns.js, which this module calls as its own
//     carve pass and which the waterfall springs key off.
//   - ore veins pick the deepslate variant of an ore when the block they
//     replace is deepslate, so the deep world reads as deepslate throughout.
//   - lava above the lake level is placed as a few small seeded pools instead
//     of flooding every floor cell inside a noise-mask region.
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

import { OVERWORLD, CHUNK, CAVES, UNDERGROUND } from '../config.js';
import { BLOCK } from './blocks.js';
import {
  mulberry32, hash2, hash01, smoothstep, lerp, bilerp, SimplexNoise, fbm2,
  Field3D,
} from './noise.js';
import { GreatCaverns } from './caverns.js';
// Phase 24: the ore/gravel vein passes and the STONE_FAMILY table moved to
// world/ores.js — the cut this file's ARCHITECTURE note mandated when it
// next grew. One-way dependency (ores.js imports nothing from here).
import { STONE_FAMILY, applyVeinPasses } from './ores.js';

// ---------------------------------------------------------------------------
// Salts (independent hash/PRNG streams per feature)
// ---------------------------------------------------------------------------

const SALT_RAVINE_JITTER = 0x8a71;
const SALT_LAVA_SPRING = 0x1afa;
const SALT_LAVA_POOL = 0x1ab0;
const SALT_WATERFALL = 0x7fa11;
const SALT_SPRING = 0x593a;
const SALT_SHORE = 0x54ce;

// Base terrain blocks caves may carve through. Water, bedrock and anything
// else (decorations come later anyway) are left alone.
const CARVABLE = new Uint8Array(256);
for (const id of [
  BLOCK.STONE, BLOCK.DEEPSLATE, BLOCK.DIRT, BLOCK.GRASS_BLOCK, BLOCK.SAND,
  BLOCK.GRAVEL, BLOCK.SANDSTONE, BLOCK.CLAY,
]) CARVABLE[id] = 1;

const isCarvable = (id) => CARVABLE[id] === 1;

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
    // Phase 10: tunnel girth variation. (Its companion, the Phase 10 lava
    // pool-region mask, is gone — Phase 23 places lava rather than masking it.)
    const G = T.GIRTH;
    this.girth = new Field3D(rand(0x617a0009), G.SCALE_XZ, G.SCALE_Y, G.OCTAVES);
    // Phase 23: the great-cavern pass — placed chambers, not a noise layer
    // (world/caverns.js explains why the three noise attempts before it
    // never produced a room).
    this.caverns = new GreatCaverns(this.seed);
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

    // The great caverns carve last of the carving passes: their chambers are
    // placed volumes, so they win over whatever the noise layers left, and
    // their connector bores cut through to the tunnel network.
    const inCavern = this.caverns.apply(chunk, isCarvable, BLOCK.AIR);

    this._placeLava(chunk, colH);
    this._placeWaterfalls(chunk, inCavern);
    this._placeSprings(chunk, colH);
    this._placeVariants(chunk, maxH);
    // Gravel/clay banks read the final water placement, so they run after
    // every pass that can put water underground.
    this._placeShoreBanks(chunk, colH);
    // Gravel pockets + the SPEC ores (world/ores.js — Phase 24 split).
    applyVeinPasses(chunk, this.seed);
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

  // --- lava placement (Phase 10; rebuilt in Phase 23) -----------------------

  // Runs after all carving (its wall tests read final in-chunk carve state,
  // never a neighbour chunk, so generation order can't matter):
  //   - at/below CAVES.LAVA.LAKE_MAX_Y every carved cell floods — the deep
  //     lava lakes, exactly as before
  //   - ABOVE it, nothing floods. A handful of seeded sites per chunk each
  //     flood a few connected floor cells (POOL_MAX_CELLS), and wall cells
  //     spring single blocks at SPRING_CHANCE. That is the whole of it.
  //
  // The Phase 10 rule this replaces asked a 2D mask whether a COLUMN was in a
  // "pool region" and, if so, flooded every cave-floor cell in it from -53 all
  // the way to y=9. Whole cave floors came out molten and read as lava lakes
  // 40 blocks above the level that is supposed to have them: measured over a
  // 256x256 region, 3040 cells of lava sat above y=-54.
  _placeLava(chunk, colH) {
    const size = CHUNK.SIZE;
    const L = CAVES.LAVA;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;

    // 1. The deep lakes: every open cell at or below LAKE_MAX_Y.
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const top = Math.min(L.LAKE_MAX_Y, colH[lz * size + lx] - 1);
        for (let y = CAVES.MIN_Y; y <= top; y++) {
          if (chunk.get(lx, y, lz) === BLOCK.AIR) chunk.set(lx, y, lz, BLOCK.LAVA);
        }
      }
    }

    // 2. Small isolated pools. A seeded site walks down its column for the
    // first cave floor in range and digs a small RECESSED pool into it
    // (Phase 24). The Phase 23 pools flooded ON TOP of the floor with open
    // rims, and the fluid settle scan then grew every one into a flow apron
    // up to 9 cells across — the reported "large lava bodies" far above the
    // lake level. A recessed pool has no air below or beside any lava cell,
    // so the automaton never touches it: what generates is exactly what the
    // player finds.
    const rng = mulberry32(hash2(this.seed ^ SALT_LAVA_POOL, chunk.cx, chunk.cz));
    for (let attempt = 0; attempt < L.POOL_ATTEMPTS_PER_CHUNK; attempt++) {
      const lx = Math.floor(rng() * size);
      const lz = Math.floor(rng() * size);
      const roll = rng();  // drawn unconditionally — the stream stays aligned
      const span = rng();  // ...as does the depth pick
      if (roll >= L.POOL_CHANCE) continue;
      const top = Math.min(L.POOL_MAX_Y, colH[lz * size + lx] - 2);
      const bottom = L.LAKE_MAX_Y + 1;
      if (top < bottom) continue;
      const startY = bottom + Math.floor(span * (top - bottom + 1));
      const y = this._floorBelow(chunk, lx, startY, lz, bottom);
      if (y === null) continue;
      this._floodContainedPool(chunk, lx, y, lz, BLOCK.LAVA, L.POOL_MAX_CELLS);
    }

    // 3. Single-block wall springs: lava weeping out of a cave wall. Interior
    // cells only, so every neighbour test stays inside this chunk.
    const springTop = Math.min(L.SPRING_MAX_Y, OVERWORLD.LAVA_POOL_MAX_Y);
    for (let lz = 1; lz < size - 1; lz++) {
      for (let lx = 1; lx < size - 1; lx++) {
        const top = Math.min(springTop, colH[lz * size + lx] - 1);
        for (let y = L.LAKE_MAX_Y + 1; y <= top; y++) {
          if (chunk.get(lx, y, lz) !== BLOCK.AIR) continue;
          if (hash01(
            this.seed ^ SALT_LAVA_SPRING ^ Math.imul(y, 0x9e3779b1),
            x0 + lx, z0 + lz,
          ) >= L.SPRING_CHANCE) continue;
          if (this._againstWall(chunk, lx, y, lz)) {
            chunk.set(lx, y, lz, BLOCK.LAVA);
          }
        }
      }
    }
  }

  // The first cave floor at or below `startY` in this column: an air cell
  // whose neighbour below is solid. null when the column has none above
  // `bottom`.
  _floorBelow(chunk, lx, startY, lz, bottom) {
    for (let y = startY; y >= bottom; y--) {
      if (chunk.get(lx, y, lz) !== BLOCK.AIR) continue;
      const under = chunk.get(lx, y - 1, lz);
      if (under !== BLOCK.AIR && under !== BLOCK.LAVA && under !== BLOCK.WATER) {
        return y;
      }
    }
    return null;
  }

  // Is this cell against a solid wall? (horizontal neighbours only, so a
  // ceiling doesn't count)
  _againstWall(chunk, lx, y, lz) {
    const solidish = (id) =>
      id !== BLOCK.AIR && id !== BLOCK.LAVA && id !== BLOCK.WATER;
    return (
      solidish(chunk.get(lx - 1, y, lz)) || solidish(chunk.get(lx + 1, y, lz)) ||
      solidish(chunk.get(lx, y, lz - 1)) || solidish(chunk.get(lx, y, lz + 1))
    );
  }

  // A RECESSED pool: `y` is an air cell over a cave floor, and the pool digs
  // INTO that floor — fluid replaces up to `max` connected floor blocks at
  // y-1, so the surface sits sunk into the rock with solid walls on every
  // side and open air only above (the vanilla cave-pool look). Contained by
  // construction: a cell only qualifies while its floor block is solid with
  // solid rock beneath, and an erosion pass then drops any cell whose
  // sideways neighbour at pool level is open (or unknowable past the chunk
  // border) — so the settle scan finds no air below or beside any fluid
  // cell and the automaton never grows the pool. Cells trimmed or eroded
  // simply STAY rock, which can never break a kept cell's containment.
  // Returns the number of cells filled.
  _floodContainedPool(chunk, lx, y, lz, fluid, max) {
    const size = CHUNK.SIZE;
    const py = y - 1;
    const open = (id) => id === BLOCK.AIR || id === BLOCK.LAVA || id === BLOCK.WATER;
    const eligible = (cx, cz) => {
      if (cx < 0 || cx >= size || cz < 0 || cz >= size) return false;
      if (chunk.get(cx, y, cz) !== BLOCK.AIR) return false;      // needs open top
      const floor = chunk.get(cx, py, cz);
      if (open(floor) || floor === BLOCK.BEDROCK) return false;  // digs solid rock
      return !open(chunk.get(cx, py - 1, cz));                   // over solid ground
    };
    if (!eligible(lx, lz)) return 0;
    const keyOf = (cx, cz) => cz * size + cx;
    const kept = new Set([keyOf(lx, lz)]);
    const cells = [[lx, lz]];
    for (let i = 0; i < cells.length && cells.length < max + 4; i++) {
      const [cx, cz] = cells[i];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!kept.has(keyOf(nx, nz)) && eligible(nx, nz)) {
          kept.add(keyOf(nx, nz));
          cells.push([nx, nz]);
        }
      }
    }
    // Erode until every kept cell's sideways neighbours at pool level are
    // solid rock or fellow pool cells. Border cells erode too — their
    // outward neighbour lives in a chunk this pass can't read.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [cx, cz] of cells) {
        if (!kept.has(keyOf(cx, cz))) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (kept.has(keyOf(nx, nz))) continue;
          const outside = nx < 0 || nx >= size || nz < 0 || nz >= size;
          if (outside || open(chunk.get(nx, py, nz))) {
            kept.delete(keyOf(cx, cz));
            changed = true;
            break;
          }
        }
      }
    }
    let filled = 0;
    for (const [cx, cz] of cells) {
      if (filled >= max) break;
      if (!kept.has(keyOf(cx, cz))) continue;
      chunk.set(cx, py, cz, fluid);
      filled++;
    }
    return filled;
  }

  // Floods up to `max` connected cells of ONE flat floor level with `fluid`,
  // starting at (lx, y, lz). A breadth-first walk over air cells at that
  // exact y that still have solid ground under them, clipped to this chunk —
  // so a pool is a puddle on a floor, never a column and never a spill into
  // the neighbouring chunk. Returns the number of cells filled. (The water
  // springs still use this — a damp puddle that seeps a little is fine; the
  // lava pools moved to _floodContainedPool above.)
  _floodPool(chunk, lx, y, lz, fluid, max) {
    const size = CHUNK.SIZE;
    if (chunk.get(lx, y, lz) !== BLOCK.AIR) return 0;
    const queue = [lx, lz];
    const seen = new Set([lz * size + lx]);
    let filled = 0;
    while (queue.length && filled < max) {
      const cx = queue.shift();
      const cz = queue.shift();
      const under = chunk.get(cx, y - 1, cz);
      if (chunk.get(cx, y, cz) !== BLOCK.AIR) continue;
      if (under === BLOCK.AIR || under === BLOCK.LAVA || under === BLOCK.WATER) continue;
      chunk.set(cx, y, cz, fluid);
      filled++;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
        const key = nz * size + nx;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(nx, nz);
      }
    }
    return filled;
  }

  // --- underground water (Phase 23) -----------------------------------------

  // Damp caves: single-block springs weeping from a wall, and small puddles
  // on cave floors. Same machinery as the lava pools, its own seeded stream,
  // spread over the whole cave band rather than concentrated at depth.
  _placeSprings(chunk, colH) {
    const size = CHUNK.SIZE;
    const S = CAVES.SPRINGS;
    const rng = mulberry32(hash2(this.seed ^ SALT_SPRING, chunk.cx, chunk.cz));
    for (let attempt = 0; attempt < S.ATTEMPTS_PER_CHUNK; attempt++) {
      // Interior cells only — the wall test never leaves the chunk.
      const lx = 1 + Math.floor(rng() * (size - 2));
      const lz = 1 + Math.floor(rng() * (size - 2));
      const roll = rng();
      const span = rng();
      const top = Math.min(S.MAX_Y, colH[lz * size + lx] - 3);
      if (top < S.MIN_Y) continue;
      const startY = S.MIN_Y + Math.floor(span * (top - S.MIN_Y + 1));
      if (roll < S.SPRING_CHANCE) {
        // A wall spring: the highest air cell against rock in the column
        // near the pick, so it reads as leaking out of the wall.
        for (let y = startY; y >= S.MIN_Y; y--) {
          if (chunk.get(lx, y, lz) !== BLOCK.AIR) continue;
          if (!this._againstWall(chunk, lx, y, lz)) continue;
          chunk.set(lx, y, lz, BLOCK.WATER);
          break;
        }
      } else if (roll < S.SPRING_CHANCE + S.POOL_CHANCE) {
        const y = this._floorBelow(chunk, lx, startY, lz, S.MIN_Y);
        if (y === null) continue;
        this._floodPool(chunk, lx, y, lz, BLOCK.WATER, S.POOL_MAX_CELLS);
      }
    }
  }

  // --- gravel and clay banks (Phase 23) -------------------------------------

  // Cave floors go to gravel and clay near water, the way a vanilla cave pool
  // sits in a soft bank instead of bare stone. Runs after every water-placing
  // pass; reads only this chunk, writes only this chunk.
  _placeShoreBanks(chunk, colH) {
    const size = CHUNK.SIZE;
    const P = UNDERGROUND.SHORE_PATCHES;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;
    const R = P.REACH;
    // Collect the floor cells beside water first, then convert — converting
    // in place would let a fresh gravel cell seed more of itself.
    const targets = [];
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const top = Math.min(CAVES.MAX_Y, colH[lz * size + lx] - 1);
        for (let y = CAVES.MIN_Y; y <= top; y++) {
          if (chunk.get(lx, y, lz) !== BLOCK.WATER) continue;
          for (let dz = -R; dz <= R; dz++) {
            for (let dx = -R; dx <= R; dx++) {
              const nx = lx + dx;
              const nz = lz + dz;
              if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
              for (let d = 0; d < P.DEPTH; d++) {
                targets.push(nx, y - 1 - d, nz);
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < targets.length; i += 3) {
      const lx = targets[i];
      const y = targets[i + 1];
      const lz = targets[i + 2];
      if (!STONE_FAMILY[chunk.get(lx, y, lz)]) continue;
      const r = hash01(
        this.seed ^ SALT_SHORE ^ Math.imul(y, 0x9e3779b1), x0 + lx, z0 + lz,
      );
      if (r >= P.CHANCE) continue;
      chunk.set(lx, y, lz, r < P.CHANCE * P.CLAY_CHANCE ? BLOCK.CLAY : BLOCK.GRAVEL);
    }
  }

  // --- waterfall springs (Phase 15; Phase 23 re-anchored) -------------------

  // Water columns pouring down a great cavern's wall into a small floor pool.
  // The generated column IS the fall — world/fluids.js settles it into a
  // flowing one once the chunk loads. Runs after all carving and lava
  // placement (reads the chunk's final state); per-chunk seeded PRNG,
  // in-chunk writes only, so generation order can never change the world.
  // `inCavern` is the per-column mask world/caverns.js returns.
  _placeWaterfalls(chunk, inCavern) {
    const size = CHUNK.SIZE;
    const W = CAVES.WATERFALL;
    const rng = mulberry32(hash2(this.seed ^ SALT_WATERFALL, chunk.cx, chunk.cz));
    for (let attempt = 0; attempt < W.ATTEMPTS_PER_CHUNK; attempt++) {
      // Interior cells only: every neighbour test below stays in-chunk.
      const lx = 1 + Math.floor(rng() * (size - 2));
      const lz = 1 + Math.floor(rng() * (size - 2));
      const roll = rng(); // drawn unconditionally — the PRNG stream stays
                          // aligned however the gates below resolve
      if (!inCavern[lz * size + lx]) continue;
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

}
