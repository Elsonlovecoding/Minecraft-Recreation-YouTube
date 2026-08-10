// dimensions/stronghold.js — Phase 19: stronghold generation and the end
// portal room. Phase 18 placed the deterministic LOCATION (strongholdCenter
// — the eye-of-ender target); this phase builds the stronghold exactly
// there. ONE stronghold per world, underground, per SPEC: corridors,
// staircases, libraries with bookshelves, storage rooms, all sensibly
// connected in stone brick (with mossy/cracked weathering) and iron bars —
// and exactly one portal room holding the 12-frame end portal ring around
// a lava pool, some frames pre-filled at random.
//
// The layout is a seeded BLUEPRINT of CELL-sized pieces grown from the
// portal room by the dimensions/fortress.js walk (runs of corridor cells,
// staircases shifting the deck a level, junction rooms where arms branch,
// terminal rooms alternating library/storage). Every chunk the stronghold
// touches re-derives the same cached blueprint and writes only its own
// columns, so generation order can never change the world (the caves.js
// discipline). Structural rules mirror the fortress emitter's: pieces only
// link where their decks meet flush, rooms cut doorways toward every
// linked neighbour, staircases are the only place the height changes, and
// support piers descend where a piece crosses carved caves.
//
// The portal room anchors so that strongholdCenter lands on a WALKWAY
// column (STRONGHOLD.ANCHOR) — digging straight down at the eye's signal
// point drops the player beside the portal ring, never into the lava pool.
//
// Runtime (createEndPortal): right-clicking an empty frame with an eye of
// ender fills it; when all 12 hold eyes the 3x3 interior fills with end
// portal blocks; a body falling into the active portal travels to the End.

import { PORTALS, PLAYER, CHUNK, END } from '../config.js';
import { BLOCK } from '../world/blocks.js';
import { mulberry32, hash2, hash01 } from '../world/noise.js';

const SALT_STRONGHOLD = 0x57a06d;
const SALT_BRICK = 0x2b91c4;
const SALT_EYE = 0x66e01d;
const SALT_LOOT = 0x199cad;

const S = PORTALS.STRONGHOLD;
const CELL = S.CELL;
// Cell-local geometry: the corridor strip spans STRIP0..STRIP1 across a
// run (walls on its edge columns, a 3-wide walk between), doorways and the
// walk sit on the centre columns D0..D1, the room wall ring is 0/RING.
const STRIP0 = 3;
const STRIP1 = 7;
const D0 = 4;
const D1 = 6;
const RING = CELL - 1;
// The portal ring: a 5x5 perimeter (minus corners) of frame blocks around
// the 3x3 lava pool, centred in the portal room.
const FRAME0 = 3;
const FRAME1 = 7;
const POOL0 = 4;
const POOL1 = 6;

const DIRS = [
  { dx: 1, dz: 0, axis: 0 },
  { dx: -1, dz: 0, axis: 0 },
  { dx: 0, dz: 1, axis: 1 },
  { dx: 0, dz: -1, axis: 1 },
];

const keyOf = (cx, cz) => `${cx},${cz}`;

// The stronghold's centre column in world coordinates, deterministic per
// seed — the single source of truth thrown eyes of ender fly toward
// (entities/ender_eye.js) and generation anchors to. SPEC: 1000-2000
// blocks from spawn (PORTALS.STRONGHOLD_MIN/MAX_DISTANCE).
export function strongholdCenter(seed) {
  const rng = mulberry32(hash2(seed ^ SALT_STRONGHOLD, 0, 0));
  const angle = rng() * Math.PI * 2;
  const dist = PORTALS.STRONGHOLD_MIN_DISTANCE +
    rng() * (PORTALS.STRONGHOLD_MAX_DISTANCE - PORTALS.STRONGHOLD_MIN_DISTANCE);
  return {
    x: Math.round(PLAYER.SPAWN.X + Math.cos(angle) * dist),
    z: Math.round(PLAYER.SPAWN.Z + Math.sin(angle) * dist),
  };
}

