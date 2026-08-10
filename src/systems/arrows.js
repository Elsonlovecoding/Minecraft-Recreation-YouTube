// systems/arrows.js — the arrow machinery, split out of systems/combat.js in
// Phase 21: the cut the ARCHITECTURE size cap has mandated since Phase 17
// ("the arrow machinery is the long-standing mandated cut before anything
// lands in combat.js"), taken as the first move of the session that added
// the shield. The bodies moved verbatim.
//
// What lives here: the crossed-quad arrow model built from the real
// assets/entity/projectiles_arrow.png, arrow projectiles for the player and
// for skeletons (gravity arc, block sticking, mob/player hits, pick-up of
// stuck player arrows), the player's bow draw/release, and the arrows' half
// of the dimension swap. systems/combat.js wires it and keeps melee, the
// armour pipeline, explosions and the sound synth.

import * as THREE from 'three';
import { COMBAT, PLAYER, CHUNK } from '../config.js';
import { isSolid } from '../world/blocks.js';
import { raycastVoxel } from '../player/interaction.js';

// ---------------------------------------------------------------------------
// The arrow model — two crossed quads sampling the side-view art of the real
// projectiles_arrow.png (left half: fletching at u=0, tip at u=16px; art is
// 16x5 of a 32x32 sheet). Built along +z so the mesh orients with a single
// quaternion from the flight direction.
// ---------------------------------------------------------------------------

let arrowTexture = null;
let arrowGeometry = null;

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

// `deps`:
//   world, scene, player, stats, inventory   the usual game handles
//   getMobs()                                the combat target facade
//   damagePlayer(amount, kdirX, kdirZ)       combat's armour pipeline
//   lightTintAt(x, y, z)                     combat's baked-light sampler
//   rayAABB, playerAABB                      combat's shared geometry helpers
export function createArrows({
  world, scene, player, stats, inventory, getMobs,
  damagePlayer, lightTintAt, rayAABB, playerAABB,
}) {
  const getBlock = (x, y, z) => world.getBlock(x, y, z);
  const arrows = [];
  let draw = null; // { t, slot, source } while the bow is drawn

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


  // Arrows in flight belong to their dimension: swap them out hidden and
  // frozen, restore the incoming set. A draw in progress cancels — the
  // bow's world just changed under it.
  function swapState(stored = []) {
    draw = null;
    const prev = arrows.slice();
    for (const a of prev) a.mesh.visible = false;
    arrows.length = 0;
    for (const a of stored) {
      a.mesh.visible = true;
      arrows.push(a);
    }
    return prev;
  }

  return {
    update: updateArrows,
    spawnArrow,
    updateDraw,
    releaseDraw,
    cancelDraw,
    swapState,
    list: arrows,
    get isDrawing() {
      return draw !== null;
    },
    get hasArrow() {
      return hasArrowItem();
    },
    get drawCharge() {
      return draw ? Math.min(1, draw.t / COMBAT.BOW.FULL_DRAW_SECONDS) : 0;
    },
    get drawSource() {
      return draw ? draw.source : null;
    },
  };
}
