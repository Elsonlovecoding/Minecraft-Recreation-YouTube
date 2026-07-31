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

// ---------------------------------------------------------------------------
// Terrain generation
// ---------------------------------------------------------------------------

export const CAVES = {
  MIN_Y: -50,
  MAX_Y: 60,
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

// Ore distribution from SPEC.md. rarity = attempts per chunk (tuning knob).
export const ORES = {
  coal:     { minY: 0,   maxY: 120, attemptsPerChunk: 16, veinSize: 8, tool: 'wood' },
  iron:     { minY: -32, maxY: 64,  attemptsPerChunk: 12, veinSize: 6, tool: 'stone' },
  gold:     { minY: -48, maxY: 32,  attemptsPerChunk: 4,  veinSize: 5, tool: 'iron' },
  redstone: { minY: -60, maxY: 16,  attemptsPerChunk: 4,  veinSize: 6, tool: 'iron' },
  diamond:  { minY: -60, maxY: 12,  attemptsPerChunk: 2,  veinSize: 4, tool: 'iron' },
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

  WALK_SPEED: 4.3,              // blocks per second
  SPRINT_SPEED: 5.6,
  SNEAK_SPEED: 1.3,
  SWIM_SPEED: 2.2,
  JUMP_VELOCITY: 8.5,           // initial upward velocity, clears ~1.25 blocks
  GRAVITY: 32,                  // blocks per second squared

  FALL_DAMAGE_THRESHOLD: 3,     // safe fall height in blocks
  FALL_DAMAGE_PER_BLOCK: 2,     // 1 heart per block beyond the threshold

  EYE_HEIGHT: 1.62,
  WIDTH: 0.6,
  HEIGHT: 1.8,
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

export const WEAPON_DAMAGE = {
  fist: 1,
  wood_sword: 4,
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
  BOB_SPEED: 2.0,                 // bobbing cycles per second
  BOB_HEIGHT: 0.1,
  ROTATE_SPEED: 1.5,              // radians per second
  DESPAWN_SECONDS: 300,
  MAX_STACK: 64,
};

// ---------------------------------------------------------------------------
// Time and lighting
// ---------------------------------------------------------------------------

export const TIME = {
  DAY_LENGTH_SECONDS: 1200,       // full day/night cycle ~20 minutes
};

export const LIGHTING = {
  MAX_LIGHT: 15,                  // light levels 0-15
  TORCH_LIGHT: 14,
  GLOWSTONE_LIGHT: 15,
  // Per-face brightness multipliers (the Minecraft look)
  FACE_BRIGHTNESS: { top: 1.0, side: 0.8, bottom: 0.5 },
  AO_STRENGTH: 0.5,               // ambient occlusion darkening at corners
  SUN_INTENSITY: 2.5,
  SUN_POSITION: [60, 100, 40],    // fixed noon sun until the day/night cycle
  AMBIENT_INTENSITY: 0.9,
  AMBIENT_SKY_COLOR: 0xcfe5ff,    // hemisphere light from above
  AMBIENT_GROUND_COLOR: 0x8a7a5a, // earthy bounce from below
};

// ---------------------------------------------------------------------------
// Sky and fog (day values; night/nether/end variants come with those phases)
// ---------------------------------------------------------------------------

export const SKY = {
  // Gradient stops from straight up to below the horizon
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
  SHADOW_RANGE: 40,               // half-extent of the sun's shadow camera
  SHADOW_CAMERA_FAR: 300,
  SHADOW_BIAS: -0.0005,
  BREAK_STAGES: 10,               // progressive crack overlay stages
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
  FLY_SPEED: 12,                  // blocks per second
  FLY_SPEED_FAST: 40,             // holding Ctrl
  MOUSE_SENSITIVITY: 0.0022,      // radians per pixel
  MAX_DELTA: 0.1,                 // clamp frame delta (seconds) after tab-away
  HUD_UPDATE_INTERVAL: 0.25,      // seconds between FPS readout updates
  TERRAIN_PREGEN_RADIUS: 2,       // chunks generated around origin at startup
                                  // for the Phase 2 terrain diagnostics
};
