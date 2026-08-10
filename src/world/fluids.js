// world/fluids.js — flowing fluids. A budgeted cellular automaton over fluid
// cells, driven by block-change events and a one-time settle scan of each
// newly meshed chunk (generated fluid with air below or beside — the Phase 10
// lava wall leaks, pool edges, and the Phase 15 cavern springs — starts
// flowing when first seen).
//
// Phase 12 built this for LAVA. Phase 21 generalised it: water runs the same
// rules with its own range (7, vanilla) and its own faster tick, because the
// reported bug was that flow "looks wrong and behaves inconsistently" — half
// the fluids in the game never flowed at all.
//
// Rules (vanilla, simplified to this game's block set), per family:
//   - A fluid pours DOWNWARD first: any fluid cell over air writes a falling
//     column cell below it and does not spread sideways.
//   - Blocked below (solid ground or a source), it spreads across the
//     surface into air cells, one level per step, up to the family's RANGE
//     from a full-strength cell. A source and a landed falling column both
//     spread at full strength, so a poured fall re-spreads where it lands,
//     exactly like vanilla.
//   - Flowing cells are not sources: each tick they recompute what their
//     neighbours support (fluid above -> falling; a horizontal feeder of
//     level n -> level n+1) and decay to air when the feed is cut, so
//     scooping a source drains its flows outward tick by tick.
//   - A fluid never invades solids or the OTHER fluid — only air fills.
//   - Water only: a flowing cell with two or more source neighbours becomes
//     a source itself (vanilla's infinite-water-pool rule).
//
// Phase 15 — water meeting lava (SPEC: obsidian on the portal critical
// path): a lava SOURCE with water above or beside it becomes OBSIDIAN; a
// flowing/falling lava cell becomes COBBLESTONE (the vanilla pair). The
// conversion runs immediately on any block change (placing a water bucket
// against lava hardens it the same frame) and as each scheduled cell
// processes; generated contacts (a waterfall pool reaching a lava leak)
// convert when the settle scan schedules them.
//
// The simulation only writes through world.setBlock, so meshing, lighting
// (lava flow cells emit 15 like the source), falling-block support checks and
// torch pops all ride the normal block-change path. Rendering lives in the
// chunk mesher (partial-height animated cells); this module is pure logic.

import { FLUIDS, OVERWORLD, CHUNK } from '../config.js';
import {
  BLOCK, isLava, isLavaSource, lavaFlowLevel, isWater, isWaterSource,
  waterFlowLevel, WATER_FLOW_BY_LEVEL, isSolid,
} from './blocks.js';

const LAVA_FLOW_BY_LEVEL = [null, BLOCK.LAVA_FLOW_1, BLOCK.LAVA_FLOW_2, BLOCK.LAVA_FLOW_3];
const H4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MIN_Y = OVERWORLD.MIN_Y;
const MAX_Y = OVERWORLD.MIN_Y + CHUNK.HEIGHT;

// The two families, identical but for their block ids, range and pace.
const LAVA = {
  key: 'lava',
  is: isLava,
  isSource: isLavaSource,
  flowLevel: lavaFlowLevel,
  byLevel: LAVA_FLOW_BY_LEVEL,
  fall: BLOCK.LAVA_FALL,
  source: BLOCK.LAVA,
  range: FLUIDS.LAVA_RANGE,
  infinite: false,
};
const WATER = {
  key: 'water',
  is: isWater,
  isSource: isWaterSource,
  flowLevel: waterFlowLevel,
  byLevel: WATER_FLOW_BY_LEVEL,
  fall: BLOCK.WATER_FALL,
  source: BLOCK.WATER,
  range: FLUIDS.WATER_RANGE,
  infinite: true, // two adjacent sources make a third (vanilla)
};

