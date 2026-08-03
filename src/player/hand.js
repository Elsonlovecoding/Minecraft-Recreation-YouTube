// player/hand.js — the first-person hand, split out of interaction.js
// (Phase 13, per the ARCHITECTURE cap note): the dedicated fixed-FOV render
// pass, the generated pixel-skin arm, the held block/tool/model meshes that
// follow the hotbar selection, and the swing / eat / bow-draw pose
// animation. interaction.js drives it (startSwing on clicks, update per
// frame with the eating state); main.js calls renderHand after the world
// render.
//
// The hand renders in its own pass with a fixed-FOV camera (never the world
// camera — its wide FOV skews anything in a screen corner, and the sprint
// FOV kick would stretch it). Depth is cleared before the pass, so the hand
// draws over point-blank walls like vanilla while still self-occluding
// correctly.

import * as THREE from 'three';
import { INTERACTION, LIGHTING } from '../config.js';
import {
  createBlockMesh, createExtrudedItemMesh, createModelMesh, itemVisualInfo,
} from '../entities/items.js';

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

// `inventory` drives what the hand holds; `combat` (optional) supplies the
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
  let swingT = 1;   // 0..1, animation finished at >= 1
  let eatBlend = 0; // eased 0..1 into the eating hand pose
  let drawBlend = 0; // eased 0..1 into the bow-drawing hand pose

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

  // Per frame (interaction.js): `eating` is its { name, t } state or null.
  function update(dt, eating) {
    if (swingT < 1) swingT = Math.min(1, swingT + dt / H.SWING_SECONDS);
    const s = Math.sin(Math.PI * Math.min(swingT, 1));
    // Eating pose: the hand eases toward the mouth and nibbles (a quick
    // up-down bob) until the food is finished. Drawing a bow eases toward
    // its own raised pose the same way, pulling back with the charge.
    const blendTarget = eating ? 1 : 0;
    eatBlend += (blendTarget - eatBlend) * (1 - Math.exp(-H.EAT_ENGAGE_RATE * dt));
    const drawTarget = combat?.isDrawing ? 1 : 0;
    drawBlend += (drawTarget - drawBlend) * (1 - Math.exp(-H.DRAW_ENGAGE_RATE * dt));
    const drawPull = drawBlend * (combat ? 0.5 + 0.5 * combat.drawCharge : 0);
    const nibble = eating
      ? Math.abs(Math.sin(eating.t * Math.PI * 2 * H.EAT_NIBBLE_HZ)) * H.EAT_NIBBLE_AMP
      : 0;
    hand.position.set(
      handBase.x - H.SWING_SIDE * H.SWING_DIP * s + H.EAT_OFFSET[0] * eatBlend +
        H.DRAW_OFFSET[0] * drawPull,
      handBase.y - H.SWING_DIP * s + (H.EAT_OFFSET[1] + nibble) * eatBlend +
        H.DRAW_OFFSET[1] * drawPull,
      handBase.z - H.SWING_FORWARD * H.SWING_DIP * s + H.EAT_OFFSET[2] * eatBlend +
        H.DRAW_OFFSET[2] * drawPull,
    );
    hand.rotation.set(
      handTilt.x - H.SWING_ROTATION * s + H.EAT_TIP * eatBlend + H.DRAW_TIP * drawPull,
      handTilt.y + H.SWING_YAW * H.SWING_ROTATION * s,
      handTilt.z,
    );
  }

  return {
    renderHand,
    startSwing,
    update,
    // still swinging? (mining keeps re-triggering only once finished)
    get swinging() {
      return swingT < 1;
    },
    // test/debug scaffolding (interaction.debugState passes these through)
    get debug() {
      return { hand, arm, swingT, shownItem };
    },
  };
}
