// ui/containers.js — Phase 18: the block-container screen sections, split
// out of ui/screens.js per the ARCHITECTURE file-size cap (screens.js sat
// at ~810; the brewing screen tips it, so container screens live here).
// screens.js keeps the panel, cursor, slot machinery and open/close flow;
// this module owns the chest / furnace / brewing DOM sections, their
// indicator pixel art, and their per-frame indicator updates. The chest
// and furnace sections moved verbatim (same DOM classes and behaviour);
// the brewing section is new this phase.
//
// The factory receives:
//   panel             the screen panel element (sections append themselves)
//   attachSlotEvents  screens.js's slot binding (el, getContainer, index) —
//                     containers resolve at event time, so one set of DOM
//                     slots serves whichever chest/furnace/stand is open
//   getChest / getFurnace / getBrewing
//                     the active container accessors (null when closed)
// and returns { refresh(mode, iconPx), updateIndicators(mode) }.

import { INVENTORY, UI } from '../config.js';
import { renderSlotContent } from './icons.js';
import {
  SLOT_INPUT, SLOT_FUEL, SLOT_OUTPUT,
} from '../systems/smelting.js';
import {
  BOTTLE_SLOTS, SLOT_INGREDIENT as BREW_SLOT_INGREDIENT,
  SLOT_FUEL as BREW_SLOT_FUEL,
} from '../systems/brewing.js';
import { CHEST_SLOTS } from '../world/chests.js';

// Furnace indicator pixel art (inline like the other generated art):
// a 14x14 flame and a 22x15 progress arrow, each drawn dim as background
// with a bright fill revealed by fuel/progress fraction.
const FLAME_ART = [
  '......oo......',
  '.....oooo.....',
  '.....oooo.....',
  '....oooooo....',
  '....oooooo....',
  '...oooyyooo...',
  '...ooyyyyoo...',
  '..ooyyyyyyoo..',
  '..ooyyyyyyoo..',
  '.ooyyyyyyyyoo.',
  '.oyyyyyyyyyyo.',
  '.oyyyyyyyyyyo.',
  '..oyyyyyyyyo..',
  '...oyyyyyyo...',
];
const FLAME_COLORS = {
  lit: { o: '#d96415', y: '#ffc12b' },
  dim: { o: '#3b3b3b', y: '#4a4a4a' },
};
const ARROW_W = 22;
const ARROW_H = 15;
const ARROW_SHAFT = { X1: 14, Y0: 5, Y1: 9 };

