// entities/registry.js — the MOB_TYPES registry: per-mob stats and drops
// from the SPEC.md mob tables, plus each type's model table reference
// (geometry itself lives in entities/models.js). Split out of
// entities/mobs.js in Phase 15 per the ARCHITECTURE file-size cap note that
// mobs.js carried since Phase 14 — the manager (AI, animation, spawning
// dispatch) stays in mobs.js and imports this table.

import { MOBS } from '../config.js';
import {
  HUMANOID_MODEL, SKELETON_MODEL, CREEPER_MODEL, SPIDER_MODEL,
  COW_MODEL, PIG_MODEL, SHEEP_MODEL, SHEEP_WOOL_MODEL, CHICKEN_MODEL,
  GHAST_MODEL, BLAZE_MODEL, ENDERMAN_MODEL,
} from './models.js';

export const MOB_TYPES = {
  zombie: {
    name: 'zombie',
    ai: 'zombie',
    anim: 'biped',
    hostile: true,
    spawnWeight: 100,
    texture: 'assets/entity/zombie_zombie.png',
    textureSize: [64, 64],
    model: HUMANOID_MODEL,
    pose: { rightArm: { x: Math.PI / 2 }, leftArm: { x: Math.PI / 2 } },
    width: 0.6,
    height: 1.95,
    clearance: 2,              // standing room in cells (pathfinding)
    maxHealth: 20,             // SPEC
    speed: 2.3,                // blocks/s — the vanilla shamble
    attackDamage: 3,           // SPEC
    burnsInDaylight: true,
    drops: [{ item: 'rotten_flesh', count: [0, 2] }],
  },
  skeleton: {
    name: 'skeleton',
    ai: 'skeleton',
    anim: 'biped',
    hostile: true,
    spawnWeight: 100,
    texture: 'assets/entity/skeleton_skeleton.png',
    textureSize: [64, 32],
    model: SKELETON_MODEL,
    width: 0.6,
    height: 1.99,
    clearance: 2,
    maxHealth: 20,             // SPEC
    speed: 2.5,
    attackDamage: 4,           // SPEC: 4 by arrow
    burnsInDaylight: true,
    drops: [
      { item: 'bone', count: [0, 2] },
      { item: 'arrow', count: [0, 2] },
    ],
  },
  creeper: {
    name: 'creeper',
    ai: 'creeper',
    anim: 'creeper',
    hostile: true,
    spawnWeight: 100,
    texture: 'assets/entity/creeper_creeper.png',
    textureSize: [64, 32],
    model: CREEPER_MODEL,
    width: 0.6,
    height: 1.7,
    clearance: 2,
    maxHealth: 20,             // SPEC
    speed: 2.5,
    attackDamage: 22,          // SPEC: 22 at the explosion's centre
    drops: [{ item: 'gunpowder', count: [0, 2] }],
  },
  spider: {
    name: 'spider',
    ai: 'spider',
    anim: 'spider',
    hostile: true,
    spawnWeight: 100,
    texture: 'assets/entity/spider_spider.png',
    textureSize: [64, 32],
    model: SPIDER_MODEL,
    width: 1.2,                // a touch under the vanilla 1.4 so cave
                               // corridors don't jam it (climbing recovers)
    height: 0.9,
    clearance: 1,              // fits through 1-block gaps
    maxHealth: 16,             // SPEC
    speed: 3.2,                // fast
    attackDamage: 2,           // SPEC
    headHeightFraction: 0.6,   // eye sits low on the flat body
    drops: [{ item: 'string', count: [0, 2] }],
  },

  // The enderman (Phase 18 — SPEC: 40hp, 7 damage, passive until looked
  // at, teleports, damaged by water, drops ender pearls). A rare overworld
  // night spawn (the pearl source for eyes of ender); the End's islands
  // fill with them next phase. Behaviour in entities/enderman.js.
  enderman: {
    name: 'enderman',
    ai: 'enderman',
    anim: 'enderman',          // biped walk + the creepy head-lift layer
    hostile: true,
    spawnWeight: 60,           // Phase 19: 20 -> 60 ("could not find a
                               // single one" report — at 20 the cap filled
                               // with cave regulars before an enderman ever
                               // rolled; 60/460 of night spawns is uncommon
                               // but reliably encountered, and the Nether
                               // is the plentiful source now)
    texture: 'assets/entity/enderman_enderman.png',
    textureSize: [64, 32],
    model: ENDERMAN_MODEL,
    width: 0.6,
    height: 2.9,               // vanilla hitbox — genuinely tall
    clearance: 3,              // needs 3 blocks of standing room
    maxHealth: 40,             // SPEC
    speed: 3.5,                // fast once angry (wandering ambles slower)
    attackDamage: 7,           // SPEC
    headHeightFraction: 0.9,
    drops: [{ item: 'ender_pearl', count: [0, 1] }], // SPEC (vanilla roll)
  },

  // --- the Nether roster (Phase 16). `nether: true` keeps a type out of
  // the default overworld spawn pools — it spawns only where a dimension
  // def's spawn table lists it (entities/spawning.js reads the profile).
  ghast: {
    name: 'ghast',
    ai: 'ghast',
    anim: 'ghast',
    hostile: true,
    nether: true,
    spawnWeight: 100,
    texture: 'assets/entity/ghast_ghast.png',
    textureSize: [64, 32],     // classic unwrap layout (art ships at 2x)
    model: GHAST_MODEL,
    scale: 4,                  // model authored at 1 block, hitbox is 4
    flying: true,              // entities/entity.js: no gravity while alive
    width: 4,
    height: 4,
    clearance: 4,
    maxHealth: 10,             // SPEC
    speed: MOBS.GHAST.FLY_SPEED,
    attackDamage: MOBS.GHAST.FIREBALL.DAMAGE, // SPEC: damage = explosion
    minBrightness: 0.35,       // the pale ghost reads through the gloom
    headHeightFraction: 0.5,
    drops: [{ item: 'gunpowder', count: [0, 2] }], // SPEC
  },
  blaze: {
    name: 'blaze',
    ai: 'blaze',
    anim: 'blaze',
    hostile: true,
    nether: true,              // never in the overworld pools — and not in
                               // the Nether's natural table either: blazes
                               // come only from fortress spawner blocks
                               // (world/spawners.js), like vanilla
    spawnWeight: 0,
    texture: 'assets/entity/blaze.png',
    textureSize: [64, 32],
    model: BLAZE_MODEL,
    flying: true,              // hovers — entities/blaze.js steers wishY
    width: 0.6,                // vanilla hitbox
    height: 1.8,
    clearance: 2,
    maxHealth: 20,             // SPEC
    speed: MOBS.BLAZE.FLY_SPEED,
    attackDamage: MOBS.BLAZE.FIREBALL.DAMAGE, // 5 per fireball + brief fire
                               // (Phase 18: the real Minecraft values)
    minBrightness: 0.9,        // a creature of fire renders near-fullbright
    headHeightFraction: 0.85,
    drops: [
      { item: 'blaze_rod', count: [0, 1] }, // SPEC blaze_rod (vanilla roll)
      // Phase 18: magma cream rides along occasionally — it's the fire
      // resistance ingredient (SPEC critical path) and its vanilla sources
      // (magma cubes, bartering) are out of scope. Documented deviation.
      { item: 'magma_cream', count: 1, chance: 0.25 },
    ],
  },

  // --- the passive herds (Phase 14). Stats from the SPEC passive table;
  // meat item ids follow the texture names (beef, porkchop, mutton,
  // chicken — what the smelting recipes and food registry expect). `speed`
  // is the panic-flee speed; wandering ambles at a fraction of it
  // (config MOBS.PASSIVE). Temperate texture variants per the session note.
  cow: {
    name: 'cow',
    ai: 'passive',
    anim: 'quadruped',
    hostile: false,
    spawnWeight: 100,
    texture: 'assets/entity/cow_temperate_cow.png',
    textureSize: [64, 64],
    model: COW_MODEL,
    width: 0.9,
    height: 1.4,
    clearance: 2,
    maxHealth: 10,             // SPEC
    speed: 2.0,
    headHeightFraction: 0.9,
    drops: [
      { item: 'beef', count: [1, 3] },     // SPEC raw_beef
      { item: 'leather', count: [0, 2] },  // SPEC leather
    ],
  },
  pig: {
    name: 'pig',
    ai: 'passive',
    anim: 'quadruped',
    hostile: false,
    spawnWeight: 100,
    texture: 'assets/entity/pig_temperate_pig.png',
    textureSize: [64, 64],
    model: PIG_MODEL,
    width: 0.9,
    height: 0.9,
    clearance: 1,
    maxHealth: 10,             // SPEC
    speed: 2.0,
    headHeightFraction: 0.8,
    drops: [{ item: 'porkchop', count: [1, 3] }], // SPEC raw_porkchop
  },
  sheep: {
    name: 'sheep',
    ai: 'passive',
    anim: 'quadruped',
    hostile: false,
    spawnWeight: 100,
    texture: 'assets/entity/sheep_sheep.png',
    textureSize: [64, 32],
    model: SHEEP_MODEL,
    // The wool coat renders as an overlay model on its own sheet, hidden
    // while sheared (entities/passive.js owns shear/regrow).
    overlay: {
      texture: 'assets/entity/sheep_sheep_wool.png',
      textureSize: [64, 32],
      model: SHEEP_WOOL_MODEL,
    },
    wool: true,
    width: 0.9,
    height: 1.3,
    clearance: 2,
    maxHealth: 8,              // SPEC
    speed: 2.0,
    headHeightFraction: 0.9,
    // SPEC: wool + raw_mutton — but a sheared sheep has no wool to give.
    dropsFor: (mob) => [
      { item: 'mutton', count: [1, 2] },
      ...(mob.sheared ? [] : [{ item: 'white_wool', count: 1 }]),
    ],
    drops: [],                 // superseded by dropsFor (kept for tooling)
  },
  chicken: {
    name: 'chicken',
    ai: 'passive',
    anim: 'chicken',
    hostile: false,
    spawnWeight: 100,
    texture: 'assets/entity/chicken_temperate_chicken.png',
    textureSize: [64, 32],
    model: CHICKEN_MODEL,
    laysEggs: true,
    // The wing-flap slow fall: a per-type fall cap the physics step clamps
    // (entities/entity.js) — frame-rate exact, unlike an AI-side clamp.
    maxFallSpeed: MOBS.PASSIVE.CHICKEN.FALL_SPEED,
    width: 0.4,
    height: 0.7,
    clearance: 1,
    maxHealth: 4,              // SPEC
    speed: 1.75,
    headHeightFraction: 0.95,
    drops: [
      { item: 'chicken', count: 1 },       // SPEC raw_chicken
      { item: 'feather', count: [0, 2] },  // SPEC feather
    ],
  },
};
