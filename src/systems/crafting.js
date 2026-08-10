// systems/crafting.js — Phase 8: recipes and grid matching. The recipe
// registry holds every critical-path recipe from SPEC.md (shaped and
// shapeless); craftResult matches a crafting grid (2x2 in the inventory
// screen, 3x3 at a crafting table) against it; CraftingGrid is the slot
// container the screens use — grid clicks share the tested Phase 7 slot
// semantics, taking the result consumes one ingredient per occupied cell,
// and shift-clicking the result crafts as many as the ingredients and the
// inventory allow.
//
// Pure logic — no DOM, no three.js — so node tests drive it directly.
//
// Shaped recipes match anywhere in the grid (the occupied bounding box is
// compared against the pattern) and, like vanilla, also match horizontally
// mirrored. A pattern larger than the grid can never match, which is what
// makes 3x3 recipes (pickaxe, furnace...) require the crafting table.
//
// SPEC note: SPEC.md lists identical ingredients for sword and shovel
// ("1 material + 2 sticks"), so only shape can tell them apart — the shapes
// used are the vanilla ones a Minecraft player will try (sword = 2 material
// over 1 stick; shovel = 1 material over 2 sticks; pickaxe T; axe corner).

import { Inventory, itemMaxStack, itemMaxDurability } from '../player/inventory.js';

// ---------------------------------------------------------------------------
// Recipe registry (per-recipe data lives here, like per-block data lives in
// world/blocks.js; global tunables stay in config.js)
// ---------------------------------------------------------------------------

export const RECIPES = [];

// Shaped: `pattern` is rows of key characters (space = empty), `key` maps a
// character to an item name. Stored trimmed, so matching is just a bounding
// box comparison. The horizontally mirrored variant is precomputed (null
// when the pattern is symmetric).
function shaped(pattern, key, result, count = 1) {
  const h = pattern.length;
  const w = Math.max(...pattern.map((row) => row.length));
  const cells = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = pattern[y][x] ?? ' ';
      if (ch !== ' ' && !(ch in key)) throw new Error(`recipe key missing '${ch}'`);
      cells.push(ch === ' ' ? null : key[ch]);
    }
  }
  const mirrored = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) mirrored.push(cells[y * w + (w - 1 - x)]);
  }
  const symmetric = cells.every((c, i) => c === mirrored[i]);
  RECIPES.push({
    w, h, cells, mirrored: symmetric ? null : mirrored,
    result: { name: result, count },
  });
}

// Shapeless: the grid's occupied cells must be exactly this multiset of
// item names, in any arrangement (each cell contributes one item).
function shapeless(ingredients, result, count = 1) {
  RECIPES.push({
    ingredients: [...ingredients].sort(),
    result: { name: result, count },
  });
}

// --- the SPEC.md critical path ---------------------------------------------

shapeless(['oak_log'], 'oak_planks', 4);
shaped(['P', 'P'], { P: 'oak_planks' }, 'stick', 4);
shaped(['PP', 'PP'], { P: 'oak_planks' }, 'crafting_table');
shaped(['CCC', 'C C', 'CCC'], { C: 'cobblestone' }, 'furnace');
// Phase 10: the chest has a container UI now, so the vanilla recipe ships.
shaped(['PPP', 'P P', 'PPP'], { P: 'oak_planks' }, 'chest');

// Tools: one recipe per material tier, vanilla shapes. S = stick.
// Phase 21 added the GOLD tier (fastest mining of any tier, 33 durability —
// the real Minecraft trade) and the hoe in all five tiers (craftable, with
// no function in a game without farming — SPEC has no crops).
const TOOL_MATERIALS = {
  wooden: 'oak_planks',
  stone: 'cobblestone',
  iron: 'iron_ingot',
  golden: 'gold_ingot',
  diamond: 'diamond',
};
for (const [tier, M] of Object.entries(TOOL_MATERIALS)) {
  const key = { M, S: 'stick' };
  shaped(['MMM', ' S ', ' S '], key, `${tier}_pickaxe`);
  shaped(['M', 'M', 'S'], key, `${tier}_sword`);
  shaped(['MM', 'MS', ' S'], key, `${tier}_axe`); // mirrored matches too
  shaped(['M', 'S', 'S'], key, `${tier}_shovel`);
  shaped(['MM', ' S', ' S'], key, `${tier}_hoe`); // mirrored matches too
}

// Phase 21: coal OR charcoal lights a torch (vanilla — charcoal is the
// no-mining path to light, and smelting a log is its only source here).
shaped(['C', 'S'], { C: 'coal', S: 'stick' }, 'torch', 4);
shaped(['C', 'S'], { C: 'charcoal', S: 'stick' }, 'torch', 4);
shapeless(['iron_ingot', 'flint'], 'flint_and_steel');
shaped(['I I', ' I '], { I: 'iron_ingot' }, 'bucket');
shaped([' SX', 'S X', ' SX'], { S: 'stick', X: 'string' }, 'bow');
shaped(['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' }, 'arrow', 4);

