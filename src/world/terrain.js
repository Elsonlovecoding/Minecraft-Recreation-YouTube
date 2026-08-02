// world/terrain.js — Overworld generation: seeded simplex noise, heightmap,
// blended biomes (plains, forest, desert, mountains), surface layers, water
// fill to sea level, jagged bedrock, oak trees and cacti.
//
// Everything here is a pure function of (seed, x, z), so chunks generate
// identically regardless of the order they are requested in. Decorations that
// can cross a chunk border (tree canopies) are re-derived from a margin of
// columns around the chunk instead of writing into neighbouring chunks.
//
// All tunables live in config.js TERRAIN / OVERWORLD.

import { OVERWORLD, CHUNK, TERRAIN } from '../config.js';
import { BLOCK } from './blocks.js';
import { CaveCarver } from './caves.js';

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

// mulberry32 — small fast seeded PRNG, used only to build noise tables.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stateless integer coordinate hash → uint32. Deterministic per (seed, x, z),
// used for per-column decisions (trees, cacti, bedrock, dithering).
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

function hash3_01(seed, x, y, z) {
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

class Simplex2D {
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
function fbm(noise, x, z, octaves, persistence = 0.5, lacunarity = 2) {
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

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Salts so each per-column decision draws from an independent hash stream.
const SALT_TREE = 0x7ee5;
const SALT_TRUNK = 0x7a11;
const SALT_CACTUS = 0xcac7;
const SALT_DITHER = 0xd17e;
const SALT_BEDROCK = 0xbedd;

export class TerrainGenerator {
  constructor(seed = TERRAIN.SEED) {
    this.seed = seed | 0;
    // Independent permutation tables per field, derived from the world seed.
    const table = (salt) => new Simplex2D(mulberry32(this.seed ^ salt));
    this.continentNoise = table(0x1a2b3c4d);
    this.hillNoise = table(0x2b3c4d5e);
    this.temperatureNoise = table(0x3c4d5e6f);
    this.moistureNoise = table(0x4d5e6f70);
    this.mountainRegionNoise = table(0x5e6f7081);
    this.ridgeNoise = table(0x6f708192);
    // Phase 9: caves, ravines, ores, stone variants (world/caves.js) — carved
    // after the base column fill, before decorations.
    this.caves = new CaveCarver(this.seed);
  }

  // --- climate and biome weights -------------------------------------------

  climateAt(x, z) {
    const c = TERRAIN.CLIMATE;
    return {
      temperature: fbm(this.temperatureNoise, x * c.TEMPERATURE_SCALE, z * c.TEMPERATURE_SCALE, c.OCTAVES),
      moisture: fbm(this.moistureNoise, x * c.MOISTURE_SCALE, z * c.MOISTURE_SCALE, c.OCTAVES),
    };
  }

  // Normalised biome weights at a column. Always sums to 1; every weight is
  // continuous in (x, z), which is what blends biome heights and edges.
  biomeWeightsAt(x, z) {
    const { temperature, moisture } = this.climateAt(x, z);
    const M = TERRAIN.MOUNTAINS;
    const B = TERRAIN.BIOMES;

    const region = fbm(this.mountainRegionNoise, x * M.REGION_SCALE, z * M.REGION_SCALE, M.REGION_OCTAVES);
    const mountains = smoothstep(M.WEIGHT_START, M.WEIGHT_FULL, region);

    const heat = smoothstep(B.DESERT.HEAT_START, B.DESERT.HEAT_FULL, temperature);
    const dryness = 1 - smoothstep(B.DESERT.DRY_START, B.DESERT.DRY_FULL, moisture);
    const lowland = 1 - mountains;

    const raw = {
      plains: B.PLAINS.BASE_WEIGHT * lowland,
      forest: smoothstep(B.FOREST.MOISTURE_START, B.FOREST.MOISTURE_FULL, moisture) * lowland,
      desert: heat * dryness * lowland,
      mountains,
    };
    const sum = raw.plains + raw.forest + raw.desert + raw.mountains;
    return {
      plains: raw.plains / sum,
      forest: raw.forest / sum,
      desert: raw.desert / sum,
      mountains: raw.mountains / sum,
    };
  }

  // Dominant biome name — coarse lookup for spawning/debug. The surface
  // block additionally dithers between the top two (see columnAt).
  biomeAt(x, z) {
    const w = this.biomeWeightsAt(x, z);
    let best = 'plains';
    for (const name of ['forest', 'desert', 'mountains']) {
      if (w[name] > w[best]) best = name;
    }
    return best;
  }

  // --- heightmap ------------------------------------------------------------

  heightAt(x, z) {
    return this.heightFromWeights(x, z, this.biomeWeightsAt(x, z));
  }

  heightFromWeights(x, z, w) {
    const T = TERRAIN;
    const B = T.BIOMES;
    const M = T.MOUNTAINS;

    const continent = fbm(
      this.continentNoise, x * T.CONTINENT.SCALE, z * T.CONTINENT.SCALE, T.CONTINENT.OCTAVES,
    );
    const hill = fbm(
      this.hillNoise, x * T.HILLS.SCALE, z * T.HILLS.SCALE,
      T.HILLS.OCTAVES, T.HILLS.PERSISTENCE, T.HILLS.LACUNARITY,
    );

    // Ridged profile in [0, 1]: crests where the noise crosses zero.
    const ridgeSample = fbm(this.ridgeNoise, x * M.RIDGE_SCALE, z * M.RIDGE_SCALE, M.RIDGE_OCTAVES);
    const ridge = Math.pow(1 - Math.abs(ridgeSample), M.RIDGE_SHARPNESS);

    const base = OVERWORLD.SEA_LEVEL + T.CONTINENT.OFFSET + continent * T.CONTINENT.AMPLITUDE;
    const height =
      base +
      w.plains * (B.PLAINS.OFFSET + hill * B.PLAINS.HILL_AMPLITUDE) +
      w.forest * (B.FOREST.OFFSET + hill * B.FOREST.HILL_AMPLITUDE) +
      w.desert * (B.DESERT.OFFSET + hill * B.DESERT.HILL_AMPLITUDE) +
      w.mountains * (M.BASE_LIFT + ridge * M.RIDGE_AMPLITUDE);

    return Math.max(
      OVERWORLD.MIN_Y + TERRAIN.MIN_HEIGHT_ABOVE_BOTTOM,
      Math.min(OVERWORLD.PEAK_HEIGHT, Math.round(height)),
    );
  }

  // --- per-column summary ---------------------------------------------------

  // Everything generation needs to know about one column: height, biome
  // weights, the (dithered) surface biome and its layer stack.
  columnAt(x, z) {
    const weights = this.biomeWeightsAt(x, z);
    const height = this.heightFromWeights(x, z, weights);

    // Sort biomes by weight; dither the surface between the top two when
    // they are close, so biome edges feather over several columns.
    const names = ['plains', 'forest', 'desert', 'mountains'];
    names.sort((a, b) => weights[b] - weights[a]);
    let surfaceBiome = names[0];
    const gap = weights[names[0]] - weights[names[1]];
    if (gap < TERRAIN.BIOME_DITHER_RANGE) {
      // Probability of flipping to the runner-up rises to 50% as gap → 0.
      const flip = 0.5 * (1 - gap / TERRAIN.BIOME_DITHER_RANGE);
      if (hash01(this.seed ^ SALT_DITHER, x, z) < flip) surfaceBiome = names[1];
    }

    return {
      x, z, height, weights,
      biome: names[0],
      surfaceBiome,
      surface: this.surfaceLayersFor(surfaceBiome, height),
    };
  }

  // Layer stack for a column: top block, filler under it, sub-layer under
  // that, stone below. Depths count blocks below the surface block.
  surfaceLayersFor(surfaceBiome, height) {
    const S = TERRAIN.SURFACE;
    const sea = OVERWORLD.SEA_LEVEL;

    if (surfaceBiome === 'desert') {
      return {
        top: BLOCK.SAND, filler: BLOCK.SAND, fillerDepth: S.SAND_DEPTH - 1,
        sub: BLOCK.SANDSTONE, subDepth: S.SANDSTONE_DEPTH,
      };
    }
    if (surfaceBiome === 'mountains' && height >= S.MOUNTAIN_STONE_MIN_HEIGHT) {
      return { top: BLOCK.STONE, filler: BLOCK.STONE, fillerDepth: 0, sub: BLOCK.STONE, subDepth: 0 };
    }
    // Shores and sea floor: sand instead of grass so nothing grassy sits
    // underwater and beaches ring the land.
    if (height <= sea + S.BEACH_MAX_ABOVE_SEA) {
      return {
        top: BLOCK.SAND, filler: BLOCK.SAND, fillerDepth: S.SAND_DEPTH - 1,
        sub: BLOCK.SANDSTONE, subDepth: 1,
      };
    }
    return {
      top: BLOCK.GRASS_BLOCK, filler: BLOCK.DIRT, fillerDepth: S.DIRT_DEPTH,
      sub: BLOCK.DIRT, subDepth: 0,
    };
  }

  // --- chunk generation -----------------------------------------------------

  // Fills a Chunk's block array. Pure per-column work plus decorations
  // re-derived from a margin, so generation order between chunks never
  // changes the result.
  generateChunk(chunk) {
    const size = CHUNK.SIZE;
    const margin = TERRAIN.GEN_MARGIN;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;

    // Column cache covering the chunk plus its margin. Coordinates outside
    // the cacheable window (nothing reaches it today) fall back to a direct
    // computation instead of risking a key collision.
    const cols = new Map();
    const colAt = (wx, wz) => {
      const ox = wx - x0 + margin;
      const oz = wz - z0 + margin;
      if (ox < 0 || ox >= 64 || oz < 0 || oz >= 64) return this.columnAt(wx, wz);
      const key = ox * 64 + oz;
      let col = cols.get(key);
      if (col === undefined) {
        col = this.columnAt(wx, wz);
        cols.set(key, col);
      }
      return col;
    };

    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        this.fillColumn(chunk, lx, lz, colAt(x0 + lx, z0 + lz));
      }
    }

    // Caves/ravines/ores carve before decorations so trees and cacti can
    // refuse anchors whose surface block was carved away (surfaceOpenAt).
    this.caves.apply(chunk, colAt);

    this.placeTrees(chunk, colAt);
    this.placeCacti(chunk, colAt);
  }

  fillColumn(chunk, lx, lz, col) {
    const minY = OVERWORLD.MIN_Y;
    const sea = OVERWORLD.SEA_LEVEL;
    const jagged = OVERWORLD.BEDROCK_JAGGED_LAYERS;
    const wx = col.x;
    const wz = col.z;
    const { height, surface } = col;

    for (let y = minY; y <= height; y++) {
      let id;
      if (y === OVERWORLD.BEDROCK_Y) {
        id = BLOCK.BEDROCK;
      } else if (y <= OVERWORLD.BEDROCK_Y + jagged) {
        // Jagged bedrock: chance falls off with height above the solid layer.
        const layer = y - OVERWORLD.BEDROCK_Y;
        const chance = 1 - layer / (jagged + 1);
        id = hash3_01(this.seed ^ SALT_BEDROCK, wx, y, wz) < chance
          ? BLOCK.BEDROCK
          : BLOCK.STONE;
      } else {
        const depth = height - y;
        if (depth === 0) id = surface.top;
        else if (depth <= surface.fillerDepth) id = surface.filler;
        else if (depth <= surface.fillerDepth + surface.subDepth) id = surface.sub;
        else id = BLOCK.STONE;
      }
      chunk.set(lx, y, lz, id);
    }

    // Water fills anything left open below sea level (surface at y = sea).
    for (let y = height + 1; y <= sea; y++) {
      chunk.set(lx, y, lz, BLOCK.WATER);
    }
  }

  // --- trees ----------------------------------------------------------------

  // A column hosts a tree when its hash clears the blended density AND it is
  // the strongest candidate in its 3x3 neighbourhood (keeps trunks apart).
  // Returns trunk height, or 0 for no tree.
  treeAt(col, colAt) {
    const { x, z, weights, surface, height } = col;
    if (surface.top !== BLOCK.GRASS_BLOCK) return 0;
    if (height <= OVERWORLD.SEA_LEVEL) return 0;

    const density = this.treeDensityFromWeights(weights);
    const r = hash01(this.seed ^ SALT_TREE, x, z);
    if (r >= density) return 0;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        const nr = hash01(this.seed ^ SALT_TREE, nx, nz);
        const nDensity = this.treeDensityFromWeights(colAt(nx, nz).weights);
        if (nr < nDensity && nr > r) return 0;
      }
    }

    const T = TERRAIN.TREES;
    const span = T.TRUNK_MAX - T.TRUNK_MIN + 1;
    return T.TRUNK_MIN + Math.floor(hash01(this.seed ^ SALT_TRUNK, x, z) * span);
  }

  treeDensityFromWeights(w) {
    const B = TERRAIN.BIOMES;
    return (
      w.plains * B.PLAINS.TREE_DENSITY +
      w.forest * B.FOREST.TREE_DENSITY +
      w.mountains * B.MOUNTAINS.TREE_DENSITY
    );
  }

  placeTrees(chunk, colAt) {
    const size = CHUNK.SIZE;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;
    const reach = 2; // canopy radius — anchors this far outside still touch us

    for (let az = z0 - reach; az < z0 + size + reach; az++) {
      for (let ax = x0 - reach; ax < x0 + size + reach; ax++) {
        const col = colAt(ax, az);
        const trunkH = this.treeAt(col, colAt);
        // Never anchor a tree on a surface a cave mouth or ravine carved
        // away (pure query — margin anchors agree with the owning chunk).
        if (trunkH > 0 && !this.caves.surfaceOpenAt(col, colAt)) {
          this.placeTree(chunk, ax, az, col.height, trunkH);
        }
      }
    }
  }

  placeTree(chunk, ax, az, surfY, trunkH) {
    const topY = surfY + trunkH;

    // Grass under a trunk becomes dirt (only when the anchor is in-chunk).
    this.setIfInside(chunk, ax, surfY, az, BLOCK.DIRT, false);

    // Canopy first, trunk second, so logs win where they overlap.
    // Two wide layers (corners clipped), one 3x3, one plus-shaped cap.
    for (let y = topY - 1; y <= topY; y++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          this.setIfInside(chunk, ax + dx, y, az + dz, BLOCK.OAK_LEAVES, true);
        }
      }
    }
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.setIfInside(chunk, ax + dx, topY + 1, az + dz, BLOCK.OAK_LEAVES, true);
      }
    }
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      this.setIfInside(chunk, ax + dx, topY + 2, az + dz, BLOCK.OAK_LEAVES, true);
    }

    for (let y = surfY + 1; y <= topY; y++) {
      this.setIfInside(chunk, ax, y, az, BLOCK.OAK_LOG, false);
    }
  }

  // Writes a decoration block if the position falls inside this chunk.
  // onlyAir: leaves never replace terrain, logs or other leaves.
  setIfInside(chunk, wx, wy, wz, id, onlyAir) {
    const size = CHUNK.SIZE;
    const lx = wx - chunk.cx * size;
    const lz = wz - chunk.cz * size;
    if (lx < 0 || lx >= size || lz < 0 || lz >= size) return;
    if (wy < OVERWORLD.MIN_Y || wy >= OVERWORLD.MIN_Y + CHUNK.HEIGHT) return;
    if (onlyAir && chunk.get(lx, wy, lz) !== BLOCK.AIR) return;
    chunk.set(lx, wy, lz, id);
  }

  // --- cacti ----------------------------------------------------------------

  placeCacti(chunk, colAt) {
    const size = CHUNK.SIZE;
    const C = TERRAIN.CACTUS;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;

    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const col = colAt(x0 + lx, z0 + lz);
        if (col.surfaceBiome !== 'desert') continue;
        if (col.surface.top !== BLOCK.SAND) continue;
        if (col.height <= OVERWORLD.SEA_LEVEL) continue;
        if (hash01(this.seed ^ SALT_CACTUS, col.x, col.z) >= C.DENSITY) continue;
        if (this.caves.surfaceOpenAt(col, colAt)) continue; // carved surface

        const span = C.MAX_HEIGHT - C.MIN_HEIGHT + 1;
        const h = C.MIN_HEIGHT +
          Math.floor(hash01(this.seed ^ (SALT_CACTUS + 1), col.x, col.z) * span);
        for (let i = 1; i <= h; i++) {
          this.setIfInside(chunk, col.x, col.height + i, col.z, BLOCK.CACTUS, true);
        }
      }
    }
  }
}
