// world/blocks.js — Block registry: ids, display names, per-face tile indices,
// hardness, tool tier, drops, solidity, transparency, light emission.
// Data comes from the SPEC.md block tables; tile indices from render/atlas.js
// (which mirrors docs/ATLAS_MAP.md and is never renumbered).
//
// Field meanings:
//   faces        atlas tiles as { all } or { top, bottom, side } or explicit
//                { px, nx, py, ny, pz, nz }; null for blocks with no cube
//                texture (air, portals — rendered specially later)
//   tiles        faces resolved to a 6-array in BoxGeometry face order
//                [px, nx, py, ny, pz, nz] for the chunk mesher
//   hardness     seconds-at-1x to break; Infinity = unbreakable; null = not a
//                minable target at all (fluids, portal interiors)
//   tool         tool class that mines it fast ('pickaxe'|'axe'|'shovel'|null)
//   minTier      minimum tool tier for drops: 'hand'|'wood'|'stone'|'iron'|'diamond'
//                (lower tiers still break it, very slowly, dropping nothing)
//   drops        [{ item, count | [min, max], chance?, fallback? }] — item ids
//                for the item registry; empty array = drops nothing. chance
//                entries roll independently; a `fallback: true` entry drops
//                only when NO chance entry succeeded (vanilla-style exclusive
//                drops: gravel yields flint OR itself, never both)
//   solid        has a collision box
//   transparent  does NOT fully occlude neighbouring faces (meshing/culling)
//   selfCull     transparent blocks only: cull faces between same-id
//                neighbours so runs merge into one surface (water, glass).
//                Leaves and cactus override to false — every interior plane
//                renders (one quad per plane), so canopies read as a dense
//                mass and stacked cacti show their top faces through the
//                side-face gap.
//   occludesAO   contributes to ambient occlusion corners. Defaults to
//                solid && !transparent; leaves override to true so canopy
//                interiors darken like vanilla.
//   inset        horizontal shrink of the visual side faces AND the collision
//                box (blocks): cactus renders and collides 1/16 in from the
//                cell edge, so stacked cacti read as continuous.
//   light        emitted light level 0-15
//   opacity      light levels absorbed per block during propagation:
//                15 = blocks light entirely (default for non-transparent),
//                0 = light passes freely (default for transparent);
//                water and leaves absorb partially

import { TILE } from '../render/atlas.js';
import { SHAPES } from '../config.js';
// Phase 21: the shaped building blocks (stairs, slabs, fences, gates, walls,
// ladders, doors, trapdoors, beds, signs, pots, frames) live in their own
// module per the ARCHITECTURE size cap. It imports nothing from here — this
// file hands it `register` and BLOCK — so the pair is cycle-free.
import { SHAPED_BLOCK_IDS, registerBuildingBlocks } from './shapes.js';
import { buildShapeTables } from './shape_tables.js';
// Phase 23: the fluid families (the lava/water id tables and their
// predicates) — the cut ARCHITECTURE.md has mandated for this file. Same
// shape as shapes.js: it imports nothing from here, this file hands it the
// id table, so the pair is cycle-free.
import { buildFluidFamilies } from './fluid_families.js';
// Phase 24: the cross-plane ground plants (short grass, flowers, dead bush)
// — the shapes.js pattern again: this file hands it `register` and BLOCK.
import { registerPlants, isCrossPlant, plantCanSitOn, CROSS_PLANT_TILE } from './plants.js';

export { isCrossPlant, plantCanSitOn, CROSS_PLANT_TILE };

