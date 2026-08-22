# ARCHITECTURE

How this project is organised. Read before writing code so you edit the right file
instead of creating a parallel version of something that already exists.

---

## Layout

```
index.html               entry point, importmap, canvas element
src/
  main.js                bootstrap, game loop, wires systems together
  config.js              all tunable constants in one place

  world/
    blocks.js            block registry: ids, textures, hardness, drops,
                         collision/render shape tables (re-exported from
                         shapes.js/shape_tables.js), the fluid families
    shapes.js            the Phase 21 SHAPED building blocks: their ids and
                         registry entries — stairs, slabs, fences, gates,
                         walls, ladders, doors, trapdoors, beds, signs,
                         flower pots, item frames. blocks.js hands it
                         `register`, so the pair is cycle-free
    fluid_families.js    the lava and water id tables and their predicates
                         (Phase 23 — the cut ARCHITECTURE mandated for
                         blocks.js since Phase 21; moved verbatim, and
                         blocks.js re-exports every symbol so no consumer
                         changed). Takes BLOCK/BLOCKS as arguments the way
                         shapes.js takes `register`, so the pair is cycle-free
    shape_tables.js      the box tables behind them (Phase 21 split of
                         shapes.js per the size cap): SHAPE_BOXES (render),
                         COLLISION_BOXES (physics), FLUSH_RECTS (face
                         culling), the fence/wall connection builders and
                         every family lookup. ONE box list feeds both the
                         mesher and the collision sweep — what you see is
                         what you walk into
    terrain.js           heightmap, biomes (domain-warped since Phase 24),
                         rivers, surface rules, trees, cacti, ground plants,
                         surface lava pools — the overworld generator
    terrain_noise.js     the heightmap's OWN seeded 2D noise machinery
                         (hashes, Simplex2D, fbm, smoothstep — Phase 24
                         split out of terrain.js per the size cap, moved
                         verbatim; deliberately independent of noise.js so
                         the two seed streams never couple)
    spawn_scan.js        the GUARANTEED plains spawn (Phase 26): candidate
                         centres spiral out from the origin, each scored
                         over a sampled disc (plains fraction, water,
                         relief), first to clear every TERRAIN.SPAWN_SCAN
                         threshold wins — with a best-seen fallback so it
                         ALWAYS returns a column. Takes the generator as an
                         argument (the shapes.js pattern, cycle-free); the
                         player spawn, the eyes of ender and the stronghold
                         anchor all read the one cached result
    surface_rules.js     the Phase 24 surface rules (gravel patches, beach
                         reach, the mountain stone line, surfaceLayersFor)
                         — Phase 26 split out of terrain.js per the size
                         cap, moved verbatim (A/B: byte-identical chunks);
                         takes the generator as an argument like
                         spawn_scan.js, so the pair is cycle-free
    plants.js            the Phase 24 cross-plane plant registrations
                         (short grass, dandelion, poppy, dead bush) and
                         their soil rules — the shapes.js pattern: blocks.js
                         hands it `register` and BLOCK, so the pair is
                         cycle-free. isCrossPlant/plantCanSitOn are the
                         predicates placement, main.js's pop listener and
                         the mesher tables read
    noise.js             seeded simplex/fbm/Field3D machinery for the
                         carver (Phase 15 split out of caves.js per the
                         size cap — moved verbatim, byte-identical output)
    ores.js              the ore + gravel-pocket vein passes and the
                         STONE_FAMILY table (Phase 24 split out of caves.js
                         — the cut its cap note mandated; moved verbatim,
                         byte-identical PRNG streams)
    caves.js             cave carving (tunnels + caverns from noise),
                         ravines, surface entrances, ore placement, lava
                         placement, underground water springs/pools and the
                         gravel/clay banks beside them. Phase 23 retired the
                         Phase 15 MEGA noise layer (three phases of tuning
                         never produced a room) and rebuilt lava above the
                         lake level as placed pools instead of a mask flood
    caverns.js           the GREAT CAVERN pass (Phase 23): the large chambers,
                         PLACED rather than thresholded out of noise — one per
                         REGION_SIZE tile at a hashed centre and size, carved
                         as a noise-warped superellipsoid with a mid-level
                         shelf for ledges and drops, plus connector bores out
                         to the tunnel network. Split from caves.js per the
                         size cap; caves.js calls it as its last carve pass.
                         Measured: 250 chambers over 4000x4000, one per ~253
                         blocks, every one 36-58 across and 20-40 tall, and
                         all of them reachable from open sky
    chunks.js            chunk data, meshing, face culling (Phase 17: the
                         mesher tables + special emitters split out into
                         emitters.js per the size cap)
    emitters.js          the mesher's per-block lookup tables, FACES
                         geometry table and the special-shape emitters:
                         torch box model, flowing lava, portal slab, and
                         the Phase 17 nether wart crop (split out of
                         chunks.js — byte-identical A/B verified)
    chests.js            chest block entities: contents + entity-textured
                         box model + lid animation (Phase 10 addition)
    spawners.js          blaze spawner block entities (Phase 17): the
                         spinning caged-blaze display, player-proximity
                         spawn cycles, chunk-scan discovery of generated
                         spawners (the fluids settle-scan pattern)
    wart.js              nether wart lifecycle (Phase 17): growth timers
                         for planted wart, soil-break pops with drops
    fluids.js            flowing fluids: budgeted spread/fall/recede
                         automaton over block-change events (Phase 12 lava;
                         Phase 21 generalised it so WATER runs the same
                         rules with its own range 7 and faster tick, plus
                         vanilla's two-sources-make-a-source);
                         water+lava hardening to obsidian/cobble (Phase 15)
    signs.js             sign block entities (Phase 21): the four lines of
                         text, the entry panel, the generated text plane on
                         the board face
    frames.js            item frame block entities (Phase 21): the mounted
                         item and its display mesh
    world.js             chunk manager, get/set block, loading, block-change
                         listeners, getLight point queries, dimension
                         backing-store swap (Phase 15)

  render/
    renderer.js          Three.js setup, tone mapping, shadows, resize
    post_fx.js           the Phase 26 post pipeline: the scene renders into
                         a linear half-float target (MSAA, depth texture),
                         then screen-space god rays (depth-masked radial
                         blur toward the low sun — terrain AND the
                         depth-writing cloud deck carve the shafts), subtle
                         bloom (soft threshold following the sun level +
                         warm/violet emissive detectors for lava/glowstone/
                         torches/portals, sky masked out), and the grading
                         composite (richer greens, warmer sun, cooler
                         shadows, the one linear->sRGB encode + dither).
                         All tunables in config VISUAL; POST_ENABLED false
                         restores the direct Phase 25 render path
    water_fx.js          the Phase 26 water surface: a patch layered on the
                         lit chunk material — world-space vertex ripple
                         (render-only; physics never sees it), analytic
                         ripple normals, fresnel reflection mixing sky
                         colour with a dark terrain tone by the baked sky
                         access (the "suggestion of nearby terrain"), and a
                         sun glint. WATER_UNIFORMS written per frame from
                         main.js (the CHUNK_LIGHT_UNIFORMS pattern)
    atlas.js             texture atlas loading and UV lookup
    lighting.js          light propagation, AO, day/night (the cycle drives
                         the Phase 24 sky furniture below). The chunk
                         shader patch also carries DRIFTING CLOUD SHADOWS
                         (the Phase 27 "like shaders" follow-up): a cheap
                         3-octave copy of the sky's cloud field, sampled
                         at each open-sky column projected along the sun,
                         dims the SKY light only — synced to the sky's
                         drift by per-frame uniforms, off at night and
                         under fixed dimension skies — and WIND: vertices
                         carrying the mesher's per-vertex wave weight
                         (leaves; cross-plant tips) sway through a
                         world-space wind field (config VISUAL.WIND),
                         phase-continuous across blocks and chunks
    sky_fx.js            the sky furniture (Phase 24; clouds rebuilt
                         through the Phase 27 follow-ups, ending
                         VOLUMETRIC): the colour pass RAYMARCHES a slab
                         [HEIGHT, HEIGHT+THICKNESS] through the drifting
                         domain-warped/gated/eroded 2D field —
                         density-as-height columns, STEPS jittered
                         samples, front-to-back transmittance, height-
                         gradient shading (shaded flat bases, sunlit
                         crowns), silver linings — so clouds have real
                         sides, and silhouettes change as you move; the
                         Phase 26 occlusion contract keeps its depth-only
                         2D core pass (CORE_ALPHA 0.90 — a bright disc
                         dims smoothly through the blend before the cut
                         can bite); the starfield; the generated sun
                         (round disc in a rim-windowed additive glow,
                         linear-filtered), the moon's cool halo glow, and
                         the eight-phase ROUND moon (AA disc, seeded
                         maria + craters shared by every phase, soft
                         elliptical terminator, faint earthshine dark
                         side) — split from lighting.js per the size cap
    particles.js         the particle system (Phase 22): ONE fixed, capped,
                         pooled simulation drawn in two instanced draw calls
                         — textured cubes cropped from a block's own atlas
                         tile (break debris, footstep scuffs, landing
                         bursts) and flat coloured cubes (smoke, embers,
                         splashes, damage, death puffs, sparkles, portal
                         swirls). Module-level `particles` singleton; every
                         call before init() is a no-op
    item_art.js          generated 16x16 sprites for items this project
                         ships no texture for (Phase 21: the five hoes, the
                         shield, door/trapdoor/sign/bed/frame/pot) — the
                         established generated-art pattern, consumed through
                         entities/items.js like every other item visual

  player/
    gamemode.js          SURVIVAL vs CREATIVE (Phase 25): a module singleton
                         on the particles/audio pattern. Every creative rule
                         is one gate in the system that already owns it —
                         stats (invulnerable), inventory (infinite stacks, no
                         tool wear), interaction (instant break), body
                         (flight), mobs/dragon (ignored), hud (no bars),
                         screens (E opens ui/creative.js). Switching only
                         flips a flag, which is what makes a live switch cost
                         nothing and lose nothing
    controller.js        pointer-lock input, key bindings, the first-person
                         camera (bob, eye heights, FOV kick), fly mode, and
                         the creative double-tap-space flight toggle
    body.js              PlayerBody + findSpawnPosition (Phase 21 split out
                         of controller.js per the size cap — moved verbatim):
                         the AABB physics, swept collision against every
                         block's COLLISION BOX LIST, the ladder climb, and
                         (Phase 25) the creative FLIGHT integrator, which
                         replaces gravity with a chased velocity but keeps
                         the same swept collision. `body.flying` is a plain
                         field the controller sets — this file deliberately
                         does NOT import gamemode.js, so it stays DOM-free
                         and node-constructible, by design
    placement.js         block placement rules (Phase 21 split out of
                         interaction.js per the size cap): where a block may
                         go, the two-cell pieces (doors, beds), slab
                         stacking, and the wall/floor support rules
    interaction.js       raycast, break, place, block outline
    fluid_actions.js     bucket scoop/place + glass-bottle filling (Phase
                         19 split out of interaction.js per the size cap —
                         moved verbatim, the mandated cut)
    hand.js              first-person hand: its own render pass, arm and
                         held-item meshes, swing/eat/draw poses (Phase 13
                         split out of interaction.js per the size cap)
    inventory.js         slots, hotbar, stacking, item data, armour slots
    stats.js             health, hunger, damage, respawn

  entities/
    entity.js            base entity, physics, despawn; flying types
                         (Phase 16: the ghast skips gravity while alive)
    registry.js          the MOB_TYPES registry: per-mob stats and drops
                         (Phase 15 split out of mobs.js per the size cap)
    pathfinding.js       A* over world blocks
    models.js            mob models from textured boxes: standard entity
                         unwrap, animation rigs (Phase 12 addition); the
                         per-mob box-geometry tables converted from the
                         real vanilla models (Phase 13 — stats stay in
                         mobs.js, geometry lives here); multi-box parts,
                         overlay models and the passive herd tables
                         (Phase 14)
    mobs.js              mob registry (stats/drops), hostile AI, the
                         manager + animation dispatch
    spawning.js          the natural-spawning framework (Phase 14 split
                         out of mobs.js per the Phase 13 cap note)
    passive.js           passive-herd behaviour: wander/flee AI, sheep
                         shear + wool regrow, chicken eggs, quadruped/
                         chicken animation (Phase 14 addition)
    ender_pearl.js       thrown ender pearls (Phase 22): the gravity arc,
                         the sub-stepped sweep that can't tunnel, and the
                         teleport-on-landing with its 2.5 hearts
    ghast.js             ghast behaviour: flying wander, fireball attack,
                         tentacle animation (Phase 16 split out of mobs.js
                         per the size cap — the passive.js injection
                         pattern)
    skeleton.js          skeleton behaviour: keep-distance AI + the
                         draw-and-release firing cycle (Phase 17 split out
                         of mobs.js per the size cap, moved verbatim — the
                         injection pattern)
    blaze.js             blaze behaviour (Phase 17): hover, the
                         charge/volley-of-3 fireball cycle (Phase 18
                         retuned to the real values), the orbiting
                         rod-ring animation (the injection pattern)
    enderman.js          enderman behaviour (Phase 18): stare-to-aggro,
                         blink teleports, water damage, the creepy pose
                         (the injection pattern)
    ender_eye.js         thrown eyes of ender (Phase 18): fly toward the
                         stronghold, hover, drop back or shatter
    crystals.js          end crystals (Phase 20): the spinning cage/core
                         displays on the pillar seats, the mob-shaped
                         combat facades, hit-to-explode
    dragon.js            the ender dragon fight (Phase 20): the driven
                         model skeleton, circling/strafing/perching AI,
                         head/body damage rules, crystal healing, breath
                         + wing knockback, the death sequence,
                         exit-portal activation, the victory trigger —
                         all gated to the End dimension under one scene
                         group
    dragon_fx.js         the fight's visual effects (Phase 20 split out
                         of dragon.js per the size cap): the healing
                         beam, breath particle cloud, death light show,
                         the dragon-egg trophy — behaviour-free, the
                         fight decides when
    items.js             dropped item entities, pickup; item visuals
                         (mini-blocks, sprites, extruded slabs, Phase 18
                         tinted potion bottles)
    falling.js           falling sand/gravel entities (Phase 9 addition)

  systems/
    audio.js             ALL sound (Phase 22), synthesised with the Web
                         Audio API — no files ship and none load. One
                         AudioContext, a layered-voice synth (each sound is
                         2-4 oscillator/noise components), a bus compressor,
                         distance falloff + stereo pan from the camera, a
                         voice budget, and the sound catalogue. Module-level
                         `audio` singleton; dimensions/portals.js and
                         systems/combat.js both route through it.
                         Phase 23 owns the PAUSE: `audio.setPaused()` suspends
                         and resumes the whole AudioContext (main.js calls it
                         every frame), and `tryResume()` is the ONE place any
                         module may un-suspend it, so a sound emitted behind
                         the pause overlay cannot restart the audio thread
    ambience.js          continuous, position-driven feel (Phase 22): the
                         player's footsteps/landing/splash/bubbles, vanilla's
                         randomDisplayTick over cells near the player (torch
                         flames, lava embers and pops, glowstone sparkles,
                         end-portal swirls + hum), the looping water/lava
                         ambience beds and the rare underground cave tone.
                         Purely reactive — it reads state, never writes it
    commands.js          chat commands (Phase 27, split out of main.js at
                         birth per the size cap): /tp <x> <z> lands the
                         player at a SAFE spot — the surface in open-sky
                         worlds (floated to the sea surface over deep
                         water), a scanned interior spot under the Nether
                         ceiling, a refusal over the End's void — and
                         /tp <x> <y> <z> goes exactly there. `notify` is
                         injected (hud's showToast) so the dependency
                         direction stays downward
    crafting.js          recipes, grid matching
    smelting.js          furnace logic, fuel
    brewing.js           brewing stand (Phase 18): the 5-slot BrewingStand
                         state machine (bottles/ingredient/blaze-powder
                         fuel), the SPEC potion recipe table, the
                         per-position stand map (the smelting.js shape)
    combat.js            damage, knockback, armour (Phase 13): player
                         melee with weapon cooldowns and crits, the
                         armour damage pipeline, explosions (per-blast
                         radii as of Phase 16), the Phase 21 SHIELD (a
                         raised guard negates frontal hits), the
                         procedural hiss/boom synth. Mob managers receive
                         it injected via main.js (combat never imports
                         the mob manager)
    arrows.js            arrow projectiles and the bow draw (Phase 21: the
                         cut the size cap has mandated since Phase 17,
                         moved verbatim — the crossed-quad model, the
                         gravity arc, block sticking, pick-up, and the
                         draw/release cycle)
    fireballs.js         ghast fireball projectiles: straight-line flight,
                         explode on hit, melee-deflectable (Phase 16 split
                         out of combat.js per the size cap; combat injects
                         its deps, so the pair stays cycle-free)

  dimensions/
    dimensions.js        multiple worlds in memory: swaps the single World
                         instance's backing store + every entity manager's
                         collections per dimension (Phase 15 addition)
    portals.js           nether portal: frame detection, flint-and-steel
                         lighting, stand-to-travel with 1:8 scaling, linked
                         portal reuse/creation, particles + ambience
                         (Phase 15)
    nether.js            the real Nether generator (Phase 16): shaped 3D
                         density field between bedrock floor and ceiling —
                         caverns, lava oceans, floating formations, soul
                         sand, glowstone, quartz; Phase 17 runs the
                         fortress pass last
    fortress.js          nether fortresses (Phase 17; Phase 18 grown to
                         the real sprawling scale): region-seeded
                         blueprints — an enclosed keep of rooms around
                         the heart, long bridge/corridor runs, crossings,
                         staircase galleries between deck levels, tall
                         terminal blaze towers and wart rooms — emitted
                         per chunk deterministically, with support piers
                         down to ground/lava
    end.js               the End, complete (Phase 20 rebuild): the
                         central end-stone island over void, the ten
                         obsidian pillars with crystal seats, the exit
                         portal fountain, the obsidian arrival platform;
                         pillars()/exitPortalCells()/fountainTop() are
                         the layout truth the dragon fight shares
    stronghold.js        stronghold generation (Phase 19): the seeded
                         blueprint anchored to strongholdCenter (the
                         eye-of-ender target since 18) — corridors,
                         staircases, libraries, storage rooms, the one
                         portal room — emitted per chunk as the
                         overworld's last generation pass; plus the
                         end-portal runtime (frame filling, activation,
                         fall-in travel to the End)

  ui/
    hud.js               hotbar, health, hunger, crosshair, potion-effect
                         indicator (Phase 18), and the Phase 25 game-mode
                         badge (bottom-right; the survival stat rows hide
                         wholesale in creative)
    menus.js             the Phase 25 START SCREEN (Survival / Creative, up
                         before anything is playable) and the PAUSE MENU (Esc
                         — the current mode and a button to switch to the
                         other). The pause overlay is pointer-events: none
                         except for its panel, so a click anywhere else still
                         falls through to the canvas and resumes play
    chat.js              the Phase 27 CHAT BAR: T (or '/', pre-filled)
                         opens a single-line input at vanilla's chat spot;
                         the game KEEPS RUNNING while it is open (the
                         sign-editor rule — pointer releases, main.js's
                         pause verdict consults isOpen), Enter hands the
                         line to systems/commands.js, Escape cancels,
                         ArrowUp recalls history, either way the pointer
                         relocks. Owns only the DOM and key routing —
                         never a game rule. Tunables in config CHAT
    creative.js          the Phase 25 CREATIVE INVENTORY: the tabbed
                         catalogue of every block and item (building blocks,
                         decoration, tools, combat, food, materials,
                         miscellaneous), the cross-tab search field, and the
                         click / right-click / drag gestures that build a
                         fresh stack out of nothing every time. The
                         catalogue table is UI data and lives here, the way
                         per-block data lives in world/blocks.js
    screens.js           the screen panel/cursor/slot machinery, the
                         inventory + crafting screens, death, victory
                         (Phase 20 — the win condition's screen);
                         opens the container screens below. Owns the ONE E
                         key: in creative it routes to ui/creative.js
                         instead of the survival inventory
    containers.js        the block-container screen SECTIONS — chest,
                         furnace, brewing stand — and their indicator art
                         (Phase 18 split out of screens.js per the size
                         cap)
    icons.js             item icons for hud/screens: assets/items sprites,
                         isometric atlas-rendered block cubes (Phase 7
                         split), tinted potion bottles (Phase 18)
    debug.js             fps, coords, chunk count

assets/
  block_atlas.png        real Java Edition textures
  entity/                mob textures

docs/
  SPEC.md                what we're building
  ARCHITECTURE.md        this file
  PROGRESS.md            what's built, what's broken
```

