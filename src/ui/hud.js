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

import {
  PLAYER, INVENTORY, UI, STATS, LAVA_VIEW, ATLAS, COMBAT, EFFECTS,
} from '../config.js';
import { renderSlotContent, createItemIcon } from './icons.js';
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
let effectsRow = null;   // active potion effects, top-right (Phase 18)
let lastEffectsKey = ''; // rebuilt only when the countdowns change
let bossBar = null;      // the Ender Dragon boss bar (Phase 21)
let bossFill = null;
let bossShown = 1;       // eased health fraction so the bar drains smoothly
                         // (starts FULL: the bar must be solid the instant
                         // it appears, never an empty track easing up)
let absorbEls = [];      // yellow absorption hearts above the health row
let absorbUrls = null;
let absorbRow = null;
let lastAbsorb = -1;
let armourBaseBottom = 0;   // armour row offset with no absorption showing
let armourAbsorbBottom = 0; // ...and with the absorption row in between
let sleepEl = null;      // full-screen wash while a night passes in a bed
let sleepFade = 0;
let toastEl = null;      // transient message line above the hotbar
let toastTimer = 0;

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

// `palette` is { outline, fill, highlight } — the health row is red, the
// Phase 22 absorption row the same shape in vanilla's gold.
function heartDataUrl(variant, palette = {
  outline: '#1f0000', fill: '#e02222', highlight: '#ff6a6a',
}) {
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
      if (c === 'o') color = palette.outline;
      else {
        // Fill pixels: full = coloured (highlight lighter), empty = dark
        // grey, half = coloured on the left half only.
        const lit = variant === 'full' || (variant === 'half' && x < cols / 2);
        if (lit) color = c === 'R' ? palette.highlight : palette.fill;
        else color = c === 'R' ? '#4d4d4d' : '#3a3a3a';
      }
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas.toDataURL();
}

