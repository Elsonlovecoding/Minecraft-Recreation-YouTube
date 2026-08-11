// player/placement.js — block placement rules, split out of
// player/interaction.js in Phase 21 per the ARCHITECTURE file-size cap
// (interaction was at 765 of 800 and the building-block pass adds the
// multi-cell and support rules below). The single-cell path moved verbatim;
// everything new is the Phase 21 building set:
//
//   slabs      a second slab of the same material on a matching slab makes
//              the full block (vanilla's double slab)
//   doors      two cells tall, both must be free, and the lower needs floor
//   beds       two cells long along the placement facing, both supported
//   ladders    hang on a wall face only
//   signs      standing on a floor, or hanging on a wall face
//   frames     wall faces only
//
// The oriented-variant choice itself (which of a family's four facings) lives
// in world/blocks.js placementVariant, so the registry stays the single
// source of truth for what a block IS and this module only decides WHERE.

import { OVERWORLD, CHUNK, PLAYER } from '../config.js';
import {
  BLOCK, blockDef, blockIdByName, placementVariant, PLANTABLE, isSolid,
  SLAB_FAMILY_OF, SLAB_ITEM_FAMILIES, DOOR_INFO, DOOR_UPPER_BY_FACING,
  BED_INFO, BED_HEAD_BY_FACING, FACING_DELTA, isBed, isSign, isItemFrame,
  isDoor, LADDER_BY_FACING, SIGN_IDS, isClimbable, isCrossPlant,
  plantCanSitOn,
} from '../world/blocks.js';
import { particles } from '../render/particles.js';
import { audio, blockSoundGroup } from '../systems/audio.js';

const FACING_INDEX = { N: 0, S: 1, E: 2, W: 3 };

// Phase 22: every successful placement puffs the block's own texture and
// thumps in its material. One helper, called from each success path, so a
// door and a slab sound exactly like the generic case.
function placedFeedback(x, y, z, id) {
  particles.blockPlace(x, y, z, id);
  audio.placeBlock(
    blockSoundGroup(blockDef(id).name),
    { x: x + 0.5, y: y + 0.5, z: z + 0.5 },
  );
}

// A cell a new block may replace: air, fluids and — Phase 24 — the cross
// plants (vanilla: placing into tall grass replaces it, no drop). Shared
// with the bucket actions, so poured water also displaces a plant.
export function isReplaceable(id) {
  return id === BLOCK.AIR || blockDef(id).fluid || isCrossPlant(id);
}

// Would a block at cell (x, y, z) overlap the player's AABB? feet is the
// body position (feet centre). Exact face contact does not block placement.
export function placementBlockedByPlayer(x, y, z, feet) {
  const hw = PLAYER.WIDTH / 2;
  return (
    feet.x - hw < x + 1 && feet.x + hw > x &&
    feet.y < y + 1 && feet.y + PLAYER.HEIGHT > y &&
    feet.z - hw < z + 1 && feet.z + hw > z
  );
}

