// entities/passive.js — Phase 14: the passive herds' behaviour. One wander
// AI serves cow, pig, sheep and chicken: amble a short leg in a random
// direction, idle, amble again — and panic-sprint away from the player for
// a few seconds after taking any hit. Per-type extras ride the same state:
// chickens lay eggs on a timer and fall slowly (wing flapping), sheep carry
// a shearable wool coat that regrows. The mob manager (entities/mobs.js)
// owns the registry and dispatches into these functions; models live in
// entities/models.js.

import { MOBS } from '../config.js';
import { blockDef, isLava } from '../world/blocks.js';

const P = () => MOBS.PASSIVE;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

export function createPassiveBehaviour({ world, player, items }) {
  const getBlock = (x, y, z) => world.getBlock(x, y, z);

  // Lazily attach the wander state the first time a mob thinks.
  function stateOf(mob) {
    let st = mob.passive;
    if (!st) {
      st = mob.passive = {
        mode: 'idle',                 // 'idle' | 'wander' | 'flee'
        timer: rand(0, P().IDLE_MAX_SECONDS),
        dirX: 0,
        dirZ: 0,
        knownHealth: mob.entity.health, // new damage detection -> panic
        eggTimer: mob.type.laysEggs
          ? rand(P().CHICKEN.EGG_MIN_SECONDS, P().CHICKEN.EGG_MAX_SECONDS)
          : 0,
        regrowTimer: 0,               // sheep wool regrowth countdown
      };
    }
    return st;
  }

  // Is the next step along (dirX, dirZ) safe to amble onto? Rejects ledges
  // deeper than MAX_WANDER_DROP and lava in the drop column — a grazing
  // cow must not stroll into a ravine. Panic runs skip this (vanilla
  // animals flee blindly).
  function wanderStepSafe(mob, dirX, dirZ) {
    const p = mob.entity.position;
    const px = Math.floor(p.x + dirX * P().PROBE_AHEAD_BLOCKS);
    const pz = Math.floor(p.z + dirZ * P().PROBE_AHEAD_BLOCKS);
    const feetY = Math.floor(p.y + 0.01);
    for (let dy = 0; dy <= P().MAX_WANDER_DROP; dy++) {
      const id = getBlock(px, feetY - 1 - dy, pz);
      if (isLava(id)) return false;
      if (blockDef(id).solid) return true; // floor within the safe drop
    }
    return false; // bottomless (deeper than the safe drop): turn back
  }

  function startWander(st) {
    const angle = Math.random() * Math.PI * 2;
    st.mode = 'wander';
    st.dirX = Math.cos(angle);
    st.dirZ = Math.sin(angle);
    st.timer = rand(P().WANDER_MIN_SECONDS, P().WANDER_MAX_SECONDS);
  }

  function startIdle(st) {
    st.mode = 'idle';
    st.timer = rand(P().IDLE_MIN_SECONDS, P().IDLE_MAX_SECONDS);
  }

  // The AI state function (mobs.js dispatch, one per frame per mob).
  function passiveAI(mob, dt) {
    const e = mob.entity;
    const st = stateOf(mob);

    // Any new damage panics the animal: sprint away from the player with a
    // little angular jitter so a herd scatters instead of stampeding on one
    // line. (The player is the only damage source that matters here —
    // hostile mobs never target animals.)
    if (e.health < st.knownHealth) {
      st.knownHealth = e.health;
      st.mode = 'flee';
      st.timer = P().FLEE_SECONDS;
      st.fleeJitter = (Math.random() * 2 - 1) * P().FLEE_JITTER;
    }

    st.timer -= dt;
    if (st.mode === 'flee') {
      if (st.timer <= 0) {
        startIdle(st);
      } else {
        const t = player.body.position;
        const dx = e.position.x - t.x;
        const dz = e.position.z - t.z;
        const h = Math.hypot(dx, dz) || 1;
        const base = Math.atan2(dz / h, dx / h) + st.fleeJitter;
        e.wishX = Math.cos(base) * mob.type.speed;
        e.wishZ = Math.sin(base) * mob.type.speed;
      }
    }
    if (st.mode === 'wander') {
      if (st.timer <= 0) {
        startIdle(st);
      } else if (!wanderStepSafe(mob, st.dirX, st.dirZ)) {
        startIdle(st); // reached a ledge or lava: stop, think again later
      } else {
        const speed = mob.type.speed * P().WANDER_SPEED_FACTOR;
        e.wishX = st.dirX * speed;
        e.wishZ = st.dirZ * speed;
      }
    }
    if (st.mode === 'idle') {
      e.wishX = 0;
      e.wishZ = 0;
      if (st.timer <= 0) startWander(st);
    }

    // Chicken extras: the slow fall itself is the entity's per-type fall
    // cap (registry maxFallSpeed — clamped inside the physics step, where
    // it is frame-rate exact); here only the occasional egg.
    if (mob.type.laysEggs && !e.dead) {
      st.eggTimer -= dt;
      if (st.eggTimer <= 0) {
        st.eggTimer = rand(P().CHICKEN.EGG_MIN_SECONDS, P().CHICKEN.EGG_MAX_SECONDS);
        const p = e.position;
        items.spawn('egg', 1, { x: p.x, y: p.y + 0.3, z: p.z });
      }
    }

    // Sheep wool regrowth after a shearing.
    if (mob.sheared) {
      st.regrowTimer -= dt;
      if (st.regrowTimer <= 0) setSheared(mob, false);
    }
  }

  function setSheared(mob, sheared) {
    mob.sheared = sheared;
    for (const pivot of mob.woolPivots ?? []) pivot.visible = !sheared;
  }

  // Right-click with shears on a sheep (mobs.useOnMob): pops 1-3 wool and
  // bares the model until the coat regrows. Returns true when it sheared
  // (the caller wears the shears).
  function shear(mob) {
    if (!mob.type.wool || mob.sheared || mob.entity.dead) return false;
    const st = stateOf(mob);
    setSheared(mob, true);
    st.regrowTimer = rand(P().SHEEP.REGROW_MIN_SECONDS, P().SHEEP.REGROW_MAX_SECONDS);
    const p = mob.entity.position;
    const count = P().SHEEP.SHEAR_WOOL_MIN + Math.floor(
      Math.random() * (P().SHEEP.SHEAR_WOOL_MAX - P().SHEEP.SHEAR_WOOL_MIN + 1),
    );
    items.spawn('white_wool', count, {
      x: p.x, y: p.y + mob.type.height * 0.6, z: p.z,
    });
    return true;
  }

  // --- animation (mobs.js `animate` dispatch) -------------------------------

  // Quadrupeds walk diagonal leg pairs, like the creeper but on tall legs.
  function animateQuadruped(mob, swing) {
    const parts = mob.parts;
    if (parts.rightHindLeg) parts.rightHindLeg.rotation.x = swing;
    if (parts.leftHindLeg) parts.leftHindLeg.rotation.x = -swing;
    if (parts.rightFrontLeg) parts.rightFrontLeg.rotation.x = -swing;
    if (parts.leftFrontLeg) parts.leftFrontLeg.rotation.x = swing;
  }

  // Chickens alternate legs and flap their wings while airborne (the slow
  // fall reads as flapping, exactly the vanilla feel).
  function animateChicken(mob, swing) {
    const parts = mob.parts;
    const e = mob.entity;
    if (parts.rightLeg) parts.rightLeg.rotation.x = swing;
    if (parts.leftLeg) parts.leftLeg.rotation.x = -swing;
    const C = P().CHICKEN;
    const flap = !e.onGround && !e.dead
      ? Math.abs(Math.sin(e.age * Math.PI * 2 * C.WING_FLAP_HZ)) * C.WING_FLAP_AMP
      : 0;
    if (parts.rightWing) parts.rightWing.rotation.z = flap;
    if (parts.leftWing) parts.leftWing.rotation.z = -flap;
  }

  return { passiveAI, animateQuadruped, animateChicken, shear };
}