---

## Rules

**One responsibility per file.** If you're adding mob spawning, it goes in `mobs.js`,
not wherever is convenient.

**One shape, one source.** A block's collision boxes and its rendered boxes
come from the SAME table (`world/shape_tables.js`). Never write a shape twice:
if the mesher and the physics ever disagree, players walk into thin air.

**No file over ~800 lines.** If one is growing past that, split it and note the split
in this document. Phase 27 added TWO new files (`ui/chat.js` 129,
`systems/commands.js` 95 — the command logic split out of main.js AT BIRTH:
the chat wiring had taken main to 875, and moving /tp into its own system
brought it back to 802, sitting right on the tilde; **if main.js grows
again, the beds block — trySleep/updateSleep — is its next natural cut**).
`world/world.js` is 426 after the streaming idle/resume work and
`world/chunks.js` 627 after the light-data tier gate, both comfortably
under. Phase 26 added FOUR new files (`world/spawn_scan.js` 130,
`world/surface_rules.js` 112, `render/post_fx.js` 354, `render/water_fx.js`
152) and made ONE cut the same session: the spawn scan and LOD additions took
`world/terrain.js` 792 → 814, so the Phase 24 surface rules moved verbatim to
`world/surface_rules.js` (terrain is 728 now; the A/B generated byte-identical
chunks). Every other file Phase 26 touched stayed under: `world/chunks.js`
617, `world/world.js` 365, `render/lighting.js` 735, `render/sky_fx.js` 417,
`render/particles.js` 670, `systems/ambience.js` 301, `player/body.js` 784,
`src/main.js` 780, `dimensions/stronghold.js` 630. The three standing
over-cap debts are unchanged — `entities/dragon.js` (884, the rig cut),
`world/emitters.js` (829, the small-box emitters) and `world/blocks.js`
(915, the lookups tail) — and none of them was touched. Phase 25 added THREE new files rather than growing any
(`player/gamemode.js` 96, `ui/menus.js` 242, `ui/creative.js` 528) and left
every file it edited under the cap: `ui/hud.js` 777 (mode badge + the
survival-bar gate), `ui/screens.js` 752 (the E route), `player/interaction.js`
780, `player/body.js` 775 (the flight integrator), `player/inventory.js` 660,
`player/stats.js` 541, `player/controller.js` 300, `src/main.js` 749 (the test
chest coming out paid for the menu wiring). `entities/dragon.js` (884) is
still the only file over the cap and still carries the mandated rig cut;
`world/emitters.js` (829) and `world/blocks.js` (915) still carry theirs.
Phase 24 grew three files past the cap and cut two of them
back the same session: `world/terrain.js` (the rivers/surface-rules/vegetation
pass took it 546 → 868) gave up its seeded 2D noise machinery to
`world/terrain_noise.js` (124, moved verbatim — terrain is 751 now), and
`world/caves.js` (863 after the contained-pool rebuild) finally made the
ore/vein cut its own note has mandated since Phase 23 — `world/ores.js` (100,
byte-identical PRNG streams; caves is 786 again, still with no room to grow:
**its next cut is the underground-water/shore-bank passes**). Phase 24 also
added `world/plants.js` (66) and `render/sky_fx.js` (287) as new files rather
than growing blocks.js/lighting.js past their states. Two files now sit just
over the cap and carry the next mandated cuts: `world/emitters.js` (829 after
the cross-plane emitter — **cut the Phase 19 small-box emitters:
brewing stand, bars, end frame, end portal**) and `world/blocks.js` (915 —
**the lookups tail below buildShapeTables is the natural cut**), joining
`entities/dragon.js` (878, rig cut still outstanding). Phase 23 added two files rather than growing any
(`world/caverns.js` 297 for the great-cavern pass, `world/fluid_families.js`
94 for blocks.js's long-mandated fluid cut) and took `world/blocks.js` back
UNDER the cap for the first time since Phase 21 — it was 908, the deepslate
set would have made it 967, and the fluid families coming out leave it at 901.
`world/caves.js` is 786 after gaining the water springs, the gravel/clay banks
and the rebuilt lava placement (and losing the MEGA layer): under, but with no
room left — **its next growth must take the ore/vein passes out**.
`systems/audio.js` is 761 after the sound retune, and `entities/dragon.js`
(878) is now the ONLY file over the cap — its rig cut, below, is the last one
outstanding. Phase 22 added four files rather than growing any (render/
particles.js 655, systems/audio.js 646, systems/ambience.js 288,
entities/ender_pearl.js 178) and deliberately did NOT touch the two files
then over the cap. systems/combat.js lost its private
WebAudio helpers to systems/audio.js and is 513 now. Phase 21 made five cuts: the long-mandated
`systems/arrows.js` out of combat.js (which is 572 now, finally under),
`player/placement.js` out of interaction.js (745), `player/body.js` out of
controller.js (259), and `world/shapes.js` + `world/shape_tables.js` out of
blocks.js. Current state of the cap: `config.js` is exempt (it is the
constants registry — splitting it would scatter the single source of tunables);
`player/interaction.js` got its hand split in Phase 13 (`player/hand.js`)
and its mandated fluid-actions split in Phase 19 (`player/fluid_actions.js`,
moved verbatim — the bucket/bottle actions; interaction is ~765 now);
`entities/mobs.js` got its MOB_TYPES split in Phase 15 (`entities/registry.js`),
its ghast split in Phase 16 (`entities/ghast.js`), its mandated skeleton
split in Phase 17 (`entities/skeleton.js`, moved verbatim), and Phase 19
moved the spawn-profile machinery into `entities/spawning.js` (its natural
home) — ~758 now;
`systems/combat.js` got its fireball split in Phase 16 (`systems/fireballs.js`)
and its long-mandated ARROW split in Phase 21 (`systems/arrows.js`, moved
verbatim as the session's first move before the shield landed in it) —
572 now, under the cap for the first time since Phase 13;
`player/controller.js` got its physics split in Phase 21 (`player/body.js`:
PlayerBody + findSpawnPosition, moved verbatim; controller is 259);
`world/caves.js` split its noise machinery into `world/noise.js` in Phase 15
(the mega-cavern pass would have pushed it past the cap; ~640 now);
`world/chunks.js` got its mandated split in Phase 17 (`world/emitters.js`:
the per-block mesher tables, the FACES geometry table and the special-shape
emitters — torch/lava/portal/wart; moved with a byte-identical A/B check;
chunks.js is ~495 now);
`player/interaction.js` also gave up its placement rules in Phase 21
(`player/placement.js` — the single-cell path moved verbatim, joined by the
two-cell and support rules; interaction is 745);
`ui/screens.js` got its mandated split in Phase 18 (`ui/containers.js`:
the chest/furnace/brewing container sections + indicator art; screens.js
keeps the panel/cursor/slot machinery and is ~670 now — Phase 20's victory
screen brings it to ~736, still under);
`entities/dragon.js` split its visual effects out at birth in Phase 20
(`entities/dragon_fx.js`: healing beam, breath particles, death light
show, the egg — crystals live in their own `entities/crystals.js` from
the start); Phase 21's perch pose and allocation-free hitboxes bring it to
878 — OVER, and **the rig (spawnDragon/attach/layoutChain/animate plus the
two local<->world transforms) is the mandated cut before anything else
lands in it**;
`world/blocks.js` gave up the whole Phase 21 building set to
`world/shapes.js` (registrations) and `world/shape_tables.js` (the box
tables), and in Phase 23 made its mandated FLUID cut to
`world/fluid_families.js` — the lava/water id tables and their predicates,
moved verbatim, taking BLOCK/BLOCKS as arguments exactly the way shapes.js
takes `register` so the import cycle never bites. It re-exports all ten
symbols, so nothing else changed an import. 901 now, under the cap for the
first time since Phase 21 even after the deepslate set landed in it.

**Three module singletons, imported directly.** Anything that wants a particle
or a sound imports `particles` (render/particles.js) or `audio`
(systems/audio.js) and calls it; anything that needs to know whether the game
is in survival or creative imports `gamemode` (player/gamemode.js) and asks it.
No wiring through factories — the CHUNK_LIGHT_UNIFORMS pattern. `gamemode`
joined them in Phase 25 for the same reason the other two exist: a dozen
unrelated systems each need one boolean, and threading it through every
constructor would have meant editing every factory signature in the project to
say one thing. player/body.js is the deliberate exception — it takes
`body.flying` as a field so the physics stays importable in node. Both are inert until main.js initialises them, which is what keeps
node-testable modules (player/body.js, entities/entity.js) free of three.js:
those two deliberately emit NOTHING, and their feedback is edge-detected by
their managers instead (entities/mobs.js watches mob health, systems/ambience.js
watches the player body).

**All constants in `config.js`.** Gravity, walk speed, mob caps, chunk size, view
distance, day length. Never hardcode a tunable number inline.

**Systems talk through `world.js` and `main.js`.** Don't import mobs into terrain or
UI into physics. Keep the dependency direction flowing downward.

**Never break the running game.** If a feature isn't finished, leave it disabled
rather than half-wired. The game must load and play at the end of every session.

---

## Running it

ES modules don't load from `file://`. From the project root:

```
python3 -m http.server
```

Then open `http://localhost:8000`.

Deploys to GitHub Pages unchanged.

---

## Adding a block

1. Add to the registry in `world/blocks.js` with hardness, tool, drops
2. Add its texture to the atlas and register the tile index in `render/atlas.js`
3. If it is not a full cube, give it a `shape` (and, when the physics box
   differs, a `collision`) in `world/shapes.js` and mark it
   `special: 'shape'` — the generic emitter and the collision sweep both read
   that ONE table, so there is nothing else to write. Register its id in
   `SHAPED_BLOCK_IDS` there too.
4. If it has behaviour (falls, damages, emits light), handle it in the relevant system
5. If it's craftable, add the recipe to `systems/crafting.js`
6. If it stores state (text, contents), give it a block-entity module in
   `world/` on the chests.js/signs.js pattern and add it to main.js's
   listener list AND the dimension managers list

## Adding a mob

1. Define it in `entities/mobs.js` with stats from SPEC.md
2. Build its model from boxes using the real entity texture
3. Give it an AI state machine — idle, pursue, attack, flee
4. Register spawn conditions
5. Add drops
