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

import { OVERWORLD, CHUNK, TERRAIN, UNDERGROUND } from '../config.js';
import { BLOCK } from './blocks.js';
import { CaveCarver } from './caves.js';
import { StrongholdGenerator } from '../dimensions/stronghold.js';
// Phase 24: the seeded 2D noise machinery (hashes, Simplex2D, fbm,
// smoothstep) moved verbatim to world/terrain_noise.js per the ARCHITECTURE
// size cap — deliberately still terrain's OWN copy, independent of
// world/noise.js's 3D machinery (see the determinism note there).
import {
  mulberry32, hash2, hash01, hash3_01, Simplex2D, fbm, smoothstep,
} from './terrain_noise.js';

// Salts so each per-column decision draws from an independent hash stream.
const SALT_TREE = 0x7ee5;
const SALT_TRUNK = 0x7a11;
const SALT_CACTUS = 0xcac7;
const SALT_DITHER = 0xd17e;
const SALT_BEDROCK = 0xbedd;
const SALT_LEAF = 0x1eaf;
const SALT_DEEPSLATE = 0xdee9;
const SALT_GRAVEL_PATCH = 0x64a7;   // Phase 24: beach/riverbed gravel dither
const SALT_PLANT = 0x91a7;          // Phase 24: short grass
const SALT_FLOWER = 0xf10e;         // Phase 24: flower columns
const SALT_FLOWER_TYPE = 0xf17e;    // Phase 24: dandelion-vs-poppy patches
const SALT_BUSH = 0xb054;           // Phase 24: desert dead bushes
const SALT_POOL = 0x9001;           // Phase 24: surface lava pool regions

