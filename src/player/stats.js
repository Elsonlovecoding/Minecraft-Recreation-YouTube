// player/stats.js — Phase 11: the full survival loop.
//   Health   20 (10 hearts on the HUD), restored by natural regeneration.
//   Hunger   20 (10 drumsticks), backed by a hidden vanilla-style saturation
//            buffer. Activity (sprinting, swimming, jumping) and natural
//            regeneration accumulate exhaustion; every
//            STATS.EXHAUSTION_PER_HUNGER of it drains 1 saturation, or 1
//            hunger once the buffer is dry. Eating (player/interaction.js
//            drives the hold-right-click flow, calling eat()) restores both.
//   Regen    +1 health per REGEN_INTERVAL_SECONDS while hunger >= 18.
//   Starving at 0 hunger: STARVE_DAMAGE per tick down to STARVE_FLOOR_HEALTH
//            (5 hearts, Easy difficulty) — hunger alone never kills (SPEC).
//   Damage   lava contact (+ sets the body on fire — water extinguishes),
//            fire ticks after leaving lava, cactus contact (with knockback
//            away from the block), fall damage beyond PLAYER.
//            FALL_DAMAGE_THRESHOLD (consumes body.lastLanding), drowning
//            once the breath meter is empty. damage() is the single entry
//            point — mobs (combat phase) will call it too, with
//            applyKnockback for directional hits. Every hit drives the HUD
//            red flash via flashFraction.
//   Death    close-screens hook (main.js), inventory dropped where you died,
//            the death screen (ui/screens.js) holds until Respawn, then
//            respawn() teleports to the world spawn with everything restored.
// Fly mode (the F4 debug camera) is exempt from all of it.
//
// Contact checks sample the player's AABB against the world: lava with a
// slightly-inset box (must really be in it), cactus with a slightly-inflated
// one (the 1/16-inset cactus box hurts on touch, including standing on top).

import { PLAYER, STATS } from '../config.js';
import { BLOCK, isLava } from '../world/blocks.js';
import { findSpawnPosition } from './controller.js';

