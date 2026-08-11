// world/ores.js — the ore and gravel-pocket vein passes, split out of
// world/caves.js in Phase 24 (the cut caves.js's ARCHITECTURE note has
// mandated since Phase 23: "its next growth must take the ore/vein passes
// out"). Moved verbatim: same salts, same PRNG streams, same walk — the
// output is byte-identical to the pre-split world.
//
// STONE_FAMILY lives here (the veins are its primary consumer) and caves.js
// imports it back — the dependency runs one way, so the pair is cycle-free.

import { CHUNK, ORES, UNDERGROUND } from '../config.js';
import { BLOCK } from './blocks.js';
import { mulberry32, hash2 } from './noise.js';

// Blocks ore veins and variant blobs may replace.
export const STONE_FAMILY = new Uint8Array(256);
for (const id of [
  BLOCK.STONE, BLOCK.GRANITE, BLOCK.DIORITE, BLOCK.ANDESITE, BLOCK.DEEPSLATE,
]) {
  STONE_FAMILY[id] = 1;
}

const SALT_GRAVEL = 0x67a1;
// Per-ore PRNG stream salts (stable — never reorder).
const ORE_SALTS = { coal: 0xc0a1, iron: 0x1207, gold: 0x601d, redstone: 0x8ed5, diamond: 0xd1a3 };
const ORE_BLOCKS = {
  coal: BLOCK.COAL_ORE,
  iron: BLOCK.IRON_ORE,
  gold: BLOCK.GOLD_ORE,
  redstone: BLOCK.REDSTONE_ORE,
  diamond: BLOCK.DIAMOND_ORE,
};
// Phase 23: the same ore in deepslate. A vein cell takes this variant when
// the block it is replacing is deepslate, so a vein straddling the transition
// band comes out half stone ore and half deepslate ore, exactly like vanilla.
const DEEPSLATE_ORE_BLOCKS = {
  coal: BLOCK.DEEPSLATE_COAL_ORE,
  iron: BLOCK.DEEPSLATE_IRON_ORE,
  gold: BLOCK.DEEPSLATE_GOLD_ORE,
  redstone: BLOCK.DEEPSLATE_REDSTONE_ORE,
  diamond: BLOCK.DEEPSLATE_DIAMOND_ORE,
};

// Compact random-walk veins from a per-chunk seeded PRNG. Only this
// chunk's cells are written (walks clip at the border), so generation
// order can never change the world. Placement replaces the stone family
// only — never air, cave interiors, dirt or ore already placed.
// `deepId` (Phase 23) is the block to write instead when the cell being
// replaced is deepslate, so a vein crossing the transition band comes out
// part stone ore and part deepslate ore.
function placeVeins(seed, chunk, blockId, salt, cfg, deepId = null) {
  const size = CHUNK.SIZE;
  const rng = mulberry32(hash2(seed ^ salt, chunk.cx, chunk.cz));
  const span = cfg.MAX_Y - cfg.MIN_Y;
  for (let attempt = 0; attempt < cfg.ATTEMPTS_PER_CHUNK; attempt++) {
    let cx = Math.floor(rng() * size);
    let cz = Math.floor(rng() * size);
    // BIAS_BOTTOM: min of three uniforms — density ∝ (1-t)², strongly
    // concentrated toward MIN_Y ("the right depth" for diamonds).
    let t = rng();
    if (cfg.BIAS_BOTTOM) t = Math.min(t, rng(), rng());
    let cy = cfg.MIN_Y + Math.round(t * span);
    const target = cfg.VEIN_MIN + Math.floor(rng() * (cfg.VEIN_MAX - cfg.VEIN_MIN + 1));
    let placed = 0;
    let guard = target * 6;
    while (placed < target && guard-- > 0) {
      if (cx >= 0 && cx < size && cz >= 0 && cz < size &&
          cy >= cfg.MIN_Y && cy <= cfg.MAX_Y) {
        const under = chunk.get(cx, cy, cz);
        if (STONE_FAMILY[under]) {
          chunk.set(
            cx, cy, cz,
            deepId !== null && under === BLOCK.DEEPSLATE ? deepId : blockId,
          );
          placed++;
        }
      }
      const axis = Math.floor(rng() * 3);
      const dir = rng() < 0.5 ? -1 : 1;
      if (axis === 0) cx += dir;
      else if (axis === 1) cy += dir;
      else cz += dir;
    }
  }
}

// The vein passes caves.js runs last: gravel pockets (the renewable flint
// source), then every SPEC ore.
export function applyVeinPasses(chunk, seed) {
  const G = UNDERGROUND.GRAVEL_POCKETS;
  placeVeins(seed, chunk, BLOCK.GRAVEL, SALT_GRAVEL, {
    MIN_Y: G.MIN_Y, MAX_Y: G.MAX_Y, ATTEMPTS_PER_CHUNK: G.ATTEMPTS_PER_CHUNK,
    VEIN_MIN: G.SIZE_MIN, VEIN_MAX: G.SIZE_MAX,
  });
  for (const name of Object.keys(ORES)) {
    placeVeins(
      seed, chunk, ORE_BLOCKS[name], ORE_SALTS[name], ORES[name],
      DEEPSLATE_ORE_BLOCKS[name],
    );
  }
}
