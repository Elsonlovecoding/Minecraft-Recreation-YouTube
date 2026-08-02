// entities/mobs.js — Phase 12: the mob foundation. The per-mob registry
// (stats + box-model definitions, per ARCHITECTURE.md data tables live
// here), the spawning framework (light/distance/ground checks + caps from
// config MOBS), the pursue AI over entities/pathfinding.js, walking/head
// animation over entities/models.js rigs, the player-attack raycast, drops
// and despawns over entities/entity.js.
//
// This phase ships ONE placeholder mob proving the whole stack — zombie
// stats and skin (SPEC's zombie row), spawns in darkness, paths to the
// player, bites, takes hits and dies. The real mob roster (skeleton bow AI,
// creeper fuse, passive herds...) is the next phase; each new mob is a
// registry entry + an AI state function.

import * as THREE from 'three';
import { MOBS, OVERWORLD, CHUNK, LIGHTING, PLAYER } from '../config.js';
import { BLOCK, blockDef } from '../world/blocks.js';
import { Entity } from './entity.js';
import { findPath, standableAt } from './pathfinding.js';
import { createMobModel } from './models.js';

// ---------------------------------------------------------------------------
// Model definitions (pixel units; the standard entity unwrap — models.js)
// ---------------------------------------------------------------------------

