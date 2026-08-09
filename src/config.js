// config.js — all tunable constants in one place.
// Per ARCHITECTURE.md, never hardcode a tunable number inline in another file.
// Per-block and per-mob data tables (hardness, HP, drops) live in their
// registries (world/blocks.js, entities/mobs.js); this file holds the global
// tunables SPEC.md defines.

// ---------------------------------------------------------------------------
// World dimensions
// ---------------------------------------------------------------------------

export const OVERWORLD = {
  MIN_Y: -64,
  MAX_Y: 320,
  SEA_LEVEL: 62,
  HILL_HEIGHT: 100,       // typical hill tops
  PEAK_HEIGHT: 140,       // occasional peaks
  LAVA_POOL_MAX_Y: 10,    // lava pools generate below this
  BEDROCK_Y: -64,         // solid bedrock layer
  BEDROCK_JAGGED_LAYERS: 4, // jagged bedrock for this many blocks above
};

export const NETHER = {
  MIN_Y: 0,
  MAX_Y: 128,
  CEILING_Y: 128,         // bedrock ceiling
  COORD_RATIO: 8,         // 1 nether block = 8 overworld blocks
  // Phase 15 placeholder terrain (dimensions/nether.js): a flat netherrack
  // plain under the fixed red sky, so the portal has somewhere to arrive.
  // The real Nether generation replaces this next session.
  PLACEHOLDER: {
    FLOOR_Y: 64,          // top netherrack layer (near overworld portal
                          // heights — y carries over 1:1 through a portal)
    BEDROCK_TOP_Y: 59,    // bedrock floor 58..59 under netherrack 60..64
  },
};

export const END = {
  MIN_Y: 0,
  MAX_Y: 256,
  ISLAND_RADIUS: 50,          // central island ~100 blocks across
  PILLAR_COUNT: 10,
  PILLAR_MIN_HEIGHT: 40,
  PILLAR_MAX_HEIGHT: 70,
};

// ---------------------------------------------------------------------------
// Chunks and rendering distance
// ---------------------------------------------------------------------------

export const CHUNK = {
  SIZE: 16,               // blocks per chunk edge (x/z)
  HEIGHT: 384,            // overworld world height (MAX_Y - MIN_Y)
};

export const VIEW = {
  DISTANCE_CHUNKS: 8,     // chunks loaded/rendered around the player
  FOV: 70,
  NEAR: 0.1,
  FAR: 1000,
};

// Chunk streaming: how terrain loads in around the player without stutter.
// Chunk data generates in a square ring one chunk beyond the meshed circle so
// every meshed chunk has all 8 neighbours available for culling and AO.
export const STREAMING = {
  INITIAL_RADIUS: 3,      // chunks fully generated+meshed synchronously at boot
  FRAME_BUDGET_MS: 8,     // max main-thread ms per frame spent generating/meshing
  UNLOAD_MARGIN: 1,       // hysteresis: unload this many chunks beyond the load ring
};

// ---------------------------------------------------------------------------
// Terrain generation
// ---------------------------------------------------------------------------

// Cave carving (world/caves.js). Two noise layers — winding tunnels and open
// caverns — carve the band MIN_Y..MAX_Y; tunnels additionally fade upward to
// the surface so their strongest cores pierce it as findable entrances.
// Noise fields are sampled on a world-aligned lattice every LATTICE_STEP
// blocks and interpolated per block (fast, and identical across chunk
// borders whatever the generation order).
export const CAVES = {
  MIN_Y: -60,                // Phase 10: down to the jagged bedrock band so
                             // lava lakes have somewhere to live below -54
  MAX_Y: 60,
  LATTICE_STEP: 4,
  BOTTOM_FADE_BLOCKS: 4,     // caves taper closed over this band above MIN_Y

  // Tunnels: carve where fieldA² + fieldB² < RADIUS² — the neighbourhood of
  // the intersection curve of two 3D noise zero-surfaces (long winding
  // spaghetti). The y frequency is higher than xz so tunnels run mostly
  // horizontal and slightly wider than tall. Phase 10: RADIUS is modulated
  // along the tunnel by a low-frequency GIRTH field, so passages vary from
  // tight 2-wide crawls to broader corridors instead of one uniform bore.
  TUNNEL: {
    SCALE_XZ: 1 / 95,
    SCALE_Y: 1 / 68,
    OCTAVES: 2,
    RADIUS: 0.085,
    GIRTH: {
      SCALE_XZ: 1 / 230,     // slow variation — girth changes over ~100 blocks
      SCALE_Y: 1 / 160,
      OCTAVES: 2,
      MIN: 0.55,             // radius multiplier range (noise -1..1 mapped in)
      MAX: 1.35,
    },
  },

  // Caverns: carve where a low-frequency squashed 3D field exceeds a
  // threshold that loosens with depth — open rooms, common deep down,
  // fading out entirely above MAX_Y. Phase 10 retune: lower frequency +
  // higher threshold = larger caverns (10-30 blocks across, stacked levels
  // where the field folds) that appear clearly less often than tunnels.
  CAVERN: {
    SCALE_XZ: 1 / 200,
    SCALE_Y: 1 / 78,
    OCTAVES: 2,
    MAX_Y: 48,               // no caverns above this (only tunnels reach up)
    FULL_BELOW_Y: -6,        // deep threshold applies at/below this
    SHALLOW_Y: 30,           // threshold reaches SHALLOW value here
    THRESHOLD_DEEP: 0.71,
    THRESHOLD_SHALLOW: 0.85,
  },

  // Mega caverns (Phase 15 — the "caves are all narrow tunnels" report): a
  // DISTINCT large-cave pass, separate from the tunnel noise. A very-low-
  // frequency 2D region mask gates where they exist at all (uncommon but
  // findable); inside a region, a low-frequency squashed 3D field carves
  // where it exceeds THRESHOLD — genuinely huge chambers, 30-60+ blocks
  // across and 20+ tall, stacked into multiple levels where the field
  // folds. The threshold rises to CEILING (unreachable) toward region edges
  // and the vertical band edges, so chambers close smoothly.
  MEGA: {
    SCALE_XZ: 1 / 110,
    SCALE_Y: 1 / 58,
    OCTAVES: 2,
    THRESHOLD: 0.52,         // field value carving starts at (region core)
    CEILING: 1.05,           // unreachable threshold (fbm stays within ±1)
    MIN_Y: -52,              // above the lava-lake band's deep flood
    MAX_Y: 26,               // never near the surface (sea level 62)
    EDGE_FADE: 8,            // threshold ramp to CEILING at the band edges
    REGION_SCALE: 1 / 420,   // rarity mask frequency (region ~ hundreds of blocks)
    REGION_START: 0.48,      // mask noise where mega regions begin
    REGION_FULL: 0.66,       // mask noise where the region gate saturates
  },

  // Waterfall springs (Phase 15): rare water columns pouring down mega-cavern
  // walls into a small floor pool. Static water (this game's water doesn't
  // flow yet) — the column IS the waterfall. Deterministic per chunk, writes
  // only inside the owning chunk.
  WATERFALL: {
    ATTEMPTS_PER_CHUNK: 2,   // spring-column candidates per chunk
    CHANCE: 0.3,             // chance an eligible candidate actually springs
    MIN_GATE: 0.5,           // only well inside a mega region
    MIN_Y: -20,              // springs sit in the upper cavern walls
    MAX_Y: 24,
    MIN_DROP: 5,             // needs at least this much open air below
    MAX_FALL: 32,            // column length cap
  },

  // Lava placement in carved space (Phase 10 — replaces the old "everything
  // below y=10 floods" rule that drowned the deep caves in lava):
  //   - full lava lakes only at/below LAKE_MAX_Y (all carved cells flood)
  //   - between LAKE_MAX_Y and OVERWORLD.LAVA_POOL_MAX_Y, only small
  //     occasional pools: 1-deep puddles on cave floors inside sparse
  //     pool-mask regions, plus rare single-block wall leaks
  LAVA: {
    LAKE_MAX_Y: -54,         // vanilla-style lava-flood level
    POOL_MASK_SCALE: 1 / 55, // 2D pool-region mask frequency
    POOL_MASK_MIN: 0.42,     // mask noise (-1..1) above which puddles form
    LEAK_CHANCE: 0.0012,     // per carved wall-adjacent cell in the pool band
  },

  // Surface entrances: above MAX_Y tunnels keep carving only inside sparse
  // "entrance regions" (a low-frequency 2D mask), where they stay wide
  // enough to walk into — few walkable cave mouths instead of a pockmarked
  // surface. Only dry grass/stone columns qualify (no holes in beaches,
  // deserts or under oceans; sand would float).
  ENTRANCE: {
    MASK_SCALE: 1 / 100,     // 2D mask field frequency (region size)
    MASK_START: 0.18,        // mask noise where entrance regions begin
    MASK_FULL: 0.42,         // mask noise where the gate saturates
    MAX_FACTOR: 1.0,         // tunnel radius fraction inside a full-gate region
    DECAY: 0.025,            // additional gentle taper with height above MAX_Y
    MAX_SURFACE_Y: 96,       // columns higher than this never get mouths
    // Phase 11 retune (was 1/140 / 0.38 / 0.60 / 0.85 / 0.04): caves were
    // too hard to find on foot. Census over six 192x192 regions: walkable
    // mouths (>= 3 connected open columns, ravines excluded) went 0.32 ->
    // ~1.0 per 100x100 columns — a player crossing plains or forest now
    // comes across a cave entrance reasonably often.
  },

  // Never carve within DEPTH blocks below the surface when any column in a
  // (2*RADIUS+1)² neighbourhood is at or below sea level — keeps ocean and
  // shore floors sealed (no static-water walls, no drained-looking pockets).
  OCEAN_SHIELD: { RADIUS: 2, DEPTH: 6 },

  // Ravines: rare long, deep, narrow cuts. A 2D noise zero-line supplies the
  // path (|line| < WIDTH carves), a very low-frequency mask gates where
  // ravines exist at all, and depth shrinks toward the edges (V profile).
  RAVINE: {
    LINE_SCALE: 1 / 150,
    MASK_SCALE: 1 / 420,
    MASK_START: 0.50,        // mask noise where ravines begin (depth 0)
    MASK_FULL: 0.62,         // mask noise where ravines reach full depth
    WIDTH: 0.04,             // line-noise threshold — half-width in noise units
    MAX_DEPTH: 48,           // depth of the ravine centre at full mask
    NARROW: 0.65,            // fraction of the width band that shallows the V
    EDGE_JITTER: 0.12,       // per-column jitter on the width test (rough walls)
  },
};

