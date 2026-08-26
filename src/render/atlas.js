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

// The tile-local mip chain (the "far places look low quality" fix). With no
// mipmaps, Nearest-minified terrain degenerates into shimmering pixel noise
// at distance — every screen pixel lands on one arbitrary texel of a 16px
// tile. The classic reason this project disabled them ("tiles blur into each
// other") only bites when the chain runs PAST tile resolution, so this chain
// STOPS there, exactly like vanilla's 4 mipmap levels: successive 2x2 box
// downsamples from 256x256 to 16x16, where each tile is one pixel. Tile
// boundaries stay 2x2-aligned at every level, so no level ever mixes two
// tiles' texels, and three.js allocates texture storage for exactly these
// levels — sampling can never reach a level that would bleed. RGB averages
// are alpha-weighted so cutout tiles (leaves, plants) keep their edge
// colours instead of ringing dark.
function buildMipChain(base) {
  const levels = [base];
  let src = base.getContext('2d').getImageData(0, 0, base.width, base.height);
  let w = base.width;
  let h = base.height;
  const count = Math.round(Math.log2(ATLAS.TILE_PIXELS)); // 16px tiles -> 4
  for (let level = 0; level < count; level++) {
    const nw = w >> 1;
    const nh = h >> 1;
    const dst = new ImageData(nw, nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const i = ((y * 2 + dy) * w + (x * 2 + dx)) * 4;
            const al = src.data[i + 3];
            r += src.data[i] * al;
            g += src.data[i + 1] * al;
            b += src.data[i + 2] * al;
            a += al;
          }
        }
        const j = (y * nw + x) * 4;
        dst.data[j] = a ? Math.round(r / a) : 0;
        dst.data[j + 1] = a ? Math.round(g / a) : 0;
        dst.data[j + 2] = a ? Math.round(b / a) : 0;
        dst.data[j + 3] = Math.round(a / 4);
      }
    }
    const c = document.createElement('canvas');
    c.width = nw;
    c.height = nh;
    c.getContext('2d').putImageData(dst, 0, 0);
    levels.push(c);
    src = dst;
    w = nw;
    h = nh;
  }
  return levels;
}

