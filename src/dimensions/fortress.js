// dimensions/fortress.js — Phase 17: nether fortresses; Phase 18: grown to
// the real sprawling scale. One fortress per NETHER.FORTRESS.REGION_CHUNKS²
// chunk region, always. The layout is a region-seeded BLUEPRINT: pieces on
// a CELL-sized grid — an enclosed KEEP of interconnected roofed rooms
// around the central blaze-spawner heart, long straight bridge runs (dozens
// of cells — the classic spans over the lava ocean), walled corridors,
// crossings where arms branch, STAIRCASE galleries that shift whole arms up
// or down a deck level, and terminal rooms (tall crenellated blaze towers
// and wart gardens) — grown by a bounded, fully deterministic walk. Every
// chunk the fortress touches re-derives the same blueprint (cached per
// region) and emits only its own columns, so generation order can never
// change the world (the caves.js discipline).
//
// Structural rules the emitter guarantees (the session requirements):
//   - every piece is connected: runs start at the keep and either end in a
//     room, merge into an existing piece AT THE SAME DECK HEIGHT (a
//     misaligned merge upgrades that piece to a crossing so the junction
//     genuinely joins; a height-mismatched arrival caps itself with a room
//     instead), or branch at a crossing — there are no isolated fragments;
//   - rooms cut doorways toward every neighbouring piece that connects back
//     at their height, so no room is sealed (keep rooms interconnect the
//     same way — the keep is a walkable warren of rooms and corridors);
//   - decks meet flush WITHIN a level: pieces carry their own deck y, and
//     two pieces only ever link when their meeting edges agree on it;
//     staircase pieces are the only place the height changes — 1-block
//     steps between two landings, walled and roofed;
//   - support piers descend from bridges, crossings, stairs and room
//     corners until they find ground (or stand a few blocks into the lava
//     sea) — nothing reads as floating.
//
// Pieces carve their interiors (air) through whatever terrain is there —
// embedded sections read as brick galleries, open-cavern sections as the
// classic bridges over the lava ocean far below.

import { NETHER, CHUNK } from '../config.js';
import { BLOCK } from '../world/blocks.js';
import { mulberry32, hash2 } from '../world/noise.js';

const F = NETHER.FORTRESS;
const CELL = F.CELL;

// Cell-local geometry offsets, derived from CELL (8): the deck strip spans
// A0..A1 across a run (railings/walls on its edge columns, the walk
// between), doorways sit on the two centre columns.
const A0 = CELL / 2 - 3;          // 1 — deck strip min offset
const A1 = CELL / 2 + 2;          // 6 — deck strip max offset
const D0 = CELL / 2 - 1;          // 3 — doorway min offset
const D1 = CELL / 2;              // 4 — doorway max offset
const RING_MAX = CELL - 1;        // 7 — room wall ring offsets are 0 and this

const SALT_FORTRESS = 0x4f027a;

const DIRS = [
  { dx: 1, dz: 0, axis: 0 },
  { dx: -1, dz: 0, axis: 0 },
  { dx: 0, dz: 1, axis: 1 },
  { dx: 0, dz: -1, axis: 1 },
];

const keyOf = (cx, cz) => `${cx},${cz}`;
const ROOMY = new Set(['room', 'hall', 'blaze', 'wart']);

// The deck height a piece presents on its face toward direction `d`, or
// null when that face doesn't connect at all. Bridges and corridors reach
// out only along their own axis; crossings and rooms toward any side; a
// staircase presents its LOW landing on the face it was entered from and
// its HIGH landing on the face it exits through (its own axis only).
function pieceEdgeY(piece, d) {
  if (piece.type === 'stairs') {
    if (d.dx === piece.dir.dx && d.dz === piece.dir.dz) return piece.yOut;
    if (d.dx === -piece.dir.dx && d.dz === -piece.dir.dz) return piece.yIn;
    return null;
  }
  if (piece.type === 'bridge' || piece.type === 'corridor') {
    // The axis is derived from the direction itself, so bare {dx, dz}
    // callers (negated directions) resolve correctly too.
    return piece.axis === (d.dx !== 0 ? 0 : 1) ? piece.y : null;
  }
  return piece.y; // crossings and every room kind connect on all sides
}

