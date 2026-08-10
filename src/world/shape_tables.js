// world/shape_tables.js — Phase 21: the box tables behind the shaped
// building blocks, split out of world/shapes.js per the ARCHITECTURE size
// cap (registrations and tables together ran to 916 lines). Moved verbatim.
//
// buildShapeTables(...) is called ONCE by world/blocks.js after it freezes
// its registry, and everything it returns is re-exported from there — so
// callers keep importing block data from the block registry and this module
// stays an implementation detail of the split.
//
// What it builds:
//   SHAPE_BOXES       per id, the render box list ({ box, tiles[6] })
//   COLLISION_BOXES   per id, the physics box list
//   FLUSH_RECTS       per id per face, the rectangles a shape covers flush
//                     with the cell boundary (the mesher's face cull)
//   MAX_BOX_TOP       the tallest collision box top (fences reach 1.5)
//   plus the connection builders for fences/walls and every family lookup
//   the placement and use paths need.

import { SHAPES } from '../config.js';
import { TILE } from '../render/atlas.js';
import {
  STAIRS_BY_MATERIAL, SLAB_FAMILIES, SIGN_IDS, ITEM_FRAME_IDS,
  DOOR_IDS, TRAPDOOR_IDS, BED_IDS, FACINGS,
} from './shapes.js';

// Assigned by buildShapeTables and read by the runtime helpers below (the
// fence connection test needs to know a gate when it sees one, and the
// collision lookups need the block registry's own def reader).
let GATE_AXIS_RUNTIME = {};
let blockDefRef = null;

// ---------------------------------------------------------------------------
// The tables. blocks.js calls this once, after freezing its registry, and
// re-exports everything it returns.
// ---------------------------------------------------------------------------