export function createFluids({ world }) {
  // One pending set and one timer per family: water ticks several times per
  // lava tick, and a cell's family never changes under it.
  const queues = {
    lava: { pending: new Set(), carry: [], timer: 0, seconds: FLUIDS.LAVA_SPREAD_SECONDS },
    water: { pending: new Set(), carry: [], timer: 0, seconds: FLUIDS.WATER_SPREAD_SECONDS },
  };
  // Per-dimension lava tick override (Phase 16): Nether lava spreads twice
  // as fast (vanilla). dimensions/dimensions.js sets it on every switch;
  // null restores the overworld default.
  function setTickSeconds(seconds) {
    queues.lava.seconds = seconds ?? FLUIDS.LAVA_SPREAD_SECONDS;
  }

  const familyOf = (id) => (isLava(id) ? LAVA : isWater(id) ? WATER : null);

  function schedule(x, y, z) {
    if (y < MIN_Y || y >= MAX_Y) return;
    const family = familyOf(world.getBlock(x, y, z));
    if (!family) return;
    queues[family.key].pending.add(x + ',' + y + ',' + z);
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

  // Water meets lava (Phase 15): a lava cell with water ABOVE or BESIDE it
  // hardens — sources to obsidian, flows and falls to cobblestone (vanilla).
  // Water below doesn't harden the lava over it (also vanilla — lava can't
  // pour INTO water here anyway, falls only fill air). Returns true when the
  // cell converted; the setBlock rides the normal listener chain, so
  // neighbouring lava re-checks itself and an obsidian shell cascades along
  // the whole contact face.
  function hardenOnWaterContact(x, y, z, id) {
    if (
      !isWater(world.getBlock(x, y + 1, z)) &&
      !isWater(world.getBlock(x + 1, y, z)) &&
      !isWater(world.getBlock(x - 1, y, z)) &&
      !isWater(world.getBlock(x, y, z + 1)) &&
      !isWater(world.getBlock(x, y, z - 1))
    ) return false;
    // A real, permanent block — markModified stays true (unlike flow writes).
    world.setBlock(x, y, z, isLavaSource(id) ? BLOCK.OBSIDIAN : BLOCK.COBBLESTONE);
    return true;
  }

  // Any edit can start or stop a flow at the cell or a face neighbour —
  // schedule whichever of those cells actually holds a fluid (a placed
  // source schedules itself; a block broken under a lake schedules the fluid
  // above). Water contact converts lava immediately instead (same frame as
  // the edit — placing a water bucket against lava never waits for a tick).
  function onBlockChanged(x, y, z) {
    for (const [dx, dy, dz] of [
      [0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const id = world.getBlock(nx, ny, nz);
      const family = familyOf(id);
      if (!family) continue;
      if (family === LAVA && hardenOnWaterContact(nx, ny, nz, id)) continue;
      schedule(nx, ny, nz);
    }
  }

  // The spread strength a fluid cell offers its horizontal neighbours:
  // 0 for a source; 0 for a falling column resting on something that stops
  // it (solid ground or a source — vanilla re-spreads at the foot of a
  // fall); its own level for a flow cell; null = feeds nothing (a still-
  // falling column feeds only downward).
  function feederLevel(family, x, y, z, id) {
    if (family.isSource(id)) return 0;
    if (id === family.fall) {
      const below = world.getBlock(x, y - 1, z);
      return isSolid(below) || family.isSource(below) ? 0 : null;
    }
    return family.flowLevel(id); // 1..range for flows; null for anything else
  }

  // What this flowing cell's neighbours support it to be: a falling cell
  // under any same-family fluid, a flow one level past its best horizontal
  // feeder, or nothing (air) when the feed is gone.
  function supportedState(family, x, y, z) {
    if (family.is(world.getBlock(x, y + 1, z))) return family.fall;
    let best = null;
    let sources = 0;
    for (const [dx, dz] of H4) {
      const nid = world.getBlock(x + dx, y, z + dz);
      if (!family.is(nid)) continue;
      if (family.isSource(nid)) sources++;
      const f = feederLevel(family, x + dx, y, z + dz, nid);
      if (f !== null && (best === null || f < best)) best = f;
    }
    // Vanilla's infinite water: a flowing cell touching two sources with
    // something solid under it becomes a source of its own.
    if (family.infinite && sources >= 2 && isSolid(world.getBlock(x, y - 1, z))) {
      return family.source;
    }
    if (best !== null && best < family.range) return family.byLevel[best + 1];
    return BLOCK.AIR;
  }

  function processCell(x, y, z) {
    let id = world.getBlock(x, y, z);
    const family = familyOf(id);
    if (!family) return;
    if (family === LAVA && hardenOnWaterContact(x, y, z, id)) return;

    // Pull: a flowing cell revalidates itself against its neighbours
    // (upgrade, downgrade, or decay to air). setBlock's listener schedules
    // the fluid neighbours, so recedes and upgrades cascade tick by tick.
    if (!family.isSource(id)) {
      const want = supportedState(family, x, y, z);
      if (want !== id) {
        // Fluid writes are DERIVED state (markModified false): the chunk
        // stays unloadable and the settle scan re-derives flows on return.
        // A promoted infinite-water source is a real edit, though — it must
        // survive an unload like any placed block.
        world.setBlock(x, y, z, want, want === family.source);
        if (want === BLOCK.AIR) return;
        id = want;
      }
    }

    // Push: downward first. Air below becomes a falling column; any
    // non-source same-family fluid below means this cell is still pouring
    // down, so it never spreads sideways (vanilla).
    const below = world.getBlock(x, y - 1, z);
    if (below === BLOCK.AIR) {
      if (y - 1 >= MIN_Y) {
        world.setBlock(x, y - 1, z, family.fall, false);
        return;
      }
      return; // resting on the world floor guard — nothing to pour into
    }
    if (family.is(below) && !family.isSource(below)) return;

    // Blocked below: spread across the surface into air cells.
    const f = feederLevel(family, x, y, z, id);
    if (f === null || f >= family.range) return;
    const next = family.byLevel[f + 1];
    for (const [dx, dz] of H4) {
      if (world.getBlock(x + dx, y, z + dz) === BLOCK.AIR) {
        world.setBlock(x + dx, y, z + dz, next, false);
      }
    }
  }

  // One-time settle scan of a chunk's generated fluids: any fluid cell with
  // air directly below or beside can flow — schedule it. Lake interiors,
  // ocean bodies and sealed pools schedule nothing and stay exactly as
  // generated.
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
          const id = blocks[colBase + iy];
          const family = familyOf(id);
          if (!family) continue;
          const x = baseX + lx;
          const y = iy + MIN_Y;
          const z = baseZ + lz;
          // Air below/beside can start a flow; water above/beside (Phase
          // 15 — a generated waterfall pool against a lava leak) hardens
          // the lava cell on its first tick.
          const above = world.getBlock(x, y + 1, z);
          const e = world.getBlock(x + 1, y, z);
          const w = world.getBlock(x - 1, y, z);
          const s = world.getBlock(x, y, z + 1);
          const n = world.getBlock(x, y, z - 1);
          const touchesWater = family === LAVA && (
            isWater(above) || isWater(e) || isWater(w) || isWater(s) || isWater(n)
          );
          if (
            world.getBlock(x, y - 1, z) === BLOCK.AIR ||
            e === BLOCK.AIR || w === BLOCK.AIR ||
            s === BLOCK.AIR || n === BLOCK.AIR ||
            touchesWater
          ) {
            schedule(x, y, z);
          }
        }
      }
    }
    chunk._fluidScanned = true;
  }

  // Run one family's queue, spending from the shared per-frame budget.
  function runQueue(queue, budget) {
    const batch = queue.pending;
    queue.pending = new Set(); // writes during processing schedule the NEXT tick
    for (const k of queue.carry) batch.add(k);
    queue.carry = [];
    let spent = 0;
    for (const key of batch) {
      if (spent >= budget) {
        queue.carry.push(key);
        continue;
      }
      spent++;
      const [x, y, z] = key.split(',').map(Number);
      if (!cellChunksLoaded(x, z)) continue; // dropped — rescan on return
      processCell(x, y, z);
    }
    return spent;
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

    // Both families share MAX_UPDATES_PER_TICK so a busy waterfall can never
    // add its cost on top of a busy lava lake — the frame budget is one
    // number, whatever is flowing.
    let budget = FLUIDS.MAX_UPDATES_PER_TICK;
    for (const queue of [queues.water, queues.lava]) {
      queue.timer += dt;
      if (queue.timer < queue.seconds) continue;
      queue.timer = 0; // one spread step per interval, even after a hitch
      budget -= runQueue(queue, budget);
      if (budget <= 0) break;
    }
  }

  // Dimension switch (Phase 15): the pending queues and tick phases belong
  // to their dimension (cell coordinates mean nothing in another world). The
  // chunk-side settle flags travel with the chunks themselves.
  function swapDimensionState(stored = null) {
    const prev = {
      lava: { pending: queues.lava.pending, carry: queues.lava.carry, timer: queues.lava.timer },
      water: { pending: queues.water.pending, carry: queues.water.carry, timer: queues.water.timer },
    };
    for (const key of ['lava', 'water']) {
      const incoming = stored?.[key];
      queues[key].pending = incoming?.pending ?? new Set();
      queues[key].carry = incoming?.carry ?? [];
      queues[key].timer = incoming?.timer ?? 0;
    }
    return prev;
  }

  return {
    update,
    onBlockChanged,
    swapDimensionState,
    setTickSeconds, // per-dimension lava pace (Phase 16 — the Nether halves it)
    // Debug/test scaffolding
    get pendingByFamily() {
      return {
        lava: queues.lava.pending.size + queues.lava.carry.length,
        water: queues.water.pending.size + queues.water.carry.length,
      };
    },
    get pendingCount() {
      return queues.lava.pending.size + queues.lava.carry.length +
        queues.water.pending.size + queues.water.carry.length;
    },
    schedule,
  };
}