// Numeric block ids. Chunk data is a Uint8Array of these, so keep ids < 256.
// Append new blocks at the end — never renumber existing ids.
export const BLOCK = {
  AIR: 0,
  GRASS_BLOCK: 1,
  DIRT: 2,
  STONE: 3,
  COBBLESTONE: 4,
  SAND: 5,
  GRAVEL: 6,
  OAK_LOG: 7,
  OAK_PLANKS: 8,
  OAK_LEAVES: 9,
  WATER: 10,
  LAVA: 11,
  COAL_ORE: 12,
  IRON_ORE: 13,
  GOLD_ORE: 14,
  REDSTONE_ORE: 15,
  DIAMOND_ORE: 16,
  OBSIDIAN: 17,
  BEDROCK: 18,
  CRAFTING_TABLE: 19,
  FURNACE: 20,
  CHEST: 21,
  TORCH: 22,
  CACTUS: 23,
  SANDSTONE: 24,
  GLASS: 25,
  NETHERRACK: 26,
  SOUL_SAND: 27,
  NETHER_BRICKS: 28,
  GLOWSTONE: 29,
  NETHER_QUARTZ_ORE: 30,
  NETHER_PORTAL: 31,
  END_STONE: 32,
  END_PORTAL_FRAME: 33,
  END_PORTAL: 34,
  STONE_BRICKS: 35,
  MOSSY_STONE_BRICKS: 36,
  CRACKED_STONE_BRICKS: 37,
  BOOKSHELF: 38,
  IRON_BARS: 39,
  SPAWNER: 40,
  BREWING_STAND: 41,
  WHITE_WOOL: 42,
  IRON_BLOCK: 43,
  GOLD_BLOCK: 44,
  DIAMOND_BLOCK: 45,
  COAL_BLOCK: 46,
  GRANITE: 47,
  DIORITE: 48,
  ANDESITE: 49,
  // Phase 10: furnace facing/lit variants (the base FURNACE id stays 20 and
  // faces south/+z; placement picks the variant facing the player, smelting
  // swaps lit <-> unlit in place). All variants drop 'furnace'.
  FURNACE_N: 50,
  FURNACE_E: 51,
  FURNACE_W: 52,
  FURNACE_LIT_S: 53,
  FURNACE_LIT_N: 54,
  FURNACE_LIT_E: 55,
  FURNACE_LIT_W: 56,
  // Phase 11: wall torch variants (the base TORCH id 22 stays the floor
  // torch). Placement against a wall face picks the variant leaning out of
  // that wall ('S' leans toward +z); all variants drop 'torch'.
  TORCH_WALL_S: 57,
  TORCH_WALL_N: 58,
  TORCH_WALL_E: 59,
  TORCH_WALL_W: 60,
  // Phase 12: flowing lava (world/fluids.js). A lava SOURCE stays id 11;
  // flowing cells carry their horizontal spread level (1..3 — each renders a
  // step lower than the last) and falling columns get their own id. All of
  // them glow, damage and burn like lava, none is targetable or scoopable.
  LAVA_FLOW_1: 61,
  LAVA_FLOW_2: 62,
  LAVA_FLOW_3: 63,
  LAVA_FALL: 64,
  // Phase 17: nether wart growth stages (fortress wart rooms generate stage
  // 2; planting the nether_wart item on soul sand starts a stage-0 plant
  // that world/wart.js grows). Rendered as the vanilla crop shape by the
  // mesher's wart emitter (world/emitters.js) — the two younger stages
  // shorter, sampling the bottom band of the same atlas tile.
  NETHER_WART_0: 65,
  NETHER_WART_1: 66,
  NETHER_WART_2: 67,
  // Phase 19: an end portal frame holding an eye of ender (right-clicking
  // a frame with an eye fills it; some generate pre-filled). The base
  // END_PORTAL_FRAME id 33 stays the empty frame.
  END_PORTAL_FRAME_EYE: 68,
  // Phase 21: flowing WATER, the lava family's twin (world/fluids.js runs
  // both on one automaton now). A water SOURCE stays id 10; flowing cells
  // carry their horizontal spread level 1..7 (each a step lower) and
  // falling columns get their own id. None is scoopable or targetable.
  WATER_FLOW_1: 69,
  WATER_FLOW_2: 70,
  WATER_FLOW_3: 71,
  WATER_FLOW_4: 72,
  WATER_FLOW_5: 73,
  WATER_FLOW_6: 74,
  WATER_FLOW_7: 75,
  WATER_FALL: 76,
  ...SHAPED_BLOCK_IDS,
  // Phase 23: deepslate. Below DEEPSLATE.TOP_Y the stone the terrain fills
  // with becomes deepslate (blended over the band down to FULL_Y), and every
  // ore vein that lands in it takes its deepslate variant. Ids continue after
  // the Phase 21 shaped set, which ends at ITEM_FRAME_W = 162.
  DEEPSLATE: 163,
  COBBLED_DEEPSLATE: 164,
  DEEPSLATE_COAL_ORE: 165,
  DEEPSLATE_IRON_ORE: 166,
  DEEPSLATE_GOLD_ORE: 167,
  DEEPSLATE_REDSTONE_ORE: 168,
  DEEPSLATE_DIAMOND_ORE: 169,
  // Phase 23: clay, in patches on cave floors near underground water.
  CLAY: 170,
  // Phase 24: ground vegetation — cross-plane plants (two DoubleSide quads
  // in an X, alpha-cutout, no collision, no light attenuation). Atlas 65-68.
  SHORT_GRASS: 171,
  DANDELION: 172,
  POPPY: 173,
  DEAD_BUSH: 174,
};

export const BLOCKS = [];

// BoxGeometry face order used throughout rendering (see main.js Phase 1).
export const FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

function resolveFaceTile(faces, face) {
  if (faces[face] !== undefined) return faces[face];
  if (face === 'py') return faces.top ?? faces.all;
  if (face === 'ny') return faces.bottom ?? faces.all;
  return faces.side ?? faces.all;
}

function register(id, name, displayName, props) {
  const {
    faces = null,
    hardness = null,
    tool = null,
    minTier = 'hand',
    drops,
    solid = true,
    transparent = false,
    selfCull = true,
    occludesAO = solid && !transparent,
    inset = 0,
    light = 0,
    opacity = transparent ? 0 : 15,
    falls = false,
    fluid = false,
    damagesOnContact = false,
    slows = false,
    climbable = false,
    special = null,
    shape = null,
    collision = null,
    shearDrops = null,
  } = props;

  BLOCKS[id] = Object.freeze({
    id,
    name,
    displayName,
    faces,
    tiles: faces ? FACE_ORDER.map((f) => resolveFaceTile(faces, f)) : null,
    hardness,
    tool,
    minTier,
    // Default: drops one of itself.
    drops: drops ?? [{ item: name, count: 1 }],
    // What the block yields when broken with shears instead (Phase 21:
    // leaves give leaf blocks). null = the normal drop table.
    shearDrops,
    solid,
    transparent,
    selfCull,
    occludesAO,
    inset,
    light,
    opacity,
    falls,
    fluid,
    damagesOnContact,
    slows,
    climbable,
    special,
    // Phase 21 — the ONE shape table. `shape` is the render box list
    // ([{ box: [x0,y0,z0,x1,y1,z1], tiles: {top,bottom,side}|tile }]) and
    // `collision` the physics box list; when only `shape` is given the
    // physics boxes derive from it, so what you see is what you walk into.
    // Both may be the string 'dynamic:<kind>' for connection-shaped blocks
    // (fences, walls) — resolved per cell by shapeBoxesAt/collisionBoxesAt.
    shape,
    collision,
  });
}

// ---------------------------------------------------------------------------
// Overworld
// ---------------------------------------------------------------------------

