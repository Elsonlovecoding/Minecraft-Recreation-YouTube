// entities/mobs.js — the mob manager and registry. Per-mob stats + drops
// from SPEC.md (box-model geometry lives in entities/models.js), the
// hostile AI state machines, walk/head animation over the models.js rigs,
// daylight burning, and the player-attack raycast. Damage TO the player
// routes through the injected combat system (systems/combat.js) so armour
// reduction applies; skeleton arrows and creeper explosions are combat's
// machinery too. Phase 14 splits (ARCHITECTURE cap): natural spawning lives
// in entities/spawning.js, passive behaviour in entities/passive.js.
//
// The roster (SPEC mob tables):
//   zombie    walks at the player, melee bites, burns in daylight
//   skeleton  keeps its distance; draws its bow visibly, fires on release
//             (2s cycle), burns in daylight
//   creeper   approaches, hisses, flashes and swells, explodes after 1.5s
//   spider    fast, climbs walls, neutral in daylight unless provoked
//   cow/pig/sheep/chicken  wander on daylight grass, flee when hit, never
//             despawn; sheep shear, chickens lay eggs and fall slowly
// (enderman/blaze/ghast arrive with their dimensions.)

import * as THREE from 'three';
import { MOBS, COMBAT, LIGHTING, PLAYER } from '../config.js';
import { Entity } from './entity.js';
import { findPath } from './pathfinding.js';
import {
  createMobModel, attachOverlayModel, HUMANOID_MODEL, SKELETON_MODEL,
  CREEPER_MODEL, SPIDER_MODEL, SPIDER_LEG_POSE, COW_MODEL, PIG_MODEL,
  SHEEP_MODEL, SHEEP_WOOL_MODEL, CHICKEN_MODEL,
} from './models.js';
import { createSpawner } from './spawning.js';
import { createPassiveBehaviour } from './passive.js';
import { rayAABB, lineOfSight } from '../systems/combat.js';
import { createExtrudedItemMesh } from './items.js';
import { CHUNK_LIGHT_UNIFORMS, heldLightBrightness } from '../render/lighting.js';
import { blockDef } from '../world/blocks.js';

// ---------------------------------------------------------------------------
// Mob registry — stats and drops are the SPEC.md hostile table, exactly.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Small angle helpers (animation)
// ---------------------------------------------------------------------------

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const easeAngle = (from, to, rate, dt) =>
  from + wrapAngle(to - from) * (1 - Math.exp(-rate * dt));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// The mob manager
// ---------------------------------------------------------------------------

