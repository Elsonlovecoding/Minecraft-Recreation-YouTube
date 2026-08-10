// player/fluid_actions.js — the bucket and bottle fluid actions, split out
// of player/interaction.js in Phase 19 per the ARCHITECTURE file-size cap
// note it carried since Phase 18 ("the bucket/bottle fluid actions are the
// natural cut"). Moved verbatim; they close over the interaction's live
// ray state through the factory (rayOrigin/rayDir are the same mutated
// vectors, `getTarget` reads the frame's raycast result).
//
// Buckets (Phase 11): an empty bucket scoops the first fluid SOURCE on the
// crosshair ray (a solid block in front still wins); a full bucket places
// its fluid against the targeted face. Glass bottles (Phase 18) fill into
// water bottles at a water source WITHOUT consuming it (vanilla). One
// action per press throughout — the held item changes underneath, so
// hold-repeat must not run.

import { OVERWORLD, CHUNK, PLAYER } from '../config.js';
import { BLOCK, blockDef } from '../world/blocks.js';
import { raycastVoxel, isTargetable, isReplaceable } from './interaction.js';

export function createFluidActions({
  world, player, inventory, items, getBlock, rayOrigin, rayDir, getTarget,
}) {
  const fluidOrTargetable = (id) => isTargetable(id) || blockDef(id).fluid;

  function tryScoopFluid(hand) {
    const hit = raycastVoxel(getBlock, rayOrigin, rayDir, PLAYER.REACH, fluidOrTargetable);
    // Only SOURCE blocks fill a bucket (vanilla) — flowing lava is not a
    // bucketful, so a flow cell on the ray consumes nothing.
    if (!hit || (hit.id !== BLOCK.WATER && hit.id !== BLOCK.LAVA)) return false;
    world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
    hand.replace(hit.id === BLOCK.LAVA ? 'lava_bucket' : 'water_bucket');
    return true;
  }

  function tryPlaceFluid(hand, fluidId) {
    const target = getTarget();
    if (!target) return false;
    const [fx, fy, fz] = target.face;
    if (fx === 0 && fy === 0 && fz === 0) return false;
    const x = target.x + fx;
    const y = target.y + fy;
    const z = target.z + fz;
    if (y < OVERWORLD.MIN_Y || y >= OVERWORLD.MIN_Y + CHUNK.HEIGHT) return false;
    if (!isReplaceable(world.getBlock(x, y, z))) return false;
    // Fluids may be placed into the player's own cell (vanilla) — they have
    // no collision box, so no overlap check.
    world.setBlock(x, y, z, fluidId);
    hand.replace('bucket');
    return true;
  }

  // Full-bucket placement for the acting hand's item, or false when it
  // isn't a filled bucket (the press falls through to eating/placing).
  // Empty-bucket scooping resolves EARLIER than the use-block check
  // (interaction.update) because a nearer fluid must win over a usable
  // block behind it.
  function tryBucketPlace(hand) {
    const name = hand.name;
    if (name === 'water_bucket') return tryPlaceFluid(hand, BLOCK.WATER);
    if (name === 'lava_bucket') return tryPlaceFluid(hand, BLOCK.LAVA);
    return false;
  }

  // Is a water SOURCE the first thing on the crosshair ray within reach?
  // (the glass bottle's fill condition — resolved for the active-hand
  // rule as well as the action itself; a nearer solid still wins.)
  function waterSourceInReach() {
    const hit = raycastVoxel(getBlock, rayOrigin, rayDir, PLAYER.REACH, fluidOrTargetable);
    return !!hit && hit.id === BLOCK.WATER;
  }

  // Glass bottle at a water source (Phase 18): the first WATER source on
  // the crosshair ray fills the bottle — the source itself stays (vanilla,
  // unlike the bucket). A single held bottle swaps in place; from a stack,
  // one is consumed and the water bottle joins the inventory (dropping at
  // the feet when nothing fits — never silently lost).
  function tryFillBottle(hand) {
    if (!waterSourceInReach()) return false;
    if (hand.stack?.count === 1) {
      hand.replace('water_bottle');
    } else {
      hand.consume(1);
      if (inventory.add('water_bottle', 1) > 0) {
        const p = player.body.position;
        items.spawn('water_bottle', 1, { x: p.x, y: p.y + 1, z: p.z });
      }
    }
    return true;
  }

  return { tryScoopFluid, tryBucketPlace, tryFillBottle, waterSourceInReach };
}