export class FortressGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    this._blueprints = new Map(); // "rx,rz" -> blueprint
  }

  // --- the blueprint --------------------------------------------------------

  // The full deterministic layout for a region: { ox, oz, deckY, cells }
  // where cells maps "cx,cz" (cell coords, heart at 0,0) to
  // { type: 'bridge'|'corridor'|'crossing'|'stairs'|'hall'|'blaze'|'wart',
  //   axis, y } (stairs carry { dir, yIn, yOut } instead of y).
  blueprint(rx, rz) {
    const key = keyOf(rx, rz);
    const cached = this._blueprints.get(key);
    if (cached) return cached;

    const rng = mulberry32(hash2(this.seed ^ SALT_FORTRESS, rx, rz));
    const regionBlocks = F.REGION_CHUNKS * CHUNK.SIZE;
    const jitter = () => Math.floor((rng() * 2 - 1) * F.ORIGIN_JITTER);
    // The heart cell's min corner, centred on the jittered point. The
    // extent cap (MAX_RADIUS_CELLS) plus the jitter stays strictly inside
    // the region, so a chunk only ever consults its OWN region's fortress.
    const ox = rx * regionBlocks + (regionBlocks >> 1) + jitter() - (CELL >> 1);
    const oz = rz * regionBlocks + (regionBlocks >> 1) + jitter() - (CELL >> 1);
    const deckY = F.DECK_MIN_Y +
      Math.floor(rng() * (F.DECK_MAX_Y - F.DECK_MIN_Y + 1));
    const yMin = deckY - F.LEVEL_RANGE;
    const yMax = deckY + F.LEVEL_RANGE;
    const inRadius = (cx, cz) =>
      Math.abs(cx) <= F.MAX_RADIUS_CELLS && Math.abs(cz) <= F.MAX_RADIUS_CELLS;

    const cells = new Map();
    // The KEEP (Phase 18): a (2K+1)² block of roofed rooms around the
    // heart, all at the base deck height — the enclosed interior section.
    // The centre is the blaze-spawner heart; the rest are halls. Adjacent
    // rooms cut doorways toward each other at emission (rooms connect on
    // every side), so the whole keep is walkable inside.
    const K = F.KEEP_RADIUS_CELLS;
    for (let cz = -K; cz <= K; cz++) {
      for (let cx = -K; cx <= K; cx++) {
        cells.set(keyOf(cx, cz), {
          type: cx === 0 && cz === 0 ? 'blaze' : 'hall', axis: 0, y: deckY,
        });
      }
    }
    let pieces = (2 * K + 1) * (2 * K + 1);
    const terminals = [];
    let lastRunCell = null; // farthest run cell — the no-terminal fallback

    // FIFO growth queue: arms spread evenly instead of one arm eating the
    // whole budget. Every entry grows one straight run from `cx,cz` along
    // `dir` at deck height `y`, then ends it (staircase + crossing /
    // crossing / terminal room / flush merge).
    const queue = [];
    // The keep sprouts one arm per side, in seeded order, from the
    // edge-centre rooms.
    const order = DIRS.map((d) => ({ d, r: rng() }))
      .sort((a, b) => a.r - b.r)
      .map((e) => e.d);
    for (const d of order) {
      queue.push({ cx: d.dx * K, cz: d.dz * K, dir: d, depth: 0, y: deckY });
    }

    while (queue.length > 0) {
      const { cx, cz, dir, depth, y } = queue.shift();
      // Every roll for this entry is drawn up-front, unconditionally, so
      // the rng stream stays aligned however the walk plays out.
      const corridor = rng() < F.CORRIDOR_CHANCE;
      const lenRoll = rng();
      const continueRoll = rng() < F.CONTINUE_CHANCE;
      const stairRoll = rng() < F.STAIR_CHANCE;
      const stairUp = rng() < 0.5;
      const branchRolls = [rng() < F.BRANCH_CHANCE, rng() < F.BRANCH_CHANCE];
      const [minL, maxL] = corridor
        ? [F.CORRIDOR_MIN_CELLS, F.CORRIDOR_MAX_CELLS]
        : [F.BRIDGE_MIN_CELLS, F.BRIDGE_MAX_CELLS];
      const runLen = minL + Math.floor(lenRoll * (maxL - minL + 1));

      let x = cx;
      let z = cz;
      let placedLast = null;
      let merged = false;
      let blocked = false; // hit an existing piece that could NOT merge
      for (let i = 0; i < runLen; i++) {
        const nx = x + dir.dx;
        const nz = z + dir.dz;
        if (!inRadius(nx, nz) || pieces >= F.MAX_PIECES) break;
        const nkey = keyOf(nx, nz);
        const existing = cells.get(nkey);
        if (existing) {
          // The run reached an existing piece. A genuine junction needs the
          // decks to meet FLUSH: the piece must present our height where we
          // arrive. For a bridge/corridor that means its OWN deck height,
          // not pieceEdgeY — a side face reaches nowhere (null), which is
          // exactly the misaligned case Phase 17 upgraded to a crossing, so
          // asking the face would make the upgrade unreachable (review
          // finding: every perpendicular arrival blocked instead, capping a
          // dead-end room against the bridge's flank with no doorway).
          // A crossing's arms resolve per neighbour at emission, so the
          // upgrade genuinely joins the two runs. Rooms/crossings/stairs
          // still answer through their faces; any height mismatch blocks
          // the run (its last cell gets capped with a room below).
          const isRun = existing.type === 'bridge' || existing.type === 'corridor';
          const edgeY = isRun
            ? existing.y
            : pieceEdgeY(existing, { dx: -dir.dx, dz: -dir.dz });
          if (edgeY === y) {
            if (isRun && existing.axis !== dir.axis) existing.type = 'crossing';
            merged = true;
          } else {
            blocked = true;
          }
          break;
        }
        cells.set(nkey, {
          type: corridor ? 'corridor' : 'bridge', axis: dir.axis, y,
        });
        pieces++;
        x = nx;
        z = nz;
        placedLast = { x, z, key: nkey };
        lastRunCell = placedLast;
      }
      if (!placedLast) continue;
      if (merged) continue;

      // End the run. Unless it was blocked by a foreign-height piece, it
      // may continue: optionally through a staircase gallery (the deck
      // level shifts by LEVEL_STEP) into a crossing, else a crossing at
      // this height — and maybe branches. Otherwise it terminates in a
      // room, so no arm ever dead-ends into open air.
      let continued = false;
      if (!blocked && continueRoll && depth < F.MAX_DEPTH) {
        const jx = x + dir.dx;
        const jz = z + dir.dz;
        // The staircase wants its own cell plus the junction cell after it.
        let yNext = stairUp ? y + F.LEVEL_STEP : y - F.LEVEL_STEP;
        if (yNext > yMax || yNext < yMin) yNext = stairUp ? y - F.LEVEL_STEP : y + F.LEVEL_STEP;
        const kx = jx + dir.dx;
        const kz = jz + dir.dz;
        const canStair = stairRoll && yNext >= yMin && yNext <= yMax &&
          inRadius(jx, jz) && inRadius(kx, kz) &&
          !cells.has(keyOf(jx, jz)) && !cells.has(keyOf(kx, kz)) &&
          pieces + 2 <= F.MAX_PIECES;
        if (canStair) {
          cells.set(keyOf(jx, jz), {
            type: 'stairs', axis: dir.axis,
            dir: { dx: dir.dx, dz: dir.dz }, yIn: y, yOut: yNext,
          });
          cells.set(keyOf(kx, kz), { type: 'crossing', axis: dir.axis, y: yNext });
          pieces += 2;
          queue.push({ cx: kx, cz: kz, dir, depth: depth + 1, y: yNext });
          const [left, right] = dir.axis === 0
            ? [DIRS[2], DIRS[3]]
            : [DIRS[0], DIRS[1]];
          if (branchRolls[0]) queue.push({ cx: kx, cz: kz, dir: left, depth: depth + 1, y: yNext });
          if (branchRolls[1]) queue.push({ cx: kx, cz: kz, dir: right, depth: depth + 1, y: yNext });
          continued = true;
        } else if (
          inRadius(jx, jz) && !cells.has(keyOf(jx, jz)) && pieces < F.MAX_PIECES
        ) {
          cells.set(keyOf(jx, jz), { type: 'crossing', axis: dir.axis, y });
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
        // Terminal: the run's last cell becomes a room (role assigned
        // below), so no arm ever dead-ends into open air.
        cells.get(placedLast.key).type = 'room';
        terminals.push(placedLast.key);
      }
    }

    // A crossing whose queued continuations all aborted (budget or radius
    // exhausted before they dequeued) would be a railed balcony to nowhere
    // — cap every crossing with at most one linked neighbour as a terminal
    // room instead, so every arm genuinely ends in a room. Deterministic:
    // Map iteration is insertion order, the check uses no rng, and a
    // conversion never changes any other cell's link count (rooms connect
    // back on every side at their height, exactly like crossings).
    for (const [ckey, piece] of cells) {
      if (piece.type !== 'crossing') continue;
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

    // Terminal roles: the heart is already a blaze room, so the wart room
    // comes first, then alternate. Growth always yields at least one
    // terminal (the very first arm can neither merge nor be blocked), but
    // guard anyway: fall back to converting the farthest run cell.
    if (terminals.length === 0 && lastRunCell) {
      cells.get(lastRunCell.key).type = 'wart';
    }
    for (let i = 0; i < terminals.length; i++) {
      cells.get(terminals[i]).type = i % 2 === 0 ? 'wart' : 'blaze';
    }

    const bp = { rx, rz, ox, oz, deckY, cells };
    this._blueprints.set(key, bp);
    return bp;
  }

  // World-space centre of a region's fortress heart (tests/tooling — e.g.
  // teleporting straight to the nearest fortress).
  heartOf(rx, rz) {
    const bp = this.blueprint(rx, rz);
    return {
      x: bp.ox + (CELL >> 1),
      y: bp.deckY + 1,
      z: bp.oz + (CELL >> 1),
    };
  }

  // --- chunk emission -------------------------------------------------------

  emitChunk(chunk) {
    const size = CHUNK.SIZE;
    const rc = F.REGION_CHUNKS;
    const bp = this.blueprint(
      Math.floor(chunk.cx / rc), Math.floor(chunk.cz / rc),
    );
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;
    for (const [key, piece] of bp.cells) {
      const [cx, cz] = key.split(',').map(Number);
      const px0 = bp.ox + cx * CELL;
      const pz0 = bp.oz + cz * CELL;
      // Clip the piece's footprint to this chunk; skip non-intersecting.
      const lo0 = Math.max(px0, x0);
      const lo1 = Math.min(px0 + CELL - 1, x0 + size - 1);
      const lz0 = Math.max(pz0, z0);
      const lz1 = Math.min(pz0 + CELL - 1, z0 + size - 1);
      if (lo0 > lo1 || lz0 > lz1) continue;
      for (let wx = lo0; wx <= lo1; wx++) {
        for (let wz = lz0; wz <= lz1; wz++) {
          this._emitColumn(
            chunk, bp, piece, cx, cz,
            wx - x0, wz - z0, wx - px0, wz - pz0,
          );
        }
      }
    }
  }

  // Neighbour connectivity for a piece: does the piece in direction d exist
  // and reach back toward this cell AT deck height y?
  _linked(bp, cx, cz, d, y) {
    return linkedAt(bp.cells, cx, cz, d, y);
  }

  // One column (a, b = offsets 0..CELL-1 within the piece) of one piece,
  // written into the owning chunk at chunk-local lx/lz.
  _emitColumn(chunk, bp, piece, cx, cz, lx, lz, a, b) {
    const B = BLOCK.NETHER_BRICKS;
    const set = (yy, id) => chunk.set(lx, yy, lz, id);
    const clear = (y0, y1) => {
      for (let yy = y0; yy <= y1; yy++) set(yy, BLOCK.AIR);
    };

    if (piece.type === 'bridge' || piece.type === 'corridor') {
      const y = piece.y;
      const v = piece.axis === 0 ? b : a; // across the run
      const u = piece.axis === 0 ? a : b; // along the run
      if (v < A0 || v > A1) return;
      set(y, B); // the deck
      const edge = v === A0 || v === A1;
      if (piece.type === 'corridor') {
        if (edge) {
          // Wall with window slits every few columns.
          for (let yy = y + 1; yy <= y + F.CLEAR_HEIGHT; yy++) set(yy, B);
          if (u % F.WINDOW_EVERY === 1) clear(y + 2, y + 3);
        } else {
          clear(y + 1, y + F.CLEAR_HEIGHT);
        }
        set(y + F.CLEAR_HEIGHT + 1, B); // roof
      } else if (edge) {
        set(y + 1, B); // railing
        clear(y + 2, y + F.CLEAR_HEIGHT);
      } else {
        clear(y + 1, y + F.CLEAR_HEIGHT);
      }
      // Support piers under every other cell of a run (2x2 at the centre).
      if (
        (cx + cz) % 2 === 0 &&
        (a === D0 || a === D1) && (b === D0 || b === D1)
      ) {
        this._pier(chunk, lx, lz, y - 1);
      }
      return;
    }

    if (piece.type === 'stairs') {
      // A staircase gallery (Phase 18): 1-block steps between two landings,
      // walled and roofed, climbing LEVEL_STEP blocks across the cell along
      // its travel direction. u runs 0 (the low, entry landing) to CELL-1
      // (the high, exit landing) in the travel direction.
      const v = piece.axis === 0 ? b : a; // across the stair
      let u = piece.axis === 0 ? a : b;   // along the travel direction
      if (piece.dir.dx + piece.dir.dz < 0) u = RING_MAX - u;
      if (v < A0 || v > A1) return;
      // Landing at u=0 (yIn), one step per column, landing again at the
      // far end once the full rise is climbed — works for both signs.
      const rise = piece.yOut - piece.yIn;
      const yDeck = piece.yIn + Math.sign(rise) *
        Math.min(Math.abs(rise), Math.max(0, u));
      set(yDeck, B);
      const edge = v === A0 || v === A1;
      if (edge) {
        for (let yy = yDeck + 1; yy <= yDeck + F.CLEAR_HEIGHT; yy++) set(yy, B);
      } else {
        clear(yDeck + 1, yDeck + F.CLEAR_HEIGHT);
      }
      set(yDeck + F.CLEAR_HEIGHT + 1, B); // stepped roof follows the climb
      if ((a === D0 || a === D1) && (b === D0 || b === D1)) {
        this._pier(chunk, lx, lz, yDeck - 1);
      }
      return;
    }

    if (piece.type === 'crossing') {
      const y = piece.y;
      // The deck footprint: the centre square plus an arm strip toward each
      // connected neighbour. Railings ring the footprint boundary (walk
      // columns continue into connected neighbours' decks flush).
      const arms = DIRS.map((d) => this._linked(bp, cx, cz, d, y));
      const deckAt = (aa, bb) => {
        if (aa < 0) return arms[1] ? bb >= A0 && bb <= A1 : false;
        if (aa >= CELL) return arms[0] ? bb >= A0 && bb <= A1 : false;
        if (bb < 0) return arms[3] ? aa >= A0 && aa <= A1 : false;
        if (bb >= CELL) return arms[2] ? aa >= A0 && aa <= A1 : false;
        const inA = aa >= A0 && aa <= A1;
        const inB = bb >= A0 && bb <= A1;
        if (inA && inB) return true;                      // centre square
        if (inB && (aa < A0 ? arms[1] : arms[0])) return true; // x arms
        if (inA && (bb < A0 ? arms[3] : arms[2])) return true; // z arms
        return false;
      };
      if (!deckAt(a, b)) return;
      set(y, B);
      const railing =
        !deckAt(a - 1, b) || !deckAt(a + 1, b) ||
        !deckAt(a, b - 1) || !deckAt(a, b + 1);
      if (railing) {
        set(y + 1, B);
        clear(y + 2, y + F.CLEAR_HEIGHT);
      } else {
        clear(y + 1, y + F.CLEAR_HEIGHT);
      }
      if ((a === D0 || a === D1) && (b === D0 || b === D1)) {
        this._pier(chunk, lx, lz, y - 1);
      }
      return;
    }

    // Rooms: the keep's halls and heart, and terminals ('blaze' spawner
    // tower — Phase 18: tall, crenellated — and roofed 'wart' gardens).
    const y = piece.y;
    const blazeRoom = piece.type === 'blaze';
    const wallTop = y + (blazeRoom ? F.TOWER_WALL_HEIGHT : F.WALL_HEIGHT);
    const ring = a === 0 || a === RING_MAX || b === 0 || b === RING_MAX;
    set(y, B); // full floor
    // Corner piers carry the room (the innermost deck-strip corners).
    if ((a === A0 || a === A1) && (b === A0 || b === A1)) {
      this._pier(chunk, lx, lz, y - 1);
    }
    if (ring) {
      for (let yy = y + 1; yy <= wallTop; yy++) set(yy, B);
      // Doorways toward every connected neighbour, on the centre columns.
      for (const d of DIRS) {
        const onSide = d.dx === 1 ? a === RING_MAX
          : d.dx === -1 ? a === 0
          : d.dz === 1 ? b === RING_MAX
          : b === 0;
        const centred = d.axis === 0 ? (b === D0 || b === D1) : (a === D0 || a === D1);
        if (onSide && centred && this._linked(bp, cx, cz, d, y)) {
          clear(y + 1, y + F.DOOR_HEIGHT);
        }
      }
      if (blazeRoom) {
        // Open-top tower: merlons on alternating ring columns.
        if ((a + b) % 2 === 0) set(wallTop + 1, B);
      } else {
        set(wallTop + 1, B); // roof edge
      }
      return;
    }
    // Interior column.
    clear(y + 1, wallTop);
    if (blazeRoom) {
      if (a === D0 && b === D0) set(y + 1, BLOCK.SPAWNER);
    } else if (piece.type === 'wart') {
      // Wart garden: soul-sand beds sunk into the floor, fully grown wart
      // on top; the roof carries a glowstone lamp at its centre.
      const bed =
        (a >= 1 && a <= 3 && (b === 1 || b === 2)) ||
        (a >= 4 && a <= 6 && (b === 4 || b === 5));
      if (bed) {
        set(y, BLOCK.SOUL_SAND);
        set(y + 1, BLOCK.NETHER_WART_2);
      }
      set(wallTop + 1, (a === D0 || a === D1) && (b === D0 || b === D1)
        ? BLOCK.GLOWSTONE
        : B); // roof
    } else {
      // Keep halls (and the fallback 'room'): plain roofed interior with a
      // glowstone lamp at the ceiling centre, so the keep reads lit inside.
      set(wallTop + 1, (a === D0 || a === D1) && (b === D0 || b === D1)
        ? BLOCK.GLOWSTONE
        : B); // roof
    }
  }

  // A support pier: nether brick descending from `startY` through open air
  // (and a few blocks into the lava sea) until it reaches ground or the
  // drop cap. Reads only its own column of the owning chunk, so piers stay
  // chunk-local and deterministic.
  _pier(chunk, lx, lz, startY) {
    let lavaDepth = 0;
    const floor = Math.max(NETHER.MIN_Y + 1, startY - F.PIER_MAX_DROP);
    for (let y = startY; y >= floor; y--) {
      const id = chunk.get(lx, y, lz);
      if (id === BLOCK.LAVA) {
        if (++lavaDepth > F.PIER_LAVA_DEPTH) break;
      } else if (id !== BLOCK.AIR) {
        break; // found ground
      }
      chunk.set(lx, y, lz, BLOCK.NETHER_BRICKS);
    }
  }
}

// Shared by blueprint growth (the dead-end cleanup) and emission: does the
// piece in direction d from (cx, cz) exist and present a connecting edge at
// height y back toward this cell?
function linkedAt(cells, cx, cz, d, y) {
  const n = cells.get(keyOf(cx + d.dx, cz + d.dz));
  if (!n) return false;
  return pieceEdgeY(n, { dx: -d.dx, dz: -d.dz }) === y;
}

// Room kinds (tooling/tests).
export function isRoomType(type) {
  return ROOMY.has(type);
}
