// main.js — bootstrap and game loop. Wires renderer, atlas, sky, lights,
// the streamed chunk terrain and the player controller together.

import * as THREE from 'three';
import { DEBUG, SKY, LAVA_VIEW, ITEMS } from './config.js';
import { createRenderer, createCamera, attachResizeHandler } from './render/renderer.js';
import { loadAtlas } from './render/atlas.js';
import {
  createSky, createFog, createSunLight, createAmbientLight, createDayNightCycle,
} from './render/lighting.js';
import { initDebug, updateDebug, logTerrainProfile, logColumn, logBlockCensus } from './ui/debug.js';
import { initHud, updateHud } from './ui/hud.js';
import { createScreens } from './ui/screens.js';
import { World } from './world/world.js';
import { BLOCK, isFurnace, isTorch, torchSupportCell, isSolid } from './world/blocks.js';
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
  // Phase 11: torches pop off as items when their support goes — the block
  // below a floor torch, the wall behind a wall torch. Cascades (a pillar of
  // sand under a torch collapsing) ride the listener chain naturally.
  world.addBlockListener((x, y, z) => {
    for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      const tx = x + dx;
      const ty = y + dy;
      const tz = z + dz;
      const id = world.getBlock(tx, ty, tz);
      if (!isTorch(id)) continue;
      const s = torchSupportCell(id, tx, ty, tz);
      if (s && !isSolid(world.getBlock(s.x, s.y, s.z))) {
        world.setBlock(tx, ty, tz, BLOCK.AIR);
        items.spawn('torch', 1, {
          x: tx + 0.5, y: ty + ITEMS.DROP_SPAWN_Y_OFFSET, z: tz + 0.5,
        });
      }
    }
  });
  let screens;
  // Phase 11 death flow: any open screen closes first (grid and cursor
  // stacks return to the inventory, so they drop at the death site with
  // everything else), then the death screen holds until Respawn.
  const stats = createStats({
    world, player, inventory, items,
    onDeath: () => {
      screens.closeScreen(false);
      screens.showDeath();
    },
  });
  const interaction = createInteraction({
    world, camera, scene, canvas, player, items, inventory, stats,
    onUseBlock: (target) => {
      if (target.id === BLOCK.CRAFTING_TABLE) {
        screens.openCrafting();
        return true;
      }
      if (isFurnace(target.id)) {
        screens.openFurnace(
          smelting.furnaceAt(target.x, target.y, target.z),
          { x: target.x, y: target.y, z: target.z },
        );
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
  screens = createScreens({
    inventory, canvas, items, player, camera,
    onRespawn: () => stats.respawn(),
  });
  window.__screens = screens;

  // Pickups go to the inventory (existing stacks first, then the first empty
  // slot); the return value tells the item manager how many were accepted.
  // A dropped worn tool carries its durability back in via addStack.
  // A dead player collects nothing (Phase 11) — otherwise the corpse would
  // vacuum its own death drops back up before the respawn teleport.
  const onPickup = (name, count, durability) => {
    if (stats.dead) return 0;
    return durability != null
      ? count - inventory.addStack({ name, count, durability })
      : count - inventory.add(name, count);
  };

  // Defensive: if the block backing an open container screen stops being
  // that container (unreachable by hand today — breaking needs pointer
  // lock — but explosions arrive with mobs), close the screen so stacks
  // can't be deposited into an orphaned container. The chest/furnace
  // listeners above already dropped its contents.
  world.addBlockListener((x, y, z, id) => {
    const pos = screens.activeBlockPos;
    if (!pos || pos.x !== x || pos.y !== y || pos.z !== z) return;
    const stillThere = pos.kind === 'furnace' ? isFurnace(id) : id === BLOCK.CHEST;
    if (!stillThere) screens.closeScreen();
  });

  const clock = new THREE.Clock();
  let wasEyeInLava = false;
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
    // near/far are put back once on the exit transition (edge-triggered, so
    // this never fights a future dimension's own fog settings per frame).
    if (player.body.eyeInLava) {
      scene.fog.color.setHex(LAVA_VIEW.FOG_COLOR);
      scene.fog.near = LAVA_VIEW.FOG_NEAR;
      scene.fog.far = LAVA_VIEW.FOG_FAR;
      wasEyeInLava = true;
    } else if (wasEyeInLava) {
      scene.fog.near = SKY.FOG_NEAR;
      scene.fog.far = SKY.FOG_FAR;
      wasEyeInLava = false;
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