// Stone variants and non-ore pockets underground (world/caves.js).
export const UNDERGROUND = {
  // Granite / diorite / andesite blobs: two low-frequency 3D fields — the
  // primary picks granite (above threshold) or diorite (below negative
  // threshold); the secondary picks andesite where the primary is quiet.
  VARIANTS: {
    SCALE_XZ: 1 / 26,
    SCALE_Y: 1 / 26,
    OCTAVES: 2,
    PRIMARY_THRESHOLD: 0.52,
    ANDESITE_THRESHOLD: 0.55,
  },
  // Gravel pockets in stone — the renewable flint source underground.
  GRAVEL_POCKETS: { MIN_Y: -56, MAX_Y: 56, ATTEMPTS_PER_CHUNK: 2, SIZE_MIN: 8, SIZE_MAX: 16 },
};

// Overworld heightmap, biomes and decoration (world/terrain.js).
// Noise scales are in cycles per block (1/blocks-per-feature).
export const TERRAIN = {
  SEED: 1337,

  // Extra columns computed around a chunk during generation so trees whose
  // canopy crosses a chunk border come out identical from both sides
  // (canopy radius 2 + 1 for the tree spacing check).
  GEN_MARGIN: 3,

  // Very low frequency landmass swell around sea level. Where it dips
  // negative the terrain drops below sea level and oceans/lakes form.
  CONTINENT: { SCALE: 1 / 1100, OCTAVES: 2, AMPLITUDE: 11, OFFSET: 1 },

  // Safety floor: the surface never generates closer than this to the
  // bottom of the world, whatever the noise does.
  MIN_HEIGHT_ABOVE_BOTTOM: 8,

  // Rolling hill detail shared by all biomes (amplitude set per biome).
  HILLS: { SCALE: 1 / 160, OCTAVES: 4, PERSISTENCE: 0.5, LACUNARITY: 2 },

  // Climate fields drive biome weights. Both are fBm in [-1, 1].
  CLIMATE: {
    TEMPERATURE_SCALE: 1 / 480,
    MOISTURE_SCALE: 1 / 420,
    OCTAVES: 3,
  },

  // Mountains come from their own region mask, not climate, so ranges read
  // as coherent chains. Ridged noise supplies the relief inside a region.
  MOUNTAINS: {
    REGION_SCALE: 1 / 700,
    REGION_OCTAVES: 2,
    WEIGHT_START: 0.12,        // region noise where mountains begin to blend in
    WEIGHT_FULL: 0.55,         // region noise where mountains fully dominate
    RIDGE_SCALE: 1 / 260,
    RIDGE_OCTAVES: 3,
    RIDGE_SHARPNESS: 2.2,      // exponent on the ridge profile; higher = sharper crests
    BASE_LIFT: 14,             // flat height bonus inside a mountain region
    RIDGE_AMPLITUDE: 58,       // ridge height on top of the lift (hills ~100, peaks ~140)
  },

  // Per-biome height contribution (OFFSET above the continent base plus
  // hill noise * HILL_AMPLITUDE) and tree density (trees per column).
  BIOMES: {
    PLAINS: { BASE_WEIGHT: 0.35, OFFSET: 3, HILL_AMPLITUDE: 4, TREE_DENSITY: 0.005 },
    FOREST: {
      OFFSET: 4, HILL_AMPLITUDE: 6, TREE_DENSITY: 0.08,
      MOISTURE_START: 0.02,    // moisture where forest starts blending in
      MOISTURE_FULL: 0.38,     // moisture where forest weight saturates
    },
    DESERT: {
      OFFSET: 2, HILL_AMPLITUDE: 3.5,
      HEAT_START: 0.08,        // temperature where desert starts blending in
      HEAT_FULL: 0.45,
      DRY_START: -0.2,         // below this moisture the air is fully dry
      DRY_FULL: 0.15,          // above this moisture desert weight is zero
    },
    MOUNTAINS: { TREE_DENSITY: 0.003 },
  },

  // When the top two biome weights are within this range the surface block
  // is hash-dithered between them, so borders feather instead of hard-edging.
  BIOME_DITHER_RANGE: 0.2,

  SURFACE: {
    DIRT_DEPTH: 3,             // dirt under grass
    SAND_DEPTH: 4,             // sand at the desert surface
    SANDSTONE_DEPTH: 3,        // sandstone under desert sand
    BEACH_MAX_ABOVE_SEA: 1,    // up to this height above sea, shores turn to sand
    MOUNTAIN_STONE_MIN_HEIGHT: 92, // mountain surface is bare stone above this
  },

  TREES: {
    TRUNK_MIN: 4,              // trunk height range (inclusive)
    TRUNK_MAX: 6,
    WIDE_LAYERS: 3,            // 5x5 canopy layers below the 3x3 cap (Phase 11
                               // raised 2 -> 3: canopies read as a dense mass,
                               // sky rarely visible through the middle)
    CORNER_CHANCE: 0.5,        // chance each 5x5 layer corner keeps its leaf
                               // block (vanilla clips corners randomly)
  },

  CACTUS: {
    DENSITY: 0.015,            // per desert sand column
    MIN_HEIGHT: 1,
    MAX_HEIGHT: 3,
  },
};

