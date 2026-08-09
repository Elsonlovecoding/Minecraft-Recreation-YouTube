// dimensions/fortress.js — Phase 17: nether fortresses. One fortress per
// NETHER.FORTRESS.REGION_CHUNKS² chunk region, always (a portal arrival is
// never more than a region away from one). The layout is a region-seeded
// BLUEPRINT: pieces on a CELL-sized grid — a central blaze-spawner room
// (the heart), straight bridge/corridor runs, crossings where arms branch,
// and terminal rooms (blaze towers and wart rooms) — grown by a bounded,
// fully deterministic walk. Every chunk the fortress touches re-derives the
// same blueprint (cached per region) and emits only its own columns, so
// generation order can never change the world (the caves.js discipline).
//
// Structural rules the emitter guarantees (the session requirements):
//   - every piece is connected: runs start at the heart and either end in a
//     room, merge into an existing piece (a misaligned merge upgrades that
//     piece to a crossing so the junction genuinely joins), or branch at a
//     crossing — there are no isolated fragments;
//   - rooms cut doorways toward every neighbouring piece that connects back
//     (and the heart has at least one arm), so no room is sealed;
//   - decks meet flush: one shared deck height per fortress, deck strips
//     spanning their full cell so adjacent pieces tile continuously;
//   - support piers descend from bridges, crossings and room corners until
//     they find ground (or stand a few blocks into the lava sea) — nothing
//     reads as floating.
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

// Does a piece's deck reach its cell edge toward `axis`? Bridges and
// corridors only along their own axis; crossings and rooms toward any side
// (crossings grow arms, rooms cut doorways — both resolved per neighbour).
function connects(piece, axis) {
  if (piece.type === 'bridge' || piece.type === 'corridor') {
    return piece.axis === axis;
  }
  return true;
}

export class FortressGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    this._blueprints = new Map(); // "rx,rz" -> blueprint
  }

  // --- the blueprint --------------------------------------------------------

  // The full deterministic layout for a region: { ox, oz, deckY, cells }
  // where cells maps "cx,cz" (cell coords, heart at 0,0) to
  // { type: 'bridge'|'corridor'|'crossing'|'blaze'|'wart', axis }.
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

    const cells = new Map();
    cells.set(keyOf(0, 0), { type: 'blaze', axis: 0 }); // the heart
    let pieces = 1;
    const terminals = [];
    let lastRunCell = null; // farthest run cell — the no-terminal fallback

    // FIFO growth queue: arms spread evenly instead of one arm eating the
    // whole budget. Every entry grows one straight run from `cx,cz` along
    // `dir`, then ends it (crossing / terminal room / merge).
    const queue = [];
    // The heart sprouts up to four arms, in seeded order.
    const order = DIRS.map((d, i) => ({ d, r: rng() }))
      .sort((a, b) => a.r - b.r)
      .map((e) => e.d);
    for (const d of order) queue.push({ cx: 0, cz: 0, dir: d, depth: 0 });

    while (queue.length > 0) {
      const { cx, cz, dir, depth } = queue.shift();
      const runLen = F.ARM_MIN_CELLS +
        Math.floor(rng() * (F.ARM_MAX_CELLS - F.ARM_MIN_CELLS + 1));
      const corridor = rng() < F.CORRIDOR_CHANCE;
      const continueRoll = rng() < F.CONTINUE_CHANCE;
      const branchRolls = [rng() < F.BRANCH_CHANCE, rng() < F.BRANCH_CHANCE];

      let x = cx;
      let z = cz;
      let placedLast = null;
      let merged = false;
      for (let i = 0; i < runLen; i++) {
        const nx = x + dir.dx;
        const nz = z + dir.dz;
        if (
          Math.abs(nx) > F.MAX_RADIUS_CELLS ||
          Math.abs(nz) > F.MAX_RADIUS_CELLS ||
          pieces >= F.MAX_PIECES
        ) break;
        const nkey = keyOf(nx, nz);
        const existing = cells.get(nkey);
        if (existing) {
          // The run merged into an existing piece — a genuine junction. A
          // misaligned bridge/corridor there would leave the arriving deck
          // facing that piece's side wall, so upgrade it to a crossing (its
          // arms resolve per neighbour at emission).
          if (
            (existing.type === 'bridge' || existing.type === 'corridor') &&
            existing.axis !== dir.axis
          ) {
            existing.type = 'crossing';
          }
          merged = true;
          break;
        }
        cells.set(nkey, { type: corridor ? 'corridor' : 'bridge', axis: dir.axis });
        pieces++;
        x = nx;
        z = nz;
        placedLast = { x, z, key: nkey };
        lastRunCell = placedLast;
      }
      if (!placedLast || merged) continue;

      // End the run: chain a crossing (and maybe branches), or terminate in
      // a room. The junction takes the NEXT cell so the run keeps its length.
      const jx = x + dir.dx;
      const jz = z + dir.dz;
      const canJunction =
        continueRoll &&
        depth < F.MAX_DEPTH &&
        pieces < F.MAX_PIECES &&
        Math.abs(jx) <= F.MAX_RADIUS_CELLS &&
        Math.abs(jz) <= F.MAX_RADIUS_CELLS &&
        !cells.has(keyOf(jx, jz));
      if (canJunction) {
        cells.set(keyOf(jx, jz), { type: 'crossing', axis: dir.axis });
        pieces++;
        queue.push({ cx: jx, cz: jz, dir, depth: depth + 1 });
        const [left, right] = dir.axis === 0
          ? [DIRS[2], DIRS[3]]
          : [DIRS[0], DIRS[1]];
        if (branchRolls[0]) queue.push({ cx: jx, cz: jz, dir: left, depth: depth + 1 });
        if (branchRolls[1]) queue.push({ cx: jx, cz: jz, dir: right, depth: depth + 1 });
      } else {
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
    // back on every side, exactly like crossings).
    for (const [key, piece] of cells) {
      if (piece.type !== 'crossing') continue;
      const [cx, cz] = key.split(',').map(Number);
      let links = 0;
      for (const d of DIRS) {
        const n = cells.get(keyOf(cx + d.dx, cz + d.dz));
        if (n && connects(n, d.axis)) links++;
      }
      if (links <= 1) {
        piece.type = 'room';
        terminals.push(key);
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
  // and reach back toward this cell?
  _linked(bp, cx, cz, d) {
    const n = bp.cells.get(keyOf(cx + d.dx, cz + d.dz));
    return !!n && connects(n, d.axis);
  }

  // One column (a, b = offsets 0..CELL-1 within the piece) of one piece,
  // written into the owning chunk at chunk-local lx/lz.
  _emitColumn(chunk, bp, piece, cx, cz, lx, lz, a, b) {
    const y = bp.deckY;
    const B = BLOCK.NETHER_BRICKS;
    const set = (yy, id) => chunk.set(lx, yy, lz, id);
    const clear = (y0, y1) => {
      for (let yy = y0; yy <= y1; yy++) set(yy, BLOCK.AIR);
    };

    if (piece.type === 'bridge' || piece.type === 'corridor') {
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

    if (piece.type === 'crossing') {
      // The deck footprint: the centre square plus an arm strip toward each
      // connected neighbour. Railings ring the footprint boundary (walk
      // columns continue into connected neighbours' decks flush).
      const arms = DIRS.map((d) => this._linked(bp, cx, cz, d));
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

    // Rooms: the heart and terminals ('blaze' spawner tower, 'wart' garden).
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
        if (onSide && centred && this._linked(bp, cx, cz, d)) {
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
    } else {
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