register(BLOCK.AIR, 'air', 'Air', {
  solid: false, transparent: true, drops: [],
});
register(BLOCK.GRASS_BLOCK, 'grass_block', 'Grass Block', {
  faces: { top: TILE.GRASS_TOP, bottom: TILE.DIRT, side: TILE.GRASS_SIDE },
  hardness: 0.6, tool: 'shovel', drops: [{ item: 'dirt', count: 1 }],
});
register(BLOCK.DIRT, 'dirt', 'Dirt', {
  faces: { all: TILE.DIRT }, hardness: 0.5, tool: 'shovel',
});
register(BLOCK.STONE, 'stone', 'Stone', {
  faces: { all: TILE.STONE }, hardness: 1.5, tool: 'pickaxe', minTier: 'wood',
  drops: [{ item: 'cobblestone', count: 1 }],
});
register(BLOCK.COBBLESTONE, 'cobblestone', 'Cobblestone', {
  faces: { all: TILE.COBBLESTONE }, hardness: 2.0, tool: 'pickaxe', minTier: 'wood',
});
register(BLOCK.SAND, 'sand', 'Sand', {
  faces: { all: TILE.SAND }, hardness: 0.5, tool: 'shovel', falls: true,
});
// Gravel sources flint like vanilla (10%, replacing the gravel drop) —
// flint_and_steel and arrows are on the SPEC critical path, and gravel is
// their only source.
register(BLOCK.GRAVEL, 'gravel', 'Gravel', {
  faces: { all: TILE.GRAVEL }, hardness: 0.6, tool: 'shovel', falls: true,
  drops: [
    { item: 'flint', count: 1, chance: 0.1 },
    { item: 'gravel', count: 1, fallback: true },
  ],
});
register(BLOCK.OAK_LOG, 'oak_log', 'Oak Log', {
  faces: { top: TILE.OAK_LOG_TOP, bottom: TILE.OAK_LOG_TOP, side: TILE.OAK_LOG },
  hardness: 2.0, tool: 'axe',
});
register(BLOCK.OAK_PLANKS, 'oak_planks', 'Oak Planks', {
  faces: { all: TILE.OAK_PLANKS }, hardness: 2.0, tool: 'axe',
});
register(BLOCK.OAK_LEAVES, 'oak_leaves', 'Oak Leaves', {
  faces: { all: TILE.OAK_LEAVES }, hardness: 0.2, transparent: true, opacity: 1,
  selfCull: false, occludesAO: true,
  drops: [
    { item: 'oak_sapling', count: 1, chance: 0.05 },
    { item: 'apple', count: 1, chance: 0.005 },
  ],
  // Phase 21: shears harvest the leaf block itself (vanilla).
  shearDrops: [{ item: 'oak_leaves', count: 1 }],
});
register(BLOCK.WATER, 'water', 'Water', {
  faces: { all: TILE.WATER_STILL }, solid: false, transparent: true, opacity: 1,
  fluid: true, drops: [],
});
register(BLOCK.LAVA, 'lava', 'Lava', {
  faces: { all: TILE.LAVA_STILL }, solid: false, fluid: true,
  damagesOnContact: true, light: 15, drops: [],
});
register(BLOCK.COAL_ORE, 'coal_ore', 'Coal Ore', {
  faces: { all: TILE.COAL_ORE }, hardness: 3.0, tool: 'pickaxe', minTier: 'wood',
  drops: [{ item: 'coal', count: 1 }],
});
register(BLOCK.IRON_ORE, 'iron_ore', 'Iron Ore', {
  faces: { all: TILE.IRON_ORE }, hardness: 3.0, tool: 'pickaxe', minTier: 'stone',
  drops: [{ item: 'raw_iron', count: 1 }],
});
register(BLOCK.GOLD_ORE, 'gold_ore', 'Gold Ore', {
  faces: { all: TILE.GOLD_ORE }, hardness: 3.0, tool: 'pickaxe', minTier: 'iron',
  drops: [{ item: 'raw_gold', count: 1 }],
});
register(BLOCK.REDSTONE_ORE, 'redstone_ore', 'Redstone Ore', {
  faces: { all: TILE.REDSTONE_ORE }, hardness: 3.0, tool: 'pickaxe', minTier: 'iron',
  drops: [{ item: 'redstone', count: [4, 5] }],
});
register(BLOCK.DIAMOND_ORE, 'diamond_ore', 'Diamond Ore', {
  faces: { all: TILE.DIAMOND_ORE }, hardness: 3.0, tool: 'pickaxe', minTier: 'iron',
  drops: [{ item: 'diamond', count: 1 }],
});
register(BLOCK.OBSIDIAN, 'obsidian', 'Obsidian', {
  faces: { all: TILE.OBSIDIAN }, hardness: 50.0, tool: 'pickaxe', minTier: 'diamond',
});
register(BLOCK.BEDROCK, 'bedrock', 'Bedrock', {
  faces: { all: TILE.BEDROCK }, hardness: Infinity, drops: [],
});
register(BLOCK.CRAFTING_TABLE, 'crafting_table', 'Crafting Table', {
  faces: {
    top: TILE.CRAFTING_TABLE_TOP, bottom: TILE.OAK_PLANKS,
    pz: TILE.CRAFTING_TABLE_FRONT, nz: TILE.CRAFTING_TABLE_FRONT,
    px: TILE.CRAFTING_TABLE_SIDE, nx: TILE.CRAFTING_TABLE_SIDE,
  },
  hardness: 2.5, tool: 'axe',
});
// Furnace family (Phase 10): one block per facing, unlit and lit. The base
// 'furnace' id is what crafting yields and every variant drops; placement
// (player/interaction.js via placementVariant) picks the facing toward the
// player, and systems/smelting.js swaps lit <-> unlit in place while
// burning. The lit front tile glows and the block emits light 13 (vanilla).
function registerFurnace(id, name, facingFace, lit) {
  const faces = {
    top: TILE.FURNACE_TOP, bottom: TILE.FURNACE_TOP,
    px: TILE.FURNACE_SIDE, nx: TILE.FURNACE_SIDE,
    pz: TILE.FURNACE_SIDE, nz: TILE.FURNACE_SIDE,
  };
  faces[facingFace] = lit ? TILE.FURNACE_FRONT_ON : TILE.FURNACE_FRONT;
  register(id, name, 'Furnace', {
    faces, hardness: 3.5, tool: 'pickaxe', minTier: 'wood',
    drops: [{ item: 'furnace', count: 1 }],
    light: lit ? 13 : 0,
  });
}
registerFurnace(BLOCK.FURNACE, 'furnace', 'pz', false);
registerFurnace(BLOCK.FURNACE_N, 'furnace_n', 'nz', false);
registerFurnace(BLOCK.FURNACE_E, 'furnace_e', 'px', false);
registerFurnace(BLOCK.FURNACE_W, 'furnace_w', 'nx', false);
registerFurnace(BLOCK.FURNACE_LIT_S, 'furnace_lit_s', 'pz', true);
registerFurnace(BLOCK.FURNACE_LIT_N, 'furnace_lit_n', 'nz', true);
registerFurnace(BLOCK.FURNACE_LIT_E, 'furnace_lit_e', 'px', true);
registerFurnace(BLOCK.FURNACE_LIT_W, 'furnace_lit_w', 'nx', true);
// The chest renders as a 14/16 box model from assets/entity/chest_normal.png
// (world/chests.js), not as atlas cube faces: tiles stay null so the chunk
// mesher emits nothing, `transparent` so neighbouring blocks still draw
// their faces against the gap around the box, `solid` for a full collision
// cell, opacity 0 so light passes (vanilla — chests don't block light).
register(BLOCK.CHEST, 'chest', 'Chest', {
  faces: null, hardness: 2.5, tool: 'axe', special: 'chest',
  transparent: true, opacity: 0,
});
// Torches render as a small box model in the mesher (2px-wide, 10px-tall
// post; wall variants tilt out of their wall), not as cube faces — tiles
// stay null so the generic face emitter skips them and world/chunks.js
// special-cases `special: 'torch'` ids instead. Item visuals (icon, drop,
// hand) use the flat TORCH atlas tile as a sprite, like vanilla.
register(BLOCK.TORCH, 'torch', 'Torch', {
  faces: null, hardness: 0, solid: false, transparent: true,
  light: 14, special: 'torch',
});
function registerWallTorch(id, name) {
  register(id, name, 'Torch', {
    faces: null, hardness: 0, solid: false, transparent: true,
    light: 14, special: 'torch', drops: [{ item: 'torch', count: 1 }],
  });
}
registerWallTorch(BLOCK.TORCH_WALL_S, 'torch_wall_s');
registerWallTorch(BLOCK.TORCH_WALL_N, 'torch_wall_n');
registerWallTorch(BLOCK.TORCH_WALL_E, 'torch_wall_e');
registerWallTorch(BLOCK.TORCH_WALL_W, 'torch_wall_w');
// Flowing lava (Phase 12): partial-height animated cells the mesher renders
// through its own emitter (faces: null keeps the generic cube emitter away).
// `transparent` so neighbouring blocks still draw their faces behind the
// partial volume; opacity 15 like the source (lava blocks light — and emits
// 15 anyway). Never a minable target (hardness null), never drops.
function registerLavaFlow(id, name) {
  register(id, name, 'Lava', {
    faces: null, solid: false, transparent: true, opacity: 15,
    fluid: true, damagesOnContact: true, light: 15, drops: [],
    special: 'lava_flow',
  });
}
registerLavaFlow(BLOCK.LAVA_FLOW_1, 'lava_flow_1');
registerLavaFlow(BLOCK.LAVA_FLOW_2, 'lava_flow_2');
registerLavaFlow(BLOCK.LAVA_FLOW_3, 'lava_flow_3');
registerLavaFlow(BLOCK.LAVA_FALL, 'lava_fall');
register(BLOCK.CACTUS, 'cactus', 'Cactus', {
  faces: { top: TILE.CACTUS_TOP, bottom: TILE.CACTUS_TOP, side: TILE.CACTUS_SIDE },
  hardness: 0.4, transparent: true, damagesOnContact: true, special: 'cactus',
  selfCull: false, inset: SHAPES.CACTUS_INSET,
});
register(BLOCK.SANDSTONE, 'sandstone', 'Sandstone', {
  faces: { top: TILE.SANDSTONE_TOP, bottom: TILE.SANDSTONE_TOP, side: TILE.SANDSTONE },
  hardness: 0.8, tool: 'pickaxe', minTier: 'wood',
});
register(BLOCK.GLASS, 'glass', 'Glass', {
  faces: { all: TILE.GLASS }, hardness: 0.3, transparent: true, drops: [],
});