// Ore distribution from SPEC.md (Y ranges and relative rarity). Each chunk
// makes ATTEMPTS vein attempts per ore at a seeded random position in the
// Y range; a vein is a compact random walk of VEIN_MIN..VEIN_MAX blocks
// replacing stone. BIAS_BOTTOM concentrates an ore toward the bottom of its
// range (diamond — "the right depth" is deep). Tool gating lives in the
// block registry (world/blocks.js), not here.
export const ORES = {
  coal:     { MIN_Y: 0,   MAX_Y: 120, ATTEMPTS_PER_CHUNK: 14, VEIN_MIN: 4, VEIN_MAX: 12 },
  iron:     { MIN_Y: -32, MAX_Y: 64,  ATTEMPTS_PER_CHUNK: 10, VEIN_MIN: 4, VEIN_MAX: 12 },
  gold:     { MIN_Y: -48, MAX_Y: 32,  ATTEMPTS_PER_CHUNK: 4,  VEIN_MIN: 4, VEIN_MAX: 8 },
  redstone: { MIN_Y: -60, MAX_Y: 16,  ATTEMPTS_PER_CHUNK: 6,  VEIN_MIN: 4, VEIN_MAX: 8 },
  diamond:  { MIN_Y: -60, MAX_Y: 12,  ATTEMPTS_PER_CHUNK: 5,  VEIN_MIN: 1, VEIN_MAX: 4, BIAS_BOTTOM: true },
};

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export const PLAYER = {
  MAX_HEALTH: 20,
  MAX_HUNGER: 20,
  REGEN_HUNGER_THRESHOLD: 18,   // health regenerates at/above this hunger
  STARVE_FLOOR_HEALTH: 10,      // starvation stops at 5 hearts — Minecraft's
                                // Easy difficulty (Phase 12; was 1 heart)
  REACH: 5,                     // block interaction distance

  // Body (AABB) and first-person camera
  WIDTH: 0.6,
  HEIGHT: 1.8,
  EYE_HEIGHT: 1.62,
  SNEAK_EYE_HEIGHT: 1.27,       // eye drops while sneaking (the box stays 1.8)
  EYE_LERP_RATE: 12,            // 1/s — how fast the eye eases between heights
  MOUSE_SENSITIVITY: 0.0022,    // radians of look per pixel of mouse movement
  PITCH_MARGIN: 0.01,           // radians short of straight up/down the pitch clamps
  SPRINT_FOV_BOOST: 8,          // degrees of extra FOV while sprinting
  FOV_LERP_RATE: 12,            // 1/s FOV ease in/out of sprint
  STEP_SMOOTH_RATE: 12,         // 1/s — camera easing after a 1-block auto-step
  VIEW_BOB: {
    AMP_Y: 0.045,               // vertical bob amplitude (blocks)
    AMP_X: 0.018,               // lateral sway amplitude (blocks)
    CYCLES_PER_BLOCK: 0.35,     // stride cycles per block walked
    FADE_RATE: 8,               // 1/s bob fade in/out
  },

  // Speeds (blocks per second)
  WALK_SPEED: 4.3,
  SPRINT_SPEED: 5.6,
  SNEAK_SPEED: 1.3,
  SWIM_SPEED: 2.2,
  SWIM_SPRINT_SPEED: 5.6,       // vanilla swim-sprint pace (sprint fully submerged)

  // Vertical physics
  JUMP_VELOCITY: 8.5,           // initial upward velocity, clears ~1.1 blocks
  JUMP_COOLDOWN_SECONDS: 0.5,   // vanilla's 10-tick jump delay — a full jump
                                // arc is longer, so it only bites when the
                                // arc is cut short (low ceilings), stopping
                                // ceiling-bounce sprint-boost compounding
  GRAVITY: 32,                  // blocks per second squared
  TERMINAL_VELOCITY: 78,        // fastest possible fall (blocks per second)

  // Movement feel — continuous-time equivalents of the vanilla tick physics
  GROUND_RESPONSE: 12,          // 1/s exponential approach to the wanted velocity
                                // on the ground (acceleration AND friction)
  AIR_ACCEL: 8,                 // blocks/s² of steering while airborne
  AIR_DRAG: 1.9,                // 1/s horizontal damping while airborne
  SPRINT_DOUBLE_TAP_SECONDS: 0.3, // double-tap W within this starts a sprint
  SPRINT_JUMP_BOOST: 1.8,       // forward blocks/s added by a sprinting jump —
                                // tuned so repeated sprint-jumping averages the
                                // vanilla ~7.1 blocks/s vs 5.6 flat sprinting
  SLOW_BLOCK_FACTOR: 0.4,       // speed multiplier on `slows` blocks (soul sand)

  // Auto-step (no jump needed) and the sneak edge guard. Vanilla's step
  // height is 0.6: slabs and stairs auto-step, full blocks require a jump.
  STEP_HEIGHT: 0.6,             // walk straight up ledges this tall
  SNEAK_EDGE_DROP: 0.6,         // sneaking refuses moves with no floor within this
  SNEAK_CLAMP_INCREMENT: 0.05,  // granularity of the sneak edge clamp

  // Lava (Phase 10 — a dense fluid, per the PROGRESS note extending the
  // water handling behind a fluid-kind flag). Movement is very slow, the
  // body sinks slowly and only partially (buoyancy ~ neutral at full
  // submersion), and holding jump climbs back out.
  LAVA_SPEED: 1.1,              // horizontal blocks/s target in lava
  LAVA_DRAG: 9,                 // 1/s velocity damping (dense — kills plunges)
  LAVA_GRAVITY: 9,              // blocks/s² downward pull in lava
  LAVA_BUOYANCY: 1.0,           // lift as a multiple of lava gravity at full
                                // submersion — neutral when fully under, so
                                // the body drifts just below the surface
                                // instead of dropping to the floor
  LAVA_UP_ACCEL: 14,            // blocks/s² while holding jump in lava
  LAVA_DOWN_ACCEL: 8,           // blocks/s² while holding sneak in lava
  LAVA_RESPONSE: 3,             // 1/s horizontal approach rate in lava

  // Swimming
  SWIM_MIN_SUBMERSION: 0.35,    // waterline fraction of body height where water
                                // physics take over from walking
  WATER_DRAG: 4.5,              // 1/s velocity damping in water
  WATER_GRAVITY: 8,             // blocks/s² downward pull in water
  WATER_BUOYANCY: 1.4,          // buoyant lift as a multiple of water gravity at
                                // full submersion — floats eyes just above water
  WATER_RESPONSE: 5,            // 1/s horizontal approach rate while swimming
  SWIM_UP_ACCEL: 16,            // blocks/s² while holding jump in water
  SWIM_DOWN_ACCEL: 12,          // blocks/s² while holding sneak in water
  WATER_EXIT_JUMP: 6,           // upward blocks/s hop when swimming into a bank
  BREATH_SECONDS: 15,           // air supply while the eye is underwater
  BREATH_REFILL_RATE: 4,        // refill speed multiplier once surfaced
  BREATH_BUBBLES: 10,           // bubbles on the HUD breath meter
  SWIM_EYE_HEIGHT: 0.62,        // eye height while swim-sprinting (prone body)

  // Falling (damage itself is applied by the stats phase)
  FALL_DAMAGE_THRESHOLD: 3,     // safe fall height in blocks
  FALL_DAMAGE_PER_BLOCK: 1,     // half a heart per block beyond the threshold
                                // (real Minecraft: 4 blocks = 0.5 hearts,
                                // 10 blocks = 3.5, 23+ kills from full health;
                                // Phase 12 fixed the doubled value)

  // Safe spawn: nearest dry, clear surface column to this point
  SPAWN: { X: 8, Z: 8, SEARCH_RADIUS: 48 },
};

// ---------------------------------------------------------------------------
// Stats (player/stats.js) — Phase 11: the full survival loop. Health, hunger
// (with a hidden vanilla-style saturation buffer drained by exhaustion from
// activity), regeneration, starvation, fall/drown/cactus/fire damage,
// knockback, eating, the death screen and respawn.
// ---------------------------------------------------------------------------

export const STATS = {
  LAVA_DAMAGE: 4,               // per contact tick while touching lava (2 hearts)
  DAMAGE_TICK_SECONDS: 0.5,     // minimum time between contact damage ticks
  CONTACT_INSET: 0.05,          // body AABB shrink for contact sampling
  DAMAGE_FLASH_SECONDS: 0.35,   // red screen flash on damage
  DEATH_DROP_SCATTER: 2.0,      // horizontal scatter speed of dropped inventory
  DEATH_DROP_POP: 2.5,          // upward pop speed of dropped inventory
  DEATH_DROP_Y_OFFSET: 1,       // drops spawn this far above the feet
  HEART_PX: 18,                 // HUD heart icon size
  HUNGER_PX: 18,                // HUD drumstick icon size
  ARMOR_PX: 18,                 // HUD armour icon size (Phase 13)

  // Contact damage (cactus registers damagesOnContact; lava handled above)
  CACTUS_DAMAGE: 1,             // per contact tick (half a heart, vanilla)
  CACTUS_CONTACT_EXPAND: 0.1,   // body AABB inflation for cactus contact —
                                // generous enough to reach past the 1/16 inset

  // Drowning: once the breath meter is empty (vanilla 2 damage per second)
  DROWN_DAMAGE: 2,
  DROWN_TICK_SECONDS: 1.0,

  // Burning: lava sets the body on fire; water puts it out (vanilla numbers)
  FIRE_DAMAGE: 1,               // per burn tick while on fire
  FIRE_TICK_SECONDS: 1.0,
  LAVA_BURN_SECONDS: 15,        // fire time (re)set while touching lava

  // Starvation at 0 hunger: SPEC — damage down to 1 heart, never death
  STARVE_DAMAGE: 1,
  STARVE_TICK_SECONDS: 4.0,

  // Natural regeneration at hunger >= PLAYER.REGEN_HUNGER_THRESHOLD
  REGEN_INTERVAL_SECONDS: 4.0,  // +1 health this often (vanilla)
  REGEN_EXHAUSTION: 6.0,        // exhaustion each natural heal costs (vanilla)

  // Exhaustion: activity accumulates it; every EXHAUSTION_PER_HUNGER spent
  // drains 1 saturation (the hidden buffer food also fills), then 1 hunger.
  // EXHAUSTION_SCALE (Phase 14) multiplies every exhaustion gain: the
  // vanilla-exact values still drained noticeably fast for this game's
  // pace ("hunger still depletes too fast" across two sessions), so the
  // whole system runs at half speed — continuous sprinting now costs its
  // first hunger point after ~86s instead of ~43s, and a player walking
  // and exploring normally manages many minutes between meals.
  EXHAUSTION_SCALE: 0.5,
  EXHAUSTION_PER_HUNGER: 4.0,
  EXHAUST_SPRINT_PER_BLOCK: 0.1,
  EXHAUST_SWIM_PER_BLOCK: 0.01,
  EXHAUST_JUMP: 0.05,
  EXHAUST_SPRINT_JUMP: 0.2,
  EXHAUST_DAMAGE: 0.1,          // taking any damage costs a little food
  EXHAUST_ATTACK: 0.1,          // landing a melee hit (vanilla, Phase 13)
  EXHAUST_BREAK_BLOCK: 0.005,   // breaking a block (vanilla, Phase 13)
  EXHAUST_MAX_STEP_BLOCKS: 2,   // per-frame moves beyond this are teleports
                                // (respawn), not travel — no exhaustion
  RESPAWN_SATURATION: 5,        // saturation after (re)spawn (vanilla)

  // Knockback (cactus contact now; the combat phase reuses applyKnockback)
  KNOCKBACK_HORIZONTAL: 6.5,    // blocks/s away from the damage source
  KNOCKBACK_VERTICAL: 5.0,      // upward pop (never reduces upward velocity)

  // Eating: hold right click with food selected
  EAT_SECONDS: 1.6,

  // Hunger poisoning (Phase 14): rotten flesh applies the vanilla Hunger
  // effect with 80% probability — for its duration, exhaustion accrues on
  // its own, draining the food bar faster.
  HUNGER_POISON: {
    SECONDS: 30,                  // vanilla Hunger I duration
    EXHAUSTION_PER_SECOND: 0.1,   // vanilla Hunger I drain rate
  },
};

