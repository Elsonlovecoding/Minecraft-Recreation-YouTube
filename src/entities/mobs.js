// entities/mobs.js — Phase 13: the hostile roster. The per-mob registry
// (stats + drops from SPEC.md; box-model geometry lives in
// entities/models.js), the spawning framework (light/distance/ground gates
// + caps from config MOBS), the per-mob AI state machines, walk/head
// animation over the models.js rigs, daylight burning, and the
// player-attack raycast. Damage TO the player routes through the injected
// combat system (systems/combat.js) so armour reduction applies; skeleton
// arrows and creeper explosions are combat's machinery too.
//
// The roster (SPEC mob table):
//   zombie    walks at the player, melee bites, burns in daylight
//   skeleton  keeps its distance, shoots arrows with lead, burns in daylight
//   creeper   approaches, hisses, flashes and swells, explodes after 1.5s
//   spider    fast, climbs walls, neutral in daylight unless provoked
// (enderman/blaze/ghast arrive with their dimensions.)

import * as THREE from 'three';
import { MOBS, COMBAT, OVERWORLD, CHUNK, LIGHTING, PLAYER } from '../config.js';
import { BLOCK, blockDef } from '../world/blocks.js';
import { Entity } from './entity.js';
import { findPath, standableAt } from './pathfinding.js';
import {
  createMobModel, HUMANOID_MODEL, SKELETON_MODEL, CREEPER_MODEL,
  SPIDER_MODEL, SPIDER_LEG_POSE,
} from './models.js';
import { rayAABB, lineOfSight } from '../systems/combat.js';

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
  let spawnTimer = 0;

  const hostileTypes = Object.values(MOB_TYPES).filter((t) => t.hostile);
  const passiveTypes = Object.values(MOB_TYPES).filter((t) => !t.hostile);

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
      // skeleton state
      aiming: false,
      aimBlend: 0,
      shootTimer: MOBS.SKELETON.SHOOT_INTERVAL_SECONDS,
      // creeper state
      ignited: false,
      fuse: 0,
    };
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
    mob.material.dispose();
    mobs.splice(index, 1);
  }

  function dropLoot(mob) {
    const p = mob.entity.position;
    for (const drop of mob.type.drops ?? []) {
      if (drop.chance !== undefined && Math.random() >= drop.chance) continue;
      const count = Array.isArray(drop.count)
        ? drop.count[0] + Math.floor(Math.random() * (drop.count[1] - drop.count[0] + 1))
        : drop.count;
      if (count > 0) {
        items.spawn(drop.item, count, { x: p.x, y: p.y + 0.5, z: p.z });
      }
    }
  }

  // --- spawning framework --------------------------------------------------

  function countByCategory() {
    let hostile = 0;
    let passive = 0;
    for (const mob of mobs) {
      if (mob.entity.dead) continue;
      if (mob.type.hostile) hostile++;
      else passive++;
    }
    return { hostile, passive };
  }

  // The effective light for spawn gates: block light holds at night, sky
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

  function trySpawnOne(counts) {
    const wantHostile = counts.hostile < MOBS.HOSTILE_CAP && hostileTypes.length > 0;
    const wantPassive = counts.passive < MOBS.PASSIVE_CAP && passiveTypes.length > 0;
    if (!wantHostile && !wantPassive) return false;
    const hostile = wantHostile && (!wantPassive || Math.random() < 0.5);
    const type = pickWeighted(hostile ? hostileTypes : passiveTypes);

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

    // Distance gate on the real position (never in the player's face,
    // never outside despawn range).
    const cx = x + 0.5;
    const cz = z + 0.5;
    const d = Math.hypot(cx - p.x, y - p.y, cz - p.z);
    if (d < MOBS.SPAWN_MIN_DISTANCE || d > MOBS.DESPAWN_DISTANCE) return false;

    // Light gates (SPEC): hostiles need effective light <= 7 — torches
    // prevent spawns, night surfaces allow them; passives need bright grass.
    // No light data (unmeshed chunk) = no spawn.
    const light = world.getLight(x, y, z);
    if (!light) return false;
    const level = effectiveLight(light);
    if (hostile && level > MOBS.HOSTILE_SPAWN_LIGHT_MAX) return false;
    if (!hostile && level < MOBS.PASSIVE_SPAWN_LIGHT_MIN) return false;

    spawnAt(type, cx, y, cz);
    return true;
  }

  function spawnCycle() {
    const counts = countByCategory();
    for (let i = 0; i < MOBS.SPAWN_ATTEMPTS_PER_CYCLE; i++) {
      if (trySpawnOne(counts)) {
        // Recount so a cycle can't blow past a cap.
        counts.hostile = countByCategory().hostile;
        counts.passive = countByCategory().passive;
      }
    }
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
    mob.shootTimer = Math.max(0, mob.shootTimer - dt);
    if (!playerTargetable() || dist > MOBS.AGGRO_RADIUS) {
      e.wishX = 0;
      e.wishZ = 0;
      mob.aiming = false;
      return;
    }
    const p = e.position;
    const t = player.body.position;
    const eye = { x: p.x, y: p.y + S.EYE_HEIGHT, z: p.z };
    const playerEye = { x: t.x, y: t.y + PLAYER.EYE_HEIGHT, z: t.z };
    const los = lineOfSight(getBlock, eye, playerEye);

    if (dist < S.RETREAT_RANGE) {
      // Too close: back straight away, still shooting.
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
      // In the sweet spot with a clear shot: stand and fire.
      e.wishX = 0;
      e.wishZ = 0;
      mob.aiming = true;
    }

    if (mob.aiming && mob.shootTimer === 0) {
      mob.shootTimer = S.SHOOT_INTERVAL_SECONDS;
      skeletonShoot(mob, eye);
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
  };

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
    if (mob.aimBlend > 0.001) {
      const aimX = Math.PI / 2 + mob.headPitch;
      rightX = rightX * (1 - mob.aimBlend) + aimX * mob.aimBlend;
      leftX = leftX * (1 - mob.aimBlend) + aimX * mob.aimBlend;
    }
    if (mob.parts.rightArm) {
      mob.parts.rightArm.rotation.x = rightX;
      mob.parts.rightArm.rotation.y = -0.1 * mob.aimBlend;
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
    const light = world.getLight(p.x, p.y + e.def.height / 2, p.z);
    let target = 1;
    if (light) {
      const skyLevel = clamp(light.sky - dayNight.skyDarken, 0, 15);
      target = Math.max(
        LIGHTING.LIGHT_FALLOFF ** (15 - skyLevel),
        LIGHTING.LIGHT_FALLOFF ** (15 - light.block),
      );
    }
    mob.brightness += (target - mob.brightness) *
      (1 - Math.exp(-MOBS.LIGHT_TINT_RATE * dt));
    const b = mob.brightness;
    if (e.hurtTimer > 0) {
      mob.material.color.setRGB(b, b * 0.35, b * 0.35);
    } else if (fuseFrac > 0 &&
      Math.sin(mob.fuse * Math.PI * 2 * MOBS.CREEPER.FLASH_HZ) > 0) {
      mob.material.color.setRGB(1, 1, 1); // the warning blink
    } else if (mob.onFire || e.inLava) {
      const flicker = 0.55 + 0.45 * Math.sin(e.age * 21);
      mob.material.color.setRGB(b, b * (0.35 + 0.25 * flicker), b * 0.15);
    } else {
      mob.material.color.setRGB(b, b, b);
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
    spawnTimer += dt;
    if (spawnTimer >= MOBS.SPAWN_INTERVAL_SECONDS) {
      spawnTimer = 0;
      spawnCycle();
    }

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
    spawnAt,   // dev/test scaffolding: __mobs.spawnAt(__mobs.types.zombie, x, y, z)
    types: MOB_TYPES,
    mobs,      // read-only by convention (debug/tests)
    get count() {
      return mobs.length;
    },
  };
}
