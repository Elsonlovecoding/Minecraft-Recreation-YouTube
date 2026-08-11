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
import { BLOCK, blockDef, isCrossPlant } from '../world/blocks.js';
import { raycastVoxel, isTargetable, isReplaceable } from './interaction.js';
import { particles } from '../render/particles.js';
import { audio } from '../systems/audio.js';

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
    const at = { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 };
    if (hit.id === BLOCK.LAVA) audio.lavaPop(at, 0.7);
    else audio.splash(at, 0.7);
    hand.replace(hit.id === BLOCK.LAVA ? 'lava_bucket' : 'water_bucket');
    return true;
  }

  // Phase 22: placement runs its OWN fluid-aware ray rather than reusing the
  // block raycast's target. The block ray skips fluids entirely, so aiming
  // anywhere at a pool, a flowing stream or the water you are standing in
  // used to resolve to the solid floor UNDER it (or to nothing at all, past
  // reach) and the click silently did nothing — the reported "right-clicking
  // a full water bucket does nothing". Now: a fluid cell on the ray takes
  // the source directly (vanilla replaces a flow with a source), a solid one
  // takes it on the clicked FACE, and nothing else changes.
  function tryPlaceFluid(hand, fluidId) {
    const hit = raycastVoxel(getBlock, rayOrigin, rayDir, PLAYER.REACH, fluidOrTargetable);
    let x;
    let y;
    let z;
    if (hit && blockDef(hit.id).fluid) {
      if (hit.id === fluidId) return false; // already a source of this fluid
      x = hit.x;
      y = hit.y;
      z = hit.z;
    } else {
      const target = hit ?? getTarget();
      if (!target) return false;
      if (isCrossPlant(target.id)) {
        // Phase 24: a cross plant is replaceable — the bucket pours into
        // its cell rather than onto the face above it.
        x = target.x;
        y = target.y;
        z = target.z;
      } else {
        const [fx, fy, fz] = target.face;
        if (fx === 0 && fy === 0 && fz === 0) return false;
        x = target.x + fx;
        y = target.y + fy;
        z = target.z + fz;
      }
    }
    if (y < OVERWORLD.MIN_Y || y >= OVERWORLD.MIN_Y + CHUNK.HEIGHT) return false;
    if (!isReplaceable(world.getBlock(x, y, z))) return false;
    // Fluids may be placed into the player's own cell (vanilla) — they have
    // no collision box, so no overlap check.
    world.setBlock(x, y, z, fluidId);
    const at = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    if (fluidId === BLOCK.LAVA) {
      particles.lavaPop(x, y, z);
      audio.lavaPop(at, 0.9);
    } else {
      particles.splash(x + 0.5, y + 0.6, z + 0.5, 1.2);
      audio.splash(at, 0.9);
    }
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
      audio.bubble(player.body.position, 0.9);
    } else {
      audio.bubble(player.body.position, 0.9);
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
