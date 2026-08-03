// ui/hud.js — HUD: crosshair, breath meter, (Phase 7) the hotbar — the
// inventory's first 9 slots with real item icons, stack counts, durability
// bars and the selected-slot highlight — (Phase 9) the hearts row above the
// hotbar's left half plus the red damage flash, (Phase 10) the
// submerged-in-lava overlay, and (Phase 11) the hunger row: 10 drumsticks
// above the hotbar's right half, filling right-to-left like vanilla, with
// the breath bubbles moved up a row to sit above them.
//
// Phase 10 highlight fix: the selection highlight is a dedicated element
// moved by transform (repositioned both on inventory emits and per frame),
// not a per-slot ::after class — the class toggle sometimes didn't repaint
// under pointer lock, leaving the box on the old slot.

import { PLAYER, INVENTORY, UI, STATS, LAVA_VIEW, ATLAS, COMBAT } from '../config.js';
import { renderSlotContent } from './icons.js';
import { getAtlasTexture, TILE } from '../render/atlas.js';

let breathRow = null;
let bubbles = [];
let slotEls = [];
let heartEls = [];
let heartUrls = null; // { full, half, empty } data URLs
let hungerEls = [];   // left-to-right; hunger fills right-to-left
let hungerUrls = null;
let lastHunger = -1;
let flashEl = null;
let lastHealth = -1;
let armourEls = [];   // armour bar above the hearts (Phase 13)
let armourUrls = null;
let lastArmour = -1;
let armourRow = null;
let hudInventory = null; // armourPoints source for the bar
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

// Pixel-art drumstick in the vanilla hunger-bar style: browned meat blob to
// the top-left, pale bone poking out toward the bottom-right. 'o' outline,
// 'm' meat, 'M' meat highlight, 'b' bone; the empty variant greys the fill,
// the half variant keeps colour on the left half only.
const FOOD_SHAPE = [
  '..oooo..',
  '.oMMmmo.',
  'oMmmmmmo',
  'ommmmmo.',
  '.ommmo..',
  '..oobbo.',
  '...obbo.',
  '....oo..',
];

function hungerDataUrl(variant) {
  const rows = FOOD_SHAPE.length;
  const cols = FOOD_SHAPE[0].length;
  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = cols * scale;
  canvas.height = rows * scale;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = FOOD_SHAPE[y][x];
      if (c === '.') continue;
      let color;
      if (c === 'o') color = '#2b1508';
      else {
        const lit = variant === 'full' || (variant === 'half' && x < cols / 2);
        if (lit) {
          color = c === 'M' ? '#d8904a' : c === 'b' ? '#e8ddc8' : '#b06a28';
        } else {
          color = c === 'M' ? '#4d4d4d' : c === 'b' ? '#565656' : '#3a3a3a';
        }
      }
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas.toDataURL();
}

// Pixel-art armour plate in the vanilla armour-bar style: shoulder caps
// over a tapering chest. 'o' outline, 's' steel, 'S' highlight; the empty
// variant greys the fill, the half variant keeps colour on the left half.
const ARMOR_SHAPE = [
  'oo....oo',
  'oso..oso',
  'osSooSso',
  'osSSSSso',
  '.oSSSSo.',
  '.osSSso.',
  '.osssso.',
  '..oooo..',
];

function armourDataUrl(variant) {
  const rows = ARMOR_SHAPE.length;
  const cols = ARMOR_SHAPE[0].length;
  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = cols * scale;
  canvas.height = rows * scale;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = ARMOR_SHAPE[y][x];
      if (c === '.') continue;
      let color;
      if (c === 'o') color = '#20222b';
      else {
        const lit = variant === 'full' || (variant === 'half' && x < cols / 2);
        if (lit) color = c === 'S' ? '#e8ecf5' : '#a8b0c0';
        else color = c === 'S' ? '#4d4d4d' : '#3a3a3a';
      }
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas.toDataURL();
}

