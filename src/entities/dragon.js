// entities/dragon.js — Phase 20: the Ender Dragon fight, the game's finale.
//
//   The dragon    a kinematic flyer (no voxel collision, like vanilla)
//                 driven through phases: CIRCLING a ring above the pillars,
//                 STRAFING runs that swoop past the player (wing knockback),
//                 PERCHING on the exit portal fountain (the breath attack,
//                 and the only time melee reaches it). 200 health; only the
//                 head takes full damage, the body takes
//                 DRAGON.BODY_DAMAGE_MULTIPLIER (SPEC). While perched it is
//                 immune to ranged hits (vanilla) — detected by hit
//                 distance, since melee can only land within reach.
//   Crystals      entities/crystals.js — one per pillar; the nearest living
//                 one heals the dragon over a visible beam. Popping the
//                 crystal the dragon is drinking from stings it.
//   Death         glide to the centre, radiating light beams, a white-out
//                 flash — then the exit portal fills with end portal blocks
//                 and the dragon egg appears on the fountain column.
//   Victory       stepping into the active exit portal fires onVictory
//                 (main.js shows the victory screen — the SPEC win).
//
// The whole fight lives under one scene group whose visibility follows
// dimensions.activeKey === 'end'; update() gates on the same key, so the
// fight freezes completely while the player is elsewhere (the dimension
// rule) and its state — crystals popped, dragon health, the open portal —
// survives round trips. The model skeleton (models.js DRAGON_MODEL) is
// driven per frame: neck and tail pivots laid out along curves (the blaze
// rod-ring pattern), jaw/wingtips/lower legs re-parented onto their parent
// parts, wing flap and bank from the flight state. The visual effects —
// healing beam, breath particles, death light show, the egg — live in
// entities/dragon_fx.js (split per the ARCHITECTURE size cap; this module
// decides WHEN, fx owns the meshes).

import * as THREE from 'three';
import { DRAGON, END, PLAYER } from '../config.js';
import { BLOCK } from '../world/blocks.js';
import { createMobModel, DRAGON_MODEL } from './models.js';
import { createCrystals } from './crystals.js';
import { createDragonFx } from './dragon_fx.js';
import { rayAABB, lineOfSight } from '../systems/combat.js';

const PX = 1 / 16;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

const DRAGON_DEF = {
  texture: 'assets/entity/enderdragon_dragon.png',
  textureSize: [256, 256],
  model: DRAGON_MODEL,
};

const NECK = ['neck0', 'neck1', 'neck2', 'neck3'];
const TAIL = ['tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5'];

