# PROGRESS

Updated at the end of every session. Read at the start of every session.

**If something is listed as WORKING, do not rewrite or refactor it. Build on it.**

---

## Status

Phase last completed: **Phase 4 — lighting (flood-filled light, AO, day/night cycle)**

---

## Working

- `index.html` — importmap pinned to three@0.160.0 (unpkg), fullscreen canvas,
  pointer-lock hint overlay.
- `src/config.js` — all SPEC-implied global tunables: world dimensions, chunks,
  view distance, terrain/cave/ore ranges, player physics and stats, tool tiers,
  weapon damage, armour, mob spawn rules, item drops, day length, lighting
  (light falloff curve, AO strength, torch/night tints, sun orbit), the
  `DAY_NIGHT.KEYFRAMES` palette table, `CELESTIAL` sun/moon quads, sky/fog
  colours per dimension, render settings, atlas layout, portal numbers,
  dragon numbers, debug camera.
- `src/render/renderer.js` — WebGLRenderer with ACESFilmicToneMapping,
  SRGBColorSpace output, PCFSoftShadowMap, pixel-ratio clamp, window resize
  handler; perspective camera factory.
- `src/render/atlas.js` — loads `assets/block_atlas.png` with NearestFilter
  (no mipmaps), full `TILE` registry mirroring docs/ATLAS_MAP.md (indices 0–57),
  `getUV(tileIndex)` with a small inset against tile bleeding.
- `src/render/lighting.js` — Phase 4 lighting core, three parts:
  (1) **Light propagation**: flood-filled sky + block light, 15 levels,
  computed per chunk over its 3x3-chunk window (48x48 columns, full height)
  as a pure function of block data — light reaches at most 15 blocks and the
  window has a 16-block margin, so results are exact, deterministic and
  seam-free regardless of meshing order (adjacent chunks' windows agree on
  border cells; unit-verified). Sky light is 15 above each column's highest
  attenuating block (per-block `opacity` from the registry: opaque 15,
  water/leaves 1, glass/torch 0), falls straight down lossless at level 15,
  and costs max(1, opacity) per step otherwise; block light floods from
  emitters (torch 14, glowstone 15, lava 15). Per-chunk lazy caches
  (`chunk._lightMeta`: sky heightmap + emitter list, invalidated by
  `Chunk.set`) keep the window build fast; scratch buffers are reused, no
  per-mesh allocation. `computeLightWindow(nbrs)` returns shared
  { sky, block, blocks } arrays the mesher consumes immediately.
  (2) **Chunk material patch**: `patchChunkMaterial` turns MeshBasicMaterial
  into the vanilla-style lit material — per-vertex `light` attribute
  (sky, block), brightness = max(falloff^(15-skyLevel+darken) x skyTint,
  falloff^(15-blockLevel) x torchTint) via `CHUNK_LIGHT_UNIFORMS` shared by
  all chunk materials, so time-of-day relights the whole world without any
  remeshing. Torch light is warm-tinted and holds through the night; night
  skylight is moon-blue-tinted. Chunk materials are NOT tone-mapped (same
  reason as the sky: keeps fully fogged terrain == fog colour exact).
  (3) **Day/night cycle**: `createDayNightCycle` — ~20 min
  (`TIME.DAY_LENGTH_SECONDS`), keyframed in `DAY_NIGHT.KEYFRAMES`
  (sunrise/day/sunset/night palettes, piecewise-lerped, wrapping): sky
  gradient uniforms, fog colour always = horizon colour, `uSkyDarken`
  0..11 like vanilla, sunrise/sunset horizon glow around the sun position,
  square sun + moon quads riding the dome (children of the sky mesh,
  renderOrder sky -2 / celestials -1 so the front-to-back opaque sort can't
  draw the dome over them), and the directional light + hemisphere ambient
  (for later entity phases) tracking the sun by day, moon by night.
  Sky dome shader: 4-stop gradient as before, plus glow and a sub-quantum
  dither that kills 8-bit banding rings in the night sky. The sky is still
  deliberately NOT tone-mapped (see above). `updateSun(sun, focus, dir)`
  keeps the follow-the-player shadow-camera snapping from Phase 3.
- `src/ui/debug.js` — FPS counter (smoothed), camera coordinates, and
  meshed/loaded chunk counts overlay.