// Armour: standard vanilla shapes per SPEC's armour sets.
const ARMOR_MATERIALS = {
  leather: 'leather',
  iron: 'iron_ingot',
  diamond: 'diamond',
};
for (const [set, M] of Object.entries(ARMOR_MATERIALS)) {
  const key = { M };
  shaped(['MMM', 'M M'], key, `${set}_helmet`);
  shaped(['M M', 'MMM', 'MMM'], key, `${set}_chestplate`);
  shaped(['MMM', 'M M', 'M M'], key, `${set}_leggings`);
  shaped(['M M', 'M M'], key, `${set}_boots`);
}

shaped([' B ', 'CCC'], { B: 'blaze_rod', C: 'cobblestone' }, 'brewing_stand');
shapeless(['blaze_rod'], 'blaze_powder', 2);
shapeless(['blaze_powder', 'ender_pearl'], 'ender_eye');
shaped(['G G', ' G '], { G: 'glass' }, 'glass_bottle'); // SPEC: 1 bottle from 3 glass

// ---------------------------------------------------------------------------
// Phase 21 — the polish pass: everything a Minecraft player reaches for once
// the critical path is done, restricted to materials this game actually
// yields (no farming, no redstone, no dyes, no paper).
// ---------------------------------------------------------------------------

// --- combat and utility tools ---------------------------------------------

shaped(['PIP', 'PPP', ' P '], { P: 'oak_planks', I: 'iron_ingot' }, 'shield');
shaped([' I', 'I '], { I: 'iron_ingot' }, 'shears'); // mirrored matches too

// --- building blocks -------------------------------------------------------

// Stairs (4 per recipe) and slabs (6) for every material the game mines.
// The step pattern's mirror matches too, so either hand works.
const BUILDING_MATERIALS = {
  cobblestone: 'cobblestone',
  oak: 'oak_planks',
  stone_brick: 'stone_bricks',
  sandstone: 'sandstone',
  nether_brick: 'nether_bricks',
};
for (const [key, M] of Object.entries(BUILDING_MATERIALS)) {
  shaped(['M  ', 'MM ', 'MMM'], { M }, `${key}_stairs`, 4);
  shaped(['MMM'], { M }, `${key}_slab`, 6);
}

shaped(['PSP', 'PSP'], { P: 'oak_planks', S: 'stick' }, 'oak_fence', 3);
shaped(['SPS', 'SPS'], { P: 'oak_planks', S: 'stick' }, 'oak_fence_gate');
shaped(['CCC', 'CCC'], { C: 'cobblestone' }, 'cobblestone_wall', 6);

// --- utility ---------------------------------------------------------------

shaped(['S S', 'SSS', 'S S'], { S: 'stick' }, 'ladder', 3); // 7 sticks
shaped(['PP', 'PP', 'PP'], { P: 'oak_planks' }, 'oak_door', 3);
shaped(['PPP', 'PPP'], { P: 'oak_planks' }, 'oak_trapdoor', 2);
shaped(['WWW', 'PPP'], { W: 'white_wool', P: 'oak_planks' }, 'bed');
shaped(['PPP', 'PPP', ' S '], { P: 'oak_planks', S: 'stick' }, 'sign', 3);

// --- decoration ------------------------------------------------------------

// Paper has no source in this game, so a book is three leather (the session
// brief's substitution) — cows are the supply line.
shapeless(['leather', 'leather', 'leather'], 'book');
shaped(['PPP', 'BBB', 'PPP'], { P: 'oak_planks', B: 'book' }, 'bookshelf');
shaped(['SSS', 'SLS', 'SSS'], { S: 'stick', L: 'leather' }, 'item_frame');
// Vanilla's flower pot is fired clay, which this game can't make; sandstone
// is the closest obtainable earthenware (and the tile the pot renders with).
shaped(['S S', ' S '], { S: 'sandstone' }, 'flower_pot');

// --- materials -------------------------------------------------------------

shaped(['SS', 'SS'], { S: 'stone' }, 'stone_bricks', 4);
shaped(['SS', 'SS'], { S: 'sand' }, 'sandstone');

// Block forms, both ways (9 ingots to a block, a block back to 9).
const BLOCK_FORMS = [
  ['iron_ingot', 'iron_block'],
  ['gold_ingot', 'gold_block'],
  ['diamond', 'diamond_block'],
  ['coal', 'coal_block'],
];
for (const [item, block] of BLOCK_FORMS) {
  shaped(['MMM', 'MMM', 'MMM'], { M: item }, block);
  shapeless([block], item, 9);
}

Object.freeze(RECIPES);

// ---------------------------------------------------------------------------
// Grid matching
// ---------------------------------------------------------------------------

