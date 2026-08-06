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
//   Explosions     the creeper's: a ragged crater of destructible blocks
//                  (drops ride the registry tables), distance-scaled damage
//                  to the player (through armour) and mobs, an expanding
//                  flash shell, and a WebAudio boom. The tiny procedural
//                  noise synth also supplies the creeper hiss (there is no
//                  audio asset system yet; generated art is the pattern).
//
// The pure combat maths (weapon cooldowns, charge factor, armour reduction,
// ray-vs-AABB) is exported for the node test harness. createCombat wires the
// live system; entities/mobs.js receives it via main.js injection (mob melee
// and skeleton shots call in — this module never imports the mob manager,
// main passes a lazy getter).

import * as THREE from 'three';
import {
  COMBAT, WEAPON_DAMAGE, PLAYER, STATS, LIGHTING, CHUNK,
} from '../config.js';
import { BLOCK, blockDef, isSolid } from '../world/blocks.js';
import { raycastVoxel, parseHeldTool } from '../player/interaction.js';

// ---------------------------------------------------------------------------
// Pure combat maths (node-testable)
// ---------------------------------------------------------------------------

// 'sword' | 'axe' | null for anything else (fist-fast).
export function weaponClass(name) {
  const m = /^(?:wooden|stone|iron|diamond)_(sword|axe)$/.exec(name ?? '');
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

// ---------------------------------------------------------------------------
// The arrow model — two crossed quads sampling the side-view art of the real
// projectiles_arrow.png (left half: fletching at u=0, tip at u=16px; art is
// 16x5 of a 32x32 sheet). Built along +z so the mesh orients with a single
// quaternion from the flight direction.
// ---------------------------------------------------------------------------

let arrowTexture = null;
let arrowGeometry = null;
let flashGeometry = null; // explosion shell, shared across blasts

function getArrowGeometry() {
  if (arrowGeometry) return arrowGeometry;
  const L = COMBAT.ARROW.LENGTH;
  const H = (L * 5) / 16; // art proportions: 16px long, 5px tall
  const u1 = 16 / 32;
  const v0 = 1 - 5 / 32;
  const pos = [];
  const uv = [];
  const idx = [];
  // One quad in the z-y plane, one in the z-x plane, tip at +z (u max).
  for (const axis of ['y', 'x']) {
    const base = pos.length / 3;
    for (const [t, z] of [[-0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0.5, -0.5]]) {
      pos.push(axis === 'y' ? 0 : t * H, axis === 'y' ? t * H : 0, z * L);
      uv.push(z > 0 ? u1 : 0, t > 0 ? 1 : v0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  arrowGeometry = new THREE.BufferGeometry();
  arrowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  arrowGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  arrowGeometry.setIndex(idx);
  return arrowGeometry;
}

function getArrowTexture() {
  if (!arrowTexture) {
    arrowTexture = new THREE.TextureLoader().load('assets/entity/projectiles_arrow.png');
    arrowTexture.magFilter = THREE.NearestFilter;
    arrowTexture.minFilter = THREE.NearestFilter;
    arrowTexture.generateMipmaps = false;
    arrowTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return arrowTexture;
}

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
  let draw = null;           // { t, slot } while the bow is drawn
  const arrows = [];
  const flashes = [];        // expanding explosion shells

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
  };

  // Baked-light brightness at a point (the mob tint formula) for arrows —
  // sampled on spawn and on sticking, not per frame.
  function lightTintAt(x, y, z) {
    const light = world.getLight(x, y, z);
    if (!light) return 1;
    const sky = Math.max(0, Math.min(15, light.sky - dayNight.skyDarken));
    return Math.max(
      LIGHTING.LIGHT_FALLOFF ** (15 - sky),
      LIGHTING.LIGHT_FALLOFF ** (15 - light.block),
    );
  }

  // --- player melee ---------------------------------------------------------

  // Nearest living mob on the crosshair ray (interaction's combat bridge).
  const raycast = (origin, dir, maxDist) => getMobs()?.raycast(origin, dir, maxDist) ?? null;

  // One melee swing at a raycast mob. Every click swings; the damage scales
  // with how recharged the weapon is (vanilla 1.9), critical hits land while
  // falling (SPEC +50%).
  function attack(mob, dir) {
    const since = clock - lastSwing;
    lastSwing = clock;
    const name = inventory.selectedName;
    const body = player.body;
    const falling = body.velocity.y < 0 && !body.onGround && !body.touchingWater;
    let damage = (WEAPON_DAMAGE[name] ?? WEAPON_DAMAGE.fist) *
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

  // --- arrows ---------------------------------------------------------------

  // `from` is the arrowhead spawn point, `vel` blocks/s. fromPlayer arrows
  // hit mobs (and can be picked back up once stuck); mob arrows hit the
  // player. damage is applied on the hit.
  function spawnArrow({ from, vel, damage, fromPlayer }) {
    const material = new THREE.MeshBasicMaterial({
      map: getArrowTexture(),
      side: THREE.DoubleSide,
      alphaTest: 0.5,
      toneMapped: false,
    });
    const tint = lightTintAt(from.x, from.y, from.z);
    material.color.setRGB(tint, tint, tint);
    const mesh = new THREE.Mesh(getArrowGeometry(), material);
    mesh.position.set(from.x, from.y, from.z);
    scene.add(mesh);
    const arrow = {
      pos: { x: from.x, y: from.y, z: from.z },
      vel: { x: vel.x, y: vel.y, z: vel.z },
      damage,
      fromPlayer,
      mesh,
      age: 0,
      stuck: false,
      stuckFor: 0,
    };
    orientArrow(arrow);
    arrows.push(arrow);
    return arrow;
  }

  const zAxis = new THREE.Vector3(0, 0, 1);
  const dirVec = new THREE.Vector3();

  function orientArrow(arrow) {
    const v = arrow.vel;
    const len = Math.hypot(v.x, v.y, v.z);
    if (len < 1e-6) return;
    dirVec.set(v.x / len, v.y / len, v.z / len);
    arrow.mesh.quaternion.setFromUnitVectors(zAxis, dirVec);
  }

  function removeArrow(index) {
    const arrow = arrows[index];
    arrow.mesh.removeFromParent();
    arrow.mesh.material.dispose();
    arrows.splice(index, 1);
  }

  function playerAABB() {
    const p = player.body.position;
    const hw = PLAYER.WIDTH / 2;
    return {
      minX: p.x - hw, minY: p.y, minZ: p.z - hw,
      maxX: p.x + hw, maxY: p.y + PLAYER.HEIGHT, maxZ: p.z + hw,
    };
  }

  function updateArrows(dt) {
    const A = COMBAT.ARROW;
    for (let i = arrows.length - 1; i >= 0; i--) {
      const arrow = arrows[i];
      arrow.age += dt;
      if (arrow.stuck) {
        arrow.stuckFor += dt;
        if (arrow.stuckFor > A.STUCK_DESPAWN_SECONDS) {
          removeArrow(i);
          continue;
        }
        // An arrow whose chunk streamed out freezes (like items and mobs):
        // the stuck-cell probe below would otherwise synchronously
        // regenerate the far chunk every frame until despawn.
        if (!world.getChunkIfLoaded(
          Math.floor(arrow.pos.x / CHUNK.SIZE), Math.floor(arrow.pos.z / CHUNK.SIZE),
        )) {
          continue;
        }
        // Player-fired arrows can be collected back off the ground.
        if (
          arrow.fromPlayer && arrow.stuckFor > A.PICKUP_DELAY_SECONDS && !stats.dead
        ) {
          const p = player.body.position;
          const d = Math.hypot(
            arrow.pos.x - p.x,
            arrow.pos.y - (p.y + PLAYER.HEIGHT / 2),
            arrow.pos.z - p.z,
          );
          if (d < A.PICKUP_RADIUS && inventory.add('arrow', 1) === 0) {
            removeArrow(i);
            continue;
          }
        }
        // A stuck arrow whose block was mined out falls free again (the
        // exact cell it stuck into — a positional probe would miss it, the
        // stick depth clamp keeps the tip short of the surface). The age
        // resets: the flying-despawn safety net measures THIS flight, so a
        // long-stuck arrow drops to the floor instead of blinking out.
        if (!isSolid(world.getBlock(
          arrow.stuckCell.x, arrow.stuckCell.y, arrow.stuckCell.z,
        ))) {
          arrow.stuck = false;
          arrow.age = 0;
        }
        continue;
      }
      if (arrow.age > A.FLYING_DESPAWN_SECONDS) {
        removeArrow(i);
        continue;
      }

      arrow.vel.y -= A.GRAVITY * dt;
      const dragK = Math.exp(-A.DRAG * dt);
      arrow.vel.x *= dragK;
      arrow.vel.y *= dragK;
      arrow.vel.z *= dragK;
      const speed = Math.hypot(arrow.vel.x, arrow.vel.y, arrow.vel.z);
      if (speed < 1e-6) continue;
      const step = speed * dt;
      const dir = {
        x: arrow.vel.x / speed, y: arrow.vel.y / speed, z: arrow.vel.z / speed,
      };

      // Nearest block along this frame's flight segment caps the hit range.
      const blockHit = raycastVoxel(getBlock, arrow.pos, dir, step, isSolid);
      const range = blockHit ? blockHit.distance : step;

      // Entity hit inside the range wins over the block behind it.
      if (arrow.fromPlayer) {
        const mob = getMobs()?.raycast(arrow.pos, dir, range) ?? null;
        if (mob) {
          mob.provoked = true;
          mob.entity.damage(arrow.damage, dir.x, dir.z);
          removeArrow(i);
          continue;
        }
      } else {
        const t = rayAABB(arrow.pos, dir, playerAABB(), range);
        if (t !== null) {
          damagePlayer(arrow.damage, dir.x, dir.z);
          removeArrow(i);
          continue;
        }
      }

      if (blockHit) {
        // Stick just short of the face, tip touching the block. The hit
        // cell is remembered exactly, so mining that block frees the arrow.
        const depth = Math.max(
          0, blockHit.distance - COMBAT.ARROW.LENGTH * COMBAT.ARROW.STICK_BACKOFF,
        );
        arrow.pos.x += dir.x * depth;
        arrow.pos.y += dir.y * depth;
        arrow.pos.z += dir.z * depth;
        arrow.stuck = true;
        arrow.stuckFor = 0;
        arrow.vel = { x: 0, y: 0, z: 0 };
        arrow.stuckCell = { x: blockHit.x, y: blockHit.y, z: blockHit.z };
        const tint = lightTintAt(arrow.pos.x, arrow.pos.y, arrow.pos.z);
        arrow.mesh.material.color.setRGB(tint, tint, tint);
      } else {
        arrow.pos.x += arrow.vel.x * dt;
        arrow.pos.y += arrow.vel.y * dt;
        arrow.pos.z += arrow.vel.z * dt;
        orientArrow(arrow);
      }
      arrow.mesh.position.set(arrow.pos.x, arrow.pos.y, arrow.pos.z);
    }
  }

  // --- bow ------------------------------------------------------------------

  // Arrows count from the offhand too (Phase 14 review fix — vanilla
  // players keep them there, and vanilla consumes the offhand FIRST).
  const hasArrowItem = () =>
    inventory.offhandName === 'arrow' ||
    inventory.slots.some((s) => s && s.name === 'arrow');

  const consumeArrow = () => {
    if (inventory.offhandName === 'arrow') return inventory.consumeOffhand(1);
    return inventory.consumeItem('arrow', 1);
  };

  // Advance the draw while the button is held (interaction calls this every
  // frame a held bow + right button coincide). A draw only starts with an
  // arrow to fire; switching hotbar slots restarts the charge. Phase 14:
  // `source` is which hand draws — 'main' (the hotbar selection) or 'off'
  // (the offhand slot); the wear on release lands on that hand's bow.
  function updateDraw(dt, source = 'main') {
    if (stats.dead) {
      draw = null;
      return;
    }
    const slot = source === 'off' ? 'off' : inventory.selected;
    if (!draw || draw.slot !== slot) {
      if (!hasArrowItem()) {
        draw = null;
        return;
      }
      draw = { t: 0, slot, source };
      return;
    }
    draw.t += dt;
  }

  // Release fires (from the camera eye along the crosshair): damage and
  // speed scale with the charge — SPEC 1 to 6, 6 at full draw.
  function releaseDraw(origin, dir) {
    if (!draw) return;
    const t = draw.t;
    const source = draw.source;
    draw = null;
    if (t < COMBAT.BOW.MIN_DRAW_SECONDS || stats.dead) return;
    // The source hand must STILL hold the bow — an F-swap (or slot switch)
    // raced ahead of the release; that's a cancel like any other broken
    // draw (Phase 14 review fix: it used to fire anyway, skipping wear).
    const handName = source === 'off' ? inventory.offhandName : inventory.selectedName;
    if (handName !== 'bow') return;
    if (!consumeArrow()) return;
    const B = COMBAT.BOW;
    const charge = Math.min(1, t / B.FULL_DRAW_SECONDS);
    const damage = Math.round(B.MIN_DAMAGE + (B.MAX_DAMAGE - B.MIN_DAMAGE) * charge);
    const speed = B.MIN_SPEED + (B.MAX_SPEED - B.MIN_SPEED) * charge;
    const A = COMBAT.ARROW;
    spawnArrow({
      from: {
        x: origin.x + dir.x * A.SPAWN_FORWARD,
        y: origin.y + dir.y * A.SPAWN_FORWARD - A.EYE_DROP,
        z: origin.z + dir.z * A.SPAWN_FORWARD,
      },
      vel: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
      damage,
      fromPlayer: true,
    });
    if (source === 'off') {
      if (inventory.offhandName === 'bow') {
        inventory.damageOffhand(COMBAT.BOW.WEAR_PER_SHOT);
      }
    } else if (inventory.selectedName === 'bow') {
      inventory.damageSelected(COMBAT.BOW.WEAR_PER_SHOT);
    }
  }

  const cancelDraw = () => {
    draw = null;
  };

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
  // obsidian/bedrock survive, fluids are untouched.
  function explode(centre, maxDamage) {
    const E = COMBAT.EXPLOSION;
    const r = Math.ceil(E.BLOCK_RADIUS);
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.floor(centre.x) + dx;
          const y = Math.floor(centre.y) + dy;
          const z = Math.floor(centre.z) + dz;
          const d = Math.hypot(
            x + 0.5 - centre.x, y + 0.5 - centre.y, z + 0.5 - centre.z,
          );
          if (d > E.BLOCK_RADIUS - Math.random() * E.RADIUS_JITTER) continue;
          const id = world.getBlock(x, y, z);
          if (id === BLOCK.AIR) continue;
          const def = blockDef(id);
          if (def.fluid || def.hardness === null) continue;
          if (def.hardness > E.MAX_BLAST_HARDNESS) continue; // obsidian, bedrock
          world.setBlock(x, y, z, BLOCK.AIR);
          if (Math.random() < E.DROP_CHANCE) spawnBlockDrops(def, x, y, z);
        }
      }
    }

    // Distance-scaled damage: the player (through armour, with knockback
    // away from the blast) and every living mob in range.
    const p = player.body.position;
    const pd = Math.hypot(
      p.x - centre.x, p.y + PLAYER.HEIGHT / 2 - centre.y, p.z - centre.z,
    );
    if (pd < E.DAMAGE_RADIUS) {
      damagePlayer(
        Math.round(maxDamage * (1 - pd / E.DAMAGE_RADIUS)),
        p.x - centre.x, p.z - centre.z,
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
        if (md < E.DAMAGE_RADIUS) {
          e.damage(
            Math.round(maxDamage * (1 - md / E.DAMAGE_RADIUS)),
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
    flashes.push({ mesh, t: 0 });
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
      flash.mesh.scale.setScalar(0.8 + f * E.BLOCK_RADIUS * 1.5);
      flash.mesh.material.opacity = 0.85 * (1 - f);
    }
  }

  // --- per-frame ------------------------------------------------------------

  function update(dt) {
    if (dt <= 0) return;
    clock += dt;
    updateArrows(dt);
    updateFlashes(dt);
  }

  return {
    update,
    raycast,
    attack,
    damagePlayer,
    spawnArrow,
    explode,
    updateDraw,
    releaseDraw,
    cancelDraw,
    sfx,
    get isDrawing() {
      return draw !== null;
    },
    // Is there an arrow to fire at all? (interaction's active-hand rule:
    // an arrowless bow shouldn't gate the offhand's own use)
    get hasArrow() {
      return hasArrowItem();
    },
    // 0..1 — how far the current draw has charged (HUD/hand feedback)
    get drawCharge() {
      return draw ? Math.min(1, draw.t / COMBAT.BOW.FULL_DRAW_SECONDS) : 0;
    },
    // which hand is drawing: 'main' | 'off' | null (the hand pose reader)
    get drawSource() {
      return draw ? draw.source : null;
    },
    get arrowCount() {
      return arrows.length; // test/debug scaffolding
    },
    arrows, // read-only by convention (debug/tests)
  };
}
