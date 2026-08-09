// systems/fireballs.js — Phase 16: ghast fireball projectiles, split out of
// systems/combat.js per the ARCHITECTURE file-size cap. Straight-line
// exploding projectiles (no gravity, vanilla), deflectable: a melee swing
// on one reverses it along the player's look direction and flips its
// ownership — a player-owned fireball hits mobs instead of the player
// (combat's attack() drives the deflection through this module).
//
// The visual is three crossed quads sampling a generated fireball blotch
// (bright core, ragged dark-red rim; generated art is the established
// pattern — no fire_charge asset ships), unlit and fullbright. combat.js
// injects its deps — rayAABB comes in through the deps object rather than
// an import so the module pair stays cycle-free.

import * as THREE from 'three';
import { COMBAT, CHUNK } from '../config.js';
import { isSolid } from '../world/blocks.js';
import { raycastVoxel } from '../player/interaction.js';

let fireballTexture = null;
let fireballGeometry = null;

function getFireballTexture() {
  if (fireballTexture) return fireballTexture;
  const S = 32;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5;
      const dy = (y + 0.5) / S - 0.5;
      const d = Math.hypot(dx, dy) * 2; // 0 centre .. 1 edge
      const o = (y * S + x) * 4;
      // colour ramp: near-white core -> yellow -> orange -> deep red
      const t = Math.min(1, d);
      img.data[o] = 255 - 40 * t;
      img.data[o + 1] = 235 - 190 * t * t;
      img.data[o + 2] = 160 - 150 * t;
      // ragged edge: solid core, noisy fringe, nothing past the rim
      const fringe = (d - 0.55) / 0.4;
      img.data[o + 3] = d < 0.55 ? 255 : (Math.random() > fringe ? 255 : 0);
    }
  }
  g.putImageData(img, 0, 0);
  fireballTexture = new THREE.CanvasTexture(c);
  fireballTexture.magFilter = THREE.NearestFilter;
  fireballTexture.minFilter = THREE.NearestFilter;
  fireballTexture.generateMipmaps = false;
  fireballTexture.colorSpace = THREE.SRGBColorSpace;
  return fireballTexture;
}

function getFireballGeometry() {
  if (fireballGeometry) return fireballGeometry;
  const h = COMBAT.FIREBALL.SIZE / 2;
  const pos = [];
  const uv = [];
  const idx = [];
  // Three axis-aligned quads through the centre (xy, zy, xz planes) — the
  // ball reads volumetric from every angle without billboarding.
  const quads = [
    [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]],
    [[0, -h, -h], [0, -h, h], [0, h, h], [0, h, -h]],
    [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]],
  ];
  for (const q of quads) {
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(...q[i]);
      uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  fireballGeometry = new THREE.BufferGeometry();
  fireballGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fireballGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fireballGeometry.setIndex(idx);
  return fireballGeometry;
}

