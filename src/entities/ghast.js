// entities/ghast.js — Phase 16: ghast behaviour, split out of
// entities/mobs.js per the ARCHITECTURE file-size cap (the pattern
// entities/passive.js set: the manager injects its context and dispatches
// into the returned functions).
//
// The ghast flies on a gravity-free drifting wander (entities/entity.js
// `flying`): a direction held for a few seconds, re-rolled on expiry or a
// wall hit, with vertical probes biasing it away from floors and the lava
// sea below and ceilings above. A player visible inside ATTACK_RANGE gets
// faced (mob.yawTarget — the manager's animate() lets it override the
// velocity-facing rule) and shot at with a slow exploding fireball every
// FIREBALL_COOLDOWN_SECONDS (systems/fireballs.js owns the projectile; a
// melee swing deflects it back). Tentacles wave on offset sine phases.

import { MOBS, PLAYER } from '../config.js';
import { blockDef, isLava } from '../world/blocks.js';
import { lineOfSight } from '../systems/combat.js';

// `playerTargetable`/`playerDistance` are the manager's shared gates
// (alive, not the fly camera); `combat` supplies spawnFireball + the sfx.
export function createGhastBehaviour({ world, player, combat, playerTargetable, playerDistance }) {
  const getBlock = (x, y, z) => world.getBlock(x, y, z);

  function ghastAI(mob, dt) {
    const e = mob.entity;
    const G = MOBS.GHAST;
    const p = e.position;
    mob.shootCooldown = Math.max(0, mob.shootCooldown - dt);

    mob.wanderTimer -= dt;
    if (mob.wanderTimer <= 0 || e.horizontalCollision) {
      mob.wanderTimer = G.WANDER_MIN_SECONDS +
        Math.random() * (G.WANDER_MAX_SECONDS - G.WANDER_MIN_SECONDS);
      const a = Math.random() * Math.PI * 2;
      mob.wanderDir = {
        x: Math.cos(a),
        y: (Math.random() * 2 - 1) * G.VERTICAL_DRIFT,
        z: Math.sin(a),
      };
    }
    // Terrain avoidance: solid or lava under the body pushes the drift up,
    // a solid roof close overhead pushes it down.
    let vertical = mob.wanderDir.y;
    const bx = Math.floor(p.x);
    const bz = Math.floor(p.z);
    for (let d = 1; d <= G.PROBE_BLOCKS; d++) {
      const below = getBlock(bx, Math.floor(p.y) - d, bz);
      if (blockDef(below).solid || isLava(below)) {
        vertical = G.VERTICAL_DRIFT * 2;
        break;
      }
      const above = getBlock(bx, Math.floor(p.y + e.def.height) + d, bz);
      if (blockDef(above).solid) {
        vertical = -G.VERTICAL_DRIFT * 2;
        break;
      }
    }
    e.wishX = mob.wanderDir.x * G.FLY_SPEED;
    e.wishZ = mob.wanderDir.z * G.FLY_SPEED;
    e.wishY = vertical * G.FLY_SPEED;

    // The attack: face and shoot a visible player in range.
    mob.yawTarget = null;
    const dist = playerDistance(mob);
    if (playerTargetable() && dist <= G.ATTACK_RANGE) {
      const t = player.body.position;
      const mouth = {
        x: p.x,
        y: p.y + e.def.height * G.MOUTH_HEIGHT_FRACTION,
        z: p.z,
      };
      const target = { x: t.x, y: t.y + PLAYER.HEIGHT * 0.5, z: t.z };
      if (lineOfSight(getBlock, mouth, target)) {
        mob.yawTarget = Math.atan2(-(t.x - p.x), -(t.z - p.z));
        if (mob.shootCooldown === 0) {
          mob.shootCooldown = G.FIREBALL_COOLDOWN_SECONDS;
          ghastShoot(mob, mouth, target, dist);
        }
      }
    }
  }

  function ghastShoot(mob, mouth, target, dist) {
    const G = MOBS.GHAST;
    const d = {
      x: target.x - mouth.x, y: target.y - mouth.y, z: target.z - mouth.z,
    };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
    // Spawn just outside the ghast's own box so the flight raycast can
    // never clip the shooter.
    const off = mob.entity.def.width / 2 + 1.0;
    combat.spawnFireball({
      from: {
        x: mouth.x + dir.x * off,
        y: mouth.y + dir.y * off,
        z: mouth.z + dir.z * off,
      },
      vel: {
        x: dir.x * G.FIREBALL.SPEED,
        y: dir.y * G.FIREBALL.SPEED,
        z: dir.z * G.FIREBALL.SPEED,
      },
      damage: G.FIREBALL.DAMAGE,
      blockRadius: G.FIREBALL.BLOCK_RADIUS,
      fromPlayer: false,
    });
    combat.sfx.shriek(Math.max(0.15, 1 - dist / G.ATTACK_RANGE));
  }

  // Tentacles wave on offset sine phases, slightly faster while the drift
  // moves (the vanilla dangle).
  function animateGhastLimbs(mob) {
    const e = mob.entity;
    const sway = 0.18 + 0.1 * Math.min(1, e.horizontalSpeed / mob.type.speed);
    for (let i = 0; i < 9; i++) {
      const part = mob.parts[`tentacle${i}`];
      if (!part) continue;
      part.rotation.x = 0.1 + Math.sin(e.age * 1.9 + i * 0.9) * sway;
      part.rotation.z = Math.cos(e.age * 1.6 + i * 1.3) * sway * 0.5;
    }
  }

  return { ghastAI, animateGhastLimbs };
}
