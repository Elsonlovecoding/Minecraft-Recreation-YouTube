// systems/combat.js — Phase 13: the fight itself.
//   Player melee   weapon damage from config WEAPON_DAMAGE (swords AND
//                  axes), the vanilla 1.9 cooldown curve — attacking
//                  before the weapon recharges does heavily reduced damage
//                  (0.2 + 0.8·charge²) — and the SPEC critical hit: +50%
//                  damage attacking while falling. Landing a hit wears the
//                  held tool and costs attack exhaustion.
//   Armour         damagePlayer is the single entry for combat-type damage
//                  to the player (mob melee, arrows, explosions): equipped
//                  armour reduces it by 4% per protection point (full sets:
//                  leather 28%, iron 60%, diamond 80% — the SPEC values),
//                  every reduced hit wears each equipped piece, knockback
//                  applies before damage. Environmental damage (falls,
//                  lava, drowning, starving) keeps going to stats directly,
//                  unreduced.
//   Bow + arrows   hold-right-to-draw (player/interaction.js drives it),
//                  damage and speed scaling with draw time (SPEC 1..6);
//                  arrow projectiles for the player and skeletons — real
//                  assets/entity/projectiles_arrow.png crossed-quad model,
//                  gravity arc, block sticking, mob/player hits; stuck
//                  player arrows can be picked back up.
//   Explosions     the creeper's, and (Phase 16) any per-blast radius —
//                  ghast fireballs crater far smaller: a ragged crater of
//                  destructible blocks (drops ride the registry tables),
//                  distance-scaled damage to the player (through armour)
//                  and mobs, an expanding flash shell, and a WebAudio
//                  boom. The tiny procedural noise synth also supplies
//                  the creeper hiss, the ghast shriek and the deflect
//                  thwack (no audio asset system; generated is the
//                  pattern).
//   Fireballs      Phase 16, systems/fireballs.js (split per the size
//                  cap): this module wires the system, wraps fireballs
//                  into the crosshair raycast, and deflects them on a
//                  melee swing.
//
// The pure combat maths (weapon cooldowns, charge factor, armour reduction,
// ray-vs-AABB) is exported for the node test harness. createCombat wires the
// live system; entities/mobs.js receives it via main.js injection (mob melee
// and skeleton shots call in — this module never imports the mob manager,
// main passes a lazy getter).

import * as THREE from 'three';
import {
  COMBAT, WEAPON_DAMAGE, PLAYER, STATS, LIGHTING, SHIELD,
} from '../config.js';
import { BLOCK, blockDef, isSolid } from '../world/blocks.js';
import { raycastVoxel, parseHeldTool } from '../player/interaction.js';
import { createFireballs } from './fireballs.js';
import { createArrows } from './arrows.js';

// ---------------------------------------------------------------------------
// Pure combat maths (node-testable)
// ---------------------------------------------------------------------------

// 'sword' | 'axe' | null for anything else (fist-fast).
export function weaponClass(name) {
  const m = /^(?:wooden|stone|iron|golden|diamond)_(sword|axe)$/.exec(name ?? '');
  return m ? m[1] : null;
}

// Seconds this weapon takes to fully recharge between swings.
export function weaponCooldownSeconds(name) {
  return COMBAT.COOLDOWN_SECONDS[weaponClass(name)] ?? COMBAT.COOLDOWN_SECONDS.default;
}

// Damage multiplier for a swing `sinceSeconds` after the previous one —
// the vanilla 1.9 curve: 0.2 + 0.8 · charge², charge = elapsed/cooldown.
export function attackChargeFactor(sinceSeconds, name) {
  const charge = Math.max(0, Math.min(1, sinceSeconds / weaponCooldownSeconds(name)));
  return COMBAT.MIN_CHARGE_FACTOR + (1 - COMBAT.MIN_CHARGE_FACTOR) * charge * charge;
}