- `src/main.js` — game loop on `setAnimationLoop` with clamped delta time;
  free-fly debug camera (click for pointer lock, WASD + Space/Shift, Ctrl
  for fast, mouse look). Phase 3: the Phase 1 test scene is gone — the
  world renders as streamed chunk meshes. Boot: load atlas, create shared
  chunk materials, spawn the camera `DEBUG.SPAWN_ALTITUDE` above the
  surface at `DEBUG.SPAWN_X/Z`, `world.prebuild` a small area
  synchronously, then stream per frame (`world.updateStreaming`) alongside
  `dayNight.update` (Phase 4 — drives sky, fog, sun/moon and the chunk
  light uniforms; also recentres the sky dome). Terrain console diagnostics
  still log at boot; `window.__world`, `window.__camera`,
  `window.__renderer`, `window.__dayNight` (`setTimeOfDay(t)`: 0 sunrise,
  0.25 noon, 0.5 sunset, 0.75 midnight) and `window.__controls`
  (`setView(yaw, pitch)`) are exposed as dev scaffolding.
- `src/world/blocks.js` — full block registry (50 blocks: all SPEC.md tables
  plus stronghold/decorative blocks the atlas supports). Per block: id, name,
  per-face tiles resolved to BoxGeometry order `[px,nx,py,ny,pz,nz]`,
  hardness, preferred tool, min tool tier for drops, drops (with counts and
  chances), solid, transparent, light level, light `opacity` (Phase 4:
  levels absorbed during propagation — defaults opaque 15 / transparent 0,
  water and leaves override to 1), and behaviour flags (falls, fluid,
  damagesOnContact, slows). Lookup helpers: `blockDef`, `isSolid`,
  `isTransparent`, `lightLevel`, `lightOpacity`, `faceTiles`.
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
  reads air / ignores writes), `dirty` flag for remeshing, `modified` flag
  (player edits, data never dropped), `_lightMeta` lighting cache nulled by
  `set()`. Phase 3 meshing in the same file: one merged mesh per chunk per
  pass — opaque, cutout (alphaTest: leaves, cactus, glass...), translucent
  water (blended, depthWrite off, DoubleSide) — from flattened per-id lookup
  tables. Face culling emits a face only against a transparent neighbour
  with a different id (same-id transparent runs merge: water-water,
  leaf-leaf; interior faces never exist; world-bottom faces skipped; where
  two DIFFERENT transparent blocks touch — leaves|cactus, water|glass —
  only the lower id emits the shared plane, since both materials are
  DoubleSide and a coplanar pair would z-fight). Per-face atlas UVs from
  `faceTiles(id)`, upright and unmirrored on sides. Per-face brightness
  (1.0/0.8/0.5) times baked vertex AO (3-cell corner test) as vertex
  colours, plus (Phase 4) a per-vertex `light` attribute — vec2(sky, block)
  levels /15, each vertex averaging the face's front cell and its three AO
  corner cells (a corner sealed by two occluders reuses the front cell so
  light can't turn sealed corners; opaque cells contribute their stored
  light, so emitters glow through their faces). Water skips AO but takes
  smooth light (depth darkens it). The quad diagonal flips toward the
  brighter/less-occluded pair (AO + light combined). Water tops sink
  `RENDER.WATER_SURFACE_SINK` below the block top when no water above.
  Neighbour reads cross chunk borders through a 3x3 chunk grid (bit-shift
  lookup), so meshing order can never change a mesh. Phase 4: chunk
  materials are unlit MeshBasicMaterial + `patchChunkMaterial` (all shading
  is baked light — the vanilla look); scene lights/shadow maps no longer
  touch terrain, so the Phase 3 `MeshDepthMaterial` cutout-shadow path and
  the unused normal attribute are gone.
- `src/world/world.js` — `World` chunk manager: `getBlock`/`setBlock` by
  world coordinates generating chunks on demand (correct floor division for
  negatives), `setBlock` dirties the chunk plus every loaded neighbour the
  edit can touch — Phase 4: baked light reaches `LIGHTING.MAX_LIGHT` blocks
  (Manhattan), so side neighbours dirty when the edited column is within 15
  of the border and diagonals by Manhattan distance (this subsumes the
  1-block AO/culling reach), `getHeight`/`getBiome` from the generator,
  `getHighestSolidY` (includes trees/edits), `ensureArea`, `forEachChunk`,
  `loadedChunkCount`. Phase 3
  streaming: `bindScene(scene, materials)`, `prebuild(pos)` (synchronous
  small area at boot, `STREAMING.INITIAL_RADIUS`), `updateStreaming(pos)`
  once per frame — walks a precomputed nearest-first offset ring, generates
  missing data in the square ring `view+1`, meshes missing/dirty chunks
  inside the view-distance circle once all 8 neighbours have data, all
  within `STREAMING.FRAME_BUDGET_MS` per frame (first heavy task always
  runs, so progress is guaranteed). Unload with hysteresis on crossing a
  chunk border: meshes disposed outside the view circle + margin, data
  dropped outside the load square + margin unless `modified`. Meshes kept
  in the hysteresis band still remesh if they turn dirty (no stale
  geometry). `streamStats()` feeds the debug overlay.
