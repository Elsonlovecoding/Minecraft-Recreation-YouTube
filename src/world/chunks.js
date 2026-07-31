// world/chunks.js — Chunk data storage. One chunk is a CHUNK.SIZE x
// CHUNK.HEIGHT x CHUNK.SIZE column of block ids in a flat Uint8Array.
// Meshing and face culling are added here in Phase 3; the `dirty` flag
// already marks chunks whose mesh will need rebuilding.

import { CHUNK, OVERWORLD } from '../config.js';
import { BLOCK } from './blocks.js';

const SIZE = CHUNK.SIZE;
const HEIGHT = CHUNK.HEIGHT;
const MIN_Y = OVERWORLD.MIN_Y;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    // Uint8Array starts zeroed = all BLOCK.AIR. Indexed y-fastest so a
    // vertical column is contiguous (generation and lighting walk columns).
    this.blocks = new Uint8Array(SIZE * SIZE * HEIGHT);
    this.dirty = true; // mesh needs (re)building — consumed in Phase 3
  }

  // lx/lz must be 0..SIZE-1 (world.js converts world coords); y is a world
  // coordinate. Outside the vertical range reads as air, writes are ignored.
  static index(lx, y, lz) {
    return (lz * SIZE + lx) * HEIGHT + (y - MIN_Y);
  }

  get(lx, y, lz) {
    if (y < MIN_Y || y >= MIN_Y + HEIGHT) return BLOCK.AIR;
    return this.blocks[Chunk.index(lx, y, lz)];
  }

  set(lx, y, lz, id) {
    if (y < MIN_Y || y >= MIN_Y + HEIGHT) return;
    this.blocks[Chunk.index(lx, y, lz)] = id;
  }
}
