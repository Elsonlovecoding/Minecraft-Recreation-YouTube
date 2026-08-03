// entities/entity.js — Phase 12: the base entity every mob builds on. An
// AABB body swept against the voxel world (the PlayerBody collision model,
// simplified for mobs): gravity with terminal velocity, exact per-axis cell
// scans so no speed can tunnel through a wall, a 1-block auto-step
// (MOBS.STEP_HEIGHT — mobs climb full blocks without jumping), water
// buoyancy and a bank-exit hop, lava as a slow dense fluid. On top of the
// physics: health, hurt/knockback, a death timer for the fall-over
// animation, and the despawn rules (hostiles vanish beyond
// MOBS.DESPAWN_DISTANCE; anything below the world despawns).
//
// Pure logic — no DOM, no three.js types. Node tests can construct one with
// any { getBlock, getChunkIfLoaded } world. AI (entities/mobs.js) steers by
// writing `wishX/wishZ` (wanted horizontal velocity) before step().

import { MOBS, CHUNK } from '../config.js';
import { BLOCK, blockDef, isLava } from '../world/blocks.js';

const EPS = 1e-7;
const AXIS = ['x', 'y', 'z'];

export class Entity {
  // `def` is the mob type: { width, height, maxHealth, hostile, ... }.
  constructor(world, pos, def) {
    this.world = world;
    this.def = def;
    this.position = { x: pos.x, y: pos.y, z: pos.z }; // feet centre
    this.velocity = { x: 0, y: 0, z: 0 };
    this.wishX = 0;             // AI steering: wanted horizontal velocity
    this.wishZ = 0;
    this.onGround = false;
    this.horizontalCollision = false; // pushed into a wall last step (spiders climb)
    this.climbing = false;      // AI-set (spider): wall-climbing this step —
                                // keeps ground-style steering while airborne,
                                // so the body stays pressed into the wall
    this.inWater = false;
    this.inLava = false;
    this.submersion = 0;        // waterline fraction of body height
    this.health = def.maxHealth;
    this.dead = false;          // dying — death animation playing
    this.removed = false;       // done — the manager drops it this frame
    this.diedFromDamage = false; // died (drops) vs despawned (no drops)
    this.age = 0;
    this.hurtTimer = 0;         // red-flash countdown after a hit
    this.deathTimer = 0;
    this.horizontalSpeed = 0;   // actual blocks/s this step (drives limb swing)
  }

  // The entity's world-space AABB (player attack ray tests).
  get aabb() {
    const p = this.position;
    const hw = this.def.width / 2;
    return {
      minX: p.x - hw, minY: p.y, minZ: p.z - hw,
      maxX: p.x + hw, maxY: p.y + this.def.height, maxZ: p.z + hw,
    };
  }

  // Single damage entry point (the player's attacks now; mob-vs-mob later).
  // A non-zero (dirX, dirZ) knocks the mob back along it. Returns true if
  // the hit landed (false once dead).
  damage(amount, dirX = 0, dirZ = 0) {
    if (this.dead || this.removed || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtTimer = MOBS.HURT_FLASH_SECONDS;
    const len = Math.hypot(dirX, dirZ);
    if (len > 1e-6) {
      this.velocity.x = (dirX / len) * MOBS.KNOCKBACK_HORIZONTAL;
      this.velocity.z = (dirZ / len) * MOBS.KNOCKBACK_HORIZONTAL;
      this.velocity.y = Math.max(this.velocity.y, MOBS.KNOCKBACK_VERTICAL);
    }
    if (this.health === 0) {
      this.dead = true;
      this.diedFromDamage = true;
      this.deathTimer = MOBS.DEATH_SECONDS;
    }
    return true;
  }

  // Despawn rules + the death countdown. playerPos is the player's feet.
  updateLifecycle(dt, playerPos) {
    if (this.dead) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.removed = true;
      return;
    }
    const p = this.position;
    if (p.y < MOBS.VOID_DESPAWN_Y) {
      this.removed = true; // fell out of the world
      return;
    }
    const dist = Math.hypot(p.x - playerPos.x, p.y - playerPos.y, p.z - playerPos.z);
    if (this.def.hostile && dist > MOBS.DESPAWN_DISTANCE) this.removed = true;
  }