// ---------------------------------------------------------------------------
// Falling blocks (entities/falling.js) — sand and gravel fall when the block
// under them is removed (registry `falls` flag).
// ---------------------------------------------------------------------------

export const FALLING = {
  GRAVITY: 24,                  // blocks/s² on a detached falling block
  MAX_FALL_SPEED: 40,
};

// ---------------------------------------------------------------------------
// Flowing fluids (world/fluids.js) — Phase 12: lava spreads from sources,
// falls when unsupported, and recedes when its feed is cut. Water stays
// static (its lakes are generation-sealed; water flow is a later phase).
// ---------------------------------------------------------------------------

export const FLUIDS = {
  LAVA_SPREAD_SECONDS: 1.5,     // one spread step (vanilla overworld lava tick)
  LAVA_RANGE: 3,                // horizontal spread distance from a source (SPEC)
  // Rendered surface height per horizontal flow level, as a fraction of the
  // cell — each step visibly lower than the last. Sources render full cubes.
  FLOW_HEIGHTS: [0.75, 0.5, 0.25],
  FALL_HEIGHT: 1.0,             // falling columns fill their cell
  SCROLL_TILES_PER_SECOND: 0.35, // animated flowing-texture scroll rate
  MAX_UPDATES_PER_TICK: 1200,   // fluid cells processed per spread tick (the
                                // remainder carries — a lake edge can't stall
                                // a frame). Sized above the initial settle
                                // wave around spawn (~1400 falls to ~0 within
                                // a few ticks); most updates are cheap no-op
                                // revalidations — only real changes remesh
  SCAN_CHUNKS_PER_FRAME: 1,     // newly meshed chunks settled per frame
                                // (finds generated lava with air below/beside)
};

// ---------------------------------------------------------------------------
// Tools, weapons, armour (SPEC.md tables)
// ---------------------------------------------------------------------------

export const TOOL_TIERS = {
  hand:    { speedMultiplier: 1, durability: Infinity },
  wood:    { speedMultiplier: 2, durability: 60 },
  stone:   { speedMultiplier: 4, durability: 132 },
  iron:    { speedMultiplier: 6, durability: 251 },
  diamond: { speedMultiplier: 8, durability: 1562 },
};

// Keys are the item ids the inventory uses (wooden_sword...), so combat can
// look up WEAPON_DAMAGE[inventory.selectedName] directly. Real Minecraft
// Java figures; anything not listed (including the bow used as a club)
// hits for the fist value. Bow RANGED damage is COMBAT.BOW.
export const WEAPON_DAMAGE = {
  fist: 1,
  wooden_sword: 4,
  stone_sword: 5,
  iron_sword: 6,
  diamond_sword: 7,
  wooden_axe: 7,
  stone_axe: 9,
  iron_axe: 9,
  diamond_axe: 9,
};

// ---------------------------------------------------------------------------
// Combat (systems/combat.js) — Phase 13: the player's side of a fight.
// ---------------------------------------------------------------------------

export const COMBAT = {
  // Attack cooldown per weapon class (seconds to fully recharge — vanilla
  // 1.9 attack speeds: sword 1.6/s = 0.625s, axe ~1.0s, everything else
  // fist-fast). Attacking early does heavily reduced damage:
  // factor = MIN_CHARGE_FACTOR + (1 - MIN_CHARGE_FACTOR) * charge², the
  // vanilla 0.2 + 0.8c² curve.
  COOLDOWN_SECONDS: { sword: 0.625, axe: 1.0, default: 0.25 },
  MIN_CHARGE_FACTOR: 0.2,
  CRIT_MULTIPLIER: 1.5,           // 50% bonus damage attacking while falling (SPEC)
  WEAPON_WEAR_PER_HIT: 1,         // durability a held tool loses landing a hit

  // Armour: per-piece protection points (the vanilla tables). Reduction =
  // points * REDUCTION_PER_POINT, so the SPEC full-set values fall out
  // exactly: leather 7 pts = 28%, iron 15 = 60%, diamond 20 = 80%.
  ARMOR_POINTS: {
    leather: { helmet: 1, chestplate: 3, leggings: 2, boots: 1 },
    golden:  { helmet: 2, chestplate: 5, leggings: 3, boots: 1 },
    iron:    { helmet: 2, chestplate: 6, leggings: 5, boots: 2 },
    diamond: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
  },
  ARMOR_REDUCTION_PER_POINT: 0.04,
  // Every armour-reduced hit wears each equipped piece by
  // max(1, floor(damage / ARMOR_WEAR_DAMAGE_DIVISOR)) durability (vanilla).
  ARMOR_WEAR_DAMAGE_DIVISOR: 4,

  // Bow (SPEC: 1 to 6 damage scaling with draw time, 6 at full draw).
  BOW: {
    FULL_DRAW_SECONDS: 1.0,       // vanilla full charge
    MIN_DRAW_SECONDS: 0.15,       // releases shorter than this fire nothing
    MIN_DAMAGE: 1,
    MAX_DAMAGE: 6,
    MIN_SPEED: 18,                // arrow blocks/s at minimum draw
    MAX_SPEED: 53,                // blocks/s at full draw (vanilla ~3 blocks/tick)
    WEAR_PER_SHOT: 1,
  },

  // Arrows (both the player's and skeletons').
  ARROW: {
    GRAVITY: 20,                  // blocks/s² (vanilla 0.05 blocks/tick²)
    DRAG: 0.5,                    // 1/s velocity damping in flight
    LENGTH: 0.9,                  // rendered shaft length (vanilla render scale)
    STUCK_DESPAWN_SECONDS: 30,    // stuck arrows vanish after this
    FLYING_DESPAWN_SECONDS: 15,   // safety net for arrows that never land
                                  // (per flight — resets when a stuck arrow
                                  // is freed by mining its block)
    STICK_BACKOFF: 0.4,           // fraction of LENGTH the stick point backs
                                  // off the hit face (tip touches the block)
    PICKUP_RADIUS: 1.2,           // player-fired stuck arrows collect within this
    PICKUP_DELAY_SECONDS: 0.5,    // ...but not before this after sticking
    SPAWN_FORWARD: 0.4,           // arrows spawn this far along the aim direction
    EYE_DROP: 0.1,                // ...and this far below the shooter's eye
    MIN_TINT: 0.45,               // floor on the baked-light tint — skeletons
                                  // fire at night and underground, where the
                                  // raw tint (falloff^11+ ≈ 0.09) rendered the
                                  // arrow invisible black on a black sky (the
                                  // Phase 15 "no projectile" report)
  },

  // Explosions (the creeper's; damage itself comes from the mob registry).
  EXPLOSION: {
    BLOCK_RADIUS: 3,              // vanilla creeper power
    RADIUS_JITTER: 0.6,           // per-block radius roughness (crater edges)
    MAX_BLAST_HARDNESS: 10,       // blocks harder than this survive (obsidian
                                  // 50, bedrock ∞ — everything normal breaks)
    DROP_CHANCE: 0.3,             // chance a destroyed block drops its items
    DAMAGE_RADIUS: 6,             // damage falls off linearly to zero here
    FLASH_SECONDS: 0.3,           // expanding white shell lifetime
    BOOM_RANGE: 40,               // the boom fades to silence at this distance
  },
};

// Mining a block above your tool tier: possible but very slow, drops nothing.
export const WRONG_TIER_SPEED_MULTIPLIER = 0.3;

