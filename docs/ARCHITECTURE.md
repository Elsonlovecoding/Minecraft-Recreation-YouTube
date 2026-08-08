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
    chunks.js            chunk data, meshing, face culling; special
                         emitters (torch, lava flow, Phase 15 portal)
    chests.js            chest block entities: contents + entity-textured
                         box model + lid animation (Phase 10 addition)
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
    hand.js              first-person hand: its own render pass, arm and
                         held-item meshes, swing/eat/draw poses (Phase 13
                         split out of interaction.js per the size cap)
    inventory.js         slots, hotbar, stacking, item data, armour slots
    stats.js             health, hunger, damage, respawn

  entities/
    entity.js            base entity, physics, despawn
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
    dragon.js            ender dragon fight
    items.js             dropped item entities, pickup
    falling.js           falling sand/gravel entities (Phase 9 addition)

  systems/
    crafting.js          recipes, grid matching
    smelting.js          furnace logic, fuel
    brewing.js           brewing stand
    combat.js            damage, knockback, armour (Phase 13): player
                         melee with weapon cooldowns and crits, the
                         armour damage pipeline, bow + arrow projectiles,
                         explosions, the procedural hiss/boom synth.
                         Mob managers receive it injected via main.js
                         (combat never imports the mob manager)

  dimensions/
    dimensions.js        multiple worlds in memory: swaps the single World
                         instance's backing store + every entity manager's
                         collections per dimension (Phase 15 addition)
    portals.js           nether portal: frame detection, flint-and-steel
                         lighting, stand-to-travel with 1:8 scaling, linked
                         portal reuse/creation, particles + ambience
                         (Phase 15)
    nether.js            nether generation, fortress (Phase 15 ships a flat
                         placeholder generator; the real Nether replaces it
                         behind the same interface)
    end.js               end island, pillars, crystals
    stronghold.js        stronghold generation, end portal room

  ui/
    hud.js               hotbar, health, hunger, crosshair
    screens.js           inventory, crafting, furnace, death, victory
    icons.js             item icons for hud/screens: assets/items sprites,
                         isometric atlas-rendered block cubes (Phase 7 split)
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
`player/interaction.js` got its mandated split in Phase 13 (the first-person
hand lives in `player/hand.js` now; ~740 after the Phase 14 offhand);
`entities/mobs.js` got its mandated MOB_TYPES split in Phase 15
(`entities/registry.js`; mobs.js is ~770 after the skeleton-cycle fix);
`world/caves.js` split its noise machinery into `world/noise.js` in Phase 15
(the mega-cavern pass would have pushed it past the cap; ~640 now);
`world/chunks.js` sits exactly AT ~800 after the Phase 15 portal emitter —
the next session that grows it must split (the special-shape emitters —
torch/lava/portal — are the natural cut);
`ui/screens.js` sits at ~810 as of Phase 14 (preview + offhand slot) — the
brewing-stand screen should split the container screens out.

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
