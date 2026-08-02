// ui/screens.js — Screens over the running game. Phase 7 shipped the
// inventory screen, Phase 8 added crafting, Phase 10 adds generic container
// screens (a container = any SlotContainer bound to a block):
//   - the inventory screen (E) carries a 2x2 craft grid with a result slot
//   - right-clicking a crafting table opens the same panel with a 3x3 grid
//   - right-clicking a chest opens its persistent 27-slot grid
//   - right-clicking a furnace opens input/fuel/output with a progress
//     arrow (smelt fraction) and flame indicator (fuel unit remaining),
//     polled per frame via update(dt)
//   - the result slot previews the recipe match live; clicking it crafts
//     once onto the cursor, shift-clicking crafts as many as possible
//     straight into the inventory
//   - closing a screen returns craft-grid contents to the inventory (drops
//     what doesn't fit), then the cursor stack the same way; chest and
//     furnace contents STAY in their container — that's the point of them
// Slot interactions are the vanilla ones from player/inventory.js,
// systems/crafting.js and systems/smelting.js:
//   - left click: pick up / put down / swap / merge (and press-drag-release
//     moves a stack in one gesture)
//   - right click: pick up half / place one
//   - shift click: between hotbar and main — or, with a container open,
//     between the inventory and the container (furnace routes smeltables
//     to input and fuel to the fuel slot; its output slot never accepts)
// E or Esc closes. Death and victory screens arrive later.

import { INVENTORY, UI, CRAFTING } from '../config.js';
import { renderSlotContent } from './icons.js';
import { CraftingGrid } from '../systems/crafting.js';
import { SLOT_INPUT, SLOT_FUEL, SLOT_OUTPUT } from '../systems/smelting.js';
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

