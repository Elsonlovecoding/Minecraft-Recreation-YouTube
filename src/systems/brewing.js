// systems/brewing.js — Phase 18: the brewing stand (SPEC "Brewing").
// Brewing stand + blaze powder as fuel; the SPEC potion table:
//   water bottle + nether wart        -> awkward
//   awkward + magma cream             -> fire resistance  (the one that
//                                        matters for the run)
//   awkward + blaze powder            -> strength
//   awkward + glistering melon slice  -> healing
//
// Two layers, the smelting.js shape:
//   BrewingStand          one stand's state — a 5-slot SlotContainer
//                         (3 bottle slots, ingredient, blaze-powder fuel)
//                         plus the brew progress machine. Pure logic — no
//                         DOM, no three.js — so node tests drive it.
//   createBrewingSystem   the per-position stand map. Every stand ticks
//                         every frame whether or not its screen is open;
//                         breaking a stand drops its slots' contents.
//
// Vanilla rules kept: all matching bottles transform together in one
// 20-second operation consuming 1 ingredient; one blaze powder fuels 20
// operations and is loaded only when a brew can actually start; swapping
// the ingredient mid-brew restarts the operation; removing the bottles or
// ingredient resets progress (no rewind — vanilla brewing just stops).
// Potion item data (colours, effects) lives in player/inventory.js
// (POTIONS); the effect timers live in player/stats.js.

import { BREWING } from '../config.js';
import { SlotContainer, itemMaxStack, potionInfo } from '../player/inventory.js';
import { BLOCK } from '../world/blocks.js';

// ---------------------------------------------------------------------------
// Registries — SPEC.md "Brewing"
// ---------------------------------------------------------------------------

// ingredient item -> { bottle item it transforms -> result }. Item ids
// follow the texture names (glistering_melon_slice like the shipped art).
export const BREW_RECIPES = {
  nether_wart: { water_bottle: 'awkward_potion' },
  magma_cream: { awkward_potion: 'fire_resistance_potion' },
  blaze_powder: { awkward_potion: 'strength_potion' },
  glistering_melon_slice: { awkward_potion: 'healing_potion' },
};

export const FUEL_ITEM = 'blaze_powder';

export const BOTTLE_SLOTS = [0, 1, 2];
export const SLOT_INGREDIENT = 3;
export const SLOT_FUEL = 4;

export function isBrewIngredient(name) {
  return BREW_RECIPES[name] !== undefined;
}

// Bottle slots hold water bottles and potions (never empty glass bottles —
// vanilla; filling happens at a water source, player/interaction.js).
export function isBottleItem(name) {
  return potionInfo(name) !== null;
}

// Anything the brewing screen's shift-click routing takes an interest in
// (ui/screens.js falls back to the hotbar<->main move otherwise).
export function routableInBrewing(name) {
  return isBottleItem(name) || isBrewIngredient(name) || name === FUEL_ITEM;
}

// ---------------------------------------------------------------------------
// One brewing stand
// ---------------------------------------------------------------------------

export class BrewingStand extends SlotContainer {
  constructor() {
    super(BOTTLE_SLOTS.length + 2);
    this.progress = 0;      // seconds toward the current operation
    this.fuelBrews = 0;     // operations left on the loaded blaze powder
    this._brewingName = null; // ingredient the progress belongs to
  }

  // Powder indicator: fraction of the loaded fuel unit left.
  get fuelFraction() {
    return Math.min(1, this.fuelBrews / BREWING.BREWS_PER_FUEL);
  }

  // Progress indicator: fraction of the current operation done.
  get progressFraction() {
    return Math.min(1, this.progress / BREWING.BREW_SECONDS);
  }

  get isBrewing() {
    return this.progress > 0;
  }

  // Bottle slots that the current ingredient would transform.
  _brewableBottles() {
    const ing = this.slots[SLOT_INGREDIENT];
    const map = ing ? BREW_RECIPES[ing.name] : null;
    if (!map) return null;
    const out = [];
    for (const i of BOTTLE_SLOTS) {
      const s = this.slots[i];
      if (s && map[s.name]) out.push(i);
    }
    return out.length > 0 ? out : null;
  }

  // Vanilla slot gating: bottle slots take bottles/potions only, the
  // ingredient slot brewing ingredients, the fuel slot blaze powder.
  canPlaceIn(i, name) {
    if (i === SLOT_INGREDIENT) return isBrewIngredient(name);
    if (i === SLOT_FUEL) return name === FUEL_ITEM;
    return isBottleItem(name);
  }

  // Click semantics honour the slot gates; like the furnace, clicking a
  // gated slot holding the same plain item pulls it onto the cursor.
  clickSlot(i, cursor) {
    if (cursor && !this.canPlaceIn(i, cursor.name)) {
      const s = this.slots[i];
      if (s && s.name === cursor.name && s.durability == null && cursor.durability == null) {
        const moved = Math.min(itemMaxStack(s.name) - cursor.count, s.count);
        if (moved > 0) {
          cursor.count += moved;
          s.count -= moved;
          if (s.count <= 0) this.slots[i] = null;
          this._emit();
        }
      }
      return cursor;
    }
    return super.clickSlot(i, cursor);
  }

