// player/controller.js — Phase 5: the player. An AABB body with vanilla-feel
// movement physics (walk/sprint/sneak/jump, 1-block auto-step, swimming with
// buoyancy and a breath meter), exact swept collision against world blocks,
// and the first-person pointer-lock camera at eye height. The Phase 1 debug
// fly camera lives on inside this controller behind DEBUG.FLY_TOGGLE_CODE.
//
// Three parts:
//   PlayerBody              pure physics — no DOM, no three.js types, so node
//                           tests can construct one and step it directly
//   findSpawnPosition       safe surface spawn search
//   createPlayerController  input + camera wrapper used by main.js

import * as THREE from 'three';
import { PLAYER, DEBUG, OVERWORLD } from '../config.js';
import { BLOCK, blockDef, isSolid } from '../world/blocks.js';

const HALF_WIDTH = PLAYER.WIDTH / 2;
const AXIS = ['x', 'y', 'z'];
// Keys the game consumes while pointer-locked. Their keydown default is
// prevented so browser shortcuts riding them (Ctrl+S save, Ctrl+D bookmark,
// Space scroll) can't fire mid-game. Reserved chords like Ctrl+W can't be
// prevented — the hint steers players toward double-tap sprint instead.
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
]);
// Cell-boundary bias: keeps faces resting exactly on integer planes from
// rounding into the neighbouring cell.
const EPS = 1e-7;

// ---------------------------------------------------------------------------
// PlayerBody — physics state stepped against the voxel world
// ---------------------------------------------------------------------------

export class PlayerBody {
  constructor(world, spawn) {
    this.world = world;
    this.position = { x: spawn.x, y: spawn.y, z: spawn.z }; // feet centre
    this.velocity = { x: 0, y: 0, z: 0 };
    this.onGround = false;
    this.sneaking = false;
    this.sprinting = false;
    this.touchingWater = false;   // any part of the box overlaps water
    this.swimming = false;        // deep enough that water physics take over
    this.swimSprinting = false;   // vanilla swim mechanic: sprinting submerged
    this.submersion = 0;          // fraction of body height under the waterline
    this.eyeInWater = false;
    this._standingEyeInWater = false; // water at full standing eye height
    this.maxBreath = PLAYER.BREATH_SECONDS;
    this.breath = this.maxBreath;
    this.fallDistance = 0;        // blocks fallen so far while airborne
    this.lastLanding = 0;         // fall distance of a landing this step (for stats)
    this.lastStepUp = 0;          // height auto-stepped this step (camera smoothing)
    this.horizontalSpeed = 0;     // actual blocks/s moved this step (view bob)
    this._fallStartY = spawn.y;
    this._jumpTimer = PLAYER.JUMP_COOLDOWN_SECONDS; // ready to jump at spawn
  }

  // input: { forward: -1..1, strafe: -1..1, yaw, pitch, jump, sneak, sprint }
  // where sprint is intent (key held / double-tap latch); the body applies
  // the vanilla rules for whether it actually takes effect. pitch (radians,
  // positive looking up) only steers the swim-sprint mechanic.
  step(input, dt) {
    if (dt <= 0) return;
    const p = this.position;
    const v = this.velocity;
    const c = PLAYER;
    this.lastLanding = 0;
    this.lastStepUp = 0;
    this._jumpTimer += dt;

    this._senseWater();
    this.sneaking = !!input.sneak;
    const moving = input.forward !== 0 || input.strafe !== 0;
    this.sprinting =
      !!input.sprint && input.forward > 0 && !this.sneaking && !this.swimming;
    // Vanilla swim mechanic: sprinting while fully submerged tips the body
    // prone and swims fast toward the look direction. Entry AND persistence
    // key off the STANDING eye height (previous step's sense) — if a
    // full-height head would be above the surface, the prone mode drops, so
    // surface swimming can't self-sustain on its own lowered eye and drain
    // breath forever.
    this.swimSprinting =
      !!input.sprint && input.forward > 0 && !this.sneaking &&
      this.swimming && this._standingEyeInWater;

    // Wish direction on the horizontal plane, camera-yaw relative
    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);
    let wx = -sin * input.forward + cos * input.strafe;
    let wz = -cos * input.forward - sin * input.strafe;
    const wishLen = Math.hypot(wx, wz);
    if (wishLen > 1) {
      wx /= wishLen;
      wz /= wishLen;
    }

