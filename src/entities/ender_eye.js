// entities/ender_eye.js — Phase 18: thrown eyes of ender (SPEC "Stronghold
// location"). A thrown eye rises and glides toward the stronghold
// (dimensions/stronghold.js supplies the deterministic target — the
// stronghold itself generates there next phase), hovers at its signal
// point for a moment, then either drops back down as an ender_eye item or
// SHATTERS (PORTALS.EYE_SHATTER_CHANCE, the SPEC 20%) with a little flash.
// The player follows the direction; repeated throws walk them to the
// stronghold.
//
// The eye ignores terrain like vanilla (it rises well above head height,
// so it clears obstacles); it makes no world reads, so it needs no
// unloaded-chunk guard. Rendered as the ender_eye item slab, spinning,
// slightly emissive-looking (the shared extruded-item model).

import * as THREE from 'three';
import { ENDER_EYE, PORTALS, PLAYER } from '../config.js';
import { createExtrudedItemMesh } from './items.js';

export function createEnderEyes({ scene, player, items, sfx, getTarget }) {
  const eyes = [];
  const flashes = [];
  let flashGeometry = null;

  // Throw one eye from the player's eye position toward the stronghold.
  // Returns true when thrown (the caller consumes the item).
  function throwEye() {
    const target = getTarget();
    if (!target) return false;
    const p = player.body.position;
    const from = { x: p.x, y: p.y + PLAYER.EYE_HEIGHT, z: p.z };
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    const h = Math.hypot(dx, dz) || 1;
    const signal = {
      x: from.x + (dx / h) * ENDER_EYE.TRAVEL_BLOCKS,
      y: from.y + ENDER_EYE.RISE_BLOCKS,
      z: from.z + (dz / h) * ENDER_EYE.TRAVEL_BLOCKS,
    };
    const mesh = createExtrudedItemMesh('ender_eye', ENDER_EYE.SPRITE_SIZE);
    mesh.position.set(from.x, from.y, from.z);
    scene.add(mesh);
    eyes.push({ from, signal, t: 0, mesh });
    return true;
  }

  function removeEye(index) {
    eyes[index].mesh.removeFromParent();
    eyes.splice(index, 1);
  }

  // The little burst when an eye shatters (an expanding fading shell, the
  // combat flash pattern at eye scale).
  function spawnShatterFlash(pos) {
    flashGeometry ??= new THREE.SphereGeometry(1, 12, 8);
    const mesh = new THREE.Mesh(
      flashGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xd8fce8, transparent: true, opacity: 0.9,
        depthWrite: false, toneMapped: false,
      }),
    );
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.scale.setScalar(0.2);
    scene.add(mesh);
    flashes.push({ mesh, t: 0 });
    sfx?.shatter?.(0.8);
  }

  function update(dt) {
    if (dt <= 0) return;
    for (let i = eyes.length - 1; i >= 0; i--) {
      const eye = eyes[i];
      eye.t += dt;
      // Eased glide to the signal point, then a bobbing hover there.
      const flyFrac = Math.min(1, eye.t / ENDER_EYE.FLY_SECONDS);
      const ease = 1 - (1 - flyFrac) ** 3;
      const x = eye.from.x + (eye.signal.x - eye.from.x) * ease;
      const z = eye.from.z + (eye.signal.z - eye.from.z) * ease;
      let y = eye.from.y + (eye.signal.y - eye.from.y) * ease;
      if (flyFrac >= 1) {
        y += Math.sin(
          (eye.t - ENDER_EYE.FLY_SECONDS) * Math.PI * 2 * ENDER_EYE.BOB_HZ,
        ) * ENDER_EYE.BOB_BLOCKS;
      }
      eye.mesh.position.set(x, y, z);
      eye.mesh.rotation.y += ENDER_EYE.SPIN_RATE * dt;

      if (eye.t >= ENDER_EYE.FLY_SECONDS + ENDER_EYE.HOVER_SECONDS) {
        // Resolve: SPEC — drops as an item, or shatters (20%).
        if (Math.random() < PORTALS.EYE_SHATTER_CHANCE) {
          spawnShatterFlash({ x, y, z });
        } else {
          items.spawn('ender_eye', 1, { x, y, z }, { x: 0, y: 0, z: 0 });
        }
        removeEye(i);
      }
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const flash = flashes[i];
      flash.t += dt;
      const f = flash.t / ENDER_EYE.SHATTER_FLASH_SECONDS;
      if (f >= 1) {
        flash.mesh.removeFromParent();
        flash.mesh.material.dispose();
        flashes.splice(i, 1);
        continue;
      }
      flash.mesh.scale.setScalar(0.2 + f * 1.2);
      flash.mesh.material.opacity = 0.9 * (1 - f);
    }
  }

  // Dimension switch (the standard manager protocol): eyes in flight
  // belong to their dimension — hidden and frozen while stored.
  function swapDimensionState(stored = []) {
    const prev = eyes.slice();
    for (const e of prev) e.mesh.visible = false;
    eyes.length = 0;
    for (const e of stored) {
      e.mesh.visible = true;
      eyes.push(e);
    }
    return prev;
  }

  return {
    throwEye,
    update,
    swapDimensionState,
    eyes, // read-only by convention (debug/tests)
    get count() {
      return eyes.length;
    },
  };
}