- `src/ui/debug.js` — FPS/coords overlay, plus Phase 2 console diagnostics:
  `logTerrainProfile` (ASCII heightmap side-view with water and biome strip),
  `logColumn` (run-length block spans of one column), `logBlockCensus`
  (block counts across loaded chunks).

Phase 2 verification (still holds): Node checks against the real modules —
chunk-order determinism (byte-identical chunks regardless of generation
order), solid bedrock layer + jagged band percentages (80/60/40/20), water
exactly filling (height, 62] and never above sea, no grass underwater, dirt
under grass, trunk-on-dirt and cactus-on-sand invariants, canopy present for
every trunk, no adjacent trunks, forest ~4x plains tree density, desert
census (sand, sandstone, cacti), biome shares over a 2048x2048 sample
(~41/26/13/21%), heights min 54 / max 140.

Phase 3 verification in headless Chromium (three.js served locally because
the sandbox blocks unpkg — production still loads the CDN): zero console
errors; 6701 sampled quads across 8 chunks each face a transparent
different-id neighbour and none is interior; an independent face count of
chunk (0,0) written against `world.getBlock` matches the built mesh exactly
(685 == 685); prebuild meshes the initial circle (29 chunks, ~600ms);
teleporting 400 blocks streams the full 197-chunk view circle in and
unloads the old area (data bounded by the load square + margin); `setBlock`
remeshes the touched chunk within a frame or two and sets `modified`;
renderer stats at the settled view: ~100 draw calls / ~62k triangles —
comfortably 60fps-scale for integrated GPUs (headless SwiftShader renders
~10fps, which is the software-rasteriser floor, not a GPU number).
Screenshots confirm the Minecraft look: forest canopy with cutout leaves
and AO, per-face brightness, fogged horizon matching the sky, translucent
ocean over visible sea floor, desert with cacti.

Phase 4 verification: 40 node unit checks against the real modules — flat
world sky levels, torch/glowstone Manhattan falloff and no leaking through
stone, full sun down a 1x1 shaft spreading into a room (15/14/13/12),
light creeping under an overhang (14/13/12... from the rim, sideways at
every level), water 1 level per block of depth, wide leaf canopy
(15 -> 14 -> decay), glass passing sun untouched, adjacent chunks' windows
byte-identical on the seam columns (with torches straddling the border),
deterministic recompute, `_lightMeta` invalidation on `set()`. Headless
Chromium (three served locally, as in Phase 3): zero console errors;
screenshots at day/sunrise/sunset/night confirm the palette and terrain
dimming; torches + glowstone placed at night glow warm with smooth falloff
across chunk borders and are invisible again by day; ocean floor darkens
with depth; square sun and moon render on the dome (occluded by terrain,
sun sits in the sunset glow); remesh+relight ~4.2ms/chunk in SwiftShader
(inside the 8ms streaming budget; real GPUs are faster).

---

## Partially built

- The rest of `src/` exists as empty stub modules with responsibility headers
  (world/caves.js, player/, entities/, systems/, dimensions/, ui/hud.js,
  ui/screens.js).
- Lava is fully wired into lighting (emits 15, blocks light) but nothing
  places it until the caves phase; a fullbright/emissive treatment for lava
  and glowstone faces themselves is later polish (they currently render lit
  by their own neighbouring light, which reads fine).
- Directional sun + hemisphere ambient remain in the scene for later entity
  phases (mobs will be Lambert-lit); terrain itself is unlit baked light.
  Shadow maps are configured but currently have no casters/receivers —
  vanilla Minecraft has no dynamic shadows, so this is the intended look,
  not a regression.
- Rivers, caves, ravines, ores and lava pools are later phases (caves.js);
  `world/terrain.js` deliberately does not carve anything.
- `blocks.js`: chest uses oak-planks tiles as a cube fallback (its real
  texture is an entity texture); nether/end portal blocks have `faces: null`
  plus a `special` tag — the mesher skips `tiles === null` (their custom
  rendering comes with the portal phase).
- `special` blocks (torch, cactus, brewing stand, iron bars) currently mesh
  as full textured cubes in the cutout pass; their real non-cube shapes are
  a later polish. Terrain only ever places cactus, which reads fine.
- Meshing runs on the main thread inside a per-frame budget. If a later
  phase needs more headroom (bigger view distance, cave-heavy remeshing), a
  Web Worker mesher is the escape hatch — the mesher is already a pure
  function of chunk + 3x3 neighbour data.

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

- Likely Phase 5 is either caves/ores (fill in `world/caves.js`, hook into
  the generator — carved caves get correct darkness and torch light for
  free from the Phase 4 flood fill) or the player (controller.js
  physics/collision + interaction.js break/place). Both build directly on
  what exists; nothing needs restructuring.