    let targetSpeed = c.WALK_SPEED;
    if (this.swimming) {
      targetSpeed = this.swimSprinting ? c.SWIM_SPRINT_SPEED : c.SWIM_SPEED;
    } else if (this.sneaking) targetSpeed = c.SNEAK_SPEED;
    else if (this.sprinting) targetSpeed = c.SPRINT_SPEED;
    // Swim-sprinting follows the look pitch: the horizontal share shrinks as
    // the vertical share (applied below) grows.
    if (this.swimSprinting) {
      const cosPitch = Math.cos(input.pitch || 0);
      wx *= cosPitch;
      wz *= cosPitch;
    }
    const under = blockDef(
      this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z)),
    );
    if (under.slows) targetSpeed *= c.SLOW_BLOCK_FACTOR;

    // Horizontal velocity. On the ground (and in water) an exponential
    // approach to the wanted velocity plays both acceleration and friction,
    // framerate-independently; airborne there is only weak steering and drag.
    if (this.swimming || this.onGround) {
      const rate = this.swimming ? c.WATER_RESPONSE : c.GROUND_RESPONSE;
      const k = 1 - Math.exp(-rate * dt);
      v.x += (wx * targetSpeed - v.x) * k;
      v.z += (wz * targetSpeed - v.z) * k;
    } else {
      const accel = c.AIR_ACCEL * (targetSpeed / c.WALK_SPEED);
      v.x += wx * accel * dt;
      v.z += wz * accel * dt;
      const drag = Math.exp(-c.AIR_DRAG * dt);
      v.x *= drag;
      v.z *= drag;
    }

    // Vertical velocity. In air, integrate the position with the midpoint
    // velocity — exact for constant gravity at any framerate, so jump height
    // and fall speed don't shrink at low fps.
    let dy;
    const canJump =
      input.jump && this.onGround && this._jumpTimer >= c.JUMP_COOLDOWN_SECONDS;
    if (this.touchingWater) {
      // While ANY part of the body is in water, space swims upward slowly —
      // never a normal jump (even grounded in a shallow pool). Climbing out
      // onto a bank rides the water exit hop below instead.
      if (this.swimSprinting) {
        // Swim toward the look direction (vanilla swim): velocity approaches
        // the pitch-driven vertical wish; jump/sneak still steer up/down.
        const k = 1 - Math.exp(-c.WATER_RESPONSE * dt);
        const wishY = Math.sin(input.pitch || 0) * c.SWIM_SPRINT_SPEED;
        v.y += (wishY - v.y) * k;
        if (input.jump) v.y += c.SWIM_UP_ACCEL * dt;
        if (input.sneak) v.y -= c.SWIM_DOWN_ACCEL * dt;
      } else {
        // A dry centre column (submersion 0 — only a box corner clips the
        // pool) keeps full gravity and no swim thrust: space still never
        // jumps, but it can't levitate the player over dry land either.
        const submerged = this.submersion > 0;
        let a = submerged
          ? -c.WATER_GRAVITY * (1 - c.WATER_BUOYANCY * this.submersion)
          : -c.GRAVITY;
        if (input.jump && submerged) a += c.SWIM_UP_ACCEL;
        if (input.sneak && submerged) a -= c.SWIM_DOWN_ACCEL;
        v.y += a * dt;
        v.y *= Math.exp(-c.WATER_DRAG * dt);
      }
      dy = v.y * dt;
    } else {
      if (canJump) {
        v.y = c.JUMP_VELOCITY;
        this._jumpTimer = 0;
        if (this.sprinting) {
          // Vanilla sprint-jump boost, along the facing direction
          v.x += -sin * c.SPRINT_JUMP_BOOST;
          v.z += -cos * c.SPRINT_JUMP_BOOST;
        }
      }
      const vy0 = v.y;
      v.y -= c.GRAVITY * dt;
      if (v.y < -c.TERMINAL_VELOCITY) v.y = -c.TERMINAL_VELOCITY;
      dy = ((vy0 + v.y) / 2) * dt;
    }

    // Integrate and collide: Y first, then the horizontal axes (vanilla
    // order). Grounding is decided by the direction of travel: a downward
    // hit is a landing, an upward hit is a ceiling — never grounded (else a
    // head bump in a 2-high tunnel leaves a stale onGround and holding jump
    // pins the player to the ceiling, re-applying jump every frame).
    const hitY = this._sweep(1, dy);
    if (hitY) {
      this.onGround = dy < 0;
      v.y = 0;
    } else if (dy !== 0) {
      this.onGround = false;
    }

    let dx = v.x * dt;
    let dz = v.z * dt;
    if (this.sneaking && this.onGround) [dx, dz] = this._clampToLedge(dx, dz);
    const beforeX = p.x;
    const beforeZ = p.z;
    const hit = this._moveHorizontal(dx, dz);
    if (hit.x) v.x = 0;
    if (hit.z) v.z = 0;

    // Climbing out of water: hop upward when pressing into a bank (vanilla
    // re-applies this every tick). The hop keeps working while any part of
    // the body still clips water — not just while fully swimming — so the
    // exit arc can't stall short of the bank lip at high framerates.
    // Grounded wading is excluded (no bouncing off cliffs in knee-deep
    // water), as is a fast plunge straight after a dive.
    const canWaterHop = this.swimming || (this.touchingWater && !this.onGround);
    if (
      canWaterHop && (hit.x || hit.z) && moving &&
      v.y < c.WATER_EXIT_JUMP && v.y > -c.WATER_EXIT_JUMP
    ) {
      v.y = c.WATER_EXIT_JUMP;
    }

    // Fall tracking (fall damage itself is applied by the stats phase)
    if (this.touchingWater || this.onGround) {
      if (this.onGround && !this.touchingWater && this.fallDistance > 0) {
        // Measure from the fall's start height so the landing step's final
        // partial move is included.
        this.lastLanding = Math.max(0, this._fallStartY - p.y);
      }
      this.fallDistance = 0;
      this._fallStartY = p.y;
    } else {
      if (p.y > this._fallStartY) this._fallStartY = p.y;
      this.fallDistance = this._fallStartY - p.y;
    }

    // Breath (the prone swim-sprint body carries its eye much lower)
    const eyeY = p.y + (this.swimSprinting ? c.SWIM_EYE_HEIGHT
      : this.sneaking ? c.SNEAK_EYE_HEIGHT : c.EYE_HEIGHT);
    this.eyeInWater =
      this.world.getBlock(Math.floor(p.x), Math.floor(eyeY), Math.floor(p.z)) ===
      BLOCK.WATER;
    // Sensed at the full standing eye regardless of pose — the swim-sprint
    // gate above reads this next step.
    this._standingEyeInWater =
      this.world.getBlock(
        Math.floor(p.x), Math.floor(p.y + c.EYE_HEIGHT), Math.floor(p.z),
      ) === BLOCK.WATER;
    this.breath = this.eyeInWater
      ? Math.max(0, this.breath - dt)
      : Math.min(this.maxBreath, this.breath + dt * c.BREATH_REFILL_RATE);

    this.horizontalSpeed = Math.hypot(p.x - beforeX, p.z - beforeZ) / dt;
  }

  // Does the body's box overlap any solid block? (spawn/unstick safety check)
  intersectsSolid() {
    const p = this.position;
    return this._anyInBox(
      p.x - HALF_WIDTH, p.y, p.z - HALF_WIDTH,
      p.x + HALF_WIDTH, p.y + PLAYER.HEIGHT, p.z + HALF_WIDTH,
      isSolid,
    );
  }

  // Exact swept AABB move along one axis: scans every cell layer the box
  // crosses in movement order, so no speed can tunnel through a wall. On a
  // hit the face clamps flush against the block and the move stops there.
  // Blocks with a horizontal `inset` (cactus) collide as their narrower box:
  // the blocking plane moves into the cell and the transverse overlap test
  // shrinks, so the body slides past — or falls off — the 1/16 rim instead of
  // snagging on it. Returns true if it collided.
  _sweep(axis, amount) {
    if (amount === 0) return false;
    const p = this.position;
    const min = [p.x - HALF_WIDTH, p.y, p.z - HALF_WIDTH];
    const max = [p.x + HALF_WIDTH, p.y + PLAYER.HEIGHT, p.z + HALF_WIDTH];
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
      // Nearest blocking plane in this layer — planes differ where full
      // cubes and inset boxes mix, so the whole layer is scanned.
      let plane = null;
      for (let ui = u0; ui <= u1; ui++) {
        cell[u] = ui;
        for (let wi = w0; wi <= w1; wi++) {
          cell[w] = wi;
          const def = blockDef(this.world.getBlock(cell[0], cell[1], cell[2]));
          if (!def.solid) continue;
          let candidate;
          if (def.inset > 0) {
            // Skip when the body misses the narrowed box on a transverse
            // horizontal axis, or can't reach its face this step.
            if (u !== 1 && (min[u] >= cell[u] + 1 - def.inset - EPS ||
                            max[u] <= cell[u] + def.inset + EPS)) continue;
            if (w !== 1 && (min[w] >= cell[w] + 1 - def.inset - EPS ||
                            max[w] <= cell[w] + def.inset + EPS)) continue;
            const boxInset = axis === 1 ? 0 : def.inset;
            candidate = dir > 0 ? ci + boxInset : ci + 1 - boxInset;
            if (dir > 0 ? candidate - face > amount : candidate - face < amount) continue;
          } else {
            candidate = dir > 0 ? ci : ci + 1;
          }
          if (plane === null || (dir > 0 ? candidate < plane : candidate > plane)) {
            plane = candidate;
          }
        }
      }
      if (plane !== null) {
        let moved = plane - face;
        // A layer behind the face can only test solid if the body is
        // already embedded; never shove it backwards.
        if (dir > 0 ? moved < 0 : moved > 0) moved = 0;
        p[AXIS[axis]] += moved;
        return true;
      }
    }
    p[AXIS[axis]] += amount;
    return false;
  }

  // Horizontal move with the 1-block auto-step: if the flat move hits a wall
  // while grounded, retry from a raised start and keep whichever result
  // travels farther.
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
      this._sweep(1, PLAYER.STEP_HEIGHT);
      const raised = p.y - sy;
      const shx = this._sweep(0, dx);
      const shz = this._sweep(2, dz);
      const settled = this._sweep(1, -raised); // settle down onto the step
      const stepD = (p.x - sx) ** 2 + (p.z - sz) ** 2;
      if (raised > 0 && stepD > flatD + 1e-9) {
        if (settled) this.onGround = true;
        if (p.y > sy) this.lastStepUp = p.y - sy;
        return { x: shx, z: shz };
      }
      p.x = fx;
      p.y = fy;
      p.z = fz;
    }
    return { x: hx, z: hz };
  }

  // Sneak edge guard (vanilla behaviour): shrink the move until the body
  // keeps some floor within SNEAK_EDGE_DROP below it — first each axis
  // alone, then the combination.
  _clampToLedge(dx, dz) {
    const inc = PLAYER.SNEAK_CLAMP_INCREMENT;
    const shrink = (a) => (Math.abs(a) <= inc ? 0 : a - Math.sign(a) * inc);
    while (dx !== 0 && !this._hasSupport(dx, 0)) dx = shrink(dx);
    while (dz !== 0 && !this._hasSupport(0, dz)) dz = shrink(dz);
    while (dx !== 0 && dz !== 0 && !this._hasSupport(dx, dz)) {
      dx = shrink(dx);
      dz = shrink(dz);
    }
    return [dx, dz];
  }

  // Support for the sneak guard is inset-aware: the 1/16 rim of a cactus
  // cell is NOT floor (the collision box isn't there), so sneaking refuses
  // to shuffle onto it instead of walking off the box and falling.
  _hasSupport(dx, dz) {
    const p = this.position;
    const minX = p.x - HALF_WIDTH + dx;
    const maxX = p.x + HALF_WIDTH + dx;
    const minZ = p.z - HALF_WIDTH + dz;
    const maxZ = p.z + HALF_WIDTH + dz;
    const x0 = Math.floor(minX + EPS);
    const x1 = Math.floor(maxX - EPS);
    const y0 = Math.floor(p.y - PLAYER.SNEAK_EDGE_DROP + EPS);
    const y1 = Math.floor(p.y - EPS);
    const z0 = Math.floor(minZ + EPS);
    const z1 = Math.floor(maxZ - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const def = blockDef(this.world.getBlock(x, y, z));
          if (!def.solid) continue;
          if (def.inset > 0 && (
            minX >= x + 1 - def.inset - EPS || maxX <= x + def.inset + EPS ||
            minZ >= z + 1 - def.inset - EPS || maxZ <= z + def.inset + EPS)) continue;
          return true;
        }
      }
    }
    return false;
  }

  // Water state: touchingWater from the whole box; the waterline (and with it
  // submersion, which drives buoyancy) from the body's centre column.
  _senseWater() {
    const p = this.position;
    this.touchingWater = this._anyInBox(
      p.x - HALF_WIDTH, p.y, p.z - HALF_WIDTH,
      p.x + HALF_WIDTH, p.y + PLAYER.HEIGHT, p.z + HALF_WIDTH,
      (id) => id === BLOCK.WATER,
    );
    let sub = 0;
    if (this.touchingWater) {
      const cx = Math.floor(p.x);
      const cz = Math.floor(p.z);
      const top = Math.floor(p.y + PLAYER.HEIGHT - EPS);
      for (let y = top; y >= Math.floor(p.y + EPS); y--) {
        if (this.world.getBlock(cx, y, cz) === BLOCK.WATER) {
          sub = Math.min(1, (y + 1 - p.y) / PLAYER.HEIGHT);
          break;
        }
      }
    }
    this.submersion = sub;
    this.swimming = sub >= PLAYER.SWIM_MIN_SUBMERSION;
  }

  _anyInBox(minX, minY, minZ, maxX, maxY, maxZ, pred) {
    const x0 = Math.floor(minX + EPS);
    const x1 = Math.floor(maxX - EPS);
    const y0 = Math.floor(minY + EPS);
    const y1 = Math.floor(maxY - EPS);
    const z0 = Math.floor(minZ + EPS);
    const z1 = Math.floor(maxZ - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (pred(this.world.getBlock(x, y, z))) return true;
        }
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Safe spawn: nearest surface column to PLAYER.SPAWN that is dry land with
// standing clearance — never inside terrain, never in the air, never in water.
// ---------------------------------------------------------------------------

export function findSpawnPosition(world, overrides = {}) {
  const { X, Z, SEARCH_RADIUS } = { ...PLAYER.SPAWN, ...overrides };
  for (let r = 0; r <= SEARCH_RADIUS; r++) {
    for (const [x, z] of ringCells(X, Z, r)) {
      const y = world.getHighestSolidY(x, z);
      if (y < OVERWORLD.SEA_LEVEL) continue; // below sea level — underwater
      const ground = blockDef(world.getBlock(x, y, z));
      if (ground.damagesOnContact) continue; // not on a cactus
      if (ground.id === BLOCK.OAK_LEAVES) continue; // not on a tree canopy
      if (isSolid(world.getBlock(x, y + 1, z))) continue;
      if (isSolid(world.getBlock(x, y + 2, z))) continue; // 1.8 needs 2 clear
      return { x: x + 0.5, y: y + 1, z: z + 0.5 };
    }
  }
  // No candidate in range (should not happen on real terrain): stand on the
  // configured column's surface, whatever it is.
  const y = world.getHighestSolidY(X, Z);
  return { x: X + 0.5, y: y + 1, z: Z + 0.5 };
}

function* ringCells(cx, cz, r) {
  if (r === 0) {
    yield [cx, cz];
    return;
  }
  for (let dx = -r; dx <= r; dx++) {
    yield [cx + dx, cz - r];
    yield [cx + dx, cz + r];
  }
  for (let dz = -r + 1; dz <= r - 1; dz++) {
    yield [cx - r, cz + dz];
    yield [cx + r, cz + dz];
  }
}

// ---------------------------------------------------------------------------
// Controller — pointer-lock input and the first-person camera around a body
// ---------------------------------------------------------------------------

export function createPlayerController({ world, camera, canvas }) {
  const body = new PlayerBody(world, findSpawnPosition(world));
  const keys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const maxPitch = Math.PI / 2 - PLAYER.PITCH_MARGIN;
  let yaw = 0;
  let pitch = 0;
  let mode = 'walk'; // 'walk' | 'fly' (the old debug camera, behind a toggle)
  let sprintLatch = false;
  let lastForwardTap = -Infinity;
  let eyeHeight = PLAYER.EYE_HEIGHT;
  let stepSmooth = 0; // camera offset easing out after an auto-step
  let bobPhase = 0;
  let bobIntensity = 0;
  const baseFov = camera.fov;
  let fov = camera.fov;
  let inputOverride = false; // dev/test scaffolding: accept input without lock
  const hint = document.getElementById('lock-hint');

  const locked = () => document.pointerLockElement === canvas || inputOverride;

  canvas.addEventListener('click', () => {
    if (document.pointerLockElement === canvas) return;
    // Browsers enforce a ~1.3s cooldown after Esc exits the lock; the
    // request may reject (an unhandled promise rejection in Chromium).
    // Swallow it — the hint stays up and the next click retries.
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  });

  document.addEventListener('pointerlockchange', () => {
    const isLocked = document.pointerLockElement === canvas;
    if (hint) hint.classList.toggle('hidden', isLocked);
    if (!isLocked) {
      keys.clear();
      sprintLatch = false;
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!locked()) return;
    yaw -= e.movementX * PLAYER.MOUSE_SENSITIVITY;
    pitch -= e.movementY * PLAYER.MOUSE_SENSITIVITY;
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
  });

  document.addEventListener('keydown', (e) => {
    if (!locked()) return;
    if (GAME_KEYS.has(e.code) || e.code === DEBUG.FLY_TOGGLE_CODE) e.preventDefault();
    if (e.code === DEBUG.FLY_TOGGLE_CODE) {
      if (!e.repeat) toggleFly();
      return;
    }
    if (e.code === 'KeyW' && !e.repeat && !keys.has('KeyW')) {
      const now = performance.now() / 1000;
      if (now - lastForwardTap <= PLAYER.SPRINT_DOUBLE_TAP_SECONDS) sprintLatch = true;
      lastForwardTap = now;
    }
    keys.add(e.code);
  });

  document.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'KeyW') sprintLatch = false;
  });

  function toggleFly() {
    mode = mode === 'walk' ? 'fly' : 'walk';
    body.velocity.x = 0;
    body.velocity.y = 0;
    body.velocity.z = 0;
    body.swimSprinting = false; // never carry the prone mode across a toggle
    body.sneaking = false; // fly never steps the body, so the flag would
                           // freeze — and interaction's use/place gate reads it
    if (mode === 'walk') {
      // Never re-enter walking inside terrain: lift to the nearest free spot
      let guard = 512;
      while (body.intersectsSolid() && guard-- > 0) body.position.y += 1;
    }
    body.onGround = false;
    body.fallDistance = 0;
    body._fallStartY = body.position.y;
  }

  // The old free-fly debug camera: no gravity, no collision
  function flyMove(dt) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let mx = 0;
    let my = 0;
    let mz = 0;
    if (keys.has('KeyW')) { mx += fx; mz += fz; }
    if (keys.has('KeyS')) { mx -= fx; mz -= fz; }
    if (keys.has('KeyD')) { mx += -fz; mz += fx; }
    if (keys.has('KeyA')) { mx -= -fz; mz -= fx; }
    if (keys.has('Space')) my += 1;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) my -= 1;
    const len = Math.hypot(mx, my, mz);
    if (len === 0) return;
    const fast = keys.has('ControlLeft') || keys.has('ControlRight');
    const speed = (fast ? DEBUG.FLY_SPEED_FAST : DEBUG.FLY_SPEED) / len;
    body.position.x += mx * speed * dt;
    body.position.y += my * speed * dt;
    body.position.z += mz * speed * dt;
  }

  function update(delta) {
    if (delta > 0) {
      if (mode === 'fly') {
        flyMove(delta);
        // Breath is meaningless while flying; recover it so the HUD meter
        // doesn't freeze mid-drained (body.step is not running).
        body.eyeInWater = false;
        body.breath = Math.min(
          body.maxBreath,
          body.breath + delta * PLAYER.BREATH_REFILL_RATE,
        );
      } else {
        body.step(
          {
            forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
            strafe: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
            yaw,
            pitch,
            jump: keys.has('Space'),
            sneak: keys.has('ShiftLeft') || keys.has('ShiftRight'),
            sprint:
              keys.has('ControlLeft') || keys.has('ControlRight') || sprintLatch,
          },
          delta,
        );
        if (body.lastStepUp > 0) stepSmooth += body.lastStepUp;
      }
    }
    syncCamera(delta);
  }

  function syncCamera(delta) {
    const p = body.position;
    const B = PLAYER.VIEW_BOB;
    let bobX = 0;
    let bobY = 0;
    if (delta > 0) {
      // Eye eases between stand/sneak/swim heights; auto-steps ease out
      const eyeTarget = mode !== 'walk' ? PLAYER.EYE_HEIGHT
        : body.swimSprinting ? PLAYER.SWIM_EYE_HEIGHT
        : body.sneaking ? PLAYER.SNEAK_EYE_HEIGHT
        : PLAYER.EYE_HEIGHT;
      eyeHeight += (eyeTarget - eyeHeight) * (1 - Math.exp(-PLAYER.EYE_LERP_RATE * delta));
      stepSmooth *= Math.exp(-PLAYER.STEP_SMOOTH_RATE * delta);
      if (stepSmooth < 0.001) stepSmooth = 0;
      // View bob rides the actual ground speed — never airborne, in water
      // or in fly mode
      const active = mode === 'walk' && body.onGround && !body.swimming;
      const target = active ? Math.min(1, body.horizontalSpeed / PLAYER.WALK_SPEED) : 0;
      bobIntensity += (target - bobIntensity) * (1 - Math.exp(-B.FADE_RATE * delta));
      if (active) bobPhase += body.horizontalSpeed * B.CYCLES_PER_BLOCK * delta;
    }
    const t = bobPhase * Math.PI * 2;
    bobX = Math.sin(t) * B.AMP_X * bobIntensity;
    bobY = -Math.abs(Math.cos(t)) * B.AMP_Y * bobIntensity;
    const rx = Math.cos(yaw); // camera-right on the horizontal plane
    const rz = -Math.sin(yaw);
    camera.position.set(
      p.x + rx * bobX,
      p.y + eyeHeight - stepSmooth + bobY,
      p.z + rz * bobX,
    );
    camera.quaternion.setFromEuler(euler.set(pitch, yaw, 0, 'YXZ'));
    // Sprinting (on land or as a swim) widens the FOV a touch
    const fovTarget = baseFov +
      (mode === 'walk' && (body.sprinting || body.swimSprinting)
        ? PLAYER.SPRINT_FOV_BOOST : 0);
    if (delta > 0) fov += (fovTarget - fov) * (1 - Math.exp(-PLAYER.FOV_LERP_RATE * delta));
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  syncCamera(0); // put the camera at the spawn eye before the first frame

  return {
    update,
    body,
    get position() {
      return body.position;
    },
    get mode() {
      return mode;
    },
    get breath() {
      return body.breath;
    },
    get maxBreath() {
      return body.maxBreath;
    },
    toggleFly,
    // Dev scaffolding (console/tests): aim the view; accept input without
    // pointer lock so a headless harness can drive the keys.
    setView(newYaw, newPitch) {
      yaw = newYaw;
      pitch = Math.max(-maxPitch, Math.min(maxPitch, newPitch));
    },
    debugForceInput(on) {
      inputOverride = !!on;
    },
  };
}
