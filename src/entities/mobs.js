// entities/mobs.js — the mob manager. The hostile AI state machines,
// walk/head animation over the models.js rigs, daylight burning, and the
// player-attack raycast. Damage TO the player routes through the injected
// combat system (systems/combat.js) so armour reduction applies; skeleton
// arrows and creeper explosions are combat's machinery too. Splits per the
// ARCHITECTURE cap: natural spawning lives in entities/spawning.js, passive
// behaviour in entities/passive.js, and (Phase 15) the MOB_TYPES registry —
// per-mob stats and drops — in entities/registry.js.
//
// The roster (SPEC mob tables):
//   zombie    walks at the player, melee bites, burns in daylight
//   skeleton  keeps its distance; draws its bow visibly, fires on release
//             (2s cycle), burns in daylight
//   creeper   approaches, hisses, flashes and swells, explodes after 1.5s
//   spider    fast, climbs walls, neutral in daylight unless provoked
//   cow/pig/sheep/chicken  wander on daylight grass, flee when hit, never
//             despawn; sheep shear, chickens lay eggs and fall slowly
//   ghast     Phase 16, Nether only (the dimension def's spawn table):
//             flies on a gravity-free wander, lobs slow exploding
//             fireballs at a visible player; a melee swing on a fireball
//             deflects it back (combat owns the projectile)
//   blaze     Phase 17, fortress spawner blocks only (world/spawners.js):
//             hovers, fires bursts of three small fireballs, drops rods
// (enderman arrives with the End phase.) Phase 17 splits: skeleton AI in
// entities/skeleton.js, blaze in entities/blaze.js (the injection pattern).

import { MOBS, LIGHTING, PLAYER, CHUNK } from '../config.js';
import { Entity } from './entity.js';
import { findPath } from './pathfinding.js';
import { createMobModel, attachOverlayModel, SPIDER_LEG_POSE } from './models.js';
import { MOB_TYPES } from './registry.js';
import { createSpawner } from './spawning.js';
import { createPassiveBehaviour } from './passive.js';
import { createGhastBehaviour } from './ghast.js';
import { createBlazeBehaviour } from './blaze.js';
import { createSkeletonBehaviour } from './skeleton.js';
import { createEndermanBehaviour } from './enderman.js';
import { rayAABB } from '../systems/combat.js';
import { createExtrudedItemMesh } from './items.js';
import { CHUNK_LIGHT_UNIFORMS, heldLightBrightness } from '../render/lighting.js';
import { blockDef } from '../world/blocks.js';
import { particles } from '../render/particles.js';
import { audio } from '../systems/audio.js';

