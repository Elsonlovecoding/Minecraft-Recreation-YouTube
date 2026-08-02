# PROGRESS

Updated at the end of every session. Read at the start of every session.

**If something is listed as WORKING, do not rewrite or refactor it. Build on it.**

---

## Status

Phase last completed: **Phase 8 — crafting (recipes, 2x2 + 3x3 grids, result slot, shift-craft-max, the full wood-to-stone opening) + Phase 7 bug fixes (held-item distortion, real destroy-stage cracks)**

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
- `src/ui/hud.js` — crosshair (difference-blend; hidden while the pointer is
  unlocked so it never draws over the "Click to play" hint), breath meter
  (bubbles above the hotbar, visible only while air is missing), and the
  Phase 7 hotbar: the inventory's first 9 slots as vanilla-styled slots with
  real item icons (ui/icons.js), stack counts, durability bars
  (green-to-red, hidden at full) and a white selected-slot highlight;
  re-renders via the inventory subscription. Hearts/hunger arrive with stats.
- `src/player/inventory.js` — Phase 7 inventory core, pure logic (no
  DOM/three.js; node tests drive it directly): `INVENTORY.SIZE` 36 slots,
  slots 0-8 the hotbar; a slot is null or { name, count, durability? }.
  Stacking to `INVENTORY.MAX_STACK` 64 with per-item overrides in the item
  registry (tools/armour/bow/flint_and_steel/shears/buckets/stew/potion
  stack 1; ender_pearl/egg 16); tool durability from `TOOL_TIERS`, armour
  from the vanilla piece x material factor table, and such stacks never
  merge. `add` (pickups: existing stacks first in slot order — hotbar
  before main — then first empty slots), `addStack` (preserves worn
  durability), `canAccept` (gates the item magnet), `select`/`selectNext`
  (wrapping), `consumeSelected`, `damageSelected` ('broken' clears the
  slot), and the vanilla screen semantics: `clickSlot` (pick up / put down
  / merge to cap / swap), `rightClickSlot` (half up / place one / no-op on
  incompatible), `shiftClick` (to the other region, merging first).
  `subscribe(fn)` notifies the HUD, screen and hand on every change.
- `src/ui/icons.js` — item icons for the hotbar and screens plus the shared
  slot renderer (icon + count + durability bar). Non-block items are an
  `<img>` straight from `assets/items/<name>.png` (the real textures, never
  generated); block items render their real atlas tiles once into a small
  canvas as the classic isometric inventory cube (top/left/right faces,
  vanilla shading), cached as a data URL. Visual routing shares
  `itemVisualInfo` with dropped items, so slot icons always match the world
  and hand visuals.
