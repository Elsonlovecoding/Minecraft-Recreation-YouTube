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
//
// Phase 17: the per-block lookup tables, the FACES geometry table and the
// special-shape emitters (torch / flowing lava / portal / nether wart) live
// in world/emitters.js — the split the ARCHITECTURE cap note mandated.

import * as THREE from 'three';
import {
  CHUNK, OVERWORLD, LIGHTING, RENDER, ATLAS, FLUIDS, PORTALS,
} from '../config.js';
import { BLOCK, BLOCKS, TORCH_LEAN } from './blocks.js';
import { TILE } from '../render/atlas.js';
import { computeLightWindow, patchChunkMaterial } from '../render/lighting.js';
import {
  PASS_NONE, PASS_OPAQUE, PASS_CUTOUT, PASS_WATER, PASS_LAVA, PASS_PORTAL,
  IS_TRANSPARENT, OCCLUDES_AO, SELF_CULL, INSET, PASS, TILES,
  IS_LAVA_FLOW, WART_HEIGHT, FACES, tileUV, createSpecialEmitters,
} from './emitters.js';

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
    this.lightData = null; // packed sky<<4|block per cell, copied at mesh
                           // time for world.getLight point queries (mob
                           // spawning); refreshed on every remesh, so it can
                           // lag an edit by the frame or two until the dirty
                           // chunk remeshes — fine for spawn checks
    this._fluidScanned = false; // world/fluids.js settled this chunk's lava
    this._spawnerScanned = false; // world/spawners.js discovered this chunk's
                                  // generated spawner blocks (same pattern)
    this._chestScanned = false;   // world/chests.js discovered this chunk's
                                  // generated loot chests (Phase 19, same
                                  // pattern again)
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

