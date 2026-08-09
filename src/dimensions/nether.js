// dimensions/nether.js — Phase 16: the real Nether. One seeded 3D density
// field shaped by a vertical bias profile (config NETHER.GEN.SHAPE) fills
// netherrack between a bedrock floor and the bedrock ceiling at
// NETHER.CEILING_Y: positive bias seals rock toward both bedrock layers, the
// negative mid band opens huge caverns — and where the field folds back
// above the threshold inside that band, isolated netherrack masses hang in
// the open as floating formations. Every open cell at/below
// NETHER.LAVA_SEA_Y floods with lava (the lava oceans; world/fluids.js
// animates their shores when a chunk first meshes). On top of the density
// pass: soul sand patches on floor surfaces inside sparse mask regions,
// glowstone clusters dangling from ceilings and overhangs, nether quartz
// ore veins, and rare high lava leaks that pour down cavern walls.
//
// Determinism contract (the world/caves.js discipline): the density field is
// sampled on a world-aligned lattice every NETHER.GEN.LATTICE_STEP blocks
// and trilinearly interpolated per cell — the pure point query interpolates
// with the same helper functions in the same association order, so it can
// never disagree with the chunk fill about a threshold crossing. Per-chunk
// features (quartz, glowstone, leaks) draw from per-chunk seeded PRNGs and
// only ever write their own chunk. Everything is a pure function of
// (seed, x, y, z); generation order can never change the world.
//
// The generator interface matches world/terrain.js TerrainGenerator as far
// as World consumes it: generateChunk(chunk), heightAt(x, z), biomeAt(x, z).
// Chunks share the overworld's storage shape (16 x 384 x 16, y -64..320);
// the Nether's y range 0..128 generates inside that space.

import { NETHER, CHUNK } from '../config.js';
import { BLOCK } from '../world/blocks.js';
import {
  mulberry32, hash2, hash01, lerp, bilerp, fbm2, SimplexNoise, Field3D,
} from '../world/noise.js';
import { FortressGenerator } from './fortress.js';

const STEP = NETHER.GEN.LATTICE_STEP;

// Per-feature hash/PRNG stream salts (stable — never reorder).
const SALT_QUARTZ = 0x9a4712;
const SALT_GLOWSTONE = 0x610057;
const SALT_LEAK = 0x2e7a1a;
const SALT_BEDROCK_FLOOR = 0x6ed01;
const SALT_BEDROCK_CEIL = 0x6ed02;

