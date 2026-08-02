// world/chunks.js — Chunk data storage, meshing and face culling. One chunk
// is a CHUNK.SIZE x CHUNK.HEIGHT x CHUNK.SIZE column of block ids in a flat
// Uint8Array, rendered as one merged mesh per material pass (opaque / cutout /
// translucent water). Only faces touching air or a transparent block are
// emitted; interior faces never exist — except non-self-culling transparent
// blocks (leaves, cactus), whose same-id interior planes render as one quad
// each so canopies read dense. Per-face brightness and vertex AO are
// baked into vertex colours; flood-filled sky/block light (render/lighting.js)
// is baked into a per-vertex `light` attribute that the patched chunk
// materials combine with the time-of-day uniforms.

import * as THREE from 'three';
import { CHUNK, OVERWORLD, LIGHTING, RENDER, SHAPES } from '../config.js';
import { BLOCK, BLOCKS, TORCH_LEAN } from './blocks.js';
import { getUV, TILE } from '../render/atlas.js';
import { computeLightWindow, patchChunkMaterial } from '../render/lighting.js';

const SIZE = CHUNK.SIZE;
const HEIGHT = CHUNK.HEIGHT;
const MIN_Y = OVERWORLD.MIN_Y;
// The mesher's neighbour lookup uses bit math, so the chunk edge must stay a
// power of two.
const SIZE_SHIFT = Math.log2(SIZE);
const SIZE_MASK = SIZE - 1;
if (!Number.isInteger(SIZE_SHIFT)) {
  throw new Error(`CHUNK.SIZE must be a power of two, got ${SIZE}`);
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    // Uint8Array starts zeroed = all BLOCK.AIR. Indexed y-fastest so a
    // vertical column is contiguous (generation and lighting walk columns).
    this.blocks = new Uint8Array(SIZE * SIZE * HEIGHT);
    this.dirty = true;    // block data changed since the mesh was last built
    this.mesh = null;     // { group, geometries } once meshed (world.js owns it)
    this.modified = false; // touched by setBlock — data is never discarded
    this._lightMeta = null; // lighting cache (render/lighting.js), lazy
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
    this._lightMeta = null; // heightmap/emitters may have changed
  }
}

// ---------------------------------------------------------------------------
// Per-block lookup tables, flattened from the registry for the hot loop
// ---------------------------------------------------------------------------

// Render buckets: which material pass a block's faces belong to.
const PASS_NONE = 0;    // no cube faces (air, portals — special-cased later)
const PASS_OPAQUE = 1;
const PASS_CUTOUT = 2;  // alpha-tested: leaves, cactus, glass, torch, bars
const PASS_WATER = 3;   // alpha-blended

const NUM_IDS = BLOCKS.length;
const IS_TRANSPARENT = new Uint8Array(NUM_IDS); // does not occlude neighbours
const OCCLUDES_AO = new Uint8Array(NUM_IDS);    // darkens AO corners (registry flag)
const SELF_CULL = new Uint8Array(NUM_IDS);      // merge same-id runs (water, glass);
                                                // 0 for leaves/cactus: interior
                                                // planes render, one quad each
const INSET = new Float32Array(NUM_IDS);        // side faces pulled into the cell
const PASS = new Uint8Array(NUM_IDS);
const TILES = [];                               // per id: [px,nx,py,ny,pz,nz] or null

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

// Torch lean directions as a flat per-id array for the hot loop (Phase 11:
// torches mesh as a small box model, not cube faces). null = not a torch.
const TORCH_LEAN_OF = new Array(NUM_IDS).fill(null);
for (const [id, lean] of Object.entries(TORCH_LEAN)) TORCH_LEAN_OF[id] = lean;

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
// Face geometry table
// ---------------------------------------------------------------------------

