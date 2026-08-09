// entities/blaze.js — Phase 17: blaze behaviour, split out of
// entities/mobs.js per the ARCHITECTURE file-size cap (the injection
// pattern entities/passive.js and entities/ghast.js set: the manager
// injects its context and dispatches into the returned functions).
//
// The blaze HOVERS (a `flying` entity, entities/entity.js): floor probes
// hold it a couple of blocks off the ground while idle; with a visible
// player inside ATTACK_RANGE it faces them (mob.yawTarget), climbs to
// float just above their eye line, holds its distance, and fires the SPEC
// burst of three — a CHARGE_SECONDS wind-up (the rod rings visibly spin
// up), then BURST_COUNT small fast fireballs BURST_INTERVAL apart
// (systems/fireballs.js: no crater, a small damage radius), then a
// cooldown. The twelve rods orbit the body in three counter-rotating
// rings, re-positioned every frame from the accumulated spin phase.

import { MOBS, PLAYER } from '../config.js';
import { blockDef, isLava } from '../world/blocks.js';
import { lineOfSight } from '../systems/combat.js';
import { BLAZE_RINGS } from './models.js';

const PX = 1 / 16;

export function createBlazeBehaviour({ world, player, combat, playerTargetable, playerDistance }) {
  const getBlock = (x, y, z) => world.getBlock(x, y, z);

  // Distance from the blaze's feet to the first solid (or lava) cell below,
  // up to the probe limit — the hover height controller's input.
  function floorDistance(p) {
    const B = MOBS.BLAZE;
    const bx = Math.floor(p.x);
    const bz = Math.floor(p.z);
    for (let d = 1; d <= B.HOVER_PROBE_BLOCKS; d++) {
      const id = getBlock(bx, Math.floor(p.y) - d, bz);
      if (blockDef(id).solid || isLava(id)) return d;
    }
    return Infinity;
  }

  function blazeAI(mob, dt) {
    const e = mob.entity;
    const B = MOBS.BLAZE;
    const p = e.position;
    mob.shootCooldown = Math.max(0, mob.shootCooldown - dt);

    // The rod rings spin continuously, faster while charging or bursting
    // (the accumulated phase drives the animation below; accumulating here
    // keeps it dt-driven and frozen with the AI in unloaded chunks).
    const excited = mob.blazeCharge > 0 || mob.blazeBurst > 0;
    mob.blazeSpin += dt * (excited ? B.ROD_SPIN_ATTACK_FACTOR : 1);

    const dist = playerDistance(mob);
    const t = player.body.position;
    const mouth = {
      x: p.x, y: p.y + e.def.height * B.MOUTH_HEIGHT_FRACTION, z: p.z,
    };
    const target = { x: t.x, y: t.y + PLAYER.HEIGHT * 0.6, z: t.z };
    const engaged = playerTargetable() && dist <= B.ATTACK_RANGE &&
      lineOfSight(getBlock, mouth, target);

    // A burst already begun always FINISHES (vanilla): dodging behind
    // cover eats the remaining fireballs on the wall, and the cooldown
    // charges at the end of every burst — so a corner-peeking player faces
    // one full cycle per exposure, never a fresh charge per peek (Phase 17
    // review fix; the first cut aborted the burst, which under knockback
    // LOS flicker collapsed every burst to a single shot).
    if (mob.blazeBurst > 0) {
      mob.blazeTimer -= dt;
      if (mob.blazeTimer <= 0) {
        blazeShoot(mob, mouth, target, dist);
        mob.blazeBurst--;
        mob.blazeTimer = B.BURST_INTERVAL_SECONDS;
        if (mob.blazeBurst === 0) mob.shootCooldown = B.COOLDOWN_SECONDS;
      }
    }

    if (engaged) {
      mob.yawTarget = Math.atan2(-(t.x - p.x), -(t.z - p.z));

      // Hold the preferred ring: drift in when far, back off when crowded.
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const h = Math.hypot(dx, dz) || 1;
      let drift = 0;
      if (dist > B.PREFERRED_RANGE) drift = 1;
      else if (dist < B.CLOSE_RANGE) drift = -1;
      e.wishX = (dx / h) * B.FLY_SPEED * drift;
      e.wishZ = (dz / h) * B.FLY_SPEED * drift;
      // Float just above the player's eye line (the vanilla menace).
      const wantY = t.y + PLAYER.EYE_HEIGHT + B.ATTACK_HOVER_ABOVE;
      e.wishY = clampSpeed((wantY - p.y) * B.VERTICAL_RESPONSE, B.FLY_SPEED);

      // Starting a new cycle needs the cooldown spent and a clear shot:
      // charge the wind-up, then launch the burst above.
      if (mob.blazeBurst === 0 && mob.shootCooldown === 0) {
        mob.blazeCharge += dt;
        if (mob.blazeCharge >= B.CHARGE_SECONDS) {
          mob.blazeCharge = 0;
          mob.blazeBurst = B.BURST_COUNT;
          mob.blazeTimer = 0; // first fireball leaves immediately
        }
      }
      return;
    }

    // Idle: a slow drifting wander (re-rolled on expiry or a wall), the
    // hover controller keeping it a couple of blocks off the floor. Losing
    // the target mid-wind-up lets the charge down (a burst in progress
    // still runs out above).
    mob.yawTarget = null;
    mob.blazeCharge = 0;
    mob.wanderTimer -= dt;
    if (mob.wanderTimer <= 0 || e.horizontalCollision) {
      mob.wanderTimer = B.WANDER_MIN_SECONDS +
        Math.random() * (B.WANDER_MAX_SECONDS - B.WANDER_MIN_SECONDS);
      const a = Math.random() * Math.PI * 2;
      mob.wanderDir = { x: Math.cos(a), y: 0, z: Math.sin(a) };
    }
    const idleSpeed = B.FLY_SPEED * B.IDLE_SPEED_FACTOR;
    e.wishX = mob.wanderDir.x * idleSpeed;
    e.wishZ = mob.wanderDir.z * idleSpeed;
    const floor = floorDistance(p);
    if (floor < B.HOVER_MIN_BLOCKS) e.wishY = idleSpeed;
    else if (floor > B.HOVER_MAX_BLOCKS) e.wishY = -idleSpeed;
    else e.wishY = 0;
  }

  function clampSpeed(v, max) {
    return Math.max(-max, Math.min(max, v));
  }

  function blazeShoot(mob, mouth, target, dist) {
    const B = MOBS.BLAZE;
    const jitter = () => (Math.random() * 2 - 1) * B.INACCURACY;
    const d = {
      x: target.x - mouth.x, y: target.y - mouth.y, z: target.z - mouth.z,
    };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
    // Spawn just outside the blaze's own box so the flight raycast can
    // never clip the shooter.
    const off = mob.entity.def.width / 2 + 0.5;
    combat.spawnFireball({
      from: {
        x: mouth.x + dir.x * off,
        y: mouth.y + dir.y * off,
        z: mouth.z + dir.z * off,
      },
      vel: {
        x: dir.x * B.FIREBALL.SPEED + jitter(),
        y: dir.y * B.FIREBALL.SPEED + jitter(),
        z: dir.z * B.FIREBALL.SPEED + jitter(),
      },
      damage: B.FIREBALL.DAMAGE,
      blockRadius: 0,                       // small fireballs never crater
      damageRadius: B.FIREBALL.DAMAGE_RADIUS,
      size: B.FIREBALL.SIZE,
      fireSeconds: B.FIREBALL.FIRE_SECONDS, // Phase 18: brief burn on a hit
      fromPlayer: false,
    });
    combat.sfx.flame(Math.max(0.2, 1 - dist / B.ATTACK_RANGE));
  }

  // The rod rings orbit (counter-rotating, per-ring speeds), each rod
  // bobbing gently on its own phase. Positions are recomputed from the
  // rest-layout parameters in BLAZE_RINGS plus the accumulated spin.
  function animateBlazeLimbs(mob) {
    const B = MOBS.BLAZE;
    const e = mob.entity;
    for (let r = 0; r < BLAZE_RINGS.length; r++) {
      const ring = BLAZE_RINGS[r];
      const spin = ring.phase + mob.blazeSpin * B.ROD_SPIN[r];
      for (let k = 0; k < 4; k++) {
        const part = mob.parts[`rod${r * 4 + k}`];
        if (!part) continue;
        const angle = spin + (k * Math.PI) / 2;
        const bob = Math.sin(
          e.age * Math.PI * 2 * B.ROD_BOB_HZ + r * 1.7 + k * 0.8,
        ) * B.ROD_BOB_PX;
        part.position.set(
          Math.cos(angle) * ring.radius * PX,
          (ring.y + bob) * PX,
          Math.sin(angle) * ring.radius * PX,
        );
      }
    }
  }

  return { blazeAI, animateBlazeLimbs };
}