// Torch lean directions as a flat per-id array for the hot loop (Phase 11:
// torches mesh as a small box model, not cube faces). null = not a torch.
const TORCH_LEAN_OF = new Array(BLOCKS.length).fill(null);
for (const [id, lean] of Object.entries(TORCH_LEAN)) TORCH_LEAN_OF[id] = lean;

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
  // Phase 12: flowing lava scrolls its texture, so it samples its own
  // repeating copy of the still-lava tile — the shared atlas is clamped and
  // must not scroll under every other block. The mesher's flow emitter
  // writes UVs in tile units with v running downstream, so one shared
  // offset.y slides every flow face along its own local flow direction.
  const P = ATLAS.TILE_PIXELS;
  const lavaCanvas = document.createElement('canvas');
  lavaCanvas.width = P;
  lavaCanvas.height = P;
  if (atlasTexture?.image) {
    const tile = TILE.LAVA_STILL;
    const col = tile % ATLAS.TILES_PER_ROW;
    const row = Math.floor(tile / ATLAS.TILES_PER_ROW);
    lavaCanvas.getContext('2d')
      .drawImage(atlasTexture.image, col * P, row * P, P, P, 0, 0, P, P);
  }
  const lavaTexture = new THREE.CanvasTexture(lavaCanvas);
  lavaTexture.magFilter = THREE.NearestFilter;
  lavaTexture.minFilter = THREE.NearestFilter;
  lavaTexture.generateMipmaps = false;
  lavaTexture.wrapS = THREE.RepeatWrapping;
  lavaTexture.wrapT = THREE.RepeatWrapping;
  lavaTexture.colorSpace = THREE.SRGBColorSpace;
  const lava = new THREE.MeshBasicMaterial({
    map: lavaTexture,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  // Phase 15: the nether-portal interior. No portal tile ships in the atlas,
  // so the swirl is generated (like the crack random-walk and arm skin were
  // — generated art is the established pattern): layered purple value noise
  // on a repeating canvas, scrolled upward with a sideways wobble per frame.
  // The material is deliberately UNLIT and un-patched — the portal is an
  // emissive surface (light 11 in the registry lights its surroundings);
  // fullbright purple through fog is the vanilla read.
  const PT = 32;
  const portalCanvas = document.createElement('canvas');
  portalCanvas.width = PT;
  portalCanvas.height = PT;
  {
    const ctx = portalCanvas.getContext('2d');
    const img = ctx.createImageData(PT, PT);
    for (let y = 0; y < PT; y++) {
      for (let x = 0; x < PT; x++) {
        // Two sine octaves + hash sparkle, tileable via the 2π wrap.
        const u = (x / PT) * Math.PI * 2;
        const v = (y / PT) * Math.PI * 2;
        let n = 0.5 +
          0.28 * Math.sin(u * 2 + Math.sin(v * 3)) +
          0.22 * Math.sin(v * 2 + Math.sin(u * 5 + 1.7));
        n += 0.18 * (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1);
        n = Math.max(0, Math.min(1, n));
        const i = (y * PT + x) * 4;
        img.data[i] = 60 + 90 * n;        // r
        img.data[i + 1] = 10 + 40 * n;    // g
        img.data[i + 2] = 120 + 110 * n;  // b
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const portalTexture = new THREE.CanvasTexture(portalCanvas);
  portalTexture.magFilter = THREE.NearestFilter;
  portalTexture.minFilter = THREE.NearestFilter;
  portalTexture.generateMipmaps = false;
  portalTexture.wrapS = THREE.RepeatWrapping;
  portalTexture.wrapT = THREE.RepeatWrapping;
  portalTexture.colorSpace = THREE.SRGBColorSpace;
  const portal = new THREE.MeshBasicMaterial({
    map: portalTexture,
    transparent: true,
    opacity: PORTALS.SWIRL.OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  let portalClock = 0;
  patchChunkMaterial(opaque);
  patchChunkMaterial(cutout);
  patchChunkMaterial(water);
  patchChunkMaterial(lava);
  return {
    opaque,
    cutout,
    water,
    lava,
    portal,
    // main.js calls this once per un-paused frame: the animated flow.
    // offset.y decreasing slides the pattern toward +v — downstream on flow
    // tops, downward on flow sides and falling columns.
    scrollLava(dt) {
      lavaTexture.offset.y =
        (((lavaTexture.offset.y - FLUIDS.SCROLL_TILES_PER_SECOND * dt) % 1) + 1) % 1;
    },
    // The portal swirl drifts upward and shimmers sideways.
    scrollPortal(dt) {
      const S = PORTALS.SWIRL;
      portalClock += dt;
      portalTexture.offset.y =
        (((portalTexture.offset.y - S.SCROLL_TILES_PER_SECOND * dt) % 1) + 1) % 1;
      portalTexture.offset.x =
        S.WOBBLE_AMPLITUDE * Math.sin(portalClock * Math.PI * 2 * S.WOBBLE_HZ);
    },
  };
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

  // Phase 12: keep the centre chunk's computed light for cheap point
  // queries (world.getLight — the mob spawner's light checks). Packed
  // sky << 4 | block per cell, refreshed on every remesh.
  let lightData = chunk.lightData;
  if (!lightData) {
    lightData = new Uint8Array(SIZE * SIZE * HEIGHT);
    chunk.lightData = lightData;
  }
  for (let lz = 0; lz < SIZE; lz++) {
    for (let lx = 0; lx < SIZE; lx++) {
      const src = ((lz + SIZE) * W + (lx + SIZE)) * HEIGHT;
      const dst = (lz * SIZE + lx) * HEIGHT;
      for (let iy = 0; iy < HEIGHT; iy++) {
        lightData[dst + iy] = (wSky[src + iy] << 4) | wBlk[src + iy];
      }
    }
  }

  const buckets = [
    null, newBucket(), newBucket(), newBucket(), newBucket(), newBucket(),
  ];
  const aoStrength = LIGHTING.AO_STRENGTH;
  const waterSink = RENDER.WATER_SURFACE_SINK;
  const blocks = chunk.blocks;
  const ao = [1, 1, 1, 1];
  const vSky = [0, 0, 0, 0];
  const vBlk = [0, 0, 0, 0];

  // The special-shape emitters (world/emitters.js): torch box model,
  // flowing-lava cells, the portal slab, the nether wart crop. They close
  // over this mesh's buckets/light window through the ctx.
  const {
    emitTorch, emitLavaFlow, emitPortal, emitWart,
    emitBrewingStand, emitBars, emitEndFrame, emitEndPortal,
  } = createSpecialEmitters({ chunk, buckets, getId, wSky, wBlk, W });

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
        if (IS_LAVA_FLOW[id]) {
          emitLavaFlow(lx, iy, lz, id);
          continue;
        }
        if (id === BLOCK.NETHER_PORTAL) {
          emitPortal(lx, iy, lz, id);
          continue;
        }
        if (WART_HEIGHT[id] > 0) {
          emitWart(lx, iy, lz, id);
          continue;
        }
        // Phase 19 specials: the brewing stand box model, iron-bar panes,
        // end portal frames (empty/filled) and the end portal sheet.
        if (id === BLOCK.BREWING_STAND) {
          emitBrewingStand(lx, iy, lz);
          continue;
        }
        if (id === BLOCK.IRON_BARS) {
          emitBars(lx, iy, lz);
          continue;
        }
        if (id === BLOCK.END_PORTAL_FRAME || id === BLOCK.END_PORTAL_FRAME_EYE) {
          emitEndFrame(lx, iy, lz, id === BLOCK.END_PORTAL_FRAME_EYE);
          continue;
        }
        if (id === BLOCK.END_PORTAL) {
          emitEndPortal(lx, iy, lz);
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
  addMesh(buckets[PASS_LAVA], materials.lava);
  addMesh(buckets[PASS_PORTAL], materials.portal);

  return { group, geometries };
}

// Removes a chunk's meshes from the scene and frees their GPU buffers.
// Materials are shared and stay alive. (The fluid settle flag is NOT
// cleared here — remeshing goes through this too, and a rescan per remesh
// would re-enqueue every settled lava surface forever; world.js clears the
// flag only on the unload paths.)
export function disposeChunkMesh(chunk) {
  if (!chunk.mesh) return;
  chunk.mesh.group.removeFromParent();
  for (const geometry of chunk.mesh.geometries) geometry.dispose();
  chunk.mesh = null;
}
