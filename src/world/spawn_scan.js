// world/spawn_scan.js — Phase 26: the GUARANTEED plains spawn. The player
// must start in the middle of a large open plains area — not in forest, not
// on a coastline, not on a mountain — and that must be a property of the
// GENERATOR, not of a lucky seed.
//
// scanPlainsSpawn walks candidate centres outward from the world origin on a
// coarse grid and scores each one over a sampled disc: what fraction of the
// disc is plains-dominant land, whether any of it is underwater, and how much
// the height varies. The first candidate (nearest-first) that clears every
// threshold in TERRAIN.SPAWN_SCAN wins; if the spiral somehow exhausts
// MAX_RADIUS, the best-scoring candidate seen stands — the scan ALWAYS
// returns a column, which is what makes the plains spawn a guarantee rather
// than a retry loop.
//
// The generator is passed IN as an argument (the shapes.js `register`
// pattern), so this module imports nothing from world/terrain.js and the
// pair stays cycle-free — dimensions/stronghold.js can import this file for
// its spawn-anchored centre without terrain.js completing a cycle. Pure in
// the generator's seed: heightAt/biomeWeightsAt are pure, the grid is fixed,
// so every consumer (spawn, eyes of ender, stronghold anchor) sees the same
// column. Cost: reads only noise fields — never generates a chunk.

import { TERRAIN, OVERWORLD } from '../config.js';

// Scores one candidate centre over the sampled disc. Returns
// { plains, water, relief, ok } — fractions of disc samples, height spread,
// and whether every SPAWN_SCAN threshold passed.
function scoreCandidate(gen, cx, cz) {
  const S = TERRAIN.SPAWN_SCAN;
  const sea = OVERWORLD.SEA_LEVEL;
  const r = S.AREA_RADIUS;
  const r2 = r * r;
  let total = 0;
  let plains = 0;
  let water = 0;
  let treeSum = 0;
  let minH = Infinity;
  let maxH = -Infinity;
  for (let dz = -r; dz <= r; dz += S.SAMPLE_STEP) {
    for (let dx = -r; dx <= r; dx += S.SAMPLE_STEP) {
      if (dx * dx + dz * dz > r2) continue;
      const x = cx + dx;
      const z = cz + dz;
      total++;
      const h = gen.heightAt(x, z);
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
      if (h < sea) {
        water++;
        continue;
      }
      const w = gen.biomeWeightsAt(x, z);
      if (w.plains >= w.forest && w.plains >= w.desert && w.plains >= w.mountains) {
        plains++;
      }
      // OPEN WILDERNESS (旷野, by request): plains-dominant is not enough —
      // the Phase 24 tree-density FIELD varies within a biome, so a plains
      // disc can still be dotted with a grove. Average the field over the
      // disc and require a genuine clearing, so the player opens their eyes
      // on open ground with a long view instead of standing among trunks.
      treeSum += gen.treeDensityAt(x, z, w);
    }
  }
  const centreH = gen.heightAt(cx, cz);
  const relief = maxH - minH;
  const plainsFrac = plains / total;
  const waterFrac = water / total;
  const treeDensity = treeSum / total;
  const ok =
    plainsFrac >= S.MIN_PLAINS &&
    waterFrac <= S.MAX_WATER &&
    relief <= S.MAX_RELIEF &&
    treeDensity <= S.MAX_TREE_DENSITY &&
    centreH >= sea + 1 &&
    centreH <= sea + S.MAX_HEIGHT_ABOVE_SEA;
  return { plainsFrac, waterFrac, relief, treeDensity, ok };
}

// Candidate centres of one square ring at grid radius `n` (in CAND_STEP
// units), the body.js ringCells shape scaled up.
function* ringCentres(step, n) {
  if (n === 0) {
    yield [0, 0];
    return;
  }
  const r = n * step;
  for (let i = -n; i <= n; i++) {
    yield [i * step, -r];
    yield [i * step, r];
  }
  for (let i = -n + 1; i <= n - 1; i++) {
    yield [-r, i * step];
    yield [r, i * step];
  }
}

// The scan. `gen` is any generator exposing pure heightAt(x, z) and
// biomeWeightsAt(x, z) — in practice the overworld TerrainGenerator, which
// caches this result per instance (terrain.js spawnColumn).
export function scanPlainsSpawn(gen) {
  const S = TERRAIN.SPAWN_SCAN;
  const sea = OVERWORLD.SEA_LEVEL;
  const maxN = Math.ceil(S.MAX_RADIUS / S.CAND_STEP);
  let best = null;
  let bestScore = -Infinity;
  for (let n = 0; n <= maxN; n++) {
    for (const [cx, cz] of ringCentres(S.CAND_STEP, n)) {
      // Prescreen on the centre column alone — one height and one weights
      // read. Most candidates die here, which is what keeps the whole scan
      // to a few milliseconds; only survivors pay for the full disc.
      const ch = gen.heightAt(cx, cz);
      const cw = gen.biomeWeightsAt(cx, cz);
      const centrePlains =
        cw.plains >= cw.forest && cw.plains >= cw.desert && cw.plains >= cw.mountains;
      // The tree field joins the prescreen too. Without it the openness
      // test only ran after a full disc scan, and asking for a CLEARING is
      // selective enough that the scan spent 20 SECONDS of disc reads
      // before finding one — at boot, where it blocks the load. One extra
      // noise read per candidate keeps the whole scan in the milliseconds.
      const centreTrees = gen.treeDensityAt(cx, cz, cw);
      if (
        ch < sea + 1 || ch > sea + S.MAX_HEIGHT_ABOVE_SEA || !centrePlains
        || centreTrees > S.MAX_TREE_DENSITY * 1.3
      ) {
        // Crude fallback score so even a failed prescreen stays comparable.
        const score = cw.plains - (ch < sea ? 3 : 0) - 1;
        if (score > bestScore) {
          bestScore = score;
          best = { x: cx, z: cz };
        }
        continue;
      }
      const s = scoreCandidate(gen, cx, cz);
      if (s.ok) return { x: cx, z: cz };
      // Fallback score: mostly plains coverage, heavily punish water, then
      // flatness. Only consulted if the whole spiral fails (unseen under
      // the Phase 26 biome weights, but the guarantee must not hinge on it).
      const score = s.plainsFrac - s.waterFrac * 3 - s.relief * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = { x: cx, z: cz };
      }
    }
  }
  return best ?? { x: 0, z: 0 };
}
