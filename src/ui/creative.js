// ui/creative.js — Phase 25: the CREATIVE INVENTORY.
//
// A separate screen from the survival one (ui/screens.js), opened with E while
// creative mode is on. It is a catalogue of every block and item in the game,
// sorted into the vanilla tabs, with a search field over the top and the
// player's own 36 slots underneath so things can be dragged straight into
// place.
//
// The catalogue is INFINITE by construction: nothing is ever taken out of it.
// A click builds a brand-new full stack and hands it to the inventory; a
// press-drag-release builds one and drops it in the slot released over. The
// same entry can be clicked forever. (The other half of "infinite" — placing
// a block never spending it — lives in player/inventory.js, where creative
// makes consumeSelected a no-op.)
//
// Gestures, all left button unless noted:
//   catalogue cell, click          a full stack into the inventory
//   catalogue cell, right click    exactly one item into the inventory
//   catalogue cell -> slot, drag   a full stack into that slot
//   inventory slot                 the ordinary pick-up/put-down/swap
//   backdrop, with a stack held    destroy it (vanilla's creative bin)
//
// The catalogue table at the top is UI data, so it lives here — the same way
// per-block data lives in world/blocks.js and per-mob data in entities/
// mobs.js. Every name in it is a real item this game can render and use.

import { INVENTORY, UI } from '../config.js';
import { renderSlotContent } from './icons.js';
import { itemMaxStack, itemMaxDurability } from '../player/inventory.js';

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const CREATIVE_TABS = [
  {
    key: 'building',
    label: 'Building Blocks',
    items: [
      'grass_block', 'dirt', 'stone', 'cobblestone', 'granite', 'diorite',
      'andesite', 'deepslate', 'cobbled_deepslate', 'sand', 'sandstone',
      'gravel', 'clay', 'oak_log', 'oak_planks', 'glass', 'white_wool',
      'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks',
      'obsidian', 'coal_block', 'iron_block', 'gold_block', 'diamond_block',
      'netherrack', 'nether_bricks', 'soul_sand', 'glowstone', 'end_stone',
      'coal_ore', 'iron_ore', 'gold_ore', 'redstone_ore', 'diamond_ore',
      'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore',
      'deepslate_redstone_ore', 'deepslate_diamond_ore',
      'cobblestone_stairs', 'oak_stairs', 'stone_brick_stairs',
      'sandstone_stairs', 'nether_brick_stairs',
      'cobblestone_slab', 'oak_slab', 'stone_brick_slab', 'sandstone_slab',
      'nether_brick_slab',
      'oak_fence', 'oak_fence_gate', 'cobblestone_wall', 'iron_bars',
    ],
  },
  {
    key: 'decoration',
    label: 'Decoration',
    items: [
      'oak_leaves', 'oak_sapling', 'short_grass', 'dandelion', 'poppy',
      'dead_bush', 'cactus', 'torch', 'ladder', 'oak_door', 'oak_trapdoor',
      'sign', 'bed', 'item_frame', 'flower_pot', 'bookshelf', 'chest',
      'glowstone', 'iron_bars', 'nether_wart',
    ],
  },
  {
    key: 'tools',
    label: 'Tools',
    items: [
      'wooden_pickaxe', 'wooden_axe', 'wooden_shovel', 'wooden_hoe',
      'stone_pickaxe', 'stone_axe', 'stone_shovel', 'stone_hoe',
      'iron_pickaxe', 'iron_axe', 'iron_shovel', 'iron_hoe',
      'golden_pickaxe', 'golden_axe', 'golden_shovel', 'golden_hoe',
      'diamond_pickaxe', 'diamond_axe', 'diamond_shovel', 'diamond_hoe',
      'shears', 'flint_and_steel', 'bucket', 'water_bucket', 'lava_bucket',
    ],
  },
  {
    key: 'combat',
    label: 'Combat',
    items: [
      'wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword',
      'diamond_sword', 'bow', 'arrow', 'shield',
      // (no golden armour — this project ships the leather/iron/diamond
      // sprites and the three SPEC sets, and an entry with no art would be
      // a blank tile)
      'leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots',
      'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
      'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
    ],
  },
  {
    key: 'food',
    label: 'Food',
    items: [
      'apple', 'golden_apple', 'bread', 'beef', 'cooked_beef', 'porkchop',
      'cooked_porkchop', 'chicken', 'cooked_chicken', 'mutton',
      'cooked_mutton', 'carrot', 'potato', 'baked_potato', 'melon_slice',
      'mushroom_stew', 'rotten_flesh', 'milk_bucket',
    ],
  },
  {
    key: 'materials',
    label: 'Materials',
    items: [
      'stick', 'coal', 'charcoal', 'raw_iron', 'iron_ingot', 'iron_nugget',
      'raw_gold', 'gold_ingot', 'gold_nugget', 'diamond', 'redstone',
      'quartz', 'flint', 'clay_ball', 'brick', 'leather', 'string',
      'feather', 'gunpowder', 'bone', 'bone_meal', 'egg', 'wheat',
      'wheat_seeds', 'sugar', 'paper', 'book', 'blaze_rod', 'blaze_powder',
      'glowstone_dust', 'ender_pearl', 'ender_eye', 'ghast_tear',
      'magma_cream', 'spider_eye', 'fermented_spider_eye',
      'glistering_melon_slice', 'nether_wart',
    ],
  },
  {
    key: 'misc',
    label: 'Miscellaneous',
    items: [
      'crafting_table', 'furnace', 'chest', 'brewing_stand', 'glass_bottle',
      'water_bottle', 'awkward_potion', 'fire_resistance_potion',
      'strength_potion', 'healing_potion', 'bowl', 'bucket', 'spawner',
    ],
  },
];

