// dimensions/end.js — the End, complete (Phase 20; the Phase 19 island was
// reported far too small and is replaced wholesale here). SPEC: a central
// end-stone island ~100 blocks across floating in void, 10 obsidian pillars
// ringing the centre 40-70 blocks tall (an end crystal on each — the
// crystals themselves are entities, entities/crystals.js), the inactive
// bedrock exit portal fountain at the centre, and the obsidian arrival
// platform on the island margin.
//
// Same generator interface as dimensions/nether.js (World consumes it):
// generateChunk(chunk), heightAt(x, z), biomeAt(x, z). Everything is a
// pure function of (seed, x, z) — chunk order can never change the island.
// The pillar layout (`pillars()`) and the exit-portal cell list
// (`exitPortalCells()`) are the shared truth the dragon fight reads: main.js
// passes the ONE EndGenerator instance both to the dimension def and to
// entities/dragon.js (the stronghold-blueprint pattern).

import { END, CHUNK } from '../config.js';
import { BLOCK } from '../world/blocks.js';
import { mulberry32, SimplexNoise, fbm2 } from '../world/noise.js';

const SALT_PILLARS = 0xe4d3;

export class EndGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    this.edgeNoise = new SimplexNoise(mulberry32(this.seed ^ 0xe4d1));
    this.surfaceNoise = new SimplexNoise(mulberry32(this.seed ^ 0xe4d2));
    this._pillars = null;
  }

  // The 10 obsidian pillars: deterministic ring layout. Heights climb from
  // MIN to MAX around the ring in a seeded rotation (the vanilla spiral
  // read); radii and exact angles jitter a little. Each entry:
  // { x, z, radius, top } — `top` is the y of the pillar's highest solid
  // block (the bedrock crystal seat).
  pillars() {
    if (this._pillars) return this._pillars;
    const P = END.PILLARS;
    const rng = mulberry32(this.seed ^ SALT_PILLARS);
    const count = END.PILLAR_COUNT;
    const startIndex = Math.floor(rng() * count); // where the shortest sits
    const list = [];
    for (let k = 0; k < count; k++) {
      const angle = (k / count) * Math.PI * 2 +
        (rng() * 2 - 1) * P.ANGLE_JITTER;
      const ring = P.RING_RADIUS + (rng() * 2 - 1) * 2;
      const rank = (k - startIndex + count) % count;
      const height = Math.round(
        END.PILLAR_MIN_HEIGHT +
        (rank / (count - 1)) * (END.PILLAR_MAX_HEIGHT - END.PILLAR_MIN_HEIGHT),
      );
      const radius = P.RADIUS_MIN +
        Math.floor(rng() * (P.RADIUS_MAX - P.RADIUS_MIN + 1));
      list.push({
        x: Math.round(Math.cos(angle) * ring),
        z: Math.round(Math.sin(angle) * ring),
        radius,
        top: END.ISLAND_TOP_Y + height,
      });
    }
    this._pillars = list;
    return list;
  }

  // The exit portal well: the cells that hold end portal blocks once the
  // dragon dies (AIR until then). One block above the bedrock base, minus
  // the central column.
  exitPortalCells() {
    const E = END.EXIT_PORTAL;
    const cells = [];
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > E.WELL_RADIUS_SQ || (dx === 0 && dz === 0)) continue;
        cells.push({ x: E.X + dx, y: END.ISLAND_TOP_Y + 1, z: E.Z + dz });
      }
    }
    return cells;
  }

  // Where the dragon perches and the egg spawns: atop the fountain column.
  fountainTop() {
    const E = END.EXIT_PORTAL;
    return { x: E.X, y: END.ISLAND_TOP_Y + E.PILLAR_HEIGHT, z: E.Z };
  }

  // Island columns: solid end stone from a tapering underside up to a
  // gently undulating surface; a ragged, noise-wobbled coastline; a
  // dead-flat plateau around the centre so the exit portal sits flush.
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
    // Surface undulation fades out entirely inside the central plateau.
    const flat = Math.max(0, Math.min(1, (r - END.FLAT_RADIUS) / END.FLAT_BLEND));
    const surf = fbm2(this.surfaceNoise, x * 0.03, z * 0.03, 2) *
      END.SURFACE_WOBBLE * flat;
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
    const E = END.EXIT_PORTAL;
    const pillars = this.pillars();
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

        // Obsidian pillars: every column inside a pillar's cylinder fills
        // from a few blocks under the surface up to the pillar top; the
        // centre column caps with bedrock (the crystal's seat).
        for (const p of pillars) {
          const dx = wx - p.x;
          const dz = wz - p.z;
          if (dx * dx + dz * dz > p.radius * p.radius) continue;
          const base = (col ? col.top : END.ISLAND_TOP_Y) - END.PILLARS.ROOT_DEPTH;
          for (let y = Math.max(END.MIN_Y, base); y <= p.top; y++) {
            chunk.set(lx, y, lz, BLOCK.OBSIDIAN);
          }
          if (dx === 0 && dz === 0) chunk.set(lx, p.top, lz, BLOCK.BEDROCK);
        }

        // The exit portal fountain (inactive): bedrock base disc, raised
        // rim, empty well (the dragon's death fills it with end portal),
        // central bedrock column with torches near the top.
        const ex = wx - E.X;
        const ez = wz - E.Z;
        const e2 = ex * ex + ez * ez;
        if (e2 <= E.BASE_RADIUS_SQ) {
          const baseY = END.ISLAND_TOP_Y;
          chunk.set(lx, baseY, lz, BLOCK.BEDROCK);
          for (let d = 1; d <= E.CLEARANCE; d++) {
            chunk.set(lx, baseY + d, lz, BLOCK.AIR);
          }
          if (ex === 0 && ez === 0) {
            // The central column the egg lands on.
            for (let d = 1; d <= E.PILLAR_HEIGHT; d++) {
              chunk.set(lx, baseY + d, lz, BLOCK.BEDROCK);
            }
          } else if (e2 > E.WELL_RADIUS_SQ) {
            chunk.set(lx, baseY + 1, lz, BLOCK.BEDROCK); // the rim
          }
          // Torches on the column's shoulders, one below the top (their
          // support is the bedrock column beside them).
          const torchY = baseY + E.PILLAR_HEIGHT - 1;
          if (ex === 1 && ez === 0) chunk.set(lx, torchY, lz, BLOCK.TORCH_WALL_E);
          if (ex === -1 && ez === 0) chunk.set(lx, torchY, lz, BLOCK.TORCH_WALL_W);
          if (ex === 0 && ez === 1) chunk.set(lx, torchY, lz, BLOCK.TORCH_WALL_S);
          if (ex === 0 && ez === -1) chunk.set(lx, torchY, lz, BLOCK.TORCH_WALL_N);
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
    for (const p of this.pillars()) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz <= p.radius * p.radius) return p.top;
    }
    const col = this._columnAt(x, z);
    return col ? col.top : END.MIN_Y;
  }

  biomeAt() {
    return 'end';
  }
}