// The deck height a piece presents on its face toward direction d, or null
// when that face doesn't connect (the fortress.js contract): corridors
// reach along their own axis, staircases their low landing on the entry
// face and high landing on the exit face, every room kind on all sides.
function pieceEdgeY(piece, d) {
  if (piece.type === 'stairs') {
    if (d.dx === piece.dir.dx && d.dz === piece.dir.dz) return piece.yOut;
    if (d.dx === -piece.dir.dx && d.dz === -piece.dir.dz) return piece.yIn;
    return null;
  }
  if (piece.type === 'corridor') {
    return piece.axis === (d.dx !== 0 ? 0 : 1) ? piece.y : null;
  }
  return piece.y; // portal / junction / library / storage
}

function linkedAt(cells, cx, cz, d, y) {
  const n = cells.get(keyOf(cx + d.dx, cz + d.dz));
  if (!n) return false;
  return pieceEdgeY(n, { dx: -d.dx, dz: -d.dz }) === y;
}

const ROOMY = new Set(['portal', 'junction', 'library', 'storage']);
export function isRoomType(type) {
  return ROOMY.has(type);
}

export class StrongholdGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    this._blueprint = null;
  }

  // The full deterministic layout: { ox, oz, deckY, cells, frames,
  // portalCells, chests, allPrefilled, bounds }. Cell (cx, cz)'s world min
  // corner is (ox + cx*CELL, oz + cz*CELL); the portal room is cell (0,0).
  blueprint() {
    if (this._blueprint) return this._blueprint;
    const center = strongholdCenter(this.seed);
    // Anchor: strongholdCenter lands on portal-room offset ANCHOR (a
    // walkway column beside the ring — see the header note).
    const ox = center.x - S.ANCHOR.A;
    const oz = center.z - S.ANCHOR.B;
    const deckY = S.BASE_Y;
    const yMin = deckY - S.LEVEL_RANGE;
    const yMax = deckY + S.LEVEL_RANGE;
    const rng = mulberry32(hash2(this.seed ^ SALT_STRONGHOLD, 7, 7));
    const inRadius = (cx, cz) =>
      Math.abs(cx) <= S.MAX_RADIUS_CELLS && Math.abs(cz) <= S.MAX_RADIUS_CELLS;

    const cells = new Map();
    cells.set(keyOf(0, 0), { type: 'portal', axis: 0, y: deckY });
    let pieces = 1;
    const terminals = [];
    let lastRunCell = null;

    // FIFO growth from the portal room, one arm per side in seeded order
    // (the fortress.js walk — every rng roll drawn up-front so the stream
    // stays aligned however the walk plays out).
    const queue = [];
    const order = DIRS.map((d) => ({ d, r: rng() }))
      .sort((a, b) => a.r - b.r)
      .map((e) => e.d);
    for (const d of order) {
      queue.push({ cx: 0, cz: 0, dir: d, depth: 0, y: deckY });
    }

    while (queue.length > 0) {
      const { cx, cz, dir, depth, y } = queue.shift();
      const lenRoll = rng();
      const continueRoll = rng() < S.CONTINUE_CHANCE;
      const stairRoll = rng() < S.STAIR_CHANCE;
      const stairUp = rng() < 0.5;
      const branchRolls = [rng() < S.BRANCH_CHANCE, rng() < S.BRANCH_CHANCE];
      const runLen = S.RUN_MIN_CELLS +
        Math.floor(lenRoll * (S.RUN_MAX_CELLS - S.RUN_MIN_CELLS + 1));

      let x = cx;
      let z = cz;
      let placedLast = null;
      let merged = false;
      let blocked = false;
      for (let i = 0; i < runLen; i++) {
        const nx = x + dir.dx;
        const nz = z + dir.dz;
        if (!inRadius(nx, nz) || pieces >= S.MAX_PIECES) break;
        const nkey = keyOf(nx, nz);
        const existing = cells.get(nkey);
        if (existing) {
          // A corridor merges on its own deck height (a perpendicular
          // same-height arrival upgrades it to a junction — the Phase 18
          // fortress review fix); rooms and stairs answer through faces.
          const isRun = existing.type === 'corridor';
          const edgeY = isRun
            ? existing.y
            : pieceEdgeY(existing, { dx: -dir.dx, dz: -dir.dz });
          if (edgeY === y) {
            if (isRun && existing.axis !== dir.axis) existing.type = 'junction';
            merged = true;
          } else {
            blocked = true;
          }
          break;
        }
        cells.set(nkey, { type: 'corridor', axis: dir.axis, y });
        pieces++;
        x = nx;
        z = nz;
        placedLast = { x, z, key: nkey };
        lastRunCell = placedLast;
      }
      if (!placedLast) continue;
      if (merged) continue;

      let continued = false;
      if (!blocked && continueRoll && depth < S.MAX_DEPTH) {
        const jx = x + dir.dx;
        const jz = z + dir.dz;
        let yNext = stairUp ? y + S.LEVEL_STEP : y - S.LEVEL_STEP;
        if (yNext > yMax || yNext < yMin) {
          yNext = stairUp ? y - S.LEVEL_STEP : y + S.LEVEL_STEP;
        }
        const kx = jx + dir.dx;
        const kz = jz + dir.dz;
        const canStair = stairRoll && yNext >= yMin && yNext <= yMax &&
          inRadius(jx, jz) && inRadius(kx, kz) &&
          !cells.has(keyOf(jx, jz)) && !cells.has(keyOf(kx, kz)) &&
          pieces + 2 <= S.MAX_PIECES;
        if (canStair) {
          cells.set(keyOf(jx, jz), {
            type: 'stairs', axis: dir.axis,
            dir: { dx: dir.dx, dz: dir.dz }, yIn: y, yOut: yNext,
          });
          cells.set(keyOf(kx, kz), { type: 'junction', axis: dir.axis, y: yNext });
          pieces += 2;
          queue.push({ cx: kx, cz: kz, dir, depth: depth + 1, y: yNext });
          const [left, right] = dir.axis === 0
            ? [DIRS[2], DIRS[3]]
            : [DIRS[0], DIRS[1]];
          if (branchRolls[0]) queue.push({ cx: kx, cz: kz, dir: left, depth: depth + 1, y: yNext });
          if (branchRolls[1]) queue.push({ cx: kx, cz: kz, dir: right, depth: depth + 1, y: yNext });
          continued = true;
        } else if (
          inRadius(jx, jz) && !cells.has(keyOf(jx, jz)) && pieces < S.MAX_PIECES
        ) {
          cells.set(keyOf(jx, jz), { type: 'junction', axis: dir.axis, y });
          pieces++;
          queue.push({ cx: jx, cz: jz, dir, depth: depth + 1, y });
          const [left, right] = dir.axis === 0
            ? [DIRS[2], DIRS[3]]
            : [DIRS[0], DIRS[1]];
          if (branchRolls[0]) queue.push({ cx: jx, cz: jz, dir: left, depth: depth + 1, y });
          if (branchRolls[1]) queue.push({ cx: jx, cz: jz, dir: right, depth: depth + 1, y });
          continued = true;
        }
      }
      if (!continued) {
        cells.get(placedLast.key).type = 'room';
        terminals.push(placedLast.key);
      }
    }

    // A junction whose queued continuations all aborted would dead-end;
    // cap any with at most one link as a terminal room (the fortress rule —
    // deterministic, no rng, link counts unaffected by the conversion).
    for (const [ckey, piece] of cells) {
      if (piece.type !== 'junction') continue;
      const [cx, cz] = ckey.split(',').map(Number);
      let links = 0;
      for (const d of DIRS) {
        if (linkedAt(cells, cx, cz, d, piece.y)) links++;
      }
      if (links <= 1) {
        piece.type = 'room';
        terminals.push(ckey);
      }
    }

    // Terminal roles alternate library / storage (SPEC lists both).
    if (terminals.length === 0 && lastRunCell) terminals.push(lastRunCell.key);
    for (let i = 0; i < terminals.length; i++) {
      cells.get(terminals[i]).type = i % 2 === 0 ? 'library' : 'storage';
    }

    // The portal ring's 12 frame positions (world coords, one block above
    // the deck), each with its deterministic pre-fill roll, plus the 3x3
    // portal interior above the lava pool and every storage chest.
    const frames = [];
    let allPrefilled = true;
    for (let b = FRAME0; b <= FRAME1; b++) {
      for (let a = FRAME0; a <= FRAME1; a++) {
        const edgeA = a === FRAME0 || a === FRAME1;
        const edgeB = b === FRAME0 || b === FRAME1;
        if (!edgeA && !edgeB) continue;
        if (edgeA && edgeB) continue; // corners stay open
        const x = ox + a;
        const z = oz + b;
        const filled =
          hash01(this.seed ^ SALT_EYE, x, z) < S.FRAME_PREFILL_CHANCE;
        if (!filled) allPrefilled = false;
        frames.push({ x, y: deckY + 1, z, filled });
      }
    }
    const portalCells = [];
    for (let b = POOL0; b <= POOL1; b++) {
      for (let a = POOL0; a <= POOL1; a++) {
        portalCells.push({ x: ox + a, y: deckY + 1, z: oz + b });
      }
    }
    const chests = [];
    for (const [ckey, piece] of cells) {
      if (piece.type !== 'storage') continue;
      const [cx, cz] = ckey.split(',').map(Number);
      const px0 = ox + cx * CELL;
      const pz0 = oz + cz * CELL;
      for (const [a, b] of [[4, 1], [6, 1], [8, 8]]) {
        chests.push({ x: px0 + a, y: piece.y + 1, z: pz0 + b });
      }
    }

    const r = S.MAX_RADIUS_CELLS;
    this._blueprint = {
      ox, oz, deckY, cells, frames, portalCells, chests, allPrefilled,
      bounds: {
        x0: ox - r * CELL, x1: ox + (r + 1) * CELL - 1,
        z0: oz - r * CELL, z1: oz + (r + 1) * CELL - 1,
      },
    };
    return this._blueprint;
  }

  // A convenient teleport/test point: the anchor column on the portal
  // room's walkway, one block above the deck floor.
  entryPoint() {
    const bp = this.blueprint();
    const center = strongholdCenter(this.seed);
    return { x: center.x + 0.5, y: bp.deckY + 1, z: center.z + 0.5 };
  }

  // Deterministic loot for a generated stronghold chest at (x, y, z), or
  // null when no chest generates there (world/chests.js consults this when
  // its chunk scan discovers a generated chest). Stronghold-flavoured:
  // bread, iron, coal, the occasional pearl/book/apple.
  lootFor(x, y, z) {
    const bp = this.blueprint();
    if (!bp.chests.some((c) => c.x === x && c.y === y && c.z === z)) return null;
    const rng = mulberry32(hash2(this.seed ^ SALT_LOOT, x, z) ^ (y | 0));
    const loot = [];
    const roll = (name, chance, min, max) => {
      if (rng() < chance) {
        loot.push({ name, count: min + Math.floor(rng() * (max - min + 1)) });
      } else {
        rng(); // keep the stream aligned whatever the rolls decide
      }
    };
    roll('bread', 0.9, 1, 3);
    roll('iron_ingot', 0.7, 1, 3);
    roll('coal', 0.6, 2, 5);
    roll('apple', 0.5, 1, 2);
    roll('ender_pearl', 0.3, 1, 1);
    roll('book', 0.4, 1, 2);
    roll('torch', 0.5, 2, 6);
    return loot;
  }

  // --- chunk emission -------------------------------------------------------

  emitChunk(chunk) {
    const size = CHUNK.SIZE;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;
    // One stronghold per world: a cheap bounding-box early-out keeps every
    // other chunk's generation untouched. The blueprint is only derived
    // once a chunk actually inside the (deterministic) bounds generates.
    const center = strongholdCenter(this.seed);
    const reach = (S.MAX_RADIUS_CELLS + 1) * CELL;
    if (
      x0 + size - 1 < center.x - reach || x0 > center.x + reach ||
      z0 + size - 1 < center.z - reach || z0 > center.z + reach
    ) {
      return;
    }
    const bp = this.blueprint();
    for (const [key, piece] of bp.cells) {
      const [cx, cz] = key.split(',').map(Number);
      const px0 = bp.ox + cx * CELL;
      const pz0 = bp.oz + cz * CELL;
      const lo0 = Math.max(px0, x0);
      const lo1 = Math.min(px0 + CELL - 1, x0 + size - 1);
      const lz0 = Math.max(pz0, z0);
      const lz1 = Math.min(pz0 + CELL - 1, z0 + size - 1);
      if (lo0 > lo1 || lz0 > lz1) continue;
      for (let wx = lo0; wx <= lo1; wx++) {
        for (let wz = lz0; wz <= lz1; wz++) {
          this._emitColumn(
            chunk, bp, piece, cx, cz,
            wx - x0, wz - z0, wx - px0, wz - pz0, wx, wz,
          );
        }
      }
    }
  }

  // Weathered stone brick: mossy/cracked variants rolled per block position
  // (SPEC: "stone brick with mossy and cracked variants").
  _brick(wx, y, wz) {
    const r = hash01(this.seed ^ SALT_BRICK ^ (y * 0x9e37), wx, wz);
    if (r < S.MOSSY_CHANCE) return BLOCK.MOSSY_STONE_BRICKS;
    if (r < S.MOSSY_CHANCE + S.CRACKED_CHANCE) return BLOCK.CRACKED_STONE_BRICKS;
    return BLOCK.STONE_BRICKS;
  }

  // A support pier descending through carved caves until it finds ground
  // (bounded) — underground pieces crossing caverns must not float.
  _pier(chunk, lx, lz, startY, wx, wz) {
    const floor = startY - S.PIER_MAX_DROP;
    for (let y = startY; y >= floor; y--) {
      const id = chunk.get(lx, y, lz);
      if (id !== BLOCK.AIR && id !== BLOCK.WATER && id !== BLOCK.LAVA) break;
      chunk.set(lx, y, lz, this._brick(wx, y, wz));
    }
  }

  _emitColumn(chunk, bp, piece, cx, cz, lx, lz, a, b, wx, wz) {
    const set = (yy, id) => chunk.set(lx, yy, lz, id);
    const brickAt = (yy) => this._brick(wx, yy, wz);
    const clear = (y0, y1) => {
      for (let yy = y0; yy <= y1; yy++) set(yy, BLOCK.AIR);
    };
    const wallUp = (y0, y1) => {
      for (let yy = y0; yy <= y1; yy++) set(yy, brickAt(yy));
    };

    if (piece.type === 'corridor' || piece.type === 'stairs') {
      const v = piece.axis === 0 ? b : a; // across the run
      let u = piece.axis === 0 ? a : b;   // along the run
      if (v < STRIP0 || v > STRIP1) return;
      let y = piece.y;
      if (piece.type === 'stairs') {
        // 1-block steps between the two landings, climbing the LEVEL_STEP
        // across the cell along the travel direction.
        if (piece.dir.dx + piece.dir.dz < 0) u = RING - u;
        const rise = piece.yOut - piece.yIn;
        y = piece.yIn + Math.sign(rise) *
          Math.min(Math.abs(rise), Math.floor((u * (Math.abs(rise) + 1)) / CELL));
      }
      set(y, brickAt(y));
      const H = S.CORRIDOR_HEIGHT;
      if (v === STRIP0 || v === STRIP1) {
        wallUp(y + 1, y + H);
      } else {
        clear(y + 1, y + H);
        // A torch along the wall side of the walk every few columns.
        if (piece.type === 'corridor' && v === D0 && u % S.TORCH_EVERY === 2) {
          set(y + 1, BLOCK.TORCH);
        }
      }
      set(y + H + 1, brickAt(y + H + 1)); // roof
      if (v === D0 + 1 && u % 3 === 1) this._pier(chunk, lx, lz, y - 1, wx, wz);
      return;
    }

    // Rooms — portal / junction / library / storage: a walled ring with
    // doorways toward every linked neighbour, a full floor and roof, and
    // the type's furniture inside.
    const y = piece.y;
    const H = piece.type === 'portal' ? S.PORTAL_ROOM_HEIGHT : S.ROOM_HEIGHT;
    const ring = a === 0 || a === RING || b === 0 || b === RING;
    set(y, brickAt(y)); // floor (the portal pool overrides below)
    if ((a === 1 || a === RING - 1) && (b === 1 || b === RING - 1)) {
      this._pier(chunk, lx, lz, y - 1, wx, wz);
    }
    if (ring) {
      wallUp(y + 1, y + H);
      // Barred niches in the portal room's walls (SPEC lists iron bars).
      if (piece.type === 'portal') {
        const niche =
          ((a === 0 || a === RING) && (b === 2 || b === RING - 2)) ||
          ((b === 0 || b === RING) && (a === 2 || a === RING - 2));
        if (niche) {
          set(y + 2, BLOCK.IRON_BARS);
          set(y + 3, BLOCK.IRON_BARS);
        }
      }
      // Doorways toward linked neighbours, on the centre columns.
      for (const d of DIRS) {
        const onSide = d.dx === 1 ? a === RING
          : d.dx === -1 ? a === 0
          : d.dz === 1 ? b === RING
          : b === 0;
        const centred = d.axis === 0 ? (b >= D0 && b <= D1) : (a >= D0 && a <= D1);
        if (onSide && centred && linkedAt(bp.cells, cx, cz, d, y)) {
          clear(y + 1, y + S.DOOR_HEIGHT);
        }
      }
      set(y + H + 1, brickAt(y + H + 1)); // roof edge
      return;
    }
    clear(y + 1, y + H);
    set(y + H + 1, brickAt(y + H + 1)); // roof

    if (piece.type === 'portal') {
      const inPool = a >= POOL0 && a <= POOL1 && b >= POOL0 && b <= POOL1;
      const edgeA = a === FRAME0 || a === FRAME1;
      const edgeB = b === FRAME0 || b === FRAME1;
      const onRing = (edgeA || edgeB) && !(edgeA && edgeB) &&
        a >= FRAME0 && a <= FRAME1 && b >= FRAME0 && b <= FRAME1;
      if (inPool) {
        // The lava pool the ring surrounds (SPEC), sealed underneath; the
        // portal sheet appears one block above it when the ring completes.
        set(y - 1, brickAt(y - 1));
        set(y, BLOCK.LAVA);
        if (bp.allPrefilled) set(y + 1, BLOCK.END_PORTAL);
      } else if (onRing) {
        const filled = hash01(this.seed ^ SALT_EYE, wx, wz) < S.FRAME_PREFILL_CHANCE;
        set(y + 1, filled ? BLOCK.END_PORTAL_FRAME_EYE : BLOCK.END_PORTAL_FRAME);
      } else if ((a === 1 || a === RING - 1) && (b === 1 || b === RING - 1)) {
        set(y + 1, BLOCK.TORCH); // walkway corner torches
      }
      return;
    }
    if (piece.type === 'library') {
      // Bookshelf-lined walls (gaps clear of the door approaches) and a
      // low central double row — the vanilla library read.
      const wallShelf =
        ((a === 1 || a === RING - 1) && (b <= 3 || b >= RING - 3)) ||
        ((b === 1 || b === RING - 1) && (a <= 3 || a >= RING - 3));
      if (wallShelf) {
        for (let yy = y + 1; yy <= y + 3; yy++) set(yy, BLOCK.BOOKSHELF);
        if ((a === 1 || a === RING - 1) && (b === 1 || b === RING - 1)) {
          set(y + 4, BLOCK.TORCH); // corner torches atop the shelves
        }
      } else if (a === 5 && (b === 2 || b === 3 || b === RING - 3 || b === RING - 2)) {
        set(y + 1, BLOCK.BOOKSHELF);
        set(y + 2, BLOCK.BOOKSHELF);
      }
      return;
    }
    if (piece.type === 'storage') {
      // Chests along the north wall, crates, and a barred stock cell in
      // the corner holding the third chest (the iron-bar use SPEC lists).
      if (b === 1 && (a === 4 || a === 6)) set(y + 1, BLOCK.CHEST);
      if (a === 1 && (b === RING - 3 || b === RING - 2)) set(y + 1, BLOCK.OAK_PLANKS);
      if (a === 2 && b === RING - 2) set(y + 1, BLOCK.COBBLESTONE);
      if (a === 6 && b >= 6 && b <= RING - 1 && b !== 8) {
        for (let yy = y + 1; yy <= y + 3; yy++) set(yy, BLOCK.IRON_BARS);
      }
      if (a === 8 && b === 8) set(y + 1, BLOCK.CHEST);
      if (a === 5 && b === 5) set(y + 1, BLOCK.TORCH);
      return;
    }
    // Junction (and the brief pre-role 'room'): plain, lit.
    if (a === 5 && b === 5) set(y + 1, BLOCK.TORCH);
  }
}

