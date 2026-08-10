// world/shapes.js — Phase 21: the SHAPED building blocks — stairs, slabs,
// fences, gates, walls, ladders, doors, trapdoors, beds, signs, flower pots
// and item frames — split out of world/blocks.js the moment that file passed
// the ARCHITECTURE size cap with them inline (1722 lines).
//
// Three parts, all moved verbatim from blocks.js:
//
//   SHAPED_BLOCK_IDS          the ids themselves (77..162). They live here so
//                             blocks.js can spread them into BLOCK without
//                             importing back — the pair stays cycle-free.
//   registerBuildingBlocks()  the registry entries, called by blocks.js with
//                             its own private `register` at the point in its
//                             registration order where these ids belong.
//   buildShapeTables()        the ONE box table both the mesher and the
//                             collision sweep read — SHAPE_BOXES (render),
//                             COLLISION_BOXES (physics), FLUSH_RECTS (face
//                             culling), MAX_BOX_TOP — plus the connection
//                             builders for fences/walls and every family
//                             lookup the placement and use paths need.
//
// The rule this file exists to hold: a block's shape is written ONCE, so
// what the mesher draws and what the player walks into can never drift.

import { SHAPES } from '../config.js';
import { TILE } from '../render/atlas.js';

export const SHAPED_BLOCK_IDS = {
  // Phase 21 building blocks. Stairs: 5 materials x 4 facings. `facing` is
  // the direction the step CLIMBS toward (vanilla: the direction the player
  // faced when placing), so the raised half sits on the facing side.
  COBBLESTONE_STAIRS_N: 77,
  COBBLESTONE_STAIRS_S: 78,
  COBBLESTONE_STAIRS_E: 79,
  COBBLESTONE_STAIRS_W: 80,
  OAK_STAIRS_N: 81,
  OAK_STAIRS_S: 82,
  OAK_STAIRS_E: 83,
  OAK_STAIRS_W: 84,
  STONE_BRICK_STAIRS_N: 85,
  STONE_BRICK_STAIRS_S: 86,
  STONE_BRICK_STAIRS_E: 87,
  STONE_BRICK_STAIRS_W: 88,
  SANDSTONE_STAIRS_N: 89,
  SANDSTONE_STAIRS_S: 90,
  SANDSTONE_STAIRS_E: 91,
  SANDSTONE_STAIRS_W: 92,
  NETHER_BRICK_STAIRS_N: 93,
  NETHER_BRICK_STAIRS_S: 94,
  NETHER_BRICK_STAIRS_E: 95,
  NETHER_BRICK_STAIRS_W: 96,
  // Slabs: bottom half and top half per material. Two slabs of a material
  // stacked make the full block again (placing onto a matching slab).
  COBBLESTONE_SLAB: 97,
  COBBLESTONE_SLAB_TOP: 98,
  OAK_SLAB: 99,
  OAK_SLAB_TOP: 100,
  STONE_BRICK_SLAB: 101,
  STONE_BRICK_SLAB_TOP: 102,
  SANDSTONE_SLAB: 103,
  SANDSTONE_SLAB_TOP: 104,
  NETHER_BRICK_SLAB: 105,
  NETHER_BRICK_SLAB_TOP: 106,
  OAK_FENCE: 107,
  // Fence gates: the panel lies ALONG the named axis (so an X gate blocks
  // travel along z). Open variants swing their leaves to the cell edges.
  OAK_FENCE_GATE_X: 108,
  OAK_FENCE_GATE_Z: 109,
  OAK_FENCE_GATE_X_OPEN: 110,
  OAK_FENCE_GATE_Z_OPEN: 111,
  COBBLESTONE_WALL: 112,
  // Ladders: `facing` is the direction the rungs face — out of the wall the
  // ladder hangs on.
  LADDER_N: 113,
  LADDER_S: 114,
  LADDER_E: 115,
  LADDER_W: 116,
  // Doors: two blocks tall (lower + upper), 4 facings, open/closed. `facing`
  // is the direction the CLOSED door's face points; opening swings it 90°.
  OAK_DOOR_LOWER_N: 117,
  OAK_DOOR_LOWER_S: 118,
  OAK_DOOR_LOWER_E: 119,
  OAK_DOOR_LOWER_W: 120,
  OAK_DOOR_LOWER_N_OPEN: 121,
  OAK_DOOR_LOWER_S_OPEN: 122,
  OAK_DOOR_LOWER_E_OPEN: 123,
  OAK_DOOR_LOWER_W_OPEN: 124,
  OAK_DOOR_UPPER_N: 125,
  OAK_DOOR_UPPER_S: 126,
  OAK_DOOR_UPPER_E: 127,
  OAK_DOOR_UPPER_W: 128,
  OAK_DOOR_UPPER_N_OPEN: 129,
  OAK_DOOR_UPPER_S_OPEN: 130,
  OAK_DOOR_UPPER_E_OPEN: 131,
  OAK_DOOR_UPPER_W_OPEN: 132,
  // Trapdoors: one block, horizontal when closed, vertical against the
  // facing wall when open.
  OAK_TRAPDOOR_N: 133,
  OAK_TRAPDOOR_S: 134,
  OAK_TRAPDOOR_E: 135,
  OAK_TRAPDOOR_W: 136,
  OAK_TRAPDOOR_N_OPEN: 137,
  OAK_TRAPDOOR_S_OPEN: 138,
  OAK_TRAPDOOR_E_OPEN: 139,
  OAK_TRAPDOOR_W_OPEN: 140,
  // Beds: two cells, head + foot. `facing` points from foot toward head.
  BED_FOOT_N: 141,
  BED_FOOT_S: 142,
  BED_FOOT_E: 143,
  BED_FOOT_W: 144,
  BED_HEAD_N: 145,
  BED_HEAD_S: 146,
  BED_HEAD_E: 147,
  BED_HEAD_W: 148,
  // Signs: free-standing (4 rotations) and wall-mounted (4 facings). The
  // text itself is block-entity state (world/signs.js).
  SIGN_N: 149,
  SIGN_S: 150,
  SIGN_E: 151,
  SIGN_W: 152,
  WALL_SIGN_N: 153,
  WALL_SIGN_S: 154,
  WALL_SIGN_E: 155,
  WALL_SIGN_W: 156,
  FLOWER_POT: 157,
  FLOWER_POT_SAPLING: 158,
  // Item frames hang on a wall face; the displayed item is block-entity
  // state (world/frames.js).
  ITEM_FRAME_N: 159,
  ITEM_FRAME_S: 160,
  ITEM_FRAME_E: 161,
  ITEM_FRAME_W: 162
};

