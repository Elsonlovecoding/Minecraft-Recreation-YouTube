// ui/screens.js — Screens over the running game. Phase 7 shipped the
// inventory screen, Phase 8 added crafting, Phase 10 generic container
// screens, Phase 18 the brewing stand (and the mandated split: the
// chest/furnace/brewing container SECTIONS live in ui/containers.js now —
// this file keeps the panel, cursor and slot machinery, the craft grids,
// the equip row and the open/close flow):
//   - the inventory screen (E) carries a 2x2 craft grid with a result slot
//   - right-clicking a crafting table opens the same panel with a 3x3 grid
//   - right-clicking a chest opens its persistent 27-slot grid
//   - right-clicking a furnace opens input/fuel/output with a progress
//     arrow and flame indicator, polled per frame via update(dt)
//   - right-clicking a brewing stand (Phase 18) opens ingredient over three
//     bottle slots with a downward progress arrow and blaze-powder bar
//   - the result slot previews the recipe match live; clicking it crafts
//     once onto the cursor, shift-clicking crafts as many as possible
//     straight into the inventory
//   - closing a screen returns craft-grid contents to the inventory (drops
//     what doesn't fit), then the cursor stack the same way; chest, furnace
//     and brewing-stand contents STAY in their container — that's the point
// Slot interactions are the vanilla ones from player/inventory.js,
// systems/crafting.js, systems/smelting.js and systems/brewing.js:
//   - left click: pick up / put down / swap / merge (and press-drag-release
//     moves a stack in one gesture)
//   - right click: pick up half / place one
//   - shift click: between hotbar and main — or, with a container open,
//     between the inventory and the container (furnace routes smeltables
//     to input and fuel to the fuel slot; the brewing stand routes bottles
//     to bottle slots, powder to fuel, ingredients to the ingredient slot;
//     gated output/ingredient slots never accept what they shouldn't)
// E or Esc closes. Phase 11 additions:
//   - clicking the dark backdrop OUTSIDE the panel with a stack on the
//     cursor throws it into the world along the camera direction (left
//     click the whole stack, right click a single item — vanilla)
//   - the death screen (stats.js drives it through main.js): "You died!"
//     over a red-tinted overlay, a Respawn button, input held until respawn
//   - the victory screen (Phase 20 — the SPEC win condition): shown when
//     the player enters the activated exit portal after killing the
//     dragon; a Return Home button travels back to the overworld spawn

import * as THREE from 'three';
import { INVENTORY, UI, CRAFTING, ITEMS } from '../config.js';
import { renderSlotContent } from './icons.js';
import { createPlayerPreview } from './player_preview.js';
import { createContainerSections } from './containers.js';
import { CraftingGrid } from '../systems/crafting.js';
import { isFuel, smeltResult } from '../systems/smelting.js';
import { routableInBrewing } from '../systems/brewing.js';

