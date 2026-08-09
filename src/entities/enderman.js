// entities/enderman.js — Phase 18: enderman behaviour, the injection
// pattern (entities/passive.js / ghast.js / blaze.js — the mob manager
// injects its context and dispatches into the returned functions).
//
// SPEC: 40hp, 7 melee damage, PASSIVE until the player looks directly at
// its head — the vanilla stare check: the camera-forward vector dotted
// with the direction to the enderman's head must beat 1 - SLACK/distance
// (tighter with range), with clear line of sight — then aggressive: a fast
// chase with teleports. It teleports when hit (the vanilla dodge), blinks
// toward a distant target while angry, takes damage from water (and blinks
// out of it), and drops ender pearls (the registry table). While angry it
// wears the vanilla "creepy" pose: the head lifts off the deflated jaw box
// (the model's separate 'jaw' part), revealing the open mouth.

import { MOBS, PLAYER, CHUNK } from '../config.js';
import { BLOCK } from '../world/blocks.js';
import { lineOfSight } from '../systems/combat.js';
import { standableAt } from './pathfinding.js';

const PX = 1 / 16;

export function createEndermanBehaviour({
  world, player, combat, playerTargetable, playerDistance, steerToward, tryMelee,
}) {
  const getBlock = (x, y, z) => world.getBlock(x, y, z);
  const E = () => MOBS.ENDERMAN;

  // The exact camera-forward vector from the controller's yaw/pitch (the
  // YXZ euler the camera itself uses).
  function lookDir() {
    const yaw = player.yaw ?? 0;
    const pitch = player.pitch ?? 0;
    const c = Math.cos(pitch);
    return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
  }

  // Is the player looking directly at this enderman's head right now?
  function staredAt(mob) {
    const cfg = E();
    const e = mob.entity;
    const p = e.position;
    const head = {
      x: p.x,
      y: p.y + e.def.height * (mob.type.headHeightFraction ?? 0.9),
      z: p.z,
    };
    const t = player.body.position;
    const eye = { x: t.x, y: t.y + PLAYER.EYE_HEIGHT, z: t.z };
    const dx = head.x - eye.x;
    const dy = head.y - eye.y;
    const dz = head.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6 || dist > cfg.STARE_RANGE) return false;
    const d = lookDir();
    const dot = (d.x * dx + d.y * dy + d.z * dz) / dist;
    // The vanilla threshold: dead-centre at range, looser up close.
    if (dot <= 1 - cfg.STARE_DOT_SLACK / dist) return false;
    return lineOfSight(getBlock, eye, head);
  }

  // A candidate teleport landing must be dry standing room (never water —
  // water is what an enderman blinks AWAY from).
  function dryStandable(x, y, z, clearance) {
    if (!standableAt(getBlock, x, y, z, clearance)) return false;
    for (let i = 0; i < clearance; i++) {
      if (getBlock(x, y + i, z) === BLOCK.WATER) return false;
    }
    return true;
  }

  // Random blink to a standable column near `around`, between minR and
  // maxR out. Only loaded chunks are considered (the universal rule).
  // Returns true when the enderman landed somewhere.
  function teleportRandom(mob, around, minR, maxR) {
    const cfg = E();
    const e = mob.entity;
    const clearance = mob.type.clearance ?? 3;
    for (let i = 0; i < cfg.TELEPORT_ATTEMPTS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      const x = Math.floor(around.x + Math.cos(a) * r);
      const z = Math.floor(around.z + Math.sin(a) * r);
      if (!world.getChunkIfLoaded(
        Math.floor(x / CHUNK.SIZE), Math.floor(z / CHUNK.SIZE),
      )) {
        continue;
      }
      const yBase = Math.floor(around.y);
      for (let dy = 0; dy <= cfg.TELEPORT_Y_RANGE; dy++) {
        for (const y of dy === 0 ? [yBase] : [yBase + dy, yBase - dy]) {
          if (!dryStandable(x, y, z, clearance)) continue;
          e.position.x = x + 0.5;
          e.position.y = y;
          e.position.z = z + 0.5;
          e.velocity.x = 0;
          e.velocity.y = 0;
          e.velocity.z = 0;
          mob.path = null; // stale A* waypoints point at the old spot
          combat.sfx.warp(Math.max(0.15, 1 - playerDistance(mob) / 24));
          return true;
        }
      }
    }
    return false;
  }

  function endermanAI(mob, dt) {
    const cfg = E();
    const e = mob.entity;
    const p = e.position;
    mob.lastHealth ??= e.health;
    const targetable = playerTargetable();
    const dist = playerDistance(mob);

    // Water damage (SPEC): a tick of damage, then blink somewhere dry.
    if (e.inWater) {
      mob.waterTimer -= dt;
      if (mob.waterTimer <= 0) {
        mob.waterTimer = cfg.WATER_TICK_SECONDS;
        e.damage(cfg.WATER_DAMAGE);
        if (!e.dead) teleportRandom(mob, p, 4, cfg.TELEPORT_RADIUS);
      }
    } else {
      mob.waterTimer = 0;
    }

    // Any hit landed since last frame: the vanilla dodge-blink (and it
    // remembers who did it — provoked also flips on player attacks).
    if (e.health < mob.lastHealth && !e.dead) {
      teleportRandom(mob, p, 8, cfg.TELEPORT_RADIUS);
      if (targetable) mob.angry = true;
    }
    mob.lastHealth = e.health;
    if (mob.provoked && targetable) mob.angry = true;

    // The stare (SPEC: passive until the player looks directly at its
    // head, then aggressive).
    if (targetable && !mob.angry && staredAt(mob)) {
      mob.angry = true;
      combat.sfx.warp(0.8); // the vwoop doubles as the aggro scream
    }
    if (!targetable || dist > cfg.FORGET_RANGE) mob.angry = false;
    mob.creepy = mob.angry && !e.dead;

    if (mob.angry) {
      steerToward(mob, dt);
      tryMelee(mob, dt);
      // A distant target gets blinked to (the vanilla chase teleport).
      mob.chaseTimer -= dt;
      if (dist > cfg.CHASE_TELEPORT_RANGE && mob.chaseTimer <= 0) {
        mob.chaseTimer = cfg.CHASE_TELEPORT_SECONDS * (0.5 + Math.random());
        const t = player.body.position;
        teleportRandom(
          mob, { x: t.x, y: t.y, z: t.z },
          cfg.CHASE_ARRIVE_RADIUS[0], cfg.CHASE_ARRIVE_RADIUS[1],
        );
      }
      return;
    }

    // Passive: amble a leg, pause, repeat (the tall silhouette drifting
    // across the night is the point).
    mob.wanderTimer -= dt;
    if (mob.wanderTimer <= 0 || e.horizontalCollision) {
      const moving = mob.wanderDir.x !== 0 || mob.wanderDir.z !== 0;
      if (moving && !e.horizontalCollision) {
        mob.wanderDir = { x: 0, y: 0, z: 0 }; // pause between legs
        mob.wanderTimer = cfg.IDLE_MIN_SECONDS +
          Math.random() * (cfg.IDLE_MAX_SECONDS - cfg.IDLE_MIN_SECONDS);
      } else {
        const a = Math.random() * Math.PI * 2;
        mob.wanderDir = { x: Math.cos(a), y: 0, z: Math.sin(a) };
        mob.wanderTimer = cfg.WANDER_MIN_SECONDS +
          Math.random() * (cfg.WANDER_MAX_SECONDS - cfg.WANDER_MIN_SECONDS);
      }
    }
    const speed = mob.type.speed * cfg.WANDER_SPEED_FACTOR;
    e.wishX = mob.wanderDir.x * speed;
    e.wishZ = mob.wanderDir.z * speed;
  }

  // The creepy pose, layered over the biped walk animation: the head eases
  // up off the jaw box while angry (revealing the open mouth), and the jaw
  // follows the head-tracking rotation so it never reads detached.
  function animateCreepy(mob, dt) {
    const cfg = E();
    const head = mob.parts.head;
    const jaw = mob.parts.jaw;
    if (!head) return;
    mob.headBaseY ??= head.position.y;
    const target = mob.creepy ? 1 : 0;
    mob.creepyBlend += (target - mob.creepyBlend) *
      (1 - Math.exp(-MOBS.LIMB_SWING_FADE_RATE * dt));
    head.position.y = mob.headBaseY + cfg.CREEPY_HEAD_RAISE_PX * PX * mob.creepyBlend;
    if (jaw) {
      jaw.rotation.y = head.rotation.y;
      jaw.rotation.x = head.rotation.x;
    }
  }

  return { endermanAI, animateCreepy };
}
