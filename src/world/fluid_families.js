// world/fluid_families.js — the lava and water id tables and their predicates.
//
// Phase 23 split: this is the cut ARCHITECTURE.md has mandated for
// world/blocks.js since Phase 21 (the file was already over the ~800-line cap
// at 908, and the deepslate set this phase added would have pushed it to 967).
// Moved VERBATIM — the tables, the predicates and fluidHeight are unchanged;
// only where they live moved, and blocks.js re-exports every one of them so
// no consumer had to change a single import.
//
// The cycle-free shape ARCHITECTURE calls for: this module imports nothing
// from blocks.js. blocks.js calls buildFluidFamilies(BLOCK, BLOCKS) at the
// point in its registration order where the ids exist, exactly the way it
// hands `register` to world/shapes.js.
//
// What the tables encode: a flow LEVEL per fluid id — 0 for a source and for
// a falling column (both spread at full strength), 1..N for horizontal flow
// cells, -1 for anything that is not that fluid. Flat typed arrays, because
// the mesher, the physics sweep and the fluid automaton all read them in
// hot loops.

import { FLUIDS } from '../config.js';

export function buildFluidFamilies(BLOCK, BLOCKS) {
  const LAVA_LEVEL_OF = (() => {
    const table = new Int8Array(BLOCKS.length).fill(-1);
    table[BLOCK.LAVA] = 0;
    table[BLOCK.LAVA_FLOW_1] = 1;
    table[BLOCK.LAVA_FLOW_2] = 2;
    table[BLOCK.LAVA_FLOW_3] = 3;
    table[BLOCK.LAVA_FALL] = 0;
    return table;
  })();

  const WATER_LEVEL_OF = (() => {
    const table = new Int8Array(BLOCKS.length).fill(-1);
    table[BLOCK.WATER] = 0;
    for (let level = 1; level <= 7; level++) {
      table[BLOCK.WATER_FLOW_1 + level - 1] = level;
    }
    table[BLOCK.WATER_FALL] = 0;
    return table;
  })();

  const WATER_FLOW_BY_LEVEL = [
    null,
    BLOCK.WATER_FLOW_1, BLOCK.WATER_FLOW_2, BLOCK.WATER_FLOW_3, BLOCK.WATER_FLOW_4,
    BLOCK.WATER_FLOW_5, BLOCK.WATER_FLOW_6, BLOCK.WATER_FLOW_7,
  ];

  // Any lava cell — source, flow or fall (contact damage, fluid physics,
  // pathfinding avoidance, item burning all key off this).
  const isLava = (id) => LAVA_LEVEL_OF[id] !== undefined && LAVA_LEVEL_OF[id] >= 0;
  const isLavaSource = (id) => id === BLOCK.LAVA;

  // Horizontal flow level (1..3) of a flowing cell, or null for anything else
  // (including the source and the falling column).
  const lavaFlowLevel = (id) => {
    const level = LAVA_LEVEL_OF[id];
    return level >= 1 ? level : null;
  };

  const isWater = (id) => WATER_LEVEL_OF[id] >= 0;
  const isWaterSource = (id) => id === BLOCK.WATER;
  const waterFlowLevel = (id) => {
    const level = WATER_LEVEL_OF[id];
    return level >= 1 ? level : null;
  };

  // Surface height of a fluid cell as a fraction of its block — 1 for sources
  // and falling columns, stepping down per horizontal flow level. The mesher
  // renders at this height and the player's fluid line reads it, so a 1/8-deep
  // film can't make anyone swim (Phase 21: one table, two consumers).
  const fluidHeight = (id) => {
    const lava = LAVA_LEVEL_OF[id];
    if (lava >= 0) {
      if (id === BLOCK.LAVA) return 1;
      return id === BLOCK.LAVA_FALL
        ? FLUIDS.FALL_HEIGHT : FLUIDS.FLOW_HEIGHTS[lava - 1];
    }
    const water = WATER_LEVEL_OF[id];
    if (water >= 0) {
      if (id === BLOCK.WATER) return 1;
      return id === BLOCK.WATER_FALL
        ? FLUIDS.FALL_HEIGHT : FLUIDS.WATER_FLOW_HEIGHTS[water - 1];
    }
    return 0;
  };

  return {
    LAVA_LEVEL_OF, isLava, isLavaSource, lavaFlowLevel,
    WATER_LEVEL_OF, WATER_FLOW_BY_LEVEL, isWater, isWaterSource, waterFlowLevel,
    fluidHeight,
  };
}