// `explode(centre, maxDamage, opts)` and `playerAABB()` are combat's;
// `getMobs` resolves lazily; `sfx` supplies the deflect thwack; `rayAABB`
// is combat's slab test, injected to keep the modules cycle-free.
export function createFireballs({
  world, scene, getMobs, playerAABB, explode, sfx, rayAABB, ignitePlayer,
}) {
  const getBlock = (x, y, z) => world.getBlock(x, y, z);
  const fireballs = [];

  // `from` is the spawn point (outside the shooter's box), `vel` blocks/s.
  // fromPlayer flips when a melee swing deflects it. Phase 17 options for
  // the blaze's small fast fireballs: `size` scales the render and hitbox
  // (default the ghast's COMBAT.FIREBALL.SIZE), `damageRadius` overrides
  // the blast falloff range, `maxHardness` caps what the blast can break
  // (combat.explode opts — blockRadius 0 breaks nothing at all).
  // Phase 18: `fireSeconds` sets the player briefly on fire on a DIRECT hit
  // (the blaze fireball's burn — splash damage alone never ignites).
  function spawn({
    from, vel, damage, blockRadius, fromPlayer = false,
    size, damageRadius, maxHardness, fireSeconds,
  }) {
    const mesh = new THREE.Mesh(
      getFireballGeometry(),
      new THREE.MeshBasicMaterial({
        map: getFireballTexture(),
        side: THREE.DoubleSide,
        alphaTest: 0.5,
        toneMapped: false, // fullbright — it IS a ball of fire
      }),
    );
    mesh.position.set(from.x, from.y, from.z);
    if (size !== undefined) mesh.scale.setScalar(size / COMBAT.FIREBALL.SIZE);
    scene.add(mesh);
    const fireball = {
      pos: { x: from.x, y: from.y, z: from.z },
      vel: { x: vel.x, y: vel.y, z: vel.z },
      damage,
      blockRadius,
      damageRadius,
      maxHardness,
      fireSeconds,
      size: size ?? COMBAT.FIREBALL.SIZE,
      fromPlayer,
      mesh,
      age: 0,
    };
    fireballs.push(fireball);
    return fireball;
  }

  function remove(index) {
    const fireball = fireballs[index];
    fireball.mesh.removeFromParent();
    fireball.mesh.material.dispose();
    fireballs.splice(index, 1);
  }

  function deflect(fireball, dir) {
    const s = COMBAT.FIREBALL.DEFLECT_SPEED;
    fireball.vel = { x: dir.x * s, y: dir.y * s, z: dir.z * s };
    fireball.fromPlayer = true;
    fireball.age = 0; // a fresh flight for the despawn safety net
    sfx.deflect();
  }

  // Nearest fireball whose box the ray hits within maxDist, with its
  // distance — combat's crosshair raycast compares it against the mob hit.
  function nearestOnRay(origin, dir, maxDist) {
    let best = null;
    let bestT = Infinity;
    for (const f of fireballs) {
      const h = f.size / 2;
      const t = rayAABB(origin, dir, {
        minX: f.pos.x - h, minY: f.pos.y - h, minZ: f.pos.z - h,
        maxX: f.pos.x + h, maxY: f.pos.y + h, maxZ: f.pos.z + h,
      }, maxDist);
      if (t !== null && t < bestT) {
        bestT = t;
        best = f;
      }
    }
    return best ? { fireball: best, t: bestT } : null;
  }

  function update(dt) {
    for (let i = fireballs.length - 1; i >= 0; i--) {
      const fb = fireballs[i];
      fb.age += dt;
      if (fb.age > COMBAT.FIREBALL.FLYING_DESPAWN_SECONDS) {
        remove(i); // flew into nothing — silent removal
        continue;
      }
      // Frozen in unloaded chunks like arrows/items/mobs — the flight
      // raycast below would synchronously regenerate far chunks.
      if (!world.getChunkIfLoaded(
        Math.floor(fb.pos.x / CHUNK.SIZE), Math.floor(fb.pos.z / CHUNK.SIZE),
      )) {
        continue;
      }
      const speed = Math.hypot(fb.vel.x, fb.vel.y, fb.vel.z);
      if (speed < 1e-6) continue;
      const step = speed * dt;
      const dir = { x: fb.vel.x / speed, y: fb.vel.y / speed, z: fb.vel.z / speed };

      // Nearest block along this frame's flight segment caps the hit range.
      const blockHit = raycastVoxel(getBlock, fb.pos, dir, step, isSolid);
      const range = blockHit ? blockHit.distance : step;

      // Entity hit inside the range wins over the block behind it.
      let burstAt = null;
      let knock = null; // explicit player knockback direction — a direct
                        // hit bursts at the body centre, where the blast's
                        // own radial direction degenerates to zero
      if (fb.fromPlayer) {
        const mob = getMobs()?.raycast(fb.pos, dir, range) ?? null;
        if (mob) {
          // Blast centred on the body — a deflected direct hit lands the
          // full damage on the ghast that fired it (its famous demise).
          const mp = mob.entity.position;
          burstAt = { x: mp.x, y: mp.y + mob.entity.def.height / 2, z: mp.z };
        }
      } else {
        const box = playerAABB();
        const t = rayAABB(fb.pos, dir, box, range);
        if (t !== null) {
          // Blast centred on the body, exactly like the mob branch above —
          // a direct hit lands the fireball's full damage. Bursting at the
          // AABB entry point instead left the surface-to-mid-body offset
          // inside the falloff, so a blaze's 2-radius fireball could never
          // deal its SPEC 6 (Phase 17 review fix).
          burstAt = {
            x: (box.minX + box.maxX) / 2,
            y: (box.minY + box.maxY) / 2,
            z: (box.minZ + box.maxZ) / 2,
          };
          knock = dir; // shoved along the flight line, away from the shooter
          // The brief burn lands only on a direct body hit (Phase 18).
          if (fb.fireSeconds) ignitePlayer?.(fb.fireSeconds);
        }
      }
      if (!burstAt && blockHit) {
        burstAt = {
          x: fb.pos.x + dir.x * blockHit.distance,
          y: fb.pos.y + dir.y * blockHit.distance,
          z: fb.pos.z + dir.z * blockHit.distance,
        };
      }
      if (burstAt) {
        remove(i);
        explode(burstAt, fb.damage, {
          blockRadius: fb.blockRadius,
          damageRadius: fb.damageRadius,
          maxHardness: fb.maxHardness,
          knockX: knock?.x,
          knockZ: knock?.z,
          // A fire projectile (fireSeconds set — the blaze's) deals FIRE
          // damage: fire resistance negates it for the player entirely,
          // like vanilla (mobs in the blast still take it).
          fireDamage: fb.fireSeconds != null,
        });
        continue;
      }
      fb.pos.x += fb.vel.x * dt;
      fb.pos.y += fb.vel.y * dt;
      fb.pos.z += fb.vel.z * dt;
      fb.mesh.position.set(fb.pos.x, fb.pos.y, fb.pos.z);
      fb.mesh.rotation.y += dt * 2.4; // a lazy spin keeps the ball alive
    }
  }

  // Dimension swap support (combat drives it alongside the arrows): hide
  // and freeze the outgoing set, restore the incoming one. The exported
  // `list` keeps its identity.
  function swapState(stored = []) {
    const prev = fireballs.slice();
    for (const f of prev) f.mesh.visible = false;
    fireballs.length = 0;
    for (const f of stored) {
      f.mesh.visible = true;
      fireballs.push(f);
    }
    return prev;
  }

  return { spawn, deflect, nearestOnRay, update, swapState, list: fireballs };
}
