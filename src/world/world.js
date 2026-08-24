// world/world.js — Chunk manager: get/set block by world coordinates,
// generating chunks on demand, plus chunk streaming — loading, meshing and
// unloading around the player within a per-frame time budget. All other
// systems read and write the world through this module.

import { CHUNK, OVERWORLD, TERRAIN, VIEW, STREAMING, LIGHTING } from '../config.js';
import { Chunk, buildChunkMesh, disposeChunkMesh } from './chunks.js';
import { TerrainGenerator } from './terrain.js';
import { BLOCK, isSolid } from './blocks.js';

const SIZE = CHUNK.SIZE;

export class World {
  // `generator` (Phase 15): any object with generateChunk/heightAt/biomeAt —
  // the overworld default, or a dimension generator (dimensions/nether.js).
  constructor({ seed = TERRAIN.SEED, generator = null } = {}) {
    this.generator = generator ?? new TerrainGenerator(seed);
    this.chunks = new Map(); // "cx,cz" -> Chunk
    this.scene = null;       // set by bindScene once rendering starts
    this.materials = null;
    // Block-change listeners, fired by setBlock as (x, y, z, id). Phase 9
    // had a single onBlockChanged slot (falling-block support checks);
    // Phase 10 turned it into a list — furnaces and chests listen too.
    this._blockListeners = [];
    this.meshedCount = 0;
    this._pcx = null;        // player chunk from the last streaming update
    this._pcz = null;
    // Candidate chunk offsets around the player, nearest first. Data
    // generates in the square ring view+1 (so meshing always has 3x3
    // neighbours); meshes build inside the view-distance circle. The ring
    // also spans the unload-hysteresis band so kept meshes that turn dirty
    // still get remeshed.
    this._offsets = [];
    const r = VIEW.DISTANCE_CHUNKS + Math.max(1, STREAMING.UNLOAD_MARGIN);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        this._offsets.push({ dx, dz, d2: dx * dx + dz * dz });
      }
    }
    this._offsets.sort((a, b) => a.d2 - b.d2);
    // Phase 27 — the streaming scan itself must not cost a frame anything
    // once the ring is built. At r=40 the candidate list is 6889 offsets,
    // and walking it every frame (a string-keyed Map lookup each) is real
    // milliseconds. Two cuts:
    //   _streamIdle    a full pass that found NOTHING to do parks the
    //                  streamer entirely; any setBlock (the one dirty
    //                  writer), a chunk-border crossing or a dimension swap
    //                  wakes it
    //   _scanFrom      work is nearest-first, so the completed near region
    //                  only ever grows — passes resume at the first offset
    //                  the previous pass found incomplete instead of
    //                  re-checking thousands of finished chunks
    this._streamIdle = false;
    this._scanFrom = 0;
    this._appearing = []; // chunk groups mid-rise (STREAMING.APPEAR)
  }

  static chunkKey(cx, cz) {
    return cx + ',' + cz;
  }

  // Returns the chunk, generating it on demand.
  getChunk(cx, cz) {
    const key = World.chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.generator.generateChunk(chunk);
      // The save pass (systems/persistence.js): a freshly generated chunk
      // the save carries edits for gets them decoded straight over its
      // blocks, right here — every consumer downstream (lighting, meshing,
      // decoration scans) sees only the restored data. The hook is a plain
      // field, NOT part of swapState, so it survives dimension switches
      // and resolves the active dimension itself.
      if (this.restoreChunk) this.restoreChunk(chunk);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  getChunkIfLoaded(cx, cz) {
    return this.chunks.get(World.chunkKey(cx, cz)) ?? null;
  }

  // Block id at world coordinates. Outside the vertical range is air.
  // Generates the containing chunk if needed.
  getBlock(x, y, z) {
    if (y < OVERWORLD.MIN_Y || y >= OVERWORLD.MIN_Y + CHUNK.HEIGHT) return BLOCK.AIR;
    x = Math.floor(x);
    z = Math.floor(z);
    const cx = Math.floor(x / SIZE);
    const cz = Math.floor(z / SIZE);
    return this.getChunk(cx, cz).get(x - cx * SIZE, Math.floor(y), z - cz * SIZE);
  }

  // Sets a block and marks the chunk (and bordering neighbours, if already
  // loaded) dirty so Phase 3 remeshes them. `markModified` false is for
  // DERIVED writes (the fluid simulation): the chunk stays eligible for
  // data unload — flows re-derive from the settle scan when the chunk
  // returns — so merely exploring lava terrain can't pin chunk data in
  // memory forever. Everything player-driven keeps the default.
  setBlock(x, y, z, id, markModified = true) {
    if (y < OVERWORLD.MIN_Y || y >= OVERWORLD.MIN_Y + CHUNK.HEIGHT) return;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const cx = Math.floor(x / SIZE);
    const cz = Math.floor(z / SIZE);
    const lx = x - cx * SIZE;
    const lz = z - cz * SIZE;
    const chunk = this.getChunk(cx, cz);
    chunk.set(lx, y, lz, id);
    chunk.dirty = true;
    if (markModified) chunk.modified = true; // player edits — never dropped
    this._streamIdle = false; // wake the streamer (Phase 27)
    this._scanFrom = 0;       // the dirty chunk can be anywhere in the ring

    const markDirty = (ncx, ncz) => {
      const n = this.getChunkIfLoaded(ncx, ncz);
      if (n) n.dirty = true;
    };
    // An edit changes baked light up to MAX_LIGHT blocks away (light spreads
    // by Manhattan distance; a sky-lit shaft moves the change down its own
    // column, never sideways, so the horizontal reach still bounds it).
    // Remesh every loaded neighbour the edited column can touch — this also
    // covers the 1-block reach of border culling and baked vertex AO.
    const reach = LIGHTING.MAX_LIGHT;
    if (lx < reach) markDirty(cx - 1, cz);
    if (SIZE - 1 - lx < reach) markDirty(cx + 1, cz);
    if (lz < reach) markDirty(cx, cz - 1);
    if (SIZE - 1 - lz < reach) markDirty(cx, cz + 1);
    // Diagonals: horizontal Manhattan distance to the nearest column of the
    // diagonal chunk.
    if (lx + lz + 2 <= reach) markDirty(cx - 1, cz - 1);
    if (SIZE - lx + lz + 1 <= reach) markDirty(cx + 1, cz - 1);
    if (lx + 1 + SIZE - lz <= reach) markDirty(cx - 1, cz + 1);
    if (SIZE - lx + SIZE - lz <= reach) markDirty(cx + 1, cz + 1);

    for (const listener of this._blockListeners) listener(x, y, z, id);
  }

  // Registers a block-change listener (x, y, z, id). Listeners must never
  // throw — an exception would stop later listeners from seeing the edit.
  addBlockListener(fn) {
    this._blockListeners.push(fn);
  }

  // Phase 15 (dimensions/dimensions.js): swap this world's backing store —
  // chunk map, generator, scene group, streaming position — for another
  // dimension's, returning the replaced store. Every system that closed
  // over this World instance (player physics, interaction, managers, block
  // listeners) now reads and writes the other dimension; the swapped-out
  // dimension's chunks and meshes stay in memory untouched (its scene
  // group is hidden by the caller) until it swaps back in.
  swapState(state) {
    const prev = {
      chunks: this.chunks,
      generator: this.generator,
      scene: this.scene,
      meshedCount: this.meshedCount,
      pcx: this._pcx,
      pcz: this._pcz,
    };
    this.chunks = state.chunks;
    this.generator = state.generator;
    this.scene = state.scene;
    this.meshedCount = state.meshedCount;
    this._pcx = state.pcx;
    this._pcz = state.pcz;
    this._streamIdle = false; // a whole other world just arrived (Phase 27)
    this._scanFrom = 0;
    return prev;
  }

  // Sky/block light at a cell as { sky, block } (0-15), read from the light
  // computed when the containing chunk last meshed, or null when the chunk
  // has never meshed (far away). Mob spawning reads this — never rebuild
  // light windows per query (see docs/PROGRESS.md lighting invariants).
  getLight(x, y, z) {
    if (y < OVERWORLD.MIN_Y || y >= OVERWORLD.MIN_Y + CHUNK.HEIGHT) return null;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const cx = Math.floor(x / SIZE);
    const cz = Math.floor(z / SIZE);
    const chunk = this.getChunkIfLoaded(cx, cz);
    if (!chunk || !chunk.lightData) return null;
    const packed = chunk.lightData[
      ((z - cz * SIZE) * SIZE + (x - cx * SIZE)) * CHUNK.HEIGHT + (y - OVERWORLD.MIN_Y)
    ];
    return { sky: packed >> 4, block: packed & 15 };
  }

  // Terrain height (surface block y) from the generator — pre-decoration,
  // pre-edit. For the actual current surface use getHighestSolidY.
  getHeight(x, z) {
    return this.generator.heightAt(Math.floor(x), Math.floor(z));
  }

  // Dominant biome name at a column: 'plains' | 'forest' | 'desert' | 'mountains'.
  getBiome(x, z) {
    return this.generator.biomeAt(Math.floor(x), Math.floor(z));
  }

  // Highest solid block y in a column (includes trees and player edits),
  // or MIN_Y - 1 if the column is all air. Generates the chunk if needed.
  getHighestSolidY(x, z) {
    x = Math.floor(x);
    z = Math.floor(z);
    const cx = Math.floor(x / SIZE);
    const cz = Math.floor(z / SIZE);
    const chunk = this.getChunk(cx, cz);
    const lx = x - cx * SIZE;
    const lz = z - cz * SIZE;
    for (let y = OVERWORLD.MIN_Y + CHUNK.HEIGHT - 1; y >= OVERWORLD.MIN_Y; y--) {
      if (isSolid(chunk.get(lx, y, lz))) return y;
    }
    return OVERWORLD.MIN_Y - 1;
  }

  // Generates every chunk within `radius` chunks of (ccx, ccz).
  ensureArea(ccx, ccz, radius) {
    for (let cz = ccz - radius; cz <= ccz + radius; cz++) {
      for (let cx = ccx - radius; cx <= ccx + radius; cx++) {
        this.getChunk(cx, cz);
      }
    }
  }

  get loadedChunkCount() {
    return this.chunks.size;
  }

  forEachChunk(cb) {
    for (const chunk of this.chunks.values()) cb(chunk);
  }

  // -------------------------------------------------------------------------
  // Chunk streaming (Phase 3): meshes appear around the player, budgeted per
  // frame so loading never stalls the game loop.
  // -------------------------------------------------------------------------

  // Wires the world to the scene it renders into. `materials` comes from
  // chunks.js createChunkMaterials (shared across all chunk meshes).
  bindScene(scene, materials) {
    this.scene = scene;
    this.materials = materials;
  }

  // Synchronously builds a small area around `pos` before the first frame so
  // the player starts on visible ground; the rest streams in per frame.
  // Two passes: one pass only generates missing data (meshing waits for the
  // next pass by design), the second builds the meshes.
  prebuild(pos) {
    this._pcx = Math.floor(pos.x / SIZE);
    this._pcz = Math.floor(pos.z / SIZE);
    this._streamPass(this._pcx, this._pcz, Infinity, STREAMING.INITIAL_RADIUS);
    this._streamPass(this._pcx, this._pcz, Infinity, STREAMING.INITIAL_RADIUS);
    // Phase 27: the small prebuild ring "completes" its scan, but the REAL
    // ring is still empty — never let the boot passes park the streamer.
    this._streamIdle = false;
    this._scanFrom = 0;
  }

  // Call once per frame with the camera/player position. Generates missing
  // chunk data, builds missing or dirty meshes nearest-first, and unloads
  // whatever fell out of range — all within STREAMING.FRAME_BUDGET_MS.
  updateStreaming(pos) {
    if (!this.scene) return;
    // The appear rise ticks BEFORE the idle early-out: the last chunks of
    // a burst finish rising after the ring has already gone idle.
    this._tickAppear();
    const pcx = Math.floor(pos.x / SIZE);
    const pcz = Math.floor(pos.z / SIZE);
    if (pcx !== this._pcx || pcz !== this._pcz) {
      this._pcx = pcx;
      this._pcz = pcz;
      this._unloadFar(pcx, pcz);
      this._streamIdle = false; // the ring re-centred (Phase 27)
      this._scanFrom = 0;
    }
    // Phase 27: a built, clean ring costs the frame NOTHING — the last
    // full pass found no work and nothing has changed since.
    if (this._streamIdle) return;
    this._streamPass(pcx, pcz, STREAMING.FRAME_BUDGET_MS, VIEW.DISTANCE_CHUNKS);
  }

  // One pass over the candidate ring, nearest first. Cheap checks are free;
  // heavy work (generating a chunk, building a mesh) spends the budget. The
  // first heavy task of a pass always runs, so progress is guaranteed.
  //
  // Phase 26 — LOD tiers: chunks inside VIEW.LOD.DETAIL_CHUNKS mesh at full
  // detail (tier 0), everything beyond at the reduced tier 1 (chunks.js
  // skips cross plants and leaf interiors there). A meshed chunk whose tier
  // no longer matches its distance remeshes — with HYSTERESIS on the demote
  // side, so walking along the boundary never remesh-thrashes a ring of
  // chunks. Nearest-first order means promotions (a visual upgrade close to
  // the player) naturally run before distant demotions.
  _streamPass(pcx, pcz, budgetMs, meshRadius) {
    const t0 = performance.now();
    const meshR2 = meshRadius * meshRadius;
    // Meshes kept by unload hysteresis can still turn dirty (border edits);
    // remesh them too rather than rendering stale geometry.
    const keepR = meshRadius + STREAMING.UNLOAD_MARGIN;
    const keepR2 = keepR * keepR;
    const genR = meshRadius + 1;
    const detailR2 = VIEW.LOD.DETAIL_CHUNKS ** 2;
    const demoteR2 = (VIEW.LOD.DETAIL_CHUNKS + VIEW.LOD.HYSTERESIS) ** 2;
    const appearR2 = STREAMING.APPEAR.MIN_CHUNKS ** 2;
    // Phase 27: tier-change remeshes TRICKLE (VIEW.LOD.RETIER_PER_PASS) so a
    // border crossing's whole arc of promotions can't camp on the budget,
    // and the scan resumes at the first offset the previous pass left
    // incomplete — work is nearest-first, so everything before that index
    // is known finished and re-checking it is pure waste (at r=40 the ring
    // is 6889 offsets; walking them all every frame was itself a cost).
    let retiers = VIEW.LOD.RETIER_PER_PASS;
    let firstIncomplete = -1;
    const offsets = this._offsets;
    for (let i = this._scanFrom; i < offsets.length; i++) {
      const o = offsets[i];
      const cx = pcx + o.dx;
      const cz = pcz + o.dz;
      const chunk = this.getChunkIfLoaded(cx, cz);
      if (!chunk) {
        if (Math.max(Math.abs(o.dx), Math.abs(o.dz)) > genR) continue;
        if (firstIncomplete < 0) firstIncomplete = i;
        if (performance.now() - t0 >= budgetMs) {
          this._scanFrom = firstIncomplete;
          return;
        }
        this.getChunk(cx, cz); // generates; meshing happens on a later pass
        continue;
      }
      // The reduced tier is only meaningful under an open sky: its
      // underground cull keys off baked sky light, which the Nether and
      // End generators never have (see chunks.js) — those worlds always
      // mesh at full detail (they are small or fog-bounded anyway).
      const lod = o.d2 <= detailR2 || this.generator.hasOpenSky !== true ? 0 : 1;
      const lodStale = chunk.mesh && chunk.mesh.lod !== lod &&
        // Demotions wait out the hysteresis band; promotions apply at once.
        (lod === 0 || o.d2 > demoteR2);
      const wantsMesh = o.d2 <= meshR2
        ? !chunk.mesh || chunk.dirty || lodStale
        : o.d2 <= keepR2 && !!chunk.mesh && (chunk.dirty || lodStale);
      if (!wantsMesh) continue;
      if (firstIncomplete < 0) firstIncomplete = i;
      // A tier change with nothing else wrong is cosmetic upkeep — capped
      // per pass; missing and dirty meshes keep the whole budget.
      if (lodStale && chunk.mesh && !chunk.dirty) {
        if (retiers <= 0) continue;
        retiers--;
      }
      if (!this._neighborsLoaded(cx, cz)) continue;
      if (performance.now() - t0 >= budgetMs) {
        this._scanFrom = firstIncomplete;
        return;
      }
      // FIRST-ever mesh beyond the appear radius rises in (the "real
      // render" smoothness); retier and edit remeshes (chunk.mesh set)
      // swap in place so building is never bouncy.
      this._remesh(chunk, lod, !chunk.mesh && o.d2 > appearR2);
    }
    // Scanned to the end of the ring: park on the first thing still
    // unfinished (a capped retier, a chunk waiting on neighbours), or go
    // IDLE — the next frames cost nothing until something wakes us
    // (updateStreaming clears the flag on movement, setBlock on any edit).
    if (firstIncomplete >= 0) {
      this._scanFrom = firstIncomplete;
    } else {
      this._scanFrom = 0;
      this._streamIdle = true;
    }
  }

  // Meshing needs all 8 neighbours generated so culling and AO can read
  // across chunk borders without triggering generation mid-mesh.
  _neighborsLoaded(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!this.getChunkIfLoaded(cx + dx, cz + dz)) return false;
      }
    }
    return true;
  }

  _remesh(chunk, lod = 0, animate = false) {
    if (chunk.mesh) {
      disposeChunkMesh(chunk);
      this.meshedCount--;
    }
    chunk.mesh = buildChunkMesh(
      chunk,
      (cx, cz) => this.getChunkIfLoaded(cx, cz),
      this.materials,
      lod,
    );
    this.scene.add(chunk.mesh.group);
    if (animate) {
      // Start the group sunk DROP blocks; _tickAppear eases it up to rest.
      const group = chunk.mesh.group;
      group.position.y = -STREAMING.APPEAR.DROP;
      group.updateMatrix();
      this._appearing.push({ group, start: performance.now() });
    }
    this.meshedCount++;
    chunk.dirty = false;
  }

  // Eases every mid-rise chunk group toward rest (cubic ease-out over
  // STREAMING.APPEAR.SECONDS) and drops finished or unloaded entries.
  // Wall-clock timed: the rise is cosmetic, runs a fraction of a second,
  // and must keep moving even on frames the streamer spends fully parked.
  _tickAppear() {
    const list = this._appearing;
    if (list.length === 0) return;
    const A = STREAMING.APPEAR;
    const now = performance.now();
    let keep = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.group.parent) continue; // unloaded (or disposed) mid-rise
      const t = (now - e.start) / (A.SECONDS * 1000);
      if (t >= 1) {
        e.group.position.y = 0;
        e.group.updateMatrix();
        continue;
      }
      const ease = 1 - (1 - t) ** 3;
      e.group.position.y = -A.DROP * (1 - ease);
      e.group.updateMatrix();
      list[keep++] = e;
    }
    list.length = keep;
  }

  // Drops meshes outside the view circle and chunk data outside the load
  // square (with a margin of hysteresis so border chunks don't thrash).
  // Player-modified chunks keep their data forever.
  _unloadFar(pcx, pcz) {
    const meshKeepR = VIEW.DISTANCE_CHUNKS + STREAMING.UNLOAD_MARGIN;
    const meshKeepR2 = meshKeepR * meshKeepR;
    const dataKeepR = VIEW.DISTANCE_CHUNKS + 1 + STREAMING.UNLOAD_MARGIN;
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (Math.max(Math.abs(dx), Math.abs(dz)) > dataKeepR) {
        if (chunk.mesh) {
          disposeChunkMesh(chunk);
          this.meshedCount--;
        }
        // Leaving the area ends the chunk's fluid simulation (queue entries
        // drop rather than resurrect unloaded neighbours); clearing the
        // settle flag makes a RETURNING chunk re-scan so an interrupted
        // spread resumes. Only unload clears it — remeshing must not, or
        // every remesh would re-enqueue the chunk's whole lava surface.
        // The spawner-discovery flag (world/spawners.js) follows the same
        // rule; its rescan is idempotent (states found by key are kept).
        chunk._fluidScanned = false;
        chunk._spawnerScanned = false;
        chunk._chestScanned = false;
        if (!chunk.modified) this.chunks.delete(key);
      } else if (chunk.mesh && dx * dx + dz * dz > meshKeepR2) {
        disposeChunkMesh(chunk);
        this.meshedCount--;
        chunk._fluidScanned = false;
        chunk._spawnerScanned = false;
        chunk._chestScanned = false;
      }
    }
  }

  streamStats() {
    return { loaded: this.chunks.size, meshed: this.meshedCount };
  }
}
