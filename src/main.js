// main.js — bootstrap and game loop. Wires renderer, atlas, sky, and (for
// Phase 1) a lit test scene of textured cubes with a free-fly debug camera.
// The test scene is temporary and gets replaced by real chunked terrain.

import * as THREE from 'three';
import { DEBUG, LIGHTING } from './config.js';
import { createRenderer, createCamera, attachResizeHandler } from './render/renderer.js';
import { loadAtlas, getUV, TILE } from './render/atlas.js';
import { createSky, createFog, createSunLight, createAmbientLight } from './render/lighting.js';
import { initDebug, updateDebug, logTerrainProfile, logColumn, logBlockCensus } from './ui/debug.js';
import { World } from './world/world.js';

// ---------------------------------------------------------------------------
// Test-scene cube building
// ---------------------------------------------------------------------------

// BoxGeometry lays out its 24 vertices as 4 per face in the order
// +x, -x, +y, -y, +z, -z. We rewrite the UVs per face from the atlas and add
// vertex colours for the Minecraft per-face brightness (top/side/bottom).
const FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

const geometryCache = new Map();

function createBlockGeometry(faces) {
  const key = FACE_ORDER.map((f) => resolveFaceTile(faces, f)).join(',');
  if (geometryCache.has(key)) return geometryCache.get(key);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const uvs = geometry.getAttribute('uv');
  const colors = new Float32Array(24 * 3);
  const b = LIGHTING.FACE_BRIGHTNESS;

  FACE_ORDER.forEach((face, i) => {
    const { u0, v0, u1, v1 } = getUV(resolveFaceTile(faces, face));
    const o = i * 4;
    uvs.setXY(o + 0, u0, v1);
    uvs.setXY(o + 1, u1, v1);
    uvs.setXY(o + 2, u0, v0);
    uvs.setXY(o + 3, u1, v0);

    const brightness = face === 'py' ? b.top : face === 'ny' ? b.bottom : b.side;
    for (let v = 0; v < 4; v++) {
      colors[(o + v) * 3 + 0] = brightness;
      colors[(o + v) * 3 + 1] = brightness;
      colors[(o + v) * 3 + 2] = brightness;
    }
  });

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometryCache.set(key, geometry);
  return geometry;
}

// faces: { all } or { top, bottom, side } or full { px, nx, py, ny, pz, nz }
function resolveFaceTile(faces, face) {
  if (faces[face] !== undefined) return faces[face];
  if (face === 'py') return faces.top ?? faces.all;
  if (face === 'ny') return faces.bottom ?? faces.all;
  return faces.side ?? faces.all;
}

function buildTestScene(scene, atlasTexture) {
  const solid = new THREE.MeshLambertMaterial({
    map: atlasTexture,
    vertexColors: true,
  });
  const cutout = new THREE.MeshLambertMaterial({
    map: atlasTexture,
    vertexColors: true,
    alphaTest: 0.5,
  });

  const blocks = {
    grass: { top: TILE.GRASS_TOP, side: TILE.GRASS_SIDE, bottom: TILE.DIRT },
    dirt: { all: TILE.DIRT },
    stone: { all: TILE.STONE },
    cobblestone: { all: TILE.COBBLESTONE },
    sand: { all: TILE.SAND },
    gravel: { all: TILE.GRAVEL },
    oakLog: { top: TILE.OAK_LOG_TOP, bottom: TILE.OAK_LOG_TOP, side: TILE.OAK_LOG },
    oakPlanks: { all: TILE.OAK_PLANKS },
    oakLeaves: { all: TILE.OAK_LEAVES },
    craftingTable: {
      top: TILE.CRAFTING_TABLE_TOP,
      bottom: TILE.OAK_PLANKS,
      pz: TILE.CRAFTING_TABLE_FRONT,
      nz: TILE.CRAFTING_TABLE_FRONT,
      px: TILE.CRAFTING_TABLE_SIDE,
      nx: TILE.CRAFTING_TABLE_SIDE,
    },
    furnace: {
      top: TILE.FURNACE_TOP,
      bottom: TILE.FURNACE_TOP,
      pz: TILE.FURNACE_FRONT,
      nz: TILE.FURNACE_SIDE,
      px: TILE.FURNACE_SIDE,
      nx: TILE.FURNACE_SIDE,
    },
    bookshelf: { top: TILE.OAK_PLANKS, bottom: TILE.OAK_PLANKS, side: TILE.BOOKSHELF },
    glowstone: { all: TILE.GLOWSTONE },
    obsidian: { all: TILE.OBSIDIAN },
    bedrock: { all: TILE.BEDROCK },
    coalOre: { all: TILE.COAL_ORE },
    ironOre: { all: TILE.IRON_ORE },
    goldOre: { all: TILE.GOLD_ORE },
    redstoneOre: { all: TILE.REDSTONE_ORE },
    diamondOre: { all: TILE.DIAMOND_ORE },
    ironBlock: { all: TILE.IRON_BLOCK },
    goldBlock: { all: TILE.GOLD_BLOCK },
    diamondBlock: { all: TILE.DIAMOND_BLOCK },
    stoneBricks: { all: TILE.STONE_BRICKS },
  };

  const placeBlock = (name, x, y, z, { casts = true } = {}) => {
    const material = name === 'oakLeaves' ? cutout : solid;
    const mesh = new THREE.Mesh(createBlockGeometry(blocks[name]), material);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.castShadow = casts;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  // Grass ground, 16x16. Ground blocks skip shadow casting to keep the
  // test scene's draw cost down; everything on top casts.
  for (let x = -8; x < 8; x++) {
    for (let z = -8; z < 8; z++) {
      placeBlock('grass', x, 0, z, { casts: false });
    }
  }

  // A small oak tree
  for (let y = 1; y <= 3; y++) placeBlock('oakLog', -5, y, -5);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      placeBlock('oakLeaves', -5 + dx, 4, -5 + dz);
      if (dx === 0 || dz === 0) placeBlock('oakLeaves', -5 + dx, 5, -5 + dz);
    }
  }

  // Showcase rows: common blocks in front, ores behind, mineral blocks on top
  const rowA = ['stone', 'cobblestone', 'sand', 'gravel', 'oakPlanks', 'craftingTable', 'furnace', 'bookshelf'];
  rowA.forEach((name, i) => placeBlock(name, i - 4, 1, 2));

  const rowB = ['coalOre', 'ironOre', 'goldOre', 'redstoneOre', 'diamondOre', 'obsidian', 'glowstone', 'bedrock'];
  rowB.forEach((name, i) => placeBlock(name, i - 4, 1, 5));

  const rowC = ['ironBlock', 'goldBlock', 'diamondBlock', 'stoneBricks'];
  rowC.forEach((name, i) => placeBlock(name, i - 2, 2, 5));

  // A dirt pillar so the grass/dirt side textures read from below too
  placeBlock('dirt', 6, 1, -3);
  placeBlock('dirt', 6, 2, -3);
  placeBlock('grass', 6, 3, -3);
}