- Break/place should just call `world.setBlock` — it dirties the chunk and
  every loaded neighbour within light range (up to the 3x3), and the
  streaming pass remeshes dirty chunks nearest-first within the frame
  budget. The edited chunk remeshes next frame; neighbour light catches up
  over the following few frames.
- The mesher (`buildChunkMesh`) requires all 8 neighbour chunks' data (for
  culling, AO and the light window); the streaming pass guarantees it. If
  you call it manually, go through `World._remesh`.
- Lighting invariants to preserve: `computeLightWindow` must stay a pure
  function of the 3x3 blocks (that's what makes light seam-free and
  deterministic); anything that writes `chunk.blocks` must go through
  `Chunk.set` (or null `_lightMeta` itself) or stale heightmaps/emitters
  will linger. Mob spawning ("light level <= 7") can read
  `computeLightWindow` or, cheaper, be given a `getLight(x,y,z)` helper on
  World later — don't rebuild windows per mob query.
- Day/night hooks for later phases: `dayNight.timeOfDay` (0 sunrise, 0.25
  noon, 0.5 sunset, 0.75 midnight) is the single time source — zombies
  burning in daylight, beds, and hostile spawn rules should read it.
  All palette/beauty tuning lives in `DAY_NIGHT.KEYFRAMES`, tints and
  falloff in `LIGHTING`, sun/moon size in `CELESTIAL` (config.js).
- Transparent-block culling merges same-id neighbours (`nid === id`
  skipped). If a future block needs same-id internal faces (glass panes
  don't; stained glass wouldn't), that's the line to revisit in chunks.js.
- Caves will expose underground faces: culling already handles it (carve
  air, set dirty). Ores are opaque cubes — zero mesher work needed.
- `world.getHeight` is the raw terrain height (pre-trees/edits);
  `getHighestSolidY` scans actual blocks — use the latter for spawning.
- Terrain diagnostics (`logTerrainProfile`, `logColumn`, `logBlockCensus` in
  ui/debug.js and the `window.__world`/`__camera`/`__renderer` handles) are
  dev scaffolding — keep them, they make regressions visible.
- All terrain tuning lives in `config.js` `TERRAIN`; streaming knobs in
  `STREAMING`; water/cutout/shadow-follow visuals in `RENDER`; spawn point
  in `DEBUG`. World seed: `TERRAIN.SEED`.
- Atlas textures are pre-tinted (grass top and leaves are already green).
  Lava exists in the registry as an opaque-pass fluid; it gets placed (and
  can get an emissive/animated treatment) with the caves/lava-pools phase.
- Torch/cactus/brewing-stand still mesh as full cubes (`special` shapes are
  later polish) — a placed torch is a glowing textured cube for now; its
  light is correct.
- Headless testing note: the sandbox blocks unpkg.com, so the Playwright
  harness intercepts the three.js CDN URL and serves the identical build
  from npm (`three@0.160.0`). index.html is unchanged for production.

---

## Session log

| Phase | What was built | Left incomplete |
|---|---|---|
| 1 | index.html, config.js, renderer/atlas/sky+fog/debug overlay, lit textured test scene, fly camera, full stub tree | Everything beyond rendering: world gen, chunks, player physics, interaction, mobs, systems, dimensions, HUD |
| 2 | Block registry (50 blocks), seeded deterministic terrain gen (blended biomes, trees, cacti, water, bedrock), Chunk storage, World chunk manager with on-demand generation, terrain console diagnostics | Rendering the terrain (Phase 3 meshing), caves/ores/rivers/lava (caves.js), chest/portal special rendering |
| 3 | Chunk meshing (merged mesh per chunk per pass, face culling, per-face atlas UVs, brightness + vertex AO), opaque/cutout/water passes, budgeted chunk streaming with load/unload around the player, sun/shadow follow, chunk counts in debug overlay; test scene removed | Caves/ores/rivers/lava (caves.js), block-light propagation (torches), player controller/interaction, non-cube shapes for torch/cactus/portals, day/night cycle |
| 4 | Flood-filled sky+block light (15 levels, per-chunk 3x3 window, seam-free), per-block light opacity, smooth per-vertex light baked with AO into meshes, unlit vanilla-style chunk materials with day-factor/torch-tint uniforms, ~20-min day/night cycle (keyframed sky palette, fog always = horizon, sunrise/sunset glow, square sun+moon), light-radius remesh dirtying on edits, TIME in debug overlay | Caves/ores/rivers/lava (caves.js), player controller/interaction, non-cube special shapes, emissive lava/glowstone polish, mob-facing `getLight` helper |
