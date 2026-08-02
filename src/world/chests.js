// world/chests.js — Phase 10: chest block entities. A chest block renders as
// the real entity-textured box model (assets/entity/chest_normal.png — base
// 14x10x14, lid 14x5x14 on a back hinge, 2x4x1 latch), faces the player who
// placed it, holds a persistent 27-slot SlotContainer, and animates its lid
// while its screen is open. The chunk mesher emits nothing for chest cells
// (registry tiles: null); this module owns one small mesh per chest.
//
// Texture layout: the classic Minecraft box unwrap (lid at texOffs 0,0, base
// at 0,19, latch at 0,0), but the modern (1.15+) sheet stores every face
// rotated 180° — the UV builder below un-rotates. The front faces (with the
// latch recess) sit in the fourth side slot of each strip.
//
// Like dropped items and the hand, chest meshes are unlit (per-face
// brightness only) — a `getLight` tint can join all three when a later
// phase adds it. Mesh visibility follows the owning chunk's mesh, so an
// unloaded area doesn't leave floating chests in the fog.

import * as THREE from 'three';
import { CHUNK, LIGHTING } from '../config.js';
import { BLOCK, facingToward } from './blocks.js';
import { SlotContainer } from '../player/inventory.js';

export const CHEST_SLOTS = 27;
export const CHEST_TEXTURE_PATH = 'assets/entity/chest_normal.png';

// --- model art (deliberately inline, like the other generated art) --------
const TEX = 64;                      // sheet is 64x64
const PX = 1 / 16;                   // one model pixel in block units
const LID_OPEN_ANGLE = Math.PI / 2 * 0.92; // lid swing when open
const LID_EASE_RATE = 10;            // 1/s lid animation easing

const FACING_YAW = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };

// ---------------------------------------------------------------------------
// Box geometry with the Minecraft entity unwrap
// ---------------------------------------------------------------------------

