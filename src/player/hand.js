// player/hand.js — the first-person hands, split out of interaction.js
// (Phase 13, per the ARCHITECTURE cap note): the dedicated fixed-FOV render
// pass, the generated pixel-skin arm, the held block/tool/model meshes that
// follow the hotbar selection, and the swing / eat / bow-draw pose
// animation. interaction.js drives it (startSwing on clicks, update per
// frame with the eating state); main.js calls renderHand after the world
// render.
//
// Phase 14: TWO hands. The right hand is the Phase 13 hand unchanged; the
// left mirrors it across the screen centre and shows the OFFHAND item
// whenever one is held (nothing — not even a bare arm — otherwise, like
// vanilla). Each hand swings, eats and draws independently; offhand
// actions (interaction's active-hand fallback) animate the left.
//
// The hands render in their own pass with a fixed-FOV camera (never the
// world camera — its wide FOV skews anything in a screen corner, and the
// sprint FOV kick would stretch it). Depth is cleared before the pass, so
// the hands draw over point-blank walls like vanilla while still
// self-occluding correctly.

import * as THREE from 'three';
import { INTERACTION, LIGHTING } from '../config.js';
import {
  createBlockMesh, createExtrudedItemMesh, createModelMesh, itemVisualInfo,
} from '../entities/items.js';

// Items whose art was TUNED for the SPRITE_TILT pose. That pose yaws the
// slab ~180°, so what faces the camera is its BACK — and the back of a flat
// sprite is its mirror image. Long-handled tools read correctly either way
// (the diagonal is what sells them) and were screenshot-matched to vanilla
// in that pose, so they keep it; everything else was coming out left-right
// flipped in the hand (the Phase 22 golden-apple report) and gets its art
// mirrored back with a negative local X scale — same pose, right-way-round
// picture.
const TOOL_SHAPED = /_(pickaxe|axe|shovel|sword|hoe)$/;
const TOOL_SHAPED_NAMES = new Set([
  'bow', 'shears', 'flint_and_steel', 'shield', 'fishing_rod',
]);
function isToolShaped(name) {
  return TOOL_SHAPED.test(name) || TOOL_SHAPED_NAMES.has(name);
}

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