// ---------------------------------------------------------------------------
// Runtime: filling frames, activating the portal, travelling to the End
// ---------------------------------------------------------------------------

// `generator` is a StrongholdGenerator for the world seed (main.js makes
// its own — the blueprint is deterministic, so it always agrees with the
// terrain pass). Travel mirrors dimensions/portals.js: switch, teleport,
// prebuild the arrival area before the next frame.
export function createEndPortal({ world, player, camera, dimensions, generator }) {
  // Right-click with an eye of ender on an empty frame (wired through
  // player/interaction.js -> main.js). Returns true when the eye goes in —
  // the caller consumes the item.
  function fillFrame(target) {
    if (dimensions.activeKey !== 'overworld') return false;
    if (world.getBlock(target.x, target.y, target.z) !== BLOCK.END_PORTAL_FRAME) {
      return false;
    }
    world.setBlock(target.x, target.y, target.z, BLOCK.END_PORTAL_FRAME_EYE);
    checkActivation();
    return true;
  }

  // All 12 frames filled -> the 3x3 interior becomes end portal (SPEC).
  function checkActivation() {
    const bp = generator.blueprint();
    for (const f of bp.frames) {
      if (world.getBlock(f.x, f.y, f.z) !== BLOCK.END_PORTAL_FRAME_EYE) return false;
    }
    for (const c of bp.portalCells) {
      if (world.getBlock(c.x, c.y, c.z) !== BLOCK.END_PORTAL) {
        world.setBlock(c.x, c.y, c.z, BLOCK.END_PORTAL);
      }
    }
    return true;
  }

  // Falling into the active portal transports to the End (SPEC): the End
  // becomes the live dimension and the player arrives on the obsidian
  // platform at the island's edge.
  function travel() {
    const body = player.body;
    const p = body.position;
    dimensions.switchTo('end');
    p.x = END.PLATFORM.X + 0.5;
    p.y = END.ISLAND_TOP_Y + 1;
    p.z = END.PLATFORM.Z + 0.5;
    body.velocity.x = 0;
    body.velocity.y = 0;
    body.velocity.z = 0;
    body.fallDistance = 0;
    camera.position.set(p.x, p.y + PLAYER.EYE_HEIGHT, p.z);
    world.prebuild(p);
  }

  function update() {
    if (dimensions.activeKey !== 'overworld') return;
    const p = player.body.position;
    // The feet cell or the body's midriff touching an end portal block
    // triggers the trip (the portal sheet is non-solid — a body falling
    // through the ring crosses its cell within a frame).
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    if (
      world.getBlock(x, Math.floor(p.y + 0.05), z) === BLOCK.END_PORTAL ||
      world.getBlock(x, Math.floor(p.y + 0.9), z) === BLOCK.END_PORTAL
    ) {
      travel();
    }
  }

  return { fillFrame, checkActivation, update };
}
