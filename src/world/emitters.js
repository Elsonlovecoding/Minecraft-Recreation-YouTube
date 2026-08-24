// world/emitters.js — the chunk mesher's per-block lookup tables and the
// special-shape emitters (torch box model, flowing-lava cells, the nether
// portal slab, and — Phase 17 — the nether wart crop), split out of
// world/chunks.js per the ARCHITECTURE file-size cap note that file carried
// since Phase 15 ("the special-shape emitters are the natural cut"). The
// emitter bodies moved verbatim; they close over per-mesh state
// (buckets, the light window, the neighbour lookup), so buildChunkMesh
// creates them per mesh through createSpecialEmitters(ctx).

import {
  CHUNK, OVERWORLD, LIGHTING, SHAPES, FLUIDS,
} from '../config.js';
import {
  BLOCK, BLOCKS, LAVA_LEVEL_OF, WATER_LEVEL_OF, WART_STAGE,
  HAS_SHAPE, FLUSH_RECTS, shapeBoxesAt, fluidHeight, CROSS_PLANT_TILE,
} from './blocks.js';
import { getUV, TILE } from '../render/atlas.js';

const SIZE = CHUNK.SIZE;
const HEIGHT = CHUNK.HEIGHT;
const MIN_Y = OVERWORLD.MIN_Y;

// ---------------------------------------------------------------------------
// Per-block lookup tables, flattened from the registry for the hot loop
// ---------------------------------------------------------------------------

// Render buckets: which material pass a block's faces belong to.
export const PASS_NONE = 0;    // no cube faces (air, portals — special-cased)
export const PASS_OPAQUE = 1;
export const PASS_CUTOUT = 2;  // alpha-tested: leaves, cactus, glass, torch, bars
export const PASS_WATER = 3;   // alpha-blended
export const PASS_LAVA = 4;    // flowing lava (partial-height animated cells)
export const PASS_PORTAL = 5;  // nether portal interior (animated swirl)
export const PASS_WATER_FLOW = 6; // flowing water (Phase 21 — the lava pass's
                                  // twin, on its own scrolling water texture)
export const PASS_COUNT = 7;

const NUM_IDS = BLOCKS.length;
export const IS_TRANSPARENT = new Uint8Array(NUM_IDS); // does not occlude neighbours
export const OCCLUDES_AO = new Uint8Array(NUM_IDS);    // darkens AO corners (registry flag)
export const SELF_CULL = new Uint8Array(NUM_IDS);      // merge same-id runs (water, glass);
                                                       // 0 for leaves/cactus: interior
                                                       // planes render, one quad each
export const INSET = new Float32Array(NUM_IDS);        // side faces pulled into the cell
export const PASS = new Uint8Array(NUM_IDS);
export const TILES = [];                               // per id: [px,nx,py,ny,pz,nz] or null

for (let id = 0; id < NUM_IDS; id++) {
  const def = BLOCKS[id];
  IS_TRANSPARENT[id] = def.transparent ? 1 : 0;
  OCCLUDES_AO[id] = def.occludesAO ? 1 : 0;
  SELF_CULL[id] = def.selfCull ? 1 : 0;
  INSET[id] = def.inset;
  TILES[id] = def.tiles;
  PASS[id] = !def.tiles ? PASS_NONE
    : id === BLOCK.WATER ? PASS_WATER
    : def.transparent ? PASS_CUTOUT
    : PASS_OPAQUE;
}

// Fluid family tables (Phase 12 for lava; Phase 21 added water on the same
// machinery): flowing/falling cells render through the partial-height fluid
// emitter, lava into PASS_LAVA and water into PASS_WATER_FLOW; SOURCES keep
// their normal full-cube path (lakes and oceans look exactly as before).
// Heights per id come from FLUIDS config — each horizontal step visibly
// lower, which is what makes a spreading pool read as a slope.
export const IS_LAVA_CELL = new Uint8Array(NUM_IDS);   // source, flows and falls
export const IS_LAVA_FLOW = new Uint8Array(NUM_IDS);   // flows and falls only
export const LAVA_HEIGHT = new Float32Array(NUM_IDS);  // rendered surface height
export const IS_WATER_CELL = new Uint8Array(NUM_IDS);
export const IS_WATER_FLOW = new Uint8Array(NUM_IDS);
// Every fluid cell of either family, and the surface height of each — the
// emitter is shared, so it reads these rather than a per-family table.
export const IS_FLUID_CELL = new Uint8Array(NUM_IDS);
export const IS_FLUID_FLOW = new Uint8Array(NUM_IDS);
export const FLUID_HEIGHT = new Float32Array(NUM_IDS);
export const FLUID_PASS = new Uint8Array(NUM_IDS);
for (let id = 0; id < NUM_IDS; id++) {
  const level = LAVA_LEVEL_OF[id];
  if (level < 0) continue;
  IS_LAVA_CELL[id] = 1;
  if (id === BLOCK.LAVA) {
    LAVA_HEIGHT[id] = 1;
  } else {
    IS_LAVA_FLOW[id] = 1;
    LAVA_HEIGHT[id] =
      id === BLOCK.LAVA_FALL ? FLUIDS.FALL_HEIGHT : FLUIDS.FLOW_HEIGHTS[level - 1];
  }
}
for (let id = 0; id < NUM_IDS; id++) {
  const level = WATER_LEVEL_OF[id];
  if (level < 0) continue;
  IS_WATER_CELL[id] = 1;
  if (id !== BLOCK.WATER) IS_WATER_FLOW[id] = 1;
}
for (let id = 0; id < NUM_IDS; id++) {
  if (IS_LAVA_CELL[id]) {
    IS_FLUID_CELL[id] = 1;
    IS_FLUID_FLOW[id] = IS_LAVA_FLOW[id];
    FLUID_HEIGHT[id] = fluidHeight(id);
    FLUID_PASS[id] = PASS_LAVA;
  } else if (IS_WATER_CELL[id]) {
    IS_FLUID_CELL[id] = 1;
    IS_FLUID_FLOW[id] = IS_WATER_FLOW[id];
    FLUID_HEIGHT[id] = fluidHeight(id);
    FLUID_PASS[id] = PASS_WATER_FLOW;
  }
}
// Flow side faces sit a hair inside their cell so they can never z-fight a
// transparent neighbour's face on the shared boundary plane (glass, water).
const LAVA_SIDE_INSET = 0.001;

