// world/spawners.js — Phase 17: blaze spawner block entities. The SPAWNER
// block itself renders as the normal cutout cube (the caged atlas tile);
// this module owns everything else per placed spawner: the spinning
// miniature blaze visible inside the cage, and the spawning — with a
// player inside ACTIVATE_RANGE the cage spins up and every DELAY roll it
// spawns blazes into open cells around itself, unless enough blazes
// already crowd it (the vanilla shape, simplified).
//
// Fortress generation writes spawner blocks straight into chunk data (no
// block events fire), so spawners are DISCOVERED by scanning newly meshed
// chunks — the world/fluids.js settle-scan pattern, budgeted per frame
// with its own chunk flag (`_spawnerScanned`, cleared on the same unload
// paths). States are keyed by position, survive chunk unloads, and follow
// the owning chunk's mesh visibility like chests.

import * as THREE from 'three';
import { SPAWNER, CHUNK, OVERWORLD } from '../config.js';
import { BLOCK, blockDef, isLava } from './blocks.js';
import { createMobModel } from '../entities/models.js';
import { MOB_TYPES } from '../entities/registry.js';

const SIZE = CHUNK.SIZE;
const HEIGHT = CHUNK.HEIGHT;
const MIN_Y = OVERWORLD.MIN_Y;

// `getMobs` resolves lazily (the mob manager is created after the world
// systems); `player` supplies the activation distance.
export function createSpawners({ world, scene, player, getMobs }) {
  const spawners = new Map(); // "x,y,z" -> state
  const keyOf = (x, y, z) => `${x},${y},${z}`;

  const rollDelay = () => SPAWNER.DELAY_MIN_SECONDS +
    Math.random() * (SPAWNER.DELAY_MAX_SECONDS - SPAWNER.DELAY_MIN_SECONDS);

  function createState(x, y, z) {
    // The display: a miniature blaze turning inside the cage. Its rods sit
    // in their rest rings (entities/blaze.js animates only live mobs); the
    // whole model spins, faster while the spawner is active.
    const { group, material } = createMobModel(MOB_TYPES.blaze);
    const holder = new THREE.Group();
    holder.position.set(x + 0.5, y + 0.1, z + 0.5);
    holder.scale.setScalar(SPAWNER.MINI_SCALE);
    holder.add(group);
    scene.add(holder);
    const state = {
      x, y, z,
      holder,
      material,
      spinRate: SPAWNER.SPIN_IDLE,
      timer: SPAWNER.FIRST_DELAY_SECONDS, // a discovered spawner fires fast
    };
    spawners.set(keyOf(x, y, z), state);
    return state;
  }

  function removeState(key, state) {
    state.holder.removeFromParent();
    state.material.dispose();
    spawners.delete(key);
  }

  // Discover generated spawners: scan each newly meshed chunk's block data
  // once (a flat typed-array indexOf sweep — cheap). Rescans after an
  // unload find existing states by key and leave them alone.
  function scanChunk(chunk) {
    const blocks = chunk.blocks;
    let i = blocks.indexOf(BLOCK.SPAWNER);
    while (i !== -1) {
      const y = MIN_Y + (i % HEIGHT);
      const col = (i - (y - MIN_Y)) / HEIGHT;
      const lx = col % SIZE;
      const lz = (col - lx) / SIZE;
      const wx = chunk.cx * SIZE + lx;
      const wz = chunk.cz * SIZE + lz;
      if (!spawners.has(keyOf(wx, y, wz))) createState(wx, y, wz);
      i = blocks.indexOf(BLOCK.SPAWNER, i + 1);
    }
    chunk._spawnerScanned = true;
  }

  // One spawn cycle: up to MAX_SPAWNS_PER_CYCLE blazes into open 2-high
  // cells around the spawner, capped by the nearby-blaze count.
  function trySpawnCycle(state) {
    const mobs = getMobs();
    if (!mobs) return;
    let nearby = 0;
    for (const mob of mobs.mobs) {
      if (mob.type.name !== 'blaze' || mob.entity.dead) continue;
      const p = mob.entity.position;
      if (Math.hypot(p.x - state.x, p.y - state.y, p.z - state.z) <=
        SPAWNER.NEARBY_RADIUS) {
        nearby++;
      }
    }
    let spawned = 0;
    for (
      let i = 0;
      i < SPAWNER.SPAWN_ATTEMPTS &&
      spawned < SPAWNER.MAX_SPAWNS_PER_CYCLE &&
      nearby + spawned < SPAWNER.MAX_NEARBY;
      i++
    ) {
      const x = state.x + Math.round((Math.random() * 2 - 1) * SPAWNER.SPAWN_RADIUS);
      const z = state.z + Math.round((Math.random() * 2 - 1) * SPAWNER.SPAWN_RADIUS);
      const y = state.y + Math.floor(Math.random() * (SPAWNER.SPAWN_Y_RANGE + 1));
      // Feet + head cells must be open and harmless (blazes hover — no
      // floor needed, but never inside blocks or the lava sea).
      let clear = true;
      for (let dy = 0; dy < 2; dy++) {
        const id = world.getBlock(x, y + dy, z);
        if (blockDef(id).solid || isLava(id)) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      mobs.spawnAt(MOB_TYPES.blaze, x + 0.5, y, z + 0.5);
      spawned++;
    }
  }

  // Block listener: a spawner block appearing gets its state (placed by a
  // future structure/dev path — generation goes through the scan instead);
  // anything replacing a spawner cell tears it down. No drops (vanilla).
  function onBlockChanged(x, y, z, id) {
    const key = keyOf(x, y, z);
    const state = spawners.get(key);
    if (id === BLOCK.SPAWNER) {
      if (!state) createState(x, y, z);
      return;
    }
    if (state) removeState(key, state);
  }

  function update(dt) {
    // Discover generated spawners in newly meshed chunks (budgeted).
    let scanned = 0;
    for (const chunk of world.chunks.values()) {
      if (!chunk.mesh || chunk._spawnerScanned) continue;
      scanChunk(chunk);
      if (++scanned >= SPAWNER.SCAN_CHUNKS_PER_FRAME) break;
    }

    const p = player.body.position;
    for (const state of spawners.values()) {
      const chunk = world.getChunkIfLoaded(
        Math.floor(state.x / SIZE), Math.floor(state.z / SIZE),
      );
      state.holder.visible = !!(chunk && chunk.mesh);
      if (!chunk) continue; // frozen with its chunk, like chests

      const dist = Math.hypot(
        p.x - (state.x + 0.5), p.y - state.y, p.z - (state.z + 0.5),
      );
      const active = dist <= SPAWNER.ACTIVATE_RANGE;
      const wantRate = active ? SPAWNER.SPIN_ACTIVE : SPAWNER.SPIN_IDLE;
      state.spinRate += (wantRate - state.spinRate) *
        (1 - Math.exp(-SPAWNER.SPIN_RESPONSE * dt));
      state.holder.rotation.y += state.spinRate * dt;

      if (active) {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.timer = rollDelay();
          trySpawnCycle(state);
        }
      }
    }
  }

  // Dimension switch: spawner states belong to their dimension (the chests
  // protocol — stored states hide their displays and freeze; the exported
  // Map keeps its identity). State shape: array of [key, state].
  function swapDimensionState(stored = []) {
    const prev = [...spawners.entries()];
    for (const [, state] of prev) state.holder.visible = false;
    spawners.clear();
    for (const [k, state] of stored) spawners.set(k, state);
    return prev;
  }

  return {
    update,
    onBlockChanged,
    swapDimensionState,
    spawners, // read-only by convention (debug/tests)
  };
}