export function buildShapeTables({ BLOCKS, BLOCK, blockDef, FACE_ORDER, resolveFaceTile }) {
  blockDefRef = blockDef;
  // ---------------------------------------------------------------------------
  // Phase 21 — the shape tables: ONE source of truth for what a block looks
  // like and what it collides as.
  //
  //   SHAPE_BOXES[id]      render boxes ({ box, tiles: [6 atlas tiles] }) or
  //                        null (cube/no shape) or a 'dynamic:*' string
  //   COLLISION_BOXES[id]  physics boxes ([x0,y0,z0,x1,y1,z1]) or a
  //                        'dynamic:*' string
  //   FLUSH_RECTS[id]      per face, the rectangles a shape covers flush with
  //                        the cell boundary — the mesher culls a shape face
  //                        that a neighbouring shape fully covers
  //   MAX_BOX_TOP[id]      the tallest collision box top (fences reach 1.5),
  //                        so the vertical sweep knows to look a cell lower
  // ---------------------------------------------------------------------------

  const FULL_BOX = Object.freeze([Object.freeze([0, 0, 0, 1, 1, 1])]);
  const NO_BOXES = Object.freeze([]);

  function resolveTiles6(tiles) {
    if (typeof tiles === 'number') return FACE_ORDER.map(() => tiles);
    return FACE_ORDER.map((f) => resolveFaceTile(tiles, f));
  }

  const SHAPE_BOXES = new Array(BLOCKS.length).fill(null);
  const COLLISION_BOXES = new Array(BLOCKS.length).fill(NO_BOXES);
  const FLUSH_RECTS = new Array(BLOCKS.length).fill(null);
  const MAX_BOX_TOP = new Float32Array(BLOCKS.length);
  const HAS_SHAPE = new Uint8Array(BLOCKS.length);

  // The in-plane (a, b) rectangle of a box on face `fi`, or null when the box
  // is not flush with that face. a/b axes: ±x -> (z, y), ±y -> (x, z),
  // ±z -> (x, y) — the same frame on both sides of a boundary.
  function flushRect(b, fi) {
    const [x0, y0, z0, x1, y1, z1] = b;
    switch (fi) {
      case 0: return x1 >= 1 ? [z0, y0, z1, y1] : null;
      case 1: return x0 <= 0 ? [z0, y0, z1, y1] : null;
      case 2: return y1 >= 1 ? [x0, z0, x1, z1] : null;
      case 3: return y0 <= 0 ? [x0, z0, x1, z1] : null;
      case 4: return z1 >= 1 ? [x0, y0, x1, y1] : null;
      default: return z0 <= 0 ? [x0, y0, x1, y1] : null;
    }
  }

  function buildFlushRects(boxes) {
    const rects = [[], [], [], [], [], []];
    for (const entry of boxes) {
      for (let fi = 0; fi < 6; fi++) {
        const r = flushRect(entry.box ?? entry, fi);
        if (r) rects[fi].push(r);
      }
    }
    return rects;
  }

  for (let id = 0; id < BLOCKS.length; id++) {
    const def = BLOCKS[id];
    if (!def) continue;
    if (typeof def.shape === 'string') {
      SHAPE_BOXES[id] = def.shape;
      HAS_SHAPE[id] = 1;
    } else if (def.shape) {
      SHAPE_BOXES[id] = def.shape.map((e) => ({
        box: e.box, tiles: resolveTiles6(e.tiles),
      }));
      HAS_SHAPE[id] = 1;
      FLUSH_RECTS[id] = buildFlushRects(def.shape);
    }
    if (typeof def.collision === 'string') {
      COLLISION_BOXES[id] = def.collision;
    } else if (def.collision) {
      COLLISION_BOXES[id] = def.collision;
    } else if (def.shape && typeof def.shape !== 'string') {
      COLLISION_BOXES[id] = def.shape.map((e) => e.box);
    } else if (!def.solid) {
      COLLISION_BOXES[id] = NO_BOXES;
    } else if (def.inset > 0) {
      COLLISION_BOXES[id] = [[def.inset, 0, def.inset, 1 - def.inset, 1, 1 - def.inset]];
    } else {
      COLLISION_BOXES[id] = FULL_BOX;
    }
    const boxes = COLLISION_BOXES[id];
    let top = 0;
    if (Array.isArray(boxes)) for (const b of boxes) top = Math.max(top, b[4]);
    else top = 1.5; // dynamic fence/wall collision reaches SHAPES.*.COLLISION_HEIGHT
    MAX_BOX_TOP[id] = top;
  }

  // How far above its own cell any block's collision can reach (1.5 for
  // fences/walls/gates). The vertical sweep extends its scan by this much so a
  // falling body can land on a fence top.
  const MAX_COLLISION_OVERHANG = (() => {
    let over = 0;
    for (let id = 0; id < MAX_BOX_TOP.length; id++) {
      over = Math.max(over, MAX_BOX_TOP[id] - 1);
    }
    return over;
  })();

  // --- connection-shaped blocks (fences, walls) ------------------------------

  // Does a fence/wall at (x,y,z) join its neighbour in direction (dx,dz)?
  // Solid opaque blocks, other fences/walls and matching gates all connect.
  function joinsFence(nid) {
    if (nid === BLOCK.OAK_FENCE || nid === BLOCK.COBBLESTONE_WALL) return true;
    if (GATE_AXIS_RUNTIME[nid] !== undefined) return true;
    const def = blockDefRef(nid);
    return def.solid && !def.transparent;
  }

  const H4_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // px, nx, pz, nz

  function connectionMask(getId, x, y, z) {
    let mask = 0;
    for (let i = 0; i < 4; i++) {
      const [dx, dz] = H4_DIRS[i];
      if (joinsFence(getId(x + dx, y, z + dz))) mask |= 1 << i;
    }
    return mask;
  }

  const F = SHAPES.FENCE;
  const W = SHAPES.WALL;
  const OAK_TILES6 = resolveTiles6({ all: TILE.OAK_PLANKS });
  const COBBLE_TILES6 = resolveTiles6({ all: TILE.COBBLESTONE });

  // Cached per connection mask (16 each) — the sweep and the mesher both hit
  // these every frame a player stands beside a fence, so they never allocate.
  const fenceShapeCache = [];
  const fenceCollisionCache = [];
  const wallShapeCache = [];
  const wallCollisionCache = [];

  function buildFenceShape(mask) {
    const boxes = [{
      box: [0.5 - F.POST_HALF, 0, 0.5 - F.POST_HALF, 0.5 + F.POST_HALF, F.HEIGHT, 0.5 + F.POST_HALF],
      tiles: OAK_TILES6,
    }];
    const rails = [[F.ARM_LOW, F.ARM_LOW_TOP], [F.ARM_HIGH, F.ARM_HIGH_TOP]];
    const arm = (i, y0, y1) => {
      const a = F.ARM_HALF;
      if (i === 0) return [0.5 + F.POST_HALF, y0, 0.5 - a, 1, y1, 0.5 + a];
      if (i === 1) return [0, y0, 0.5 - a, 0.5 - F.POST_HALF, y1, 0.5 + a];
      if (i === 2) return [0.5 - a, y0, 0.5 + F.POST_HALF, 0.5 + a, y1, 1];
      return [0.5 - a, y0, 0, 0.5 + a, y1, 0.5 - F.POST_HALF];
    };
    for (let i = 0; i < 4; i++) {
      if (!(mask & (1 << i))) continue;
      for (const [y0, y1] of rails) boxes.push({ box: arm(i, y0, y1), tiles: OAK_TILES6 });
    }
    return boxes;
  }

  function buildFenceCollision(mask) {
    const p = F.POST_HALF;
    const h = F.COLLISION_HEIGHT;
    const boxes = [[0.5 - p, 0, 0.5 - p, 0.5 + p, h, 0.5 + p]];
    const seg = [
      [0.5 + p, 0, 0.5 - p, 1, h, 0.5 + p],
      [0, 0, 0.5 - p, 0.5 - p, h, 0.5 + p],
      [0.5 - p, 0, 0.5 + p, 0.5 + p, h, 1],
      [0.5 - p, 0, 0, 0.5 + p, h, 0.5 - p],
    ];
    for (let i = 0; i < 4; i++) if (mask & (1 << i)) boxes.push(seg[i]);
    return boxes;
  }

  function buildWallShape(mask) {
    const boxes = [{
      box: [0.5 - W.POST_HALF, 0, 0.5 - W.POST_HALF, 0.5 + W.POST_HALF, W.HEIGHT, 0.5 + W.POST_HALF],
      tiles: COBBLE_TILES6,
    }];
    const a = W.ARM_HALF;
    const seg = [
      [0.5 + W.POST_HALF, 0, 0.5 - a, 1, W.ARM_TOP, 0.5 + a],
      [0, 0, 0.5 - a, 0.5 - W.POST_HALF, W.ARM_TOP, 0.5 + a],
      [0.5 - a, 0, 0.5 + W.POST_HALF, 0.5 + a, W.ARM_TOP, 1],
      [0.5 - a, 0, 0, 0.5 + a, W.ARM_TOP, 0.5 - W.POST_HALF],
    ];
    for (let i = 0; i < 4; i++) if (mask & (1 << i)) boxes.push({ box: seg[i], tiles: COBBLE_TILES6 });
    return boxes;
  }

  function buildWallCollision(mask) {
    const p = W.POST_HALF;
    const h = W.COLLISION_HEIGHT;
    const boxes = [[0.5 - p, 0, 0.5 - p, 0.5 + p, h, 0.5 + p]];
    const a = W.ARM_HALF;
    const seg = [
      [0.5 + p, 0, 0.5 - a, 1, h, 0.5 + a],
      [0, 0, 0.5 - a, 0.5 - p, h, 0.5 + a],
      [0.5 - a, 0, 0.5 + p, 0.5 + a, h, 1],
      [0.5 - a, 0, 0, 0.5 + a, h, 0.5 - p],
    ];
    for (let i = 0; i < 4; i++) if (mask & (1 << i)) boxes.push(seg[i]);
    return boxes;
  }

  // Render boxes for a block at a cell. `getId(x, y, z)` reads neighbours (only
  // connection-shaped blocks use it). Returns null for cube blocks.
  function shapeBoxesAt(id, getId, x, y, z) {
    const shape = SHAPE_BOXES[id];
    if (shape === null) return null;
    if (typeof shape !== 'string') return shape;
    const mask = connectionMask(getId, x, y, z);
    if (shape === 'dynamic:fence') {
      return fenceShapeCache[mask] ?? (fenceShapeCache[mask] = buildFenceShape(mask));
    }
    return wallShapeCache[mask] ?? (wallShapeCache[mask] = buildWallShape(mask));
  }

  // Collision boxes for a block at a cell (cell-local units). Always an array;
  // empty for pass-through blocks.
  function collisionBoxesAt(id, getId, x, y, z) {
    const boxes = COLLISION_BOXES[id];
    if (typeof boxes !== 'string') return boxes;
    const mask = connectionMask(getId, x, y, z);
    if (boxes === 'dynamic:fence_collision') {
      return fenceCollisionCache[mask] ?? (fenceCollisionCache[mask] = buildFenceCollision(mask));
    }
    return wallCollisionCache[mask] ?? (wallCollisionCache[mask] = buildWallCollision(mask));
  }

  // Does this block have any collision at all? (cheap pre-check for the sweep)
  function hasCollision(id) {
    const boxes = COLLISION_BOXES[id];
    return typeof boxes === 'string' || boxes.length > 0;
  }

  function isClimbable(id) {
    return blockDef(id).climbable;
  }
  // ---------------------------------------------------------------------------
  // Phase 21 families: stairs / slabs / gates / doors / trapdoors / ladders /
  // beds / signs / frames — the id lookups the interaction and placement paths
  // use. FACINGS order is [N, S, E, W] throughout.
  // ---------------------------------------------------------------------------

  const FACING_INDEX = { N: 0, S: 1, E: 2, W: 3 };
  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

  // item name -> the 4 facing ids (stairs), placed toward the player's look.
  const STAIRS_ITEM_IDS = {};
  for (const [key, ids] of Object.entries(STAIRS_BY_MATERIAL)) {
    STAIRS_ITEM_IDS[`${key}_stairs`] = ids;
  }

  // item name -> { bottom, top, full } (slabs).
  const SLAB_ITEM_FAMILIES = {};
  for (const [key, f] of Object.entries(SLAB_FAMILIES)) {
    SLAB_ITEM_FAMILIES[`${key}_slab`] = f;
  }
  // slab block id -> its family (placing a second slab makes the full block).
  const SLAB_FAMILY_OF = new Array(BLOCKS.length).fill(null);
  for (const f of Object.values(SLAB_FAMILIES)) {
    SLAB_FAMILY_OF[f.bottom] = f;
    SLAB_FAMILY_OF[f.top] = f;
  }

  // gate id -> 'X' | 'Z' and open/closed pairings.
  const GATE_AXIS = {};
  const GATE_TOGGLE = {};
  {
    const pairs = [
      [BLOCK.OAK_FENCE_GATE_X, BLOCK.OAK_FENCE_GATE_X_OPEN, 'X'],
      [BLOCK.OAK_FENCE_GATE_Z, BLOCK.OAK_FENCE_GATE_Z_OPEN, 'Z'],
    ];
    for (const [closed, open, axis] of pairs) {
      GATE_AXIS[closed] = axis;
      GATE_AXIS[open] = axis;
      GATE_TOGGLE[closed] = open;
      GATE_TOGGLE[open] = closed;
    }
  }

  // door id -> { half: 'lower'|'upper', facing, open }; and the toggle map.
  const DOOR_INFO = {};
  const DOOR_TOGGLE = {};
  for (const half of ['lower', 'upper']) {
    for (let i = 0; i < 4; i++) {
      const closed = DOOR_IDS[half].closed[i];
      const open = DOOR_IDS[half].open[i];
      DOOR_INFO[closed] = { half, facing: FACINGS[i], open: false };
      DOOR_INFO[open] = { half, facing: FACINGS[i], open: true };
      DOOR_TOGGLE[closed] = open;
      DOOR_TOGGLE[open] = closed;
    }
  }
  const DOOR_LOWER_BY_FACING = DOOR_IDS.lower.closed;
  const DOOR_UPPER_BY_FACING = DOOR_IDS.upper.closed;
  function isDoor(id) {
    return DOOR_INFO[id] !== undefined;
  }

  const TRAPDOOR_TOGGLE = {};
  for (let i = 0; i < 4; i++) {
    TRAPDOOR_TOGGLE[TRAPDOOR_IDS.closed[i]] = TRAPDOOR_IDS.open[i];
    TRAPDOOR_TOGGLE[TRAPDOOR_IDS.open[i]] = TRAPDOOR_IDS.closed[i];
  }
  const TRAPDOOR_BY_FACING = TRAPDOOR_IDS.closed;
  function isTrapdoor(id) {
    return TRAPDOOR_TOGGLE[id] !== undefined;
  }

  const LADDER_BY_FACING = {
    N: BLOCK.LADDER_N, S: BLOCK.LADDER_S, E: BLOCK.LADDER_E, W: BLOCK.LADDER_W,
  };

  // bed id -> { part: 'foot'|'head', facing }; the head sits one cell along
  // `facing` from the foot.
  const BED_INFO = {};
  for (const part of ['foot', 'head']) {
    BED_IDS[part].forEach((id, i) => {
      BED_INFO[id] = { part, facing: FACINGS[i] };
    });
  }
  const BED_FOOT_BY_FACING = BED_IDS.foot;
  const BED_HEAD_BY_FACING = BED_IDS.head;
  function isBed(id) {
    return BED_INFO[id] !== undefined;
  }
  const FACING_DELTA = {
    N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  };

  function isSign(id) {
    return SIGN_IDS.stand.includes(id) || SIGN_IDS.wall.includes(id);
  }
  function isItemFrame(id) {
    return ITEM_FRAME_IDS.includes(id);
  }
  // Which way a wall-mounted block faces (its outward normal) — wall signs,
  // item frames and ladders (the climb check pushes INTO -facing).
  const WALL_MOUNT_FACING = {};
  for (const [facing, id] of Object.entries(LADDER_BY_FACING)) {
    WALL_MOUNT_FACING[id] = facing;
  }
  SIGN_IDS.wall.forEach((id, i) => { WALL_MOUNT_FACING[id] = FACINGS[i]; });
  SIGN_IDS.stand.forEach((id, i) => { WALL_MOUNT_FACING[id] = FACINGS[i]; });
  ITEM_FRAME_IDS.forEach((id, i) => { WALL_MOUNT_FACING[id] = FACINGS[i]; });
  GATE_AXIS_RUNTIME = GATE_AXIS;
  return {
    SHAPE_BOXES, COLLISION_BOXES, FLUSH_RECTS, MAX_BOX_TOP, HAS_SHAPE,
    MAX_COLLISION_OVERHANG, shapeBoxesAt, collisionBoxesAt, hasCollision,
    isClimbable,
    STAIRS_BY_MATERIAL, SLAB_FAMILIES, SIGN_IDS, ITEM_FRAME_IDS,
    STAIRS_ITEM_IDS, SLAB_ITEM_FAMILIES, SLAB_FAMILY_OF, GATE_AXIS,
    GATE_TOGGLE, DOOR_INFO, DOOR_TOGGLE, DOOR_LOWER_BY_FACING,
    DOOR_UPPER_BY_FACING, isDoor, TRAPDOOR_TOGGLE, TRAPDOOR_BY_FACING,
    isTrapdoor, LADDER_BY_FACING, BED_INFO, BED_FOOT_BY_FACING,
    BED_HEAD_BY_FACING, isBed, FACING_DELTA, isSign, isItemFrame,
    WALL_MOUNT_FACING,
  };
}
