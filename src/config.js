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
  LAVA_SEA_Y: 31,         // every open cell at/below this floods (the lava
                          // oceans — the vanilla nether sea level)
  LAVA_TICK_SECONDS: 0.75, // nether lava spreads twice as fast as the
                          // overworld's 1.5s tick (vanilla; fluids.js takes
                          // it as a per-dimension override on switch)

  // Phase 16 — the real Nether generation (dimensions/nether.js): one 3D
  // density field shaped by a vertical bias profile. Solid where
  // field + bias(y) > 0, so positive bias closes rock toward the bedrock
  // floor and ceiling while the negative mid band opens the huge caverns
  // (and leaves floating netherrack islands where the field folds above
  // the threshold). Everything below LAVA_SEA_Y that carves open floods
  // with lava.
  GEN: {
    LATTICE_STEP: 4,      // noise sampled every N blocks, trilerped per cell
    DENSITY: { SCALE_XZ: 1 / 105, SCALE_Y: 1 / 68, OCTAVES: 3 },
    // [y, bias] keyframes, piecewise-lerped over the full height.
    SHAPE: [
      [0, 2.4],           // solid mass against the bedrock floor
      [12, 0.65],
      [26, 0.26],         // ocean-floor band: mostly solid, lakes carve open
      [40, 0.06],
      [56, -0.13],        // the big-cavern band (portal arrival heights)
      [74, -0.17],        // most open here
      [90, 0.02],
      [106, 0.5],
      [118, 1.3],         // sealing toward the ceiling
      [128, 2.6],
    ],
    // Bedrock: a solid layer at MIN_Y and at CEILING_Y, plus jagged bands
    // just inside them (per-layer survival chance, like the overworld's).
    BEDROCK_JAGGED_CHANCE: [0.8, 0.6, 0.4, 0.2],

    // Soul sand patches: inside sparse 2D mask regions, upward floor
    // surfaces convert their top layers (the slog through them is the
    // point — registry `slows`).
    SOUL_SAND: { MASK_SCALE: 1 / 60, THRESHOLD: 0.34, DEPTH: 3, MAX_Y: 80 },

    // Glowstone clusters dangling from ceilings/overhangs: per-chunk seeded
    // attempts; a hit grows a compact downward-biased blob of glowstone
    // (light 15) under a solid roof.
    GLOWSTONE: {
      ATTEMPTS_PER_CHUNK: 6,
      CHANCE: 0.45,        // chance an attempt with a valid roof grows
      MIN_Y: 36,           // never down at the lava sea
      MAX_Y: 124,
      BLOB_MIN: 5,
      BLOB_MAX: 14,
    },

    // Nether quartz ore veins in netherrack (vanilla: common).
    QUARTZ: { MIN_Y: 8, MAX_Y: 117, ATTEMPTS_PER_CHUNK: 12, VEIN_MIN: 4, VEIN_MAX: 13 },

    // Rare lava leaks high on cavern walls — a source placed against a wall
    // with a drop below it; the fluids automaton pours it on first sight.
    LAVA_LEAKS: { ATTEMPTS_PER_CHUNK: 2, CHANCE: 0.35, MIN_Y: 44, MAX_Y: 110 },
  },

  // Phase 17 — nether fortresses (dimensions/fortress.js), Phase 18 grown to
  // the real sprawling scale ("fortresses are too small" report): one
  // fortress per REGION_CHUNKS² chunk region, always, spanning up to
  // ~300 blocks — genuinely long bridges (runs of dozens of cells),
  // multiple blaze towers, staircase galleries connecting decks at
  // different heights, and an enclosed KEEP of interconnected rooms and
  // corridors around the heart. Region-seeded blueprint on a CELL grid;
  // every intersecting chunk re-derives it and emits deterministically.
  // Geometry offsets within a cell (deck strip, doorways) are derived from
  // CELL in fortress.js; these are the layout/growth tunables.
  FORTRESS: {
    REGION_CHUNKS: 24,      // one fortress per 24x24-chunk (384-block) region
                            // (Phase 18: doubled — the fortress itself spans
                            // most of the region, so it stays findable)
    CELL: 8,                // piece footprint (blocks); rooms fill a cell
    ORIGIN_JITTER: 40,      // fortress origin scatter around the region centre
                            // (extent + jitter stays inside the region, so a
                            // chunk only ever consults its OWN region)
    DECK_MIN_Y: 48,         // base deck height rolled per fortress — inside
    DECK_MAX_Y: 58,         // the big-cavern band, above the lava sea
    MAX_PIECES: 110,        // blueprint growth budget (Phase 18: was 34)
    MAX_RADIUS_CELLS: 18,   // extent cap in cells from the origin (144
                            // blocks — up to ~290 blocks across; jitter +
                            // extent stays strictly inside the region)
    MAX_DEPTH: 6,           // junctions chained per arm before it must end
    BRIDGE_MIN_CELLS: 4,    // open-bridge run length range — LONG spans
    BRIDGE_MAX_CELLS: 14,   // (up to 112 blocks in one straight run)
    CORRIDOR_MIN_CELLS: 2,  // walled-corridor runs stay shorter
    CORRIDOR_MAX_CELLS: 5,
    CORRIDOR_CHANCE: 0.35,  // a run is a walled corridor instead of open bridge
    CONTINUE_CHANCE: 0.75,  // a run ends in a crossing (vs a terminal room)
    BRANCH_CHANCE: 0.6,     // each side of a crossing sprouts a new arm
    STAIR_CHANCE: 0.4,      // a continuing run inserts a staircase gallery
                            // before its junction, shifting the deck level
    LEVEL_STEP: 6,          // blocks of height one staircase cell climbs
    LEVEL_RANGE: 12,        // deck levels stay within base deckY ± this
    KEEP_RADIUS_CELLS: 1,   // the enclosed keep spans (2R+1)² cells around
                            // the heart (1 = a 3x3 block of rooms, 24x24)
    CLEAR_HEIGHT: 4,        // air cleared above every deck/walkway
    WALL_HEIGHT: 5,         // roofed-room walls (roof sits one above)
    TOWER_WALL_HEIGHT: 10,  // blaze-tower walls (Phase 18: tall, open-top,
                            // merlons above — reads as a tower from afar)
    DOOR_HEIGHT: 3,         // doorway cut height (width derives from CELL)
    WINDOW_EVERY: 3,        // corridor wall slit spacing (columns)
    PIER_MAX_DROP: 48,      // support piers descend at most this far
    PIER_LAVA_DEPTH: 3,     // ...and at most this deep into the lava sea
  },
};

export const END = {
  MIN_Y: 0,
  MAX_Y: 256,
  // Phase 21 (reported too small): the measured Phase 20 island ran 88-106
  // blocks across because EDGE_WOBBLE cut as deep as it pushed out. Radius
  // 56 with a 6-block wobble keeps every bearing at 100+ and reads ~112
  // across — SPEC's "roughly 100 blocks" as a floor, not an average.
  ISLAND_RADIUS: 56,          // central island ~112 blocks across
  PILLAR_COUNT: 10,
  // Phase 21 (reported as towering over the island): heights are measured
  // ABOVE the island surface, and 40-70 there put the tallest pillar's top
  // 70 blocks over a 100-wide island — nothing like vanilla. Real spikes
  // top out at y 76-103 over a surface at y≈64, i.e. 12-39 blocks of shaft.
  // These are those numbers; the column is still a 40-70 block obsidian
  // structure once its ROOT_DEPTH anchor into the island is counted.
  PILLAR_MIN_HEIGHT: 14,
  PILLAR_MAX_HEIGHT: 40,
  // Phase 20 — the island rebuilt (dimensions/end.js; the Phase 19 report
  // called the first pass far too small). A radial end-stone disc: full
  // thickness at the centre, tapering to a wobbled edge, floating over
  // void, flattened around the centre so the exit portal sits flush.
  ISLAND_TOP_Y: 64,           // island surface height
  ISLAND_MAX_DEPTH: 42,       // stone thickness at the centre
  EDGE_WOBBLE: 7,             // radius noise amplitude (ragged coastline)
  EDGE_WOBBLE_SCALE: 0.7,     // radius noise frequency (radians on the ring)
  SURFACE_WOBBLE: 2,          // gentle surface undulation amplitude
  FLAT_RADIUS: 9,             // dead-flat plateau around the exit portal
  FLAT_BLEND: 8,              // blocks over which the wobble fades back in
  // The obsidian arrival platform (vanilla flavour, placed ON the island
  // margin so arrival can never soft-lock over the void).
  PLATFORM: { X: 38, Z: 0, RADIUS: 2, CLEARANCE: 3 },
  HOSTILE_CAP: 10,            // endermen fill the island (SPEC: "endermen
                              // spawn on the island")

  // Phase 20 — the obsidian pillars ringing the centre (SPEC: 10 pillars,
  // 40-70 blocks tall, an end crystal on each). Heights climb around the
  // ring from MIN to MAX in a seeded order; each pillar is an obsidian
  // cylinder rooted a few blocks into the island with a bedrock cap block
  // at the top centre (the crystal's seat, vanilla flavour).
  PILLARS: {
    RING_RADIUS: 33,          // pillar centres sit on this ring
    RADIUS_MIN: 2,            // pillar cylinder radius rolls in this range
    RADIUS_MAX: 3,
    ANGLE_JITTER: 0.25,       // radians of seeded scatter off the even ring
    ROOT_DEPTH: 26,           // blocks the pillar anchors below the surface —
                              // Phase 21: the shaft got shorter, so the
                              // column roots deeper into the 42-thick island
                              // and stays a 40-66 block obsidian pillar
  },

  // Phase 20 — the exit portal fountain at the island centre: a bedrock
  // disc, a raised bedrock rim around the portal well, and the central
  // bedrock column with torches. The well stays AIR until the dragon dies;
  // then it fills with end portal blocks (the win condition's doorway).
  EXIT_PORTAL: {
    X: 0,
    Z: 0,
    BASE_RADIUS_SQ: 13,       // bedrock disc: cells with dx²+dz² <= this
    WELL_RADIUS_SQ: 6,        // portal well interior (minus the centre column)
    PILLAR_HEIGHT: 3,         // central bedrock column above the base (the
                              // perched dragon's body drapes just above it)
    CLEARANCE: 8,             // air cleared above the fountain at generation
  },
};

// ---------------------------------------------------------------------------
// Chunks and rendering distance
// ---------------------------------------------------------------------------

export const CHUNK = {
  SIZE: 16,               // blocks per chunk edge (x/z)
  HEIGHT: 384,            // overworld world height (MAX_Y - MIN_Y)
};

// RENDER DISTANCE. Phase 25 went 8 -> 12; the follow-ups went 12 -> 20 and
// then 20 -> 30 (480 blocks) by request. This is THE knob to turn for
// performance: everything below scales with its square.
//
// Measured off the real generator+mesher (node) so the trade is a number
// rather than a hope:
//        r=8   197 meshed chunks    453 draws   0.91M tris    79 MB geometry +  71 MB chunk data
//        r=12  441 meshed chunks    973 draws   2.03M tris   174 MB geometry + 143 MB chunk data
//        r=20  1257 meshed chunks  2968 draws   6.44M tris   554 MB geometry + 364 MB chunk data
//        r=30  2821 meshed chunks  6665 draws  14.23M tris  1224 MB geometry + 780 MB chunk data
// A 70° lens sees roughly a quarter of the ring at a time, so r=30 draws on
// the order of 1700 calls and 3.6M triangles per frame — that wants a real
// discrete GPU, and the ~2 GB resident footprint wants 16 GB of system
// memory with a 64-bit browser. This is an enthusiast setting by explicit
// request; drop to 20 (~920 MB), 12 (a vanilla-default ~320 MB) or 8 on
// lesser machines. Filling the ring costs ~38 s of CPU (measured: 3969
// chunks generated at 5.1 ms, 2821 meshed at 6.4 ms), which the
// 8 ms-per-frame streaming budget spreads over ~80 s of play at 60fps,
// nearest-first — the horizon finishes loading well after the nearby world.
export const VIEW = {
  DISTANCE_CHUNKS: 25,    // chunks loaded/rendered around the player —
                          // the guaranteed radius WHEREVER the player
                          // stands (streaming re-centres every border
                          // crossing). Final request: "render 25 chunks
                          // ... wherever I'm standing, 25 chunk radius" —
                          // Phase 27's 40 was more than asked and its
                          // 5025-chunk ring took real minutes to fill
                          // after a move; 1961 chunks fills ~2.5x faster,
                          // so the promised radius is actually THERE.
                          // (Phase 27: 30 -> 40; measured numbers for
                          // both in the LOD note below.)
  FOV: 70,
  NEAR: 0.1,
  FAR: 1700,              // must clear CLOUDS.FADE_END (1400) plus slack —
                          // the cloud plane's far band was clipping at the
                          // old 1000 (terrain never gets near this: the
                          // ring ends at 400 and fog closes at 425)

  // Phase 26 — LEVEL OF DETAIL, so the 30-chunk ring doesn't cost 30 chunks
  // of full geometry. Chunks beyond DETAIL_CHUNKS mesh at a reduced tier:
  // cross-plane plants are skipped (a grass sprite at 224+ blocks is under
  // ~5px at 1080p), leaves stop emitting their same-id interior planes (the
  // Phase 7 dense-canopy rule — invisible from that far), and — the real
  // saving — faces fronting pitch-dark air are culled: baked sky light 0
  // means enclosed underground, and the entire hidden cave network stops
  // emitting walls (water-covered floors, ravines and cave mouths keep
  // theirs; see chunks.js). Surface terrain, trees, water, structures and
  // player builds mesh identically at both tiers, so the boundary has
  // nothing visible to pop. HYSTERESIS keeps a chunk's tier sticky for 2
  // chunks of movement so walking along the boundary never remesh-thrashes.
  // Measured over the full ring (node, real generator + mesher):
  //   r=25 full detail  1961 meshed   4605 draws  10.00M tris   820 MB geometry
  //   r=25 with LOD     1961 meshed   4182 draws   5.58M tris   458 MB geometry
  //   r=30 full detail  2821 meshed   6634 draws  14.25M tris  1168 MB geometry
  //   r=30 with LOD     2821 meshed   5908 draws   6.87M tris   563 MB geometry
  //   r=40 full detail  5025 meshed  11963 draws  25.09M tris  2058 MB geometry
  //   r=40 with LOD     5025 meshed  10327 draws  10.22M tris   838 MB geometry
  // The shipped r=25 ring carries less than half the r=40 cost, and far
  // chunks stopped storing their 98KB light arrays on top (only
  // full-detail chunks keep them — see chunks.js).
  // Per-mesh frustum culling (three.js bounding spheres, precomputed at
  // build) then trims the drawn set to the lens — a 70° view draws roughly
  // a quarter of it.
  LOD: {
    DETAIL_CHUNKS: 14,    // full-detail radius (chunks) around the player
    HYSTERESIS: 3,        // extra chunks a promoted chunk keeps its tier
                          // (Phase 27: 2 -> 3 — walking along the boundary
                          // re-tiers fewer chunks per border crossing)
    RETIER_PER_PASS: 2,   // tier-change remeshes allowed per streaming pass
                          // (Phase 27): crossing a chunk border wants a
                          // whole arc of promotions at once, and letting
                          // them all compete for the frame budget was a
                          // visible hitch while moving — they trickle now,
                          // capped, while missing/dirty meshes keep full
                          // priority
  },
};

