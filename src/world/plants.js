// world/plants.js — the Phase 24 ground vegetation: short grass, dandelion,
// poppy and dead bush. Cross-plane blocks: two DoubleSide quads in an X,
// alpha-cutout, no collision, no light attenuation, popped when the block
// under them goes. Registrations live here on the world/shapes.js pattern —
// blocks.js hands this module `register` and the id table, so the pair stays
// cycle-free and blocks.js stays inside its size cap.
//
// The registry flags do most of the work (see the Phase 24 notes in
// docs/PROGRESS.md): `solid: false` empties the collision box list,
// `transparent: true` zeroes light opacity and AO occlusion and keeps
// neighbour faces rendering, `hardness: 0` breaks instantly with no tool
// wear, and `faces` keeps the break-particle crop working — the mesher
// dispatches to the cross emitter (world/emitters.js) BEFORE the generic
// cube path ever reads those tiles.

import { TILE } from '../render/atlas.js';

// Filled by registerPlants — per-id atlas tile for the cross emitter, and
// the id set every plant rule reads.
export const CROSS_PLANT_TILE = {};

let ids = null;

export function isCrossPlant(id) {
  return CROSS_PLANT_TILE[id] !== undefined;
}

// May `plantId` sit on `soilId`? Grass and dirt carry every plant; sand
// additionally carries the dead bush (it generates on desert sand). Shared
// by player placement (player/placement.js), the support-break listener
// (main.js) and terrain generation's own writes.
export function plantCanSitOn(plantId, soilId) {
  if (soilId === ids.GRASS_BLOCK || soilId === ids.DIRT) return true;
  return plantId === ids.DEAD_BUSH && soilId === ids.SAND;
}

export function registerPlants(register, BLOCK) {
  ids = BLOCK;
  const plant = (id, name, displayName, tile, extra = {}) => {
    register(id, name, displayName, {
      faces: { all: tile },       // break-particle crop; never cube-meshed
      hardness: 0,                // instant by hand, no durability cost
      solid: false,               // no collision — walk straight through
      transparent: true,          // opacity 0, no AO, neighbours keep faces
      special: 'plant',
      ...extra,
    });
    CROSS_PLANT_TILE[id] = tile;
  };

  plant(BLOCK.SHORT_GRASS, 'short_grass', 'Short Grass', TILE.SHORT_GRASS, {
    // Vanilla: bare hands get the occasional seeds; shears get the plant.
    drops: [{ item: 'wheat_seeds', count: 1, chance: 0.125 }],
    shearDrops: [{ item: 'short_grass', count: 1 }],
  });
  // The brief: hand-breaking drops nothing. Shears are the deliberate
  // obtain path (the leaves/short-grass precedent), so the flower items —
  // placeable on grass/dirt — are actually reachable in play.
  plant(BLOCK.DANDELION, 'dandelion', 'Dandelion', TILE.DANDELION, {
    drops: [],
    shearDrops: [{ item: 'dandelion', count: 1 }],
  });
  plant(BLOCK.POPPY, 'poppy', 'Poppy', TILE.POPPY, {
    drops: [],
    shearDrops: [{ item: 'poppy', count: 1 }],
  });
  plant(BLOCK.DEAD_BUSH, 'dead_bush', 'Dead Bush', TILE.DEAD_BUSH, {
    drops: [],
    shearDrops: [{ item: 'dead_bush', count: 1 }],
  });
}
