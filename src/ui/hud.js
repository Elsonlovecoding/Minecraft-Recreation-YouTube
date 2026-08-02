// ui/hud.js — HUD: crosshair, breath meter, (Phase 7) the hotbar — the
// inventory's first 9 slots with real item icons, stack counts, durability
// bars and the selected-slot highlight — (Phase 9) the hearts row above the
// hotbar's left half plus the red damage flash, and (Phase 10) the
// submerged-in-lava overlay. Hunger arrives with the full stats phase.
//
// Phase 10 highlight fix: the selection highlight is a dedicated element
// moved by transform (repositioned both on inventory emits and per frame),
// not a per-slot ::after class — the class toggle sometimes didn't repaint
// under pointer lock, leaving the box on the old slot.

import { PLAYER, INVENTORY, UI, STATS, LAVA_VIEW, ATLAS } from '../config.js';
import { renderSlotContent } from './icons.js';
import { getAtlasTexture, TILE } from '../render/atlas.js';

let breathRow = null;
let bubbles = [];
let slotEls = [];
let heartEls = [];
let heartUrls = null; // { full, half, empty } data URLs
let flashEl = null;
let lastHealth = -1;
let selectEl = null;     // the hotbar selection highlight box
let lastSelected = -1;
let syncSelection = null; // repositions selectEl; also guarded per frame
let lavaEl = null;       // fullscreen overlay while the eye is in lava