// Nether portal interior (Phase 15): a 4/16-thick vertical slab of animated
// purple, PASS_PORTAL bucket. The two big faces sit at 6/16 and 10/16
// across the portal's thin axis (the vanilla block shape).
const PORTAL_PLANE_MIN = 6 / 16;
const PORTAL_PLANE_MAX = 10 / 16;

// Nether wart crop height per block id (Phase 17), from the stage table —
// undefined/0 = not a wart. The dispatch check in buildChunkMesh reads this.
export const WART_HEIGHT = new Float32Array(NUM_IDS);
for (const [id, stage] of Object.entries(WART_STAGE)) {
  WART_HEIGHT[id] = SHAPES.WART.STAGE_HEIGHTS[stage];
}

// Cross-plane plants (Phase 24): per-id atlas tile, -1 = not a plant. The
// dispatch check in buildChunkMesh reads this — before the generic cube
// path, so the plants' registry `faces` (kept for break particles and item
// art) never emit cube geometry.
export const CROSS_TILE = new Int16Array(NUM_IDS).fill(-1);
for (const [id, tile] of Object.entries(CROSS_PLANT_TILE)) CROSS_TILE[id] = tile;

// ---------------------------------------------------------------------------
// Torch box model (Phase 11) — a WIDTH x HEIGHT x WIDTH post: floor torches
// stand centred on the cell floor; wall torches pivot at the wall, raised
// WALL_BASE_Y and tilted WALL_ANGLE out of it (vanilla template_torch_wall).
// Sides sample the 2px art column of the TORCH tile, the top the flame
// pixels, the bottom the stick base — the vanilla model UVs.
// ---------------------------------------------------------------------------

// Face corners in torch-local (a, h, b) space: a along the lean direction,
// h up the post, b across it. Corner order matches FACES: (0,0) (1,0) (0,1)
// (1,1) in each face's UV frame.
const TORCH_FACES = (() => {
  const w2 = SHAPES.TORCH.WIDTH / 2;
  const H = SHAPES.TORCH.HEIGHT;
  // uv: [u0..u1, v0..v1] as fractions of the torch tile
  const SIDE_UV = [7 / 16, 9 / 16, 0, 10 / 16];
  const TOP_UV = [7 / 16, 9 / 16, 8 / 16, 10 / 16];
  const BOTTOM_UV = [7 / 16, 9 / 16, 0, 2 / 16];
  return [
    { corners: [[w2, 0, -w2], [w2, 0, w2], [w2, H, -w2], [w2, H, w2]], uv: SIDE_UV, brightness: 'side' },
    { corners: [[-w2, 0, w2], [-w2, 0, -w2], [-w2, H, w2], [-w2, H, -w2]], uv: SIDE_UV, brightness: 'side' },
    { corners: [[-w2, 0, w2], [w2, 0, w2], [-w2, H, w2], [w2, H, w2]], uv: SIDE_UV, brightness: 'side' },
    { corners: [[w2, 0, -w2], [-w2, 0, -w2], [w2, H, -w2], [-w2, H, -w2]], uv: SIDE_UV, brightness: 'side' },
    { corners: [[-w2, H, -w2], [w2, H, -w2], [-w2, H, w2], [w2, H, w2]], uv: TOP_UV, brightness: 'top' },
    { corners: [[-w2, 0, w2], [w2, 0, w2], [-w2, 0, -w2], [w2, 0, -w2]], uv: BOTTOM_UV, brightness: 'bottom' },
  ];
})();

// ---------------------------------------------------------------------------
// Face geometry table (shared with the generic cube emitter in chunks.js)
// ---------------------------------------------------------------------------

// One entry per face in blocks.js tiles order [px, nx, py, ny, pz, nz].
// corners: [x, y, z, u, v] per vertex, ordered (0,0) (1,0) (0,1) (1,1) in the
// face's UV frame so side textures are upright (v up) and not mirrored.
// Winding is CCW seen from outside the block.
export const FACES = [
  { dir: [1, 0, 0],  corners: [[1, 0, 1, 0, 0], [1, 0, 0, 1, 0], [1, 1, 1, 0, 1], [1, 1, 0, 1, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 0, 0, 0], [0, 0, 1, 1, 0], [0, 1, 0, 0, 1], [0, 1, 1, 1, 1]] },
  { dir: [0, 1, 0],  corners: [[0, 1, 1, 0, 0], [1, 1, 1, 1, 0], [0, 1, 0, 0, 1], [1, 1, 0, 1, 1]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0, 0, 0], [1, 0, 0, 1, 0], [0, 0, 1, 0, 1], [1, 0, 1, 1, 1]] },
  { dir: [0, 0, 1],  corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
];

