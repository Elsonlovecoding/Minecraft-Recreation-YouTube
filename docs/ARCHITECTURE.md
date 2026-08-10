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
    blocks.js            block registry: ids, textures, hardness, drops
    terrain.js           noise, heightmap, biomes, trees
    noise.js             seeded simplex/fbm/Field3D machinery for the
                         carver (Phase 15 split out of caves.js per the
                         size cap — moved verbatim, byte-identical output)
    caves.js             cave carving (tunnels, caverns, Phase 15 mega
                         caverns + waterfall springs), ore placement, lava
                         placement
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
    fluids.js            flowing lava: budgeted spread/fall/recede automaton
                         over block-change events (Phase 12 addition);
                         water+lava hardening to obsidian/cobble (Phase 15)
    world.js             chunk manager, get/set block, loading, block-change
                         listeners, getLight point queries, dimension
                         backing-store swap (Phase 15)

  render/
    renderer.js          Three.js setup, tone mapping, shadows, post
    atlas.js             texture atlas loading and UV lookup
    lighting.js          light propagation, AO, day/night

  player/
    controller.js        movement, physics, collision, camera
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
    crafting.js          recipes, grid matching
    smelting.js          furnace logic, fuel
    brewing.js           brewing stand (Phase 18): the 5-slot BrewingStand
                         state machine (bottles/ingredient/blaze-powder
                         fuel), the SPEC potion recipe table, the
                         per-position stand map (the smelting.js shape)
    combat.js            damage, knockback, armour (Phase 13): player
                         melee with weapon cooldowns and crits, the
                         armour damage pipeline, bow + arrow projectiles,
                         explosions (per-blast radii as of Phase 16), the
                         procedural hiss/boom synth. Mob managers receive
                         it injected via main.js (combat never imports
                         the mob manager)
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
                         indicator (Phase 18)
    screens.js           the screen panel/cursor/slot machinery, the
                         inventory + crafting screens, death, victory
                         (Phase 20 — the win condition's screen);
                         opens the container screens below
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

**No file over ~800 lines.** If one is growing past that, split it and note the split
in this document. Current state of the cap: `config.js` is exempt (it is the
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
and sits at 808 (untouched in Phase 19) — the ONLY file still OVER, and the
arrow machinery is the long-standing mandated cut before anything lands
in it;
`world/caves.js` split its noise machinery into `world/noise.js` in Phase 15
(the mega-cavern pass would have pushed it past the cap; ~640 now);
`world/chunks.js` got its mandated split in Phase 17 (`world/emitters.js`:
the per-block mesher tables, the FACES geometry table and the special-shape
emitters — torch/lava/portal/wart; moved with a byte-identical A/B check;
chunks.js is ~495 now);
`ui/screens.js` got its mandated split in Phase 18 (`ui/containers.js`:
the chest/furnace/brewing container sections + indicator art; screens.js
keeps the panel/cursor/slot machinery and is ~670 now — Phase 20's victory
screen brings it to ~736, still under);
`entities/dragon.js` split its visual effects out at birth in Phase 20
(`entities/dragon_fx.js`: healing beam, breath particles, death light
show, the egg — dragon.js is ~780, crystals live in their own
`entities/crystals.js` from the start).

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
3. If it has behaviour (falls, damages, emits light), handle it in the relevant system
4. If it's craftable, add the recipe to `systems/crafting.js`

## Adding a mob

1. Define it in `entities/mobs.js` with stats from SPEC.md
2. Build its model from boxes using the real entity texture
3. Give it an AI state machine — idle, pursue, attack, flee
4. Register spawn conditions
5. Add drops
