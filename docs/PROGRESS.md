# PROGRESS

Updated at the end of every session. Read at the start of every session.

**If something is listed as WORKING, do not rewrite or refactor it. Build on it.**

---

## Status

Phase last completed: **Phase 6 — block interaction (raycast targeting, breaking with cracks, placing, dropped items, first-person hand) + Phase 5 movement bug fixes**

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
  dragon numbers. Phase 5 replaced the debug-camera spawn keys with the full
  `PLAYER` movement block (body/camera dimensions, speeds, jump + vanilla
  0.5s jump cooldown, gravity/terminal velocity, ground/air/water response
  rates, sprint double-tap + FOV boost, 1-block step height, sneak edge
  guard, swimming/buoyancy/breath, view bob, mouse sensitivity, safe-spawn
  search) — `DEBUG` now only holds fly-mode speeds, `FLY_TOGGLE_CODE` ('F4'),
  `MAX_DELTA` and the HUD readout interval.
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
- `src/main.js` — game loop on `setAnimationLoop` with clamped delta time.
  Phase 5: the free-fly debug camera is gone from this file — boot creates
  the player controller (which finds a safe spawn and owns the camera),
  then `world.prebuild` around it, then per frame: `player.update`,
  `world.updateStreaming(camera.position)`, `dayNight.update` (drives sky,
  fog, sun/moon and the chunk light uniforms; also recentres the sky dome),
  `updateHud`, `updateDebug`, render. Terrain console diagnostics still log
  at boot; `window.__world`, `window.__camera`, `window.__renderer`,
  `window.__dayNight` (`setTimeOfDay(t)`: 0 sunrise, 0.25 noon, 0.5 sunset,
  0.75 midnight) and `window.__player` (with `window.__controls` as a
  back-compat alias; `setView(yaw, pitch)` lives there) are dev scaffolding.
