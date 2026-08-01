// player/inventory.js — Phase 7: the player inventory. INVENTORY.SIZE (36)
// slots, the first INVENTORY.HOTBAR_SIZE (9) of which are the hotbar; stacks
// up to INVENTORY.MAX_STACK with per-item overrides (tools, armour and a few
// specials stack to 1 and carry durability). Owns the vanilla click semantics
// the inventory screen uses (pick up / put down / swap / merge, right-click
// half / place-one, shift-click between hotbar and main).
//
// Pure logic — no DOM, no three.js — so node tests construct an Inventory and
// drive it directly. The UI (ui/hud.js hotbar, ui/screens.js) and the hand
// (player/interaction.js) subscribe via `subscribe(fn)` and re-render on
// change.
//
// A slot is null or { name, count, durability? }: durability is present only
// on items that wear out (tools, armour, bows...), and such stacks always
// have count 1 and never merge.

import { INVENTORY, TOOL_TIERS } from '../config.js';

// ---------------------------------------------------------------------------
// Item registry — stack caps and durability (per-item data lives here, like
// per-block data lives in world/blocks.js; global tunables stay in config.js)
// ---------------------------------------------------------------------------

// Tool item names follow the texture names (wooden_pickaxe ... diamond_sword);
// durability comes from the SPEC tier table (config TOOL_TIERS).
const TOOL_RE = /^(wooden|stone|iron|diamond)_(pickaxe|axe|shovel|sword)$/;
const TOOL_TIER_NAME = { wooden: 'wood', stone: 'stone', iron: 'iron', diamond: 'diamond' };

// Armour durability = per-piece factor x material factor (the vanilla
// formula: leather helmet 5x11 = 55, diamond chestplate 33x16 = 528...).
const ARMOR_RE = /^(leather|iron|diamond|golden)_(helmet|chestplate|leggings|boots)$/;
const ARMOR_MATERIAL_FACTOR = { leather: 5, iron: 15, golden: 7, diamond: 33 };
const ARMOR_PIECE_FACTOR = { helmet: 11, chestplate: 16, leggings: 15, boots: 13 };

// Everything else that doesn't stack to 64 (vanilla values).
const SPECIAL_DURABILITY = { bow: 384, flint_and_steel: 64, shears: 238 };
const SPECIAL_MAX_STACK = {
  bucket: 1, water_bucket: 1, lava_bucket: 1, milk_bucket: 1,
  mushroom_stew: 1, potion: 1,
  ender_pearl: 16, egg: 16,
};

// Max durability for an item name, or null for items that don't wear out.
export function itemMaxDurability(name) {
  const tool = TOOL_RE.exec(name ?? '');
  if (tool) return TOOL_TIERS[TOOL_TIER_NAME[tool[1]]].durability;
  const armor = ARMOR_RE.exec(name ?? '');
  if (armor) return ARMOR_MATERIAL_FACTOR[armor[1]] * ARMOR_PIECE_FACTOR[armor[2]];
  return SPECIAL_DURABILITY[name] ?? null;
}

// Stack cap for an item name. Durability items never stack.
export function itemMaxStack(name) {
  if (itemMaxDurability(name) !== null) return 1;
  return SPECIAL_MAX_STACK[name] ?? INVENTORY.MAX_STACK;
}

// ---------------------------------------------------------------------------
// The inventory
// ---------------------------------------------------------------------------

