# PROGRESS

Updated at the end of every session. Read at the start of every session.

**If something is listed as WORKING, do not rewrite or refactor it. Build on it.**

---

## Status

Phase last completed: **Phase 1 — scaffolding and a visible 3D scene**

---

## Working

- `index.html` — importmap pinned to three@0.160.0 (unpkg), fullscreen canvas,
  pointer-lock hint overlay.
- `src/config.js` — all SPEC-implied global tunables: world dimensions, chunks,
  view distance, terrain/cave/ore ranges, player physics and stats, tool tiers,
  weapon damage, armour, mob spawn rules, item drops, day length, lighting,
  sky/fog colours per dimension, render settings, atlas layout, portal numbers,
  dragon numbers, debug camera.
- `src/render/renderer.js` — WebGLRenderer with ACESFilmicToneMapping,
  SRGBColorSpace output, PCFSoftShadowMap, pixel-ratio clamp, window resize
  handler; perspective camera factory.
- `src/render/atlas.js` — loads `assets/block_atlas.png` with NearestFilter
  (no mipmaps), full `TILE` registry mirroring docs/ATLAS_MAP.md (indices 0–57),
  `getUV(tileIndex)` with a small inset against tile bleeding.
- `src/render/lighting.js` — sky dome shader with a 4-stop vertical gradient
  (below-horizon, horizon, mid, zenith) that goes through the renderer's tone
  mapping so fog (matched to the horizon colour) blends terrain into the sky
  exactly; shadow-casting directional sun; hemisphere ambient.
- `src/ui/debug.js` — FPS counter (smoothed) plus camera coordinates overlay.
- `src/main.js` — game loop on `setAnimationLoop` with clamped delta time;
  test scene: 16x16 grass ground, oak tree with cutout leaves, showcase rows of
  ~25 block types with correct per-face tiles (grass top/side/dirt, log ends,
  crafting table front, furnace faces); per-face brightness (top 1.0 / side 0.8 /
  bottom 0.5) baked as vertex colours; free-fly debug camera (click for pointer
  lock, WASD + Space/Shift, Ctrl for fast, mouse look).

Verified in headless Chromium: loads with zero console errors, renders textured
cubes with sun shadows, sky gradient and fog, FPS counter updates, resize works,
pointer lock + WASD/Space movement and mouse look work.

---

## Partially built

- The rest of `src/` exists as empty stub modules with responsibility headers
  (world/, player/, entities/, systems/, dimensions/, ui/hud.js, ui/screens.js,
  render/lighting.js only does Phase 1 sky/sun — block-light propagation and AO
  still to come).

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

- The test scene in `main.js` (cube builder, `buildTestScene`, fly controls) is
  temporary scaffolding. Phase 2 (chunked terrain + meshing in `world/chunks.js`
  / `world/terrain.js`) replaces it; the per-face UV + vertex-colour approach in
  `createBlockGeometry` is the pattern the chunk mesher should reuse.
- `render/atlas.js` `getUV` returns `{u0, v0, u1, v1}` in flipY UV space
  (v0 = tile bottom). BoxGeometry face order is px, nx, py, ny, pz, nz with
  4 verts per face — see `createBlockGeometry` for the corner mapping.
- Atlas textures are pre-tinted (grass top and leaves are already green);
  leaves need `alphaTest` (cutout), water/lava tiles exist but translucency is
  not built yet.
- Free-fly camera speed/sensitivity and all sky/fog colours are in `config.js`.

---

## Session log

| Phase | What was built | Left incomplete |
|---|---|---|
| 1 | index.html, config.js, renderer/atlas/sky+fog/debug overlay, lit textured test scene, fly camera, full stub tree | Everything beyond rendering: world gen, chunks, player physics, interaction, mobs, systems, dimensions, HUD |