// ---------------------------------------------------------------------------
// Nether
// ---------------------------------------------------------------------------

register(BLOCK.NETHERRACK, 'netherrack', 'Netherrack', {
  faces: { all: TILE.NETHERRACK }, hardness: 0.4, tool: 'pickaxe', minTier: 'wood',
});
register(BLOCK.SOUL_SAND, 'soul_sand', 'Soul Sand', {
  faces: { all: TILE.SOUL_SAND }, hardness: 0.5, tool: 'shovel', slows: true,
});
register(BLOCK.NETHER_BRICKS, 'nether_bricks', 'Nether Bricks', {
  faces: { all: TILE.NETHER_BRICKS }, hardness: 2.0, tool: 'pickaxe', minTier: 'wood',
});
register(BLOCK.GLOWSTONE, 'glowstone', 'Glowstone', {
  faces: { all: TILE.GLOWSTONE }, hardness: 0.3, light: 15,
  drops: [{ item: 'glowstone_dust', count: [2, 4] }],
});
register(BLOCK.NETHER_QUARTZ_ORE, 'nether_quartz_ore', 'Nether Quartz Ore', {
  faces: { all: TILE.NETHER_QUARTZ_ORE }, hardness: 3.0, tool: 'pickaxe', minTier: 'wood',
  drops: [{ item: 'quartz', count: 1 }],
});
register(BLOCK.NETHER_PORTAL, 'nether_portal', 'Nether Portal', {
  faces: null, solid: false, transparent: true, light: 11,
  drops: [], special: 'nether_portal',
});
// Nether wart (Phase 17): a walk-through crop on soul sand, instant-break
// with any tool. The mesher renders the vanilla crop shape from the
// NETHER_WART tile (`special: 'wart'`; faces stay null so the generic cube
// emitter skips it). Only the grown stage pays out; younger stages return
// the one wart that was planted.
function registerWart(id, name, drops) {
  register(id, name, 'Nether Wart', {
    faces: null, hardness: 0, solid: false, transparent: true,
    special: 'wart', drops,
  });
}
registerWart(BLOCK.NETHER_WART_0, 'nether_wart_0', [{ item: 'nether_wart', count: 1 }]);
registerWart(BLOCK.NETHER_WART_1, 'nether_wart_1', [{ item: 'nether_wart', count: 1 }]);
registerWart(BLOCK.NETHER_WART_2, 'nether_wart_2', [{ item: 'nether_wart', count: [2, 4] }]);

