# ATLAS MAP

Tile indices in `assets/block_atlas.png`. 16x16 grid, 16px tiles.
Index = row * 16 + column, row-major from top-left.

**Do not renumber these.** The game code references them directly.

**The atlas is GENERATED.** `python3 tools/gen_block_atlas.py` writes it:
every tile 0-68 is original pixel art authored procedurally in the vanilla
idiom (a few hand-picked shades per material, deterministic hash noise that
wraps at the tile edge, string-art sprites for the cutouts), so the file is
reproducible byte for byte and nothing in it is copied from any texture
pack. Edit the generator, not the PNG; `--sheet out.png` renders a zoomed
contact sheet for eyeballing a change. The generator keeps the conventions
the meshes and tint depend on — grass top / leaves / plants painted green
for the biome tint to multiply, cactus insets, the 13px portal frame side,
water at alpha 180.

Indices 0-57 keep the layout of the first atlas.
Indices 58-68 are deepslate variants and ground plants.

**Generated tiles.** Indices at the free tail of the grid are painted into the
loaded atlas at boot by `render/atlas.js` — art this project ships no texture
for, on the same pattern `render/item_art.js` uses for item sprites. They are
listed below with the shipped tiles because everything downstream (the chunk
mesher, the HUD, item icons, particles) samples ONE atlas by tile index and
cannot tell the difference. Note that index 58 previously held the generated
end-portal-frame-with-eye art; the deepslate atlas overwrote it, so that tile
moved to 69 rather than renumbering anything.

| Index | Texture | Status |
|---|---|---|
| 0 | grass_block_top | ok |
| 1 | grass_block_side | ok |
| 2 | dirt | ok |
| 3 | stone | ok |
| 4 | cobblestone | ok |
| 5 | sand | ok |
| 6 | gravel | ok |
| 7 | oak_log | ok |
| 8 | oak_log_top | ok |
| 9 | oak_planks | ok |
| 10 | oak_leaves | ok |
| 11 | water_still | ok |
| 12 | bedrock | ok |
| 13 | sandstone | ok |
| 14 | sandstone_top | ok |
| 15 | glass | ok |
| 16 | coal_ore | ok |
| 17 | iron_ore | ok |
| 18 | gold_ore | ok |
| 19 | redstone_ore | ok |
| 20 | diamond_ore | ok |
| 21 | obsidian | ok |
| 22 | lava_still | ok |
| 23 | cactus_side | ok |
| 24 | cactus_top | ok |
| 25 | torch | ok |
| 26 | crafting_table_top | ok |
| 27 | crafting_table_front | ok |
| 28 | crafting_table_side | ok |
| 29 | furnace_front | ok |
| 30 | furnace_front_on | ok |
| 31 | furnace_side | ok |
| 32 | furnace_top | ok |
| 33 | netherrack | ok |
| 34 | soul_sand | ok |
| 35 | nether_bricks | ok |
| 36 | glowstone | ok |
| 37 | nether_quartz_ore | ok |
| 38 | nether_wart_stage2 | ok |
| 39 | end_stone | ok |
| 40 | end_portal_frame_top | ok |
| 41 | end_portal_frame_side | ok |
| 42 | stone_bricks | ok |
| 43 | mossy_stone_bricks | ok |
| 44 | cracked_stone_bricks | ok |
| 45 | bookshelf | ok |
| 46 | iron_bars | ok |
| 47 | spawner | ok |
| 48 | brewing_stand | ok |
| 49 | white_wool | ok |
| 50 | fire_0 | ok |
| 51 | granite | ok |
| 52 | diorite | ok |
| 53 | andesite | ok |
| 54 | iron_block | ok |
| 55 | gold_block | ok |
| 56 | diamond_block | ok |
| 57 | coal_block | ok |
| 58 | deepslate | ok |
| 59 | cobbled_deepslate | ok |
| 60 | deepslate_coal_ore | ok |
| 61 | deepslate_iron_ore | ok |
| 62 | deepslate_gold_ore | ok |
| 63 | deepslate_redstone_ore | ok |
| 64 | deepslate_diamond_ore | ok |
| 65 | short_grass | ok |
| 66 | dandelion | ok |
| 67 | poppy | ok |
| 68 | dead_bush | ok |
| 69 | end_portal_frame_eye | generated at boot (frame top + the eye) |
| 70 | clay | generated at boot (Phase 23 cave-floor clay banks) |
