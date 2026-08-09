// entities/skeleton.js — skeleton behaviour, split out of entities/mobs.js
// in Phase 17 per the ARCHITECTURE file-size cap note mobs.js carried since
// Phase 16 (the injection pattern entities/passive.js, ghast.js and
// blaze.js share: the manager injects its context and dispatches into the
// returned functions). Moved verbatim; the draw/aim ANIMATION stays in
// mobs.js's biped animator — it reads the mob fields this AI writes
// (aiming, drawTime, shootCooldown).
//
// The behaviour (Phases 13-15): keeps its distance — approaches to
// PREFERRED_RANGE, backs away inside RETREAT_RANGE, holds and aims with
// line of sight — and fires on a real draw-and-release cycle: after the
// cooldown an aiming skeleton visibly draws for DRAW_SECONDS, releases the
// arrow at full draw (with lead and a gravity-arc lift, from the bow's own
// world position), then cools down. Losing the aim lets the draw down
// without firing.

import * as THREE from 'three';
import { MOBS, COMBAT, PLAYER } from '../config.js';
import { lineOfSight } from '../systems/combat.js';

// `steerToward` is the manager's shared pursue machinery (A* + waypoints);
// `playerTargetable`/`playerDistance` its shared gates.
export function createSkeletonBehaviour({
  player, combat, getBlock, playerTargetable, playerDistance, steerToward,
}) {
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
  // the gravity arc over the flight time. The arrow leaves from the BOW in
  // the skeleton's hand (Phase 15 — it used to pop out of the eye centre),
  // falling back to the eye until the async bow mesh exists.
  const bowWorldPos = new THREE.Vector3();
  function skeletonShoot(mob, eye) {
    const S = MOBS.SKELETON;
    let from = eye;
    if (mob.bowGroup) {
      // getWorldPosition refreshes the ancestor matrices itself, so this is
      // the bow's exact position under the current draw pose.
      mob.bowGroup.getWorldPosition(bowWorldPos);
      from = { x: bowWorldPos.x, y: bowWorldPos.y, z: bowWorldPos.z };
    }
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

  return { skeletonAI };
}