// 'diamond_pickaxe' -> 'Diamond Pickaxe'. Used for the tooltip and, with the
// raw id, for the search match — so both "gold" and "gold_ingot" find it.
export function itemDisplayName(name) {
  return name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function matchesQuery(name, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return name.includes(q) || itemDisplayName(name).toLowerCase().includes(q);
}

// A brand-new stack of an item, at the item's own cap and full durability.
// Nothing is deducted from anywhere — this is the whole of "infinite".
function freshStack(name, count) {
  const durability = itemMaxDurability(name);
  const stack = { name, count: count ?? itemMaxStack(name) };
  if (durability != null) {
    stack.count = 1;
    stack.durability = durability;
  }
  return stack;
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function createCreativeScreen({ inventory, canvas }) {
  const C = UI.CREATIVE_SCREEN;
  const iconPx = Math.round(C.SLOT_PX * UI.ICON_SCALE);
  let open = false;
  let built = false;
  let activeTab = CREATIVE_TABS[0].key;
  let query = '';
  let cursor = null;       // the stack on the mouse
  let dragFromCatalogue = false; // this press started on a catalogue entry
  const cellEls = [];      // { el, name } for the active tab's grid
  const slotEls = new Array(INVENTORY.SIZE).fill(null);

  const style = document.createElement('style');
  style.textContent = `
    #creative-root {
      position: fixed; inset: 0; z-index: 10; display: none;
      align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.45); user-select: none;
    }
    #creative-panel {
      background: #c6c6c6; padding: 12px 14px 16px;
      border: 3px solid; border-color: #ffffff #555555 #555555 #ffffff;
      border-radius: 3px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
    }
    #creative-tabs {
      display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 10px;
    }
    .creative-tab {
      font: bold 12px/1 monospace; color: #3f3f3f; cursor: pointer;
      background: #9a9a9a; padding: 0 12px; height: ${C.TAB_PX}px;
      display: flex; align-items: center;
      border: 2px solid; border-color: #cfcfcf #5a5a5a #5a5a5a #cfcfcf;
    }
    .creative-tab:hover { background: #b0b0b0; }
    .creative-tab.active {
      background: #e2e2e2; color: #1f1f1f;
      border-color: #ffffff #6e6e6e #6e6e6e #ffffff;
    }
    #creative-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; margin-bottom: 8px;
    }
    #creative-title { margin: 0; color: #3f3f3f; font: bold 15px/1 monospace; }
    #creative-search {
      font: ${C.SEARCH_PX}px/1 monospace; padding: 6px 8px; width: 220px;
      background: #8b8b8b; color: #ffffff; outline: none;
      border: 2px solid; border-color: #373737 #ffffff #ffffff #373737;
    }
    #creative-search::placeholder { color: #dcdcdc; }
    #creative-grid {
      display: grid; margin: 0 auto;
      grid-template-columns: repeat(${C.COLUMNS}, ${C.SLOT_PX}px);
      width: ${C.COLUMNS * C.SLOT_PX}px;
      max-height: ${C.ROWS * C.SLOT_PX}px; overflow-y: auto; overflow-x: hidden;
      /* Reserve the scrollbar gutter outside the columns, so a tab that
         scrolls and a tab that doesn't line up at the same width. */
      scrollbar-gutter: stable;
      align-content: start;
    }
    #creative-empty {
      display: none; color: #4a4a4a; font: 13px/1 monospace;
      padding: 14px 4px 2px;
    }
    .creative-slot {
      position: relative; box-sizing: border-box;
      width: ${C.SLOT_PX}px; height: ${C.SLOT_PX}px;
      display: flex; align-items: center; justify-content: center;
      background: #8b8b8b; cursor: pointer;
      border: 2px solid; border-color: #373737 #ffffff #ffffff #373737;
    }
    .creative-slot:hover { background: #a8a8a8; }
    #creative-inv { margin: 12px auto 0; width: ${C.COLUMNS * C.SLOT_PX}px; }
    #creative-inv .creative-slot { cursor: default; }
    .creative-grid-row {
      display: grid; grid-template-columns: repeat(${INVENTORY.HOTBAR_SIZE}, ${C.SLOT_PX}px);
    }
    #creative-hotbar { margin-top: 10px; }
    #creative-hint {
      margin: 8px auto 0; color: #4a4a4a; font: 11px/1.6 monospace;
      max-width: ${C.COLUMNS * C.SLOT_PX}px; text-align: center;
    }
    #creative-cursor {
      position: fixed; z-index: 11; pointer-events: none; display: none;
      width: ${C.SLOT_PX}px; height: ${C.SLOT_PX}px;
      transform: translate(-50%, -50%);
      align-items: center; justify-content: center;
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'creative-root';
  const panel = document.createElement('div');
  panel.id = 'creative-panel';
  root.appendChild(panel);
  document.body.appendChild(root);

  const cursorEl = document.createElement('div');
  cursorEl.id = 'creative-cursor';
  document.body.appendChild(cursorEl);

  const head = document.createElement('div');
  head.id = 'creative-head';
  const title = document.createElement('h2');
  title.id = 'creative-title';
  title.textContent = 'Creative Inventory';
  const search = document.createElement('input');
  search.id = 'creative-search';
  search.type = 'text';
  search.placeholder = 'Search…';
  search.autocomplete = 'off';
  head.appendChild(title);
  head.appendChild(search);
  panel.appendChild(head);

  const tabsRow = document.createElement('div');
  tabsRow.id = 'creative-tabs';
  panel.appendChild(tabsRow);

  const grid = document.createElement('div');
  grid.id = 'creative-grid';
  panel.appendChild(grid);
  const emptyNote = document.createElement('div');
  emptyNote.id = 'creative-empty';
  emptyNote.textContent = 'Nothing matches that search.';
  panel.appendChild(emptyNote);

  const invWrap = document.createElement('div');
  invWrap.id = 'creative-inv';
  panel.appendChild(invWrap);

  const hint = document.createElement('div');
  hint.id = 'creative-hint';
  hint.innerHTML =
    'Click an item for a full stack · right-click for one · drag into a slot<br>' +
    'Click the search box to filter · drop outside the panel to destroy · ' +
    'E or Esc to close';
  panel.appendChild(hint);

  // --- cursor helpers -------------------------------------------------------

  function moveCursorEl(e) {
    cursorEl.style.left = `${e.clientX}px`;
    cursorEl.style.top = `${e.clientY}px`;
  }

  function drawCursor() {
    renderSlotContent(cursorEl, cursor, iconPx);
    cursorEl.style.display = cursor ? 'flex' : 'none';
  }

  // Hand a stack to the inventory. Anything that doesn't fit stays on the
  // cursor so it is visibly not lost (creative has no "drop at feet" — the
  // player can always fetch another).
  function give(stack) {
    const left = inventory.addStack(stack);
    cursor = left > 0 ? { ...stack, count: left } : null;
    drawCursor();
  }

  // --- the tabs -------------------------------------------------------------

  for (const tab of CREATIVE_TABS) {
    const el = document.createElement('div');
    el.className = 'creative-tab';
    el.textContent = tab.label;
    el.dataset.tab = tab.key;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      activeTab = tab.key;
      buildGrid();
      syncTabs();
    });
    tabsRow.appendChild(el);
  }

  function syncTabs() {
    for (const el of tabsRow.children) {
      el.classList.toggle('active', el.dataset.tab === activeTab);
    }
  }

  // --- the catalogue grid ---------------------------------------------------

  function buildGrid() {
    grid.textContent = '';
    cellEls.length = 0;
    const tab = CREATIVE_TABS.find((t) => t.key === activeTab) ?? CREATIVE_TABS[0];
    // A search spans EVERY tab (vanilla's search tab), so typing finds an
    // item without knowing which drawer it lives in.
    const names = query
      ? [...new Set(CREATIVE_TABS.flatMap((t) => t.items))].filter((n) => matchesQuery(n, query))
      : tab.items;
    for (const name of names) {
      const el = document.createElement('div');
      el.className = 'creative-slot';
      el.title = itemDisplayName(name);
      // Drawn as a single item: the catalogue is a list of THINGS, and a "64"
      // stamped on all 188 of them is noise (vanilla shows no count here).
      // What a click hands over is still a full stack — freshStack decides
      // that, not what the tile draws.
      renderSlotContent(el, { name, count: 1 }, iconPx);
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (e.button === 2) {
          // Right click: exactly one, straight into the inventory.
          if (!cursor) give(freshStack(name, 1));
          return;
        }
        if (e.button !== 0) return;
        // Holding a stack already? Drop it back into the void (the entry is
        // a bottomless source, so putting something back is a delete).
        cursor = freshStack(name);
        dragFromCatalogue = true;
        drawCursor();
        moveCursorEl(e);
      });
      el.addEventListener('mouseup', (e) => {
        if (e.button !== 0 || !dragFromCatalogue || !cursor) return;
        // Pressed AND released on the entry — a plain click, so the stack
        // goes into the inventory rather than staying on the cursor.
        dragFromCatalogue = false;
        give(cursor);
      });
      grid.appendChild(el);
      cellEls.push({ el, name });
    }
    emptyNote.style.display = names.length === 0 ? 'block' : 'none';
    grid.scrollTop = 0;
    built = true;
  }

  // --- the player's own slots ----------------------------------------------

  const makeRow = (indices, id) => {
    const row = document.createElement('div');
    row.className = 'creative-grid-row';
    if (id) row.id = id;
    for (const i of indices) {
      const el = document.createElement('div');
      el.className = 'creative-slot';
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragFromCatalogue = false;
        cursor = e.button === 2
          ? inventory.rightClickSlot(i, cursor)
          : inventory.clickSlot(i, cursor);
        drawCursor();
        moveCursorEl(e);
      });
      el.addEventListener('mouseup', (e) => {
        // Press-drag-release out of the catalogue lands the stack here.
        if (e.button !== 0 || !cursor || !dragFromCatalogue) return;
        dragFromCatalogue = false;
        cursor = inventory.clickSlot(i, cursor);
        drawCursor();
      });
      row.appendChild(el);
      slotEls[i] = el;
    }
    return row;
  };
  const mainIndices = [];
  for (let i = INVENTORY.HOTBAR_SIZE; i < INVENTORY.SIZE; i++) mainIndices.push(i);
  const hotbarIndices = [];
  for (let i = 0; i < INVENTORY.HOTBAR_SIZE; i++) hotbarIndices.push(i);
  invWrap.appendChild(makeRow(mainIndices));
  invWrap.appendChild(makeRow(hotbarIndices, 'creative-hotbar'));

  function refresh() {
    for (let i = 0; i < INVENTORY.SIZE; i++) {
      renderSlotContent(slotEls[i], inventory.get(i), iconPx);
    }
    drawCursor();
  }
  inventory.subscribe(() => {
    if (open) refresh();
  });

  // --- input ----------------------------------------------------------------

  search.addEventListener('input', () => {
    query = search.value.trim();
    buildGrid();
  });
  // The world's key handlers are all pointer-lock gated, so typing here is
  // safe — except for this screen's own E, which must not close the panel
  // mid-word. Escape always closes, from the field or not.
  search.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.code === 'Escape') {
      search.blur();
      closeScreen();
    }
  });

  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('mousemove', moveCursorEl);
  root.addEventListener('mouseup', () => {
    // A release over nothing in particular just ends the gesture; the stack
    // stays on the cursor for the next click.
    dragFromCatalogue = false;
  });
  // The backdrop is the creative bin: a stack dropped outside the panel is
  // destroyed (vanilla). Nothing is lost — the catalogue still has it.
  root.addEventListener('mousedown', (e) => {
    if (e.target !== root) return;
    e.preventDefault();
    if (cursor) {
      cursor = null;
      drawCursor();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.target === search) return; // handled above; never eat a keystroke
    if (e.code === 'KeyE' || e.code === 'Escape') {
      if (e.repeat) return;
      e.preventDefault();
      closeScreen();
    }
  });

  // --- open / close ---------------------------------------------------------

  function openScreen() {
    if (open) return;
    open = true;
    if (!built) {
      syncTabs();
      buildGrid();
    }
    document.body.classList.add('mc-screen-open');
    root.style.display = 'flex';
    document.exitPointerLock();
    refresh();
    // Deliberately NOT auto-focused. E is the key that opens this screen and
    // the key that closes it; if the caret sat in the search field on open,
    // that second press would type an "e" instead, and the screen would look
    // stuck. Click the field to search — the hint at the foot says so.
  }

  function closeScreen(relock = true) {
    if (!open) return;
    open = false;
    // A stack left on the cursor goes into the inventory if it fits and is
    // simply discarded if it doesn't — creative can always make another.
    if (cursor) {
      inventory.addStack(cursor);
      cursor = null;
      drawCursor();
    }
    dragFromCatalogue = false;
    search.blur();
    document.body.classList.remove('mc-screen-open');
    root.style.display = 'none';
    if (!relock) return;
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  }

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
    // Test/debug scaffolding: the names on show right now.
    get visibleItems() {
      return cellEls.map((c) => c.name);
    },
  };
}
