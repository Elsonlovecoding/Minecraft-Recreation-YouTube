// entities/crystals.js — Phase 20: the end crystals atop the obsidian
// pillars. Each is the vanilla display — a spinning tilted glass cage, a
// counter-spinning core, a flat base — bobbing over its bedrock seat, and
// each is a combat target: ANY hit (melee swing, arrow, blast) pops it in
// an explosion. The dragon fight (entities/dragon.js) owns the manager,
// reads `nearestLiving` for the healing link and merges `raycast`/
// `blastTargets` into the combat facade main.js builds.
//
// Crystals are not Entities (no physics, no despawn) — they are fight
// furniture, frozen with the rest of the fight whenever the End is not the
// active dimension (dragon.js gates every update).

import * as THREE from 'three';
import { END_CRYSTAL } from '../config.js';
import { createMobModel, END_CRYSTAL_MODEL } from './models.js';
import { rayAABB } from '../systems/combat.js';

const PX = 1 / 16;

const CRYSTAL_DEF = {
  texture: 'assets/entity/end_crystal_end_crystal.png',
  textureSize: [64, 32], // classic unwrap; the art ships at 2x (128x64)
  model: END_CRYSTAL_MODEL,
};

// `root` is the fight's scene group (visibility flips with the dimension);
// `combat` supplies explode + the boom.
export function createCrystals({ root, combat }) {
  const crystals = [];

  // A crystal presents the mob-facade shape combat's paths expect:
  // entity.damage() from melee swings and arrows, entity.position/def from
  // explosion range checks, dead/removed to be skipped once popped.
  function makeFacade(crystal) {
    const half = END_CRYSTAL.SIZE / 2;
    return {
      isCrystal: true,
      provoked: false, // written by combat.attack; meaningless here
      entity: {
        def: { height: END_CRYSTAL.SIZE },
        get position() {
          // Feet-style position (explode adds def.height / 2).
          return { x: crystal.x, y: crystal.centerY() - half, z: crystal.z };
        },
        get aabb() {
          const cy = crystal.centerY();
          return {
            minX: crystal.x - half, maxX: crystal.x + half,
            minY: cy - half, maxY: cy + half,
            minZ: crystal.z - half, maxZ: crystal.z + half,
          };
        },
        get dead() {
          return !crystal.alive;
        },
        get removed() {
          return !crystal.alive;
        },
        damage(amount) {
          if (!crystal.alive || amount <= 0) return false;
          pop(crystal);
          return true;
        },
      },
    };
  }

  function pop(crystal) {
    crystal.alive = false;
    crystal.group.visible = false;
    combat.explode(
      { x: crystal.x, y: crystal.centerY(), z: crystal.z },
      END_CRYSTAL.EXPLODE_DAMAGE,
      { blockRadius: END_CRYSTAL.EXPLODE_BLOCK_RADIUS },
    );
  }

  // Build one crystal per pillar seat (idempotent — the fight initialises
  // once per session). `pillars` comes from EndGenerator.pillars(); the
  // crystal sits on the bedrock cap at the pillar top.
  function init(pillars) {
    if (crystals.length > 0) return;
    for (const p of pillars) {
      const { group, parts, material } = createMobModel(CRYSTAL_DEF);
      material.side = THREE.DoubleSide; // the cage reads from inside too
      const baseY = p.top + 1;
      group.position.set(p.x + 0.5, baseY, p.z + 0.5);
      // The classic tilted-cube look: spin around Y with a corner-forward
      // tilt (YXZ: the spin applies around the world-vertical first).
      for (const name of ['glass', 'core']) {
        parts[name].rotation.x = Math.PI / 5;
        parts[name].rotation.z = Math.PI / 4;
      }
      parts.core.scale.setScalar(0.55);
      root.add(group);
      const crystal = {
        x: p.x + 0.5,
        z: p.z + 0.5,
        baseY,
        alive: true,
        group,
        parts,
        material,
        phase: Math.random() * Math.PI * 2,
        bob: 0,
        centerY() {
          return this.baseY + 11 * PX + this.bob;
        },
      };
      crystal.facade = makeFacade(crystal);
      crystals.push(crystal);
    }
  }

  function update(dt) {
    for (const c of crystals) {
      if (!c.alive) continue;
      c.phase += dt;
      c.bob = Math.sin(c.phase * Math.PI * 2 * END_CRYSTAL.BOB_HZ) *
        END_CRYSTAL.BOB_HEIGHT;
      const y = 11 * PX + c.bob;
      c.parts.glass.position.y = y;
      c.parts.core.position.y = y;
      c.parts.glass.rotation.y = c.phase * END_CRYSTAL.SPIN_RATE;
      c.parts.core.rotation.y = c.phase * END_CRYSTAL.CORE_SPIN_RATE;
    }
  }

  // Nearest living crystal to a point within `range`, or null — the
  // dragon's healing link.
  function nearestLiving(pos, range) {
    let best = null;
    let bestD = range;
    for (const c of crystals) {
      if (!c.alive) continue;
      const d = Math.hypot(c.x - pos.x, c.centerY() - pos.y, c.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  // Nearest living crystal on a ray, as { target, t } — merged into the
  // combat-target facade (main.js) beside the mobs and the dragon.
  function raycast(origin, dir, maxDist) {
    let best = null;
    let bestT = Infinity;
    for (const c of crystals) {
      if (!c.alive) continue;
      const t = rayAABB(origin, dir, c.facade.entity.aabb, maxDist);
      if (t !== null && t < bestT) {
        bestT = t;
        best = c.facade;
      }
    }
    return best ? { target: best, t: bestT } : null;
  }

  return {
    init,
    update,
    nearestLiving,
    raycast,
    // Living-crystal facades for combat.explode's target sweep.
    get blastTargets() {
      return crystals.filter((c) => c.alive).map((c) => c.facade);
    },
    get livingCount() {
      return crystals.filter((c) => c.alive).length;
    },
    crystals, // read-only by convention (debug/tests)
  };
}
