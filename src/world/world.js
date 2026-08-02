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
  constructor({ seed = TERRAIN.SEED } = {}) {
    this.generator = new TerrainGenerator(seed);
    this.chunks = new Map(); // "cx,cz" -> Chunk
    this.scene = null;       // set by bindScene once rendering starts
    this.materials = null;
    this.onBlockChanged = null; // optional (x, y, z, id) hook fired by
                                // setBlock — falling-block support checks
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
  // loaded) dirty so Phase 3 remeshes them.
  setBlock(x, y, z, id) {
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
    chunk.modified = true; // player edits — this chunk's data is never dropped

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

    this.onBlockChanged?.(x, y, z, id);
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
  }

  // Call once per frame with the camera/player position. Generates missing
  // chunk data, builds missing or dirty meshes nearest-first, and unloads
  // whatever fell out of range — all within STREAMING.FRAME_BUDGET_MS.
  updateStreaming(pos) {
    if (!this.scene) return;
    const pcx = Math.floor(pos.x / SIZE);
    const pcz = Math.floor(pos.z / SIZE);
    if (pcx !== this._pcx || pcz !== this._pcz) {
      this._pcx = pcx;
      this._pcz = pcz;
      this._unloadFar(pcx, pcz);
    }
    this._streamPass(pcx, pcz, STREAMING.FRAME_BUDGET_MS, VIEW.DISTANCE_CHUNKS);
  }

  // One pass over the candidate ring, nearest first. Cheap checks are free;
  // heavy work (generating a chunk, building a mesh) spends the budget. The
  // first heavy task of a pass always runs, so progress is guaranteed.
  _streamPass(pcx, pcz, budgetMs, meshRadius) {
    const t0 = performance.now();
    const meshR2 = meshRadius * meshRadius;
    // Meshes kept by unload hysteresis can still turn dirty (border edits);
    // remesh them too rather than rendering stale geometry.
    const keepR = meshRadius + STREAMING.UNLOAD_MARGIN;
    const keepR2 = keepR * keepR;
    const genR = meshRadius + 1;
    for (const o of this._offsets) {
      const cx = pcx + o.dx;
      const cz = pcz + o.dz;
      const chunk = this.getChunkIfLoaded(cx, cz);
      if (!chunk) {
        if (Math.max(Math.abs(o.dx), Math.abs(o.dz)) > genR) continue;
        if (performance.now() - t0 >= budgetMs) return;
        this.getChunk(cx, cz); // generates; meshing happens on a later pass
        continue;
      }
      const wantsMesh = o.d2 <= meshR2
        ? !chunk.mesh || chunk.dirty
        : o.d2 <= keepR2 && !!chunk.mesh && chunk.dirty;
      if (!wantsMesh) continue;
      if (!this._neighborsLoaded(cx, cz)) continue;
      if (performance.now() - t0 >= budgetMs) return;
      this._remesh(chunk);
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

  _remesh(chunk) {
    if (chunk.mesh) {
      disposeChunkMesh(chunk);
      this.meshedCount--;
    }
    chunk.mesh = buildChunkMesh(
      chunk,
      (cx, cz) => this.getChunkIfLoaded(cx, cz),
      this.materials,
    );
    this.scene.add(chunk.mesh.group);
    this.meshedCount++;
    chunk.dirty = false;
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
        if (!chunk.modified) this.chunks.delete(key);
      } else if (chunk.mesh && dx * dx + dz * dz > meshKeepR2) {
        disposeChunkMesh(chunk);
        this.meshedCount--;
      }
    }
  }

  streamStats() {
    return { loaded: this.chunks.size, meshed: this.meshedCount };
  }
}
