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
import { BLOCK, BLOCKS, LAVA_LEVEL_OF, WART_STAGE } from './blocks.js';
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

// Lava family tables (Phase 12): flowing/falling cells render through their
// own partial-height emitter in the PASS_LAVA bucket; the SOURCE keeps its
// normal full-cube path (lakes look exactly as before). Heights per id come
// from FLUIDS config — each horizontal step visibly lower.
export const IS_LAVA_CELL = new Uint8Array(NUM_IDS);   // source, flows and falls
export const IS_LAVA_FLOW = new Uint8Array(NUM_IDS);   // flows and falls only
export const LAVA_HEIGHT = new Float32Array(NUM_IDS);  // rendered surface height
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

  // Flowing/falling lava (Phase 12): a partial-height cell in the PASS_LAVA
  // bucket, lit flat by its own cell (it IS an emitter, like the torch).
  // UVs are in repeating tile units with v running downstream — the shared
  // material scroll animates every face along its own flow. Top faces sit at
  // the level's height; sides are pulled a hair into the cell so they can't
  // z-fight a transparent neighbour's face on the boundary plane.
  const emitLavaFlow = (lx, iy, lz, id) => {
    const bucket = buckets[PASS_LAVA];
    const y = iy + MIN_Y;
    const h = LAVA_HEIGHT[id];
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
    if (!IS_LAVA_CELL[above]) {
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
        } else if (IS_LAVA_CELL[nid]) {
          gx += dx * (h - LAVA_HEIGHT[nid]);
          gz += dz * (h - LAVA_HEIGHT[nid]);
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
      if (IS_LAVA_CELL[nid] && LAVA_HEIGHT[nid] >= h - 1e-4) continue;
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
    if (iy > 0 && IS_TRANSPARENT[below] && !IS_LAVA_CELL[below]) {
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

  return { emitTorch, emitLavaFlow, emitPortal, emitWart };
}
