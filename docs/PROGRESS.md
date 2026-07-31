# PROGRESS

Updated at the end of every session. Read at the start of every session.

**If something is listed as WORKING, do not rewrite or refactor it. Build on it.**

---

## Status

Phase last completed: **Phase 2 — overworld terrain data generation**

---

## Working

- `index.html` — importmap pinned to three@0.160.0 (unpkg), fullscreen canvas,
  pointer-lock hint overlay.
- `src/config.js` — all SPEC-implied global tunables: world dimensions, chunks,
  view distance, terrain/cave/ore ranges, player physics and stats, tool tiers,
  weapon damage, armour, mob spawn rules, item drops, day length, lighting,
  sky/fog colours per dimension, render settings, atlas layout, portal numbers,
  dragon numbers, debug camera.
- `src/render/renderer.js` — WebGLRenderer with ACESFilmicToneMapping,
  SRGBColorSpace output, PCFSoftShadowMap, pixel-ratio clamp, window resize
  handler; perspective camera factory.
- `src/render/atlas.js` — loads `assets/block_atlas.png` with NearestFilter
  (no mipmaps), full `TILE` registry mirroring docs/ATLAS_MAP.md (indices 0–57),
  `getUV(tileIndex)` with a small inset against tile bleeding.
- `src/render/lighting.js` — sky dome shader with a 4-stop vertical gradient
  (below-horizon, horizon, mid, zenith). The sky is deliberately NOT
  tone-mapped: r160 applies fog after tone mapping with the fog colour in
  output sRGB, so the un-tone-mapped sky horizon (= fog colour) matches fully
  fogged terrain exactly. Shadow-casting directional sun; hemisphere ambient.
- `src/ui/debug.js` — FPS counter (smoothed) plus camera coordinates overlay.
- `src/main.js` — game loop on `setAnimationLoop` with clamped delta time;
  test scene: 16x16 grass ground, oak tree with cutout leaves, showcase rows of
  ~25 block types with correct per-face tiles (grass top/side/dirt, log ends,
  crafting table front, furnace faces); per-face brightness (top 1.0 / side 0.8 /
  bottom 0.5) baked as vertex colours; free-fly debug camera (click for pointer
  lock, WASD + Space/Shift, Ctrl for fast, mouse look). Phase 2: also creates
  the `World`, pre-generates 5x5 chunks at origin (~80ms) and logs terrain
  diagnostics; `window.__world` exposes it in the console.
- `src/world/blocks.js` — full block registry (50 blocks: all SPEC.md tables
  plus stronghold/decorative blocks the atlas supports). Per block: id, name,
  per-face tiles resolved to BoxGeometry order `[px,nx,py,ny,pz,nz]`,
  hardness, preferred tool, min tool tier for drops, drops (with counts and
  chances), solid, transparent, light level, and behaviour flags (falls,
  fluid, damagesOnContact, slows). Lookup helpers: `blockDef`, `isSolid`,
  `isTransparent`, `lightLevel`, `faceTiles`.
- `src/world/terrain.js` — seeded, fully deterministic overworld generation:
  own 2D simplex (seeded permutation) + fBm; continent swell (oceans where it
  dips), per-biome hill amplitudes, ridged mountain relief (hills ~100,
  clamped at peaks 140); climate noise (temperature/moisture) blending
  plains/forest/desert/mountains weights — heights blend continuously, biome
  edges hash-dither; surface layering (grass/dirt, desert sand+sandstone,
  beach sand near sea level, bare stone above y=92 in mountains); water fill
  up to sea level 62; solid bedrock at -64 with a 4-block jagged band above;
  oak trees (per-column hash + 3x3 spacing rule, forest ~7/chunk, sparse in
  plains/mountains, canopies cross chunk borders identically from both sides
  via a margin re-derivation — chunks never write into each other); cacti on
  desert sand. Everything is a pure function of (seed, x, z), so chunk
  generation order can never change the world.
- `src/world/chunks.js` — `Chunk`: 16x384x16 `Uint8Array` of block ids,
  y-fastest indexing (columns contiguous), world-y get/set (outside range
  reads air / ignores writes), `dirty` flag for Phase 3 meshing.
- `src/world/world.js` — `World` chunk manager: `getBlock`/`setBlock` by
  world coordinates generating chunks on demand (correct floor division for
  negatives), `setBlock` dirties the chunk and loaded border neighbours,
  `getHeight`/`getBiome` from the generator, `getHighestSolidY` (includes
  trees/edits), `ensureArea`, `forEachChunk`, `loadedChunkCount`.
