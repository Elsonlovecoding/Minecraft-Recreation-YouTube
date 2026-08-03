# PROGRESS

Updated at the end of every session. Read at the start of every session.

**If something is listed as WORKING, do not rewrite or refactor it. Build on it.**

---

## Status

Phase last completed: **Phase 13 — hostile mobs, combat and armour (the real
roster: zombie / skeleton with bow / creeper with block-destroying explosion /
wall-climbing spider, daylight burning, weighted natural spawning; the combat
system: weapon damage with vanilla 1.9 cooldown scaling and falling crits, the
player bow with draw-scaled arrows, arrow projectiles both ways; armour: four
equip slots with drag + right-click equip, SPEC damage reduction, durability
wear, HUD armour bar, drops on death) + the Phase 12 zombie-head-angle fix**

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

- `src/world/caves.js` — Phase 9 underground generation, all of it a pure
  function of (seed, x, y, z): (1) **Cave carving**, two noise layers —
  tunnels carve where two 3D simplex fields' squared sum dips under a radius
  threshold (the neighbourhood of their zero-surface intersection curve:
  long winding spaghetti, mostly horizontal, y-squashed), caverns where a
  low-frequency squashed field exceeds a depth-loosening threshold (open
  rooms, common deep, absent above y=48). Both live in y -50..60
  (`CAVES.MIN_Y/MAX_Y`), taper closed at the bottom, and are sampled on a
  world-aligned lattice every 4 blocks (`LATTICE_STEP`) then trilinearly
  interpolated per block — fast (~1.5ms of the ~4ms chunk gen) and
  bit-identical across chunk borders whatever the generation order.
  (2) **Surface entrances**: above MAX_Y tunnels keep carving only inside
  sparse entrance regions (low-frequency 2D mask), where they stay wide
  enough to walk into — a handful of real cave mouths per few-chunk area
  plus rare 1-block "rabbit holes", never a pockmarked surface. Only dry
  inland grass/stone columns qualify (no holes in beaches/deserts — sand
  would float — and none above y=96). (3) **Ravines**: a 2D ridged line
  field's zero-contours gated by a very-low-frequency rarity mask; V-shaped
  depth profile (full-depth core, shallowing edges, per-column jitter for
  rough walls), up to 48 deep, spans 50-180 blocks, roughly one system per
  ~200x200 — they breach the surface (exposed) and are the second findable
  way down. (4) **Ocean shield**: no carving within 6 blocks below the
  surface wherever any column in a 5x5 neighbourhood is at/below sea level —
  ocean floors stay sealed, no static-water walls against cave air
  (region-verified: zero contacts). (5) **Lava pools**: every carved cell
  below y=10 (`OVERWORLD.LAVA_POOL_MAX_Y`) becomes lava instead of air —
  the classic lava-flood level; deep tunnels become pools, big caverns lava
  lakes, all lit by lava's light 15 through the Phase 4 flood fill.
  (6) **Stone variants**: granite/diorite/andesite blobs from two more 3D
  fields (primary picks granite/diorite at ±threshold, secondary picks
  andesite where the primary is quiet) — ~3% of stone each, seamless across
  chunks. (7) **Gravel pockets** in stone (the underground flint source).
  (8) **Ore veins** per config `ORES` (exact SPEC Y ranges): compact
  random-walk veins from a per-chunk seeded PRNG, replacing stone-family
  blocks only, clipped at chunk borders (deterministic); coal/iron 4-12 per
  vein, gold/redstone 4-8, diamond 1-4 with a strong bottom bias (min of
  three uniforms — 83% of diamond sits below y=-30). Census per chunk:
  ~59 coal, ~72 iron, ~22 gold, ~33 redstone, ~12 diamond.
  `surfaceOpenAt(col, colAt)` is the pure decoration guard terrain.js uses
  so trees/cacti never anchor on a carved-away surface — margin anchors get
  the same answer the owning chunk computes (float-exact: the query and the
  carve share lerp arithmetic and f64 lattices; region-verified zero
  mismatches).
- `src/world/terrain.js` Phase 9 integration: the carver runs after the
  base column fill and before decorations; tree and cactus placement skip
  anchors whose surface the caves carved (same overall structure —
  everything still a pure function of (seed, x, z)).
- `src/entities/falling.js` — falling sand/gravel: any `world.setBlock`
  fires `world.onBlockChanged` (new hook, wired in main.js), which queues
  support checks for the cell above the edit and the edited cell itself; a
  `falls` block with nothing solid under it detaches into a full-size
  mini-block entity, falls with a cell-sweep (no tunnelling), and settles
  back into the world where it lands. Vanilla rules: lands on a torch ->
  breaks into an item (torch survives); fluids are displaced — falling
  blocks sink through water AND lava and settle on the floor beneath, so
  lava lakes can be filled with gravel like vanilla (matters at diamond
  depth). Cascades chain naturally (each vacated cell re-queues the cell
  above), entities freeze in unloaded chunks like dropped items.
