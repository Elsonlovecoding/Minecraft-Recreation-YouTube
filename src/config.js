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
    MASK_SCALE: 1 / 140,     // 2D mask field frequency (region size)
    MASK_START: 0.38,        // mask noise where entrance regions begin
    MASK_FULL: 0.60,         // mask noise where the gate saturates
    MAX_FACTOR: 0.85,        // tunnel radius fraction inside a full-gate region
    DECAY: 0.04,             // additional gentle taper with height above MAX_Y
    MAX_SURFACE_Y: 96,       // columns higher than this never get mouths
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
  STARVE_FLOOR_HEALTH: 2,       // starvation stops at 1 heart in the overworld
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
  FALL_DAMAGE_PER_BLOCK: 2,     // 1 heart per block beyond the threshold

  // Safe spawn: nearest dry, clear surface column to this point
  SPAWN: { X: 8, Z: 8, SEARCH_RADIUS: 48 },
};

// ---------------------------------------------------------------------------
// Stats (player/stats.js) — Phase 9 slice: health and lava contact damage.
// Hunger, fall damage, drowning and the rest arrive with the full stats phase.
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
// Tools, weapons, armour (SPEC.md tables)
// ---------------------------------------------------------------------------

export const TOOL_TIERS = {
  hand:    { speedMultiplier: 1, durability: Infinity },
  wood:    { speedMultiplier: 2, durability: 60 },
  stone:   { speedMultiplier: 4, durability: 132 },
  iron:    { speedMultiplier: 6, durability: 251 },
  diamond: { speedMultiplier: 8, durability: 1562 },
};

// Keys are the item ids the inventory uses (wooden_sword...), so the combat
// phase can look up WEAPON_DAMAGE[inventory.selectedName] directly.
export const WEAPON_DAMAGE = {
  fist: 1,
  wooden_sword: 4,
  stone_sword: 5,
  iron_sword: 6,
  diamond_sword: 7,
  bow_full_draw: 6,
};

export const ARMOR_REDUCTION = {
  leather: 0.28,
  iron: 0.60,
  diamond: 0.80,
};

// Mining a block above your tool tier: possible but very slow, drops nothing.
export const WRONG_TIER_SPEED_MULTIPLIER = 0.3;

// Non-cube block shapes (consumed by the block registry, mesher and physics).
export const SHAPES = {
  CACTUS_INSET: 1 / 16,           // cactus side faces AND collision box sit this
                                  // far inside the cell on x/z (vanilla: sides
                                  // render 1/16..15/16, top/bottom full size)
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
  HOSTILE_CAP: 32,                // total cap to protect framerate
  PASSIVE_CAP: 16,
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
  CRACK_INFLATE: 0.008,           // crack overlay cube inflation over the block
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
  },
};

// ---------------------------------------------------------------------------
// Time and lighting
// ---------------------------------------------------------------------------

export const TIME = {
  DAY_LENGTH_SECONDS: 1200,       // full day/night cycle ~20 minutes
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
export const DAY_NIGHT = {
  KEYFRAMES: [
    { T: 0.000, ZENITH: 0x2e4382, MID: 0x8a7a9c, HORIZON: 0xffb26b,
      BELOW: 0x7a6055, SUN_LEVEL: 0.45, SKY_DARKEN: 4, GLOW: 0.85 },
    { T: 0.050, ZENITH: SKY.ZENITH_COLOR, MID: SKY.MID_COLOR, HORIZON: SKY.HORIZON_COLOR,
      BELOW: SKY.BELOW_COLOR, SUN_LEVEL: 1.0, SKY_DARKEN: 0, GLOW: 0 },
    { T: 0.450, ZENITH: SKY.ZENITH_COLOR, MID: SKY.MID_COLOR, HORIZON: SKY.HORIZON_COLOR,
      BELOW: SKY.BELOW_COLOR, SUN_LEVEL: 1.0, SKY_DARKEN: 0, GLOW: 0 },
    { T: 0.500, ZENITH: 0x2b3866, MID: 0x86688a, HORIZON: 0xff9354,
      BELOW: 0x6e5a52, SUN_LEVEL: 0.45, SKY_DARKEN: 4, GLOW: 0.85 },
    { T: 0.560, ZENITH: 0x050914, MID: 0x0a1226, HORIZON: 0x16203a,
      BELOW: 0x0b101e, SUN_LEVEL: 0.15, SKY_DARKEN: 11, GLOW: 0 },
    { T: 0.940, ZENITH: 0x050914, MID: 0x0a1226, HORIZON: 0x16203a,
      BELOW: 0x0b101e, SUN_LEVEL: 0.15, SKY_DARKEN: 11, GLOW: 0 },
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
  NETHER_FRAME_MIN_WIDTH: 4,
  NETHER_FRAME_MIN_HEIGHT: 5,
  NETHER_STAND_SECONDS: 3,
  EYE_SHATTER_CHANCE: 0.2,
  STRONGHOLD_MIN_DISTANCE: 1000,
  STRONGHOLD_MAX_DISTANCE: 2000,
  END_PORTAL_FRAME_COUNT: 12,
};

export const DRAGON = {
  HEALTH: 200,
  HEAD_ONLY_FULL_DAMAGE: true,
  BODY_DAMAGE_MULTIPLIER: 0.25,
};

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
