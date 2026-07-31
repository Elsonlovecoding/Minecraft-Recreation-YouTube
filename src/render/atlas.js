// render/atlas.js — texture atlas loading and UV lookup.
// Tile indices come from docs/ATLAS_MAP.md and are fixed. Never renumber them.

import * as THREE from 'three';
import { ATLAS } from '../config.js';

// Tile registry, index = row * 16 + column (row-major from top-left).
// Mirrors docs/ATLAS_MAP.md exactly.
export const TILE = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  COBBLESTONE: 4,
  SAND: 5,
  GRAVEL: 6,
  OAK_LOG: 7,
  OAK_LOG_TOP: 8,
  OAK_PLANKS: 9,
  OAK_LEAVES: 10,
  WATER_STILL: 11,
  BEDROCK: 12,
  SANDSTONE: 13,
  SANDSTONE_TOP: 14,
  GLASS: 15,
  COAL_ORE: 16,
  IRON_ORE: 17,
  GOLD_ORE: 18,
  REDSTONE_ORE: 19,
  DIAMOND_ORE: 20,
  OBSIDIAN: 21,
  LAVA_STILL: 22,
  CACTUS_SIDE: 23,
  CACTUS_TOP: 24,
  TORCH: 25,
  CRAFTING_TABLE_TOP: 26,
  CRAFTING_TABLE_FRONT: 27,
  CRAFTING_TABLE_SIDE: 28,
  FURNACE_FRONT: 29,
  FURNACE_FRONT_ON: 30,
  FURNACE_SIDE: 31,
  FURNACE_TOP: 32,
  NETHERRACK: 33,
  SOUL_SAND: 34,
  NETHER_BRICKS: 35,
  GLOWSTONE: 36,
  NETHER_QUARTZ_ORE: 37,
  NETHER_WART_STAGE2: 38,
  END_STONE: 39,
  END_PORTAL_FRAME_TOP: 40,
  END_PORTAL_FRAME_SIDE: 41,
  STONE_BRICKS: 42,
  MOSSY_STONE_BRICKS: 43,
  CRACKED_STONE_BRICKS: 44,
  BOOKSHELF: 45,
  IRON_BARS: 46,
  SPAWNER: 47,
  BREWING_STAND: 48,
  WHITE_WOOL: 49,
  FIRE_0: 50,
  GRANITE: 51,
  DIORITE: 52,
  ANDESITE: 53,
  IRON_BLOCK: 54,
  GOLD_BLOCK: 55,
  DIAMOND_BLOCK: 56,
  COAL_BLOCK: 57,
};

let atlasTexture = null;

// Loads assets/block_atlas.png once. NearestFilter keeps the pixel-art look;
// mipmaps are disabled so tiles don't blur into each other at distance.
export async function loadAtlas() {
  if (atlasTexture) return atlasTexture;
  const loader = new THREE.TextureLoader();
  atlasTexture = await loader.loadAsync(ATLAS.PATH);
  atlasTexture.magFilter = THREE.NearestFilter;
  atlasTexture.minFilter = THREE.NearestFilter;
  atlasTexture.generateMipmaps = false;
  atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
  atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  return atlasTexture;
}

export function getAtlasTexture() {
  if (!atlasTexture) throw new Error('Atlas not loaded — call loadAtlas() first');
  return atlasTexture;
}

// UV rectangle for a tile index, in Three.js UV space (v=0 at the bottom of
// the image, so atlas row 0 maps to the top of the v range). A small inset
// keeps samples off tile boundaries where neighbours would bleed.
// Returns { u0, v0, u1, v1 }: u0/v0 bottom-left, u1/v1 top-right of the tile.
export function getUV(tileIndex) {
  const n = ATLAS.TILES_PER_ROW;
  const inset = ATLAS.UV_INSET;
  const col = tileIndex % n;
  const row = Math.floor(tileIndex / n);
  return {
    u0: col / n + inset,
    v0: 1 - (row + 1) / n + inset,
    u1: (col + 1) / n - inset,
    v1: 1 - row / n - inset,
  };
}
