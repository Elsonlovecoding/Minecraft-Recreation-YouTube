// world/surface_rules.js — the Phase 24 SURFACE RULES, moved verbatim out of
// world/terrain.js in Phase 26 per the ARCHITECTURE size cap (the spawn-scan
// and LOD additions took terrain.js past ~800). Which block tops a column and
// what lies under it: underwater floors (shallow sand / deep dirt, both
// gravel-patched), desert sand over sandstone, beach sand only within reach
// of real water, mountain bare stone by the noise-jittered stone line or on
// cliff faces, grass everywhere else.
//
// The generator is passed IN as `gen` (the spawn_scan.js/shapes.js argument
// pattern — this module imports nothing from terrain.js, so the pair stays
// cycle-free). It supplies the noise tables (gravelNoise, stoneLineNoise),
// the seed, and the memoised `_heightCached` neighbourhood reads.

import { OVERWORLD, TERRAIN } from '../config.js';
import { BLOCK } from './blocks.js';
import { fbm, hash01 } from './terrain_noise.js';

const SALT_GRAVEL_PATCH = 0x64a7;   // Phase 24: beach/riverbed gravel dither
                                    // (the same salt terrain.js always used)

// Is (x, z) inside a gravel patch? Beaches and riverbeds take gravel here
// instead of sand — a low-frequency field picks the patches, a per-column
// hash roughens their edges so they never read as smooth blobs.
export function gravelPatchAt(gen, x, z) {
  const G = TERRAIN.SURFACE.GRAVEL;
  const field = fbm(gen.gravelNoise, x * G.SCALE, z * G.SCALE, 2);
  const jitter = (hash01(gen.seed ^ SALT_GRAVEL_PATCH, x, z) - 0.5) * G.EDGE_JITTER;
  return field + jitter > G.THRESHOLD;
}

// Does this near-sea-level column count as beach? Only when some column
// within reach is actually underwater — sand needs water to lap it, so an
// inland plain that happens to sit at y 62 stays grass.
function nearWater(gen, x, z) {
  const B = TERRAIN.SURFACE.BEACH;
  const sea = OVERWORLD.SEA_LEVEL;
  for (let dz = -B.REACH; dz <= B.REACH; dz++) {
    for (let dx = -B.REACH; dx <= B.REACH; dx++) {
      if ((dx !== 0 || dz !== 0) && gen._heightCached(x + dx, z + dz) < sea) {
        return true;
      }
    }
  }
  return false;
}

// The Phase 24 mountain surface rule: bare stone only above a noise-jittered
// stone line, or on faces so steep grass could not sit (the column stands
// STEEP_DROP or more above its lowest 4-neighbour). Everything else grasses.
function bareStoneAt(gen, x, z, height) {
  const S = TERRAIN.SURFACE;
  const SL = S.STONE_LINE;
  const line = SL.HEIGHT + fbm(gen.stoneLineNoise, x * SL.SCALE, z * SL.SCALE, 2) * SL.JITTER;
  if (height >= line) return true;
  const minN = Math.min(
    gen._heightCached(x + 1, z), gen._heightCached(x - 1, z),
    gen._heightCached(x, z + 1), gen._heightCached(x, z - 1),
  );
  return height - minN >= S.STEEP_DROP;
}

// Layer stack for a column: top block, filler under it, sub-layer under
// that, stone below. Depths count blocks below the surface block.
// Phase 24 rewrote the rules: sand only where water actually is (beaches,
// shallow floors) or in deserts; gravel patches on beaches and riverbeds;
// mountain stone by stone-line and steepness instead of one fixed height.
export function surfaceLayersFor(gen, x, z, surfaceBiome, height) {
  const S = TERRAIN.SURFACE;
  const sea = OVERWORLD.SEA_LEVEL;

  // Underwater floors (oceans, lakes, rivers): sandy in the shallows —
  // riverbeds live here — with gravel patches throughout; plain dirt with
  // gravel below the sandy band.
  if (height < sea) {
    const gravel = gravelPatchAt(gen, x, z);
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
  if (height <= sea + S.BEACH.MAX_ABOVE_SEA && nearWater(gen, x, z)) {
    return {
      top: gravelPatchAt(gen, x, z) ? BLOCK.GRAVEL : BLOCK.SAND,
      filler: BLOCK.SAND, fillerDepth: S.SAND_DEPTH - 1,
      sub: BLOCK.SANDSTONE, subDepth: 1,
    };
  }

  if (surfaceBiome === 'mountains' && bareStoneAt(gen, x, z, height)) {
    return { top: BLOCK.STONE, filler: BLOCK.STONE, fillerDepth: 0, sub: BLOCK.STONE, subDepth: 0 };
  }

  return {
    top: BLOCK.GRASS_BLOCK, filler: BLOCK.DIRT, fillerDepth: S.DIRT_DEPTH,
    sub: BLOCK.DIRT, subDepth: 0,
  };
}
