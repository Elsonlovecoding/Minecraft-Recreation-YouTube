// dimensions/stronghold.js — Stronghold generation: corridors, rooms, the
// end portal room. Phase 18 places the stronghold's LOCATION (the eye-of-
// ender navigation target); generation itself is the next phase and must
// build the stronghold exactly at this point — strongholdCenter is the
// single source of truth both read.
//
// SPEC: strongholds generate roughly 1000-2000 blocks from spawn
// (config PORTALS.STRONGHOLD_MIN/MAX_DISTANCE), underground. The location
// is a pure function of the world seed: a seeded angle and distance from
// the world spawn point.

import { PORTALS, PLAYER } from '../config.js';
import { mulberry32, hash2 } from '../world/noise.js';

const SALT_STRONGHOLD = 0x57a06d;

// The stronghold's centre column in world coordinates, deterministic per
// seed. Thrown eyes of ender fly toward this point (entities/ender_eye.js);
// next phase's generation anchors the portal room to it.
export function strongholdCenter(seed) {
  const rng = mulberry32(hash2(seed ^ SALT_STRONGHOLD, 0, 0));
  const angle = rng() * Math.PI * 2;
  const dist = PORTALS.STRONGHOLD_MIN_DISTANCE +
    rng() * (PORTALS.STRONGHOLD_MAX_DISTANCE - PORTALS.STRONGHOLD_MIN_DISTANCE);
  return {
    x: Math.round(PLAYER.SPAWN.X + Math.cos(angle) * dist),
    z: Math.round(PLAYER.SPAWN.Z + Math.sin(angle) * dist),
  };
}
