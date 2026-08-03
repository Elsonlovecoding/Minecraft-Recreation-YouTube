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
//     vanilla uses it for the sheep's wool layer),
//     rotation?: [x, y, z] radians baked at creation (the quadruped body
//       lies on its side: the vanilla π/2 body roll, -x here),
//     boxes?: [{ texOffs, size, offset, mirror?, inflate? }, ...] extra
//       boxes riding the same pivot (Phase 14 — a pig's snout, the cow's
//       nose/horns/udder, the chicken's beak: vanilla attaches several
//       cubes to one bone) }
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
  const key = `${def.textureKey ?? def.texture}:${part.name}`;
  let geometry = geometryCache.get(key);
  if (geometry) return geometry;
  const arrays = { pos: [], uv: [], col: [], idx: [] };
  const [tw, th] = def.textureSize;
  // The part's own box plus any extra boxes riding the same pivot.
  const boxes = [part, ...(part.boxes ?? [])];
  for (const box of boxes) {
    const [w, h, d] = box.size;
    const [ox, oy, oz] = box.offset;
    const grow = (box.inflate ?? 0) * PX;
    appendBox(
      arrays,
      ox * PX - grow, oy * PX - grow, oz * PX - grow,
      (ox + w) * PX + grow, (oy + h) * PX + grow, (oz + d) * PX + grow,
      box.texOffs[0], box.texOffs[1], w, h, d, tw, th,
      !!box.mirror,
    );
  }
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
  // A ready THREE.Texture passes through (the player preview's generated
  // canvas skin — ui/player_preview.js — has no file to load).
  if (path && path.isTexture) return path;
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
    // Baked base rotation (quadruped bodies lie on their side). Animation
    // never writes these parts, so the pose survives.
    if (part.rotation) pivot.rotation.set(...part.rotation);
    pivot.add(new THREE.Mesh(partGeometry(def, part), material));
    group.add(pivot);
    parts[part.name] = pivot;
  }
  return { group, parts, material };
}

