// systems/smelting.js — Phase 10: furnace logic. The recipe and fuel tables
// (SPEC.md "Smelting") are registries here, like crafting recipes live in
// systems/crafting.js; global tunables (smelt time, progress decay) are
// config SMELTING.
//
// Two layers:
//   Furnace                one furnace's state — a 3-slot SlotContainer
//                          (input / fuel / output, vanilla slot rules) plus
//                          the burn/progress state machine. Pure logic — no
//                          DOM, no three.js — so node tests drive it.
//   createSmeltingSystem   the per-position furnace map. Every furnace ticks
//                          every frame whether or not its screen is open —
//                          smelting continues with the UI closed, and
//                          multiple furnaces run independently. While a
//                          furnace burns, its block swaps to the lit variant
//                          (glowing front tile, emits light 13) and back.
//                          Breaking a furnace drops its slots' contents.
//
// Vanilla rules kept: fuel is only consumed when a smelt can actually run
// (input has a recipe and the output has room); once consumed, fuel burns to
// exhaustion even idle; progress rewinds while unlit or blocked; a lava
// bucket leaves the empty bucket in the fuel slot.

import { SMELTING } from '../config.js';
import { SlotContainer, itemMaxStack } from '../player/inventory.js';
import { isFurnace, furnaceLitVariant, furnaceUnlitVariant } from '../world/blocks.js';

// ---------------------------------------------------------------------------
// Registries — SPEC.md "Smelting"
// ---------------------------------------------------------------------------

// input item -> output item (always 1:1). "raw food -> cooked food" covers
// the four passive-mob meats; their item ids follow the texture names
// (beef, porkchop...), the same convention tools use.
export const SMELT_RECIPES = {
  raw_iron: 'iron_ingot',
  raw_gold: 'gold_ingot',
  sand: 'glass',
  cobblestone: 'stone',
  beef: 'cooked_beef',
  porkchop: 'cooked_porkchop',
  chicken: 'cooked_chicken',
  mutton: 'cooked_mutton',
};

// fuel item -> items smelted per unit (SPEC: coal 8, planks 1.5, sticks 0.5,
// lava bucket 100). Burn seconds = value * SMELTING.SMELT_SECONDS.
export const FUEL_ITEMS = {
  coal: 8,
  oak_planks: 1.5,
  stick: 0.5,
  lava_bucket: 100,
};

// Consuming some fuels leaves an item behind (lava bucket -> empty bucket).
const FUEL_RESIDUE = { lava_bucket: 'bucket' };

export function isFuel(name) {
  return FUEL_ITEMS[name] !== undefined;
}

export function smeltResult(name) {
  return SMELT_RECIPES[name] ?? null;
}

// ---------------------------------------------------------------------------
// One furnace
// ---------------------------------------------------------------------------

export const SLOT_INPUT = 0;
export const SLOT_FUEL = 1;
export const SLOT_OUTPUT = 2;

export class Furnace extends SlotContainer {
  constructor() {
    super(3);
    this.burnRemaining = 0; // seconds of the current fuel unit left
    this.burnCapacity = 0;  // what the current fuel unit started with
    this.progress = 0;      // seconds toward the current smelt
    this._cookingName = null; // input item the progress belongs to
  }

  get isLit() {
    return this.burnRemaining > 0;
  }

  // Flame indicator: fraction of the current fuel unit left (vanilla).
  get fuelFraction() {
    return this.burnCapacity > 0
      ? Math.min(1, this.burnRemaining / this.burnCapacity)
      : 0;
  }

  // Progress arrow: fraction of the current smelt done.
  get progressFraction() {
    return Math.min(1, this.progress / SMELTING.SMELT_SECONDS);
  }

  // Vanilla slot gating: anything may go in the input, only fuel in the
  // fuel slot, nothing may ever be placed into the output.
  canPlaceIn(i, name) {
    if (i === SLOT_OUTPUT) return false;
    if (i === SLOT_FUEL) return isFuel(name);
    return true;
  }

  // Click semantics honour the slot gates: a disallowed placement is inert,
  // except that clicking a gated slot holding the same plain item pulls it
  // onto the cursor (how vanilla lets you collect output onto a stack).
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