// MOB_TYPES (stats/drops) lives in entities/registry.js as of Phase 15.

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
      shownHealth: type.maxHealth, // last health the hurt feedback reacted to
                                   // (Phase 22 — the edge detector in update)
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
      // ghast state (Phase 16): the drifting wander leg, and a yaw target
      // that overrides the velocity-facing rule while it aims at the player
      wanderTimer: 0,
      wanderDir: { x: 1, y: 0, z: 0 },
      yawTarget: null,
      // blaze state (Phase 17): the burst-of-three cycle and the rod-ring
      // spin phase (entities/blaze.js)
      blazeCharge: 0,
      blazeBurst: 0,
      blazeTimer: 0,
      blazeSpin: 0,
      // enderman state (Phase 18, entities/enderman.js): the stare-aggro
      // flag, the creepy head-lift blend, and the blink timers
      angry: false,
      creepy: false,
      creepyBlend: 0,
      lastHealth: null,
      waterTimer: 0,
      chaseTimer: 0,
      headBaseY: null,
      // passive state (entities/passive.js attaches lazily)
      passive: null,
      sheared: false,
      woolPivots: null,
      bowGroup: null,
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
      // The slab arrives async and its material is the SHARED extruded-item
      // cache entry (the player's held bow and every dropped bow use the
      // same instance). Clone it per mob so the tint loop below can darken
      // it with the rest of the skeleton — without a clone the bow stayed
      // fullbright white on a near-invisible midnight mob, and tinting the
      // shared material would bleed onto the player's own bow.
      // `bow` is declared BEFORE the call: on a cache hit the factory fires
      // onReady synchronously, and a `const` here would still be in its
      // temporal dead zone (the Phase 10 held-tool crash, same shape). The
      // claim is idempotent, so the post-call invocation covers exactly
      // that case and no-ops on the async path.
      let bow;
      const claimBowMaterial = () => {
        const mesh = bow?.children[0];
        if (!mesh?.isMesh || mob.materials.includes(mesh.material)) return;
        mesh.material = mesh.material.clone(); // shares the texture, owns its colour
        mob.materials.push(mesh.material);
      };
      bow = createExtrudedItemMesh('bow', S.BOW_SCALE, claimBowMaterial);
      claimBowMaterial();
      bow.position.set(...S.BOW_OFFSET);
      bow.rotation.set(...S.BOW_TILT);
      parts.leftArm.add(bow);
      mob.bowGroup = bow; // arrows leave from here (Phase 15)
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

  // Phase 16: the spawner reads a per-dimension profile — type pools, caps
  // and the light rule; Phase 19 moved the profile machinery into
  // entities/spawning.js (its natural home, and mobs.js was over the cap).
  // setSpawnProfile is re-exported below (dimensions/dimensions.js applies
  // the def's `spawn` table on every switch).
  const spawner = createSpawner({ world, player, dayNight, mobs, spawnAt });
  const setSpawnProfile = spawner.setSpawnProfile;

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

  // Skeleton behaviour (Phase 17: moved to entities/skeleton.js per the
  // ARCHITECTURE size cap — the injection pattern; the draw/aim animation
  // below still reads the mob fields it writes).
  const skeleton = createSkeletonBehaviour({
    player, combat, getBlock, playerTargetable, playerDistance, steerToward,
  });

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

  // Ghast behaviour (Phase 16) lives in entities/ghast.js per the
  // ARCHITECTURE size cap — the passive.js injection pattern; the blaze
  // (Phase 17) follows it in entities/blaze.js.
  const ghast = createGhastBehaviour({
    world, player, combat, playerTargetable, playerDistance,
  });
  const blaze = createBlazeBehaviour({
    world, player, combat, playerTargetable, playerDistance,
  });
  const enderman = createEndermanBehaviour({
    world, player, combat, playerTargetable, playerDistance,
    steerToward, tryMelee,
  });

  const AI = {
    zombie: zombieAI,
    skeleton: skeleton.skeletonAI,
    creeper: creeperAI,
    spider: spiderAI,
    ghast: ghast.ghastAI,
    blaze: blaze.blazeAI,
    enderman: enderman.endermanAI,
    passive: passive.passiveAI,
  };

  // Right-click on a mob with an item (player/interaction.js routes it
  // through main.js): shears on an unsheared sheep shear it. Returns true
  // when the use consumed the click (the caller wears the shears). A
  // fireball wrapper from combat's crosshair raycast is not a mob — no
  // right-click use (deflection is the left button).
  function useOnMob(mob, itemName) {
    if (mob?.isFireball) return false;
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
    // a little). The skeleton's shooting cycle (Phase 15 — the "no shooting
    // animation" report): the arms stay DOWN through the cooldown and rise
    // into the aim only while the draw itself runs, so every shot reads as
    // raise -> draw over ~1s -> release -> lower, instead of a permanently
    // frozen aim pose whose wind-up was a barely visible 7-degree twitch.
    const aimTarget =
      mob.aiming && mob.shootCooldown === 0 && !mob.entity.dead ? 1 : 0;
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

    // Body yaw eases toward the move direction (forward = -sin/-cos yaw);
    // a set yawTarget (the ghast facing the player it shoots at) wins.
    const v = e.velocity;
    if (mob.yawTarget !== null && !e.dead) {
      mob.yaw = easeAngle(mob.yaw, mob.yawTarget, MOBS.BODY_TURN_RATE, dt);
    } else if (Math.hypot(v.x, v.z) > MOBS.BODY_TURN_MIN_SPEED && !e.dead) {
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
    else if (type.anim === 'ghast') ghast.animateGhastLimbs(mob);
    else if (type.anim === 'blaze') blaze.animateBlazeLimbs(mob);
    else if (type.anim === 'quadruped') passive.animateQuadruped(mob, swing);
    else if (type.anim === 'chicken') passive.animateChicken(mob, swing);
    else if (type.anim === 'enderman') {
      // The biped walk plus the creepy head-lift layer (Phase 18).
      animateBipedLimbs(mob, swing, dt);
      enderman.animateCreepy(mob, dt);
    } else animateBipedLimbs(mob, swing, dt);

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
    // Base model scale (the ghast is authored at 1 block, hitbox 4) times
    // the creeper's pre-blast swell.
    mob.group.scale.setScalar((type.scale ?? 1) * (1 + MOBS.CREEPER.SWELL_SCALE * fuseFrac));

    // Tint by local baked light (cave mobs read dark, torch-lit mobs warm),
    // flash red while hurt, flicker orange while on fire, and blink white
    // while a creeper's fuse runs. Same falloff curve as the terrain shader.
    // Phase 14: the player's held-torch light lifts nearby mobs too — the
    // uniforms main.js writes for the chunk shader are read back here so
    // both stay in exact agreement.
    const light = world.getLight(p.x, p.y + e.def.height / 2, p.z);
    let target = 1;
    if (light) {
      // The dimension ambient floor (Phase 16 — the Nether's constant dim
      // red) lifts the sky term exactly like the chunk shader does.
      const skyLevel = clamp(
        Math.max(light.sky - dayNight.skyDarken, dayNight.ambientLight ?? 0),
        0, 15,
      );
      target = Math.max(
        LIGHTING.LIGHT_FALLOFF ** (15 - skyLevel),
        LIGHTING.LIGHT_FALLOFF ** (15 - light.block),
      );
    }
    // Per-type visibility floor (the ghast's pale bulk never fades out).
    target = Math.max(target, mob.type.minBrightness ?? 0);
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
    // The blaze's wind-up flare (Phase 18 — the visible tell before a
    // volley): the body pulses toward hot orange as the charge fills.
    const chargeFrac = mob.type.ai === 'blaze' && mob.blazeCharge > 0
      ? clamp(mob.blazeCharge / MOBS.BLAZE.CHARGE_SECONDS, 0, 1)
      : 0;
    for (const material of mob.materials) {
      if (e.hurtTimer > 0) {
        material.color.setRGB(b, b * 0.35, b * 0.35);
      } else if (fuseFrac > 0 &&
        Math.sin(mob.fuse * Math.PI * 2 * MOBS.CREEPER.FLASH_HZ) > 0) {
        material.color.setRGB(1, 1, 1); // the warning blink
      } else if (chargeFrac > 0) {
        const pulse = 0.5 + 0.5 *
          Math.sin(e.age * Math.PI * 2 * MOBS.BLAZE.CHARGE_FLASH_HZ);
        const hot = chargeFrac * pulse;
        material.color.setRGB(1, 1 - 0.45 * hot, 1 - 0.85 * hot);
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

  // --- dimension switch (Phase 15) -----------------------------------------

  // Swap the live mob list for another dimension's stored one (the
  // dimensions/dimensions.js manager protocol): stored mobs stay in the
  // scene hidden and completely frozen. The exported `mobs` array keeps
  // its identity. Natural spawning is per dimension — the placeholder
  // Nether spawns nothing until its own mobs arrive next session.
  let naturalSpawning = true;

  function swapDimensionState(stored = []) {
    const prev = mobs.slice();
    for (const m of prev) m.group.visible = false;
    mobs.length = 0;
    for (const m of stored) {
      m.group.visible = true;
      mobs.push(m);
    }
    return prev;
  }

  function setNaturalSpawning(on) {
    naturalSpawning = !!on;
  }

  // --- per-frame update ----------------------------------------------------

  function update(dt) {
    if (dt <= 0) return;
    if (naturalSpawning) spawner.update(dt);

    const playerPos = player.body.position;
    for (let i = mobs.length - 1; i >= 0; i--) {
      const mob = mobs[i];
      const e = mob.entity;
      // Mobs in unloaded chunks freeze ENTIRELY, like dropped items — the
      // physics step already guarded itself, but the AI (wander probes,
      // pathfinding) and the suffocation check below call world.getBlock
      // too, which would synchronously regenerate the far chunk every
      // frame after every streaming unload. Unreachable before Phase 14
      // (hostiles despawn inside the data-keep radius); never-despawning
      // passives made it a recurring travel hitch.
      const ep = e.position;
      const chunkLoaded = !!world.getChunkIfLoaded(
        Math.floor(ep.x / CHUNK.SIZE), Math.floor(ep.z / CHUNK.SIZE),
      );
      if (!e.dead && !e.removed && chunkLoaded) AI[mob.type.ai](mob, dt);
      e.step(dt);

      if (chunkLoaded) {
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
      }

      // Phase 22 feedback: entities/entity.js stays three-free, so the
      // hurt/death particles and sounds are edge-detected here, where the
      // manager already walks every mob. One place covers EVERY damage
      // source — melee, arrows, blasts, burning, suffocation.
      if (e.health < mob.shownHealth) {
        const mid = { x: ep.x, y: ep.y + e.def.height * 0.6, z: ep.z };
        const pitch = Math.max(0.6, Math.min(1.7, 1.7 / e.def.height));
        particles.damage(mid.x, mid.y, mid.z);
        if (e.dead) {
          particles.death(ep.x, ep.y, ep.z, e.def.height);
          audio.death(mid, pitch);
        } else {
          audio.mobHurt(mid, pitch);
        }
      }
      mob.shownHealth = e.health;

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
    swapDimensionState,
    setNaturalSpawning,
    setSpawnProfile, // per-dimension spawn tables (Phase 16)
    spawnAt,   // dev/test scaffolding: __mobs.spawnAt(__mobs.types.zombie, x, y, z)
    types: MOB_TYPES,
    mobs,      // read-only by convention (debug/tests)
    get count() {
      return mobs.length;
    },
  };
}