// Loads assets/block_atlas.png once, paints the generated tiles into it and
// hands back one texture. NearestFilter magnification keeps the pixel-art
// look up close; minification blends through the tile-local mip chain above
// so distant terrain reads as clean colour instead of noise.
export async function loadAtlas() {
  if (atlasTexture) return atlasTexture;
  const loader = new THREE.TextureLoader();
  const loaded = await loader.loadAsync(ATLAS.PATH);
  const img = loaded.image;
  // 1. The ART canvas — the shipped PNG's own 16px layout, generated tiles
  // painted in exactly as before (their painters use the original grid).
  const art = document.createElement('canvas');
  art.width = img.width;
  art.height = img.height;
  const actx = art.getContext('2d');
  actx.imageSmoothingEnabled = false;
  actx.drawImage(img, 0, 0);
  const P = ATLAS.TILE_PIXELS;
  for (const [tile, paint] of GENERATED_TILES) {
    paint(
      actx,
      (tile % ATLAS.TILES_PER_ROW) * P,
      Math.floor(tile / ATLAS.TILES_PER_ROW) * P,
      P,
    );
  }
  loaded.dispose();
  // 2. The RUNTIME canvas — repacked into CELL_PIXELS cells with
  // PAD_PIXELS gutters of each tile's own replicated edge pixels (see the
  // config note: this is what lets faces sample all 16 texels
  // edge-to-edge with ZERO inset and still never bleed a neighbour tile
  // at any mip level or under anisotropy). Edge strips and corners are
  // 1px source slices stretched across the gutter, smoothing off, which
  // is exact edge replication.
  const cell = ATLAS.CELL_PIXELS;
  const pad = ATLAS.PAD_PIXELS;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS.TILES_PER_ROW * cell;
  canvas.height = ATLAS.TILES_PER_ROW * cell;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let row = 0; row < ATLAS.TILES_PER_ROW; row++) {
    for (let col = 0; col < ATLAS.TILES_PER_ROW; col++) {
      const sx = col * P;
      const sy = row * P;
      const ax = col * cell + pad; // the cell's art origin
      const ay = row * cell + pad;
      ctx.drawImage(art, sx, sy, P, P, ax, ay, P, P);
      // Edges…
      ctx.drawImage(art, sx, sy, 1, P, ax - pad, ay, pad, P);          // left
      ctx.drawImage(art, sx + P - 1, sy, 1, P, ax + P, ay, pad, P);    // right
      ctx.drawImage(art, sx, sy, P, 1, ax, ay - pad, P, pad);          // top
      ctx.drawImage(art, sx, sy + P - 1, P, 1, ax, ay + P, P, pad);    // bottom
      // …and corners.
      ctx.drawImage(art, sx, sy, 1, 1, ax - pad, ay - pad, pad, pad);
      ctx.drawImage(art, sx + P - 1, sy, 1, 1, ax + P, ay - pad, pad, pad);
      ctx.drawImage(art, sx, sy + P - 1, 1, 1, ax - pad, ay + P, pad, pad);
      ctx.drawImage(art, sx + P - 1, sy + P - 1, 1, 1, ax + P, ay + P, pad, pad);
    }
  }
  atlasTexture = new THREE.CanvasTexture(canvas);
  atlasTexture.magFilter = THREE.NearestFilter;
  // Nearest WITHIN a mip level (pixel-art up close), linear BETWEEN levels
  // (no visible band where the terrain switches detail).
  atlasTexture.minFilter = THREE.NearestMipmapLinearFilter;
  atlasTexture.generateMipmaps = false; // the chain is hand-built, and stops
  atlasTexture.mipmaps = buildMipChain(canvas); // at tile resolution
  atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
  atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  return atlasTexture;
}

export function getAtlasTexture() {
  if (!atlasTexture) throw new Error('Atlas not loaded — call loadAtlas() first');
  return atlasTexture;
}

// UV rectangle for a tile's ART region inside the padded runtime atlas, in
// Three.js UV space (v=0 at the bottom of the image, so atlas row 0 maps to
// the top of the v range). The gutters made UV_INSET zero — a face samples
// all 16 texels edge-to-edge, every pixel equal width — but the term stays
// so the knob still exists.
// Returns { u0, v0, u1, v1 }: u0/v0 bottom-left, u1/v1 top-right of the tile.
export function getUV(tileIndex) {
  const n = ATLAS.TILES_PER_ROW;
  const size = n * ATLAS.CELL_PIXELS;
  const inset = ATLAS.UV_INSET;
  const col = tileIndex % n;
  const row = Math.floor(tileIndex / n);
  const x = col * ATLAS.CELL_PIXELS + ATLAS.PAD_PIXELS;
  const y = row * ATLAS.CELL_PIXELS + ATLAS.PAD_PIXELS;
  return {
    u0: x / size + inset,
    v0: 1 - (y + ATLAS.TILE_PIXELS) / size + inset,
    u1: (x + ATLAS.TILE_PIXELS) / size - inset,
    v1: 1 - y / size - inset,
  };
}

// Pixel rectangle of a tile's ART region inside the runtime atlas canvas
// (getAtlasTexture().image) — for the 2D consumers that drawImage from it:
// item icons, the HUD lava overlay, sprite canvases, the fluid-scroll
// textures. They must NOT compute tile*TILE_PIXELS themselves any more:
// the runtime layout is padded.
export function tilePixelRect(tileIndex) {
  const col = tileIndex % ATLAS.TILES_PER_ROW;
  const row = Math.floor(tileIndex / ATLAS.TILES_PER_ROW);
  return {
    x: col * ATLAS.CELL_PIXELS + ATLAS.PAD_PIXELS,
    y: row * ATLAS.CELL_PIXELS + ATLAS.PAD_PIXELS,
    size: ATLAS.TILE_PIXELS,
  };
}