// ---------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------

register(BLOCK.END_STONE, 'end_stone', 'End Stone', {
  faces: { all: TILE.END_STONE }, hardness: 3.0, tool: 'pickaxe', minTier: 'wood',
});
// End portal frames render as the vanilla 13/16-tall box (the emitter in
// world/emitters.js; faces stay null so the cube emitter skips them), so
// they're `transparent` for culling while still absorbing light (opacity
// 15) and carrying a full collision cell. Unbreakable, like vanilla. The
// EYE variant adds the small raised eye box (atlas tile 58) and a soft glow.
register(BLOCK.END_PORTAL_FRAME, 'end_portal_frame', 'End Portal Frame', {
  faces: null, hardness: Infinity, drops: [], special: 'end_portal_frame',
  transparent: true, opacity: 15,
});
register(BLOCK.END_PORTAL_FRAME_EYE, 'end_portal_frame_eye', 'End Portal Frame', {
  faces: null, hardness: Infinity, drops: [], special: 'end_portal_frame',
  transparent: true, opacity: 15, light: 3,
});
register(BLOCK.END_PORTAL, 'end_portal', 'End Portal', {
  faces: null, solid: false, transparent: true, light: 15,
  drops: [], special: 'end_portal',
});

// ---------------------------------------------------------------------------
// Structure / decorative blocks the later phases need (stronghold, drops)
// ---------------------------------------------------------------------------

register(BLOCK.STONE_BRICKS, 'stone_bricks', 'Stone Bricks', {
  faces: { all: TILE.STONE_BRICKS }, hardness: 1.5, tool: 'pickaxe', minTier: 'wood',
});
register(BLOCK.MOSSY_STONE_BRICKS, 'mossy_stone_bricks', 'Mossy Stone Bricks', {
  faces: { all: TILE.MOSSY_STONE_BRICKS }, hardness: 1.5, tool: 'pickaxe', minTier: 'wood',
});
register(BLOCK.CRACKED_STONE_BRICKS, 'cracked_stone_bricks', 'Cracked Stone Bricks', {
  faces: { all: TILE.CRACKED_STONE_BRICKS }, hardness: 1.5, tool: 'pickaxe', minTier: 'wood',
});
register(BLOCK.BOOKSHELF, 'bookshelf', 'Bookshelf', {
  faces: { top: TILE.OAK_PLANKS, bottom: TILE.OAK_PLANKS, side: TILE.BOOKSHELF },
  hardness: 1.5, tool: 'axe', drops: [{ item: 'book', count: 3 }],
});
// Iron bars render as thin panes connecting to solid neighbours (Phase 19
// emitter — faces null keeps the cube emitter away); the item shows the
// flat atlas tile (entities/items.js ATLAS_SPRITE_ITEMS, the torch rule).
// Collision stays the full cell, an accepted simplification.
register(BLOCK.IRON_BARS, 'iron_bars', 'Iron Bars', {
  faces: null, hardness: 5.0, tool: 'pickaxe', minTier: 'wood',
  transparent: true, special: 'bars',
});
register(BLOCK.SPAWNER, 'spawner', 'Monster Spawner', {
  faces: { all: TILE.SPAWNER }, hardness: 5.0, tool: 'pickaxe', minTier: 'wood',
  transparent: true, drops: [],
});
// The brewing stand renders as its real box model (Phase 19 — base plate,
// rod, three bottle arms; world/emitters.js): faces null keeps the cube
// emitter away, opacity 0 lets light pass. Item visuals fall back to the
// shipped assets/items/brewing_stand.png sprite.
register(BLOCK.BREWING_STAND, 'brewing_stand', 'Brewing Stand', {
  faces: null, hardness: 0.5, tool: 'pickaxe', minTier: 'wood',
  transparent: true, opacity: 0, special: 'brewing_stand', light: 1,
});
register(BLOCK.WHITE_WOOL, 'white_wool', 'White Wool', {
  faces: { all: TILE.WHITE_WOOL }, hardness: 0.8,
});
register(BLOCK.IRON_BLOCK, 'iron_block', 'Block of Iron', {
  faces: { all: TILE.IRON_BLOCK }, hardness: 5.0, tool: 'pickaxe', minTier: 'stone',
});
register(BLOCK.GOLD_BLOCK, 'gold_block', 'Block of Gold', {
  faces: { all: TILE.GOLD_BLOCK }, hardness: 3.0, tool: 'pickaxe', minTier: 'iron',
});
register(BLOCK.DIAMOND_BLOCK, 'diamond_block', 'Block of Diamond', {
  faces: { all: TILE.DIAMOND_BLOCK }, hardness: 5.0, tool: 'pickaxe', minTier: 'iron',
});
register(BLOCK.COAL_BLOCK, 'coal_block', 'Block of Coal', {
  faces: { all: TILE.COAL_BLOCK }, hardness: 5.0, tool: 'pickaxe', minTier: 'wood',
});
register(BLOCK.GRANITE, 'granite', 'Granite', {
  faces: { all: TILE.GRANITE }, hardness: 1.5, tool: 'pickaxe', minTier: 'wood',
});
register(BLOCK.DIORITE, 'diorite', 'Diorite', {
  faces: { all: TILE.DIORITE }, hardness: 1.5, tool: 'pickaxe', minTier: 'wood',
});
register(BLOCK.ANDESITE, 'andesite', 'Andesite', {
  faces: { all: TILE.ANDESITE }, hardness: 1.5, tool: 'pickaxe', minTier: 'wood',
});