// ---------------------------------------------------------------------------
// The registry entries. `register` is blocks.js's private registrar and
// `BLOCK` its (already complete) id table.
// ---------------------------------------------------------------------------

// Family tables the registrations build. world/shape_tables.js turns them
// into the public lookups, so they are exported straight across.
export let STAIRS_BY_MATERIAL = {};
export let SLAB_FAMILIES = {};
export let SIGN_IDS = { stand: [], wall: [] };
export let ITEM_FRAME_IDS = [];
export let DOOR_IDS = null;
export let TRAPDOOR_IDS = null;
export let BED_IDS = null;
export const FACINGS = ['N', 'S', 'E', 'W'];

export function registerBuildingBlocks(register, BLOCK) {
  // ---------------------------------------------------------------------------
  // Phase 21 — the building blocks (stairs, slabs, fences, gates, walls,
  // ladders, doors, trapdoors, beds, signs, pots, item frames).
  //
  // Every one carries a `shape`: the box list the mesher renders AND (unless
  // `collision` overrides it) the box list the player collides with. `faces`
  // stays populated so item icons, dropped items and the held hand keep
  // working through the existing block-cube path — the mesher never reaches
  // the cube emitter for them because chunks.js dispatches `special: 'shape'`
  // first.
  // ---------------------------------------------------------------------------

  const S = SHAPES;
  const box = (x0, y0, z0, x1, y1, z1) => [x0, y0, z0, x1, y1, z1];

  // Material palettes: the tiles a shaped block's boxes sample.
  const MAT = {
    cobblestone: { all: TILE.COBBLESTONE },
    oak: { all: TILE.OAK_PLANKS },
    stone_brick: { all: TILE.STONE_BRICKS },
    sandstone: { top: TILE.SANDSTONE_TOP, bottom: TILE.SANDSTONE_TOP, side: TILE.SANDSTONE },
    nether_brick: { all: TILE.NETHER_BRICKS },
  };

  // --- stairs ---------------------------------------------------------------

  // The raised half per facing, as [x0, z0, x1, z1] over the cell footprint.
  const STAIR_HALF = {
    N: [0, 0, 1, 0.5],
    S: [0, 0.5, 1, 1],
    E: [0.5, 0, 1, 1],
    W: [0, 0, 0.5, 1],
  };

  function registerStairs(id, name, display, mat, facing, hardness, tool, minTier, dropItem) {
    const [hx0, hz0, hx1, hz1] = STAIR_HALF[facing];
    register(id, name, display, {
      faces: mat, hardness, tool, minTier,
      transparent: true, special: 'shape',
      drops: [{ item: dropItem, count: 1 }],
      shape: [
        { box: box(0, 0, 0, 1, S.STAIRS.STEP_HEIGHT, 1), tiles: mat },
        { box: box(hx0, S.STAIRS.STEP_HEIGHT, hz0, hx1, 1, hz1), tiles: mat },
      ],
    });
  }

  const STAIR_FAMILIES = [
    ['cobblestone', 'Cobblestone Stairs', MAT.cobblestone, 2.0, 'pickaxe', 'wood',
      [BLOCK.COBBLESTONE_STAIRS_N, BLOCK.COBBLESTONE_STAIRS_S,
        BLOCK.COBBLESTONE_STAIRS_E, BLOCK.COBBLESTONE_STAIRS_W]],
    ['oak', 'Oak Stairs', MAT.oak, 2.0, 'axe', 'hand',
      [BLOCK.OAK_STAIRS_N, BLOCK.OAK_STAIRS_S, BLOCK.OAK_STAIRS_E, BLOCK.OAK_STAIRS_W]],
    ['stone_brick', 'Stone Brick Stairs', MAT.stone_brick, 1.5, 'pickaxe', 'wood',
      [BLOCK.STONE_BRICK_STAIRS_N, BLOCK.STONE_BRICK_STAIRS_S,
        BLOCK.STONE_BRICK_STAIRS_E, BLOCK.STONE_BRICK_STAIRS_W]],
    ['sandstone', 'Sandstone Stairs', MAT.sandstone, 0.8, 'pickaxe', 'wood',
      [BLOCK.SANDSTONE_STAIRS_N, BLOCK.SANDSTONE_STAIRS_S,
        BLOCK.SANDSTONE_STAIRS_E, BLOCK.SANDSTONE_STAIRS_W]],
    ['nether_brick', 'Nether Brick Stairs', MAT.nether_brick, 2.0, 'pickaxe', 'wood',
      [BLOCK.NETHER_BRICK_STAIRS_N, BLOCK.NETHER_BRICK_STAIRS_S,
        BLOCK.NETHER_BRICK_STAIRS_E, BLOCK.NETHER_BRICK_STAIRS_W]],
  ];
  // material key -> the four stair ids, indexed like FACINGS (placement).
  STAIRS_BY_MATERIAL = {};
  for (const [key, display, mat, hardness, tool, minTier, ids] of STAIR_FAMILIES) {
    STAIRS_BY_MATERIAL[key] = ids;
    ids.forEach((id, i) => {
      registerStairs(
        id, `${key}_stairs_${FACINGS[i].toLowerCase()}`, display, mat,
        FACINGS[i], hardness, tool, minTier, `${key}_stairs`,
      );
    });
  }

  // --- slabs ----------------------------------------------------------------

  // material key -> { bottom, top, full } — `full` is the block two slabs make.
  SLAB_FAMILIES = {
    cobblestone: {
      bottom: BLOCK.COBBLESTONE_SLAB, top: BLOCK.COBBLESTONE_SLAB_TOP,
      full: BLOCK.COBBLESTONE, mat: MAT.cobblestone, display: 'Cobblestone Slab',
      hardness: 2.0, tool: 'pickaxe', minTier: 'wood',
    },
    oak: {
      bottom: BLOCK.OAK_SLAB, top: BLOCK.OAK_SLAB_TOP,
      full: BLOCK.OAK_PLANKS, mat: MAT.oak, display: 'Oak Slab',
      hardness: 2.0, tool: 'axe', minTier: 'hand',
    },
    stone_brick: {
      bottom: BLOCK.STONE_BRICK_SLAB, top: BLOCK.STONE_BRICK_SLAB_TOP,
      full: BLOCK.STONE_BRICKS, mat: MAT.stone_brick, display: 'Stone Brick Slab',
      hardness: 1.5, tool: 'pickaxe', minTier: 'wood',
    },
    sandstone: {
      bottom: BLOCK.SANDSTONE_SLAB, top: BLOCK.SANDSTONE_SLAB_TOP,
      full: BLOCK.SANDSTONE, mat: MAT.sandstone, display: 'Sandstone Slab',
      hardness: 0.8, tool: 'pickaxe', minTier: 'wood',
    },
    nether_brick: {
      bottom: BLOCK.NETHER_BRICK_SLAB, top: BLOCK.NETHER_BRICK_SLAB_TOP,
      full: BLOCK.NETHER_BRICKS, mat: MAT.nether_brick, display: 'Nether Brick Slab',
      hardness: 2.0, tool: 'pickaxe', minTier: 'wood',
    },
  };
  for (const [key, f] of Object.entries(SLAB_FAMILIES)) {
    const common = {
      faces: f.mat, hardness: f.hardness, tool: f.tool, minTier: f.minTier,
      transparent: true, special: 'shape',
      drops: [{ item: `${key}_slab`, count: 1 }],
    };
    register(f.bottom, `${key}_slab`, f.display, {
      ...common,
      shape: [{ box: box(0, 0, 0, 1, S.SLAB_HEIGHT, 1), tiles: f.mat }],
    });
    register(f.top, `${key}_slab_top`, f.display, {
      ...common,
      shape: [{ box: box(0, S.SLAB_HEIGHT, 0, 1, 1, 1), tiles: f.mat }],
    });
  }

  // --- fences, gates and walls ----------------------------------------------

  register(BLOCK.OAK_FENCE, 'oak_fence', 'Oak Fence', {
    faces: MAT.oak, hardness: 2.0, tool: 'axe',
    transparent: true, special: 'shape',
    shape: 'dynamic:fence', collision: 'dynamic:fence_collision',
  });
  register(BLOCK.COBBLESTONE_WALL, 'cobblestone_wall', 'Cobblestone Wall', {
    faces: MAT.cobblestone, hardness: 2.0, tool: 'pickaxe', minTier: 'wood',
    transparent: true, special: 'shape',
    shape: 'dynamic:wall', collision: 'dynamic:wall_collision',
  });

  const G = S.GATE;
  function gateShape(axis, open) {
    const p = G.POST_HALF;
    const boxes = [];
    // Two posts at the cell edges along the gate's axis.
    if (axis === 'X') {
      boxes.push({ box: box(0, 0, 0.5 - p, p * 2, G.TOP, 0.5 + p), tiles: MAT.oak });
      boxes.push({ box: box(1 - p * 2, 0, 0.5 - p, 1, G.TOP, 0.5 + p), tiles: MAT.oak });
      if (!open) {
        boxes.push({
          box: box(p * 2, G.BOTTOM, 0.5 - G.THICK_HALF, 1 - p * 2, G.TOP, 0.5 + G.THICK_HALF),
          tiles: MAT.oak,
        });
      } else {
        // Leaves swung open along z, hugging the posts.
        boxes.push({ box: box(0, G.BOTTOM, 0.5 + G.THICK_HALF, p * 2, G.TOP, 0.5 + G.OPEN_SIDE), tiles: MAT.oak });
        boxes.push({ box: box(1 - p * 2, G.BOTTOM, 0.5 + G.THICK_HALF, 1, G.TOP, 0.5 + G.OPEN_SIDE), tiles: MAT.oak });
      }
    } else {
      boxes.push({ box: box(0.5 - p, 0, 0, 0.5 + p, G.TOP, p * 2), tiles: MAT.oak });
      boxes.push({ box: box(0.5 - p, 0, 1 - p * 2, 0.5 + p, G.TOP, 1), tiles: MAT.oak });
      if (!open) {
        boxes.push({
          box: box(0.5 - G.THICK_HALF, G.BOTTOM, p * 2, 0.5 + G.THICK_HALF, G.TOP, 1 - p * 2),
          tiles: MAT.oak,
        });
      } else {
        boxes.push({ box: box(0.5 + G.THICK_HALF, G.BOTTOM, 0, 0.5 + G.OPEN_SIDE, G.TOP, p * 2), tiles: MAT.oak });
        boxes.push({ box: box(0.5 + G.THICK_HALF, G.BOTTOM, 1 - p * 2, 0.5 + G.OPEN_SIDE, G.TOP, 1), tiles: MAT.oak });
      }
    }
    return boxes;
  }
  function registerGate(id, name, axis, open) {
    register(id, name, 'Oak Fence Gate', {
      faces: MAT.oak, hardness: 2.0, tool: 'axe',
      transparent: true, special: 'shape',
      drops: [{ item: 'oak_fence_gate', count: 1 }],
      shape: gateShape(axis, open),
      // A closed gate blocks like a fence (1.5 tall so mobs can't hop it);
      // an open one has no collision at all.
      collision: open ? [] : (axis === 'X'
        ? [box(0, 0, 0.5 - G.POST_HALF, 1, G.COLLISION_HEIGHT, 0.5 + G.POST_HALF)]
        : [box(0.5 - G.POST_HALF, 0, 0, 0.5 + G.POST_HALF, G.COLLISION_HEIGHT, 1)]),
    });
  }
  registerGate(BLOCK.OAK_FENCE_GATE_X, 'oak_fence_gate_x', 'X', false);
  registerGate(BLOCK.OAK_FENCE_GATE_Z, 'oak_fence_gate_z', 'Z', false);
  registerGate(BLOCK.OAK_FENCE_GATE_X_OPEN, 'oak_fence_gate_x_open', 'X', true);
  registerGate(BLOCK.OAK_FENCE_GATE_Z_OPEN, 'oak_fence_gate_z_open', 'Z', true);

  // --- ladders --------------------------------------------------------------

  // The rung panel hugs the wall opposite `facing` (facing = out of the wall).
  const LADDER_BOX = {
    N: box(0, 0, 1 - S.LADDER.DEPTH, 1, 1, 1),
    S: box(0, 0, 0, 1, 1, S.LADDER.DEPTH),
    E: box(0, 0, 0, S.LADDER.DEPTH, 1, 1),
    W: box(1 - S.LADDER.DEPTH, 0, 0, 1, 1, 1),
  };
  const LADDER_TILES = { all: TILE.IRON_BARS }; // closest rung art in the atlas
  for (const [facing, id] of [
    ['N', BLOCK.LADDER_N], ['S', BLOCK.LADDER_S],
    ['E', BLOCK.LADDER_E], ['W', BLOCK.LADDER_W],
  ]) {
    register(id, `ladder_${facing.toLowerCase()}`, 'Ladder', {
      faces: LADDER_TILES, hardness: 0.4, tool: 'axe',
      solid: false, transparent: true, special: 'shape', climbable: true,
      drops: [{ item: 'ladder', count: 1 }],
      shape: [{ box: LADDER_BOX[facing], tiles: LADDER_TILES }],
      collision: [], // vanilla ladders are walk-through; you climb them
    });
  }

  // --- doors and trapdoors --------------------------------------------------

  // A closed door's slab sits against the `facing` side of the cell; opening
  // swings it a quarter turn (to the cell's +x/-x or +z/-z edge).
  const D = S.DOOR.THICKNESS;
  const DOOR_CLOSED = {
    N: box(0, 0, 0, 1, 1, D),
    S: box(0, 0, 1 - D, 1, 1, 1),
    E: box(1 - D, 0, 0, 1, 1, 1),
    W: box(0, 0, 0, D, 1, 1),
  };
  const DOOR_OPEN = { N: 'W', S: 'E', E: 'N', W: 'S' }; // hinge quarter-turn
  function registerDoorPart(id, name, facing, upper, open) {
    const shapeBox = open ? DOOR_CLOSED[DOOR_OPEN[facing]] : DOOR_CLOSED[facing];
    register(id, name, 'Oak Door', {
      faces: MAT.oak, hardness: 3.0, tool: 'axe',
      transparent: true, special: 'shape',
      // Only the lower half drops the item (vanilla) — the other half is
      // removed by the door logic in player/interaction.js.
      drops: upper ? [] : [{ item: 'oak_door', count: 1 }],
      shape: [{ box: shapeBox, tiles: MAT.oak }],
    });
  }
  DOOR_IDS = {
    lower: {
      closed: [BLOCK.OAK_DOOR_LOWER_N, BLOCK.OAK_DOOR_LOWER_S, BLOCK.OAK_DOOR_LOWER_E, BLOCK.OAK_DOOR_LOWER_W],
      open: [BLOCK.OAK_DOOR_LOWER_N_OPEN, BLOCK.OAK_DOOR_LOWER_S_OPEN, BLOCK.OAK_DOOR_LOWER_E_OPEN, BLOCK.OAK_DOOR_LOWER_W_OPEN],
    },
    upper: {
      closed: [BLOCK.OAK_DOOR_UPPER_N, BLOCK.OAK_DOOR_UPPER_S, BLOCK.OAK_DOOR_UPPER_E, BLOCK.OAK_DOOR_UPPER_W],
      open: [BLOCK.OAK_DOOR_UPPER_N_OPEN, BLOCK.OAK_DOOR_UPPER_S_OPEN, BLOCK.OAK_DOOR_UPPER_E_OPEN, BLOCK.OAK_DOOR_UPPER_W_OPEN],
    },
  };
  for (const half of ['lower', 'upper']) {
    for (const state of ['closed', 'open']) {
      DOOR_IDS[half][state].forEach((id, i) => {
        registerDoorPart(
          id, `oak_door_${half}_${FACINGS[i].toLowerCase()}${state === 'open' ? '_open' : ''}`,
          FACINGS[i], half === 'upper', state === 'open',
        );
      });
    }
  }

  const T = S.TRAPDOOR.THICKNESS;
  const TRAPDOOR_OPEN_BOX = {
    N: box(0, 0, 0, 1, 1, T),
    S: box(0, 0, 1 - T, 1, 1, 1),
    E: box(1 - T, 0, 0, 1, 1, 1),
    W: box(0, 0, 0, T, 1, 1),
  };
  TRAPDOOR_IDS = {
    closed: [BLOCK.OAK_TRAPDOOR_N, BLOCK.OAK_TRAPDOOR_S, BLOCK.OAK_TRAPDOOR_E, BLOCK.OAK_TRAPDOOR_W],
    open: [BLOCK.OAK_TRAPDOOR_N_OPEN, BLOCK.OAK_TRAPDOOR_S_OPEN, BLOCK.OAK_TRAPDOOR_E_OPEN, BLOCK.OAK_TRAPDOOR_W_OPEN],
  };
  for (const state of ['closed', 'open']) {
    TRAPDOOR_IDS[state].forEach((id, i) => {
      const facing = FACINGS[i];
      register(
        id, `oak_trapdoor_${facing.toLowerCase()}${state === 'open' ? '_open' : ''}`,
        'Oak Trapdoor',
        {
          faces: MAT.oak, hardness: 3.0, tool: 'axe',
          transparent: true, special: 'shape',
          drops: [{ item: 'oak_trapdoor', count: 1 }],
          shape: [{
            box: state === 'open' ? TRAPDOOR_OPEN_BOX[facing] : box(0, 0, 0, 1, T, 1),
            tiles: MAT.oak,
          }],
        },
      );
    });
  }

  // --- beds -----------------------------------------------------------------

  const BED_TILES = {
    top: TILE.WHITE_WOOL, bottom: TILE.OAK_PLANKS, side: TILE.WHITE_WOOL,
  };
  BED_IDS = {
    foot: [BLOCK.BED_FOOT_N, BLOCK.BED_FOOT_S, BLOCK.BED_FOOT_E, BLOCK.BED_FOOT_W],
    head: [BLOCK.BED_HEAD_N, BLOCK.BED_HEAD_S, BLOCK.BED_HEAD_E, BLOCK.BED_HEAD_W],
  };
  for (const part of ['foot', 'head']) {
    BED_IDS[part].forEach((id, i) => {
      register(id, `bed_${part}_${FACINGS[i].toLowerCase()}`, 'Bed', {
        faces: BED_TILES, hardness: 0.2, transparent: true, special: 'shape',
        // Only the foot drops the item; breaking either removes both.
        drops: part === 'foot' ? [{ item: 'bed', count: 1 }] : [],
        shape: [{ box: box(0, 0, 0, 1, S.BED.HEIGHT, 1), tiles: BED_TILES }],
      });
    });
  }

  // --- signs, pots and item frames -------------------------------------------

  const SG = S.SIGN;
  const SIGN_TILES = MAT.oak;
  // A standing sign's board faces the named direction; wall signs hang on the
  // wall opposite their facing.
  const SIGN_STAND_SHAPE = (facing) => {
    const alongX = facing === 'N' || facing === 'S';
    const boardHalf = SG.BOARD_HALF;
    const t = SG.BOARD_THICK;
    return [
      {
        box: box(0.5 - SG.POST_HALF, 0, 0.5 - SG.POST_HALF,
          0.5 + SG.POST_HALF, SG.POST_TOP, 0.5 + SG.POST_HALF),
        tiles: SIGN_TILES,
      },
      {
        box: alongX
          ? box(0.5 - boardHalf, SG.BOARD_BOTTOM, 0.5 - t, 0.5 + boardHalf, SG.BOARD_TOP, 0.5 + t)
          : box(0.5 - t, SG.BOARD_BOTTOM, 0.5 - boardHalf, 0.5 + t, SG.BOARD_TOP, 0.5 + boardHalf),
        tiles: SIGN_TILES,
      },
    ];
  };
  const SIGN_WALL_SHAPE = (facing) => {
    const t = SG.BOARD_THICK;
    const h = SG.BOARD_HALF;
    const off = SG.WALL_OFFSET;
    const spans = {
      N: box(0.5 - h, SG.WALL_BOTTOM, off, 0.5 + h, SG.WALL_TOP, off + t * 2),
      S: box(0.5 - h, SG.WALL_BOTTOM, 1 - off - t * 2, 0.5 + h, SG.WALL_TOP, 1 - off),
      E: box(1 - off - t * 2, SG.WALL_BOTTOM, 0.5 - h, 1 - off, SG.WALL_TOP, 0.5 + h),
      W: box(off, SG.WALL_BOTTOM, 0.5 - h, off + t * 2, SG.WALL_TOP, 0.5 + h),
    };
    return [{ box: spans[facing], tiles: SIGN_TILES }];
  };
  SIGN_IDS = {
    stand: [BLOCK.SIGN_N, BLOCK.SIGN_S, BLOCK.SIGN_E, BLOCK.SIGN_W],
    wall: [BLOCK.WALL_SIGN_N, BLOCK.WALL_SIGN_S, BLOCK.WALL_SIGN_E, BLOCK.WALL_SIGN_W],
  };
  for (const kind of ['stand', 'wall']) {
    SIGN_IDS[kind].forEach((id, i) => {
      register(id, `${kind === 'wall' ? 'wall_sign' : 'sign'}_${FACINGS[i].toLowerCase()}`, 'Sign', {
        faces: SIGN_TILES, hardness: 1.0, tool: 'axe',
        solid: false, transparent: true, special: 'shape',
        drops: [{ item: 'sign', count: 1 }],
        shape: kind === 'wall' ? SIGN_WALL_SHAPE(FACINGS[i]) : SIGN_STAND_SHAPE(FACINGS[i]),
        collision: [],
      });
    });
  }

  const FP = S.FLOWER_POT;
  const POT_TILES = { all: TILE.DIRT }; // closest unglazed-terracotta tile
  register(BLOCK.FLOWER_POT, 'flower_pot', 'Flower Pot', {
    faces: POT_TILES, hardness: 0.2, transparent: true, special: 'shape',
    shape: [{ box: box(0.5 - FP.HALF, 0, 0.5 - FP.HALF, 0.5 + FP.HALF, FP.HEIGHT, 0.5 + FP.HALF), tiles: POT_TILES }],
  });
  register(BLOCK.FLOWER_POT_SAPLING, 'flower_pot_sapling', 'Potted Sapling', {
    faces: POT_TILES, hardness: 0.2, transparent: true, special: 'shape',
    drops: [{ item: 'flower_pot', count: 1 }, { item: 'oak_sapling', count: 1 }],
    shape: [
      { box: box(0.5 - FP.HALF, 0, 0.5 - FP.HALF, 0.5 + FP.HALF, FP.HEIGHT, 0.5 + FP.HALF), tiles: POT_TILES },
      {
        box: box(0.5 - FP.PLANT_HALF, FP.HEIGHT, 0.5 - 0.5 / 16,
          0.5 + FP.PLANT_HALF, FP.PLANT_TOP, 0.5 + 0.5 / 16),
        tiles: { all: TILE.OAK_LEAVES },
      },
      {
        box: box(0.5 - 0.5 / 16, FP.HEIGHT, 0.5 - FP.PLANT_HALF,
          0.5 + 0.5 / 16, FP.PLANT_TOP, 0.5 + FP.PLANT_HALF),
        tiles: { all: TILE.OAK_LEAVES },
      },
    ],
    collision: [box(0.5 - FP.HALF, 0, 0.5 - FP.HALF, 0.5 + FP.HALF, FP.HEIGHT, 0.5 + FP.HALF)],
  });

  const IF = S.ITEM_FRAME;
  const FRAME_TILES = MAT.oak;
  const FRAME_BOX = {
    N: box(0.5 - IF.HALF, 0.5 - IF.HALF, 0, 0.5 + IF.HALF, 0.5 + IF.HALF, IF.DEPTH),
    S: box(0.5 - IF.HALF, 0.5 - IF.HALF, 1 - IF.DEPTH, 0.5 + IF.HALF, 0.5 + IF.HALF, 1),
    E: box(1 - IF.DEPTH, 0.5 - IF.HALF, 0.5 - IF.HALF, 1, 0.5 + IF.HALF, 0.5 + IF.HALF),
    W: box(0, 0.5 - IF.HALF, 0.5 - IF.HALF, IF.DEPTH, 0.5 + IF.HALF, 0.5 + IF.HALF),
  };
  ITEM_FRAME_IDS =
    [BLOCK.ITEM_FRAME_N, BLOCK.ITEM_FRAME_S, BLOCK.ITEM_FRAME_E, BLOCK.ITEM_FRAME_W];
  ITEM_FRAME_IDS.forEach((id, i) => {
    register(id, `item_frame_${FACINGS[i].toLowerCase()}`, 'Item Frame', {
      faces: FRAME_TILES, hardness: 0.25,
      solid: false, transparent: true, special: 'shape',
      drops: [{ item: 'item_frame', count: 1 }],
      shape: [{ box: FRAME_BOX[FACINGS[i]], tiles: FRAME_TILES }],
      collision: [],
    });
  });
}