- `src/ui/debug.js` — FPS/coords overlay, plus Phase 2 console diagnostics:
  `logTerrainProfile` (ASCII heightmap side-view with water and biome strip),
  `logColumn` (run-length block spans of one column), `logBlockCensus`
  (block counts across loaded chunks).

Verified in headless Chromium: loads with zero console errors, renders the
Phase 1 test scene unchanged, generates 25 chunks in ~80ms and logs correct
terrain diagnostics. Verified in Node against the real modules: chunk-order
determinism (byte-identical chunks regardless of generation order), solid
bedrock layer + jagged band percentages (80/60/40/20), water exactly filling
(height, 62] and never above sea, no grass underwater, dirt under grass,
trunk-on-dirt and cactus-on-sand invariants, canopy present for every trunk,
no adjacent trunks, forest ~4x plains tree density, desert census (sand,
sandstone, cacti), biome shares over a 2048x2048 sample (~41/26/13/21%),
heights min 54 / max 140.

---

## Partially built

- The rest of `src/` exists as empty stub modules with responsibility headers
  (world/caves.js, player/, entities/, systems/, dimensions/, ui/hud.js,
  ui/screens.js; render/lighting.js only does Phase 1 sky/sun — block-light
  propagation and AO still to come).
- Terrain is data-only: nothing renders it yet (Phase 3 meshing in
  world/chunks.js). Rivers, caves, ravines, ores and lava pools are later
  phases (caves.js); `world/terrain.js` deliberately does not carve anything.
- `blocks.js`: chest uses oak-planks tiles as a cube fallback (its real
  texture is an entity texture); nether/end portal blocks have `faces: null`
  plus a `special` tag — the mesher must skip/special-case `tiles === null`.

---

## Known broken

_Nothing known broken._

---

## Deliberately not built

See the out-of-scope list in SPEC.md. Also deliberately deferred by design:
per-block data tables belong in `world/blocks.js` and per-mob tables in
`entities/mobs.js` (registries), not `config.js` — config holds global tunables.

---

## Notes for the next session

- Phase 3 is meshing: build chunk meshes in `world/chunks.js` from
  `chunk.blocks` using `faceTiles(id)` (already in BoxGeometry face order
  [px,nx,py,ny,pz,nz]) + `isTransparent` for face culling, then replace the
  test scene in `main.js` (cube builder, `buildTestScene`) with rendered
  chunks around the camera. The per-face UV + vertex-colour approach in
  `createBlockGeometry` is the pattern the chunk mesher should reuse.
- `world.setBlock` already sets `dirty` on the chunk and loaded border
  neighbours; the mesher consumes and clears that flag.
- `world.getHeight` is the raw terrain height (pre-trees/edits);
  `getHighestSolidY` scans actual blocks — use the latter for spawning.
- Terrain diagnostics (`logTerrainProfile`, `logColumn`, `logBlockCensus` in
  ui/debug.js and the `window.__world` handle) are dev scaffolding — keep
  them, they make regressions visible in the console.
- All terrain tuning lives in `config.js` `TERRAIN` (noise scales, biome
  weights/offsets, tree/cactus densities, surface depths, dither range).
  World seed: `TERRAIN.SEED`.
- `render/atlas.js` `getUV` returns `{u0, v0, u1, v1}` in flipY UV space
  (v0 = tile bottom). BoxGeometry face order is px, nx, py, ny, pz, nz with
  4 verts per face — see `createBlockGeometry` for the corner mapping.
- Atlas textures are pre-tinted (grass top and leaves are already green);
  leaves need `alphaTest` (cutout), water/lava tiles exist but translucency is
  not built yet.
- Free-fly camera speed/sensitivity and all sky/fog colours are in `config.js`.

---

## Session log

| Phase | What was built | Left incomplete |
|---|---|---|
| 1 | index.html, config.js, renderer/atlas/sky+fog/debug overlay, lit textured test scene, fly camera, full stub tree | Everything beyond rendering: world gen, chunks, player physics, interaction, mobs, systems, dimensions, HUD |
| 2 | Block registry (50 blocks), seeded deterministic terrain gen (blended biomes, trees, cacti, water, bedrock), Chunk storage, World chunk manager with on-demand generation, terrain console diagnostics | Rendering the terrain (Phase 3 meshing), caves/ores/rivers/lava (caves.js), chest/portal special rendering |