// The classic humanoid rig on a legacy 64x64 sheet (zombie): head, body,
// right arm/leg regions in the top half, left limbs mirrored.
const HUMANOID_MODEL = [
  { name: 'head', texOffs: [0, 0], size: [8, 8, 8], pivot: [0, 24, 0], offset: [-4, 0, -4] },
  { name: 'body', texOffs: [16, 16], size: [8, 12, 4], pivot: [0, 12, 0], offset: [-4, 0, -2] },
  { name: 'rightArm', texOffs: [40, 16], size: [4, 12, 4], pivot: [6, 22, 0], offset: [-2, -10, -2] },
  { name: 'leftArm', texOffs: [40, 16], size: [4, 12, 4], pivot: [-6, 22, 0], offset: [-2, -10, -2], mirror: true },
  { name: 'rightLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [2, 12, 0], offset: [-2, -12, -2] },
  { name: 'leftLeg', texOffs: [0, 16], size: [4, 12, 4], pivot: [-2, 12, 0], offset: [-2, -12, -2], mirror: true },
];

// ---------------------------------------------------------------------------
// Mob registry
// ---------------------------------------------------------------------------

export const MOB_TYPES = {
  // Phase 12's placeholder proving the foundation: zombie stats (SPEC mob
  // table) and the real zombie sheet, pursue-and-bite AI. Real mobs replace
  // this next phase.
  placeholder: {
    name: 'placeholder',
    hostile: true,
    texture: 'assets/entity/zombie_zombie.png',
    textureSize: [64, 64],
    model: HUMANOID_MODEL,
    // Zombie pose: both arms raised straight forward.
    pose: { rightArm: { x: Math.PI / 2 }, leftArm: { x: Math.PI / 2 } },
    width: 0.6,
    height: 1.95,
    clearance: 2,              // standing room in cells (pathfinding)
    maxHealth: 20,             // SPEC zombie
    speed: 2.3,                // blocks/s — the vanilla zombie shamble
    attackDamage: 3,           // SPEC zombie
    drops: [{ item: 'rotten_flesh', count: [0, 2] }],
  },
};

// ---------------------------------------------------------------------------
// Small angle helpers (animation)
// ---------------------------------------------------------------------------

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const easeAngle = (from, to, rate, dt) =>
  from + wrapAngle(to - from) * (1 - Math.exp(-rate * dt));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Ray vs AABB slab test: distance along dir, or null.
function rayAABB(origin, dir, box, maxDist) {
  let tMin = 0;
  let tMax = maxDist;
  for (const [o, d, lo, hi] of [
    [origin.x, dir.x, box.minX, box.maxX],
    [origin.y, dir.y, box.minY, box.maxY],
    [origin.z, dir.z, box.minZ, box.maxZ],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }
  return tMin;
}

// ---------------------------------------------------------------------------
// The mob manager
// ---------------------------------------------------------------------------

// `dayNight` supplies skyDarken (hostile light gate follows the time of
// day); `items` receives death drops; `stats` takes mob melee damage.
export function createMobs({ world, scene, player, stats, items, dayNight }) {
  const mobs = [];
  const getBlock = (x, y, z) => world.getBlock(x, y, z);
  let spawnTimer = 0;
  let attackCooldown = 0; // the player's melee swing cooldown

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
      burnTimer: 0,
      suffocateTimer: 0,
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

  function trySpawnOne(counts) {
    const wantHostile = counts.hostile < MOBS.HOSTILE_CAP && hostileTypes.length > 0;
    const wantPassive = counts.passive < MOBS.PASSIVE_CAP && passiveTypes.length > 0;
    if (!wantHostile && !wantPassive) return false;
    const hostile = wantHostile && (!wantPassive || Math.random() < 0.5);
    const pool = hostile ? hostileTypes : passiveTypes;
    const type = pool[Math.floor(Math.random() * pool.length)];

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

  // --- AI ------------------------------------------------------------------

  function pursue(mob, dt) {
    const e = mob.entity;
    const p = e.position;
    const t = player.body.position;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const horiz = Math.hypot(dx, dz);
    const dist3 = Math.hypot(dx, t.y - p.y, dz);

    if (dist3 > MOBS.AGGRO_RADIUS) {
      e.wishX = 0;
      e.wishZ = 0;
      return;
    }

    // Close enough (or pathless): head straight for the player.
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

    // Bite: close enough on the flat and roughly level with the player.
    mob.meleeTimer = Math.max(0, mob.meleeTimer - dt);
    if (
      mob.meleeTimer === 0 && horiz < MOBS.MELEE_RANGE &&
      Math.abs(t.y - p.y) < MOBS.MELEE_VERTICAL_RANGE &&
      !stats.dead && player.mode !== 'fly'
    ) {
      mob.meleeTimer = MOBS.MELEE_COOLDOWN_SECONDS;
      stats.applyKnockback(dx, dz);
      stats.damage(mob.type.attackDamage);
    }
  }

  // --- animation -----------------------------------------------------------

  function animate(mob, dt) {
    const e = mob.entity;
    const pose = mob.type.pose ?? {};

    // Body yaw eases toward the move direction (forward = -sin/-cos yaw).
    const v = e.velocity;
    if (Math.hypot(v.x, v.z) > MOBS.BODY_TURN_MIN_SPEED && !e.dead) {
      mob.yaw = easeAngle(mob.yaw, Math.atan2(-v.x, -v.z), MOBS.BODY_TURN_RATE, dt);
    }

    // Limb swing rides the actual ground speed.
    const ampTarget = e.onGround || e.inWater
      ? Math.min(1, e.horizontalSpeed / Math.max(0.001, mob.type.speed))
      : 0;
    mob.swingAmp += (ampTarget - mob.swingAmp) *
      (1 - Math.exp(-MOBS.LIMB_SWING_FADE_RATE * dt));
    mob.swingPhase += e.horizontalSpeed * MOBS.LIMB_SWING_CYCLES_PER_BLOCK *
      Math.PI * 2 * dt;
    const swing = Math.sin(mob.swingPhase) * MOBS.LIMB_SWING_MAX * mob.swingAmp;
    if (mob.parts.rightLeg) mob.parts.rightLeg.rotation.x = swing;
    if (mob.parts.leftLeg) mob.parts.leftLeg.rotation.x = -swing;
    // Arms counter-swing on top of their pose (the zombie's stay raised,
    // swaying a little).
    const armBase = { right: pose.rightArm?.x ?? 0, left: pose.leftArm?.x ?? 0 };
    const armSwing = swing * (pose.rightArm ? MOBS.POSED_ARM_SWAY : 1);
    if (mob.parts.rightArm) mob.parts.rightArm.rotation.x = armBase.right - armSwing;
    if (mob.parts.leftArm) mob.parts.leftArm.rotation.x = armBase.left + armSwing;

    // The head tracks the player inside HEAD_TRACK_RANGE, clamped to the
    // neck's limits, and returns to forward otherwise.
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
        (p.y + e.def.height * MOBS.HEAD_HEIGHT_FRACTION);
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

    // Sync the group: position, body yaw, the death fall-over.
    mob.group.position.set(p.x, p.y, p.z);
    mob.group.rotation.y = mob.yaw;
    mob.group.rotation.z = e.dead
      ? (1 - Math.max(0, e.deathTimer) / MOBS.DEATH_SECONDS) * (Math.PI / 2)
      : 0;

    // Tint by local baked light (cave mobs read dark, torch-lit mobs warm)
    // and flash red while hurt. Same falloff curve as the terrain shader.
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
    const hurt = e.hurtTimer > 0;
    mob.material.color.setRGB(b, hurt ? b * 0.35 : b, hurt ? b * 0.35 : b);
  }

  // --- player combat -------------------------------------------------------

  // Nearest living mob whose box the ray hits within maxDist, or null.
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

  // One melee swing at a raycast mob. The cooldown lives here (the
  // attacker's, not the mob's); a cooling swing still consumes the click.
  function attack(mob, damage, dir) {
    if (attackCooldown > 0) return;
    attackCooldown = MOBS.ATTACK_COOLDOWN_SECONDS;
    mob.entity.damage(damage, dir.x, dir.z);
  }

  // --- per-frame update ----------------------------------------------------

  function update(dt) {
    if (dt <= 0) return;
    attackCooldown = Math.max(0, attackCooldown - dt);
    spawnTimer += dt;
    if (spawnTimer >= MOBS.SPAWN_INTERVAL_SECONDS) {
      spawnTimer = 0;
      spawnCycle();
    }

    const playerPos = player.body.position;
    for (let i = mobs.length - 1; i >= 0; i--) {
      const mob = mobs[i];
      const e = mob.entity;
      if (!e.dead) pursue(mob, dt);
      e.step(dt);

      // Burning in lava (mobs take contact damage like the player).
      if (e.inLava && !e.dead) {
        mob.burnTimer -= dt;
        if (mob.burnTimer <= 0) {
          mob.burnTimer = MOBS.BURN_DAMAGE_TICK_SECONDS;
          e.damage(MOBS.LAVA_CONTACT_DAMAGE);
        }
      } else if (!e.inLava) {
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
    attack,
    spawnAt,   // dev/test scaffolding: __mobs.spawnAt(__mobs.types.placeholder, x, y, z)
    types: MOB_TYPES,
    mobs,      // read-only by convention (debug/tests)
    get count() {
      return mobs.length;
    },
  };
}