// `dayNight` supplies skyDarken (spawn gates and daylight burning follow the
// time of day); `items` receives death drops; `combat` (systems/combat.js)
// takes all damage to the player (armour applies there) and supplies
// skeleton arrows, creeper explosions and the hiss.
export function createMobs({ world, scene, player, stats, items, dayNight, combat }) {
  const mobs = [];
  const getBlock = (x, y, z) => world.getBlock(x, y, z);

  const hostileTypes = Object.values(MOB_TYPES).filter((t) => t.hostile);
  const passiveTypes = Object.values(MOB_TYPES).filter((t) => !t.hostile);

  // Phase 14 splits: natural spawning (entities/spawning.js) and passive
  // behaviour (entities/passive.js) plug back into this manager.
  const passive = createPassiveBehaviour({ world, player, items });

  function spawnAt(type, x, y, z) {
    const entity = new Entity(world, { x, y, z }, type);
    const { group, parts, material } = createMobModel(type);
    group.position.set(x, y, z);
    scene.add(group);
    const mob = {
      type,
      entity,
      group,
      parts,
      material,
      materials: [material], // every material tinted by light/hurt/fire
      yaw: Math.random() * Math.PI * 2,
      headYaw: 0,
      headPitch: 0,
      swingPhase: 0,
      swingAmp: 0,
      brightness: 1,
      path: null,
      pathIndex: 0,
      repathTimer: 0,
      meleeTimer: 0,
      burnTimer: 0,          // lava AND daylight fire ticks
      suffocateTimer: 0,
      onFire: false,         // daylight burning (drives the flicker tint)
      provoked: false,       // hit by the player — neutral spiders retaliate
      // skeleton state (Phase 14: a real draw-and-release cycle)
      aiming: false,
      aimBlend: 0,
      shootCooldown: MOBS.SKELETON.SHOOT_COOLDOWN_SECONDS,
      drawTime: 0,
      // creeper state
      ignited: false,
      fuse: 0,
      // passive state (entities/passive.js attaches lazily)
      passive: null,
      sheared: false,
      woolPivots: null,
    };
    // The sheep's wool coat: a second sheet's model riding the same rig.
    if (type.overlay) {
      const overlay = attachOverlayModel(parts, type.overlay);
      mob.woolPivots = overlay.pivots;
      mob.materials.push(overlay.material);
    }
    // The skeleton's bow (Phase 14): the extruded item slab in the LEFT
    // hand — a child of the arm pivot, so the aim pose points it at the
    // target and the draw animation rides along.
    if (type.ai === 'skeleton' && parts.leftArm) {
      const S = MOBS.SKELETON;
      const bow = createExtrudedItemMesh('bow', S.BOW_SCALE);
      bow.position.set(...S.BOW_OFFSET);
      bow.rotation.set(...S.BOW_TILT);
      parts.leftArm.add(bow);
    }
    applyPose(mob);
    mobs.push(mob);
    return mob;
  }

  function applyPose(mob) {
    const pose = mob.type.pose ?? {};
    for (const [name, rot] of Object.entries(pose)) {
      const part = mob.parts[name];
      if (!part) continue;
      part.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
    }
  }

  function removeMob(index) {
    const mob = mobs[index];
    mob.group.removeFromParent();
    for (const material of mob.materials) material.dispose();
    mobs.splice(index, 1);
  }

  // Loot rolls the type's drop table — or its dropsFor(mob) when the table
  // depends on the mob's state (a sheared sheep has no wool). Every
  // damage-death rolls every entry; a [0, n] range can legitimately roll 0
  // (vanilla skeletons sometimes leave nothing).
  function dropLoot(mob) {
    const p = mob.entity.position;
    const table = mob.type.dropsFor ? mob.type.dropsFor(mob) : (mob.type.drops ?? []);
    for (const drop of table) {
      if (drop.chance !== undefined && Math.random() >= drop.chance) continue;
      const count = Array.isArray(drop.count)
        ? drop.count[0] + Math.floor(Math.random() * (drop.count[1] - drop.count[0] + 1))
        : drop.count;
      if (count > 0) {
        items.spawn(drop.item, count, { x: p.x, y: p.y + 0.5, z: p.z });
      }
    }
  }

  // --- spawning (entities/spawning.js since the Phase 14 split) ------------

  const spawner = createSpawner({
    world, player, dayNight, hostileTypes, passiveTypes, mobs, spawnAt,
  });

  // The effective light for the spider's neutrality gate: block light holds
  // at night, sky light dims with the day/night cycle like the shading does.
  function effectiveLight(light) {
    return Math.max(light.block, light.sky - dayNight.skyDarken);
  }

  // --- shared AI machinery -------------------------------------------------

  // Steer toward the player: straight-line when close (or pathless), A*
  // waypoints when far. Writes the entity's wish velocity.
  function steerToward(mob, dt) {
    const e = mob.entity;
    const p = e.position;
    const t = player.body.position;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const horiz = Math.hypot(dx, dz);
    let dirX = horiz > 1e-6 ? dx / horiz : 0;
    let dirZ = horiz > 1e-6 ? dz / horiz : 0;

    if (horiz > MOBS.CHASE_DIRECT_RANGE) {
      mob.repathTimer -= dt;
      if (mob.repathTimer <= 0) {
        mob.repathTimer = MOBS.REPATH_SECONDS;
        mob.path = findPath(
          getBlock,
          { x: p.x, y: p.y + 0.01, z: p.z },
          t,
          { clearance: mob.type.clearance },
        );
        mob.pathIndex = 0;
      }
      if (mob.path && mob.pathIndex < mob.path.length) {
        const wp = mob.path[mob.pathIndex];
        const wx = wp.x + 0.5 - p.x;
        const wz = wp.z + 0.5 - p.z;
        const wd = Math.hypot(wx, wz);
        if (wd < MOBS.WAYPOINT_RADIUS) {
          mob.pathIndex++;
        } else {
          dirX = wx / wd;
          dirZ = wz / wd;
        }
      }
    }

    e.wishX = dirX * mob.type.speed;
    e.wishZ = dirZ * mob.type.speed;
  }

  // A melee bite when close enough on the flat and roughly level. Damage
  // goes through combat so armour reduces it; knockback rides along.
  function tryMelee(mob, dt) {
    const e = mob.entity;
    const p = e.position;
    const t = player.body.position;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    mob.meleeTimer = Math.max(0, mob.meleeTimer - dt);
    if (
      mob.meleeTimer === 0 && Math.hypot(dx, dz) < MOBS.MELEE_RANGE &&
      Math.abs(t.y - p.y) < MOBS.MELEE_VERTICAL_RANGE &&
      !stats.dead && player.mode !== 'fly'
    ) {
      mob.meleeTimer = MOBS.MELEE_COOLDOWN_SECONDS;
      combat.damagePlayer(mob.type.attackDamage, dx, dz);
    }
  }

  const playerDistance = (mob) => {
    const p = mob.entity.position;
    const t = player.body.position;
    return Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
  };

  // The player can be engaged at all: alive, and not the untouchable
  // debug fly camera (every AI stands down uniformly).
  const playerTargetable = () => !stats.dead && player.mode !== 'fly';

  // --- per-mob AI ----------------------------------------------------------

  function zombieAI(mob, dt) {
    const e = mob.entity;
    if (!playerTargetable() || playerDistance(mob) > MOBS.AGGRO_RADIUS) {
      e.wishX = 0;
      e.wishZ = 0;
      return;
    }
    steerToward(mob, dt);
    tryMelee(mob, dt);
  }

  function skeletonAI(mob, dt) {
    const e = mob.entity;
    const S = MOBS.SKELETON;
    const dist = playerDistance(mob);
    mob.shootCooldown = Math.max(0, mob.shootCooldown - dt);
    if (!playerTargetable() || dist > MOBS.AGGRO_RADIUS) {
      e.wishX = 0;
      e.wishZ = 0;
      mob.aiming = false;
      mob.drawTime = Math.max(0, mob.drawTime - dt * S.DRAW_DECAY_RATE);
      return;
    }
    const p = e.position;
    const t = player.body.position;
    const eye = { x: p.x, y: p.y + S.EYE_HEIGHT, z: p.z };
    const playerEye = { x: t.x, y: t.y + PLAYER.EYE_HEIGHT, z: t.z };
    const los = lineOfSight(getBlock, eye, playerEye);

    if (dist < S.RETREAT_RANGE) {
      // Too close: back straight away, still aiming.
      const dx = p.x - t.x;
      const dz = p.z - t.z;
      const h = Math.hypot(dx, dz) || 1;
      e.wishX = (dx / h) * mob.type.speed;
      e.wishZ = (dz / h) * mob.type.speed;
      mob.aiming = los;
    } else if (dist > S.PREFERRED_RANGE || !los) {
      // Out of range or no shot: close in.
      steerToward(mob, dt);
      mob.aiming = false;
    } else {
      // In the sweet spot with a clear shot: stand and aim.
      e.wishX = 0;
      e.wishZ = 0;
      mob.aiming = true;
    }

    // The Phase 14 firing cycle: once the cooldown has passed, an aiming
    // skeleton DRAWS for S.DRAW_SECONDS (the visible wind-up — the draw
    // animation reads mob.drawTime) and releases the arrow at full draw,
    // then cools down for S.SHOOT_COOLDOWN_SECONDS. Losing the aim
    // mid-draw lets the draw down without firing. Sum: one arrow every
    // 2 seconds flat out, never a snap shot.
    if (mob.aiming && mob.shootCooldown === 0) {
      mob.drawTime += dt;
      if (mob.drawTime >= S.DRAW_SECONDS) {
        mob.drawTime = 0;
        mob.shootCooldown = S.SHOOT_COOLDOWN_SECONDS;
        skeletonShoot(mob, eye);
      }
    } else {
      mob.drawTime = Math.max(0, mob.drawTime - dt * S.DRAW_DECAY_RATE);
    }
  }

  // Fire an arrow with lead: aim where the player is heading, lifted for
  // the gravity arc over the flight time.
  function skeletonShoot(mob, from) {
    const S = MOBS.SKELETON;
    const t = player.body.position;
    const v = player.body.velocity;
    const target = {
      x: t.x, y: t.y + PLAYER.HEIGHT * S.AIM_HEIGHT_FRACTION, z: t.z,
    };
    const flight = Math.hypot(
      target.x - from.x, target.y - from.y, target.z - from.z,
    ) / S.ARROW_SPEED;
    const lead = S.AIM_LEAD_FACTOR * flight;
    const aim = {
      x: target.x + v.x * lead - from.x,
      y: target.y - from.y + 0.5 * COMBAT.ARROW.GRAVITY * flight * flight,
      z: target.z + v.z * lead - from.z,
    };
    const len = Math.hypot(aim.x, aim.y, aim.z) || 1;
    const jitter = () => (Math.random() * 2 - 1) * S.ARROW_INACCURACY;
    const dir = { x: aim.x / len, y: aim.y / len, z: aim.z / len };
    combat.spawnArrow({
      from: {
        x: from.x + dir.x * COMBAT.ARROW.SPAWN_FORWARD,
        y: from.y + dir.y * COMBAT.ARROW.SPAWN_FORWARD,
        z: from.z + dir.z * COMBAT.ARROW.SPAWN_FORWARD,
      },
      vel: {
        x: dir.x * S.ARROW_SPEED + jitter(),
        y: dir.y * S.ARROW_SPEED + jitter(),
        z: dir.z * S.ARROW_SPEED + jitter(),
      },
      damage: mob.type.attackDamage,
      fromPlayer: false,
    });
  }

  function creeperAI(mob, dt) {
    const e = mob.entity;
    const C = MOBS.CREEPER;
    const dist = playerDistance(mob);
    const targetable = playerTargetable();

    if (targetable && dist < C.IGNITE_RANGE && !mob.ignited) {
      mob.ignited = true; // the hiss, once per ignition
      combat.sfx.hiss(Math.max(C.HISS_MIN_VOLUME, 1 - dist / C.HISS_RANGE));
    }
    if (mob.ignited && (dist > C.ABORT_RANGE || !targetable)) mob.ignited = false;

    if (mob.ignited) {
      e.wishX = 0;
      e.wishZ = 0;
      mob.fuse += dt;
    } else {
      mob.fuse = Math.max(0, mob.fuse - dt * C.FUSE_REWIND_RATE);
      if (targetable && dist <= MOBS.AGGRO_RADIUS) steerToward(mob, dt);
      else {
        e.wishX = 0;
        e.wishZ = 0;
      }
    }

    if (mob.fuse >= C.FUSE_SECONDS) {
      const p = e.position;
      e.removed = true; // exploding is not dying — no gunpowder from this
      combat.explode(
        { x: p.x, y: p.y + e.def.height / 2, z: p.z },
        mob.type.attackDamage,
      );
    }
  }

  function spiderAI(mob, dt) {
    const e = mob.entity;
    const p = e.position;
    // Neutral in bright light (daylight) unless the player provoked it.
    const light = world.getLight(p.x, p.y + 0.5, p.z);
    const level = light ? effectiveLight(light) : 0;
    const hostile = mob.provoked || level <= MOBS.SPIDER.HOSTILE_LIGHT_MAX;

    if (!hostile || !playerTargetable() || playerDistance(mob) > MOBS.AGGRO_RADIUS) {
      e.wishX = 0;
      e.wishZ = 0;
    } else {
      steerToward(mob, dt);
      tryMelee(mob, dt);
    }
    // Climbing (vanilla rule): pressing into a wall lifts the spider. The
    // collision flag is last step's; the impulse feeds the coming step, and
    // the climbing flag keeps ground-style steering while airborne so the
    // body stays pressed against the wall all the way up.
    e.climbing = e.horizontalCollision && (e.wishX !== 0 || e.wishZ !== 0);
    if (e.climbing) e.velocity.y = MOBS.SPIDER.CLIMB_SPEED;
  }

  const AI = {
    zombie: zombieAI,
    skeleton: skeletonAI,
    creeper: creeperAI,
    spider: spiderAI,
    passive: passive.passiveAI,
  };

  // Right-click on a mob with an item (player/interaction.js routes it
  // through main.js): shears on an unsheared sheep shear it. Returns true
  // when the use consumed the click (the caller wears the shears).
  function useOnMob(mob, itemName) {
    if (itemName === 'shears' && passive.shear(mob)) return true;
    return false;
  }

  // --- daylight burning ----------------------------------------------------

  // Zombies and skeletons on fire under the open day sky (SPEC). Direct
  // sky light only — any roof, canopy or overhang shades; water douses.
  function daylightBurning(mob) {
    if (!mob.type.burnsInDaylight) return false;
    const e = mob.entity;
    if (e.dead || e.inWater) return false;
    if (dayNight.skyDarken > MOBS.DAYLIGHT_BURN.MAX_SKY_DARKEN) return false;
    const p = e.position;
    const light = world.getLight(
      p.x,
      p.y + e.def.height * (mob.type.headHeightFraction ?? MOBS.HEAD_HEIGHT_FRACTION),
      p.z,
    );
    return !!light && light.sky >= MOBS.DAYLIGHT_BURN.MIN_SKY_LIGHT;
  }

  // --- animation -----------------------------------------------------------

  function animateBipedLimbs(mob, swing, dt) {
    const pose = mob.type.pose ?? {};
    if (mob.parts.rightLeg) mob.parts.rightLeg.rotation.x = swing;
    if (mob.parts.leftLeg) mob.parts.leftLeg.rotation.x = -swing;
    // Arms counter-swing over their pose (the zombie's stay raised, swaying
    // a little); an aiming skeleton raises both toward the player instead.
    const aimTarget = mob.aiming && !mob.entity.dead ? 1 : 0;
    mob.aimBlend += (aimTarget - mob.aimBlend) *
      (1 - Math.exp(-MOBS.LIMB_SWING_FADE_RATE * dt));
    const armSwing = swing * (pose.rightArm ? MOBS.POSED_ARM_SWAY : 1);
    let rightX = (pose.rightArm?.x ?? 0) - armSwing;
    let leftX = (pose.leftArm?.x ?? 0) + armSwing;
    // The skeleton's draw (Phase 14): while the wind-up runs, the bow arm
    // (LEFT — it holds the bow) lifts a touch and the string arm folds
    // back across the chest, releasing forward the instant the arrow goes.
    const S = MOBS.SKELETON;
    const drawFrac = mob.type.ai === 'skeleton'
      ? Math.min(1, mob.drawTime / S.DRAW_SECONDS)
      : 0;
    if (mob.aimBlend > 0.001) {
      const aimX = Math.PI / 2 + mob.headPitch;
      rightX = rightX * (1 - mob.aimBlend) + aimX * mob.aimBlend;
      leftX = leftX * (1 - mob.aimBlend) +
        (aimX + S.DRAW_ARM_RAISE * drawFrac) * mob.aimBlend;
    }
    if (mob.parts.rightArm) {
      mob.parts.rightArm.rotation.x = rightX;
      mob.parts.rightArm.rotation.y =
        (-0.1 - S.DRAW_STRING_PULL * drawFrac) * mob.aimBlend;
    }
    if (mob.parts.leftArm) {
      mob.parts.leftArm.rotation.x = leftX;
      mob.parts.leftArm.rotation.y = 0.1 * mob.aimBlend;
    }
  }

  function animateCreeperLimbs(mob, swing) {
    // Diagonal leg pairs alternate, quadruped-style.
    if (mob.parts.leg1) mob.parts.leg1.rotation.x = swing;
    if (mob.parts.leg2) mob.parts.leg2.rotation.x = -swing;
    if (mob.parts.leg3) mob.parts.leg3.rotation.x = -swing;
    if (mob.parts.leg4) mob.parts.leg4.rotation.x = swing;
  }

  function animateSpiderLimbs(mob) {
    const SP = MOBS.SPIDER;
    for (let i = 0; i < 4; i++) {
      const pose = SPIDER_LEG_POSE[i];
      const phase = mob.swingPhase * 2 + (i * Math.PI) / 2;
      const osc = Math.sin(phase) * SP.LEG_SWING * mob.swingAmp;
      const lift = Math.abs(Math.cos(phase)) * SP.LEG_LIFT * mob.swingAmp;
      const left = mob.parts[`legL${i + 1}`];
      const right = mob.parts[`legR${i + 1}`];
      if (left) {
        left.rotation.z = pose.roll - lift;
        left.rotation.y = pose.yaw + osc;
      }
      if (right) {
        right.rotation.z = -(pose.roll - lift);
        right.rotation.y = -pose.yaw + osc;
      }
    }
  }

  function animate(mob, dt) {
    const e = mob.entity;
    const type = mob.type;

    // Body yaw eases toward the move direction (forward = -sin/-cos yaw).
    const v = e.velocity;
    if (Math.hypot(v.x, v.z) > MOBS.BODY_TURN_MIN_SPEED && !e.dead) {
      mob.yaw = easeAngle(mob.yaw, Math.atan2(-v.x, -v.z), MOBS.BODY_TURN_RATE, dt);
    }

    // Limb swing rides the actual ground speed.
    const ampTarget = e.onGround || e.inWater
      ? Math.min(1, e.horizontalSpeed / Math.max(0.001, type.speed))
      : 0;
    mob.swingAmp += (ampTarget - mob.swingAmp) *
      (1 - Math.exp(-MOBS.LIMB_SWING_FADE_RATE * dt));
    mob.swingPhase += e.horizontalSpeed * MOBS.LIMB_SWING_CYCLES_PER_BLOCK *
      Math.PI * 2 * dt;
    const swing = Math.sin(mob.swingPhase) * MOBS.LIMB_SWING_MAX * mob.swingAmp;
    if (type.anim === 'spider') animateSpiderLimbs(mob);
    else if (type.anim === 'creeper') animateCreeperLimbs(mob, swing);
    else if (type.anim === 'quadruped') passive.animateQuadruped(mob, swing);
    else if (type.anim === 'chicken') passive.animateChicken(mob, swing);
    else animateBipedLimbs(mob, swing, dt);

    // The head tracks the player inside HEAD_TRACK_RANGE, clamped to the
    // neck's limits, and returns to forward otherwise. The part's YXZ
    // rotation order (models.js) keeps a yawed head's pitch a nod, not a
    // roll — the Phase 12 "head angled slightly wrong" fix.
    const p = e.position;
    const t = player.body.position;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const trackDist = Math.hypot(dx, t.y - p.y, dz);
    let wantYaw = 0;
    let wantPitch = 0;
    if (trackDist < MOBS.HEAD_TRACK_RANGE && !e.dead) {
      wantYaw = clamp(
        wrapAngle(Math.atan2(-dx, -dz) - mob.yaw),
        -MOBS.HEAD_YAW_LIMIT, MOBS.HEAD_YAW_LIMIT,
      );
      const eyeDy = (t.y + PLAYER.EYE_HEIGHT) -
        (p.y + e.def.height * (type.headHeightFraction ?? MOBS.HEAD_HEIGHT_FRACTION));
      wantPitch = clamp(
        Math.atan2(eyeDy, Math.hypot(dx, dz)),
        -MOBS.HEAD_PITCH_LIMIT, MOBS.HEAD_PITCH_LIMIT,
      );
    }
    mob.headYaw = easeAngle(mob.headYaw, wantYaw, MOBS.HEAD_TURN_RATE, dt);
    mob.headPitch = easeAngle(mob.headPitch, wantPitch, MOBS.HEAD_TURN_RATE, dt);
    if (mob.parts.head) {
      mob.parts.head.rotation.y = mob.headYaw;
      mob.parts.head.rotation.x = mob.headPitch;
    }

    // Sync the group: position, body yaw, the death fall-over, and the
    // creeper's pre-blast swell.
    mob.group.position.set(p.x, p.y, p.z);
    mob.group.rotation.y = mob.yaw;
    mob.group.rotation.z = e.dead
      ? (1 - Math.max(0, e.deathTimer) / MOBS.DEATH_SECONDS) * (Math.PI / 2)
      : 0;
    const fuseFrac = type.ai === 'creeper'
      ? clamp(mob.fuse / MOBS.CREEPER.FUSE_SECONDS, 0, 1)
      : 0;
    mob.group.scale.setScalar(1 + MOBS.CREEPER.SWELL_SCALE * fuseFrac);

    // Tint by local baked light (cave mobs read dark, torch-lit mobs warm),
    // flash red while hurt, flicker orange while on fire, and blink white
    // while a creeper's fuse runs. Same falloff curve as the terrain shader.
    // Phase 14: the player's held-torch light lifts nearby mobs too — the
    // uniforms main.js writes for the chunk shader are read back here so
    // both stay in exact agreement.
    const light = world.getLight(p.x, p.y + e.def.height / 2, p.z);
    let target = 1;
    if (light) {
      const skyLevel = clamp(light.sky - dayNight.skyDarken, 0, 15);
      target = Math.max(
        LIGHTING.LIGHT_FALLOFF ** (15 - skyLevel),
        LIGHTING.LIGHT_FALLOFF ** (15 - light.block),
      );
    }
    const heldLevel = CHUNK_LIGHT_UNIFORMS.uHeldLightLevel.value;
    if (heldLevel > 0) {
      const hp = CHUNK_LIGHT_UNIFORMS.uHeldLightPos.value;
      target = Math.max(target, heldLightBrightness(heldLevel, Math.hypot(
        p.x - hp.x, p.y + e.def.height / 2 - hp.y, p.z - hp.z,
      )));
    }
    mob.brightness += (target - mob.brightness) *
      (1 - Math.exp(-MOBS.LIGHT_TINT_RATE * dt));
    const b = mob.brightness;
    for (const material of mob.materials) {
      if (e.hurtTimer > 0) {
        material.color.setRGB(b, b * 0.35, b * 0.35);
      } else if (fuseFrac > 0 &&
        Math.sin(mob.fuse * Math.PI * 2 * MOBS.CREEPER.FLASH_HZ) > 0) {
        material.color.setRGB(1, 1, 1); // the warning blink
      } else if (mob.onFire || e.inLava) {
        const flicker = 0.55 + 0.45 * Math.sin(e.age * 21);
        material.color.setRGB(b, b * (0.35 + 0.25 * flicker), b * 0.15);
      } else {
        material.color.setRGB(b, b, b);
      }
    }
  }

  // --- player combat -------------------------------------------------------

  // Nearest living mob whose box the ray hits within maxDist, or null.
  // (systems/combat.js consumes this for melee clicks and arrow flight.)
  function raycast(origin, dir, maxDist) {
    let best = null;
    let bestT = Infinity;
    for (const mob of mobs) {
      if (mob.entity.dead || mob.entity.removed) continue;
      const t = rayAABB(origin, dir, mob.entity.aabb, maxDist);
      if (t !== null && t < bestT) {
        bestT = t;
        best = mob;
      }
    }
    return best;
  }

  // --- per-frame update ----------------------------------------------------

  function update(dt) {
    if (dt <= 0) return;
    spawner.update(dt);

    const playerPos = player.body.position;
    for (let i = mobs.length - 1; i >= 0; i--) {
      const mob = mobs[i];
      const e = mob.entity;
      if (!e.dead && !e.removed) AI[mob.type.ai](mob, dt);
      e.step(dt);

      // Fire: lava contact and daylight burning share the tick (a mob
      // takes one or the other, lava dominating).
      mob.onFire = daylightBurning(mob);
      if ((e.inLava || mob.onFire) && !e.dead) {
        mob.burnTimer -= dt;
        if (mob.burnTimer <= 0) {
          mob.burnTimer = e.inLava
            ? MOBS.BURN_DAMAGE_TICK_SECONDS
            : MOBS.DAYLIGHT_BURN.TICK_SECONDS;
          e.damage(e.inLava ? MOBS.LAVA_CONTACT_DAMAGE : MOBS.DAYLIGHT_BURN.DAMAGE);
        }
      } else {
        mob.burnTimer = 0;
      }

      // Suffocation (vanilla): a solid block ending up in the head cell —
      // placed by the player, or falling sand settling there — damages the
      // mob until it dies. Without this a head-embedded body would be
      // pinned forever by the sweep's no-shove clamp.
      const ep = e.position;
      const headSolid = !e.dead && blockDef(world.getBlock(
        Math.floor(ep.x),
        Math.floor(ep.y + e.def.height - 0.1),
        Math.floor(ep.z),
      )).solid;
      if (headSolid) {
        mob.suffocateTimer -= dt;
        if (mob.suffocateTimer <= 0) {
          mob.suffocateTimer = MOBS.SUFFOCATION_TICK_SECONDS;
          e.damage(MOBS.SUFFOCATION_DAMAGE);
        }
      } else {
        mob.suffocateTimer = 0;
      }

      e.updateLifecycle(dt, playerPos);
      if (e.removed) {
        if (e.diedFromDamage) dropLoot(mob);
        removeMob(i);
        continue;
      }
      animate(mob, dt);
    }
  }

  return {
    update,
    raycast,
    useOnMob,  // right-click items on mobs (shears -> sheep)
    spawnAt,   // dev/test scaffolding: __mobs.spawnAt(__mobs.types.zombie, x, y, z)
    types: MOB_TYPES,
    mobs,      // read-only by convention (debug/tests)
    get count() {
      return mobs.length;
    },
  };
}