export function createDragonFight({
  world, scene, player, stats, combat, dimensions, generator, onVictory,
}) {
  const getBlock = (x, y, z) => world.getBlock(x, y, z);
  const fightRoot = new THREE.Group();
  fightRoot.visible = false;
  scene.add(fightRoot);
  const crystals = createCrystals({ root: fightRoot, combat });
  const fx = createDragonFx({ root: fightRoot });

  const centre = {
    x: END.EXIT_PORTAL.X + 0.5,
    z: END.EXIT_PORTAL.Z + 0.5,
  };
  const fountainTop = generator.fountainTop();

  let initialised = false;
  let dragon = null; // the live rig + flight state
  let portalActive = false;
  let victoryLatch = false; // edge trigger on standing in the portal
  let healer = null;        // the crystal currently feeding the dragon

  // --- combat facade (main.js merges this into combat's target raycast) ----

  // Two persistent wrappers — head and body — shaped like a mob for
  // combat.attack (melee) and the arrow flight loop: entity.damage lands
  // the hit, aabb is the exact box the ray met (set at raycast time).
  function makeTarget(kind) {
    const target = {
      isDragon: true,
      provoked: true,
      entity: {
        aabb: null, // written by raycast() just before combat reads it
        hitCenter: null,
        def: { height: 2 },
        get position() {
          return dragon
            ? { x: dragon.pos.x, y: dragon.pos.y - 1, z: dragon.pos.z }
            : { x: 0, y: 0, z: 0 };
        },
        get dead() {
          return !dragon || dragon.state === 'dying' || dragon.state === 'dead';
        },
        get removed() {
          return this.dead;
        },
        damage(amount) {
          return damageDragon(kind, amount, target.entity.hitCenter);
        },
      },
    };
    return target;
  }
  const headTarget = makeTarget('head');
  const bodyTarget = makeTarget('body');

  // The hittable boxes this frame: the head (full damage), three cubes
  // along the body spine, and two tail cubes (all body-rate). Computed
  // from the flight state directly — no matrix reads.
  function hitBoxes() {
    if (!dragon || dragon.state === 'dying' || dragon.state === 'dead') return [];
    const s = DRAGON.SCALE;
    const boxes = [];
    const add = (kind, local, half) => {
      const w = localToWorld(local);
      boxes.push({
        kind,
        center: w,
        aabb: {
          minX: w.x - half, maxX: w.x + half,
          minY: w.y - half, maxY: w.y + half,
          minZ: w.z - half, maxZ: w.z + half,
        },
      });
    };
    add('head', dragon.headLocal, 1.0 * s);
    add('body', { x: 0, y: 0, z: -1.2 }, 1.5 * s);
    add('body', { x: 0, y: 0, z: 0.8 }, 1.5 * s);
    add('body', { x: 0, y: 0, z: 2.6 }, 1.3 * s);
    add('body', dragon.tailLocals[1], 0.7 * s);
    add('body', dragon.tailLocals[4], 0.6 * s);
    return boxes;
  }

  // Nearest dragon part or crystal on the ray as { target, t }, or null.
  // main.js merges this into combat's target raycast. Gated to the End —
  // the fight's boxes must never intercept a swing in another dimension.
  function raycast(origin, dir, maxDist) {
    if (dimensions.activeKey !== 'end') return null;
    let best = null;
    let bestT = Infinity;
    for (const box of hitBoxes()) {
      const t = rayAABB(origin, dir, box.aabb, maxDist);
      if (t !== null && t < bestT) {
        bestT = t;
        best = box;
      }
    }
    const crystalHit = crystals.raycast(origin, dir, maxDist);
    if (crystalHit && (!best || crystalHit.t < bestT)) return crystalHit;
    if (!best) return null;
    const target = best.kind === 'head' ? headTarget : bodyTarget;
    target.entity.aabb = best.aabb;
    // The IMPACT point, not the box centre — the perch immunity check
    // measures the player's distance to it, and a big body box's centre
    // can sit past ARROW_RANGE even when the swing's contact face is
    // within melee reach (review finding: legit melee read as arrows).
    target.entity.hitCenter = {
      x: origin.x + dir.x * bestT,
      y: origin.y + dir.y * bestT,
      z: origin.z + dir.z * bestT,
    };
    return { target, t: bestT };
  }

  function damageDragon(kind, amount, hitCenter) {
    if (!dragon || amount <= 0) return false;
    if (dragon.state === 'dying' || dragon.state === 'dead') return false;
    // Perched = projectile-immune (vanilla). Melee can only land within
    // reach, so a hit from beyond PERCH.ARROW_RANGE was a projectile.
    if (dragon.state === 'perched' && DRAGON.PERCH.ARROW_IMMUNE && hitCenter) {
      const p = player.body.position;
      const d = Math.hypot(
        hitCenter.x - p.x,
        hitCenter.y - (p.y + PLAYER.EYE_HEIGHT),
        hitCenter.z - p.z,
      );
      if (d > DRAGON.PERCH.ARROW_RANGE) {
        combat.sfx.deflect();
        return false;
      }
    }
    const mult = kind === 'head' ? 1 : DRAGON.BODY_DAMAGE_MULTIPLIER;
    const dealt = amount * mult;
    dragon.health = Math.max(0, dragon.health - dealt);
    dragon.hurtTimer = DRAGON.HURT_FLASH_SECONDS;
    if (dragon.state === 'perched') {
      dragon.perchDamage += dealt;
    }
    if (dragon.health <= 0) startDeath();
    return true;
  }

  // --- the rig --------------------------------------------------------------

  // Re-parent a child pivot onto a parent part at a local offset (px) —
  // jaw under head, wingtips on wings, lower legs at the knees.
  function attach(parts, child, parent, offsetPx) {
    const c = parts[child];
    parts[parent].add(c);
    c.position.set(offsetPx[0] * PX, offsetPx[1] * PX, offsetPx[2] * PX);
  }

  function spawnDragon() {
    const { group, parts, material } = createMobModel(DRAGON_DEF);
    // Only the wing membranes need to render both ways (vanilla draws the
    // dragon no-cull); a DoubleSide clone on the four wing parts keeps the
    // big body meshes front-face only — half the fill of the largest
    // object on screen (review finding).
    const wingMaterial = material.clone();
    wingMaterial.side = THREE.DoubleSide;
    for (const name of ['wingR', 'wingtipR', 'wingL', 'wingtipL']) {
      parts[name].children[0].material = wingMaterial;
    }
    group.rotation.order = 'YXZ';
    group.scale.setScalar(DRAGON.SCALE);
    fightRoot.add(group);
    attach(parts, 'jaw', 'head', [0, -2, -8]);
    attach(parts, 'wingtipR', 'wingR', [56, 0, 0]);
    attach(parts, 'wingtipL', 'wingL', [-56, 0, 0]);
    attach(parts, 'frontLowerR', 'frontUpperR', [0, -20, 0]);
    attach(parts, 'frontLowerL', 'frontUpperL', [0, -20, 0]);
    attach(parts, 'rearLowerR', 'rearUpperR', [0, -26, 0]);
    attach(parts, 'rearLowerL', 'rearUpperL', [0, -26, 0]);
    dragon = {
      group,
      parts,
      material,
      materials: [material, wingMaterial], // tinted together
      breathAim: { x: 0, y: 0, z: -1 },    // latched per breath burst
      pos: {
        x: centre.x + DRAGON.CIRCLE.RADIUS,
        y: END.ISLAND_TOP_Y + DRAGON.CIRCLE.HEIGHT_MAX,
        z: centre.z,
      },
      yaw: Math.PI,
      pitch: 0,
      bank: 0,
      vy: 0,
      speed: DRAGON.CIRCLE.SPEED,
      health: DRAGON.HEALTH,
      hurtTimer: 0,
      age: 0,
      flapPhase: Math.random() * Math.PI * 2,
      state: 'circle',
      stateTimer: 0,
      circleAngle: 0,
      circleDir: 1,
      circleHeight: END.ISLAND_TOP_Y + DRAGON.CIRCLE.HEIGHT_MAX,
      strafeAim: null,
      perchDamage: 0,
      wingHitCooldown: 0,
      breathTimer: DRAGON.BREATH.COOLDOWN_SECONDS,
      breathing: 0,
      breathTick: 0,
      deathTimer: 0,
      headLocal: { x: 0, y: 0.8, z: -3.4 },
      tailLocals: TAIL.map((_, k) => ({ x: 0, y: 0.3, z: 3 + 0.55 * (k + 1) })),
    };
  }

  // Full YXZ orientation (yaw, pitch, bank) — the group's exact transform,
  // so hitboxes and the breath mouth track the RENDERED skeleton even in a
  // banked dive (the review's render/hitbox divergence finding: yaw-only
  // maths left the head box ~1.8 blocks off the visible head at strafe
  // pitch, so aimed shots missed the model).
  const localToWorld = (l) => {
    const s = DRAGON.SCALE;
    const d = dragon;
    const cy = Math.cos(d.yaw);
    const sy = Math.sin(d.yaw);
    const cp = Math.cos(d.pitch);
    const sp = Math.sin(d.pitch);
    const cb = Math.cos(d.bank);
    const sb = Math.sin(d.bank);
    // Rz(bank), then Rx(pitch), then Ry(yaw) — three.js YXZ euler order.
    const x1 = l.x * cb - l.y * sb;
    const y1 = l.x * sb + l.y * cb;
    const y2 = y1 * cp - l.z * sp;
    const z2 = y1 * sp + l.z * cp;
    return {
      x: d.pos.x + (x1 * cy + z2 * sy) * s,
      y: d.pos.y + y2 * s,
      z: d.pos.z + (-x1 * sy + z2 * cy) * s,
    };
  };

  const worldToLocal = (w) => {
    const s = DRAGON.SCALE;
    const d = dragon;
    const cy = Math.cos(d.yaw);
    const sy = Math.sin(d.yaw);
    const cp = Math.cos(d.pitch);
    const sp = Math.sin(d.pitch);
    const cb = Math.cos(d.bank);
    const sb = Math.sin(d.bank);
    const rx = w.x - d.pos.x;
    const ry = w.y - d.pos.y;
    const rz = w.z - d.pos.z;
    // Inverse: Ry(-yaw), then Rx(-pitch), then Rz(-bank).
    const x1 = rx * cy - rz * sy;
    const z1 = rx * sy + rz * cy;
    const y2 = ry * cp + z1 * sp;
    const z2 = -ry * sp + z1 * cp;
    return {
      x: (x1 * cb + y2 * sb) / s,
      y: (-x1 * sb + y2 * cb) / s,
      z: z2 / s,
    };
  };

  // --- flight ---------------------------------------------------------------

  const playerTargetable = () => !stats.dead && player.mode !== 'fly';
  const playerEye = () => {
    const p = player.body.position;
    return { x: p.x, y: p.y + PLAYER.EYE_HEIGHT, z: p.z };
  };

  // Steer the heading toward a target point and advance. Returns the
  // signed turn rate (rad/s) for banking.
  function flyToward(target, speed, dt) {
    const desired = Math.atan2(
      -(target.x - dragon.pos.x), -(target.z - dragon.pos.z),
    );
    const maxTurn = DRAGON.TURN_RATE * dt;
    const turn = clamp(wrapAngle(desired - dragon.yaw), -maxTurn, maxTurn);
    dragon.yaw = wrapAngle(dragon.yaw + turn);
    dragon.pos.x += -Math.sin(dragon.yaw) * speed * dt;
    dragon.pos.z += -Math.cos(dragon.yaw) * speed * dt;
    const wantVy = clamp((target.y - dragon.pos.y) * 1.2, -speed * 0.7, speed * 0.7);
    dragon.vy += (wantVy - dragon.vy) * ease(2.5, dt);
    dragon.pos.y += dragon.vy * dt;
    dragon.speed = speed;
    return dt > 0 ? turn / dt : 0;
  }

  function startCircleLeg() {
    const C = DRAGON.CIRCLE;
    dragon.state = 'circle';
    dragon.stateTimer = 0;
    dragon.circleDir = Math.random() < 0.5 ? 1 : -1;
    dragon.circleHeight = END.ISLAND_TOP_Y + C.HEIGHT_MIN +
      Math.random() * (C.HEIGHT_MAX - C.HEIGHT_MIN);
    dragon.circleLeg = C.LEG_MIN_SECONDS +
      Math.random() * (C.LEG_MAX_SECONDS - C.LEG_MIN_SECONDS);
  }

  function pickNextLeg() {
    const C = DRAGON.CIRCLE;
    const roll = Math.random();
    if (playerTargetable() && roll < C.STRAFE_CHANCE) {
      const p = player.body.position;
      const dx = p.x - dragon.pos.x;
      const dz = p.z - dragon.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      dragon.strafeAim = {
        x: p.x + (dx / d) * DRAGON.STRAFE.OVERSHOOT,
        y: p.y + DRAGON.STRAFE.PASS_HEIGHT,
        z: p.z + (dz / d) * DRAGON.STRAFE.OVERSHOOT,
      };
      dragon.state = 'strafe';
      dragon.stateTimer = 0;
      combat.sfx.shriek(0.7);
      return;
    }
    if (roll < C.STRAFE_CHANCE + C.PERCH_CHANCE) {
      dragon.state = 'perchApproach';
      dragon.stateTimer = 0;
      return;
    }
    startCircleLeg();
  }

  const perchSeat = () => ({
    x: centre.x,
    y: END.ISLAND_TOP_Y + 1 + DRAGON.PERCH.BODY_HEIGHT,
    z: centre.z,
  });

  function updateFlight(dt) {
    const d = dragon;
    d.stateTimer += dt;
    let turnRate = 0;

    if (d.state === 'circle') {
      const C = DRAGON.CIRCLE;
      d.circleAngle = Math.atan2(d.pos.z - centre.z, d.pos.x - centre.x);
      const lead = d.circleAngle + d.circleDir * 0.5;
      turnRate = flyToward({
        x: centre.x + Math.cos(lead) * C.RADIUS,
        y: d.circleHeight,
        z: centre.z + Math.sin(lead) * C.RADIUS,
      }, C.SPEED, dt);
      if (d.stateTimer >= (d.circleLeg ?? C.LEG_MIN_SECONDS)) pickNextLeg();
    } else if (d.state === 'strafe') {
      const S = DRAGON.STRAFE;
      turnRate = flyToward(d.strafeAim, S.SPEED, dt);
      const past = Math.hypot(
        d.strafeAim.x - d.pos.x, d.strafeAim.z - d.pos.z,
      ) < 5;
      const p = player.body.position;
      const away = Math.hypot(p.x - d.pos.x, p.z - d.pos.z) > S.BREAK_OFF_DISTANCE &&
        d.stateTimer > 2;
      if (past || away || d.stateTimer > S.MAX_SECONDS) startCircleLeg();
    } else if (d.state === 'perchApproach') {
      const seat = perchSeat();
      const dist = Math.hypot(
        seat.x - d.pos.x, seat.y - d.pos.y, seat.z - d.pos.z,
      );
      // Swing wide first, then descend onto the seat.
      const target = dist > 14
        ? { x: seat.x, y: seat.y + 8, z: seat.z }
        : seat;
      turnRate = flyToward(target, DRAGON.PERCH.APPROACH_SPEED, dt);
      if (dist < DRAGON.PERCH.SETTLE_DISTANCE || d.stateTimer > 14) {
        d.state = 'perched';
        d.stateTimer = 0;
        d.perchDamage = 0;
        d.perchFor = DRAGON.PERCH.MIN_SECONDS + Math.random() *
          (DRAGON.PERCH.MAX_SECONDS - DRAGON.PERCH.MIN_SECONDS);
        d.pos.x = seat.x;
        d.pos.y = seat.y;
        d.pos.z = seat.z;
        d.vy = 0;
        d.speed = 0;
        d.breathTimer = 1.2; // a beat, then the first breath
        combat.sfx.shriek(0.5);
      }
    } else if (d.state === 'perched') {
      d.speed = 0;
      d.bank *= Math.exp(-3 * dt);
      // Face the player.
      if (playerTargetable()) {
        const p = player.body.position;
        const want = Math.atan2(-(p.x - d.pos.x), -(p.z - d.pos.z));
        d.yaw = wrapAngle(d.yaw + wrapAngle(want - d.yaw) * ease(2.2, dt));
      }
      updateBreath(dt);
      if (d.stateTimer > d.perchFor || d.perchDamage >= DRAGON.PERCH.LEAVE_DAMAGE) {
        d.state = 'takeoff';
        d.stateTimer = 0;
        d.breathing = 0;
        combat.sfx.shriek(0.6);
      }
    } else if (d.state === 'takeoff') {
      turnRate = flyToward({
        x: centre.x + Math.cos(d.yaw) * DRAGON.CIRCLE.RADIUS,
        y: END.ISLAND_TOP_Y + DRAGON.CIRCLE.HEIGHT_MIN + 6,
        z: centre.z + Math.sin(d.yaw) * DRAGON.CIRCLE.RADIUS,
      }, DRAGON.CIRCLE.SPEED * 0.8, dt);
      if (d.stateTimer > 2.5) pickNextLeg();
    }

    // Bank into turns; pitch with the climb.
    const bankTarget = clamp(-turnRate * DRAGON.BANK_FACTOR, -0.7, 0.7);
    d.bank += (bankTarget - d.bank) * ease(DRAGON.BANK_RATE, dt);
    const hspeed = d.state === 'perched' ? 0 : d.speed;
    const pitchTarget = hspeed > 0.1
      ? clamp(Math.atan2(d.vy, hspeed) * 0.7, -0.55, 0.55)
      : 0;
    d.pitch += (pitchTarget - d.pitch) * ease(3, dt);

    // Wing knockback: a fast pass that clips the player shoves them hard.
    d.wingHitCooldown = Math.max(0, d.wingHitCooldown - dt);
    if (
      d.state !== 'perched' && hspeed >= DRAGON.WING.MIN_SPEED &&
      d.wingHitCooldown === 0 && playerTargetable()
    ) {
      const p = player.body.position;
      const dist = Math.hypot(
        p.x - d.pos.x, (p.y + 0.9) - d.pos.y, p.z - d.pos.z,
      );
      if (dist < DRAGON.WING.RANGE * DRAGON.SCALE) {
        d.wingHitCooldown = DRAGON.WING.COOLDOWN_SECONDS;
        combat.damagePlayer(DRAGON.WING.DAMAGE, p.x - d.pos.x, p.z - d.pos.z);
      }
    }
  }

  // --- the breath attack (perch weapon) --------------------------------------

  function updateBreath(dt) {
    const B = DRAGON.BREATH;
    const d = dragon;
    if (d.breathing > 0) {
      d.breathing -= dt;
      d.breathTick -= dt;
      const eye = playerEye();
      const mouth = localToWorld(d.headLocal);
      // The stream pours along the aim LATCHED at burst start — sprinting
      // sideways out of the cone is the dodge (CONE_DOT, ~28°; the review
      // caught the gate documented but unwired: a re-aimed-every-frame
      // breath was undodgeable inside its range).
      fx.emitBreath(mouth, d.breathAim, dt);
      const dx = eye.x - mouth.x;
      const dy = eye.y - mouth.y;
      const dz = eye.z - mouth.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const inCone = (dx * d.breathAim.x + dy * d.breathAim.y +
        dz * d.breathAim.z) / dist >= B.CONE_DOT;
      if (
        d.breathTick <= 0 && playerTargetable() && dist < B.RANGE &&
        inCone && lineOfSight(getBlock, mouth, eye)
      ) {
        d.breathTick = B.TICK_SECONDS;
        combat.damagePlayer(B.DAMAGE, dx, dz);
      }
      if (d.breathing <= 0) d.breathTimer = B.COOLDOWN_SECONDS;
    } else {
      d.breathTimer -= dt;
      const eye = playerEye();
      const dist = Math.hypot(
        eye.x - d.pos.x, eye.y - d.pos.y, eye.z - d.pos.z,
      );
      if (d.breathTimer <= 0 && playerTargetable() && dist < B.RANGE + 4) {
        d.breathing = B.BURST_SECONDS;
        d.breathTick = 0.3; // the cloud arrives before the first tick
        // Aim at the player's eye as the burst begins, then hold it.
        const mouth = localToWorld(d.headLocal);
        const ax = eye.x - mouth.x;
        const ay = eye.y - mouth.y;
        const az = eye.z - mouth.z;
        const len = Math.hypot(ax, ay, az) || 1;
        d.breathAim = { x: ax / len, y: ay / len, z: az / len };
        combat.sfx.flame(0.8);
      }
    }
  }

  // --- crystal healing -------------------------------------------------------

  function updateHealing(dt) {
    const d = dragon;
    if (!d || d.state === 'dying' || d.state === 'dead') {
      fx.updateHealBeam(null);
      healer = null;
      return;
    }
    const previous = healer;
    healer = crystals.nearestLiving(d.pos, DRAGON.HEAL.RANGE);
    // Losing the crystal it was drinking from stings (vanilla feedback).
    if (previous && !previous.alive) {
      d.health = Math.max(0, d.health - DRAGON.HEAL.CRYSTAL_POP_DAMAGE);
      d.hurtTimer = DRAGON.HURT_FLASH_SECONDS;
      if (d.health <= 0) {
        startDeath();
        fx.updateHealBeam(null);
        return;
      }
    }
    if (!healer) {
      fx.updateHealBeam(null);
      return;
    }
    d.health = Math.min(DRAGON.HEALTH, d.health + DRAGON.HEAL.PER_SECOND * dt);
    fx.updateHealBeam(
      { x: healer.x, y: healer.centerY() + 0.6, z: healer.z },
      { x: d.pos.x, y: d.pos.y, z: d.pos.z },
    );
  }

  // --- death ----------------------------------------------------------------

  function startDeath() {
    const d = dragon;
    if (!d || d.state === 'dying' || d.state === 'dead') return;
    d.state = 'dying';
    d.deathTimer = 0;
    d.breathing = 0;
    fx.updateHealBeam(null);
    combat.sfx.shriek(1.0);
    fx.startDeathShow();
  }

  function updateDeath(dt) {
    const d = dragon;
    const D = DRAGON.DEATH;
    d.deathTimer += dt;
    // Glide to a hover above the fountain, nose lifting, slow spin; the
    // radiating light show and terminal flash grow in dragon_fx.
    const target = {
      x: centre.x,
      y: END.ISLAND_TOP_Y + D.RISE_HEIGHT,
      z: centre.z,
    };
    const k = ease(1.1, dt);
    d.pos.x += (target.x - d.pos.x) * k;
    d.pos.y += (target.y - d.pos.y) * k;
    d.pos.z += (target.z - d.pos.z) * k;
    d.yaw = wrapAngle(d.yaw + dt * 0.5);
    d.pitch += (0.35 - d.pitch) * ease(1.5, dt);
    d.bank *= Math.exp(-2 * dt);
    fx.updateDeathShow(d.pos, d.deathTimer / D.SECONDS, dt);
    if (d.deathTimer >= D.SECONDS) finishDeath();
  }

  function finishDeath() {
    const d = dragon;
    d.state = 'dead';
    d.group.removeFromParent();
    for (const material of d.materials) material.dispose();
    fx.endDeathShow();
    fx.hideBreath();
    fx.updateHealBeam(null);
    combat.sfx.explosion(1.0);
    activatePortal();
    // The egg lands on the fountain column (a decorative trophy — this
    // game has no XP or egg item, documented deviation).
    fx.spawnEgg({
      x: fountainTop.x + 0.5, y: fountainTop.y + 1, z: fountainTop.z + 0.5,
    });
  }

  // The win condition's doorway: the well fills with end portal blocks.
  // Only ever called while the End is the active dimension (the fight
  // gates), so setBlock writes the right store.
  function activatePortal() {
    portalActive = true;
    for (const c of generator.exitPortalCells()) {
      world.setBlock(c.x, c.y, c.z, BLOCK.END_PORTAL);
    }
  }

  // --- the skeleton, per frame ------------------------------------------------

  // Lay pivots along a quadratic bezier from `from` to `to` (local block
  // units), each oriented along the tangent; returns the end tangent.
  function layoutChain(names, from, to, sag, swayAmp, swayPhase) {
    const d = dragon;
    const cx = (from.x + to.x) / 2;
    const cy = (from.y + to.y) / 2 + sag;
    const cz = (from.z + to.z) / 2;
    let tangent = null;
    for (let k = 0; k < names.length; k++) {
      const t = (k + 1) / (names.length + 1);
      const u = 1 - t;
      const sway = swayAmp * Math.sin(swayPhase - k * 0.85) * t;
      const px = u * u * from.x + 2 * u * t * cx + t * t * to.x + sway;
      const py = u * u * from.y + 2 * u * t * cy + t * t * to.y;
      const pz = u * u * from.z + 2 * u * t * cz + t * t * to.z;
      const tx = 2 * u * (cx - from.x) + 2 * t * (to.x - cx);
      const ty = 2 * u * (cy - from.y) + 2 * t * (to.y - cy);
      const tz = 2 * u * (cz - from.z) + 2 * t * (to.z - cz);
      const part = d.parts[names[k]];
      part.position.set(px, py, pz);
      const horiz = Math.hypot(tx, tz) || 1e-6;
      // Chains lay along the walk direction: the neck runs -z (tangent
      // agrees with model forward), the tail runs +z (flip so the boxes
      // don't render backwards).
      const forward = tz < 0 ? 1 : -1;
      part.rotation.y = Math.atan2(-tx * forward, -tz * forward);
      part.rotation.x = Math.atan2(ty * forward, horiz);
      tangent = { x: tx, y: ty, z: tz };
    }
    return tangent;
  }

  function animate(dt) {
    const d = dragon;
    d.age += dt;
    d.hurtTimer = Math.max(0, d.hurtTimer - dt);
    const perched = d.state === 'perched';
    const dying = d.state === 'dying';

    // Wings: flap rate and amplitude by state.
    const flapHz = dying ? 0.5 : perched ? 0.35 : d.state === 'strafe' ? 1.5 : 1.0;
    d.flapPhase += dt * flapHz * Math.PI * 2;
    const rest = perched ? 1.05 : 0.22;
    const amp = perched ? 0.06 : dying ? 0.3 : 0.5;
    const flap = rest + Math.sin(d.flapPhase) * amp;
    const tipFold = perched
      ? -1.9
      : Math.sin(d.flapPhase - 0.7) * 0.75;
    d.parts.wingR.rotation.z = flap;
    d.parts.wingL.rotation.z = -flap;
    d.parts.wingtipR.rotation.z = tipFold;
    d.parts.wingtipL.rotation.z = -tipFold;

    // Legs: trail in flight, plant while perched.
    const upperX = perched ? -0.1 : -0.75;
    const lowerX = perched ? 0.15 : 1.0;
    for (const side of ['R', 'L']) {
      d.parts[`frontUpper${side}`].rotation.x = upperX;
      d.parts[`frontLower${side}`].rotation.x = lowerX;
      d.parts[`rearUpper${side}`].rotation.x = upperX * 0.8;
      d.parts[`rearLower${side}`].rotation.x = lowerX * 0.9;
    }

    // Neck + head: cruise pose in flight, craned at the player while
    // perched (or lifted skyward while dying).
    let headBase;
    if (dying) {
      headBase = { x: 0, y: 1.9, z: -2.6 };
    } else if (perched && playerTargetable()) {
      const local = worldToLocal(playerEye());
      const len = Math.hypot(local.x, local.y, local.z) || 1;
      const reach = 3.3;
      headBase = {
        x: clamp((local.x / len) * reach, -2, 2),
        y: clamp((local.y / len) * reach, -2.3, 1.4),
        z: Math.min(-1.6, (local.z / len) * reach),
      };
    } else {
      headBase = {
        x: 0,
        y: 0.75 + Math.sin(d.age * 0.9) * 0.2,
        z: -3.4,
      };
    }
    d.headLocal = headBase;
    const neckTangent = layoutChain(
      NECK,
      { x: 0, y: 0.4, z: -0.9 },
      headBase,
      0.45,
      0,
      0,
    );
    const head = d.parts.head;
    head.position.set(headBase.x, headBase.y, headBase.z);
    const horiz = Math.hypot(neckTangent.x, neckTangent.z) || 1e-6;
    head.rotation.y = Math.atan2(-neckTangent.x, -neckTangent.z);
    head.rotation.x = Math.atan2(neckTangent.y, horiz) * 0.8;
    // The jaw works while breathing or roaring through death.
    const jawOpen = d.breathing > 0 ? 0.55
      : dying ? 0.35 + 0.2 * Math.sin(d.age * 5)
      : 0.06 + 0.04 * Math.sin(d.age * 1.7);
    d.parts.jaw.rotation.x = -jawOpen;

    // Tail: streams behind in flight, drapes over the fountain perched.
    const tailEnd = perched
      ? { x: 1.6, y: -2.4, z: 4.6 }
      : { x: 0, y: 0.35 + d.pitch * 1.5, z: 6.4 };
    const locals = [];
    layoutChain(
      TAIL,
      { x: 0, y: 0.15, z: 2.9 },
      tailEnd,
      perched ? -0.4 : 0.3,
      perched ? 0.2 : 0.55,
      d.age * 2.2,
    );
    for (const name of TAIL) {
      const p = d.parts[name].position;
      locals.push({ x: p.x, y: p.y, z: p.z });
    }
    d.tailLocals = locals;

    // Group transform + tint.
    d.group.position.set(d.pos.x, d.pos.y, d.pos.z);
    d.group.rotation.y = d.yaw;
    d.group.rotation.x = d.pitch;
    d.group.rotation.z = d.bank;
    for (const material of d.materials) {
      if (d.hurtTimer > 0) {
        material.color.setRGB(1, 0.35, 0.35);
      } else if (dying) {
        // Brighten toward white-hot as the light show builds.
        const w = clamp(d.deathTimer / DRAGON.DEATH.SECONDS, 0, 1);
        const glow = 1 + w * (1 + 0.4 * Math.sin(d.age * 14));
        material.color.setRGB(glow, glow, glow);
      } else {
        material.color.setRGB(1, 1, 1);
      }
    }
  }

  // --- lifecycle --------------------------------------------------------------

  function init() {
    initialised = true;
    crystals.init(generator.pillars());
    spawnDragon();
    combat.sfx.shriek(0.6); // the arrival roar
  }

  // Visibility follows the active dimension even while paused — called
  // from main.js outside the pause gate, so a dimension switch never
  // leaves the fight rendered in the wrong world for a frame.
  function syncVisibility() {
    fightRoot.visible = dimensions.activeKey === 'end';
  }

  function checkVictory() {
    const p = player.body.position;
    const inPortal = world.getBlock(
      Math.floor(p.x), Math.floor(p.y + 0.05), Math.floor(p.z),
    ) === BLOCK.END_PORTAL;
    if (inPortal && !victoryLatch && !stats.dead) onVictory();
    victoryLatch = inPortal;
  }

  function update(dt) {
    if (dt <= 0) return;
    syncVisibility();
    if (dimensions.activeKey !== 'end') return;
    if (!initialised) init();
    crystals.update(dt);
    if (dragon && dragon.state !== 'dead') {
      if (dragon.state === 'dying') updateDeath(dt);
      else updateFlight(dt);
      updateHealing(dt);
      if (dragon.state !== 'dead') animate(dt);
    }
    fx.updateBreath(dt);
    if (portalActive) checkVictory();
  }

  return {
    update,
    syncVisibility,
    raycast,
    // Living crystals join explosion sweeps (the dragon itself doesn't —
    // nothing in the End explodes at it in this game). Empty outside the
    // End, like the raycast.
    get blastTargets() {
      return dimensions.activeKey === 'end' ? crystals.blastTargets : [];
    },
    get health() {
      return dragon ? dragon.health : null;
    },
    get state() {
      return dragon ? dragon.state : 'unspawned';
    },
    get portalActive() {
      return portalActive;
    },
    crystals,   // debug/tests
    damageDragon, // debug/tests: __dragonFight.damageDragon('head', n)
    get dragon() {
      return dragon; // debug/tests
    },
  };
}
