// player/body.js — PlayerBody and the safe-spawn search, split out of
// player/controller.js in Phase 21 per the ARCHITECTURE size cap (the
// shape-aware collision sweep and the ladder climb pushed that file to 904).
// Moved verbatim.
//
// PlayerBody is deliberately DOM-free and constructible in node with any
// `{ getBlock }` world — the physics test harness depends on that, and the
// split makes it explicit. It owns: the AABB body, vanilla-feel movement
// (walk/sprint/sneak/jump, the 1-block auto-step, swimming and the dense-lava
// crawl, Phase 21's ladder climb), and the exact swept collision against
// every block's COLLISION BOX LIST — the same lists the mesher renders from,
// so what a player sees is what they walk into.

import { PLAYER, OVERWORLD, SHIELD, CREATIVE } from '../config.js';
import {
  BLOCK, blockDef, isSolid, isLava, isWater, fluidHeight,
  collisionBoxesAt, hasCollision, isClimbable, MAX_COLLISION_OVERHANG,
  WALL_MOUNT_FACING, FACING_DELTA,
} from '../world/blocks.js';

// Fluid-cell predicates (Phase 12: flowing lava cells count as lava for
// every physics and damage sense; Phase 21 put flowing water on the same
// footing — a stream you can wade through is still water).
const isWaterCell = isWater;

