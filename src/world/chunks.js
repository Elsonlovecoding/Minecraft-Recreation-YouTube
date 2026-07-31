// world/chunks.js — Chunk data storage, meshing and face culling. One chunk
// is a CHUNK.SIZE x CHUNK.HEIGHT x CHUNK.SIZE column of block ids in a flat
// Uint8Array, rendered as one merged mesh per material pass (opaque / cutout /
// translucent water). Only faces touching air or a transparent block are
// emitted; interior faces never exist. Per-face brightness and vertex AO are
// baked into vertex colours.

import * as THREE from 'three';
import { CHUNK, OVERWORLD, LIGHTING, RENDER } from '../config.js';
import { BLOCK, BLOCKS } from './blocks.js';
import { getUV } from '../render/atlas.js';

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
const OCCLUDES_AO = new Uint8Array(NUM_IDS);    // full opaque cube: darkens corners
const PASS = new Uint8Array(NUM_IDS);
const TILES = [];                               // per id: [px,nx,py,ny,pz,nz] or null

for (let id = 0; id < NUM_IDS; id++) {
  const def = BLOCKS[id];
  IS_TRANSPARENT[id] = def.transparent ? 1 : 0;
  OCCLUDES_AO[id] = def.solid && !def.transparent ? 1 : 0;
  TILES[id] = def.tiles;
  PASS[id] = !def.tiles ? PASS_NONE
    : id === BLOCK.WATER ? PASS_WATER
    : def.transparent ? PASS_CUTOUT
    : PASS_OPAQUE;
}

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

export function createChunkMaterials(atlasTexture) {
  const opaque = new THREE.MeshLambertMaterial({
    map: atlasTexture,
    vertexColors: true,
  });
  const cutout = new THREE.MeshLambertMaterial({
    map: atlasTexture,
    vertexColors: true,
    alphaTest: RENDER.CUTOUT_ALPHA_TEST,
    side: THREE.DoubleSide,
  });
  const water = new THREE.MeshLambertMaterial({
    map: atlasTexture,
    vertexColors: true,
    transparent: true,
    opacity: RENDER.WATER_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Explicit depth material so cutout blocks cast hole-punched shadows
  // instead of full-cube ones.
  const cutoutDepth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: atlasTexture,
    alphaTest: RENDER.CUTOUT_ALPHA_TEST,
  });
  return { opaque, cutout, water, cutoutDepth };
}

// ---------------------------------------------------------------------------
// Meshing
// ---------------------------------------------------------------------------

function newBucket() {
  return { pos: [], nor: [], col: [], uv: [], idx: [], count: 0 };
}

// Builds the merged meshes for one chunk. getChunkAt(cx, cz) must return the
// already-generated Chunk for every coordinate in the 3x3 neighbourhood —
// world.js only meshes chunks whose neighbours all exist, so culling and AO
// read identical data no matter which chunk meshes first.
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

  const buckets = [null, newBucket(), newBucket(), newBucket()];
  const aoStrength = LIGHTING.AO_STRENGTH;
  const waterSink = RENDER.WATER_SURFACE_SINK;
  const blocks = chunk.blocks;
  const ao = [1, 1, 1, 1];

  for (let lz = 0; lz < SIZE; lz++) {
    for (let lx = 0; lx < SIZE; lx++) {
      const colBase = (lz * SIZE + lx) * HEIGHT;
      for (let iy = 0; iy < HEIGHT; iy++) {
        const id = blocks[colBase + iy];
        if (id === 0) continue;
        const pass = PASS[id];
        if (pass === PASS_NONE) continue;

        const y = iy + MIN_Y;
        const tiles = TILES[id];
        const bucket = buckets[pass];

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

          // Face culling: emit only against air or a transparent block, and
          // merge same-id transparent runs (water-water, leaf-leaf).
          const nid = getId(lx + d[0], ny, lz + d[2]);
          if (!IS_TRANSPARENT[nid] || nid === id) continue;
          // Where two DIFFERENT transparent blocks touch (leaves|cactus,
          // water|glass) only the lower id emits the shared plane — the
          // cutout/water materials are DoubleSide, so one quad reads from
          // both sides while a coplanar pair would z-fight.
          if (nid !== BLOCK.AIR && IS_TRANSPARENT[id] && id > nid) continue;

          // Vertex AO from the three cells around each corner (skipped for
          // water — the surface should stay evenly lit).
          if (pass !== PASS_WATER) {
            for (let k = 0; k < 4; k++) {
              const [o1, o2, o3] = face.ao[k];
              const s1 = OCCLUDES_AO[getId(lx + o1[0], y + o1[1], lz + o1[2])];
              const s2 = OCCLUDES_AO[getId(lx + o2[0], y + o2[1], lz + o2[2])];
              const occ = s1 && s2
                ? 3
                : s1 + s2 + OCCLUDES_AO[getId(lx + o3[0], y + o3[1], lz + o3[2])];
              ao[k] = 1 - (aoStrength * occ) / 3;
            }
          } else {
            ao[0] = ao[1] = ao[2] = ao[3] = 1;
          }

          const { u0, v0, u1, v1 } = tileUV(tiles[fi]);
          const base = bucket.count;
          const brightness = face.brightness;
          for (let k = 0; k < 4; k++) {
            const c = face.corners[k];
            bucket.pos.push(lx + c[0], c[1] ? topY : y, lz + c[2]);
            bucket.nor.push(d[0], d[1], d[2]);
            bucket.uv.push(c[3] ? u1 : u0, c[4] ? v1 : v0);
            const shade = brightness * ao[k];
            bucket.col.push(shade, shade, shade);
          }

          // Split the quad along the diagonal with less occlusion so AO
          // interpolates without the classic anisotropy artefact.
          if (ao[0] + ao[3] > ao[1] + ao[2]) {
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
  const addMesh = (bucket, material, { shadows = false, depthMaterial = null } = {}) => {
    if (bucket.count === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.nor, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.col, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uv, 2));
    geometry.setIndex(bucket.idx);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    if (depthMaterial) mesh.customDepthMaterial = depthMaterial;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    geometries.push(geometry);
  };

  addMesh(buckets[PASS_OPAQUE], materials.opaque, { shadows: true });
  addMesh(buckets[PASS_CUTOUT], materials.cutout, {
    shadows: true,
    depthMaterial: materials.cutoutDepth,
  });
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
