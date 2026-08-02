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
import { itemVisualInfo, atlasSpriteCanvas } from '../entities/items.js';
import { itemMaxDurability } from '../player/inventory.js';
import { CHEST_TEXTURE_PATH } from '../world/chests.js';

// Face brightness for the isometric icon (vanilla-style: lit from the top
// left). Art detail, deliberately inline like the other generated art.
const ICON_SHADE = { top: 1.0, left: 0.8, right: 0.6 };

// True dimetric cube proportions (vanilla GUI block render: 45° yaw, 30°
// elevation, orthographic). For a cube icon of width W the top diamond is
// W/2 tall and the vertical edges drop cos30°/√2 ≈ 0.612·W below it — the
// icon is ~11% taller than wide. (Phase 11 fix: the old icons used a drop
// of W/2, which squashed every block cube visibly flat.)
const ICON_DROP = Math.sqrt(3) / 2 / Math.SQRT2;
// Canvas/display height as a multiple of the width.
export const BLOCK_ICON_ASPECT = 0.5 + ICON_DROP;

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
  const drop = Math.round(S * ICON_DROP); // vertical edge length
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S / 2 + drop;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const img = getAtlasTexture().image;
  const tiles = faceTiles(blockId); // [px, nx, py, ny, pz, nz]
  const h = S / 2;
  const q = S / 4;
  // Top diamond, then the two visible sides (pz face on the left, px on the
  // right — the same tiles the placed block shows).
  drawFace(ctx, img, tiles[2], 0, q, h, -q, h, q, ICON_SHADE.top);
  drawFace(ctx, img, tiles[4], 0, q, h, q, 0, drop, ICON_SHADE.left);
  drawFace(ctx, img, tiles[0], h, h, h, -q, 0, drop, ICON_SHADE.right);
  url = canvas.toDataURL();
  blockIconCache.set(blockId, url);
  return url;
}

// ---------------------------------------------------------------------------
// Chest icon (Phase 10) — the same isometric cube, drawn from the chest
// entity sheet instead of atlas tiles. The sheet stores faces rotated 180°
// (see world/chests.js), and the visible front is a composite of the lid
// and base strips plus the latch. Built once, async (the sheet is already
// loading for the world model, so this is a cache hit).
// ---------------------------------------------------------------------------

let chestIconUrl = null;
let chestIconLoading = null;

// Draws sheet region (sx, sy, sw, sh) rotated 180° into (dx, dy, dw, dh).
function drawRegion180(ctx, sheet, sx, sy, sw, sh, dx, dy, dw, dh) {
  ctx.save();
  ctx.translate(dx + dw, dy + dh);
  ctx.scale(-1, -1);
  ctx.drawImage(sheet, sx, sy, sw, sh, 0, 0, dw, dh);
  ctx.restore();
}

function buildChestIcon(sheet) {
  // Face canvases in 14px chest space: top, front (lid strip over base
  // strip, latch overlaid), and a plain side.
  const makeFace = (front) => {
    const c = document.createElement('canvas');
    c.width = 14;
    c.height = 14;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const slotX = front ? 42 : 28; // 4th slot = front (latch recess), 3rd = side
    drawRegion180(ctx, sheet, slotX, 33, 14, 10, 0, 4, 14, 10); // base strip
    drawRegion180(ctx, sheet, slotX, 14, 14, 5, 0, 0, 14, 5);   // lid strip
    if (front) drawRegion180(ctx, sheet, 4, 1, 2, 4, 6, 3, 2, 4); // latch
    return c;
  };
  const top = document.createElement('canvas');
  top.width = 14;
  top.height = 14;
  const topCtx = top.getContext('2d');
  topCtx.imageSmoothingEnabled = false;
  drawRegion180(topCtx, sheet, 14, 0, 14, 14, 0, 0, 14, 14);

  const S = UI.BLOCK_ICON_PX;
  const drop = Math.round(S * ICON_DROP);
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S / 2 + drop;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const h = S / 2;
  const q = S / 4;
  const face = (img, x0, y0, ux, uy, vx, vy, shade) => {
    ctx.save();
    ctx.setTransform(ux / 14, uy / 14, vx / 14, vy / 14, x0, y0);
    ctx.drawImage(img, 0, 0);
    if (shade < 1) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(0, 0, 0, ${1 - shade})`;
      ctx.fillRect(0, 0, 14, 14);
    }
    ctx.restore();
  };
  // Same three-face layout as blockIconDataURL: top, front-left, side-right.
  face(top, 0, q, h, -q, h, q, ICON_SHADE.top);
  face(makeFace(true), 0, q, h, q, 0, drop, ICON_SHADE.left);
  face(makeFace(false), h, h, h, -q, 0, drop, ICON_SHADE.right);
  return canvas.toDataURL();
}

function setChestIcon(imgEl) {
  if (chestIconUrl) {
    imgEl.src = chestIconUrl;
    return;
  }
  if (!chestIconLoading) {
    chestIconLoading = new Promise((resolve) => {
      const sheet = new Image();
      sheet.onload = () => {
        chestIconUrl = buildChestIcon(sheet);
        resolve();
      };
      sheet.onerror = () => resolve(); // icon stays blank; world model warns
      sheet.src = CHEST_TEXTURE_PATH;
    });
  }
  chestIconLoading.then(() => {
    if (chestIconUrl) imgEl.src = chestIconUrl;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Icon element for an item name: block items get the isometric cube (shown
// slightly taller than wide — the true cube proportions), item items their
// real square sprite. Always an <img> so callers can size it freely.
export function createItemIcon(name, sizePx) {
  const img = document.createElement('img');
  img.className = 'mc-slot-icon';
  img.draggable = false;
  img.style.width = `${sizePx}px`;
  img.style.height = `${sizePx}px`;
  const info = itemVisualInfo(name);
  if (info.model === 'chest') {
    img.style.height = `${Math.round(sizePx * BLOCK_ICON_ASPECT)}px`;
    setChestIcon(img);
  } else if (info.blockId !== undefined) {
    img.style.height = `${Math.round(sizePx * BLOCK_ICON_ASPECT)}px`;
    img.src = blockIconDataURL(info.blockId);
  } else if (info.atlas) {
    img.src = atlasSpriteDataUrl(info.sprite);
  } else {
    img.src = `assets/items/${info.sprite}.png`;
  }
  return img;
}

const atlasSpriteUrlCache = new Map(); // item name -> data URL

// Sprite icon for an item whose art lives in the block atlas (torch).
function atlasSpriteDataUrl(name) {
  let url = atlasSpriteUrlCache.get(name);
  if (!url) {
    url = atlasSpriteCanvas(name).toDataURL();
    atlasSpriteUrlCache.set(name, url);
  }
  return url;
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