// ---------------------------------------------------------------------------
// Phase 23 — deepslate. The stone of the deep: same role as stone, twice the
// hardness (SPEC's stone is 1.5, vanilla's deepslate is 3.0), dropping
// cobbled deepslate exactly as stone drops cobblestone. Its five ores are the
// deepslate variants of the SPEC ore table — same tool tier and same drops as
// their stone twins, just tougher rock around them (vanilla 4.5).
// world/terrain.js decides where deepslate replaces stone; world/caves.js
// picks the matching ore variant per vein cell.
// ---------------------------------------------------------------------------

register(BLOCK.DEEPSLATE, 'deepslate', 'Deepslate', {
  faces: { all: TILE.DEEPSLATE }, hardness: 3.0, tool: 'pickaxe', minTier: 'wood',
  drops: [{ item: 'cobbled_deepslate', count: 1 }],
});
register(BLOCK.COBBLED_DEEPSLATE, 'cobbled_deepslate', 'Cobbled Deepslate', {
  faces: { all: TILE.COBBLED_DEEPSLATE }, hardness: 3.5, tool: 'pickaxe',
  minTier: 'wood',
});
register(BLOCK.DEEPSLATE_COAL_ORE, 'deepslate_coal_ore', 'Deepslate Coal Ore', {
  faces: { all: TILE.DEEPSLATE_COAL_ORE }, hardness: 4.5, tool: 'pickaxe',
  minTier: 'wood', drops: [{ item: 'coal', count: 1 }],
});
register(BLOCK.DEEPSLATE_IRON_ORE, 'deepslate_iron_ore', 'Deepslate Iron Ore', {
  faces: { all: TILE.DEEPSLATE_IRON_ORE }, hardness: 4.5, tool: 'pickaxe',
  minTier: 'stone', drops: [{ item: 'raw_iron', count: 1 }],
});
register(BLOCK.DEEPSLATE_GOLD_ORE, 'deepslate_gold_ore', 'Deepslate Gold Ore', {
  faces: { all: TILE.DEEPSLATE_GOLD_ORE }, hardness: 4.5, tool: 'pickaxe',
  minTier: 'iron', drops: [{ item: 'raw_gold', count: 1 }],
});
register(BLOCK.DEEPSLATE_REDSTONE_ORE, 'deepslate_redstone_ore', 'Deepslate Redstone Ore', {
  faces: { all: TILE.DEEPSLATE_REDSTONE_ORE }, hardness: 4.5, tool: 'pickaxe',
  minTier: 'iron', drops: [{ item: 'redstone', count: [4, 5] }],
});
register(BLOCK.DEEPSLATE_DIAMOND_ORE, 'deepslate_diamond_ore', 'Deepslate Diamond Ore', {
  faces: { all: TILE.DEEPSLATE_DIAMOND_ORE }, hardness: 4.5, tool: 'pickaxe',
  minTier: 'iron', drops: [{ item: 'diamond', count: 1 }],
});

// Clay (Phase 23): the soft grey-blue bank that forms where underground
// water pools. Shovel material, drops itself. Its atlas tile is generated at
// load time (render/atlas.js) — the shipped atlas has no clay texture.
register(BLOCK.CLAY, 'clay', 'Clay', {
  faces: { all: TILE.CLAY }, hardness: 0.6, tool: 'shovel',
});

// ---------------------------------------------------------------------------
// Phase 21 — flowing water (world/fluids.js). The mirror of the lava family:
// faces null keeps the cube emitter away (the fluid emitter renders the
// partial-height cell), transparent for culling, opacity 1 like the source
// so depth still darkens, never targetable, never scoopable.
// ---------------------------------------------------------------------------

function registerWaterFlow(id, name) {
  register(id, name, 'Water', {
    faces: null, solid: false, transparent: true, opacity: 1,
    fluid: true, drops: [], special: 'water_flow',
  });
}
registerWaterFlow(BLOCK.WATER_FLOW_1, 'water_flow_1');
registerWaterFlow(BLOCK.WATER_FLOW_2, 'water_flow_2');
registerWaterFlow(BLOCK.WATER_FLOW_3, 'water_flow_3');
registerWaterFlow(BLOCK.WATER_FLOW_4, 'water_flow_4');
registerWaterFlow(BLOCK.WATER_FLOW_5, 'water_flow_5');
registerWaterFlow(BLOCK.WATER_FLOW_6, 'water_flow_6');
registerWaterFlow(BLOCK.WATER_FLOW_7, 'water_flow_7');
registerWaterFlow(BLOCK.WATER_FALL, 'water_fall');

// Phase 21 building blocks (world/shapes.js) — registered here so their ids
// keep their place in the one registration order.
registerBuildingBlocks(register, BLOCK);

// Phase 24 ground plants (world/plants.js) — same pattern.
registerPlants(register, BLOCK);

Object.freeze(BLOCKS);
Object.freeze(BLOCK);

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

// The Phase 21 shape tables (world/shapes.js): the ONE box list the mesher
// renders and the collision sweep reads, plus every family lookup the
// placement and use paths need. Re-exported from here so callers keep
// importing block data from the block registry.
export const {
  SHAPE_BOXES, COLLISION_BOXES, FLUSH_RECTS, MAX_BOX_TOP, HAS_SHAPE,
  MAX_COLLISION_OVERHANG, shapeBoxesAt, collisionBoxesAt, hasCollision,
  isClimbable,
  STAIRS_BY_MATERIAL, SLAB_FAMILIES, SIGN_IDS, ITEM_FRAME_IDS,
  STAIRS_ITEM_IDS, SLAB_ITEM_FAMILIES, SLAB_FAMILY_OF, GATE_AXIS,
  GATE_TOGGLE, DOOR_INFO, DOOR_TOGGLE, DOOR_LOWER_BY_FACING,
  DOOR_UPPER_BY_FACING, isDoor, TRAPDOOR_TOGGLE, TRAPDOOR_BY_FACING,
  isTrapdoor, LADDER_BY_FACING, BED_INFO, BED_FOOT_BY_FACING,
  BED_HEAD_BY_FACING, isBed, FACING_DELTA, isSign, isItemFrame,
  WALL_MOUNT_FACING,
} = buildShapeTables({ BLOCKS, BLOCK, blockDef, FACE_ORDER, resolveFaceTile });

