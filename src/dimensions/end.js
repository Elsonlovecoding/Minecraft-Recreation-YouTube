// dimensions/end.js — the End. Phase 19 builds the central island (the end
// portal's destination — SPEC: a floating end-stone island ~100 blocks
// across over void) and the obsidian arrival platform; the obsidian
// pillars, crystals, exit portal and the dragon are the next phase, layered
// onto this generator the way the fortress pass layers onto the Nether's.
//
// Same generator interface as dimensions/nether.js (World consumes it):
// generateChunk(chunk), heightAt(x, z), biomeAt(x, z). Everything is a
// pure function of (seed, x, z) — chunk order can never change the island.

import { END, CHUNK } from '../config.js';
import { BLOCK } from '../world/blocks.js';
import { mulberry32, SimplexNoise, fbm2 } from '../world/noise.js';

export class EndGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    this.edgeNoise = new SimplexNoise(mulberry32(this.seed ^ 0xe4d1));
    this.surfaceNoise = new SimplexNoise(mulberry32(this.seed ^ 0xe4d2));
  }

  // Island columns: solid end stone from a tapering underside up to a
  // gently undulating surface; a ragged, noise-wobbled coastline.
  _columnAt(x, z) {
    const r = Math.hypot(x, z);
    const angle = Math.atan2(z, x);
    // Coastline wobble sampled on the ring (periodic in the angle by
    // construction: the noise reads a point moving on a circle).
    const wob = this.edgeNoise.noise2(
      Math.cos(angle) * END.EDGE_WOBBLE_SCALE * 4,
      Math.sin(angle) * END.EDGE_WOBBLE_SCALE * 4,
    ) * END.EDGE_WOBBLE;
    const radius = END.ISLAND_RADIUS + wob;
    if (r >= radius) return null;
    const f = 1 - (r / radius) ** 2; // 1 at the centre, 0 at the coast
    const surf = fbm2(this.surfaceNoise, x * 0.03, z * 0.03, 2) * END.SURFACE_WOBBLE;
    const top = Math.round(END.ISLAND_TOP_Y + surf * f);
    const depth = Math.max(1, Math.round(END.ISLAND_MAX_DEPTH * f ** 1.5) +
      Math.round(surf));
    return { top, bottom: top - depth };
  }

  generateChunk(chunk) {
    const size = CHUNK.SIZE;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;
    const P = END.PLATFORM;
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const col = this._columnAt(wx, wz);
        if (col) {
          for (let y = Math.max(END.MIN_Y, col.bottom); y <= col.top; y++) {
            chunk.set(lx, y, lz, BLOCK.END_STONE);
          }
        }
        // The obsidian arrival platform (on the island margin, so stepping
        // off it can never soft-lock over the void), clear air above.
        if (
          Math.abs(wx - P.X) <= P.RADIUS && Math.abs(wz - P.Z) <= P.RADIUS
        ) {
          chunk.set(lx, END.ISLAND_TOP_Y, lz, BLOCK.OBSIDIAN);
          for (let d = 1; d <= P.CLEARANCE; d++) {
            chunk.set(lx, END.ISLAND_TOP_Y + d, lz, BLOCK.AIR);
          }
        }
      }
    }
  }

  heightAt(x, z) {
    const col = this._columnAt(x, z);
    return col ? col.top : END.MIN_Y;
  }

  biomeAt() {
    return 'end';
  }
}
