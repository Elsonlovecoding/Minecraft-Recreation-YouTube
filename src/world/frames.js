// world/frames.js — Phase 21: item frame block entities. A frame hangs on a
// wall face; right-clicking it with an item mounts that item, right-clicking
// a filled frame pops the item back out, and breaking the frame drops both.
//
// Same shape as world/signs.js and world/chests.js: the BLOCK (the wooden
// border) meshes through the generic shape emitter, and only the displayed
// item lives here as a per-position entity — a Map keyed by cell, swapped per
// dimension, torn down by the block-change listener.

import * as THREE from 'three';
import { SHAPES, ITEMS } from '../config.js';
import { isItemFrame, WALL_MOUNT_FACING } from './blocks.js';
import { createItemDisplayMesh } from '../entities/items.js';

const IF = SHAPES.ITEM_FRAME;
const key = (x, y, z) => `${x},${y},${z}`;
const NORMAL = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

export function createFrames({ world, scene, items }) {
  let frames = new Map(); // "x,y,z" -> { x, y, z, item, group }

  function disposeMesh(frame) {
    if (!frame.group) return;
    frame.group.removeFromParent();
    frame.group = null;
  }

  // Mount the displayed item just in front of the frame's face.
  function refresh(frame) {
    disposeMesh(frame);
    const id = world.getBlock(frame.x, frame.y, frame.z);
    if (!isItemFrame(id) || !frame.item) return;
    const [nx, nz] = NORMAL[WALL_MOUNT_FACING[id]];
    const group = new THREE.Group();
    group.add(createItemDisplayMesh(frame.item, IF.ITEM_SIZE));
    group.position.set(
      frame.x + 0.5 + nx * (0.5 - IF.DEPTH - 0.02),
      frame.y + 0.5,
      frame.z + 0.5 + nz * (0.5 - IF.DEPTH - 0.02),
    );
    group.rotation.y = Math.atan2(nx, nz);
    scene.add(group);
    frame.group = group;
  }

  function frameAt(x, y, z) {
    const k = key(x, y, z);
    let frame = frames.get(k);
    if (!frame) {
      frame = { x, y, z, item: null, group: null };
      frames.set(k, frame);
    }
    return frame;
  }

  // Right-click on a frame: mount the held item, or pop the mounted one back
  // out into the world. Returns true when the click was consumed.
  function use(x, y, z, hand) {
    const frame = frameAt(x, y, z);
    if (frame.item) {
      items.spawn(frame.item, 1, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      frame.item = null;
      refresh(frame);
      return true;
    }
    const name = hand?.name;
    if (!name) return false;
    frame.item = name;
    hand.consume(1);
    refresh(frame);
    return true;
  }

  // The block listener: a frame that stops being a frame drops its item.
  function onBlockChanged(x, y, z, id) {
    const k = key(x, y, z);
    const frame = frames.get(k);
    if (!frame || isItemFrame(id)) return;
    if (frame.item) {
      items.spawn(frame.item, 1, {
        x: x + 0.5, y: y + ITEMS.DROP_SPAWN_Y_OFFSET, z: z + 0.5,
      });
    }
    disposeMesh(frame);
    frames.delete(k);
  }

  function swapDimensionState(stored = null) {
    const prev = frames;
    for (const frame of prev.values()) if (frame.group) frame.group.visible = false;
    frames = stored ?? new Map();
    for (const frame of frames.values()) if (frame.group) frame.group.visible = true;
    return prev;
  }

  return {
    onBlockChanged,
    use,
    frameAt,
    swapDimensionState,
    update() {}, // frames are static; the manager list expects the method
    get count() {
      return frames.size;
    },
  };
}
