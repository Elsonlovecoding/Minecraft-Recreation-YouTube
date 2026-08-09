// dimensions/nether.js — the Nether. Phase 15 ships only the PLACEHOLDER
// generator: a flat netherrack plain over a bedrock floor, under the fixed
// red sky (config NETHER_SKY), so the portal has somewhere real to arrive
// and link. The genuine Nether — netherrack caverns, lava oceans, soul
// sand, glowstone, fortresses, blazes and ghasts — is the next session's
// work and replaces PlaceholderNetherGenerator behind the same interface.
//
// The generator interface matches world/terrain.js TerrainGenerator as far
// as World consumes it: generateChunk(chunk), heightAt(x, z), biomeAt(x, z).
// Chunks share the overworld's storage shape (16 x 384 x 16, y -64..320);
// the Nether's own y range 0..128 (config NETHER) simply generates inside
// that space.

import { NETHER, CHUNK } from '../config.js';
import { BLOCK } from '../world/blocks.js';

export class PlaceholderNetherGenerator {
  constructor(seed) {
    this.seed = seed | 0;
  }

  generateChunk(chunk) {
    const P = NETHER.PLACEHOLDER;
    for (let lz = 0; lz < CHUNK.SIZE; lz++) {
      for (let lx = 0; lx < CHUNK.SIZE; lx++) {
        for (let y = P.BEDROCK_TOP_Y - 1; y <= P.FLOOR_Y; y++) {
          chunk.set(
            lx, y, lz,
            y <= P.BEDROCK_TOP_Y ? BLOCK.BEDROCK : BLOCK.NETHERRACK,
          );
        }
      }
    }
  }

  heightAt() {
    return NETHER.PLACEHOLDER.FLOOR_Y;
  }

  biomeAt() {
    return 'nether';
  }
}
