// ui/screens.js — Screens over the running game. Phase 7 ships the inventory
// screen: E opens it (releasing pointer lock), showing the 27 main slots and
// the 9 hotbar slots. Interactions are the vanilla ones, all implemented by
// player/inventory.js:
//   - left click: pick up / put down / swap / merge (and press-drag-release
//     moves a stack in one gesture)
//   - right click: pick up half / place one
//   - shift click: move the stack between hotbar and main
// E or Esc closes it; whatever is still on the cursor goes back into the
// inventory (or drops at the player's feet if nothing fits).
// Crafting, furnace, death and victory screens arrive with later phases.

import { INVENTORY, UI } from '../config.js';
import { renderSlotContent } from './icons.js';

export function createScreens({ inventory, canvas, items, player }) {
  const iconPx = Math.round(UI.SCREEN_SLOT_PX * UI.ICON_SCALE);
  let open = false;
  let cursor = null;    // stack picked up onto the mouse cursor
  let downSlot = null;  // slot index the current left press started on

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
  title.textContent = 'Inventory';
  panel.appendChild(title);

  // Main slots (9..35) above, hotbar slots (0..8) below, like vanilla.
  const slotEls = new Array(INVENTORY.SIZE).fill(null);
  const makeGrid = (indices, extraClass) => {
    const grid = document.createElement('div');
    grid.className = `screen-grid${extraClass ? ` ${extraClass}` : ''}`;
    for (const i of indices) {
      const el = document.createElement('div');
      el.className = 'screen-slot';
      el.dataset.slot = String(i);
      attachSlotEvents(el, i);
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
    renderSlotContent(cursorEl, cursor, iconPx);
    cursorEl.style.display = cursor ? 'flex' : 'none';
  }
  inventory.subscribe(() => {
    if (open) refresh();
  });

  function moveCursorEl(e) {
    cursorEl.style.left = `${e.clientX}px`;
    cursorEl.style.top = `${e.clientY}px`;
  }

  // --- slot interactions

  function attachSlotEvents(el, i) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 0) {
        if (e.shiftKey) {
          inventory.shiftClick(i);
          downSlot = null;
        } else {
          cursor = inventory.clickSlot(i, cursor);
          downSlot = i;
        }
      } else if (e.button === 2) {
        cursor = inventory.rightClickSlot(i, cursor);
        downSlot = null;
      }
      refresh();
      moveCursorEl(e);
    });
    el.addEventListener('mouseup', (e) => {
      // Press-drag-release: releasing over a different slot drops the stack
      // there, so both click-click and drag-drop gestures work.
      if (e.button === 0 && cursor && downSlot !== null && downSlot !== i) {
        cursor = inventory.clickSlot(i, cursor);
        refresh();
      }
      downSlot = null;
    });
  }
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('mousemove', moveCursorEl);
  root.addEventListener('mouseup', () => {
    // A release outside any slot just ends the gesture; the stack stays on
    // the cursor for the next click.
    downSlot = null;
  });

  // --- open / close

  function openScreen() {
    if (open) return;
    open = true;
    document.body.classList.add('mc-screen-open');
    root.style.display = 'flex';
    document.exitPointerLock();
    refresh();
  }

  function closeScreen() {
    if (!open) return;
    open = false;
    downSlot = null;
    // Return the cursor stack; anything that truly doesn't fit drops at the
    // player's feet instead of vanishing.
    if (cursor) {
      const leftover = inventory.addStack(cursor);
      if (leftover > 0 && items) {
        const p = player.position;
        items.spawn(cursor.name, leftover, { x: p.x, y: p.y + 1, z: p.z });
      }
      cursor = null;
    }
    document.body.classList.remove('mc-screen-open');
    root.style.display = 'none';
    // Re-lock the pointer to resume play. The request can reject during the
    // browser's post-Esc cooldown — the "Click to play" hint covers that.
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  }

  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') {
      if (open) {
        e.preventDefault();
        closeScreen();
      } else if (document.pointerLockElement === canvas) {
        e.preventDefault();
        openScreen();
      }
    } else if (e.code === 'Escape' && open) {
      // Esc closes like vanilla (the pointer is already unlocked here)
      closeScreen();
    }
  });

  return {
    openScreen,
    closeScreen,
    refresh,
    get isOpen() {
      return open;
    },
    get cursor() {
      return cursor;
    },
  };
}