const HALF_WIDTH = PLAYER.WIDTH / 2;
// How many extra cells the sweep looks "behind" a face: collision boxes can
// reach above their own cell (fences/walls/gates stand 1.5 blocks).
const OVERHANG_CELLS = Math.ceil(MAX_COLLISION_OVERHANG);
const AXIS = ['x', 'y', 'z'];
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
    this.touchingLava = false;    // any part of the box overlaps lava
    this.lavaSubmersion = 0;      // fraction of body height under the lava line
    this.eyeInLava = false;       // drives the submerged-lava overlay/fog
    this._standingEyeInWater = false; // water at full standing eye height
    this.onLadder = false;        // body overlaps a climbable block (Phase 21)
    this.ladderFacing = null;     // which way its rungs face ('N'|'S'|'E'|'W')
    this.climbing = false;        // actively driving up a ladder this step
    this.blocking = false;        // raised shield (set by player/interaction.js)
    // Creative flight (Phase 25). The controller owns WHEN this is true (it
    // is the thing that knows about game modes and key taps); the body owns
    // what flying DOES. Deliberately a plain field rather than an import of
    // player/gamemode.js, so this module stays the DOM-free, dependency-free
    // physics the node harness constructs directly.
    this.flying = false;
    // Bound once: the collision box lookups pass it to connection-shaped
    // blocks (fences/walls read their neighbours) every sweep.
    this._getBlock = (x, y, z) => this.world.getBlock(x, y, z);
    this.maxBreath = PLAYER.BREATH_SECONDS;
    this.breath = this.maxBreath;
    this.fallDistance = 0;        // blocks fallen so far while airborne
    this.lastLanding = 0;         // fall distance of a landing this step (for stats)
    this.lastJumped = false;      // a real jump started this step (one-frame,
                                  // for stats' jump exhaustion — knockback
                                  // pops and fluid exit hops don't count)
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
    if (this.flying) {
      this._stepFlight(input, dt);
      return;
    }
    const p = this.position;
    const v = this.velocity;
    const c = PLAYER;
    this.lastLanding = 0;
    this.lastJumped = false;
    this.lastStepUp = 0;
    this._jumpTimer += dt;

    this._senseWater();
    this._senseClimb();
    this.sneaking = !!input.sneak;
    const moving = input.forward !== 0 || input.strafe !== 0;
    this.sprinting =
      !!input.sprint && input.forward > 0 && !this.sneaking && !this.swimming &&
      !(this.touchingLava && this.lavaSubmersion > 0); // no sprint (or FOV
                                                       // kick) while crawling
                                                       // through lava
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

    // Lava is a dense fluid (Phase 10): whenever any of the body is below
    // the lava line, movement drops to a crawl, whatever else is going on.
    const inLava = this.touchingLava && this.lavaSubmersion > 0;
    let targetSpeed = c.WALK_SPEED;
    if (inLava) {
      targetSpeed = c.LAVA_SPEED;
    } else if (this.swimming) {
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
    // A raised shield slows the walk (vanilla), and climbing damps the
    // horizontal drift so the player hugs the ladder.
    if (this.blocking) targetSpeed *= SHIELD.SLOWDOWN;

    // Climbing (Phase 21): while the body overlaps a ladder, holding
    // forward INTO it (or jump) drives the player up; letting go slides
    // slowly down; sneaking pins them. Fluids win over ladders.
    const inFluid = this.touchingWater || (this.touchingLava && this.lavaSubmersion > 0);
    let climbInput = false;
    if (this.onLadder && !inFluid) {
      if (this.ladderFacing) {
        // The ladder's facing is its outward normal; pressing INTO the wall
        // is movement along -facing.
        const [fx, fz] = FACING_DELTA[this.ladderFacing];
        climbInput = (wx * -fx + wz * -fz) > 0.1;
      } else {
        climbInput = moving;
      }
      if (input.jump) climbInput = true;
    }
    this.climbing = this.onLadder && !inFluid;
    if (this.climbing) targetSpeed *= c.CLIMB_HORIZONTAL_FACTOR;

    // Horizontal velocity. On the ground (and in a fluid) an exponential
    // approach to the wanted velocity plays both acceleration and friction,
    // framerate-independently; airborne there is only weak steering and drag.
    if (inLava || this.swimming || this.onGround) {
      const rate = inLava && !this.onGround ? c.LAVA_RESPONSE
        : this.swimming ? c.WATER_RESPONSE
        : c.GROUND_RESPONSE;
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
    if (this.climbing) {
      // Ladder motion is a velocity, not an acceleration (vanilla): no
      // gravity while attached, so the climb never gets faster.
      if (climbInput) v.y = c.CLIMB_SPEED;
      else if (this.sneaking) v.y = c.CLIMB_HOLD_SPEED;
      else v.y = Math.max(v.y, -c.CLIMB_DOWN_SPEED);
      dy = v.y * dt;
    } else if (inLava && (this.lavaSubmersion >= c.SWIM_MIN_SUBMERSION || !this.onGround)) {
      // Dense lava: strong drag kills any entry plunge within a fraction of
      // a second, buoyancy is neutral at full submersion, so the body sinks
      // slowly and only partially — it drifts just under the surface rather
      // than dropping to the floor. Jump/sneak rise and dive slowly (rising
      // out of a waist-deep puddle takes about a second, plus the bank exit
      // hop). Only a grounded edge-graze — the centre column dry, lava just
      // clipping a corner — falls through to the normal-jump branch below.
      let a = -c.LAVA_GRAVITY * (1 - c.LAVA_BUOYANCY * this.lavaSubmersion);
      if (input.jump) a += c.LAVA_UP_ACCEL;
      if (input.sneak) a -= c.LAVA_DOWN_ACCEL;
      v.y += a * dt;
      v.y *= Math.exp(-c.LAVA_DRAG * dt);
      dy = v.y * dt;
    } else if (this.touchingWater) {
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
        this.lastJumped = true;
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

    // Climbing out of a fluid: hop upward when pressing into a bank
    // (vanilla re-applies this every tick; lava climbs out the same way).
    // The hop keeps working while any part of the body still clips the
    // fluid — not just while fully swimming — so the exit arc can't stall
    // short of the bank lip at high framerates. Grounded wading is excluded
    // (no bouncing off cliffs in knee-deep water), as is a fast plunge
    // straight after a dive.
    const canFluidHop =
      this.swimming || ((this.touchingWater || inLava) && !this.onGround);
    if (
      canFluidHop && (hit.x || hit.z) && moving &&
      v.y < c.WATER_EXIT_JUMP && v.y > -c.WATER_EXIT_JUMP
    ) {
      v.y = c.WATER_EXIT_JUMP;
    }

    // Fall tracking (fall damage itself is applied by the stats phase);
    // both fluids break a fall — landing INTO either reports no drop
    // (otherwise a 1-deep lava puddle would add full fall damage on top of
    // contact damage at some framerates and not others). Re-sense fluids at
    // the POST-move position first: a single fast step (terminal velocity,
    // or a clamped 0.1s hitch frame) can carry the feet from above a pool
    // all the way to its floor, and the start-of-step sense would still say
    // "dry" on that landing frame — full fall damage into a pond.
    this._senseWater();
    // A ladder breaks a fall the moment it is grabbed (vanilla), so a climb
    // down never lands as a drop.
    if (this.climbing) {
      this.fallDistance = 0;
      this._fallStartY = p.y;
    }
    if (this.touchingWater || this.touchingLava || this.onGround) {
      if (this.onGround && !this.touchingWater && !this.touchingLava &&
          this.fallDistance > 0) {
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
    const eyeBlock =
      this.world.getBlock(Math.floor(p.x), Math.floor(eyeY), Math.floor(p.z));
    this.eyeInWater = isWaterCell(eyeBlock);
    this.eyeInLava = isLava(eyeBlock);
    // Sensed at the full standing eye regardless of pose — the swim-sprint
    // gate above reads this next step.
    this._standingEyeInWater = isWater(
      this.world.getBlock(
        Math.floor(p.x), Math.floor(p.y + c.EYE_HEIGHT), Math.floor(p.z),
      ),
    );
    this.breath = this.eyeInWater
      ? Math.max(0, this.breath - dt)
      : Math.min(this.maxBreath, this.breath + dt * c.BREATH_REFILL_RATE);

    this.horizontalSpeed = Math.hypot(p.x - beforeX, p.z - beforeZ) / dt;
  }

  // Creative flight (Phase 25). Gravity, buoyancy, jumping, ladders and the
  // ground/air split are all replaced by one rule: velocity chases a wanted
  // velocity in all three axes and decays toward zero without input. The
  // move itself still goes through the SAME swept collision as walking
  // (CREATIVE.FLY_COLLIDES — vanilla creative flight is flight, not
  // spectator noclip), so a flying player can't pass through the world.
  //
  // Vanilla behaviours kept: sprinting doubles the pace; landing on the
  // ground ends the flight; fall distance never accrues; water and lava are
  // sensed (the eye overlay and fog still work under the surface) but their
  // physics never take over.
  _stepFlight(input, dt) {
    const p = this.position;
    const v = this.velocity;
    const F = CREATIVE;
    this.lastLanding = 0;
    this.lastJumped = false;
    this.lastStepUp = 0;
    this._jumpTimer += dt;
    this._senseWater();
    this._senseClimb();
    // Poses that only make sense on foot or in water are off while flying:
    // shift is "descend", not "sneak", and the prone swim never applies.
    this.sneaking = false;
    this.climbing = false;
    this.swimming = false;
    this.swimSprinting = false;
    this.sprinting = !!input.sprint && input.forward > 0;

    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);
    let wx = -sin * input.forward + cos * input.strafe;
    let wz = -cos * input.forward - sin * input.strafe;
    const wishLen = Math.hypot(wx, wz);
    if (wishLen > 1) {
      wx /= wishLen;
      wz /= wishLen;
    }
    const boost = this.sprinting ? F.FLY_SPRINT_MULTIPLIER : 1;
    const k = 1 - Math.exp(-F.FLY_RESPONSE * dt);
    const glide = Math.exp(-F.FLY_DRAG * dt);
    if (wishLen > 0) {
      const speed = F.FLY_SPEED * boost;
      v.x += (wx * speed - v.x) * k;
      v.z += (wz * speed - v.z) * k;
    } else {
      v.x *= glide;
      v.z *= glide;
    }
    const up = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
    if (up !== 0) v.y += (up * F.FLY_VERTICAL_SPEED * boost - v.y) * k;
    else v.y *= glide;

    const beforeX = p.x;
    const beforeZ = p.z;
    if (F.FLY_COLLIDES) {
      const dy = v.y * dt;
      const hitY = this._sweep(1, dy);
      if (hitY) {
        // Touching down ends the flight, exactly like vanilla — descending
        // onto the ground drops you back into walking.
        if (dy < 0) {
          this.onGround = true;
          this.flying = false;
        }
        v.y = 0;
      } else if (dy !== 0) {
        this.onGround = false;
      }
      const hit = this._moveHorizontal(v.x * dt, v.z * dt);
      if (hit.x) v.x = 0;
      if (hit.z) v.z = 0;
    } else {
      p.x += v.x * dt;
      p.y += v.y * dt;
      p.z += v.z * dt;
      this.onGround = false;
    }

    // A flight never becomes a fall: switching flight off mid-air drops the
    // player from wherever they are with a clean slate, and creative takes
    // no fall damage anyway.
    this.fallDistance = 0;
    this._fallStartY = p.y;
    this._senseWater();
    const eyeY = p.y + PLAYER.EYE_HEIGHT;
    const eyeBlock =
      this.world.getBlock(Math.floor(p.x), Math.floor(eyeY), Math.floor(p.z));
    this.eyeInWater = isWaterCell(eyeBlock);
    this.eyeInLava = isLava(eyeBlock);
    this._standingEyeInWater = this.eyeInWater;
    // Breath stays full: creative cannot drown, and a drained meter carried
    // back into survival would drown the player the instant they switched.
    this.breath = this.maxBreath;
    this.horizontalSpeed = Math.hypot(p.x - beforeX, p.z - beforeZ) / dt;
  }

  // Does the body's box overlap any block's collision box? (spawn/unstick
  // safety check — Phase 21: shape-aware, so a slab floor isn't "inside
  // terrain")
  intersectsSolid() {
    const p = this.position;
    const minX = p.x - HALF_WIDTH;
    const maxX = p.x + HALF_WIDTH;
    const minZ = p.z - HALF_WIDTH;
    const maxZ = p.z + HALF_WIDTH;
    const x0 = Math.floor(minX + EPS);
    const x1 = Math.floor(maxX - EPS);
    const y0 = Math.floor(p.y + EPS) - OVERHANG_CELLS;
    const y1 = Math.floor(p.y + PLAYER.HEIGHT - EPS);
    const z0 = Math.floor(minZ + EPS);
    const z1 = Math.floor(maxZ - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = this.world.getBlock(x, y, z);
          if (!hasCollision(id)) continue;
          for (const b of collisionBoxesAt(id, this._getBlock, x, y, z)) {
            if (minX >= x + b[3] - EPS || maxX <= x + b[0] + EPS) continue;
            if (p.y >= y + b[4] - EPS || p.y + PLAYER.HEIGHT <= y + b[1] + EPS) continue;
            if (minZ >= z + b[5] - EPS || maxZ <= z + b[2] + EPS) continue;
            return true;
          }
        }
      }
    }
    return false;
  }

  // Exact swept AABB move along one axis: scans every cell layer the box
  // crosses in movement order, so no speed can tunnel through a wall. On a
  // hit the face clamps flush against the nearest blocking box and the move
  // stops there.
  //
  // Phase 21: every block collides as its BOX LIST (world/blocks.js
  // collisionBoxesAt) — the same list the mesher renders. A full cube is one
  // [0,0,0,1,1,1] box, a cactus its inset box, a slab a half-height box, a
  // stair two boxes, a fence its post plus the arms it actually connects to.
  // Boxes may stand taller than their own cell (fences reach 1.5), so a
  // downward sweep scans OVERHANG_CELLS further and a horizontal sweep
  // starts its vertical transverse range that much lower. Returns true if it
  // collided.
  _sweep(axis, amount) {
    if (amount === 0) return false;
    const p = this.position;
    const min = [p.x - HALF_WIDTH, p.y, p.z - HALF_WIDTH];
    const max = [p.x + HALF_WIDTH, p.y + PLAYER.HEIGHT, p.z + HALF_WIDTH];
    const dir = amount > 0 ? 1 : -1;
    const face = dir > 0 ? max[axis] : min[axis];
    const c0 = Math.floor(face + dir * EPS);
    let c1 = Math.floor(face + amount + dir * EPS);
    // A tall box in a cell the face has already passed can still block it.
    if (dir < 0) c1 -= OVERHANG_CELLS;
    const u = (axis + 1) % 3;
    const w = (axis + 2) % 3;
    const u0 = Math.floor(min[u] + EPS) - (u === 1 ? OVERHANG_CELLS : 0);
    const u1 = Math.floor(max[u] - EPS);
    const w0 = Math.floor(min[w] + EPS) - (w === 1 ? OVERHANG_CELLS : 0);
    const w1 = Math.floor(max[w] - EPS);
    const cell = [0, 0, 0];
    const getBlock = this._getBlock;
    for (let ci = c0; dir > 0 ? ci <= c1 : ci >= c1; ci += dir) {
      cell[axis] = ci;
      // Nearest blocking plane in this layer — planes differ wherever cubes
      // and part-cell shapes mix, so the whole layer is scanned.
      let plane = null;
      for (let ui = u0; ui <= u1; ui++) {
        cell[u] = ui;
        for (let wi = w0; wi <= w1; wi++) {
          cell[w] = wi;
          const id = this.world.getBlock(cell[0], cell[1], cell[2]);
          if (!hasCollision(id)) continue;
          const boxes = collisionBoxesAt(id, getBlock, cell[0], cell[1], cell[2]);
          for (const b of boxes) {
            // The body must overlap the box on BOTH transverse axes to be
            // stopped by it.
            if (min[u] >= cell[u] + b[u + 3] - EPS ||
                max[u] <= cell[u] + b[u] + EPS) continue;
            if (min[w] >= cell[w] + b[w + 3] - EPS ||
                max[w] <= cell[w] + b[w] + EPS) continue;
            const candidate = dir > 0 ? ci + b[axis] : ci + b[axis + 3];
            // Past this step's reach, or behind the face entirely.
            if (dir > 0 ? candidate - face > amount : candidate - face < amount) continue;
            if (plane === null || (dir > 0 ? candidate < plane : candidate > plane)) {
              plane = candidate;
            }
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

  // Support for the sneak guard is SHAPE-aware: the 1/16 rim of a cactus
  // cell is NOT floor, and neither is the air over a slab's missing top
  // half, so sneaking refuses to shuffle onto them instead of walking off
  // the box and falling. A box counts as support when its TOP lands inside
  // the drop window under the feet.
  _hasSupport(dx, dz) {
    const p = this.position;
    const minX = p.x - HALF_WIDTH + dx;
    const maxX = p.x + HALF_WIDTH + dx;
    const minZ = p.z - HALF_WIDTH + dz;
    const maxZ = p.z + HALF_WIDTH + dz;
    const x0 = Math.floor(minX + EPS);
    const x1 = Math.floor(maxX - EPS);
    const y0 = Math.floor(p.y - PLAYER.SNEAK_EDGE_DROP + EPS) - OVERHANG_CELLS;
    const y1 = Math.floor(p.y - EPS);
    const z0 = Math.floor(minZ + EPS);
    const z1 = Math.floor(maxZ - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = this.world.getBlock(x, y, z);
          if (!hasCollision(id)) continue;
          for (const b of collisionBoxesAt(id, this._getBlock, x, y, z)) {
            const top = y + b[4];
            if (top > p.y + EPS || top < p.y - PLAYER.SNEAK_EDGE_DROP - EPS) continue;
            if (minX >= x + b[3] - EPS || maxX <= x + b[0] + EPS) continue;
            if (minZ >= z + b[5] - EPS || maxZ <= z + b[2] + EPS) continue;
            return true;
          }
        }
      }
    }
    return false;
  }

  // Climbable blocks (ladders) overlapping the body: records whether the
  // player is on one and which way its rungs face, for the climb rules in
  // step(). Vanilla is generous about the horizontal reach, so the sample
  // box is the body inflated by CLIMB_MARGIN.
  _senseClimb() {
    const p = this.position;
    const m = PLAYER.CLIMB_MARGIN;
    const x0 = Math.floor(p.x - HALF_WIDTH - m + EPS);
    const x1 = Math.floor(p.x + HALF_WIDTH + m - EPS);
    const y0 = Math.floor(p.y + EPS);
    const y1 = Math.floor(p.y + PLAYER.HEIGHT - EPS);
    const z0 = Math.floor(p.z - HALF_WIDTH - m + EPS);
    const z1 = Math.floor(p.z + HALF_WIDTH + m - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = this.world.getBlock(x, y, z);
          if (!isClimbable(id)) continue;
          this.onLadder = true;
          this.ladderFacing = WALL_MOUNT_FACING[id] ?? null;
          return;
        }
      }
    }
    this.onLadder = false;
    this.ladderFacing = null;
  }

  // Fluid state: touchingWater/touchingLava from the whole box; each
  // fluid's line (and with it submersion, which drives buoyancy) from the
  // body's centre column. `swimming` (and the swim-sprint mechanic behind
  // it) stays water-only — lava is handled as a dense fluid in step().
  _senseWater() {
    const p = this.position;
    let water = false;
    let lava = false;
    this._anyInBox(
      p.x - HALF_WIDTH, p.y, p.z - HALF_WIDTH,
      p.x + HALF_WIDTH, p.y + PLAYER.HEIGHT, p.z + HALF_WIDTH,
      (id) => {
        if (isWaterCell(id)) water = true;
        else if (isLava(id)) lava = true;
        return water && lava; // early-out only when both are known
      },
    );
    this.touchingWater = water;
    this.touchingLava = lava;
    // Submersion from the topmost fluid cell in the centre column. A run
    // reaching the feet uses the classic waterline (identical to Phase 5
    // for every natural, contiguous pool); a FLOATING pocket (a Phase 10
    // lava wall leak with air beneath) only counts its overlapped band —
    // otherwise a single leak block at head height read as submersion ~1,
    // zeroing gravity and hanging the player mid-air under it.
    // The surface of the topmost fluid cell uses its RENDERED height (Phase
    // 21): a 1/8-deep flowing film must not read as a full block of fluid
    // and float the player.
    const lineOf = (isFluidCell) => {
      const cx = Math.floor(p.x);
      const cz = Math.floor(p.z);
      const top = Math.floor(p.y + PLAYER.HEIGHT - EPS);
      const bottom = Math.floor(p.y + EPS);
      for (let y = top; y >= bottom; y--) {
        const id = this.world.getBlock(cx, y, cz);
        if (isFluidCell(id)) {
          const surface = y + fluidHeight(id);
          let lo = y;
          while (lo - 1 >= bottom && isFluidCell(this.world.getBlock(cx, lo - 1, cz))) lo--;
          if (lo <= bottom) return Math.max(0, Math.min(1, (surface - p.y) / PLAYER.HEIGHT));
          return Math.max(0, Math.min(1, (surface - Math.max(p.y, lo)) / PLAYER.HEIGHT));
        }
      }
      return 0;
    };
    this.submersion = water ? lineOf(isWaterCell) : 0;
    this.lavaSubmersion = lava ? lineOf(isLava) : 0;
    this.swimming = this.submersion >= PLAYER.SWIM_MIN_SUBMERSION;
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