const AIR_DEF = BLOCKS[BLOCK.AIR];
const ID_BY_NAME = new Map(BLOCKS.map((def) => [def.name, def.id]));
// Phase 21: item names for the multi-variant families resolve to their base
// variant; placementVariant picks the real one from the click. (Stairs,
// gates, ladders, doors, trapdoors, beds, signs and frames all ship as ONE
// item.)
for (const [item, id] of [
  ['cobblestone_stairs', BLOCK.COBBLESTONE_STAIRS_N],
  ['oak_stairs', BLOCK.OAK_STAIRS_N],
  ['stone_brick_stairs', BLOCK.STONE_BRICK_STAIRS_N],
  ['sandstone_stairs', BLOCK.SANDSTONE_STAIRS_N],
  ['nether_brick_stairs', BLOCK.NETHER_BRICK_STAIRS_N],
  ['oak_fence_gate', BLOCK.OAK_FENCE_GATE_X],
  ['ladder', BLOCK.LADDER_N],
  ['oak_door', BLOCK.OAK_DOOR_LOWER_N],
  ['oak_trapdoor', BLOCK.OAK_TRAPDOOR_N],
  ['bed', BLOCK.BED_FOOT_N],
  ['sign', BLOCK.SIGN_N],
  ['item_frame', BLOCK.ITEM_FRAME_N],
]) {
  ID_BY_NAME.set(item, id);
}

export function blockDef(id) {
  return BLOCKS[id] ?? AIR_DEF;
}

// Block id for a registry name ('dirt' -> BLOCK.DIRT), or null when the name
// is not a block (item-only drops like 'coal').
export function blockIdByName(name) {
  return ID_BY_NAME.get(name) ?? null;
}

export function isSolid(id) {
  return blockDef(id).solid;
}

export function isTransparent(id) {
  return blockDef(id).transparent;
}

export function lightLevel(id) {
  return blockDef(id).light;
}

// Light levels absorbed per block during propagation (0 = passes freely,
// 15 = fully blocks).
export function lightOpacity(id) {
  return blockDef(id).opacity;
}

// Face tiles in BoxGeometry order [px, nx, py, ny, pz, nz]; null for
// blocks without a cube texture.
export function faceTiles(id) {
  return blockDef(id).tiles;
}

// ---------------------------------------------------------------------------
// Fluid families (Phase 23 — the mandated cut to world/fluid_families.js)
// ---------------------------------------------------------------------------
//
// The lava and water id tables, their predicates and fluidHeight moved out
// verbatim; every one of them is re-exported here, so `import { isWater } from
// './blocks.js'` keeps working exactly as it did. The builder takes BLOCK and
// BLOCKS as arguments the way world/shapes.js takes `register`, which is what
// keeps the pair cycle-free.

export const {
  LAVA_LEVEL_OF, isLava, isLavaSource, lavaFlowLevel,
  WATER_LEVEL_OF, WATER_FLOW_BY_LEVEL, isWater, isWaterSource, waterFlowLevel,
  fluidHeight,
} = buildFluidFamilies(BLOCK, BLOCKS);

// ---------------------------------------------------------------------------
// Furnace family + oriented placement (Phase 10)
// ---------------------------------------------------------------------------

// facing -> { unlit, lit } block ids. 'S' fronts +z, 'N' -z, 'E' +x, 'W' -x.
const FURNACE_BY_FACING = {
  S: { unlit: BLOCK.FURNACE, lit: BLOCK.FURNACE_LIT_S },
  N: { unlit: BLOCK.FURNACE_N, lit: BLOCK.FURNACE_LIT_N },
  E: { unlit: BLOCK.FURNACE_E, lit: BLOCK.FURNACE_LIT_E },
  W: { unlit: BLOCK.FURNACE_W, lit: BLOCK.FURNACE_LIT_W },
};
const FURNACE_LIT_OF = new Map();
const FURNACE_UNLIT_OF = new Map();
const FURNACE_IDS = new Set();
for (const { unlit, lit } of Object.values(FURNACE_BY_FACING)) {
  FURNACE_LIT_OF.set(unlit, lit);
  FURNACE_LIT_OF.set(lit, lit);
  FURNACE_UNLIT_OF.set(lit, unlit);
  FURNACE_UNLIT_OF.set(unlit, unlit);
  FURNACE_IDS.add(unlit);
  FURNACE_IDS.add(lit);
}

export function isFurnace(id) {
  return FURNACE_IDS.has(id);
}

export function furnaceLitVariant(id) {
  return FURNACE_LIT_OF.get(id) ?? id;
}

export function furnaceUnlitVariant(id) {
  return FURNACE_UNLIT_OF.get(id) ?? id;
}

// Cardinal facing from a block cell toward a viewer position ('S' = the
// front should face +z). Used for furnace placement and the chest model.
export function facingToward(cell, pos) {
  const dx = pos.x - (cell.x + 0.5);
  const dz = pos.z - (cell.z + 0.5);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'E' : 'W';
  return dz > 0 ? 'S' : 'N';
}

// ---------------------------------------------------------------------------
// Torch family (Phase 11)
// ---------------------------------------------------------------------------

