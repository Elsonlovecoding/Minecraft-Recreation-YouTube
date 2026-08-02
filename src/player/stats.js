// player/stats.js — Phase 9 slice of the stats system: health, lava contact
// damage, death (drop inventory) and respawn at the spawn point. Hunger,
// fall damage, drowning, cactus contact, armour and the death screen arrive
// with the full stats/combat phase — the damage() entry point is ready for
// them.
//
// Lava contact samples the player's slightly-inset AABB corners against the
// world each frame; while any overlapped cell is lava, damage ticks every
// STATS.DAMAGE_TICK_SECONDS (fly mode is exempt — it's the debug camera).

import { PLAYER, STATS } from '../config.js';
import { BLOCK } from '../world/blocks.js';
import { findSpawnPosition } from './controller.js';

export function createStats({ world, player, inventory, items }) {
  let health = PLAYER.MAX_HEALTH;
  let contactTimer = 0; // countdown until the next contact damage tick
  let flash = 0;        // damage screen-flash countdown
  // Computed eagerly: at boot the spawn chunks are already loaded (the
  // player just spawned there), so this is nearly free — computing it
  // lazily on death instead would synchronously regenerate the whole
  // (long-unloaded) spawn area inside one frame.
  const spawn = findSpawnPosition(world);

  function bodyTouchesLava() {
    const p = player.body.position;
    const inset = STATS.CONTACT_INSET;
    const hw = PLAYER.WIDTH / 2 - inset;
    const y0 = Math.floor(p.y + inset);
    const y1 = Math.floor(p.y + PLAYER.HEIGHT - inset);
    for (let y = y0; y <= y1; y++) {
      for (const dx of [-hw, hw]) {
        for (const dz of [-hw, hw]) {
          const id = world.getBlock(
            Math.floor(p.x + dx), y, Math.floor(p.z + dz),
          );
          if (id === BLOCK.LAVA) return true;
        }
      }
    }
    return false;
  }

  function damage(amount) {
    if (amount <= 0 || health <= 0) return;
    health = Math.max(0, health - amount);
    flash = STATS.DAMAGE_FLASH_SECONDS;
    if (health === 0) die();
  }

  // SPEC death: drop the inventory where you died, respawn at the spawn
  // point with full health. (The death screen is a later phase — for now
  // the respawn is immediate.)
  function die() {
    const p = player.body.position;
    for (const stack of inventory.drainAll()) {
      const angle = Math.random() * Math.PI * 2;
      items.spawn(
        stack.name, stack.count,
        { x: p.x, y: p.y + STATS.DEATH_DROP_Y_OFFSET, z: p.z },
        {
          x: Math.cos(angle) * STATS.DEATH_DROP_SCATTER * Math.random(),
          y: STATS.DEATH_DROP_POP,
          z: Math.sin(angle) * STATS.DEATH_DROP_SCATTER * Math.random(),
        },
        stack.durability ?? undefined,
      );
    }
    const body = player.body;
    body.position.x = spawn.x;
    body.position.y = spawn.y;
    body.position.z = spawn.z;
    body.velocity.x = 0;
    body.velocity.y = 0;
    body.velocity.z = 0;
    body.fallDistance = 0;
    body._fallStartY = spawn.y; // no phantom fall carried across the teleport
    body.breath = body.maxBreath;
    health = PLAYER.MAX_HEALTH;
  }

  function update(dt) {
    flash = Math.max(0, flash - dt);
    contactTimer = Math.max(0, contactTimer - dt);
    if (contactTimer === 0 && player.mode !== 'fly' && bodyTouchesLava()) {
      damage(STATS.LAVA_DAMAGE);
      contactTimer = STATS.DAMAGE_TICK_SECONDS;
    }
  }

  return {
    update,
    damage,
    get health() {
      return health;
    },
    get maxHealth() {
      return PLAYER.MAX_HEALTH;
    },
    // 1 at the moment of damage, easing to 0 (drives the HUD red flash)
    get flashFraction() {
      return STATS.DAMAGE_FLASH_SECONDS > 0 ? flash / STATS.DAMAGE_FLASH_SECONDS : 0;
    },
  };
}
