// world/caverns.js — Phase 23: GREAT CAVERNS, the large-chamber generation
// pass. Separate from the tunnel noise on purpose, and separate from
// world/caves.js as a file per the ARCHITECTURE size cap.
//
// Why this is not another noise layer. Three phases tried to grow big rooms by
// thresholding a 3D field (the old CAVES.MEGA): pick a low frequency, pick a
// high threshold, hope rooms fall out. Measured over a 256x256 region that
// pass carved about one cell in a thousand of the band it was allowed to touch
// and produced scattered fragments — a noise iso-surface near its own 95th
// percentile is a thin scatter of blobs, not a room, and no amount of retuning
// changes that shape. So caverns are PLACED here:
//
//   the world is tiled into GREAT_CAVERN.REGION_SIZE squares
//   each region deterministically hosts at most one chamber (CHANCE)
//   its centre, radii, height, shelf and connectors come from that region's
//     hash — so the size is a number in config, not something to hope for:
//     36-58 blocks on the long axis, at least 30 on the short one, 20-40 tall
//
// The chamber body is a superellipsoid whose y exponent (POWER_Y > 2) flattens
// floor and ceiling into an actual room, with its radius pushed in and out by
// a low-frequency 3D field so the walls are irregular. A 2D SHELF noise leaves
// part of a mid-height slab uncarved: that is what makes a chamber multi-level
// — a ledge you stand on with a drop to the floor below. Two connector bores
// leave near floor height and climb outward until they run into the tunnel
// network, so a chamber is always reachable.
//
// Everything is a pure function of (seed, world position). A chunk carves only
// the part of a chamber that falls inside it, and asks its 3x3 neighbourhood
// of regions which chambers could reach it, so chunks agree on every border
// cell whatever order they generate in.
//
// All tunables live in config.js CAVES.GREAT_CAVERN.

import { CAVES, CHUNK } from '../config.js';
import { mulberry32, hash2, Field3D, SimplexNoise, fbm2 } from './noise.js';

const SALT_REGION = 0x9ca4e001;

export class GreatCaverns {
  constructor(seed) {
    this.seed = seed | 0;
    const G = CAVES.GREAT_CAVERN;
    this.warp = new Field3D(
      mulberry32(this.seed ^ 0x9ca4e002),
      G.WARP.SCALE_XZ, G.WARP.SCALE_Y, G.WARP.OCTAVES,
    );
    this.shelf = new SimplexNoise(mulberry32(this.seed ^ 0x9ca4e003));
    this._cache = new Map(); // region key -> chamber | null
  }

  // --- placement ------------------------------------------------------------

  // The chamber a region hosts, or null. Pure in (seed, rx, rz) and cached,
  // because every chunk in and around a region asks for the same answer.
  chamberIn(rx, rz) {
    const key = `${rx},${rz}`;
    let c = this._cache.get(key);
    if (c !== undefined) return c;
    c = this._buildChamber(rx, rz);
    // The cache is unbounded in principle but bounded in practice: a region
    // is 224 blocks, so a loaded world touches a handful. Trim anyway so a
    // long session walking in one direction can't grow it without limit.
    if (this._cache.size > 512) this._cache.clear();
    this._cache.set(key, c);
    return c;
  }