// Per-torch-id lean direction: floor torches [0, 0], wall torches the unit
// horizontal direction they lean (out of the wall they attach to). The
// mesher builds the box model from this; undefined = not a torch.
export const TORCH_LEAN = {
  [BLOCK.TORCH]: [0, 0],
  [BLOCK.TORCH_WALL_S]: [0, 1],
  [BLOCK.TORCH_WALL_N]: [0, -1],
  [BLOCK.TORCH_WALL_E]: [1, 0],
  [BLOCK.TORCH_WALL_W]: [-1, 0],
};
const TORCH_WALL_BY_FACE = {
  '0,1': BLOCK.TORCH_WALL_S,
  '0,-1': BLOCK.TORCH_WALL_N,
  '1,0': BLOCK.TORCH_WALL_E,
  '-1,0': BLOCK.TORCH_WALL_W,
};

export function isTorch(id) {
  return TORCH_LEAN[id] !== undefined;
}

// The cell a torch needs solid support in: below a floor torch, behind a
// wall torch. Returns { x, y, z } or null for non-torch ids.
export function torchSupportCell(id, x, y, z) {
  const lean = TORCH_LEAN[id];
  if (!lean) return null;
  if (lean[0] === 0 && lean[1] === 0) return { x, y: y - 1, z };
  return { x: x - lean[0], y, z: z - lean[1] };
}

// ---------------------------------------------------------------------------
// Nether wart family (Phase 17)
// ---------------------------------------------------------------------------

// Growth stage per wart block id (0 freshly planted .. 2 fully grown);
// undefined = not a wart. world/wart.js advances stages, the mesher's wart
// emitter reads the stage for the crop height.
export const WART_STAGE = {
  [BLOCK.NETHER_WART_0]: 0,
  [BLOCK.NETHER_WART_1]: 1,
  [BLOCK.NETHER_WART_2]: 2,
};
export const WART_STAGE_BLOCKS = [
  BLOCK.NETHER_WART_0, BLOCK.NETHER_WART_1, BLOCK.NETHER_WART_2,
];

export function isWart(id) {
  return WART_STAGE[id] !== undefined;
}

// Items that plant a block on a specific soil when right-clicked onto its
// top face (player/interaction.js consults this in the placement path —
// and in the active-hand gate, so a plantable item counts as having a use).
export const PLANTABLE = {
  nether_wart: { block: BLOCK.NETHER_WART_0, soil: BLOCK.SOUL_SAND },
};

// The id actually placed for a selected block item: oriented blocks
// (furnace) turn their front toward the player; torches become the wall
// variant leaning out of the clicked face (null = this face can't hold the
// block — torches never hang from ceilings); everything else places as-is.
// `cell` is the target cell, `pos` the player's feet position, `face` the
// clicked face normal [fx, fy, fz] (optional — callers that can't know it
// get the floor/default variant).
export function placementVariant(id, cell, pos, face) {
  if (id === BLOCK.FURNACE) {
    return FURNACE_BY_FACING[facingToward(cell, pos)].unlit;
  }
  if (id === BLOCK.TORCH && face) {
    const [fx, fy, fz] = face;
    if (fy === 1) return BLOCK.TORCH;
    if (fy === -1) return null; // no torches on ceilings
    return TORCH_WALL_BY_FACE[`${fx},${fz}`] ?? BLOCK.TORCH;
  }
  // --- Phase 21 oriented shapes -------------------------------------------
  const toward = facingToward(cell, pos);      // from the block to the player
  const away = OPPOSITE[toward];               // the way the player looks
  const faceFacing = face ? FACE_TO_FACING[`${face[0]},${face[2]}`] ?? null : null;

  const stairFamily = STAIRS_FAMILY_OF[id];
  if (stairFamily) return stairFamily[FACING_INDEX[away]];

  const slab = SLAB_FAMILY_OF[id];
  if (slab) {
    if (face && face[1] === -1) return slab.top; // clicked a ceiling
    return slab.bottom;
  }
  if (GATE_AXIS[id] !== undefined) {
    // The panel spans across the way the player is walking, so they open it
    // to pass through.
    return (toward === 'E' || toward === 'W')
      ? BLOCK.OAK_FENCE_GATE_Z : BLOCK.OAK_FENCE_GATE_X;
  }
  if (LADDER_FACING_OF[id] !== undefined) {
    if (!faceFacing) return null;              // ladders only hang on walls
    return LADDER_BY_FACING[faceFacing];
  }
  if (DOOR_INFO[id]) return DOOR_LOWER_BY_FACING[FACING_INDEX[toward]];
  if (isTrapdoor(id)) return TRAPDOOR_BY_FACING[FACING_INDEX[toward]];
  if (isBed(id)) return BED_FOOT_BY_FACING[FACING_INDEX[away]];
  if (isSign(id)) {
    if (faceFacing) return SIGN_IDS.wall[FACING_INDEX[faceFacing]];
    if (face && face[1] === 1) return SIGN_IDS.stand[FACING_INDEX[toward]];
    return null;                               // never hangs from a ceiling
  }
  if (isItemFrame(id)) {
    if (!faceFacing) return null;
    return ITEM_FRAME_IDS[FACING_INDEX[faceFacing]];
  }
  return id;
}

// Facing letters in the order every family table uses, and their opposites.
const FACING_INDEX = { N: 0, S: 1, E: 2, W: 3 };
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

// Horizontal face normal -> facing letter (the outward direction).
const FACE_TO_FACING = {
  '0,1': 'S', '0,-1': 'N', '1,0': 'E', '-1,0': 'W',
};

// stairs id -> its family's 4 ids; ladder id -> its facing.
const STAIRS_FAMILY_OF = new Array(BLOCKS.length).fill(null);
for (const ids of Object.values(STAIRS_BY_MATERIAL)) {
  for (const id of ids) STAIRS_FAMILY_OF[id] = ids;
}
export function isStairs(id) {
  return STAIRS_FAMILY_OF[id] !== null;
}
const LADDER_FACING_OF = {};
for (const [facing, id] of Object.entries(LADDER_BY_FACING)) {
  LADDER_FACING_OF[id] = facing;
}
