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

import { INVENTORY, TOOL_TIERS, COMBAT } from '../config.js';

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

// The four equip slots, top to bottom (Phase 13). armourSlotIndex maps an
// item name to the slot it belongs in, or null for non-armour.
export const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];

export function armourSlotIndex(name) {
  const m = ARMOR_RE.exec(name ?? '');
  return m ? ARMOR_PIECES.indexOf(m[2]) : null;
}

// Everything else that doesn't stack to 64 (vanilla values).
const SPECIAL_DURABILITY = { bow: 384, flint_and_steel: 64, shears: 238 };
const SPECIAL_MAX_STACK = {
  bucket: 1, water_bucket: 1, lava_bucket: 1, milk_bucket: 1,
  mushroom_stew: 1, potion: 1,
  water_bottle: 1, awkward_potion: 1, fire_resistance_potion: 1,
  strength_potion: 1, healing_potion: 1,
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
// Food registry (Phase 11) — hunger points restored and the hidden saturation
// buffer filled by eating (both vanilla values; cooked meat restores far more
// than raw). `container` is the item left behind after eating (stew -> bowl).
// Item ids follow the texture names in assets/items/.
// ---------------------------------------------------------------------------

// Phase 14 flags: `always` — edible even at full hunger (only the golden
// apple, vanilla); `poisonChance` — probability of the Hunger effect on
// eating (rotten flesh 80%; the effect itself lives in player/stats.js).
const FOODS = {
  apple:           { hunger: 4, saturation: 2.4 },
  golden_apple:    { hunger: 4, saturation: 9.6, always: true },
  bread:           { hunger: 5, saturation: 6.0 },
  beef:            { hunger: 3, saturation: 1.8 },
  cooked_beef:     { hunger: 8, saturation: 12.8 },
  porkchop:        { hunger: 3, saturation: 1.8 },
  cooked_porkchop: { hunger: 8, saturation: 12.8 },
  chicken:         { hunger: 2, saturation: 1.2 },
  cooked_chicken:  { hunger: 6, saturation: 7.2 },
  mutton:          { hunger: 2, saturation: 1.2 },
  cooked_mutton:   { hunger: 6, saturation: 9.6 },
  carrot:          { hunger: 3, saturation: 3.6 },
  potato:          { hunger: 1, saturation: 0.6 },
  baked_potato:    { hunger: 5, saturation: 6.0 },
  melon_slice:     { hunger: 2, saturation: 1.2 },
  rotten_flesh:    { hunger: 4, saturation: 0.8, poisonChance: 0.8 },
  mushroom_stew:   { hunger: 6, saturation: 7.2, container: 'bowl' },
};

// { hunger, saturation, container? } for an edible item name, else null.
export function foodValue(name) {
  return FOODS[name] ?? null;
}

// ---------------------------------------------------------------------------
// Potion registry (Phase 18 — systems/brewing.js brews them, stats.js
// applies the effects). Per potion: the liquid colour (the bottle art is
// tinted with it everywhere the item shows — entities/items.js builds the
// canvas) and the effect drinking applies. SPEC potions: awkward (the
// base), fire resistance (the one that matters), healing, strength.
// Colours are the vanilla liquid colours; awkward gets a murky violet so
// it reads distinct from water in a game with no item tooltips.
// ---------------------------------------------------------------------------

export const POTIONS = {
  water_bottle:           { color: 0x385dc6 },
  awkward_potion:         { color: 0x7a6f9e },
  fire_resistance_potion: { color: 0xe49a3a, effect: 'fire_resistance' },
  strength_potion:        { color: 0x932423, effect: 'strength' },
  healing_potion:         { color: 0xf82423, effect: 'healing' },
};

export function potionInfo(name) {
  return POTIONS[name] ?? null;
}

// Anything consumable by the hold-right-click flow: food, or a potion
// (always drinkable, no hunger gate, leaves the glass bottle behind —
// player/interaction.js drives both through the same hold).
export function consumableValue(name) {
  const food = FOODS[name];
  if (food) return food;
  const potion = POTIONS[name];
  if (potion) {
    return {
      hunger: 0, saturation: 0, always: true,
      container: 'glass_bottle', potion,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The inventory
// ---------------------------------------------------------------------------

export class Inventory {
  constructor() {
    this.slots = new Array(INVENTORY.SIZE).fill(null);
    this.selected = 0; // hotbar slot index 0..HOTBAR_SIZE-1
    this._listeners = [];
    // Phase 13: the four armour equip slots (helmet/chestplate/leggings/
    // boots), a gated SlotContainer of their own — the inventory screen
    // renders them beside the craft grid, combat reads the points.
    this.armour = new ArmourContainer();
    // Phase 14: the offhand — a 1-slot container (full click semantics on
    // the inventory screen for free). F swaps it with the selected hotbar
    // slot; the hand renders it in the left arm; right-click actions fall
    // back to it when the main hand item has none.
    this.offhand = new SlotContainer(1);
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

  // The offhand stack/name (Phase 14). The slot itself is this.offhand.
  get offhandStack() {
    return this.offhand.slots[0] ?? null;
  }

  get offhandName() {
    return this.offhand.slots[0]?.name ?? null;
  }

  // F: swap the selected hotbar stack with the offhand stack.
  swapOffhand() {
    const held = this.slots[this.selected] ?? null;
    this.slots[this.selected] = this.offhand.slots[0] ?? null;
    this.offhand.slots[0] = held;
    this._emit();
    this.offhand._emit();
  }

  // Consume n from the offhand stack (offhand block placement / eating).
  consumeOffhand(n = 1) {
    const s = this.offhand.slots[0];
    if (!s || s.count < n) return false;
    s.count -= n;
    if (s.count <= 0) this.offhand.slots[0] = null;
    this.offhand._emit();
    return true;
  }

  // Replace the offhand stack outright (offhand bucket fill/empty).
  replaceOffhand(name, count = 1) {
    this.offhand.slots[0] = { name, count };
    this.offhand._emit();
  }

  // Wear the offhand item by n (offhand bow shots), like damageSelected.
  damageOffhand(n = 1) {
    const s = this.offhand.slots[0];
    if (!s || s.durability == null) return 'none';
    s.durability -= n;
    const broke = s.durability <= 0;
    if (broke) this.offhand.slots[0] = null;
    this.offhand._emit();
    return broke ? 'broken' : 'damaged';
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
  // (Loops run over this.slots.length so SlotContainer — any size — can
  // share the implementation; for the inventory that is INVENTORY.SIZE.)
  _insert(name, count, durability) {
    let left = count;
    const n = this.slots.length;
    if (durability == null) {
      const cap = itemMaxStack(name);
      if (cap > 1) {
        for (let i = 0; i < n && left > 0; i++) {
          const s = this.slots[i];
          if (s && s.name === name && s.durability == null && s.count < cap) {
            const moved = Math.min(cap - s.count, left);
            s.count += moved;
            left -= moved;
          }
        }
      }
      for (let i = 0; i < n && left > 0; i++) {
        if (!this.slots[i]) {
          const put = Math.min(cap, left);
          this.slots[i] = { name, count: put };
          left -= put;
        }
      }
    } else {
      for (let i = 0; i < n && left > 0; i++) {
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

  // Empties every slot — worn armour and the offhand included (SPEC:
  // everything drops on death) — and returns the removed stacks with
  // durability intact. Death drops (player/stats.js).
  drainAll() {
    const stacks = [];
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]) {
        stacks.push(this.slots[i]);
        this.slots[i] = null;
      }
    }
    if (this.armour) stacks.push(...this.armour.drainAll());
    if (this.offhand) stacks.push(...this.offhand.drainAll());
    if (stacks.length) this._emit();
    return stacks;
  }

  // Right-click equip (Phase 13): the selected armour piece moves into its
  // slot, swapping with whatever was worn there. False for non-armour.
  equipSelected() {
    const s = this.slots[this.selected];
    const idx = s ? armourSlotIndex(s.name) : null;
    if (idx === null) return false;
    this.slots[this.selected] = this.armour.slots[idx] ?? null;
    this.armour.slots[idx] = s;
    this._emit();
    this.armour._emit();
    return true;
  }

  // The same equip from the offhand (Phase 14 — the offhand fallback can
  // right-click-equip armour held there).
  equipOffhand() {
    const s = this.offhand.slots[0];
    const idx = s ? armourSlotIndex(s.name) : null;
    if (idx === null) return false;
    this.offhand.slots[0] = this.armour.slots[idx] ?? null;
    this.armour.slots[idx] = s;
    this.offhand._emit();
    this.armour._emit();
    return true;
  }

  // Total worn protection points (config COMBAT.ARMOR_POINTS — 4% damage
  // reduction each; drives the HUD armour bar and combat's reduction).
  get armourPoints() {
    let points = 0;
    for (const s of this.armour.slots) {
      const m = s ? ARMOR_RE.exec(s.name) : null;
      if (m) points += COMBAT.ARMOR_POINTS[m[1]]?.[m[2]] ?? 0;
    }
    return points;
  }

  // Consume n of an item by name across stacks (bow shots eat arrows).
  // All-or-nothing: false (and nothing consumed) when short.
  consumeItem(name, n = 1) {
    let have = 0;
    for (const s of this.slots) {
      if (s && s.name === name && s.durability == null) have += s.count;
    }
    if (have < n) return false;
    let left = n;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (!s || s.name !== name || s.durability != null) continue;
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count <= 0) this.slots[i] = null;
    }
    this._emit();
    return true;
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

  // Replace the selected stack outright (bucket fill/empty: the held bucket
  // becomes a water/lava bucket and back — all stack-1 items).
  replaceSelected(name, count = 1) {
    this.slots[this.selected] = { name, count };
    this._emit();
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
      // Combinable stacks merge up to the cap; when the slot is already
      // full the click is inert (vanilla), never a swap.
      const moved = Math.min(itemMaxStack(slot.name) - slot.count, cursor.count);
      if (moved <= 0) return cursor;
      slot.count += moved;
      cursor.count -= moved;
      this._emit();
      return cursor.count > 0 ? cursor : null;
    }
    this.slots[i] = cursor; // non-combinable items: swap
    this._emit();
    return slot;
  }

  // Vanilla right click: empty cursor picks up half (rounded up); a held
  // stack places exactly one into an empty or matching slot; over a
  // non-combinable stack it swaps exactly like a left click (only a full
  // matching stack is inert). Returns the new cursor.
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
    if (slot.name === cursor.name && slot.durability == null && cursor.durability == null) {
      if (slot.count >= itemMaxStack(slot.name)) return cursor; // full: inert
      slot.count += 1;
      cursor.count -= 1;
      this._emit();
      return cursor.count > 0 ? cursor : null;
    }
    this.slots[i] = cursor; // non-combinable items: swap, like a left click
    this._emit();
    return slot;
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

// ---------------------------------------------------------------------------
// SlotContainer — a generic block-container slot array (Phase 10): chests,
// the furnace, later the brewing stand. Shares the hardened Inventory click
// semantics the same way CraftingGrid does (systems/crafting.js), plus
// insertion and cross-container moves. Pure logic, node-testable.
// ---------------------------------------------------------------------------

export class SlotContainer {
  constructor(size) {
    this.slots = new Array(size).fill(null);
    this._listeners = [];
  }

  // Unlike Inventory.subscribe, returns an unsubscriber — container screens
  // bind to whichever chest/furnace is open and must unbind on close.
  subscribe(fn) {
    this._listeners.push(fn);
    return () => {
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  _emit() {
    for (const fn of this._listeners) fn(this);
  }

  get(i) {
    return this.slots[i] ?? null;
  }

  // Move the stack in slot i into `target` (anything with addStack —
  // the inventory or another container), merging first. Returns true if
  // anything moved. This is the shift-click between containers.
  moveSlotTo(i, target) {
    const s = this.slots[i];
    if (!s) return false;
    const left = target.addStack(s);
    if (left === s.count) return false;
    this.slots[i] = left > 0 ? { ...s, count: left } : null;
    this._emit();
    return true;
  }

  // Empties every slot and returns the removed stacks (durability intact) —
  // dropped when the container's block is broken.
  drainAll() {
    const stacks = [];
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]) {
        stacks.push(this.slots[i]);
        this.slots[i] = null;
      }
    }
    if (stacks.length) this._emit();
    return stacks;
  }
}

// The exact click/insert semantics the inventory screen already uses —
// shared, not re-implemented (the Phase 7/8-hardened versions).
SlotContainer.prototype.clickSlot = Inventory.prototype.clickSlot;
SlotContainer.prototype.rightClickSlot = Inventory.prototype.rightClickSlot;
SlotContainer.prototype._insert = Inventory.prototype._insert;
SlotContainer.prototype.add = Inventory.prototype.add;
SlotContainer.prototype.addStack = Inventory.prototype.addStack;

// Inventory slots gain the same cross-container move (shift-click from the
// inventory into an open chest/furnace).
Inventory.prototype.moveSlotTo = SlotContainer.prototype.moveSlotTo;

// ---------------------------------------------------------------------------
// ArmourContainer — the four equip slots (Phase 13). A SlotContainer whose
// slots each accept exactly one piece kind (the furnace's gating pattern):
// a disallowed placement is inert, shift-click routing (addStack) sends a
// piece to its own slot only when that slot is empty. Worn pieces wear
// together on every armour-reduced hit (systems/combat.js calls damageAll)
// and break at zero durability.
// ---------------------------------------------------------------------------

export class ArmourContainer extends SlotContainer {
  constructor() {
    super(ARMOR_PIECES.length);
  }

  accepts(i, name) {
    return armourSlotIndex(name) === i;
  }

  clickSlot(i, cursor) {
    if (cursor && !this.accepts(i, cursor.name)) return cursor; // inert
    return super.clickSlot(i, cursor);
  }

  rightClickSlot(i, cursor) {
    if (cursor && !this.accepts(i, cursor.name)) return cursor;
    return super.rightClickSlot(i, cursor);
  }

  // Shift-click equip (inventory.moveSlotTo target): armour stacks are
  // always count 1; the piece goes to its own slot if that slot is free.
  addStack(stack) {
    const i = armourSlotIndex(stack.name);
    if (i === null || i < 0 || this.slots[i]) return stack.count;
    this.slots[i] = { ...stack };
    this._emit();
    return 0;
  }

  // Wear every equipped piece (combat: max(1, floor(damage/4)) per hit).
  // A piece reaching zero durability breaks — the slot clears.
  damageAll(wear) {
    let changed = false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s) continue;
      const d = (s.durability ?? itemMaxDurability(s.name)) - wear;
      if (d <= 0) this.slots[i] = null;
      else s.durability = d;
      changed = true;
    }
    if (changed) this._emit();
  }
}
