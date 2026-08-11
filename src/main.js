// main.js — bootstrap and game loop. Wires renderer, atlas, sky, lights,
// the streamed chunk terrain and the player controller together.

import * as THREE from 'three';
import {
  DEBUG, SKY, LAVA_VIEW, ITEMS, LIGHTING, NETHER_SKY, END_SKY, NETHER, END,
  MOBS, TERRAIN, TEST_CHEST, BEDS, DRAGON,
} from './config.js';
import { createRenderer, createCamera, attachResizeHandler } from './render/renderer.js';
import { loadAtlas } from './render/atlas.js';
import {
  createSky, createFog, createSunLight, createAmbientLight, createDayNightCycle,
  CHUNK_LIGHT_UNIFORMS,
} from './render/lighting.js';
import { initDebug, updateDebug, logTerrainProfile, logColumn, logBlockCensus } from './ui/debug.js';
import { initHud, updateHud, setBossBar, setSleepFade, showToast } from './ui/hud.js';
import { createScreens } from './ui/screens.js';
import { World } from './world/world.js';
import {
  BLOCK, isFurnace, isTorch, torchSupportCell, isSolid,
  GATE_TOGGLE, DOOR_TOGGLE, DOOR_INFO, TRAPDOOR_TOGGLE, BED_INFO,
  FACING_DELTA, isSign, isItemFrame, isBed,
} from './world/blocks.js';
import { createChunkMaterials } from './world/chunks.js';
import { createFluids } from './world/fluids.js';
import { createChests } from './world/chests.js';
import { createSpawners } from './world/spawners.js';
import { createSigns } from './world/signs.js';
import { createFrames } from './world/frames.js';
import { createWart } from './world/wart.js';
import { createPlayerController } from './player/controller.js';
import { createInteraction } from './player/interaction.js';
import { createInventory } from './player/inventory.js';
import { createStats } from './player/stats.js';
import { createDimensions } from './dimensions/dimensions.js';
import { createPortals } from './dimensions/portals.js';
import { NetherGenerator } from './dimensions/nether.js';
import { EndGenerator } from './dimensions/end.js';
import { strongholdCenter, createEndPortal } from './dimensions/stronghold.js';
import { createItemManager } from './entities/items.js';
import { createFallingBlocks } from './entities/falling.js';
import { createMobs } from './entities/mobs.js';
import { createEnderEyes } from './entities/ender_eye.js';
import { createEnderPearls } from './entities/ender_pearl.js';
import { createDragonFight } from './entities/dragon.js';
import { createSmeltingSystem } from './systems/smelting.js';
import { createBrewingSystem } from './systems/brewing.js';
import { createCombat, rayAABB } from './systems/combat.js';
import { createAmbience } from './systems/ambience.js';
import { audio } from './systems/audio.js';
import { particles } from './render/particles.js';

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

  // Phase 22: the two feel systems. Both are module-level singletons any
  // system can emit into (the CHUNK_LIGHT_UNIFORMS pattern) — before these
  // calls every emit is a silent no-op, which is what keeps the node
  // harnesses DOM-free. The particle pool needs the atlas, so it starts
  // here; the AudioContext waits for the first click (autoplay policy).
  canvas.addEventListener('pointerdown', () => audio.unlock());

  // Phase 3: the world renders as streamed chunk meshes. A small area builds
  // synchronously before the first frame; the rest arrives budgeted per frame.
  const world = new World();
  // Phase 12: kept in a named binding — the loop drives the animated
  // flowing-lava texture through chunkMaterials.scrollLava.
  const chunkMaterials = createChunkMaterials(atlasTexture);
  // Phase 15: each dimension's chunk meshes live in their own group, so a
  // dimension switch is one visibility flip — the swapped-out world's
  // meshes stay in memory, hidden, exactly as they were.
  const overworldGroup = new THREE.Group();
  const netherGroup = new THREE.Group();
  const endGroup = new THREE.Group();
  netherGroup.visible = false;
  endGroup.visible = false;
  scene.add(overworldGroup);
  scene.add(netherGroup);
  scene.add(endGroup);
  world.bindScene(overworldGroup, chunkMaterials);
  // The particle pool lives in the scene root, not a dimension group: its
  // contents are cleared on every dimension switch (coordinates mean
  // nothing in another world), so there is nothing to keep hidden.
  particles.init({ scene, world });
  // Phase 19: the overworld generator's stronghold pass doubles as the
  // single source of layout truth for the end-portal runtime and the
  // loot-chest scan (one shared blueprint cache).
  const stronghold = world.generator.stronghold;

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
  // Phase 12: flowing lava — sources pour and spread, flows recede when
  // their feed is cut; newly meshed chunks settle their generated lava once.
  const fluids = createFluids({ world });
  world.addBlockListener(fluids.onBlockChanged);
  // Phase 10: furnaces tick whether or not a screen is open; chests are
  // entity-textured box models with persistent contents.
  const smelting = createSmeltingSystem({ world, items });
  world.addBlockListener(smelting.onBlockChanged);
  // Phase 18: brewing stands tick like furnaces (potions brew with the
  // screen closed); breaking one drops its slots.
  const brewing = createBrewingSystem({ world, items });
  world.addBlockListener(brewing.onBlockChanged);
  const chests = createChests({
    world, scene, items, player,
    // Generated stronghold chests stock deterministic loot at discovery.
    lootFor: (x, y, z) => stronghold.lootFor(x, y, z),
  });
  world.addBlockListener(chests.onBlockChanged);
  // Phase 17: blaze spawner block entities (fortress rooms generate them —
  // discovered by chunk scan; the listener handles break/teardown) and the
  // nether wart lifecycle (growth timers, soil-break pops). `mobs` is
  // assigned below; spawner cycles can only fire frames later.
  const spawners = createSpawners({ world, scene, player, getMobs: () => mobs });
  world.addBlockListener(spawners.onBlockChanged);
  const wart = createWart({ world, items });
  world.addBlockListener(wart.onBlockChanged);
  // Phase 21 block entities: sign text and item-frame contents (the blocks
  // themselves mesh through the generic shape emitter).
  const signs = createSigns({ world, scene, canvas });
  world.addBlockListener(signs.onBlockChanged);
  const frames = createFrames({ world, scene, items });
  world.addBlockListener(frames.onBlockChanged);
  // Breaking either half of a door or a bed removes the other half, so a
  // stray upper door slab or bed head can never be left standing.
  world.addBlockListener((x, y, z, id) => {
    for (const [dx, dy, dz] of [
      [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const nid = world.getBlock(nx, ny, nz);
      const door = DOOR_INFO[nid];
      if (door) {
        const otherY = door.half === 'lower' ? ny + 1 : ny - 1;
        if (!DOOR_INFO[world.getBlock(nx, otherY, nz)]) {
          world.setBlock(nx, ny, nz, BLOCK.AIR);
        }
        continue;
      }
      const bed = BED_INFO[nid];
      if (!bed) continue;
      const [bdx, bdz] = FACING_DELTA[bed.facing];
      const sign = bed.part === 'foot' ? 1 : -1;
      const other = world.getBlock(nx + bdx * sign, ny, nz + bdz * sign);
      if (!BED_INFO[other]) world.setBlock(nx, ny, nz, BLOCK.AIR);
    }
  });
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
  // Phase 13: the combat system — player melee (weapon damage, cooldown
  // charge, crits), the armour damage pipeline, bow + arrows, explosions.
  // Mobs are created after it, so the mob list resolves lazily. Phase 20:
  // combat aims at a TARGET FACADE merging the mob manager with the dragon
  // fight — melee swings, arrows and blasts reach the dragon's parts and
  // the end crystals through the same paths that hit mobs (the fight
  // gates itself to the End dimension; combat.js is untouched).
  let mobs;
  let dragonFight; // created below, after the dimension system
  const combatTargets = {
    raycast(origin, dir, maxDist) {
      const mob = mobs.raycast(origin, dir, maxDist);
      const mobT = mob
        ? rayAABB(origin, dir, mob.entity.aabb, maxDist) ?? Infinity
        : Infinity;
      const fight = dragonFight ? dragonFight.raycast(origin, dir, maxDist) : null;
      if (fight && fight.t < mobT) return fight.target;
      return mob;
    },
    get mobs() {
      const blastable = dragonFight ? dragonFight.blastTargets : [];
      return blastable.length > 0 ? mobs.mobs.concat(blastable) : mobs.mobs;
    },
  };
  const combat = createCombat({
    world, scene, player, stats, inventory, items, dayNight,
    getMobs: () => combatTargets,
  });
  // Phase 18: thrown eyes of ender fly toward the stronghold's
  // deterministic location (dimensions/stronghold.js — generation itself
  // arrives next phase at exactly that point).
  const enderEyes = createEnderEyes({
    scene, player, items, sfx: combat.sfx,
    getTarget: () => strongholdCenter(TERRAIN.SEED),
  });
  // Phase 22: thrown ender pearls — a real projectile that teleports the
  // player where it lands, for 2.5 hearts of fall damage.
  const enderPearls = createEnderPearls({ scene, world, player, stats, camera });
  let portals; // assigned below — clicks can only arrive long after init
  let endPortal; // assigned below, same rule
  const interaction = createInteraction({
    world, camera, scene, canvas, player, items, inventory, stats,
    // A mob in the crosshair intercepts left clicks (attack, not mine);
    // holding right with the bow draws and releases through combat too.
    combat,
    // Right-clicking a mob (Phase 14): shears shear a sheep. `mobs` is
    // assigned below; clicks can only arrive long after init finishes.
    onUseMob: (mob, itemName) => mobs.useOnMob(mob, itemName),
    // Flint and steel on a block face (Phase 15): light a portal frame.
    onIgnite: (target) => portals.tryIgnite(target),
    // A held eye of ender right-clicked (Phase 18): throw it. Phase 19:
    // right-clicked ON an empty portal frame, it fills the frame instead.
    onThrowEye: () => enderEyes.throwEye(),
    // A held ender pearl right-clicked (Phase 22): throw it.
    onThrowPearl: () => enderPearls.throwPearl(),
    onFillFrame: (target) => endPortal.fillFrame(target),
    // A freshly placed sign opens its text entry right away (vanilla).
    onPlaceSign: (cell) => signs.beginEdit(cell),
    onUseBlock: (target, hand) => {
      // Phase 21 openables: doors, fence gates and trapdoors swap to their
      // other state in place. Both halves of a door move together.
      if (DOOR_TOGGLE[target.id] !== undefined) {
        const info = DOOR_INFO[target.id];
        const baseY = info.half === 'lower' ? target.y : target.y - 1;
        const lower = world.getBlock(target.x, baseY, target.z);
        const upper = world.getBlock(target.x, baseY + 1, target.z);
        if (DOOR_TOGGLE[lower] !== undefined) {
          world.setBlock(target.x, baseY, target.z, DOOR_TOGGLE[lower]);
        }
        if (DOOR_TOGGLE[upper] !== undefined) {
          world.setBlock(target.x, baseY + 1, target.z, DOOR_TOGGLE[upper]);
        }
        return true;
      }
      if (GATE_TOGGLE[target.id] !== undefined) {
        world.setBlock(target.x, target.y, target.z, GATE_TOGGLE[target.id]);
        return true;
      }
      if (TRAPDOOR_TOGGLE[target.id] !== undefined) {
        world.setBlock(target.x, target.y, target.z, TRAPDOOR_TOGGLE[target.id]);
        return true;
      }
      if (isItemFrame(target.id)) {
        return frames.use(target.x, target.y, target.z, hand);
      }
      if (isSign(target.id)) {
        signs.beginEdit({ x: target.x, y: target.y, z: target.z });
        return true;
      }
      if (isBed(target.id)) return trySleep(target);
      // Flower pots take the one plant this game has (Phase 21).
      if (target.id === BLOCK.FLOWER_POT && hand?.name === 'oak_sapling') {
        world.setBlock(target.x, target.y, target.z, BLOCK.FLOWER_POT_SAPLING);
        hand.consume(1);
        return true;
      }
      if (target.id === BLOCK.FLOWER_POT_SAPLING) {
        world.setBlock(target.x, target.y, target.z, BLOCK.FLOWER_POT);
        items.spawn('oak_sapling', 1, {
          x: target.x + 0.5, y: target.y + ITEMS.DROP_SPAWN_Y_OFFSET, z: target.z + 0.5,
        });
        return true;
      }
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
      if (target.id === BLOCK.BREWING_STAND) {
        screens.openBrewing(
          brewing.standAt(target.x, target.y, target.z),
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

  // --- beds (Phase 21) -------------------------------------------------------

  // Right-clicking a bed sets the respawn point (always) and, at night with
  // nothing hostile nearby, skips to morning. `sleeping` runs the fade.
  let sleeping = 0; // seconds left in the sleep transition
  let sleepJumped = false;
  function trySleep(target) {
    const info = BED_INFO[target.id];
    if (!info) return false;
    const p = player.body.position;
    if (Math.hypot(p.x - (target.x + 0.5), p.z - (target.z + 0.5)) > BEDS.USE_RANGE) {
      return true;
    }
    // The spawn point is the bed's foot cell — the same rule as vanilla's
    // "respawn beside the bed", and always safe because the bed stood there.
    stats.setSpawnPoint(target.x + 0.5, target.y, target.z + 0.5);
    showToast('Respawn point set');
    const t = dayNight.timeOfDay;
    if (t < BEDS.NIGHT_START || t >= BEDS.NIGHT_END) {
      showToast('You can only sleep at night');
      return true;
    }
    const near = mobs.mobs.some((m) => {
      if (!m.type.hostile || m.entity.dead || m.entity.removed) return false;
      const mp = m.entity.position;
      return Math.hypot(mp.x - p.x, mp.y - p.y, mp.z - p.z) < BEDS.MONSTER_RADIUS;
    });
    if (near) {
      showToast('You may not rest now, there are monsters nearby');
      return true;
    }
    sleeping = BEDS.SLEEP_SECONDS;
    sleepJumped = false;
    return true;
  }

  // The fade: dark to black, the night passes at the peak, then back.
  function updateSleep(dt) {
    if (sleeping <= 0) return;
    sleeping = Math.max(0, sleeping - dt);
    const half = BEDS.SLEEP_SECONDS / 2;
    const elapsed = BEDS.SLEEP_SECONDS - sleeping;
    if (!sleepJumped && elapsed >= half) {
      sleepJumped = true;
      dayNight.setTimeOfDay(BEDS.WAKE_TIME_OF_DAY);
    }
    setSleepFade(elapsed < half ? elapsed / half : sleeping / half);
    if (sleeping === 0) setSleepFade(0);
  }
  mobs = createMobs({ world, scene, player, stats, items, dayNight, combat });
  const endGenerator = new EndGenerator(TERRAIN.SEED);

  // Phase 15: the dimension system — the overworld and the Nether, each
  // keeping its own chunks and entities, switched between by the portal
  // system. Every entity manager above participates via the
  // swapDimensionState protocol. Phase 16: the real Nether generator, its
  // own spawn table (ghasts, any light, a small cap) and the doubled lava
  // pace.
  const dimensions = createDimensions({
    world, dayNight, mobs, fluids,
    managers: [
      items, mobs, falling, combat, fluids, smelting, brewing, chests,
      spawners, wart, enderEyes, enderPearls, signs, frames, particles,
    ],
    defs: {
      overworld: { group: overworldGroup, sky: null, spawning: true },
      nether: {
        group: netherGroup,
        sky: NETHER_SKY,
        spawning: true,
        // Phase 19: endermen spawn commonly in the Nether beside the
        // ghasts (the weight override is per-dimension — overworld
        // rarity untouched).
        spawn: {
          hostiles: [
            'ghast',
            { name: 'enderman', weight: MOBS.NETHER_ENDERMAN_WEIGHT },
          ],
          hostileCap: MOBS.NETHER_HOSTILE_CAP,
          anyLight: true,
        },
        lavaTickSeconds: NETHER.LAVA_TICK_SECONDS,
        makeGenerator: () => new NetherGenerator(TERRAIN.SEED),
      },
      // Phase 19: the End — the island, its purple gloom and its endermen
      // (SPEC: "endermen spawn on the island"). Phase 20: the ONE
      // EndGenerator instance is shared with the dragon fight — its pillar
      // layout and exit-portal cells are the fight's layout truth (the
      // stronghold-blueprint pattern).
      end: {
        group: endGroup,
        sky: END_SKY,
        spawning: true,
        spawn: {
          hostiles: ['enderman'],
          hostileCap: END.HOSTILE_CAP,
          anyLight: true,
        },
        makeGenerator: () => endGenerator,
      },
    },
  });
  // Phase 22: the ambience driver — player footsteps/landings/splashes and
  // the world's random display ticks. It reads state only; nothing else
  // depends on it, so it is created last and updated last.
  const ambience = createAmbience({ world, player, dimensions });
  portals = createPortals({ world, scene, player, stats, camera, dimensions });
  world.addBlockListener(portals.onBlockChanged);
  // Phase 19: end-portal runtime — frame filling, activation on the 12th
  // eye, and the fall-in trip to the End.
  endPortal = createEndPortal({
    world, player, camera, dimensions, generator: stronghold,
  });
  // Phase 20: the dragon fight — crystals on the pillars, the dragon's
  // flight phases, the death sequence, exit-portal activation and the
  // victory trigger. `screens` binds below; the portal can only activate
  // long after init finishes.
  dragonFight = createDragonFight({
    world, scene, player, stats, combat, dimensions, generator: endGenerator,
    onVictory: () => {
      // The one genuine milestone this game has: the vanilla level-up chime.
      audio.levelUp();
      screens.showVictory();
    },
  });

  const buildStart = performance.now();
  world.prebuild(camera.position);
  console.log(
    `[world] prebuilt ${world.streamStats().meshed} chunk meshes in ` +
    `${(performance.now() - buildStart).toFixed(0)}ms`,
  );

  // TEMPORARY, MUST REMOVE (config TEST_CHEST): chests at the spawn point
  // stocked so the portal, the Nether, brewing, eyes of ender, the
  // stronghold AND the dragon fight can all be tested without a full
  // playthrough. (Removed at the end of Phase 20 as mandated, restored by
  // request for End-fight testing with the fight kit expanded.)
  if (TEST_CHEST) {
    const p = player.body.position;
    // The kit, in slot order. Durability items (tools, armour, bows)
    // arrive at full durability through `add`, one per slot. Water
    // bottles and buckets stack to 1, so they cost a slot each — the kit
    // runs past one chest's 27, and the overflow fills a second chest
    // beside the first.
    const TEST_KIT = [
      ['obsidian', 14],
      ['flint_and_steel', 1],
      ['brewing_stand', 1],
      ['blaze_rod', 64],
      ['blaze_powder', 8],
      ['nether_wart', 8],
      ['ender_pearl', 16],
      ['ender_eye', 16],
      ['glass_bottle', 6],
      ['water_bottle', 6],
      ['bucket', 3],
      ['diamond_helmet', 1],
      ['diamond_chestplate', 1],
      ['diamond_leggings', 1],
      ['diamond_boots', 1],
      ['diamond_sword', 1],
      ['diamond_pickaxe', 1],
      ['diamond_axe', 1],
      ['diamond_shovel', 1],
      ['iron_sword', 1],
      ['bow', 3],          // End-fight kit: spares against durability
      ['arrow', 128],      // the dragon + ten crystals want volume
      ['golden_apple', 5], // fight sustain
      ['torch', 64],
      ['cobblestone', 64],
      ['oak_planks', 64],
    ];
    // Prefer a column whose surface is level with the player — leaves count
    // as solid, so a bare offset could sit a chest on a tree canopy. The
    // two offset lists never overlap, so the chests can't collide.
    const placeChest = (offsets) => {
      const level = offsets.find(([ox, oz]) => {
        const x = Math.floor(p.x) + ox;
        const z = Math.floor(p.z) + oz;
        return Math.abs((world.getHighestSolidY(x, z) + 1) - p.y) <= 2;
      });
      const [ox, oz] = level ?? offsets[0];
      const x = Math.floor(p.x) + ox;
      const z = Math.floor(p.z) + oz;
      const y = world.getHighestSolidY(x, z) + 1;
      world.setBlock(x, y, z, BLOCK.CHEST);
      return chests.chestAt(x, y, z);
    };
    const chest = placeChest([[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]);
    const spare = placeChest([[3, 0], [-3, 0], [0, 3], [0, -3], [3, 1], [-3, -1]]);
    for (const [name, count] of TEST_KIT) {
      const leftover = chest.container.add(name, count);
      if (leftover > 0) spare.container.add(name, leftover);
    }
  }

  // Terrain diagnostics (dev scaffolding — they make regressions visible)
  logTerrainProfile(world);
  logColumn(world, 0, 0);
  logColumn(world, 40, 40);
  logBlockCensus(world);
  window.__world = world; // poke at the world from the browser console
  window.__BLOCK = BLOCK;  // block ids, for the console and the test harness
  window.__camera = camera;
  window.__renderer = renderer;
  window.__dayNight = dayNight; // e.g. __dayNight.setTimeOfDay(0.75) = midnight
  window.__player = player;
  window.__controls = player; // back-compat alias (setView lives here too)
  window.__items = items;
  window.__interaction = interaction;
  window.__inventory = inventory;
  window.__falling = falling;
  window.__fluids = fluids;
  window.__mobs = mobs;
  window.__combat = combat;
  window.__stats = stats;
  window.__smelting = smelting;
  window.__brewing = brewing;
  window.__enderEyes = enderEyes;
  window.__enderPearls = enderPearls;
  window.__particles = particles;
  window.__ambience = ambience;
  window.__audio = audio;
  window.__chests = chests;
  window.__spawners = spawners;
  window.__wart = wart;
  window.__signs = signs;
  window.__frames = frames;
  window.__dimensions = dimensions;
  window.__portals = portals;
  window.__stronghold = stronghold;
  window.__endPortal = endPortal;
  window.__dragonFight = dragonFight;

  // The sign panel suppresses the pointer-lock hint while it is open
  // (world/signs.js toggles the class).
  const hintStyle = document.createElement('style');
  hintStyle.textContent = '#lock-hint.mc-suppressed { display: none; }';
  document.head.appendChild(hintStyle);

  initDebug();
  initHud(inventory);
  screens = createScreens({
    inventory, canvas, items, player, camera,
    // Dying in the Nether respawns at the OVERWORLD spawn point (Phase 15):
    // the dimension switches home before the respawn teleport.
    onRespawn: () => {
      dimensions.switchTo('overworld');
      stats.respawn();
    },
    // Winning travels home the same way (Phase 20) — inventory intact.
    onVictoryReturn: () => {
      dimensions.switchTo('overworld');
      stats.respawn();
    },
  });
  window.__screens = screens;

  // Pickups go to the inventory (existing stacks first, then the first empty
  // slot); the return value tells the item manager how many were accepted.
  // A dropped worn tool carries its durability back in via addStack.
  // A dead player collects nothing (Phase 11) — otherwise the corpse would
  // vacuum its own death drops back up before the respawn teleport.
  const onPickup = (name, count, durability) => {
    if (stats.dead) return 0;
    const taken = durability != null
      ? count - inventory.addStack({ name, count, durability })
      : count - inventory.add(name, count);
    // Phase 22: a small sparkle and blip on anything that actually went in.
    if (taken > 0) {
      const p = player.body.position;
      particles.pickup(p.x, p.y + 0.9, p.z);
      audio.pickup();
    }
    return taken;
  };

  // Defensive: if the block backing an open container screen stops being
  // that container (unreachable by hand today — breaking needs pointer
  // lock — but explosions arrive with mobs), close the screen so stacks
  // can't be deposited into an orphaned container. The chest/furnace
  // listeners above already dropped its contents.
  world.addBlockListener((x, y, z, id) => {
    const pos = screens.activeBlockPos;
    if (!pos || pos.x !== x || pos.y !== y || pos.z !== z) return;
    const stillThere = pos.kind === 'furnace' ? isFurnace(id)
      : pos.kind === 'brewing' ? id === BLOCK.BREWING_STAND
      : id === BLOCK.CHEST;
    if (!stillThere) screens.closeScreen();
  });

  // Phase 12: the pause state. Whenever the pointer is unlocked with no
  // screen open (Esc from gameplay, or before the very first click), the
  // game freezes completely: physics and momentum, entities, day/night,
  // block break progress, furnaces — nothing advances until play resumes.
  // Input needs no extra gating: every gameplay input path (movement keys,
  // E, number keys, wheel, mouse) already requires pointer lock, and screens
  // can only open while locked. Only a click (or Esc, below) resumes.
  // The harness override (`debugForceInput`) keeps headless tests running
  // without real pointer lock.
  let everLocked = false;
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) everLocked = true;
  });
  const isPaused = () =>
    document.pointerLockElement !== canvas &&
    !screens.isOpen && !screens.isDeathShown && !screens.isVictoryShown &&
    !signs.isEditing && !player.inputOverridden;
  // Esc while paused resumes, like vanilla. The lock request can reject
  // during the browser's ~1.3s post-Esc cooldown — the pause overlay stays
  // up and a click resumes instead (same swallow as the click path).
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !isPaused()) return;
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  });

  const clock = new THREE.Clock();
  let wasEyeInLava = false;
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), DEBUG.MAX_DELTA);
    const paused = isPaused();
    // The "Game paused" title only reads right once play has begun; the
    // first-boot freeze keeps the plain "Click to play" hint.
    document.body.classList.toggle('mc-paused', paused && everLocked);
    if (!paused) {
      player.update(delta);
      interaction.update(delta);
      items.update(delta, player.position, onPickup);
      mobs.update(delta);     // spawning, AI, mob physics, animation
      combat.update(delta);   // arrows in flight, explosion flashes
      falling.update(delta);
      smelting.update(delta); // furnaces run with the UI closed, independently
      brewing.update(delta);  // brewing stands too (Phase 18)
      enderEyes.update(delta); // thrown eyes of ender in flight (Phase 18)
      enderPearls.update(delta); // thrown pearls + the arrival teleport
      chests.update(delta);   // lid animation + chunk-visibility follow
      spawners.update(delta); // blaze spawner cycles + spinning displays
      wart.update(delta);     // nether wart growth timers
      stats.update(delta);
      screens.update(delta);  // furnace flame/arrow indicators
      fluids.update(delta);   // lava spread steps + new-chunk settling
      portals.update(delta);  // stand-in-portal travel, particles, ambience
      endPortal.update();     // fall-into-end-portal travel (Phase 19)
      dragonFight.update(delta); // the End fight (gates itself to the End;
                              // runs right after the travel step so arrival
                              // spawns the fight the same frame)
      chunkMaterials.scrollLava(delta); // animated flowing-lava texture
      chunkMaterials.scrollPortal(delta); // animated portal swirl
      // Phase 22 feel: footsteps/landings/splashes, the random display tick
      // that finds torches, lava and portals nearby, the fluid ambience
      // beds and the cave tones. Last, so it reads this frame's body state.
      ambience.update(delta);
    }
    // Phase 23 bug fix: pausing the game pauses the SOUND. Freezing the
    // update loop never silenced the looping ambience beds — a running
    // BufferSource is a live graph node, not something the game loop drives —
    // so water kept lapping behind the pause overlay. Suspending the whole
    // AudioContext stops every voice at once and resuming picks them up
    // where they left off. Edge-triggered inside audio.setPaused.
    audio.setPaused(paused);
    // Phase 22: the listener follows the camera (position AND facing, for
    // the stereo pan), and the particle pool integrates. Both run outside
    // the pause gate with a zero delta while paused — the pool must keep
    // its instance buffers in place so a paused frame still draws them.
    audio.setListener(camera);
    particles.update(paused ? 0 : delta, camera.position);
    world.updateStreaming(camera.position); // terrain loads even while paused
    // The End fight's visibility follows the active dimension even while
    // paused — respawn/victory clicks switch dimensions from overlay
    // handlers, outside the unpaused update path (dragon.js's contract).
    dragonFight.syncVisibility();
    // delta 0 while paused: the palette still applies, time doesn't advance.
    dayNight.update(paused ? 0 : delta, camera.position);
    // Held-torch dynamic light (Phase 14): a torch in either hand lights the
    // world around the player. Two uniform writes per frame — the chunk
    // shader applies the falloff per fragment, so no chunk ever remeshes
    // for it (entities/mobs.js reads the same uniforms for its tints).
    CHUNK_LIGHT_UNIFORMS.uHeldLightLevel.value = Math.max(
      LIGHTING.HELD_LIGHT[inventory.selectedName] ?? 0,
      LIGHTING.HELD_LIGHT[inventory.offhandName] ?? 0,
    );
    CHUNK_LIGHT_UNIFORMS.uHeldLightPos.value.copy(camera.position);
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
    if (!paused) updateSleep(delta);
    // The boss bar: shown for as long as the dragon lives. Phase 22 fixed
    // the reported "empty space where it should be" — the bar is now driven
    // by BEING IN THE END, not by the fight having already ticked. Arriving
    // (or arriving and pausing before the first unpaused frame) used to
    // leave `health` null for as many frames as it took the fight to
    // initialise, and the bar stayed hidden through all of them.
    const dragonHealth = dragonFight.health;
    const dragonAlive = dragonFight.state !== 'dying' && dragonFight.state !== 'dead';
    setBossBar(
      dimensions.activeKey === 'end' && dragonAlive
        ? { fraction: (dragonHealth ?? DRAGON.HEALTH) / DRAGON.HEALTH }
        : null,
      paused ? 0 : delta,
    );
    updateHud(player, stats, paused ? 0 : delta);
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