  // Shift-click routing INTO the furnace (inventory.moveSlotTo calls this):
  // smeltable items head to the input, fuel to the fuel slot (a smeltable
  // fuel prefers the input, like vanilla). Returns the count that didn't fit.
  addStack(stack) {
    if (stack.durability != null) return stack.count; // tools never route in
    let left = stack.count;
    if (SMELT_RECIPES[stack.name]) left = this._mergeAt(SLOT_INPUT, stack.name, left);
    if (left > 0 && isFuel(stack.name)) left = this._mergeAt(SLOT_FUEL, stack.name, left);
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

  // Advance the furnace by dt seconds. Slot changes emit; continuous
  // burn/progress movement does not (the screen polls those per frame).
  update(dt) {
    if (dt <= 0) return;
    const input = this.slots[SLOT_INPUT];
    // Progress belongs to a specific input item (vanilla): swapping the
    // input mid-smelt restarts the cook — otherwise a cheap item could be
    // run to 99% and swapped for a slow one to finish near-instantly.
    const inputName = input?.name ?? null;
    if (inputName !== this._cookingName) {
      this._cookingName = inputName;
      this.progress = 0;
    }
    const result = input ? SMELT_RECIPES[input.name] : null;
    const out = this.slots[SLOT_OUTPUT];
    const canSmelt = !!result &&
      (!out || (out.name === result && out.durability == null &&
                out.count < itemMaxStack(result)));
    let changed = false;

    // Ignite: consume one fuel unit only when a smelt can actually run.
    const tryIgnite = () => {
      const fuel = this.slots[SLOT_FUEL];
      const value = fuel && fuel.durability == null ? FUEL_ITEMS[fuel.name] : undefined;
      if (!value) return;
      this.burnCapacity = value * SMELTING.SMELT_SECONDS;
      this.burnRemaining = this.burnCapacity;
      const residue = FUEL_RESIDUE[fuel.name];
      fuel.count -= 1;
      if (fuel.count <= 0) {
        this.slots[SLOT_FUEL] = residue ? { name: residue, count: 1 } : null;
      }
      changed = true;
    };
    if (this.burnRemaining <= 0 && canSmelt) tryIgnite();

    const lit = this.burnRemaining > 0;
    if (lit) {
      this.burnRemaining = Math.max(0, this.burnRemaining - dt);
      // A fuel unit exhausting mid-smelt re-ignites within the same update:
      // a continuous burn must never observe an unlit frame — the one-frame
      // blink swapped the block unlit and back, costing ~10 chunk remeshes
      // per fuel boundary (review finding).
      if (this.burnRemaining <= 0 && canSmelt) tryIgnite();
    }

    if (lit && canSmelt) {
      this.progress += dt;
      // The epsilon absorbs float drift when the burn divides into frames
      // exactly (fuel worth N smelts must complete N, never N-1 by 1e-13).
      if (this.progress >= SMELTING.SMELT_SECONDS - 1e-9) {
        // Carry the overshoot into the next smelt: progress accrues 1:1
        // with burn time, so discarding the remainder here would eat one
        // frame of burn per item — a coal (exactly 8 smelts of burn)
        // finished only 7 items, with the 8th stranded at ~99% as the
        // flame died (review finding, regression-tested).
        this.progress -= SMELTING.SMELT_SECONDS;
        input.count -= 1;
        if (input.count <= 0) this.slots[SLOT_INPUT] = null;
        if (out) out.count += 1;
        else this.slots[SLOT_OUTPUT] = { name: result, count: 1 };
        changed = true;
      }
    } else if (this.progress > 0) {
      // Unlit or blocked: the smelt rewinds (vanilla), it never holds.
      this.progress = Math.max(0, this.progress - dt * SMELTING.PROGRESS_DECAY);
    }

    if (changed) this._emit();
  }
}

// ---------------------------------------------------------------------------
// The world-facing system
// ---------------------------------------------------------------------------

export function createSmeltingSystem({ world, items }) {
  const furnaces = new Map(); // "x,y,z" -> { furnace, x, y, z }
  const keyOf = (x, y, z) => `${x},${y},${z}`;

  // The furnace state for a block position, created on first use (opening
  // the screen). Returns null if the block there isn't a furnace.
  function furnaceAt(x, y, z) {
    if (!isFurnace(world.getBlock(x, y, z))) return null;
    const key = keyOf(x, y, z);
    let entry = furnaces.get(key);
    if (!entry) {
      entry = { furnace: new Furnace(), x, y, z };
      furnaces.set(key, entry);
    }
    return entry.furnace;
  }

  // Block listener: a furnace block replaced by anything non-furnace
  // (mined; lit<->unlit swaps stay in the family) drops its contents and
  // forgets its state.
  function onBlockChanged(x, y, z, id) {
    const key = keyOf(x, y, z);
    const entry = furnaces.get(key);
    if (!entry || isFurnace(id)) return;
    for (const s of entry.furnace.drainAll()) {
      items.spawn(
        s.name, s.count,
        { x: x + 0.5, y: y + 0.25, z: z + 0.5 },
        undefined, s.durability ?? undefined,
      );
    }
    furnaces.delete(key);
  }

  // Tick every furnace, open screen or not, and keep each block's lit
  // variant in sync with its burn state (facing preserved).
  function update(dt) {
    for (const entry of furnaces.values()) {
      entry.furnace.update(dt);
      const current = world.getBlock(entry.x, entry.y, entry.z);
      if (!isFurnace(current)) continue; // listener handles the teardown
      const want = entry.furnace.isLit
        ? furnaceLitVariant(current)
        : furnaceUnlitVariant(current);
      if (want !== current) world.setBlock(entry.x, entry.y, entry.z, want);
    }
  }

  // Dimension switch (Phase 15): furnace states are keyed by position, so a
  // Nether furnace at (2, 65, 3) must never collide with an overworld one.
  // The exported Map keeps its identity (entries copied in place); stored
  // furnaces freeze — vanilla furnaces in unloaded chunks pause the same
  // way. State shape: array of [key, entry].
  function swapDimensionState(stored = []) {
    const prev = [...furnaces.entries()];
    furnaces.clear();
    for (const [k, entry] of stored) furnaces.set(k, entry);
    return prev;
  }

  return {
    update,
    onBlockChanged,
    furnaceAt,
    swapDimensionState,
    furnaces, // read-only by convention (debug/tests)
  };
}
