// entities/items.js — Dropped item entities. A dropped item is a point entity
// with simple physics (gravity, ground landing, water float), rendered as a
// bobbing, rotating mini-block (for block items) or flat sprite (for
// assets/items/*.png items). Items magnetise to the player within
// ITEMS.MAGNET_RADIUS, are collected at ITEMS.PICKUP_RADIUS, and despawn
// after ITEMS.DESPAWN_SECONDS.
//
// createBlockMesh is also used by player/interaction.js for the held block in
// the first-person hand — this module owns "what an item looks like".

import * as THREE from 'three';
import { ITEMS, LIGHTING, RENDER, OVERWORLD, PLAYER, CHUNK } from '../config.js';
import { BLOCK, blockIdByName, faceTiles, isSolid } from '../world/blocks.js';
import { getUV, getAtlasTexture } from '../render/atlas.js';

const EPS = 1e-5;
const TAU = Math.PI * 2;

// Items whose real texture this project doesn't ship yet render as a close
// stand-in (noted in PROGRESS.md): a sapling reads as a sprout of leaves.
const VISUAL_ALIAS = {
  oak_sapling: { block: BLOCK.OAK_LEAVES },
  glowstone_dust: { sprite: 'blaze_powder' },
};

// ---------------------------------------------------------------------------
// Visuals — mini-block and sprite meshes (geometry/material caches shared)
// ---------------------------------------------------------------------------

// Same face layout as the chunk mesher: dir + corners in the face's UV frame,
// CCW from outside. Corner coords are 0/1, centred and scaled on build.
const FACES = [
  { dir: [1, 0, 0],  corners: [[1, 0, 1, 0, 0], [1, 0, 0, 1, 0], [1, 1, 1, 0, 1], [1, 1, 0, 1, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 0, 0, 0], [0, 0, 1, 1, 0], [0, 1, 0, 0, 1], [0, 1, 1, 1, 1]] },
  { dir: [0, 1, 0],  corners: [[0, 1, 1, 0, 0], [1, 1, 1, 1, 0], [0, 1, 0, 0, 1], [1, 1, 0, 1, 1]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0, 0, 0], [1, 0, 0, 1, 0], [0, 0, 1, 0, 1], [1, 0, 1, 1, 1]] },
  { dir: [0, 0, 1],  corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
];

const blockGeometryCache = new Map(); // "id:size" -> BufferGeometry
let blockMaterial = null;             // shared: atlas + vertex colours
const spriteMaterialCache = new Map(); // item name -> MeshBasicMaterial
let spriteGeometry = null;            // shared unit plane, scaled per mesh

function getBlockMaterial() {
  if (!blockMaterial) {
    blockMaterial = new THREE.MeshBasicMaterial({
      map: getAtlasTexture(),
      vertexColors: true,
      alphaTest: RENDER.CUTOUT_ALPHA_TEST, // lets leaves/torch cutouts read
      side: THREE.DoubleSide,
      // Matches the terrain: chunk materials are not tone-mapped, so a held
      // or dropped block shows the exact placed-block colours.
      toneMapped: false,
    });
  }
  return blockMaterial;
}