export function createScreens({ inventory, canvas, items, player }) {
  const iconPx = Math.round(UI.SCREEN_SLOT_PX * UI.ICON_SCALE);
  let open = false;
  let mode = 'inventory'; // 'inventory' | 'table' | 'chest' | 'furnace'
  let cursor = null;      // stack picked up onto the mouse cursor
  let downRef = null;     // { container, index } the current left press started on
  let activeChest = null;   // chest state (world/chests.js) while mode==='chest'
  let activeFurnace = null; // Furnace (systems/smelting.js) while mode==='furnace'
  let containerUnsub = null; // active container subscription teardown

  // The craft grids persist across opens (they are drained on every close,
  // so nothing can hide in a closed screen's grid).
  const invGrid = new CraftingGrid(CRAFTING.INVENTORY_GRID);
  const tableGrid = new CraftingGrid(CRAFTING.TABLE_GRID);
  const activeGrid = () => (mode === 'table' ? tableGrid : invGrid);
  const showsCraft = () => mode === 'inventory' || mode === 'table';
  // The open block container, if any — shift-clicks route into/out of it.
  const activeExternal = () =>
    mode === 'chest' ? activeChest?.container
      : mode === 'furnace' ? activeFurnace
      : null;

  // --- DOM
  const style = document.createElement('style');
  style.textContent = `
    #screen-root {
      position: fixed; inset: 0; z-index: 10; display: none;
      align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.45);
      user-select: none;
    }
    /* The lock hint never shows while a screen is open */
    body.mc-screen-open #lock-hint { display: none; }
    #screen-panel {
      background: #c6c6c6; padding: 14px 14px 16px;
      border: 3px solid; border-color: #ffffff #555555 #555555 #ffffff;
      border-radius: 3px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
    }
    #screen-panel h2 {
      margin: 0 0 10px 2px; color: #3f3f3f;
      font: bold 15px/1 monospace;
    }
    .screen-grid { display: grid; grid-template-columns: repeat(${INVENTORY.HOTBAR_SIZE}, ${UI.SCREEN_SLOT_PX}px); }
    .screen-hotbar { margin-top: 10px; }
    .screen-chest { margin-bottom: 14px; }
    .screen-slot {
      position: relative; box-sizing: border-box;
      width: ${UI.SCREEN_SLOT_PX}px; height: ${UI.SCREEN_SLOT_PX}px;
      display: flex; align-items: center; justify-content: center;
      background: #8b8b8b;
      border: 2px solid; border-color: #373737 #ffffff #ffffff #373737;
    }
    .screen-slot:hover { background: #a0a0a0; }
    .screen-craft {
      display: flex; align-items: center; justify-content: center;
      gap: 12px; margin-bottom: 14px;
    }
    .screen-craft-cells { display: grid; }
    .screen-craft-arrow {
      color: #6f6f6f; font: bold 30px/1 monospace;
      text-shadow: 1px 1px 0 #ffffff;
    }
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
    #screen-cursor {
      position: fixed; z-index: 11; pointer-events: none; display: none;
      width: ${UI.SCREEN_SLOT_PX}px; height: ${UI.SCREEN_SLOT_PX}px;
      transform: translate(-50%, -50%);
      align-items: center; justify-content: center;
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'screen-root';
  const panel = document.createElement('div');
  panel.id = 'screen-panel';
  const title = document.createElement('h2');
  panel.appendChild(title);

  // --- slot interactions

  // A container is the inventory, a CraftingGrid or a block container
  // (chest SlotContainer, Furnace) — all share the same click semantics.
  // `getContainer` resolves at event time so one set of chest/furnace slot
  // elements can serve whichever chest/furnace is currently open.
  function attachSlotEvents(el, getContainer, i) {
    el.addEventListener('mousedown', (e) => {
      const container = getContainer();
      if (!container) return;
      e.preventDefault();
      if (e.button === 0) {
        if (e.shiftKey) {
          shiftMove(container, i);
          downRef = null;
        } else {
          cursor = container.clickSlot(i, cursor);
          downRef = { container, index: i };
        }
      } else if (e.button === 2) {
        cursor = container.rightClickSlot(i, cursor);
        downRef = null;
      }
      refresh();
      moveCursorEl(e);
    });
    el.addEventListener('mouseup', (e) => {
      // Press-drag-release: releasing over a different slot drops the stack
      // there, so both click-click and drag-drop gestures work.
      const container = getContainer();
      if (!container) return;
      if (
        e.button === 0 && cursor && downRef &&
        (downRef.container !== container || downRef.index !== i)
      ) {
        cursor = container.clickSlot(i, cursor);
        refresh();
      }
      downRef = null;
    });
  }

  // Shift-click routing. With a block container open, stacks move between
  // it and the inventory (the furnace's addStack routes smeltables to the
  // input and fuel to the fuel slot; whatever the container refuses stays).
  // Otherwise the Phase 7/8 semantics: hotbar <-> main, craft grid -> out.
  function shiftMove(container, i) {
    const external = activeExternal();
    if (container === inventory) {
      if (external) inventory.moveSlotTo(i, external);
      else inventory.shiftClick(i);
    } else if (container === invGrid || container === tableGrid) {
      container.shiftOut(i, inventory);
    } else {
      container.moveSlotTo(i, inventory);
    }
  }

  // The result slot: click (either button) crafts once onto the cursor;
  // shift-click crafts the maximum into the inventory. Never a drop target.
  function attachResultEvents(el, grid) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button !== 0 && e.button !== 2) return;
      if (e.shiftKey) grid.craftMaxInto(inventory);
      else cursor = grid.takeResult(cursor);
      downRef = null;
      refresh();
      moveCursorEl(e);
    });
    el.addEventListener('mouseup', () => {
      downRef = null;
    });
  }

  // Craft area: one section per grid, the active mode's shown. Grid cells,
  // an arrow, then the result slot.
  function makeCraftSection(grid) {
    const section = document.createElement('div');
    section.className = 'screen-craft';
    const cells = document.createElement('div');
    cells.className = 'screen-craft-cells';
    cells.style.gridTemplateColumns = `repeat(${grid.width}, ${UI.SCREEN_SLOT_PX}px)`;
    const cellEls = [];
    for (let i = 0; i < grid.width * grid.width; i++) {
      const el = document.createElement('div');
      el.className = 'screen-slot';
      attachSlotEvents(el, () => grid, i);
      cells.appendChild(el);
      cellEls.push(el);
    }
    const arrow = document.createElement('div');
    arrow.className = 'screen-craft-arrow';
    arrow.textContent = '→';
    const resultEl = document.createElement('div');
    resultEl.className = 'screen-slot';
    attachResultEvents(resultEl, grid);
    section.appendChild(cells);
    section.appendChild(arrow);
    section.appendChild(resultEl);
    panel.appendChild(section);
    return { grid, section, cellEls, resultEl };
  }

  const craftSections = [
    makeCraftSection(invGrid),
    makeCraftSection(tableGrid),
  ];

  // Chest section: a 9-wide grid of CHEST rows, rebound to whichever chest
  // is open.
  const chestSection = document.createElement('div');
  chestSection.className = 'screen-grid screen-chest';
  const chestCellEls = [];
  {
    for (let i = 0; i < CHEST_SLOTS; i++) {
      const el = document.createElement('div');
      el.className = 'screen-slot';
      attachSlotEvents(el, () => activeChest?.container, i);
      chestSection.appendChild(el);
      chestCellEls.push(el);
    }
  }
  panel.appendChild(chestSection);

  // Furnace section: input over flame over fuel, progress arrow, output.
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
      attachSlotEvents(el, () => activeFurnace, slotIndex);
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

  // Main slots (9..35) above, hotbar slots (0..8) below, like vanilla.
  const slotEls = new Array(INVENTORY.SIZE).fill(null);
  const makeGrid = (indices, extraClass) => {
    const grid = document.createElement('div');
    grid.className = `screen-grid${extraClass ? ` ${extraClass}` : ''}`;
    for (const i of indices) {
      const el = document.createElement('div');
      el.className = 'screen-slot';
      el.dataset.slot = String(i);
      attachSlotEvents(el, () => inventory, i);
      grid.appendChild(el);
      slotEls[i] = el;
    }
    return grid;
  };
  const mainIndices = [];
  for (let i = INVENTORY.HOTBAR_SIZE; i < INVENTORY.SIZE; i++) mainIndices.push(i);
  const hotbarIndices = [];
  for (let i = 0; i < INVENTORY.HOTBAR_SIZE; i++) hotbarIndices.push(i);
  panel.appendChild(makeGrid(mainIndices));
  panel.appendChild(makeGrid(hotbarIndices, 'screen-hotbar'));
  root.appendChild(panel);
  document.body.appendChild(root);

  const cursorEl = document.createElement('div');
  cursorEl.id = 'screen-cursor';
  document.body.appendChild(cursorEl);

  // --- rendering

  function updateIndicators() {
    if (!activeFurnace) return;
    flameFillEl.style.height = `${(activeFurnace.fuelFraction * 100).toFixed(1)}%`;
    arrowFillEl.style.width = `${(activeFurnace.progressFraction * 100).toFixed(1)}%`;
  }

  function refresh() {
    for (let i = 0; i < INVENTORY.SIZE; i++) {
      renderSlotContent(slotEls[i], inventory.get(i), iconPx);
    }
    for (const s of craftSections) {
      const active = showsCraft() && s.grid === activeGrid();
      s.section.style.display = active ? 'flex' : 'none';
      if (!active) continue;
      for (let i = 0; i < s.cellEls.length; i++) {
        renderSlotContent(s.cellEls[i], s.grid.get(i), iconPx);
      }
      // Live recipe preview — a result stack that isn't in any container
      // until it's actually taken.
      const result = s.grid.result;
      renderSlotContent(s.resultEl, result, iconPx);
    }
    chestSection.style.display = mode === 'chest' ? 'grid' : 'none';
    if (mode === 'chest' && activeChest) {
      for (let i = 0; i < chestCellEls.length; i++) {
        renderSlotContent(chestCellEls[i], activeChest.container.get(i), iconPx);
      }
    }
    furnaceSection.style.display = mode === 'furnace' ? 'flex' : 'none';
    if (mode === 'furnace' && activeFurnace) {
      for (const idx of [SLOT_INPUT, SLOT_FUEL, SLOT_OUTPUT]) {
        renderSlotContent(furnaceSlotEls[idx], activeFurnace.get(idx), iconPx);
      }
      updateIndicators();
    }
    renderSlotContent(cursorEl, cursor, iconPx);
    cursorEl.style.display = cursor ? 'flex' : 'none';
  }
  inventory.subscribe(() => {
    if (open) refresh();
  });
  invGrid.subscribe(() => {
    if (open) refresh();
  });
  tableGrid.subscribe(() => {
    if (open) refresh();
  });

  function moveCursorEl(e) {
    cursorEl.style.left = `${e.clientX}px`;
    cursorEl.style.top = `${e.clientY}px`;
  }

  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('mousemove', moveCursorEl);
  root.addEventListener('mouseup', () => {
    // A release outside any slot just ends the gesture; the stack stays on
    // the cursor for the next click.
    downRef = null;
  });

  // --- open / close

  function openScreen(newMode = 'inventory') {
    if (open) return;
    open = true;
    mode = newMode;
    title.textContent =
      mode === 'table' ? 'Crafting'
        : mode === 'chest' ? 'Chest'
        : mode === 'furnace' ? 'Furnace'
        : 'Inventory';
    document.body.classList.add('mc-screen-open');
    root.style.display = 'flex';
    document.exitPointerLock();
    refresh();
  }

  // Right-clicking a crafting table (wired through main.js) lands here.
  function openCrafting() {
    openScreen('table');
  }

  // Right-clicking a chest: `chest` is the world/chests.js state — its
  // container renders in the panel and its lid opens while we're here.
  function openChest(chest) {
    if (open || !chest) return;
    activeChest = chest;
    chest.open = true;
    containerUnsub = chest.container.subscribe(() => {
      if (open) refresh();
    });
    openScreen('chest');
  }

  // Right-clicking a furnace: `furnace` is the systems/smelting.js Furnace.
  function openFurnace(furnace) {
    if (open || !furnace) return;
    activeFurnace = furnace;
    containerUnsub = furnace.subscribe(() => {
      if (open) refresh();
    });
    openScreen('furnace');
  }

  function dropAtFeet(name, count, durability) {
    if (!items) return;
    const p = player.position;
    items.spawn(name, count, { x: p.x, y: p.y + 1, z: p.z }, undefined, durability);
  }

  function closeScreen() {
    if (!open) return;
    open = false;
    downRef = null;
    // Craft-grid contents go back into the inventory (vanilla), then the
    // cursor stack; anything that truly doesn't fit drops at the player's
    // feet instead of vanishing — worn tools keep their durability through
    // the drop and back. Chest and furnace contents stay where they are.
    for (const grid of [invGrid, tableGrid]) {
      for (const o of grid.drainInto(inventory)) {
        dropAtFeet(o.name, o.count, o.durability ?? undefined);
      }
    }
    if (cursor) {
      const leftover = inventory.addStack(cursor);
      if (leftover > 0) dropAtFeet(cursor.name, leftover, cursor.durability);
      cursor = null;
    }
    if (containerUnsub) {
      containerUnsub();
      containerUnsub = null;
    }
    if (activeChest) {
      activeChest.open = false; // the lid eases shut
      activeChest = null;
    }
    activeFurnace = null;
    cursorEl.style.display = 'none'; // never leave the ghost over gameplay
    document.body.classList.remove('mc-screen-open');
    root.style.display = 'none';
    // Re-lock the pointer to resume play. The request can reject during the
    // browser's post-Esc cooldown — the "Click to play" hint covers that.
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  }

  // Per frame from main.js: the furnace indicators move continuously (slot
  // changes emit and re-render, but burn/progress only tick).
  function update() {
    if (open && mode === 'furnace') updateIndicators();
  }

  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') {
      if (e.repeat) return; // holding E must not flap the screen open/closed
      if (open) {
        e.preventDefault();
        closeScreen();
      } else if (document.pointerLockElement === canvas) {
        e.preventDefault();
        openScreen('inventory');
      }
    } else if (e.code === 'Escape' && open) {
      // Esc closes like vanilla (the pointer is already unlocked here)
      closeScreen();
    }
  });

  return {
    openScreen,
    openCrafting,
    openChest,
    openFurnace,
    closeScreen,
    refresh,
    update,
    invGrid,   // exposed for tests/debugging
    tableGrid,
    get isOpen() {
      return open;
    },
    get mode() {
      return mode;
    },
    get cursor() {
      return cursor;
    },
  };
}