// Damage multiplier for `points` of worn armour protection.
export function armourReductionFactor(points) {
  return Math.max(0, 1 - points * COMBAT.ARMOR_REDUCTION_PER_POINT);
}

// Exact line of sight between two points: no solid block on the segment
// (the same voxel traversal arrows fly on, so what an AI "sees" it can
// actually hit — a coarse sampler here let skeletons corner-clip and stand
// plinking a wall forever).
export function lineOfSight(getBlock, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  return raycastVoxel(
    getBlock, from, { x: dx / dist, y: dy / dist, z: dz / dist }, dist, isSolid,
  ) === null;
}

// Ray vs AABB slab test: distance along dir (0 when origin is inside), or
// null within maxDist. Shared with the mob manager's crosshair raycast.
export function rayAABB(origin, dir, box, maxDist) {
  let tMin = 0;
  let tMax = maxDist;
  for (const [o, d, lo, hi] of [
    [origin.x, dir.x, box.minX, box.maxX],
    [origin.y, dir.y, box.minY, box.maxY],
    [origin.z, dir.z, box.minZ, box.maxZ],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }
  return tMin;
}

// ---------------------------------------------------------------------------
// Procedural sound (WebAudio) — a single looping noise buffer shaped per
// effect. Created lazily on first use (gameplay always follows a click, so
// autoplay policy is satisfied); every failure path is silent.
// ---------------------------------------------------------------------------

let audioCtx = null;
let noiseBuffer = null;

function ensureAudio() {
  if (audioCtx !== null) return audioCtx;
  try {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

function noiseBurst({ seconds, volume, filterType, frequency, attack }) {
  if (volume <= 0.01) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(volume, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
    src.stop(t + seconds + 0.05);
  } catch {
    // never let a sound failure touch gameplay
  }
}

let flashGeometry = null; // explosion shell, shared across blasts

// ---------------------------------------------------------------------------
// The combat system
// ---------------------------------------------------------------------------

// `getMobs` resolves lazily (main.js creates mobs after combat); `dayNight`
// supplies skyDarken for arrow light tinting.
export function createCombat({
  world, scene, player, stats, inventory, items, dayNight, getMobs,
}) {
  const getBlock = (x, y, z) => world.getBlock(x, y, z);
  let clock = 0;
  let lastSwing = -Infinity; // time of the previous attack swing
  const flashes = [];        // expanding explosion shells
  // Phase 21 — the shield: player/interaction.js raises and lowers the
  // guard, and damagePlayer below negates whatever arrives from the front
  // while it is up.
  let blocking = false;
  const blockFacing = { x: 0, z: 1 };

  const sfx = {
    // volume 0..1 — callers scale by distance to the player
    hiss: (volume) => noiseBurst({
      seconds: 1.6, volume: 0.5 * volume, filterType: 'bandpass',
      frequency: 4800, attack: 0.08,
    }),
    explosion: (volume) => noiseBurst({
      seconds: 1.0, volume: 0.9 * volume, filterType: 'lowpass',
      frequency: 220, attack: 0.005,
    }),
    // The ghast's firing shriek and the melee thwack of a deflection.
    shriek: (volume) => noiseBurst({
      seconds: 0.7, volume: 0.6 * volume, filterType: 'bandpass',
      frequency: 950, attack: 0.02,
    }),
    deflect: () => noiseBurst({
      seconds: 0.15, volume: 0.5, filterType: 'highpass',
      frequency: 1400, attack: 0.005,
    }),
    // The blaze's short fiery huff per burst shot (Phase 17).
    flame: (volume) => noiseBurst({
      seconds: 0.35, volume: 0.45 * volume, filterType: 'bandpass',
      frequency: 2400, attack: 0.01,
    }),
    // The enderman's teleport vwoop (Phase 18).
    warp: (volume) => noiseBurst({
      seconds: 0.4, volume: 0.4 * volume, filterType: 'bandpass',
      frequency: 700, attack: 0.05,
    }),
    // An eye of ender shattering (Phase 18) — a short glassy crack.
    shatter: (volume) => noiseBurst({
      seconds: 0.2, volume: 0.5 * volume, filterType: 'highpass',
      frequency: 2600, attack: 0.005,
    }),
  };

  // Baked-light brightness at a point (the mob tint formula) for arrows —
  // sampled on spawn and on sticking, not per frame. Floored at
  // ARROW.MIN_TINT (Phase 15): skeletons fire at night and underground,
  // where the raw curve bottoms out below 0.1 and rendered the arrow as an
  // invisible black sliver — the "damage with no projectile" report.
  function lightTintAt(x, y, z) {
    const light = world.getLight(x, y, z);
    if (!light) return 1;
    const sky = Math.max(0, Math.min(15, light.sky - dayNight.skyDarken));
    return Math.max(
      COMBAT.ARROW.MIN_TINT,
      LIGHTING.LIGHT_FALLOFF ** (15 - sky),
      LIGHTING.LIGHT_FALLOFF ** (15 - light.block),
    );
  }

  // --- ghast fireballs (Phase 16, systems/fireballs.js) ---------------------

  // Created after the function declarations below resolve (they're hoisted:
  // explode and playerAABB are plain function declarations in this scope).
  const fireballSystem = createFireballs({
    world, scene, getMobs, sfx, rayAABB,
    playerAABB: (...args) => playerAABB(...args),
    explode: (...args) => explode(...args),
    // Phase 18: a fireball with `fireSeconds` (the blaze's) sets the player
    // briefly on fire on a direct hit — the vanilla burn-after-the-hit.
    ignitePlayer: (seconds) => stats.igniteFire(seconds),
  });

  // --- arrows and the bow (Phase 21, systems/arrows.js) ---------------------

  // Created after the hoisted declarations it leans on (damagePlayer,
  // playerAABB and lightTintAt are plain function declarations in this
  // scope), exactly like the fireball system above.
  const arrowSystem = createArrows({
    world, scene, player, stats, inventory, getMobs,
    damagePlayer: (...args) => damagePlayer(...args),
    lightTintAt: (...args) => lightTintAt(...args),
    rayAABB,
    playerAABB: (...args) => playerAABB(...args),
  });

  // --- the shield (Phase 21) -------------------------------------------------

  // player/interaction.js raises the guard while the button is held; `dir`
  // is the camera forward, so damagePlayer can tell a frontal hit from one
  // that came round the side.
  function setBlocking(on, dir) {
    blocking = !!on;
    if (on && dir) {
      const len = Math.hypot(dir.x, dir.z) || 1;
      blockFacing.x = dir.x / len;
      blockFacing.z = dir.z / len;
    }
  }

  // Is an attack whose knockback pushes the player along (kdirX, kdirZ)
  // coming at the raised shield? Knockback points AWAY from the attacker, so
  // the attacker sits along -kdir; a frontal hit is one the player faces.
  function shieldBlocks(kdirX, kdirZ) {
    if (!blocking) return false;
    const len = Math.hypot(kdirX, kdirZ);
    if (len < 1e-6) return false; // no direction to judge (never blocked)
    const towardAttackerX = -kdirX / len;
    const towardAttackerZ = -kdirZ / len;
    return blockFacing.x * towardAttackerX + blockFacing.z * towardAttackerZ >
      SHIELD.BLOCK_ARC_DOT;
  }

  // Spend the shield's durability for a blocked hit, on whichever hand
  // holds it (a broken shield vanishes and the guard drops).
  function wearShield() {
    if (inventory.selectedName === 'shield') {
      if (inventory.damageSelected(SHIELD.WEAR_PER_BLOCK) === 'broken') blocking = false;
    } else if (inventory.offhandName === 'shield') {
      if (inventory.damageOffhand(SHIELD.WEAR_PER_BLOCK) === 'broken') blocking = false;
    }
  }

  // --- player melee ---------------------------------------------------------

  // Nearest attackable thing on the crosshair ray (interaction's combat
  // bridge): a living mob, or — Phase 16 — a ghast fireball in flight,
  // whichever is nearer. A fireball comes back wrapped as
  // { isFireball: true, fireball } so attack() can deflect instead of
  // damage; interaction treats the return opaquely either way.
  function raycast(origin, dir, maxDist) {
    const mob = getMobs()?.raycast(origin, dir, maxDist) ?? null;
    const mobT = mob ? rayAABB(origin, dir, mob.entity.aabb, maxDist) ?? Infinity : Infinity;
    const fb = fireballSystem.nearestOnRay(origin, dir, maxDist);
    if (fb && fb.t <= mobT) return { isFireball: true, fireball: fb.fireball };
    return mob;
  }

  // One melee swing at a raycast target. Every click swings; the damage
  // scales with how recharged the weapon is (vanilla 1.9), critical hits
  // land while falling (SPEC +50%). A fireball under the crosshair deflects
  // instead (SPEC: "deflectable by hitting them"): it reverses along the
  // player's look direction and becomes the player's own projectile.
  function attack(mob, dir) {
    if (mob?.isFireball) {
      lastSwing = clock; // a deflection is a swing — the charge clock resets
      fireballSystem.deflect(mob.fireball, dir);
      return;
    }
    const since = clock - lastSwing;
    lastSwing = clock;
    const name = inventory.selectedName;
    const body = player.body;
    const falling = body.velocity.y < 0 && !body.onGround && !body.touchingWater;
    // Strength (Phase 18 — the potion) adds to the base like the vanilla
    // attribute, so the charge curve scales it too.
    let damage = ((WEAPON_DAMAGE[name] ?? WEAPON_DAMAGE.fist) +
      (stats.strengthBonus ?? 0)) *
      attackChargeFactor(since, name);
    if (falling) damage *= COMBAT.CRIT_MULTIPLIER;
    mob.provoked = true; // neutral mobs (daylight spiders) fight back
    if (mob.entity.damage(damage, dir.x, dir.z)) {
      stats.exhaust(STATS.EXHAUST_ATTACK);
      // Weapons and tools wear on a landed hit (the bow used as a club
      // doesn't, like vanilla; damageSelected no-ops for plain items).
      if (parseHeldTool(name)) inventory.damageSelected(COMBAT.WEAPON_WEAR_PER_HIT);
    }
  }

  // --- armour pipeline ------------------------------------------------------

  // Combat-type damage to the player: mob melee, arrows, explosions.
  // Armour reduces it (4%/point — the SPEC set values), every reduced hit
  // wears each equipped piece, knockback lands BEFORE damage so a lethal
  // hit can't launch the corpse (the Phase 11 cactus lesson).
  function damagePlayer(amount, kdirX = 0, kdirZ = 0) {
    if (amount <= 0 || stats.dead || player.mode === 'fly') return;
    // A raised shield eats a frontal hit outright (vanilla) and takes the
    // wear instead — melee, arrows and blasts all arrive through here.
    if (shieldBlocks(kdirX, kdirZ)) {
      wearShield();
      sfx.deflect();
      return;
    }
    const points = inventory.armourPoints;
    const reduced = Math.max(1, Math.round(amount * armourReductionFactor(points)));
    if (points > 0) {
      inventory.armour.damageAll(
        Math.max(1, Math.floor(amount / COMBAT.ARMOR_WEAR_DAMAGE_DIVISOR)),
      );
    }
    if (kdirX !== 0 || kdirZ !== 0) stats.applyKnockback(kdirX, kdirZ);
    stats.damage(reduced);
  }

  // --- explosions -----------------------------------------------------------

  // Drops for an exploded block: the registry drop table (chance entries
  // first, fallback entries only if none hit — same semantics as mining),
  // gated behind the explosion's own drop chance by the caller.
  function spawnBlockDrops(def, x, y, z) {
    let chanceDropped = false;
    for (const drop of def.drops) {
      if (drop.fallback && chanceDropped) continue;
      if (drop.chance !== undefined) {
        if (Math.random() >= drop.chance) continue;
        chanceDropped = true;
      }
      const count = Array.isArray(drop.count)
        ? drop.count[0] + Math.floor(Math.random() * (drop.count[1] - drop.count[0] + 1))
        : drop.count;
      if (count > 0) items.spawn(drop.item, count, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    }
  }

  // A creeper-style explosion at `centre` dealing up to `maxDamage` at the
  // blast point. Blocks inside a ragged sphere break (their listeners —
  // falling supports, torch pops, chest spills — ride the setBlock chain);
  // obsidian/bedrock survive, fluids are untouched. Phase 16: the radii are
  // per-blast now — ghast fireballs crater far smaller than a creeper —
  // defaulting to the creeper's config values; the damage radius keeps the
  // config pair's 2x proportion unless given explicitly. Phase 17:
  // opts.maxHardness caps what a blast can break below the global
  // MAX_BLAST_HARDNESS — ghast fireballs break netherrack but not nether
  // brick (the fortress survives a siege, the vanilla proportions).
  function explode(centre, maxDamage, opts = {}) {
    const E = COMBAT.EXPLOSION;
    const blockRadius = opts.blockRadius ?? E.BLOCK_RADIUS;
    const damageRadius = opts.damageRadius ??
      blockRadius * (E.DAMAGE_RADIUS / E.BLOCK_RADIUS);
    const maxHardness = opts.maxHardness ?? E.MAX_BLAST_HARDNESS;
    const r = Math.ceil(blockRadius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.floor(centre.x) + dx;
          const y = Math.floor(centre.y) + dy;
          const z = Math.floor(centre.z) + dz;
          const d = Math.hypot(
            x + 0.5 - centre.x, y + 0.5 - centre.y, z + 0.5 - centre.z,
          );
          if (d > blockRadius - Math.random() * E.RADIUS_JITTER) continue;
          const id = world.getBlock(x, y, z);
          if (id === BLOCK.AIR) continue;
          const def = blockDef(id);
          if (def.fluid || def.hardness === null) continue;
          if (def.hardness > maxHardness) continue; // obsidian, bedrock; and
                                                    // fortress brick vs the
                                                    // capped ghast fireball
          world.setBlock(x, y, z, BLOCK.AIR);
          if (Math.random() < E.DROP_CHANCE) spawnBlockDrops(def, x, y, z);
        }
      }
    }

    // Distance-scaled damage: the player (through armour, with knockback
    // away from the blast) and every living mob in range. Fire-typed
    // blasts (opts.fireDamage — blaze fireballs) are negated entirely for
    // a player under fire resistance, the vanilla rule; mobs still take
    // them.
    const p = player.body.position;
    const pd = Math.hypot(
      p.x - centre.x, p.y + PLAYER.HEIGHT / 2 - centre.y, p.z - centre.z,
    );
    const playerFireProof =
      opts.fireDamage && (stats.effects?.fire_resistance ?? 0) > 0;
    if (pd < damageRadius && !playerFireProof) {
      // opts.knockX/knockZ override the radial shove for blasts centred ON
      // the player (a direct fireball hit bursts at the body centre, where
      // the radial direction is zero — Phase 17 review fix: the caller
      // passes the flight direction instead, so square hits still shove).
      damagePlayer(
        Math.round(maxDamage * (1 - pd / damageRadius)),
        opts.knockX ?? (p.x - centre.x), opts.knockZ ?? (p.z - centre.z),
      );
    }
    const mobs = getMobs();
    if (mobs) {
      for (const mob of mobs.mobs) {
        const e = mob.entity;
        if (e.dead || e.removed) continue;
        const mp = e.position;
        const md = Math.hypot(
          mp.x - centre.x, mp.y + e.def.height / 2 - centre.y, mp.z - centre.z,
        );
        if (md < damageRadius) {
          e.damage(
            Math.round(maxDamage * (1 - md / damageRadius)),
            mp.x - centre.x, mp.z - centre.z,
          );
        }
      }
    }

    // The flash shell + the boom, faded by how far away the player stands.
    // Geometry shared across blasts (only the per-flash material disposes).
    flashGeometry ??= new THREE.SphereGeometry(1, 16, 12);
    const mesh = new THREE.Mesh(
      flashGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xfff0c0, transparent: true, opacity: 0.85,
        depthWrite: false, toneMapped: false,
      }),
    );
    mesh.position.set(centre.x, centre.y, centre.z);
    scene.add(mesh);
    flashes.push({ mesh, t: 0, radius: blockRadius });
    sfx.explosion(Math.max(0, 1 - pd / COMBAT.EXPLOSION.BOOM_RANGE));
  }

  function updateFlashes(dt) {
    const E = COMBAT.EXPLOSION;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const flash = flashes[i];
      flash.t += dt;
      const f = flash.t / E.FLASH_SECONDS;
      if (f >= 1) {
        flash.mesh.removeFromParent();
        flash.mesh.material.dispose();
        flashes.splice(i, 1);
        continue;
      }
      flash.mesh.scale.setScalar(0.8 + f * flash.radius * 1.5);
      flash.mesh.material.opacity = 0.85 * (1 - f);
    }
  }

  // --- dimension switch (Phase 15) ------------------------------------------

  // Arrows and fireballs in flight belong to their dimension: swap them
  // out hidden and frozen, restore the incoming set. A draw in progress
  // cancels — the bow's world just changed under it.
  function swapDimensionState(stored = { arrows: [], fireballs: [] }) {
    // Phase 15 stored plain arrow arrays; accept both shapes.
    const inArrows = Array.isArray(stored) ? stored : stored.arrows ?? [];
    const inFireballs = Array.isArray(stored) ? [] : stored.fireballs ?? [];
    const prev = { arrows: arrowSystem.swapState(inArrows) };
    prev.fireballs = fireballSystem.swapState(inFireballs);
    return prev;
  }

  // --- per-frame ------------------------------------------------------------

  function update(dt) {
    if (dt <= 0) return;
    clock += dt;
    arrowSystem.update(dt);
    fireballSystem.update(dt);
    updateFlashes(dt);
  }

  return {
    update,
    raycast,
    attack,
    damagePlayer,
    spawnArrow: arrowSystem.spawnArrow,
    spawnFireball: fireballSystem.spawn,
    explode,
    updateDraw: arrowSystem.updateDraw,
    releaseDraw: arrowSystem.releaseDraw,
    cancelDraw: arrowSystem.cancelDraw,
    swapDimensionState,
    setBlocking,
    sfx,
    get blocking() {
      return blocking;
    },
    get isDrawing() {
      return arrowSystem.isDrawing;
    },
    // Is there an arrow to fire at all? (interaction's active-hand rule:
    // an arrowless bow shouldn't gate the offhand's own use)
    get hasArrow() {
      return arrowSystem.hasArrow;
    },
    // 0..1 — how far the current draw has charged (HUD/hand feedback)
    get drawCharge() {
      return arrowSystem.drawCharge;
    },
    // which hand is drawing: 'main' | 'off' | null (the hand pose reader)
    get drawSource() {
      return arrowSystem.drawSource;
    },
    get arrowCount() {
      return arrowSystem.list.length; // test/debug scaffolding
    },
    get fireballCount() {
      return fireballSystem.list.length; // test/debug scaffolding
    },
    arrows: arrowSystem.list, // read-only by convention (debug/tests)
    fireballs: fireballSystem.list, // read-only by convention (debug/tests)
  };
}
