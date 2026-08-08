// entities/falling.js — Falling block entities: sand and gravel (registry
// `falls: true`) detach when the block under them is removed, fall as a
// full-size mini-block visual, and settle back into the world where they
// land. Vanilla rules: a block that lands in a cell holding a non-solid,
// non-fluid block (a torch) breaks and drops as an item; fluids are simply
// replaced — falling blocks sink through water AND lava and settle on the
// floor beneath, so lava lakes can be filled with gravel like vanilla.
//
// The manager listens to world.onBlockChanged (wired in main.js): any edit
// queues a support check for the cell above it (mined support) and for the
// cell itself (a falls-block placed with nothing under it). A settling or
// detaching block edits the world through world.setBlock, so cascades — a
// whole gravel column above a mined cell — chain naturally, one entity per
// vacated cell.

import * as THREE from 'three';
import { FALLING, CHUNK, OVERWORLD } from '../config.js';
import { BLOCK, blockDef, isSolid } from '../world/blocks.js';
import { createBlockMesh } from './items.js';

export function createFallingBlocks({ world, scene, items }) {
  const entities = [];
  const pending = []; // cells queued for a support check

  function onBlockChanged(x, y, z) {
    pending.push(x, y + 1, z); // block above may have lost its support
    pending.push(x, y, z);     // the placed block itself may be unsupported
  }

  // Detach a falls-block into an entity when nothing solid is under it.
  // (Falling through fluids is allowed — sand sinks in water and lava.)
  function maybeDetach(x, y, z) {
    const id = world.getBlock(x, y, z);
    if (!blockDef(id).falls) return;
    if (isSolid(world.getBlock(x, y - 1, z))) return;
    world.setBlock(x, y, z, BLOCK.AIR); // queues the check above via the hook
    const mesh = createBlockMesh(id, 1);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    scene.add(mesh);
    entities.push({ id, x, z, baseY: y, vy: 0, mesh });
  }

  // The entity settles into `cy` (its below-neighbour is solid) — or breaks.
  function settle(e, cy) {
    const content = world.getBlock(e.x, cy, e.z);
    if (content === BLOCK.AIR || blockDef(content).fluid) {
      // Fluids (water and lava alike) are displaced — vanilla lake-filling.
      world.setBlock(e.x, cy, e.z, e.id);
    } else {
      // Landed on a non-solid obstruction (torch): pop off as an item.
      items.spawn(blockDef(e.id).name, 1, { x: e.x + 0.5, y: cy + 1, z: e.z + 0.5 });
    }
    e.mesh.removeFromParent();
    e.done = true;
  }

  function update(dt) {
    // Support checks queued by world edits (bounded: entries only come from
    // real block changes).
    while (pending.length) {
      const z = pending.pop();
      const y = pending.pop();
      const x = pending.pop();
      maybeDetach(x, y, z);
    }

    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      // Freeze in unloaded chunks (same reason as dropped items: physics
      // would regenerate chunks synchronously outside the streaming budget).
      if (!world.getChunkIfLoaded(
        Math.floor(e.x / CHUNK.SIZE),
        Math.floor(e.z / CHUNK.SIZE),
      )) continue;

      e.vy = Math.min(e.vy + FALLING.GRAVITY * dt, FALLING.MAX_FALL_SPEED);
      const ny = e.baseY - e.vy * dt;
      // Sweep every crossed cell so fast falls can't tunnel through a floor.
      for (let cy = Math.floor(e.baseY); cy >= Math.floor(ny); cy--) {
        const content = world.getBlock(e.x, cy, e.z);
        if (content !== BLOCK.AIR && !blockDef(content).fluid) {
          // Fell onto a non-solid obstruction inside this cell (torch).
          settle(e, cy);
          break;
        }
        if (isSolid(world.getBlock(e.x, cy - 1, e.z)) || cy === OVERWORLD.MIN_Y) {
          settle(e, cy);
          break;
        }
      }
      if (e.done) {
        entities.splice(i, 1);
        continue;
      }
      e.baseY = ny;
      e.mesh.position.y = ny + 0.5;
    }
  }

  // Dimension switch (Phase 15): mid-fall blocks and queued support checks
  // belong to their dimension — swap them out frozen/hidden, restore the
  // incoming set. State shape: { entities, pending }.
  function swapDimensionState(stored = { entities: [], pending: [] }) {
    const prev = { entities: entities.slice(), pending: pending.slice() };
    for (const e of prev.entities) e.mesh.visible = false;
    entities.length = 0;
    pending.length = 0;
    for (const e of stored.entities) {
      e.mesh.visible = true;
      entities.push(e);
    }
    pending.push(...stored.pending);
    return prev;
  }

  return {
    onBlockChanged,
    update,
    swapDimensionState,
    get count() {
      return entities.length;
    },
  };
}
