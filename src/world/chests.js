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
import { CHUNK, LIGHTING, OVERWORLD, CHESTS } from '../config.js';
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
// front (+z) takes the fourth slot, back (-z) the second. The top/bottom
// pair is also SWAPPED relative to the classic unwrap (Phase 16 fix —
// verified against the shipped sheet's pixels: the classic top slot at
// (u+d, v) holds the dark flat UNDERSIDE art, the classic bottom slot at
// (u+d+w, v) the wood-grain top art; the lid rendered its dark underside
// on top before this).
function appendBox(arrays, x0, y0, z0, x1, y1, z1, u, v, w, h, d) {
  const FB = LIGHTING.FACE_BRIGHTNESS;
  // Region rectangles in sheet pixels: [x, y, width, height]
  const regions = {
    top: [u + d + w, v, w, d],
    bottom: [u + d, v, w, d],
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
    // on the block: x/z in -0.5..0.5, y 0..1. With the swapped top/bottom
    // slots the top face shows the dark hollow interior (what an open chest
    // reveals, vanilla) and the never-visible bottom the wood-grain plate —
    // the Phase 10 bottom-face UV overwrite is obsolete.
    baseGeometry = buildGeometry((a) => {
      appendBox(a, -7 * PX, 0, -7 * PX, 7 * PX, 10 * PX, 7 * PX, 0, 19, 14, 10, 14);
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
// contents when a chest is broken. `lootFor(x, y, z)` (optional, Phase 19)
// supplies deterministic contents for chests a STRUCTURE generated into
// chunk data — the stronghold's storage rooms; null = not a generated
// loot chest. Generated chests are DISCOVERED by scanning newly meshed
// chunks (the world/spawners.js pattern, budgeted per frame with its own
// `_chestScanned` chunk flag) because generation fires no block events.
export function createChests({ world, scene, items, player, lootFor }) {
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

  // A generated chest discovered in chunk data (scan below, or a player
  // reaching one before its chunk's scan ran): default south facing, loot
  // stocked once at discovery (deterministic per position).
  function discoverState(x, y, z) {
    const state = createState(x, y, z, 'S');
    for (const s of lootFor?.(x, y, z) ?? []) {
      state.container.add(s.name, s.count);
    }
    return state;
  }

  // The chest state at a block position, created on demand (a chest block
  // with no state yet — placed before this system existed, or generated by
  // a structure and not yet scanned — goes through discovery).
  function chestAt(x, y, z) {
    if (world.getBlock(x, y, z) !== BLOCK.CHEST) return null;
    return chests.get(keyOf(x, y, z)) ?? discoverState(x, y, z);
  }

  // Discover generated chests: scan each newly meshed chunk's block data
  // once (a flat indexOf sweep — the spawner pattern). Rescans after an
  // unload find existing states by key and leave them alone.
  function scanChunk(chunk) {
    const blocks = chunk.blocks;
    let i = blocks.indexOf(BLOCK.CHEST);
    while (i !== -1) {
      const y = OVERWORLD.MIN_Y + (i % CHUNK.HEIGHT);
      const col = (i - (y - OVERWORLD.MIN_Y)) / CHUNK.HEIGHT;
      const lx = col % CHUNK.SIZE;
      const lz = (col - lx) / CHUNK.SIZE;
      const wx = chunk.cx * CHUNK.SIZE + lx;
      const wz = chunk.cz * CHUNK.SIZE + lz;
      if (!chests.has(keyOf(wx, y, wz))) discoverState(wx, y, wz);
      i = blocks.indexOf(BLOCK.CHEST, i + 1);
    }
    chunk._chestScanned = true;
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
    // Discover generated chests in newly meshed chunks (budgeted).
    let scanned = 0;
    for (const chunk of world.chunks.values()) {
      if (!chunk.mesh || chunk._chestScanned) continue;
      scanChunk(chunk);
      if (++scanned >= CHESTS.SCAN_CHUNKS_PER_FRAME) break;
    }
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

  // Dimension switch (Phase 15): chest states (contents + models) are keyed
  // by position and belong to their dimension. Stored chests hide their
  // models and freeze; the exported Map keeps its identity. Restored
  // visibility follows the owning chunk's mesh again via update(). State
  // shape: array of [key, state].
  function swapDimensionState(stored = []) {
    const prev = [...chests.entries()];
    for (const [, state] of prev) state.group.visible = false;
    chests.clear();
    for (const [k, state] of stored) chests.set(k, state);
    return prev;
  }

  // The save pass (systems/persistence.js): contents by position. Restore
  // recreates each chest's state (mesh included — the visibility follow in
  // update() hides ones whose chunks aren't loaded) and fills its slots;
  // an existing state wins, so a restore can never clobber live play.
  function serialize() {
    const out = [];
    for (const s of chests.values()) {
      out.push({
        x: s.x, y: s.y, z: s.z, facing: s.facing,
        slots: s.container.slots.map((c) => (c ? { ...c } : null)),
      });
    }
    return out;
  }

  function restore(list) {
    for (const d of list ?? []) {
      if (chests.has(keyOf(d.x, d.y, d.z))) continue;
      const s = createState(d.x, d.y, d.z, d.facing);
      const n = Math.min(s.container.slots.length, d.slots?.length ?? 0);
      for (let i = 0; i < n; i++) {
        s.container.slots[i] = d.slots[i] ? { ...d.slots[i] } : null;
      }
      s.container._emit();
    }
  }

  return {
    update,
    onBlockChanged,
    chestAt,
    swapDimensionState,
    serialize,
    restore,
    chests, // read-only by convention (debug/tests)
  };
}
