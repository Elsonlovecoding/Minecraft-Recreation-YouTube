// entities/spawning.js — the natural-spawning framework, split out of
// entities/mobs.js in Phase 14 (the ARCHITECTURE cap note it carried since
// Phase 13). Per SPAWN_INTERVAL_SECONDS it makes SPAWN_ATTEMPTS_PER_CYCLE
// attempts: a random ring position 24..96 blocks from the player, a column
// walk to solid opaque harmless ground, then the SPEC light gates —
// hostiles need effective light <= 7 (block light holds at night, sky light
// dims with the day/night cycle), passives need real DAYLIGHT >= 9 on a
// grass block (sky light after the darken — a torch-lit field at night
// spawns nothing). Passives count toward their cap only within
// DESPAWN_DISTANCE, because they never despawn (Phase 14) — herds left
// behind by a travelling player must not starve the cap forever.
//
// Phase 16: the pools, caps and light rule come from a per-dimension spawn
// PROFILE (`getProfile()` — entities/mobs.js resolves the active dimension
// def's table, defaulting to the overworld pools): the Nether lists the
// ghast with its own small cap and `anyLight` (no light gate — the Nether
// spawns in any light, vanilla). Wide types (the ghast's 4-block box) also
// verify their whole spawn box is free, not just the anchor column.
//
// The per-mob registry (stats, drops, models) stays in entities/registry.js
// per ARCHITECTURE.md; this module receives a spawnAt callback from the mob
// manager.

