// world/fluids.js — Phase 12: flowing lava. A budgeted cellular automaton
// over lava cells, driven by block-change events and a one-time settle scan
// of each newly meshed chunk (generated lava with air below or beside —
// the Phase 10 wall leaks and pool edges — starts flowing when first seen).
//
// Rules (vanilla Overworld lava, simplified to this game's block set):
//   - Lava pours DOWNWARD first: any lava cell over air writes a falling
//     column cell (LAVA_FALL) below it and does not spread sideways.
//   - Blocked below (solid ground or a lava source), it spreads across the
//     surface into air cells, one level per step, up to FLUIDS.LAVA_RANGE
//     (3) from a full-strength cell. A source and a landed falling column
//     both spread at full strength, so a poured fall re-spreads where it
//     lands, exactly like vanilla.
//   - Flowing cells are not sources: each tick they recompute what their
//     neighbours support (lava above -> falling; a horizontal feeder of
//     level n -> level n+1) and decay to air when the feed is cut, so
//     scooping a source drains its flows outward tick by tick.
//   - Lava never invades water, solids, or other fluids — only air fills.
//
// The simulation only writes through world.setBlock, so meshing, lighting
// (flow cells emit 15 like the source), falling-block support checks and
// torch pops all ride the normal block-change path. Rendering lives in the
// chunk mesher (partial-height animated cells); this module is pure logic.

import { FLUIDS, OVERWORLD, CHUNK } from '../config.js';
import {
  BLOCK, isLava, isLavaSource, lavaFlowLevel, isSolid,
} from './blocks.js';

const FLOW_BY_LEVEL = [null, BLOCK.LAVA_FLOW_1, BLOCK.LAVA_FLOW_2, BLOCK.LAVA_FLOW_3];
const H4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MIN_Y = OVERWORLD.MIN_Y;
const MAX_Y = OVERWORLD.MIN_Y + CHUNK.HEIGHT;

