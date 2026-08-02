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
  OVERWORLD, CHUNK, LIGHTING,
} from '../config.js';
import { BLOCK, blockDef, blockIdByName, placementVariant } from '../world/blocks.js';
import {
  createBlockMesh, createExtrudedItemMesh, createModelMesh, itemVisualInfo,
} from '../entities/items.js';

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
// Overlay art: the real destroy-stage textures, and the generated arm skin
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// Pixel-art skin for the first-person arm: classic skin tones with per-pixel
// variation (deterministic, so the arm looks the same every run).
function createArmTexture() {
  const size = 16;
  const rand = mulberry32(0x5709);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const v = (rand() - 0.5) * 26;
      img.data[i] = 197 + v;
      img.data[i + 1] = 148 + v;
      img.data[i + 2] = 112 + v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

// ---------------------------------------------------------------------------
// The interaction controller
// ---------------------------------------------------------------------------

// Wires targeting, breaking, placing and the first-person hand into the game.
// `player` is the Phase 5 controller (body + mode), `items` the item manager,
// `inventory` the Phase 7 inventory (selection, stacks, durability).
// `onUseBlock(target)` (optional, wired by main.js) handles right-clicking a
// usable block — a crafting table opening its screen — returning true when it
// consumed the click; sneaking bypasses it so blocks can still be placed
// against usable blocks, like vanilla.
export function createInteraction({
  world, camera, scene, canvas, player, items, inventory, onUseBlock,
}) {
  const H = INTERACTION.HAND;

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
  let breakKey = null;      // "x,y,z,id" of the block being broken
  let breakPlan = null;     // { time, drops } for that block
  let breakProgress = 0;    // 0..1
  let breakCooldown = 0;    // pause between consecutive breaks
  let placeTimer = 0;       // hold-to-place repeat

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
  const crackMesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      1 + INTERACTION.CRACK_INFLATE,
      1 + INTERACTION.CRACK_INFLATE,
      1 + INTERACTION.CRACK_INFLATE,
    ),
    new THREE.MeshBasicMaterial({
      map: crackTextures[0],
      transparent: true,
      depthWrite: false,
      toneMapped: false,
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

  // --- first-person hand, drawn in its own pass over the finished frame
  // (main.js calls renderHand after the world render). Its camera has a
  // fixed, modest FOV: the world camera's wide FOV would perspective-skew
  // anything sitting in a screen corner, and the sprint FOV kick would
  // stretch it — the held block must read as a clean, undistorted cube.
  // Depth is cleared before the pass, so the hand draws over point-blank
  // walls like vanilla while still self-occluding correctly (its own back
  // faces hidden — depth-free materials scrambled the cube's faces before).
  const handScene = new THREE.Scene();
  const handCamera = new THREE.PerspectiveCamera(
    H.FOV, window.innerWidth / window.innerHeight, H.NEAR, H.FAR,
  );
  window.addEventListener('resize', () => {
    handCamera.aspect = window.innerWidth / window.innerHeight;
    handCamera.updateProjectionMatrix();
  });
  const hand = new THREE.Group();
  // Per-face brightness (top/side/bottom like blocks) so the arm box reads
  // as a 3D limb instead of a flat plane whichever face dominates.
  const armGeometry = new THREE.BoxGeometry(...H.ARM_SIZE);
  {
    const normals = armGeometry.getAttribute('normal');
    const colors = new Float32Array(normals.count * 3);
    const FB = LIGHTING.FACE_BRIGHTNESS;
    for (let i = 0; i < normals.count; i++) {
      const ny = normals.getY(i);
      const b = ny > 0.5 ? FB.top : ny < -0.5 ? FB.bottom : FB.side;
      colors[i * 3] = b;
      colors[i * 3 + 1] = b;
      colors[i * 3 + 2] = b;
    }
    armGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  const arm = new THREE.Mesh(
    armGeometry,
    new THREE.MeshBasicMaterial({
      map: createArmTexture(),
      vertexColors: true,
      toneMapped: false,
    }),
  );
  // The arm reaches forward from the bottom-right screen corner
  arm.position.set(0, 0, -H.ARM_SIZE[2] * H.ARM_FORWARD);
  hand.add(arm);
  let heldMesh = null; // mini-block or sprite of the current selection
  let shownItem = false; // item name the hand currently shows (false = never set)
  const handBase = new THREE.Vector3(...H.POSITION);
  const handTilt = new THREE.Euler(...H.ARM_TILT);
  hand.position.copy(handBase);
  hand.rotation.copy(handTilt);
  handScene.add(hand);
  let swingT = 1; // 0..1, animation finished at >= 1

  function renderHand(renderer) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(handScene, handCamera);
    renderer.autoClear = true;
  }

  function startSwing() {
    swingT = 0;
  }

  // The hand shows the selected hotbar item: block items as a small angled
  // mini-cube in the lower-right corner (vanilla placement), other items as
  // their sprite, an empty slot as the bare arm.
  function refreshHeldMesh() {
    const name = inventory.selectedName;
    if (name === shownItem) return;
    shownItem = name;
    if (heldMesh) {
      hand.remove(heldMesh);
      heldMesh = null;
    }
    if (name) {
      // The shared item-visual meshes/materials are used as-is — the hand
      // pass clears depth itself, so no depth-free clones are needed and
      // the mini-cube self-occludes like a real block.
      const info = itemVisualInfo(name);
      if (info.model) {
        // Entity-model items (chest): the same centred model the drops use,
        // held like a block.
        heldMesh = createModelMesh(info.model, H.BLOCK_SCALE);
        heldMesh.position.set(...H.BLOCK_OFFSET);
        heldMesh.rotation.set(...H.BLOCK_TILT);
        arm.visible = false;
      } else if (info.blockId !== undefined) {
        heldMesh = createBlockMesh(info.blockId, H.BLOCK_SCALE);
        heldMesh.position.set(...H.BLOCK_OFFSET);
        heldMesh.rotation.set(...H.BLOCK_TILT);
        arm.visible = false;
      } else {
        // Tools and materials: the extruded slab model (flat sprite with
        // one-pixel depth), angled diagonally across the lower-right like a
        // vanilla held tool — never a cube. The slab may arrive async (the
        // first selection of each item builds it from its texture) — keep
        // the arm until it does, so the hand is never empty.
        // `mesh` is declared before the call: on a CACHE HIT the factory
        // fires onReady synchronously, and a `const` here would still be in
        // its temporal dead zone — re-selecting a previously held tool
        // crashed. The sync call safely no-ops (heldMesh can't equal
        // undefined) and the visibility line below covers that case.
        let mesh;
        mesh = createExtrudedItemMesh(info.sprite, H.SPRITE_SCALE, () => {
          if (heldMesh === mesh) arm.visible = false;
        });
        mesh.position.set(...H.SPRITE_OFFSET);
        mesh.rotation.set(...H.SPRITE_TILT);
        heldMesh = mesh;
        arm.visible = mesh.children.length === 0;
      }
      hand.add(heldMesh);
    } else {
      arm.visible = true;
    }
  }
  inventory.subscribe(refreshHeldMesh);
  refreshHeldMesh();

  // --- input
  const locked = () => document.pointerLockElement === canvas;

  document.addEventListener('mousedown', (e) => {
    if (!locked()) return;
    if (e.button === 0) {
      mouseLeft = true;
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
    if (swingT >= 1) startSwing(); // keep swinging while mining
    if (breakPlan.time <= 0) {
      finishBreak();
      return;
    }
    breakProgress += dt / breakPlan.time; // Infinity time -> progress stays 0
    if (breakProgress >= 1) finishBreak();
  }

  // --- placing

  function tryPlace() {
    if (!target) return;
    const [fx, fy, fz] = target.face;
    if (fx === 0 && fy === 0 && fz === 0) return; // ray started inside it
    const name = inventory.selectedName;
    if (!name) return;
    const id = blockIdByName(name);
    if (id === null) return; // the selection isn't a placeable block
    const x = target.x + fx;
    const y = target.y + fy;
    const z = target.z + fz;
    // Outside the world's vertical range setBlock is a silent no-op — don't
    // let it eat the stack count.
    if (y < OVERWORLD.MIN_Y || y >= OVERWORLD.MIN_Y + CHUNK.HEIGHT) return;
    if (!isReplaceable(world.getBlock(x, y, z))) return;
    if (placementBlockedByPlayer(x, y, z, player.body.position)) return;
    // Oriented blocks (furnace) place the variant facing the player.
    world.setBlock(x, y, z, placementVariant(id, { x, y, z }, player.body.position));
    inventory.consumeSelected(1); // the hand refreshes via the subscription
    startSwing();
  }

  function updatePlacing(dt) {
    if (!mouseRight) return;
    placeTimer -= dt;
    if (placeTimer > 0) return;
    placeTimer = INTERACTION.PLACE_REPEAT_SECONDS;
    tryPlace();
  }

  // --- per-frame update

  function updateHand(dt) {
    if (swingT < 1) swingT = Math.min(1, swingT + dt / H.SWING_SECONDS);
    const s = Math.sin(Math.PI * Math.min(swingT, 1));
    hand.position.set(
      handBase.x - H.SWING_SIDE * H.SWING_DIP * s,
      handBase.y - H.SWING_DIP * s,
      handBase.z - H.SWING_FORWARD * H.SWING_DIP * s,
    );
    hand.rotation.set(
      handTilt.x - H.SWING_ROTATION * s,
      handTilt.y + H.SWING_YAW * H.SWING_ROTATION * s,
      handTilt.z,
    );
  }

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

    // Right-click use: the targeted block (crafting table...) takes
    // precedence over placing, unless sneaking (vanilla). A handled use
    // consumes the press entirely — no place, no hold-to-place repeat.
    if (useCheckPending) {
      useCheckPending = false;
      if (target && !player.body.sneaking && onUseBlock && onUseBlock(target)) {
        mouseRight = false;
        startSwing();
      }
    }

    updateBreaking(dt);
    updatePlacing(dt);

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

    updateHand(dt);
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
    debugState() {
      return { mouseLeft, mouseRight, shownItem, swingT, hand, arm, outline, crackMesh };
    },
    // Test scaffolding: drive the mouse without real events.
    debugSetMouse(left, right) {
      mouseLeft = !!left;
      if (right !== undefined) mouseRight = !!right;
    },
  };
}