// Vanilla's absorption hearts: the same heart in gold.
const ABSORB_PALETTE = {
  outline: '#2a1c00', fill: '#e8b21a', highlight: '#ffe066',
};

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
  // Absorption (Phase 22) sits directly above the health row; armour rides
  // above whichever of the two is showing (updateHud moves it).
  const absorbBottom = statsBottom + STATS.HEART_PX + 4;
  const armourBottom = absorbBottom;
  armourBaseBottom = armourBottom;
  armourAbsorbBottom = absorbBottom + STATS.ABSORPTION_PX + 4;
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
    /* The boss bar: a MAGENTA fill in a dark track, captioned above. It sits
       over everything the HUD draws, so nothing can hide it in the End. */
    #hud-boss {
      position: fixed; left: 50%; top: ${UI.BOSS_BAR.TOP_PX}px;
      transform: translateX(-50%); display: none; z-index: 12;
      pointer-events: none; text-align: center;
    }
    #hud-boss-label {
      color: #fff; font: bold ${UI.BOSS_BAR.LABEL_PX}px monospace;
      text-shadow: 2px 2px 0 #000; margin-bottom: 4px; letter-spacing: 1px;
      white-space: nowrap;
    }
    #hud-boss-track {
      width: ${UI.BOSS_BAR.WIDTH_PX}px; height: ${UI.BOSS_BAR.HEIGHT_PX}px;
      background: ${UI.BOSS_BAR.TRACK}; border: 2px solid #000;
      box-sizing: content-box;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18);
    }
    #hud-boss-fill {
      height: 100%; width: 100%;
      background: linear-gradient(
        ${UI.BOSS_BAR.FILL_TOP}, ${UI.BOSS_BAR.FILL_MID} 55%,
        ${UI.BOSS_BAR.FILL_BOTTOM}
      );
      box-shadow: 0 0 8px ${UI.BOSS_BAR.FILL_MID};
    }
    /* A transient message line, vanilla's action-bar text. */
    #hud-toast {
      position: fixed; left: 50%; bottom: ${statsBottom + 46}px;
      transform: translateX(-50%); color: #fff; opacity: 0;
      font: 15px monospace; text-shadow: 2px 2px 0 #000;
      pointer-events: none; z-index: 6; transition: opacity 0.25s;
      white-space: nowrap;
    }
    /* The sleep wash: a full-screen fade while the night passes. */
    #hud-sleep {
      position: fixed; inset: 0; background: ${UI.SLEEP_FADE_COLOR};
      opacity: 0; display: none; z-index: 30; pointer-events: none;
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
    #hud-absorb {
      /* Phase 22 — the golden apple's absorption hearts, directly above the
         health row and hidden whenever there is no absorption to show */
      position: fixed; left: 50%; bottom: ${absorbBottom}px;
      transform: translateX(-${Math.round((UI.HOTBAR_SLOT_PX * INVENTORY.HOTBAR_SIZE + 8) / 2)}px);
      display: none; z-index: 5; pointer-events: none;
      filter: drop-shadow(1px 1px 0 rgba(0,0,0,0.5));
    }
    #hud-absorb .heart {
      width: ${STATS.ABSORPTION_PX}px; height: ${STATS.ABSORPTION_PX}px;
      margin-right: 1px; background-size: contain; background-repeat: no-repeat;
      image-rendering: pixelated; flex: 0 0 auto;
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
    #hud-effects {
      /* active potion effects: a small framed icon with the countdown
         BENEATH it, top-right — vanilla's proportions (Phase 22 shrank the
         Phase 18 panel, which intruded on the view) */
      position: fixed; top: ${UI.EFFECTS_HUD.TOP_PX}px;
      right: ${UI.EFFECTS_HUD.RIGHT_PX}px; z-index: 5;
      display: flex; flex-direction: row; gap: ${UI.EFFECTS_HUD.GAP_PX}px;
      align-items: flex-start; pointer-events: none;
    }
    .hud-effect {
      display: flex; flex-direction: column; align-items: center; gap: 1px;
    }
    .hud-effect .hud-effect-icon {
      width: ${UI.EFFECTS_HUD.ICON_PX}px; height: ${UI.EFFECTS_HUD.ICON_PX}px;
      box-sizing: border-box;
      display: flex; align-items: center; justify-content: center;
      background: rgba(12, 12, 12, 0.55);
      border: 1px solid rgba(0, 0, 0, 0.85);
      box-shadow: 0 0 0 1px rgba(190, 190, 190, 0.25);
    }
    .hud-effect span {
      color: #fff; font: ${UI.EFFECTS_HUD.LABEL_PX}px/1 monospace;
      text-shadow: 1px 1px 0 #000;
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

  // --- absorption hearts (Phase 22 — the golden apple): the same heart in
  // gold, one row above the health bar, shown only while absorption is up.
  absorbUrls = {
    full: heartDataUrl('full', ABSORB_PALETTE),
    half: heartDataUrl('half', ABSORB_PALETTE),
  };
  absorbRow = document.createElement('div');
  absorbRow.id = 'hud-absorb';
  absorbEls = [];
  // Sized to the largest absorption this game grants (the golden apple's).
  for (let i = 0; i < Math.ceil(EFFECTS.GOLDEN_APPLE.ABSORPTION_HEALTH / 2); i++) {
    const h = document.createElement('div');
    h.className = 'heart';
    absorbRow.appendChild(h);
    absorbEls.push(h);
  }
  document.body.appendChild(absorbRow);
  lastAbsorb = -1;

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

  // --- active potion effects (Phase 18)
  effectsRow = document.createElement('div');
  effectsRow.id = 'hud-effects';
  document.body.appendChild(effectsRow);
  lastEffectsKey = '';

  // --- the boss bar (Phase 21): Minecraft's purple bar across the top of
  // the screen while the Ender Dragon lives, depleting as it takes damage.
  bossBar = document.createElement('div');
  bossBar.id = 'hud-boss';
  const bossLabel = document.createElement('div');
  bossLabel.id = 'hud-boss-label';
  bossLabel.textContent = UI.BOSS_BAR.LABEL;
  const bossTrack = document.createElement('div');
  bossTrack.id = 'hud-boss-track';
  bossFill = document.createElement('div');
  bossFill.id = 'hud-boss-fill';
  bossTrack.appendChild(bossFill);
  bossBar.appendChild(bossLabel);
  bossBar.appendChild(bossTrack);
  document.body.appendChild(bossBar);

  // --- the sleep fade (Phase 21 — beds)
  sleepEl = document.createElement('div');
  sleepEl.id = 'hud-sleep';
  document.body.appendChild(sleepEl);

  // --- transient message line (Phase 21): the bed's "you may not rest now"
  toastEl = document.createElement('div');
  toastEl.id = 'hud-toast';
  document.body.appendChild(toastEl);
}

