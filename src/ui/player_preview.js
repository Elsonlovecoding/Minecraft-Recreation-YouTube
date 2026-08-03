// ui/player_preview.js — Phase 14: the live 3D player model on the
// inventory screen (vanilla's inset beside the crafting grid). The model is
// the standard Minecraft humanoid built from boxes (head 8x8x8, body
// 8x12x4, arms/legs 4x12x4 — entities/models.js HUMANOID_MODEL) wearing a
// generated neutral skin (no Steve skin ships in assets/entity, so the
// classic look is painted onto a canvas: skin tones, teal shirt, blue
// trousers). Equipped armour renders as colour-coded inflated overlay boxes
// on the matching limbs, synced live from the inventory's armour slots.
// The whole model turns to follow the mouse, the head leading, like the
// vanilla screen.
//
// Rendering: a dedicated small WebGLRenderer on its own canvas — the main
// renderer owns the world frame and the panel is DOM, so a second tiny
// context is the clean way to composite into the screen. It only renders
// while the inventory screen is open (ui/screens.js drives update()).

import * as THREE from 'three';
import { UI, LIGHTING } from '../config.js';
import { createMobModel, HUMANOID_MODEL } from '../entities/models.js';
import { ARMOR_PIECES } from '../player/inventory.js';

const PX = 1 / 16;
const P = () => UI.PLAYER_PREVIEW;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The generated 64x64 skin, painted region by region along the standard
// humanoid unwrap (head at (0,0) 8x8x8, body (16,16) 8x12x4, arm (40,16)
// and leg (0,16) 4x12x4 — left limbs mirror). Per-pixel value noise keeps
// it from reading as flat plastic, like the first-person arm's skin.
function createNeutralSkin() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(0x51e7e);
  const paint = (x, y, w, h, [r, g, b], jitter = 14) => {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const v = (rand() - 0.5) * jitter;
        ctx.fillStyle = `rgb(${r + v | 0},${g + v | 0},${b + v | 0})`;
        ctx.fillRect(px, py, 1, 1);
      }
    }
  };
  const SKIN = [197, 148, 112];
  const HAIR = [62, 42, 28];
  const SHIRT = [0, 128, 128];
  const TROUSER = [70, 82, 140];
  const SHOE = [70, 70, 70];
  // Head: top+bottom (8..23, 0..7), side strip (0..31, 8..15)
  paint(8, 0, 16, 8, HAIR);          // top of head (hair) + underside
  paint(16, 0, 8, 8, SKIN);          // bottom region stays skin
  paint(0, 8, 32, 8, SKIN);          // all four sides
  paint(0, 8, 32, 2, HAIR);          // hairline around the top of the sides
  // Face (front region 8..15, 8..15): eyes + mouth
  paint(10, 12, 1, 1, [255, 255, 255], 0);
  paint(11, 12, 1, 1, [70, 60, 160], 0);
  paint(13, 12, 1, 1, [70, 60, 160], 0);
  paint(14, 12, 1, 1, [255, 255, 255], 0);
  paint(11, 14, 3, 1, [150, 100, 80], 0);
  // Body (16,16): top/bottom (20..35, 16..19), sides (16..39, 20..31)
  paint(16, 16, 24, 4, SHIRT);
  paint(16, 20, 24, 12, SHIRT);
  // Arm (40,16) 4x12x4: skin with a sleeve across the top rows
  paint(40, 16, 16, 4, SKIN);
  paint(40, 20, 16, 12, SKIN);
  paint(40, 20, 16, 3, SHIRT);
  // Leg (0,16) 4x12x4: trousers with shoes at the bottom
  paint(0, 16, 16, 4, TROUSER);
  paint(0, 20, 16, 12, TROUSER);
  paint(0, 29, 16, 3, SHOE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A plain-colour box with per-face brightness vertex colours (the armour
// overlays — no texture, just the material tint).
function shadedBox(w, h, d, material) {
  const geometry = new THREE.BoxGeometry(w * PX, h * PX, d * PX);
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  const FB = LIGHTING.FACE_BRIGHTNESS;
  for (let i = 0; i < normals.count; i++) {
    const ny = normals.getY(i);
    const b = ny > 0.5 ? FB.top : ny < -0.5 ? FB.bottom : FB.side;
    colors[i * 3] = b;
    colors[i * 3 + 1] = b;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geometry, material);
}

// Armour overlay colours by material prefix (leather_helmet -> leather).
const ARMOUR_COLOURS = {
  leather: 0xa06540,
  golden: 0xf5d94a,
  iron: 0xd8d8dd,
  diamond: 0x45dcd2,
};

// A tiny plate texture shared by every overlay box: white base with a
// darker rim and a top-left sheen, tinted by the material colour — flat
// colour alone reads as a silhouette blob on the small preview.
let plateTexture = null;
function getPlateTexture() {
  if (plateTexture) return plateTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = '#a8a8a8';
  ctx.fillRect(0, 0, 8, 1);
  ctx.fillRect(0, 7, 8, 1);
  ctx.fillRect(0, 0, 1, 8);
  ctx.fillRect(7, 0, 1, 8);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(1, 1, 3, 1);
  ctx.fillRect(1, 2, 1, 2);
  plateTexture = new THREE.CanvasTexture(canvas);
  plateTexture.magFilter = THREE.NearestFilter;
  plateTexture.minFilter = THREE.NearestFilter;
  plateTexture.generateMipmaps = false;
  return plateTexture;
}

export function createPlayerPreview({ inventory }) {
  const el = document.createElement('div');
  el.className = 'player-preview';
  const canvas = document.createElement('canvas');
  el.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setSize(P().WIDTH_PX, P().HEIGHT_PX);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    P().FOV, P().WIDTH_PX / P().HEIGHT_PX, 0.1, 20,
  );
  // The model faces -z; the camera sits on that side looking back at it.
  camera.position.set(0, P().CAMERA_HEIGHT, -P().CAMERA_DISTANCE);
  camera.lookAt(0, P().CAMERA_HEIGHT, 0);

  const skin = createNeutralSkin();
  const { group, parts } = createMobModel({
    texture: skin,
    textureKey: 'player-preview',
    textureSize: [64, 64],
    model: HUMANOID_MODEL,
  });
  scene.add(group);

  // --- armour overlays: per equip slot, inflated boxes over the limbs the
  // piece covers, coloured by its material. One material per slot instance
  // (tint swaps when the piece changes).
  const inflate = P().ARMOUR_INFLATE_PX;
  const thin = P().LEGGING_INFLATE_PX;
  const overlays = []; // per armour slot: { material, meshes: [] }
  const addOverlay = (slot, part, w, h, d, grow, cx, cy, cz) => {
    const mesh = shadedBox(w + 2 * grow, h + 2 * grow, d + 2 * grow, overlays[slot].material);
    mesh.position.set(cx * PX, cy * PX, cz * PX);
    parts[part].add(mesh);
    overlays[slot].meshes.push(mesh);
  };
  for (let i = 0; i < ARMOR_PIECES.length; i++) {
    overlays.push({
      material: new THREE.MeshBasicMaterial({
        map: getPlateTexture(), vertexColors: true, toneMapped: false,
      }),
      meshes: [],
    });
  }
  // helmet: the head. chestplate: torso + both upper arms. leggings: hips +
  // upper legs (thinner, so boots/chest read over them). boots: lower legs.
  addOverlay(0, 'head', 8, 8, 8, inflate, 0, 4, 0);
  addOverlay(1, 'body', 8, 12, 4, inflate, 0, 6, 0);
  addOverlay(1, 'rightArm', 4, 12, 4, inflate, 0, -4, 0);
  addOverlay(1, 'leftArm', 4, 12, 4, inflate, 0, -4, 0);
  addOverlay(2, 'body', 8, 5, 4, thin, 0, 2.5, 0);
  addOverlay(2, 'rightLeg', 4, 7, 4, thin, 0, -3.5, 0);
  addOverlay(2, 'leftLeg', 4, 7, 4, thin, 0, -3.5, 0);
  addOverlay(3, 'rightLeg', 4, 5, 4, inflate, 0, -9.5, 0);
  addOverlay(3, 'leftLeg', 4, 5, 4, inflate, 0, -9.5, 0);

  function syncArmour() {
    for (let i = 0; i < overlays.length; i++) {
      const stack = inventory.armour.get(i);
      const visible = !!stack;
      const material = visible ? /^([a-z]+)_/.exec(stack.name)?.[1] : null;
      overlays[i].material.color.setHex(ARMOUR_COLOURS[material] ?? 0xd8d8dd);
      for (const mesh of overlays[i].meshes) mesh.visible = visible;
    }
  }
  inventory.armour.subscribe(syncArmour);
  syncArmour();

  // --- mouse follow: the body turns toward the cursor, the head leading a
  // little further, eased per frame (ui/screens.js feeds cursor moves).
  let targetYaw = 0;
  let targetPitch = 0;
  let yaw = 0;
  let pitch = 0;

  function onMouseMove(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const dx = (clientX - (rect.left + rect.width / 2)) / rect.width;
    const dy = (clientY - (rect.top + rect.height / 2)) / rect.height;
    // The camera looks along +z at the model's -z face, so screen-right is
    // world -x — positive yaw turns the model's gaze that way; screen-down
    // (dy positive) is a downward glance (negative head pitch).
    targetYaw = Math.max(-1.6, Math.min(1.6, dx * 2.2));
    targetPitch = Math.max(
      -P().MAX_HEAD_PITCH, Math.min(P().MAX_HEAD_PITCH, -dy * 1.4),
    );
  }

  function update(dt) {
    const k = 1 - Math.exp(-P().TURN_RATE * dt);
    yaw += (targetYaw - yaw) * k;
    pitch += (targetPitch - pitch) * k;
    const bodyYaw = Math.max(-P().MAX_BODY_YAW, Math.min(P().MAX_BODY_YAW, yaw));
    group.rotation.y = bodyYaw;
    const headYaw = Math.max(
      -P().HEAD_EXTRA_YAW, Math.min(P().HEAD_EXTRA_YAW, yaw - bodyYaw),
    );
    parts.head.rotation.y = headYaw;
    parts.head.rotation.x = pitch;
    renderer.render(scene, camera);
  }

  return { el, update, onMouseMove };
}