// The crafting result for a grid of stacks (null or { name, count, ... }) of
// `width` x `width` cells: { name, count } or null when nothing matches.
export function craftResult(slots, width) {
  let minX = width;
  let minY = width;
  let maxX = -1;
  let maxY = -1;
  let filled = 0;
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      if (!slots[y * width + x]) continue;
      filled += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (filled === 0) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;

  // The occupied bounding box, cell by cell, against a trimmed pattern.
  const matches = (cells, w) => {
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const name = slots[(minY + y) * width + (minX + x)]?.name ?? null;
        if (name !== cells[y * w + x]) return false;
      }
    }
    return true;
  };

  let names = null; // sorted occupied-cell names, built lazily for shapeless
  for (const r of RECIPES) {
    if (r.cells) {
      if (r.w !== bw || r.h !== bh) continue;
      if (matches(r.cells, r.w) || (r.mirrored && matches(r.mirrored, r.w))) {
        return { ...r.result };
      }
    } else {
      if (r.ingredients.length !== filled) continue;
      if (!names) {
        names = [];
        for (const s of slots) if (s) names.push(s.name);
        names.sort();
      }
      if (names.every((n, i) => n === r.ingredients[i])) return { ...r.result };
    }
  }
  return null;
}

// Can `count` of `name` fit into the inventory right now? Guards shift-click
// max-crafting so a craft is never consumed when its result has nowhere to go.
export function canFit(inventory, name, count) {
  const cap = itemMaxStack(name);
  let free = 0;
  for (const s of inventory.slots) {
    if (!s) free += cap;
    else if (cap > 1 && s.name === name && s.durability == null && s.count < cap) {
      free += cap - s.count;
    }
    if (free >= count) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The crafting grid — the slot container behind the screens' craft area
// ---------------------------------------------------------------------------

export class CraftingGrid {
  constructor(width) {
    this.width = width;
    this.slots = new Array(width * width).fill(null);
    this._listeners = [];
  }

  subscribe(fn) {
    this._listeners.push(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this);
  }

  get(i) {
    return this.slots[i] ?? null;
  }

  // Live result preview ({ name, count } or null) for the result slot.
  get result() {
    return craftResult(this.slots, this.width);
  }

  // One craft's ingredients: one item from every occupied cell.
  _consumeOne() {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s) continue;
      s.count -= 1;
      if (s.count <= 0) this.slots[i] = null;
    }
    this._emit();
  }

  // Click on the result slot: crafts once onto the cursor when the cursor
  // can hold it (empty, or the same plain item with room — vanilla). Tools
  // arrive at full durability. Returns the new cursor.
  takeResult(cursor) {
    const r = this.result;
    if (!r) return cursor;
    const durability = itemMaxDurability(r.name);
    if (cursor) {
      if (cursor.name !== r.name || cursor.durability != null || durability !== null) {
        return cursor;
      }
      if (cursor.count + r.count > itemMaxStack(r.name)) return cursor;
      this._consumeOne();
      cursor.count += r.count;
      return cursor;
    }
    this._consumeOne();
    return durability !== null
      ? { name: r.name, count: r.count, durability }
      : { name: r.name, count: r.count };
  }

  // Shift-click on the result slot: craft as many as the ingredients allow
  // and the inventory can hold, straight into the inventory. Stops when the
  // grid stops matching THE RECIPE THE PLAYER CLICKED — uneven cell counts
  // can leave a remainder that matches a different recipe (4 planks -> table
  // leaves a plank column that would chain into sticks), and crafting items
  // the player never asked for is worse than stopping. Returns the number of
  // items crafted.
  craftMaxInto(inventory) {
    let crafted = 0;
    const first = this.result;
    if (!first) return 0;
    for (;;) {
      const r = this.result;
      if (!r || r.name !== first.name || r.count !== first.count) break;
      if (!canFit(inventory, r.name, r.count)) break;
      this._consumeOne();
      inventory.add(r.name, r.count);
      crafted += r.count;
    }
    return crafted;
  }

  // Shift-click on a grid cell: move its stack into the inventory (existing
  // stacks first, then first empty slots). Whatever doesn't fit stays.
  shiftOut(i, inventory) {
    const s = this.slots[i];
    if (!s) return;
    const left = inventory.addStack(s);
    this.slots[i] = left > 0 ? { ...s, count: left } : null;
    this._emit();
  }

  // Closing the screen returns grid contents to the inventory. Whatever
  // doesn't fit comes back as [{ name, count, durability }] for the caller
  // to drop at the player's feet.
  drainInto(inventory) {
    const overflow = [];
    let changed = false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s) continue;
      const left = inventory.addStack(s);
      if (left > 0) overflow.push({ name: s.name, count: left, durability: s.durability ?? null });
      this.slots[i] = null;
      changed = true;
    }
    if (changed) this._emit();
    return overflow;
  }
}

// Grid cells use the exact click semantics the inventory screen already has
// (pick up / put down / merge to cap / swap; right-click half / place one) —
// the methods only touch `slots` and `_emit`, so they are shared rather than
// re-implemented (Phase 7's review hardened them; see PROGRESS.md).
CraftingGrid.prototype.clickSlot = Inventory.prototype.clickSlot;
CraftingGrid.prototype.rightClickSlot = Inventory.prototype.rightClickSlot;
