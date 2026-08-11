// systems/ambience.js — Phase 22: continuous, position-driven feel. Two
// halves, both purely reactive (they read state, they never change it):
//
//   the player      footsteps timed off actual ground speed and tinted to
//                   the block underfoot, the landing burst, the splash on
//                   entering water and the bubble trail while swimming
//   the world       vanilla's randomDisplayTick — a budget of random cells
//                   around the player each frame, spawning torch flames,
//                   lava embers and pops, glowstone sparkles and end-portal
//                   swirls wherever they land; the looping water and lava
//                   ambience beds whose gain follows how much fluid is
//                   nearby; and the rare distant cave tone underground
//
// Event-driven feedback (breaking, placing, hits, deaths, explosions) is
// emitted where those events happen — this module owns only what has to be
// re-decided every frame from the player's position.
//
// Nether-portal particles and their hum stay in dimensions/portals.js, which
// has owned them since Phase 15; this module deliberately skips
// NETHER_PORTAL cells so they are never doubled.

import { PARTICLES, AUDIO, PLAYER, STATS } from '../config.js';
import {
  BLOCK, blockDef, isTorch, isLava, isWater, isSolid, TORCH_LEAN,
} from '../world/blocks.js';
import { particles } from '../render/particles.js';
import { audio, blockSoundGroup } from './audio.js';