// The potion item whose tinted-bottle icon stands for each effect.
const EFFECT_ICON_ITEM = {
  fire_resistance: 'fire_resistance_potion',
  strength: 'strength_potion',
  regeneration: 'healing_potion', // the golden apple's burst (Phase 22)
};

// Rebuilt only when the whole-second countdowns change (cheap, and the
// icons are cached data URLs after first build).
function updateEffects(stats) {
  if (!effectsRow || !stats?.effects) return;
  const active = Object.entries(stats.effects)
    .filter(([, s]) => s > 0)
    .map(([type, s]) => [type, Math.ceil(s)]);
  const key = active.map(([t, s]) => `${t}:${s}`).join(',');
  if (key === lastEffectsKey) return;
  lastEffectsKey = key;
  effectsRow.textContent = '';
  for (const [type, seconds] of active) {
    const el = document.createElement('div');
    el.className = 'hud-effect';
    const frame = document.createElement('div');
    frame.className = 'hud-effect-icon';
    frame.appendChild(createItemIcon(
      EFFECT_ICON_ITEM[type] ?? 'potion', UI.EFFECTS_HUD.ART_PX,
    ));
    el.appendChild(frame);
    const label = document.createElement('span');
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    label.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.appendChild(label);
    effectsRow.appendChild(el);
  }
}

// Call once per frame with the player controller and (Phase 9) the stats.
// The breath meter only shows while air is missing (underwater or just
// surfaced), like vanilla.
// Phase 21: the boss bar and the sleep fade ride the same per-frame call.
// `boss` is { name, fraction } | null (main.js passes the dragon fight's
// health while it lives); `sleep` is a 0..1 fade.
export function setBossBar(boss, dt = 0) {
  if (!bossBar) return;
  if (!boss) {
    bossBar.style.display = 'none';
    bossShown = 1;
    return;
  }
  // Belt and braces (Phase 22 report — "an empty space where it should be"):
  // force the whole subtree visible every frame it is shown, so nothing
  // another screen or overlay does can leave the caption and track blank.
  bossBar.style.display = 'block';
  bossBar.style.visibility = 'visible';
  bossBar.style.opacity = '1';
  const raw = Number(boss.fraction);
  const target = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
  const k = dt > 0 ? 1 - Math.exp(-UI.BOSS_BAR.EASE_RATE * dt) : 1;
  bossShown += (target - bossShown) * k;
  if (!Number.isFinite(bossShown)) bossShown = target;
  if (Math.abs(bossShown - target) < 0.002) bossShown = target;
  bossFill.style.width = `${(bossShown * 100).toFixed(1)}%`;
}

// A short message over the hotbar (the bed's refusals).
export function showToast(text, seconds = 2.5) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.style.opacity = '1';
  toastTimer = seconds;
}

export function setSleepFade(fraction) {
  if (!sleepEl) return;
  sleepFade = Math.max(0, Math.min(1, fraction));
  sleepEl.style.display = sleepFade > 0 ? 'block' : 'none';
  sleepEl.style.opacity = String(sleepFade);
}

export function updateHud(player, stats, dt = 0) {
  if (!breathRow) return;
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) toastEl.style.opacity = '0';
  }
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
  updateEffects(stats);

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
  // Absorption hearts (Phase 22): the golden apple's yellow hearts, sitting
  // directly above the red health row and emptying before real health does.
  // The row's visibility is written EVERY frame, not only on a change: a
  // one-off stale value here is exactly the shape of the "no yellow hearts
  // appear" report, and two style writes a frame cost nothing.
  const absorb = stats.absorption ?? 0;
  absorbRow.style.display = absorb > 0 ? 'flex' : 'none';
  if (absorb !== lastAbsorb) {
    const wasShown = lastAbsorb > 0;
    lastAbsorb = absorb;
    for (let i = 0; i < absorbEls.length; i++) {
      const points = absorb - i * 2;
      absorbEls[i].style.display = points > 0 ? 'block' : 'none';
      if (points > 0) {
        absorbEls[i].style.backgroundImage =
          `url(${points >= 2 ? absorbUrls.full : absorbUrls.half})`;
      }
    }
    // The armour bar rides above whichever rows are showing.
    if ((absorb > 0) !== wasShown) {
      armourRow.style.bottom = `${absorb > 0 ? armourAbsorbBottom : armourBaseBottom}px`;
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