// Textured mini-cube geometry for a block id: per-face atlas UVs and the
// vanilla per-face brightness (top 1.0 / side 0.8 / bottom 0.5) baked as
// vertex colours. Centred on the origin, edge length `size`.
function getBlockGeometry(blockId, size) {
  const key = blockId + ':' + size;
  let geometry = blockGeometryCache.get(key);
  if (geometry) return geometry;

  const tiles = faceTiles(blockId);
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const FB = LIGHTING.FACE_BRIGHTNESS;
  for (let fi = 0; fi < 6; fi++) {
    const face = FACES[fi];
    const b = face.dir[1] > 0 ? FB.top : face.dir[1] < 0 ? FB.bottom : FB.side;
    const { u0, v0, u1, v1 } = getUV(tiles[fi]);
    const base = pos.length / 3;
    for (const c of face.corners) {
      pos.push((c[0] - 0.5) * size, (c[1] - 0.5) * size, (c[2] - 0.5) * size);
      col.push(b, b, b);
      uv.push(c[3] ? u1 : u0, c[4] ? v1 : v0);
    }
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(idx);
  return blockGeometryCache.set(key, geometry), geometry;
}

// Mini-block mesh for a block id (shared geometry + material). Used for
// dropped block items and the held block in the first-person hand.
export function createBlockMesh(blockId, size) {
  return new THREE.Mesh(getBlockGeometry(blockId, size), getBlockMaterial());
}

function getSpriteMaterial(name) {
  let material = spriteMaterialCache.get(name);
  if (material) return material;
  const texture = new THREE.TextureLoader().load(
    `assets/items/${name}.png`,
    undefined,
    undefined,
    () => console.warn(`[items] missing texture assets/items/${name}.png`),
  );
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  material = new THREE.MeshBasicMaterial({
    map: texture,
    alphaTest: RENDER.CUTOUT_ALPHA_TEST,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  spriteMaterialCache.set(name, material);
  return material;
}

// How an item name renders, shared by dropped items, the first-person hand
// and the UI icons (ui/icons.js): block items as their block ({ blockId }),
// everything else as a flat texture from assets/items/ ({ sprite }).
export function itemVisualInfo(name) {
  const alias = VISUAL_ALIAS[name];
  const blockId = alias?.block ?? (alias?.sprite ? null : blockIdByName(name));
  if (blockId !== null && blockId !== undefined && faceTiles(blockId)) {
    return { blockId };
  }
  return { sprite: alias?.sprite ?? name };
}

// Flat sprite quad for a non-block item (shared geometry, cached material).
export function createSpriteMesh(name, size) {
  if (!spriteGeometry) spriteGeometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(spriteGeometry, getSpriteMaterial(name));
  mesh.scale.setScalar(size);
  return mesh;
}

// ---------------------------------------------------------------------------
// Extruded item model (the vanilla held-item look): the sprite as a thin
// slab — full front and back quads plus one edge quad per opaque/transparent
// pixel boundary, each edge sampling its pixel's centre so the rim takes the
// art's colours. Used by the first-person hand for tools (interaction.js);
// dropped items stay flat sprites.
// ---------------------------------------------------------------------------

const extrudedCache = new Map(); // name -> { geometry, material } once built

// Depth of the slab as a fraction of the sprite's width (vanilla items are
// one pixel thick: 1/16 of their 16px span).
const EXTRUDE_DEPTH = 1 / 16;

function buildExtrudedGeometry(img) {
  const w = img.width;
  const h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  // Same cutoff as the slab material's alphaTest, so edge quads are built
  // for exactly the pixels the shader keeps.
  const alphaCut = RENDER.CUTOUT_ALPHA_TEST * 255;
  const opaque = (px, py) =>
    px >= 0 && px < w && py >= 0 && py < h && data[(py * w + px) * 4 + 3] >= alphaCut;

  const t2 = EXTRUDE_DEPTH / 2;
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const FB = LIGHTING.FACE_BRIGHTNESS;
  // corners: [x, y, z, u, v] (geometry y up; image rows count down)
  const quad = (corners, brightness) => {
    const base = pos.length / 3;
    for (const [x, y, z, u, v] of corners) {
      pos.push(x, y, z);
      uv.push(u, v);
      col.push(brightness, brightness, brightness);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // Front (+z) and back (-z) full quads with the plain sprite mapping.
  quad([
    [-0.5, -0.5, t2, 0, 0], [0.5, -0.5, t2, 1, 0],
    [0.5, 0.5, t2, 1, 1], [-0.5, 0.5, t2, 0, 1],
  ], 1.0);
  quad([
    [0.5, -0.5, -t2, 1, 0], [-0.5, -0.5, -t2, 0, 0],
    [-0.5, 0.5, -t2, 0, 1], [0.5, 0.5, -t2, 1, 1],
  ], 1.0);

  // Edge quads at every opaque/transparent pixel boundary.
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (!opaque(px, py)) continue;
      const u = (px + 0.5) / w;
      const v = 1 - (py + 0.5) / h;
      const xl = px / w - 0.5;
      const xr = (px + 1) / w - 0.5;
      const yt = 0.5 - py / h;
      const yb = 0.5 - (py + 1) / h;
      if (!opaque(px - 1, py)) {
        quad([[xl, yb, -t2, u, v], [xl, yb, t2, u, v], [xl, yt, t2, u, v], [xl, yt, -t2, u, v]], FB.side);
      }
      if (!opaque(px + 1, py)) {
        quad([[xr, yb, t2, u, v], [xr, yb, -t2, u, v], [xr, yt, -t2, u, v], [xr, yt, t2, u, v]], FB.side);
      }
      if (!opaque(px, py - 1)) {
        quad([[xl, yt, t2, u, v], [xr, yt, t2, u, v], [xr, yt, -t2, u, v], [xl, yt, -t2, u, v]], FB.top);
      }
      if (!opaque(px, py + 1)) {
        quad([[xl, yb, -t2, u, v], [xr, yb, -t2, u, v], [xr, yb, t2, u, v], [xl, yb, t2, u, v]], FB.bottom);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setIndex(idx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    alphaTest: RENDER.CUTOUT_ALPHA_TEST,
    vertexColors: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return { geometry, material };
}

// Extruded mesh for an item sprite. Returns a group immediately; the slab
// mesh appears once the texture image is loaded (cached after the first
// build). Falls back to the flat sprite if the image can't load. `onReady`
// (optional) fires when the group actually has content — synchronously on
// a cache hit, after the image load otherwise (the hand keeps the arm
// visible until then, so it is never empty).
export function createExtrudedItemMesh(name, size, onReady) {
  const group = new THREE.Group();
  group.scale.setScalar(size);
  const cached = extrudedCache.get(name);
  if (cached) {
    group.add(new THREE.Mesh(cached.geometry, cached.material));
    onReady?.();
    return group;
  }
  const img = new Image();
  img.onload = () => {
    let built = extrudedCache.get(name);
    if (!built) {
      built = buildExtrudedGeometry(img);
      extrudedCache.set(name, built);
    }
    group.add(new THREE.Mesh(built.geometry, built.material));
    onReady?.();
  };
  img.onerror = () => {
    console.warn(`[items] missing texture assets/items/${name}.png`);
    group.add(createSpriteMesh(name, 1));
    onReady?.();
  };
  img.src = `assets/items/${name}.png`;
  return group;
}

// Visual for an item name. Returns { mesh, halfHeight }.
function createItemVisual(name) {
  const info = itemVisualInfo(name);
  if (info.blockId !== undefined) {
    const size = ITEMS.BLOCK_SCALE;
    return { mesh: createBlockMesh(info.blockId, size), halfHeight: size / 2 };
  }
  const size = ITEMS.SPRITE_SCALE;
  return { mesh: createSpriteMesh(info.sprite, size), halfHeight: size / 2 };
}

// ---------------------------------------------------------------------------
// The item manager
// ---------------------------------------------------------------------------

// Manages every dropped item in the scene. `update` must be called once per
// frame with the player's feet position; collected items fire
// onPickup(name, count).
export function createItemManager({ world, scene }) {
  const entities = [];

  // Spawns a dropped item entity. `pos` is the item's base point (bottom).
  // Velocity defaults to the broken-block pop: up plus random scatter.
  // `durability` (optional) rides along so a dropped worn tool comes back
  // worn, not repaired.
  function spawn(name, count, pos, vel, durability) {
    const { mesh, halfHeight } = createItemVisual(name);
    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(pos.x, pos.y, pos.z);
    scene.add(group);
    const angle = Math.random() * TAU;
    const entity = {
      name,
      count,
      durability: durability ?? null,
      pos: { x: pos.x, y: pos.y, z: pos.z },
      vel: vel
        ? { x: vel.x, y: vel.y, z: vel.z }
        : {
            x: Math.cos(angle) * ITEMS.POP_SPEED_SIDE * Math.random(),
            y: ITEMS.POP_SPEED_UP,
            z: Math.sin(angle) * ITEMS.POP_SPEED_SIDE * Math.random(),
          },
      age: 0,
      grounded: false,
      retry: 0, // pause left before re-offering a pickup the inventory refused
      phase: Math.random() * TAU, // bob/spin offset so drops don't sync
      group,
      inner: mesh,
      halfHeight,
    };
    entities.push(entity);
    return entity;
  }

  function remove(index) {
    const e = entities[index];
    e.group.removeFromParent(); // geometry/material caches are shared, kept
    entities.splice(index, 1);
  }

  function solidAt(x, y, z) {
    return isSolid(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  function stepPhysics(e, dt) {
    const p = e.pos;
    const v = e.vel;
    const midY = p.y + e.halfHeight;

    // Squeezed by a placed block: pop up to the top of that cell.
    if (solidAt(p.x, midY, p.z)) {
      p.y = Math.floor(midY) + 1 + ITEMS.REST_CLEARANCE;
      v.y = 0;
      e.grounded = true;
    }

    const inWater =
      world.getBlock(Math.floor(p.x), Math.floor(midY), Math.floor(p.z)) ===
      BLOCK.WATER;
    if (inWater) {
      // Items float: rise gently toward the surface, heavily damped.
      const k = 1 - Math.exp(-ITEMS.WATER_FLOAT_RESPONSE * dt);
      v.y += (ITEMS.WATER_FLOAT_SPEED - v.y) * k;
      const drag = Math.exp(-ITEMS.WATER_HORIZONTAL_DRAG * dt);
      v.x *= drag;
      v.z *= drag;
    } else if (!e.grounded) {
      v.y -= ITEMS.GRAVITY * dt;
    }

    moveWithCollision(e, dt);

    if (e.grounded) {
      const f = Math.exp(-ITEMS.GROUND_FRICTION * dt);
      v.x *= f;
      v.z *= f;
    }
  }

  // Integrates e.vel over dt with per-axis cell collision. The item's
  // midpoint is the collision probe both ways — a rising item stops with its
  // top under a ceiling (never poking into the cell, which would trip the
  // squeeze rescue and teleport it through). Used by normal physics AND the
  // magnet pull, so walls block magnetised items too.
  function moveWithCollision(e, dt) {
    const p = e.pos;
    const v = e.vel;
    const half = e.halfHeight;

    // Vertical sweep (through every crossed cell, no tunnelling)
    const ny = p.y + v.y * dt;
    if (v.y <= 0) {
      // The ground can vanish (mined out from under the item)
      if (e.grounded && !solidAt(p.x, p.y - 2 * ITEMS.REST_CLEARANCE, p.z)) {
        e.grounded = false;
      }
      if (!e.grounded) {
        let landed = false;
        for (let cy = Math.floor(p.y); cy >= Math.floor(ny); cy--) {
          if (solidAt(p.x, cy, p.z)) {
            p.y = cy + 1 + ITEMS.REST_CLEARANCE;
            v.y = 0;
            e.grounded = true;
            landed = true;
            break;
          }
        }
        if (!landed) p.y = ny;
      }
    } else {
      e.grounded = false;
      let blocked = false;
      for (let cy = Math.floor(p.y + half) + 1; cy <= Math.floor(ny + half); cy++) {
        if (solidAt(p.x, cy, p.z)) {
          p.y = cy - half - EPS; // midpoint just below the solid cell
          v.y = 0;
          blocked = true;
          break;
        }
      }
      if (!blocked) p.y = ny;
    }

    // Horizontal, axis by axis (a solid cell at the midpoint stops the axis)
    const yCell = p.y + half;
    const nx = p.x + v.x * dt;
    if (v.x !== 0) {
      if (solidAt(nx, yCell, p.z)) v.x = 0;
      else p.x = nx;
    }
    const nz = p.z + v.z * dt;
    if (v.z !== 0) {
      if (solidAt(p.x, yCell, nz)) v.z = 0;
      else p.z = nz;
    }
  }

  // Per-frame update. `playerPos` is the player's FEET position (body
  // convention); magnet and pickup measure from the body centre.
  // onPickup(name, count, durability) returns how many the inventory
  // accepted (undefined = all): a refused item stays in the world, keeps its
  // physics, and waits ITEMS.PICKUP_RETRY_SECONDS before offering itself (or
  // magnetising) again, so a full inventory doesn't vacuum drops around
  // forever.
  function update(dt, playerPos, onPickup) {
    if (dt <= 0) return;
    const cx = playerPos.x;
    const cy = playerPos.y + PLAYER.HEIGHT / 2; // body centre
    const cz = playerPos.z;

    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      // An item whose chunk was unloaded freezes (age and all): its physics
      // would otherwise call world.getBlock, which regenerates the chunk
      // synchronously outside the streaming budget — a hitch on every chunk
      // border crossing while any far-away drop exists.
      if (!world.getChunkIfLoaded(
        Math.floor(e.pos.x / CHUNK.SIZE),
        Math.floor(e.pos.z / CHUNK.SIZE),
      )) continue;
      e.age += dt;
      if (
        e.age >= ITEMS.DESPAWN_SECONDS ||
        e.pos.y < OVERWORLD.MIN_Y - ITEMS.VOID_DESPAWN_DEPTH
      ) {
        remove(i);
        continue;
      }
      // Lava burns dropped items (vanilla), checked at the item's midpoint.
      if (world.getBlock(
        Math.floor(e.pos.x),
        Math.floor(e.pos.y + e.halfHeight),
        Math.floor(e.pos.z),
      ) === BLOCK.LAVA) {
        remove(i);
        continue;
      }

      const dx = cx - e.pos.x;
      const dy = cy - (e.pos.y + e.halfHeight);
      const dz = cz - e.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (e.retry > 0) e.retry -= dt;
      const active = e.age >= ITEMS.PICKUP_DELAY_SECONDS && e.retry <= 0;

      if (active && dist <= ITEMS.PICKUP_RADIUS) {
        const accepted = onPickup
          ? (onPickup(e.name, e.count, e.durability) ?? e.count)
          : e.count;
        if (accepted >= e.count) {
          remove(i);
          continue;
        }
        if (accepted > 0) e.count -= accepted;
        e.retry = ITEMS.PICKUP_RETRY_SECONDS; // inventory full — try later
      }

      if (active && e.retry <= 0 && dist <= ITEMS.MAGNET_RADIUS && dist > EPS) {
        // Magnetised: fly straight at the body centre — but still through
        // the collision move, so a wall between item and player blocks the
        // pull instead of letting it vacuum drops through solid blocks.
        const s = ITEMS.MAGNET_SPEED / dist;
        e.vel.x = dx * s;
        e.vel.y = dy * s;
        e.vel.z = dz * s;
        e.grounded = false;
        moveWithCollision(e, dt);
      } else {
        stepPhysics(e, dt);
      }

      // Bob and rotate (visual only — the entity base stays on the ground)
      e.group.position.set(e.pos.x, e.pos.y, e.pos.z);
      const bob = (Math.sin(TAU * ITEMS.BOB_SPEED * e.age + e.phase) + 1) / 2;
      e.inner.position.y = e.halfHeight + bob * ITEMS.BOB_HEIGHT;
      e.inner.rotation.y = ITEMS.ROTATE_SPEED * e.age + e.phase;
    }
  }

  function clear() {
    for (let i = entities.length - 1; i >= 0; i--) remove(i);
  }

  return {
    spawn,
    update,
    clear,
    entities, // read-only by convention (debug overlay / tests)
    get count() {
      return entities.length;
    },
  };
}