export function createFluids({ world }) {
  let pending = new Set(); // "x,y,z" cells to process on the next tick
  let carry = [];          // overflow from a budget-capped tick
  let timer = 0;

  function schedule(x, y, z) {
    if (y < MIN_Y || y >= MAX_Y) return;
    pending.add(x + ',' + y + ',' + z);
  }

  // A cell may only process while every chunk its reads/writes can touch
  // (itself + the 4 face neighbours, so at most a 2x2 chunk corner) still
  // holds data. Without this, queue entries surviving an unload would make
  // the next tick's getBlock regenerate far chunks synchronously and march
  // the spread away from the player forever (items and falling blocks
  // freeze in unloaded chunks for the same reason). Dropped updates heal:
  // disposeChunkMesh clears _fluidScanned, so a returning chunk re-scans.
  function cellChunksLoaded(x, z) {
    // A pure-logic mock world without chunk streaming counts as all-loaded
    // (node tests drive the automaton with a plain { getBlock, setBlock }).
    if (!world.getChunkIfLoaded) return true;
    const c0x = Math.floor((x - 1) / CHUNK.SIZE);
    const c1x = Math.floor((x + 1) / CHUNK.SIZE);
    const c0z = Math.floor((z - 1) / CHUNK.SIZE);
    const c1z = Math.floor((z + 1) / CHUNK.SIZE);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        if (!world.getChunkIfLoaded(cx, cz)) return false;
      }
    }
    return true;
  }

  // Any edit can start or stop a flow at the cell or a face neighbour —
  // schedule whichever of those cells actually holds lava (a placed source
  // schedules itself; a block broken under a lake schedules the lava above).
  function onBlockChanged(x, y, z) {
    for (const [dx, dy, dz] of [
      [0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (isLava(world.getBlock(nx, ny, nz))) schedule(nx, ny, nz);
    }
  }

  // The spread strength a lava cell offers its horizontal neighbours:
  // 0 for a source; 0 for a falling column resting on something that stops
  // it (solid ground or a source — vanilla re-spreads at the foot of a
  // fall); its own level for a flow cell; null = feeds nothing (a still-
  // falling column feeds only downward).
  function feederLevel(x, y, z, id) {
    if (isLavaSource(id)) return 0;
    if (id === BLOCK.LAVA_FALL) {
      const below = world.getBlock(x, y - 1, z);
      return isSolid(below) || isLavaSource(below) ? 0 : null;
    }
    return lavaFlowLevel(id); // 1..3 for flows; null for anything else
  }

  // What this flowing cell's neighbours support it to be: a falling cell
  // under any lava, a flow one level past its best horizontal feeder, or
  // nothing (air) when the feed is gone.
  function supportedState(x, y, z) {
    if (isLava(world.getBlock(x, y + 1, z))) return BLOCK.LAVA_FALL;
    let best = null;
    for (const [dx, dz] of H4) {
      const nid = world.getBlock(x + dx, y, z + dz);
      if (!isLava(nid)) continue;
      const f = feederLevel(x + dx, y, z + dz, nid);
      if (f !== null && (best === null || f < best)) best = f;
    }
    if (best !== null && best < FLUIDS.LAVA_RANGE) return FLOW_BY_LEVEL[best + 1];
    return BLOCK.AIR;
  }

  function processCell(x, y, z) {
    let id = world.getBlock(x, y, z);
    if (!isLava(id)) return;

    // Pull: a flowing cell revalidates itself against its neighbours
    // (upgrade, downgrade, or decay to air). setBlock's listener schedules
    // the lava neighbours, so recedes and upgrades cascade tick by tick.
    if (!isLavaSource(id)) {
      const want = supportedState(x, y, z);
      if (want !== id) {
        // Fluid writes are DERIVED state (markModified false): the chunk
        // stays unloadable and the settle scan re-derives flows on return.
        world.setBlock(x, y, z, want, false);
        if (want === BLOCK.AIR) return;
        id = want;
      }
    }

    // Push: downward first. Air below becomes a falling column; any
    // non-source lava below means this cell is still pouring down, so it
    // never spreads sideways (vanilla).
    const below = world.getBlock(x, y - 1, z);
    if (below === BLOCK.AIR) {
      if (y - 1 >= MIN_Y) {
        world.setBlock(x, y - 1, z, BLOCK.LAVA_FALL, false);
        return;
      }
      return; // resting on the world floor guard — nothing to pour into
    }
    if (isLava(below) && !isLavaSource(below)) return;

    // Blocked below: spread across the surface into air cells.
    const f = feederLevel(x, y, z, id);
    if (f === null || f >= FLUIDS.LAVA_RANGE) return;
    const next = FLOW_BY_LEVEL[f + 1];
    for (const [dx, dz] of H4) {
      if (world.getBlock(x + dx, y, z + dz) === BLOCK.AIR) {
        world.setBlock(x + dx, y, z + dz, next, false);
      }
    }
  }

  // One-time settle scan of a chunk's generated lava: any lava cell with
  // air directly below or beside can flow — schedule it. Lake interiors and
  // sealed pools schedule nothing and stay exactly as generated.
  function scanChunk(chunk) {
    const S = CHUNK.SIZE;
    const H = CHUNK.HEIGHT;
    const baseX = chunk.cx * S;
    const baseZ = chunk.cz * S;
    const blocks = chunk.blocks;
    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const colBase = (lz * S + lx) * H;
        for (let iy = 0; iy < H; iy++) {
          if (!isLava(blocks[colBase + iy])) continue;
          const x = baseX + lx;
          const y = iy + MIN_Y;
          const z = baseZ + lz;
          if (
            world.getBlock(x, y - 1, z) === BLOCK.AIR ||
            world.getBlock(x + 1, y, z) === BLOCK.AIR ||
            world.getBlock(x - 1, y, z) === BLOCK.AIR ||
            world.getBlock(x, y, z + 1) === BLOCK.AIR ||
            world.getBlock(x, y, z - 1) === BLOCK.AIR
          ) {
            schedule(x, y, z);
          }
        }
      }
    }
    chunk._fluidScanned = true;
  }

  function update(dt) {
    // Settle newly meshed chunks (their 3x3 neighbours are guaranteed
    // generated, so the border reads above never trigger generation).
    let scanned = 0;
    for (const chunk of world.chunks.values()) {
      if (!chunk.mesh || chunk._fluidScanned) continue;
      scanChunk(chunk);
      if (++scanned >= FLUIDS.SCAN_CHUNKS_PER_FRAME) break;
    }

    timer += dt;
    if (timer < FLUIDS.LAVA_SPREAD_SECONDS) return;
    timer = 0; // one spread step per interval, even after a long hitch

    const batch = pending;
    pending = new Set(); // writes during processing schedule the NEXT tick
    for (const k of carry) batch.add(k);
    carry = [];
    let n = 0;
    for (const k of batch) {
      if (n++ >= FLUIDS.MAX_UPDATES_PER_TICK) {
        carry.push(k);
        continue;
      }
      const [x, y, z] = k.split(',').map(Number);
      if (!cellChunksLoaded(x, z)) continue; // dropped — rescan on return
      processCell(x, y, z);
    }
  }

  return {
    update,
    onBlockChanged,
    // Debug/test scaffolding
    get pendingCount() {
      return pending.size + carry.length;
    },
    schedule,
  };
}