export class NetherGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    const rand = (salt) => mulberry32(this.seed ^ salt);
    const D = NETHER.GEN.DENSITY;
    this.density = new Field3D(rand(0x4e7e0001), D.SCALE_XZ, D.SCALE_Y, D.OCTAVES);
    this.soulMask = new SimplexNoise(rand(0x4e7e0002));
    // Phase 17: nether fortresses (dimensions/fortress.js) — region-seeded
    // blueprints emitted per chunk as the LAST generation pass, so fortress
    // blocks win over every decoration.
    this.fortress = new FortressGenerator(this.seed);

    // The vertical bias per block y, pre-lerped from the SHAPE keyframes.
    this.bias = new Float64Array(NETHER.MAX_Y + 1);
    const shape = NETHER.GEN.SHAPE;
    for (let y = 0; y <= NETHER.MAX_Y; y++) {
      let a = shape[0];
      let b = shape[shape.length - 1];
      for (let i = 0; i < shape.length - 1; i++) {
        if (shape[i][0] <= y && y <= shape[i + 1][0]) {
          a = shape[i];
          b = shape[i + 1];
          break;
        }
      }
      this.bias[y] = b[0] === a[0]
        ? a[1]
        : lerp(a[1], b[1], (y - a[0]) / (b[0] - a[0]));
    }
  }

  // --- pure point queries ---------------------------------------------------

  // Interpolated density-field value at an arbitrary block position, from
  // the same world-aligned lattice corners the chunk fill uses (identical
  // helper functions, identical association order — bit-exact agreement).
  _fieldAt(x, y, z) {
    const field = this.density;
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
      field.sample(X0, Y0 + STEP, Z0 + STEP),
      field.sample(X0 + STEP, Y0 + STEP, Z0 + STEP),
      tx, tz,
    );
    return lerp(v0, v1, ty);
  }

  // Is the base terrain solid at a cell? (density only — bedrock and the
  // decorations are layered on top of this during the chunk fill)
  _solidAt(x, y, z) {
    if (y <= NETHER.MIN_Y || y >= NETHER.CEILING_Y) return y >= NETHER.MIN_Y && y <= NETHER.CEILING_Y;
    return this._fieldAt(x, y, z) + this.bias[y] > 0;
  }

  // --- the generator interface ---------------------------------------------

  generateChunk(chunk) {
    const size = CHUNK.SIZE;
    const G = NETHER.GEN;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;

    // World-aligned lattice over the full nether height (0..128 is already
    // a multiple of STEP for any sane step; guard anyway).
    const yLo = 0;
    const yHi = Math.ceil(NETHER.CEILING_Y / STEP) * STEP;
    const lat = this._buildLattice(x0, z0, yLo, yHi);
    const ny = lat.ny;
    const colVal = new Float64Array(ny);

    const soulTop = Math.min(G.SOUL_SAND.MAX_Y, NETHER.CEILING_Y - 1);
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        this._blendColumn(lat, lx, lz, colVal);

        // Base fill: netherrack where the shaped density is positive, lava
        // in open cells at/below the sea level, air above it.
        for (let y = NETHER.MIN_Y + 1; y < NETHER.CEILING_Y; y++) {
          const j = (y - yLo) / STEP;
          const j0 = Math.min(Math.floor(j), ny - 2);
          const ty = j - j0;
          const v = lerp(colVal[j0], colVal[j0 + 1], ty) + this.bias[y];
          if (v > 0) {
            chunk.set(lx, y, lz, BLOCK.NETHERRACK);
          } else if (y <= NETHER.LAVA_SEA_Y) {
            chunk.set(lx, y, lz, BLOCK.LAVA);
          }
        }

        // Soul sand patches: inside mask regions, every upward floor
        // surface (netherrack under air) converts its top layers. Column-
        // local reads only, so chunk borders agree by construction.
        const S = G.SOUL_SAND;
        const inPatch = fbm2(
          this.soulMask, (x0 + lx) * S.MASK_SCALE, (z0 + lz) * S.MASK_SCALE, 2,
        ) > S.THRESHOLD;
        if (inPatch) {
          for (let y = soulTop; y > NETHER.MIN_Y; y--) {
            if (
              chunk.get(lx, y, lz) !== BLOCK.NETHERRACK ||
              chunk.get(lx, y + 1, lz) !== BLOCK.AIR
            ) continue;
            for (let d = 0; d < S.DEPTH; d++) {
              if (chunk.get(lx, y - d, lz) !== BLOCK.NETHERRACK) break;
              chunk.set(lx, y - d, lz, BLOCK.SOUL_SAND);
            }
          }
        }

        // Bedrock: solid at the floor and the ceiling, jagged bands just
        // inside both (per-layer survival chance, hashed per column).
        chunk.set(lx, NETHER.MIN_Y, lz, BLOCK.BEDROCK);
        chunk.set(lx, NETHER.CEILING_Y, lz, BLOCK.BEDROCK);
        const wx = x0 + lx;
        const wz = z0 + lz;
        const J = G.BEDROCK_JAGGED_CHANCE;
        for (let i = 0; i < J.length; i++) {
          if (hash01(this.seed ^ SALT_BEDROCK_FLOOR ^ (i * 0x9e37), wx, wz) < J[i]) {
            chunk.set(lx, NETHER.MIN_Y + 1 + i, lz, BLOCK.BEDROCK);
          }
          if (hash01(this.seed ^ SALT_BEDROCK_CEIL ^ (i * 0x9e37), wx, wz) < J[i]) {
            chunk.set(lx, NETHER.CEILING_Y - 1 - i, lz, BLOCK.BEDROCK);
          }
        }
      }
    }

    this._placeQuartz(chunk);
    this._placeGlowstone(chunk);
    this._placeLavaLeaks(chunk);
    this.fortress.emitChunk(chunk); // last — structure writes win
  }

  // Surface height for debug tooling: the topmost solid cell below the
  // ceiling band (bedrock ceiling excluded).
  heightAt(x, z) {
    for (let y = NETHER.CEILING_Y - 1; y > NETHER.MIN_Y; y--) {
      if (this._solidAt(x, y, z)) return y;
    }
    return NETHER.MIN_Y;
  }

  biomeAt() {
    return 'nether';
  }

  // --- lattice machinery (the caves.js layout) ------------------------------

  _buildLattice(x0, z0, yLo, yHi) {
    const n = CHUNK.SIZE / STEP + 1;
    const ny = (yHi - yLo) / STEP + 1;
    const data = new Float64Array(n * n * ny);
    let o = 0;
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        const x = x0 + ix * STEP;
        const z = z0 + iz * STEP;
        for (let iy = 0; iy < ny; iy++) {
          data[o++] = this.density.sample(x, yLo + iy * STEP, z);
        }
      }
    }
    return { data, ny, yLo, n };
  }

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

  // --- per-chunk seeded features (in-chunk writes only) ---------------------

  // Nether quartz veins: compact random walks replacing netherrack, the
  // caves.js _placeVeins shape (walks clip at the chunk border).
  _placeQuartz(chunk) {
    const size = CHUNK.SIZE;
    const Q = NETHER.GEN.QUARTZ;
    const rng = mulberry32(hash2(this.seed ^ SALT_QUARTZ, chunk.cx, chunk.cz));
    const span = Q.MAX_Y - Q.MIN_Y;
    for (let attempt = 0; attempt < Q.ATTEMPTS_PER_CHUNK; attempt++) {
      let cx = Math.floor(rng() * size);
      let cz = Math.floor(rng() * size);
      let cy = Q.MIN_Y + Math.round(rng() * span);
      const target = Q.VEIN_MIN + Math.floor(rng() * (Q.VEIN_MAX - Q.VEIN_MIN + 1));
      let placed = 0;
      let guard = target * 6;
      while (placed < target && guard-- > 0) {
        if (
          cx >= 0 && cx < size && cz >= 0 && cz < size &&
          cy >= Q.MIN_Y && cy <= Q.MAX_Y &&
          chunk.get(cx, cy, cz) === BLOCK.NETHERRACK
        ) {
          chunk.set(cx, cy, cz, BLOCK.NETHER_QUARTZ_ORE);
          placed++;
        }
        const axis = Math.floor(rng() * 3);
        const dir = rng() < 0.5 ? -1 : 1;
        if (axis === 0) cx += dir;
        else if (axis === 1) cy += dir;
        else cz += dir;
      }
    }
  }

  // Glowstone clusters: a downward-biased random walk of glowstone cells
  // growing from an air cell directly under a solid roof (the ceiling mass,
  // or a floating formation's underside). Light 15 rides the registry.
  _placeGlowstone(chunk) {
    const size = CHUNK.SIZE;
    const G = NETHER.GEN.GLOWSTONE;
    const rng = mulberry32(hash2(this.seed ^ SALT_GLOWSTONE, chunk.cx, chunk.cz));
    const span = G.MAX_Y - G.MIN_Y;
    for (let attempt = 0; attempt < G.ATTEMPTS_PER_CHUNK; attempt++) {
      const ax = Math.floor(rng() * size);
      const az = Math.floor(rng() * size);
      const ay = G.MIN_Y + Math.floor(rng() * (span + 1));
      const roll = rng(); // drawn unconditionally — the stream stays aligned
      if (roll >= G.CHANCE) continue;
      // Find the roof of the air pocket at the anchor: drop out of solid
      // rock into air first if needed, then climb the air column to the
      // cell right under its ceiling (a solid roof always exists — the
      // bedrock ceiling band closes every column). In-column reads only.
      let y = ay;
      let guardDown = 24;
      while (guardDown-- > 0 && y > G.MIN_Y && chunk.get(ax, y, az) !== BLOCK.AIR) y--;
      if (chunk.get(ax, y, az) !== BLOCK.AIR) continue;
      while (
        y + 1 < NETHER.CEILING_Y && chunk.get(ax, y + 1, az) === BLOCK.AIR
      ) y++;
      const roof = chunk.get(ax, y + 1, az);
      if (
        roof !== BLOCK.NETHERRACK && roof !== BLOCK.BEDROCK &&
        roof !== BLOCK.SOUL_SAND
      ) continue;
      const target = G.BLOB_MIN + Math.floor(rng() * (G.BLOB_MAX - G.BLOB_MIN + 1));
      let cx = ax;
      let cy = y;
      let cz = az;
      let placed = 0;
      let guard = target * 6;
      while (placed < target && guard-- > 0) {
        if (
          cx >= 0 && cx < size && cz >= 0 && cz < size &&
          cy > NETHER.MIN_Y && cy < NETHER.CEILING_Y &&
          chunk.get(cx, cy, cz) === BLOCK.AIR
        ) {
          chunk.set(cx, cy, cz, BLOCK.GLOWSTONE);
          placed++;
        }
        // Downward-biased drip: mostly sideways near the roof, down often
        // enough that clusters read as dangling clumps.
        const r = rng();
        if (r < 0.35) cy -= 1;
        else if (r < 0.5) cy += 1;
        else if (r < 0.625) cx += 1;
        else if (r < 0.75) cx -= 1;
        else if (r < 0.875) cz += 1;
        else cz -= 1;
      }
    }
  }

  // Rare lava leaks high on cavern walls: a source in an air cell against
  // netherrack with a drop below — the fluids automaton pours it into a
  // falling stream the first time the chunk meshes.
  _placeLavaLeaks(chunk) {
    const size = CHUNK.SIZE;
    const L = NETHER.GEN.LAVA_LEAKS;
    const rng = mulberry32(hash2(this.seed ^ SALT_LEAK, chunk.cx, chunk.cz));
    for (let attempt = 0; attempt < L.ATTEMPTS_PER_CHUNK; attempt++) {
      // Interior cells only, so the wall test never leaves the chunk.
      const lx = 1 + Math.floor(rng() * (size - 2));
      const lz = 1 + Math.floor(rng() * (size - 2));
      const y = L.MIN_Y + Math.floor(rng() * (L.MAX_Y - L.MIN_Y + 1));
      const roll = rng(); // unconditional — stream alignment
      if (roll >= L.CHANCE) continue;
      if (chunk.get(lx, y, lz) !== BLOCK.AIR) continue;
      if (chunk.get(lx, y - 1, lz) !== BLOCK.AIR) continue; // needs a drop
      if (
        chunk.get(lx - 1, y, lz) === BLOCK.NETHERRACK ||
        chunk.get(lx + 1, y, lz) === BLOCK.NETHERRACK ||
        chunk.get(lx, y, lz - 1) === BLOCK.NETHERRACK ||
        chunk.get(lx, y, lz + 1) === BLOCK.NETHERRACK
      ) {
        chunk.set(lx, y, lz, BLOCK.LAVA);
      }
    }
  }
}