// Phase 23 — the deepslate transition. Below UNDERGROUND.DEEPSLATE.TOP_Y the
// stone the column fills with turns to deepslate, but NOT on a line: through
// the band down to FULL_Y each block independently rolls deepslate with a
// probability rising from 0 to 1, so the two interleave in a speckled band the
// player walks down through. At or below FULL_Y it is all deepslate.
function deepslateChance(y) {
  const D = UNDERGROUND.DEEPSLATE;
  if (y > D.TOP_Y) return 0;
  if (y <= D.FULL_Y) return 1;
  return (D.TOP_Y - y) / (D.TOP_Y - D.FULL_Y);
}

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
    // Phase 24 — the polish fields. Two warp fields push the biome sampling
    // coordinates around (irregular boundaries); the river pair supplies the
    // channel contours and their width variation; the rest drive the new
    // surface rules and decoration variation.
    this.warpXNoise = table(0x70819213);
    this.warpZNoise = table(0x81921324);
    this.riverNoise = table(0x92132435);
    this.riverWidthNoise = table(0x13243546);
    this.stoneLineNoise = table(0x24354657);
    this.gravelNoise = table(0x35465768);
    this.treeDensityNoise = table(0x46576879);
    this.treeHeightNoise = table(0x5768798a);
    this.plantNoise = table(0x68798a9b);
    this.flowerNoise = table(0x798a9bac);
    // Height memo — heights are pure in (x, z) but the Phase 24 surface
    // rules read neighbourhoods (slope, beach reach, pool relief), and
    // adjacent columns share most of those reads. Cleared when it grows
    // past a few chunks' worth (generateChunk), never trusted for anything
    // but a cache of the pure heightAt.
    this._hCache = new Map();
    // Surface lava pool memo, one entry per visited region tile (tiny).
    this._poolCache = new Map();
    // Phase 9: caves, ravines, ores, stone variants (world/caves.js) — carved
    // after the base column fill, before decorations.
    this.caves = new CaveCarver(this.seed);
    // Phase 19: the stronghold (dimensions/stronghold.js) — emitted per
    // chunk as the LAST generation pass so structure writes win, exactly
    // like the Nether's fortress pass (dimensions/nether.js).
    this.stronghold = new StrongholdGenerator(this.seed);
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
  // Phase 24: the climate and region fields are sampled at DOMAIN-WARPED
  // coordinates — two low-frequency fields push the sample point tens of
  // blocks around — so every biome boundary wanders irregularly instead of
  // tracing the smooth contours of the raw noise. Still continuous, still a
  // pure function of (x, z).
  biomeWeightsAt(x, z) {
    const WP = TERRAIN.BIOME_WARP;
    const wx = x + fbm(this.warpXNoise, x * WP.SCALE, z * WP.SCALE, WP.OCTAVES) * WP.AMPLITUDE;
    const wz = z + fbm(this.warpZNoise, x * WP.SCALE, z * WP.SCALE, WP.OCTAVES) * WP.AMPLITUDE;
    const { temperature, moisture } = this.climateAt(wx, wz);
    const M = TERRAIN.MOUNTAINS;
    const B = TERRAIN.BIOMES;

    const region = fbm(this.mountainRegionNoise, wx * M.REGION_SCALE, wz * M.REGION_SCALE, M.REGION_OCTAVES);
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
    let height =
      base +
      w.plains * (B.PLAINS.OFFSET + hill * B.PLAINS.HILL_AMPLITUDE) +
      w.forest * (B.FOREST.OFFSET + hill * B.FOREST.HILL_AMPLITUDE) +
      w.desert * (B.DESERT.OFFSET + hill * B.DESERT.HILL_AMPLITUDE) +
      w.mountains * (M.BASE_LIFT + ridge * M.RIDGE_AMPLITUDE);

    // Phase 24 — rivers. Where the river field's magnitude is inside the
    // (locally varied) channel width, terrain is pressed DOWN toward a bed
    // below sea level — never raised — so the water fill makes the channel a
    // river and the min() lets it run straight into any lake or ocean its
    // contour crosses. Contours of a continuous field cannot simply stop:
    // they loop or leave, which is what makes rivers continuous.
    const R = T.RIVERS;
    const line = fbm(this.riverNoise, x * R.LINE_SCALE, z * R.LINE_SCALE, R.LINE_OCTAVES);
    const widthVar = fbm(this.riverWidthNoise, x * R.WIDTH_VAR_SCALE, z * R.WIDTH_VAR_SCALE, 2);
    const width = R.WIDTH * (1 + R.WIDTH_VARIATION * widthVar);
    const q = Math.abs(line) / width; // 0 at the channel centre, 1 at the edge
    if (q < 1) {
      const sea = OVERWORLD.SEA_LEVEL;
      const inner = 1 - R.SHORE_BLEND;
      if (q <= inner) {
        // The channel: a parabolic bed, deepest at the centre, rising to
        // the bank lip at the inner edge.
        const qi = q / inner;
        const bed = sea + R.BANK_HEIGHT - (R.DEPTH + R.BANK_HEIGHT) * (1 - qi * qi);
        height = Math.min(height, bed);
      } else {
        // The banks: the cap eases from the lip back up into the terrain.
        const t = smoothstep(0, 1, (q - inner) / R.SHORE_BLEND);
        const cap = sea + R.BANK_HEIGHT + (height - sea - R.BANK_HEIGHT) * t;
        height = Math.min(height, cap);
      }
    }

    return Math.max(
      OVERWORLD.MIN_Y + TERRAIN.MIN_HEIGHT_ABOVE_BOTTOM,
      Math.min(OVERWORLD.PEAK_HEIGHT, Math.round(height)),
    );
  }

  // heightAt through the memo — the Phase 24 neighbourhood rules (slope,
  // beach reach, pool relief) read many neighbour heights and adjacent
  // columns share most of them.
  _heightCached(x, z) {
    const key = x + ',' + z;
    let h = this._hCache.get(key);
    if (h === undefined) {
      h = this.heightAt(x, z);
      this._hCache.set(key, h);
    }
    return h;
  }

  // --- per-column summary ---------------------------------------------------

  // Everything generation needs to know about one column: height, biome
  // weights, the (dithered) surface biome and its layer stack.
  columnAt(x, z) {
    const weights = this.biomeWeightsAt(x, z);
    const height = this.heightFromWeights(x, z, weights);
    this._hCache.set(x + ',' + z, height); // seed the memo — computed anyway

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
      surface: this.surfaceLayersFor(x, z, surfaceBiome, height),
    };
  }

  // Is (x, z) inside a gravel patch? Beaches and riverbeds take gravel here
  // instead of sand — a low-frequency field picks the patches, a per-column
  // hash roughens their edges so they never read as smooth blobs.
  _gravelPatchAt(x, z) {
    const G = TERRAIN.SURFACE.GRAVEL;
    const field = fbm(this.gravelNoise, x * G.SCALE, z * G.SCALE, 2);
    const jitter = (hash01(this.seed ^ SALT_GRAVEL_PATCH, x, z) - 0.5) * G.EDGE_JITTER;
    return field + jitter > G.THRESHOLD;
  }

  // Does this near-sea-level column count as beach? Only when some column
  // within reach is actually underwater — sand needs water to lap it, so an
  // inland plain that happens to sit at y 62 stays grass.
  _nearWater(x, z) {
    const B = TERRAIN.SURFACE.BEACH;
    const sea = OVERWORLD.SEA_LEVEL;
    for (let dz = -B.REACH; dz <= B.REACH; dz++) {
      for (let dx = -B.REACH; dx <= B.REACH; dx++) {
        if ((dx !== 0 || dz !== 0) && this._heightCached(x + dx, z + dz) < sea) {
          return true;
        }
      }
    }
    return false;
  }

  // The Phase 24 mountain surface rule: bare stone only above a noise-jittered
  // stone line, or on faces so steep grass could not sit (the column stands
  // STEEP_DROP or more above its lowest 4-neighbour). Everything else grasses.
  _bareStoneAt(x, z, height) {
    const S = TERRAIN.SURFACE;
    const SL = S.STONE_LINE;
    const line = SL.HEIGHT + fbm(this.stoneLineNoise, x * SL.SCALE, z * SL.SCALE, 2) * SL.JITTER;
    if (height >= line) return true;
    const minN = Math.min(
      this._heightCached(x + 1, z), this._heightCached(x - 1, z),
      this._heightCached(x, z + 1), this._heightCached(x, z - 1),
    );
    return height - minN >= S.STEEP_DROP;
  }

  // Layer stack for a column: top block, filler under it, sub-layer under
  // that, stone below. Depths count blocks below the surface block.
  // Phase 24 rewrote the rules: sand only where water actually is (beaches,
  // shallow floors) or in deserts; gravel patches on beaches and riverbeds;
  // mountain stone by stone-line and steepness instead of one fixed height.
  surfaceLayersFor(x, z, surfaceBiome, height) {
    const S = TERRAIN.SURFACE;
    const sea = OVERWORLD.SEA_LEVEL;

    // Underwater floors (oceans, lakes, rivers): sandy in the shallows —
    // riverbeds live here — with gravel patches throughout; plain dirt with
    // gravel below the sandy band.
    if (height < sea) {
      const gravel = this._gravelPatchAt(x, z);
      if (sea - height <= S.UNDERWATER_SAND_DEPTH) {
        return {
          top: gravel ? BLOCK.GRAVEL : BLOCK.SAND,
          filler: BLOCK.SAND, fillerDepth: 2, sub: BLOCK.SANDSTONE, subDepth: 1,
        };
      }
      return {
        top: gravel ? BLOCK.GRAVEL : BLOCK.DIRT,
        filler: BLOCK.DIRT, fillerDepth: 2, sub: BLOCK.DIRT, subDepth: 0,
      };
    }

    if (surfaceBiome === 'desert') {
      return {
        top: BLOCK.SAND, filler: BLOCK.SAND, fillerDepth: S.SAND_DEPTH - 1,
        sub: BLOCK.SANDSTONE, subDepth: S.SANDSTONE_DEPTH,
      };
    }

    // Beaches: near-sea columns with real water in reach, gravel-patched.
    if (height <= sea + S.BEACH.MAX_ABOVE_SEA && this._nearWater(x, z)) {
      return {
        top: this._gravelPatchAt(x, z) ? BLOCK.GRAVEL : BLOCK.SAND,
        filler: BLOCK.SAND, fillerDepth: S.SAND_DEPTH - 1,
        sub: BLOCK.SANDSTONE, subDepth: 1,
      };
    }

    if (surfaceBiome === 'mountains' && this._bareStoneAt(x, z, height)) {
      return { top: BLOCK.STONE, filler: BLOCK.STONE, fillerDepth: 0, sub: BLOCK.STONE, subDepth: 0 };
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

    // Keep the height memo bounded — a few dozen chunks' worth of columns.
    if (this._hCache.size > 60000) this._hCache.clear();

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

    // Phase 24: surface lava pools carve after the caves (so nothing
    // re-carves the lava) and before the decorations (which skip their
    // footprints via _surfacePoolAt).
    this.placeSurfaceLavaPools(chunk, colAt);

    this.placeTrees(chunk, colAt);
    this.placeCacti(chunk, colAt);
    this.placePlants(chunk, colAt);

    this.stronghold.emitChunk(chunk); // last — structure writes win
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
      // Deepslate replaces the stone of the deep — including the stone
      // between the jagged bedrock, which is deeper than anything.
      if (id === BLOCK.STONE) {
        const p = deepslateChance(y);
        if (p > 0 && hash3_01(this.seed ^ SALT_DEEPSLATE, wx, y, wz) < p) {
          id = BLOCK.DEEPSLATE;
        }
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
    if (this._surfacePoolAt(x, z)) return 0; // never over a surface lava pool

    const density = this.treeDensityAt(x, z, weights);
    const r = hash01(this.seed ^ SALT_TREE, x, z);
    if (r >= density) return 0;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        const nr = hash01(this.seed ^ SALT_TREE, nx, nz);
        const nDensity = this.treeDensityAt(nx, nz, colAt(nx, nz).weights);
        if (nr < nDensity && nr > r) return 0;
      }
    }

    // Trunk height: the biome range plus a slow noise bias, so groves of
    // taller trees stand together instead of heights being i.i.d. per trunk.
    const T = TERRAIN.TREES;
    const span = T.TRUNK_MAX - T.TRUNK_MIN + 1;
    const hf = TERRAIN.TREES.HEIGHT_FIELD;
    const bias01 = (fbm(this.treeHeightNoise, x * hf.SCALE, z * hf.SCALE, 2) + 1) * 0.5;
    return T.TRUNK_MIN + Math.floor(hash01(this.seed ^ SALT_TRUNK, x, z) * span) +
      Math.round(hf.BIAS * bias01);
  }

  // Blended biome density scaled by the Phase 24 density field, so a forest
  // has glades and thickets rather than one uniform spacing.
  treeDensityAt(x, z, w) {
    const F = TERRAIN.TREES.DENSITY_FIELD;
    const f01 = (fbm(this.treeDensityNoise, x * F.SCALE, z * F.SCALE, 2) + 1) * 0.5;
    return this.treeDensityFromWeights(w) * (F.MIN + (F.MAX - F.MIN) * f01);
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
    const T = TERRAIN.TREES;

    // Grass under a trunk becomes dirt (only when the anchor is in-chunk).
    this.setIfInside(chunk, ax, surfY, az, BLOCK.DIRT, false);

    // Canopy first, trunk second, so logs win where they overlap.
    // WIDE_LAYERS 5x5 layers (each corner kept with CORNER_CHANCE — vanilla
    // clips corners randomly), one 3x3, one plus-shaped cap. Phase 11 made
    // the canopy a layer deeper so the middle of a tree reads as a dense
    // mass instead of a see-through shell.
    for (let y = topY - (T.WIDE_LAYERS - 1); y <= topY; y++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2 &&
              hash3_01(this.seed ^ SALT_LEAF, ax + dx, y, az + dz) >= T.CORNER_CHANCE) {
            continue;
          }
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
        if (this._surfacePoolAt(col.x, col.z)) continue; // lava pool footprint
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

  // --- ground vegetation (Phase 24) ----------------------------------------

  // Cross-plane plants scattered on the surface, one cell above the top
  // block. Short grass follows a density FIELD (patches of thick growth
  // thinning to nothing) scaled per biome; flowers only appear inside
  // cluster regions of their own field and pick dandelion-vs-poppy per
  // coarse patch, so one meadow leans yellow and another red; dead bushes
  // speckle desert sand. Pure per column — a single-cell decoration needs
  // no cross-chunk writes at all.
  placePlants(chunk, colAt) {
    const size = CHUNK.SIZE;
    const P = TERRAIN.PLANTS;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;

    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const col = colAt(x0 + lx, z0 + lz);
        const { x, z, height, surface, surfaceBiome } = col;
        if (height <= OVERWORLD.SEA_LEVEL) continue;

        let id = 0;
        if (surface.top === BLOCK.GRASS_BLOCK) {
          const flowerField = fbm(
            this.flowerNoise, x * P.FLOWER_FIELD_SCALE, z * P.FLOWER_FIELD_SCALE, 2,
          );
          if (
            flowerField > P.FLOWER_FIELD_MIN &&
            hash01(this.seed ^ SALT_FLOWER, x, z) < P.FLOWER_CHANCE
          ) {
            id = hash01(this.seed ^ SALT_FLOWER_TYPE, x >> 4, z >> 4) < 0.5
              ? BLOCK.DANDELION
              : BLOCK.POPPY;
          } else {
            const density = (P.GRASS_DENSITY[surfaceBiome] ?? 0) * (fbm(
              this.plantNoise, x * P.GRASS_FIELD_SCALE, z * P.GRASS_FIELD_SCALE, 2,
            ) + 1) * 0.5;
            if (hash01(this.seed ^ SALT_PLANT, x, z) < density) id = BLOCK.SHORT_GRASS;
          }
        } else if (surfaceBiome === 'desert' && surface.top === BLOCK.SAND) {
          if (hash01(this.seed ^ SALT_BUSH, x, z) < P.DEAD_BUSH_CHANCE) {
            id = BLOCK.DEAD_BUSH;
          }
        }
        if (!id) continue;
        if (this._surfacePoolAt(x, z)) continue;       // lava pool footprint
        if (this.caves.surfaceOpenAt(col, colAt)) continue; // carved surface
        this.setIfInside(chunk, x, height + 1, z, id, true);
      }
    }
  }

  // --- surface lava pools (Phase 24) ---------------------------------------

  // The pool candidate of one REGION_SIZE tile, or null. Pure per (seed,
  // region): a hashed centre well inside the tile (the footprint can never
  // cross into a neighbouring tile, so every cell's membership is answered
  // by its own region alone), gated to mountain/desert centres on gentle
  // ground above the beaches. `level` is the lava surface: one below the
  // footprint's lowest column, so the rim always stands above the lava and
  // the fluid settle pass finds nothing to spread.
  _surfacePoolFor(rx, rz) {
    const key = rx + ',' + rz;
    let pool = this._poolCache.get(key);
    if (pool !== undefined) return pool;
    pool = null;
    const P = TERRAIN.SURFACE_LAVA;
    const h = hash2(this.seed ^ SALT_POOL, rx, rz);
    if ((h & 0xffff) / 0x10000 < P.CHANCE) {
      const margin = P.RADIUS_MAX + 2;
      const span = P.REGION_SIZE - 2 * margin;
      const px = rx * P.REGION_SIZE + margin + Math.floor((((h >>> 16) & 0xff) / 256) * span);
      const pz = rz * P.REGION_SIZE + margin + Math.floor((((h >>> 24) & 0xff) / 256) * span);
      const radius = P.RADIUS_MIN +
        (((h >>> 8) & 0xff) % (P.RADIUS_MAX - P.RADIUS_MIN + 1));
      const biome = this.biomeAt(px, pz);
      const centreH = this._heightCached(px, pz);
      if (
        (biome === 'mountains' || biome === 'desert') &&
        centreH > OVERWORLD.SEA_LEVEL + P.MIN_HEIGHT_ABOVE_SEA
      ) {
        // Relief over footprint AND rim: a pool wants a flat shelf, and a
        // rim that stands above the lava is what keeps the basin closed.
        let minH = Infinity;
        let maxH = -Infinity;
        const r1 = radius + 1;
        for (let dz = -r1; dz <= r1; dz++) {
          for (let dx = -r1; dx <= r1; dx++) {
            if (dx * dx + dz * dz > r1 * r1) continue;
            const hh = this._heightCached(px + dx, pz + dz);
            if (hh < minH) minH = hh;
            if (hh > maxH) maxH = hh;
          }
        }
        if (maxH - minH <= P.MAX_RELIEF) {
          pool = { px, pz, radius, level: minH - 1 };
        }
      }
    }
    this._poolCache.set(key, pool);
    return pool;
  }

  // The pool whose footprint (radius + 1, so decorations also clear the rim)
  // contains (x, z), or null. Pure — decorations in any chunk agree.
  _surfacePoolAt(x, z) {
    const P = TERRAIN.SURFACE_LAVA;
    const pool = this._surfacePoolFor(
      Math.floor(x / P.REGION_SIZE), Math.floor(z / P.REGION_SIZE),
    );
    if (!pool) return null;
    const dx = x - pool.px;
    const dz = z - pool.pz;
    const r1 = pool.radius + 1;
    return dx * dx + dz * dz <= r1 * r1 ? pool : null;
  }

  // Digs and fills this chunk's share of any pool overlapping it: the bump
  // above the lava level is carved off, an unsolid floor cell (a cave that
  // nicked the shelf) is plugged with stone, and the floor ring inside the
  // radius floods with lava sources. In-chunk writes only; the pure pool
  // descriptor makes every chunk agree on the shared cells.
  placeSurfaceLavaPools(chunk, colAt) {
    const size = CHUNK.SIZE;
    const P = TERRAIN.SURFACE_LAVA;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;
    const r0x = Math.floor(x0 / P.REGION_SIZE);
    const r1x = Math.floor((x0 + size - 1) / P.REGION_SIZE);
    const r0z = Math.floor(z0 / P.REGION_SIZE);
    const r1z = Math.floor((z0 + size - 1) / P.REGION_SIZE);
    for (let rz = r0z; rz <= r1z; rz++) {
      for (let rx = r0x; rx <= r1x; rx++) {
        const pool = this._surfacePoolFor(rx, rz);
        if (!pool) continue;
        const r2 = pool.radius * pool.radius;
        for (let lz = 0; lz < size; lz++) {
          for (let lx = 0; lx < size; lx++) {
            const dx = x0 + lx - pool.px;
            const dz = z0 + lz - pool.pz;
            if (dx * dx + dz * dz > r2) continue;
            const col = colAt(x0 + lx, z0 + lz);
            for (let y = pool.level + 1; y <= col.height; y++) {
              chunk.set(lx, y, lz, BLOCK.AIR);
            }
            const under = chunk.get(lx, pool.level - 1, lz);
            if (under === BLOCK.AIR || under === BLOCK.WATER || under === BLOCK.LAVA) {
              chunk.set(lx, pool.level - 1, lz, BLOCK.STONE);
            }
            chunk.set(lx, pool.level, lz, BLOCK.LAVA);
          }
        }
      }
    }
  }
}