// Non-cube block shapes (consumed by the block registry, mesher and physics).
export const SHAPES = {
  CACTUS_INSET: 1 / 16,           // cactus side faces AND collision box sit this
                                  // far inside the cell on x/z (vanilla: sides
                                  // render 1/16..15/16, top/bottom full size)
  // Torch box model (Phase 11 — replaces the wrong full-cube rendering): a
  // 2px-wide, 10px-tall post centred in the cell, sitting on the floor, the
  // flame at the top. Wall torches tilt out of the wall they attach to,
  // their base raised and half-embedded (vanilla template_torch_wall).
  TORCH: {
    WIDTH: 2 / 16,                // post cross-section (both horizontal axes)
    HEIGHT: 10 / 16,              // post height
    WALL_ANGLE: Math.PI / 8,      // wall torch lean out of the wall (22.5°)
    WALL_BASE_Y: 3.5 / 16,        // wall torch pivot height above the cell floor
  },
};

// ---------------------------------------------------------------------------
// Smelting (systems/smelting.js — the recipe and fuel tables are registries
// in that file, like crafting recipes; these are the global tunables)
// ---------------------------------------------------------------------------

export const SMELTING = {
  SMELT_SECONDS: 10,              // one item smelts in this long (vanilla 10s);
                                  // SPEC fuel values are in items smelted, so
                                  // burn seconds = value * SMELT_SECONDS
  PROGRESS_DECAY: 2,              // unlit/blocked progress rewinds at this
                                  // multiple of the forward speed (vanilla)
};

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

export const MOBS = {
  HOSTILE_SPAWN_LIGHT_MAX: 7,     // hostiles spawn at light level <= this
  SPAWN_MIN_DISTANCE: 24,         // blocks from the player
  DESPAWN_DISTANCE: 128,
  // Phase 14 retune (caves felt crowded, not dangerous): the hostile cap
  // halved and the spawn cycle runs at a quarter of the old attempt rate
  // (2s interval x 4 attempts, was 1s x 8).
  HOSTILE_CAP: 14,                // total cap to protect framerate and pacing
  PASSIVE_CAP: 12,

  // --- Phase 12: the spawning framework (entities/spawning.js since the
  // Phase 14 split; per-mob stats live in the entities/mobs.js registry,
  // per ARCHITECTURE.md)
  SPAWN_INTERVAL_SECONDS: 2.0,    // one spawn cycle this often
  SPAWN_ATTEMPTS_PER_CYCLE: 4,    // random positions tried per cycle
  SPAWN_MAX_DISTANCE: 96,         // spawn ring outer edge (inside despawn range)
  SPAWN_Y_RANGE: 40,              // vertical search span around the player
  SPAWN_COLUMN_SCAN: 12,          // blocks walked down a column to find ground
  PASSIVE_SPAWN_LIGHT_MIN: 9,     // passive mobs need at least this much
                                  // SKYLIGHT (after the time-of-day darken):
                                  // they spawn on grass in real daylight,
                                  // never under torches at night
  VOID_DESPAWN_Y: -80,            // mobs below this are removed (16 under
                                  // the world floor, like dropped items)

  // --- entity physics (entities/entity.js)
  GRAVITY: 32,                    // blocks/s² (same world physics as the player)
  TERMINAL_VELOCITY: 78,
  STEP_HEIGHT: 1.0,               // mobs walk up full blocks without jumping
  GROUND_RESPONSE: 8,             // 1/s approach to the wished velocity
  AIR_DRAG: 1.9,                  // 1/s airborne damping (knockback arcs carry)
  WATER_GRAVITY: 8,
  WATER_BUOYANCY: 1.2,            // mobs bob toward the water surface
  WATER_DRAG: 4.5,
  WATER_SPEED_FACTOR: 0.5,        // horizontal crawl factor while in water
  LAVA_GRAVITY: 9,
  LAVA_DRAG: 9,                   // dense — mobs sink slowly, never plunge
  LAVA_SPEED_FACTOR: 0.25,
  FLUID_EXIT_JUMP: 6,             // bank hop, so mobs climb out of ponds

  // --- combat feel
  KNOCKBACK_HORIZONTAL: 6.5,      // blocks/s away from a hit
  KNOCKBACK_VERTICAL: 5.0,        // upward pop on a hit
  HURT_FLASH_SECONDS: 0.4,        // red tint after taking damage
  DEATH_SECONDS: 0.45,            // fall-over animation before removal
  ATTACK_REACH: 3,                // player melee reach against mobs (vanilla)
  MELEE_RANGE: 1.4,               // mob-to-player centre distance that can bite
                                  // (vanilla zombie reach ~1.43 — and, unlike
                                  // 1.8, geometrically unable to cross a
                                  // 1-block wall: 0.3 + 1 + 0.3 = 1.6 minimum)
  MELEE_VERTICAL_RANGE: 2,        // bite only when roughly level with the player
  MELEE_COOLDOWN_SECONDS: 1.0,    // between a mob's own attacks
  BURN_DAMAGE_TICK_SECONDS: 0.5,  // lava contact damage cadence for mobs
  LAVA_CONTACT_DAMAGE: 4,         // per tick while a mob touches lava
  SUFFOCATION_DAMAGE: 1,          // per tick with a solid block in the head cell
  SUFFOCATION_TICK_SECONDS: 0.5,  // (vanilla: sand falling onto a mob, or a
                                  // block placed into it, kills rather than
                                  // pinning it forever against the no-shove
                                  // sweep clamp)

  // --- AI (shared pursue machinery + the per-mob states)
  AGGRO_RADIUS: 32,               // pursue when the player is within this
  REPATH_SECONDS: 0.5,            // recompute the A* path this often
  WAYPOINT_RADIUS: 0.35,          // a waypoint counts reached within this
  CHASE_DIRECT_RANGE: 4,          // this close, skip the path and walk straight

  // Zombies and skeletons burn in daylight (SPEC): direct sky above
  // (sky light 15 — any canopy or roof shades) while the sun is high
  // (skyDarken at/below the threshold), unless in water.
  DAYLIGHT_BURN: {
    MIN_SKY_LIGHT: 15,            // direct, unshaded sky required
    MAX_SKY_DARKEN: 2,            // dayNight.skyDarken at/below this = day
    TICK_SECONDS: 1.0,            // fire tick cadence (vanilla)
    DAMAGE: 1,                    // per tick
  },

  // Skeleton (keeps distance, shoots with lead). Phase 14: firing is a real
  // draw-and-release cycle — after the cooldown the skeleton visibly raises
  // and draws its bow for DRAW_SECONDS (the wind-up; interrupted by losing
  // line of sight), releases the arrow, then cools down again. One arrow
  // every COOLDOWN + DRAW = 2 seconds flat out (vanilla Normal), and it can
  // never fire the instant a target reappears.
  SKELETON: {
    PREFERRED_RANGE: 10,          // approaches until inside this
    RETREAT_RANGE: 5,             // backs away when the player is closer
    SHOOT_COOLDOWN_SECONDS: 1.0,  // rest between a release and the next draw
    DRAW_SECONDS: 1.0,            // visible bow wind-up before each shot
    DRAW_DECAY_RATE: 3,           // draw lost per second when aim breaks
    ARROW_SPEED: 24,              // blocks/s — Phase 15: eased off the vanilla
                                  // 32 so the shot reads as a projectile with
                                  // a visible arc instead of a hitscan flick
                                  // (the aim lead/lift maths compensate)
    ARROW_INACCURACY: 1.2,        // blocks/s of random spread on the shot
    EYE_HEIGHT: 1.6,              // arrows leave from here
    AIM_LEAD_FACTOR: 1.0,         // fraction of the player's velocity led
    AIM_HEIGHT_FRACTION: 0.6,     // aims at this fraction of the player's height
    // The held bow (extruded assets/items/bow.png slab in the LEFT hand,
    // riding the arm so the aim pose points it at the target) and the
    // draw-pose amounts layered on the aim pose.
    BOW_SCALE: 0.55,              // bow slab edge length (blocks)
    BOW_OFFSET: [0, -0.68, -0.02], // bow position on the arm (hand end)
    BOW_TILT: [-0.5, 1.35, -0.5], // bow orientation in the hand at rest
    // Phase 15 (the "no shooting animation" report): the aim pose itself now
    // follows the firing cycle — arms DOWN through the cooldown, raised and
    // drawn over DRAW_SECONDS, released — so the wind-up amounts are sized
    // to read at a distance.
    DRAW_STRING_PULL: 0.9,        // radians the string arm folds back at full draw
    DRAW_ARM_RAISE: 0.25,         // extra radians the bow arm lifts at full draw
  },

  // Creeper (approaches, hisses, flashes, explodes)
  CREEPER: {
    FUSE_SECONDS: 1.5,            // SPEC: explodes after 1.5s
    IGNITE_RANGE: 3,              // fuse starts within this distance
    ABORT_RANGE: 7,               // fuse rewinds when the player escapes this
    FUSE_REWIND_RATE: 2,          // rewind speed multiple while aborted
    SWELL_SCALE: 0.35,            // extra model scale at full fuse
    FLASH_HZ: 5,                  // white-flash blink rate while fusing
    HISS_RANGE: 16,               // hiss volume fades to nothing at this distance
    HISS_MIN_VOLUME: 0.2,         // ...but an igniting creeper is never silent
  },

  // Spider (fast, climbs, neutral in bright light unless provoked)
  SPIDER: {
    HOSTILE_LIGHT_MAX: 7,         // hostile at/below this effective light
    CLIMB_SPEED: 2.5,             // blocks/s up a wall it is pushing against
    LEG_SWING: 0.4,               // radians of leg yaw scuttle at full stride
    LEG_LIFT: 0.15,               // radians of leg roll lift while striding
  },

  // Passive herds (Phase 14 — cow/pig/sheep/chicken, entities/passive.js).
  // The wander AI idles, ambles a short leg in a random direction, idles
  // again; taking any hit panics the animal into a sprint away from the
  // player. Registry `speed` is the panic speed; wandering uses a fraction.
  PASSIVE: {
    WANDER_SPEED_FACTOR: 0.45,    // amble speed as a fraction of panic speed
    WANDER_MIN_SECONDS: 2,        // one wander leg lasts this range
    WANDER_MAX_SECONDS: 4,
    IDLE_MIN_SECONDS: 2,          // pause between legs
    IDLE_MAX_SECONDS: 6,
    FLEE_SECONDS: 5,              // panic run duration after a hit
    FLEE_JITTER: 0.6,             // radians of random spread on the flee line
    PROBE_AHEAD_BLOCKS: 1.5,      // wander looks this far ahead for danger
    MAX_WANDER_DROP: 3,           // never amble over a ledge deeper than this
    // Sheep: shearing (right-click with shears) pops 1-3 wool; killing an
    // unsheared sheep drops 1. Wool grows back like vanilla grass-eating,
    // on a timer.
    SHEEP: {
      SHEAR_WOOL_MIN: 1,
      SHEAR_WOOL_MAX: 3,
      REGROW_MIN_SECONDS: 60,     // wool regrows after this range
      REGROW_MAX_SECONDS: 150,
    },
    // Chicken: lays an egg occasionally, falls slowly (wing flapping).
    CHICKEN: {
      EGG_MIN_SECONDS: 150,       // vanilla lays every 5-10 min; the low end
      EGG_MAX_SECONDS: 300,       // suits a 20-minute day
      FALL_SPEED: 3,              // terminal fall speed (blocks/s) — flapping
      WING_FLAP_HZ: 6,            // airborne wing-flap rate
      WING_FLAP_AMP: 1.1,         // radians of flap
    },
  },

  // --- animation (entities/models.js rigs)
  LIMB_SWING_CYCLES_PER_BLOCK: 0.55, // stride cycles per block walked
  LIMB_SWING_MAX: 0.9,            // radians of limb swing at full stride
  LIMB_SWING_FADE_RATE: 8,        // 1/s swing amplitude ease in/out
  POSED_ARM_SWAY: 0.15,           // walk counter-sway factor for posed arms
                                  // (the zombie's stay raised, swaying a little)
  HEAD_TRACK_RANGE: 8,            // the head follows a player within this
  HEAD_YAW_LIMIT: 1.1,            // radians the head turns from the body
  HEAD_PITCH_LIMIT: 0.7,
  HEAD_TURN_RATE: 10,             // 1/s head easing
  HEAD_HEIGHT_FRACTION: 0.9,      // eye height on the mob body, for head pitch
  BODY_TURN_RATE: 8,              // 1/s body yaw easing toward the move direction
  BODY_TURN_MIN_SPEED: 0.2,       // blocks/s below which the body stops turning
  LIGHT_TINT_RATE: 8,             // 1/s ease of the baked-light tint (no popping
                                  // when a mob crosses a light-level border)

  // --- pathfinding (entities/pathfinding.js)
  PATH: {
    NODE_BUDGET: 500,             // max A* expansions per search — the search
                                  // can never stall a frame; budget exhaustion
                                  // returns the closest-approach path instead
    MAX_DROP: 3,                  // never path over drops deeper than this (SPEC)
    MAX_RANGE: 48,                // nodes beyond this from the start stop expanding
    STEP_UP_COST: 1.5,            // route-shaping: climbing beats detouring only
                                  // when the detour costs more than this
    DROP_COST_PER_BLOCK: 0.5,     // extra cost per block of a ledge drop
    HEURISTIC_Y_WEIGHT: 0.5,      // vertical distance weight in the A* heuristic
  },
};