// `onPlaceSign(cell)` (optional) opens the sign's text entry right after a
// sign lands, like vanilla.
export function createPlacement({
  world, player, getTarget, startSwing, onPlaceSign,
}) {
  const inWorld = (y) => y >= OVERWORLD.MIN_Y && y < OVERWORLD.MIN_Y + CHUNK.HEIGHT;
  const freeCell = (x, y, z) =>
    inWorld(y) && isReplaceable(world.getBlock(x, y, z)) &&
    !placementBlockedByPlayer(x, y, z, player.body.position);

  // The block a shaped piece needs under it (signs, doors, beds, pots all
  // want real floor, not another sign).
  const supportedFrom = (x, y, z) => isSolid(world.getBlock(x, y - 1, z));

  function tryPlace(hand) {
    const target = getTarget();
    if (!target) return false;
    const [fx, fy, fz] = target.face;
    if (fx === 0 && fy === 0 && fz === 0) return false; // ray started inside it
    const name = hand.name;
    if (!name) return false;
    const id = blockIdByName(name);
    if (id === null) return tryPlant(hand, name, target);

    // --- slabs: a matching slab on a matching slab becomes the full block --
    const heldSlab = SLAB_ITEM_FAMILIES[name];
    if (heldSlab && SLAB_FAMILY_OF[target.id] === heldSlab) {
      world.setBlock(target.x, target.y, target.z, heldSlab.full);
      placedFeedback(target.x, target.y, target.z, heldSlab.full);
      hand.consume(1);
      startSwing(hand.key);
      return true;
    }

    // Torches need solid support (the clicked block IS the support).
    if (id === BLOCK.TORCH && !blockDef(target.id).solid) return false;

    const x = target.x + fx;
    const y = target.y + fy;
    const z = target.z + fz;
    // Outside the world's vertical range setBlock is a silent no-op — don't
    // let it eat the stack count.
    if (!inWorld(y)) return false;
    if (!isReplaceable(world.getBlock(x, y, z))) return false;
    // Torches can't stand in a fluid (vanilla) — the generic rule lets
    // blocks displace fluid cells, but a torch would burn underwater and
    // silently delete the source. Plants are the same (Phase 24): they go
    // into plain air only, never displacing water or another plant.
    if (
      (id === BLOCK.TORCH || isCrossPlant(id)) &&
      world.getBlock(x, y, z) !== BLOCK.AIR
    ) return false;
    // Walk-through shapes (ladders, signs, frames) never block the player,
    // so they may be placed in the player's own cell — everything else may
    // not.
    const solidShape = blockDef(id).solid;
    if (solidShape && placementBlockedByPlayer(x, y, z, player.body.position)) {
      return false;
    }

    // Oriented blocks place their variant: furnaces face the player, torches
    // become the wall variant leaning out of the clicked face, stairs climb
    // the way the player looks; null = the clicked face can't hold this
    // block (a torch or ladder on a ceiling).
    const placed = placementVariant(id, { x, y, z }, player.body.position, target.face);
    if (placed === null) return false;

    // --- support rules ------------------------------------------------------
    if (isClimbable(placed) || isItemFrame(placed) || SIGN_IDS.wall.includes(placed)) {
      // Wall-mounted: the block behind them must be solid.
      if (!isSolid(world.getBlock(target.x, target.y, target.z))) return false;
    }
    if (SIGN_IDS.stand.includes(placed) && !supportedFrom(x, y, z)) return false;
    if (placed === BLOCK.FLOWER_POT && !supportedFrom(x, y, z)) return false;
    // Phase 24 — plants need their soil: grass or dirt (dead bush also sand).
    if (
      isCrossPlant(placed) &&
      !plantCanSitOn(placed, world.getBlock(x, y - 1, z))
    ) return false;

    // --- two-cell pieces ----------------------------------------------------
    if (isDoor(placed)) {
      if (!supportedFrom(x, y, z)) return false;
      if (!freeCell(x, y + 1, z)) return false;
      const facing = DOOR_INFO[placed].facing;
      world.setBlock(x, y, z, placed);
      world.setBlock(x, y + 1, z, DOOR_UPPER_BY_FACING[FACING_INDEX[facing]]);
      placedFeedback(x, y, z, placed);
      hand.consume(1);
      startSwing(hand.key);
      return true;
    }
    if (isBed(placed)) {
      const facing = BED_INFO[placed].facing;
      const [dx, dz] = FACING_DELTA[facing];
      const hx = x + dx;
      const hz = z + dz;
      if (!supportedFrom(x, y, z) || !supportedFrom(hx, y, hz)) return false;
      if (!freeCell(hx, y, hz)) return false;
      world.setBlock(x, y, z, placed);
      world.setBlock(hx, y, hz, BED_HEAD_BY_FACING[FACING_INDEX[facing]]);
      placedFeedback(x, y, z, placed);
      hand.consume(1);
      startSwing(hand.key);
      return true;
    }

    world.setBlock(x, y, z, placed);
    placedFeedback(x, y, z, placed);
    hand.consume(1); // the hand visuals refresh via the subscription
    startSwing(hand.key);
    if (isSign(placed)) onPlaceSign?.({ x, y, z });
    return true;
  }

  // Plantable items (Phase 17: nether wart) place their crop block on their
  // soil's TOP face only, into air only — never displacing a fluid, never
  // sideways off a bed's edge.
  function tryPlant(hand, name, target) {
    const plant = PLANTABLE[name];
    if (!plant) return false; // the held item isn't placeable at all
    if (target.face[1] !== 1 || target.id !== plant.soil) return false;
    if (!inWorld(target.y + 1)) return false;
    if (world.getBlock(target.x, target.y + 1, target.z) !== BLOCK.AIR) return false;
    world.setBlock(target.x, target.y + 1, target.z, plant.block);
    placedFeedback(target.x, target.y + 1, target.z, plant.block);
    hand.consume(1);
    startSwing(hand.key);
    return true;
  }

  return { tryPlace };
}

// Re-exported so callers that only want the shape rules don't need the
// factory (ladders are the one placeable that is also climbable).
export { LADDER_BY_FACING };
