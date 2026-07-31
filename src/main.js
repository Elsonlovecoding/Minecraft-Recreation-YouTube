// main.js — bootstrap and game loop. Wires renderer, atlas, sky, lights and
// the streamed chunk terrain together, with a free-fly debug camera until
// player/controller.js exists.

import * as THREE from 'three';
import { DEBUG } from './config.js';
import { createRenderer, createCamera, attachResizeHandler } from './render/renderer.js';
import { loadAtlas } from './render/atlas.js';
import {
  createSky, createFog, createSunLight, createAmbientLight, updateSun,
} from './render/lighting.js';
import { initDebug, updateDebug, logTerrainProfile, logColumn, logBlockCensus } from './ui/debug.js';
import { World } from './world/world.js';
import { createChunkMaterials } from './world/chunks.js';

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
  const sun = createSunLight();
  scene.add(sun);
  scene.add(sun.target); // the target must be in the scene for updateSun
  scene.add(createAmbientLight());

  const atlasTexture = await loadAtlas();

  // Phase 3: the world renders as streamed chunk meshes. A small area builds
  // synchronously before the first frame; the rest arrives budgeted per frame.
  const world = new World();
  world.bindScene(scene, createChunkMaterials(atlasTexture));

  const spawnY = world.getHighestSolidY(DEBUG.SPAWN_X, DEBUG.SPAWN_Z) + DEBUG.SPAWN_ALTITUDE;
  camera.position.set(DEBUG.SPAWN_X, spawnY, DEBUG.SPAWN_Z);
  camera.lookAt(
    DEBUG.SPAWN_X,
    spawnY - DEBUG.SPAWN_LOOK_DOWN,
    DEBUG.SPAWN_Z - DEBUG.SPAWN_LOOK_AHEAD,
  );

  const buildStart = performance.now();
  world.prebuild(camera.position);
  console.log(
    `[world] prebuilt ${world.streamStats().meshed} chunk meshes in ` +
    `${(performance.now() - buildStart).toFixed(0)}ms`,
  );

  // Terrain diagnostics (dev scaffolding — they make regressions visible)
  logTerrainProfile(world);
  logColumn(world, 0, 0);
  logColumn(world, 40, 40);
  logBlockCensus(world);
  window.__world = world; // poke at the world from the browser console
  window.__camera = camera;
  window.__renderer = renderer;

  const controls = createFlyControls(camera, canvas);

  initDebug();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), DEBUG.MAX_DELTA);
    controls.update(delta);
    world.updateStreaming(camera.position);
    updateSun(sun, camera.position);
    sky.position.copy(camera.position);
    updateDebug(delta, camera, world.streamStats());
    renderer.render(scene, camera);
  });
}

init().catch((err) => {
  console.error('Failed to start:', err);
  const hint = document.getElementById('lock-hint');
  if (hint) hint.textContent = `Failed to start: ${err.message}`;
});