// Precompute per face: brightness class and, per corner, the three
// neighbouring cells (two edge-adjacent + one diagonal, all in the plane just
// outside the face) whose opacity produces ambient occlusion at that corner.
for (const face of FACES) {
  const [dx, dy, dz] = face.dir;
  face.brightness = dy > 0 ? LIGHTING.FACE_BRIGHTNESS.top
    : dy < 0 ? LIGHTING.FACE_BRIGHTNESS.bottom
    : LIGHTING.FACE_BRIGHTNESS.side;
  const normalAxis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
  const [t1, t2] = [0, 1, 2].filter((a) => a !== normalAxis);
  face.ao = face.corners.map((c) => {
    const s1 = c[t1] ? 1 : -1;
    const s2 = c[t2] ? 1 : -1;
    const side1 = [dx, dy, dz]; side1[t1] += s1;
    const side2 = [dx, dy, dz]; side2[t2] += s2;
    const corner = [dx, dy, dz]; corner[t1] += s1; corner[t2] += s2;
    return [side1, side2, corner];
  });
}

// UV rectangles per atlas tile, computed once on first use.
const uvByTile = [];
export function tileUV(tile) {
  return uvByTile[tile] ?? (uvByTile[tile] = getUV(tile));
}

// ---------------------------------------------------------------------------
// The special-shape emitters
// ---------------------------------------------------------------------------