// Chunk streaming: how terrain loads in around the player without stutter.
// Chunk data generates in a square ring one chunk beyond the meshed circle so
// every meshed chunk has all 8 neighbours available for culling and AO.
export const STREAMING = {
  INITIAL_RADIUS: 3,      // chunks fully generated+meshed synchronously at boot
  FRAME_BUDGET_MS: 6,     // max main-thread ms per frame spent generating/meshing
                          // (Phase 27: 8 -> 6 — 8ms on top of the render left
                          // moving through unbuilt terrain visibly hitchy at
                          // 60fps; the ring fills a touch slower instead)
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

  // GREAT CAVERNS (Phase 23) — the real answer to "every cave is a narrow
  // tunnel". Phases 15, 17 and 22 each tried to grow big rooms by thresholding
  // another 3D noise field (the old CAVES.MEGA); measured over a 256x256
  // region that pass carved 0.1% of the cells it was offered and produced
  // scattered fragments, never a room. This pass does not use a field at all:
  // caverns are PLACED. The world is tiled into REGION_SIZE squares, each of
  // which deterministically hosts at most one chamber at a hashed centre and
  // a hashed size, carved as a noise-warped superellipsoid — so the size,
  // the spacing and the rate are set here directly instead of being hoped for.
  //
  // Shape: |dx/rx|^2 + |dz/rz|^2 + |dy/ry|^POWER_Y < 1 + irregularity, where
  // the y exponent flattens floor and ceiling into a room rather than a
  // lens, and a low-frequency 3D field pushes the wall in and out so no two
  // chambers read the same. A SHELF noise leaves part of a mid-height slab
  // uncarved, which is what makes a chamber multi-level: ledges, drops and a
  // lower floor you can see down onto. Two hashed connector bores leave the
  // chamber near floor height and climb gently outward until they meet the
  // tunnel network.
  // Phase 25 raised the RATE, not the mechanism. Phase 23's chambers were
  // real and measured, but at one per 224-block region a chamber's mouth
  // covered ~3% of the cave band and a player could explore for a long time
  // without meeting one — which is exactly what the report said. The tiles
  // are 128 blocks now and nearly all of them host a chamber (one per ~136
  // blocks of travel, ~9% of all columns standing over one), and each
  // chamber sends out THREE connector bores instead of two, so the tunnel
  // network runs into a chamber far more often than it used to.
  GREAT_CAVERN: {
    REGION_SIZE: 128,        // world tiles this wide host at most one chamber
    CHANCE: 0.88,            // ...and do so this often — ~1 per 136 blocks
    MARGIN: 40,              // keep the centre this far inside its region so
                             // two neighbouring chambers can never overlap
                             // (max body reach is RADIUS_MAX * (1 + WARP) + 2
                             // = 38 blocks, which must stay <= MARGIN)
    MIN_Y: -50,              // above the lava-lake flood at -54
    MAX_Y: 24,               // and far below sea level (62)
    RADIUS_MIN: 18,          // horizontal radii -> a longest axis of 36..58
    RADIUS_MAX: 29,          // blocks; the wall warp spreads that either way
    RADIUS_ASPECT: 0.85,     // the shorter axis is at least this fraction of
                             // the longer one, which is what keeps even the
                             // narrow axis of the smallest chamber above 30
                             // (2 x 18 x 0.85) instead of slot-shaped
    HEIGHT_MIN: 20,          // full chamber height, floor to ceiling
    HEIGHT_MAX: 40,
    POWER_Y: 3.2,            // >2 flattens floor and ceiling (a room, not a lens)
    WARP: { SCALE_XZ: 1 / 34, SCALE_Y: 1 / 26, OCTAVES: 2, AMOUNT: 0.24 },
                             // wall wobble as a fraction of the radius
    SHELF: {
      CHANCE: 0.55,          // chance a chamber gets a mid-level shelf
      SCALE: 1 / 23,         // 2D noise frequency of the shelf's outline
      COVER: 0.05,           // noise threshold: higher = less of the floor
                             // survives as shelf (the field's median is ~0,
                             // so 0.05 keeps a little under half of the span)
      THICKNESS: 3,          // shelf slab thickness in blocks
      SPAN: 0.70,            // shelf reaches this fraction of the radii
      LEVEL_MIN: 0.30,       // shelf height as a fraction of the chamber,
      LEVEL_MAX: 0.55,       // measured up from the floor
    },
    CONNECTORS: {
      COUNT: 3,              // bores leaving each chamber (Phase 25: 2 -> 3,
                             // so a wandering tunnel meets one sooner)
      RADIUS: 2.2,           // bore radius (walkable)
      LENGTH_MIN: 40,        // ...run this far out to meet the tunnel net
      LENGTH_MAX: 90,
      RISE: 0.22,            // blocks climbed per block travelled
      WANDER: 0.35,          // radians of sine sway over the run
      FLOOR_OFFSET: 3,       // bore mouth this far above the chamber floor
    },
  },

  // Waterfall springs (Phase 15; Phase 23 re-anchored them to the great
  // caverns now that those are real): water columns pouring down a cavern
  // wall into a small floor pool. Water flows now (world/fluids.js settles
  // it), but the generated column keeps the fall solid from the first frame.
  // Deterministic per chunk, writes only inside the owning chunk.
  WATERFALL: {
    ATTEMPTS_PER_CHUNK: 2,   // spring-column candidates per chunk
    CHANCE: 0.3,             // chance an eligible candidate actually springs
    MIN_Y: -40,              // springs sit in the upper cavern walls
    MAX_Y: 24,
    MIN_DROP: 5,             // needs at least this much open air below
    MAX_FALL: 32,            // column length cap
  },

  // Underground water (Phase 23): springs and puddles anywhere in the cave
  // band, not only inside a great cavern — vanilla's cave floors are damp.
  // A spring is a single source block leaking from a wall or ceiling; a pool
  // is a small flat sheet of water on a cave floor.
  SPRINGS: {
    ATTEMPTS_PER_CHUNK: 3,   // candidate cells per chunk
    SPRING_CHANCE: 0.22,     // ...that become a single-block wall spring
    POOL_CHANCE: 0.16,       // ...or the seed of a floor pool
    POOL_MAX_CELLS: 14,      // flood cap — a puddle, never a lake
    MIN_Y: -50,
    MAX_Y: 45,
  },

  // Lava placement in carved space (Phase 10; rewritten in Phase 23 — the
  // Phase 10 rule flooded EVERY cave floor cell inside a pool-mask region
  // over the whole band, which is why lava lakes kept showing up 40 blocks
  // above where they belong: measured over 256x256, 3040 lava cells sat
  // above y=-54, in sheets):
  //   - full lava lakes only at/below LAKE_MAX_Y (all carved cells flood)
  //   - above it, lava is PLACED, never masked: a few seeded sites per chunk,
  //     each flooding at most POOL_MAX_CELLS of connected flat floor, plus
  //     rare single-block wall springs. Both get rarer with height.
  LAVA: {
    LAKE_MAX_Y: -54,         // vanilla-style lava-flood level
    // Phase 24: pools above the lakes only generate as CLOSED BASINS now
    // (caves.js _floodContainedPool) — the Phase 23 pools passed a static
    // census but the fluid settle scan grew every open-rimmed one into a
    // flow apron up to 9 cells across, which is what "large lava bodies at
    // Y-13" were. Containment rejects most candidate floors, so the attempt
    // count rises to keep small pools existing at all.
    POOL_ATTEMPTS_PER_CHUNK: 3, // candidate pool sites per chunk...
    POOL_CHANCE: 0.35,       // ...each this likely to actually be one
    POOL_MAX_CELLS: 8,       // "small isolated pools of a few blocks"
    POOL_MAX_Y: -12,         // no pools at all above this — the shallow caves
                             // stay dry apart from the odd wall spring
    SPRING_CHANCE: 0.0002,   // per carved wall-adjacent cell above the lakes
                             // (Phase 24 halved it — every spring's fall
                             // spreads a small flow apron where it lands)
    SPRING_MAX_Y: 8,         // ...and none above this
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

  // Deepslate (Phase 23): below TOP_Y the terrain's stone fill becomes
  // deepslate. The change is not a line — through the band from TOP_Y down to
  // FULL_Y each stone block independently rolls deepslate with a probability
  // that rises from 0 to 1 with depth, so the two interleave in a speckled
  // transition exactly like vanilla's. At/below FULL_Y everything is
  // deepslate. Ore veins landing in it take their deepslate variant.
  DEEPSLATE: { TOP_Y: 0, FULL_Y: -8 },

  // Gravel and clay banks on cave floors beside underground water (Phase 23):
  // a floor cell within REACH of a water cell may turn to gravel or clay,
  // spreading over a small patch so the result reads as a bank, not confetti.
  SHORE_PATCHES: {
    REACH: 2,                // blocks from water a floor cell may convert
    CLAY_CHANCE: 0.45,       // of converted cells, this fraction is clay...
    CHANCE: 0.55,            // ...and this fraction of eligible cells convert
    DEPTH: 2,                // how deep below the floor surface it goes
  },
};

// Overworld heightmap, biomes and decoration (world/terrain.js).
// Noise scales are in cycles per block (1/blocks-per-feature).
export const TERRAIN = {
  // The seed's history: 1337 (original) -> 2163 (Phase 25, an even spawn
  // area under those weights) -> 3200 (the Phase 25 follow-up's hand-picked
  // plains spawn — its quoted percentages were measured under the PHASE 25
  // biome weights and no longer hold). As of Phase 26 the seed no longer
  // determines the spawn at all: SPAWN_SCAN below finds the nearest large
  // open plains area for ANY seed (for 3200 that is column (-96, 160) at
  // y69), so the seed is just the world's identity again.
  SEED: 3200,

  // Phase 26 — the GUARANTEED plains spawn (world/spawn_scan.js). Instead of
  // hand-picking seeds and hoping, the generator SCANS for the nearest large
  // open plains area and spawns the player in the middle of it: candidate
  // centres spiral out from the origin on a coarse grid, each scored over a
  // sampled disc — fraction of plains-dominant columns, fraction underwater,
  // height relief — and the first candidate meeting every threshold wins.
  // If none does within MAX_RADIUS (no seed under the current biome weights
  // gets anywhere near that), the best-scoring candidate stands, so the scan
  // ALWAYS returns a column. Pure in (seed), cached per generator — the eyes
  // of ender and the stronghold anchor read the same result.
  SPAWN_SCAN: {
    CAND_STEP: 16,             // candidate-centre grid spacing (blocks)
    MAX_RADIUS: 3072,          // give up spiralling out past this (fallback:
                               // best candidate seen — the guarantee)
    AREA_RADIUS: 56,           // the disc each candidate is scored over —
                               // "the middle of a LARGE open plains area"
    SAMPLE_STEP: 8,            // disc sampling grid (blocks)
    MIN_PLAINS: 0.94,          // fraction of disc samples that must be
                               // plains-dominant land
    MAX_WATER: 0.0,            // fraction of disc samples allowed underwater
                               // (0 — not on a coastline, not beside a lake)
    MAX_RELIEF: 9,             // max height spread across the disc (open and
                               // level, not a hillside)
    MAX_HEIGHT_ABOVE_SEA: 26,  // centre column must sit in the lowland band
  },

  // Extra columns computed around a chunk during generation so trees whose
  // canopy crosses a chunk border come out identical from both sides
  // (canopy radius 2 + 1 for the tree spacing check).
  GEN_MARGIN: 3,

  // Very low frequency landmass swell around sea level. Where it dips
  // negative the terrain drops below sea level and oceans/lakes form.
  // Follow-up: OFFSET 1 -> 2.5 ("oceans shouldn't be that common") lifts
  // the whole swell so fewer of its dips reach under sea level — water fell
  // from 25% of all columns to 9%, and what remains reads as lakes and seas
  // rather than a world that is a quarter ocean. Rivers are carved DOWN
  // through the lift, so they are untouched.
  CONTINENT: { SCALE: 1 / 1100, OCTAVES: 2, AMPLITUDE: 11, OFFSET: 2.5 },

  // Safety floor: the surface never generates closer than this to the
  // bottom of the world, whatever the noise does.
  MIN_HEIGHT_ABOVE_BOTTOM: 8,

  // Rolling hill detail shared by all biomes (amplitude set per biome).
  HILLS: { SCALE: 1 / 160, OCTAVES: 4, PERSISTENCE: 0.5, LACUNARITY: 2 },

  // Climate fields drive biome weights. Both are fBm in [-1, 1].
  // Phase 25 raised both frequencies (1/480, 1/420 -> 1/360, 1/320): biome
  // patches used to be so large that a whole play session could happen
  // inside one of them, which is what "plains are rare" actually meant —
  // globally plains were the commonest biome, but you never walked to one.
  // At these scales a walk of a few hundred blocks crosses several.
  CLIMATE: {
    TEMPERATURE_SCALE: 1 / 360,
    MOISTURE_SCALE: 1 / 320,
    OCTAVES: 3,
  },

  // Mountains come from their own region mask, not climate, so ranges read
  // as coherent chains. Ridged noise supplies the relief inside a region.
  MOUNTAINS: {
    REGION_SCALE: 1 / 560,
    REGION_OCTAVES: 2,
    // Phase 25: 0.12 -> 0.25 (mountains took a quarter of all land).
    // Phase 26: 0.25 -> 0.30 — plains must be the clear majority biome, so
    // mountains hand back another slice while still forming coherent ranges.
    WEIGHT_START: 0.30,        // region noise where mountains begin to blend in
    WEIGHT_FULL: 0.60,         // region noise where mountains fully dominate
    RIDGE_SCALE: 1 / 260,
    RIDGE_OCTAVES: 3,
    RIDGE_SHARPNESS: 2.2,      // exponent on the ridge profile; higher = sharper crests
    BASE_LIFT: 14,             // flat height bonus inside a mountain region
    RIDGE_AMPLITUDE: 58,       // ridge height on top of the lift (hills ~100, peaks ~140)
  },

  // Per-biome height contribution (OFFSET above the continent base plus
  // hill noise * HILL_AMPLITUDE) and tree density (trees per column).
  // Phase 26 ("plains should be the most common biome, with forest, desert
  // and mountains appearing less often"): plains is the DEFAULT biome now —
  // BASE_WEIGHT 0.25 -> 0.55, the forest moisture gate needs genuinely wet
  // air (0.02 -> 0.10) and desert genuinely hot air (-0.06 -> 0.02), and
  // mountains give up a slice of land below. Measured over 2000x2000 of
  // land: plains 55.7% / forest 17.8% / desert 10.8% / mountains 15.6% —
  // a clear plains majority with all four biomes keeping real presence.
  BIOMES: {
    PLAINS: { BASE_WEIGHT: 0.55, OFFSET: 3, HILL_AMPLITUDE: 4, TREE_DENSITY: 0.005 },
    FOREST: {
      OFFSET: 4, HILL_AMPLITUDE: 6, TREE_DENSITY: 0.08,
      MOISTURE_START: 0.10,    // moisture where forest starts blending in
      MOISTURE_FULL: 0.46,     // moisture where forest weight saturates
    },
    DESERT: {
      OFFSET: 2, HILL_AMPLITUDE: 3.5,
      HEAT_START: 0.02,        // temperature where desert starts blending in
      HEAT_FULL: 0.36,
      DRY_START: -0.32,        // below this moisture the air is fully dry
      DRY_FULL: 0.30,          // above this moisture desert weight is zero
    },
    MOUNTAINS: { TREE_DENSITY: 0.003 },
  },

  // When the top two biome weights are within this range the surface block
  // is hash-dithered between them, so borders feather instead of hard-edging.
  // Phase 24 widened it 0.2 -> 0.35: the transition zone spans more columns.
  BIOME_DITHER_RANGE: 0.35,
  // ...except at DESERT edges (follow-up: "too many grass blocks in
  // deserts"). The wide dither speckled grass columns deep into desert-
  // dominant ground and sand into the grass beside it — a broad salt-and-
  // pepper fringe that read as grass IN the desert. When either of the top
  // two biomes is desert the dither band is this much narrower: the edge
  // still feathers over a couple of columns, but a desert is sand.
  // Measured over desert-dominant columns: grass fell to 1.9% (nearly all
  // of it on the outermost fringe where desert barely wins).
  BIOME_DITHER_DESERT_RANGE: 0.08,

  // Phase 24 — domain warp on the biome fields: the climate and mountain
  // region noises are sampled at coordinates pushed around by two
  // low-frequency fields, so every biome boundary wanders irregularly
  // instead of following the smooth contours of the raw noise.
  BIOME_WARP: {
    SCALE: 1 / 210,            // warp field frequency
    OCTAVES: 2,
    AMPLITUDE: 34,             // blocks of push at full field strength
    // Phase 25 — MOISTURE gets its OWN warp pair, on its own frequency,
    // instead of sharing the temperature/mountain warp. Sharing one warp
    // made the three biome axes bend together, so their boundaries lined up
    // and a region tended to be one biome's; with independent warps the wet
    // edge, the hot edge and the mountain edge cut across each other and a
    // walk meets a mixture. (It is also the honest answer to the "forest
    // hugs the coastline" report — see PROGRESS: the generator has no
    // forest/coast link to remove, measured, but coupled warps DID make
    // whatever biome owned a stretch of coast own all of it.)
    MOISTURE_SCALE: 1 / 155,
    MOISTURE_AMPLITUDE: 46,
  },

  // Phase 24 — rivers. The zero-contours of one low-frequency field supply
  // long continuous winding paths (the ravine-line mechanism at landscape
  // scale). Where |field| < WIDTH the terrain is pressed down below sea
  // level with a smooth bank profile, and the normal sea-level fill puts
  // water in the channel — so rivers automatically join any lake or ocean
  // their contour crosses, because a contour of a continuous field can only
  // end by looping or by running into terrain that is already underwater.
  RIVERS: {
    LINE_SCALE: 1 / 620,       // path frequency — bends over hundreds of blocks
    LINE_OCTAVES: 3,           // extra octaves wiggle the banks locally
    WIDTH: 0.028,              // |field| half-width of the channel
    WIDTH_VARIATION: 0.45,     // ±fraction of WIDTH from a second field, so
                               // rivers swell and narrow along their run
    WIDTH_VAR_SCALE: 1 / 150,
    DEPTH: 4,                  // channel floor below sea level at the centre
    BANK_HEIGHT: 1,            // bank lip height above sea at the channel edge
    SHORE_BLEND: 0.35,         // outer fraction of the half-width over which
                               // the banks ease back into the terrain
  },

  SURFACE: {
    DIRT_DEPTH: 3,             // dirt under grass
    SAND_DEPTH: 4,             // sand at the desert surface
    SANDSTONE_DEPTH: 3,        // sandstone under desert sand

    // Phase 24 — beaches are no longer "any column at sea level". Sand needs
    // actual water nearby: a column this close to sea level turns to sand
    // only when a column within REACH is underwater. Everything else keeps
    // its biome surface, so a plain that happens to sit at y 62 stays grass.
    BEACH: {
      MAX_ABOVE_SEA: 2,        // sand up to this height above sea level...
      REACH: 4,                // ...within this many blocks of open water
    },
    // Underwater floors: sand in the shallows, dirt with gravel patches
    // deeper down (riverbeds sit in the shallow band, so they get the
    // sand/gravel mix the brief asks for).
    UNDERWATER_SAND_DEPTH: 4,  // floor within this depth of sea level is sandy
    // Gravel patches on beaches and riverbeds: a low-frequency field picks
    // patch regions, a per-column hash roughens their edges.
    GRAVEL: {
      SCALE: 1 / 23,           // patch size — a few blocks across
      THRESHOLD: 0.34,         // field value where a patch begins
      EDGE_JITTER: 0.25,       // hash dither across the patch edge
    },

    // Phase 24 — the mountain surface rule. Bare stone only above a noisy
    // height line (a "stone line" like vanilla's snow line — never one fixed
    // height) or on faces too steep for grass to sit. Everything below and
    // gentler is grassed like the rest of the world.
    // Phase 25: the Phase 24 line at 108 was still low enough to strip a
    // third of every mountain (measured: 60% grass / 38% stone, and 34 of
    // those 38 points came from the LINE, not from steepness). Peaks reach
    // ~140, so a line at 128 leaves the top dozen blocks bare and grasses
    // the rest, and STEEP_DROP 3 -> 4 stops ordinary ridged relief from
    // counting as a cliff. Measured after: 91% grass / 7.6% stone.
    STONE_LINE: {
      HEIGHT: 128,             // mean height where slopes turn to bare stone
      JITTER: 7,               // ± blocks of noise on that line
      SCALE: 1 / 70,           // jitter field frequency
    },
    STEEP_DROP: 4,             // a column this many blocks above its lowest
                               // 4-neighbour is a cliff face — bare stone at
                               // any height (grass could not sit on it)
  },

  TREES: {
    TRUNK_MIN: 4,              // trunk height range (inclusive)
    TRUNK_MAX: 6,
    WIDE_LAYERS: 3,            // 5x5 canopy layers below the 3x3 cap (Phase 11
                               // raised 2 -> 3: canopies read as a dense mass,
                               // sky rarely visible through the middle)
    CORNER_CHANCE: 0.5,        // chance each 5x5 layer corner keeps its leaf
                               // block (vanilla clips corners randomly)
    // Phase 24 — density and height vary WITHIN a biome. The biome density
    // is multiplied by a low-frequency field mapped to [MIN, MAX], so forest
    // has glades and thickets instead of uniform spacing, and a second field
    // biases trunk height so groves of taller trees appear together.
    DENSITY_FIELD: {
      SCALE: 1 / 130,          // clearings/thickets a couple hundred blocks wide
      MIN: 0.15,               // density multiplier at the field's low end...
      MAX: 1.85,               // ...and its high end (mean stays ~1)
    },
    HEIGHT_FIELD: {
      SCALE: 1 / 90,
      BIAS: 2.2,               // + blocks of trunk at the field's high end
    },
  },

  CACTUS: {
    DENSITY: 0.015,            // per desert sand column
    MIN_HEIGHT: 1,
    MAX_HEIGHT: 3,
  },

  // Phase 24 — ground vegetation: cross-plane plants scattered on the
  // surface. Short grass comes in noise-driven patches of varying density;
  // flowers are rarer and cluster (a threshold field gates WHERE they can
  // appear, a hash picks the columns inside it); dead bushes speckle the
  // desert. Densities are per eligible column.
  PLANTS: {
    GRASS_FIELD_SCALE: 1 / 45, // patch size of the grass density field
    // Peak per-column short-grass chance per biome (the field scales it 0..1)
    GRASS_DENSITY: { plains: 0.60, forest: 0.45, mountains: 0.18, desert: 0 },
    FLOWER_FIELD_SCALE: 1 / 65,
    FLOWER_FIELD_MIN: 0.30,    // field value where flower clusters begin
    FLOWER_CHANCE: 0.075,      // per-column chance inside a cluster
    DEAD_BUSH_CHANCE: 0.012,   // per desert sand column
    // (the seed drop chance is per-block data — it lives in short grass's
    // drop table in world/plants.js, like every other drop roll)
  },

  // Phase 24 — occasional small surface lava pools in mountains and deserts.
  // One hashed candidate per region tile; the pool digs a closed basin into
  // gently-sloped ground (the rim stays above the lava, so the fluid settle
  // pass never spreads it) and fills the floor with lava sources.
  SURFACE_LAVA: {
    REGION_SIZE: 112,          // one candidate per region tile this wide
    CHANCE: 0.22,              // ...that actually hosts a pool
    RADIUS_MIN: 2,             // pool radius range in blocks
    RADIUS_MAX: 3,
    MAX_RELIEF: 3,             // skip ground that varies more than this over
                               // the footprint — pools want a flat shelf
    MIN_HEIGHT_ABOVE_SEA: 4,   // never near beaches or river banks
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

  // Climbing (Phase 21 — ladders). Vanilla: while the body overlaps a
  // climbable block, holding forward INTO it (or holding jump) drives the
  // player up at a fixed rate, releasing lets them slide down slowly, and
  // sneaking pins them in place. Fall distance resets while climbing.
  CLIMB_MARGIN: 0.35,           // horizontal reach that still counts as being
                                // ON a ladder (vanilla is generous here)
  CLIMB_SPEED: 2.35,            // blocks/s upward (vanilla ladder speed)
  CLIMB_DOWN_SPEED: 3.0,        // blocks/s sliding down when not climbing
  CLIMB_HOLD_SPEED: 0,          // sneaking on a ladder holds position
  CLIMB_HORIZONTAL_FACTOR: 0.4, // horizontal movement damping while climbing

  // Safe spawn: nearest dry, clear surface column to this point
  SPAWN: { X: 8, Z: 8, SEARCH_RADIUS: 48 },
};

// ---------------------------------------------------------------------------
// Beds (Phase 21) — right-click to set the spawn point; sleeping at night
// with nothing hostile nearby skips to morning.
// ---------------------------------------------------------------------------

export const BEDS = {
  NIGHT_START: 0.5,               // timeOfDay window in which sleeping works
  NIGHT_END: 1.0,                 // (0 sunrise, 0.25 noon, 0.5 sunset)
  WAKE_TIME_OF_DAY: 0.0,          // sleeping fast-forwards to dawn
  MONSTER_RADIUS: 8,              // hostiles within this block sleeping (vanilla)
  SLEEP_SECONDS: 1.2,             // the fade while the night passes
  USE_RANGE: 3,                   // must be standing this close to use it
};

// ---------------------------------------------------------------------------
// Shields (Phase 21) — right-click raises; a raised shield blocks melee and
// projectile damage arriving from the front.
// ---------------------------------------------------------------------------

export const SHIELD = {
  RAISE_SECONDS: 0.25,            // vanilla delay before the guard counts
  DURABILITY: 336,                // vanilla shield durability
  BLOCK_ARC_DOT: 0.0,             // attack direction vs facing: >0 = frontal
  DAMAGE_REDUCTION: 1.0,          // fully blocked (vanilla)
  WEAR_PER_BLOCK: 1,              // durability spent per blocked hit
  SLOWDOWN: 0.35,                 // movement multiplier while blocking
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
  ABSORPTION_PX: 18,            // HUD yellow absorption heart size (Phase 22)

  // Contact damage (cactus registers damagesOnContact; lava handled above)
  CACTUS_DAMAGE: 1,             // per contact tick (half a heart, vanilla)
  CACTUS_CONTACT_EXPAND: 0.1,   // body AABB inflation for cactus contact —
                                // generous enough to reach past the 1/16 inset

  // Drowning: once the breath meter is empty (vanilla 2 damage per second)
  DROWN_DAMAGE: 2,
  DROWN_TICK_SECONDS: 1.0,

  // The void (Phase 19 — the End's floor is open sky): falling below this
  // deals damage until death, like vanilla's void. Unreachable in the
  // overworld and Nether (bedrock floors); 16 blocks under the world
  // bottom, matching the mob/item void-despawn depth.
  VOID_DAMAGE_Y: -80,
  VOID_DAMAGE: 4,
  VOID_TICK_SECONDS: 0.5,

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
// falls when unsupported, and recedes when its feed is cut. Phase 21 put
// WATER on the same automaton (the reported "flow looks wrong and behaves
// inconsistently" bug): water spreads 7 with a faster tick, like vanilla,
// and both fluids now render at their own partial height per level.
// ---------------------------------------------------------------------------

export const FLUIDS = {
  LAVA_SPREAD_SECONDS: 1.5,     // one spread step (vanilla overworld lava tick)
  LAVA_RANGE: 3,                // horizontal spread distance from a source (SPEC)
  WATER_SPREAD_SECONDS: 0.25,   // water ticks 5x/second (vanilla ~5 ticks)
  WATER_RANGE: 7,               // vanilla water spreads 7 cells from a source
  // Rendered surface height per horizontal flow level, as a fraction of the
  // cell — each step visibly lower than the last. Sources render full cubes.
  // Lava's three levels stay exactly as Phase 12 shipped them; water's seven
  // step down from just under a full block to a thin film (vanilla's
  // 8/9..1/9 ladder, floored so the shallowest step still reads).
  FLOW_HEIGHTS: [0.75, 0.5, 0.25],
  WATER_FLOW_HEIGHTS: [7 / 8, 6 / 8, 5 / 8, 4 / 8, 3 / 8, 2 / 8, 1 / 8],
  FALL_HEIGHT: 1.0,             // falling columns fill their cell
  SCROLL_TILES_PER_SECOND: 0.35, // animated flowing-texture scroll rate
  WATER_SCROLL_TILES_PER_SECOND: 0.9, // water runs visibly faster than lava
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
  // Phase 21 — GOLD, the real Minecraft trade: the fastest mining speed of
  // any tier and only 33 durability. Its HARVEST level is wood's, though
  // (vanilla): a golden pickaxe cannot mine gold, redstone or diamond ore.
  gold:    { speedMultiplier: 12, durability: 33 },
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
  // Phase 21 — gold hits like wood (vanilla); hoes are not weapons.
  golden_sword: 4,
  golden_axe: 7,
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
    DRAG: 0.2,                    // 1/s velocity damping in flight —
                                  // Phase 20: 0.5 -> 0.2 (vanilla's ~1%/tick).
                                  // At 0.5 a full-draw arrow topped out ~38
                                  // blocks up, so NO pillar crystal was
                                  // shootable from the island and the whole
                                  // dragon fight economy collapsed into ten
                                  // tower climbs; at 0.2 the rise is ~65
                                  // (vanilla parity — the low crystals are
                                  // bow targets, the tallest still want a
                                  // climb). Skeleton shots fly slightly
                                  // flatter; verified still landing hits.
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

  // Ghast fireballs (Phase 16, systems/combat.js): straight-line exploding
  // projectiles, deflectable — a melee swing on one under the crosshair
  // reverses it along the player's look direction and makes it the
  // player's own projectile (it then hits mobs, famously the ghast).
  FIREBALL: {
    SIZE: 1.0,                    // rendered sprite edge / hitbox edge (blocks)
    DEFLECT_SPEED: 22,            // blocks/s after a melee deflection
    FLYING_DESPAWN_SECONDS: 20,   // silent removal for shots into the void
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
  // Nether wart crop shape (Phase 17): the vanilla crop model — four
  // DoubleSide planes in a # arrangement, two per horizontal axis, inset
  // PLANE_INSET from the cell edges. Younger stages render shorter, the
  // quad sampling the bottom band of the (fully grown) atlas tile.
  WART: {
    PLANE_INSET: 4 / 16,          // planes sit at 4/16 and 12/16 of the cell
    STAGE_HEIGHTS: [6 / 16, 10 / 16, 1], // quad height per growth stage 0..2
  },
  // Cross-plane plants (Phase 24): two DoubleSide quads in an X. The quad
  // width is fixed at 1 (endpoints sqrt(2)/4 in from the corners — vanilla's
  // rescale, so the art never stretches); OFFSET is the max per-axis nudge
  // off the cell centre from the per-position hash.
  PLANT: {
    OFFSET: 0.18,
  },
  // Brewing stand box model (Phase 19 — replaces the wrong full-cube
  // rendering): a stone base plate, a thin central rod sampling the tile's
  // rod column, and three flat arm panes radiating out, each showing the
  // tile's hanging-bottle art.
  BREWING_STAND: {
    BASE_HALF: 5 / 16,            // base plate half-extent (10px plate)
    BASE_HEIGHT: 2 / 16,          // base plate thickness
    ROD_HALF: 1 / 16,             // rod cross-section half (2px rod)
    ROD_TOP: 1,                   // rod reaches the cell top (14px over base)
    ARM_LENGTH: 7 / 16,           // arm pane reach from the rod outward
    ARM_TOP: 15 / 16,             // arm pane top edge
    ARM_ANGLES: [0, 2.35619449, 3.92699081], // arm yaws (0°, 135°, 225°)
  },
  // End portal frame (Phase 19): the vanilla 13/16-tall block, plus the
  // small raised eye box on a filled frame.
  END_FRAME: {
    HEIGHT: 13 / 16,              // frame box height (vanilla 0.8125)
    EYE_HALF: 2 / 16,             // eye box half-extent (4px square)
    EYE_UV: [6 / 16, 10 / 16],    // tile band the eye box samples (centre)
  },
  END_PORTAL_SURFACE_Y: 12 / 16,  // the portal sheet's height in its cell

  // -------------------------------------------------------------------------
  // Phase 21 — the building-block shapes. Every one of these is a list of
  // axis-aligned boxes in cell-local units, built by world/blocks.js into the
  // ONE `boxes` table that BOTH the collision sweep (player/controller.js,
  // entities/entity.js) and the mesher's generic shape emitter
  // (world/emitters.js) read. One source of truth: what you see is what you
  // walk into.
  // -------------------------------------------------------------------------

  SLAB_HEIGHT: 8 / 16,            // half a block (vanilla)
  STAIRS: {
    STEP_HEIGHT: 8 / 16,          // the lower slab's top
    STEP_DEPTH: 8 / 16,           // how far into the cell the upper step sits
  },
  FENCE: {
    POST_HALF: 2 / 16,            // 4px post through the cell centre
    ARM_HALF: 1.5 / 16,           // 3px connecting rails
    ARM_LOW: 6 / 16,              // lower rail band (bottom, top)
    ARM_LOW_TOP: 9 / 16,
    ARM_HIGH: 12 / 16,            // upper rail band
    ARM_HIGH_TOP: 15 / 16,
    HEIGHT: 1,                    // rendered height (vanilla posts are 1 cell)
    COLLISION_HEIGHT: 1.5,        // SPEC/vanilla: 1.5 tall so mobs can't jump it
  },
  WALL: {
    POST_HALF: 4 / 16,            // 8px post
    ARM_HALF: 3 / 16,             // 6px connecting sections
    ARM_TOP: 14 / 16,
    HEIGHT: 14 / 16,
    COLLISION_HEIGHT: 1.5,        // walls block mobs like fences do
  },
  GATE: {
    POST_HALF: 2 / 16,
    BOTTOM: 5 / 16,               // the gate panel sits above the ground gap
    TOP: 1,
    THICK_HALF: 2 / 16,           // panel thickness across the gate
    OPEN_SIDE: 7 / 16,            // open leaves swing to the cell edges
    COLLISION_HEIGHT: 1.5,
  },
  LADDER: {
    DEPTH: 3 / 16,                // how far the rungs stand off the wall
  },
  DOOR: {
    THICKNESS: 3 / 16,            // vanilla door slab thickness
  },
  TRAPDOOR: {
    THICKNESS: 3 / 16,
  },
  BED: {
    HEIGHT: 9 / 16,               // mattress top (vanilla)
  },
  SIGN: {
    POST_HALF: 1 / 16,            // standing sign's 2px post
    POST_TOP: 9 / 16,
    BOARD_BOTTOM: 9 / 16,         // board band on a standing sign
    BOARD_TOP: 1,
    BOARD_HALF: 6 / 16,           // board half-width
    BOARD_THICK: 1 / 16,          // board thickness (half-extent)
    WALL_BOTTOM: 4 / 16,          // wall sign board band
    WALL_TOP: 12 / 16,
    WALL_OFFSET: 2 / 16,          // stand-off from the wall it hangs on
    TEXT_LINES: 4,
    TEXT_MAX_CHARS: 15,
    TEXTURE_SIZE: 128,            // generated text canvas edge (px)
  },
  FLOWER_POT: {
    HALF: 3 / 16,                 // 6px pot
    HEIGHT: 6 / 16,
    PLANT_HALF: 4 / 16,           // the potted sapling's crossed quads
    PLANT_TOP: 14 / 16,
  },
  ITEM_FRAME: {
    DEPTH: 1.5 / 16,              // frame thickness off the wall
    HALF: 6 / 16,                 // frame half-width
    ITEM_SIZE: 0.42,              // rendered item edge inside the frame
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
// Brewing (systems/brewing.js — Phase 18: the brewing stand. The potion and
// ingredient tables are registries in that file and player/inventory.js,
// like smelting recipes; these are the global tunables.)
// ---------------------------------------------------------------------------

// Chest block entities (world/chests.js).
export const CHESTS = {
  SCAN_CHUNKS_PER_FRAME: 1,       // generated-chest discovery budget
                                  // (the spawner scan's pace)
};

export const BREWING = {
  BREW_SECONDS: 20,               // one brewing operation (vanilla 20s)
  BREWS_PER_FUEL: 20,             // operations one blaze powder fuels (vanilla)
};

// Potion effect strengths/durations (player/stats.js applies them on drink).
export const EFFECTS = {
  FIRE_RESISTANCE_SECONDS: 180,   // vanilla 3:00 — no fire or lava damage
  STRENGTH_SECONDS: 180,          // vanilla 3:00
  STRENGTH_BONUS_DAMAGE: 3,       // vanilla Strength I: +3 melee damage
  HEALING_AMOUNT: 4,              // vanilla Instant Health I: 2 hearts
  // The golden apple (Phase 22 bug fix): vanilla grants Absorption I for
  // 2:00 — 2 extra (yellow) hearts that soak damage before real health —
  // plus Regeneration II for 5 seconds.
  GOLDEN_APPLE: {
    ABSORPTION_HEALTH: 8,         // Absorption II: 8 points = 4 yellow hearts
    ABSORPTION_SECONDS: 120,      // 2:00
    REGENERATION_SECONDS: 5,      // Regeneration II, 5s
    REGENERATION_INTERVAL: 1.25,  // seconds per healed point (Regen II = 25 ticks)
  },
};

// ---------------------------------------------------------------------------
// Eyes of ender (entities/ender_eye.js — Phase 18: thrown eyes fly toward
// the stronghold, hover, then drop back as an item or shatter). The
// stronghold's deterministic location comes from dimensions/stronghold.js
// using PORTALS.STRONGHOLD_MIN/MAX_DISTANCE; the shatter roll is
// PORTALS.EYE_SHATTER_CHANCE (both SPEC numbers).
// ---------------------------------------------------------------------------

export const ENDER_EYE = {
  TRAVEL_BLOCKS: 16,              // the eye glides this far toward the target
  RISE_BLOCKS: 9,                 // ...climbing this high above the throw
  FLY_SECONDS: 2.2,               // glide duration (eased out)
  HOVER_SECONDS: 1.1,             // float at the signal point before resolving
  SPRITE_SIZE: 0.45,              // rendered slab edge (blocks)
  SPIN_RATE: 3.0,                 // rad/s idle spin
  BOB_HZ: 1.6,                    // hover bob rate
  BOB_BLOCKS: 0.12,               // hover bob amplitude
  SHATTER_FLASH_SECONDS: 0.35,    // the little burst when an eye breaks
  // Phase 22: a thrown eye draws THROUGH terrain (depth test off, drawn
  // last) — following its bearing is the whole point, so it must never
  // disappear behind the hill it is crossing.
  RENDER_ORDER: 900,
  TRAIL_PER_SECOND: 22,           // purple sparks left in its wake
  TRAIL_COLOR: 0x9ce8b0,          // the eye's own pale green-teal
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
  NETHER_HOSTILE_CAP: 10,         // Phase 19: the Nether spawns endermen
                                  // besides its ghasts ("endermen should be
                                  // common in the Nether" report), so its
                                  // cap outgrew GHAST.CAP
  NETHER_ENDERMAN_WEIGHT: 200,    // vs the ghast's 100 — two of three
                                  // Nether spawns are endermen (the pearl
                                  // farm the run needs)

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

  // Ghast (Phase 16 — the Nether's flying menace, SPEC: 10hp, explosion
  // damage, deflectable fireballs). Spawns only in the Nether (the
  // dimension def's spawn table), floats on a gravity-free wander,
  // and lobs slow exploding fireballs at a player it can see.
  GHAST: {
    CAP: 4,                       // its own hostile cap (14 ghasts is a wall
                                  // of fireballs; vanilla keeps them sparse)
    FLY_SPEED: 2.4,               // wander drift blocks/s
    VERTICAL_DRIFT: 0.5,          // vertical wander speed as a fraction
    WANDER_MIN_SECONDS: 2.5,      // one drift leg lasts this range
    WANDER_MAX_SECONDS: 6,
    PROBE_BLOCKS: 4,              // solid/lava within this below biases the
                                  // drift up; solid within it above, down
    ATTACK_RANGE: 40,             // shoots at a visible player inside this
    FIREBALL_COOLDOWN_SECONDS: 3, // between shots
    MOUTH_HEIGHT_FRACTION: 0.4,   // fireballs leave this far up the body
    FIREBALL: {
      SPEED: 11,                  // blocks/s — SPEC "slow fireballs"
      DAMAGE: 12,                 // explosion damage at the centre
      BLOCK_RADIUS: 1.6,          // crater radius (vanilla ghast power ~1 —
                                  // far smaller than a creeper's 3)
      MAX_BLAST_HARDNESS: 1.5,    // Phase 17: a ghast fireball breaks
                                  // netherrack (0.4) but not nether brick
                                  // (2.0) or cobble — the fortress survives
                                  // a ghast siege, the vanilla proportions
    },
  },

  // Blaze (Phase 17 — the fortress guardian; Phase 18 retuned to the real
  // Minecraft pacing after the "blazes kill almost instantly" report:
  // a volley of 3 fireballs in quick succession, then a clear ~5s cooldown
  // before the next, each fireball 5 damage on a direct hit plus a brief
  // burn — and a LONG, clearly visible wind-up (the rod rings spin up and
  // the body flares) so the player can take cover). Spawned by fortress
  // spawner blocks (world/spawners.js), never by the natural spawner.
  // Hovers on the flying entity model. Rod-ring geometry lives in
  // entities/models.js (BLAZE_RINGS); these are the behaviour tunables.
  BLAZE: {
    FLY_SPEED: 1.6,               // attack drift blocks/s
    IDLE_SPEED_FACTOR: 0.4,       // idle wander as a fraction of FLY_SPEED
    WANDER_MIN_SECONDS: 2,        // one idle drift leg lasts this range
    WANDER_MAX_SECONDS: 5,
    HOVER_MIN_BLOCKS: 1,          // rises when the floor is closer than this
    HOVER_MAX_BLOCKS: 3,          // sinks when it is farther than this
    HOVER_PROBE_BLOCKS: 6,        // how far down the floor probe looks
    ATTACK_RANGE: 16,             // engages a visible player inside this
    PREFERRED_RANGE: 9,           // approaches until inside this
    CLOSE_RANGE: 4,               // backs away when the player is closer
    ATTACK_HOVER_ABOVE: 1,        // floats this far above the player's eye
    VERTICAL_RESPONSE: 1.2,       // wishY per block of height error (clamped)
    CHARGE_SECONDS: 1.2,          // visible wind-up before a volley (the rod
                                  // rings spin up and the body flares — long
                                  // enough to read and duck behind cover)
    BURST_COUNT: 3,               // real Minecraft: volleys of 3
    BURST_INTERVAL_SECONDS: 0.3,  // gap between the volley's fireballs
    COOLDOWN_SECONDS: 5.0,        // rest after a volley (real Minecraft ~5s —
                                  // the window to close in or take cover)
    MOUTH_HEIGHT_FRACTION: 0.7,   // fireballs leave this far up the body
    INACCURACY: 0.6,              // blocks/s of random spread on each shot
    FIREBALL: {
      SPEED: 16,                  // fast and small, unlike the ghast's
      DAMAGE: 5,                  // real Minecraft: 5 on a direct hit...
      FIRE_SECONDS: 4,            // ...plus a brief burn (1 damage/s DoT)
      SIZE: 0.4,                  // rendered/hitbox edge (blocks)
      DAMAGE_RADIUS: 2,           // burst hurts only right at the impact
    },
    // Rod-ring animation: rad/s per ring (signs alternate the directions),
    // sped up while charging/bursting; rods bob gently on offset phases.
    // CHARGE_FLASH_HZ pulses the body toward hot orange during the wind-up
    // (the visible tell, on top of the ring spin-up).
    ROD_SPIN: [-5, 3.8, -5.8],
    ROD_SPIN_ATTACK_FACTOR: 2.2,
    ROD_BOB_PX: 1.2,
    ROD_BOB_HZ: 0.8,
    CHARGE_FLASH_HZ: 7,
  },

  // Enderman (Phase 18 — SPEC: 40hp, 7 damage, passive until the player
  // looks directly at its head, teleports, damaged by water, drops ender
  // pearls). Overworld night spawns (rare), and the End next phase.
  ENDERMAN: {
    STARE_RANGE: 40,              // a stare registers within this distance
    STARE_DOT_SLACK: 0.025,       // vanilla: seen when lookDir · dirTo >
                                  // 1 - SLACK/dist (tighter with distance)
    FORGET_RANGE: 48,             // calms down beyond this distance
    WANDER_SPEED_FACTOR: 0.35,    // idle amble as a fraction of chase speed
    WANDER_MIN_SECONDS: 2,        // one idle leg lasts this range
    WANDER_MAX_SECONDS: 5,
    IDLE_MIN_SECONDS: 2,          // pause between idle legs
    IDLE_MAX_SECONDS: 7,
    WATER_DAMAGE: 1,              // per tick while touching water (vanilla)
    WATER_TICK_SECONDS: 1.0,
    TELEPORT_RADIUS: 24,          // random blink offset range (hit / water)
    TELEPORT_ATTEMPTS: 16,        // candidate columns tried per blink
    TELEPORT_Y_RANGE: 8,          // vertical search span around the target y
    CHASE_TELEPORT_RANGE: 14,     // while angry and farther than this...
    CHASE_TELEPORT_SECONDS: 4,    // ...blink near the player about this often
    CHASE_ARRIVE_RADIUS: [3, 8],  // ...landing this far from them
    CREEPY_HEAD_RAISE_PX: 3,      // the head lifts while angry (the vanilla
                                  // "creepy" pose, sized for the tall rig)
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
// Blaze spawners (world/spawners.js) — Phase 17: the spawner blocks fortress
// blaze rooms generate. The cage block renders through the normal cutout
// pass (the SPAWNER atlas tile); this system owns the spinning miniature
// blaze inside and the spawning itself. A spawner only runs with a player
// nearby, spawns in open cells around itself, and stops while enough blazes
// already crowd it (vanilla shape, simplified).
// ---------------------------------------------------------------------------

export const SPAWNER = {
  ACTIVATE_RANGE: 16,             // runs only with the player inside this
  FIRST_DELAY_SECONDS: 2,         // a freshly discovered spawner fires fast
  DELAY_MIN_SECONDS: 8,           // then every roll in this range
  DELAY_MAX_SECONDS: 20,
  SPAWN_ATTEMPTS: 8,              // random cells tried per cycle
  MAX_SPAWNS_PER_CYCLE: 2,        // successful spawns per cycle cap
  SPAWN_RADIUS: 3.5,              // horizontal spawn offset range (blocks)
  SPAWN_Y_RANGE: 1,               // vertical spawn offset range (cells up)
  MAX_NEARBY: 6,                  // stops while this many blazes are within...
  NEARBY_RADIUS: 9,               // ...this range of the spawner
  SPIN_IDLE: 0.6,                 // display spin rad/s with no player near
  SPIN_ACTIVE: 6,                 // ...and while active (eased between)
  SPIN_RESPONSE: 2.5,             // 1/s ease between the spin rates
  MINI_SCALE: 0.4,                // the miniature blaze display's scale
  SCAN_CHUNKS_PER_FRAME: 1,       // generated-spawner discovery pace (the
                                  // fluids settle-scan pattern)
};

// ---------------------------------------------------------------------------
// Nether wart (world/wart.js) — Phase 17: grows on soul sand through three
// stages (block ids in world/blocks.js; the crop shape in SHAPES.WART).
// Fortress wart rooms generate it fully grown; harvesting a grown wart
// drops 2-4, replanting one on soul sand starts a new plant that this
// system grows on a timer.
// ---------------------------------------------------------------------------

export const WART = {
  GROW_MIN_SECONDS: 50,           // one stage advances after a roll in this
  GROW_MAX_SECONDS: 110,          // range (two stages to full growth)
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
// Game modes (Phase 25) — SURVIVAL is the whole game as SPEC.md describes it;
// CREATIVE removes the survival pressure and hands the player everything.
// The mode itself lives in player/gamemode.js (a module singleton, the
// particles/audio pattern); these are its tunables.
// ---------------------------------------------------------------------------

export const CREATIVE = {
  // Flight. Vanilla creative flies at ~10.9 blocks/s — about 2.5x walking —
  // and doubles that while sprinting. Rise/descend are their own rate.
  FLY_SPEED: 10.9,               // horizontal blocks/s
  FLY_SPRINT_MULTIPLIER: 2.0,    // ...times this while sprinting
  FLY_VERTICAL_SPEED: 7.5,       // blocks/s holding space (up) / shift (down)
  FLY_RESPONSE: 14,              // 1/s exponential approach to the wanted
                                 // velocity — the flight has weight, but the
                                 // ramp is short enough to feel immediate
  FLY_DRAG: 9,                   // 1/s damping with no input (a gentle glide)
  DOUBLE_TAP_SECONDS: 0.35,      // second space tap within this toggles flight
  // Vanilla creative flight still COLLIDES with terrain — it is flight, not
  // spectator noclip — so the body sweeps exactly as it does on foot. Set
  // false for a fly-through-walls camera instead.
  FLY_COLLIDES: true,
  // Leaving the ground with flight off never accrues fall distance in
  // creative anyway (the player cannot be damaged), but the flag keeps the
  // landing particles/sounds honest: a creative landing is silent-ish.
  LAND_EFFECTS: false,
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

  // The boss bar (Phase 21; Phase 22 made it MAGENTA and unmissable):
  // Minecraft's boss bar across the top centre of the screen while the
  // Ender Dragon lives, captioned above and depleting as it takes damage.
  BOSS_BAR: {
    WIDTH_PX: 380,                // bar width (vanilla is 182 art px at 2x)
    HEIGHT_PX: 12,                // the bar itself
    TOP_PX: 14,                   // offset from the top screen edge
    LABEL_PX: 16,                 // caption font size
    EASE_RATE: 6,                 // 1/s easing of the depleting fill
    LABEL: 'Ender Dragon',        // the caption above the bar
    // Vanilla's BossBar.Color.PINK reads as magenta on screen.
    FILL_TOP: '#ff8bf0',          // gradient: lit top edge...
    FILL_MID: '#f217c8',          // ...the magenta body...
    FILL_BOTTOM: '#a1067f',       // ...and the shaded bottom
    TRACK: '#2a0a24',             // the empty track behind the fill
  },

  // Active potion effects, top-right (Phase 18; Phase 22 shrank them to
  // vanilla's proportions — a small icon with the countdown BENEATH it,
  // not a captioned panel that intrudes on the view).
  EFFECTS_HUD: {
    // Phase 23 bug fix: doubled in both dimensions — at 24px the icon was a
    // smudge and the countdown under it was unreadable at 1080p.
    ICON_PX: 48,                  // the framed icon square
    ART_PX: 36,                   // the item sprite inside it
    LABEL_PX: 20,                 // countdown font size
    GAP_PX: 8,                    // space between two effects
    TOP_PX: 8,                    // offset from the top screen edge
    RIGHT_PX: 8,                  // ...and the right edge
  },

  // The sleep fade (Phase 21 — beds): a full-screen wash while night passes.
  SLEEP_FADE_COLOR: '#05050c',

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

  // The game-mode badge (Phase 25): the current mode, small and dim, in the
  // bottom-right corner where nothing else draws — unobtrusive, but always
  // answerable without opening a menu.
  MODE_BADGE: {
    BOTTOM_PX: 8,
    RIGHT_PX: 10,
    FONT_PX: 13,
    OPACITY: 0.55,
  },

  // The creative inventory screen (Phase 25, ui/creative.js): a tabbed grid
  // of every block and item in the game with a search field.
  CREATIVE_SCREEN: {
    COLUMNS: 9,                   // items per row...
    ROWS: 6,                      // ...and rows per page (54 visible)
    SLOT_PX: 46,                  // matches the survival screen's slots
    TAB_PX: 40,                   // tab button height
    SEARCH_PX: 15,                // search field font size
  },
};

// ---------------------------------------------------------------------------
// Chat / commands (ui/chat.js — Phase 27). T opens the chat bar, '/' opens
// it with the slash already typed (vanilla). The game KEEPS RUNNING while
// chat is open (the sign-entry rule — pointer lock releases, nothing
// pauses); Enter submits, Escape cancels, either way the pointer relocks.
// Commands are parsed in main.js; /tp is the one that ships.
// ---------------------------------------------------------------------------

export const CHAT = {
  OPEN_KEY: 'KeyT',        // opens the chat bar
  COMMAND_KEY: 'Slash',    // opens it with '/' already typed (vanilla)
  MAX_LENGTH: 96,          // input length cap
  HISTORY: 16,             // submitted lines ArrowUp/ArrowDown recall
  WIDTH_PX: 440,           // bar width
  FONT_PX: 15,             // input font size
  BOTTOM_PX: 88,           // above the hotbar, vanilla's chat spot
  LEFT_PX: 12,
  TELEPORT_LIMIT: 100000,  // /tp clamps |x| and |z| to this — far enough
                           // for anything sane, small enough that a typo
                           // can't strand the player at float-breaking
                           // coordinates
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
    // Raised shield (Phase 21): the hand swings in front of the view and
    // turns its face toward the camera — the vanilla guard.
    SHIELD_OFFSET: [-0.16, 0.12, 0.18],
    SHIELD_YAW: 0.9,                 // radians the guard turns inward
    SHIELD_ENGAGE_RATE: 10,          // 1/s ease into/out of the guard
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
  DAY_LENGTH_SECONDS: 1200,       // full day/night cycle: exactly 20 minutes,
                                  // split half and half by request — 10
                                  // minutes of day, 10 of night, with quick
                                  // 30-second dusk/dawn washes at the
                                  // night's edges (DAY_NIGHT.KEYFRAMES)
  START_TIME: 0.04,               // day fraction at boot (just after sunrise);
                                  // t=0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
};

export const LIGHTING = {
  MAX_LIGHT: 15,                  // light levels 0-15
  TORCH_LIGHT: 14,
  GLOWSTONE_LIGHT: 15,
  // Per-face brightness multipliers (the Minecraft look)
  FACE_BRIGHTNESS: { top: 1.0, side: 0.8, bottom: 0.5 },
  AO_STRENGTH: 0.40,              // ambient occlusion darkening at corners
                                  // (Phase 26: 0.45 -> 0.40 — softer corner
                                  // shadows, paired with VISUAL.SHADOW's
                                  // warm bounce and cool lean)
  // Brightness multiplier per missing light level: level L renders at
  // LIGHT_FALLOFF^(15-L), so level 0 bottoms out near-black, not pure black.
  LIGHT_FALLOFF: 0.8,
  TORCH_TINT: 0xffd2a0,           // warm tint on block-light (torches, glowstone)
  NIGHT_SKY_TINT: 0xa9bef2,       // cool moonlight tint on skylight at night
                                  // (Phase 27 follow-up: brightened toward
                                  // silver — moonlit ground should READ)
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
  // Fog is matched to the horizon colour so terrain fades into the sky.
  // Retuned with the "far places look low quality" report: the old rule
  // scaled NEAR/FAR with the render distance at the same fractions, which
  // at 480 blocks meant everything past mid-distance sat in a milky wash.
  // Now that the atlas has its tile-local mip chain (distant terrain is
  // clean colour, not noise, so it can BEAR being seen), the fog's only
  // remaining job is masking the chunk edge: clear to 340 blocks (~70% of
  // the view), fading over the last stretch so the 480-block edge sits at
  // ~80% haze and pop-in stays invisible.
  FOG_COLOR: 0xbcd8f5,
  // Scaled with the view at the same fractions every retune (480 -> 640 ->
  // the final 400): clear to ~72% of the view, the ring edge sitting at
  // ~80% haze so pop-in stays invisible.
  FOG_NEAR: 288,
  FOG_FAR: 425,
  // Phase 26 (the golden-hour reference): ATMOSPHERIC HAZE. The keyframes
  // below carry a HAZE channel (0 = the clear midday fog above, 1 = these
  // heavy bounds) and the cycle lerps fog.near/far between them every
  // frame — so a low sun drowns distant terrain in warm haze while midday
  // keeps the Phase 25 clarity ("don't make the far places blurry" holds
  // where it was asked for: full day).
  HAZE_NEAR: 40,
  HAZE_FAR: 430,
};

// Day/night cycle keyframes, piecewise-linearly interpolated (wrapping) over
// the day fraction t in [0,1): t=0 sunrise, 0.25 noon, 0.5 sunset, 0.75
// midnight. Colours are the sky gradient stops; fog always uses HORIZON so
// terrain fades into the sky at every point of the cycle.
//   SUN_LEVEL   scales the directional sun + hemisphere ambient (entities)
//   SKY_DARKEN  levels subtracted from baked skylight (0 day .. 11 deep night)
//   GLOW        strength of the warm horizon glow around the sun's position
// Retimed by request to a TRUE half-and-half day: over the 20-minute cycle
// the sun is above the horizon for exactly 10 minutes (t 0.0-0.5 — it rises
// at t=0 and sets at t=0.5 by the orbit maths) and below it for exactly 10
// (t 0.5-1.0). The dusk and dawn ramps are quick 30-second washes sitting
// just inside the night's edges (0.5-0.525 and 0.975-1.0), so full darkness
// holds for 9 of the night's 10 minutes. (The previous timing was vanilla's:
// 1.5-minute transitions and only 7 minutes of full night.)
// Phase 24 added two channels: STARS (starfield alpha, fading in through
// dusk and out through dawn) and TINT (the skylight tint uniform — white at
// midday, warm at dawn/dusk, cool at night — which is what keeps the LIGHT
// on the terrain in agreement with the sky it stands under).
// Phase 26 (the golden-hour reference image): the day gains a GOLDEN HOUR at
// each end — while the sun is low the sky runs a purple-to-gold gradient
// (periwinkle zenith through violet-pink to a gold horizon), terrain light
// warms, and the new HAZE channel (0 clear .. 1 = SKY.HAZE_NEAR/FAR) drowns
// distant terrain in warm atmosphere. Full blue day still holds the middle
// (t 0.05-0.45), the sun is still above the horizon for exactly t 0-0.5,
// and full darkness still holds 0.525-0.975 — the Phase 25 half-and-half
// clock is untouched; only the look at the day's edges changed.
export const DAY_NIGHT = {
  KEYFRAMES: [
    // Dawn golden hour: the sun rises into purple-gold and clears by 0.05.
    { T: 0.000, ZENITH: 0x7a74c2, MID: 0xc9a0c8, HORIZON: 0xffc06a,
      BELOW: 0xb08a68, SUN_LEVEL: 0.8, SKY_DARKEN: 1, GLOW: 1.0,
      STARS: 0, TINT: 0xffd2a4, HAZE: 0.85 },
    { T: 0.050, ZENITH: SKY.ZENITH_COLOR, MID: SKY.MID_COLOR, HORIZON: SKY.HORIZON_COLOR,
      BELOW: SKY.BELOW_COLOR, SUN_LEVEL: 1.0, SKY_DARKEN: 0, GLOW: 0,
      STARS: 0, TINT: 0xffffff, HAZE: 0.15 },
    // The full blue day (the Phase 25 clarity request holds here: HAZE low).
    { T: 0.450, ZENITH: SKY.ZENITH_COLOR, MID: SKY.MID_COLOR, HORIZON: SKY.HORIZON_COLOR,
      BELOW: SKY.BELOW_COLOR, SUN_LEVEL: 1.0, SKY_DARKEN: 0, GLOW: 0,
      STARS: 0, TINT: 0xffffff, HAZE: 0.15 },
    // Evening golden hour peaks as the sun touches the horizon: the
    // reference's periwinkle-to-violet-to-gold sky, heavy warm haze.
    { T: 0.500, ZENITH: 0x7a74c2, MID: 0xc9a0c8, HORIZON: 0xffc06a,
      BELOW: 0xb08a68, SUN_LEVEL: 0.85, SKY_DARKEN: 1, GLOW: 1.0,
      STARS: 0, TINT: 0xffd2a4, HAZE: 0.9 },
    { T: 0.5125, ZENITH: 0x3a3670, MID: 0x8a6a9a, HORIZON: 0xff9a54,
      BELOW: 0x6e5a52, SUN_LEVEL: 0.45, SKY_DARKEN: 4, GLOW: 0.85,
      STARS: 0.25, TINT: 0xffd9b0, HAZE: 0.75 },
    // Night (Phase 27 follow-up: SKY_DARKEN 11 -> 10 and the tint pushed
    // toward silver — a full-moon night should read, not swallow the world;
    // gameplay unchanged: night surfaces sit at effective light 5, still
    // under the hostile-spawn gate of 7, and torches still protect at 14).
    { T: 0.525, ZENITH: 0x060a18, MID: 0x0c142c, HORIZON: 0x182440,
      BELOW: 0x0c1222, SUN_LEVEL: 0.15, SKY_DARKEN: 10, GLOW: 0,
      STARS: 1, TINT: LIGHTING.NIGHT_SKY_TINT, HAZE: 0.25 },
    { T: 0.975, ZENITH: 0x060a18, MID: 0x0c142c, HORIZON: 0x182440,
      BELOW: 0x0c1222, SUN_LEVEL: 0.15, SKY_DARKEN: 10, GLOW: 0,
      STARS: 1, TINT: LIGHTING.NIGHT_SKY_TINT, HAZE: 0.25 },
    { T: 0.9875, ZENITH: 0x2e4382, MID: 0x8a7a9c, HORIZON: 0xffb26b,
      BELOW: 0x7a6055, SUN_LEVEL: 0.45, SKY_DARKEN: 4, GLOW: 0.85,
      STARS: 0.25, TINT: 0xffd9b0, HAZE: 0.75 },
  ],
  GLOW_COLOR: 0xffb04a,           // sunrise/sunset horizon glow — gold, so
                                  // the sun's side of the sky turns golden
                                  // while the horizon base stays violet-pink
};

// The visible sun and moon riding the sky dome. Phase 24 shipped a square
// sun; the follow-up ("sun shouldn't have that box around it") made it a
// ROUND disc inside a soft atmospheric glow. The box was real, twice over:
// the old glow term still carried alpha ~16/255 at the quad's edge, which
// additive blending paints as a faint square boundary against the sky, and
// the texture was Nearest-filtered, so the magnified gradient stair-stepped.
// The glow is windowed to reach EXACTLY zero before the rim now, the sun
// texture filters linearly, and the core is a disc. The moon followed in
// the second Phase 27 follow-up ("make moon round"): an anti-aliased
// disc with seeded maria + craters, a soft terminator and an earthshine
// dark side — the same two rules (windowed, linear-filtered).
export const CELESTIAL = {
  DISTANCE: 820,                  // from the camera; inside the sky dome radius
  SUN_SIZE: 150,                  // the disc's diameter, in dome units
  SUN_GLOW_SCALE: 3.4,            // quad size as a multiple of the core —
                                  // the glow needs room to fade to nothing
                                  // (Phase 26: 2.6 -> 3.4, the reference's
                                  // big soft halo around a low sun)
  SUN_GLOW_STRENGTH: 0.72,        // glow alpha at the disc edge (was a
                                  // hardcoded 0.5 in sky_fx.js)
  SUN_CORE_COLOR: 0xfffbe8,       // the square itself
  SUN_GLOW_COLOR: 0xffd9a0,       // the atmospheric halo around it
  MOON_SIZE: 104,                 // the round disc is inscribed in the quad
                                  // (0.94 of it), so the quad grew a touch
                                  // to keep the old apparent diameter
  MOON_LIT_COLOR: 0xdfe4f2,       // the lit part of the moon's face
  MOON_DARK_ALPHA: 0.18,          // how visible the unlit part stays
  MOON_PHASES: 8,                 // vanilla's cycle; day 0 is full moon
  // Phase 27 follow-up — MOONLIGHT ("moon light should also good"). The
  // round moon disc hangs in a soft cool halo (an additive glow quad
  // behind it, the sun-glow treatment at night temperature), the sky dome
  // carries a gentle wash of light around its position, and the water
  // picks up a moon glint (main.js feeds the water uniforms the moon's
  // direction after sunset).
  MOON_GLOW_SCALE: 3.0,           // halo quad as a multiple of the moon
  MOON_GLOW_STRENGTH: 0.55,       // halo alpha at the moon's edge
  MOON_GLOW_COLOR: 0xcdddff,      // cool silver-blue halo
  MOON_SKY_GLOW: 0.32,            // the dome's night wash around the moon
  MOON_SKY_GLOW_COLOR: 0x9db8e8,  // ...and its colour
  MOON_SKY_GLOW_BAND: 1.6,        // dome-height reach of the wash (the day
                                  // glow hugs the horizon at 0.45; the moon
                                  // rides high, so its wash must too)
  MOON_GLINT_LEVEL: 0.32,         // water sun-level stand-in at night (drives
                                  // the moon glint + keeps night reflections
                                  // from going fully dead)
};

// Phase 27 follow-up — REALISTIC clouds, by request ("make clouds look
// realistic, not blocks"). The blocky slab deck is gone: the sky carries a
// noise-shaded cloud LAYER now — a camera-following plane at HEIGHT whose
// fragment shader grows soft cumulus out of domain-warped fbm value noise
// (a coarse weather-system gate grouping the masses, detail-noise erosion
// curdling the thin edges, pseudo-volume dome lighting — density read as
// height, relief-bumped normals, N.L against the sun or the night's moon —
// and warm silver linings on thin edges near a low sun). The colour pass
// is a VOLUMETRIC RAYMARCH now (the "like real life, like shaders"
// request): the slab knobs below march the field as density-as-height
// columns with real sides and crowns. World-anchored and drifting along
// -x like the old deck, day/night tinted, dawn-blushed.
//
// THE OCCLUSION CONTRACT SURVIVES (the Phase 26 bug fix): the layer draws
// twice — a DEPTH-ONLY pass whose fragments survive only where the cloud
// is dense (CORE_ALPHA), so the far-plane-pinned sun/moon/stars still fail
// the depth test behind real cloud, and a COLOUR pass drawn AFTER them, so
// the soft rims attenuate a star or the moon smoothly instead of alpha-
// popping. See render/sky_fx.js.
export const CLOUDS = {
  HEIGHT: 192,                    // cloud base height (the vanilla altitude)
  PLANE_RADIUS: 1600,             // half-extent of the camera-following plane
  SPEED: 1.3,                     // drift in blocks per second, along -x
                                  // (nudged up with the volumetric pass —
                                  // visible motion, with the terrain's
                                  // cloud shadows drifting in step, is
                                  // half of what reads as "alive")
  SCALE: 1 / 110,                 // noise-space units per block — the size
                                  // of individual cumulus features (the
                                  // first cut at 1/260 made one puff-cell
                                  // 260 blocks wide, so the patch of layer
                                  // visible overhead held ~one cell and
                                  // whole vantages rolled cloudless; at 110
                                  // the dome always carries a field of them)
  GATE_SCALE: 0.28,               // weather-system field, relative to SCALE —
                                  // the low-frequency grouping that leaves
                                  // clear stretches between masses (~390
                                  // blocks per system at SCALE 1/110; the
                                  // first cut put the WHOLE visible sky in
                                  // one gate cell and a low roll meant a
                                  // permanently empty sky)
  COVER: 0.70,                    // how much of a weather system fills in
                                  // (the reference-image retune: node
                                  // sweep holds ~52% visible / ~44% solid
                                  // with EVERY sampled vantage >= 38% —
                                  // clouds mostly SOLID white with thin
                                  // rims, blue between the puffs, and the
                                  // gate kept mild so no vantage ever
                                  // rolls an empty sky)
  SOFTNESS: 0.24,                 // density ramp width (puffy vs crisp edges)
  OPACITY: 0.97,                  // core opacity
  CORE_ALPHA: 0.90,               // RAW-field alpha above which a fragment
                                  // writes depth and OCCLUDES the sun/moon/
                                  // stars — deliberately NEAR-OPAQUE: the
                                  // visible pass has already dimmed a body
                                  // behind such cloud to ~a tenth, so the
                                  // depth cut is invisible. The old 0.60
                                  // bit a hard cookie-edge silhouette out
                                  // of the bright moon disc (the dusk
                                  // report's ugliest artifact)
  FADE_START: 780,                // thin out toward the horizon so the far
  FADE_END: 1400,                 // plane clip never shows a hard edge —
                                  // pushed out with VIEW.FAR 1700 so the
                                  // low stacked band of distant clouds
                                  // (the reference image's horizon) shows
  WARP: 0.55,                      // domain-warp strength (noise units) —
                                  // bends the sample space so puffs stop
                                  // being round fbm blobs
  DETAIL_SCALE: 3.1,              // erosion detail frequency, x base scale
  EROSION: 0.34,                  // how hard detail noise eats thin edges
                                  // (the cauliflower rim; cores keep mass)
  // VOLUMETRIC slab (the "like real life, like shaders" pass): the colour
  // pass raymarches [HEIGHT, HEIGHT + THICKNESS] through the drifting 2D
  // field — density-as-height columns, so clouds have visible sides,
  // rounded crowns and shaded flat bases from every angle.
  THICKNESS: 48,                  // slab depth in blocks
  STEPS: 10,                      // march samples per ray (the quality/cost
                                  // knob; ~11 noise evals per step)
  DENSITY: 0.05,                  // extinction per block of dense cloud —
                                  // how fast a ray goes opaque inside
  ROUND: 0.22,                    // crown falloff width (fraction of the
                                  // column's coverage): puffy vs boxy tops
  BOTTOM_LIT: 0.32,               // shading at the slab base (1 at crowns)
  MAX_SPAN: 620,                  // cap on the marched path for grazing
                                  // rays (they are horizon-faded anyway)
  LIT_COLOR: 0xffffff,            // sunlit faces of a cloud...
  SHADE_COLOR: 0xa4aec4,          // ...and its shaded underbelly (sRGB)
  SILVER: 0.85,                   // silver-lining strength on thin edges
  SILVER_POWER: 9,                // ...tightness around the sun's direction
  NIGHT_BRIGHTNESS: 0.22,         // colour scale at deep night (1.0 at noon)
  HORIZON_TINT: 0.45,             // fraction of the horizon colour mixed in
                                  // (what makes dawn clouds blush gold-pink)
  SEED: 37.73,                    // noise hash offset (clouds are weather,
                                  // not terrain — never world-seeded)
};

// Phase 24 — the night starfield: small fixed-size points on the celestial
// sphere, wheeling with the sun's orbit, alpha driven by the KEYFRAMES'
// STARS channel so they fade in through dusk and out through dawn.
export const STARS = {
  COUNT: 800,                     // over the FULL sphere — roughly half are
                                  // above the horizon at any moment of the
                                  // wheel's turn
  SIZE: 1.8,                      // screen pixels (no distance attenuation)
  RADIUS: 850,                    // just inside the sky dome
  SEED: 0x57a125,
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
  FOG_COLOR: 0x4a1006,            // thick warm red (Phase 18: lifted
                                  // from near-black 0x330808 — the Nether
                                  // should read dimly lit, not dark)
  FOG_NEAR: 20,                   // Phase 19: 8/72 -> 20/140 ("fog too
  FOG_FAR: 140,                   // thick" report — still the densest fog
                                  // in the game, but terrain, lava oceans
                                  // and fortresses read at a distance)
  // SPEC "ambient light: constant dim red" — while in the Nether the
  // day/night cycle's sky writes are overridden with these fixed values
  // (render/lighting.js setDimensionSky): skylight held at a permanent dusk
  // and tinted red, block light (glowstone, lava, the portal) unaffected.
  SKY_DARKEN: 5,
  SKY_TINT: 0xffa075,             // the warm red-orange cast
  // Phase 16: with the bedrock ceiling the real Nether has NO sky light at
  // all inside — this floors the effective sky level per fragment (and the
  // mob tint) so enclosed netherrack reads as the dim red glow instead of
  // pitch black. 0 in dimensions without the field (the overworld cycle).
  // Phase 18: 6 -> 9 ("the Nether is too dark" report — dimly lit but
  // clearly visible; lava and glowstone still dominate up close).
  AMBIENT_LIGHT: 9,
};

export const END_SKY = {
  FOG_COLOR: 0x281a3a,            // purple, medium
  FOG_NEAR: 20,
  FOG_FAR: 110,
  // SPEC "ambient light: constant dim purple" — the same fixed-sky channel
  // the Nether uses (render/lighting.js setDimensionSky).
  SKY_DARKEN: 6,
  SKY_TINT: 0xc0aee0,             // the cool violet cast
  AMBIENT_LIGHT: 9,               // effective-sky floor: the island is
                                  // clearly visible under the void sky
};

// ---------------------------------------------------------------------------
// The Phase 26 visual pass (render/post_fx.js, render/water_fx.js, and the
// shadow tint/bounce terms in render/lighting.js). Everything here is a
// LOOK, not a mechanic: the whole block can be neutralised (POST_ENABLED
// false, strengths 0) and the game is exactly Phase 25 again. The guiding
// rule from the brief: richer than vanilla, still unmistakably Minecraft —
// every strength below is deliberately subtle.
// ---------------------------------------------------------------------------

export const VISUAL = {
  // Master switch for the post pipeline (god rays, bloom, grading). With it
  // false the renderer draws straight to the canvas, Phase 25 style, and
  // only the water/shadow material patches remain (their strengths can be
  // zeroed individually below).
  POST_ENABLED: true,
  // The scene target's multisampling — rendering into a target loses the
  // canvas's built-in antialiasing, so the target carries its own (three
  // r160 resolves MSAA colour AND depth into the attached textures). 4 is
  // the standard; 0 disables if a GPU chokes on multisampled half-float.
  MSAA_SAMPLES: 4,

  // Subtle bloom on light sources: lava, glowstone, torches, portals. The
  // bright pass runs at 1/DOWNSCALE resolution and is masked to NON-SKY
  // pixels (the sun already carries its own glow). Sources are picked out
  // two ways: a soft luminance threshold that follows the time of day
  // (torch-lit surfaces must pop at night without daylight sand glowing at
  // noon), plus warm/violet EMISSIVE detectors — lava and glowstone are
  // saturated warm, portals saturated violet, while daylight terrain is
  // near-neutral, which is what keeps the bloom on the light sources
  // instead of on every bright block.
  BLOOM: {
    STRENGTH: 0.20,          // additive weight of the blurred bright pass
    THRESHOLD_DAY: 0.62,     // linear-luminance floor at full daylight...
    THRESHOLD_NIGHT: 0.17,   // ...and at deep night
    SOFT_KNEE: 0.5,          // soft shoulder under the threshold
    WARM_BOOST: 0.55,        // emissive detector gain: warm saturation
    WARM_FLOOR: 0.18,        // ...ignored below this (wood, sand, dirt)
    VIOLET_BOOST: 0.5,       // ...and violet saturation (portal swirl)
    VIOLET_FLOOR: 0.14,
    DOWNSCALE: 4,            // bright+blur passes at quarter resolution
    BLUR_SPREAD: 1.6,        // gaussian tap spacing in downscaled texels
  },

  // Soft god rays from the sun when it is low in the sky: a screen-space
  // radial blur of the sky's brightness around the sun's screen position,
  // masked by depth — terrain and the (depth-writing, Phase 26) cloud deck
  // carve the shafts, so a cloud in front of the sun kills its rays exactly
  // like a ridge does. Strength ramps in as the sun drops below
  // MAX_ELEVATION (sun-direction y), peaks at FULL_ELEVATION, and fades
  // with the sun itself through sunset; a high noon sun casts none.
  GODRAYS: {
    STRENGTH: 0.44,          // composite weight at full effect (0.34 at
                             // first; the reference wants soft but present)
    MAX_ELEVATION: 0.40,     // rays begin as the sun sinks below this
    FULL_ELEVATION: 0.14,    // ...full strength from here down
    TAPS: 14,                // radial samples per pass
    PASSES: 2,               // blur passes (TAPS^PASSES effective reach)
    DECAY: 0.93,             // per-tap falloff along the ray
    DENSITY: 0.42,           // fraction of the ray to the sun each pass spans
    SUN_RADIUS: 0.55,        // screen-space radius of the source window
    DOWNSCALE: 2,            // ray passes at half resolution
    TINT: 0xffdda6,          // warm shaft colour (multiplies the mask)
    RISE_START: -0.05,       // rays fade in from this sun elevation...
    RISE_FULL: 0.04,         // ...fully risen here (the sun clears the rim)
    FACING_START: 0.05,      // camera-forward · sunDir where rays begin...
    FACING_FULL: 0.30,       // ...and reach full weight (looking sunward)
  },

  // Slight colour grading, applied last in the composite: richer greens,
  // warmer sunlight, cooler shadows. All three are gentle pushes — the
  // palette must stay recognisably Minecraft's.
  GRADING: {
    EXPOSURE: 1.0,           // linear gain before grading
    SATURATION: 1.06,        // global saturation
    GREEN_GAIN: 1.06,        // extra gain on green-dominant pixels (foliage)
    WARMTH: 0.045,           // warm white-balance push, scaled by sun level
    SHADOW_COOL_COLOR: 0x4a66a8, // the tone shadows lean toward...
    SHADOW_COOL: 0.12,       // ...and how far the darkest tones lean
    DITHER: 1 / 255,         // composite output dither (kills sky banding)
  },

  // The water surface (render/water_fx.js — a patch on the same lit chunk
  // material water has always used). A gentle world-space ripple displaces
  // surface vertices (render-only; physics and raycasts never see it), the
  // same wave function's gradient perturbs the per-fragment normal, and a
  // fresnel term mixes in a reflection: sky colour where the surface is
  // open to the sky, falling back to a dark terrain tone where the baked
  // sky light says the water sits under canopy or cliff — the "suggestion
  // of nearby terrain". A tight sun glint rides the ripple normals.
  WATER: {
    RIPPLE_AMPLITUDE: 0.06, // vertex ripple height (blocks)
    RIPPLE_SCALE: 0.55,      // primary wave frequency (radians per block)
    RIPPLE_SCALE_2: 1.35,    // second octave frequency
    RIPPLE_SPEED: 0.9,       // primary phase speed (radians per second)
    RIPPLE_SPEED_2: 1.7,     // second octave phase speed
    NORMAL_STRENGTH: 0.9,   // how strongly the ripple tilts the normal
    REFLECTION: 0.45,        // fresnel reflection mix at grazing angles
    BASE_REFLECT: 0.06,      // reflection floor looking straight down
    FRESNEL_POWER: 4.0,
    SHADE_COLOR: 0x24382e,   // reflection tone under canopy/cliff (low sky)
    OPEN_SKY_LIGHT: 0.85,    // vLight.x above this reflects pure sky
    SHADE_SKY_LIGHT: 0.45,   // ...below this, pure terrain tone
    GLINT_STRENGTH: 0.6,     // sun sparkle amplitude
    GLINT_POWER: 180,        // sparkle tightness
    GLINT_COLOR: 0xfff2d9,   // the sparkle's warm-white tint
    OPACITY_BOOST: 0.35,     // extra alpha at grazing angles (the mirror
                             // look); 0 restores Phase 25 translucency
    NIGHT_REFLECT_FLOOR: 0.25, // fraction of the terrain-tone reflection
                             // that survives deep night
  },

  // Shadow feel (render/lighting.js patchChunkMaterial): a subtle warm
  // bounce lifted into shaded faces by day (sunlit ground scatters warm
  // light back up), and a slight cool lean on those same faces (open-sky
  // shadow is blue-lit). Both scale with the face's baked shade (per-face
  // brightness x AO), the daylight level, and the column's sky access, so
  // caves and night are untouched. AO_STRENGTH 0.45 -> 0.40 beside these
  // softens the corner darkening a touch (the "improved shadow softness").
  SHADOW: {
    BOUNCE_COLOR: 0xffc088,  // warm bounce tone
    BOUNCE_STRENGTH: 0.10,   // added light at full shade in full day
    COOL_COLOR: 0x8fa8d8,    // the cool lean of daylight shadows
    COOL_STRENGTH: 0.14,
  },
  // Cloud SHADOWS drifting over the terrain (the "lively, like shaders"
  // pass): the chunk shader dims each open-sky column's SKY light by a
  // cheap copy of the cloud field, projected along the sun and synced to
  // the sky's drift — patches of shade wander across the plains exactly
  // under the clouds that cast them. Torch light, caves and the fixed-sky
  // dimensions are untouched; strength fades with the sun and is 0 at
  // night.
  // WIND on the foliage ("make those leaves look lively, like a shader"):
  // the mesher bakes a per-vertex wave weight (leaves ~0.55 everywhere;
  // cross-plane grass/flowers 0 at the root, 1 at the tip) and the chunk
  // vertex shader sways those vertices through a world-space wind field —
  // several incommensurate sines plus a slow travelling gust, phase
  // continuous across blocks and chunks so a canopy ripples as one body.
  // Textures untouched; static blocks pay one attribute byte per vertex
  // and a uniform branch.
  WIND: {
    AMPLITUDE: 0.09,         // peak displacement in blocks at weight 1
    SPEED: 1.0,              // wind clock rate (1 = the shipped feel)
  },
  CLOUD_SHADOW: {
    STRENGTH: 0.30,          // sky-light dimming under a solid cloud
    SOFTNESS: 0.34,          // shadow edge width (field units) — soft,
                             // like real cloud shade, and wider than the
                             // sky's own edges so the match never has to
                             // be exact
    PROJECT_HEIGHT: 120,     // blocks of sun-slant projection (cloud base
                             // minus typical terrain height)
    MIN_SUN_Y: 0.35,         // clamp on the slant divisor so a low sun
                             // never smears shadows kilometres sideways
  },
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
  // Building a fresh linked portal in the CEILINGED Nether (Phase 16): the
  // overworld's highest-solid-column rule would land on TOP of the bedrock
  // ceiling, so columns spiral out from the scaled point looking for real
  // interior ground (solid non-lava floor with standing room); failing
  // that, a sheltered netherrack pocket is carved for the frame.
  NETHER_PLACE: {
    SEARCH_RADIUS: 16,            // columns searched around the scaled point
    CLEARANCE: 5,                 // air cells needed above a natural floor
  },
  EYE_SHATTER_CHANCE: 0.2,
  // Phase 26: "roughly 400 blocks from spawn instead of 1000-2000, so it
  // can be reached without a long journey." Measured from the ACTUAL
  // scanned plains spawn column (world/spawn_scan.js), not the config
  // origin — strongholdCenter takes the spawn as an anchor now.
  STRONGHOLD_MIN_DISTANCE: 340,
  STRONGHOLD_MAX_DISTANCE: 460,
  END_PORTAL_FRAME_COUNT: 12,

  // The stronghold itself (Phase 19 — dimensions/stronghold.js). One per
  // world, underground, its portal room anchored to strongholdCenter (the
  // eye-of-ender target). A deterministic blueprint of CELL-sized pieces —
  // corridors, junction rooms, staircases shifting deck levels, terminal
  // libraries and storage rooms — grown from the portal room by the
  // fortress.js walk.
  STRONGHOLD: {
    CELL: 11,                     // blocks per layout cell (rooms are one cell)
    BASE_Y: 12,                   // portal-room deck height (underground —
                                  // surfaces sit at 45+, lava lakes at -54)
    LEVEL_STEP: 4,                // deck shift per staircase piece
    LEVEL_RANGE: 8,               // decks stay within BASE_Y ± this
    MAX_RADIUS_CELLS: 5,          // layout bounded to ±5 cells (~55 blocks)
    MAX_PIECES: 34,               // total piece budget
    RUN_MIN_CELLS: 1,             // corridor run length range (cells)
    RUN_MAX_CELLS: 3,
    CONTINUE_CHANCE: 0.7,         // a run continues past a junction...
    STAIR_CHANCE: 0.4,            // ...possibly through a staircase
    BRANCH_CHANCE: 0.5,           // side arms at junctions
    MAX_DEPTH: 4,                 // junction generations from the heart
    ROOM_HEIGHT: 4,               // room interior height (portal room taller)
    PORTAL_ROOM_HEIGHT: 6,
    CORRIDOR_HEIGHT: 3,
    DOOR_HEIGHT: 3,
    MOSSY_CHANCE: 0.12,           // stone-brick weathering rolls, per block
    CRACKED_CHANCE: 0.12,
    TORCH_EVERY: 5,               // corridor torch spacing (columns)
    PIER_MAX_DROP: 12,            // support piers under cavern crossings
    FRAME_PREFILL_CHANCE: 0.1,    // per-frame chance to generate eye-filled
                                  // (SPEC: "some frames spawn pre-filled")
    ANCHOR: { A: 5, B: 2 },       // strongholdCenter lands on this portal-room
                                  // offset — a walkway column, so digging
                                  // straight down at the eye point can never
                                  // drop the player into the lava pool
  },

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

  // Phase 20 — the fight itself (entities/dragon.js). The dragon is a
  // kinematic flyer (no voxel collision, like vanilla): it steers toward
  // per-phase target points, banks into turns, and only ever lands on the
  // exit portal fountain.
  SCALE: 1.2,                   // model scale (the rig is authored at the
                                // vanilla px sizes — ~15-block wingspan
                                // before scaling)
  TURN_RATE: 1.1,               // rad/s the flight heading can turn
  BANK_FACTOR: 0.7,             // roll into turns, radians per rad/s of turn
  BANK_RATE: 3,                 // 1/s roll easing
  HURT_FLASH_SECONDS: 0.4,      // red tint after a hit (the mob look)

  // Circling: ride a ring OUTSIDE the pillar ring (pillar reach ~38 with
  // jitter+radius; the lead-pursuit steering bows the real orbit ~5
  // inside RADIUS, so 48 keeps the body clear of the obsidian — the
  // review caught the old 38 clipping through the tall pillars each lap).
  CIRCLE: {
    RADIUS: 48,                 // flight ring radius around the centre
    HEIGHT_MIN: 22,             // ring height above ISLAND_TOP_Y rolls
    HEIGHT_MAX: 34,             //   in this range per leg
    SPEED: 12,                  // blocks/s along the ring
    LEG_MIN_SECONDS: 6,         // one circling leg before the next roll
    LEG_MAX_SECONDS: 12,
    STRAFE_CHANCE: 0.45,        // roll at the end of a leg: strafing run...
    PERCH_CHANCE: 0.25,         // ...or drop onto the exit portal fountain
  },

  // Strafing run: swoop low past the player — the wing-knockback pass.
  STRAFE: {
    SPEED: 17,                  // blocks/s during the swoop
    PASS_HEIGHT: 3,             // aim this far above the player's head
    OVERSHOOT: 18,              // the aim point sits this far past the player
    BREAK_OFF_DISTANCE: 26,     // climbing away this far past ends the run
    MAX_SECONDS: 9,             // safety cap — never dive forever
  },

  // Perching on the exit portal (SPEC: melee is the perch-phase answer).
  PERCH: {
    APPROACH_SPEED: 10,         // blocks/s descending onto the fountain
    SETTLE_DISTANCE: 1.2,       // close enough to the seat counts as landed
    MIN_SECONDS: 8,             // sits at least this long...
    MAX_SECONDS: 16,            // ...and takes off by this even if ignored
    LEAVE_DAMAGE: 24,           // accumulated damage that ends a perch early
    // Phase 21 (reported: "stands on top of the exit portal rather than
    // gripping it"). The body now settles so the front claws close on the
    // fountain's raised rim and the rear feet plant on the bedrock base,
    // with the neck craned DOWN at the player — which is what makes the
    // perch a melee window at all.
    BODY_HEIGHT: 2.6,           // body-centre height above the fountain base
    GRIP_SPREAD: 0.55,          // radians the front legs splay outward to grip
    GRIP_REACH: 0.5,            // radians the front legs reach forward/down
    REAR_PLANT: 0.35,           // radians the rear legs fold under the body
    HEAD_DROP: 1.1,             // blocks the craned head aims below the eye
    NECK_SAG: -0.55,            // neck curve sag while perched (arches over)
    ARROW_IMMUNE: true,         // vanilla: projectiles do nothing while
                                // perched (ranged hits are detected by
                                // distance — melee happens within reach)
    ARROW_RANGE: 4.5,           // hits from farther than this count as arrows
  },

  // The breath attack (perch weapon): a purple particle cone at the player
  // with a damage tick while they stand in it.
  BREATH: {
    RANGE: 14,                  // reaches this far from the mouth
    CONE_DOT: 0.88,             // aim·target cosine gate (~28° half-angle)
    DAMAGE: 3,                  // per tick caught in the cone
    TICK_SECONDS: 0.6,
    BURST_SECONDS: 3.0,         // one breath lasts this long...
    COOLDOWN_SECONDS: 4.0,      // ...with this long between breaths
    PARTICLE_COUNT: 160,        // pooled breath particles
    PARTICLE_SPEED: 9,          // blocks/s leaving the mouth
    PARTICLE_LIFE: 1.1,
    PARTICLE_SIZE: 0.5,
  },

  // Wing knockback: a fast pass that clips the player shoves them hard.
  WING: {
    DAMAGE: 5,                  // vanilla dragon body hit
    RANGE: 4.0,                 // player within this of the body centre
    MIN_SPEED: 8,               // only while genuinely sweeping past
    COOLDOWN_SECONDS: 1.2,      // between wing hits
  },

  // Crystal healing (SPEC: regenerates from any living crystal, visible
  // beam). The nearest living crystal within range feeds the dragon.
  // Range 40: the circling ring stays mostly connected (the pressure to
  // pop crystals is the fight), but the PERCH sits ~49+ from every seat —
  // perch-phase melee progress sticks instead of healing back (the
  // review's fight-economy finding).
  HEAL: {
    // Phase 21 retune: the pillars are shorter, so the perch seat sits ~35
    // from the nearest crystal instead of ~49. Range 30 keeps the circling
    // ring fed (nearest crystal ~20-27 away all the way round) while the
    // PERCH still gets no drink — the Phase 20 fight-economy rule, held.
    RANGE: 30,                  // crystals feed the dragon within this
    PER_SECOND: 3,              // health per second while connected
    CRYSTAL_POP_DAMAGE: 10,     // losing the connected crystal stings
                                // (vanilla explosion feedback)
  },

  // The death sequence: glide to the centre, light beams, gone.
  DEATH: {
    SECONDS: 5.5,               // the whole sequence
    RISE_HEIGHT: 14,            // final hover height above the fountain
    BEAM_COUNT: 9,              // radiating light beams
    BEAM_LENGTH: 28,
    BEAM_WIDTH: 0.55,
    FLASH_SECONDS: 1.0,         // terminal white-out flash
  },
};

// End crystals (entities/crystals.js — Phase 20): one atop each obsidian
// pillar, healing the dragon, destroyable with a hit (they explode).
export const END_CRYSTAL = {
  SIZE: 1.6,                    // hittable AABB edge (blocks)
  BOB_HEIGHT: 0.18,             // hover bob amplitude
  BOB_HZ: 0.5,
  SPIN_RATE: 1.2,               // rad/s of the glass cage spin
  CORE_SPIN_RATE: -2.1,         // the inner core counter-spins
  EXPLODE_DAMAGE: 12,           // blast damage at the crystal
  EXPLODE_BLOCK_RADIUS: 2,      // crater size (obsidian/bedrock survive)
  BEAM_WIDTH: 0.22,             // healing-beam thickness (blocks)
  BEAM_COLOR: 0xe0b8ff,         // pale violet
  BEAM_OPACITY: 0.75,
};

// ---------------------------------------------------------------------------
// Ender pearls (entities/ender_pearl.js — Phase 22): right-clicking one
// throws it as a real projectile; wherever it lands the player teleports,
// taking the vanilla 5 points (2.5 hearts) of fall damage on arrival.
// ---------------------------------------------------------------------------

export const ENDER_PEARL = {
  SPEED: 22,                      // launch speed, blocks/s (vanilla ~1.5 b/t)
  GRAVITY: 20,                    // arc pull, blocks/s^2
  DRAG: 0.008,                    // per-second velocity damping
  MAX_SECONDS: 8,                 // safety despawn (a pearl thrown at the sky)
  SPAWN_FORWARD: 0.35,            // launch offset ahead of the eye (blocks)
  SPAWN_DOWN: 0.12,               // ...and a touch below it, like vanilla
  SPRITE_SIZE: 0.32,              // rendered slab edge (blocks)
  SPIN_RATE: 6.0,                 // rad/s tumble
  STEP_SECONDS: 1 / 120,          // sub-step for the swept collision test
  TELEPORT_DAMAGE: 5,             // SPEC/vanilla: 2.5 hearts on arrival
  TRAIL_PER_SECOND: 26,           // purple particles left behind in flight
  ARRIVAL_CLEARANCE: 0.02,        // lift off the landing face before standing
};

// ---------------------------------------------------------------------------
// Particles (render/particles.js — Phase 22). ONE pooled instanced mesh pair
// draws every particle in the game: textured cubes sampling the block atlas
// (break debris, footstep scuffs, landing bursts) and flat coloured cubes
// (smoke, embers, splashes, magic). The pool is fixed and capped, so heavy
// scenes drop the OLDEST particle rather than allocating.
// ---------------------------------------------------------------------------

export const PARTICLES = {
  MAX: 2000,                      // hard pool cap (both meshes share it)
  GRAVITY: 16,                    // default fall, blocks/s^2 (scaled per kind)
  DRAG: 1.4,                      // default per-second velocity damping
  BOUNCE: 0.28,                   // velocity kept when debris hits ground
  COLLIDE_MAX: 700,               // above this live count, skip block collision
  CULL_DISTANCE: 72,              // never spawn further than this from the eye
  ATLAS_CROP: 0.25,               // block-break cubes sample a quarter tile

  BREAK: { COUNT: 14, SIZE: 0.11, SPEED: 3.0, LIFE: [0.5, 1.1], GRAVITY: 1.0 },
  PLACE: { COUNT: 7, SIZE: 0.09, SPEED: 1.4, LIFE: [0.25, 0.5], GRAVITY: 0.55 },
  STEP: { COUNT: 2, SIZE: 0.09, SPEED: 0.9, LIFE: [0.3, 0.6], GRAVITY: 0.8 },
  SPRINT_STEP_COUNT: 4,           // sprinting kicks up more
  STEP_INTERVAL: 0.42,            // seconds between walking footsteps
  SPRINT_STEP_INTERVAL: 0.34,     // ...and while sprinting (Phase 23: 0.30
                                  // put ~4.3 steps a second under the player,
                                  // faster than vanilla and part of why the
                                  // sprint loop read as a continuous noise)
  LAND: { COUNT: 18, SIZE: 0.10, SPEED: 2.6, LIFE: [0.4, 0.8], GRAVITY: 0.9 },
  LAND_MIN_FALL: 1.2,             // blocks fallen before a landing burst shows

  SPLASH: { COUNT: 26, SIZE: 0.09, SPEED: 4.2, LIFE: [0.4, 0.9], GRAVITY: 1.1,
            COLOR: 0xbfe4ff },
  BUBBLE: { SIZE: 0.07, RISE: 1.1, LIFE: [0.6, 1.2], COLOR: 0xd8f2ff,
            PER_SECOND: 9 },
  EMBER: { SIZE: 0.095, RISE: 0.85, LIFE: [0.8, 1.6], COLOR: 0xffb02a },
  LAVA_POP: { COUNT: 5, SIZE: 0.1, SPEED: 3.4, LIFE: [0.6, 1.1], GRAVITY: 0.9,
              COLOR: 0xff7418 },
  SMOKE: { SIZE: 0.34, RISE: 0.9, LIFE: [0.9, 1.9], COLOR: 0x3a3632 },
  EXPLOSION: { SMOKE: 34, DEBRIS: 26, SPEED: 7.0, DEBRIS_SIZE: 0.13,
               DEBRIS_LIFE: [0.6, 1.4], DEBRIS_COLOR: 0x6b6459 },
  DAMAGE: { COUNT: 9, SIZE: 0.10, SPEED: 2.2, LIFE: [0.3, 0.6], GRAVITY: 0.8,
            COLOR: 0xd21f1f },
  DEATH: { COUNT: 22, SIZE: 0.16, SPEED: 1.3, LIFE: [0.5, 1.0], GRAVITY: -0.1,
           COLOR: 0xe8e8e8 },
  PICKUP: { COUNT: 5, SIZE: 0.07, SPEED: 1.4, LIFE: [0.25, 0.5],
            COLOR: 0xfff3a8 },
  PORTAL: { SIZE: 0.105, LIFE: [0.9, 1.7], RADIUS: 1.5, COLOR: 0xb44cff,
            PER_SECOND: 14 },
  ENDER: { COUNT: 16, SIZE: 0.11, SPEED: 1.6, LIFE: [0.5, 1.1],
           COLOR: 0xa14cff },
  FLAME: { SIZE: 0.105, RISE: 0.35, LIFE: [0.5, 1.0], COLOR: 0xffb444,
           PER_HIT: 2 },
  SPARKLE: { SIZE: 0.085, RISE: 0.1, LIFE: [0.5, 1.0], COLOR: 0xfff0b0 },
  BREATH: { SIZE: 0.5, LIFE: [0.6, 1.2], COLOR: 0xc060ff },
  // Phase 26: ambient dust motes in underground light shafts — tiny, slow,
  // long-lived specks that catch the light where a cave opens to the sky.
  DUST: { SIZE: 0.035, SINK: 0.16, DRIFT: 0.05, LIFE: [2.5, 5.0],
          COLOR: 0xd8ccae },

  // The random "display tick" that finds torches, lava, glowstone and end
  // portals near the player (systems/ambience.js — vanilla's randomDisplayTick).
  // Vanilla samples ~20 000 random cells a second around the player and
  // lets whatever it lands on decide; the numbers below are that, scaled to
  // this radius. A cell is visited ~0.6 times a second, which is what makes
  // a torch flicker rather than stream.
  AMBIENT: {
    RADIUS: 10,                   // cells sampled around the player
    SAMPLES_PER_SECOND: 14000,    // random cells tested each second (each
                                  // cell in the cube gets visited ~1.5x/s)
    MAX_PER_FRAME: 1600,          // ...never more than this in one frame
    TORCH_CHANCE: 1.0,            // per hit, chance a flame spawns
    LAVA_CHANCE: 0.55,
    LAVA_POP_CHANCE: 0.02,
    GLOWSTONE_CHANCE: 0.35,
    // Phase 26 — dust motes in underground light shafts: an AIR cell hit by
    // the random tick spawns one when it carries real sky light (a shaft)
    // while sitting well below the generator's surface (a cave, not a
    // valley at dusk). The chance keeps a handful alive in a typical shaft.
    DUST_CHANCE: 0.05,            // per eligible air-cell hit
    DUST_MIN_SKY: 6,              // baked sky light that counts as a shaft
    DUST_MIN_DEPTH: 5,            // cell at least this far under the surface
  },
};

// ---------------------------------------------------------------------------
// Sound (systems/audio.js — Phase 22). Everything is synthesised with the
// Web Audio API: no files ship with this game. Voices are layered (each
// sound is 2-4 oscillator/noise components), routed through a compressor so
// a dozen simultaneous events read as ONE satisfying thump rather than
// clipping mush, and attenuated by distance from the listener with a stereo
// pan derived from the camera's right vector.
// ---------------------------------------------------------------------------

export const AUDIO = {
  MASTER_VOLUME: 0.55,            // the whole game's output level
  MAX_VOICES: 24,                 // concurrent one-shots; the rest are dropped
  VOICE_MIN_GAP: 0.012,           // seconds between two copies of one sound
  HEARING_RANGE: 26,              // blocks: silence beyond this
  ROLLOFF: 1.35,                  // >1 = quieter faster with distance
  PAN_WIDTH: 0.85,                // maximum stereo spread
  PAN_NEAR: 1.5,                  // blocks under which a sound is centred
  // The bus compressor: what keeps a creeper blast beside a lava lake with
  // mobs dying from turning into noise.
  COMPRESSOR: { THRESHOLD: -22, KNEE: 26, RATIO: 8, ATTACK: 0.004, RELEASE: 0.22 },

  // Phase 23 retune. Footsteps are the most-heard sound in the game and were
  // both too loud and too long; sprinting no longer gets a volume boost at
  // all (vanilla sprint steps are faster, not louder — boosting them was half
  // of the reported "strange, unnatural" sprint noise), and landing has its
  // own heavier sound instead of a footstep played at 1.8x.
  FOOTSTEP_VOLUME: 0.26,
  SPRINT_STEP_VOLUME: 1.0,        // multiplier on a sprinting step (was 1.15)
  SNEAK_STEP_VOLUME: 0.35,        // ...and on a sneaking one
  LAND_VOLUME: 0.42,
  LAND_MAX_VOLUME: 1.35,          // cap on the fall-height scaling
  BREAK_VOLUME: 0.62,
  PLACE_VOLUME: 0.58,
  MINING_VOLUME: 0.24,            // the loop while a block is being dug
  MINING_INTERVAL: 0.28,          // seconds between mining ticks
  HURT_VOLUME: 0.7,
  SWING_VOLUME: 0.4,
  PICKUP_VOLUME: 0.28,
  LEVEL_UP_VOLUME: 0.6,

  // Continuous ambience (systems/ambience.js): looping beds whose gain
  // follows how much fluid is around the player.
  WATER_AMBIENCE_VOLUME: 0.20,
  LAVA_AMBIENCE_VOLUME: 0.30,
  FLUID_AMBIENCE_RADIUS: 8,       // cells sampled around the player
  FLUID_AMBIENCE_FULL: 26,        // fluid cells for full ambience volume
  AMBIENCE_RESPONSE: 1.6,         // 1/s gain easing

  // The end portal's hum (the nether portal keeps its own in portals.js).
  PORTAL_HUM_VOLUME: 0.16,
  PORTAL_SCAN_SECONDS: 0.25,      // how often nearby portal cells are re-found

  // Cave ambience: rare distant echoing tones while underground in the dark.
  CAVE: {
    MIN_GAP: 32,                  // seconds between candidate moments
    MAX_GAP: 95,
    MAX_SKY_LIGHT: 4,             // only where daylight can't reach
    MAX_Y: 52,                    // ...and only below this height
    VOLUME: 0.5,
  },
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
