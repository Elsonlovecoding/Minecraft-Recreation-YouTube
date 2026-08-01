// main.js — bootstrap and game loop. Wires renderer, atlas, sky, lights,
// the streamed chunk terrain and the player controller together.

import * as THREE from 'three';
import { DEBUG } from './config.js';
import { createRenderer, createCamera, attachResizeHandler } from './render/renderer.js';
import { loadAtlas } from './render/atlas.js';
import {
  createSky, createFog, createSunLight, createAmbientLight, createDayNightCycle,
} from './render/lighting.js';
import { initDebug, updateDebug, logTerrainProfile, logColumn, logBlockCensus } from './ui/debug.js';
import { initHud, updateHud } from './ui/hud.js';
import { createScreens } from './ui/screens.js';
import { World } from './world/world.js';
import { createChunkMaterials } from './world/chunks.js';
import { createPlayerController } from './player/controller.js';
import { createInteraction } from './player/interaction.js';
import { createInventory } from './player/inventory.js';
import { createItemManager } from './entities/items.js';

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
  const ambient = createAmbientLight();
  scene.add(ambient);

  // Phase 4: the ~20-minute day/night cycle drives the sky palette, fog,
  // sun/moon, and the baked-light uniforms shared by all chunk materials.
  const dayNight = createDayNightCycle({ sky, fog: scene.fog, sun, ambient });

  const atlasTexture = await loadAtlas();

  // Phase 3: the world renders as streamed chunk meshes. A small area builds
  // synchronously before the first frame; the rest arrives budgeted per frame.
  const world = new World();
  world.bindScene(scene, createChunkMaterials(atlasTexture));

  // Phase 5: the player — spawned safely on the surface, camera at eye
  // height. The old fly camera lives behind DEBUG.FLY_TOGGLE_CODE.
  const player = createPlayerController({ world, camera, canvas });

  // Phase 6: dropped items and block interaction (break/place/outline/hand).
  // The camera joins the scene so the first-person hand (a camera child)
  // renders. Phase 7: the inventory owns items/selection; pickups flow into
  // it and the inventory screen (E) sits over the game.
  scene.add(camera);
  const inventory = createInventory();
  const items = createItemManager({ world, scene });
  const interaction = createInteraction({
    world, camera, scene, canvas, player, items, inventory,
  });

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
  window.__dayNight = dayNight; // e.g. __dayNight.setTimeOfDay(0.75) = midnight
  window.__player = player;
  window.__controls = player; // back-compat alias (setView lives here too)
  window.__items = items;
  window.__interaction = interaction;
  window.__inventory = inventory;

  initDebug();
  initHud(inventory);
  const screens = createScreens({ inventory, canvas, items, player });
  window.__screens = screens;

  // Pickups go to the inventory (existing stacks first, then the first empty
  // slot); the return value tells the item manager how many were accepted.
  const onPickup = (name, count) => count - inventory.add(name, count);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), DEBUG.MAX_DELTA);
    player.update(delta);
    interaction.update(delta);
    items.update(delta, player.position, onPickup);
    world.updateStreaming(camera.position);
    dayNight.update(delta, camera.position); // also recentres the sky dome
    updateHud(player);
    updateDebug(delta, camera, world.streamStats(), dayNight.timeOfDay);
    renderer.render(scene, camera);
  });
}

init().catch((err) => {
  console.error('Failed to start:', err);
  const hint = document.getElementById('lock-hint');
  if (hint) hint.textContent = `Failed to start: ${err.message}`;
});
