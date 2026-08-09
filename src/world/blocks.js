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
    special = null,
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
    special,
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
register(BLOCK.END_PORTAL_FRAME, 'end_portal_frame', 'End Portal Frame', {
  faces: {
    top: TILE.END_PORTAL_FRAME_TOP, bottom: TILE.END_STONE,
    side: TILE.END_PORTAL_FRAME_SIDE,
  },
  hardness: Infinity, drops: [], special: 'end_portal_frame',
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
register(BLOCK.IRON_BARS, 'iron_bars', 'Iron Bars', {
  faces: { all: TILE.IRON_BARS }, hardness: 5.0, tool: 'pickaxe', minTier: 'wood',
  transparent: true, special: 'bars',
});
register(BLOCK.SPAWNER, 'spawner', 'Monster Spawner', {
  faces: { all: TILE.SPAWNER }, hardness: 5.0, tool: 'pickaxe', minTier: 'wood',
  transparent: true, drops: [],
});
register(BLOCK.BREWING_STAND, 'brewing_stand', 'Brewing Stand', {
  faces: { all: TILE.BREWING_STAND }, hardness: 0.5, tool: 'pickaxe', minTier: 'wood',
  transparent: true, special: 'brewing_stand',
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

Object.freeze(BLOCKS);
Object.freeze(BLOCK);

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const AIR_DEF = BLOCKS[BLOCK.AIR];
const ID_BY_NAME = new Map(BLOCKS.map((def) => [def.name, def.id]));

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
// Lava family (Phase 12 — flowing lava, world/fluids.js)
// ---------------------------------------------------------------------------

// Flow level per lava id: 0 for the source and the falling column (both
// spread at full strength), 1..3 for horizontal flow cells. -1 = not lava.
// Kept as a flat array for the physics/mesher hot loops.
export const LAVA_LEVEL_OF = (() => {
  const table = new Int8Array(BLOCKS.length).fill(-1);
  table[BLOCK.LAVA] = 0;
  table[BLOCK.LAVA_FLOW_1] = 1;
  table[BLOCK.LAVA_FLOW_2] = 2;
  table[BLOCK.LAVA_FLOW_3] = 3;
  table[BLOCK.LAVA_FALL] = 0;
  return table;
})();

// Any lava cell — source, flow or fall (contact damage, fluid physics,
// pathfinding avoidance, item burning all key off this).
export function isLava(id) {
  return LAVA_LEVEL_OF[id] !== undefined && LAVA_LEVEL_OF[id] >= 0;
}

export function isLavaSource(id) {
  return id === BLOCK.LAVA;
}

// Horizontal flow level (1..3) of a flowing cell, or null for anything else
// (including the source and the falling column).
export function lavaFlowLevel(id) {
  const level = LAVA_LEVEL_OF[id];
  return level >= 1 ? level : null;
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
  return id;
}