// ---------------------------------------------------------------------------
// Items (dropped entities)
// ---------------------------------------------------------------------------

export const ITEMS = {
  MAGNET_RADIUS: 1.5,             // items magnetise to the player within this
  MAGNET_SPEED: 6,                // blocks/s pull toward the player while magnetised
  PICKUP_RADIUS: 0.6,             // distance to the player's centre that collects
  PICKUP_DELAY_SECONDS: 0.4,      // fresh drops pop before they can be collected
  BOB_SPEED: 2.0,                 // bobbing cycles per second
  BOB_HEIGHT: 0.1,
  ROTATE_SPEED: 1.5,              // radians per second
  DESPAWN_SECONDS: 300,
  PICKUP_RETRY_SECONDS: 0.5,      // pause before re-offering an item the
                                  // inventory had no room for
  GRAVITY: 16,                    // blocks/s² on dropped items
  GROUND_FRICTION: 8,             // 1/s horizontal damping once resting
  WATER_FLOAT_SPEED: 0.8,         // blocks/s items rise toward the water surface
  WATER_FLOAT_RESPONSE: 4,        // 1/s approach rate to the float speed
  WATER_HORIZONTAL_DRAG: 2,       // 1/s horizontal damping while floating
  POP_SPEED_UP: 3.2,              // upward pop when a broken block drops
  POP_SPEED_SIDE: 1.6,            // random horizontal scatter on drop
  THROW_SPEED: 6,                 // forward speed of a thrown stack (clicking
                                  // outside the inventory panel with a cursor
                                  // stack throws it into the world)
  THROW_UP: 1.5,                  // small upward lift added to a throw
  THROW_EYE_DROP: 0.3,            // throws spawn this far below the eye
  BLOCK_SCALE: 0.25,              // edge length of a dropped mini-block
  SPRITE_SCALE: 0.35,             // edge length of a dropped flat item sprite
  REST_CLEARANCE: 0.02,           // items rest this far above the ground plane
  DROP_SPAWN_Y_OFFSET: 0.25,      // drops spawn this far above the broken cell floor
  VOID_DESPAWN_DEPTH: 16,         // items despawn this far below the world bottom
};

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const INVENTORY = {
  SIZE: 36,                       // total slots
  HOTBAR_SIZE: 9,                 // slots 0-8 are the hotbar
  MAX_STACK: 64,                  // default stack cap (per-item overrides — tools,
                                  // armour, pearls — live in the item registry)
};

// ---------------------------------------------------------------------------
// Crafting (SPEC.md: 2x2 grid in the inventory, 3x3 at a crafting table;
// the recipes themselves are the registry in systems/crafting.js)
// ---------------------------------------------------------------------------

export const CRAFTING = {
  INVENTORY_GRID: 2,              // craft grid width on the inventory screen
  TABLE_GRID: 3,                  // craft grid width at a crafting table
};

// ---------------------------------------------------------------------------
// UI (HUD hotbar and inventory screen) — sizes only; the pixel-art styling
// itself is inline in ui/hud.js / ui/screens.js like the other generated art
// ---------------------------------------------------------------------------

export const UI = {
  HOTBAR_SLOT_PX: 46,             // hotbar slot size
  HOTBAR_BOTTOM_PX: 8,            // hotbar offset from the bottom screen edge
  SCREEN_SLOT_PX: 46,             // inventory-screen slot size
  ICON_SCALE: 0.8,                // item icon size as a fraction of its slot
  BLOCK_ICON_PX: 64,              // canvas resolution of isometric block icons
  DURABILITY_BAR_PX: 3,           // height of the durability bar in a slot

  // The 3D player model preview on the inventory screen (Phase 14,
  // ui/player_preview.js): a small live-rendered viewport beside the 2x2
  // craft grid; the model turns to follow the mouse like vanilla.
  PLAYER_PREVIEW: {
    WIDTH_PX: 110,                // viewport size on the panel
    HEIGHT_PX: 150,
    FOV: 30,                      // narrow lens like the vanilla inset
    CAMERA_DISTANCE: 4.6,         // blocks from the model
    CAMERA_HEIGHT: 1.0,           // camera aim height on the model (blocks)
    MAX_BODY_YAW: 0.6,            // radians the whole body turns to the mouse
    HEAD_EXTRA_YAW: 0.5,          // radians the head adds beyond the body
    MAX_HEAD_PITCH: 0.5,          // radians the head tips up/down
    TURN_RATE: 10,                // 1/s easing toward the mouse direction
    MAX_TARGET_YAW: 1.6,          // clamp on the raw look target (body + head
                                  // limits divide it up between them)
    YAW_SENSITIVITY: 2.2,         // target radians per canvas-width of cursor
    PITCH_SENSITIVITY: 1.4,       // target radians per canvas-height of cursor
    ARMOUR_INFLATE_PX: 0.75,      // armour overlay growth per side (pixels)
    LEGGING_INFLATE_PX: 0.4,      // trousers sit inside the boots/chest layer
  },
};