// The arm box geometry with per-face brightness (top/side/bottom like
// blocks) so it reads as a 3D limb whichever face dominates.
function createArmGeometry(H) {
  const geometry = new THREE.BoxGeometry(...H.ARM_SIZE);
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  const FB = LIGHTING.FACE_BRIGHTNESS;
  for (let i = 0; i < normals.count; i++) {
    const ny = normals.getY(i);
    const b = ny > 0.5 ? FB.top : ny < -0.5 ? FB.bottom : FB.side;
    colors[i * 3] = b;
    colors[i * 3 + 1] = b;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// `inventory` drives what the hands hold; `combat` (optional) supplies the
// bow-draw state for the pulled-back pose.
export function createHand({ inventory, combat }) {
  const H = INTERACTION.HAND;

  const handScene = new THREE.Scene();
  const handCamera = new THREE.PerspectiveCamera(
    H.FOV, window.innerWidth / window.innerHeight, H.NEAR, H.FAR,
  );
  window.addEventListener('resize', () => {
    handCamera.aspect = window.innerWidth / window.innerHeight;
    handCamera.updateProjectionMatrix();
  });
  const armTexture = createArmTexture();
  const armGeometry = createArmGeometry(H);

  // One hand rig: the group, the arm, the held mesh following a name
  // getter, and the swing/eat/draw pose state. `side` config picks the
  // resting position/tilts; `showBareArm` false hides the empty hand
  // entirely (the offhand).
  function makeRig({
    base, armTilt, blockTilt, blockOffset, spriteTilt, spriteOffset, showBareArm,
  }) {
    const hand = new THREE.Group();
    const arm = new THREE.Mesh(
      armGeometry,
      new THREE.MeshBasicMaterial({
        map: armTexture,
        vertexColors: true,
        toneMapped: false,
      }),
    );
    // The arm reaches forward from its screen corner
    arm.position.set(0, 0, -H.ARM_SIZE[2] * H.ARM_FORWARD);
    hand.add(arm);
    const rig = {
      hand,
      arm,
      heldMesh: null,
      shownItem: false, // item name currently shown (false = never set)
      base: new THREE.Vector3(...base),
      tilt: new THREE.Euler(...armTilt),
      // The arm's resting twist, INVERTED — placeHeld cancels it so a held
      // item's configured pose is read in VIEW space (see config HAND).
      invTilt: new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(...armTilt)).invert(),
      blockTilt,
      blockOffset,
      spriteTilt,
      spriteOffset,
      showBareArm,
      swingT: 1,   // 0..1, animation finished at >= 1
      eatBlend: 0, // eased 0..1 into the eating pose
      blockBlend: 0, // eased 0..1 into the raised-shield guard (Phase 21)
      drawBlend: 0, // eased 0..1 into the bow-drawing pose
    };
    hand.position.copy(rig.base);
    hand.rotation.copy(rig.tilt);
    handScene.add(hand);
    return rig;
  }

  const mainRig = makeRig({
    base: H.POSITION,
    armTilt: H.ARM_TILT,
    blockTilt: H.BLOCK_TILT,
    blockOffset: H.BLOCK_OFFSET,
    spriteTilt: H.SPRITE_TILT,
    spriteOffset: H.SPRITE_OFFSET,
    showBareArm: true,
  });
  const offRig = makeRig({
    base: H.OFFHAND_POSITION,
    armTilt: H.OFFHAND_ARM_TILT,
    blockTilt: H.OFFHAND_BLOCK_TILT,
    blockOffset: H.OFFHAND_BLOCK_OFFSET,
    spriteTilt: H.OFFHAND_SPRITE_TILT,
    spriteOffset: H.OFFHAND_SPRITE_OFFSET,
    showBareArm: false,
  });

  // Poses a held mesh from a VIEW-SPACE tilt and offset: both are
  // pre-multiplied by the inverse of the rig's resting arm twist, so the
  // configured numbers describe what the player sees rather than what the
  // arm's local frame happens to be. The SWING still rides on top — it
  // rotates the hand group, which carries the item with it.
  const poseEuler = new THREE.Euler();
  function placeHeld(rig, mesh, viewTilt, viewOffset) {
    mesh.quaternion.setFromEuler(poseEuler.set(...viewTilt)).premultiply(rig.invTilt);
    mesh.position.set(...viewOffset).applyQuaternion(rig.invTilt);
  }

  function renderHand(renderer) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(handScene, handCamera);
    renderer.autoClear = true;
  }

  // which: 'main' (default) | 'off'
  function startSwing(which) {
    (which === 'off' ? offRig : mainRig).swingT = 0;
  }

  // A rig shows its item: block items as a small angled mini-cube in its
  // screen corner (vanilla placement), other items as their sprite slab, an
  // empty slot as the bare arm (main) or nothing at all (offhand).
  function refreshRig(rig, name) {
    if (name === rig.shownItem) return;
    rig.shownItem = name;
    if (rig.heldMesh) {
      rig.hand.remove(rig.heldMesh);
      rig.heldMesh = null;
    }
    if (name) {
      // The shared item-visual meshes/materials are used as-is — the hand
      // pass clears depth itself, so no depth-free clones are needed and
      // the mini-cube self-occludes like a real block.
      const info = itemVisualInfo(name);
      if (info.model) {
        // Entity-model items (chest): the same centred model the drops use,
        // held like a block.
        rig.heldMesh = createModelMesh(info.model, H.BLOCK_SCALE);
        placeHeld(rig, rig.heldMesh, rig.blockTilt, rig.blockOffset);
        rig.arm.visible = false;
      } else if (info.blockId !== undefined) {
        rig.heldMesh = createBlockMesh(info.blockId, H.BLOCK_SCALE);
        placeHeld(rig, rig.heldMesh, rig.blockTilt, rig.blockOffset);
        rig.arm.visible = false;
      } else {
        // Tools and materials: the extruded slab model (flat sprite with
        // one-pixel depth), angled diagonally like a vanilla held tool —
        // never a cube. The slab may arrive async (the first selection of
        // each item builds it from its texture) — the main hand keeps the
        // arm until it does, so it is never empty.
        // `mesh` is declared before the call: on a CACHE HIT the factory
        // fires onReady synchronously, and a `const` here would still be in
        // its temporal dead zone — re-selecting a previously held tool
        // crashed once. The sync call safely no-ops (heldMesh can't equal
        // undefined) and the visibility line below covers that case.
        let mesh;
        mesh = createExtrudedItemMesh(info.sprite, H.SPRITE_SCALE, () => {
          if (rig.heldMesh === mesh) rig.arm.visible = false;
        });
        placeHeld(rig, mesh, rig.spriteTilt, rig.spriteOffset);
        // Un-mirror everything that isn't a tool (see TOOL_SHAPED above).
        if (!isToolShaped(name)) mesh.scale.x *= -1;
        rig.heldMesh = mesh;
        rig.arm.visible = rig.showBareArm && mesh.children.length === 0;
      }
      rig.hand.add(rig.heldMesh);
      rig.hand.visible = true;
    } else {
      rig.arm.visible = rig.showBareArm;
      rig.hand.visible = rig.showBareArm;
    }
  }
  const refreshMain = () => refreshRig(mainRig, inventory.selectedName);
  const refreshOff = () => refreshRig(offRig, inventory.offhandName);
  inventory.subscribe(refreshMain);
  inventory.offhand.subscribe(refreshOff);
  refreshMain();
  refreshOff();

  // One rig's pose for this frame. `eatingHere` is the interaction eating
  // state when THIS hand eats; `drawingHere` mirrors the combat draw.
  function updateRig(rig, dt, eatingHere, drawingHere, blockingHere) {
    if (rig.swingT < 1) rig.swingT = Math.min(1, rig.swingT + dt / H.SWING_SECONDS);
    const s = Math.sin(Math.PI * Math.min(rig.swingT, 1));
    // Eating pose: the hand eases toward the mouth and nibbles (a quick
    // up-down bob) until the food is finished. Drawing a bow eases toward
    // its own raised pose the same way, pulling back with the charge.
    const blendTarget = eatingHere ? 1 : 0;
    rig.eatBlend += (blendTarget - rig.eatBlend) * (1 - Math.exp(-H.EAT_ENGAGE_RATE * dt));
    const drawTarget = drawingHere ? 1 : 0;
    rig.drawBlend += (drawTarget - rig.drawBlend) * (1 - Math.exp(-H.DRAW_ENGAGE_RATE * dt));
    const drawPull = rig.drawBlend * (combat ? 0.5 + 0.5 * combat.drawCharge : 0);
    // Raised shield (Phase 21): the hand swings across the view and turns
    // its face toward the camera — the vanilla guard.
    const blockTarget = blockingHere ? 1 : 0;
    rig.blockBlend += (blockTarget - rig.blockBlend) *
      (1 - Math.exp(-H.SHIELD_ENGAGE_RATE * dt));
    const nibble = eatingHere
      ? Math.abs(Math.sin(eatingHere.t * Math.PI * 2 * H.EAT_NIBBLE_HZ)) * H.EAT_NIBBLE_AMP
      : 0;
    // The left hand mirrors across x: its sideways swing dip and eat/draw
    // x-offsets flip sign.
    const mirror = rig === offRig ? -1 : 1;
    rig.hand.position.set(
      rig.base.x - mirror * H.SWING_SIDE * H.SWING_DIP * s +
        mirror * H.EAT_OFFSET[0] * rig.eatBlend + mirror * H.DRAW_OFFSET[0] * drawPull +
        mirror * H.SHIELD_OFFSET[0] * rig.blockBlend,
      rig.base.y - H.SWING_DIP * s + (H.EAT_OFFSET[1] + nibble) * rig.eatBlend +
        H.DRAW_OFFSET[1] * drawPull + H.SHIELD_OFFSET[1] * rig.blockBlend,
      rig.base.z - H.SWING_FORWARD * H.SWING_DIP * s + H.EAT_OFFSET[2] * rig.eatBlend +
        H.DRAW_OFFSET[2] * drawPull + H.SHIELD_OFFSET[2] * rig.blockBlend,
    );
    rig.hand.rotation.set(
      rig.tilt.x - H.SWING_ROTATION * s + H.EAT_TIP * rig.eatBlend + H.DRAW_TIP * drawPull,
      rig.tilt.y + mirror * H.SWING_YAW * H.SWING_ROTATION * s +
        mirror * H.SHIELD_YAW * rig.blockBlend,
      rig.tilt.z,
    );
  }

  // Per frame (interaction.js): `eating` is its { name, t, source } state
  // or null. The draw pose lands on whichever hand combat says is drawing.
  function update(dt, eating, blocking = false) {
    const drawSource = combat?.isDrawing ? (combat.drawSource ?? 'main') : null;
    const blockMain = blocking && inventory.selectedName === 'shield';
    const blockOff = blocking && !blockMain && inventory.offhandName === 'shield';
    updateRig(mainRig, dt, eating && eating.source !== 'off' ? eating : null,
      drawSource === 'main', blockMain);
    updateRig(offRig, dt, eating && eating.source === 'off' ? eating : null,
      drawSource === 'off', blockOff);
  }

  return {
    renderHand,
    startSwing,
    update,
    // still swinging? (mining keeps re-triggering only once finished)
    get swinging() {
      return mainRig.swingT < 1;
    },
    // test/debug scaffolding (interaction.debugState passes these through)
    get debug() {
      return {
        hand: mainRig.hand,
        arm: mainRig.arm,
        swingT: mainRig.swingT,
        shownItem: mainRig.shownItem,
        offHand: offRig.hand,
        offShownItem: offRig.shownItem,
      };
    },
  };
}