// One entry per face in blocks.js tiles order [px, nx, py, ny, pz, nz].
// corners: [x, y, z, u, v] per vertex, ordered (0,0) (1,0) (0,1) (1,1) in the
// face's UV frame so side textures are upright (v up) and not mirrored.
// Winding is CCW seen from outside the block.
const FACES = [
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
function tileUV(tile) {
  return uvByTile[tile] ?? (uvByTile[tile] = getUV(tile));
}

// ---------------------------------------------------------------------------
// Materials (shared by every chunk; created once in main.js)
// ---------------------------------------------------------------------------

// Chunk materials are unlit (MeshBasicMaterial): like the game itself, all
// shading comes from the baked per-face brightness, AO and flood-filled light
// (patchChunkMaterial injects the light response). Scene lights and shadow
// maps no longer touch terrain — the Phase 3 sun shadows are retired in
// favour of the vanilla look.
export function createChunkMaterials(atlasTexture) {
  const opaque = new THREE.MeshBasicMaterial({
    map: atlasTexture,
    vertexColors: true,
  });
  const cutout = new THREE.MeshBasicMaterial({
    map: atlasTexture,
    vertexColors: true,
    alphaTest: RENDER.CUTOUT_ALPHA_TEST,
    side: THREE.DoubleSide,
  });
  const water = new THREE.MeshBasicMaterial({
    map: atlasTexture,
    vertexColors: true,
    transparent: true,
    opacity: RENDER.WATER_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  patchChunkMaterial(opaque);
  patchChunkMaterial(cutout);
  patchChunkMaterial(water);
  return { opaque, cutout, water };
}

// ---------------------------------------------------------------------------
// Meshing
// ---------------------------------------------------------------------------

function newBucket() {
  return { pos: [], col: [], lig: [], uv: [], idx: [], count: 0 };
}

// Builds the merged meshes for one chunk. getChunkAt(cx, cz) must return the
// already-generated Chunk for every coordinate in the 3x3 neighbourhood —
// world.js only meshes chunks whose neighbours all exist, so culling, AO and
// light read identical data no matter which chunk meshes first.
// Returns { group, geometries }; positions are chunk-local in x/z (the group
// is placed at the chunk origin) and world-space in y.
export function buildChunkMesh(chunk, getChunkAt, materials) {
  const nbrs = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      nbrs.push(getChunkAt(chunk.cx + dx, chunk.cz + dz));
    }
  }

  // Block id at chunk-local coordinates, lx/lz in [-SIZE, 2*SIZE-1] (the
  // hot loop only reaches [-1, SIZE]): picks the right neighbour chunk by
  // bit shifts.
  const getId = (lx, y, lz) => {
    const c = nbrs[((lz + SIZE) >> SIZE_SHIFT) * 3 + ((lx + SIZE) >> SIZE_SHIFT)];
    return c.get(lx & SIZE_MASK, y, lz & SIZE_MASK);
  };

  // Flood-filled sky/block light over the 3x3 window (render/lighting.js).
  // The returned arrays are shared scratch, consumed before the next mesh.
  // `blocks` in the window is the same data getId reads, flattened; AO and
  // light sample it below at chunk-local coords lx+SIZE, lz+SIZE, iy.
  const light = computeLightWindow(nbrs);
  const wSky = light.sky;
  const wBlk = light.block;
  const wIds = light.blocks;
  const W = SIZE * 3;

  const buckets = [null, newBucket(), newBucket(), newBucket()];
  const aoStrength = LIGHTING.AO_STRENGTH;
  const waterSink = RENDER.WATER_SURFACE_SINK;
  const blocks = chunk.blocks;
  const ao = [1, 1, 1, 1];
  const vSky = [0, 0, 0, 0];
  const vBlk = [0, 0, 0, 0];

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

  // One window cell sampled for AO + vertex light, written to the s* outs.
  // Outside the world vertically: air, full sky above, darkness below.
  let sOcc = 0;
  let sSky = 0;
  let sBlk = 0;
  const sample = (lx, iy, lz) => {
    if (iy < 0 || iy >= HEIGHT) {
      sOcc = 0;
      sSky = iy >= HEIGHT ? 15 : 0;
      sBlk = 0;
      return;
    }
    const i = ((lz + SIZE) * W + (lx + SIZE)) * HEIGHT + iy;
    sOcc = OCCLUDES_AO[wIds[i]];
    sSky = wSky[i];
    sBlk = wBlk[i];
  };

  for (let lz = 0; lz < SIZE; lz++) {
    for (let lx = 0; lx < SIZE; lx++) {
      const colBase = (lz * SIZE + lx) * HEIGHT;
      for (let iy = 0; iy < HEIGHT; iy++) {
        const id = blocks[colBase + iy];
        if (id === 0) continue;
        const lean = TORCH_LEAN_OF[id];
        if (lean !== null) {
          emitTorch(lx, iy, lz, lean);
          continue;
        }
        const pass = PASS[id];
        if (pass === PASS_NONE) continue;

        const y = iy + MIN_Y;
        const tiles = TILES[id];
        const bucket = buckets[pass];
        const inset = INSET[id];

        // Water surface sits slightly below the block top wherever the
        // block above isn't water (top face and the lip of side faces).
        const topY = pass === PASS_WATER && getId(lx, y + 1, lz) !== id
          ? y + 1 - waterSink
          : y + 1;

        for (let fi = 0; fi < 6; fi++) {
          const face = FACES[fi];
          const d = face.dir;
          const ny = y + d[1];
          if (ny < MIN_Y) continue; // world-bottom face, never visible

          // Inset side faces (cactus) sit inside their own cell — nothing can
          // occlude or z-fight with them, so they skip culling entirely.
          const insetSide = inset > 0 && d[1] === 0;
          if (!insetSide) {
            // Face culling: emit only against air or a transparent block.
            const nid = getId(lx + d[0], ny, lz + d[2]);
            if (!IS_TRANSPARENT[nid]) continue;
            if (nid === id) {
              // Same-id transparent runs merge into one surface (water,
              // glass) — except non-self-culling blocks (leaves, stacked
              // cactus tops), whose interior planes DO render: exactly one
              // DoubleSide quad per shared plane, from the positive face,
              // so canopies read dense with no coplanar z-fight pairs.
              if (SELF_CULL[id]) continue;
              if (d[0] + d[1] + d[2] < 0) continue;
            } else if (
              nid !== BLOCK.AIR && IS_TRANSPARENT[id] && id > nid &&
              PASS[nid] !== PASS_NONE
            ) {
              // Where two DIFFERENT transparent blocks touch (leaves|cactus,
              // water|glass) only the lower id emits the shared plane — the
              // cutout/water materials are DoubleSide, so one quad reads from
              // both sides while a coplanar pair would z-fight. A PASS_NONE
              // neighbour (chest, portal interiors) renders no cube faces at
              // all, so this block must emit regardless of id order.
              continue;
            }
          }
          // Cactus side faces render pulled in by the inset (full width and
          // height — only the plane moves); top/bottom faces stay full size.
          const ox = insetSide ? -d[0] * inset : 0;
          const oz = insetSide ? -d[2] * inset : 0;

          // The cell in front of the face: every vertex samples it, and it
          // stands in for corner cells that light can't reach.
          const fy = iy + d[1];
          let fSky = 15;
          let fBlk = 0;
          if (fy < HEIGHT) {
            const fIdx = ((lz + d[2] + SIZE) * W + (lx + d[0] + SIZE)) * HEIGHT + fy;
            fSky = wSky[fIdx];
            fBlk = wBlk[fIdx];
          }

          // Vertex AO and smooth light from the three cells around each
          // corner (in the plane just outside the face) plus the front cell.
          // AO is skipped for water — the surface should stay evenly lit —
          // but water still takes the smooth light so depth darkens it.
          for (let k = 0; k < 4; k++) {
            const [o1, o2, o3] = face.ao[k];
            sample(lx + o1[0], iy + o1[1], lz + o1[2]);
            const s1 = sOcc;
            const sky1 = sSky;
            const blk1 = sBlk;
            sample(lx + o2[0], iy + o2[1], lz + o2[2]);
            const s2 = sOcc;
            const sky2 = sSky;
            const blk2 = sBlk;
            sample(lx + o3[0], iy + o3[1], lz + o3[2]);
            // Light can't turn a sealed corner: if both edge cells occlude,
            // the diagonal cell's light is unreachable — use the front cell.
            const sealed = s1 !== 0 && s2 !== 0;
            if (pass !== PASS_WATER) {
              const occ = sealed ? 3 : s1 + s2 + sOcc;
              ao[k] = 1 - (aoStrength * occ) / 3;
            } else {
              ao[k] = 1;
            }
            vSky[k] = (fSky + sky1 + sky2 + (sealed ? fSky : sSky)) * (1 / 60);
            vBlk[k] = (fBlk + blk1 + blk2 + (sealed ? fBlk : sBlk)) * (1 / 60);
          }

          const { u0, v0, u1, v1 } = tileUV(tiles[fi]);
          const base = bucket.count;
          const brightness = face.brightness;
          for (let k = 0; k < 4; k++) {
            const c = face.corners[k];
            bucket.pos.push(lx + c[0] + ox, c[1] ? topY : y, lz + c[2] + oz);
            bucket.uv.push(c[3] ? u1 : u0, c[4] ? v1 : v0);
            const shade = brightness * ao[k];
            bucket.col.push(shade, shade, shade);
            bucket.lig.push(vSky[k], vBlk[k]);
          }

          // Split the quad along the diagonal with less occlusion (and less
          // light) so shading interpolates without the classic anisotropy
          // artefact.
          const w0 = ao[0] + vSky[0] + vBlk[0];
          const w1 = ao[1] + vSky[1] + vBlk[1];
          const w2 = ao[2] + vSky[2] + vBlk[2];
          const w3 = ao[3] + vSky[3] + vBlk[3];
          if (w0 + w3 > w1 + w2) {
            bucket.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          } else {
            bucket.idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
          }
          bucket.count += 4;
        }
      }
    }
  }

  const group = new THREE.Group();
  group.position.set(chunk.cx * SIZE, 0, chunk.cz * SIZE);
  group.matrixAutoUpdate = false;
  group.updateMatrix();

  const geometries = [];
  // No normals: the unlit chunk materials never read them. `light` carries
  // vec2(sky, block) light levels normalised to 0..1 for the shader patch.
  const addMesh = (bucket, material) => {
    if (bucket.count === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.col, 3));
    geometry.setAttribute('light', new THREE.Float32BufferAttribute(bucket.lig, 2));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uv, 2));
    geometry.setIndex(bucket.idx);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    geometries.push(geometry);
  };

  addMesh(buckets[PASS_OPAQUE], materials.opaque);
  addMesh(buckets[PASS_CUTOUT], materials.cutout);
  addMesh(buckets[PASS_WATER], materials.water);

  return { group, geometries };
}

// Removes a chunk's meshes from the scene and frees their GPU buffers.
// Materials are shared and stay alive.
export function disposeChunkMesh(chunk) {
  if (!chunk.mesh) return;
  chunk.mesh.group.removeFromParent();
  for (const geometry of chunk.mesh.geometries) geometry.dispose();
  chunk.mesh = null;
}