// Appends one axis-aligned box to the position/uv/color/index arrays.
// x0..z1 are model coordinates (block units); (u, v) is the box's texOffs in
// sheet pixels; (w, h, d) its pixel dimensions. Every face samples its
// unwrap region rotated 180° (the modern sheet convention). Side slots:
// front (+z) takes the fourth slot, back (-z) the second.
function appendBox(arrays, x0, y0, z0, x1, y1, z1, u, v, w, h, d) {
  const FB = LIGHTING.FACE_BRIGHTNESS;
  // Region rectangles in sheet pixels: [x, y, width, height]
  const regions = {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    west: [u, v + d, d, h],          // -x
    back: [u + d, v + d, w, h],      // -z
    east: [u + d + w, v + d, d, h],  // +x
    front: [u + d + w + d, v + d, w, h], // +z (the notched slot)
  };
  // corners: 4 vertices CCW from outside, with face-local (s, t) in 0..1
  // (s right, t up on the face). UVs map (s, t) into the region rotated
  // 180°: sheet u = rx + (1 - s) * rw, sheet v-row = ry + t * rh (rows count
  // down, so t up == earlier rows already; the 180° turn flips both).
  const faces = [
    { r: 'east', b: FB.side, corners: [
      [x1, y0, z1, 0, 0], [x1, y0, z0, 1, 0], [x1, y1, z0, 1, 1], [x1, y1, z1, 0, 1]] },
    { r: 'west', b: FB.side, corners: [
      [x0, y0, z0, 0, 0], [x0, y0, z1, 1, 0], [x0, y1, z1, 1, 1], [x0, y1, z0, 0, 1]] },
    { r: 'top', b: FB.top, corners: [
      [x0, y1, z1, 0, 0], [x1, y1, z1, 1, 0], [x1, y1, z0, 1, 1], [x0, y1, z0, 0, 1]] },
    { r: 'bottom', b: FB.bottom, corners: [
      [x0, y0, z0, 0, 0], [x1, y0, z0, 1, 0], [x1, y0, z1, 1, 1], [x0, y0, z1, 0, 1]] },
    { r: 'front', b: FB.side, corners: [
      [x0, y0, z1, 0, 0], [x1, y0, z1, 1, 0], [x1, y1, z1, 1, 1], [x0, y1, z1, 0, 1]] },
    { r: 'back', b: FB.side, corners: [
      [x1, y0, z0, 0, 0], [x0, y0, z0, 1, 0], [x0, y1, z0, 1, 1], [x1, y1, z0, 0, 1]] },
  ];
  const { pos, uv, col, idx } = arrays;
  for (const face of faces) {
    const [rx, ry, rw, rh] = regions[face.r];
    const base = pos.length / 3;
    for (const [x, y, z, s, t] of face.corners) {
      pos.push(x, y, z);
      // 180° rotation within the region: flip both axes. Sheet v counts
      // rows down; three.js v counts up from the bottom of the image.
      const su = (rx + (1 - s) * rw) / TEX;
      const sv = 1 - (ry + t * rh) / TEX;
      uv.push(su, sv);
      col.push(face.b, face.b, face.b);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function buildGeometry(build) {
  const arrays = { pos: [], uv: [], col: [], idx: [] };
  build(arrays);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(arrays.pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(arrays.uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(arrays.col, 3));
  geometry.setIndex(arrays.idx);
  return geometry;
}

let baseGeometry = null;  // shared by every chest
let lidGeometry = null;   // lid + latch, coordinates relative to the hinge
let chestMaterial = null;

function getChestMaterial() {
  if (!chestMaterial) {
    const texture = new THREE.TextureLoader().load(CHEST_TEXTURE_PATH);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    chestMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      vertexColors: true,
      toneMapped: false, // matches terrain/items — exact texel colours
    });
  }
  return chestMaterial;
}

function getGeometries() {
  if (!baseGeometry) {
    // Base: 14x10x14 px from (1,0,1), texOffs (0,19). Model space is centred
    // on the block: x/z in -0.5..0.5, y 0..1. The sheet's base-bottom region
    // has a transparent middle, so the (never visible) bottom face reuses
    // the base-top region instead.
    baseGeometry = buildGeometry((a) => {
      appendBox(a, -7 * PX, 0, -7 * PX, 7 * PX, 10 * PX, 7 * PX, 0, 19, 14, 10, 14);
      // Overwrite the bottom face's UVs with the top region (last-built box
      // face order: east, west, top, bottom, front, back — bottom is face 3,
      // vertices 12..15).
      const [rx, ry, rw, rh] = [14, 19, 14, 14];
      for (let k = 0; k < 4; k++) {
        const s = [0, 1, 1, 0][k];
        const t = [0, 0, 1, 1][k];
        a.uv[(12 + k) * 2] = (rx + (1 - s) * rw) / TEX;
        a.uv[(12 + k) * 2 + 1] = 1 - (ry + t * rh) / TEX;
      }
    });
    // Lid (14x5x14 px, texOffs 0,0) + latch (2x4x1 px, texOffs 0,0), built
    // relative to the hinge: the lid's bottom-back edge at y=9px, z=1px.
    // +z runs toward the chest front.
    lidGeometry = buildGeometry((a) => {
      appendBox(a, -7 * PX, 0, 0, 7 * PX, 5 * PX, 14 * PX, 0, 0, 14, 5, 14);
      // Latch depth stops 0.1px short of the cell boundary: a solid block
      // placed against the chest front draws its face on that exact plane
      // (the chest is `transparent`), and a full-depth latch would z-fight
      // with it.
      appendBox(a, -1 * PX, -2 * PX, 14 * PX, 1 * PX, 2 * PX, 14.9 * PX, 0, 0, 2, 4, 1);
    });
  }
  return { baseGeometry, lidGeometry };
}

// A complete chest model group: base + hinged lid, closed. Local space is
// one block centred on x/z (so scaling by `size` yields a `size`-tall box,
// like createBlockMesh). Returns { group, lid } — rotate lid.rotation.x
// negative to open. Used for placed chests, dropped chest items and the
// held chest in the hand.
export function createChestMesh(size = 1) {
  const { baseGeometry, lidGeometry } = getGeometries();
  const material = getChestMaterial();
  const group = new THREE.Group();
  const base = new THREE.Mesh(baseGeometry, material);
  const lid = new THREE.Mesh(lidGeometry, material);
  lid.position.set(0, 9 * PX, -7 * PX); // hinge point
  group.add(base);
  group.add(lid);
  group.scale.setScalar(size);
  group.userData.lid = lid;
  return group;
}

// ---------------------------------------------------------------------------
// Chest block-entity manager
// ---------------------------------------------------------------------------

// `player` supplies the placement position for facing; `items` receives the
// contents when a chest is broken.
export function createChests({ world, scene, items, player }) {
  const chests = new Map(); // "x,y,z" -> state
  const keyOf = (x, y, z) => `${x},${y},${z}`;

  function createState(x, y, z, facing) {
    const group = createChestMesh(1);
    group.position.set(x + 0.5, y, z + 0.5);
    group.rotation.y = FACING_YAW[facing] ?? 0;
    scene.add(group);
    const state = {
      x, y, z,
      facing,
      container: new SlotContainer(CHEST_SLOTS),
      group,
      lid: group.userData.lid,
      open: false,   // the screen sets this; update() eases the lid
      angle: 0,
    };
    chests.set(keyOf(x, y, z), state);
    return state;
  }

  // The chest state at a block position, created on demand (a chest block
  // with no state yet — placed before this system existed, or spawned by a
  // future structure phase — gets a default south facing).
  function chestAt(x, y, z) {
    if (world.getBlock(x, y, z) !== BLOCK.CHEST) return null;
    return chests.get(keyOf(x, y, z)) ?? createState(x, y, z, 'S');
  }

  function removeState(key, state, dropContents) {
    if (dropContents) {
      for (const s of state.container.drainAll()) {
        items.spawn(
          s.name, s.count,
          { x: state.x + 0.5, y: state.y + 0.25, z: state.z + 0.5 },
          undefined, s.durability ?? undefined,
        );
      }
    }
    state.group.removeFromParent();
    chests.delete(key);
  }

  // Block listener: placing a chest creates its state facing the player;
  // anything else replacing a chest cell drops the contents.
  function onBlockChanged(x, y, z, id) {
    const key = keyOf(x, y, z);
    const state = chests.get(key);
    if (id === BLOCK.CHEST) {
      if (!state) {
        createState(x, y, z, facingToward({ x, y, z }, player.position));
      }
      return;
    }
    if (state) removeState(key, state, true);
  }

  // Per frame: lid animation for open chests, and visibility following the
  // owning chunk's mesh (few chests, all cheap checks).
  function update(dt) {
    for (const state of chests.values()) {
      const chunk = world.getChunkIfLoaded(
        Math.floor(state.x / CHUNK.SIZE),
        Math.floor(state.z / CHUNK.SIZE),
      );
      state.group.visible = !!(chunk && chunk.mesh);
      const target = state.open ? LID_OPEN_ANGLE : 0;
      if (state.angle !== target && dt > 0) {
        state.angle += (target - state.angle) * (1 - Math.exp(-LID_EASE_RATE * dt));
        if (Math.abs(state.angle - target) < 0.005) state.angle = target;
        state.lid.rotation.x = -state.angle;
      }
    }
  }

  return {
    update,
    onBlockChanged,
    chestAt,
    chests, // read-only by convention (debug/tests)
  };
}