// Attach a second texture's model (the sheep's wool coat) onto an existing
// model's parts: each overlay part shares its base part's pivot AND baked
// rotation, so it becomes a zero-offset child and rides every animation for
// free. Returns the overlay material (for tinting alongside the base) and
// the overlay pivots (visibility toggling — shearing).
export function attachOverlayModel(baseParts, overlayDef) {
  const { parts, material } = createMobModel(overlayDef);
  const pivots = [];
  for (const [name, pivot] of Object.entries(parts)) {
    const basePart = baseParts[name];
    if (!basePart) continue;
    pivot.position.set(0, 0, 0);
    pivot.rotation.set(0, 0, 0);
    basePart.add(pivot);
    pivots.push(pivot);
  }
  return { material, pivots };
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

// ---------------------------------------------------------------------------
// Passive herd models (Phase 14) — converted from the vanilla models with
// the same rules, verified box-by-box against the shipped sheets' actual
// UV regions (the alpha maps line up exactly). Quadruped bodies carry the
// vanilla lying-on-the-side roll as a baked part rotation (three.js
// -π/2 x — animation never touches the body part, so it holds).
// ---------------------------------------------------------------------------

const QUAD_BODY_ROLL = [-Math.PI / 2, 0, 0];

// Pig (pig_temperate_pig.png, 64x64 — classic quadruped layout in the top
// half): 8x8x8 head with the snout box, 10x16x8 body, four 4x6x4 legs.
export const PIG_MODEL = [
  { name: 'head', texOffs: [0, 0], size: [8, 8, 8], pivot: [0, 12, -6], offset: [-4, -4, -8],
    boxes: [{ texOffs: [16, 16], size: [4, 3, 1], offset: [-2, -3, -9] }] },
  { name: 'body', texOffs: [28, 8], size: [10, 16, 8], pivot: [0, 13, 2], offset: [-5, -6, -7],
    rotation: QUAD_BODY_ROLL },
  { name: 'rightHindLeg', texOffs: [0, 16], size: [4, 6, 4], pivot: [-3, 6, 7], offset: [-2, -6, -2] },
  { name: 'leftHindLeg', texOffs: [0, 16], size: [4, 6, 4], pivot: [3, 6, 7], offset: [-2, -6, -2] },
  { name: 'rightFrontLeg', texOffs: [0, 16], size: [4, 6, 4], pivot: [-3, 6, -5], offset: [-2, -6, -2] },
  { name: 'leftFrontLeg', texOffs: [0, 16], size: [4, 6, 4], pivot: [3, 6, -5], offset: [-2, -6, -2] },
];

// Cow (cow_temperate_cow.png, 64x64 — the 1.21.5 sheet: classic cow layout
// plus the remodel's 6x3x2 nose at (0,32), confirmed present in the art):
// 8x8x6 head with nose and two 1x3x1 horns, 12x18x10 body with the 4x6x1
// udder, four 4x12x4 legs.
export const COW_MODEL = [
  { name: 'head', texOffs: [0, 0], size: [8, 8, 6], pivot: [0, 20, -8], offset: [-4, -4, -6],
    boxes: [
      { texOffs: [0, 32], size: [6, 3, 2], offset: [-3, -4, -8] },   // nose
      { texOffs: [22, 0], size: [1, 3, 1], offset: [-5, 2, -4] },    // right horn
      { texOffs: [22, 0], size: [1, 3, 1], offset: [4, 2, -4] },     // left horn
    ] },
  { name: 'body', texOffs: [18, 4], size: [12, 18, 10], pivot: [0, 19, 2], offset: [-6, -8, -7],
    rotation: QUAD_BODY_ROLL,
    boxes: [{ texOffs: [52, 0], size: [4, 6, 1], offset: [-2, -8, -8] }] }, // udder
  { name: 'rightHindLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [-3, 12, 7], offset: [-2, -12, -2] },
  { name: 'leftHindLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [3, 12, 7], offset: [-2, -12, -2] },
  { name: 'rightFrontLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [-3, 12, -5], offset: [-2, -12, -2] },
  { name: 'leftFrontLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [3, 12, -5], offset: [-2, -12, -2] },
];

// Sheep (sheep_sheep.png, 64x32): the skin layer — 6x6x8 head, 8x16x6 body,
// four 4x12x4 legs. The wool coat is the overlay model below on its own
// sheet, attached via attachOverlayModel (hidden while sheared).
export const SHEEP_MODEL = [
  { name: 'head', texOffs: [0, 0], size: [6, 6, 8], pivot: [0, 18, -8], offset: [-3, -2, -6] },
  { name: 'body', texOffs: [28, 8], size: [8, 16, 6], pivot: [0, 19, 2], offset: [-4, -6, -7],
    rotation: QUAD_BODY_ROLL },
  { name: 'rightHindLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [-3, 12, 7], offset: [-2, -12, -2] },
  { name: 'leftHindLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [3, 12, 7], offset: [-2, -12, -2] },
  { name: 'rightFrontLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [-3, 12, -5], offset: [-2, -12, -2] },
  { name: 'leftFrontLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [3, 12, -5], offset: [-2, -12, -2] },
];

// The wool coat (sheep_sheep_wool.png): the same rig inflated — head cap
// 0.6px, body coat 1.75px, upper-leg cuffs 0.5px (vanilla fur layer).
export const SHEEP_WOOL_MODEL = [
  { name: 'head', texOffs: [0, 0], size: [6, 6, 6], pivot: [0, 18, -8], offset: [-3, -2, -4], inflate: 0.6 },
  { name: 'body', texOffs: [28, 8], size: [8, 16, 6], pivot: [0, 19, 2], offset: [-4, -6, -7], inflate: 1.75 },
  { name: 'rightHindLeg', texOffs: [0, 16], size: [4, 6, 4], pivot: [-3, 12, 7], offset: [-2, -6, -2], inflate: 0.5 },
  { name: 'leftHindLeg', texOffs: [0, 16], size: [4, 6, 4], pivot: [3, 12, 7], offset: [-2, -6, -2], inflate: 0.5 },
  { name: 'rightFrontLeg', texOffs: [0, 16], size: [4, 6, 4], pivot: [-3, 12, -5], offset: [-2, -6, -2], inflate: 0.5 },
  { name: 'leftFrontLeg', texOffs: [0, 16], size: [4, 6, 4], pivot: [3, 12, -5], offset: [-2, -6, -2], inflate: 0.5 },
];

// Chicken (chicken_temperate_chicken.png, 64x32): 4x6x3 head with beak and
// wattle, 6x8x6 body, 3x5x3 legs, 1x4x6 wings (flap while falling).
export const CHICKEN_MODEL = [
  { name: 'head', texOffs: [0, 0], size: [4, 6, 3], pivot: [0, 9, -4], offset: [-2, 0, -2],
    boxes: [
      { texOffs: [14, 0], size: [4, 2, 2], offset: [-2, 2, -4] },    // beak
      { texOffs: [14, 4], size: [2, 2, 2], offset: [-1, 0, -3] },    // wattle
    ] },
  { name: 'body', texOffs: [0, 9], size: [6, 8, 6], pivot: [0, 8, 0], offset: [-3, -4, -3],
    rotation: QUAD_BODY_ROLL },
  { name: 'rightLeg', texOffs: [26, 0], size: [3, 5, 3], pivot: [-2, 5, 1], offset: [-1, -5, -3] },
  { name: 'leftLeg', texOffs: [26, 0], size: [3, 5, 3], pivot: [1, 5, 1], offset: [-1, -5, -3] },
  { name: 'rightWing', texOffs: [24, 13], size: [1, 4, 6], pivot: [-4, 11, 0], offset: [0, -4, -3] },
  { name: 'leftWing', texOffs: [24, 13], size: [1, 4, 6], pivot: [4, 11, 0], offset: [-1, -4, -3] },
];
