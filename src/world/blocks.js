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
register(BLOCK.FURNACE, 'furnace', 'Furnace', {
  faces: {
    top: TILE.FURNACE_TOP, bottom: TILE.FURNACE_TOP,
    pz: TILE.FURNACE_FRONT, nz: TILE.FURNACE_SIDE,
    px: TILE.FURNACE_SIDE, nx: TILE.FURNACE_SIDE,
  },
  hardness: 3.5, tool: 'pickaxe', minTier: 'wood',
});
// The atlas has no chest tile (chests use assets/entity/chest_normal.png);
// planks faces are a safe cube fallback until the entity-style renderer.
register(BLOCK.CHEST, 'chest', 'Chest', {
  faces: { all: TILE.OAK_PLANKS }, hardness: 2.5, tool: 'axe', special: 'chest',
});
register(BLOCK.TORCH, 'torch', 'Torch', {
  faces: { all: TILE.TORCH }, hardness: 0, solid: false, transparent: true,
  light: 14, special: 'torch',
});
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
