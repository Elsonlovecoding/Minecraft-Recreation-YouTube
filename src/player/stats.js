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

import { PLAYER, STATS, EFFECTS } from '../config.js';
import { BLOCK, isLava } from '../world/blocks.js';
import { findSpawnPosition } from './controller.js';
import { gamemode } from './gamemode.js';
import { particles } from '../render/particles.js';
import { audio } from '../systems/audio.js';

export function createStats({ world, player, inventory, items, onDeath }) {
  let health = PLAYER.MAX_HEALTH;
  let hunger = PLAYER.MAX_HUNGER;
  let saturation = STATS.RESPAWN_SATURATION;
  let exhaustion = 0;
  let dead = false;
  let burnSeconds = 0;   // fire time left (set by lava, cleared by water)
  let poisonSeconds = 0; // hunger-poison time left (rotten flesh, Phase 14)
  // Potion effects (Phase 18, systems/brewing.js): seconds remaining per
  // effect type. Fire resistance suppresses ALL fire/lava damage (the one
  // that matters for the run); strength adds melee damage (combat reads
  // strengthBonus); healing is instant on drink (no entry here).
  const effects = { fire_resistance: 0, strength: 0, regeneration: 0 };
  // Absorption (Phase 22 — the golden apple): extra health points that soak
  // damage BEFORE real health and expire on their own timer. Shown as the
  // yellow heart row above the health bar (ui/hud.js).
  let absorption = 0;
  let absorptionSeconds = 0;
  let regenEffectTimer = 0; // countdown to the next regeneration heal
  let flash = 0;         // damage screen-flash countdown
  let contactTimer = 0;  // countdown until the next contact damage tick
  let fireTimer = STATS.FIRE_TICK_SECONDS;
  let drownTimer = STATS.DROWN_TICK_SECONDS;
  let voidTimer = STATS.VOID_TICK_SECONDS;
  let regenTimer = STATS.REGEN_INTERVAL_SECONDS;
  let starveTimer = STATS.STARVE_TICK_SECONDS;
  let prevX = null;      // last-frame position for movement exhaustion
  let prevZ = null;
  // Computed eagerly: at boot the spawn chunks are already loaded (the
  // player just spawned there), so this is nearly free — computing it
  // lazily on death instead would synchronously regenerate the whole
  // (long-unloaded) spawn area inside one frame.
  // The respawn point. Phase 21: sleeping in a bed moves it (SPEC "respawn
  // at spawn point or bed"), so it is a mutable record rather than a const.
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
  // Creative has no hunger at all, so nothing accrues — which also means a
  // long creative flight can't hand the player an empty bar the moment they
  // switch back to survival.
  function gainExhaustion(amount) {
    if (gamemode.creative) return;
    exhaustion += amount * STATS.EXHAUSTION_SCALE;
  }

  // Entering creative restores the player to full and puts out anything
  // still burning, so switching back to survival starts from a clean state
  // rather than from whatever the last survival hit left behind. Leaving
  // creative changes nothing — the player keeps the full bars.
  gamemode.subscribe((mode) => {
    if (mode !== 'creative') return;
    health = PLAYER.MAX_HEALTH;
    hunger = PLAYER.MAX_HUNGER;
    saturation = STATS.RESPAWN_SATURATION;
    exhaustion = 0;
    burnSeconds = 0;
    poisonSeconds = 0;
    player.body.fallDistance = 0;
    player.body._fallStartY = player.body.position.y;
  });

  function damage(amount) {
    // Phase 25 — creative: the player cannot be hurt and cannot die. This is
    // the SINGLE gate for every damage source in the game (lava, fall,
    // drowning, the void, cactus, mobs, explosions, the dragon's breath),
    // because they all arrive here.
    if (gamemode.creative) return;
    if (amount <= 0 || dead) return;
    // Absorption first (vanilla): the yellow hearts empty before any real
    // health is touched, and whatever they can't cover carries through.
    if (absorption > 0) {
      const soaked = Math.min(absorption, amount);
      absorption -= soaked;
      amount -= soaked;
      if (absorption <= 0) absorptionSeconds = 0;
    }
    flash = STATS.DAMAGE_FLASH_SECONDS;
    const p = player.body.position;
    particles.damage(p.x, p.y + PLAYER.HEIGHT * 0.55, p.z);
    audio.playerHurt();
    if (amount <= 0) return; // fully absorbed — the hit still stings visually
    health = Math.max(0, health - amount);
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
    absorption = 0;
    absorptionSeconds = 0;
    const body = player.body;
    particles.death(body.position.x, body.position.y, body.position.z, PLAYER.HEIGHT);
    audio.death(null, 1, 1);
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
    effects.fire_resistance = 0;
    effects.strength = 0;
    effects.regeneration = 0;
    absorption = 0;
    absorptionSeconds = 0;
    regenEffectTimer = 0;
    flash = 0;
    contactTimer = 0;
    regenTimer = STATS.REGEN_INTERVAL_SECONDS;
    starveTimer = STATS.STARVE_TICK_SECONDS;
    prevX = null;
    prevZ = null;
    dead = false;
  }

  // Eating/drinking (interaction.js calls this when the hold completes).
  // `food` is a { hunger, saturation, poisonChance?, potion? } entry from
  // the inventory registry. Rotten flesh (Phase 14): poisonChance rolls the
  // vanilla Hunger effect — for its duration exhaustion accrues by itself.
  // Potions (Phase 18): `potion` carries the effect the drink applies —
  // fire_resistance/strength timers, or the instant heal.
  function eat(food) {
    hunger = Math.min(PLAYER.MAX_HUNGER, hunger + food.hunger);
    saturation = Math.min(hunger, saturation + food.saturation);
    if (food.poisonChance && Math.random() < food.poisonChance) {
      poisonSeconds = STATS.HUNGER_POISON.SECONDS;
    }
    audio.eat(player.body.position, 0.9);
    // The golden apple (Phase 22): vanilla's Absorption I for 2:00 — 2
    // yellow hearts that soak damage before real health — plus a short
    // Regeneration II burst. Re-eating refreshes both rather than stacking.
    if (food.golden) {
      const G = EFFECTS.GOLDEN_APPLE;
      absorption = Math.max(absorption, G.ABSORPTION_HEALTH);
      absorptionSeconds = Math.max(absorptionSeconds, G.ABSORPTION_SECONDS);
      effects.regeneration = Math.max(effects.regeneration, G.REGENERATION_SECONDS);
      regenEffectTimer = Math.min(regenEffectTimer, G.REGENERATION_INTERVAL);
      audio.levelUp(0.4);
      const p = player.body.position;
      particles.sparkle(p.x, p.y + 1, p.z, 0xffd44a);
      particles.pickup(p.x, p.y + 1, p.z);
    }
    const potion = food.potion;
    if (potion) {
      if (potion.effect === 'fire_resistance') {
        effects.fire_resistance = Math.max(
          effects.fire_resistance, EFFECTS.FIRE_RESISTANCE_SECONDS,
        );
      } else if (potion.effect === 'strength') {
        effects.strength = Math.max(effects.strength, EFFECTS.STRENGTH_SECONDS);
      } else if (potion.effect === 'healing') {
        health = Math.min(PLAYER.MAX_HEALTH, health + EFFECTS.HEALING_AMOUNT);
      }
    }
  }

  // External fire (Phase 18 — a blaze fireball's brief burn; combat routes
  // it here). Never shortens a burn already running; fire resistance still
  // lets the flames show, it only suppresses the damage ticks below.
  function igniteFire(seconds) {
    if (dead || gamemode.creative || player.mode === 'fly') return;
    burnSeconds = Math.max(burnSeconds, seconds);
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
    // Creative is exempt from the whole survival loop, exactly like the F4
    // debug camera: no fall damage, no contact damage, no drowning, no
    // hunger, no regeneration to run. damage() is gated too, so this is
    // belt-and-braces — but it also stops the timers from ticking down
    // pointlessly and stops movement exhaustion accruing across a flight.
    if (dead || gamemode.creative || player.mode === 'fly') {
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

    // --- potion effect timers (Phase 18)
    for (const key of Object.keys(effects)) {
      if (effects[key] > 0) effects[key] = Math.max(0, effects[key] - dt);
    }
    const fireProof = effects.fire_resistance > 0;

    // --- absorption + regeneration (Phase 22 — the golden apple). The
    // yellow hearts run down on their own clock and vanish when it expires;
    // regeneration heals a point every REGENERATION_INTERVAL while it lasts.
    if (absorptionSeconds > 0) {
      absorptionSeconds = Math.max(0, absorptionSeconds - dt);
      if (absorptionSeconds === 0) absorption = 0;
    }
    if (effects.regeneration > 0) {
      regenEffectTimer -= dt;
      if (regenEffectTimer <= 0) {
        regenEffectTimer = EFFECTS.GOLDEN_APPLE.REGENERATION_INTERVAL;
        health = Math.min(PLAYER.MAX_HEALTH, health + 1);
      }
    } else {
      regenEffectTimer = 0;
    }

    // --- contact damage (lava first — it dominates — then cactus). Fire
    // resistance (the run-critical potion) suppresses lava AND fire damage
    // entirely for its duration — swimming the lava sea is the point.
    contactTimer = Math.max(0, contactTimer - dt);
    const inLava = touchesLava();
    if (inLava) burnSeconds = STATS.LAVA_BURN_SECONDS; // (re)ignite
    if (contactTimer === 0) {
      if (inLava) {
        if (!fireProof) damage(STATS.LAVA_DAMAGE);
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

    // --- burning (fire damage-over-time; water puts it out; fire
    // resistance suppresses the ticks while the flames run out)
    if (body.touchingWater) burnSeconds = 0;
    if (burnSeconds > 0) {
      burnSeconds = Math.max(0, burnSeconds - dt);
      fireTimer -= dt;
      if (fireTimer <= 0) {
        fireTimer = STATS.FIRE_TICK_SECONDS;
        if (!fireProof) damage(STATS.FIRE_DAMAGE);
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

    // --- the void (Phase 19): below the world floor, damage until death —
    // the End's island floats over open void (SPEC: "falling into void
    // kills"); bedrock keeps the other dimensions from ever reaching it.
    if (body.position.y < STATS.VOID_DAMAGE_Y) {
      voidTimer -= dt;
      if (voidTimer <= 0) {
        voidTimer = STATS.VOID_TICK_SECONDS;
        damage(STATS.VOID_DAMAGE);
      }
    } else {
      voidTimer = STATS.VOID_TICK_SECONDS;
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
    igniteFire,
    exhaust,
    canEatFood,
    respawn,
    // The save pass (systems/persistence.js): the survival numbers a
    // reload must not reset, plus the bed spawn. Transient timers (burn,
    // poison, potion effects, absorption) deliberately do NOT persist —
    // vanilla-ish behaviour forgives them and a stale burn timer igniting
    // the player on load would read as a bug.
    serialize() {
      return {
        health, hunger, saturation,
        spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
      };
    },
    restore(d) {
      if (!d) return;
      if (Number.isFinite(d.health)) {
        health = Math.min(PLAYER.MAX_HEALTH, Math.max(1, d.health));
      }
      if (Number.isFinite(d.hunger)) {
        hunger = Math.min(PLAYER.MAX_HUNGER, Math.max(0, d.hunger));
      }
      if (Number.isFinite(d.saturation)) saturation = Math.max(0, d.saturation);
      if (d.spawn && Number.isFinite(d.spawn.x)) {
        spawn.x = d.spawn.x;
        spawn.y = d.spawn.y;
        spawn.z = d.spawn.z;
      }
    },
    // Phase 21 — beds. `setSpawnPoint` moves the respawn point; the getter
    // is test/debug scaffolding.
    setSpawnPoint(x, y, z) {
      spawn.x = x;
      spawn.y = y;
      spawn.z = z;
    },
    get spawnPoint() {
      return { x: spawn.x, y: spawn.y, z: spawn.z };
    },
    get health() {
      return health;
    },
    get maxHealth() {
      return PLAYER.MAX_HEALTH;
    },
    // Phase 22 — the golden apple's absorption buffer, in health points
    // (2 per yellow heart). ui/hud.js draws the row; damage() spends it.
    get absorption() {
      return absorption;
    },
    get absorptionSeconds() {
      return absorptionSeconds;
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
    // Potion effects (Phase 18): seconds remaining per type (HUD indicator,
    // tests). Strength's melee bonus is read by systems/combat.js.
    get effects() {
      return { ...effects };
    },
    get strengthBonus() {
      return effects.strength > 0 ? EFFECTS.STRENGTH_BONUS_DAMAGE : 0;
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
