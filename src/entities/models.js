// entities/models.js — Phase 12: mob models built from textured boxes, using
// the real entity sheets in assets/entity/ with the STANDARD Minecraft box
// unwrap (unlike the chest sheet, these are not stored rotated):
//
//   For a box of w x h x d pixels at texOffs (u, v):
//     top    (u+d,     v,   w, d)     bottom (u+d+w,   v,   w, d)
//     right  (u,       v+d, d, h)     front  (u+d,     v+d, w, h)
//     left   (u+d+w,   v+d, d, h)     back   (u+d+w+d, v+d, w, h)
//
//   The front region maps onto the model's -z face (Minecraft models face
//   north); the mob's yaw turns the whole group, with forward = (-sin yaw,
//   0, -cos yaw) like the player controller. `mirror` flips U for left
//   limbs that reuse the right limb's texOffs — legacy sheets (zombie) keep
//   their whole bottom half empty and mirror instead.
//
// A part definition:
//   { name, texOffs: [u, v], size: [w, h, d] (px), pivot: [x, y, z] (px,
//     model space, feet origin), offset: [x, y, z] (px, box min corner
//     relative to the pivot), mirror?, inflate? (px grown on every side —
//     vanilla uses it for zombie/creeper heads' outer skin, we for none yet) }
//
// createMobModel returns { group, parts, material }: `group` sits at the
// feet centre, each named part is a Group pivoted for animation (swing legs
// with parts.rightLeg.rotation.x...), and `material` is a per-instance
// clone so hurt flashes and world-light tinting affect one mob at a time.
// Like chests/items/hand, mobs are unlit (per-face brightness vertex
// colours); the mob manager multiplies the material colour by the local
// baked light so cave mobs read dark and torch-lit mobs warm.

import * as THREE from 'three';
import { LIGHTING } from '../config.js';

const PX = 1 / 16; // one texture/model pixel in block units

// ---------------------------------------------------------------------------
// Box geometry with the standard entity unwrap
// ---------------------------------------------------------------------------