- `src/player/controller.js` — Phase 5, three parts:
  (1) **`PlayerBody`** — pure physics, no DOM/three.js types (node tests
  drive it directly): 0.6x1.8 AABB stepped against `world.getBlock` with
  exact swept per-axis collision (Y then X then Z like vanilla; every cell
  layer crossed is scanned in movement order, so terminal-velocity falls
  can never tunnel through ground, verified at dt=0.1). Movement feel is
  the vanilla tick physics in continuous form: on ground an exponential
  approach to the wished velocity (`GROUND_RESPONSE` ~ vanilla ground drag;
  acceleration and friction in one, framerate-independent), airborne only
  weak steering + light drag, gravity integrated with midpoint velocity so
  jump height doesn't shrink at low fps, terminal velocity 78. Walk /
  sprint (forward-only; sprint-jump boost along facing; 0.5s vanilla jump
  cooldown so cut-short arcs under 2-high ceilings can't compound the
  boost) / sneak (slower, and refuses moves that would lose all floor
  within `SNEAK_EDGE_DROP` — vanilla-style per-axis shrink) / jump.
  Grounding comes from the direction of the Y hit (downward = landing,
  upward = ceiling, never grounded). 1-block auto-step: on a grounded
  horizontal hit, retry the move from a raised start and keep whichever
  result travels farther, settling onto the step. Swimming: `submersion`
  (waterline fraction of body height) drives buoyancy — at rest the body
  floats with eyes just above the surface; jump/sneak swim up/down, water
  drag on all axes, real jumps in shallow water, and a vanilla-style
  re-applied exit hop while pressing into a bank that keeps working while
  any part of the body clips water (bank climb-out verified 30-240fps).
  Breath meter: depletes while the eye is in water, refills 4x surfaced,
  clamps at 0 (drowning damage is the stats phase's job). Fall tracking:
  `fallDistance` while airborne, `lastLanding` reports the exact drop on
  the landing step (for stats), water contact resets it. `slows` blocks
  (soul sand) scale target speed.
  (2) **`findSpawnPosition`** — ring search from `PLAYER.SPAWN` for the
  nearest dry (>= sea level), harmless (no cactus, not a canopy) surface
  column with 2 blocks of standing clearance; feet land exactly on the
  surface — never inside terrain, never in the air, never in water.
  (3) **`createPlayerController`** — pointer-lock input + first-person
  camera: mouse look with clamped pitch, camera at eye height (1.62,
  easing to 1.27 sneaking), sprint via Ctrl or double-tap W (latch drops on
  W release; FOV widens ~8 degrees while sprinting), subtle ground-speed
  view bob, step-ups eased out of the camera (`STEP_SMOOTH_RATE`), and the
  old debug fly camera folded in behind `DEBUG.FLY_TOGGLE_CODE` (F4 — no
  gravity/collision, DEBUG fly speeds; leaving fly mode lifts out of any
  overlap before walking resumes). Game keys are `preventDefault`ed while
  locked so Ctrl+S/Ctrl+D chords can't fire browser shortcuts (reserved
  Ctrl+W can't be — the hint leads with double-tap sprint instead), and
  the `requestPointerLock` promise rejection during the browser's ~1.3s
  post-Esc cooldown is swallowed (hint stays up, next click retries).
  Dev scaffolding: `setView(yaw, pitch)`, `debugForceInput(on)` so a
  harness can drive keys without pointer lock.
- `src/ui/hud.js` — Phase 5 slice of the HUD: centred crosshair
  (difference-blend; hidden while the pointer is unlocked so it never draws
  over the "Click to play" hint) and the breath meter — `PLAYER.BREATH_BUBBLES`
  bubbles above the future hotbar position, visible only while air is
  missing, like vanilla. Hotbar/hearts/hunger arrive with inventory/stats.
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
- `src/player/interaction.js` — Phase 6 block interaction, in two layers:
  (1) **Pure logic** (node-tested): `raycastVoxel` — Amanatides & Woo voxel
  DDA from the camera eye along the look direction, PLAYER.REACH (5) blocks,
  visiting every crossed cell in order (no corner skipping, negative coords
  exact); returns cell, id, entered-face normal and distance; targets
  anything with a non-null hardness (so torches and leaves yes; air, fluids
  and portal interiors are looked through). `miningPlan(def, heldItem)` —
  SPEC rules: hardness = seconds at 1x; a held tool of the block's preferred
  class applies its tier speed multiplier; the tier gate uses that class
  (wrong class counts as hand), below `minTier` the time is divided by
  `WRONG_TIER_SPEED_MULTIPLIER` and NOTHING drops; hardness 0 = instant,
  Infinity (bedrock) = never. `isReplaceable` (air + fluids),
  `placementBlockedByPlayer` (block-cell vs player-AABB overlap, exact face
  contact allowed), `parseHeldTool` ('wooden_pickaxe' → class+tier).
  (2) **createInteraction** — per frame: raycast, black LineLoop outline
  floated `OUTLINE_OFFSET` off the targeted face; hold-left-to-break with
  progress reset on target change, `BREAK_COOLDOWN_SECONDS` between breaks,
  crack overlay (inflated cube over the block, 10 generated destroy-stage
  CanvasTextures — cumulative seeded random-walk cracks, so stages grow one
  fracture); on completion `world.setBlock(air)` + drop spawning per the
  registry drops table (chance and [min,max] counts honoured); right-click
  places the selected block against the targeted face into air/fluid cells
  only, never overlapping the player, repeating every
  `PLACE_REPEAT_SECONDS` while held; first-person hand (camera child) — a
  generated pixel-skin arm, or a mini-cube of the block about to be placed —
  swings on click, on place and continuously while mining. Until the
  inventory phase a proto-inventory lives here: collected drops in a counts
  map, the freshest block pickup becomes the placeable selection, placing
  decrements it (`setHeldItem`/`setSelectedBlock`/`debugSetMouse` are dev
  scaffolding, `window.__interaction` exposed).
- `src/entities/items.js` — dropped item entities: point physics (gravity,
  cell-sweep landing with no tunnelling, ground vanishing re-falls, squeezed
  items pop up, water float + drag), visuals as bobbing/rotating mini-blocks
  (atlas per-face UVs + face-brightness vertex colours, shared
  geometry/material caches) or flat item sprites from assets/items/*.png;
  magnetise to the player's body centre within `ITEMS.MAGNET_RADIUS` (1.5),
  collected at `PICKUP_RADIUS` after `PICKUP_DELAY_SECONDS`, despawn after
  `DESPAWN_SECONDS` or below the world; broken-block drops pop up with
  random scatter. `createBlockMesh` is shared with the hand.
  `window.__items` exposed.
- Phase 5 movement bug fixes (this session, overriding earlier notes):
  step height is vanilla 0.6 (`STEP_HEIGHT`/`SNEAK_EDGE_DROP` 0.6) — full
  1-block ledges now require a jump, and sneaking refuses 1-block drops like
  vanilla; while ANY part of the body touches water, space swims up slowly
  (no more normal jumps from shallow pools or pool edges — the shallow-jump
  special case and `SHALLOW_JUMP_MAX_SUBMERSION` are gone; bank exits still
  ride the water exit hop); sprinting while fully submerged triggers the
  vanilla swim mechanic: `body.swimSprinting` (enters when the eye is under
  water, sprint+forward held) swims fast (`SWIM_SPRINT_SPEED`) toward the
  look direction (pitch-driven vertical, `input.pitch` now part of the body
  input), lowers the eye to `SWIM_EYE_HEIGHT` (prone feel) and widens the
  FOV like a land sprint.

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

Phase 5 verification: 50 node physics checks driving the real `PlayerBody`
against a synthetic voxel world (rest exactly on the floor; terminal-velocity
falls land without tunnelling even at dt=0.1; landing reports the exact drop;
walk/sprint/sneak/swim speeds converge to config; friction stops in under a
block; jump peaks ~1.1 and is unaffected by framerate; walls clamp flush;
1-block auto-step up and into 2-high gaps but never 2 blocks; ceiling clamp;
ceiling-bounce jump spam stays bounded (no sprint-boost compounding); sneaking
never leaves a 1x1 pillar while plain walking falls off; buoyancy equilibrium
floats the eye above water; breath depletes/clamps/refills; water entry
cancels fall distance; bank climb-out succeeds at 30/60/90/144/240fps).
37 spawn checks across 30 seeds plus far-out spawn points on real generated
worlds (feet flush on solid, dry, harmless ground with clearance). 38
headless-Chromium gameplay checks against the running game (zero console
errors; spawn on the surface at eye height; measured walk/sprint/sneak
speeds; double-tap and Ctrl sprint with FOV kick; sneak eye drop and edge
refusal; auto-step without jumping; 2-block wall blocks; 320-block fall lands
flush, never dipping below the surface; float/dive/surface with the bubble
meter appearing and hiding; fly toggle on/off; a cross-country walk that
never sinks into terrain). An adversarial multi-agent review (4 lenses, every
finding independently verified with repros) confirmed and led to fixes for:
ceiling-hit grounding (hover exploit), framerate-dependent water exit, the
jump cooldown, Ctrl-chord browser shortcuts, the pointer-lock cooldown
rejection, breath frozen in fly mode, and crosshair-over-hint stacking.
(Phase 5 note: the auto-step checks above were written against the old
1-block step height; Phase 6 corrected it to vanilla 0.6 — full blocks now
require a jump, re-verified below.)

Phase 6 verification: 70 node checks against the real modules — raycast
geometry (axis-aligned/diagonal/negative directions, boundary origins,
through-water, inside-block starts, reach limit), mining plans for every
tool/tier/block matrix corner (dirt/stone/ores/obsidian/bedrock/torch,
wrong-class = hand gate, wrong tier slow + no drops), replaceability,
player-overlap placement rejection (incl. straddled cells and exact face
contact), and the movement fixes (1-block ledge blocks walking / jump
clears it / flat speed unchanged; shallow-pool and pool-edge space = slow
swim, never jump velocity; submerged ascent kept; swim-sprint engage speed
+ pitch dive + disengage; bank climb-out at 30/60/144fps; pillar + 1-block
drop sneak guards; dry jump height; landing report). 25 headless-Chromium
gameplay checks against the running game (boot with zero console errors;
crosshair raycast + top-face targeting + visible outline; hold-to-break
with crack overlay and continuous hand swing; drop magnetised and picked
up; pickup drives the held mini-block and place selection; in-player
placement rejected; place onto a targeted face consumes the count;
wrong-tier stone survives punching, wooden pickaxe breaks it, cobblestone
entity bobs in the world and magnetises within 1.5; the 1-block wall no
longer auto-steps and a jump clears it; shallow-water space swims up
slowly; submerged sprint engages swim mode and lowers the eye; hand is a
camera child). Screenshots confirm the look: black face outline, spreading
cracks, pixel arm and held dirt mini-block, placed blocks, a cobblestone
drop resting on grass.

---

## Partially built

- The rest of `src/` exists as empty stub modules with responsibility headers
  (world/caves.js, player/inventory.js, player/stats.js, entities/entity.js,
  entities/mobs.js, entities/pathfinding.js, entities/dragon.js, systems/,
  dimensions/, ui/screens.js).
- `ui/hud.js` is the Phase 5 slice only (crosshair + breath bubbles);
  hotbar, hearts and hunger come with inventory/stats.
- Phase 6 deliberate slices, replaced by later phases:
  - The proto-inventory (counts map in interaction.js, freshest pickup =
    selection) is scaffolding — inventory.js will own items/hotbar and take
    over `notifyPickup`, the held-item and the place selection.
    `setHeldItem('iron_pickaxe')` from the console is how to try tools now.
  - Dropped items and the hand are not lit by world light (unlit atlas
    material, correct per-face brightness only) — a `getLight` sample can
    tint them when the mob phase adds it.
  - `sand`/`gravel` have `falls: true` in the registry, but there is no
    falling-block entity yet; mined support just leaves them floating.
  - No break/place/footstep sounds yet (SPEC "feel" row; no audio system).
  - `oak_sapling` and `glowstone_dust` drops have no shipped item texture;
    items.js renders stand-ins (leaves mini-block / blaze powder sprite)
    via its VISUAL_ALIAS map.
  - Breaking water/lava directly is impossible (not targetable) — bucket
    interactions are an item-phase concern.
- The controller exposes but does not consume damage inputs — stats.js later
  wires `body.lastLanding` (fall damage), `body.breath === 0` (drowning),
  and `damagesOnContact` blocks (cactus/lava contact does nothing yet;
  cactus still collides as a full cube).
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

- Likely Phase 7 is caves/ores (fill in `world/caves.js` — carved caves get
  correct darkness and torch light for free from the Phase 4 flood fill, and
  breaking ore already drops the right items) or inventory/stats + hotbar
  HUD (interaction.js hands over its proto-inventory: replace `notifyPickup`
  / `setHeldItem` / `setSelectedBlock` with the real inventory, keep the
  `miningPlan` rules).
- Phase 6 APIs for later phases: `interaction.notifyPickup(name, count)` is
  the pickup sink main.js wires into `items.update`; `interaction.target`
  is the live raycast result ({x,y,z,id,face,distance} or null);
  `items.spawn(name, count, pos, vel?)` drops anything (mob drops later);
  `createBlockMesh(blockId, size)` (entities/items.js) builds the mini-block
  used by both dropped items and the held block — reuse it for item frames /
  inventory icons rather than re-deriving atlas cubes. Tool durability is
  deliberately not tracked yet (inventory owns item instances).
- Player API for later phases: `controller.body` is the physics truth —
  `position` (feet centre), `velocity`, `onGround`, `swimming`,
  `submersion`, `eyeInWater`, `breath`/`maxBreath`, `sneaking`,
  `sprinting`, `fallDistance`, and per-step one-frame signals
  `lastLanding` (blocks fallen, set on the landing step) and `lastStepUp`.
  `controller.mode` is 'walk' | 'fly'. Reach checks for interaction should
  ray from `__camera` (it sits at the eye, bob included).
- `PlayerBody` is deliberately DOM-free and constructible in node with any
  `{ getBlock }` — keep it that way; the physics test harness depends on it.
  `findSpawnPosition(world, overrides)` is also pure and node-testable.
- Movement/physics tuning all lives in `config.js` `PLAYER` (response rates,
  water feel, bob, spawn search); fly mode in `DEBUG`. `STEP_HEIGHT` and
  `SNEAK_EDGE_DROP` are the vanilla 0.6 as of Phase 6 — when slabs/stairs
  arrive they will auto-step for free; full blocks require a jump.
- Browser-chrome caveat: reserved Ctrl+W (close tab) cannot be prevented —
  that's why the hint leads with double-tap sprint, and why fly mode's
  Ctrl-fast + W is a known sharp edge (debug-only, left as is). All other
  game-key chords are `preventDefault`ed while pointer-locked.
- Water physics constants interlock: the exit hop stays correct as long as
  it keeps re-applying while the body clips water (don't regress it to
  `swimming`-only — that stalls below the bank lip at >=90fps), and
  `WATER_BUOYANCY` > 1 is what floats the eye above water at rest.
- The old debug camera survives as fly mode (F4): no collision, no gravity,
  breath refills, `DEBUG.FLY_SPEED/_FAST`. Toggling back to walk lifts the
  body out of any solid overlap before physics resumes.
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
| 5 | The player (controller.js): AABB body with exact swept collision (no tunnelling), vanilla-feel accel/friction, walk/sprint(double-tap W or Ctrl, FOV kick)/sneak(edge guard, lowered eye)/jump(0.5s vanilla cooldown), 1-block auto-step with camera smoothing, swimming (buoyant float, breath meter) with framerate-independent bank climb-out, safe surface spawn, first-person pointer-lock camera with view bob, debug fly camera behind F4; hud.js crosshair + breath bubbles; PLAYER config block; adversarially reviewed + 125 automated checks | Break/place (interaction.js), stats.js consuming lastLanding/breath/contact damage, hotbar/hearts HUD, caves/ores (caves.js), non-cube special shapes |
| 6 | Block interaction (interaction.js): voxel DDA raycast (5 reach), black targeted-face outline, hold-to-break timed by hardness × tool class/tier with wrong-tier very-slow-no-drops, 10-stage generated crack overlay, right-click place onto the targeted face (air/fluid cells only, never inside the player, hold-repeat), registry-table drops; dropped item entities (items.js): mini-block/sprite visuals, bob + rotate, gravity with cell-sweep landing, water float, 1.5-block magnetise, pickup, despawn; first-person hand (pixel arm or held mini-block) swinging on click/place/mining; proto-inventory scaffolding; Phase 5 fixes: step height 0.6 (jump for full blocks), space-in-any-water swims up slowly, submerged sprint = vanilla swim mechanic (fast, pitch-driven, prone eye); INTERACTION/ITEMS config blocks; adversarially reviewed + 95 automated checks | Inventory/hotbar replacing the proto-inventory, tool durability, falling sand/gravel entities, item/hand world-light tinting, sounds, caves/ores (caves.js), non-cube special shapes |
