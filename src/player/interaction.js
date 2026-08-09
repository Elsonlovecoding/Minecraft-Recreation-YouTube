// player/interaction.js — Phase 6: block targeting and editing. A voxel
// raycast from the camera picks the targeted block within PLAYER.REACH; a
// black outline marks the targeted face; holding left-click breaks the block
// over a hardness/tool-derived time with a 10-stage crack overlay; right-click
// places against the targeted face (never inside the player); breaking spawns
// dropped items (entities/items.js) per the registry drops table. A
// first-person hand — the arm, or the block about to be placed — swings on
// every click.
//
// Pure logic (raycastVoxel, miningPlan, placement checks) is exported for the
// node test harness; everything DOM/three.js lives in createInteraction.
//
// Phase 7: the real inventory (player/inventory.js) drives everything the
// proto-inventory scaffolding used to — the hotbar selection is what the hand
// shows, what mining checks and what right-click places; breaking a block
// with a tool wears its durability. Number keys 1-9 and the scroll wheel
// change the selection here (gameplay input, pointer-locked only).
//
// Phase 8: cracks are the real destroy_stage_0..9.png textures; the hand
// renders in its own fixed-FOV pass (renderHand) so the held block is an
// undistorted cube; right-click on a usable block defers to onUseBlock
// (main.js opens the crafting screen for a crafting table).

import * as THREE from 'three';
import {
  PLAYER, INTERACTION, ITEMS, RENDER, TOOL_TIERS, WRONG_TIER_SPEED_MULTIPLIER,
  OVERWORLD, CHUNK, STATS, MOBS,
} from '../config.js';
import {
  BLOCK, blockDef, blockIdByName, placementVariant, PLANTABLE,
} from '../world/blocks.js';
import { consumableValue, armourSlotIndex } from './inventory.js';
import { createHand } from './hand.js';

const TIER_RANK = { hand: 0, wood: 1, stone: 2, iron: 3, diamond: 4 };

// ---------------------------------------------------------------------------
// Pure logic (node-testable)
// ---------------------------------------------------------------------------

// A block the crosshair can target: anything minable (hardness set) — so not
// air, fluids or portal interiors, but torches and leaves count.
export function isTargetable(id) {
  return blockDef(id).hardness !== null;
}

// A cell a new block may replace: air and fluids only.
export function isReplaceable(id) {
  return id === BLOCK.AIR || blockDef(id).fluid;
}

// Voxel raycast (Amanatides & Woo grid traversal): walks every cell the ray
// passes through, in order, out to maxDist. Returns the first targetable
// block as { x, y, z, id, face, distance } — face is the unit normal of the
// entered face (pointing back at the viewer), or [0,0,0] when the ray starts
// inside the block. Returns null on no hit.
export function raycastVoxel(getBlock, origin, dir, maxDist, targetable = isTargetable) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = dir.x !== 0 ? ((stepX > 0 ? x + 1 : x) - origin.x) / dir.x : Infinity;
  let tMaxY = dir.y !== 0 ? ((stepY > 0 ? y + 1 : y) - origin.y) / dir.y : Infinity;
  let tMaxZ = dir.z !== 0 ? ((stepZ > 0 ? z + 1 : z) - origin.z) / dir.z : Infinity;
  let face = [0, 0, 0];
  let t = 0;
  while (t <= maxDist) {
    const id = getBlock(x, y, z);
    if (targetable(id)) return { x, y, z, id, face, distance: t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      face = [0, -stepY, 0];
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      face = [0, 0, -stepZ];
    }
  }
  return null;
}

// Held tool item name -> { toolClass, tier }, or null for anything that isn't
// a tool (bare hand, blocks, food). Tool item ids follow the texture names:
// wooden_pickaxe, stone_axe, iron_shovel, diamond_sword...
export function parseHeldTool(itemName) {
  const m = /^(wooden|stone|iron|diamond)_(pickaxe|axe|shovel|sword)$/.exec(itemName ?? '');
  if (!m) return null;
  return { toolClass: m[2], tier: m[1] === 'wooden' ? 'wood' : m[1] };
}