  rightClickSlot(i, cursor) {
    if (cursor && !this.canPlaceIn(i, cursor.name)) return cursor;
    return super.rightClickSlot(i, cursor);
  }

  // Shift-click routing INTO the stand: potions/bottles head to the first
  // empty bottle slot, blaze powder to the fuel slot (topping it up) and
  // only then to the ingredient slot, other ingredients to the ingredient
  // slot. Returns the count that didn't fit.
  addStack(stack) {
    if (stack.durability != null) return stack.count; // tools never route in
    let left = stack.count;
    if (isBottleItem(stack.name)) {
      for (const i of BOTTLE_SLOTS) {
        if (left <= 0) break;
        if (!this.slots[i]) {
          this.slots[i] = { name: stack.name, count: 1 };
          left -= 1;
          this._emit();
        }
      }
      return left;
    }
    if (stack.name === FUEL_ITEM) {
      left = this._mergeAt(SLOT_FUEL, stack.name, left);
    }
    if (left > 0 && isBrewIngredient(stack.name)) {
      left = this._mergeAt(SLOT_INGREDIENT, stack.name, left);
    }
    return left;
  }

  _mergeAt(i, name, count) {
    if (count <= 0) return 0;
    const cap = itemMaxStack(name);
    const s = this.slots[i];
    if (!s) {
      const put = Math.min(cap, count);
      this.slots[i] = { name, count: put };
      this._emit();
      return count - put;
    }
    if (s.name !== name || s.durability != null) return count;
    const moved = Math.min(cap - s.count, count);
    if (moved > 0) {
      s.count += moved;
      this._emit();
    }
    return count - moved;
  }

  // Advance the stand by dt seconds. Slot changes emit; continuous
  // progress movement does not (the screen polls it per frame).
  update(dt) {
    if (dt <= 0) return;
    // Progress belongs to a specific ingredient (the furnace rule):
    // swapping it mid-brew restarts the operation.
    const ingName = this.slots[SLOT_INGREDIENT]?.name ?? null;
    if (ingName !== this._brewingName) {
      this._brewingName = ingName;
      this.progress = 0;
    }
    const bottles = this._brewableBottles();
    if (!bottles) {
      this.progress = 0; // nothing to brew: the operation just stops
      return;
    }
    // Load a blaze powder only when a brew can actually run (vanilla).
    if (this.fuelBrews <= 0) {
      const fuel = this.slots[SLOT_FUEL];
      if (!fuel || fuel.name !== FUEL_ITEM) {
        this.progress = 0;
        return;
      }
      fuel.count -= 1;
      if (fuel.count <= 0) this.slots[SLOT_FUEL] = null;
      this.fuelBrews = BREWING.BREWS_PER_FUEL;
      this._emit();
    }
    this.progress += dt;
    if (this.progress >= BREWING.BREW_SECONDS - 1e-9) {
      this.progress = 0;
      const map = BREW_RECIPES[ingName];
      for (const i of bottles) {
        this.slots[i] = { name: map[this.slots[i].name], count: 1 };
      }
      const ing = this.slots[SLOT_INGREDIENT];
      ing.count -= 1;
      if (ing.count <= 0) this.slots[SLOT_INGREDIENT] = null;
      this.fuelBrews -= 1;
      this._emit();
    }
  }
}

// ---------------------------------------------------------------------------
// The world-facing system
// ---------------------------------------------------------------------------

export function createBrewingSystem({ world, items }) {
  const stands = new Map(); // "x,y,z" -> { stand, x, y, z }
  const keyOf = (x, y, z) => `${x},${y},${z}`;

  // The stand state for a block position, created on first use (opening
  // the screen). Returns null if the block there isn't a brewing stand.
  function standAt(x, y, z) {
    if (world.getBlock(x, y, z) !== BLOCK.BREWING_STAND) return null;
    const key = keyOf(x, y, z);
    let entry = stands.get(key);
    if (!entry) {
      entry = { stand: new BrewingStand(), x, y, z };
      stands.set(key, entry);
    }
    return entry.stand;
  }

  // Block listener: a mined brewing stand drops its contents and forgets
  // its state.
  function onBlockChanged(x, y, z, id) {
    const key = keyOf(x, y, z);
    const entry = stands.get(key);
    if (!entry || id === BLOCK.BREWING_STAND) return;
    for (const s of entry.stand.drainAll()) {
      items.spawn(
        s.name, s.count,
        { x: x + 0.5, y: y + 0.25, z: z + 0.5 },
        undefined, s.durability ?? undefined,
      );
    }
    stands.delete(key);
  }

  // Tick every stand, open screen or not (brewing continues unwatched).
  function update(dt) {
    for (const entry of stands.values()) entry.stand.update(dt);
  }

  // Dimension switch (the smelting.js protocol): stand states are keyed by
  // position and swap per dimension; stored stands freeze mid-brew.
  function swapDimensionState(stored = []) {
    const prev = [...stands.entries()];
    stands.clear();
    for (const [k, entry] of stored) stands.set(k, entry);
    return prev;
  }

  return {
    update,
    onBlockChanged,
    standAt,
    swapDimensionState,
    stands, // read-only by convention (debug/tests)
  };
}