export class Inventory {
  constructor() {
    this.slots = new Array(INVENTORY.SIZE).fill(null);
    this.selected = 0; // hotbar slot index 0..HOTBAR_SIZE-1
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

  get selectedStack() {
    return this.slots[this.selected] ?? null;
  }

  // Item name under the hotbar selection, or null — what the hand holds,
  // what mining checks, what right-click places.
  get selectedName() {
    return this.slots[this.selected]?.name ?? null;
  }

  select(i) {
    if (i < 0 || i >= INVENTORY.HOTBAR_SIZE || i === this.selected) return;
    this.selected = i;
    this._emit();
  }

  // Scroll-wheel selection: +1 next slot, -1 previous, wrapping.
  selectNext(dir) {
    const n = INVENTORY.HOTBAR_SIZE;
    this.selected = (this.selected + dir + n) % n;
    this._emit();
  }

  // Core insertion: merge into existing stacks first (slot order, so hotbar
  // fills before main), then the first empty slots. Durability items occupy
  // one slot per unit and never merge. Returns the count that didn't fit.
  _insert(name, count, durability) {
    let left = count;
    if (durability == null) {
      const cap = itemMaxStack(name);
      if (cap > 1) {
        for (let i = 0; i < INVENTORY.SIZE && left > 0; i++) {
          const s = this.slots[i];
          if (s && s.name === name && s.durability == null && s.count < cap) {
            const moved = Math.min(cap - s.count, left);
            s.count += moved;
            left -= moved;
          }
        }
      }
      for (let i = 0; i < INVENTORY.SIZE && left > 0; i++) {
        if (!this.slots[i]) {
          const put = Math.min(cap, left);
          this.slots[i] = { name, count: put };
          left -= put;
        }
      }
    } else {
      for (let i = 0; i < INVENTORY.SIZE && left > 0; i++) {
        if (!this.slots[i]) {
          this.slots[i] = { name, count: 1, durability };
          left -= 1;
        }
      }
    }
    if (left !== count) this._emit();
    return left;
  }

  // Pickups and crafting results. New durability items arrive at full
  // durability. Returns the leftover count (0 = everything fit).
  add(name, count = 1) {
    return this._insert(name, count, itemMaxDurability(name));
  }

  // Re-insert an exact stack (preserving worn durability) — used when the
  // inventory screen closes with a stack still on the cursor.
  addStack(stack) {
    return this._insert(stack.name, stack.count, stack.durability ?? null);
  }

  // Could add() accept at least one of this item right now? Gates the item
  // magnet so a full inventory doesn't vacuum drops around forever.
  canAccept(name) {
    if (this.slots.some((s) => !s)) return true;
    if (itemMaxDurability(name) !== null) return false;
    const cap = itemMaxStack(name);
    return this.slots.some(
      (s) => s.name === name && s.durability == null && s.count < cap,
    );
  }

  // Consume n from the selected stack (placing blocks). False if it can't.
  consumeSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s || s.count < n) return false;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this._emit();
    return true;
  }

  // Wear the selected item by n. 'none' when it has no durability;
  // 'broken' clears the slot when durability runs out.
  damageSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s || s.durability == null) return 'none';
    s.durability -= n;
    const broke = s.durability <= 0;
    if (broke) this.slots[this.selected] = null;
    this._emit();
    return broke ? 'broken' : 'damaged';
  }

  // Vanilla left click with `cursor` (a stack or null) over slot i:
  // pick up the whole stack / put the cursor down / merge same items up to
  // the cap / swap different ones. Returns the new cursor.
  clickSlot(i, cursor) {
    const slot = this.slots[i];
    if (!cursor) {
      if (!slot) return null;
      this.slots[i] = null;
      this._emit();
      return slot;
    }
    if (!slot) {
      this.slots[i] = cursor;
      this._emit();
      return null;
    }
    if (slot.name === cursor.name && slot.durability == null && cursor.durability == null) {
      const cap = itemMaxStack(slot.name);
      const moved = Math.min(cap - slot.count, cursor.count);
      if (moved > 0) {
        slot.count += moved;
        cursor.count -= moved;
        this._emit();
        return cursor.count > 0 ? cursor : null;
      }
    }
    this.slots[i] = cursor; // different items (or no room): swap
    this._emit();
    return slot;
  }

  // Vanilla right click: empty cursor picks up half (rounded up); a held
  // stack places exactly one into an empty or matching slot. Returns the
  // new cursor.
  rightClickSlot(i, cursor) {
    const slot = this.slots[i];
    if (!cursor) {
      if (!slot) return null;
      const take = Math.ceil(slot.count / 2);
      const rest = slot.count - take;
      this.slots[i] = rest > 0 ? { ...slot, count: rest } : null;
      this._emit();
      return { ...slot, count: take };
    }
    if (!slot) {
      if (cursor.count === 1) {
        this.slots[i] = cursor;
        this._emit();
        return null;
      }
      this.slots[i] = { name: cursor.name, count: 1 };
      cursor.count -= 1;
      this._emit();
      return cursor;
    }
    if (
      slot.name === cursor.name && slot.durability == null &&
      cursor.durability == null && slot.count < itemMaxStack(slot.name)
    ) {
      slot.count += 1;
      cursor.count -= 1;
      this._emit();
      return cursor.count > 0 ? cursor : null;
    }
    return cursor; // incompatible: nothing happens (vanilla)
  }

  // Shift-click: move the stack to the other region (hotbar <-> main),
  // merging into existing stacks there first, then the first empty slot.
  shiftClick(i) {
    const s = this.slots[i];
    if (!s) return;
    const H = INVENTORY.HOTBAR_SIZE;
    const [t0, t1] = i < H ? [H, INVENTORY.SIZE] : [0, H];
    let changed = false;
    if (s.durability == null) {
      const cap = itemMaxStack(s.name);
      for (let j = t0; j < t1 && s.count > 0; j++) {
        const d = this.slots[j];
        if (d && d.name === s.name && d.durability == null && d.count < cap) {
          const moved = Math.min(cap - d.count, s.count);
          d.count += moved;
          s.count -= moved;
          changed = changed || moved > 0;
        }
      }
    }
    if (s.count > 0) {
      for (let j = t0; j < t1; j++) {
        if (!this.slots[j]) {
          this.slots[j] = { ...s };
          s.count = 0;
          changed = true;
          break;
        }
      }
    }
    if (s.count === 0) this.slots[i] = null;
    if (changed) this._emit();
  }
}

export function createInventory() {
  return new Inventory();
}