  // One physics step. Entities in unloaded chunks freeze entirely (like
  // dropped items — physics would otherwise regenerate far chunks
  // synchronously outside the streaming budget).
  step(dt) {
    if (dt <= 0) return;
    const p = this.position;
    const v = this.velocity;
    this.age += dt;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    if (!this.world.getChunkIfLoaded(
      Math.floor(p.x / CHUNK.SIZE), Math.floor(p.z / CHUNK.SIZE),
    )) {
      this.horizontalSpeed = 0;
      return;
    }

    this._senseFluids();
    if (this.dead) {
      this.wishX = 0;
      this.wishZ = 0;
      this.climbing = false; // a corpse falls — the AI stops writing the
                             // flag on death, so clear it here or a spider
                             // killed mid-climb would rise gravity-free
    }

    // Horizontal control: exponential approach to the wish on the ground
    // and in fluids (acceleration and friction in one, framerate-
    // independent); airborne only drag, so knockback arcs carry.
    const inFluid = this.inWater || this.inLava;
    const speedScale = this.inLava ? MOBS.LAVA_SPEED_FACTOR
      : this.inWater ? MOBS.WATER_SPEED_FACTOR : 1;
    if (this.onGround || inFluid || this.climbing) {
      const k = 1 - Math.exp(-MOBS.GROUND_RESPONSE * dt);
      v.x += (this.wishX * speedScale - v.x) * k;
      v.z += (this.wishZ * speedScale - v.z) * k;
    } else {
      const drag = Math.exp(-MOBS.AIR_DRAG * dt);
      v.x *= drag;
      v.z *= drag;
    }

    // Vertical: gravity, or buoyant bobbing in water, or a dense slow sink
    // in lava (mobs burn either way — the manager applies the damage).
    // Climbing is a velocity state like vanilla ladders — the AI writes the
    // climb speed and gravity stays out of it (fighting gravity here would
    // make the climb rate framerate-dependent: at a clamped 0.1s frame,
    // gravity*dt alone exceeds the climb speed).
    if (this.inWater) {
      v.y += -MOBS.WATER_GRAVITY * (1 - MOBS.WATER_BUOYANCY * this.submersion) * dt;
      v.y *= Math.exp(-MOBS.WATER_DRAG * dt);
    } else if (!this.climbing) {
      if (this.inLava) {
        v.y += -MOBS.LAVA_GRAVITY * dt;
        v.y *= Math.exp(-MOBS.LAVA_DRAG * dt);
      } else {
        v.y -= MOBS.GRAVITY * dt;
        // Per-type fall cap (Phase 14: the chicken's wing-flap slow fall).
        // Clamped HERE, after gravity — an AI-side clamp would race the
        // integration and leak up to gravity*dt of extra speed per frame
        // (frame-rate dependent, +3.2 blocks/s at a clamped 0.1s frame).
        const cap = this.def.maxFallSpeed ?? MOBS.TERMINAL_VELOCITY;
        if (v.y < -cap) v.y = -cap;
      }
    }

    // Integrate and collide: Y first, then the horizontal axes with the
    // step-up retry (vanilla order).
    const hitY = this._sweep(1, v.y * dt);
    if (hitY) {
      this.onGround = v.y < 0;
      v.y = 0;
    } else if (v.y !== 0) {
      this.onGround = false;
    }
    const beforeX = p.x;
    const beforeZ = p.z;
    const hit = this._moveHorizontal(v.x * dt, v.z * dt);
    if (hit.x) v.x = 0;
    if (hit.z) v.z = 0;
    this.horizontalCollision = hit.x || hit.z;

    // Pushing into a bank while in a fluid: hop, so mobs climb out of ponds
    // the way the player does.
    if (
      inFluid && (hit.x || hit.z) && (this.wishX !== 0 || this.wishZ !== 0) &&
      v.y < MOBS.FLUID_EXIT_JUMP && v.y > -MOBS.FLUID_EXIT_JUMP
    ) {
      v.y = MOBS.FLUID_EXIT_JUMP;
    }

    this.horizontalSpeed = Math.hypot(p.x - beforeX, p.z - beforeZ) / dt;
  }

