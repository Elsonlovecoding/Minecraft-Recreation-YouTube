// world/wart.js — Phase 17: nether wart lifecycle. Fortress wart rooms
// generate fully grown wart (stage 2); harvesting one drops 2-4 nether
// wart; planting a wart item on soul sand (player/interaction.js consults
// blocks.js PLANTABLE) places stage 0, which this system grows to stage 2
// on seeded-free runtime timers — one WART.GROW_* roll per stage. Growth
// advances through world.setBlock, so remeshing and this module's own
// re-registration ride the normal listener chain. Wart in unloaded chunks
// freezes (the universal rule). Breaking the SOUL SAND under any wart pops
// the plant with its stage's drops (the torch support rule).

import { WART, CHUNK } from '../config.js';
import {
  BLOCK, blockDef, isWart, WART_STAGE, WART_STAGE_BLOCKS,
} from './blocks.js';

export function createWart({ world, items }) {
  const growing = new Map(); // "x,y,z" -> seconds until the next stage
  const keyOf = (x, y, z) => `${x},${y},${z}`;

  const rollGrowth = () =>
    WART.GROW_MIN_SECONDS +
    Math.random() * (WART.GROW_MAX_SECONDS - WART.GROW_MIN_SECONDS);

  // Registry drop roll for a popped wart — the shared roller on the item
  // manager (Phase 24), same semantics mining uses.
  function dropWart(def, x, y, z) {
    items.spawnDrops(def.drops, x, y, z);
  }

  // Block listener: growing stages register a timer, anything else clears
  // it; and a support change under any wart pops the plant (drops ride).
  function onBlockChanged(x, y, z, id) {
    const key = keyOf(x, y, z);
    const stage = WART_STAGE[id];
    if (stage !== undefined && stage < 2) {
      if (!growing.has(key)) growing.set(key, rollGrowth());
    } else {
      growing.delete(key);
    }

    // The changed cell may be the soil of a wart directly above it.
    if (id !== BLOCK.SOUL_SAND) {
      const above = world.getBlock(x, y + 1, z);
      if (isWart(above)) {
        world.setBlock(x, y + 1, z, BLOCK.AIR);
        dropWart(blockDef(above), x, y + 1, z);
      }
    }
  }

  function update(dt) {
    if (dt <= 0 || growing.size === 0) return;
    let advance = null; // collected first — setBlock re-enters the listener
    for (const [key, left] of growing) {
      const [x, , z] = key.split(',').map(Number);
      // Frozen in unloaded chunks like every timed system.
      if (!world.getChunkIfLoaded(
        Math.floor(x / CHUNK.SIZE), Math.floor(z / CHUNK.SIZE),
      )) {
        continue;
      }
      const next = left - dt;
      if (next > 0) {
        growing.set(key, next);
      } else {
        (advance ??= []).push(key);
      }
    }
    if (!advance) return;
    for (const key of advance) {
      const [x, y, z] = key.split(',').map(Number);
      const stage = WART_STAGE[world.getBlock(x, y, z)];
      if (stage === undefined || stage >= 2) {
        growing.delete(key); // stale entry (block changed underneath)
        continue;
      }
      // setBlock fires onBlockChanged: the old entry clears, and a stage-1
      // plant re-registers itself with a fresh roll.
      growing.delete(key);
      world.setBlock(x, y, z, WART_STAGE_BLOCKS[stage + 1]);
    }
  }

  // Dimension switch: growth timers are world positions and belong to
  // their dimension (the chests protocol). State shape: array of
  // [key, secondsLeft].
  function swapDimensionState(stored = []) {
    const prev = [...growing.entries()];
    growing.clear();
    for (const [k, t] of stored) growing.set(k, t);
    return prev;
  }

  return {
    update,
    onBlockChanged,
    swapDimensionState,
    growing, // read-only by convention (debug/tests)
  };
}