  _buildChamber(rx, rz) {
    const G = CAVES.GREAT_CAVERN;
    const rng = mulberry32(hash2(this.seed ^ SALT_REGION, rx, rz));
    if (rng() >= G.CHANCE) return null;

    // Centre, kept MARGIN inside the region so two neighbouring chambers can
    // never reach each other (max radius <= MARGIN by construction below).
    const span = G.REGION_SIZE - 2 * G.MARGIN;
    const x = rx * G.REGION_SIZE + G.MARGIN + Math.floor(rng() * span);
    const z = rz * G.REGION_SIZE + G.MARGIN + Math.floor(rng() * span);

    // Radii: one axis anywhere in range, the other at least RADIUS_ASPECT of
    // it, so chambers are round-ish rather than slot-shaped.
    const rSpan = G.RADIUS_MAX - G.RADIUS_MIN;
    const rA = G.RADIUS_MIN + rng() * rSpan;
    const rB = Math.max(G.RADIUS_MIN, rA * (G.RADIUS_ASPECT + rng() * (1 - G.RADIUS_ASPECT)));
    const swap = rng() < 0.5;
    const radiusX = swap ? rA : rB;
    const radiusZ = swap ? rB : rA;

    const height = G.HEIGHT_MIN + rng() * (G.HEIGHT_MAX - G.HEIGHT_MIN);
    const radiusY = height / 2;
    // Centre y: the whole chamber must sit inside MIN_Y..MAX_Y.
    const yLo = G.MIN_Y + radiusY;
    const yHi = G.MAX_Y - radiusY;
    const y = yHi <= yLo ? (G.MIN_Y + G.MAX_Y) / 2 : yLo + rng() * (yHi - yLo);

    const S = G.SHELF;
    const hasShelf = rng() < S.CHANCE;
    // Shelf height measured up from the chamber floor.
    const shelfY = y - radiusY + height * (S.LEVEL_MIN + rng() * (S.LEVEL_MAX - S.LEVEL_MIN));
    const shelfPhase = rng() * 1000;

    const C = G.CONNECTORS;
    const connectors = [];
    const baseAngle = rng() * Math.PI * 2;
    for (let i = 0; i < C.COUNT; i++) {
      connectors.push({
        // Spread the bores around the chamber rather than letting two land on
        // top of each other.
        angle: baseAngle + (i / C.COUNT) * Math.PI * 2 + (rng() - 0.5) * 0.9,
        length: C.LENGTH_MIN + rng() * (C.LENGTH_MAX - C.LENGTH_MIN),
        sway: (rng() - 0.5) * 2,
        y: y - radiusY + C.FLOOR_OFFSET,
      });
    }

    // The reach of everything this chamber writes — chunks outside it skip
    // the chamber entirely.
    // Two boxes, because they are wildly different sizes: the chamber body is
    // ~60 blocks across, the connectors reach ten times its radius but are
    // only a few blocks thick. Carving each over its own box keeps the cost
    // of a chamber proportional to what it actually writes.
    const bodyR = Math.max(radiusX, radiusZ) * (1 + G.WARP.AMOUNT) + 2;
    const bodyRY = radiusY * (1 + G.WARP.AMOUNT) + 2;
    const body = {
      minX: x - bodyR, maxX: x + bodyR,
      minZ: z - bodyR, maxZ: z + bodyR,
      minY: Math.floor(y - bodyRY), maxY: Math.ceil(y + bodyRY),
    };
    for (const k of connectors) {
      // The bore's own box: the run's swept rectangle, padded by the sway and
      // the bore radius, and the climb it makes over that run.
      const pad = C.RADIUS + 2 + Math.abs(k.sway) * C.WANDER * k.length * 0.25;
      const ex = x + Math.cos(k.angle) * k.length;
      const ez = z + Math.sin(k.angle) * k.length;
      k.minX = Math.min(x, ex) - pad;
      k.maxX = Math.max(x, ex) + pad;
      k.minZ = Math.min(z, ez) - pad;
      k.maxZ = Math.max(z, ez) + pad;
      k.minY = Math.floor(k.y - C.RADIUS) - 1;
      k.maxY = Math.ceil(k.y + k.length * C.RISE + C.RADIUS) + 1;
    }
    const reach = Math.max(
      bodyR,
      ...connectors.map((k) => Math.max(
        k.maxX - x, x - k.minX, k.maxZ - z, z - k.minZ,
      )),
    );
    return {
      x, y, z, radiusX, radiusY, radiusZ, height,
      hasShelf, shelfY, shelfPhase, connectors, body,
      minX: x - reach, maxX: x + reach,
      minZ: z - reach, maxZ: z + reach,
      minY: Math.min(body.minY, ...connectors.map((k) => k.minY)),
      maxY: Math.max(body.maxY, ...connectors.map((k) => k.maxY)),
    };
  }

  // Every chamber whose written volume can touch the block rectangle
  // [x0, x1] x [z0, z1]. Scans the regions that rectangle plus a chamber's
  // maximum reach overlaps.
  chambersNear(x0, z0, x1, z1) {
    const G = CAVES.GREAT_CAVERN;
    // A chamber's reach never exceeds one region, so the 3x3 neighbourhood of
    // the rectangle's own regions is always enough.
    const r0x = Math.floor(x0 / G.REGION_SIZE) - 1;
    const r1x = Math.floor(x1 / G.REGION_SIZE) + 1;
    const r0z = Math.floor(z0 / G.REGION_SIZE) - 1;
    const r1z = Math.floor(z1 / G.REGION_SIZE) + 1;
    const out = [];
    for (let rz = r0z; rz <= r1z; rz++) {
      for (let rx = r0x; rx <= r1x; rx++) {
        const c = this.chamberIn(rx, rz);
        if (!c) continue;
        if (c.maxX < x0 || c.minX > x1 || c.maxZ < z0 || c.minZ > z1) continue;
        out.push(c);
      }
    }
    return out;
  }

  // --- shape ----------------------------------------------------------------

  // Is (x, y, z) inside the chamber body? The superellipsoid test with the
  // wall pushed in and out by the warp field.
  _inBody(c, x, y, z) {
    const G = CAVES.GREAT_CAVERN;
    const dx = (x - c.x) / c.radiusX;
    const dz = (z - c.z) / c.radiusZ;
    const dy = (y - c.y) / c.radiusY;
    // Cheap rejection before the noise sample — the body test runs over the
    // chamber's whole bounding box, and most of that box is outside it.
    const flat = dx * dx + dz * dz;
    if (flat > 2 || Math.abs(dy) > 1.6) return false;
    const d = flat + Math.abs(dy) ** G.POWER_Y;
    const limit = 1 + G.WARP.AMOUNT * this.warp.sample(x, y, z);
    return d < limit * limit;
  }