// ---------------------------------------------------------------------------
// Block interaction (break / place / outline / hand)
// ---------------------------------------------------------------------------

export const INTERACTION = {
  BREAK_COOLDOWN_SECONDS: 0.3,    // pause after a break before the next starts
  PLACE_REPEAT_SECONDS: 0.25,     // hold-to-place repeat interval
  WHEEL_STEP_DELTA: 50,           // wheel delta (pixels) per hotbar step — a
                                  // discrete notch (~100) steps once; trackpad
                                  // micro-deltas accumulate to this
  WHEEL_LINE_PIXELS: 33,          // deltaMode line -> pixel normalisation
  OUTLINE_COLOR: 0x000000,        // targeted face outline
  OUTLINE_OPACITY: 0.75,
  OUTLINE_OFFSET: 0.004,          // outline floats this far off the face (z-fight)
  // The crack overlay sits EXACTLY on the block faces (Phase 12 — the old
  // inflated cube parallaxed the crack texture up to a pixel off the face at
  // grazing view angles). polygonOffset wins the depth test against the
  // coplanar face without moving a single fragment on screen.
  CRACK_POLYGON_OFFSET_FACTOR: -1,
  CRACK_POLYGON_OFFSET_UNITS: -2,
  DESTROY_STAGE_PATH: 'assets/destroy/destroy_stage_', // real Minecraft crack
                                  // textures, `${PATH}${stage}.png`, 10 stages
  HAND: {
    // The hand renders in its own pass with a fixed-FOV camera (never the
    // world camera — its wide FOV skews anything in a screen corner, and the
    // sprint FOV kick would stretch it further).
    FOV: 50,
    NEAR: 0.05,
    FAR: 10,
    POSITION: [0.5, -0.4, -0.72],    // hand-camera-space resting spot
                                     // (right, down, forward — Phase 10 moved
                                     // it further into the lower-right corner;
                                     // it sat too close to screen centre and
                                     // blocked the view)
    ARM_SIZE: [0.15, 0.15, 0.33],    // first-person arm box dimensions (sized
                                     // for the FOV-50 hand camera; Phase 10
                                     // shortened the reach — it filled too
                                     // much of the screen)
    ARM_TILT: [0.45, 0.55, 0.55],    // resting rotation (radians) — the far
                                     // end reaches up toward screen centre and
                                     // the roll shows two faces (reads 3D)
    ARM_FORWARD: 0.12,               // arm reach forward, fraction of its length
    BLOCK_SCALE: 0.19,               // held mini-block edge length — sits in
                                     // the lower-right corner like vanilla
    BLOCK_TILT: [0.22, 0.785, 0],    // held block yawed ~45°, tipped a touch so
                                     // the top and two side faces read (vanilla)
    BLOCK_OFFSET: [0.05, -0.02, -0.1], // held block offset from POSITION
    SPRITE_SCALE: 0.38,              // held tool/item slab edge length
    SPRITE_TILT: [-0.6, 2.9, 0.67], // held tool orientation (screenshot-tuned
                                     // against vanilla): the ~180° yaw shows
                                     // the mirrored back face, pitch + roll
                                     // put the handle toward the bottom-right
                                     // corner with the head raised up and
                                     // forward on a ~45° diagonal
    SPRITE_OFFSET: [0.05, -0.03, -0.1], // held sprite offset from POSITION
    SWING_SECONDS: 0.28,             // one swing animation
    SWING_DIP: 0.28,                 // how far the swing dips (blocks, camera space)
    SWING_ROTATION: 1.1,             // swing rotation amplitude (radians)
    SWING_SIDE: 0.35,                // sideways dip, fraction of SWING_DIP
    SWING_FORWARD: 0.25,             // forward dip, fraction of SWING_DIP
    SWING_YAW: 0.25,                 // yaw twist, fraction of SWING_ROTATION
    // Eating (Phase 11): while holding right click with food, the hand lifts
    // toward the mouth and nibbles until STATS.EAT_SECONDS completes.
    EAT_OFFSET: [-0.16, 0.05, -0.06], // hand offset toward the mouth while eating
    EAT_TIP: 0.5,                    // extra x-rotation tipping the food up
    EAT_NIBBLE_HZ: 4.5,              // nibble bobs per second
    EAT_NIBBLE_AMP: 0.03,            // nibble bob amplitude
    EAT_ENGAGE_RATE: 10,             // 1/s ease into/out of the eating pose
    // Drawing a bow (Phase 13): the bow raises toward screen centre and
    // pulls back while the draw charges.
    DRAW_OFFSET: [-0.18, 0.07, 0.06], // hand offset while drawing
    DRAW_TIP: 0.3,                   // extra x-rotation raising the bow
    DRAW_ENGAGE_RATE: 8,             // 1/s ease into/out of the draw pose
    // Offhand (Phase 14): the left hand mirrors the right across the screen
    // centre and shows the offhand item whenever one is held. It swings on
    // offhand actions (eating from the offhand) but never on attacks.
    OFFHAND_POSITION: [-0.5, -0.4, -0.72], // left-hand resting spot
    OFFHAND_ARM_TILT: [0.45, -0.55, -0.55], // mirrored resting rotation
    OFFHAND_BLOCK_TILT: [0.22, -0.785, 0],  // mirrored held-block yaw
    OFFHAND_SPRITE_TILT: [-0.6, -2.9, -0.67], // mirrored held-tool diagonal
  },
};

// ---------------------------------------------------------------------------
// Time and lighting
// ---------------------------------------------------------------------------

export const TIME = {
  DAY_LENGTH_SECONDS: 1200,       // full day/night cycle: exactly 20 minutes
                                  // (Phase 14 — real Minecraft timing; the
                                  // phase splits live in DAY_NIGHT.KEYFRAMES:
                                  // day 10 min, sunset 1.5, night 7,
                                  // sunrise 1.5)
  START_TIME: 0.04,               // day fraction at boot (just after sunrise);
                                  // t=0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
};

export const LIGHTING = {
  MAX_LIGHT: 15,                  // light levels 0-15
  TORCH_LIGHT: 14,
  GLOWSTONE_LIGHT: 15,
  // Per-face brightness multipliers (the Minecraft look)
  FACE_BRIGHTNESS: { top: 1.0, side: 0.8, bottom: 0.5 },
  AO_STRENGTH: 0.45,              // ambient occlusion darkening at corners
  // Brightness multiplier per missing light level: level L renders at
  // LIGHT_FALLOFF^(15-L), so level 0 bottoms out near-black, not pure black.
  LIGHT_FALLOFF: 0.8,
  TORCH_TINT: 0xffd2a0,           // warm tint on block-light (torches, glowstone)
  NIGHT_SKY_TINT: 0x8fa8e8,       // cool moonlight tint on skylight at night
  // Held-item dynamic light (Phase 14, deliberately beyond vanilla): a torch
  // in the main or off hand lights the world around the player. Applied at
  // render time as a per-fragment distance term in the chunk shader — NEVER
  // baked into the flood fill, which would remesh chunks every step. The
  // light level per holdable item name; anything unlisted emits nothing.
  HELD_LIGHT: { torch: 14 },
  HELD_LIGHT_TINT: 0xffd2a0,      // same warm tone as placed torch light
  SUN_INTENSITY: 2.5,             // directional light (entities in later phases)
  SUN_DISTANCE: 300,              // directional light offset from the focus point
  SUN_TILT: 0.25,                 // z-lean of the sun's orbital plane
  AMBIENT_INTENSITY: 0.9,
  AMBIENT_SKY_COLOR: 0xcfe5ff,    // hemisphere light from above
  AMBIENT_GROUND_COLOR: 0x8a7a5a, // earthy bounce from below
};

// ---------------------------------------------------------------------------
// Sky and fog (day values; night/nether/end variants come with those phases)
// ---------------------------------------------------------------------------

export const SKY = {
  // Gradient stops from straight up to below the horizon (daytime palette;
  // the day/night cycle interpolates DAY_NIGHT.KEYFRAMES through these)
  ZENITH_COLOR: 0x3a6fd8,
  MID_COLOR: 0x6f9ce8,
  HORIZON_COLOR: 0xbcd8f5,
  BELOW_COLOR: 0x9db8d2,
  MID_STOP: 0.35,                 // where the mid stop sits in dome height 0..1
  // Fog is matched to the horizon colour so terrain fades into the sky
  FOG_COLOR: 0xbcd8f5,
  FOG_NEAR: 40,
  FOG_FAR: 140,
};