import { MOBS, OVERWORLD, CHUNK } from '../config.js';
import { BLOCK, blockDef } from '../world/blocks.js';
import { standableAt } from './pathfinding.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// `mobs` is the live mob list (read each cycle); `spawnAt(type, x, y, z)`
// creates one and is owned by the manager; `getProfile()` resolves the
// active dimension's spawn table.
export function createSpawner({ world, player, dayNight, mobs, spawnAt, getProfile }) {
  const getBlock = (x, y, z) => world.getBlock(x, y, z);
  let spawnTimer = 0;

  function countByCategory() {
    const p = player.body.position;
    let hostile = 0;
    let passive = 0;
    for (const mob of mobs) {
      if (mob.entity.dead) continue;
      if (mob.type.hostile) {
        hostile++;
      } else {
        // Passives never despawn; only nearby ones hold a cap slot.
        const mp = mob.entity.position;
        if (Math.hypot(mp.x - p.x, mp.y - p.y, mp.z - p.z) <= MOBS.DESPAWN_DISTANCE) {
          passive++;
        }
      }
    }
    return { hostile, passive };
  }

  // The effective light for hostile gates: block light holds at night, sky
  // light dims with the day/night cycle exactly like the shading does.
  function effectiveLight(light) {
    return Math.max(light.block, light.sky - dayNight.skyDarken);
  }

  function pickWeighted(pool) {
    let total = 0;
    for (const t of pool) total += t.spawnWeight ?? 1;
    let r = Math.random() * total;
    for (const t of pool) {
      r -= t.spawnWeight ?? 1;
      if (r <= 0) return t;
    }
    return pool[pool.length - 1];
  }

  // Wide types (the ghast) need their whole box free, not just the anchor
  // column. Every chunk the box touches must already be loaded — getBlock
  // would otherwise generate one synchronously mid-frame.
  function boxClear(type, x, y, z) {
    const r = Math.ceil(type.width / 2);
    for (const [cx, cz] of [
      [x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r],
    ]) {
      if (!world.getChunkIfLoaded(
        Math.floor(cx / CHUNK.SIZE), Math.floor(cz / CHUNK.SIZE),
      )) {
        return false;
      }
    }
    const h = Math.ceil(type.height);
    for (let dy = 0; dy < h; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (blockDef(getBlock(x + dx, y + dy, z + dz)).solid) return false;
        }
      }
    }
    return true;
  }

  function trySpawnOne(counts, profile) {
    const wantHostile = counts.hostile < profile.hostileCap && profile.hostile.length > 0;
    const wantPassive = counts.passive < profile.passiveCap && profile.passive.length > 0;
    if (!wantHostile && !wantPassive) return false;
    const hostile = wantHostile && (!wantPassive || Math.random() < 0.5);
    const type = pickWeighted(hostile ? profile.hostile : profile.passive);

    const p = player.body.position;
    const angle = Math.random() * Math.PI * 2;
    const dist = MOBS.SPAWN_MIN_DISTANCE +
      Math.random() * (MOBS.SPAWN_MAX_DISTANCE - MOBS.SPAWN_MIN_DISTANCE);
    const x = Math.floor(p.x + Math.cos(angle) * dist);
    const z = Math.floor(p.z + Math.sin(angle) * dist);
    // Cold chunks never spawn — the column scan's getBlock would otherwise
    // generate a whole chunk synchronously (multi-ms, outside the streaming
    // budget) only for the light gate to reject the attempt anyway.
    if (!world.getChunkIfLoaded(
      Math.floor(x / CHUNK.SIZE), Math.floor(z / CHUNK.SIZE),
    )) {
      return false;
    }
    const yBase = clamp(
      Math.floor(p.y) + Math.round((Math.random() * 2 - 1) * MOBS.SPAWN_Y_RANGE),
      OVERWORLD.MIN_Y + 1,
      OVERWORLD.MIN_Y + CHUNK.HEIGHT - 3,
    );

    // Walk down the column a little to find ground under the picked cell.
    let y = null;
    for (let i = 0; i <= MOBS.SPAWN_COLUMN_SCAN; i++) {
      if (standableAt(getBlock, x, yBase - i, z, type.clearance)) {
        y = yBase - i;
        break;
      }
    }
    if (y === null) return false;

    // Solid, opaque, harmless ground (standableAt already rejected cactus);
    // no spawning submerged.
    const floor = blockDef(getBlock(x, y - 1, z));
    if (floor.transparent) return false; // no leaves/chest/glass tops
    if (getBlock(x, y, z) === BLOCK.WATER || getBlock(x, y + 1, z) === BLOCK.WATER) {
      return false;
    }
    if (!hostile && getBlock(x, y - 1, z) !== BLOCK.GRASS_BLOCK) return false;

    // Wide bodies need their whole box open, not just the anchor column.
    if (type.width > 1 && !boxClear(type, x, y, z)) return false;

    // Distance gate on the real position (never in the player's face,
    // never outside despawn range).
    const cx = x + 0.5;
    const cz = z + 0.5;
    const d = Math.hypot(cx - p.x, y - p.y, cz - p.z);
    if (d < MOBS.SPAWN_MIN_DISTANCE || d > MOBS.DESPAWN_DISTANCE) return false;

    // Light gates (SPEC): hostiles need effective light <= 7 — torches
    // prevent spawns, night surfaces allow them; passives need bright
    // DAYLIGHT on their grass (sky component only — no torch farms).
    // No light data (unmeshed chunk) = no spawn, even under `anyLight`
    // (the Nether rule) — spawning into never-rendered space is never right.
    const light = world.getLight(x, y, z);
    if (!light) return false;
    if (!profile.anyLight) {
      if (hostile && effectiveLight(light) > MOBS.HOSTILE_SPAWN_LIGHT_MAX) return false;
      if (!hostile &&
        light.sky - dayNight.skyDarken < MOBS.PASSIVE_SPAWN_LIGHT_MIN) {
        return false;
      }
    }

    spawnAt(type, cx, y, cz);
    return true;
  }

  function update(dt) {
    spawnTimer += dt;
    if (spawnTimer < MOBS.SPAWN_INTERVAL_SECONDS) return;
    spawnTimer = 0;
    const profile = getProfile();
    const counts = countByCategory();
    for (let i = 0; i < MOBS.SPAWN_ATTEMPTS_PER_CYCLE; i++) {
      if (trySpawnOne(counts, profile)) {
        // Recount so a cycle can't blow past a cap.
        const fresh = countByCategory();
        counts.hostile = fresh.hostile;
        counts.passive = fresh.passive;
      }
    }
  }

  return { update, countByCategory };
}
