// world/world.js — Chunk manager: get/set block by world coordinates,
// generating chunks on demand. All other systems read and write the world
// through this module.

import { CHUNK, OVERWORLD, TERRAIN } from '../config.js';
import { Chunk } from './chunks.js';
import { TerrainGenerator } from './terrain.js';
import { BLOCK, isSolid } from './blocks.js';

const SIZE = CHUNK.SIZE;

export class World {
  constructor({ seed = TERRAIN.SEED } = {}) {
    this.generator = new TerrainGenerator(seed);
    this.chunks = new Map(); // "cx,cz" -> Chunk
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

    const markDirty = (ncx, ncz) => {
      const n = this.getChunkIfLoaded(ncx, ncz);
      if (n) n.dirty = true;
    };
    if (lx === 0) markDirty(cx - 1, cz);
    if (lx === SIZE - 1) markDirty(cx + 1, cz);
    if (lz === 0) markDirty(cx, cz - 1);
    if (lz === SIZE - 1) markDirty(cx, cz + 1);
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
}