- `src/ui/screens.js` — Phase 7 inventory screen: E opens (releases pointer
  lock, suppresses the lock hint via a body class), showing the 27 main
  slots over the 9 hotbar slots on a vanilla-grey panel. Left click picks
  up / puts down / swaps / merges; press-drag-release moves a stack in one
  gesture; right click picks up half / places one; shift-click moves
  between hotbar and main. The cursor stack follows the mouse as a ghost
  slot. E or Esc closes; a stack still on the cursor goes back into the
  inventory, and anything that truly doesn't fit drops at the player's
  feet. Closing re-requests pointer lock (the post-Esc cooldown rejection
  is swallowed — the click-to-play hint covers it).
  Phase 8: the same panel now carries a craft area above the slots — a 2x2
  grid + result slot in inventory mode, a 3x3 in 'Crafting' mode (opened by
  right-clicking a placed crafting table). Grid cells use the exact Phase 7
  click semantics (cross-container press-drag-release works too); shift on
  a grid cell moves the stack back to the inventory; the result slot
  previews the live recipe match, click (either button) crafts once onto
  the cursor, shift-click crafts the maximum straight into the inventory
  (guarded so a craft is never consumed when its result can't fit).
  Closing drains both grids back into the inventory before the cursor;
  true overflow drops at the feet with durability preserved.
- `src/systems/crafting.js` — Phase 8 crafting core, pure logic (node tests
  drive it directly): the recipe registry (every SPEC.md critical-path
  recipe — planks x4, sticks x4, crafting table, furnace ring, the four
  material tiers of pickaxe/sword/axe/shovel, torches x4, flint and steel,
  bucket, bow, arrows x4, the three SPEC armour sets in the standard
  shapes, brewing stand, blaze powder x2, eye of ender ('ender_eye', the
  texture name), glass bottle). Shaped recipes store a trimmed pattern +
  precomputed horizontal mirror and match the grid's occupied bounding box
  anywhere in a 2x2 or 3x3 grid — a 3-wide/3-tall pattern therefore
  physically requires the crafting table, which is the SPEC grid gating.
  Shapeless recipes match the occupied cells as a sorted multiset.
  `craftResult(slots, width)` is the single matcher; `canFit` computes
  real acceptance capacity against inventory stack caps; `CraftingGrid`
  owns the grid slots (click semantics shared from Inventory.prototype —
  the Phase 7 hardened ones, not a re-implementation), `takeResult`
  (vanilla cursor rules; tools arrive at full durability, never stack),
  `craftMaxInto`, `shiftOut`, `drainInto` (returns overflow for the drop
  path). SPEC note: SPEC's sword row duplicates its shovel row
  ("1 material + 2 sticks"), so shapes disambiguate — the vanilla shapes a
  Minecraft player will try (sword = 2 material over 1 stick). Glass
  bottle follows SPEC literally: 3 glass -> 1 bottle (vanilla gives 3).
- `src/world/blocks.js` — full block registry (50 blocks: all SPEC.md tables
  plus stronghold/decorative blocks the atlas supports). Per block: id, name,
  per-face tiles resolved to BoxGeometry order `[px,nx,py,ny,pz,nz]`,
  hardness, preferred tool, min tool tier for drops, drops (with counts and
  chances), solid, transparent, light level, light `opacity` (Phase 4:
  levels absorbed during propagation — defaults opaque 15 / transparent 0,
  water and leaves override to 1), and behaviour flags (falls, fluid,
  damagesOnContact, slows). Phase 7 rendering/shape fields: `selfCull`
  (default true — transparent same-id runs merge; leaves and cactus
  override false so interior planes render), `occludesAO` (default
  solid && !transparent; leaves override true so canopies darken inside),
  `inset` (horizontal shrink of side faces AND collision box — cactus
  `SHAPES.CACTUS_INSET` 1/16). Lookup helpers: `blockDef`, `isSolid`,
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
  the unused normal attribute are gone. Phase 7 mesher fixes: non-self-cull
  transparent blocks (leaves, cactus — registry `selfCull: false`) render
  their same-id interior planes as exactly ONE DoubleSide quad per shared
  plane (emitted by the positive-direction face, so chunk borders stay
  deterministic and no coplanar pair can z-fight) — canopies now read as a
  dense mass with dark interiors instead of a hollow shell (leaves also
  `occludesAO`); cactus side faces are always emitted, pulled `inset`
  (1/16) into their own cell (full width/height, only the plane moves)
  while top/bottom faces stay full-size — stacked cacti read continuous
  like vanilla, the top-face quad visible edge-on through the gap.
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
  registry drops table (chance and [min,max] counts honoured; the crack
  material uses multiply-with-alpha blending so cracks darken the face's
  own lit colour — dark at night, never a fullbright glow); right-click
  places the selected block against the targeted face into air/fluid cells
  only, never overlapping the player, never outside the world's vertical
  range, repeating every `PLACE_REPEAT_SECONDS` while held; `finishBreak`
  nulls the target so a same-frame place can't build against a face that
  was just broken; first-person hand (camera child, drawn depth-free over
  the world like vanilla so point-blank walls can't swallow it) — a
  generated pixel-skin arm, or a mini-cube of the block about to be placed —
  swings on click, on place and continuously while mining. Phase 7: the
  inventory drives everything the proto-inventory scaffolding used to — the
  hotbar selection is what the hand shows (block mini-cube with the vanilla
  ~45° corner placement, item sprite for tools/materials, bare arm when
  empty — `HAND.BLOCK_*`/`SPRITE_*` offsets/tilts/scales in config), what
  `miningPlan` checks, and what right-click places (consuming 1 from the
  stack); breaking a hardness>0 block with a held tool wears 1 durability
  (instant-break blocks don't, like vanilla), and a tool hitting 0 vanishes
  mid-hold. Number keys 1-9 and the scroll wheel (down = next) change the
  selection while pointer-locked; digits preventDefault so Ctrl-sprint
  chords can't switch browser tabs. (`debugSetMouse` remains as test
  scaffolding, `window.__interaction`/`__inventory`/`__screens` exposed).
  Phase 8 changes in this file:
  (1) **Hand render pass** — the first-person hand lives in its own scene
  rendered by `renderHand(renderer)` (main.js calls it right after the
  world render; autoClear off, depth cleared, restored after) with a
  dedicated fixed-FOV camera (`HAND.FOV` 50, aspect synced on resize).
  This fixes the distorted held block two ways: the world camera's wide
  FOV + sprint FOV kick no longer perspective-skew the corner of the
  screen, and the held meshes use the normal shared materials with real
  depth testing (the old depth-free clones let the cube's own back faces
  draw over front faces — the "skewed cube" look). Held mesh placement
  constants retuned for the new frustum; the arm box got per-face
  brightness vertex colours so it reads as a limb from any angle.
  (2) **Real cracks** — the 10 break stages are the genuine
  `assets/destroy/destroy_stage_0..9.png` textures loaded directly
  (NearestFilter, SRGBColorSpace so the multiply-with-alpha blend uses the
  authentic texel values); the generated crack random-walk is gone. A
  stage that hasn't finished loading never binds (visibility guard), so
  there's no black flash on the first-ever break.
  (3) **Use hook** — right-click first offers the targeted block to
  `onUseBlock` (wired in main.js: a crafting table opens the 3x3 screen);
  a handled use consumes the press entirely (no place, no hold-repeat),
  and sneaking bypasses it so blocks can be placed against a table,
  exactly like vanilla.
- `src/entities/items.js` — dropped item entities: point physics with the
  item's midpoint as the collision probe both ways (cell-sweep landing with
  no tunnelling; a rising item stops UNDER a ceiling — it can never poke
  into the cell and get squeeze-popped through, verified in a flooded
  cavern under a submerged roof), ground vanishing re-falls, a block placed
  into an item's cell pops it on top (the intended squeeze path), water
  float + drag; visuals as bobbing/rotating mini-blocks (atlas per-face UVs
  + face-brightness vertex colours, shared geometry/material caches) or
  flat item sprites from assets/items/*.png; magnetise to the player's body
  centre within `ITEMS.MAGNET_RADIUS` (1.5) — the pull goes through the
  same collision move, so walls block it (no vacuuming drops through solid
  blocks); collected at `PICKUP_RADIUS` after `PICKUP_DELAY_SECONDS`,
  despawn after `DESPAWN_SECONDS` or `VOID_DESPAWN_DEPTH` below the world;
  items whose chunk is unloaded freeze entirely (physics would otherwise
  regenerate the chunk synchronously outside the streaming budget on every
  border crossing); broken-block drops pop up with random scatter.
  `createBlockMesh` is shared with the hand. `window.__items` exposed.
  Phase 7: `onPickup(name, count)` returns how many the inventory accepted
  (undefined = all) — a refused item stays in the world with its physics,
  waits `ITEMS.PICKUP_RETRY_SECONDS` before offering itself (or
  magnetising) again, and partial acceptance shrinks the entity's count.
  `itemVisualInfo`/`createSpriteMesh` are exported for the hand and the UI
  icons so every surface shows the same visual for an item name.
- Phase 7 physics/feel fixes in `controller.js`/config: `_sweep` understands
  per-block horizontal `inset` boxes — the blocking plane moves into the
  cell and the transverse overlap test shrinks, so the body clamps flush
  against a cactus's 15/16 box, slides past (or falls off) the 1/16 rim
  instead of snagging, and still lands on the full-size top; each layer now
  scans for the NEAREST blocking plane so mixed cactus/full-cube layers
  clamp correctly. Everything else about the sweep (flush wall clamps,
  no-tunnelling cell scan, auto-step retry, embedded-body no-shove) is
  unchanged and re-verified. `SPRINT_JUMP_BOOST` retuned 4 -> 1.8: repeated
  sprint-jumping now averages the vanilla ~7.1 blocks/s (measured
  7.0-7.2 across 30/60/144fps) versus 5.6 flat sprinting — it was 8.9-9.2,
  far over vanilla.
- Phase 5 movement bug fixes (older session, overriding earlier notes):
  step height is vanilla 0.6 (`STEP_HEIGHT`/`SNEAK_EDGE_DROP` 0.6) — full
  1-block ledges now require a jump, and sneaking refuses 1-block drops like
  vanilla; while ANY part of the body touches water, space swims up slowly
  (no more normal jumps from shallow pools or pool edges — the shallow-jump
  special case and `SHALLOW_JUMP_MAX_SUBMERSION` are gone; bank exits still
  ride the water exit hop; a dry centre column — only a box corner clipping
  the pool, submersion 0 — keeps full gravity and no swim thrust, so the
  pool edge can't levitate the player over dry land); sprinting while fully
  submerged triggers the vanilla swim mechanic: `body.swimSprinting` swims
  fast (`SWIM_SPRINT_SPEED`) toward the look direction (pitch-driven
  vertical, `input.pitch` now part of the body input), lowers the eye to
  `SWIM_EYE_HEIGHT` (prone feel) and widens the FOV like a land sprint.
  Entry AND persistence key off the STANDING eye height, so surfacing drops
  the prone mode — surface swimming can't self-sustain on its own lowered
  eye and drain breath. `toggleFly` clears the flag.

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

Phase 6's adversarial multi-agent review (4 lenses — correctness, spec
fidelity, regression, edge cases — each independently probing the real
modules in node and the running browser game) confirmed and led to fixes for:
rising items tunnelling up through solid ceilings (midpoint collision both
ways now; flooded-cavern and dry-bonk probes); items in unloaded chunks
forcing synchronous chunk regeneration on every border crossing (frozen
until the chunk reloads); same-frame placement against a just-broken face
(stale target nulled); placing at the world ceiling eating the collected
count (vertical range guard); pool-edge levitation (full gravity on a dry
centre column); surface swim-sprint self-sustaining and draining breath
(standing-eye rule); the crack overlay glowing fullbright at night
(multiply-with-alpha blending); the magnet vacuuming drops through walls
(collision-checked pull); the hand being swallowed by point-blank walls
(depth-free draw over the world); a stale `swimSprinting` flag across the
fly toggle; plus config extraction of remaining tunables and comment
fixes. 14 regression checks were added for these — 109 automated checks
total (84 node + 25 browser), all passing, zero console errors.

Phase 7 verification: 69 node checks against the real modules — 50 on the
Inventory class (registry stack caps and durabilities incl. every armour
piece; add existing-stack-first then first-empty ordering; 36x64+overflow;
tools one-per-slot at full durability; consume/damage/break-at-zero;
select/wheel wrap; the full clickSlot / rightClickSlot / shiftClick
semantics incl. the vanilla inert-on-full-same-item click, right-click
incompatible swap, durability preservation, no-room stays, addStack keeping
wear, emit-on-change-only), 10 physics (cactus clamp at the 15/16 plane,
grazing past the rim where a full cube would block, landing on the top,
falling past the rim, sneak refusing the cactus rim while stone support
reaches farther, stone wall flush clamp + jump height regressions), 9
mesher (3x3x3 leaf cube = 54 exterior + 54 one-per-plane interior quads;
leaf pair across a chunk border emits the shared plane exactly once, from
the +x side; water still merges runs; single cactus = 5 quads with side
planes at 1/16 and full-size top; stacked cacti = 10 incl. the interface
plane; meshing-order byte determinism), plus sprint-jump speed measured
7.0-7.2 blocks/s at 30/60/144fps vs 5.6 flat. In headless Chromium: 45
checks, zero console errors — 26 gameplay (hand shows block/sprite/arm and
switches with the selection; place consumes; mining wears exactly 1
durability and instant-break doesn't; tool breaking mid-hold vanishes the
tool and re-shows the arm; pickup merges into existing stacks; wrong-tier
stone survives punching; non-block items don't place; full inventory
refuses pickups which wait and re-enter when a slot frees; mid-break
selection switch resets progress and charges nothing; a worn dropped tool
returns at its worn durability) and 19 inventory-screen checks under REAL
pointer lock (E opens/unlocks, click pickup/drop, press-drag-release,
right-click half/place-one, shift-click across regions, close returns the
cursor stack, Esc closes, holding E doesn't flap, trackpad micro-deltas
accumulate to one hotbar step while a discrete notch steps exactly once).
Screenshots verify the vanilla look: hotbar with real icons/counts/
durability bars and highlight, the small angled corner-held block and
mirrored held pickaxe, dense dark-interior canopies from above/below/
inside, stacked cacti reading continuous, the grey inventory screen.

Phase 8 verification: 122 node checks against the real modules — every
critical-path recipe matched (planks in all cells of both grids, sticks in
all 6 positions of the 3x3 and both 2x2 columns, table at all 4 offsets of
the 3x3, furnace ring incl. filled-centre rejection, all four tool tiers
in all shapes incl. the mirrored axe and bow, torches/flint-and-steel/
bucket/arrows/armour x3 sets/brewing stand/blaze powder/ender eye/glass
bottle), 3x3-only patterns rejected by the 2x2, wrong-material mixes and
junk rejected, stack counts ignored for matching; takeResult cursor
semantics (merge to cap, overflow block, wrong-item block, tool results at
full durability that never stack); craftMaxInto (8 logs -> 32 planks,
full-inventory crafts nothing and consumes nothing, partial-fit crafts
exactly what fits, tools limited by free slots); canFit cap edges;
shiftOut/drainInto incl. partial fits and overflow reporting; borrowed
grid click semantics. In headless Chromium, 53 checks, zero console
errors: the FULL OPENING PLAYED END TO END through the real DOM — a real
oak tree found and punched by hand, log picked up, planks crafted in the
2x2 (result preview + counts verified in the DOM), shift-craft-max 32
planks, crafting table crafted and PLACED in the world, right-click...
opens the 3x3 (verified under REAL pointer lock via the game's own
mousedown path, incl. the sneak bypass placing instead, and E still
opening the 2x2), sticks and the wooden pickaxe crafted at the table,
stone mined with it (real destroy_stage_N.png crack overlay verified
mid-break with the stage tracking progress), cobblestone collected, stone
pickaxe crafted (durability 132); the tier gate live — a wooden pickaxe
broke iron ore slowly with NO drop, the stone pickaxe harvested raw_iron;
durability wear summed exactly (4 wooden-pickaxe uses across the run).
Screenshots confirm the two bug fixes: the held block is a clean
undistorted mini-cube (top + two sides visible, vanilla corner placement)
and cracks are the genuine destroy-stage art multiplying the lit face.

Phase 8's adversarial review (5 independent lenses — crafting logic,
UI/DOM, render/input regression, SPEC fidelity, integration edge cases —
each probing the real modules in node and/or headless Chromium; the logic
lenses ran exhaustive offset/mirror placement sweeps, a 20k-state fuzz
proving canFit exactly predicts Inventory.add acceptance, and 30k-operation
aliasing/conservation fuzzes) confirmed and led to fixes for:
- Crack overlay glowing near-white: the real destroy-stage PNGs' background
  texels are WHITE at alpha 1/255 (not black-transparent), doubling the
  face brightness under the multiply-with-alpha blend. Fixed with alphaTest
  on the crack material — surviving texels have alpha 1 so the blend is
  exactly dst * src.rgb. Verified numerically: a mid-grey face under the
  overlay reads 128 -> 128 (was 255); the darkest crack texel reads
  128 * 61/255 = 31, the exact multiply.
- Flint was unobtainable (blocking flint_and_steel, arrows, and eventually
  the Nether portal): gravel now drops flint at 10% replacing the gravel
  drop, vanilla-style, via a new `fallback: true` drop-table semantic in
  blocks.js/interaction.js (chance entries roll first; fallback entries
  drop only when no chance entry succeeded).
- craftMaxInto chaining into a DIFFERENT recipe when uneven cell counts
  left a remainder matching something else (a 4-plank table craft with
  extra planks in two cells chained into sticks) — the loop now stops when
  the matched result changes from the recipe the player clicked.
- The right-click use decision reading last frame's raycast while placement
  used the current frame's (one-frame asymmetry could open a table the
  crosshair just left, or place against one it just reached) — the use
  check now resolves inside update() against the same fresh target
  placement uses.
- `body.sneaking` freezing across the F4 fly toggle (fly never steps the
  body; Phase 8's use/place gate is its first external reader) — toggleFly
  now clears it, like the Phase 6 swimSprinting fix.
- WEAPON_DAMAGE config keys renamed to the real item ids (wooden_sword...)
  so the combat phase's obvious `WEAPON_DAMAGE[selectedName]` lookup will
  work; nothing consumed the table yet.
- The screen cursor-ghost element staying visible over gameplay after
  closing a screen with a stack on the cursor (pre-existing, now hidden on
  close).
All re-verified after the fixes: 180 automated checks (127 node + 53
browser), zero console errors, plus the isolated WebGL blend readback.

A 20-agent adversarial review (5 lenses: inventory correctness, UI/DOM,
render/physics regression, spec fidelity, integration edge cases; every
finding independently re-reproduced by a dedicated verifier against the
real modules) confirmed and led to fixes for: mid-break hotbar switches
keeping the stale mining plan (tier/drop-gate bypass, durability charged to
the wrong item — the held item is now part of the break key, so switching
resets progress vanilla-style); left click with a matching cursor on a full
stack swapping instead of the vanilla no-op; right click over a
non-combinable stack doing nothing where vanilla swaps; worn tools dropped
by the close-screen overflow path returning at full durability (item
entities now carry durability through spawn -> pickup -> addStack); one
hotbar step per wheel event regardless of delta (trackpads flew through
slots — deltas now normalise and accumulate against
INTERACTION.WHEEL_STEP_DELTA); the passive wheel listener letting
Ctrl+scroll zoom the browser mid-game (non-passive + preventDefault);
holding E flapping the screen open/closed (repeat guard); and the sneak
edge guard treating a cactus cell as full-cube support (now inset-aware —
sneaking refuses the rim instead of walking off the collision box). All
re-verified: 114 automated checks (69 node + 45 browser), all passing,
zero console errors.

---

## Partially built

- The rest of `src/` exists as empty stub modules with responsibility headers
  (world/caves.js, player/stats.js, entities/entity.js, entities/mobs.js,
  entities/pathfinding.js, entities/dragon.js, systems/, dimensions/).
- `ui/hud.js` still lacks hearts and hunger (stats phase).
- `ui/screens.js` has the inventory + crafting screens; furnace/death/
  victory screens are later phases (the panel/slot/cursor structure is
  ready to extend).
- Phase 8 deliberate slices:
  - Crafting recipes only cover what the item set supports — no chest
    recipe (the chest block has no container UI yet), no golden tools
    (gold tier isn't in SPEC's tool table), no shield/ladder/door.
  - Vanilla's drag-to-distribute across grid cells (holding a button and
    sweeping) isn't implemented — click/right-click per cell is.
  - Recipe unlocking/recipe book: none, by design.
  - The crafting table block has no persistent per-table state (vanilla
    drops grid contents on close; here they return to the inventory, which
    is the modern-vanilla behaviour for the 2x2 and kinder for the 3x3).
- Phase 7 deliberate slices:
  - Armour items exist in the registry (stack 1, correct durabilities) and
    can live in the inventory, but there are no equip slots and no damage
    reduction yet — that's the stats/combat phase.
  - No off-hand. Cursor stacks can't be thrown into the world by clicking
    outside the panel (vanilla drops them) — closing the screen returns or
    drops them instead. No Q-to-drop either.
  - Tools wear 1 durability per broken block for every tool class (vanilla
    charges 2 for swords); swords have no attack use until combat.
  - Number-key/wheel selection and the E screen are keyboard-only bindings
    (no rebinding UI).
- Phase 6 deliberate slices, replaced by later phases:
  - Dropped items and the hand are not lit by world light (unlit atlas
    material, correct per-face brightness only) — a `getLight` sample can
    tint them when the mob phase adds it.
  - `sand`/`gravel` have `falls: true` in the registry, but there is no
    falling-block entity yet; mined support just leaves them floating.
  - No break/place/footstep sounds yet (SPEC "feel" row; no audio system).
  - `oak_sapling` and `glowstone_dust` drops have no shipped item texture;
    items.js renders stand-ins (leaves mini-block / blaze powder sprite)
    via its VISUAL_ALIAS map — hotbar/screen icons follow the same alias.
  - Breaking water/lava directly is impossible (not targetable) — bucket
    interactions are an item-phase concern.
  - Dropped item ENTITIES still never merge with each other in the world
    and have no count cap beyond the 300s despawn — sustained mining
    without pickup accumulates one draw call per item. (Pickup into the
    inventory does stack correctly as of Phase 7.)
  - Generated-art internals (crack random-walk shape, arm skin palette) are
    deliberately inline in interaction.js — they are the art itself, not
    gameplay tunables; everything gameplay-facing (offsets, timings, sizes,
    swing shape fractions) lives in config.js.
- The controller exposes but does not consume damage inputs — stats.js later
  wires `body.lastLanding` (fall damage), `body.breath === 0` (drowning),
  and `damagesOnContact` blocks (cactus/lava contact does nothing yet;
  cactus now collides as its 15/16 box, so "touching a cactus" checks can
  use the same inset).
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

- Likely Phase 9 is caves/ores (fill in `world/caves.js` — carved caves get
  correct darkness and torch light for free from the Phase 4 flood fill,
  breaking ore already drops the right items, and crafting/tiers are ready
  to consume them) or smelting (systems/smelting.js + a furnace screen —
  the screens.js craft-area/slot machinery extends; furnace right-click
  should route through main.js `onUseBlock` exactly like the crafting
  table does).
- Phase 8 APIs for later phases: `craftResult(slots, width)` is the only
  matcher; add recipes via the `shaped`/`shapeless` helpers at the top of
  systems/crafting.js (append — order matters only if two patterns could
  match the same grid, which none do today). `CraftingGrid` is reusable
  for any future grid-shaped container. `screens.openCrafting()` opens the
  3x3; new usable blocks hook into main.js's `onUseBlock` (return true =
  click consumed; sneaking already bypasses upstream).
  `interaction.renderHand(renderer)` must stay the LAST render call of the
  frame; anything new drawn as an overlay should render before it.
- The held-item/hand look lives entirely in `INTERACTION.HAND` (config):
  FOV/NEAR/FAR for the dedicated hand camera, POSITION/tilts/scales sized
  for that frustum — if the FOV changes, everything needs re-tuning
  against screenshots (sizes appear ~1.5x bigger at 50 vs 70).
- Phase 7 APIs for later phases: `inventory` (main.js `window.__inventory`)
  is the single item-ownership truth — `add(name, count)` returns leftover
  (crafting/smelting outputs, mob drops), `addStack` preserves durability,
  `canAccept`, `selectedName`/`selectedStack`, `consumeSelected`,
  `damageSelected` ('broken' clears), `subscribe(fn)` for any new UI.
  `itemMaxStack`/`itemMaxDurability` are the item registry — extend the
  tables there for new items. `items.spawn(name, count, pos, vel?,
  durability?)` drops anything and pickups route durability back through
  `onPickup(name, count, durability)` in main.js. Slot UI: reuse
  `renderSlotContent`/`createItemIcon` (ui/icons.js) for any new screen.
  `interaction.target` is the live raycast result ({x,y,z,id,face,distance}
  or null); `createBlockMesh(blockId, size)` (entities/items.js) builds the
  mini-block used by drops and the held hand.
- The break key includes the held item name — any selection change resets
  break progress and recomputes the plan (that's what keeps the tier/drop
  gate and durability charge honest); don't "optimise" it back out.
- Headless-harness gotchas (cost this session real time): headless Chromium
  FREEZES requestAnimationFrame permanently once pointer lock engages — do
  event-driven tests (keys, screens, wheel) under real lock, but anything
  frame-driven unlocked via `setView`/`debugSetMouse`/`debugForceInput`;
  Playwright's injected mouse also emits huge fake movementX/Y around lock
  engagement, so suppress mousemove (capture + stopImmediatePropagation) or
  never use page.mouse while locked. SwiftShader frames are slow and uneven
  — wait on frame counters (`renderer.info.render.frame`) or polled
  conditions, never wall-clock. Phase 8 note: the hand pass is a second
  render() per frame, so `renderer.info.render.frame` now advances by 2 per
  displayed frame (fine for waiting on progress) and `info.render.calls/
  triangles` report the hand pass, not the world — use a mid-frame probe if
  world draw-call stats are ever needed again. The right-click use decision
  resolves in interaction.update(), so a locked-pointer harness test that
  dispatches a synthetic right mousedown must drive
  `__interaction.update(dt)` once by hand (rAF is frozen under lock).
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
| 6 | Block interaction (interaction.js): voxel DDA raycast (5 reach), black targeted-face outline, hold-to-break timed by hardness × tool class/tier with wrong-tier very-slow-no-drops, 10-stage generated crack overlay (multiply-blended, night-correct), right-click place onto the targeted face (air/fluid cells only, never inside the player or outside the world, hold-repeat, no stale-face placement), registry-table drops; dropped item entities (items.js): mini-block/sprite visuals, bob + rotate, midpoint collision both ways (no ceiling tunnelling), water float, wall-blocked 1.5-block magnetise, pickup, despawn, unloaded-chunk freeze; first-person depth-free hand (pixel arm or held mini-block) swinging on click/place/mining; proto-inventory scaffolding; Phase 5 fixes: step height 0.6 (jump for full blocks), space-in-any-water swims up slowly (no pool-edge levitation), submerged sprint = vanilla swim mechanic (fast, pitch-driven, prone eye, standing-eye surface disengage); INTERACTION/ITEMS config blocks; adversarially reviewed (4 lenses, all confirmed findings fixed) + 109 automated checks | Inventory/hotbar replacing the proto-inventory, tool durability, item stack merging, falling sand/gravel entities, item/hand world-light tinting, sounds, caves/ores (caves.js), non-cube special shapes |
| 7 | Inventory (inventory.js): 36 slots / 9 hotbar, stacking to 64 with per-item registry (tools + armour stack 1, carry durability; pearls/eggs 16), pickups existing-stack-first then first-empty, vanilla click/right-click/shift-click semantics; hotbar HUD (hud.js) with real item icons (icons.js — assets/items sprites verbatim, isometric atlas cubes for blocks), counts, durability bars, selection highlight; 1-9 keys + delta-accumulating scroll wheel; inventory screen on E (screens.js) with click and press-drag-release moves, cursor ghost, close-returns-cursor (overflow drops at the feet, durability preserved through the drop); held item switches visibly (block cube / item sprite / bare arm); mining wears tools, broken tools vanish; partial pickups with retry when full. Bug fixes: held item vanilla-sized in the corner, leaves render interior faces + occlude AO (dense dark canopies), cactus sides inset 1/16 with 15/16 collision (sweep + sneak guard inset-aware), sprint-jump retuned to ~7.1 b/s. Adversarially reviewed (20 agents, 5 lenses, 8 unique confirmed findings all fixed) + 114 automated checks | Armour equip slots + damage reduction (stats/combat), crafting grid in the screen, Q-drop / click-outside-drop, dropped-entity stack merging, hearts/hunger HUD, caves/ores (caves.js), non-cube special shapes, sounds |
| 8 | Crafting (systems/crafting.js): every SPEC critical-path recipe (shaped with bounding-box position independence + vanilla horizontal mirroring, shapeless as multisets), 2x2 craft area on the inventory screen + 3x3 crafting-table screen (screens.js) sharing the Phase 7 slot/cursor machinery, live result preview, click-crafts-one / shift-crafts-max (capacity-guarded, stops if the matched recipe changes), grids drain back on close; right-click on a placed crafting table opens the 3x3 via main.js `onUseBlock` (resolved in update() against the fresh raycast; sneak bypasses to place, vanilla-style); tools craft at full durability, tier gates verified live end to end (punch wood -> planks -> table -> sticks -> wooden pickaxe -> stone -> stone pickaxe; wooden pickaxe can't harvest iron ore, stone can); gravel drops flint 10% (new fallback drop semantic) so flint_and_steel/arrows are reachable. Bug fixes: held item renders in a dedicated fixed-FOV hand pass (undistorted self-occluding cube; arm re-tuned with per-face shading), cracks are the real assets/destroy/destroy_stage_0..9.png advancing with progress (alphaTested — their background is white at alpha 1/255, not transparent-black). Adversarially reviewed (5 lenses, 7 confirmed findings all fixed) + 180 automated checks (127 node + 53 browser incl. real-pointer-lock use-path tests) | Furnace/smelting (furnace right-click routes like the table), chest UI, drag-to-distribute crafting gesture, Q-drop, armour equip, hearts/hunger HUD, caves/ores (caves.js), non-cube special shapes, sounds |