// ---------------------------------------------------------------------------
// Free-fly debug camera (temporary — replaced by player/controller.js later)
// ---------------------------------------------------------------------------

function createFlyControls(camera, canvas) {
  const keys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  euler.setFromQuaternion(camera.quaternion, 'YXZ');
  let yaw = euler.y;
  let pitch = euler.x;
  const maxPitch = Math.PI / 2 - 0.01;
  const hint = document.getElementById('lock-hint');

  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (hint) hint.classList.toggle('hidden', locked);
    if (!locked) keys.clear();
  });

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * DEBUG.MOUSE_SENSITIVITY;
    pitch -= e.movementY * DEBUG.MOUSE_SENSITIVITY;
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
  });

  document.addEventListener('keydown', (e) => {
    if (document.pointerLockElement !== canvas) return;
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });

  document.addEventListener('keyup', (e) => keys.delete(e.code));

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();

  return {
    update(delta) {
      camera.quaternion.setFromEuler(euler.set(pitch, yaw, 0, 'YXZ'));

      // WASD moves on the horizontal plane relative to yaw; Space/Shift fly
      forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      right.set(-forward.z, 0, forward.x);
      move.set(0, 0, 0);
      if (keys.has('KeyW')) move.add(forward);
      if (keys.has('KeyS')) move.sub(forward);
      if (keys.has('KeyD')) move.add(right);
      if (keys.has('KeyA')) move.sub(right);
      if (keys.has('Space')) move.y += 1;
      if (keys.has('ShiftLeft') || keys.has('ShiftRight')) move.y -= 1;

      if (move.lengthSq() > 0) {
        const fast = keys.has('ControlLeft') || keys.has('ControlRight');
        const speed = fast ? DEBUG.FLY_SPEED_FAST : DEBUG.FLY_SPEED;
        move.normalize().multiplyScalar(speed * delta);
        camera.position.add(move);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function init() {
  const canvas = document.getElementById('game-canvas');
  const renderer = createRenderer(canvas);
  const camera = createCamera();
  attachResizeHandler(renderer, camera);

  const scene = new THREE.Scene();
  scene.fog = createFog();

  const sky = createSky();
  scene.add(sky);
  scene.add(createSunLight());
  scene.add(createAmbientLight());

  const atlasTexture = await loadAtlas();
  buildTestScene(scene, atlasTexture);

  // Phase 2: terrain data. Generated and verified here; rendered in Phase 3
  // (this scene still shows the Phase 1 test blocks).
  const world = new World();
  const genStart = performance.now();
  world.ensureArea(0, 0, DEBUG.TERRAIN_PREGEN_RADIUS);
  console.log(
    `[world] generated ${world.loadedChunkCount} chunks in ` +
    `${(performance.now() - genStart).toFixed(0)}ms`,
  );
  logTerrainProfile(world);
  logColumn(world, 0, 0);
  logColumn(world, 40, 40);
  logBlockCensus(world);
  window.__world = world; // poke at terrain data from the browser console

  camera.position.set(10, 7, 14);
  camera.lookAt(0, 1, 0);
  const controls = createFlyControls(camera, canvas);

  initDebug();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), DEBUG.MAX_DELTA);
    controls.update(delta);
    sky.position.copy(camera.position);
    updateDebug(delta, camera);
    renderer.render(scene, camera);
  });
}

init().catch((err) => {
  console.error('Failed to start:', err);
  const hint = document.getElementById('lock-hint');
  if (hint) hint.textContent = `Failed to start: ${err.message}`;
});