// Appends one box to the arrays. (x0..z1) in block units; (u, v) texOffs and
// (w, h, d) the box's pixel dimensions on a texW x texH sheet.
function appendBox(arrays, x0, y0, z0, x1, y1, z1, u, v, w, h, d, texW, texH, mirror) {
  const FB = LIGHTING.FACE_BRIGHTNESS;
  const regions = {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],           // +x (the model's right when facing -z)
    front: [u + d, v + d, w, h],       // -z
    left: [u + d + w, v + d, d, h],    // -x
    back: [u + d + w + d, v + d, w, h], // +z
  };
  // Four corners in CCW perimeter order seen from outside (fan-indexed like
  // world/chests.js), each with face-local (s, t): s runs along the region's
  // u axis, t up the face (sheet v runs downward). Shared unwrap edges line
  // up: the front region's left edge (u+d) is the box's front-right vertical
  // edge (x1, z0), which is also the right region's right edge; the top
  // region's bottom edge is the box's front-top edge.
  const faces = [
    { r: 'right', b: FB.side, corners: [
      [x1, y0, z1, 0, 0], [x1, y0, z0, 1, 0], [x1, y1, z0, 1, 1], [x1, y1, z1, 0, 1]] },
    { r: 'left', b: FB.side, corners: [
      [x0, y0, z0, 0, 0], [x0, y0, z1, 1, 0], [x0, y1, z1, 1, 1], [x0, y1, z0, 0, 1]] },
    { r: 'front', b: FB.side, corners: [
      [x1, y0, z0, 0, 0], [x0, y0, z0, 1, 0], [x0, y1, z0, 1, 1], [x1, y1, z0, 0, 1]] },
    { r: 'back', b: FB.side, corners: [
      [x0, y0, z1, 0, 0], [x1, y0, z1, 1, 0], [x1, y1, z1, 1, 1], [x0, y1, z1, 0, 1]] },
    { r: 'top', b: FB.top, corners: [
      [x0, y1, z1, 1, 1], [x1, y1, z1, 0, 1], [x1, y1, z0, 0, 0], [x0, y1, z0, 1, 0]] },
    { r: 'bottom', b: FB.bottom, corners: [
      [x1, y0, z1, 1, 1], [x0, y0, z1, 0, 1], [x0, y0, z0, 0, 0], [x1, y0, z0, 1, 0]] },
  ];
  const { pos, uv, col, idx } = arrays;
  for (const face of faces) {
    const [rx, ry, rw, rh] = regions[face.r];
    const base = pos.length / 3;
    for (const [x, y, z, s, t] of face.corners) {
      pos.push(x, y, z);
      const fs = mirror ? 1 - s : s;
      uv.push((rx + fs * rw) / texW, 1 - (ry + (1 - t) * rh) / texH);
      col.push(face.b, face.b, face.b);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// Geometry per (texture, part) is shared across all mobs of a type.
const geometryCache = new Map();

function partGeometry(def, part) {
  const key = `${def.texture}:${part.name}`;
  let geometry = geometryCache.get(key);
  if (geometry) return geometry;
  const arrays = { pos: [], uv: [], col: [], idx: [] };
  const [w, h, d] = part.size;
  const [ox, oy, oz] = part.offset;
  const grow = (part.inflate ?? 0) * PX;
  const [tw, th] = def.textureSize;
  appendBox(
    arrays,
    ox * PX - grow, oy * PX - grow, oz * PX - grow,
    (ox + w) * PX + grow, (oy + h) * PX + grow, (oz + d) * PX + grow,
    part.texOffs[0], part.texOffs[1], w, h, d, tw, th,
    !!part.mirror,
  );
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(arrays.pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(arrays.uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(arrays.col, 3));
  geometry.setIndex(arrays.idx);
  return geometryCache.set(key, geometry), geometry;
}

// Textures shared per sheet; materials cloned per mob instance for tinting.
const textureCache = new Map();

function sheetTexture(path) {
  let texture = textureCache.get(path);
  if (!texture) {
    texture = new THREE.TextureLoader().load(path);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(path, texture);
  }
  return texture;
}

// ---------------------------------------------------------------------------
// Model instances
// ---------------------------------------------------------------------------

// `def` is a mob type from entities/mobs.js: { texture, textureSize, model:
// [parts...] }. Returns { group, parts, material }.
export function createMobModel(def) {
  const material = new THREE.MeshBasicMaterial({
    map: sheetTexture(def.texture),
    vertexColors: true,
    toneMapped: false, // exact texel colours, like terrain/chests/items
    // Entity sheets keep unused regions transparent; discard those texels
    // so an empty pixel can never render as a black film over the box.
    alphaTest: 0.5,
  });
  const group = new THREE.Group();
  const parts = {};
  for (const part of def.model) {
    const pivot = new THREE.Group();
    pivot.position.set(part.pivot[0] * PX, part.pivot[1] * PX, part.pivot[2] * PX);
    // Yaw before pitch on the part's own axes (vanilla): with the default
    // XYZ order a yawed head pitching at the player ROLLS sideways instead
    // of nodding — the Phase 12 zombie's "head angled slightly wrong" bug.
    pivot.rotation.order = 'YXZ';
    pivot.add(new THREE.Mesh(partGeometry(def, part), material));
    group.add(pivot);
    parts[part.name] = pivot;
  }
  return { group, parts, material };
}

// ---------------------------------------------------------------------------
// Model tables (Phase 13) — the real vanilla model geometry, converted to
// this file's y-up feet-origin format. Conversion from the Java models:
// pivot_y = 24 - rotationPoint_y (24 is the ground in y-down model space),
// offset_y = -(boxOffset_y + boxHeight); x/z carry over. Stats live in the
// entities/mobs.js registry per ARCHITECTURE.md; these are geometry only.
// ---------------------------------------------------------------------------

// The classic humanoid rig (zombie: a legacy 64x64 sheet whose bottom half
// is empty — left limbs mirror the right limbs' texture regions).
export const HUMANOID_MODEL = [
  { name: 'head', texOffs: [0, 0], size: [8, 8, 8], pivot: [0, 24, 0], offset: [-4, 0, -4] },
  { name: 'body', texOffs: [16, 16], size: [8, 12, 4], pivot: [0, 12, 0], offset: [-4, 0, -2] },
  { name: 'rightArm', texOffs: [40, 16], size: [4, 12, 4], pivot: [6, 22, 0], offset: [-2, -10, -2] },
  { name: 'leftArm', texOffs: [40, 16], size: [4, 12, 4], pivot: [-6, 22, 0], offset: [-2, -10, -2], mirror: true },
  { name: 'rightLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [2, 12, 0], offset: [-2, -12, -2] },
  { name: 'leftLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [-2, 12, 0], offset: [-2, -12, -2], mirror: true },
];

// Skeleton: the humanoid rig with 2px-thin arms and legs (64x32 sheet).
export const SKELETON_MODEL = [
  { name: 'head', texOffs: [0, 0], size: [8, 8, 8], pivot: [0, 24, 0], offset: [-4, 0, -4] },
  { name: 'body', texOffs: [16, 16], size: [8, 12, 4], pivot: [0, 12, 0], offset: [-4, 0, -2] },
  { name: 'rightArm', texOffs: [40, 16], size: [2, 12, 2], pivot: [5, 22, 0], offset: [-1, -10, -1] },
  { name: 'leftArm', texOffs: [40, 16], size: [2, 12, 2], pivot: [-5, 22, 0], offset: [-1, -10, -1], mirror: true },
  { name: 'rightLeg', texOffs: [0, 16], size: [2, 12, 2], pivot: [2, 12, 0], offset: [-1, -12, -1] },
  { name: 'leftLeg', texOffs: [0, 16], size: [2, 12, 2], pivot: [-2, 12, 0], offset: [-1, -12, -1], mirror: true },
];

// Creeper: head on a tall body over four stubby legs (64x32 sheet). Legs
// 1/2 sit at the back (+z), 3/4 at the front; walking swings diagonal pairs.
export const CREEPER_MODEL = [
  { name: 'head', texOffs: [0, 0], size: [8, 8, 8], pivot: [0, 18, 0], offset: [-4, 0, -4] },
  { name: 'body', texOffs: [16, 16], size: [8, 12, 4], pivot: [0, 18, 0], offset: [-4, -12, -2] },
  { name: 'leg1', texOffs: [0, 16], size: [4, 6, 4], pivot: [-2, 6, 4], offset: [-2, -6, -2] },
  { name: 'leg2', texOffs: [0, 16], size: [4, 6, 4], pivot: [2, 6, 4], offset: [-2, -6, -2] },
  { name: 'leg3', texOffs: [0, 16], size: [4, 6, 4], pivot: [-2, 6, -4], offset: [-2, -6, -2] },
  { name: 'leg4', texOffs: [0, 16], size: [4, 6, 4], pivot: [2, 6, -4], offset: [-2, -6, -2] },
];

// Spider: head + neck + abdomen and eight 16px legs pivoted at the body
// sides (64x32 sheet). legL* extend -x, legR* +x; z from rear to front.
export const SPIDER_MODEL = [
  { name: 'head', texOffs: [32, 4], size: [8, 8, 8], pivot: [0, 9, -3], offset: [-4, -4, -8] },
  { name: 'neck', texOffs: [0, 0], size: [6, 6, 6], pivot: [0, 9, 0], offset: [-3, -3, -3] },
  { name: 'body', texOffs: [0, 12], size: [10, 8, 12], pivot: [0, 9, 9], offset: [-5, -4, -6] },
  { name: 'legL1', texOffs: [18, 0], size: [16, 2, 2], pivot: [-4, 9, 2], offset: [-15, -1, -1] },
  { name: 'legR1', texOffs: [18, 0], size: [16, 2, 2], pivot: [4, 9, 2], offset: [-1, -1, -1] },
  { name: 'legL2', texOffs: [18, 0], size: [16, 2, 2], pivot: [-4, 9, 1], offset: [-15, -1, -1] },
  { name: 'legR2', texOffs: [18, 0], size: [16, 2, 2], pivot: [4, 9, 1], offset: [-1, -1, -1] },
  { name: 'legL3', texOffs: [18, 0], size: [16, 2, 2], pivot: [-4, 9, 0], offset: [-15, -1, -1] },
  { name: 'legR3', texOffs: [18, 0], size: [16, 2, 2], pivot: [4, 9, 0], offset: [-1, -1, -1] },
  { name: 'legL4', texOffs: [18, 0], size: [16, 2, 2], pivot: [-4, 9, -1], offset: [-15, -1, -1] },
  { name: 'legR4', texOffs: [18, 0], size: [16, 2, 2], pivot: [4, 9, -1], offset: [-1, -1, -1] },
];

// Spider leg rest pose (the vanilla splay): per leg-pair { roll, yaw } in
// radians, written for the LEFT (-x-extending) legs — roll slopes a leg
// down to the ground, yaw fans rear legs backward and front legs forward;
// right legs use the negated angles. Pairs run rear (index 0) to front.
// Animation swings yaw around these.
const SP_ROLL = Math.PI / 4;
const SP_YAW = Math.PI / 8;
export const SPIDER_LEG_POSE = [
  { roll: SP_ROLL, yaw: SP_YAW * 2 },          // rear pair
  { roll: SP_ROLL * 0.74, yaw: SP_YAW },       // mid-rear
  { roll: SP_ROLL * 0.74, yaw: -SP_YAW },      // mid-front
  { roll: SP_ROLL, yaw: -SP_YAW * 2 },         // front pair
];