export function initHud(inventory) {
  hudInventory = inventory;
  const iconPx = Math.round(UI.HOTBAR_SLOT_PX * UI.ICON_SCALE);
  const statsBottom = UI.HOTBAR_BOTTOM_PX + UI.HOTBAR_SLOT_PX + 10;
  // Armour sits above the hearts on the left, like breath above hunger.
  const armourBottom = statsBottom + STATS.HEART_PX + 4;
  // Bubbles sit above the hunger row (vanilla), which mirrors the hearts on
  // the right half of the hotbar.
  const breathBottom = statsBottom + STATS.HUNGER_PX + 4;
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
      /* right-aligned above the hunger row (vanilla layout) */
      position: fixed; left: 50%; bottom: ${breathBottom}px;
      transform: translateX(calc(${Math.round((UI.HOTBAR_SLOT_PX * INVENTORY.HOTBAR_SIZE + 8) / 2)}px - 100%));
      display: none; pointer-events: none; z-index: 5;
    }
    #hud-hunger {
      /* right-aligned over the hotbar's right half, mirroring the hearts */
      position: fixed; left: 50%; bottom: ${statsBottom}px;
      transform: translateX(calc(${Math.round((UI.HOTBAR_SLOT_PX * INVENTORY.HOTBAR_SIZE + 8) / 2)}px - 100%));
      display: flex; z-index: 5; pointer-events: none;
      filter: drop-shadow(1px 1px 0 rgba(0,0,0,0.5));
    }
    #hud-hunger .drumstick {
      width: ${STATS.HUNGER_PX}px; height: ${STATS.HUNGER_PX}px; margin-left: 1px;
      background-size: contain; background-repeat: no-repeat;
      image-rendering: pixelated;
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
    #hud-armour {
      /* left-aligned above the hearts (vanilla layout); hidden unarmoured */
      position: fixed; left: 50%; bottom: ${armourBottom}px;
      transform: translateX(-${Math.round((UI.HOTBAR_SLOT_PX * INVENTORY.HOTBAR_SIZE + 8) / 2)}px);
      display: none; z-index: 5; pointer-events: none;
      filter: drop-shadow(1px 1px 0 rgba(0,0,0,0.5));
    }
    #hud-armour .plate {
      width: ${STATS.ARMOR_PX}px; height: ${STATS.ARMOR_PX}px; margin-right: 1px;
      display: inline-block;
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

  // --- armour bar (Phase 13) — one plate per 2 protection points
  armourUrls = {
    full: armourDataUrl('full'),
    half: armourDataUrl('half'),
    empty: armourDataUrl('empty'),
  };
  armourRow = document.createElement('div');
  armourRow.id = 'hud-armour';
  armourEls = [];
  // One plate per 2 protection points, sized to the best possible set
  // (a full diamond set = 20 points = 10 plates), like hearts to health.
  const maxPoints = Object.values(COMBAT.ARMOR_POINTS.diamond)
    .reduce((a, b) => a + b, 0);
  for (let i = 0; i < maxPoints / 2; i++) {
    const a = document.createElement('div');
    a.className = 'plate';
    armourRow.appendChild(a);
    armourEls.push(a);
  }
  document.body.appendChild(armourRow);
  lastArmour = -1;

  // --- hunger row (Phase 11)
  hungerUrls = {
    full: hungerDataUrl('full'),
    half: hungerDataUrl('half'),
    empty: hungerDataUrl('empty'),
  };
  const hungerRow = document.createElement('div');
  hungerRow.id = 'hud-hunger';
  hungerEls = [];
  for (let i = 0; i < PLAYER.MAX_HUNGER / 2; i++) {
    const d = document.createElement('div');
    d.className = 'drumstick';
    hungerRow.appendChild(d);
    hungerEls.push(d);
  }
  document.body.appendChild(hungerRow);
  lastHunger = -1;

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
  if (stats.hunger !== lastHunger) {
    lastHunger = stats.hunger;
    for (let i = 0; i < hungerEls.length; i++) {
      // The hunger bar fills right-to-left (vanilla): the rightmost
      // drumstick holds points 1-2.
      const points = stats.hunger - (hungerEls.length - 1 - i) * 2;
      const url = points >= 2 ? hungerUrls.full : points === 1 ? hungerUrls.half : hungerUrls.empty;
      hungerEls[i].style.backgroundImage = `url(${url})`;
    }
  }
  // Armour bar: shown only while wearing anything (vanilla), one plate per
  // 2 protection points, filling left to right.
  const armourPoints = hudInventory ? hudInventory.armourPoints : 0;
  if (armourPoints !== lastArmour) {
    lastArmour = armourPoints;
    armourRow.style.display = armourPoints > 0 ? 'block' : 'none';
    for (let i = 0; i < armourEls.length; i++) {
      const points = armourPoints - i * 2;
      const url = points >= 2 ? armourUrls.full : points === 1 ? armourUrls.half : armourUrls.empty;
      armourEls[i].style.backgroundImage = `url(${url})`;
    }
  }
  flashEl.style.opacity = stats.flashFraction > 0
    ? (0.4 + 0.6 * stats.flashFraction).toFixed(2)
    : '0';
}
