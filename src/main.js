// main.js — bootstrap and game loop. Wires renderer, atlas, sky, lights,
// the streamed chunk terrain and the player controller together.

import * as THREE from 'three';
import { DEBUG, SKY, LAVA_VIEW } from './config.js';
import { createRenderer, createCamera, attachResizeHandler } from './render/renderer.js';
import { loadAtlas } from './render/atlas.js';
import {
  createSky, createFog, createSunLight, createAmbientLight, createDayNightCycle,
} from './render/lighting.js';
import { initDebug, updateDebug, logTerrainProfile, logColumn, logBlockCensus } from './ui/debug.js';
import { initHud, updateHud } from './ui/hud.js';
import { createScreens } from './ui/screens.js';
import { World } from './world/world.js';
import { BLOCK, isFurnace } from './world/blocks.js';
import { createChunkMaterials } from './world/chunks.js';
import { createChests } from './world/chests.js';
import { createPlayerController } from './player/controller.js';
import { createInteraction } from './player/interaction.js';
import { createInventory } from './player/inventory.js';
import { createStats } from './player/stats.js';
import { createItemManager } from './entities/items.js';
import { createFallingBlocks } from './entities/falling.js';
import { createSmeltingSystem } from './systems/smelting.js';

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
  // Phase 7: the inventory owns items/selection; pickups flow into it and
  // the inventory screen (E) sits over the game. Phase 8: the hand renders
  // in its own pass (no camera-in-scene needed), and right-clicking a
  // crafting table opens the 3x3 crafting screen (`screens` binds below —
  // clicks can only arrive long after init finishes).
  const inventory = createInventory();
  const items = createItemManager({ world, scene });
  // Phase 9: sand/gravel fall when their support goes; lava damages (stats).
  // Phase 10: block-change listeners are a list — falling-block support
  // checks, furnace teardown and chest lifecycle all subscribe.
  const falling = createFallingBlocks({ world, scene, items });
  world.addBlockListener(falling.onBlockChanged);
  // Phase 10: furnaces tick whether or not a screen is open; chests are
  // entity-textured box models with persistent contents.
  const smelting = createSmeltingSystem({ world, items });
  world.addBlockListener(smelting.onBlockChanged);
  const chests = createChests({ world, scene, items, player });
  world.addBlockListener(chests.onBlockChanged);
  const stats = createStats({ world, player, inventory, items });
  let screens;
  const interaction = createInteraction({
    world, camera, scene, canvas, player, items, inventory,
    onUseBlock: (target) => {
      if (target.id === BLOCK.CRAFTING_TABLE) {
        screens.openCrafting();
        return true;
      }
      if (isFurnace(target.id)) {
        screens.openFurnace(smelting.furnaceAt(target.x, target.y, target.z));
        return true;
      }
      if (target.id === BLOCK.CHEST) {
        screens.openChest(chests.chestAt(target.x, target.y, target.z));
        return true;
      }
      return false;
    },
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
  window.__falling = falling;
  window.__stats = stats;
  window.__smelting = smelting;
  window.__chests = chests;

  initDebug();
  initHud(inventory);
  screens = createScreens({ inventory, canvas, items, player });
  window.__screens = screens;

  // Pickups go to the inventory (existing stacks first, then the first empty
  // slot); the return value tells the item manager how many were accepted.
  // A dropped worn tool carries its durability back in via addStack.
  const onPickup = (name, count, durability) =>
    durability != null
      ? count - inventory.addStack({ name, count, durability })
      : count - inventory.add(name, count);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), DEBUG.MAX_DELTA);
    player.update(delta);
    interaction.update(delta);
    items.update(delta, player.position, onPickup);
    falling.update(delta);
    smelting.update(delta); // furnaces run with the UI closed, independently
    chests.update(delta);   // lid animation + chunk-visibility follow
    stats.update(delta);
    screens.update(delta);  // furnace flame/arrow indicators
    world.updateStreaming(camera.position);
    dayNight.update(delta, camera.position); // also recentres the sky dome
    // Submerged in lava: near-blind orange view — the fog collapses to
    // arm's reach (the HUD overlay in ui/hud.js does the rest). dayNight
    // rewrites the fog colour every frame, so leaving lava restores itself;
    // near/far are put back explicitly.
    if (player.body.eyeInLava) {
      scene.fog.color.setHex(LAVA_VIEW.FOG_COLOR);
      scene.fog.near = LAVA_VIEW.FOG_NEAR;
      scene.fog.far = LAVA_VIEW.FOG_FAR;
    } else if (scene.fog.far !== SKY.FOG_FAR) {
      scene.fog.near = SKY.FOG_NEAR;
      scene.fog.far = SKY.FOG_FAR;
    }
    updateHud(player, stats);
    updateDebug(delta, camera, world.streamStats(), dayNight.timeOfDay);
    renderer.render(scene, camera);
    interaction.renderHand(renderer); // hand pass over the finished frame
  });
}

init().catch((err) => {
  console.error('Failed to start:', err);
  const hint = document.getElementById('lock-hint');
  if (hint) hint.textContent = `Failed to start: ${err.message}`;
});