function flameDataUrl(variant) {
  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = FLAME_ART[0].length * scale;
  canvas.height = FLAME_ART.length * scale;
  const ctx = canvas.getContext('2d');
  const colors = FLAME_COLORS[variant];
  for (let y = 0; y < FLAME_ART.length; y++) {
    for (let x = 0; x < FLAME_ART[y].length; x++) {
      const c = FLAME_ART[y][x];
      if (c === '.') continue;
      ctx.fillStyle = colors[c];
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas.toDataURL();
}

function arrowInShape(x, y) {
  if (x < ARROW_SHAFT.X1) return y >= ARROW_SHAFT.Y0 && y <= ARROW_SHAFT.Y1;
  const half = Math.floor((ARROW_H - 1) / 2);
  return x - ARROW_SHAFT.X1 <= half - Math.abs(y - half);
}

function arrowDataUrl(color) {
  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = ARROW_W * scale;
  canvas.height = ARROW_H * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  for (let y = 0; y < ARROW_H; y++) {
    for (let x = 0; x < ARROW_W; x++) {
      if (arrowInShape(x, y)) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas.toDataURL();
}

// The brewing screen's downward arrow: the same shape transposed (shaft
// down from the top, head at the bottom), filled top-to-bottom as the brew
// progresses.
function downArrowDataUrl(color) {
  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = ARROW_H * scale;
  canvas.height = ARROW_W * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  for (let y = 0; y < ARROW_W; y++) {
    for (let x = 0; x < ARROW_H; x++) {
      if (arrowInShape(y, x)) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas.toDataURL();
}

export function createContainerSections({
  panel, attachSlotEvents, getChest, getFurnace, getBrewing,
}) {
  const style = document.createElement('style');
  style.textContent = `
    .screen-chest { margin-bottom: 14px; }
    .screen-furnace {
      display: flex; align-items: center; justify-content: center;
      gap: 16px; margin-bottom: 14px;
    }
    .screen-furnace-col {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
    }
    .screen-flame {
      position: relative; width: 42px; height: 42px;
      image-rendering: pixelated;
    }
    .screen-flame img {
      position: absolute; left: 0; bottom: 0; width: 42px; height: 42px;
      image-rendering: pixelated;
    }
    .screen-flame-fill {
      position: absolute; left: 0; bottom: 0; width: 42px; height: 0;
      overflow: hidden;
    }
    .screen-progress {
      position: relative; width: 66px; height: 45px;
      image-rendering: pixelated;
    }
    .screen-progress img {
      position: absolute; left: 0; top: 0; width: 66px; height: 45px;
      image-rendering: pixelated;
    }
    .screen-progress-fill {
      position: absolute; left: 0; top: 0; width: 0; height: 45px;
      overflow: hidden;
    }
    .screen-brewing {
      display: flex; align-items: flex-end; justify-content: center;
      gap: 18px; margin-bottom: 14px;
    }
    .screen-brew-fuel {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
    }
    .screen-brew-powder {
      width: ${UI.SCREEN_SLOT_PX}px; height: 8px; background: #3b3b3b;
      border: 1px solid #2a2a2a;
    }
    .screen-brew-powder > div {
      height: 100%; width: 0; background: #e8b64a;
    }
    .screen-brew-mid {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
    }
    .screen-brew-arrow {
      position: relative; width: 45px; height: 66px;
      image-rendering: pixelated;
    }
    .screen-brew-arrow img {
      position: absolute; left: 0; top: 0; width: 45px; height: 66px;
      image-rendering: pixelated;
    }
    .screen-brew-arrow-fill {
      position: absolute; left: 0; top: 0; width: 45px; height: 0;
      overflow: hidden;
    }
    .screen-brew-bottles { display: flex; gap: 6px; }
  `;
  document.head.appendChild(style);

  // --- chest: a 9-wide grid of CHEST rows, rebound to whichever chest is
  // open.
  const chestSection = document.createElement('div');
  chestSection.className = 'screen-grid screen-chest';
  const chestCellEls = [];
  for (let i = 0; i < CHEST_SLOTS; i++) {
    const el = document.createElement('div');
    el.className = 'screen-slot';
    attachSlotEvents(el, () => getChest()?.container, i);
    chestSection.appendChild(el);
    chestCellEls.push(el);
  }
  panel.appendChild(chestSection);

  // --- furnace: input over flame over fuel, progress arrow, output.
  const furnaceSection = document.createElement('div');
  furnaceSection.className = 'screen-furnace';
  const furnaceSlotEls = [];
  let flameFillEl = null;
  let arrowFillEl = null;
  {
    const col = document.createElement('div');
    col.className = 'screen-furnace-col';
    const makeSlot = (slotIndex) => {
      const el = document.createElement('div');
      el.className = 'screen-slot';
      attachSlotEvents(el, getFurnace, slotIndex);
      furnaceSlotEls[slotIndex] = el;
      return el;
    };
    col.appendChild(makeSlot(SLOT_INPUT));
    const flame = document.createElement('div');
    flame.className = 'screen-flame';
    const flameBg = document.createElement('img');
    flameBg.src = flameDataUrl('dim');
    flame.appendChild(flameBg);
    flameFillEl = document.createElement('div');
    flameFillEl.className = 'screen-flame-fill';
    const flameLit = document.createElement('img');
    flameLit.src = flameDataUrl('lit');
    flameFillEl.appendChild(flameLit);
    flame.appendChild(flameFillEl);
    col.appendChild(flame);
    col.appendChild(makeSlot(SLOT_FUEL));
    furnaceSection.appendChild(col);

    const progress = document.createElement('div');
    progress.className = 'screen-progress';
    const arrowBg = document.createElement('img');
    arrowBg.src = arrowDataUrl('#5a5a5a');
    progress.appendChild(arrowBg);
    arrowFillEl = document.createElement('div');
    arrowFillEl.className = 'screen-progress-fill';
    const arrowLit = document.createElement('img');
    arrowLit.src = arrowDataUrl('#ffffff');
    arrowFillEl.appendChild(arrowLit);
    progress.appendChild(arrowFillEl);
    furnaceSection.appendChild(progress);

    furnaceSection.appendChild(makeSlot(SLOT_OUTPUT));
  }
  panel.appendChild(furnaceSection);

  // --- brewing (Phase 18): fuel column (blaze powder slot + powder bar),
  // then ingredient over a downward progress arrow over the three bottle
  // slots.
  const brewingSection = document.createElement('div');
  brewingSection.className = 'screen-brewing';
  const brewSlotEls = [];
  let brewArrowFillEl = null;
  let brewPowderFillEl = null;
  {
    const makeSlot = (slotIndex) => {
      const el = document.createElement('div');
      el.className = 'screen-slot';
      attachSlotEvents(el, getBrewing, slotIndex);
      brewSlotEls[slotIndex] = el;
      return el;
    };
    const fuelCol = document.createElement('div');
    fuelCol.className = 'screen-brew-fuel';
    fuelCol.appendChild(makeSlot(BREW_SLOT_FUEL));
    const powder = document.createElement('div');
    powder.className = 'screen-brew-powder';
    brewPowderFillEl = document.createElement('div');
    powder.appendChild(brewPowderFillEl);
    fuelCol.appendChild(powder);
    brewingSection.appendChild(fuelCol);

    const mid = document.createElement('div');
    mid.className = 'screen-brew-mid';
    mid.appendChild(makeSlot(BREW_SLOT_INGREDIENT));
    const arrow = document.createElement('div');
    arrow.className = 'screen-brew-arrow';
    const arrowBg = document.createElement('img');
    arrowBg.src = downArrowDataUrl('#5a5a5a');
    arrow.appendChild(arrowBg);
    brewArrowFillEl = document.createElement('div');
    brewArrowFillEl.className = 'screen-brew-arrow-fill';
    const arrowLit = document.createElement('img');
    arrowLit.src = downArrowDataUrl('#ffffff');
    brewArrowFillEl.appendChild(arrowLit);
    arrow.appendChild(brewArrowFillEl);
    mid.appendChild(arrow);
    const bottles = document.createElement('div');
    bottles.className = 'screen-brew-bottles';
    for (const i of BOTTLE_SLOTS) bottles.appendChild(makeSlot(i));
    mid.appendChild(bottles);
    brewingSection.appendChild(mid);
  }
  panel.appendChild(brewingSection);

  // --- per-frame indicators (screens.update polls; slot changes re-render
  // through the container subscription like always)
  function updateIndicators(mode) {
    if (mode === 'furnace') {
      const furnace = getFurnace();
      if (!furnace) return;
      flameFillEl.style.height = `${(furnace.fuelFraction * 100).toFixed(1)}%`;
      arrowFillEl.style.width = `${(furnace.progressFraction * 100).toFixed(1)}%`;
    } else if (mode === 'brewing') {
      const stand = getBrewing();
      if (!stand) return;
      brewArrowFillEl.style.height = `${(stand.progressFraction * 100).toFixed(1)}%`;
      brewPowderFillEl.style.width = `${(stand.fuelFraction * 100).toFixed(1)}%`;
    }
  }

  // Show the active mode's section and render its slots.
  function refresh(mode, iconPx) {
    chestSection.style.display = mode === 'chest' ? 'grid' : 'none';
    const chest = getChest();
    if (mode === 'chest' && chest) {
      for (let i = 0; i < chestCellEls.length; i++) {
        renderSlotContent(chestCellEls[i], chest.container.get(i), iconPx);
      }
    }
    furnaceSection.style.display = mode === 'furnace' ? 'flex' : 'none';
    const furnace = getFurnace();
    if (mode === 'furnace' && furnace) {
      for (const idx of [SLOT_INPUT, SLOT_FUEL, SLOT_OUTPUT]) {
        renderSlotContent(furnaceSlotEls[idx], furnace.get(idx), iconPx);
      }
      updateIndicators(mode);
    }
    brewingSection.style.display = mode === 'brewing' ? 'flex' : 'none';
    const stand = getBrewing();
    if (mode === 'brewing' && stand) {
      for (const idx of [...BOTTLE_SLOTS, BREW_SLOT_INGREDIENT, BREW_SLOT_FUEL]) {
        renderSlotContent(brewSlotEls[idx], stand.get(idx), iconPx);
      }
      updateIndicators(mode);
    }
  }

  return { refresh, updateIndicators };
}