- `src/player/stats.js` — Phase 11: the full survival loop (fly mode exempt
  from all of it; every tunable in config `STATS`):
  - **Health/damage**: `damage(amount)` is the single entry point (mobs will
    call it too); every hit drives the HUD red flash and adds a little
    exhaustion. `applyKnockback(dirX, dirZ)` shoves the body horizontally
    and pops it up (never cancelling upward velocity) — cactus uses it now,
    combat later.
  - **Hunger 20** with a hidden vanilla-style saturation buffer: activity
    accrues exhaustion (sprint 0.1/block, swim 0.01/block, jump 0.05 or 0.2
    sprinting, damage 0.1, regen 6.0 per heal); every 4.0 exhaustion drains
    1 saturation, then 1 hunger once the buffer is dry. Eating restores
    both (`eat(food)`, driven by interaction.js).
  - **Regeneration** at hunger >= 18: +1 health per 4s, costing 6
    exhaustion — healing makes you hungry, the vanilla eat-to-heal loop.
  - **Starvation** at 0 hunger: 1 damage per 4s down to
    `PLAYER.STARVE_FLOOR_HEALTH` (1 heart) — hunger alone never kills (SPEC).
  - **Fall damage**: consumes the controller's one-frame `body.lastLanding`
    signal — 1 heart per block beyond 3 (SPEC); fluids already suppress the
    landing report in the controller, fly and respawn teleports exempt.
  - **Drowning**: 2 damage per second while `body.breath` is 0 underwater.
  - **Lava + fire**: lava contact 4 per 0.5s tick (inset AABB corner
    sampling as before) and (re)sets 15s of burning; burning ticks 1/s and
    persists after climbing out; any water contact extinguishes it.
  - **Cactus contact**: 1 damage per 0.5s tick via an AABB inflated 0.1
    (reaches past the 1/16 inset box; standing on top counts), with
    knockback away from the block.
  - **Death**: main.js's onDeath closes any open screen WITHOUT relocking
    (grid + cursor stacks return to the inventory first), the whole
    inventory drops as item entities where you died (durability preserved,
    scatter + pop), the death screen (ui/screens.js) holds until the
    Respawn button, and a dead player collects nothing (main.js pickup
    gate — the corpse can't vacuum its own drops back up). `respawn()`
    teleports to the world spawn with health/hunger/saturation/breath
    restored.
  Dropped items still burn in lava (items.js midpoint check) — dying in
  lava burns what you dropped, like vanilla.
- `src/ui/hud.js` Phase 9/11: hearts row (10 pixel-art hearts, full/half/
  empty generated once as data URLs) above the hotbar's left half, red
  damage screen flash driven by `stats.flashFraction`; Phase 11 adds the
  hunger row — 10 pixel-art drumsticks above the hotbar's right half,
  filling right-to-left like vanilla (full/half/empty variants) — and moves
  the breath bubbles up a row to sit above it.
- `src/entities/items.js` — `createExtrudedItemMesh(name, size)`: the
  vanilla held-item model — the sprite as a one-pixel-thick slab (full
  front/back quads plus one edge quad per opaque/transparent pixel
  boundary, edges sampling their pixel's centre colour, per-face
  brightness), built async from the item PNG and cached per name. Used by
  the hand for tools; dropped items stay flat sprites.
- `src/player/interaction.js` Phase 9 fixes: held tools use the extruded
  slab model angled like vanilla — handle toward the bottom-right corner,
  head raised up and forward on a ~45° diagonal (screenshot-tuned
  `HAND.SPRITE_TILT`); held blocks scaled up modestly
  (`HAND.BLOCK_SCALE` 0.17 -> 0.19).

- `src/systems/smelting.js` — Phase 10 smelting core, two layers, the state
  machine pure and node-tested: (1) **`Furnace`** — a 3-slot SlotContainer
  (input/fuel/output) plus the burn/progress state machine. Registries in
  the file (like crafting recipes): every SPEC smelting recipe (raw_iron,
  raw_gold, sand→glass, cobblestone→stone, the four meats beef/porkchop/
  chicken/mutton → cooked_*; meat item ids follow the texture names) and the
  SPEC fuel values in items-smelted (coal 8, oak_planks 1.5, stick 0.5,
  lava_bucket 100 — burn seconds = value × `SMELTING.SMELT_SECONDS` 10).
  Vanilla rules: fuel is consumed only when a smelt can actually run (recipe
  matched, output empty or same item below cap); once lit it burns to
  exhaustion; progress rewinds at 2× while unlit/blocked; a lava bucket
  leaves the empty bucket in the fuel slot. Vanilla slot gates in the click
  semantics: output never accepts placement (clicking it with a matching
  plain cursor pulls the stack ONTO the cursor), fuel slot accepts fuels
  only; `addStack` (the shift-click router) sends smeltables to input and
  fuel to fuel. (2) **`createSmeltingSystem`** — the per-position furnace
  map (`furnaceAt` creates lazily on first open). `update(dt)` ticks EVERY
  furnace each frame — smelting continues with the screen closed, and
  multiple furnaces run fully independently — and swaps the block between
  its lit/unlit variant (facing preserved) as the burn state changes; the
  block-change listener drops all three slots as items when a furnace is
  mined (lit↔unlit swaps stay in the family and keep state).
- `src/world/blocks.js` Phase 10: the furnace is a family of 8 block ids
  (4 facings × unlit/lit, ids 50-56 appended; base id 20 stays 'furnace') —
  every variant drops 'furnace', lit variants show FURNACE_FRONT_ON on the
  facing face and emit light 13 (the Phase 4 flood fill picks emitters up
  from the registry, so the glow needed zero lighting changes).
  `placementVariant(id, cell, playerPos)` orients a placed furnace toward
  the player (interaction.tryPlace calls it); `isFurnace`/`furnaceLitVariant`/
  `furnaceUnlitVariant`/`facingToward` are the family helpers. The chest
  block is now `faces: null` (no cube faces — the mesher emits nothing),
  `transparent` (neighbours draw their faces against the model's gaps) but
  `solid` (full-cell collision), opacity 0 (light passes, vanilla).
- `src/world/chests.js` — Phase 10 chest block entities. One small mesh per
  placed chest built from `assets/entity/chest_normal.png` with the classic
  Minecraft box unwrap (base 14x10x14 at texOffs 0,19; lid 14x5x14 + latch
  2x4x1 at 0,0) — the modern (1.15+) sheet stores every face rotated 180°,
  which the UV builder un-rotates; the front (latch-recess) faces sit in the
  fourth side slot of each strip. Shared geometries/material; per-face
  brightness vertex colours (unlit like items/hand — same known slice). The
  lid + latch hang on a back hinge and ease open/closed while the chest's
  screen is open. Placing a chest (block listener) creates its state facing
  the player (position-derived cardinal); each state owns a persistent
  27-slot SlotContainer; breaking the block drops the contents and removes
  mesh + state; mesh visibility follows the owning chunk's mesh so far-away
  chests don't float in the fog. `createChestMesh(size)` is exported for the
  dropped-item/held-hand model (items.js `createModelMesh` centres it) and
  ui/icons.js draws the hotbar icon from the same sheet (isometric top/front/
  side composite, latch overlaid). Crafting: 8-plank ring → chest
  (systems/crafting.js).
- `src/player/inventory.js` Phase 10: generic **`SlotContainer`** — the slot
  array behind chests, the furnace and any future block container (brewing
  stand). Shares the hardened Inventory click semantics and `_insert` the
  CraftingGrid way (prototype assignment, not re-implementation; `_insert`
  loops over `slots.length` now so any size works). Adds `moveSlotTo(i,
  target)` (the cross-container shift-click, merge-first, partial-fit aware,
  durability preserved — also grafted onto Inventory) and `drainAll`;
  `subscribe` returns an unsubscriber so screens can bind/unbind whichever
  container is open.
- `src/ui/screens.js` Phase 10: generic container screens on the same panel/
  cursor machinery. Slot event binding now resolves its container at event
  time (`attachSlotEvents(el, getContainer, i)`), so one set of DOM slots
  serves whichever chest/furnace is open. New modes: **'chest'** (9×3 grid
  bound to the open chest's SlotContainer; the chest's lid opens while the
  screen is up) and **'furnace'** (input above flame above fuel, pixel-art
  progress arrow filling with `progressFraction`, flame draining with
  `fuelFraction`, polled per frame via `screens.update(dt)` from main.js —
  slot changes re-render via container emits). Shift-click routing: with a
  container open, inventory slots shift INTO it (`moveSlotTo` → the
  container's `addStack` rules) and container slots shift back to the
  inventory; craft-grid and hotbar↔main routing unchanged in the other
  modes. Closing unsubscribes the container, eases the chest lid shut and
  leaves container contents in place (only craft grids drain — chest and
  furnace contents persisting is the point). E/Esc close paths, cursor
  return-or-drop, and the Phase 8 crafting behaviour are untouched.
- `src/main.js` Phase 10: block-change listeners are a list
  (`world.addBlockListener` — falling, smelting, chests). `onUseBlock`
  routes furnace family ids to `screens.openFurnace(smelting.furnaceAt(...))`
  and chest to `screens.openChest(chests.chestAt(...))` exactly like the
  crafting table. The loop ticks `smelting.update` (always — UI-independent),
  `chests.update` (lid + visibility), `screens.update` (indicators), and
  after `dayNight.update` applies the submerged-in-lava fog override
  (`LAVA_VIEW` colour/near/far; dayNight rewrites fog colour every frame so
  leaving lava restores itself, near/far restored explicitly).
  `window.__smelting`/`__chests` join the dev scaffolding.
- Phase 9 bug fixes shipped in Phase 10:
  - **Lava volume/placement** (`world/caves.js` `_placeLava`, config
    `CAVES.LAVA`): carving now writes air only; a post-carve pass floods
    every carved cell at/below `LAKE_MAX_Y` (-54) — the deep lava lakes —
    and above that, up to `OVERWORLD.LAVA_POOL_MAX_Y` (10), places only
    small occasional pools (1-deep puddles on cave floors inside a sparse
    2D mask region) and rare single-block wall leaks (interior cells only,
    so the neighbour test never leaves the chunk). `CAVES.MIN_Y` deepened
    to -60 (fade 4) so the lake band exists; deep mining at y≈-52 is now
    practical. Census over 192×192: zero lava at/above y=10, zero unflooded
    lake cells, pool band ~0.07 cells per column (was: every carved cell
    below y=10).
  - **Cave size variety** (`CAVES.TUNNEL.GIRTH`, cavern retune): tunnel
    radius is modulated along the passage by a low-frequency girth field
    (0.55–1.35×, clamped ≥1 above the cave band so surface mouths stay
    walkable), and caverns got lower frequency + higher thresholds — larger
    (10-40 blocks across, stacked levels where the field folds) and clearly
    rarer. Census: median horizontal crossing 4 (50% ≤4 — the narrow
    winding tunnels), 14% ≥10 wide (the caverns), max ~41.
    `surfaceOpenAt` gained the girth term through the same lattice
    arithmetic — region-verified zero mismatches against the actual carve.
  - **Dense lava physics** (`controller.js`, config `PLAYER.LAVA_*`): lava
    is a real fluid kind now (per the Phase 9 note — extends the water
    handling, water maths untouched). Very slow movement (`LAVA_SPEED`
    1.1), strong drag kills entry plunges within a fraction of a second,
    buoyancy neutral at full submersion so the body sinks slowly and only
    partially (drifts just under the surface instead of dropping to the
    floor), jump/sneak rise/dive slowly, the bank exit hop works from lava,
    both fluids reset fall distance. A grounded edge-graze (dry centre
    column) keeps the normal jump so puddle rims stay escapable.
  - **Submerged-lava view** (`ui/hud.js` + main.js fog override, config
    `LAVA_VIEW`): while the eye is in lava, a near-opaque tiled overlay of
    the real still-lava atlas texel art (darkened) covers the frame below
    the HUD and the fog collapses to arm's reach; both clear instantly on
    surfacing.
  - **Hotbar highlight repaint** (`ui/hud.js`): the selection box is a
    dedicated element moved by transform — repositioned on inventory emits
    AND guarded per frame in updateHud — replacing the per-slot `.selected`
    ::after class whose toggle sometimes didn't repaint under pointer lock.
  - **Held item/arm framing** (config `INTERACTION.HAND`): POSITION moved
    to [0.5, -0.4, -0.72] (further into the lower-right corner — it blocked
    the view), ARM_SIZE z shortened 0.48 → 0.33.
  - **Held-tool re-select crash** (`player/interaction.js`): re-selecting a
    previously held tool crashed — `createExtrudedItemMesh` fires onReady
    synchronously on a cache hit and the callback closed over a `const`
    still in its temporal dead zone. The mesh variable is pre-declared now;
    the sync call safely no-ops and the visibility line after the call
    covers the cache-hit case.
  - **Mesher culling** (`world/chunks.js`): the "lower transparent id emits
    the shared plane" rule now ignores PASS_NONE neighbours (chest, portal
    interiors render no cube faces) — a torch or cactus on a chest keeps
    its bottom face; also future-proofs iron bars against portal blocks.

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

Phase 11 (this session) additions, one entry per file:
- `src/player/interaction.js` Phase 11 — the right-click priority chain is
  now: usable block (unless sneaking) > bucket action > hold-to-eat > place.
  **Eating**: holding right click with food selected while hunger is missing
  runs a `STATS.EAT_SECONDS` (1.6s) hold — the hand eases toward the mouth
  and nibbles (`HAND.EAT_*` config) — then consumes 1, applies the food's
  hunger/saturation, spawns the container item (stew -> bowl) and swings;
  releasing or switching the selection restarts from zero; eating never
  places. **Buckets**: an empty bucket scoops the first fluid cell on the
  crosshair ray (a fluid-aware raycast — a nearer solid still wins) into a
  water/lava bucket; a full bucket places its fluid against the targeted
  face (into air/fluid cells only; fluids may be placed into the player's
  own cell, vanilla) and reverts to the empty bucket; exactly one bucket
  action per press — the held item changes underneath, so hold-repeat would
  immediately undo itself. **Torch placement**: `placementVariant` now takes
  the clicked face — top faces place the floor torch, wall faces the wall
  variant leaning out of that wall, ceilings refuse (nothing consumed), and
  torches require the clicked support block to be solid.
- `src/world/blocks.js` Phase 11 — wall torch block ids 57-60
  (`TORCH_WALL_S/N/E/W`, all dropping 'torch', light 14); the whole torch
  family is `faces: null` (the mesher's generic cube emitter skips it) with
  `special: 'torch'`; `TORCH_LEAN` maps each id to its lean direction,
  `isTorch`/`torchSupportCell` are the support helpers (floor: below; wall:
  the block behind), and `placementVariant(id, cell, pos, face)` picks the
  variant from the clicked face (null = face can't hold it).
- `src/world/chunks.js` Phase 11 — torches mesh as the vanilla box model,
  not cubes: a `SHAPES.TORCH` 2px-wide, 10px-tall post centred on the cell
  floor; wall variants pivot at their wall, raised 3.5px and tilted 22.5°
  out of it (vanilla template_torch_wall geometry). Sides sample the torch
  tile's 2px art column, the top the flame pixels, the bottom the stick
  base. Torch quads are lit flat by the torch's own cell (it is the
  emitter — no AO on a 2px post) in the cutout pass.
- `src/entities/items.js` Phase 11 — dropped sprite items use the extruded
  one-pixel-thick slab model (`createExtrudedItemMesh`, the same model the
  hand holds) instead of a flat plane, so a dropped item has visible depth
  from the side. `ATLAS_SPRITE_ITEMS`/`atlasSpriteCanvas` route items whose
  art lives in the block atlas (the torch — there is no
  assets/items/torch.png) into every sprite path: dropped slab, held hand
  slab (built synchronously from the atlas canvas), and UI icon.
- `src/ui/icons.js` Phase 11 — block-cube icons redrawn with true dimetric
  proportions (45° yaw / 30° elevation orthographic: vertical edges drop
  ~0.612·W, the icon ~11% taller than wide — `BLOCK_ICON_ASPECT`); the old
  square construction visibly squashed every block icon flat. Chest icon
  follows; block/chest icon img heights scale by the same aspect; atlas
  sprite items (torch) get a data-URL icon.
- `src/ui/screens.js` Phase 11 — clicking the backdrop outside the panel
  with a stack on the cursor throws it into the world along the camera
  direction (`ITEMS.THROW_SPEED`/`THROW_UP`): left click the whole stack,
  right click a single item, durability preserved. The death screen ("You
  died!" over a red overlay, Respawn button) holds input until respawn —
  `showDeath()`/`closeScreen(relock=false)` are the stats-phase hooks; the
  Respawn click runs `onRespawn` (main.js -> stats.respawn()) and relocks
  the pointer.
- `src/player/inventory.js` Phase 11 — the `FOODS` registry (vanilla hunger
  + saturation per item, cooked meat far above raw; stew carries
  `container: 'bowl'`) with `foodValue(name)`; `replaceSelected(name)` for
  the bucket fill/empty swaps (stack-1 items).
- `src/world/terrain.js` Phase 11 — canopies are a layer deeper
  (`TREES.WIDE_LAYERS` 3 5x5 layers under the 3x3 + plus cap) and the 5x5
  corners are kept with a 50% per-corner hash (`CORNER_CHANCE`) instead of
  always clipped — the middle of a tree now reads as a dense mass (leaf
  census ~13 leaves per trunk log, was ~9), still byte-deterministic across
  generation order.
- `src/main.js` Phase 11 — torch-support block listener (floor torches pop
  off as items when the block below goes, wall torches when their wall
  goes; cascades ride the listener chain), the death flow wiring
  (onDeath/onRespawn above), `stats` passed to interaction, and the
  dead-pickup gate.
- config `CAVES.ENTRANCE` retune — walkable surface cave mouths (>= 3
  connected open columns, ravines excluded) measured over six 192x192
  regions: 0.32 -> ~1.0 per 100x100 columns; mouths stay clustered in
  regions rather than pockmarking, still only on dry grass/stone columns.

Phase 12 (this session) additions, one entry per file:
- `src/main.js` Phase 12 — **the pause**: whenever the pointer is unlocked
  with no screen open (Esc from gameplay, or before the very first click)
  the game freezes completely — player physics and mid-jump momentum,
  interaction (break progress), items, mobs, falling blocks, smelting,
  chests, stats, fluids, the lava-texture scroll and the day/night clock
  all stop (`isPaused()` gates the loop; `dayNight.update(0)` keeps the
  palette applied without advancing time). Input needs no extra gating:
  every gameplay input path already requires pointer lock and screens can
  only open while locked, so E/number keys/clicks are dead while paused.
  Esc while paused retries the lock (vanilla resume; the post-Esc-cooldown
  rejection is swallowed and a click resumes instead), and index.html shows
  a "Game paused" title over the hint once play has begun. The harness
  override (`player.inputOverridden`) keeps headless tests running
  unlocked. World streaming continues while paused (terrain is not
  gameplay).
- `src/world/fluids.js` — **flowing lava** (the Phase 9 "no flowing fluids"
  slice closed for lava): a budgeted cellular automaton driven by
  block-change events plus a one-time settle scan of each newly meshed
  chunk (generated lava with air below or beside — the Phase 10 wall leaks
  and pool rims — starts flowing when first seen). Vanilla Overworld rules:
  pour downward first (LAVA_FALL columns, one cell per 1.5s tick), spread
  across surfaces up to 3 from a full-strength cell with each step a lower
  level, falls re-spread at full strength where they land, flows revalidate
  against their neighbours each tick and decay when the feed is cut
  (scooping a source drains its flows outward). Only air fills — lava
  never invades water or displaces blocks. All writes go through
  world.setBlock, so meshing/lighting/falling-support/torch pops ride the
  normal listener path. Config FLUIDS: tick, range, per-level render
  heights, scroll rate, per-tick update cap (the remainder carries — a
  lake edge can never stall a frame), chunks scanned per frame.
- `src/world/blocks.js` Phase 12 — lava family ids 61-64 (LAVA_FLOW_1..3 +
  LAVA_FALL): fluid, damaging, light 15, transparent (neighbours render
  behind the partial volume), `special: 'lava_flow'`, never targetable or
  dropped. `LAVA_LEVEL_OF` flat table + `isLava`/`isLavaSource`/
  `lavaFlowLevel` helpers — physics, stats, items, pathfinding and the
  mesher all key off them.
- `src/world/chunks.js` Phase 12 — the PASS_LAVA bucket: flows/falls mesh
  as partial-height cells (FLUIDS.FLOW_HEIGHTS per level, falls full),
  top faces UV-oriented along the local downstream direction (gradient of
  neighbour surface heights, air pulls downhill), side faces culled
  against equal-or-taller lava and opaque neighbours and pulled 0.001 into
  the cell (never z-fights a transparent neighbour's boundary face), lit
  flat by their own emitting cell like torches. The material samples its
  own repeating copy of the still-lava atlas tile; one shared offset.y
  scroll (`materials.scrollLava(dt)`, driven un-paused from main.js)
  animates every face along its own local flow axis — downstream on tops,
  downward on sides. Also: `chunk.lightData` — the centre chunk's computed
  light packed sky<<4|block per cell, copied on every remesh for
  `world.getLight` point queries.
- `src/player/interaction.js` Phase 12 — the crack overlay is a UNIT cube
  exactly on the block faces with polygonOffset (-1/-2) winning the depth
  test against the coplanar face: crack texels align with the block's own
  texel grid from every angle (the old inflated cube parallaxed the crack
  up to a pixel off the face at grazing views). Combat interception: a mob
  under the crosshair (nearer than the targeted block, within
  MOBS.ATTACK_REACH) makes the pending left click an attack via the
  `combat` bridge and holds mining while aimed at it; bucket scooping now
  fills only from SOURCE cells (flowing lava is not a bucketful, vanilla).
- `src/entities/entity.js` — the base entity every mob builds on, pure
  logic (node-testable with any { getBlock, getChunkIfLoaded } world): the
  PlayerBody collision model simplified for mobs — exact per-axis swept
  cell scans (no tunnelling at terminal velocity), gravity, a
  MOBS.STEP_HEIGHT (1 block) auto-step retry so mobs climb full blocks
  without jumping, water buoyancy + bank-exit hop, lava as a slow dense
  fluid; health with a single damage() entry point (knockback along the
  hit direction, never cancelling upward velocity), hurt/death timers,
  despawn rules (hostiles beyond DESPAWN_DISTANCE 128, anything below
  VOID_DESPAWN_Y), unloaded-chunk freeze like dropped items.
- `src/entities/pathfinding.js` — budgeted A* over walkable feet cells
  (`findPath`, `standableAt` — both pure over a getBlock fn): solid
  harmless floor + body clearance, step up 1 (with headroom over the
  current cell), walk off ledges landing within MAX_DROP 3 (lava or solid
  interrupting the drop column rejects it), lava and contact-damage floors
  never standable. Binary-heap open set; at most NODE_BUDGET (500)
  expansions per call so a search can never stall a frame — budget
  exhaustion (or a walled-off goal) returns the closest-approach path so
  the mob keeps moving while the next repath refines.
- `src/entities/models.js` — mob models from textured boxes using the real
  assets/entity sheets with the STANDARD entity unwrap (top/bottom over a
  right/front/left/back strip — unlike the chest's rotated variant),
  `mirror` flipping U for left limbs on legacy sheets (the zombie's bottom
  half is empty), optional per-part inflate. Parts are pivot Groups for
  animation; geometry cached per (texture, part); material cloned per mob
  instance (hurt flash + local light tint) over a shared NearestFilter
  SRGB texture; per-face brightness vertex colours like chests/items (mobs
  are unlit, tinted by baked world light).
- `src/entities/mobs.js` — the registry (per-mob stats/models live here
  per ARCHITECTURE.md; one `placeholder` entry this phase: zombie stats
  and skin from SPEC, arms-raised pose), the spawning framework (per
  SPAWN_INTERVAL_SECONDS: random ring 24..96 from the player, column walk
  to solid opaque harmless ground, no water, hostile gate effective light
  <= 7 where effective = max(block, sky - dayNight.skyDarken), passive
  gate >= 9 on grass — framework in place, no passive types yet; caps
  HOSTILE_CAP/PASSIVE_CAP; unmeshed chunks (no light data) never spawn),
  pursue AI (repath every 0.5s, waypoint following, straight-line inside
  CHASE_DIRECT_RANGE, melee bite with stats.damage + applyKnockback —
  fly-mode and dead players exempt), animation (body yaw eases toward the
  move direction, limb swing rides actual ground speed, arms counter-sway
  over their pose, head tracks the player within 8 blocks clamped to neck
  limits), per-frame light tint from world.getLight (cave mobs dark,
  torch-lit mobs warm, eased to avoid cell popping) + red hurt flash,
  death fall-over then drops (rotten_flesh 0-2), lava contact damage for
  mobs. Player combat: `raycast` (slab test over live mob AABBs) +
  `attack` with the swing cooldown; main.js bridges it into interaction
  with WEAPON_DAMAGE[selectedName] ?? fist.
- `src/world/world.js` Phase 12 — `getLight(x, y, z)` -> { sky, block }
  (0-15) from the chunk's mesh-time light copy, or null when the chunk has
  never meshed; refreshed on every remesh (it can lag an edit by the frame
  or two until the dirty chunk remeshes — fine for spawn checks, never
  rebuild windows per query).
- `src/render/lighting.js` Phase 12 — `dayNight.skyDarken` getter (0 day
  .. 11 deep night) for the hostile spawn gate.
- config Phase 12 — FLUIDS block; MOBS grew the spawning framework, entity
  physics, combat feel, AI, animation and PATH tunables; INTERACTION crack
  polygonOffset constants replace CRACK_INFLATE; PLAYER.FALL_DAMAGE_PER_
  BLOCK 2 -> 1 (half a heart per block beyond 3 — 4 blocks = 0.5 hearts,
  10 = 3.5, 23+ kills from full, the SPEC examples); PLAYER.STARVE_FLOOR_
  HEALTH 2 -> 10 (5 hearts, Easy difficulty). The exhaustion values were
  audited against vanilla and were already exact (sprint 0.1/block, swim
  0.01, jump 0.05/0.2, damage 0.1, regen 6.0, 4.0 per hunger point) — the
  "hunger drains too fast" report was the doubled fall damage feeding the
  eat-to-heal regen loop (each heal costs 6.0 exhaustion), now halved to
  vanilla; measured: standing still and 5 minutes of walking drain
  nothing, continuous sprinting loses its first hunger point after ~43s.

Phase 13 (this session) additions, one entry per file:
- `src/entities/mobs.js` Phase 13 — the placeholder is gone; the real
  hostile roster, each an entry in `MOB_TYPES` (SPEC stats/drops exactly)
  plus an AI state function, spawn-weighted into the Phase 12 framework:
  - **zombie** (20hp, 3dmg, rotten flesh): the Phase 12 pursue-and-bite,
    melee now routed through combat so armour reduces it; burns in
    daylight.
  - **skeleton** (20hp, arrows for 4, bone + arrow drops): keeps its
    distance — approaches to `SKELETON.PREFERRED_RANGE`, backs straight
    away inside `RETREAT_RANGE`, holds and aims with line of sight (a
    coarse solid-block march, checked ~1/s at the shot decision), and
    fires every 2s with LEAD: the arrow aims at the player's position
    plus velocity x flight-time, lifted for the gravity arc, jittered by
    `ARROW_INACCURACY`. Arms raise into an aiming pose (eased blend) and
    track the target pitch. Burns in daylight.
  - **creeper** (20hp, explosion 22 at centre, gunpowder): walks at the
    player; inside `IGNITE_RANGE` (3) it stops, HISSES (combat's
    procedural synth, volume by distance), swells up to +35% scale and
    blink-flashes white at 5Hz while the 1.5s SPEC fuse runs; the fuse
    rewinds at 2x if the player escapes `ABORT_RANGE` (7). At zero it
    removes itself (no drops — exploding is not dying) and hands combat
    the explosion. Does not burn in daylight.
  - **spider** (16hp, 2dmg, string, 0.9 tall / 1.2 wide so it fits
    1-block gaps — pathfinding clearance 1): fast (3.2), neutral in
    bright light unless `provoked` (any player hit flips the flag),
    hostile at effective light <= 7 like vanilla; CLIMBS — pressing into
    a wall sets the entity's climbing state (vanilla ladder-style: the
    AI writes the climb speed, gravity stays out of it) so walls are not
    cover. Eight legs splay in the vanilla rest pose and scuttle-swing
    while moving.
  - **Daylight burning** (zombie + skeleton): direct sky light 15 at the
    head, `dayNight.skyDarken <= 2` (day), not in water — 1 damage/s and
    an orange flicker tint. Any roof/canopy shades (leaves cost 1 sky
    light level, so trees are real cover, like vanilla).
  - Animation dispatch per type: biped (zombie/skeleton arms + legs,
    skeleton aim blend), creeper (diagonal leg pairs), spider (leg-pair
    yaw scuttle + roll lift over the models.js rest pose). Head tracking,
    body-yaw ease, hurt flash, light tint, death fall-over all carry over
    from Phase 12; the creeper adds its fuse flash/swell to the tint
    chain (hurt > fuse blink > fire flicker > plain tint).
- `src/entities/models.js` Phase 13 — the per-mob box-geometry tables,
  converted from the real vanilla Java models (pivot_y = 24 - rotationPoint,
  offset_y = -(boxOffset + height)): `HUMANOID_MODEL` (moved from mobs.js),
  `SKELETON_MODEL` (2px limbs, 64x32), `CREEPER_MODEL` (head at 18..26px,
  four 4x6x4 legs at z ±4), `SPIDER_MODEL` (head/neck/abdomen + eight
  16x2x2 legs pivoted at the body sides) and `SPIDER_LEG_POSE` (the
  vanilla splay angles). **The Phase 12 zombie-head bug fix**: every part
  pivot now rotates in `YXZ` order — with the default XYZ, a yawed head
  pitching at the player rolled sideways instead of nodding (the "head
  angled slightly wrong" report; worst at diagonal look angles).
- `src/systems/combat.js` Phase 13 — the stub is real, four parts:
  - **Player melee**: every click swings; damage = `WEAPON_DAMAGE`
    (swords AND axes now) x the vanilla 1.9 charge curve
    0.2 + 0.8·(elapsed/cooldown)² — sword recharges in 0.625s, axe in
    1.0s, everything else 0.25s — x1.5 crit while falling (SPEC).
    Landed hits wear the held tool 1 and cost attack exhaustion.
  - **Armour pipeline**: `damagePlayer` is the single entry for
    combat-type damage (mob melee, arrows, explosions): reduction =
    4% per worn protection point (config `COMBAT.ARMOR_POINTS`, the
    vanilla per-piece tables — full sets land exactly on SPEC: leather
    7pts=28%, iron 15=60%, diamond 20=80%), minimum 1 through any
    armour, knockback BEFORE damage (the Phase 11 corpse-launch lesson),
    every hit wears each equipped piece max(1, floor(damage/4)).
    Environmental damage (falls, lava, fire, drowning, cactus, starving)
    keeps its direct stats path, unreduced.
  - **Bow + arrows**: hold right click with the bow selected to draw
    (needs an arrow; slot switch restarts; pointer-lock loss cancels),
    release fires from the crosshair — damage rounds 1..6 and speed
    18..53 by draw fraction of 1s (SPEC: 6 at full draw), consuming one
    arrow and 1 bow durability. Arrows (the real
    `assets/entity/projectiles_arrow.png` as two crossed quads, tip
    +z, oriented by velocity, tinted by baked light) fly a gravity arc
    with light drag; per frame the flight segment is voxel-raycast for
    blocks and slab-tested against mobs (player arrows) or the player
    AABB (skeleton arrows) — nearest wins. Block hits stick the arrow
    (exact hit CELL remembered — mining that block frees it to fall);
    stuck player arrows can be picked back up within 1.2 blocks after
    0.5s; stuck arrows despawn at 30s, flyers at 15s.
  - **Explosions**: a ragged crater (radius 3, per-block rim jitter) of
    every destructible block — `hardness > 10` survives (obsidian,
    bedrock), fluids and portal interiors untouched — with 30% of
    destroyed blocks dropping their registry drop tables; block removal
    rides `world.setBlock`, so falling-sand support checks, torch pops
    and chest content spills all fire through the normal listener chain.
    Damage scales linearly to zero at radius 6 (creeper max 22 — SPEC)
    for the player (through armour, knocked away from the centre) and
    every living mob. Plus an expanding flash shell and a WebAudio boom.
  - The tiny procedural noise synth (lazy AudioContext, looped noise
    buffer through a filter + gain envelope) supplies the creeper hiss
    and the explosion boom — there is no audio asset system yet, and
    generated art is the established pattern.
  - Pure maths exported for tests: `weaponCooldownSeconds`,
    `attackChargeFactor`, `armourReductionFactor`, `rayAABB` (moved here
    from mobs.js; mobs imports it back — combat never imports the mob
    manager, main.js injects a lazy getter).
- `src/player/inventory.js` Phase 13 — `ArmourContainer`: four equip
  slots (helmet/chestplate/leggings/boots) as a gated SlotContainer in
  the furnace's gating pattern — a wrong-piece placement is inert,
  `addStack` (the shift-click router) sends a piece to its own slot only
  when empty, `damageAll(wear)` wears every equipped piece and breaks a
  piece at zero durability. `Inventory.armour` instance, `equipSelected`
  (right-click equip: swaps the held piece with the worn one),
  `armourPoints` (config points sum — drives combat reduction and the
  HUD bar), `consumeItem(name, n)` (all-or-nothing across stacks — bow
  shots eat arrows), and `drainAll` now empties the armour slots too
  (SPEC: armour drops on death with the rest of the inventory).
- `src/player/interaction.js` Phase 13 — the right-click chain grows one
  link: usable block (unless sneaking) > bucket > **armour equip** >
  hold-to-eat > place. Bow: holding right with the bow selected drives
  `combat.updateDraw`; only a real button RELEASE fires along the current
  crosshair ray — switching the hotbar slot away mid-draw cancels (never
  auto-fires), as does pointer-lock loss. Drawing (like eating) blocks
  mining and placing. Breaking a real block now costs
  `STATS.EXHAUST_BREAK_BLOCK`.
- `src/player/hand.js` Phase 13 — the first-person hand, split out of
  interaction.js per the ARCHITECTURE cap note it carried since Phase 12
  (interaction is back to ~650 lines): the fixed-FOV render pass, the
  generated pixel-skin arm, the held block/tool/model meshes following
  the hotbar selection, and the swing / eat / bow-draw pose animation
  (the draw pose eases in and pulls back with the charge, `HAND.DRAW_*`).
  Faithful extraction — interaction drives it (startSwing, update with
  the eating state), main.js calls `renderHand` as before.
- `src/entities/entity.js` Phase 13 — `horizontalCollision` (pushed into
  a wall last step) and the `climbing` state: while climbing, horizontal
  control stays ground-style (the body keeps pressing the wall while
  airborne) and gravity is skipped entirely — the AI writes the climb
  velocity like a vanilla ladder. Fighting gravity instead made the
  climb rate framerate-dependent: at the clamped 0.1s frame,
  gravity·dt alone exceeded the climb speed and spiders could not climb
  at all below ~13fps.
- `src/player/stats.js` Phase 13 — `exhaust(amount)` exposed for
  combat's attack cost and interaction's block-break cost (fly mode and
  death exempt, like everything else).
- `src/ui/screens.js` Phase 13 — the inventory screen carries an armour
  column beside the 2x2 craft area: four gated slots with faint
  grey piece silhouettes when empty (CSS ghosts, hidden by `filled`),
  full click/drag/right-click semantics via the shared slot machinery,
  shift-click equips a piece from the inventory (inventory mode only)
  and unequips back from the armour column.
- `src/ui/hud.js` Phase 13 — the armour bar: 10 pixel-art plates above
  the hearts (mirroring breath above hunger), one per 2 protection
  points with half-plate odd values, hidden entirely while nothing is
  worn (vanilla).
- `src/main.js` Phase 13 — `createCombat` wired between stats and
  interaction (interaction's combat bridge IS the combat system now: the
  crosshair mob raycast, attacks, and the bow); mobs receive combat for
  melee/arrows/explosions; `combat.update` ticks arrows and explosion
  flashes inside the pause gate. `window.__combat` joins the dev
  scaffolding.
- config Phase 13 — `COMBAT` (cooldowns, charge curve, crit, armour
  points/reduction/wear, bow, arrow physics, explosion), `MOBS` grew
  `DAYLIGHT_BURN`, `SKELETON`, `CREEPER`, `SPIDER` blocks and dropped
  the player-side `ATTACK_COOLDOWN_SECONDS` (weapon-dependent in COMBAT
  now); `WEAPON_DAMAGE` gained the axes and dropped the never-consumed
  `bow_full_draw` (ranged bow damage lives in `COMBAT.BOW`);
  `ARMOR_REDUCTION` (set-level, never consumed) replaced by the
  per-piece points tables; `STATS` gained `EXHAUST_ATTACK`,
  `EXHAUST_BREAK_BLOCK`, `ARMOR_PX`; `INTERACTION.HAND` gained the
  `DRAW_*` pose.

Phase 13 verification: 68 node checks against the real modules — the
weapon table exact (fist 1, swords 4/5/6/7, axes 7/9/9/9), cooldowns
(sword 0.625s / axe 1.0s / default 0.25s), the charge curve at its
endpoints and midpoint (0.2 / 0.4 / 1.0, overcharge clamped), armour
reduction landing exactly on the SPEC set values (7/15/20 points ->
28/60/80%), rayAABB (hit/miss/inside/range/reverse), the armour container
(slot gating inert on wrong pieces for click and right-click, addStack
routing only into an empty own slot, pick-up off worn slots, damageAll
wear arithmetic and break-at-zero, equipSelected swaps, full-set points,
drainAll including armour, consumeItem all-or-nothing across stacks),
the registry matching SPEC stats/drops for all four mobs, creeper fuse
1.5s, the entity wall-collision flag and the climb impulse scaling a real
wall (and NOT lifting non-climbers), and the model tables (2px skeleton
limbs, 4 creeper legs, 8 16px spider legs, creeper head 18..26px, spider
head forward). In headless Chromium, 35 gameplay checks against the
running game, zero console errors throughout: the zombie closes 8 blocks
and bites; full iron armour turns the 3-damage bite into exactly 1 while
wearing every piece; the HUD armour bar appears; a fully-charged iron
sword hits for 6, a spam swing for ~1-2, and a knockback-airborne swing
crits for 9 (the falling crit, caught accidentally and then asserted
deliberately); the skeleton fires real arrow entities that hit the
player; the creeper ignites within 3 blocks, swells, blinks and explodes
— removed, an 8+-block crater carved, the player damaged through armour;
the spider ignores the player at noon until provoked by a sword hit, then
chases and bites, and climbs a 5-block stone well pressing toward the
player; zombies and skeletons burn at noon under open sky while the
creeper stands unharmed; the bow draw charges to full, the released
arrow hits for 6, consumes 1 arrow and 1 bow durability, and the draw
state clears; the inventory screen shows the four armour slots filled
with the worn set. Screenshots verify the look: all four mobs correct
against their real textures (zombie arms-raised walk, thin aiming
skeleton, creeper with the iconic face on four stubby legs, splayed
red-eyed spider), the armour column with ghost silhouettes and
durability bars, the armour bar over the hearts, the held bow.

Phase 13's adversarial review (five independent lenses — combat logic,
mobs/AI/models, armour/inventory/UI, Phase 11/12 regressions, session
fidelity — each probing the real modules with its own node and headless-
Chromium repro scripts over the full diff) came back clean on the armour
machinery (a 120,000-operation click/equip/drag conservation fuzz plus 41
browser DOM checks: zero violations, wrong-piece placements inert on
every path, unequip into a full inventory loses nothing, death drops
carry worn durability through pickup) and on session fidelity (every
requirement present with exact values). Seven findings were confirmed
with repro probes and fixed + re-verified:
- Switching the hotbar slot away from the bow mid-draw FIRED the arrow
  (and skipped bow wear) instead of cancelling — only a real button
  release fires now; any other break of the draw cancels, like the
  pointer-lock path always did.
- A stuck arrow left in a streaming-unloaded chunk synchronously
  regenerated that chunk every chunk-border crossing (~8ms per arrow per
  crossing, measured) through its mined-block probe — stuck arrows in
  unloaded chunks freeze like items and mobs (0/5 crossings regenerate
  in the re-run probe).
- Mining out the block under a >15s-old stuck arrow deleted the arrow
  on the next frame (the flying-despawn safety net measured TOTAL age) —
  the age resets when an arrow is freed, so it falls and re-sticks.
- A spider killed mid-climb rose gravity-free through its death
  animation (the dead AI stopped rewriting `climbing`) — a corpse clears
  the climbing state in the entity step; the probe's corpse now falls
  like the control zombie.
- The skeleton's 0.5-block-sampled line of sight passed through block
  corners, locking it into stand-and-fire against a wall its (exactly
  raycast) arrows could never pass — LoS now uses the same voxel
  raycast the arrows fly on (combat.lineOfSight).
- The explosion flash leaked one sphere geometry per blast (only the
  material was disposed) — the shell geometry is shared now.
- Fly-mode/dead-player targeting was inconsistent across the roster
  (skeletons and creepers stood down, zombies and spiders kept crowding)
  — one `playerTargetable` gate for all four AIs.
Plus the config-hygiene pass the fidelity lens asked for: creeper hiss
audibility (HISS_RANGE/HISS_MIN_VOLUME), explosion boom range
(BOOM_RANGE), skeleton aim height (AIM_HEIGHT_FRACTION), arrow stick
backoff (ARROW.STICK_BACKOFF), the daylight-burn head sample reusing
the mob's headHeightFraction, and the HUD plate count derived from the
best set's points instead of a literal 10. Development itself had
already caught and fixed three more through the harness: stuck arrows
oscillating stuck/unstuck every frame (exact hit-cell tracking now),
spider climbing framerate-dependent to the point of impossibility below
~13fps (climbing is a gravity-free velocity state like vanilla ladders),
and climbing mobs losing wall pressure while airborne (ground-style
steering persists while climbing). All suites re-run green after every
fix: 68 node + 35 browser + the reviewers' own probes, zero console
errors.

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

Phase 9 verification: 21 node checks against the real modules — chunk bytes
identical regardless of generation order (caves included); lava exists
underground and never at/above y=10; the bedrock floor intact under all
caves; ocean floors sealed (zero carved cells within the shield depth over
a 176x176 region) and zero carved-air cells touching still water anywhere;
no trunk/cactus floating over a carved surface; every ore present and
strictly inside its SPEC Y range; diamond clusters 1-4 (>90% of clusters
<=4, rare adjacent-vein merges allowed), coal and iron vein medians in
4-12; granite/diorite/andesite all present in quantity; surface mouths
exist and flood-fill from them descends into the cave band (y<=30) with
on-demand generation following the tunnels; ravines present with 30+ deep
sections; `surfaceOpenAt` agrees with the actual carve at every surface
column of the region (zero float mismatches). **Diamond findability
(SPEC requirement) measured by simulation**: 40 independent trials of
branch mining at y=-54 (2-high tunnels, branches every 3 blocks, ~700
blocks mined ≈ 10 minutes with an iron pickaxe), 39/40 trials found >=1
diamond, averaging 4.9 ore per session. In headless Chromium: boot with
zero console errors; screenshots verify the look (dark cave mouth in a
hillside, torch-lit cave interior with granite and redstone in the walls,
a long narrow ravine cutting the surface, hearts row + red flash); 10
gameplay checks — crosshair targets and iron-pickaxe-mines a real coal
ore with the drop collected; removing support detaches sand which falls
and restacks on the ground (cascade of 2); sand falling onto a torch pops
off as an item and the torch survives; standing in a lava pool ticks
damage, kills, drops the full inventory (which burns in the lava,
vanilla-style) and respawns at the spawn point with full health.

Phase 10's adversarial review (5 independent lenses — smelting/container
logic, screens/HUD DOM, physics/world-gen regression, integration/lifecycle,
spec fidelity — each probing the real modules with its own node repro
scripts, including a 400k-operation conservation fuzz over every
click/shift/drag path and a byte-identical water-physics regression fuzz
against the pre-change PlayerBody) confirmed and led to fixes for:
- One coal smelted 7 items, not SPEC's 8: completing a smelt discarded the
  frame overshoot (`progress = 0`) while burn time debited exactly, so the
  8th item stranded at ~99% as an 80.0s coal died. Progress now carries the
  remainder (plus a 1e-9s epsilon for burns that divide into frames
  exactly); regression-tested at jittered 60fps and dt=1/240 for 1/2/4
  coal → exactly 8/16/32.
- Smelt progress survived an input swap: cobblestone at 95% + click-swap to
  raw_gold yielded a gold ingot in 0.5s. Progress now belongs to the input
  item name and resets when it changes (vanilla).
- The furnace blinked unlit for one frame at every fuel-unit boundary
  (ignite was checked before the burn decrement), costing ~10 chunk
  remeshes per boundary and a visible glow flicker; a unit exhausting
  mid-smelt now re-ignites within the same update.
- Landing while touching lava reported the full drop in `lastLanding`
  (framerate-dependent) — a latent double-punishment for the future fall-
  damage phase; both fluids now suppress the landing report.
- A floating lava wall leak (air beneath — ~20 per 12x12 chunks) read as
  submersion ~1.0 through the topmost-cell waterline, zeroing gravity and
  hanging a falling player mid-air beneath it while contact damage ticked.
  The fluid line now only counts the contiguous run overlapping the body
  (natural contiguous pools take the identical old formula — re-verified
  byte-identical water physics).
- `sprinting` stayed true while crawling through lava (FOV kick at 1.1
  blocks/s); lava now clears the sprint gate.
- Furnace-mode shift-click of an item the furnace takes no interest in was
  a silent no-op; it now falls back to the vanilla hotbar<->main move (a
  full chest still leaves the stack, vanilla).
- The chest latch's front face sat exactly on the cell boundary plane and
  z-fought a block placed against the chest front (the chest is
  `transparent`, so that neighbour face renders); the latch now stops
  0.1px short.
- The girth radius product multiplied in a different association order in
  the pure surfaceOpenAt query vs the carve loop — 0.38% of cells were
  bit-different (zero decision flips observed, but the Phase 9
  float-exactness contract rested on luck); both sites now multiply in the
  same order.
- Hardening: the submerged-lava fog restore is edge-triggered (never fights
  a future dimension's own fog per frame), and main.js closes an open
  chest/furnace screen if its backing block stops existing (unreachable by
  hand today — breaking needs pointer lock — but explosions arrive with
  mobs; without it, deposits into the orphaned container would vanish).
Review lenses also verified clean: zero conservation violations in the
400k-op fuzz, no reachable dupe/loss path through any slot gate, listener
reentrancy safe (Map delete-during-iteration incl.), falling sand can never
replace a container block, PASS_NONE culling audit over all ordered id
pairs found zero new z-fights/holes, chest icon async races benign,
per-chunk generation cost unchanged (~2.5ms), and every item id reachable
from the new code resolves to a real texture/model (98 names checked).

Phase 10 verification: 122 node checks against the real modules — 89 on
smelting/containers (every SPEC recipe and fuel value; coal ignition/burn
duration/chaining across 3 smelts/idle burn-out; exactly 8/16 smelts per
1/2 coal at jittered 60fps frames and at dt=1/240; input swap mid-smelt
resets the cook; continuous burns never blink unlit at fuel boundaries;
no ignition without a recipe, with a full output, or with a mismatched
output; stick 0.5 can never finish a smelt and progress rewinds to zero
without consuming input; planks smelt exactly 1.5 worth; lava bucket burns
100 worth and leaves the empty bucket; output slot rejects placement and
merges onto a matching cursor;
fuel slot rejects non-fuel; addStack shift-routing incl. cap merges and
tool/junk refusal; Inventory<->SlotContainer moves with partial fits and
durability preserved; unsubscribe; furnace block family helpers, oriented
placement for all four approach directions, lit light 13; chest recipe vs
2x2 table recipe; system-level: two furnaces independent, lit swap preserves
facing, UI-closed smelting, burn-out swaps back unlit, break drops contents
and lit<->unlit swaps don't), 19 lava/water physics (slow partial sinking,
entry-plunge kill, crawl movement, slow jump-rise + sink on release, waist
-deep puddle rise-out, bank climb-out from lava; water regressions: float
eye-above-surface, swim speed, breath, dry-land walk speed, no lava flags in
water), 14 cave/lava census over 192x192 (no lava at/above y=10, lake band
fully flooded below -54, pool band sparse ~0.07 cells/column, median
crossing 4 with 50% narrow and 14% >=10-wide, chunk-order byte determinism,
zero surfaceOpenAt mismatches with the girth term). In headless Chromium:
38 gameplay checks, zero console errors — furnace placed/oriented, screen
DOM (title, flame, arrow), shift-click routing into input/fuel through the
real DOM events, ignition swaps to the lit facing variant, indicator DOM
tracks progressFraction, smelting 5 iron with the screen closed, burn-out
swap-back, reopen shows persisted output and shift-collects it, two
furnaces independent in-browser, break drops stacks; chest placed facing
the player, model in scene, 27-slot screen, shift a stack in, lid opens
(-1.45 rad) and closes, contents persist across close/reopen, break drops
and removes model+state; selection highlight tracks 12 switches incl. a
wheel wrap; lit furnace at night; body settles partially submerged in a
staged lava pool with the near-opaque tile overlay + fog collapse, both
clearing on exit. Screenshots verify the chest model art (rim/planks/latch,
correct facing), the chest hotbar icon, held block/tool tucked into the
lower-right corner, the shortened arm, and the lava overlay.

Phase 11 verification: 44 node checks driving the real stats module with a
synthetic body/world (fall damage exactly at/over the SPEC threshold and the
20-damage kill; fly exemption; cactus contact + knockback direction/pop +
tick spacing + standing-on-top; lava contact igniting 15s burning, fire
ticking ~1/s after leaving lava, water extinguishing; drowning 2/s at
breath 0 and stopping on surfacing; sprint exhaustion draining saturation
before hunger; regen at full hunger costing exhaustion; starvation stopping
exactly at 1 heart and never killing; eating clamps; cooked > raw registry
values; death dropping every stack with the death screen holding position
until respawn; no damage or pickups while dead; knockback API). 22 browser
checks against the running game (zero console errors at boot and
throughout; eating refused at full hunger, started when hungry, consuming 1
and restoring hunger through the real held-button path; the regen
eat-to-heal loop stalling below hunger 18; bucket scooping a staged water
source into water_bucket leaving air, and placing it back emptying to
bucket; wall torch placed via a real right press on a wall face becoming
the leaning variant, floor torch on a top face, ceiling refusing without
consuming, and the wall torch popping off as an item when its wall broke;
click-outside-the-panel throwing one item on right click and the rest on
left; an 8-block fall through the real physics costing the SPEC hearts).
Chunk determinism re-verified byte-identical across generation orders with
the denser canopies (leaf census ~13 leaves/trunk-log, was ~9). Cave-mouth
census: 0.32 -> ~1.0 walkable mouths per 100x100 columns over six 192x192
regions. Screenshot suite verifies the look: thin floor-torch post with
flame, tilted wall torch, night torch glow, extruded dropped bread/torch/
pickaxe with visible thickness, true-proportion block icons in hotbar +
inventory, dense dark-interior canopies from below and a hole-free canopy
from above, hunger drumsticks right-aligned with hearts, the death screen.
An adversarial multi-agent review (5 lenses — stats logic, interaction
flow, UI/DOM, meshing/world-gen, SPEC/integration — each probing the real
modules with its own node repros and browser sessions) ran over the full
diff. UI/DOM (51 probes: icon routing for every reachable item id, throw
conservation incl. durability, death overlay input isolation, hunger fill
at odd values, row layout) and meshing/world-gen (torch UV math traced to
the actual atlas texels, wall pivots measured from mesh vertices for all
four facings, border light indexing, culling around torches, canopy
determinism over shuffled generation orders, three coastal ocean-shield
censuses with zero water-air contacts, sand-onto-wall-torch pops) came
back clean. Ten findings elsewhere were confirmed with repros and fixed +
regression-checked:
- Fall damage could apply through water when one fast physics step
  (terminal velocity, or a clamped 0.1s hitch frame) crossed the whole
  pool — the landing suppression read the START-of-step fluid sense; the
  controller now re-senses fluids at the post-move position before fall
  tracking (was 15/50 terminal pond falls dying; now 0/50, dry-land falls
  unchanged).
- stats.update now guards dt <= 0 — body.step early-returns on zero-delta
  frames without resetting lastLanding, so a coarse-timestamp frame
  re-applied the same landing damage.
- A lethal cactus tick knocked back the corpse after die() zeroed the
  velocity (knockback now applies before damage).
- Knockback pops and fluid exit hops were billed as jump exhaustion — the
  controller now sets a one-frame `lastJumped` only on real jumps and
  stats reads that instead of a ground-to-air heuristic.
- An empty bucket right-clicked at a fluid with a usable block behind it
  opened the block instead of scooping — a nearer fluid now resolves
  before the use-block check (a dry click on a table still opens it).
- Switching to another hotbar slot holding the SAME food kept the eat
  timer — eating now keys on slot + name and restarts on any change.
- Mining continued while eating — using an item now blocks attacking
  (break progress resets while an eat is in progress), vanilla-style.
- A torch could be placed INTO a water/lava source cell (burning
  underwater, silently deleting the source) — torch destinations must now
  be air.
- Two config-hygiene fixes: the torch-pop drop height and throw eye-drop
  offset moved to config (ITEMS.DROP_SPAWN_Y_OFFSET reused,
  THROW_EYE_DROP added), the exhaustion teleport guard to
  STATS.EXHAUST_MAX_STEP_BLOCKS; plus a stale items.js header comment
  ("dropped items stay flat sprites") corrected.
All 74 automated checks re-run green after the fixes (44 node + 22
browser gameplay + 8 fix regressions), zero console errors.

Phase 12 verification: 26 node checks against the real modules —
pathfinding (flat direct path; 1-block step-up; routing around a 2-high
wall; taking a 3-drop and refusing a 4-drop; lava floor avoided and not
standable; a sealed goal returns a fast (<50ms) best-effort path toward
it), entity physics (terminal-velocity landing flush at dt=0.1; walking
with the 1-block auto-step; a 2-block wall stopping; knockback velocities;
lethal damage -> death timer -> removal; hostile despawn beyond 128), and
the corrected stats (falls of 3/4/10/23 costing exactly 0/0.5/3.5/10
hearts; starvation flooring at 5 hearts and never killing; standing still
and 5 minutes of walking draining nothing; continuous sprint losing its
first hunger point after ~43s — all vanilla). In headless Chromium (zero
console errors throughout): boot pauses before the first click (day/night
frozen) and the harness override resumes it; E and number keys are dead
while paused; a mid-fall pause freezes position AND velocity exactly and
resume continues the same arc; the placeholder mob spawns on the surface,
pursues the player (10.0 -> 8.1 blocks over ~4s at the vanilla 2.2-2.3
blocks/s with limb swing at full amplitude), takes a raycast melee hit
(-5 hp, red hurt flash confirmed by material colour readback), dies with
the fall-over and is removed, and the night spawn framework produced 11-13
hostiles within caps at legal distances; a staged lava source spread the
exact vanilla diamond (4x level-1, 8x level-2, 12x level-3 around one
source), a rim source poured a falling column one cell per 1.5s tick,
landed ~15 blocks below and re-spread across the ground, and removing the
centre source drained its flows to zero within a few ticks; the flow ids
read back as air,3,2,1,S,1,2,3,air across the pool. Screenshots verify the
look: crack stages exactly inside the outlined face both straight-on and
at a grazing angle (the parallax case), lava terraces stepping visibly
lower with the real animated tile, the falling lava column, the zombie
model (legacy 64x64 sheet: face/body/limbs correct, arms-raised pose,
mirrored left limbs) walking, and the night scene where the mob reads
near-black in darkness (brightness 0.09) and warm-lit next to a placed
torch (0.63).

Phase 12's adversarial review (5 independent lenses — fluid simulation,
entities/pathfinding/spawning, Phase 11 regressions, rendering/meshing,
session-requirement fidelity — each probing the real modules with its own
node repros and browser sessions over the full diff) came back clean on
regressions, on the A* internals (the live-fScore heap mutation is real but
provably self-healing: 1,195 instrumented searches matched a reference
Dijkstra exactly), on the models.js UV math (94/94 numeric checks against
the ground-truth zombie sheet) and on the automaton's convergence (drain/
fuzz/ring probes all quiesce with sources intact and water never invaded).
Seven confirmed findings were fixed and re-verified:
- Flow TOPS animated upstream — the downhill-gradient sign was inverted, so
  surfaces streamed back toward their source while sides scrolled down
  correctly. Air and lower-lava neighbours now accumulate the true
  downstream direction (probe: top-face UVs put +v on the air/downhill
  edge).
- The flow bottom face over a transparent solid (glass, canopy) was exactly
  coplanar with the support's top face (z-fight); lifted by the side inset.
- Stale fluid-queue entries surviving a chunk unload resurrected the
  dropped chunks: the next tick's getBlock regenerated them synchronously
  mid-frame and marched the spread away from the player forever. Cells now
  process only while every chunk they can touch holds data; dropped
  updates heal because _unloadFar clears the settle flag, so a returning
  chunk re-scans and resumes an interrupted spread. (First attempt hooked
  the flag reset into disposeChunkMesh — but remeshing goes through that
  too, and the rescan-per-remesh fed the queue its own writes forever,
  starving distant regions; the reset lives only on the unload paths.)
- Settle-scan flow writes marked chunks `modified` — the keep-forever flag
  — so merely exploring lava terrain pinned most visited chunks' data in
  memory (186 of 256 in the probe). Fluid writes are DERIVED state now:
  setBlock grew a markModified flag, fluid chunks stay unloadable, and the
  probe retains zero chunks after leaving. MAX_UPDATES_PER_TICK raised
  above the initial settle wave (soak: pending 1919 -> 428 and draining).
- Mob melee bit through a 1-block wall (range 1.8 > the 1.6 minimum
  through-wall centre distance); MELEE_RANGE is the vanilla ~1.4 reach,
  which geometrically cannot cross a wall.
- A solid block ending up in a mob's head cell (player placement, falling
  sand) pinned it forever against the sweep's no-shove clamp; mobs now
  take vanilla suffocation damage and die instead.
- Spawn attempts landing outside streamed data generated whole chunks
  synchronously (up to ~143ms per cycle after a respawn teleport) only for
  the light gate to reject them; cold chunks are rejected before the
  column scan.
Plus the ARCHITECTURE config rule applied to the new code: the mob eye
height, melee vertical gate, tint/turn rates, posed-arm sway and the A*
cost weights all moved into config MOBS (the head-tracking eye height now
follows PLAYER.EYE_HEIGHT instead of silently duplicating 1.62). All
suites re-run green after the fixes (26 node + boot/pause/mob/lava browser
suites + the reviewers' own probes), zero console errors.

---

## Partially built

- Remaining stub modules with responsibility headers: entities/dragon.js,
  systems/brewing.js, dimensions/ (entities/entity.js, pathfinding.js,
  models.js, mobs.js are real as of Phase 12; systems/combat.js as of 13).
- Phase 13 deliberate slices:
  - The overworld hostile roster is complete. Still to come with their
    dimensions/phases: enderman, blaze, ghast; passive herds (cow, pig,
    sheep, chicken — the meat drops the food registry already expects).
  - Armour reduces COMBAT damage (mob melee, arrows, explosions) only;
    environmental damage (falls, lava, fire, drowning, cactus, starving)
    is unreduced (vanilla reduces cactus/lava contact too — accepted
    simplification, documented in combat.js).
  - Skeleton arrows only test the player and player arrows only test
    mobs — no friendly fire, no vanilla skeleton-vs-zombie wars, and a
    skeleton can never shoot itself. Skeletons don't strafe (retreat is
    a straight back-away) and don't seek shade while burning.
  - Explosions have no line-of-sight/exposure model: blocks and entities
    within radius are hit through walls. Dropped item entities in the
    blast survive (vanilla destroys them). No visual particles beyond
    the expanding flash shell; sound is the procedural WebAudio synth
    (no audio asset system yet).
  - The bow has no vanilla zoom-while-drawing, no attack-cooldown
    indicator on the HUD, and crits don't require the near-full charge
    vanilla does (SPEC wording — falling is enough).
  - Spider hitbox is 1.2 wide (vanilla 1.4) so cave corridors don't jam
    it; A* stays column-based (width-unaware) and climbing recovers the
    difference. Mobs still take no fall damage (Phase 12 slice).
- Phase 12 deliberate slices:
  - ~~One placeholder mob only... Zombies do not burn in daylight yet~~ —
    Phase 13: the real roster (zombie/skeleton/creeper/spider registry
    entries + AI state functions), zombies and skeletons burn in
    daylight. Enderman and the passive herds remain (above).
  - Mobs don't push the player or each other (no entity-entity collision);
    melee reach compensates. Mob-vs-mob damage now exists ONLY from
    explosions (a creeper blast hurts nearby mobs).
  - Only lava flows. Water stays static (generation seals its lakes; water
    flow + springs are a later phase — the fluids.js automaton generalises
    when needed). Lava meeting water makes nothing (no obsidian/cobble
    yet); flows hover where a fall lands on water.
  - Flowing lava has flat partial-height tops per level (no corner-sloped
    surfaces), and sources keep the static still-lava tile.
  - ~~Mob melee ignores armour... no attack exhaustion cost yet~~ —
    Phase 13: melee routes through combat's armour pipeline; attack and
    block-break exhaustion cost their vanilla values.
  - Spawning is one-at-a-time (no vanilla pack spawns) and there is no
    per-category mob-cap density scaling by loaded chunks.
- `player/stats.js` is complete for solo survival (Phase 11).
  ~~Still missing: armour equip slots + damage reduction... exhaustion
  costs~~ — all shipped in Phase 13.
- Burning has no screen-edge fire overlay or sound — damage flash only.
  Fire exists only as a state (lava sets it); there is no fire BLOCK yet
  (flint-and-steel lighting things is the portal phase).
- Phase 9 deliberate slices:
  - ~~Lava is not swimmable~~ — Phase 10 made lava a dense fluid (slow
    partial sinking, crawl movement, slow rise on jump). Still no
    fire/burning damage-over-time after leaving lava; contact damage plus
    the slow escape remains usually fatal, vanilla-accurate in outcome.
  - ~~No flowing fluids~~ — Phase 12 made lava flow (world/fluids.js:
    pours, spreads 3, recedes; generated wall leaks settle). Water still
    static: carved caves never breach it (ocean shield).
  - Rivers (SPEC overworld row) remain unbuilt — the only SPEC world
    feature not yet placed; needs a fluid-aware carver pass of its own.
  - Sand/gravel floating at generation time (e.g. a tunnel roof under a
    desert) stays put until a neighbouring edit disturbs it — vanilla-like;
    only player-triggered block changes queue support checks.
  - Falling blocks don't push/suffocate entities standing in the landing
    cell; the block simply places (the player can walk/dig out).
  - ~~Dying with an inventory/crafting screen open preserves the cursor
    stack...~~ — Phase 11: death closes any open screen first (grids and
    cursor return to the inventory) and everything drops at the death site.
- `ui/screens.js` has the inventory, crafting, chest, furnace and death
  screens; the victory screen is the dragon phase. The brewing stand should
  reuse the Phase 10 container machinery (SlotContainer with slot gates +
  a screen mode with indicator art — the furnace is the template).
- Phase 8 deliberate slices:
  - Crafting recipes only cover what the item set supports — no golden
    tools (gold tier isn't in SPEC's tool table), no shield/ladder/door.
    (~~no chest recipe~~ — shipped in Phase 10 with the chest UI.)
  - Vanilla's drag-to-distribute across grid cells (holding a button and
    sweeping) isn't implemented — click/right-click per cell is.
  - Recipe unlocking/recipe book: none, by design.
  - The crafting table block has no persistent per-table state (vanilla
    drops grid contents on close; here they return to the inventory, which
    is the modern-vanilla behaviour for the 2x2 and kinder for the 3x3).
- Phase 7 deliberate slices:
  - ~~Armour items... no equip slots and no damage reduction yet~~ —
    Phase 13: four gated equip slots on the inventory screen, right-click
    equip, SPEC damage reduction, durability wear, death drops.
  - No off-hand. ~~Cursor stacks can't be thrown into the world by clicking
    outside the panel~~ — Phase 11: they can (left = stack, right = one).
    No Q-to-drop while playing yet.
  - Tools wear 1 durability per broken block for every tool class (vanilla
    charges 2 for swords); swords have no attack use until combat.
  - Number-key/wheel selection and the E screen are keyboard-only bindings
    (no rebinding UI).
- Phase 6 deliberate slices, replaced by later phases:
  - Dropped items and the hand are not lit by world light (unlit atlas
    material, correct per-face brightness only) — a `getLight` sample can
    tint them when the mob phase adds it.
  - ~~`sand`/`gravel` falling~~ — done in Phase 9 (entities/falling.js).
  - No break/place/footstep sounds yet (SPEC "feel" row; no audio system).
  - `oak_sapling` and `glowstone_dust` drops have no shipped item texture;
    items.js renders stand-ins (leaves mini-block / blaze powder sprite)
    via its VISUAL_ALIAS map — hotbar/screen icons follow the same alias.
  - Breaking water/lava directly is impossible (not targetable) — ~~bucket
    interactions are an item-phase concern~~ Phase 11: buckets scoop and
    place both fluids (interaction.js runs a fluid-aware raycast for the
    scoop).
  - Dropped item ENTITIES still never merge with each other in the world
    and have no count cap beyond the 300s despawn — sustained mining
    without pickup accumulates one draw call per item. (Pickup into the
    inventory does stack correctly as of Phase 7.)
  - Generated-art internals (crack random-walk shape, arm skin palette) are
    deliberately inline in interaction.js — they are the art itself, not
    gameplay tunables; everything gameplay-facing (offsets, timings, sizes,
    swing shape fractions) lives in config.js.
- ~~The controller exposes but does not consume damage inputs~~ — Phase 11
  wired all of them: `body.lastLanding` (fall damage), `body.breath === 0`
  (drowning), cactus contact (inflated-AABB sampling reaches past the 1/16
  inset), lava contact + burning.
- Lava is placed by the caves phase and lights its surroundings (emits 15);
  a fullbright/emissive treatment for lava and glowstone faces themselves is
  later polish (they currently render lit by their own neighbouring light,
  which reads fine).
- Directional sun + hemisphere ambient remain in the scene for later entity
  phases (mobs will be Lambert-lit); terrain itself is unlit baked light.
  Shadow maps are configured but currently have no casters/receivers —
  vanilla Minecraft has no dynamic shadows, so this is the intended look,
  not a regression.
- Rivers are the one remaining SPEC world feature (see Phase 9 slices);
  caves, ravines, ores and lava pools are done (world/caves.js).
- `blocks.js`: nether/end portal blocks have `faces: null` plus a `special`
  tag — the mesher skips `tiles === null` (their custom rendering comes with
  the portal phase; the chest got its real model in Phase 10 the same way).
- `special` blocks: the torch got its real box model in Phase 11 and the
  cactus its inset shape in Phase 7; brewing stand and iron bars still mesh
  as full textured cubes in the cutout pass — their non-cube shapes are
  later polish (the torch's `emitTorch` in chunks.js is the pattern for
  small box models).
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

- Phase 13 is likely the real mob roster over the Phase 12 foundation.
  Adding a mob = a MOB_TYPES entry in entities/mobs.js (stats from
  SPEC.md, model parts in the models.js format — verify each sheet's
  layout by inspecting the PNG; 64x32 sheets exist for creeper/skeleton/
  spider/sheep/enderman/chicken, cow/pig are 64x64) + an AI function next
  to `pursue` (the manager currently hardwires pursue — split per-type AI
  when the second behaviour arrives). Passive mobs should drop the meat
  item ids the smelting recipes AND food registry expect: beef, porkchop,
  chicken, mutton (texture names, NOT SPEC's raw_beef spelling).
- Phase 12 APIs for later phases: `Entity` (entities/entity.js) is the
  physics base — construct with (world, pos, typeDef), steer via
  wishX/wishZ, `damage(amount, dirX, dirZ)`, `aabb`. `findPath`/
  `standableAt` (entities/pathfinding.js) are pure over a getBlock fn;
  budget knobs in MOBS.PATH. `createMobModel(type)` (entities/models.js)
  -> { group, parts, material } — parts are pivot Groups (swing via
  rotation), material is per-instance for tinting. `world.getLight(x,y,z)`
  -> { sky, block } | null (never rebuild light windows per query);
  `dayNight.skyDarken` for effective-light gates. The combat bridge in
  main.js passes WEAPON_DAMAGE[selectedName] ?? fist into `mobs.attack`;
  skeleton arrows and creeper explosions should call `stats.damage` +
  `applyKnockback` like the melee bite does, and apply `ARMOR_REDUCTION`
  once armour equip slots exist (still unbuilt). Vanilla attack/break
  exhaustion costs also remain for the combat phase.
- Flowing lava (world/fluids.js): event-driven — anything that edits
  blocks gets flow updates for free via the world listener. If water flow
  arrives later, generalise the automaton (feeder levels + heights are
  the only lava-specific parts; water spreads 7 with faster ticks). The
  Nether phase should widen LAVA_RANGE there (vanilla doubles range and
  halves the tick in the Nether).
- The pause: `isPaused()` in main.js is the single gate — new per-frame
  systems must tick inside the `if (!paused)` block. Anything input-driven
  must gate on pointer lock (that is what makes input dead while paused).
- Mob visuals: mobs are unlit like chests/items — the per-frame
  world.getLight tint in mobs.js `animate` is the pattern; if items/hand
  ever get light tinting, reuse it.
- Phase 11 APIs for later phases: `foodValue(name)` (player/inventory.js)
  is the edibility registry — new foods just add an entry (and a texture).
  `stats.eat/canEat/hunger/saturation/burning/dead/respawn`,
  `screens.showDeath()`/`closeScreen(relock)`, `inventory.replaceSelected`
  (bucket-style item swaps). The torch mesher (`emitTorch` in
  world/chunks.js + `TORCH_LEAN` in blocks.js) is the template for other
  small box models (brewing stand). `ATLAS_SPRITE_ITEMS` (entities/items.js)
  routes any item whose art is an atlas tile into all sprite paths.
  Eating currently pauses hold-to-place but not mining; vanilla also slows
  the eater — not modelled (nothing depends on it yet).
- Phase 10 APIs for later phases: `world.addBlockListener(fn)` — the
  block-change hook is a list now (falling, smelting, chests subscribe);
  listeners must not throw. `SlotContainer` (player/inventory.js) is the
  base for any block container — the brewing stand should subclass it like
  `Furnace` does (slot gates via canPlaceIn/clickSlot overrides, shift
  routing via addStack) and get a screen mode next to 'furnace' in
  screens.js (indicator art + screens.update polling is the template).
  `smelting.furnaceAt(x,y,z)` / `chests.chestAt(x,y,z)` are the state
  lookups (lazy-create). `createChestMesh(size)` for anything chest-shaped;
  `createModelMesh(model, size)` (entities/items.js) is the centred item
  variant. Oriented placement: extend `placementVariant` in blocks.js.
  Buckets scoop and place both fluids as of Phase 11 (a scooped lava
  bucket is also the premium furnace fuel, closing that loop).
- Mining note (Phase 10 update): lava lakes flood all carved space at
  y<=-54, so "the right depth" to tell players is now y≈-52 (diamond
  density there is within ~12% of the old -54 guidance; the 39/40
  findability simulation was ore-density-driven and unaffected).
- Furnace facings: placement picks FURNACE/_N/_E/_W toward the player;
  smelting swaps lit variants in place. If another oriented block arrives
  (dispenser-like), follow the same pattern — ids are cheap, the mesher
  needs nothing.
- Phase 9 APIs for later phases: `stats.damage(amount)` for any damage source;
  `stats.health/maxHealth/flashFraction` for UI. `inventory.drainAll()`
  empties and returns stacks. `createExtrudedItemMesh(name, size)`
  (entities/items.js) for any held/shown item slab (async texture build,
  cached per name). The caves carver is `world.generator.caves`
  (`ravineDepthAt`, `surfaceOpenAt` are pure and cheap; the mining-sim
  and cave-census harnesses in the session scratchpad show how to drive
  it for tests).
- Lava physics (Phase 10): lava is a dense fluid in PlayerBody behind the
  existing fluid handling (touchingLava/lavaSubmersion/eyeInLava; tunables
  in PLAYER.LAVA_*). Water maths are untouched — keep it that way; the
  swim-sprint mechanic and breath stay water-only, and the standing-eye
  disengage rule still applies to water.
- Mining note for balance: diamond concentrates hard toward y=-60..-40
  (bottom-biased); with lava lakes flooding y<=-54, "the right depth" to
  tell players is y≈-52.
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
- Brewing-stand and iron bars still mesh as full cubes (`special` shapes
  are later polish); torches render their real box model as of Phase 11
  (floor post + tilted wall variants) and cactus its inset shape.
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
| 9 | Underground (world/caves.js): two-layer cave carving (winding tunnel pair-intersection + deep caverns, world-aligned interpolation lattice, y -50..60), rare long/deep/narrow V-profile ravines, walkable surface entrances gated to sparse entrance regions (plus rare 1-block rabbit holes), ocean-sealed floors, lava filling all carved space below y=10, granite/diorite/andesite blobs, gravel pockets, ore veins per SPEC ranges (coal/iron 4-12, gold/redstone 4-8, diamond 1-4 bottom-biased — 39/40 simulated 10-min branch-mining trials find diamond, avg 4.9 ore); trees/cacti refuse carved surfaces; falling sand/gravel entities (entities/falling.js + world.onBlockChanged) with torch-break/fluid-sink (fills lava lakes like vanilla)/cascade rules; stats.js slice — health, lava contact damage, death drops inventory + respawn — with hearts HUD + damage flash; dropped items burn in lava; held-tool fix (extruded 1px-slab item models, vanilla lower-right diagonal) and held-block scale-up. 21 node + 10 browser gameplay checks + screenshot suite, zero console errors | Rivers; hunger/fall/drowning/cactus damage + death screen (stats.js continues); swimmable lava; gen-time floating sand settles only on disturbance; smelting; mobs |
| 10 | Smelting (systems/smelting.js): every SPEC recipe + fuel value, per-position furnaces ticking with the UI closed and independently, vanilla fuel/progress rules (ignite only when a smelt can run, rewind when blocked, lava-bucket residue), furnace block family (4 facings x unlit/lit, oriented placement toward the player, lit front tile + light 13), furnace screen (input/fuel/output, pixel-art progress arrow + flame indicator), break drops contents. Chests (world/chests.js): entity-textured box model from chest_normal.png (base/lid/latch, modern 180-degree-flipped unwrap decoded, back-hinge lid animation while open), placement facing the player, persistent 27-slot containers, break drops contents, chest recipe, model-routed item visuals (dropped/held/hotbar icon). Generic container UI (ui/screens.js): SlotContainer (player/inventory.js) + event-time container resolution + cross-container shift routing; world.addBlockListener list. Phase 9 bug fixes: lava rework (lakes only y<=-54, sparse 1-deep pools + rare wall leaks in -54..10, caves deepened to -60), cave size variety (girth-modulated tunnels ~2-4 wide, caverns bigger and rarer), dense-lava player physics + near-opaque lava-tile overlay + collapsed fog, hotbar highlight as a transform-moved element (repaint bug), held item moved into the corner, arm shortened, held-tool re-select TDZ crash fixed, PASS_NONE culling fix (torch-on-chest). 115 node + 38 browser checks, zero console errors | Brewing stand (reuses SlotContainer + furnace screen pattern); stats phase (hunger/fall/drowning/cactus, eating the new cooked food); mobs (drop ids beef/porkchop/chicken/mutton); buckets scooping lava/water; chest icon uses static sheet (no animated open state in the icon) |
| 11 | Full survival stats (player/stats.js): hunger 20 + hidden saturation + exhaustion from activity (sprint/swim/jump/damage/regen), natural regen at hunger>=18 costing exhaustion (the eat-to-heal loop), starvation to the SPEC 1-heart floor, fall damage 1 heart/block beyond 3 via body.lastLanding, drowning 2/s at breath 0, lava contact + 15s burning DoT that water extinguishes, cactus contact with knockback (applyKnockback API for combat), death screen with Respawn button + inventory dropped at the death site (open screens close first, dead players collect nothing) + respawn at world spawn; hunger drumstick HUD row (right-to-left) with breath bubbles moved above; eating: hold right click ~1.6s with nibble hand animation, FOODS registry (vanilla hunger/saturation, cooked > raw, stew leaves a bowl). Bug fixes: torch box model (2x10px floor post + 22.5-degree wall variants, ids 57-60, face-aware placement, solid-support requirement, support-break pop, atlas-sprite item visuals), buckets scoop/place water and lava (fluid-aware raycast, one action per press), dropped sprite items extruded 1px thick, block icons redrawn in true dimetric proportions (~11% taller), click-outside-panel throws the cursor stack (left all / right one), cave entrances ~3x more common (census-tuned), canopies a layer deeper with hash-kept corners. 44 node + 22 browser checks + screenshot suite, zero console errors; adversarial 5-lens review with per-finding verification | Brewing stand; mobs + combat (armour equip/reduction, attack/break exhaustion, WEAPON_DAMAGE consumer); rivers; Q-drop; fire overlay visual; eating doesn't slow movement |
| 12 | Entity foundation: base entity (entities/entity.js — swept-AABB physics with 1-block step-up, water/lava handling, health/knockback/hurt/death timers, despawn rules, unloaded-chunk freeze), budgeted A* pathfinding (entities/pathfinding.js — step up 1, drops capped at 3, lava/cactus avoided, 500-expansion budget with closest-approach fallback), mob spawning framework (entities/mobs.js — ring 24..96, solid opaque ground, hostile light <= 7 via new world.getLight + dayNight.skyDarken, passive >= 9 on grass, caps from config), box-model mob system (entities/models.js — standard entity unwrap from the real sheets, mirrored legacy limbs, pivot rigs, per-instance tint materials), walking limb swing + head tracking + body-yaw easing + baked-light tinting + red hurt flash + death fall-over, player melee via crosshair mob raycast with WEAPON_DAMAGE, mob melee biting through stats.damage/applyKnockback; placeholder mob (zombie stats/skin) proves spawn->pursue->bite->hit->die->drops. Bug fixes: true Esc pause (everything freezes — physics, momentum, day/night, entities, break progress, furnaces; input dead while paused; Esc/click resumes), flowing lava (world/fluids.js: pour-first spread 3 with descending partial-height animated rendering, falls, recedes, settles generated leaks), crack overlay exactly on the face via polygonOffset, fall damage halved to vanilla (0.5 hearts/block past 3), starvation floor 5 hearts (Easy). 26 node + browser suites (pause/mob/lava/visual), zero console errors; adversarial multi-lens review with per-finding refutation | Real mob roster (zombie/skeleton/creeper/spider/enderman + passives, daylight burning, per-type AI split); combat polish (armour equip + reduction, attack/break exhaustion, mob-vs-mob); water flow; lava+water -> obsidian/cobble; entity-entity collision; mob sounds |