// How long a block takes to break with the held item, and whether it drops.
// SPEC rules: hardness is seconds at 1x; the matching tool class applies its
// tier's speed multiplier; a tier below the block's minimum still breaks it,
// but very slowly (WRONG_TIER_SPEED_MULTIPLIER) and drops nothing. A tool of
// the wrong class counts as a bare hand for the tier gate (an axe never
// harvests stone).
export function miningPlan(def, heldItemName) {
  const tool = parseHeldTool(heldItemName);
  const matchesClass = !!tool && !!def.tool && tool.toolClass === def.tool;
  const gateTier = matchesClass ? tool.tier : 'hand';
  const harvests = TIER_RANK[gateTier] >= TIER_RANK[def.minTier ?? 'hand'];
  let speed = 1;
  if (matchesClass) speed *= TOOL_TIERS[tool.tier].speedMultiplier;
  if (!harvests) speed *= WRONG_TIER_SPEED_MULTIPLIER;
  return { time: def.hardness === 0 ? 0 : def.hardness / speed, drops: harvests };
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

// ---------------------------------------------------------------------------
// Overlay art: the real destroy-stage textures
// ---------------------------------------------------------------------------

// The 10 break-progress crack stages are the genuine Minecraft
// destroy_stage_0..9.png textures (assets/destroy/), used directly. Their
// background texels are WHITE at alpha 1/255 (not black-transparent), so
// the crack material must alphaTest them away — a surviving crack texel has
// alpha 1 and the multiply-with-alpha blend reduces to dst * src.rgb, the
// authentic darken. SRGBColorSpace keeps the texel values exact through the
// output encode.
function loadCrackTextures(stages) {
  const loader = new THREE.TextureLoader();
  const textures = [];
  for (let i = 0; i < stages; i++) {
    const texture = loader.load(`${INTERACTION.DESTROY_STAGE_PATH}${i}.png`);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
  }
  return textures;
}

// ---------------------------------------------------------------------------
// The interaction controller
// ---------------------------------------------------------------------------

// Wires targeting, breaking, placing and the first-person hand into the game.
// `player` is the Phase 5 controller (body + mode), `items` the item manager,
// `inventory` the Phase 7 inventory (selection, stacks, durability), `stats`
// the Phase 11 stats (eating: hunger gate + eat()).
// `onUseBlock(target)` (optional, wired by main.js) handles right-clicking a
// usable block — a crafting table opening its screen — returning true when it
// consumed the click; sneaking bypasses it so blocks can still be placed
// against usable blocks, like vanilla.
// Phase 11 right-click priority: usable block (unless sneaking) > bucket
// fill/empty > hold-to-eat food > place the selected block.
// Phase 12: `combat` (optional, wired by main.js) is { raycast(origin, dir,
// maxDist) -> mob | null, attack(mob, dir) } — a mob under the crosshair
// intercepts the left button: clicking attacks it and mining never starts
// through it, like vanilla.
// Phase 14: the offhand. F swaps the selected hotbar stack with the
// offhand; every right-click action resolves an ACTIVE HAND first — the
// main hand if its item has any right-click use, otherwise the offhand
// (vanilla's fallback rule) — and consumes from that hand. `onUseMob`
// (main.js) handles right-clicking a mob under the crosshair (shears on a
// sheep) before any block use.
// Phase 15: `onIgnite(target)` (main.js -> dimensions/portals.js) handles a
// flint-and-steel right click on a block face — lighting a valid obsidian
// frame into a portal; a successful ignition wears the tool 1 durability.
// Phase 18: `onThrowEye()` (main.js -> entities/ender_eye.js) launches a
// thrown eye of ender toward the stronghold, returning true when thrown —
// the click consumes one eye. Glass bottles fill into water bottles at a
// water source on the crosshair ray (the bucket-scoop pattern; the source
// block is NOT consumed, vanilla). Potions drink through the eating hold.
export function createInteraction({
  world, camera, scene, canvas, player, items, inventory, stats, onUseBlock,
  onUseMob, onIgnite, onThrowEye, combat,
}) {
  // --- targeting state
  let target = null;
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();
  const getBlock = (x, y, z) => world.getBlock(x, y, z);

  // --- breaking state
  let mouseLeft = false;
  let mouseRight = false;
  let useCheckPending = false; // right-click pressed; use-vs-place resolves
                               // in update() against that frame's raycast
  let attackPending = false;   // left-click pressed; mob-vs-block resolves
                               // in update() the same way
  let breakKey = null;      // "x,y,z,id" of the block being broken
  let breakPlan = null;     // { time, drops } for that block
  let breakProgress = 0;    // 0..1
  let breakCooldown = 0;    // pause between consecutive breaks
  let placeTimer = 0;       // hold-to-place repeat
  let eating = null;        // { name, slot, t, source } during a hold-to-eat

  // --- the two hands (Phase 14). Right-click actions act through a hand
  // source: name, consumption, replacement (buckets) and wear all route to
  // the hotbar selection or the offhand slot uniformly.
  const mainHand = {
    key: 'main',
    get name() { return inventory.selectedName; },
    get stack() { return inventory.selectedStack; },
    get slotKey() { return `m${inventory.selected}`; },
    consume: (n) => inventory.consumeSelected(n),
    replace: (name) => inventory.replaceSelected(name),
    damage: (n) => inventory.damageSelected(n),
    equip: () => inventory.equipSelected(),
  };
  const offHand = {
    key: 'off',
    get name() { return inventory.offhandName; },
    get stack() { return inventory.offhandStack; },
    get slotKey() { return 'off'; },
    consume: (n) => inventory.consumeOffhand(n),
    replace: (name) => inventory.replaceOffhand(name),
    damage: (n) => inventory.damageOffhand(n),
    equip: () => inventory.equipOffhand(),
  };

  // Does this item have a right-click use THAT COULD SUCCEED right now?
  // Decides which hand acts. Context matters (review fix): food at full
  // hunger, a bow with no arrows and shears with no sheep under the
  // crosshair have no use this click — vanilla lets the offhand act then.
  function hasRightClickUse(name, mobHit) {
    if (!name) return false;
    if (name === 'bucket' || name === 'water_bucket' || name === 'lava_bucket') return true;
    if (name === 'glass_bottle') return true; // fills at a water source (Phase 18)
    if (name === 'ender_eye') return !!onThrowEye; // thrown toward the stronghold
    if (name === 'bow') return combat ? combat.hasArrow : true;
    if (name === 'shears') return !!mobHit; // no block/air use in this game
    if (name === 'flint_and_steel') return true; // portal lighting (Phase 15)
    if (armourSlotIndex(name) !== null) return true;
    // Food, or a potion (always drinkable — Phase 18).
    const food = consumableValue(name);
    if (food) return stats ? stats.canEatFood(food) : true;
    // Placeable block, or a plantable item (nether wart on soul sand).
    return blockIdByName(name) !== null || PLANTABLE[name] !== undefined;
  }

  // The acting hand for this right click: the main hand if its item has a
  // use, else the offhand if ITS item does (vanilla's fallback), else the
  // main hand (a use-less click falls through harmlessly).
  function activeHand(mobHit) {
    if (hasRightClickUse(mainHand.name, mobHit)) return mainHand;
    if (hasRightClickUse(offHand.name, mobHit)) return offHand;
    return mainHand;
  }

  // --- targeted face outline
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, -0.5, 0),
      new THREE.Vector3(0.5, -0.5, 0),
      new THREE.Vector3(0.5, 0.5, 0),
      new THREE.Vector3(-0.5, 0.5, 0),
    ]),
    new THREE.LineBasicMaterial({
      color: INTERACTION.OUTLINE_COLOR,
      transparent: true,
      opacity: INTERACTION.OUTLINE_OPACITY,
      toneMapped: false,
    }),
  );
  outline.visible = false;
  outline.renderOrder = 1;
  scene.add(outline);
  const faceNormal = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);

  // --- crack overlay
  const crackTextures = loadCrackTextures(RENDER.BREAK_STAGES);
  // A unit cube EXACTLY on the block faces: the crack texels align with the
  // block's own texel grid from every angle (an inflated cube parallaxes the
  // overlay off the face at grazing views — the Phase 12 one-pixel-offset
  // fix). polygonOffset pulls the crack's depth in front of the coplanar
  // face without moving any fragment on screen.
  const crackMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      map: crackTextures[0],
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: INTERACTION.CRACK_POLYGON_OFFSET_FACTOR,
      polygonOffsetUnits: INTERACTION.CRACK_POLYGON_OFFSET_UNITS,
      // The destroy-stage background texels are WHITE at alpha 1/255 — they
      // must be discarded, not blended (blended they'd double the face
      // brightness: dst * (1 + 1 - 1/255)). What survives the alphaTest has
      // alpha 1, so the blend is exactly out = dst * src.rgb: crack texels
      // DARKEN whatever the face renders as, tracking the terrain's baked
      // light — dark at night, never a fullbright glow.
      alphaTest: RENDER.CUTOUT_ALPHA_TEST,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    }),
  );
  crackMesh.visible = false;
  scene.add(crackMesh);

  // --- first-person hand (player/hand.js — split out in Phase 13): its own
  // fixed-FOV render pass, the arm/held meshes, swing/eat/draw poses.
  const hand = createHand({ inventory, combat });
  const startSwing = hand.startSwing;
  const renderHand = hand.renderHand;

  // --- input
  const locked = () => document.pointerLockElement === canvas;

  document.addEventListener('mousedown', (e) => {
    if (!locked()) return;
    if (e.button === 0) {
      mouseLeft = true;
      attackPending = true;
      startSwing();
    } else if (e.button === 2) {
      // The use-vs-place decision resolves in update() against the SAME
      // fresh raycast placement uses — deciding here on last frame's target
      // could open a table the crosshair just left, or place against one it
      // just reached (one-frame asymmetry).
      useCheckPending = true;
      mouseRight = true;
      placeTimer = 0; // place immediately, then repeat while held
    }
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseLeft = false;
    else if (e.button === 2) mouseRight = false;
    // a sub-frame click still resolves its pending use next update
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    if (!locked()) {
      mouseLeft = false;
      mouseRight = false;
      useCheckPending = false;
      attackPending = false;
      // Losing the pointer mid-draw cancels the shot (never auto-fires).
      combat?.cancelDraw?.();
    }
  });

  // Hotbar selection: number keys 1-9 and the scroll wheel (scroll down =
  // next slot, like vanilla), only while playing. preventDefault keeps
  // Ctrl+digit (sprint key held) from switching browser tabs where possible.
  document.addEventListener('keydown', (e) => {
    if (!locked()) return;
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m) {
      e.preventDefault();
      inventory.select(Number(m[1]) - 1);
    }
    // F swaps the selected hotbar stack with the offhand (Phase 14).
    if (e.code === 'KeyF' && !e.repeat) {
      e.preventDefault();
      inventory.swapOffhand();
    }
  });
  let wheelAccum = 0;
  document.addEventListener(
    'wheel',
    (e) => {
      if (!locked() || e.deltaY === 0) return;
      // Non-passive so pointer-locked scrolling can never zoom (Ctrl+wheel,
      // with Ctrl doubling as the sprint key) or scroll the page.
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * INTERACTION.WHEEL_LINE_PIXELS
        : e.deltaMode === 2 ? Math.sign(e.deltaY) * INTERACTION.WHEEL_STEP_DELTA
        : e.deltaY;
      if (Math.sign(dy) !== Math.sign(wheelAccum)) wheelAccum = 0;
      // A discrete wheel notch steps exactly once per event; trackpad
      // micro-deltas accumulate until they add up to one step.
      if (Math.abs(dy) >= INTERACTION.WHEEL_STEP_DELTA) {
        inventory.selectNext(dy > 0 ? 1 : -1);
        wheelAccum = 0;
      } else {
        wheelAccum += dy;
        if (Math.abs(wheelAccum) >= INTERACTION.WHEEL_STEP_DELTA) {
          inventory.selectNext(wheelAccum > 0 ? 1 : -1);
          wheelAccum = 0;
        }
      }
    },
    { passive: false },
  );

  // --- breaking

  function resetBreak() {
    breakKey = null;
    breakPlan = null;
    breakProgress = 0;
  }

  function spawnDrops(def, x, y, z) {
    // chance entries roll independently; `fallback: true` entries drop only
    // when no chance entry succeeded (registry doc in world/blocks.js —
    // vanilla-style exclusive drops like gravel's flint-or-gravel).
    let chanceDropped = false;
    for (const drop of def.drops) {
      if (drop.fallback && chanceDropped) continue;
      if (drop.chance !== undefined) {
        if (Math.random() >= drop.chance) continue;
        chanceDropped = true;
      }
      const count = Array.isArray(drop.count)
        ? drop.count[0] + Math.floor(Math.random() * (drop.count[1] - drop.count[0] + 1))
        : drop.count;
      if (count > 0) {
        items.spawn(drop.item, count, {
          x: x + 0.5, y: y + ITEMS.DROP_SPAWN_Y_OFFSET, z: z + 0.5,
        });
      }
    }
  }

  function finishBreak() {
    const def = blockDef(target.id);
    world.setBlock(target.x, target.y, target.z, BLOCK.AIR);
    if (breakPlan.drops) spawnDrops(def, target.x, target.y, target.z);
    // Breaking a real block with a tool wears it (instant-break blocks like
    // torches don't, matching vanilla). damageSelected is a no-op for items
    // without durability; a tool that hits 0 vanishes from the slot.
    if (def.hardness > 0 && parseHeldTool(inventory.selectedName)) {
      inventory.damageSelected(1);
    }
    if (def.hardness > 0) stats?.exhaust(STATS.EXHAUST_BREAK_BLOCK);
    breakCooldown = INTERACTION.BREAK_COOLDOWN_SECONDS;
    resetBreak();
    // The targeted block no longer exists; drop the stale target so a place
    // in this same frame can't build against the removed face. The next
    // update re-raycasts.
    target = null;
  }

  function updateBreaking(dt) {
    breakCooldown = Math.max(0, breakCooldown - dt);
    if (!mouseLeft || !target || breakCooldown > 0) {
      resetBreak();
      return;
    }
    // The held item is part of the key: switching the hotbar selection
    // mid-break resets progress and recomputes the plan (vanilla behaviour)
    // — otherwise a stale plan could bypass the tier/drop gate and
    // finishBreak would charge durability to an item that never mined.
    const key = `${target.x},${target.y},${target.z},${target.id}:${inventory.selectedName ?? ''}`;
    if (key !== breakKey) {
      breakKey = key;
      breakProgress = 0;
      breakPlan = miningPlan(blockDef(target.id), inventory.selectedName);
    }
    if (!hand.swinging) startSwing(); // keep swinging while mining
    if (breakPlan.time <= 0) {
      finishBreak();
      return;
    }
    breakProgress += dt / breakPlan.time; // Infinity time -> progress stays 0
    if (breakProgress >= 1) finishBreak();
  }

  // --- placing (Phase 14: acts through the given hand — the offhand can
  // place its blocks when the main hand item has no right-click use)

  function tryPlace(hand) {
    if (!target) return;
    const [fx, fy, fz] = target.face;
    if (fx === 0 && fy === 0 && fz === 0) return; // ray started inside it
    const name = hand.name;
    if (!name) return;
    const id = blockIdByName(name);
    if (id === null) {
      // Plantable items (Phase 17: nether wart) place their crop block on
      // their soil's TOP face only, into air only — never displacing a
      // fluid, never sideways off a bed's edge.
      const plant = PLANTABLE[name];
      if (!plant) return; // the held item isn't placeable at all
      if (fy !== 1 || target.id !== plant.soil) return;
      // Same out-of-range guard as the block path below: setBlock above the
      // world ceiling is a silent no-op and must not eat the stack count.
      if (target.y + 1 >= OVERWORLD.MIN_Y + CHUNK.HEIGHT) return;
      if (world.getBlock(target.x, target.y + 1, target.z) !== BLOCK.AIR) return;
      world.setBlock(target.x, target.y + 1, target.z, plant.block);
      hand.consume(1);
      startSwing(hand.key);
      return;
    }
    // Torches need solid support (the clicked block IS the support).
    if (id === BLOCK.TORCH && !blockDef(target.id).solid) return;
    const x = target.x + fx;
    const y = target.y + fy;
    const z = target.z + fz;
    // Outside the world's vertical range setBlock is a silent no-op — don't
    // let it eat the stack count.
    if (y < OVERWORLD.MIN_Y || y >= OVERWORLD.MIN_Y + CHUNK.HEIGHT) return;
    if (!isReplaceable(world.getBlock(x, y, z))) return;
    // Torches can't stand in a fluid (vanilla) — the generic rule lets
    // blocks displace fluid cells, but a torch would burn underwater and
    // silently delete the source.
    if (id === BLOCK.TORCH && world.getBlock(x, y, z) !== BLOCK.AIR) return;
    if (placementBlockedByPlayer(x, y, z, player.body.position)) return;
    // Oriented blocks place their variant: furnaces face the player, torches
    // become the wall variant leaning out of the clicked face; null = the
    // clicked face can't hold this block (torch on a ceiling).
    const placed = placementVariant(id, { x, y, z }, player.body.position, target.face);
    if (placed === null) return;
    world.setBlock(x, y, z, placed);
    hand.consume(1); // the hand visuals refresh via the subscription
    startSwing(hand.key);
  }

  // --- buckets (Phase 11): an empty bucket scoops the first fluid cell on
  // the crosshair ray (fluids are looked through by the normal targeting, so
  // this raycast targets them too — a solid block in front still wins); a
  // full bucket places its fluid against the targeted face. One action per
  // press: the held item changes underneath, so hold-repeat must not run.

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
  // Empty-bucket scooping resolves EARLIER than the use-block check (see
  // update()) because a nearer fluid must win over a usable block behind it.
  function tryBucketPlace(hand) {
    const name = hand.name;
    if (name === 'water_bucket') return tryPlaceFluid(hand, BLOCK.WATER);
    if (name === 'lava_bucket') return tryPlaceFluid(hand, BLOCK.LAVA);
    return false;
  }

  // Glass bottle at a water source (Phase 18): the first WATER source on
  // the crosshair ray fills the bottle — the source itself stays (vanilla,
  // unlike the bucket). A single held bottle swaps in place; from a stack,
  // one is consumed and the water bottle joins the inventory (dropping at
  // the feet when nothing fits — never silently lost).
  function tryFillBottle(hand) {
    const hit = raycastVoxel(getBlock, rayOrigin, rayDir, PLAYER.REACH, fluidOrTargetable);
    if (!hit || hit.id !== BLOCK.WATER) return false;
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

  function updatePlacing(dt, hand) {
    if (!mouseRight) return;
    placeTimer -= dt;
    if (placeTimer > 0) return;
    placeTimer = INTERACTION.PLACE_REPEAT_SECONDS;
    tryPlace(hand);
  }

  // --- per-frame update

  function update(dt) {
    // Target under the crosshair (the camera sits at the eye, bob included)
    camera.getWorldPosition(rayOrigin);
    camera.getWorldDirection(rayDir);
    target = raycastVoxel(getBlock, rayOrigin, rayDir, PLAYER.REACH);

    if (target) {
      const [fx, fy, fz] = target.face;
      if (fx === 0 && fy === 0 && fz === 0) {
        outline.visible = false;
      } else {
        faceNormal.set(fx, fy, fz);
        outline.position.set(
          target.x + 0.5 + fx * (0.5 + INTERACTION.OUTLINE_OFFSET),
          target.y + 0.5 + fy * (0.5 + INTERACTION.OUTLINE_OFFSET),
          target.z + 0.5 + fz * (0.5 + INTERACTION.OUTLINE_OFFSET),
        );
        outline.quaternion.setFromUnitVectors(zAxis, faceNormal);
        outline.visible = true;
      }
    } else {
      outline.visible = false;
    }

    // Phase 12: a mob under the crosshair (nearer than the targeted block)
    // intercepts the left button — the pending click attacks it, and
    // holding never mines through it. Attack reach is shorter than block
    // reach (vanilla), and a wall in front always wins.
    const mobHit = combat
      ? combat.raycast(
        rayOrigin, rayDir,
        Math.min(target ? target.distance : Infinity, MOBS.ATTACK_REACH),
      )
      : null;
    if (attackPending) {
      attackPending = false;
      if (mobHit) combat.attack(mobHit, rayDir);
    }

    // Right-click resolution, one action per press, acting through the
    // ACTIVE hand (main unless its item has no right-click use — then the
    // offhand, Phase 14). A mob under the crosshair is offered the click
    // first (shears shear a sheep). Then, with an empty bucket, a NEARER
    // fluid on the ray wins (vanilla — the scoop must not be eaten by a
    // crafting table behind the pool; tryScoopFluid's ray stops at the
    // first solid, so a scoop implies the fluid was nearest). Then the
    // targeted usable block (crafting table...), unless sneaking. Then
    // full-bucket placement, then armour equip. Bucket actions never
    // hold-repeat — the held item changes underneath, so a repeat would
    // immediately undo itself. The acting hand resolves ONCE per frame
    // against this frame's mob raycast; the press resolution, bow draw,
    // eating and hold-to-place below all share it.
    const useHand = activeHand(mobHit);
    if (useCheckPending) {
      useCheckPending = false;
      if (mobHit && onUseMob && onUseMob(mobHit, useHand.name)) {
        if (useHand.name === 'shears') useHand.damage(1); // wear per shear
        mouseRight = false;
        startSwing(useHand.key);
      } else if (useHand.name === 'bucket' && tryScoopFluid(useHand)) {
        mouseRight = false;
        startSwing(useHand.key);
      } else if (useHand.name === 'glass_bottle' && tryFillBottle(useHand)) {
        // A nearer water source wins over a usable block behind it, the
        // bucket-scoop rule (Phase 18).
        mouseRight = false;
        startSwing(useHand.key);
      } else if (target && !player.body.sneaking && onUseBlock && onUseBlock(target)) {
        mouseRight = false;
        startSwing();
      } else if (
        useHand.name === 'flint_and_steel' && onIgnite && onIgnite(target)
      ) {
        // Lighting a portal frame (Phase 15). Only a successful ignition
        // wears the tool — striking bare rock does nothing (there is no
        // free-standing fire block in this game).
        useHand.damage(1);
        mouseRight = false;
        startSwing(useHand.key);
      } else if (tryBucketPlace(useHand)) {
        mouseRight = false;
        startSwing(useHand.key);
      } else if (useHand.name === 'ender_eye' && onThrowEye && onThrowEye()) {
        // Throwing an eye of ender (Phase 18): it flies toward the
        // stronghold. One eye per press; the entity itself may drop back
        // as an item or shatter (entities/ender_eye.js).
        useHand.consume(1);
        mouseRight = false;
        startSwing(useHand.key);
      } else if (useHand.equip()) {
        // Right-clicking held armour equips it directly (Phase 13),
        // swapping with the worn piece. One action per press.
        mouseRight = false;
        startSwing(useHand.key);
      }
    }

    // Bow (Phase 13): hold right click with the bow held to draw; releasing
    // fires along the crosshair, damage scaling with the charge. combat
    // owns the draw state (it needs an arrow to start); switching slots
    // restarts, losing pointer lock cancels (see pointerlockchange).
    // Phase 14: the bow can be drawn from the offhand when the main hand
    // item has no right-click use.
    if (combat?.updateDraw) {
      if (mouseRight && useHand.name === 'bow' && !eating) {
        combat.updateDraw(dt, useHand.key);
      } else if (combat.isDrawing) {
        // Only a real button release fires. Anything else that broke the
        // draw while the button is still down — switching the hotbar slot
        // away from the bow — cancels like vanilla, never auto-fires.
        if (!mouseRight) {
          combat.releaseDraw(rayOrigin, rayDir);
          startSwing(useHand.key);
        } else {
          combat.cancelDraw();
        }
      }
    }

    // Eating/drinking: hold right click with food (or a potion — Phase 18,
    // always drinkable, no hunger gate) in the acting hand. Releasing the
    // button or any change of the acting slot — including to another slot
    // holding the SAME food — restarts from zero (vanilla resets item use
    // on any slot change). A drained potion leaves its glass bottle via
    // the same container path stew uses for its bowl.
    const heldFood = stats ? consumableValue(useHand.name) : null;
    if (mouseRight && heldFood && stats.canEatFood(heldFood)) {
      if (
        !eating || eating.name !== useHand.name ||
        eating.slot !== useHand.slotKey
      ) {
        eating = {
          name: useHand.name, slot: useHand.slotKey, t: 0, source: useHand.key,
        };
      }
      eating.t += dt;
      if (eating.t >= STATS.EAT_SECONDS) {
        stats.eat(heldFood);
        useHand.consume(1);
        // Stew leaves its bowl behind (drops at the feet if nothing fits).
        if (heldFood.container && inventory.add(heldFood.container, 1) > 0) {
          const p = player.body.position;
          items.spawn(heldFood.container, 1, { x: p.x, y: p.y + 1, z: p.z });
        }
        eating = null;
        startSwing(useHand.key);
      }
    } else {
      eating = null;
    }

    // Using an item blocks attacking (vanilla): while eating or drawing a
    // bow, mining stops and its progress resets; placing pauses too. A mob
    // in the crosshair also holds mining (the swing is an attack, not a
    // dig).
    const usingItem = eating || !!combat?.isDrawing;
    if (usingItem || mobHit) resetBreak();
    else updateBreaking(dt);
    if (!usingItem) updatePlacing(dt, useHand);

    // Crack overlay over the block being broken. A destroy-stage texture
    // that hasn't finished loading yet would bind as an empty texture and
    // blacken the whole block for a frame — skip until its image is in.
    if (breakKey && breakProgress > 0 && target) {
      const stage = Math.min(
        RENDER.BREAK_STAGES - 1,
        Math.floor(breakProgress * RENDER.BREAK_STAGES),
      );
      crackMesh.material.map = crackTextures[stage];
      crackMesh.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
      crackMesh.visible = !!crackTextures[stage].image;
    } else {
      crackMesh.visible = false;
    }

    hand.update(dt, eating);
  }

  return {
    update,
    renderHand, // main.js calls this right after the world render
    get target() {
      return target;
    },
    get breakProgress() {
      return breakProgress;
    },
    // { name, slot, t, source } while a hold-to-eat is in progress, else
    // null (source: 'main' | 'off' — which hand eats, Phase 14)
    get eating() {
      return eating;
    },
    debugState() {
      return { mouseLeft, mouseRight, outline, crackMesh, ...hand.debug };
    },
    // Test scaffolding: drive the mouse without real events.
    debugSetMouse(left, right) {
      mouseLeft = !!left;
      if (right !== undefined) mouseRight = !!right;
    },
  };
}