export function createStats({ world, player, inventory, items, onDeath }) {
  let health = PLAYER.MAX_HEALTH;
  let hunger = PLAYER.MAX_HUNGER;
  let saturation = STATS.RESPAWN_SATURATION;
  let exhaustion = 0;
  let dead = false;
  let burnSeconds = 0;   // fire time left (set by lava, cleared by water)
  let poisonSeconds = 0; // hunger-poison time left (rotten flesh, Phase 14)
  let flash = 0;         // damage screen-flash countdown
  let contactTimer = 0;  // countdown until the next contact damage tick
  let fireTimer = STATS.FIRE_TICK_SECONDS;
  let drownTimer = STATS.DROWN_TICK_SECONDS;
  let regenTimer = STATS.REGEN_INTERVAL_SECONDS;
  let starveTimer = STATS.STARVE_TICK_SECONDS;
  let prevX = null;      // last-frame position for movement exhaustion
  let prevZ = null;
  // Computed eagerly: at boot the spawn chunks are already loaded (the
  // player just spawned there), so this is nearly free — computing it
  // lazily on death instead would synchronously regenerate the whole
  // (long-unloaded) spawn area inside one frame.
  const spawn = findSpawnPosition(world);

  function bodyTouches(matches, grow) {
    const p = player.body.position;
    const hw = PLAYER.WIDTH / 2 + grow;
    const y0 = Math.floor(p.y - grow);
    const y1 = Math.floor(p.y + PLAYER.HEIGHT + grow);
    for (let y = y0; y <= y1; y++) {
      for (const dx of [-hw, hw]) {
        for (const dz of [-hw, hw]) {
          const x = Math.floor(p.x + dx);
          const z = Math.floor(p.z + dz);
          if (matches(world.getBlock(x, y, z))) return { x, y, z };
        }
      }
    }
    return null;
  }

  // Flowing lava cells burn exactly like the source (Phase 12).
  const touchesLava = () => bodyTouches(isLava, -STATS.CONTACT_INSET);
  const isCactus = (id) => id === BLOCK.CACTUS;
  const touchesCactus = () => bodyTouches(isCactus, STATS.CACTUS_CONTACT_EXPAND);

  // Knockback away from (dirX, dirZ) — normalised here; the vertical pop
  // never cancels an existing upward velocity. Mob hits (combat phase)
  // should call this alongside damage().
  function applyKnockback(dirX, dirZ) {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) return;
    const v = player.body.velocity;
    v.x = (dirX / len) * STATS.KNOCKBACK_HORIZONTAL;
    v.z = (dirZ / len) * STATS.KNOCKBACK_HORIZONTAL;
    v.y = Math.max(v.y, STATS.KNOCKBACK_VERTICAL);
  }

  // Every exhaustion gain routes through here: EXHAUSTION_SCALE (Phase 14)
  // runs the whole hunger system at a fraction of the vanilla drain rate.
  function gainExhaustion(amount) {
    exhaustion += amount * STATS.EXHAUSTION_SCALE;
  }

  function damage(amount) {
    if (amount <= 0 || dead) return;
    health = Math.max(0, health - amount);
    flash = STATS.DAMAGE_FLASH_SECONDS;
    gainExhaustion(STATS.EXHAUST_DAMAGE); // being hurt costs a little food
    if (health === 0) die();
  }

  // SPEC death: drop the inventory where you died, show the death screen
  // (main.js's onDeath closes any open container screen first, so grid and
  // cursor stacks land back in the inventory and drop here too), and hold
  // until respawn() — the Respawn button.
  function die() {
    dead = true;
    burnSeconds = 0;
    poisonSeconds = 0;
    const body = player.body;
    body.velocity.x = 0;
    body.velocity.y = 0;
    body.velocity.z = 0;
    onDeath?.();
    const p = body.position;
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
  }

  // Respawn at the world spawn with everything restored (the death screen's
  // Respawn button lands here via ui/screens.js).
  function respawn() {
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
    hunger = PLAYER.MAX_HUNGER;
    saturation = STATS.RESPAWN_SATURATION;
    exhaustion = 0;
    burnSeconds = 0;
    poisonSeconds = 0;
    flash = 0;
    contactTimer = 0;
    regenTimer = STATS.REGEN_INTERVAL_SECONDS;
    starveTimer = STATS.STARVE_TICK_SECONDS;
    prevX = null;
    prevZ = null;
    dead = false;
  }

  // Eating (interaction.js calls this when the hold-to-eat completes).
  // `food` is a { hunger, saturation, poisonChance? } entry from the
  // inventory registry. Rotten flesh (Phase 14): poisonChance rolls the
  // vanilla Hunger effect — for its duration exhaustion accrues by itself.
  function eat(food) {
    hunger = Math.min(PLAYER.MAX_HUNGER, hunger + food.hunger);
    saturation = Math.min(hunger, saturation + food.saturation);
    if (food.poisonChance && Math.random() < food.poisonChance) {
      poisonSeconds = STATS.HUNGER_POISON.SECONDS;
    }
  }

  // Exhaustion from movement and jumps, measured from the body's actual
  // step results (sprint metres cost the most; plain walking is free, like
  // vanilla — the regen cost is the background drain).
  function trackActivity() {
    const body = player.body;
    const p = body.position;
    if (prevX !== null) {
      const dist = Math.hypot(p.x - prevX, p.z - prevZ);
      if (dist > 0 && dist < STATS.EXHAUST_MAX_STEP_BLOCKS) {
        if (body.sprinting) gainExhaustion(dist * STATS.EXHAUST_SPRINT_PER_BLOCK);
        else if (body.swimming) gainExhaustion(dist * STATS.EXHAUST_SWIM_PER_BLOCK);
      }
    }
    prevX = p.x;
    prevZ = p.z;
    // Only REAL jumps cost (the controller's one-frame signal) — a
    // ground->air heuristic would also bill knockback pops and fluid exit
    // hops as jumps.
    if (body.lastJumped) {
      gainExhaustion(body.sprinting ? STATS.EXHAUST_SPRINT_JUMP : STATS.EXHAUST_JUMP);
    }
  }

  // Spend accumulated exhaustion: saturation buffers hunger (vanilla).
  function settleExhaustion() {
    while (exhaustion >= STATS.EXHAUSTION_PER_HUNGER) {
      exhaustion -= STATS.EXHAUSTION_PER_HUNGER;
      if (saturation > 0) saturation = Math.max(0, saturation - 1);
      else hunger = Math.max(0, hunger - 1);
    }
  }

  function update(dt) {
    // Zero-delta frames must be inert: body.step early-returns on dt <= 0
    // WITHOUT resetting its one-frame lastLanding signal, so consuming it
    // here again would duplicate fall damage.
    if (dt <= 0) return;
    flash = Math.max(0, flash - dt);
    if (dead || player.mode === 'fly') {
      prevX = null; // no movement exhaustion across a fly-mode traversal
      return;
    }
    const body = player.body;

    // --- fall damage: half a heart per block beyond the safe height (SPEC).
    // body.lastLanding is this frame's landing signal (player.update ran
    // earlier in the frame); fluids already suppress it in the controller.
    if (body.lastLanding > PLAYER.FALL_DAMAGE_THRESHOLD) {
      damage(Math.floor(
        (body.lastLanding - PLAYER.FALL_DAMAGE_THRESHOLD) * PLAYER.FALL_DAMAGE_PER_BLOCK,
      ));
    }
    if (dead) return;

    // --- contact damage (lava first — it dominates — then cactus)
    contactTimer = Math.max(0, contactTimer - dt);
    const inLava = touchesLava();
    if (inLava) burnSeconds = STATS.LAVA_BURN_SECONDS; // (re)ignite
    if (contactTimer === 0) {
      if (inLava) {
        damage(STATS.LAVA_DAMAGE);
        contactTimer = STATS.DAMAGE_TICK_SECONDS;
      } else {
        const cactus = touchesCactus();
        if (cactus) {
          // Knockback BEFORE damage: a lethal tick's die() zeroes the
          // velocity so the corpse holds still — knocking back afterwards
          // would launch the dead body under the death screen.
          applyKnockback(
            body.position.x - (cactus.x + 0.5),
            body.position.z - (cactus.z + 0.5),
          );
          damage(STATS.CACTUS_DAMAGE);
          contactTimer = STATS.DAMAGE_TICK_SECONDS;
        }
      }
    }
    if (dead) return;

    // --- burning (fire damage-over-time; water puts it out)
    if (body.touchingWater) burnSeconds = 0;
    if (burnSeconds > 0) {
      burnSeconds = Math.max(0, burnSeconds - dt);
      fireTimer -= dt;
      if (fireTimer <= 0) {
        fireTimer = STATS.FIRE_TICK_SECONDS;
        damage(STATS.FIRE_DAMAGE);
      }
    } else {
      fireTimer = STATS.FIRE_TICK_SECONDS;
    }
    if (dead) return;

    // --- drowning once the controller's breath meter is empty
    if (body.breath <= 0 && body.eyeInWater) {
      drownTimer -= dt;
      if (drownTimer <= 0) {
        drownTimer = STATS.DROWN_TICK_SECONDS;
        damage(STATS.DROWN_DAMAGE);
      }
    } else {
      drownTimer = STATS.DROWN_TICK_SECONDS;
    }
    if (dead) return;

    // --- hunger: activity -> exhaustion -> saturation -> hunger
    trackActivity();
    // Hunger poisoning (rotten flesh): exhaustion accrues on its own for
    // the effect's duration. Applied UNSCALED — the poison is the point,
    // EXHAUSTION_SCALE only slows the ambient drain.
    if (poisonSeconds > 0) {
      poisonSeconds = Math.max(0, poisonSeconds - dt);
      exhaustion += STATS.HUNGER_POISON.EXHAUSTION_PER_SECOND * dt;
    }
    settleExhaustion();

    // --- natural regeneration (costs exhaustion, so healing makes you
    // hungry) and starvation (down to the floor, never death)
    if (hunger >= PLAYER.REGEN_HUNGER_THRESHOLD && health < PLAYER.MAX_HEALTH) {
      regenTimer -= dt;
      if (regenTimer <= 0) {
        regenTimer = STATS.REGEN_INTERVAL_SECONDS;
        health = Math.min(PLAYER.MAX_HEALTH, health + 1);
        gainExhaustion(STATS.REGEN_EXHAUSTION);
      }
    } else {
      regenTimer = STATS.REGEN_INTERVAL_SECONDS;
    }
    if (hunger <= 0 && health > PLAYER.STARVE_FLOOR_HEALTH) {
      starveTimer -= dt;
      if (starveTimer <= 0) {
        starveTimer = STATS.STARVE_TICK_SECONDS;
        damage(Math.min(STATS.STARVE_DAMAGE, health - PLAYER.STARVE_FLOOR_HEALTH));
      }
    } else {
      starveTimer = STATS.STARVE_TICK_SECONDS;
    }
    settleExhaustion(); // regen exhaustion lands the frame it accrues
  }

  // External activity costs (Phase 13: melee swings that land, block
  // breaks). Fly mode and death are exempt like everything else.
  function exhaust(amount) {
    if (dead || player.mode === 'fly') return;
    gainExhaustion(amount);
  }

  // Can THIS food be eaten right now? The golden apple's `always` flag is
  // the one exception to the full-hunger gate (Phase 14).
  function canEatFood(food) {
    return !dead && (hunger < PLAYER.MAX_HUNGER || !!food?.always);
  }

  return {
    update,
    damage,
    applyKnockback,
    eat,
    exhaust,
    canEatFood,
    respawn,
    get health() {
      return health;
    },
    get maxHealth() {
      return PLAYER.MAX_HEALTH;
    },
    get hunger() {
      return hunger;
    },
    get maxHunger() {
      return PLAYER.MAX_HUNGER;
    },
    get saturation() {
      return saturation;
    },
    get exhaustion() {
      return exhaustion;
    },
    get canEat() {
      return !dead && hunger < PLAYER.MAX_HUNGER;
    },
    get burning() {
      return burnSeconds > 0;
    },
    get poisoned() {
      return poisonSeconds > 0;
    },
    get dead() {
      return dead;
    },
    // 1 at the moment of damage, easing to 0 (drives the HUD red flash)
    get flashFraction() {
      return STATS.DAMAGE_FLASH_SECONDS > 0 ? flash / STATS.DAMAGE_FLASH_SECONDS : 0;
    },
  };
}