// Day/night cycle keyframes, piecewise-linearly interpolated (wrapping) over
// the day fraction t in [0,1): t=0 sunrise, 0.25 noon, 0.5 sunset, 0.75
// midnight. Colours are the sky gradient stops; fog always uses HORIZON so
// terrain fades into the sky at every point of the cycle.
//   SUN_LEVEL   scales the directional sun + hemisphere ambient (entities)
//   SKY_DARKEN  levels subtracted from baked skylight (0 day .. 11 deep night)
//   GLOW        strength of the warm horizon glow around the sun's position
// Phase 14 retiming — the real Minecraft phase lengths over the 20-minute
// cycle: daytime exactly 10 minutes (t 0.0-0.5, the sun above the horizon:
// it rises at t=0 and sets at t=0.5 by the orbit maths), sunset 1.5 minutes
// (0.5-0.575), night 7 minutes (0.575-0.925), sunrise 1.5 minutes
// (0.925-1.0). The old spread spent ~2 minutes total on each transition and
// only ~5.6 on night.
export const DAY_NIGHT = {
  KEYFRAMES: [
    { T: 0.000, ZENITH: SKY.ZENITH_COLOR, MID: SKY.MID_COLOR, HORIZON: SKY.HORIZON_COLOR,
      BELOW: SKY.BELOW_COLOR, SUN_LEVEL: 1.0, SKY_DARKEN: 0, GLOW: 0 },
    { T: 0.500, ZENITH: SKY.ZENITH_COLOR, MID: SKY.MID_COLOR, HORIZON: SKY.HORIZON_COLOR,
      BELOW: SKY.BELOW_COLOR, SUN_LEVEL: 1.0, SKY_DARKEN: 0, GLOW: 0 },
    { T: 0.5375, ZENITH: 0x2b3866, MID: 0x86688a, HORIZON: 0xff9354,
      BELOW: 0x6e5a52, SUN_LEVEL: 0.45, SKY_DARKEN: 4, GLOW: 0.85 },
    { T: 0.575, ZENITH: 0x050914, MID: 0x0a1226, HORIZON: 0x16203a,
      BELOW: 0x0b101e, SUN_LEVEL: 0.15, SKY_DARKEN: 11, GLOW: 0 },
    { T: 0.925, ZENITH: 0x050914, MID: 0x0a1226, HORIZON: 0x16203a,
      BELOW: 0x0b101e, SUN_LEVEL: 0.15, SKY_DARKEN: 11, GLOW: 0 },
    { T: 0.9625, ZENITH: 0x2e4382, MID: 0x8a7a9c, HORIZON: 0xffb26b,
      BELOW: 0x7a6055, SUN_LEVEL: 0.45, SKY_DARKEN: 4, GLOW: 0.85 },
  ],
  GLOW_COLOR: 0xff8a3c,           // sunrise/sunset horizon glow
};

// The visible sun and moon: square quads riding the sky dome.
export const CELESTIAL = {
  DISTANCE: 820,                  // from the camera; inside the sky dome radius
  SUN_SIZE: 150,
  MOON_SIZE: 95,
  SUN_COLOR: 0xfff7d0,
  MOON_COLOR: 0xdfe4f2,
};

// The view while the eye is submerged in lava (Phase 10): a heavy, nearly
// opaque orange overlay (the real lava tile, darkened, over the whole frame
// below the HUD) plus a very short fog so the few visible blocks vanish
// within arm's reach — vanilla's blind-in-lava look.
export const LAVA_VIEW = {
  FOG_COLOR: 0x991a00,
  FOG_NEAR: 0,
  FOG_FAR: 2.5,
  OVERLAY_OPACITY: 0.88,          // DOM overlay strength (HUD renders above)
  OVERLAY_BRIGHTNESS: 0.55,       // lava tile darkened to this for the overlay
  OVERLAY_TILE_PX: 96,            // on-screen size of one repeated lava tile
};

export const NETHER_SKY = {
  FOG_COLOR: 0x330808,            // thick red, close
  FOG_NEAR: 5,
  FOG_FAR: 60,
  // SPEC "ambient light: constant dim red" — while in the Nether the
  // day/night cycle's sky writes are overridden with these fixed values
  // (render/lighting.js setDimensionSky): skylight held at a permanent dusk
  // and tinted red, block light (glowstone, lava, the portal) unaffected.
  SKY_DARKEN: 5,
  SKY_TINT: 0xff9a80,
};

export const END_SKY = {
  FOG_COLOR: 0x281a3a,            // purple, medium
  FOG_NEAR: 20,
  FOG_FAR: 110,
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export const RENDER = {
  MAX_PIXEL_RATIO: 2,
  TONE_MAPPING_EXPOSURE: 1.0,
  SHADOW_MAP_SIZE: 2048,
  SHADOW_RANGE: 100,              // half-extent of the sun's shadow camera —
                                  // sized so the shadow cutoff falls in heavy fog
  SHADOW_CAMERA_FAR: 500,         // depth headroom so shadows survive flying high
  SHADOW_BIAS: -0.0005,
  SHADOW_FOLLOW_SNAP: 16,         // sun/shadow camera follows the player snapped
                                  // to this grid (blocks) to avoid shadow shimmer
  BREAK_STAGES: 10,               // progressive crack overlay stages
  CUTOUT_ALPHA_TEST: 0.5,         // alpha cutoff for leaves/cactus/glass
  WATER_OPACITY: 0.8,             // translucent water pass
  WATER_SURFACE_SINK: 0.125,      // water surface sits this far below the block top
};

// ---------------------------------------------------------------------------
// Texture atlas
// ---------------------------------------------------------------------------

export const ATLAS = {
  PATH: 'assets/block_atlas.png',
  TILES_PER_ROW: 16,
  TILE_PIXELS: 16,
  // Tiny UV inset to stop neighbouring tiles bleeding at face edges
  UV_INSET: 1 / 2048,
};

// ---------------------------------------------------------------------------
// Portals and the End (SPEC.md numbers)
// ---------------------------------------------------------------------------

export const PORTALS = {
  NETHER_FRAME_MIN_WIDTH: 4,      // SPEC: minimum OUTER frame size 4x5
  NETHER_FRAME_MIN_HEIGHT: 5,
  MAX_INTERIOR: 21,               // interior span cap (vanilla's 23x23 outer)
  NETHER_STAND_SECONDS: 3,
  LINK_SEARCH_RADIUS: 32,         // reuse an existing portal within this many
                                  // blocks (destination scale) of the scaled
                                  // arrival point; otherwise build one
  EYE_SHATTER_CHANCE: 0.2,
  STRONGHOLD_MIN_DISTANCE: 1000,
  STRONGHOLD_MAX_DISTANCE: 2000,
  END_PORTAL_FRAME_COUNT: 12,

  // The animated portal-interior look (world/chunks.js renders it from a
  // generated purple swirl texture — no portal tile ships in the atlas).
  SWIRL: {
    OPACITY: 0.85,
    SCROLL_TILES_PER_SECOND: 0.15, // upward drift of the swirl pattern
    WOBBLE_AMPLITUDE: 0.08,        // sideways shimmer (texture offset)
    WOBBLE_HZ: 0.4,
  },

  // Purple particles drifting off active portal blocks (dimensions/portals.js).
  PARTICLES: {
    COUNT: 90,                     // pooled particle budget
    RANGE: 20,                     // portals within this range of the player emit
    LIFE_SECONDS: 1.5,
    DRIFT_SPEED: 0.6,              // blocks/s of random drift
    SIZE: 0.22,                    // point sprite size (blocks at 1 distance)
  },

  // The low whispering hum near an active portal + the travel whoosh
  // (procedural WebAudio, like combat's hiss/boom — no audio assets exist).
  AMBIENCE: {
    RANGE: 14,                     // hum fades to silence at this distance
    VOLUME: 0.22,
    WHOOSH_VOLUME: 0.6,
  },
};

export const DRAGON = {
  HEALTH: 200,
  HEAD_ONLY_FULL_DAMAGE: true,
  BODY_DAMAGE_MULTIPLIER: 0.25,
};

// ---------------------------------------------------------------------------
// TEMPORARY, MUST REMOVE BEFORE PHASE 20 — Nether test chest
// ---------------------------------------------------------------------------

// Places a chest at the player's spawn point holding 10 obsidian, a flint
// and steel, a diamond pickaxe and an iron sword, so the portal/Nether can
// be tested without a full playthrough (main.js reads it at boot).
export const TEST_CHEST = true;

// ---------------------------------------------------------------------------
// Debug / development
// ---------------------------------------------------------------------------

export const DEBUG = {
  FLY_SPEED: 12,                  // fly mode blocks per second
  FLY_SPEED_FAST: 40,             // holding Ctrl
  FLY_TOGGLE_CODE: 'F4',          // key that toggles the debug fly mode
  MAX_DELTA: 0.1,                 // clamp frame delta (seconds) after tab-away
  HUD_UPDATE_INTERVAL: 0.25,      // seconds between FPS readout updates
};
