// ui/screens.js — Screens over the running game. Phase 7 shipped the
// inventory screen; Phase 8 adds crafting to it and the crafting-table
// screen:
//   - the inventory screen (E) carries a 2x2 craft grid with a result slot
//   - right-clicking a crafting table opens the same panel with a 3x3 grid
//   - the result slot previews the recipe match live; clicking it crafts
//     once onto the cursor, shift-clicking crafts as many as possible
//     straight into the inventory
//   - closing a screen returns craft-grid contents to the inventory (drops
//     what doesn't fit), then the cursor stack the same way
// Slot interactions are the vanilla ones from player/inventory.js and
// systems/crafting.js:
//   - left click: pick up / put down / swap / merge (and press-drag-release
//     moves a stack in one gesture)
//   - right click: pick up half / place one
//   - shift click: move between hotbar and main, or out of the craft grid
// E or Esc closes. Furnace, death and victory screens arrive later.

import { INVENTORY, UI, CRAFTING } from '../config.js';
import { renderSlotContent } from './icons.js';
import { CraftingGrid } from '../systems/crafting.js';

export function createScreens({ inventory, canvas, items, player }) {
  const iconPx = Math.round(UI.SCREEN_SLOT_PX * UI.ICON_SCALE);
  let open = false;
  let mode = 'inventory'; // 'inventory' (2x2 grid) | 'table' (3x3 grid)
  let cursor = null;      // stack picked up onto the mouse cursor
  let downRef = null;     // { container, index } the current left press started on

  // The craft grids persist across opens (they are drained on every close,
  // so nothing can hide in a closed screen's grid).
  const invGrid = new CraftingGrid(CRAFTING.INVENTORY_GRID);
  const tableGrid = new CraftingGrid(CRAFTING.TABLE_GRID);
  const activeGrid = () => (mode === 'table' ? tableGrid : invGrid);

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
      attachSlotEvents(el, grid, i);
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

  // --- slot interactions

  // A container is the inventory or a CraftingGrid — both share the same
  // click/right-click semantics. Shift-click routes per container: between
  // hotbar and main inside the inventory, out of the grid otherwise.
  function attachSlotEvents(el, container, i) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 0) {
        if (e.shiftKey) {
          if (container === inventory) inventory.shiftClick(i);
          else container.shiftOut(i, inventory);
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

  const craftSections = [
    makeCraftSection(invGrid),
    makeCraftSection(tableGrid),
  ];

  // Main slots (9..35) above, hotbar slots (0..8) below, like vanilla.
  const slotEls = new Array(INVENTORY.SIZE).fill(null);
  const makeGrid = (indices, extraClass) => {
    const grid = document.createElement('div');
    grid.className = `screen-grid${extraClass ? ` ${extraClass}` : ''}`;
    for (const i of indices) {
      const el = document.createElement('div');
      el.className = 'screen-slot';
      el.dataset.slot = String(i);
      attachSlotEvents(el, inventory, i);
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

  function refresh() {
    for (let i = 0; i < INVENTORY.SIZE; i++) {
      renderSlotContent(slotEls[i], inventory.get(i), iconPx);
    }
    for (const s of craftSections) {
      const active = s.grid === activeGrid();
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
    title.textContent = mode === 'table' ? 'Crafting' : 'Inventory';
    document.body.classList.add('mc-screen-open');
    root.style.display = 'flex';
    document.exitPointerLock();
    refresh();
  }

  // Right-clicking a crafting table (wired through main.js) lands here.
  function openCrafting() {
    openScreen('table');
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
    // the drop and back.
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
    cursorEl.style.display = 'none'; // never leave the ghost over gameplay
    document.body.classList.remove('mc-screen-open');
    root.style.display = 'none';
    // Re-lock the pointer to resume play. The request can reject during the
    // browser's post-Esc cooldown — the "Click to play" hint covers that.
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
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
    closeScreen,
    refresh,
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