// Created once per buildChunkMesh call. `ctx`:
//   chunk    the centre chunk being meshed (world-space UV continuity)
//   buckets  the per-pass vertex buckets (indexed by the PASS_* constants)
//   getId    block id at chunk-local coords across the 3x3 window
//   wSky, wBlk, W  the flood-filled light window and its row stride
export function createSpecialEmitters({ chunk, buckets, getId, wSky, wBlk, W }) {
  // Torch box model: 6 quads built from TORCH_FACES, tilted for wall
  // variants, lit flat by the torch's own cell (it is the emitter — no AO,
  // no per-corner smoothing on a 2px post).
  const torchUV = tileUV(TILE.TORCH);
  const emitTorch = (lx, iy, lz, lean) => {
    const bucket = buckets[PASS_CUTOUT];
    const y = iy + MIN_Y;
    const own = ((lz + SIZE) * W + (lx + SIZE)) * HEIGHT + iy;
    const sky = wSky[own] * (1 / 15);
    const blk = wBlk[own] * (1 / 15);
    const [dx, dz] = lean;
    const wall = dx !== 0 || dz !== 0;
    const A = wall ? SHAPES.TORCH.WALL_ANGLE : 0;
    const sinA = Math.sin(A);
    const cosA = Math.cos(A);
    const px = wall ? 0.5 - dx * 0.5 : 0.5;
    const py = wall ? SHAPES.TORCH.WALL_BASE_Y : 0;
    const pz = wall ? 0.5 - dz * 0.5 : 0.5;
    // Floor torches lean nowhere; reuse the +x frame with angle 0.
    const ax = wall ? dx : 1;
    const az = wall ? dz : 0;
    const FB = LIGHTING.FACE_BRIGHTNESS;
    const du = torchUV.u1 - torchUV.u0;
    const dv = torchUV.v1 - torchUV.v0;
    for (const face of TORCH_FACES) {
      const base = bucket.count;
      const b = FB[face.brightness];
      const [fu0, fu1, fv0, fv1] = face.uv;
      for (let k = 0; k < 4; k++) {
        const [la, lh, lb] = face.corners[k];
        const along = la * cosA + lh * sinA;
        const up = -la * sinA + lh * cosA;
        bucket.pos.push(
          lx + px + ax * along - az * lb,
          y + py + up,
          lz + pz + az * along + ax * lb,
        );
        bucket.uv.push(
          torchUV.u0 + du * (k & 1 ? fu1 : fu0),
          torchUV.v0 + dv * (k & 2 ? fv1 : fv0),
        );
        bucket.col.push(b, b, b);
        bucket.lig.push(sky, blk);
      }
      bucket.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      bucket.count += 4;
    }
  };

  // Flowing/falling fluid (Phase 12 lava; Phase 21 water on the same
  // emitter): a partial-height cell in the fluid's animated bucket, lit flat
  // by its own cell for lava (it IS an emitter, like the torch) and by the
  // real baked light for water. UVs are in repeating tile units with v
  // running downstream — the shared material scroll animates every face
  // along its own flow. Top faces sit at the level's height; sides are
  // pulled a hair into the cell so they can't z-fight a transparent
  // neighbour's face on the boundary plane.
  const emitFluidFlow = (lx, iy, lz, id) => {
    const pass = FLUID_PASS[id];
    const bucket = buckets[pass];
    const y = iy + MIN_Y;
    const h = FLUID_HEIGHT[id];
    const own = ((lz + SIZE) * W + (lx + SIZE)) * HEIGHT + iy;
    const sky = wSky[own] * (1 / 15);
    const blk = wBlk[own] * (1 / 15);
    const FB = LIGHTING.FACE_BRIGHTNESS;

    const pushQuad = (corners, uvs, b) => {
      const base = bucket.count;
      for (let k = 0; k < 4; k++) {
        bucket.pos.push(corners[k][0], corners[k][1], corners[k][2]);
        bucket.uv.push(uvs[k][0], uvs[k][1]);
        bucket.col.push(b, b, b);
        bucket.lig.push(sky, blk);
      }
      bucket.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      bucket.count += 4;
    };

    // Top face, when not under more lava: flat at the level's height, UV v
    // axis aligned to the local downstream direction. Downhill is read from
    // the neighbours — lower lava and open air pull the flow toward them.
    const above = iy + 1 < HEIGHT ? getId(lx, y + 1, lz) : BLOCK.AIR;
    if (!IS_FLUID_CELL[above]) {
      // gx/gz accumulate the DOWNSTREAM direction: open air counts as fully
      // downhill, lava neighbours pull toward the lower surface. (Phase 12
      // review fix: the original sign pointed uphill, so flow tops animated
      // back toward their source while sides scrolled down.)
      let gx = 0;
      let gz = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nid = getId(lx + dx, y, lz + dz);
        if (nid === BLOCK.AIR) {
          gx += dx * h;
          gz += dz * h;
        } else if (IS_FLUID_CELL[nid]) {
          gx += dx * (h - FLUID_HEIGHT[nid]);
          gz += dz * (h - FLUID_HEIGHT[nid]);
        }
      }
      // Downstream as a cardinal direction (flows spread cardinally); an
      // even gradient defaults to +z, which only picks the scroll axis.
      let dirX = 0;
      let dirZ = 1;
      if (Math.abs(gx) > Math.abs(gz)) {
        dirX = gx > 0 ? 1 : -1;
        dirZ = 0;
      } else if (Math.abs(gz) > 0) {
        dirX = 0;
        dirZ = gz > 0 ? 1 : -1;
      }
      const along = (cx, cz) =>
        dirX > 0 ? cx : dirX < 0 ? 1 - cx : dirZ > 0 ? cz : 1 - cz;
      const across = (cx, cz) => (dirX !== 0 ? cz : cx);
      const cs = [[0, 1], [1, 1], [0, 0], [1, 0]]; // FACES[2] corner order
      pushQuad(
        cs.map(([cx, cz]) => [lx + cx, y + h, lz + cz]),
        cs.map(([cx, cz]) => [across(cx, cz), along(cx, cz)]),
        FB.top,
      );
    }

    // Side faces: hidden by equal-or-taller lava or an opaque neighbour;
    // otherwise a band from the cell floor to the surface, scrolling down.
    for (const face of [FACES[0], FACES[1], FACES[4], FACES[5]]) {
      const d = face.dir;
      const nid = getId(lx + d[0], y, lz + d[2]);
      if (IS_FLUID_CELL[nid] && FLUID_HEIGHT[nid] >= h - 1e-4) continue;
      if (!IS_TRANSPARENT[nid]) continue;
      const ox = -d[0] * LAVA_SIDE_INSET;
      const oz = -d[2] * LAVA_SIDE_INSET;
      pushQuad(
        face.corners.map((c) => [lx + c[0] + ox, c[1] ? y + h : y, lz + c[2] + oz]),
        face.corners.map((c) => [c[3], c[1] ? 0 : h]),
        FB.side,
      );
    }

    // Bottom face, over transparent non-lava (a flow crossing a glass roof
    // or a canopy) — lifted by the same inset as the sides so it can never
    // z-fight the support block's coplanar top face.
    const below = iy > 0 ? getId(lx, y - 1, lz) : BLOCK.AIR;
    if (iy > 0 && IS_TRANSPARENT[below] && !IS_FLUID_CELL[below]) {
      pushQuad(
        FACES[3].corners.map((c) => [lx + c[0], y + LAVA_SIDE_INSET, lz + c[2]]),
        FACES[3].corners.map((c) => [c[3], c[4]]),
        FB.bottom,
      );
    }
  };

  // Nether portal interior (Phase 15): two big vertical quads, a 4/16-thick
  // slab along the portal's plane axis. The axis is read from the
  // neighbours — a portal is always at least 2 wide, so every interior cell
  // has a same-row portal neighbour along its plane. UVs are in repeating
  // tile units continuing across cells (u along the plane, v up the world),
  // so the shared scrolling material animates one seamless swirl over the
  // whole portal. Unlit fullbright material — the portal is the emitter.
  const emitPortal = (lx, iy, lz, id) => {
    const bucket = buckets[PASS_PORTAL];
    const y = iy + MIN_Y;
    const alongX =
      getId(lx + 1, y, lz) === id || getId(lx - 1, y, lz) === id ||
      // A 1-wide sliver mid-destruction: fall back to obsidian walls.
      getId(lx, y, lz + 1) !== id && getId(lx, y, lz - 1) !== id &&
      (getId(lx + 1, y, lz) === BLOCK.OBSIDIAN || getId(lx - 1, y, lz) === BLOCK.OBSIDIAN);
    const pushQuad = (corners, uvs) => {
      const base = bucket.count;
      for (let k = 0; k < 4; k++) {
        bucket.pos.push(corners[k][0], corners[k][1], corners[k][2]);
        bucket.uv.push(uvs[k][0], uvs[k][1]);
        bucket.col.push(1, 1, 1);
        bucket.lig.push(1, 1); // unused (material un-patched); keeps layout
      }
      bucket.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      bucket.count += 4;
    };
    // u continuity in WORLD coordinates so a portal spanning a chunk border
    // carries one seamless swirl across it.
    const along = alongX ? chunk.cx * SIZE + lx : chunk.cz * SIZE + lz;
    for (const off of [PORTAL_PLANE_MIN, PORTAL_PLANE_MAX]) {
      const corners = [];
      const uvs = [];
      for (const [a, h] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        corners.push(alongX
          ? [lx + a, y + h, lz + off]
          : [lx + off, y + h, lz + a]);
        uvs.push([along + a, y + h]);
      }
      pushQuad(corners, uvs);
    }
  };

  // Nether wart crop (Phase 17): the vanilla crop model — four DoubleSide
  // planes in a # arrangement (two per horizontal axis, PLANE_INSET from the
  // cell edges) in the cutout pass. Younger stages render shorter, the quad
  // sampling the bottom band of the grown tile's art so sprouts read as
  // small red nubs. Lit flat by the crop's own cell like the torch (no AO
  // on a paper-thin plant), full brightness (vanilla renders crops unshaded).
  const wartUV = tileUV(TILE.NETHER_WART_STAGE2);
  const emitWart = (lx, iy, lz, id) => {
    const bucket = buckets[PASS_CUTOUT];
    const y = iy + MIN_Y;
    const h = WART_HEIGHT[id];
    const own = ((lz + SIZE) * W + (lx + SIZE)) * HEIGHT + iy;
    const sky = wSky[own] * (1 / 15);
    const blk = wBlk[own] * (1 / 15);
    const inset = SHAPES.WART.PLANE_INSET;
    const v1 = wartUV.v0 + (wartUV.v1 - wartUV.v0) * h; // bottom band of the art
    // Two planes per axis: normal along x at x=inset/1-inset (full-width in
    // z), then the same rotated for z.
    const planes = [
      (o) => [[lx + o, y, lz], [lx + o, y, lz + 1], [lx + o, y + h, lz], [lx + o, y + h, lz + 1]],
      (o) => [[lx, y, lz + o], [lx + 1, y, lz + o], [lx, y + h, lz + o], [lx + 1, y + h, lz + o]],
    ];
    for (const plane of planes) {
      for (const o of [inset, 1 - inset]) {
        const corners = plane(o);
        const base = bucket.count;
        for (let k = 0; k < 4; k++) {
          bucket.pos.push(corners[k][0], corners[k][1], corners[k][2]);
          bucket.uv.push(k & 1 ? wartUV.u1 : wartUV.u0, k & 2 ? v1 : wartUV.v0);
          bucket.col.push(1, 1, 1);
          bucket.lig.push(sky, blk);
        }
        bucket.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        bucket.count += 4;
      }
    }
  };

  // Cross-plane plants (Phase 24): two DoubleSide quads crossing in an X in
  // the alpha-cutout pass, lit flat by the plant's own cell (the wart rule —
  // no AO on paper-thin planes, full brightness like vanilla's unshaded
  // plants; the cell's light IS the light of the block it sits on, since an
  // opacity-0 plant never attenuates it). The diagonal endpoints sit
  // sqrt(2)/4 in from the cell corners so each quad's in-plane width is
  // exactly 1 and the art is never stretched — vanilla's `rescale: true`.
  // A per-position world hash nudges the cross off-centre so a field of
  // grass reads as scattered growth, not a lattice.
  const emitCross = (lx, iy, lz, id) => {
    const bucket = buckets[PASS_CUTOUT];
    const y = iy + MIN_Y;
    const [sky, blk] = ownLight(lx, iy, lz);
    const { u0, v0, u1, v1 } = tileUV(CROSS_TILE[id]);
    const wx = chunk.cx * SIZE + lx;
    const wz = chunk.cz * SIZE + lz;
    let h = (Math.imul(wx, 0x27d4eb2d) ^ Math.imul(wz, 0x165667b1)) | 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    const off = SHAPES.PLANT.OFFSET;
    const cx = lx + 0.5 + (((h & 0xff) / 255) - 0.5) * 2 * off;
    const cz = lz + 0.5 + ((((h >>> 8) & 0xff) / 255) - 0.5) * 2 * off;
    const d = Math.SQRT2 / 4;
    // Short grass takes the column's grass tint like the ground it stands
    // on; the flowers do NOT — vanilla tints the grass family only, and a
    // tinted poppy is just a wrong-coloured poppy.
    let tr = 1;
    let tg = 1;
    let tb = 1;
    if (id === BLOCK.SHORT_GRASS && chunk.grassTint) {
      const ti = (lz * SIZE + lx) * 3;
      tr = chunk.grassTint[ti] / 255;
      tg = chunk.grassTint[ti + 1] / 255;
      tb = chunk.grassTint[ti + 2] / 255;
    }
    for (const s of [1, -1]) { // the two diagonals: (+,+) and (+,-)
      const base = bucket.count;
      // Corner order (0,0)(1,0)(0,1)(1,1) in the quad's UV frame.
      bucket.pos.push(
        cx - d, y, cz - d * s,
        cx + d, y, cz + d * s,
        cx - d, y + 1, cz - d * s,
        cx + d, y + 1, cz + d * s,
      );
      bucket.uv.push(u0, v0, u1, v0, u0, v1, u1, v1);
      for (let k = 0; k < 4; k++) {
        bucket.col.push(tr, tg, tb);
        bucket.lig.push(sky, blk);
      }
      bucket.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      bucket.count += 4;
      // Wind sway: the blade is PINNED at the root and waves at the tip
      // (verts 0,1 sit at y, 2,3 at y+1 — see the corner pushes above).
      // Zero-pad the sparse wave array to this quad's base first; the
      // chunk mesher's padWave keeps every other emit path in sync.
      const w = bucket.wav;
      for (let n = base - w.length; n > 0; n--) w.push(0);
      w.push(0, 0, 255, 255);
    }
  };

  // Shared helper for the Phase 19 small-box models (brewing stand, end
  // portal frame): one quad into a bucket, lit flat by the block's own cell
  // (the torch rule — no AO on tiny boxes), with a per-face brightness
  // class. Corners in world-ish space (chunk-local x/z, world y).
  const ownLight = (lx, iy, lz) => {
    const i = ((lz + SIZE) * W + (lx + SIZE)) * HEIGHT + iy;
    return [wSky[i] * (1 / 15), wBlk[i] * (1 / 15)];
  };
  const pushLitQuad = (bucket, corners, uvs, b, sky, blk) => {
    const base = bucket.count;
    for (let k = 0; k < 4; k++) {
      bucket.pos.push(corners[k][0], corners[k][1], corners[k][2]);
      bucket.uv.push(uvs[k][0], uvs[k][1]);
      bucket.col.push(b, b, b);
      bucket.lig.push(sky, blk);
    }
    bucket.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    bucket.count += 4;
  };
  // An axis-aligned box [x0..x1, y0..y1, z0..z1] in cell-local units at
  // (lx, y, lz), each face sampling a UV rect (tile fractions) of `tile`.
  // Faces flush with the cell boundary cull against opaque neighbours (and
  // against `cullSameId` neighbours); interior faces always emit.
  const pushBox = (lx, iy, lz, tile, box, faceUVs, { skipBottom = false, cullSameId = null } = {}) => {
    const bucket = buckets[PASS_CUTOUT];
    const y = iy + MIN_Y;
    const [sky, blk] = ownLight(lx, iy, lz);
    const { u0, v0, u1, v1 } = tileUV(tile);
    const du = u1 - u0;
    const dv = v1 - v0;
    const [x0, y0, z0, x1, y1b, z1] = box;
    const FB = LIGHTING.FACE_BRIGHTNESS;
    for (let fi = 0; fi < 6; fi++) {
      const face = FACES[fi];
      const d = face.dir;
      if (skipBottom && fi === 3) continue;
      // A face flush with the cell boundary behaves like a cube face there.
      const flush =
        (d[0] === 1 && x1 === 1) || (d[0] === -1 && x0 === 0) ||
        (d[1] === 1 && y1b === 1) || (d[1] === -1 && y0 === 0) ||
        (d[2] === 1 && z1 === 1) || (d[2] === -1 && z0 === 0);
      if (flush) {
        const nid = getId(lx + d[0], y + d[1], lz + d[2]);
        if (!IS_TRANSPARENT[nid]) continue;
        if (cullSameId && cullSameId(nid)) continue;
      }
      const uv = faceUVs[fi];
      if (!uv) continue;
      const [fu0, fu1, fv0, fv1] = uv;
      const corners = face.corners.map((c) => [
        lx + (c[0] ? x1 : x0),
        y + (c[1] ? y1b : y0),
        lz + (c[2] ? z1 : z0),
      ]);
      const uvs = face.corners.map((c) => [
        u0 + du * (c[3] ? fu1 : fu0),
        v0 + dv * (c[4] ? fv1 : fv0),
      ]);
      const b = d[1] > 0 ? FB.top : d[1] < 0 ? FB.bottom : FB.side;
      pushLitQuad(bucket, corners, uvs, b, sky, blk);
    }
  };

  // Brewing stand (Phase 19 — replaces the wrong full-cube rendering): a
  // stone base plate, the thin rod sampling the tile's rod column, and
  // three flat arm panes radiating out, each showing the tile's
  // hanging-bottle art (the vanilla read: rod, base, three bottle arms).
  const BS = SHAPES.BREWING_STAND;
  const emitBrewingStand = (lx, iy, lz) => {
    const y = iy + MIN_Y;
    const [sky, blk] = ownLight(lx, iy, lz);
    const FB = LIGHTING.FACE_BRIGHTNESS;
    // Base plate: stone, sides showing a thin band.
    const b0 = 0.5 - BS.BASE_HALF;
    const b1 = 0.5 + BS.BASE_HALF;
    const bandV = [3 / 16, 13 / 16, 0, BS.BASE_HEIGHT];
    const plateUV = [3 / 16, 13 / 16, 3 / 16, 13 / 16];
    pushBox(lx, iy, lz, TILE.STONE,
      [b0, 0, b0, b1, BS.BASE_HEIGHT, b1],
      [bandV, bandV, plateUV, plateUV, bandV, bandV],
      { skipBottom: true });
    // The rod: 2px column, its art rows sampled straight from the tile.
    const r0 = 0.5 - BS.ROD_HALF;
    const r1 = 0.5 + BS.ROD_HALF;
    const rodSide = [7 / 16, 9 / 16, 0, 14 / 16];
    const rodTop = [7 / 16, 9 / 16, 12 / 16, 14 / 16];
    pushBox(lx, iy, lz, TILE.BREWING_STAND,
      [r0, BS.BASE_HEIGHT, r0, r1, BS.ROD_TOP, r1],
      [rodSide, rodSide, rodTop, null, rodSide, rodSide]);
    // Three arm panes, one per bottle slot: a vertical DoubleSide quad from
    // the rod outward, carrying the tile's left-half art (arm bar, hook and
    // hanging bottle). The cutout material is DoubleSide, so one quad reads
    // from both sides.
    const bucket = buckets[PASS_CUTOUT];
    const { u0, v0, u1, v1 } = tileUV(TILE.BREWING_STAND);
    const du = u1 - u0;
    const dv = v1 - v0;
    for (const angle of BS.ARM_ANGLES) {
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const rIn = BS.ROD_HALF;
      const rOut = BS.ROD_HALF + BS.ARM_LENGTH;
      const yLo = y + BS.BASE_HEIGHT;
      const yHi = y + BS.ARM_TOP;
      // Corner order (0,0)(1,0)(0,1)(1,1) in the quad's UV frame: u runs
      // outer -> rod so the bottle art hangs outward, v runs up.
      const corners = [
        [lx + 0.5 + dx * rOut, yLo, lz + 0.5 + dz * rOut],
        [lx + 0.5 + dx * rIn, yLo, lz + 0.5 + dz * rIn],
        [lx + 0.5 + dx * rOut, yHi, lz + 0.5 + dz * rOut],
        [lx + 0.5 + dx * rIn, yHi, lz + 0.5 + dz * rIn],
      ];
      const armU = [0, 7 / 16];
      const armV = [1 / 16, 14 / 16];
      const uvs = [
        [u0 + du * armU[0], v0 + dv * armV[0]],
        [u0 + du * armU[1], v0 + dv * armV[0]],
        [u0 + du * armU[0], v0 + dv * armV[1]],
        [u0 + du * armU[1], v0 + dv * armV[1]],
      ];
      pushLitQuad(bucket, corners, uvs, FB.side, sky, blk);
    }
  };

  // Iron bars (Phase 19): thin panes through the cell centre, reaching
  // toward solid or bars neighbours (half-panes join seamlessly across
  // cells); an unconnected block renders as a free-standing cross.
  const emitBars = (lx, iy, lz) => {
    const bucket = buckets[PASS_CUTOUT];
    const y = iy + MIN_Y;
    const [sky, blk] = ownLight(lx, iy, lz);
    const FB = LIGHTING.FACE_BRIGHTNESS;
    const { u0, v0, u1, v1 } = tileUV(TILE.IRON_BARS);
    const du = u1 - u0;
    const dv = v1 - v0;
    // A vertical pane strip from cell-local a0..a1 along `axis` (0 = x),
    // held at 0.5 across it. u samples the matching horizontal band of the
    // tile so bar columns stay put as panes join.
    const strip = (axis, a0, a1) => {
      const corners = axis === 0
        ? [[lx + a0, y, lz + 0.5], [lx + a1, y, lz + 0.5],
           [lx + a0, y + 1, lz + 0.5], [lx + a1, y + 1, lz + 0.5]]
        : [[lx + 0.5, y, lz + a0], [lx + 0.5, y, lz + a1],
           [lx + 0.5, y + 1, lz + a0], [lx + 0.5, y + 1, lz + a1]];
      const uvs = [
        [u0 + du * a0, v0], [u0 + du * a1, v0],
        [u0 + du * a0, v0 + dv], [u0 + du * a1, v0 + dv],
      ];
      pushLitQuad(bucket, corners, uvs, FB.side, sky, blk);
    };
    const connects = (dx, dz) => {
      const nid = getId(lx + dx, y, lz + dz);
      return nid === BLOCK.IRON_BARS || !IS_TRANSPARENT[nid];
    };
    const px = connects(1, 0);
    const nx = connects(-1, 0);
    const pz = connects(0, 1);
    const nz = connects(0, -1);
    if (!px && !nx && !pz && !nz) {
      strip(0, 0, 1);
      strip(1, 0, 1);
      return;
    }
    if (px && nx) strip(0, 0, 1);
    else if (px) strip(0, 0.5, 1);
    else if (nx) strip(0, 0, 0.5);
    if (pz && nz) strip(1, 0, 1);
    else if (pz) strip(1, 0.5, 1);
    else if (nz) strip(1, 0, 0.5);
  };

  // End portal frame (Phase 19): the vanilla 13/16-tall block — end-stone
  // base band, frame-side art, the green frame top — plus, on a filled
  // frame, the small raised eye box sampling the generated frame-with-eye
  // tile. Both variants share the emitter; only the top art and the eye
  // box differ.
  const EF = SHAPES.END_FRAME;
  const emitEndFrame = (lx, iy, lz, filled) => {
    const isFrame = (nid) =>
      nid === BLOCK.END_PORTAL_FRAME || nid === BLOCK.END_PORTAL_FRAME_EYE;
    const side = [0, 1, 0, EF.HEIGHT];
    const topTile = filled ? TILE.END_PORTAL_FRAME_EYE : TILE.END_PORTAL_FRAME_TOP;
    // The box: sides sample the bottom HEIGHT band of the side art (its top
    // rows are transparent in the tile — the art is drawn 13px tall).
    pushBox(lx, iy, lz, TILE.END_PORTAL_FRAME_SIDE,
      [0, 0, 0, 1, EF.HEIGHT, 1],
      [side, side, null, [0, 1, 0, 1], side, side],
      { cullSameId: isFrame });
    // Top face at 13/16, its own tile (never culled — nothing sits flush).
    {
      const bucket = buckets[PASS_CUTOUT];
      const y = iy + MIN_Y;
      const [sky, blk] = ownLight(lx, iy, lz);
      const { u0, v0, u1, v1 } = tileUV(topTile);
      const cs = FACES[2].corners;
      pushLitQuad(
        bucket,
        cs.map((c) => [lx + c[0], y + EF.HEIGHT, lz + c[2]]),
        cs.map((c) => [c[3] ? u1 : u0, c[4] ? v1 : v0]),
        LIGHTING.FACE_BRIGHTNESS.top, sky, blk,
      );
    }
    if (filled) {
      const e0 = 0.5 - EF.EYE_HALF;
      const e1 = 0.5 + EF.EYE_HALF;
      const band = [EF.EYE_UV[0], EF.EYE_UV[1], EF.EYE_UV[0], EF.EYE_UV[1]];
      pushBox(lx, iy, lz, TILE.END_PORTAL_FRAME_EYE,
        [e0, EF.HEIGHT, e0, e1, 1, e1],
        [band, band, band, null, band, band]);
    }
  };

  // The end portal interior (Phase 19): a flat sheet at 12/16, rendered in
  // the animated portal pass (the shared swirl material — fullbright, the
  // portal is the emitter). UVs continue in world coordinates so the 3x3
  // surface reads as one sheet.
  const emitEndPortal = (lx, iy, lz) => {
    const bucket = buckets[PASS_PORTAL];
    const y = iy + MIN_Y;
    const wx = chunk.cx * SIZE + lx;
    const wz = chunk.cz * SIZE + lz;
    const cs = [[0, 1], [1, 1], [0, 0], [1, 0]]; // FACES[2] corner order
    const base = bucket.count;
    for (const [a, b] of cs) {
      bucket.pos.push(lx + a, y + SHAPES.END_PORTAL_SURFACE_Y, lz + b);
      bucket.uv.push((wx + a) * 0.5, (wz + b) * 0.5);
      bucket.col.push(1, 1, 1);
      bucket.lig.push(1, 1); // unused (material un-patched); keeps layout
    }
    bucket.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    bucket.count += 4;
  };

  // -------------------------------------------------------------------------
  // The generic SHAPE emitter (Phase 21) — one emitter for every
  // building block: stairs, slabs, fences, gates, walls, ladders, doors,
  // trapdoors, beds, signs, pots and item frames. It renders exactly the box
  // list world/blocks.js hands the collision sweep, so the shape a player
  // sees and the shape they bump into can never drift apart.
  //
  // UVs are the vanilla auto-unwrap: each face samples the sub-rectangle of
  // its tile that the box actually occupies, so a slab shows the bottom half
  // of its side texture and a stair's step lines up with the block below it.
  // -------------------------------------------------------------------------

  // The in-plane (a, b) rect a box covers on face fi, or null when the box
  // is not flush with that face (world/blocks.js buildFlushRects's twin —
  // kept here so the emitter needs no per-cell allocation).
  const faceRectOf = (b, fi) => {
    switch (fi) {
      case 0: return b[3] >= 1 ? [b[2], b[1], b[5], b[4]] : null;
      case 1: return b[0] <= 0 ? [b[2], b[1], b[5], b[4]] : null;
      case 2: return b[4] >= 1 ? [b[0], b[2], b[3], b[5]] : null;
      case 3: return b[1] <= 0 ? [b[0], b[2], b[3], b[5]] : null;
      case 4: return b[5] >= 1 ? [b[0], b[1], b[3], b[4]] : null;
      default: return b[2] <= 0 ? [b[0], b[1], b[3], b[4]] : null;
    }
  };
  const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4];
  const EPS_R = 1e-6;

  // Is this flush face hidden by the neighbouring shape? A neighbour rect
  // that strictly contains mine always wins; identical rects break the tie
  // by id (and by direction for two blocks of the same id) so exactly one of
  // the pair emits and coplanar quads never z-fight.
  const coveredByNeighbour = (rect, id, nid, fi) => {
    const rects = FLUSH_RECTS[nid];
    if (!rects) return false;
    for (const n of rects[OPPOSITE_FACE[fi]]) {
      if (n[0] > rect[0] + EPS_R || n[1] > rect[1] + EPS_R ||
          n[2] < rect[2] - EPS_R || n[3] < rect[3] - EPS_R) continue;
      const same = Math.abs(n[0] - rect[0]) < EPS_R && Math.abs(n[1] - rect[1]) < EPS_R &&
        Math.abs(n[2] - rect[2]) < EPS_R && Math.abs(n[3] - rect[3]) < EPS_R;
      if (!same) return true;                     // strictly bigger: hidden
      if (nid !== id) return id > nid;             // lower id draws the plane
      return fi === 1 || fi === 3 || fi === 5;     // same id: positive face draws
    }
    return false;
  };

  const emitShape = (lx, iy, lz, id) => {
    const y = iy + MIN_Y;
    const boxes = shapeBoxesAt(id, (bx, by, bz) => getId(bx, by, bz), lx, y, lz);
    if (!boxes) return;
    const bucket = buckets[PASS_CUTOUT];
    const [sky, blk] = ownLight(lx, iy, lz);
    const FB = LIGHTING.FACE_BRIGHTNESS;
    for (const entry of boxes) {
      const b = entry.box;
      const [x0, y0, z0, x1, y1, z1] = b;
      for (let fi = 0; fi < 6; fi++) {
        const face = FACES[fi];
        const d = face.dir;
        const rect = faceRectOf(b, fi);
        if (rect) {
          // A face flush with the cell boundary behaves like a cube face:
          // an opaque neighbour hides it, and a shaped neighbour covering
          // the same plane wins the tie-break above.
          const nid = getId(lx + d[0], y + d[1], lz + d[2]);
          if (!IS_TRANSPARENT[nid]) continue;
          if (HAS_SHAPE[nid] && coveredByNeighbour(rect, id, nid, fi)) continue;
        }
        const { u0, v0, u1, v1 } = tileUV(entry.tiles[fi]);
        const du = u1 - u0;
        const dv = v1 - v0;
        // Vanilla auto-UV: the face samples the slice of its tile the box
        // actually spans (v runs up the tile, matching FACES' corner frame).
        let ua;
        let ub;
        let va;
        let vb;
        if (fi === 0) { ua = 1 - z1; ub = 1 - z0; va = y0; vb = y1; }
        else if (fi === 1) { ua = z0; ub = z1; va = y0; vb = y1; }
        else if (fi === 2) { ua = x0; ub = x1; va = 1 - z1; vb = 1 - z0; }
        else if (fi === 3) { ua = x0; ub = x1; va = z0; vb = z1; }
        else if (fi === 4) { ua = x0; ub = x1; va = y0; vb = y1; }
        else { ua = 1 - x1; ub = 1 - x0; va = y0; vb = y1; }
        const base = bucket.count;
        const bright = d[1] > 0 ? FB.top : d[1] < 0 ? FB.bottom : FB.side;
        for (let k = 0; k < 4; k++) {
          const c = face.corners[k];
          bucket.pos.push(
            lx + (c[0] ? x1 : x0),
            y + (c[1] ? y1 : y0),
            lz + (c[2] ? z1 : z0),
          );
          bucket.uv.push(
            u0 + du * (c[3] ? ub : ua),
            v0 + dv * (c[4] ? vb : va),
          );
          bucket.col.push(bright, bright, bright);
          bucket.lig.push(sky, blk);
        }
        bucket.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        bucket.count += 4;
      }
    }
  };

  return {
    emitTorch, emitFluidFlow, emitPortal, emitWart, emitCross,
    emitBrewingStand, emitBars, emitEndFrame, emitEndPortal, emitShape,
  };
}