// The lava overlay art: the real still-lava atlas tile, darkened, tiled
// across the screen (vanilla draws the block texture over the whole view).
function lavaOverlayDataUrl() {
  const P = ATLAS.TILE_PIXELS;
  const tile = TILE.LAVA_STILL;
  const sx = (tile % ATLAS.TILES_PER_ROW) * P;
  const sy = Math.floor(tile / ATLAS.TILES_PER_ROW) * P;
  const canvas = document.createElement('canvas');
  canvas.width = P;
  canvas.height = P;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(getAtlasTexture().image, sx, sy, P, P, 0, 0, P, P);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(0, 0, 0, ${1 - LAVA_VIEW.OVERLAY_BRIGHTNESS})`;
  ctx.fillRect(0, 0, P, P);
  return canvas.toDataURL();
}

// Pixel-art heart in the vanilla style, drawn once per variant onto a
// canvas and reused as a background image. 'o' outline, 'r' red fill,
// 'h' highlight, '.' transparent; the empty variant greys the fill.
const HEART_SHAPE = [
  '.oo..oo.',
  'orrooRRo',
  'orrrrRRo',
  'orrrrrro',
  '.orrrro.',
  '..orro..',
  '...oo...',
];

function heartDataUrl(variant) {
  const rows = HEART_SHAPE.length;
  const cols = HEART_SHAPE[0].length;
  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = cols * scale;
  canvas.height = rows * scale;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = HEART_SHAPE[y][x];
      if (c === '.') continue;
      let color;
      if (c === 'o') color = '#1f0000';
      else {
        // Fill pixels: full = red (highlight lighter), empty = dark grey,
        // half = red on the left half only.
        const red = variant === 'full' || (variant === 'half' && x < cols / 2);
        if (red) color = c === 'R' ? '#ff6a6a' : '#e02222';
        else color = c === 'R' ? '#4d4d4d' : '#3a3a3a';
      }
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas.toDataURL();
}

export function initHud(inventory) {
  const iconPx = Math.round(UI.HOTBAR_SLOT_PX * UI.ICON_SCALE);
  const breathBottom = UI.HOTBAR_BOTTOM_PX + UI.HOTBAR_SLOT_PX + 16;
  const style = document.createElement('style');
  style.textContent = `
    #hud-crosshair {
      position: fixed; left: 50%; top: 50%; width: 18px; height: 18px;
      transform: translate(-50%, -50%); pointer-events: none; z-index: 5;
      mix-blend-mode: difference;
    }
    #hud-crosshair::before, #hud-crosshair::after {
      content: ''; position: absolute; background: #ddd;
    }
    #hud-crosshair::before { left: 8px; top: 0; width: 2px; height: 18px; }
    #hud-crosshair::after { left: 0; top: 8px; width: 18px; height: 2px; }
    #hud-breath {
      /* right-aligned over the hotbar's right half, mirroring the hearts on
         the left (vanilla layout) — the two rows can never overlap */
      position: fixed; left: 50%; bottom: ${breathBottom}px;
      transform: translateX(calc(${Math.round((UI.HOTBAR_SLOT_PX * INVENTORY.HOTBAR_SIZE + 8) / 2)}px - 100%));
      display: none; pointer-events: none; z-index: 5;
    }
    #hud-breath .bubble {
      display: inline-block; width: 12px; height: 12px; margin: 0 1px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #eaf6ff, #7db8e8 60%, #3d78b8);
      border: 1px solid rgba(20, 40, 80, 0.55);
    }
    #hud-hotbar {
      position: fixed; left: 50%; bottom: ${UI.HOTBAR_BOTTOM_PX}px;
      transform: translateX(-50%);
      display: flex; z-index: 5; pointer-events: none;
      background: rgba(12, 12, 12, 0.6);
      border: 2px solid rgba(0, 0, 0, 0.8);
      box-shadow: 0 0 0 2px rgba(190, 190, 190, 0.35);
    }
    .hud-slot {
      position: relative; box-sizing: border-box;
      width: ${UI.HOTBAR_SLOT_PX}px; height: ${UI.HOTBAR_SLOT_PX}px;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid;
      border-color: #2b2b2b rgba(255,255,255,0.28) rgba(255,255,255,0.28) #2b2b2b;
    }
    #hud-hotbar-sel {
      position: absolute; left: -5px; top: -5px;
      width: ${UI.HOTBAR_SLOT_PX + 10}px; height: ${UI.HOTBAR_SLOT_PX + 10}px;
      box-sizing: border-box; pointer-events: none;
      border: 3px solid #e8e8e8; border-radius: 2px;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(0,0,0,0.7);
    }
    #hud-lava-overlay {
      position: fixed; inset: 0; pointer-events: none; z-index: 3;
      display: none;
      opacity: ${LAVA_VIEW.OVERLAY_OPACITY};
      background-size: ${LAVA_VIEW.OVERLAY_TILE_PX}px ${LAVA_VIEW.OVERLAY_TILE_PX}px;
      image-rendering: pixelated;
    }
    #hud-hearts {
      position: fixed; left: 50%; bottom: ${UI.HOTBAR_BOTTOM_PX + UI.HOTBAR_SLOT_PX + 10}px;
      transform: translateX(-${Math.round((UI.HOTBAR_SLOT_PX * INVENTORY.HOTBAR_SIZE + 8) / 2)}px);
      display: flex; z-index: 5; pointer-events: none;
      filter: drop-shadow(1px 1px 0 rgba(0,0,0,0.5));
    }
    #hud-hearts .heart {
      width: ${STATS.HEART_PX}px; height: ${STATS.HEART_PX}px; margin-right: 1px;
      background-size: contain; background-repeat: no-repeat;
      image-rendering: pixelated;
    }
    #hud-damage-flash {
      position: fixed; inset: 0; pointer-events: none; z-index: 4;
      background: rgba(190, 0, 0, 0.30); opacity: 0;
    }
  `;
  document.head.appendChild(style);

  const crosshair = document.createElement('div');
  crosshair.id = 'hud-crosshair';
  // Only aim while actually playing — otherwise the crosshair draws over
  // the centred "Click to play" hint.
  crosshair.style.display = 'none';
  document.addEventListener('pointerlockchange', () => {
    crosshair.style.display = document.pointerLockElement ? 'block' : 'none';
  });
  document.body.appendChild(crosshair);

  breathRow = document.createElement('div');
  breathRow.id = 'hud-breath';
  bubbles = [];
  for (let i = 0; i < PLAYER.BREATH_BUBBLES; i++) {
    const b = document.createElement('span');
    b.className = 'bubble';
    breathRow.appendChild(b);
    bubbles.push(b);
  }
  document.body.appendChild(breathRow);

  // --- hotbar
  const hotbar = document.createElement('div');
  hotbar.id = 'hud-hotbar';
  slotEls = [];
  for (let i = 0; i < INVENTORY.HOTBAR_SIZE; i++) {
    const slot = document.createElement('div');
    slot.className = 'hud-slot';
    hotbar.appendChild(slot);
    slotEls.push(slot);
  }
  // Selection highlight: one element moved along the bar (see header note).
  selectEl = document.createElement('div');
  selectEl.id = 'hud-hotbar-sel';
  hotbar.appendChild(selectEl);
  document.body.appendChild(hotbar);
  lastSelected = -1;

  syncSelection = () => {
    if (inventory.selected === lastSelected) return;
    lastSelected = inventory.selected;
    selectEl.style.transform = `translateX(${lastSelected * UI.HOTBAR_SLOT_PX}px)`;
  };
  const refresh = () => {
    for (let i = 0; i < slotEls.length; i++) {
      renderSlotContent(slotEls[i], inventory.get(i), iconPx);
    }
    syncSelection();
  };
  inventory.subscribe(refresh);
  refresh();

  // --- hearts (Phase 9 stats slice) + damage flash
  heartUrls = {
    full: heartDataUrl('full'),
    half: heartDataUrl('half'),
    empty: heartDataUrl('empty'),
  };
  const hearts = document.createElement('div');
  hearts.id = 'hud-hearts';
  heartEls = [];
  for (let i = 0; i < PLAYER.MAX_HEALTH / 2; i++) {
    const h = document.createElement('div');
    h.className = 'heart';
    hearts.appendChild(h);
    heartEls.push(h);
  }
  document.body.appendChild(hearts);
  lastHealth = -1;

  flashEl = document.createElement('div');
  flashEl.id = 'hud-damage-flash';
  document.body.appendChild(flashEl);

  // --- submerged-in-lava overlay (Phase 10)
  lavaEl = document.createElement('div');
  lavaEl.id = 'hud-lava-overlay';
  lavaEl.style.backgroundImage = `url(${lavaOverlayDataUrl()})`;
  document.body.appendChild(lavaEl);
}

// Call once per frame with the player controller and (Phase 9) the stats.
// The breath meter only shows while air is missing (underwater or just
// surfaced), like vanilla.
export function updateHud(player, stats) {
  if (!breathRow) return;
  // Per-frame guard on the selection highlight (belt and braces with the
  // subscription — see the header note on the repaint bug).
  syncSelection?.();
  if (lavaEl) {
    const inLava = !!player.body?.eyeInLava;
    lavaEl.style.display = inLava ? 'block' : 'none';
  }
  const frac = player.breath / player.maxBreath;
  breathRow.style.display = frac < 1 ? 'block' : 'none';
  if (frac < 1) {
    const shown = Math.ceil(frac * bubbles.length);
    for (let i = 0; i < bubbles.length; i++) {
      bubbles[i].style.visibility = i < shown ? 'visible' : 'hidden';
    }
  }

  if (!stats || !heartEls.length) return;
  if (stats.health !== lastHealth) {
    lastHealth = stats.health;
    for (let i = 0; i < heartEls.length; i++) {
      const points = stats.health - i * 2; // 2 health per heart
      const url = points >= 2 ? heartUrls.full : points === 1 ? heartUrls.half : heartUrls.empty;
      heartEls[i].style.backgroundImage = `url(${url})`;
    }
  }
  flashEl.style.opacity = stats.flashFraction > 0
    ? (0.4 + 0.6 * stats.flashFraction).toFixed(2)
    : '0';
}
