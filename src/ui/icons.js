// ui/icons.js — Phase 7: item icons for the HUD hotbar and the inventory
// screen, plus the shared slot-content renderer (icon + count + durability
// bar) both use.
//
// Icons are always the real textures:
//   - non-block items: an <img> straight from assets/items/<name>.png (the
//     shipped Minecraft item textures — never generated or substituted)
//   - block items: a small canvas drawing the block's real atlas tiles as the
//     classic isometric inventory cube (top + two sides, vanilla shading),
//     cached as a data URL per block
//
// Which of the two an item name uses (and the stand-ins for items with no
// shipped texture) comes from entities/items.js `itemVisualInfo`, so a slot
// icon always matches the dropped-item and held-hand visuals.

import { ATLAS, UI } from '../config.js';
import { getAtlasTexture } from '../render/atlas.js';
import { faceTiles } from '../world/blocks.js';
import { itemVisualInfo } from '../entities/items.js';
import { itemMaxDurability } from '../player/inventory.js';

// Face brightness for the isometric icon (vanilla-style: lit from the top
// left). Art detail, deliberately inline like the other generated art.
const ICON_SHADE = { top: 1.0, left: 0.8, right: 0.6 };

let styleInjected = false;

function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .mc-slot-icon {
      display: block; margin: auto; image-rendering: pixelated;
      -webkit-user-drag: none; user-select: none; pointer-events: none;
    }
    .mc-slot-count {
      position: absolute; right: 3px; bottom: 1px;
      color: #fff; font: bold 15px/1 monospace;
      text-shadow: 1.5px 1.5px 0 #3f3f3f;
      pointer-events: none;
    }
    .mc-slot-dura {
      position: absolute; left: 3px; right: 3px; bottom: 3px;
      height: ${UI.DURABILITY_BAR_PX}px; background: #000;
      pointer-events: none;
    }
    .mc-slot-dura > div { height: 100%; }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Isometric block icons from the atlas
// ---------------------------------------------------------------------------

const blockIconCache = new Map(); // blockId -> data URL

// Draws one face of the cube: the atlas tile mapped onto the parallelogram
// with origin (x0, y0) and edge vectors (ux, uy) / (vx, vy), then darkened
// to `shade` only where the face actually drew (keeps cutout textures clean).
function drawFace(ctx, img, tile, x0, y0, ux, uy, vx, vy, shade) {
  const P = ATLAS.TILE_PIXELS;
  const sx = (tile % ATLAS.TILES_PER_ROW) * P;
  const sy = Math.floor(tile / ATLAS.TILES_PER_ROW) * P;
  ctx.save();
  ctx.setTransform(ux, uy, vx, vy, x0, y0);
  ctx.drawImage(img, sx, sy, P, P, 0, 0, 1, 1);
  if (shade < 1) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - shade})`;
    ctx.fillRect(0, 0, 1, 1);
  }
  ctx.restore();
}

function blockIconDataURL(blockId) {
  let url = blockIconCache.get(blockId);
  if (url) return url;
  const S = UI.BLOCK_ICON_PX;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const img = getAtlasTexture().image;
  const tiles = faceTiles(blockId); // [px, nx, py, ny, pz, nz]
  const h = S / 2;
  const q = S / 4;
  // Top diamond, then the two visible sides (pz face on the left, px on the
  // right — the same tiles the placed block shows).
  drawFace(ctx, img, tiles[2], 0, q, h, -q, h, q, ICON_SHADE.top);
  drawFace(ctx, img, tiles[4], 0, q, h, q, 0, h, ICON_SHADE.left);
  drawFace(ctx, img, tiles[0], h, h, h, -q, 0, h, ICON_SHADE.right);
  url = canvas.toDataURL();
  blockIconCache.set(blockId, url);
  return url;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Icon element for an item name: block items get the isometric cube, item
// items their real sprite. Always an <img> so callers can size it freely.
export function createItemIcon(name, sizePx) {
  const img = document.createElement('img');
  img.className = 'mc-slot-icon';
  img.draggable = false;
  img.style.width = `${sizePx}px`;
  img.style.height = `${sizePx}px`;
  const info = itemVisualInfo(name);
  img.src = info.blockId !== undefined
    ? blockIconDataURL(info.blockId)
    : `assets/items/${info.sprite}.png`;
  return img;
}

// Fills a slot element with a stack's icon, count (when > 1) and durability
// bar (when worn). `el` must be position: relative (or absolute) so the
// overlays anchor. Pass stack = null to empty the slot.
export function renderSlotContent(el, stack, iconPx) {
  injectStyle();
  el.textContent = '';
  if (!stack) return;
  el.appendChild(createItemIcon(stack.name, iconPx));
  if (stack.count > 1) {
    const count = document.createElement('span');
    count.className = 'mc-slot-count';
    count.textContent = String(stack.count);
    el.appendChild(count);
  }
  if (stack.durability != null) {
    const max = itemMaxDurability(stack.name);
    if (max != null && stack.durability < max) {
      const frac = Math.max(0, stack.durability / max);
      const bar = document.createElement('div');
      bar.className = 'mc-slot-dura';
      const fill = document.createElement('div');
      fill.style.width = `${Math.round(frac * 100)}%`;
      // Green at full health through yellow to red near breaking
      fill.style.background = `hsl(${Math.round(frac * 120)}, 90%, 45%)`;
      bar.appendChild(fill);
      el.appendChild(bar);
    }
  }
}