  _senseFluids() {
    const p = this.position;
    const hw = this.def.width / 2;
    let water = false;
    let lava = false;
    let topWater = -Infinity;
    const x0 = Math.floor(p.x - hw + EPS);
    const x1 = Math.floor(p.x + hw - EPS);
    const y0 = Math.floor(p.y + EPS);
    const y1 = Math.floor(p.y + this.def.height - EPS);
    const z0 = Math.floor(p.z - hw + EPS);
    const z1 = Math.floor(p.z + hw - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = this.world.getBlock(x, y, z);
          if (id === BLOCK.WATER) {
            water = true;
            if (y + 1 > topWater) topWater = y + 1;
          } else if (isLava(id)) {
            lava = true;
          }
        }
      }
    }
    this.inWater = water;
    this.inLava = lava;
    this.submersion = water
      ? Math.max(0, Math.min(1, (topWater - p.y) / this.def.height))
      : 0;
  }

  // Exact swept AABB move along one axis (the PlayerBody scan without the
  // cactus-inset refinement — mobs treat every solid cell as a full cube).
  _sweep(axis, amount) {
    if (amount === 0) return false;
    const p = this.position;
    const hw = this.def.width / 2;
    const min = [p.x - hw, p.y, p.z - hw];
    const max = [p.x + hw, p.y + this.def.height, p.z + hw];
    const dir = amount > 0 ? 1 : -1;
    const face = dir > 0 ? max[axis] : min[axis];
    const c0 = Math.floor(face + dir * EPS);
    const c1 = Math.floor(face + amount + dir * EPS);
    const u = (axis + 1) % 3;
    const w = (axis + 2) % 3;
    const u0 = Math.floor(min[u] + EPS);
    const u1 = Math.floor(max[u] - EPS);
    const w0 = Math.floor(min[w] + EPS);
    const w1 = Math.floor(max[w] - EPS);
    const cell = [0, 0, 0];
    for (let ci = c0; dir > 0 ? ci <= c1 : ci >= c1; ci += dir) {
      cell[axis] = ci;
      for (let ui = u0; ui <= u1; ui++) {
        cell[u] = ui;
        for (let wi = w0; wi <= w1; wi++) {
          cell[w] = wi;
          if (!blockDef(this.world.getBlock(cell[0], cell[1], cell[2])).solid) continue;
          let moved = (dir > 0 ? ci : ci + 1) - face;
          if (dir > 0 ? moved < 0 : moved > 0) moved = 0; // embedded: no shove
          p[AXIS[axis]] += moved;
          return true;
        }
      }
    }
    p[AXIS[axis]] += amount;
    return false;
  }

  // Horizontal move with the step-up retry: on a grounded wall hit, retry
  // from a raised start and keep whichever result travels farther.
  _moveHorizontal(dx, dz) {
    if (dx === 0 && dz === 0) return { x: false, z: false };
    const p = this.position;
    const sx = p.x;
    const sy = p.y;
    const sz = p.z;
    const hx = this._sweep(0, dx);
    const hz = this._sweep(2, dz);
    if ((hx || hz) && this.onGround) {
      const fx = p.x;
      const fy = p.y;
      const fz = p.z;
      const flatD = (fx - sx) ** 2 + (fz - sz) ** 2;
      p.x = sx;
      p.y = sy;
      p.z = sz;
      this._sweep(1, MOBS.STEP_HEIGHT);
      const raised = p.y - sy;
      const shx = this._sweep(0, dx);
      const shz = this._sweep(2, dz);
      const settled = this._sweep(1, -raised);
      const stepD = (p.x - sx) ** 2 + (p.z - sz) ** 2;
      if (raised > 0 && stepD > flatD + 1e-9) {
        if (settled) this.onGround = true;
        return { x: shx, z: shz };
      }
      p.x = fx;
      p.y = fy;
      p.z = fz;
    }
    return { x: hx, z: hz };
  }
}
