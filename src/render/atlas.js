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
  // Phase 23: the deepslate set the new atlas appends (docs/ATLAS_MAP.md
  // 58-64). These are REAL tiles in the PNG.
  DEEPSLATE: 58,
  COBBLED_DEEPSLATE: 59,
  DEEPSLATE_COAL_ORE: 60,
  DEEPSLATE_IRON_ORE: 61,
  DEEPSLATE_GOLD_ORE: 62,
  DEEPSLATE_REDSTONE_ORE: 63,
  DEEPSLATE_DIAMOND_ORE: 64,
  // Phase 24: the ground plants (docs/ATLAS_MAP.md 65-68). Real cutout
  // tiles in the PNG, rendered as cross-planes by the mesher.
  SHORT_GRASS: 65,
  DANDELION: 66,
  POPPY: 67,
  DEAD_BUSH: 68,
  // Generated tiles — painted into the free tail of the atlas at load time
  // (see GENERATED_TILES below), never shipped in the PNG. Index 58 used to
  // hold the frame-with-eye art; the Phase 23 atlas overwrote it with
  // deepslate, so the eye moved here rather than renumbering anything.
  END_PORTAL_FRAME_EYE: 69,
  CLAY: 70,
};

let atlasTexture = null;

// ---------------------------------------------------------------------------
// Generated tiles
// ---------------------------------------------------------------------------
// The established generated-art pattern (render/item_art.js) applied to the
// block atlas: art this project ships no texture for is painted into free
// tile slots on the loaded image, so every consumer — the chunk mesher, the
// HUD, item icons, particles — keeps sampling ONE atlas by tile index and
// none of them needs to know the difference.

// A tiny deterministic hash so generated art is identical every load.
function gnoise(x, y, salt) {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ salt) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// The end portal frame seen from above with an eye of ender seated in it:
// the frame top art (tile 40) with the eye's green-black orb over the middle.
function paintEndFrameEye(ctx, dx, dy, P) {
  const src = TILE.END_PORTAL_FRAME_TOP;
  ctx.drawImage(
    ctx.canvas,
    (src % ATLAS.TILES_PER_ROW) * P, Math.floor(src / ATLAS.TILES_PER_ROW) * P, P, P,
    dx, dy, P, P,
  );
  const c = P / 2;
  const r = P * 0.32;
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / r;
      if (d > 1) continue;
      const n = gnoise(x, y, 0x0e7e);
      // A dark rim falling to a bright green-teal core, mottled like the eye.
      const t = Math.max(0, 1 - d * d) * (0.75 + n * 0.5);
      const rr = Math.round(10 + 30 * t);
      const gg = Math.round(18 + 170 * t);
      const bb = Math.round(22 + 120 * t);
      ctx.fillStyle = `rgb(${rr}, ${gg}, ${bb})`;
      ctx.fillRect(dx + x, dy + y, 1, 1);
    }
  }
}

// Clay: the pale blue-grey speckle of a vanilla clay block. Phase 23 adds
// clay patches to cave floors near water and the atlas ships no clay tile.
function paintClay(ctx, dx, dy, P) {
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      // Two hash octaves: coarse 4x4 blotches under fine per-pixel grain.
      const blotch = gnoise(x >> 2, y >> 2, 0xc1a4);
      const grain = gnoise(x, y, 0xc1a5);
      const v = 0.62 * blotch + 0.38 * grain;
      const r = Math.round(150 + v * 22);
      const g = Math.round(155 + v * 22);
      const b = Math.round(168 + v * 20);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(dx + x, dy + y, 1, 1);
    }
  }
}

const GENERATED_TILES = [
  [TILE.END_PORTAL_FRAME_EYE, paintEndFrameEye],
  [TILE.CLAY, paintClay],
];

// Loads assets/block_atlas.png once, paints the generated tiles into it and
// hands back one texture. NearestFilter keeps the pixel-art look; mipmaps are
// disabled so tiles don't blur into each other at distance.
export async function loadAtlas() {
  if (atlasTexture) return atlasTexture;
  const loader = new THREE.TextureLoader();
  const loaded = await loader.loadAsync(ATLAS.PATH);
  const img = loaded.image;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const P = ATLAS.TILE_PIXELS;
  for (const [tile, paint] of GENERATED_TILES) {
    paint(
      ctx,
      (tile % ATLAS.TILES_PER_ROW) * P,
      Math.floor(tile / ATLAS.TILES_PER_ROW) * P,
      P,
    );
  }
  loaded.dispose();
  atlasTexture = new THREE.CanvasTexture(canvas);
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
