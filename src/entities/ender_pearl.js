// entities/ender_pearl.js — Phase 22: thrown ender pearls. Right-clicking a
// pearl launches it along the crosshair as a real projectile with a gravity
// arc; wherever it lands the player is teleported to it and takes the
// vanilla 5 points (2.5 hearts) of fall damage on arrival.
//
// The flight is swept in fixed sub-steps against the world's collision
// boxes, so a fast pearl can never tunnel through a wall — the landing point
// is the last cell the pearl was free in, which is also exactly where a
// player-sized body fits. A purple trail marks the arc, and both ends of the
// teleport get the enderman's own particle burst and warp sound.
//
// The manager follows the entities/ender_eye.js shape (throw / update /
// swapDimensionState), so main.js wires it exactly like the eyes.

import * as THREE from 'three';
import { ENDER_PEARL, PLAYER, PARTICLES } from '../config.js';
import { hasCollision } from '../world/blocks.js';
import { createExtrudedItemMesh } from './items.js';
import { particles } from '../render/particles.js';
import { audio } from '../systems/audio.js';

export function createEnderPearls({ scene, world, player, stats, camera }) {
  const pearls = [];
  const aim = new THREE.Vector3(); // reused: the throw direction, no allocation

  const blocked = (x, y, z) =>
    hasCollision(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));

  // Does a player-sized body fit with its feet at (x, y, z)?
  function bodyFits(x, y, z) {
    const hw = PLAYER.WIDTH / 2 - 0.02;
    for (const dx of [-hw, hw]) {
      for (const dz of [-hw, hw]) {
        for (let dy = 0; dy < PLAYER.HEIGHT; dy += 0.9) {
          if (blocked(x + dx, y + dy, z + dz)) return false;
        }
        if (blocked(x + dx, y + PLAYER.HEIGHT - 0.02, z + dz)) return false;
      }
    }
    return true;
  }

  // Throw one pearl along the camera forward. Returns true when thrown (the
  // caller consumes the item).
  function throwPearl() {
    const p = player.body.position;
    if (camera) camera.getWorldDirection(aim);
    else aim.set(0, 0, -1);
    const len = Math.hypot(aim.x, aim.y, aim.z) || 1;
    const dir = { x: aim.x / len, y: aim.y / len, z: aim.z / len };
    const from = {
      x: p.x + dir.x * ENDER_PEARL.SPAWN_FORWARD,
      y: p.y + PLAYER.EYE_HEIGHT - ENDER_PEARL.SPAWN_DOWN + dir.y * ENDER_PEARL.SPAWN_FORWARD,
      z: p.z + dir.z * ENDER_PEARL.SPAWN_FORWARD,
    };
    let mesh;
    mesh = createExtrudedItemMesh('ender_pearl', ENDER_PEARL.SPRITE_SIZE);
    mesh.position.set(from.x, from.y, from.z);
    scene.add(mesh);
    pearls.push({
      pos: { ...from },
      vel: {
        x: dir.x * ENDER_PEARL.SPEED,
        y: dir.y * ENDER_PEARL.SPEED,
        z: dir.z * ENDER_PEARL.SPEED,
      },
      age: 0,
      trailCarry: 0,
      mesh,
    });
    audio.swing(p, 0.7);
    return true;
  }

  function remove(index) {
    pearls[index].mesh.removeFromParent();
    pearls.splice(index, 1);
  }

  // The arrival: burst at both ends, drop the player in, hurt them.
  function land(pearl, at) {
    const body = player.body;
    const p = body.position;
    particles.enderTrail(p.x, p.y, p.z, PLAYER.HEIGHT);
    audio.warp(p, 1);

    // Stand where the pearl stopped, lifting out of the landing face and
    // climbing to the first spot the body actually fits (a pearl that hits a
    // ceiling must not embed the player in it).
    let y = at.y + ENDER_PEARL.ARRIVAL_CLEARANCE;
    for (let step = 0; step < 4 && !bodyFits(at.x, y, at.z); step++) y += 1;
    p.x = at.x;
    p.y = y;
    p.z = at.z;
    body.velocity.x = 0;
    body.velocity.y = 0;
    body.velocity.z = 0;
    // A teleport is not a fall: clear the fall bookkeeping BEFORE the
    // arrival damage, or the trip down counts twice (the Phase 20 harness
    // note — landing damage is computed from the fall START).
    body.fallDistance = 0;
    body._fallStartY = y;
    particles.enderTrail(at.x, y, at.z, PLAYER.HEIGHT);
    audio.warp({ x: at.x, y, z: at.z }, 1);
    stats?.damage(ENDER_PEARL.TELEPORT_DAMAGE);
  }

  function update(dt) {
    if (dt <= 0) return;
    for (let i = pearls.length - 1; i >= 0; i--) {
      const pearl = pearls[i];
      pearl.age += dt;
      if (pearl.age >= ENDER_PEARL.MAX_SECONDS) {
        remove(i);
        continue;
      }
      // Sub-stepped sweep: no tunnelling at 22 blocks/second.
      let left = dt;
      let hit = null;
      while (left > 0 && !hit) {
        const step = Math.min(ENDER_PEARL.STEP_SECONDS, left);
        left -= step;
        const v = pearl.vel;
        v.y -= ENDER_PEARL.GRAVITY * step;
        const damp = Math.exp(-ENDER_PEARL.DRAG * step);
        v.x *= damp;
        v.y *= damp;
        v.z *= damp;
        const nx = pearl.pos.x + v.x * step;
        const ny = pearl.pos.y + v.y * step;
        const nz = pearl.pos.z + v.z * step;
        if (blocked(nx, ny, nz)) {
          hit = { x: pearl.pos.x, y: pearl.pos.y, z: pearl.pos.z };
        } else {
          pearl.pos.x = nx;
          pearl.pos.y = ny;
          pearl.pos.z = nz;
        }
      }
      pearl.mesh.position.set(pearl.pos.x, pearl.pos.y, pearl.pos.z);
      pearl.mesh.rotation.y += ENDER_PEARL.SPIN_RATE * dt;
      pearl.mesh.rotation.x += ENDER_PEARL.SPIN_RATE * 0.6 * dt;

      pearl.trailCarry += dt * ENDER_PEARL.TRAIL_PER_SECOND;
      while (pearl.trailCarry >= 1) {
        pearl.trailCarry -= 1;
        particles.sparkle(pearl.pos.x, pearl.pos.y, pearl.pos.z, PARTICLES.ENDER.COLOR);
      }

      if (hit) {
        if (!stats?.dead) land(pearl, hit);
        remove(i);
      }
    }
  }

  // Dimension switch (the standard manager protocol): pearls in flight
  // belong to their dimension — hidden and frozen while stored.
  function swapDimensionState(stored = []) {
    const prev = pearls.slice();
    for (const e of prev) e.mesh.visible = false;
    pearls.length = 0;
    for (const e of stored) {
      e.mesh.visible = true;
      pearls.push(e);
    }
    return prev;
  }

  return {
    throwPearl,
    update,
    swapDimensionState,
    pearls, // read-only by convention (debug/tests)
    get count() {
      return pearls.length;
    },
  };
}