  // Does the mid-level shelf occupy (x, y, z)? A slab of THICKNESS at the
  // chamber's shelf height, present only where the outline noise says so and
  // only within SPAN of the centre — an irregular mezzanine with a drop off
  // its edge, not a second floor.
  _inShelf(c, x, y, z) {
    if (!c.hasShelf) return false;
    const S = CAVES.GREAT_CAVERN.SHELF;
    if (y < c.shelfY || y >= c.shelfY + S.THICKNESS) return false;
    const dx = (x - c.x) / (c.radiusX * S.SPAN);
    const dz = (z - c.z) / (c.radiusZ * S.SPAN);
    if (dx * dx + dz * dz > 1) return false;
    return fbm2(
      this.shelf,
      (x + c.shelfPhase) * S.SCALE, (z + c.shelfPhase) * S.SCALE, 2,
    ) > S.COVER;
  }

  // Distance² from (x, z) to a connector bore's axis at this y, in bore
  // radii — or Infinity when the point is past either end of the bore.
  // The bore starts at the chamber wall and climbs outward, swaying so it
  // reads as a passage rather than a drilled line.
  _connectorHit(c, k, x, y, z) {
    const C = CAVES.GREAT_CAVERN.CONNECTORS;
    const ax = Math.cos(k.angle);
    const az = Math.sin(k.angle);
    // Position along the bore = the outward component of (x, z) from centre.
    const ox = x - c.x;
    const oz = z - c.z;
    const t = ox * ax + oz * az;
    if (t < 0 || t > k.length) return false;
    // Perpendicular offset, with the sway applied as a sine along the run.
    const perp = -ox * az + oz * ax;
    const sway = k.sway * C.WANDER * k.length * 0.25 *
      Math.sin((t / Math.max(1, k.length)) * Math.PI);
    const dp = perp - sway;
    const dy = y - (k.y + t * C.RISE);
    const r = C.RADIUS;
    return dp * dp + dy * dy < r * r;
  }

  // --- chunk carve ----------------------------------------------------------

  // Carves every chamber touching this chunk. `carvable(id)` decides which
  // blocks may be removed (caves.js owns that table), `air` is the id to
  // write. Returns the per-column mask of "this column is inside a chamber",
  // which the waterfall pass uses to place springs in cavern walls.
  apply(chunk, carvable, air) {
    const size = CHUNK.SIZE;
    const x0 = chunk.cx * size;
    const z0 = chunk.cz * size;
    const inside = new Uint8Array(size * size);
    const chambers = this.chambersNear(x0, z0, x0 + size - 1, z0 + size - 1);
    if (chambers.length === 0) return inside;

    // The part of a box that falls inside this chunk, or null.
    const clip = (b) => {
      const lx0 = Math.max(0, Math.floor(b.minX) - x0);
      const lx1 = Math.min(size - 1, Math.ceil(b.maxX) - x0);
      const lz0 = Math.max(0, Math.floor(b.minZ) - z0);
      const lz1 = Math.min(size - 1, Math.ceil(b.maxZ) - z0);
      return lx0 > lx1 || lz0 > lz1 ? null : { lx0, lx1, lz0, lz1 };
    };

    for (const c of chambers) {
      const bb = clip(c.body);
      if (bb) {
        for (let lz = bb.lz0; lz <= bb.lz1; lz++) {
          const wz = z0 + lz;
          for (let lx = bb.lx0; lx <= bb.lx1; lx++) {
            const wx = x0 + lx;
            let any = false;
            for (let y = c.body.minY; y <= c.body.maxY; y++) {
              if (!this._inBody(c, wx, y, wz)) continue;
              any = true;
              if (this._inShelf(c, wx, y, wz)) continue;
              if (carvable(chunk.get(lx, y, lz))) chunk.set(lx, y, lz, air);
            }
            // The mask marks chamber columns only — a connector bore passing
            // through is a tunnel, not a room.
            if (any) inside[lz * size + lx] = 1;
          }
        }
      }
      for (const k of c.connectors) {
        const kb = clip(k);
        if (!kb) continue;
        for (let lz = kb.lz0; lz <= kb.lz1; lz++) {
          const wz = z0 + lz;
          for (let lx = kb.lx0; lx <= kb.lx1; lx++) {
            const wx = x0 + lx;
            for (let y = k.minY; y <= k.maxY; y++) {
              if (!this._connectorHit(c, k, wx, y, wz)) continue;
              if (carvable(chunk.get(lx, y, lz))) chunk.set(lx, y, lz, air);
            }
          }
        }
      }
    }
    return inside;
  }
}