export function createAmbience({ world, player, dimensions }) {
  let stepTimer = 0;
  let wasInWater = false;
  let bubbleTimer = 0;
  let ambientCarry = 0;   // fractional random-tick samples owed
  let caveTimer = randomCaveGap();
  let waterLoud = 0;      // eased fluid ambience levels
  let lavaLoud = 0;
  let portalCarry = 0;
  let portalLoud = 0;
  let portalScanTimer = 0;
  const endPortalCells = []; // flat x,y,z triples, refreshed on the timer

  function randomCaveGap() {
    const C = AUDIO.CAVE;
    return C.MIN_GAP + Math.random() * (C.MAX_GAP - C.MIN_GAP);
  }

  const blockAt = (x, y, z) => world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));

  // The block the player is standing on, or 0 (air) when nothing is.
  function groundBlock() {
    const p = player.body.position;
    for (const dy of [-0.08, -0.35]) {
      const id = blockAt(p.x, p.y + dy, p.z);
      if (id !== BLOCK.AIR && isSolid(id)) return id;
    }
    return BLOCK.AIR;
  }

  // --- the player -----------------------------------------------------------

  function updatePlayer(dt) {
    const body = player.body;
    const p = body.position;

    // Landing: the controller's one-frame signal. A real drop throws a ring
    // of the ground's own texture and thumps; a hop does neither.
    if (body.lastLanding > PARTICLES.LAND_MIN_FALL) {
      const id = groundBlock();
      if (id !== BLOCK.AIR) {
        particles.landing(p.x, p.y, p.z, id, body.lastLanding);
        const group = blockSoundGroup(blockDef(id).name);
        audio.land(group, p, Math.min(AUDIO.LAND_MAX_VOLUME, 0.7 + body.lastLanding / 8));
      }
      stepTimer = 0;
    }

    // Footsteps: paced by distance covered, not by wall time, so they stay
    // in step whether walking, sprinting or sneaking.
    const speed = body.horizontalSpeed ?? 0;
    if (body.onGround && speed > 0.6 && !body.swimming) {
      const interval = body.sprinting
        ? PARTICLES.SPRINT_STEP_INTERVAL : PARTICLES.STEP_INTERVAL;
      stepTimer += dt * Math.min(1.6, speed / PLAYER.WALK_SPEED);
      if (stepTimer >= interval) {
        stepTimer = 0;
        const id = groundBlock();
        if (id !== BLOCK.AIR) {
          particles.footstep(p.x, p.y, p.z, id, body.sprinting);
          audio.footstep(
            blockSoundGroup(blockDef(id).name), p,
            body.sneaking ? AUDIO.SNEAK_STEP_VOLUME
              : body.sprinting ? AUDIO.SPRINT_STEP_VOLUME : 1,
          );
        }
      }
    } else if (!body.onGround) {
      stepTimer = 0;
    }

    // Entering and leaving water: one splash per transition (vanilla).
    const inWater = !!body.touchingWater;
    if (inWater !== wasInWater) {
      const strength = Math.min(2, 0.6 + Math.abs(body.velocity.y) / 6);
      particles.splash(p.x, p.y + 0.2, p.z, strength);
      audio.splash(p, Math.min(1, 0.5 + strength * 0.3));
      wasInWater = inWater;
    }

    // Bubble trail while actually under the surface.
    if (body.eyeInWater || body.submersion > 0.5) {
      bubbleTimer -= dt * PARTICLES.BUBBLE.PER_SECOND * (0.4 + Math.min(1, speed / 4));
      while (bubbleTimer <= 0) {
        bubbleTimer += 1;
        particles.bubble(p.x, p.y + PLAYER.EYE_HEIGHT * 0.7, p.z);
        if (Math.random() < 0.12) audio.bubble(p, 0.5);
      }
    }
  }

  // --- the world around the player ------------------------------------------

  // Vanilla's randomDisplayTick: a fixed budget of random cells in a cube
  // around the player, each spawning whatever its block calls for. Cost is
  // a constant number of block reads per second whatever is nearby.
  function randomDisplayTicks(dt) {
    const A = PARTICLES.AMBIENT;
    ambientCarry += dt * A.SAMPLES_PER_SECOND;
    let budget = Math.min(A.MAX_PER_FRAME, Math.floor(ambientCarry));
    // Never let a frame that hit the cap bank the shortfall — a hitch would
    // otherwise pay itself back as a burst of samples later.
    ambientCarry = Math.min(ambientCarry - budget, A.MAX_PER_FRAME);
    const p = player.body.position;
    const R = A.RADIUS;
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y);
    const bz = Math.floor(p.z);
    while (budget-- > 0) {
      const x = bx + Math.floor(Math.random() * (2 * R + 1)) - R;
      const y = by + Math.floor(Math.random() * (2 * R + 1)) - R;
      const z = bz + Math.floor(Math.random() * (2 * R + 1)) - R;
      if (world.getChunkIfLoaded &&
        !world.getChunkIfLoaded(Math.floor(x / 16), Math.floor(z / 16))) continue;
      const id = world.getBlock(x, y, z);
      if (id === BLOCK.AIR) continue;
      if (isTorch(id)) {
        // The flame sits at the head of the torch's box model — leaned out
        // of the wall for the wall variants (TORCH_LEAN is the same table
        // the mesher tilts them by).
        if (Math.random() >= A.TORCH_CHANCE) continue;
        const [lx, lz] = TORCH_LEAN[id];
        for (let n = 0; n < PARTICLES.FLAME.PER_HIT; n++) {
          particles.flame(x + 0.5 + lx * 0.22, y + 0.62, z + 0.5 + lz * 0.22);
        }
      } else if (isLava(id)) {
        if (world.getBlock(x, y + 1, z) !== BLOCK.AIR) continue;
        if (Math.random() < A.LAVA_CHANCE) particles.ember(x, y, z);
        if (Math.random() < A.LAVA_POP_CHANCE) {
          particles.lavaPop(x, y, z);
          audio.lavaPop({ x: x + 0.5, y: y + 1, z: z + 0.5 }, 0.8);
        }
      } else if (id === BLOCK.GLOWSTONE) {
        if (Math.random() < A.GLOWSTONE_CHANCE) {
          particles.sparkle(x + 0.5, y + 0.5, z + 0.5);
        }
      }
      // END_PORTAL cells are deliberately NOT handled here: updateEndPortals
      // below emits from a cached list of them, so the random tick would
      // only double the swirl. NETHER_PORTAL belongs to portals.js.
    }
  }

  // A cheap census of the fluid around the player drives both looping beds.
  function updateFluidAmbience(dt) {
    const p = player.body.position;
    const R = AUDIO.FLUID_AMBIENCE_RADIUS;
    let water = 0;
    let lava = 0;
    // Sampled on a 2-block lattice: 9x5x9 reads, not (2R+1)^3.
    for (let dx = -R; dx <= R; dx += 2) {
      for (let dy = -4; dy <= 4; dy += 2) {
        for (let dz = -R; dz <= R; dz += 2) {
          const x = Math.floor(p.x) + dx;
          const y = Math.floor(p.y) + dy;
          const z = Math.floor(p.z) + dz;
          if (world.getChunkIfLoaded &&
            !world.getChunkIfLoaded(Math.floor(x / 16), Math.floor(z / 16))) continue;
          const id = world.getBlock(x, y, z);
          if (isWater(id)) water++;
          else if (isLava(id)) lava++;
        }
      }
    }
    const full = AUDIO.FLUID_AMBIENCE_FULL;
    const k = 1 - Math.exp(-AUDIO.AMBIENCE_RESPONSE * dt);
    const submerged = player.body.eyeInWater ? 2.2 : 1;
    waterLoud += (Math.min(1, water / full) * submerged - waterLoud) * k;
    lavaLoud += (Math.min(1, lava / full) - lavaLoud) * k;
    if (waterLoud > 0.002) {
      audio.setLoop('water', waterLoud * AUDIO.WATER_AMBIENCE_VOLUME, {
        filter: 'bandpass', frequency: 620, q: 0.7, wobbleHz: 0.6,
      });
    }
    if (lavaLoud > 0.002) {
      audio.setLoop('lava', lavaLoud * AUDIO.LAVA_AMBIENCE_VOLUME, {
        filter: 'lowpass', frequency: 260, q: 0.9, wobbleHz: 0.35,
        tone: { type: 'sine', freq: 58, volume: 0.35 },
      });
    }
  }

  // Rare distant tones, only underground in the dark (vanilla's cave sounds).
  function updateCaveAmbience(dt) {
    caveTimer -= dt;
    if (caveTimer > 0) return;
    caveTimer = randomCaveGap();
    if (dimensions?.activeKey !== 'overworld') return;
    const p = player.body.position;
    if (p.y > AUDIO.CAVE.MAX_Y) return;
    const light = world.getLight?.(
      Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z),
    );
    if (light && light.sky > AUDIO.CAVE.MAX_SKY_LIGHT) return;
    audio.caveTone();
  }

  // End portals (the stronghold room and the exit fountain) are dense
  // clusters, so instead of trusting the random tick to find them they get a
  // cached list refreshed on a slow timer: the swirl emits from real cells
  // and the hum's gain follows how many are close. Nether portals keep their
  // own particles and hum in dimensions/portals.js.
  function scanEndPortals() {
    const p = player.body.position;
    endPortalCells.length = 0;
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y);
    const bz = Math.floor(p.z);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -5; dz <= 5; dz++) {
        for (let dx = -5; dx <= 5; dx++) {
          const x = bx + dx;
          const z = bz + dz;
          if (world.getChunkIfLoaded &&
            !world.getChunkIfLoaded(Math.floor(x / 16), Math.floor(z / 16))) continue;
          if (world.getBlock(x, by + dy, z) !== BLOCK.END_PORTAL) continue;
          endPortalCells.push(x, by + dy, z);
          if (endPortalCells.length >= 96) return; // 32 cells is plenty
        }
      }
    }
  }

  function updateEndPortals(dt) {
    portalScanTimer -= dt;
    if (portalScanTimer <= 0) {
      portalScanTimer = AUDIO.PORTAL_SCAN_SECONDS;
      scanEndPortals();
    }
    const found = endPortalCells.length / 3;
    const k = 1 - Math.exp(-AUDIO.AMBIENCE_RESPONSE * dt);
    portalLoud += (Math.min(1, found / 6) - portalLoud) * k;
    if (portalLoud > 0.002) {
      audio.setLoop('endportal', portalLoud * AUDIO.PORTAL_HUM_VOLUME, {
        filter: 'bandpass', frequency: 180, q: 7, wobbleHz: 1.3,
        tone: { type: 'sine', freq: 62, volume: 0.25 },
      });
    }
    if (found === 0) return;
    portalCarry += dt * PARTICLES.PORTAL.PER_SECOND;
    while (portalCarry >= 1) {
      portalCarry -= 1;
      const i = Math.floor(Math.random() * found) * 3;
      particles.portal(endPortalCells[i], endPortalCells[i + 1], endPortalCells[i + 2]);
    }
  }

  function update(dt) {
    if (dt <= 0) return;
    if (player.body.position.y < STATS.VOID_DAMAGE_Y) return; // falling out of the world
    updatePlayer(dt);
    randomDisplayTicks(dt);
    updateFluidAmbience(dt);
    updateEndPortals(dt);
    updateCaveAmbience(dt);
  }

  return { update };
}