export function createScreens({
  inventory, canvas, items, player, camera, onRespawn, onVictoryReturn,
}) {
  const iconPx = Math.round(UI.SCREEN_SLOT_PX * UI.ICON_SCALE);
  let open = false;
  let mode = 'inventory'; // 'inventory' | 'table' | 'chest' | 'furnace' | 'brewing'
  let cursor = null;      // stack picked up onto the mouse cursor
  let downRef = null;     // { container, index } the current left press started on
  let activeChest = null;   // chest state (world/chests.js) while mode==='chest'
  let activeFurnace = null; // Furnace (systems/smelting.js) while mode==='furnace'
  let activeBrewing = null; // BrewingStand (systems/brewing.js) while mode==='brewing'
  let containerUnsub = null; // active container subscription teardown
  let activeBlockPos = null; // { x, y, z, kind } of the open container's block —
                             // main.js closes the screen if that block goes away

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
      : mode === 'brewing' ? activeBrewing
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
    /* Armour column | player preview | offhand | 2x2 craft area (inventory
       mode; preview and offhand are Phase 14) */
    .screen-equip {
      display: flex; align-items: center; justify-content: center;
      gap: 14px; margin-bottom: 14px;
    }
    .screen-armour { display: grid; grid-template-columns: ${UI.SCREEN_SLOT_PX}px; }
    .player-preview {
      width: ${UI.PLAYER_PREVIEW.WIDTH_PX}px; height: ${UI.PLAYER_PREVIEW.HEIGHT_PX}px;
      background: #1c1c1c;
      border: 2px solid; border-color: #373737 #ffffff #ffffff #373737;
      box-sizing: content-box; overflow: hidden;
    }
    .player-preview canvas { display: block; }
    .screen-offhand {
      display: flex; flex-direction: column; justify-content: flex-end;
      align-self: stretch; padding-bottom: 2px;
    }
    .screen-equip .screen-craft { margin-bottom: 0; }
    .armour-slot::before {
      content: ''; position: absolute; inset: 0; margin: auto;
      width: ${Math.round(UI.SCREEN_SLOT_PX * UI.ICON_SCALE)}px;
      height: ${Math.round(UI.SCREEN_SLOT_PX * UI.ICON_SCALE)}px;
      background-size: contain; background-repeat: no-repeat;
      background-position: center; image-rendering: pixelated;
      opacity: 0.25; filter: grayscale(1); pointer-events: none;
    }
    .armour-slot.filled::before { display: none; }
    .armour-slot-0::before { background-image: url('assets/items/iron_helmet.png'); }
    .armour-slot-1::before { background-image: url('assets/items/iron_chestplate.png'); }
    .armour-slot-2::before { background-image: url('assets/items/iron_leggings.png'); }
    .armour-slot-3::before { background-image: url('assets/items/iron_boots.png'); }
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
    #death-root {
      position: fixed; inset: 0; z-index: 30; display: none;
      flex-direction: column; align-items: center; justify-content: center;
      background: rgba(110, 0, 0, 0.55);
      user-select: none;
    }
    #death-root h1 {
      color: #fff; font: bold 44px/1 monospace; margin: 0 0 28px;
      text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.6);
    }
    #death-respawn {
      font: bold 17px/1 monospace; color: #e8e8e8;
      background: #6f6f6f; padding: 12px 60px; cursor: pointer;
      border: 2px solid; border-color: #a8a8a8 #2f2f2f #2f2f2f #a8a8a8;
      box-shadow: 0 0 0 2px #000;
    }
    #death-respawn:hover { background: #7f8caf; color: #ffffa0; }
    #victory-root {
      position: fixed; inset: 0; z-index: 30; display: none;
      flex-direction: column; align-items: center; justify-content: center;
      background: rgba(28, 8, 48, 0.6);
      user-select: none;
    }
    #victory-root h1 {
      color: #d9c7ff; font: bold 52px/1 monospace; margin: 0 0 14px;
      text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.7), 0 0 24px #8a4fd0;
    }
    #victory-root p {
      color: #e8e0f8; font: 17px/1.6 monospace; margin: 0 0 30px;
      text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.6); text-align: center;
    }
    #victory-return {
      font: bold 17px/1 monospace; color: #e8e8e8;
      background: #6f6f6f; padding: 12px 60px; cursor: pointer;
      border: 2px solid; border-color: #a8a8a8 #2f2f2f #2f2f2f #a8a8a8;
      box-shadow: 0 0 0 2px #000;
    }
    #victory-return:hover { background: #8a6fb0; color: #ffe9a0; }
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
  // (chest SlotContainer, Furnace, BrewingStand) — all share the same click
  // semantics. `getContainer` resolves at event time so one set of DOM slot
  // elements can serve whichever chest/furnace/stand is currently open.
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
  // input and fuel to the fuel slot; the brewing stand routes bottles,
  // powder and ingredients to their slots). Vanilla details: an item the
  // container takes no interest in at all falls back to the hotbar <-> main
  // move; a chest accepts anything, and a FULL chest leaves the stack where
  // it is. Otherwise the Phase 7/8 semantics: hotbar <-> main, grid -> out.
  function shiftMove(container, i) {
    const external = activeExternal();
    if (container === inventory.armour) {
      container.moveSlotTo(i, inventory); // unequip back to the inventory
      return;
    }
    if (container === inventory) {
      const s = inventory.get(i);
      if (!external || !s) {
        // On the inventory screen an armour piece shift-equips into its
        // empty slot (vanilla); everything else hops hotbar <-> main.
        if (s && mode === 'inventory' && inventory.moveSlotTo(i, inventory.armour)) {
          return;
        }
        if (s) inventory.shiftClick(i);
        return;
      }
      const uninterested =
        (mode === 'furnace' && !smeltResult(s.name) && !isFuel(s.name)) ||
        (mode === 'brewing' && !routableInBrewing(s.name));
      if (uninterested) {
        inventory.shiftClick(i);
      } else {
        inventory.moveSlotTo(i, external);
      }
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

  // Armour column (Phase 13): four gated slots beside the inventory-mode
  // 2x2 craft area. Empty slots show a faint piece silhouette (the
  // .armour-slot-N ::before ghosts; `filled` hides them). Phase 14: the
  // equip row is armour | live 3D player preview | offhand slot | 2x2 —
  // the vanilla survival-inventory layout.
  const equipRow = document.createElement('div');
  equipRow.className = 'screen-equip';
  const armourCol = document.createElement('div');
  armourCol.className = 'screen-armour';
  const armourEls = [];
  for (let i = 0; i < inventory.armour.slots.length; i++) {
    const el = document.createElement('div');
    el.className = `screen-slot armour-slot armour-slot-${i}`;
    attachSlotEvents(el, () => inventory.armour, i);
    armourCol.appendChild(el);
    armourEls.push(el);
  }
  equipRow.appendChild(armourCol);
  const preview = createPlayerPreview({ inventory });
  equipRow.appendChild(preview.el);
  const offhandCol = document.createElement('div');
  offhandCol.className = 'screen-offhand';
  const offhandEl = document.createElement('div');
  offhandEl.className = 'screen-slot';
  attachSlotEvents(offhandEl, () => inventory.offhand, 0);
  offhandCol.appendChild(offhandEl);
  equipRow.appendChild(offhandCol);
  equipRow.appendChild(craftSections[0].section);
  panel.insertBefore(equipRow, craftSections[1].section);

  // Container screen sections (Phase 18 split — ui/containers.js): the
  // chest grid, the furnace and the brewing stand, bound to whichever
  // container is open at event time.
  const containers = createContainerSections({
    panel,
    attachSlotEvents,
    getChest: () => activeChest,
    getFurnace: () => activeFurnace,
    getBrewing: () => activeBrewing,
  });

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

  // --- death screen (Phase 11)
  const deathRoot = document.createElement('div');
  deathRoot.id = 'death-root';
  const deathTitle = document.createElement('h1');
  deathTitle.textContent = 'You died!';
  const respawnBtn = document.createElement('button');
  respawnBtn.id = 'death-respawn';
  respawnBtn.textContent = 'Respawn';
  deathRoot.appendChild(deathTitle);
  deathRoot.appendChild(respawnBtn);
  document.body.appendChild(deathRoot);
  let deathShown = false;
  respawnBtn.addEventListener('click', () => {
    if (!deathShown) return;
    deathShown = false;
    deathRoot.style.display = 'none';
    document.body.classList.remove('mc-screen-open');
    onRespawn?.();
    // Back to the game (the post-Esc cooldown rejection is swallowed — the
    // click-to-play hint covers it, same as closing a normal screen).
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  });

  // Shown by main.js when the player dies (any open container screen is
  // closed first, so its stacks drop at the death site with the inventory).
  function showDeath() {
    if (deathShown) return;
    deathShown = true;
    document.body.classList.add('mc-screen-open'); // suppresses the lock hint
    deathRoot.style.display = 'flex';
    document.exitPointerLock();
  }

  // --- victory screen (Phase 20 — the win condition)
  const victoryRoot = document.createElement('div');
  victoryRoot.id = 'victory-root';
  const victoryTitle = document.createElement('h1');
  victoryTitle.textContent = 'Victory!';
  const victoryText = document.createElement('p');
  victoryText.innerHTML =
    'The Ender Dragon has been defeated.<br>The End is conquered — the game is complete.';
  const victoryBtn = document.createElement('button');
  victoryBtn.id = 'victory-return';
  victoryBtn.textContent = 'Return Home';
  victoryRoot.appendChild(victoryTitle);
  victoryRoot.appendChild(victoryText);
  victoryRoot.appendChild(victoryBtn);
  document.body.appendChild(victoryRoot);
  let victoryShown = false;
  victoryBtn.addEventListener('click', () => {
    if (!victoryShown) return;
    victoryShown = false;
    victoryRoot.style.display = 'none';
    document.body.classList.remove('mc-screen-open');
    onVictoryReturn?.();
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  });

  // Shown by main.js when the player enters the active exit portal
  // (entities/dragon.js fires it edge-triggered). The world keeps running
  // behind the overlay, like the death screen.
  function showVictory() {
    if (victoryShown || deathShown) return;
    victoryShown = true;
    document.body.classList.add('mc-screen-open');
    victoryRoot.style.display = 'flex';
    document.exitPointerLock();
  }

  // --- rendering

  function refresh() {
    for (let i = 0; i < INVENTORY.SIZE; i++) {
      renderSlotContent(slotEls[i], inventory.get(i), iconPx);
    }
    equipRow.style.display = mode === 'inventory' ? 'flex' : 'none';
    for (let i = 0; i < armourEls.length; i++) {
      const stack = inventory.armour.get(i);
      renderSlotContent(armourEls[i], stack, iconPx);
      armourEls[i].classList.toggle('filled', !!stack);
    }
    renderSlotContent(offhandEl, inventory.offhandStack, iconPx);
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
    containers.refresh(mode, iconPx);
    renderSlotContent(cursorEl, cursor, iconPx);
    cursorEl.style.display = cursor ? 'flex' : 'none';
  }
  inventory.subscribe(() => {
    if (open) refresh();
  });
  inventory.armour.subscribe(() => {
    if (open) refresh();
  });
  inventory.offhand.subscribe(() => {
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
  root.addEventListener('mousemove', (e) => {
    moveCursorEl(e);
    preview.onMouseMove(e.clientX, e.clientY); // the model follows the mouse
  });
  root.addEventListener('mouseup', () => {
    // A release outside any slot just ends the gesture; the stack stays on
    // the cursor for the next click.
    downRef = null;
  });

  // Clicking the backdrop OUTSIDE the panel with a stack on the cursor
  // throws it into the world along the camera direction (vanilla): left
  // click the whole stack, right click one item.
  const throwDir = new THREE.Vector3();
  const throwFrom = new THREE.Vector3();
  function throwItem(name, count, durability) {
    camera.getWorldPosition(throwFrom); // the camera sits at the eye
    camera.getWorldDirection(throwDir);
    items.spawn(
      name, count,
      { x: throwFrom.x, y: throwFrom.y - ITEMS.THROW_EYE_DROP, z: throwFrom.z },
      {
        x: throwDir.x * ITEMS.THROW_SPEED,
        y: throwDir.y * ITEMS.THROW_SPEED + ITEMS.THROW_UP,
        z: throwDir.z * ITEMS.THROW_SPEED,
      },
      durability ?? undefined,
    );
  }
  root.addEventListener('mousedown', (e) => {
    if (e.target !== root || !cursor || !items) return;
    e.preventDefault();
    if (e.button === 0) {
      throwItem(cursor.name, cursor.count, cursor.durability);
      cursor = null;
    } else if (e.button === 2) {
      throwItem(cursor.name, 1, cursor.durability);
      cursor.count -= 1;
      if (cursor.count <= 0) cursor = null;
    } else {
      return;
    }
    downRef = null;
    refresh();
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
        : mode === 'brewing' ? 'Brewing Stand'
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
    activeBlockPos = { x: chest.x, y: chest.y, z: chest.z, kind: 'chest' };
    chest.open = true;
    containerUnsub = chest.container.subscribe(() => {
      if (open) refresh();
    });
    openScreen('chest');
  }

  // Right-clicking a furnace: `furnace` is the systems/smelting.js Furnace,
  // `pos` its block position (for the disappeared-block guard).
  function openFurnace(furnace, pos) {
    if (open || !furnace) return;
    activeFurnace = furnace;
    activeBlockPos = pos ? { x: pos.x, y: pos.y, z: pos.z, kind: 'furnace' } : null;
    containerUnsub = furnace.subscribe(() => {
      if (open) refresh();
    });
    openScreen('furnace');
  }

  // Right-clicking a brewing stand (Phase 18): `stand` is the
  // systems/brewing.js BrewingStand, `pos` its block position.
  function openBrewing(stand, pos) {
    if (open || !stand) return;
    activeBrewing = stand;
    activeBlockPos = pos ? { x: pos.x, y: pos.y, z: pos.z, kind: 'brewing' } : null;
    containerUnsub = stand.subscribe(() => {
      if (open) refresh();
    });
    openScreen('brewing');
  }

  function dropAtFeet(name, count, durability) {
    if (!items) return;
    const p = player.position;
    items.spawn(name, count, { x: p.x, y: p.y + 1, z: p.z }, undefined, durability);
  }

  // `relock` false skips re-requesting pointer lock — the death path closes
  // screens while the death overlay takes over the input.
  function closeScreen(relock = true) {
    if (!open) return;
    open = false;
    downRef = null;
    // Craft-grid contents go back into the inventory (vanilla), then the
    // cursor stack; anything that truly doesn't fit drops at the player's
    // feet instead of vanishing — worn tools keep their durability through
    // the drop and back. Chest, furnace and brewing contents stay put.
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
    activeBrewing = null;
    activeBlockPos = null;
    cursorEl.style.display = 'none'; // never leave the ghost over gameplay
    document.body.classList.remove('mc-screen-open');
    root.style.display = 'none';
    if (!relock) return;
    // Re-lock the pointer to resume play. The request can reject during the
    // browser's post-Esc cooldown — the "Click to play" hint covers that.
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  }

  // Per frame from main.js: the furnace/brewing indicators move
  // continuously (slot changes emit and re-render, but burn/progress only
  // tick), and the player preview renders while the inventory screen is up.
  function update(dt) {
    if (open && (mode === 'furnace' || mode === 'brewing')) {
      containers.updateIndicators(mode);
    }
    if (open && mode === 'inventory') preview.update(dt ?? 0);
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
    openBrewing,
    closeScreen,
    showDeath,
    showVictory,
    refresh,
    update,
    invGrid,   // exposed for tests/debugging
    tableGrid,
    get isOpen() {
      return open;
    },
    get isDeathShown() {
      return deathShown;
    },
    get isVictoryShown() {
      return victoryShown;
    },
    get mode() {
      return mode;
    },
    get cursor() {
      return cursor;
    },
    get activeBlockPos() {
      return activeBlockPos;
    },
  };
}
