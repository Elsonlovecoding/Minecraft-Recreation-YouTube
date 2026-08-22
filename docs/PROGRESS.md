# PROGRESS

Updated at the end of every session. Read at the start of every session.

**If something is listed as WORKING, do not rewrite or refactor it. Build on it.**

---

## Status

**THE PROJECT IS COMPLETE.**

Phase last completed: **Phase 27 — SMOOTH STREAMING, CHAT + /tp** (same-
session follow-ups: REALISTIC CLOUDS + MOONLIGHT, the ROUND MOON, and the
final view-ring retune — **25 chunks guaranteed around the player**, see
the FINAL RETUNE block below).

### Phase 27 — more distance, less hitching, and a chat bar

**RENDER DISTANCE 30 -> 40 chunks (640 blocks),** with the cost curve bent
so it stays playable:
- Measured over the full ring (node, real generator + mesher): full detail
  would be 25.09M tris / 2058 MB of geometry; **with the LOD tiers it is
  10.22M tris / 838 MB (-59%)** — fewer triangles than the old
  fully-detailed r=20 ring drew. Fog pushed out to match (460/680, the
  same clear fraction of the view); the golden-hour haze bounds unchanged.
- **Far chunks stopped storing light data** (`chunks.js`): the 98KB
  per-chunk packed light array now exists only for full-detail chunks.
  Every consumer lives well inside the detail radius (mob spawning reaches
  96 blocks, the dust tick 10, the cave tone 0) and spawning already
  treats missing light as "no spawn". ~420 MB saved at r=40, and every
  far mesh skips a 98K-cell copy loop.

**"Don't be laggy when I move around"** — the streaming hitches came from
four places, each addressed (`world/world.js`, config STREAMING/VIEW.LOD):
- **The idle scan is GONE.** A full pass that finds nothing to do parks
  the streamer; any setBlock (the one dirty-path), a chunk-border crossing
  or a dimension swap wakes it. A parked frame costs 0.0004 ms (measured);
  before, every frame walked the whole candidate ring — 6889 string-keyed
  Map lookups at r=40 — for nothing.
- **Passes resume where they left off.** Work is nearest-first, so the
  completed near region only grows; the scan starts at the first offset
  the previous pass left incomplete instead of re-checking thousands of
  finished chunks (reset on edits/movement, when work can appear behind it).
- **Tier remeshes trickle.** Crossing a chunk border wants a whole arc of
  LOD promotions at once; they're capped at RETIER_PER_PASS (2) per pass
  now — missing and dirty meshes keep the full budget — and HYSTERESIS
  went 2 -> 3 so the boundary re-tiers fewer chunks per crossing.
- **The per-frame budget dropped 8 -> 6 ms** — 8ms of meshing on top of
  the render was itself a visible hitch at 60fps; the ring fills a touch
  slower instead.
  Verified in node with the real World: ring settles to idle, an edit
  wakes it and it re-settles in a handful of frames, a 10-chunk move
  re-tiers and settles, tiers land on the right side of the hysteresis
  band; and in the browser the whole session runs with zero game console
  errors.

**CHAT + /tp** (`ui/chat.js` + `systems/commands.js`, config CHAT):
- **T opens the chat bar** ('/' opens it with the slash already typed) at
  vanilla's bottom-left spot. The game KEEPS RUNNING while it is open —
  the sign-editor rule: pointer lock releases, main.js's pause verdict
  consults `chat.isOpen`, keys never leak into the game (stopPropagation),
  Enter submits, Escape cancels, ArrowUp/Down recall history, and the
  pointer relocks on close. Chat only opens while actually playing (mode
  chosen, pointer locked, no screen/sign/death/victory holding the input).
- **`/tp <x> <z>`** teleports to a SAFE spot at that column: the surface
  in open-sky worlds, floated to the sea surface over deep water (a lake
  teleport swims instead of drowning in the dark), a scanned interior spot
  under the Nether's bedrock ceiling (the top-of-column rule would land ON
  the roof), and a refusal over the End's void. **`/tp <x> <y> <z>`** goes
  exactly there. Coordinates clamp to CHAT.TELEPORT_LIMIT, junk input gets
  a usage toast, unknown commands and plain text get gentle pointers.
  Velocity zeroes on arrival; the destination chunk generates
  synchronously and the ring re-centres around it on the next frame.
- Browser-verified end to end: T and '/' openers, surface landing exactly
  on ground+1 at (300, -500), the exact-y form, junk-input safety, Escape
  cancelling an armed command, history recall, and a 4.7km teleport into
  ungenerated terrain landing on the real surface — zero game console
  errors throughout.

**FOLLOW-UP (same session): realistic clouds + moonlight** ("make clouds
look realistic, not blocks. moon light should also good"):
- **The blocky slab deck is gone.** `sky_fx.js createClouds()` is a
  camera-following plane at CLOUDS.HEIGHT whose fragment shader grows soft
  cumulus from 5-octave fbm value noise: a low-frequency weather gate
  groups the masses and leaves real clear sky (it MODULATES coverage —
  a low cell thins the sky, never empties it), an extra smoothstep
  steepens the interior so cores read solid while edges stay feathered,
  self-shading probes the density gradient toward the sun, thin cloud
  reads brighter, and thin edges catch a silver lining near a low sun.
  A faint cirrus veil rides higher at its own scale. The pattern lives in
  world space (drift wrapped at the noise lattice period), so flying never
  slides the sky. All knobs in config CLOUDS.
- **The Phase 26 occlusion contract holds with soft alpha** by drawing the
  cumulus twice: a depth-only pass (renderOrder -1.95, colorWrite false,
  fragments survive only at alpha >= CORE_ALPHA) occludes the far-plane
  sun/moon/stars per pixel; the colour pass (-1.1, no depth write) blends
  the soft rims over them. Cirrus never occludes — the sun THROUGH cirrus
  is the realistic read.
- **Tuning was measured, not eyeballed**: a node port of the shader math
  swept COVER — shipped 0.66 = 40% of the visible layer disc carrying
  cloud, 25% solid, and 0 near-empty vantages in 24 sampled (the first cut
  at feature scale 1/260 rolled whole vantages cloudless — one noise cell
  covered the entire overhead-visible patch).
- **Moonlight**: a cool additive halo quad behind the pixel moon
  (`createMoonGlowTexture` — rim-windowed so no quad box, linear-filtered),
  a wide moonlit dome wash opposite the hidden sun via the sky shader's new
  glowBand uniform (CELESTIAL.MOON_SKY_GLOW_*), the night palette
  brightened to silver-blue (LIGHTING.NIGHT_SKY_TINT 0xa9bef2, night
  SKY_DARKEN 11 -> 10) and a moon glint lane on water
  (CELESTIAL.MOON_GLINT_LEVEL, main.js flips the water light direction to
  the moon after sunset).
- Screenshot-verified at 1920x1080: day cumulus field, straight-up puff,
  sunset silver linings, moon halo among silhouetted clouds, moonlit
  ground — zero game console errors. main.js is 812 now (the beds block
  is still its mandated next cut); sky_fx.js 493, lighting.js 778.

**SECOND FOLLOW-UP: cloud realism v2 + the round moon** ("Cloud more
realistic, plus make moon round"):
- **Cloud shapes**: a domain warp bends the fbm sample space so masses
  stop being round blobs, and high-frequency detail noise ERODES the thin
  edges (weighted by 1-body, cores keep their mass) — the curdled
  cauliflower rim. COVER retuned 0.66 -> 0.68 in the node sweep to hold
  ~40% visible / ~30% solid over the visible disc.
- **Cloud lighting went pseudo-volume**: density is treated as the height
  of a dome and lit with a real N.L against the 3D sun (the moon after
  dark). Rotated-grid two-octave RELIEF bumps ride on the body height so
  the interior stays dappled after the density ramp saturates — without
  them a big puff shaded only at its rim and read flat overhead (and the
  first bump cut, un-rotated single-octave value noise, read as a quilted
  blanket — value noise shows its lattice when it drives lighting). Config:
  WARP / DETAIL_SCALE / EROSION / NORMAL_EPS / DOME_GAIN / RELIEF /
  RELIEF_SCALE / AMBIENT / THIN_LIFT / CORE_SHADE replace the old
  LIGHT_EPS/LIGHT_GAIN probe pair. The look was iterated in an OFFLINE
  node render of the exact shader math (render_clouds.mjs pattern —
  top-down PNG at two sun angles) instead of 3-minute browser cycles.
- **The cirrus veil got FLAT_SHEET**: it is a sheet, not puffs, so its
  material skips the six gradient taps and lights as a horizontal plane —
  the v2 lighting costs nothing on the layer that covers the whole sky.
- **The moon is ROUND**: `createMoonTextures()` now draws a 128px
  anti-aliased disc (R 0.94, linear-filtered — the sun-texture rules)
  with maria and craters from a seeded RNG OUTSIDE the phase loop (all
  eight phases show the same face, like the real thing), a soft
  elliptical terminator, subtle limb darkening, and the unlit part as
  faint cool earthshine. MOON_SIZE 95 -> 104 keeps the apparent diameter.
- Screenshot-verified at 1920x1080 across day / straight-up / sunset (sun
  half-sunk BEHIND a grey cloud bank — the occlusion contract visible) /
  moon-with-halo / moonlit ground; zero game console errors every run.

**THIRD FOLLOW-UP: the reference-image cloud pass** ("Improve on the
clouds like reference image" — a shader-pack shot of fat, distinct,
bright cotton cumulus over plains):
- **Distinct solid puffs**: SOFTNESS 0.22 -> 0.16 and OPACITY -> 0.97
  (clouds mostly SOLID white with thin rims — the node sweep holds ~52%
  visible / ~44% solid), WARP 0.7 -> 0.55 (rounder masses, less stringy),
  the weather gate made MILD (floor 0.62, window widened) after a vantage
  rolled a nearly empty sky — every sampled vantage now carries >= 38%
  cloud. Contrast restored after the first bright cut flattened it:
  DOME_GAIN 1.3, CORE_SHADE 0.34, AMBIENT 0.44, SHADE 0xa4aec4 (the
  reference's grey-lavender bases).
- **Then the deck was cut to ONE good layer** ("Remove the layer of bad
  cloud. Only the upper good layer cloud"): the first cut of this pass
  added a parallax TOP layer above the raw-field base, but the base's
  colour pass still painted a flat milky sheet at glancing angles — so
  the base colour pass and the old cirrus veil are GONE. The single
  visible pass draws the field shrunken to its cores (dens^2, full dome
  shading, no core-grey term): compact bright puffs, blue sky between
  them, nothing else. The depth-only occlusion pass still runs on the
  RAW field with CORE_ALPHA raised 0.45 -> 0.60 so the occluding core
  stays inside visibly solid cloud. Config CIRRUS / TOP_LIFT /
  CORE_SHADE removed with their consumers.
- **Two dusk artifacts fixed from a live-play report** ("Clouds
  shouldn't look like this"): the depth cut was biting a hard
  cookie-edge silhouette out of the bright moon disc — CORE_ALPHA
  0.60 -> 0.90, so occlusion only lands behind near-opaque cloud and a
  bright body dims SMOOTHLY through the alpha blend before the cut can
  show (the sunset shot now has the sun glowing through a shelf, no hard
  edge). And the cloud edges showed terraced onion-ring banding — the
  density curve was steepened TWICE (interior S-curve + the visible
  dens^2), collapsing the edge ramp into discrete fronts; the interior
  steepen is gone, SOFTNESS 0.16 -> 0.24, EROSION 0.34, COVER 0.70
  re-swept (~43% visible / ~28% solid, every vantage >= 28%).

**FOURTH FOLLOW-UP: VOLUMETRIC clouds + drifting cloud shadows** ("way
MORE REALISTIC. LIKE REAL LIFE. THE GAME SHOULD LOOK LIVELY (LIKE
SHADERS)"):
- **The colour pass is a RAYMARCH now** (`sky_fx.js`): the slab
  [CLOUDS.HEIGHT, HEIGHT+THICKNESS] is marched in STEPS jittered samples
  through the same drifting 2D field, read as density-as-height columns
  (`profile()`: rounded crowns, softened flat bases, thin wisps kept
  optically thin), accumulated front-to-back with early exit. Clouds
  have real THICKNESS: sides visible from afar, bright crowns over
  shaded bases from the height-gradient shading (BOTTOM_LIT -> 1),
  silhouettes that change with the viewing angle as you move, silver
  linings on thin parts toward the sun/moon. New knobs THICKNESS 48 /
  STEPS 10 (the quality-cost dial) / DENSITY / ROUND / BOTTOM_LIT /
  MAX_SPAN; the dome-normal and relief knobs retired. The Phase 26
  occlusion contract keeps its 2D depth-core pass at CORE_ALPHA 0.90.
  The look was designed in an offline PERSPECTIVE raymarch of the exact
  shader math (render_vol.mjs pattern — a ground-level camera, the sky
  gradient and sun behind), not in browser cycles.
- **Cloud SHADOWS drift over the terrain** (`lighting.js` +
  VISUAL.CLOUD_SHADOW): the chunk shader samples a cheap 3-octave copy
  of the field (same hash, seed, gate and threshold layout — no warp or
  erosion; real cloud shade is blurry) at each fragment's column
  projected along the sun, and dims the SKY contribution only, scaled by
  the column's openness — patches of shade wander across the plains in
  step with the clouds above (the cycle syncs uCloudDrift/uCloudSlant/
  uCloudShadow every frame; strength 0 at night and under fixed skies;
  ~5 noise evals per terrain fragment). Torch light and caves untouched.
- Drift SPEED 0.9 -> 1.3 blocks/s — visible motion, with the ground
  shade moving in step, is half of what reads as "alive".
- Screenshot-verified at 1920x1080 over the full r=25 ring: the day sky
  is a field of genuinely three-dimensional cumulus, the sunset sun
  sinks behind a marched shelf glowing through it, the overcast night
  reads as weather; zero game console errors every run.
- **The horizon band**: CLOUDS.FADE 620/950 -> 780/1400 and VIEW.FAR
  1000 -> 1700 (the old far plane was clipping the cloud plane; terrain
  never gets near it — the ring ends at 400, fog at 425). The reference's
  low stacked band of distant clouds above the tree line shows now.
- Screenshot-verified at 1920x1080 over the full filled r=25 ring: day
  field with white-crowned puffs and the horizon band, straight-up puff
  with a floating crown, sunset with layered shelves over a half-occluded
  sun; zero game console errors every run.

**FINAL RETUNE: the view ring is 25 chunks, guaranteed** ("render 25
chunks... wherever I'm standing, 25 chunk radius"):
- `VIEW.DISTANCE_CHUNKS` 40 -> 25 (400 blocks), fog scaled at the same
  fractions as every retune (FOG_NEAR/FAR 288/425 — clear to ~72% of the
  view, ring edge at ~80% haze). The 40-ring was more than asked and its
  5025 chunks took real minutes to fill after a move; the 1961-chunk ring
  fills ~2.5x faster, so the promised radius is actually THERE wherever
  the player stands.
- Measured (node, real generator + mesher): r=25 with the LOD tiers is
  **1961 meshed / 4182 draws / 5.58M tris / 458 MB** (full detail would
  be 10.00M / 820 MB) — about half the r=40 ring's cost.
- The GUARANTEE verified in node with the real World and streaming: the
  ring settles complete (1961/1961 meshed) at spawn, re-fills to
  1961/1961 after a 12-chunk move, the streamer parks when done, wakes on
  an edit and re-settles — PASS end to end. Browser boot clean at the new
  settings, zero game console errors.

The previous phase: **Phase 26 — VISUAL AND WORLD POLISH.** No new
systems; the game Phase 25 finished, made richer to look at and friendlier to
start. Everything below the Phase 26 entry describes the finished game it
polished.

### Phase 26 — visual and world polish

**WORLD GENERATION.**
- **Plains is the most common biome now, by a wide margin.** BASE_WEIGHT
  0.25 -> 0.55, forest's moisture gate and desert's heat gate both tightened,
  mountains handed back a slice (WEIGHT_START 0.30). Measured over 2000x2000
  of land: **plains 55.7% / forest 17.8% / desert 10.8% / mountains 15.6%**
  (was 31/29/21/19) — a clear majority with all four biomes keeping real
  presence. Water unchanged at 9% of all columns.
- **The plains spawn is GUARANTEED, not seed luck.** `world/spawn_scan.js`
  (new): candidate centres spiral out from the origin on a 16-block grid,
  each scored over a 56-radius sampled disc — fraction plains-dominant,
  fraction underwater, height relief — and the first to clear every
  `TERRAIN.SPAWN_SCAN` threshold wins, with a best-seen fallback so the scan
  ALWAYS returns a column. Pure in the seed, cached on the generator; the
  player spawn (body.js), the eyes of ender and the stronghold anchor all
  read the same column. Measured across 12 arbitrary seeds: every spawn disc
  is 94-100% plains, 0% water, relief <= 12, found in 5-90 ms. On the
  shipped seed the player spawns at (-96, 160), on grass at y69, plains 92%
  within 64 blocks — verified in the running game (`biomeAt(spawn)` ===
  'plains').
- **The stronghold is ~400 blocks from spawn** (SPEC updated; was
  1000-2000). `STRONGHOLD_MIN/MAX_DISTANCE` 340-460, and the centre is
  anchored to the ACTUAL scanned spawn — `strongholdCenter(seed, spawn)`,
  with the generator holding ONE cached anchored centre that blueprint(),
  emitChunk()'s early-out and entryPoint() all share. Measured: centre 348
  blocks from spawn, 3091 stone bricks and exactly 12 end-portal frames
  generated there, eye-of-ender target identical to the generated position.
  (The adversarial review caught the first cut recomputing an UNanchored
  centre in emitChunk's early-out — the structure would never have emitted.
  A node census now proves generation at the anchored centre.)

**RENDER DISTANCE.** Still 30 chunks (480 blocks, the follow-up's number,
exposed in `VIEW.DISTANCE_CHUNKS`) — but it no longer costs 30 chunks of
full geometry:
- **LOD tiers** (`VIEW.LOD`, chunks.js + world.js): beyond DETAIL_CHUNKS
  (14) a chunk meshes at a reduced tier — cross-plane plants skipped (a
  grass sprite at 224+ blocks is under ~5px), leaf same-id interior planes
  culled (the dense-canopy read needs ~50 blocks, not 224), and the real
  win: **faces fronting pitch-dark air are culled** — baked sky light 0
  means enclosed underground, so the entire hidden cave network stops
  emitting walls. Faces fronting water keep emitting (no holes under
  lakes), sky-lit ravines and cave mouths keep theirs, fluid flows probe
  the cell above themselves (lava flows bake sky 0 by their own opacity —
  the review caught the first cut erasing every distant lava fall), and
  the Nether/End opt out via `generator.hasOpenSky` (their baked sky is 0
  everywhere). Tier changes remesh with 2 chunks of hysteresis so walking
  the boundary never thrashes. Measured over the full r=30 ring (node,
  real generator + mesher):
      full detail   2821 meshed  6634 draws  14.25M tris  1168 MB geometry
      with LOD      2821 meshed  5908 draws   6.87M tris   563 MB geometry
  **-52% triangles and geometry memory** — r=30 now costs less than the old
  fully-detailed r=20 ring (6.44M tris) while looking identical at eye
  level.
- **Frustum culling** was already on (three.js per-mesh bounding spheres);
  the spheres are precomputed at mesh build now, inside the streaming
  budget. A 70° lens draws roughly a quarter of the ring.

**THE VISUAL PASS** — richer than vanilla, still unmistakably Minecraft.
All tunables in the new `config.js VISUAL` block; `POST_ENABLED: false`
restores the exact Phase 25 render path.
- **The post pipeline** (`render/post_fx.js`, new): the scene renders into
  a linear half-float target (4x MSAA, depth texture — three r160 keeps fog
  uniforms in the working space for render targets, checked against the
  three source, so the fog-equals-horizon contract survives; the composite
  applies the ONE linear->sRGB encode plus the sky dome's own anti-banding
  dither). From it: **soft god rays** when the sun is low (depth-masked
  radial blur toward the sun — terrain ridges and the now-depth-writing
  cloud deck carve real shafts; elevation-ramped, none at noon, none in the
  fixed-sky dimensions), **subtle bloom on light sources** (soft threshold
  following the sun level so torches halo at night without daylight sand
  glowing, plus warm/violet emissive detectors that pick out lava,
  glowstone, torch flames and the portals; sky masked by depth — the sun
  keeps its own glow), and **colour grading** (saturation 1.06, extra gain
  on green-dominant pixels, warm white balance scaled by sun level, the
  darkest tones leaning toward a cool blue).
- **Water** (`render/water_fx.js`, new — layered on the same lit chunk
  material): a gentle world-space ripple displaces surface vertices
  (render-only; physics, raycasts and floating items never see it; shared
  corner vertices displace identically so the surface stays watertight),
  the same wave's analytic gradient perturbs the per-fragment normal, and
  a fresnel term mixes in what the surface would mirror — the sky gradient
  where the column is open to the sky, easing to a dark terrain tone where
  the baked sky access says canopy or cliff hangs over it (the "suggestion
  of nearby terrain") — plus a tight sun glint riding the ripple. Flowing
  water keeps the plain pass (it animates by texture scroll at seven
  heights). Verified with an exaggerated-settings screenshot (waves,
  reflection bands and glints all present, zero seams), then dialled back
  to the shipped subtlety.
- **Shadow feel** (`render/lighting.js` + config VISUAL.SHADOW):
  AO_STRENGTH 0.45 -> 0.40, and shaded faces (per-face brightness x AO in
  the vertex colour) take a slight cool lean plus a faint warm bounce by
  day, both scaled by daylight and sky access so caves, night and the
  fixed-sky dimensions are untouched.
- **Dust motes** (`render/particles.js` dust emitter + the random display
  tick in `systems/ambience.js`): an air cell carrying real sky light (>=6)
  while sitting 5+ blocks under the generator surface is a shaft through a
  cave roof — tiny slow specks drift down through it, tinted by the light
  they hang in. Overworld only. Verified in a dug shaft in the running
  game (33 live particles, visible in the screenshot).
- **THE GOLDEN HOUR** (the reference-image request, mid-session): while
  the sun is low the sky runs a purple-to-gold gradient — periwinkle
  zenith through violet-pink to a gold horizon — the sun wears a much
  larger soft halo (SUN_GLOW_SCALE 2.6 -> 3.4, strength now config), god
  rays strengthen, terrain light warms (the TINT channel), and a new
  **HAZE keyframe channel** pulls the fog in (SKY.HAZE_NEAR/FAR 40/430 vs
  the clear 340/510) so distant terrain drowns in warm atmosphere. Full
  blue day still holds t 0.05-0.45 with near-Phase-25 clarity (HAZE 0.15),
  the sun is still up for exactly half the cycle, and full darkness still
  holds 9 of the night's 10 minutes — only the look at the day's edges
  changed. Screenshot-matched against the reference: gradient, glow, haze
  and shafts all present; block textures untouched (lighting and post
  only).

**THE BUG — clouds occlude the sun, moon and stars now.** It was a draw-
order tie: sun/moon quads and the cloud deck all sat at renderOrder -1 with
no depth writes, so the additive sun drew over any cloud. And a plain depth
test could not fix it — the sun quad sits 820 blocks out while a low sun's
sight line crosses the y=192 deck ~124/sin(elevation) blocks out, i.e.
FARTHER than the quad below ~9° of elevation, exactly the sunset case the
report described. The deck **writes depth** now and draws first
(renderOrder -1.9), and the sun, moon and stars are **pinned to the far
plane** in their vertex shaders (`sky_fx.js forceFarDepth`) — anything
above the cloud layer fails the depth test wherever a cloud fragment
landed, per pixel. Screenshot-verified three ways: a slab clipping the sun
disc exactly at its edge, night clouds blanking the stars behind them, and
a noon cloud occluding the overhead sun with the glow spilling around it.

**THE ADVERSARIAL REVIEW.** A 20-agent review/verify pass over the full
diff (5 finder dimensions, every finding independently re-verified against
the code and the three r160 source; several reproduced empirically in
node). All 15 confirmed findings fixed, among them: the CRITICAL unanchored
stronghold early-out above; the LOD gate erasing all distant flowing lava
(lava flows bake sky 0 by their own opacity — flows probe the cell above
now); the god-ray sky-depth threshold classifying everything past ~667
blocks as sky, so the cloud deck could not carve rays exactly when they
are strongest (0.99995 -> 0.999999, derived from the far-plane pin and the
24-bit depth step); bloom threshold tracking the invisible overworld sun
inside the Nether/End (skyActive-gated now); MSAA leaking into the
downscaled post targets (a resolve blit per pass for nothing); and
`world/terrain.js` crossing the size cap (814), cut the same session —
the Phase 24 surface rules moved verbatim to `world/surface_rules.js`
(A/B: byte-identical chunks over 5 test chunks).

**Verification.** The game boots in Chromium with the whole phase active —
the only console error is the browser's own /favicon.ico 404. Spawn checks,
stronghold census, biome mix, LOD costs and spawn-scan determinism all
measured in node against the real generators; the visual effects
screenshot-verified in the running game (noon vista, god rays through a
canopy, golden hour at three angles, cloud-clipped sun, night torch bloom,
shaft dust, exaggerated-water proof). Framerate remains unmeasurable in
this sandbox (software GL, 11-17 fps whatever the settings — the standing
caveat); the 60fps-at-1080p claim rests on the measured geometry: with LOD
the full ring carries HALF the triangles of the old r=20 setting that was
already shipped, frustum culling draws about a quarter of it, and the post
pipeline adds ~8 small screen-space passes.

---

**Phase 25 was the previous phase. The game was finished and shippable
then.** It loads
from a static file server, offers SURVIVAL or CREATIVE on a start screen, and
either one is a whole game.

In SURVIVAL a player starts from nothing, punches a tree, and follows the full
progression — tools, mining, smelting, a night with things in it, the Nether,
a fortress, blaze rods, brewing, endermen, eyes of ender, the stronghold, the
end portal — into the End, destroys the crystals, kills the Ender Dragon, and
steps through the activated exit portal to the victory screen. SPEC.md's
success test is met, end to end, and was driven through the real systems in a
real browser this session: 16/16 checks, from an empty inventory on a fresh
world to Return Home with the inventory intact (see THE FINAL PASS below).

In CREATIVE they fly, break anything instantly, and build out of a tabbed,
searchable catalogue of every block and item in the game.

Nothing temporary remains in the build. There is no test chest, no debug kit,
no half-wired feature behind a flag.

That phase was: **Phase 25 — SURVIVAL AND CREATIVE MODES.**

**Phase 25 follow-up (same session series): seven visual/world reports.**
All landed and measured; the game remains complete and shippable.

- **Render distance 12 -> 20 chunks (320 blocks).** Fog out to 120/346 to
  match. Measured (node, real generator+mesher): 1257 meshed chunks, 2968
  draws, 6.44M tris, 554 MB geometry + 364 MB chunk data — ~920 MB resident,
  a machine-with-memory setting by explicit request; the config comment
  carries the r=8/12/20 table so it is one number to turn back down.
- **Deserts are sand.** The Phase 24 BIOME_DITHER_RANGE of 0.35 speckled
  grass columns across desert-dominant ground (24.7% of desert-dominant
  columns had a grass surface). Desert edges now dither over their own
  narrow band (BIOME_DITHER_DESERT_RANGE 0.08): grass in desert fell to
  1.9% — almost all of it on the outermost fringe where desert barely wins —
  while grass-family borders keep the wide feather (grass dithered into
  grass is invisible by design).
- **Plains == forest.** BASE_WEIGHT 0.38 -> 0.25 plus a slightly opened
  forest moisture gate: plains 30.8% / forest 29.4% of land (was 40/23),
  with desert 21% and mountains 19%.
- **Less ocean.** CONTINENT.OFFSET 1 -> 2.5 lifts the landmass swell so
  fewer dips reach under sea level: water fell from 25% of all columns to
  9%. Rivers are carved down through the lift and are untouched.
- **Clouds are volumes.** The flat quad deck became vanilla-fancy SLABS: 4
  blocks thick, lit tops (1.0), shaded undersides (0.7), mid side walls,
  front-face culled so the volume reads from below and from creative flight
  above, per-face brightness baked as vertex colours CONVERTED TO LINEAR
  (the sRGB trap, fourth sighting). The pattern is two-stage now — a coarse
  WEATHER GATE (top 62% of the deck may hold cloud) intersected with the
  fine octave thresholded to 24% global cover — which breaks the old merged
  blend's continent-sized sheet into fields of distinct cumulus, plus an
  isolated-single-cell cleanup. Screenshot-verified from the ground, from
  under the deck and from above it.
- **The sun's box is gone.** It was real, twice over: the old glow term
  still carried alpha ~16/255 at the quad rim (additive blending draws that
  as a faint square against the sky) and the 128px texture was
  Nearest-filtered, so the magnified gradient stair-stepped. The sun is a
  ROUND disc now (256px, linear-filtered) whose glow is windowed to reach
  exactly zero before the rim. The moon keeps its vanilla pixel square.
- **Distant terrain quality (fourth follow-up request — "don't make the
  far places blurry or low quality").** Two causes, both fixed. The block
  atlas had NO mipmaps (disabled since Phase 1 "so tiles don't blur into
  each other"), so Nearest-minified terrain degenerated into shimmering
  pixel noise at distance; it carries a hand-built TILE-LOCAL mip chain
  now — successive 2x2 box downsamples from 256x256 to 16x16, where each
  16px tile is exactly one pixel, and the chain STOPS there, so no level
  can ever mix two tiles' texels (vanilla's own 4-mipmap-level trick).
  RGB averages are alpha-weighted so leaves/plants keep their edge
  colours; NearestMipmapLinear minification, Nearest magnification (pixel
  art up close untouched, screenshot-verified), 16x anisotropy so grazing-
  angle ground doesn't over-blur. And the fog stopped scaling
  proportionally with render distance — at 480 blocks the old fractions
  put everything past mid-distance in a milky wash; it is 340/510 now, so
  terrain is CLEAR to ~70% of the view and the fog's only job is masking
  the chunk edge (~80% haze at 480). Verified with before/after vistas of
  the full r=30 ring.
- **Render distance 20 -> 30 chunks (480 blocks) (third follow-up
  request).** Fog out to 180/520. Measured: 2821 meshed chunks, 6665
  draws, 14.2M triangles, 1224 MB geometry + 780 MB chunk data — a ~2 GB
  resident footprint that wants a discrete GPU and 16 GB of system memory;
  the r=8/12/20/30 cost table sits beside the number in config.js. The
  cloud deck's re-anchor guarantee (coverage to at least 576 blocks out)
  still clears the 480-block view. The e2e harness's forced ring-fill was
  capped at a fixed 12 chunks — spawn attempts land 24-96 blocks out, so
  that covers every attempt with lit chunks without asking the GPU-less
  sandbox browser for gigabytes.
- **A readable day clock (third follow-up request).** The debug HUD's
  TIME line shows minutes into the day now — "TIME 12:41 / 20:00 (night)"
  — instead of the raw day fraction; 10:00 is sunset.
- **A half-and-half day (second follow-up request).** The 20-minute cycle
  now splits exactly 10 minutes of day and 10 of night: the sun is above
  the horizon for t 0-0.5 (as it always was, by the orbit maths) and the
  dusk/dawn ramps shrank from vanilla's 1.5 minutes each to 30-second
  washes sitting just inside the night's edges (keyframes 0.5-0.525 and
  0.975-1.0), so full darkness holds 9 of the night's 10 minutes (was 7).
  Measured in the running game by sweeping the whole day in one-second
  steps: day 10.0 min, night 10.0 min, full dark 9.0 min, dusk 30 s,
  dawn 29 s. The debug HUD's phase label follows the new boundaries.
- **A plains spawn.** TERRAIN.SEED 2163 -> 3200, scanned for the most even
  spawn area that starts the player ON plains: within 260 blocks the land is
  plains 25% / forest 26% / desert 27% / mountains 22%, 13% water, spawn on
  grass at y68.

Re-verified after the changes: the full survival end-to-end run 16/16 on
three consecutive runs and the mode harness 31/31, both on the new seed,
zero game console errors. Two harness lessons from the re-run worth
keeping: the check-6 shelter is a DUG-IN pocket now, not a 1-thick wall,
because this game's melee is distance-only (MELEE_RANGE 1.4, no
line-of-sight check — an accepted simplification since the combat phase),
so a mob pressed against a thin wall bites through it and a creeper
ignites through one; five blocks of depth beats both gates. And a death
screen left standing by an earlier check silently blocks showVictory (the
two screens never stack, by design) — the harness clears it through the
real Respawn button before the victory check.

MODE SELECTION (`player/gamemode.js`, `ui/menus.js`) — a START SCREEN on load
offers Survival or Creative and holds the world frozen until one is picked
(verified: the day/night clock does not advance behind it). Esc mid-game
brings up a PAUSE MENU that names the current mode and offers the other one
by name — "Switch to Creative" / "Switch to Survival". The switch is live:
`gamemode.set` flips ONE flag and notifies subscribers, so there is no reload,
no regeneration, no teleport and no copying — the world, the position and the
inventory are the same objects a frame later, in both directions (verified by
serialising the inventory across a switch and comparing). The mode shows in
the bottom-right HUD corner as a small dim "Survival Mode" / "Creative Mode".

The design that makes that cheap: `player/gamemode.js` is a module singleton
on the established `particles`/`audio` pattern (ARCHITECTURE.md now calls them
the three singletons), and every creative rule is ONE gate in the system that
already owns the rule:

| rule | where |
|---|---|
| cannot be damaged or die | `stats.damage` — every source in the game arrives there |
| no hunger drain | `stats.gainExhaustion` |
| instant break, no drops | `interaction.miningPlan` (bedrock/frames stay `Infinity`) |
| infinite blocks | `inventory.consumeSelected` / `consumeOffhand` / `consumeItem` |
| tools never wear | `inventory.damageSelected` / `damageOffhand` / `armour.damageAll` |
| hostiles ignore the player | `mobs.playerTargetable` (every AI, injected ones included) and the same gate in `dragon.js` |
| no health/hunger bars | `hud.updateHud`, written every frame |
| E opens the creative inventory | `screens.js`, the one owner of that key |

CREATIVE FLIGHT (`player/body.js` `_stepFlight`, `player/controller.js`) —
double-tap Space toggles it, Space rises, Shift descends, sprinting doubles
the pace, and the whole thing is 2.5x walking (`CREATIVE.FLY_SPEED` 10.9 vs
`WALK_SPEED` 4.3, measured live at 10.90 blocks/s). Gravity, buoyancy,
jumping and ladders are all replaced by one rule — velocity chases a wanted
velocity on all three axes and decays without input — but the move still goes
through the SAME swept collision as walking, because vanilla creative flight
is flight, not spectator noclip (`CREATIVE.FLY_COLLIDES`, default true; see
the deliberate slices). Landing ends the flight, vanilla-style; fall distance
never accrues; leaving creative grounds the player at once.

CREATIVE INVENTORY (`ui/creative.js`) — 188 entries over seven tabs (building
blocks, decoration, tools, combat, food, materials, miscellaneous) with a
search field that filters across EVERY tab at once, so an item is findable
without knowing its drawer. Click an entry for a full stack, right-click for
one, drag one into a slot, drop a stack on the backdrop to destroy it. The
catalogue is infinite by construction: nothing is ever removed from it —
every gesture builds a brand-new stack out of `freshStack()`. Verified: every
catalogue name resolves to a real icon source (0 blanks), and every craftable
or ingredient name in `systems/crafting.js` appears in the catalogue (0
missing).

THE FIVE REPORTED BUGS — all five measured, not asserted:

(1) RENDER DISTANCE was too short. `VIEW.DISTANCE_CHUNKS` 8 → 12 (128 → 192
blocks — vanilla's own default), with the fog pushed out to match (40/140 →
72/208, the same clear fraction of the view). The number is backed by a
measurement off the real generator and mesher rather than a guess: at r=8 the
ring is 197 meshed chunks / 453 draw calls / 0.91M triangles / 79 MB geometry
+ 71 MB chunk data; at r=12 it is 441 / 973 / 2.03M / 174 MB + 143 MB. A 70°
lens sees roughly a quarter of the ring, so r=12 draws on the order of 250
calls and 0.5M triangles a frame. What stops it going further is the ~320 MB
resident footprint, not the triangles — r=14 is playable with memory to
spare, r=16 is not reasonable. Filling the ring is not the expensive part
either: driven unbudgeted in the browser, the whole r=12 ring (729 chunks
generated, 441 meshed) takes 6.4 s of CPU, which the 8 ms-per-frame
streaming budget covers in about 13 s of play at 60fps. It is one number in
config.js with all of those figures written beside it.

(2) BIOME DISTRIBUTION was unbalanced. Three changes, and the numbers over a
2000x2000 sample went from plains 39% / forest 26% / desert 10% / mountains
25% to **plains 40% / forest 23% / desert 19% / mountains 18%** — all four
with real presence. The climate fields got HIGHER frequencies (1/480, 1/420 →
1/360, 1/320) because the old patches were so large that a whole session
could happen inside one, which is what "plains are rare" actually described;
mountains gave up a third of their land (`WEIGHT_START` 0.12 → 0.25); and
desert stopped needing extreme heat AND extreme dryness at once. On "forest
appears near water almost every time": measured, the generator has no such
correlation to remove — forest is 26.0% of coastal land and 22.6% of inland
land, and it was 26.2% vs 26.1% BEFORE any change. What was real is that the
three biome axes shared one domain warp, so their boundaries bent together
and whichever biome owned a stretch of coast owned all of it; moisture has
its OWN warp pair on its own frequency now (`BIOME_WARP.MOISTURE_SCALE`), so
the wet edge cuts across the hot and mountainous ones.

(3) A NEW WORLD. `TERRAIN.SEED` 1337 → **2163**, picked by scanning seeds for
the most EVEN spawn area under the rebalanced rules. The old spawn was a
forested coast hemmed in by mountains (measured: 45% of the land within 300
blocks was mountain, 2.8% desert, and the spawn column itself was forest).
The new one is plains at y64 with, within 260 blocks: plains 29% / forest 25%
/ desert 22% / mountains 24%, 15% water.

(4) MOUNTAINS ARE GRASSY. The report was right and the Phase 24 entry marking
this fixed is CORRECTED in place below. Phase 24 measured 60% grass / 38%
stone and called it done; worse, 34 of those 38 points came from the STONE
LINE, not from steepness — the line sat at y=108 while peaks reach ~140, so
it stripped a third of every mountain rather than capping the tops. The line
is 128 now (jitter 10 → 7) and `STEEP_DROP` is 4, so ordinary ridged relief
no longer counts as a cliff. Measured after: **91.0% grass / 7.6% stone**
globally, 95.5% grass around the new spawn.

(5) LARGE CAVERNS ARE FINDABLE. Phase 23's mechanism was sound — chambers are
PLACED, not thresholded out of noise — and its measurements were true. What
was wrong was the RATE: one chamber per 224-block region put a chamber's
footprint over ~3% of the cave band, and a player could explore a long time
without meeting one. The tiles are 128 blocks now at 88% occupancy
(`GREAT_CAVERN.REGION_SIZE`/`CHANCE`), and each chamber sends out three
connector bores instead of two. Measured on real generated chunk data over a
352x352 region: **5.4% of all open cave air is "big room"** (a cell with 8
blocks of clear air each way horizontally and 6 vertically); from a random
cave cell the air-path distance to a big room is **≤60 blocks for 67% of
them, ≤120 for 80%, ≤240 for 91%**; chambers measure 36-56 across and 30-39
tall; and **6 of 6** chambers fully inside the sampled region are reachable
on foot from open sky. Density is one per ~136 blocks of travel, up from one
per ~259.

THE FINAL PASS — a survival run driven through the game's own systems in
Chromium, 16/16 green on three consecutive runs, zero game console errors
(the only 404 is the browser's own /favicon.ico request):

  1. fresh world — empty inventory, 20/20 health and hunger, plains at y65
  2. wood — a real generated oak log 1 block from spawn, punched by hand
     (2.0s, drops true), picked up through the item manager
  3. crafting — 6 logs → planks → sticks → crafting table → wooden pickaxe,
     sword and shovel, all through the real `CraftingGrid`
  4. mining — SPEC tool gating exact (stone 5.0s bare-handed no drop, 0.75s
     with a wooden pickaxe with drop; iron ore needs stone; diamond needs
     iron; obsidian needs diamond) and the ore is really in the ground near
     spawn (coal 194, iron 296, gold 148, redstone 231, diamond 50 cells in
     an 80x80x98 census, all-deepslate below y=-10)
  5. smelting — a furnace burns coal and turns 3 raw iron into 3 ingots
  6. a night — the sky darkens to level 11, 13-14 hostiles spawn naturally
     across four or five species (zombie, skeleton, spider, creeper,
     enderman), a zombie put down 7 blocks away closes the distance, and a
     player who walls themselves into a 1x2 pocket comes through the rest of
     the night at 20/20. Standing in the open instead is genuinely lethal —
     an unarmed, unarmoured player was killed outright in two of the runs,
     which is the survival loop working, not a failure
  7. the nether portal — a hand-built 4x5 obsidian frame lights and fills
  8. the Nether — a real fortress (110 pieces) with 3531 nether brick and a
     blaze spawner around its heart
  9. blaze rods — a blaze spawns, takes damage and dies
 10. brewing — water bottle → awkward → fire resistance on a real stand
 11. the stronghold — 12 end portal frames and 1646 stone bricks exactly at
     the eye-of-ender point, 1175 blocks from spawn
 12. the end portal — the twelfth eye fills the 3x3 interior (9 cells)
 13. the End — the island (18413 end-stone cells sampled), ten crystal-topped
     obsidian pillars, the dragon at 200 health
 14. the dragon — every crystal pops through its real combat facade, health
     reaches 0, the death sequence runs to 'dead' and the exit portal opens
 15. VICTORY — standing in the activated exit portal shows the victory screen
 16. Return Home — back to the overworld with the inventory intact

Plus a mode harness, 31/31: the start screen and its freeze, survival's empty
inventory and absent test chest, survival wear and consumption, the pause
menu's readout and switch, inventory identity across the switch, a click on
the backdrop falling through to the canvas and resuming play, creative's
hidden bars, instant break, infinite stacks, invulnerability, ignoring mobs,
flight (rise, descend, 10.9 b/s, no fall damage), the creative screen's seven
tabs and cross-tab search, click-for-a-full-stack twice from the same entry,
and everything working again after switching back.

---

Previous phase: **Phase 24 — POLISH: terrain, sky and ground vegetation.**

The overworld reads like Minecraft now: rivers wind to the sea, mountains
are grassy with bare stone only up high and on cliffs, clouds drift over a
sky that moves through a real day, and the ground is alive with grass and
flowers.

RIVERS (`world/terrain.js`, `TERRAIN.RIVERS`) — the zero-contours of one
low-frequency field press the heightmap down below sea level with a
parabolic bed and eased banks, and the normal sea fill makes them water.
Contours of a continuous field cannot simply stop — they loop or run into
terrain that is already underwater — which is what makes every river
CONTINUOUS and CONNECTED to lakes and oceans by construction, not by luck.
Verified by rendering a 768x768 surface map from the real generator: every
river in view winds, forks around an oxbow, and ends in open water.

SURFACE RULES (`world/terrain.js` surfaceLayersFor, rewritten) — sand now
requires actual water: a near-sea column turns beach only when a column
within `SURFACE.BEACH.REACH` is underwater, so a plain that happens to sit
at y 62 stays grass (the old rule turned it into a sand flat). Deserts are
unchanged. Mountain surfaces stopped switching to stone at one fixed
height: bare stone appears only above a noise-jittered STONE LINE
(`SURFACE.STONE_LINE`) or on faces steeper than `STEEP_DROP` — measured
over 320x320: mountain-biome surface is 57% grass / 26% stone, where the
old rule left whole ranges bald.
**CORRECTED IN PLACE (Phase 25): this was not enough, and the report that
said so was right.** The mechanism was correct but the line was set at
y=108 against peaks that reach ~140, so it stripped a third of every
mountain instead of capping the tops — and 34 of the 38 stone points came
from the LINE, not from steepness, which the Phase 24 measurement did not
separate. Phase 25 moved the line to 128 (jitter 7) and STEEP_DROP to 4:
91.0% grass / 7.6% stone. A single grass/stone ratio could not fail the
thing being reported; splitting it by CAUSE could. Gravel patches (`SURFACE.GRAVEL`) break up
beaches and riverbeds; underwater floors are sandy in the shallows and
dirt/gravel below.

BIOME EDGES — the climate and mountain-region fields are sampled at
DOMAIN-WARPED coordinates (`TERRAIN.BIOME_WARP`, ±34 blocks of push), so
boundaries wander irregularly, and the surface dither band widened 0.2 →
0.35. Tree spacing stopped being uniform: a density field
(`TREES.DENSITY_FIELD`, 0.15x-1.85x) gives forests glades and thickets,
and a height field biases trunks so groves of tall trees stand together.
Occasional SURFACE LAVA POOLS (`TERRAIN.SURFACE_LAVA`) dig closed basins
into flat mountain/desert ground — rim above the lava by construction, so
the fluid settle pass cannot spread them (verified: 8/8 sampled pools have
zero leak adjacencies).

SKY (`render/sky_fx.js` — new; `render/lighting.js` drives it) — CLOUDS:
the vanilla flat blocky deck at y=192, one merged mesh of greedy-run quads
over a hashed blob pattern (period 1152 blocks, 2x2-tiled so it re-anchors
around the camera in whole periods — never a visible jump), drifting
steadily along -x, slightly transparent, darkening with the sky and
blushing at dawn (colour maths in sRGB — the first night screenshot caught
the linear-space version rendering a 0.28 grey as a 0.57 sheet). The SUN
is a square core inside a soft additive glow (one generated texture — no
hard edge); the MOON shows the eight vanilla phases from generated
square-moon textures, one phase per in-game day (the cycle now counts
days; sleeping through a night advances the phase). STARS fade in through
dusk and out through dawn on their own keyframe channel and wheel with the
sun's orbit. A new per-keyframe TINT channel drives the skylight uniform —
white at noon, warm at dawn/dusk, cool at night — so the light ON the
terrain agrees with the sky it stands under; fog stays horizon-matched as
before. All verified by screenshot through the full cycle.

GROUND VEGETATION (`world/plants.js` — new, the shapes.js registration
pattern; atlas 65-68) — short grass, dandelions, poppies and dead bushes
as CROSS-PLANE blocks: a new mesher path (`emitCross`, world/emitters.js)
renders two DoubleSide quads in an X in the alpha-cutout pass, endpoints
sqrt(2)/4 in from the corners so the art never stretches, nudged
off-centre per position. Never face-culled (nothing is flush), never
culls neighbours (transparent), opacity 0 (light passes through — the
skylight heightmap ignores them), no collision (`solid: false` empties
the box list), lit flat by their own cell like the wart. Generation:
grass in noise-field patches scaled per biome, flowers rarer and
CLUSTERED (a threshold field gates where, a coarse hash picks
dandelion-vs-poppy per patch so meadows lean yellow or red), dead bushes
speckling desert sand. Rules: instant break, no tool wear; short grass
drops seeds 1/8 (the shipped wheat_seeds art — flowers and bushes drop
nothing, per the brief); popped when their soil goes (a wart.js-style
listener, drops still roll); placeable on grass/dirt (dead bush also
sand); REPLACEABLE — placing a block or pouring a bucket into a plant
cell displaces it like vanilla. Mob spawning/pathfinding unaffected
(both test `solid`). Meshing cost measured UNCHANGED: 13.9 vs 13.7
ms/chunk baseline over the same 49 chunks; generation 4.5 ms/chunk.

THE TWO REPORTED BUGS —
(1) "deepslate does not generate": the code was measured CORRECT, live.
In the running browser game, every cell in y[-30,-10] over 41x41 columns
at spawn is deepslate or a deepslate ore (9188 cells, zero stone, zero
regular ores), and the node harness shows 100.00% deepslate purity below
y=-9 across three seeds. The report's screenshot could not have come from
this code — a stale cached deployment (the atlas and modules cache hard)
is the only consistent explanation. See the Known broken note.
(2) "large lava bodies at Y-13": REAL, and Phase 23's fix genuinely
missed it — its census measured GENERATED cells, but the fluid settle
scan then grew every open-rimmed 8-cell pool into a flow apron up to 9
cells across (the same measured-the-wrong-quantity trap as Phase 10,
recorded again). Pools above the lakes are now RECESSED basins dug INTO
the cave floor (`_floodContainedPool`, world/caves.js): solid rock on
every side, open only above, erosion-verified per pool, so the automaton
never touches them. Measured over 256x256: 148 contained pool cells + 8
single-block wall springs above y=-54, ZERO cells with air below or
beside — what generates is exactly what the player finds. Spring chance
also halved.

Also: the ARCHITECTURE cap work — `world/ores.js` (the vein passes,
caves.js's long-mandated cut, byte-identical streams) and
`world/terrain_noise.js` (terrain's seeded 2D noise, moved verbatim) split
out the same session that grew their parents; `world/plants.js` and
`render/sky_fx.js` landed as new files. `world/emitters.js` (829) and
`world/blocks.js` (915) now carry the next mandated cuts (see
ARCHITECTURE.md).

THE REVIEW ROUND — a full-diff review before shipping surfaced eight real
issues, all fixed and re-verified the same session:
- AIMING AT A PLANT now places INTO its cell (vanilla's replaceable rule).
  The raycast stops on the tuft (hardness 0 = targetable), so the naive
  face-offset floated blocks one cell ABOVE the grass; placement and the
  bucket path both synthesize the click down to the soil now. Verified
  through the real right-click path in the browser: dirt aimed at a tuft
  lands in the tuft's cell, nothing floats.
- The STARFIELD covers the full sphere (COUNT 420→800). The first cut
  seeded only the upper band, and since the wheel turns 360° per day the
  empty cap swept across the visible sky — half-starless at midnight.
- Surface lava pools PLUG their rim ring at pool level where a cave or
  ravine pierced it — the one remaining way the settle scan could pour a
  pool into a cave.
- Flowers are OBTAINABLE via shears (hand-breaking still drops nothing,
  per the brief); their items and placement rules were dead code.
- ONE drops roller: `items.spawnDrops` (chance / [min,max] / fallback) —
  interaction.js, wart.js and the plant-pop listener all call it; there
  were three diverging copies.
- Dead config removed (PLANTS.SEED_DROP_CHANCE — the chance lives in the
  drop table; CELESTIAL.SUN_COLOR/MOON_COLOR), the night keyframes
  reference LIGHTING.NIGHT_SKY_TINT instead of repeating its hex, and
  placePlants gates flowers on the cheap hash before the fbm field.

---

Previous phase: **Phase 23 — POLISH: deepslate and the underground.**

The deep world now looks and mines like the deep world, and the caves
finally have rooms in them.

DEEPSLATE (`world/terrain.js`, `world/blocks.js`, atlas 58-64) — below y=0 the
stone the terrain fills with is deepslate, and the change is not a line: over
the band from y=0 down to y=-8 each block independently rolls deepslate with a
probability rising 0 -> 1, so the two interleave in a speckled transition you
walk down through (measured: 0% at y0, 26% at y-2, 52% at y-4, 76% at y-6,
100% at y-8). Hardness 3.0 — exactly twice SPEC's stone — dropping cobbled
deepslate the way stone drops cobblestone, and every ore vein that lands in
deepslate takes its deepslate variant (a vein straddling the band comes out
half and half). Cobbled deepslate is a stone crafting material like vanilla:
furnace, brewing stand and the five stone tools all accept it, which matters
because a player who digs down and bases below y=0 has no cobblestone at all.

GREAT CAVERNS (`world/caverns.js` — a new file) — the report that "this has
failed to land across three previous phases" was correct, and it was correct
for a structural reason. Phases 15, 17 and 22 each tried to grow rooms by
thresholding another 3D noise field; measured over 256x256, that pass carved
0.1% of the cells it was offered, because a noise iso-surface near its own
95th percentile is a scatter of fragments and no retuning changes that shape.
So caverns are PLACED now. The world tiles into 224-block regions, each
hosting at most one chamber (72%) at a hashed centre, carved as a
noise-warped superellipsoid whose y exponent flattens floor and ceiling into
an actual room. A mid-level shelf noise leaves part of a slab uncarved — that
is the multi-level: a mezzanine with a drop off its edge. Two connector bores
leave near floor height and climb outward into the tunnel network.
VERIFIED, not asserted: 5 chambers in a 512x512 world, one per ~229 blocks
of travel, 32-56 blocks across and 20-40 tall by construction, and a flood
fill from open sky reaches 5 of 5. In the running game, standing at
(292, -30, 308) measures 38x51 blocks of open space with 18 up and 18 down.
**AMENDED (Phase 25): every number here was true, and the report that
caverns were still too rare to find was ALSO true.** Density was the thing
nobody had measured: at one chamber per 224-block region a chamber's
footprint covered ~3% of the cave band. Phase 25 changed only the RATE
(REGION_SIZE 224 -> 128, CHANCE 0.72 -> 0.88, connectors 2 -> 3) and then
measured the quantity the report was actually about — how far you have to
walk THROUGH AIR from a random cave cell to reach a big room: 67% within
60 blocks, 80% within 120, 91% within 240. See the Phase 25 entry.

LAVA ABOVE -54 — the PROGRESS entry marking this fixed in Phase 10 was wrong
and is corrected below. Phase 10 asked a 2D mask whether a COLUMN was in a
"pool region" and then flooded every cave-floor cell in it from -53 up to
y=9; whole cave floors came out molten and read as lava lakes 40 blocks above
the level that should have them. Measured over 256x256: 3040 lava cells above
y=-54. Nothing above the lake level is masked now — a few seeded sites per
chunk each flood at most 8 connected floor cells below y=-12, plus rare
single-block wall springs. Re-measured over 384x384: 27 lava cells per
100x100 columns where the old rule gave 464, a 17x reduction, and the caves
above y=-11 are essentially dry.

WATER, GRAVEL AND CLAY — cave floors are damp: single-block springs weeping
from walls and small floor puddles across the whole band, waterfall columns
down great-cavern walls, and gravel/clay banks wherever water sits (clay's
atlas tile is generated at boot, like the item art).

SOUND RETUNE + PAUSE (`systems/audio.js`) — footsteps were built around a
150 Hz sine gliding to 90 Hz, so every step played the same two notes and
sprinting (a step every ~230 ms, each 156 ms long) warbled: that is the
reported "strange, unnatural noise". Footsteps are two noise layers and no
oscillator now, every decay is roughly halved, landing has its own heavier
sound instead of a footstep at 1.8x, and sprinting no longer gets a volume
boost. `tone()` gained a lowpass so the sawtooth and square voices behind the
hurt/hit/mine/arrow sounds stop buzzing. And pausing pauses the sound:
`audio.setPaused()` suspends the whole AudioContext (verified in-browser:
running -> suspended -> running, with a sound requested while paused refused
rather than sneaking the context back on).

---

Phase 22 — POLISH: particles and sound.

The game is no longer silent, and nothing you do goes unacknowledged.

PARTICLES (`render/particles.js`) — ONE fixed, pooled, capped simulation
(PARTICLES.MAX 2000) drawn in exactly TWO instanced draw calls: textured
cubes cropped from a block's own atlas tile, and flat coloured cubes.
Nothing is allocated after boot — the per-particle state lives in flat typed
arrays and one linear pass per frame integrates AND writes both instance
buffers. Breaking a block bursts its own texture (with block collision and
bounce), placing puffs it, footsteps kick up scuffs tinted to the block
underfoot (more when sprinting), landing throws a ring scaled to the fall,
entering water splashes and swimming trails bubbles, lava rises embers and
occasionally pops, explosions expand smoke + debris + a core flash,
hits throw red, anything that dies puffs, pickups sparkle, end portals
swirl purple, endermen leave a purple column at BOTH ends of a blink, and
torches and glowstone flicker. Measured: 0.16ms/frame at 1900 live
particles, 0.30ms in the brief's worst case (a creeper blast beside a lava
lake with mobs dying), 0.25ms/frame for particles AND ambience combined in
a busy scene.

SOUND (`systems/audio.js`) — the whole game, synthesised with the Web Audio
API; no audio files ship and none load. One AudioContext; every sound is a
LAYER of two to four oscillator/noise voices (a body tone, a transient, a
click) so a stone footstep reads as a boot on rock rather than a beep;
everything routes through a bus compressor, which is what makes a dozen
simultaneous events land as one satisfying thump instead of clipping mush.
Positional sounds attenuate with distance and pan across the stereo field
from the camera's right vector, and a voice budget drops the overflow.
Footsteps and break/place/mining vary by material (stone, dirt, grass,
sand, gravel, wood, wool, glass, metal, netherrack), and the catalogue
covers player/mob hurt and death, the swing and the thwack that lands, bow
draw/release and arrow impact, the creeper's hiss and the blast, the
ghast's shriek, the blaze's crackle, the enderman's warp, splashes,
bubbles, lava pops, eating, pickup, the level-up chime on victory, looping
water and lava ambience whose gain follows the fluid around you, the end
portal's hum, and rare distant cave tones underground. dimensions/portals.js
and systems/combat.js both gave up their private WebAudio code to it — ONE
context, ONE compressor for the game.

AMBIENCE (`systems/ambience.js`) — the per-frame half: the player's own
footsteps/landing/splash/bubbles, and vanilla's randomDisplayTick sampling
~14 000 random cells a second around the player so torches, lava, glowstone
and end portals emit wherever they actually are.

THE SIX REPORTED BUGS —
(1) the boss bar: it is MAGENTA now (vanilla's PINK), captioned "Ender
Dragon" above it, across the top centre, at z-index 12 with its visibility
forced every frame it shows — and it no longer waits for the dragon fight's
first tick, because ARRIVING in the End is what shows it (health null on
the arrival frame used to leave it hidden);
(2) water buckets: placement now runs its OWN fluid-aware ray instead of
reusing the block raycast's target. The block ray skips fluids entirely, so
aiming anywhere at a pool, a stream or the water you are standing in
resolved to the solid floor under it — or to nothing past reach — and the
click silently did nothing. Flow re-verified end to end: a placed source
spreads exactly 7 cells, each one visibly lower, fills a depression, and
falls when its support is knocked out;
(3) golden apples: ABSORPTION II — 4 extra hearts for 2:00 — plus
Regeneration II for 5s. The yellow hearts sit in their own row directly
above the red health hearts and empty completely before real health takes
anything. The row's visibility is written every frame rather than only on a
change, because a stale write is exactly the shape of the "no yellow hearts
appear" report;
(4) held-item mirroring: SPRITE_TILT yaws the item slab ~180°, so what
faces the camera is its BACK — the mirror image. Tools were screenshot-
tuned in that pose and read right, so they keep it; everything else is
mirrored back with a negative local X scale (same pose, right-way-round
picture). Held BLOCKS were checked and are NOT mirrored — items.js's face
table is byte-identical to the mesher's in world/emitters.js — so they were
left exactly as they were;
(5) ender pearls (`entities/ender_pearl.js`): right-click throws one on a
real gravity arc, swept in sub-steps so it cannot tunnel, and the player
teleports to where it lands for the vanilla 5 points (2.5 hearts);
(6) thrown eyes of ender render THROUGH terrain (depth test off, drawn
last) with a sparkling wake — following the bearing is the whole point, and
an eye that vanishes behind the hill it is crossing tells you nothing. The
material is CLONED per eye: the cache is shared with the hand, the drops and
the UI icons.

Also: the potion-effect indicator shrank to vanilla's proportions — a 24px
framed icon with the countdown BENEATH it, in a row across the top-right
corner (three simultaneous effects now occupy 80x35px in total, where ONE
used to take 82x38 and they stacked downward into the view).

Four new files, no file grown past the cap, and dragon.js/blocks.js
deliberately untouched (they still carry their mandated cuts).**

Previous phase: **Phase 21 — the building set and the Phase 20 bug reports
(see the Session log).**

Earlier: **Phase 20 — the final fight: the End rebuilt
complete (dimensions/end.js — the ~110-block end-stone island floating
over void with a ragged coast and a dead-flat central plateau, TEN
obsidian pillars ringing the centre at radius ~33 with heights climbing
40→70 around the ring in seeded order, each capped with a bedrock crystal
seat and rooted into the island; the inactive EXIT PORTAL fountain at the
centre — bedrock base disc, raised rim, empty 20-cell portal well, central
bedrock column with four wall torches; the obsidian arrival platform and
endermen unchanged), end crystals (entities/crystals.js — the vanilla
display converted from the real end_crystal sheet: spinning tilted glass
cage, counter-spinning core, flat base, bobbing over the seat; each is a
combat target through the standard mob facade — ONE hit from a melee
swing, arrow or blast pops it in a real explosion), THE ENDER DRAGON
(entities/dragon.js + the DRAGON_MODEL rig in models.js converted from the
vanilla ModelDragon — verified against the shipped 256x256 sheet including
the negative-texOffs wing-membrane trick, rendered DoubleSide like
vanilla's no-cull: head with lip/nostrils/ears and a hinged jaw, 4-segment
neck and 6-segment tail laid out along animated bezier chains per frame,
wings + wingtips flapping by phase, four two-part legs that trail in
flight and plant on the perch; a kinematic flyer with banked turns driven
through the SPEC phases — CIRCLING a ring above the pillars, STRAFING runs
that swoop past the player with wing knockback, PERCHING on the exit
portal fountain where the neck cranes at the player and the BREATH attack
pours a purple particle cone with damage ticks; 200 health, head-only full
damage with the body at 0.25x, projectile-immune while perched (vanilla —
detected by hit distance, melee lands within reach), healed 3/s by the
nearest living crystal over a visible additive beam with a 10-damage sting
when its feeder pops mid-drink), the DEATH SEQUENCE (glide to a hover
above the fountain, nose lifting, nine radiating light beams growing
through 5.5s, a terminal white-out flash — then the exit portal well
fills with END_PORTAL blocks and the dragon egg appears on the fountain
column as a layered-box trophy with generated speckled shell art), the
WIN (stepping into the active exit portal shows the VICTORY screen —
ui/screens.js, edge-triggered from dragon.js — and Return Home travels
back to the overworld spawn with inventory intact), combat integration
with ZERO combat.js changes (main.js hands createCombat a target FACADE
merging the mob manager's raycast with the dragon fight's part boxes and
crystal boxes, all gated to the End dimension), and the mandated
TEST_CHEST removal (later restored by request for End-fight testing —
see the TEMPORARY section; the game itself needs no kit and was
verified completable from a fresh world)**

Previous phase: **Phase 19 — the stronghold and the end portal:
stronghold generation (dimensions/stronghold.js — ONE stronghold per
world, underground, its portal room anchored EXACTLY to the
strongholdCenter point the eyes of ender have flown toward since Phase 18
— a seeded blueprint of 11-block cells grown by the fortress.js walk:
3-wide walled corridors with torches, staircase pieces shifting the deck
±4 between levels, junction rooms where arms branch, terminal LIBRARIES
(bookshelf-lined walls + a central double row, torch-lit) and STORAGE
rooms (loot chests, crates, an iron-barred stock cell) — all in stone
brick weathered per-block with mossy/cracked variants, every piece
linked flush and every room doorwayed toward its linked neighbours, with
support piers where pieces cross caves; emitted per chunk as the
overworld's LAST generation pass, order-independent), the portal room
(the 12-frame end portal ring around a sunken 3x3 lava pool, iron-bar
wall niches, walkway torches; each frame pre-filled with an eye at 10%
per seed-hash — strongholdCenter lands on a WALKWAY column so digging
straight down at the eye's signal can never drop the player into the
pool), the end portal itself (right-clicking an empty frame with an eye
of ender fills it through the real use chain; the 12th eye fills the 3x3
interior with END_PORTAL blocks — an animated fullbright sheet at 12/16
— and falling in transports to the End), a real-if-minimal END dimension
(dimensions/end.js — the ~100-block end-stone island floating over void
with a ragged coast, the obsidian arrival platform ON the island margin
so arrival can never soft-lock, END_SKY purple gloom, endermen spawning
any-light on the island; void below y=-80 kills — pillars/crystals/
dragon are Phase 20, layering onto this generator), stronghold loot
chests (world/chests.js grew the spawners.js chunk-scan — generated
chests are discovered per newly meshed chunk and stocked ONCE with
deterministic per-position loot: bread/iron/coal/apples/pearls/books/
torches), the four session bug fixes (the brewing stand's REAL box model
— stone base plate, thin rod, three radiating bottle-arm panes sampling
the tile art — replacing the garbled full-cube; brewing re-verified
end-to-end in the live game through every insertion path and fuel now
loads EAGERLY like vanilla so the powder bar responds the moment powder
goes in; endermen raised 20→60 overworld spawn weight AND spawning
commonly in the Nether — 2:1 over ghasts via per-dimension weight
overrides, cap 10 — and filling the End; Nether fog widened 8/72 →
20/140 so terrain, lava oceans and fortresses read at distance), iron
bars rendering as real connecting panes (an emitter, like the new
frame/portal/stand shapes — atlas tile 58 `end_portal_frame_eye` was
generated into the atlas: frame top + the ender-eye art), and the
mandated player/interaction.js split (player/fluid_actions.js — the
bucket/bottle actions, moved verbatim; interaction 765 lines, back under
the cap; the spawn-profile machinery also moved from mobs.js into
entities/spawning.js, its natural home, keeping mobs.js under the cap)**

Phase 18 (still earlier): **the bridge to the End: brewing
(systems/brewing.js — the 5-slot brewing stand on the SlotContainer
machinery, blaze powder fuel loaded 20 operations at a time, the SPEC
potion table with all three bottles transforming together per 20s
operation; glass bottles fill into water bottles at any water source;
potions drink through the hold-right-click path, leave their glass bottle,
and apply real effects in stats.js — fire resistance suppressing ALL
lava/fire damage for 3:00, the run-critical one; strength +3 melee;
healing instant — with a HUD indicator and tinted-bottle item art
generated from the shipped bottle sprite), the enderman (SPEC 40hp/7dmg,
the real 2.9-block model with the separate jaw layer; passive until the
player looks directly at its head — the exact camera-forward vector against
the vanilla dot threshold, line-of-sight gated — then aggressive with the
creepy head-lift pose; blinks away when hit, blinks to a distant target
while angry, takes water damage and blinks out of it; drops ender pearls;
a rare overworld night spawn), eyes of ender (right-click throws one
toward the DETERMINISTIC stronghold point — dimensions/stronghold.js
places it 1000-2000 blocks from spawn per seed, next phase generates the
stronghold exactly there — the eye rises, glides, hovers, then drops back
as an item or shatters 20%), the three session bug fixes (blazes retuned
to the real values: volley of 3 fireballs 0.3s apart, then a full 5s
cooldown, 5 damage on a direct hit plus a 4s burn, and a 1.2s wind-up
with a visible body flare; fortresses grown to the real sprawling scale:
one per 384-block region, ~100-piece blueprints spanning up to ~300
blocks, straight bridges up to 112 blocks, staircase galleries shifting
whole arms up/down 6 blocks, tall crenellated towers, and an enclosed
3x3-room keep around the heart — per-piece deck heights with flush-link
guarantees; the Nether brightened: ambient floor 6 -> 9 with a warmer
red-orange fog and tint, lava oceans lighting their shores through the
normal flood fill), and the mandated ui/screens.js split
(ui/containers.js — the chest/furnace/brewing screen sections).

---

## TEMPORARY, MUST REMOVE

_Nothing._ Phase 25 deleted the spawn test chests and the `TEST_CHEST` config
flag together, as mandated. Survival starts with an empty inventory in an
unmodified world — verified in the running game (every one of the 36 slots
null, and no chest block anywhere in the 9x9x6 box around the spawn point).
A player who wants a kit picks Creative on the start screen.

For the record, since this entry has been the project's one standing debt
since Phase 15: the chests held 14 obsidian, flint and steel, a brewing
stand, 64 blaze rods, 8 blaze powder, 8 nether wart, 16 ender pearls, 16
eyes of ender, 6 glass bottles, 6 water bottles, 3 buckets, a full diamond
armour set, diamond sword/pickaxe/axe/shovel, an iron sword, 3 bows, 128
arrows, 5 golden apples, 64 torches, 64 cobblestone and 64 oak planks. They
were removed at the end of Phase 20 as originally mandated, restored by
request for End-fight testing, and are now gone for good.

---

## Working

- **Phase 27 chat + commands** — `ui/chat.js` `createChat({ canvas,
  onCommand, canOpen })` -> `{ open(prefill), close(relock), isOpen }`;
  main.js's pause verdict includes `!chat.isOpen` (the signs.isEditing
  slot). `systems/commands.js` `createCommands({ world, player, dimensions,
  notify })` -> `{ handle(line), teleportTo(x, z, y?) }` — notify injected
  (showToast) so systems never import UI. Adding a command = one branch in
  `handle`. Config CHAT.
- **Phase 27 streaming idle/resume** — `world._streamIdle` (a completed
  no-work pass parks the streamer; setBlock, border crossings and
  swapState wake it — anything that dirties a chunk MUST go through
  setBlock, which has always been the rule) and `world._scanFrom` (passes
  resume at the first incomplete offset; reset wherever work can appear
  behind it). prebuild explicitly un-parks — its small ring "completes".
  Tier remeshes capped per pass (VIEW.LOD.RETIER_PER_PASS).
- **Phase 27 far-chunk light** — `chunk.lightData` is written only by
  tier-0 meshes now; `world.getLight` returns null out there (it always
  could — unmeshed chunks never had data) and every consumer already
  handles null. Do not add a getLight consumer that reaches past
  VIEW.LOD.DETAIL_CHUNKS without revisiting chunks.js.
- **Phase 26 plains spawn** — `world/spawn_scan.js` `scanPlainsSpawn(gen)`
  (the generator passed as an argument, cycle-free) +
  `TerrainGenerator.spawnColumn()` (cached). `findSpawnPosition` centres its
  search on the scanned column; `strongholdCenter(seed, spawn)` and the eyes
  of ender anchor to the same one via `StrongholdGenerator.center()` (ONE
  cached anchored centre — blueprint, emitChunk early-out and entryPoint all
  share it; never call `strongholdCenter(seed)` bare for this world).
  Tunables in `TERRAIN.SPAWN_SCAN`.
- **Phase 26 LOD** — `buildChunkMesh(chunk, getChunkAt, materials, lod)`;
  `chunk.mesh.lod` records the built tier; `world.js _streamPass` picks the
  tier from distance (VIEW.LOD, hysteresis on demotion) and only when
  `generator.hasOpenSky` (overworld). Tier 1 skips cross plants, culls leaf
  interiors, and culls faces fronting sky-0 air (fluid flows probe the cell
  above). Geometry bounding spheres precomputed at build for frustum culling.
- **Phase 26 post pipeline** — `render/post_fx.js`
  `createPostPipeline({ renderer })` -> `{ render(scene, camera, state) }`;
  state = `{ sunDir, sunLevel, skyActive }` read off the day/night cycle
  (which now exposes `sunLevel` / `sunDirection` / `skyActive` getters).
  Linear half-float scene target (MSAA + depth), god rays / bloom /
  grading composite, ONE sRGB encode at the end. main.js falls back to the
  plain `renderer.render` when `VISUAL.POST_ENABLED` is false; the hand
  pass still draws straight to the canvas after the composite.
- **Phase 26 water surface** — `render/water_fx.js`
  `patchWaterMaterial(material)` (layered on `patchChunkMaterial`; the
  STILL pass only) + `WATER_UNIFORMS` + `updateWaterUniforms(delta, sky)`
  called per frame from main.js (delta 0 while paused). Ripple is
  render-only; physics and raycasts read the unmoved cells.
- **Phase 26 shadow feel** — `CHUNK_LIGHT_UNIFORMS` gained
  uShadowCool/uShadowCoolStrength/uBounceColor/uBounceStrength (config
  VISUAL.SHADOW), applied in the chunk shader from the vertex-colour shade,
  daylight and sky access.
- **Phase 26 golden hour + haze** — `DAY_NIGHT.KEYFRAMES` gained golden-hour
  frames at both day edges and a HAZE channel (0 = SKY.FOG_NEAR/FAR, 1 =
  SKY.HAZE_NEAR/FAR); the cycle writes fog near/far every frame now (the
  lava-view override in main.js still runs after it and wins; the fixed-sky
  dimensions still override both). Sun glow: CELESTIAL.SUN_GLOW_SCALE 3.4 +
  SUN_GLOW_STRENGTH 0.72.
- **Phase 26 celestial occlusion** (reworked with the Phase 27 realistic
  clouds) — stars (-1.5) and sun/moon (-1.2) are pinned to the far plane by
  `sky_fx.js forceFarDepth`; the cumulus layer draws TWICE: a depth-only
  pass at renderOrder -1.95 (colorWrite false, fragments survive only where
  alpha >= CLOUDS.CORE_ALPHA — dense cloud occludes the celestials per
  pixel) and the soft colour pass at -1.1 (no depth write, blends over
  their rims). The cirrus veil is colour-only — the sun THROUGH cirrus is
  the intended read. Terrain never conflicts (peaks ~140 vs layer 192).
- **Phase 27 follow-up: realistic clouds + moonlight** — the blocky slab
  deck is gone; `sky_fx.js createClouds()` is now a camera-following plane
  at CLOUDS.HEIGHT whose fragment shader grows soft cumulus from
  domain-warped 5-octave fbm value noise (world-anchored pattern + wrapped
  drift, weather-gate grouping with real clear sky, detail-noise edge
  erosion for the curdled rim, thin-edge brightening, silver linings near
  a low sun) plus a faint higher cirrus plane; all knobs in CLOUDS.
  Self-shading is PSEUDO-VOLUME (the second follow-up): density is treated
  as the height of a dome, rotated-grid relief bumps keep the interior
  dappled after the body saturates, and the normal takes a real N.L
  against the 3D sun — the moon after dark (setSun negates the direction
  below the horizon). The cirrus veil skips the six gradient taps via its
  FLAT_SHEET define. Moonlight: a cool additive halo quad behind the moon
  (`createMoonGlowTexture`, CELESTIAL.MOON_GLOW_*), a wide moonlit dome
  wash through the sky shader's glowBand uniform (MOON_SKY_GLOW_*), a
  brighter silver-blue night (LIGHTING.NIGHT_SKY_TINT, night SKY_DARKEN
  10) and a moon glint lane on water (CELESTIAL.MOON_GLINT_LEVEL wired in
  main.js).
- **Phase 27 follow-up: the ROUND moon** — `createMoonTextures()` draws an
  anti-aliased disc (R 0.94 of the quad, ~2.5px AA band, linear-filtered)
  instead of the vanilla pixel square: maria and craters generated ONCE
  from a seeded RNG so all eight phases show the same face, a soft
  elliptical terminator (TERM 0.09), a whisper of limb darkening, and the
  unlit part left as faint cool earthshine (MOON_DARK_ALPHA). MOON_SIZE
  95 -> 104 keeps the old apparent diameter with the disc inscribed.
- **Phase 26 dust motes** — `particles.dust(x, y, z)` + the air-cell branch
  of the random display tick (`systems/ambience.js`): sky >= DUST_MIN_SKY
  at DUST_MIN_DEPTH under the generator surface, overworld only. Tunables
  in PARTICLES.DUST / PARTICLES.AMBIENT.DUST_*.
- **Phase 26 surface rules** — `world/surface_rules.js` (the Phase 24 rules
  moved verbatim per the size cap; generator passed as argument;
  A/B-verified byte-identical chunks).
- **Phase 25 game modes** — `player/gamemode.js`: the `gamemode` module
  singleton (`current` / `creative` / `survival` / `other` / `label` /
  `chosen`, `set(mode)`, `toggle()`, `subscribe(fn)`). Import it and ask it;
  never thread a mode flag through a factory. Its subscribers today are
  stats (restore to full on entering creative), controller (ground the
  player on leaving), hud (badge text) and menus (button labels).
- **Phase 25 start screen + pause menu** — `ui/menus.js`
  `createMenus({ canvas })` -> `{ setPaused(paused), startShown, pauseShown,
  chooseMode(mode) }`. main.js calls `setPaused` every frame with its own
  pause verdict; the overlay never shows over the start screen or before the
  first lock. The pause overlay is `pointer-events: none` with an `auto`
  panel, which is what keeps click-anywhere-to-resume working.
- **Phase 25 creative flight** — `body.flying` (a plain field; the
  controller sets it) switches `PlayerBody.step` to `_stepFlight`. Tunables
  in `CREATIVE`. `player.setFlying(on)` / `player.flying` on the controller;
  double-tap Space is the player-facing toggle and is creative-only.
- **Phase 25 creative inventory** — `ui/creative.js`
  `createCreativeScreen({ inventory, canvas })` -> `{ openScreen,
  closeScreen(relock), isOpen, cursor, visibleItems }`. `CREATIVE_TABS` is
  the catalogue (exported, so a test can walk it); add an item by adding its
  name to a tab — it must already resolve through `itemVisualInfo`.
- **Phase 24 rivers** — `TERRAIN.RIVERS` in `world/terrain.js`
  heightFromWeights: |field| < width presses the height toward a bed below
  sea level (parabolic profile, eased banks, width varied by a second
  field), min() only — never raised — so channels join any water they
  cross. Ocean-shield already keeps caves from draining them.
- **Phase 24 surface rules** — `surfaceLayersFor(x, z, biome, height)`:
  underwater floors (shallow sand / deep dirt, gravel-patched), beach only
  within `SURFACE.BEACH.REACH` of real water, desert unchanged, mountain
  stone by `SURFACE.STONE_LINE` + `STEEP_DROP` (slope from the 4-neighbour
  heights through the `_hCache` memo), grass otherwise.
- **Phase 24 biome warp + tree fields** — `TERRAIN.BIOME_WARP` domain-warps
  the climate/region sampling; `TREES.DENSITY_FIELD`/`HEIGHT_FIELD` vary
  spacing and trunk height inside a biome.
- **Phase 24 surface lava pools** — `TERRAIN.SURFACE_LAVA`: one hashed
  candidate per 112-block region tile, mountains/desert only, flat ground,
  closed-basin by construction (level = lowest footprint column - 1, rim
  relief-checked); trees/cacti/plants skip footprints via `_surfacePoolAt`.
- **Phase 24 contained cave lava** — `_floodContainedPool`
  (`world/caves.js`): pools above `LAKE_MAX_Y` dig INTO flat cave floors,
  erosion-guaranteed to have no air below or beside any cell, so the fluid
  settle scan never grows them. Measured: 148 contained cells + 8 springs
  per 256x256 above y=-54, zero leaks.
- **Phase 24 cross-plane plants** — `world/plants.js` (registrations, soil
  rules) + `emitCross` (`world/emitters.js`, dispatched via `CROSS_TILE`
  before the generic cube path) + `placePlants` (`world/terrain.js`).
  Instant break, seeds 1/8 from short grass, popped by the main.js soil
  listener, placeable on grass/dirt (bush also sand), replaceable by
  placement and buckets, sprite items via `ATLAS_SPRITE_ITEMS`, grass
  sound group. Meshing measured at baseline cost.
- **Phase 24 sky** — `render/sky_fx.js`: `createClouds` (rebuilt as the
  Phase 27 shader cumulus layer, see the Phase 27 follow-up entries above;
  drift and sRGB-correct day/night light survive from the deck era),
  `createStars` (keyframed alpha, orbit-wheeled), `createSunTexture`
  (round disc + windowed additive glow since the Phase 26 follow-up),
  `createMoonTextures` (8 phases, ROUND discs since the second Phase 27
  follow-up). `createDayNightCycle` gained a day counter (`dayIndex`), the
  STARS and TINT keyframe channels, and drives all of it; both hide under
  the fixed-sky dimensions. Fog stays horizon-matched.
- **Phase 23 deepslate** — `world/terrain.js` `deepslateChance` +
  `UNDERGROUND.DEEPSLATE`, blocks 163-169, atlas 58-64. Below `TOP_Y` (0) the
  column fill's stone becomes deepslate, blended over the band to `FULL_Y`
  (-8) by an independent per-block hash roll, so the transition is a speckled
  interleave rather than a plane. Hardness 3.0 (2x SPEC's stone), drops
  cobbled deepslate; the five deepslate ores carry their stone twins' tool
  tier and drops at hardness 4.5. `world/caves.js` `_placeVeins` takes a
  `deepId` and picks it per cell from the block being replaced, so veins
  crossing the band come out mixed. `STONE_FAMILY` and `CARVABLE` both
  include deepslate; the granite/diorite/andesite pass targets `BLOCK.STONE`
  only, so the deep world stays deepslate. Cobbled deepslate is a stone
  crafting material (`systems/crafting.js`): furnace, brewing stand and the
  five stone tools, which is what stops a below-zero base being a trap.
- **Phase 23 great caverns** — `world/caverns.js`, `CAVES.GREAT_CAVERN`.
  PLACED chambers, not a noise threshold: the world tiles into `REGION_SIZE`
  (224) squares, each hosting at most one chamber at `CHANCE` (0.72) with a
  hashed centre, radii (long axis 36-58; the short axis is held at 85% of it,
  which is what keeps even the smallest chamber above 30 on both), height
  (20-40), shelf and connectors. The body is
  `|dx/rx|² + |dz/rz|² + |dy/ry|^3.2 < (1 + 0.24·warp)²` — the y exponent is
  what makes it a room rather than a lens, and the warp field is what makes
  no two alike. `SHELF` leaves a 3-block slab partly uncarved at 30-55% of
  the chamber height for the ledges and drops. `CONNECTORS` bores two
  swaying, climbing 2.2-radius passages out from floor level. Carving is
  split by box (body box and per-connector box) so a chamber costs what it
  writes; generation is 6.2 ms/chunk over a cavern versus 6.5 ms on plain
  terrain. Pure in (seed, world position), in-chunk writes only:
  regenerating a chunk in a different order gives 0 differing cells.
- **Phase 23 underground water and banks** — `_placeSprings`,
  `_placeShoreBanks` and the re-anchored `_placeWaterfalls` in
  `world/caves.js` (`CAVES.SPRINGS`, `CAVES.WATERFALL`,
  `UNDERGROUND.SHORE_PATCHES`). Wall springs and floor puddles across the
  cave band, waterfall columns keyed to the great caverns' own column mask,
  and gravel/clay conversion of floor cells within 2 blocks of any water.
  Over 384x384: 1121 underground water cells, 2645 clay, 14647 gravel.
- **Phase 23 lava placement** — `world/caves.js` `_placeLava` +
  `_floodPool`/`_floorBelow`/`_againstWall`, `CAVES.LAVA`. Full flood at and
  below -54 unchanged; above it, seeded sites flood at most 8 connected
  floor cells below `POOL_MAX_Y` (-12), plus wall springs at 0.0004 per
  eligible cell up to y=8. 27 lava cells per 100x100 columns above -54,
  against 464 under the Phase 10 rule.
- **Phase 23 sound and pause** — `systems/audio.js`. Footsteps are two noise
  layers with no oscillator, `MATERIAL.decay` roughly halved across the
  board, `land()` is its own heavier sound, `tone()` takes a `lowpass` that
  tames every sawtooth/square voice, and `SPRINT_STEP_INTERVAL` went 0.30 ->
  0.34. `audio.setPaused()` suspends/resumes the AudioContext (main.js calls
  it every frame with the pause state); `tryResume()` is the single place any
  module may un-suspend it, and `playLayer`/`setLoop`/portals.js all refuse
  while paused. `audio.contextState` exposes the context's own state for the
  harness.
- `index.html` — importmap pinned to three@0.160.0 (unpkg), fullscreen canvas,
  pointer-lock hint overlay.
- **Phase 22 particles** — `render/particles.js`. ONE pooled simulation, TWO
  instanced draw calls (textured atlas-crop cubes / flat coloured cubes),
  struct-of-arrays state, nothing allocated after boot, hard-capped at
  PARTICLES.MAX. Emitters: blockBreak / blockPlace / footstep / landing /
  splash / bubble / ember / lavaPop / flame / sparkle / explosion / damage /
  death / pickup / portal / enderTrail. Spawn-time light tint, spawn-time
  distance cull, per-particle block collision behind a live-count gate,
  sRGB->linear colour decode (the renderer encodes on output — skipping this
  rendered dark smoke as pale grey). Cleared on every dimension switch.
- **Phase 22 sound** — `systems/audio.js`. One AudioContext -> per-voice
  graph -> bus gain -> compressor -> master. Layered voices, per-material
  timbre table, distance falloff + stereo pan off the camera's right vector,
  a voice budget and a per-sound retrigger gap. `blockSoundGroup(name)`
  derives a block's material from its registry NAME (blocks.js stays a block
  registry, not a sound one). `audio.setLoop(name, gain, spec)` is the
  continuous-bed API (water, lava, the end-portal hum).
  `ensureAudio()`/`getNoiseBuffer()`/`audioBus()` are exported so
  dimensions/portals.js shares the one context.
- **Phase 22 ambience** — `systems/ambience.js`: footsteps paced off real
  ground speed, the landing burst, the water splash on transition, the
  bubble trail, vanilla's randomDisplayTick (~14 000 cells/second in a
  21-cube around the player), a cached end-portal cell list driving its
  swirl and hum, the fluid ambience census, and the cave tone.
- **Phase 22 HUD** — `ui/hud.js`: the MAGENTA boss bar (config
  UI.BOSS_BAR carries the palette and caption), the ABSORPTION row (four
  gold hearts, `heartDataUrl(variant, palette)` draws the same shape in a
  second palette; the row sits directly above the health hearts and pushes
  the armour bar up while it shows), and the potion-effect chips resized to
  config UI.EFFECTS_HUD — a small framed icon with the countdown beneath,
  laid out in a row across the top-right corner.
- **Phase 22 ender pearls** — `entities/ender_pearl.js`: gravity arc,
  sub-stepped sweep (no tunnelling at 22 b/s), teleport to the landing point
  with a headroom climb, 5 points of arrival damage, purple burst and warp
  at both ends. Wired like the eyes (`onThrowPearl` in main.js, in the
  dimension managers list).
- **Phase 21 building set** — `world/shapes.js` (ids + registry entries) and
  `world/shape_tables.js` (the box tables) hold stairs/slabs/fences/gates/
  walls/ladders/doors/trapdoors/beds/signs/pots/frames; the mesher's generic
  `emitShape` (world/emitters.js) and the collision sweeps in
  `player/body.js` + `entities/entity.js` read the SAME boxes.
  `player/placement.js` owns where they go. WORKING and covered by 88
  automated checks.
- **Phase 21 fluids** — `world/fluids.js` runs lava AND water on one
  parameterised automaton; `world/emitters.js` renders both at partial
  height on their own scrolling texture. WORKING.
- **Phase 21 combat/utility** — the shield (systems/combat.js
  `setBlocking`/`shieldBlocks`), shears on leaves, charcoal, the block
  forms, the boss bar (`ui/hud.js setBossBar`) and beds (main.js `trySleep`
  + `stats.setSpawnPoint`). WORKING.
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
    **CORRECTED IN PHASE 23 — this fix did not hold, and the census above
    measured the wrong thing.** "Zero lava at/above y=10" was true and
    beside the point: the complaint is about y=-54 to y=10, where the rule
    flooded EVERY cave-floor cell of every column inside a pool-mask
    region, producing continuous molten sheets that read as lava lakes far
    above the level that should have them. Re-measured over 256x256: 3040
    lava cells above y=-54. The mask is gone — see the Phase 23 lava entry.
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

Phase 14 (this session) additions, one entry per file:
- `src/entities/spawning.js` — NEW: the natural-spawning framework, split
  out of mobs.js (the ARCHITECTURE cap note it carried since Phase 13).
  Same gates as Phase 12/13 plus the Phase 14 rules: passives require
  REAL DAYLIGHT on their grass (the sky component after the time-of-day
  darken — a torch-lit field at night spawns nothing), and passives count
  toward PASSIVE_CAP only within DESPAWN_DISTANCE — they never despawn, so
  herds left behind by a travelling player must not starve the cap forever
  (the left-behind mobs freeze in unloaded chunks like items always did).
  Spawn pacing retuned for the "caves feel crowded" report: HOSTILE_CAP
  32 -> 14, one cycle of 4 attempts every 2s (was 8 every 1s).
- `src/entities/passive.js` — NEW: passive-herd behaviour. One wander AI
  for all four animals: idle 2-6s, amble a 2-4s leg in a random direction
  at 0.45x speed, repeat — with a per-frame look-ahead probe that refuses
  ledges deeper than 3 and lava (a grazing cow won't stroll into a
  ravine); any new damage panics the animal into a full-speed sprint away
  from the player for 5s with per-animal angular jitter (herds scatter).
  Sheep: shear (via mobs.useOnMob) pops 1-3 wool, hides the wool overlay,
  regrows on a 60-150s timer. Chickens: lay an egg every 150-300s.
  Quadruped animation (diagonal leg pairs) + chicken animation (legs,
  wings flapping while airborne). All tunables in config MOBS.PASSIVE.
- `src/entities/models.js` Phase 14 — parts can carry extra `boxes` on the
  same pivot (a pig's snout, the cow's nose/horns/udder, the chicken's
  beak/wattle — vanilla attaches several cubes to one bone), a baked
  `rotation` (the vanilla quadruped body lies on its side: -π/2 x here),
  and `attachOverlayModel` (a second sheet's model riding an existing
  rig as zero-offset children — the sheep's wool coat). `sheetTexture`
  passes a ready THREE.Texture through (the preview's canvas skin) with
  `textureKey` for the geometry cache. The four passive model tables —
  COW_MODEL (the 1.21.5 sheet: classic cow + the remodel's 6x3x2 nose at
  (0,32), confirmed present in the shipped art), PIG_MODEL, SHEEP_MODEL +
  SHEEP_WOOL_MODEL (0.6/1.75/0.5px inflates), CHICKEN_MODEL — converted
  from the vanilla models and verified box-by-box against the actual
  PNGs' opaque regions (56 automated checks).
- `src/entities/mobs.js` Phase 14 — registry entries for cow (10hp,
  beef 1-3 + leather 0-2), pig (10hp, porkchop 1-3), sheep (8hp,
  `dropsFor`: mutton 1-2 + wool only while unsheared), chicken (4hp,
  chicken 1 + feather 0-2) — meat ids follow the texture names the
  smelting recipes and food registry expect. Passive types are
  `ai: 'passive'` (entities/passive.js via the AI dispatch); sheep carry
  the wool overlay (`mob.woolPivots`, both materials tinted together);
  chicken sets `maxFallSpeed`. Skeleton: an extruded bow.png slab rides
  the LEFT arm pivot (the aim pose points it at the target), and firing
  is a real draw-and-release cycle — after a 1s cooldown an aiming
  skeleton winds up for 1s (mob.drawTime, visible: the bow arm lifts and
  the string arm folds back with the draw), releases at full draw, and
  repeats: one arrow per 2s flat out, never a snap shot on reacquiring a
  target (losing line of sight lets the draw down without firing).
  `useOnMob(mob, item)` routes right-clicked items (shears). The held-
  torch light lifts nearby mobs' tint via the shared uniforms.
- `src/entities/entity.js` Phase 14 — per-type `maxFallSpeed` clamp inside
  the physics step (the chicken's wing-flap slow fall). Clamped after
  gravity in step() — an AI-side clamp would race the integration and
  leak gravity*dt of extra speed per frame (+3.2 blocks/s at the clamped
  0.1s frame; measured exact at the cap now).
- `src/player/inventory.js` Phase 14 — `offhand`: a 1-slot SlotContainer
  (full click semantics on the screen for free) with `swapOffhand` (F),
  `consumeOffhand`/`replaceOffhand`/`damageOffhand`/`equipOffhand`,
  `offhandStack`/`offhandName`; `drainAll` empties it on death with the
  rest. FOODS: golden apple `always` (edible at full hunger), rotten
  flesh `poisonChance: 0.8`. The required food table was audited against
  the session's exact figures — all values were already vanilla-exact.
- `src/player/stats.js` Phase 14 — `gainExhaustion` routes every
  exhaustion gain through `STATS.EXHAUSTION_SCALE` (0.5): the third
  "hunger drains too fast" report; the Phase 12 audit proved the values
  vanilla-exact, so the whole system now runs at half rate (sprint's
  first hunger point ~86s, walking still free). Hunger poisoning:
  `poisonSeconds` accrues 0.1 exhaustion/s UNSCALED for 30s (vanilla
  Hunger I) with 80% chance from rotten flesh; `canEatFood(food)` is the
  eating gate (full-hunger exception for `always` foods).
- `src/player/interaction.js` Phase 14 — the two-hand model: right-click
  actions act through an ACTIVE HAND source (name/consume/replace/damage/
  equip routed to the hotbar selection or the offhand uniformly). The
  main hand acts if its item has ANY right-click use (bucket family, bow,
  shears, armour, food, placeable block); otherwise the offhand's item
  acts (vanilla's fallback rule) — so sword+bread eats the offhand bread,
  cobble+bread places the cobble. Placement, bucket scoop/fill, armour
  equip, eating (state keyed on the acting slot) and the bow draw all
  honour the acting hand. F swaps selected <-> offhand (pointer-locked,
  like the digit keys). `onUseMob` (main.js -> mobs.useOnMob): a mob
  under the crosshair is offered the right click before block use —
  shears shear sheep and wear 1 durability.
- `src/systems/combat.js` Phase 14 — `updateDraw(dt, source)` /
  `releaseDraw` track WHICH hand draws ('main' | 'off'); wear lands on
  that hand's bow; `drawSource` getter for the hand pose.
- `src/player/hand.js` Phase 14 — rewritten around two hand rigs: the
  right hand is the Phase 13 hand unchanged; the left mirrors it across
  the screen centre (OFFHAND_* config) and shows the offhand item
  whenever one is held — nothing at all otherwise, like vanilla. Each rig
  swings/eats/draws independently; `startSwing('off')` and the
  eat/draw poses land on the acting hand (eating.source, combat.drawSource).
- `src/ui/player_preview.js` — NEW: the inventory screen's live 3D player
  model (vanilla's inset). The standard humanoid (HUMANOID_MODEL — the
  session's exact proportions: head 8x8x8, body 8x12x4, limbs 4x12x4)
  wearing a GENERATED neutral skin (no Steve skin ships in assets/entity;
  painted canvas: skin/hair/teal shirt/blue trousers + value noise).
  Equipped armour renders live as colour-coded inflated overlay boxes
  (leather brown / gold / iron / diamond teal, plate texture with rim +
  sheen) on the covered limbs, synced from the armour slots. The whole
  model turns toward the mouse, the head leading and pitching, eased.
  Renders on its own tiny WebGLRenderer only while the inventory screen
  is open (screens.update drives it).
- `src/ui/screens.js` Phase 14 — the inventory-mode equip row is now
  armour column | player preview | offhand slot | 2x2 craft area (the
  vanilla survival layout). The offhand slot is a real SlotContainer
  slot with the full click/drag/shift semantics; panel mousemoves feed
  the preview's mouse-follow. `update(dt)` drives the preview.
- `src/render/lighting.js` Phase 14 — the held-torch dynamic light
  (deliberately beyond vanilla): `uHeldLightPos`/`uHeldLightLevel`/
  `uHeldLightTint` join CHUNK_LIGHT_UNIFORMS; patchChunkMaterial adds a
  world-position varying and a per-fragment term
  `pow(falloff, 15 - clamp(level - distance(pos, player)))` max'd into
  the light sum — one level lost per block of euclidean distance, the
  same curve as baked light but smooth and applied at render time, so it
  costs ZERO remeshing as the player moves (verified differentially:
  torch walk 101 remeshes / empty-hand walk 103 / standing 104 — all
  ambient streaming; a control block edit remeshed 25). All four chunk
  passes (opaque/cutout/water/lava) share the patch. `heldLightBrightness`
  exports the same falloff for JS consumers (the mob tint).
- `src/main.js` Phase 14 — writes the held-light uniforms each frame
  (level = max over LIGHTING.HELD_LIGHT of both hands' items — torch 14;
  position = the camera eye), wires `onUseMob`, and passes `mobs` the
  same as before. `initHud`/screens unchanged.
- `src/ui/debug.js` Phase 14 — the TIME label matches the retimed
  keyframes (day < 0.5, sunset < 0.575, night < 0.925, sunrise after).
- config Phase 14 — DAY_NIGHT.KEYFRAMES retimed to the real Minecraft
  cycle over TIME.DAY_LENGTH_SECONDS 1200: day exactly t 0-0.5 (10 min,
  sun above the horizon by the orbit maths), sunset 0.5-0.575 (1.5 min),
  night 0.575-0.925 (7 min), sunrise 0.925-1.0 (1.5 min); STATS gained
  EXHAUSTION_SCALE + HUNGER_POISON; MOBS.HOSTILE_CAP/PASSIVE_CAP and the
  spawn cycle retuned; MOBS.SKELETON's SHOOT_INTERVAL became
  SHOOT_COOLDOWN_SECONDS + DRAW_SECONDS (+ the bow-in-hand and draw-pose
  constants); MOBS.PASSIVE added; LIGHTING.HELD_LIGHT/HELD_LIGHT_TINT;
  INTERACTION.HAND.OFFHAND_*; UI.PLAYER_PREVIEW.

Phase 18 (this session) additions, one entry per file:
- `src/systems/brewing.js` — REAL (was a stub): the brewing stand.
  Registries in the file (the smelting.js shape): `BREW_RECIPES` — the
  SPEC table (water bottle + nether wart -> awkward; awkward + magma
  cream -> fire resistance; awkward + blaze powder -> strength; awkward +
  glistering melon slice -> healing) — and the blaze-powder fuel.
  `BrewingStand` is a 5-slot SlotContainer (3 gated bottle slots that take
  only water bottles/potions, a gated ingredient slot, a gated
  blaze-powder fuel slot; the furnace's click-gate pattern including the
  same-item pull-onto-cursor concession) plus the progress machine: a brew
  runs only when the ingredient maps at least one bottle, all matching
  bottles transform together after `BREWING.BREW_SECONDS` (20) consuming
  1 ingredient, one blaze powder loads `BREWS_PER_FUEL` (20) operations
  and is consumed only when a brew can actually start, progress belongs
  to the ingredient name (swaps restart, the furnace rule) and resets
  when the brew can't run (no rewind — vanilla brewing just stops).
  addStack shift-routing: bottles -> first empty bottle slots, powder ->
  fuel first then ingredient, other ingredients -> ingredient.
  `createBrewingSystem` is the per-position stand map: standAt lazy-create,
  every stand ticks with the screen closed, break drops all five slots,
  swapDimensionState like furnaces.
- `src/player/inventory.js` Phase 18 — the `POTIONS` registry (per potion:
  liquid colour + the effect drinking applies; the vanilla colours, awkward
  a distinct murky violet since this game has no tooltips), potions in
  SPECIAL_MAX_STACK (stack 1), and `consumableValue(name)`: food OR a
  potion presented as an always-drinkable zero-hunger consumable carrying
  `container: 'glass_bottle'` and its `potion` entry — the single lookup
  player/interaction.js now uses for the hold-to-eat/drink flow
  (`foodValue` stays exported unchanged).
- `src/player/stats.js` Phase 18 — potion effects: fire_resistance and
  strength countdown timers ticked in update, healing instant on drink;
  `eat(food)` applies `food.potion`; fire resistance suppresses BOTH lava
  contact damage and burn ticks for its duration (the flames still show —
  swimming the lava sea on one potion is the point); `igniteFire(seconds)`
  is the external-burn entry (blaze fireballs); `effects`/`strengthBonus`
  getters for the HUD and combat; death/respawn clears the effects.
- `src/systems/combat.js` Phase 18 — strength adds to the weapon base
  before the charge curve (the vanilla attribute shape); sfx grew the
  enderman `warp` vwoop and the eye `shatter` crack; the fireball system
  receives `ignitePlayer` so a blaze fireball's brief burn lands on a
  DIRECT player hit only.
- `src/systems/fireballs.js` Phase 18 — `spawn` takes `fireSeconds`; the
  player-hit branch ignites the burn alongside the centre-burst explosion.
- `src/entities/blaze.js` + config `MOBS.BLAZE` Phase 18 — the real
  Minecraft pacing (the "blazes kill almost instantly" report): fireball
  damage 6 -> 5 plus `FIRE_SECONDS` 4 of burn on a direct hit, volley of 3
  at 0.3s spacing, `COOLDOWN_SECONDS` 3 -> 5 between volleys,
  `CHARGE_SECONDS` 0.7 -> 1.2 — and the wind-up is now clearly visible:
  the rod rings spin up (as before) AND the body pulses toward hot orange
  (`CHARGE_FLASH_HZ`, the tint chain in mobs.js between the hurt flash
  and the fire flicker). Browser-measured cadence: shots at 0/0.3/0.6,
  next volley 6.3s later; a dead player stops the barrage.
- `src/dimensions/fortress.js` + config `NETHER.FORTRESS` Phase 18 — the
  fortress overhaul (the "too small" report), a full rework: one fortress
  per 24x24-chunk (384-block) region, `MAX_PIECES` 34 -> 110,
  `MAX_RADIUS_CELLS` 5 -> 18 (spans measured up to 296 blocks). Pieces
  carry their own deck height; two pieces link only where their meeting
  edges agree on it (`pieceEdgeY` — bridges/corridors along their axis,
  rooms/crossings all sides, stairs yIn on the entry face / yOut on the
  exit face). New piece kinds: STAIRCASE galleries (1-block steps between
  two landings, walled, stepped roof, climbing `LEVEL_STEP` 6 within
  deckY ± `LEVEL_RANGE` 12 — inserted before a junction with
  `STAIR_CHANCE`, so whole arms shift level; both directions measured
  across regions) and keep HALLS: the heart sits in an enclosed
  `(2*KEEP_RADIUS_CELLS+1)²` = 3x3 block of interconnected roofed rooms
  (glowstone ceiling lamps, doorways between every adjacent pair — the
  enclosed interior section). Bridge runs are genuinely long
  (`BRIDGE_MIN/MAX_CELLS` 4-14 = up to 112 blocks straight); corridors
  stay short. Blaze towers are tall now (`TOWER_WALL_HEIGHT` 10, open-top
  merlons). A run arriving at a foreign-height piece caps itself with a
  room instead of merging (no stubs); the dead-end-crossing cleanup is
  height-aware. All the Phase 17 guarantees re-proven at the new scale
  (30-region suite: full connectivity through height-matched links,
  containment, determinism, >= 1 wart + blaze; emission suite: 2.6-5k
  walkable cells per fortress, BFS from the heart reaches spawners and
  wart ON FOOT ACROSS DECK LEVELS via the stairs).
- config `NETHER_SKY` Phase 18 — the "Nether too dark" report:
  `AMBIENT_LIGHT` 6 -> 9 (the uMinSkyLevel floor — dimly lit but clearly
  visible), `FOG_COLOR` 0x330808 -> 0x4a1006 and `FOG_FAR` 60 -> 72 with
  a warmer `SKY_TINT` — the red-orange cast. Lava already emitted 15 into
  the flood fill; with the raised floor the oceans now read as glowing
  shores against visible (not black) netherrack.
- `src/entities/models.js` Phase 18 — `ENDERMAN_MODEL`: the vanilla
  64x32-sheet model converted with the established rules — 8px head at
  37..45px, the JAW as a separate deflated box on the same pivot (the
  vanilla "hat" layer holding the open-mouth art; the head's bottom face
  is transparent in the sheet so the jaw shows through), 8x12x4 body,
  2x30x2 arms and legs (legs pivoted at 30 so the feet land exactly on
  the ground plane). Unwrap regions verified against the decoded 2-bit
  sheet (the overlay layers are legitimately sparse — that IS the
  open-mouth reveal).
- `src/entities/enderman.js` — NEW (the injection pattern): enderman
  behaviour. Passive amble (leg/pause wander) until the STARE — the exact
  camera-forward vector (controller yaw/pitch, the same YXZ euler the
  camera uses) dotted against the eye-to-head direction beats the vanilla
  `1 - 0.025/dist` threshold with line of sight — then angry: fast chase
  (steerToward + tryMelee, 7 through the armour pipeline), the creepy
  pose (head eases up off the jaw; the jaw follows the head-track
  rotation so it never reads detached). Teleports: a random blink to dry
  standable ground (16 seeded attempts, clearance 3, never into water,
  loaded chunks only, A* path cleared, distance-faded warp sfx) — fired
  on any hit (the vanilla dodge), on each water-damage tick (SPEC:
  damaged by water — 1/s), and toward a >14-block target every ~4s while
  angry. Forgets beyond 48 blocks or when the player dies.
- `src/entities/registry.js` Phase 18 — the enderman entry (SPEC 40hp,
  7dmg, ender_pearl 0-1; 0.6x2.9 vanilla hitbox, pathfinding clearance 3,
  spawnWeight 20 beside the 100-weight regulars — a rare-but-findable
  overworld night spawn; the End lists it next phase) and the blaze's
  occasional magma_cream drop (25% — the fire resistance ingredient;
  its vanilla sources are out of scope, documented deviation).
- `src/entities/mobs.js` Phase 18 — enderman dispatch (AI + the
  `anim: 'enderman'` layer: biped walk + animateCreepy), the new mob
  record fields (angry/creepy/creepyBlend/lastHealth/waterTimer/
  chaseTimer/headBaseY), and the blaze charge flare in the tint chain.
- `src/player/controller.js` Phase 18 — `yaw`/`pitch` getters (the
  enderman stare check derives the exact camera-forward vector).
- `src/dimensions/stronghold.js` — the stronghold's deterministic
  LOCATION (`strongholdCenter(seed)`: seeded angle + distance
  1000-2000 from spawn, the SPEC band — measured 1404 for seed 1337).
  Thrown eyes fly toward it; next phase's generation must anchor the
  portal room to exactly this point.
- `src/entities/ender_eye.js` — NEW: thrown eyes of ender. throwEye()
  launches from the player's eye toward the stronghold: an eased glide
  to a signal point `TRAVEL_BLOCKS` (16) out and `RISE_BLOCKS` (9) up
  over 2.2s, a bobbing 1.1s hover, then the SPEC resolution — drops back
  as an ender_eye item, or shatters (20%) with a flash shell and a glassy
  crack. No world reads (it clears terrain by rising, vanilla-style), so
  no unloaded-chunk hazard; swapDimensionState like every entity manager.
- `src/player/interaction.js` Phase 18 — three right-click chain
  additions: glass bottle FILLS at the first water source on the
  crosshair ray (the bucket-scoop pattern and priority — a nearer pool
  wins over a usable block behind it; the source is NOT consumed,
  vanilla; a single bottle swaps in place, a stack consumes one and the
  water bottle joins the inventory or drops at the feet), a held
  ender_eye THROWS via `onThrowEye` (consuming one), and the eating hold
  runs on `consumableValue` so potions DRINK (always allowed, no hunger
  gate) leaving their glass bottle through the stew-bowl container path.
  The hand sources grew a `stack` getter.
- `src/ui/containers.js` — NEW (the mandated screens split): the
  chest/furnace/brewing screen SECTIONS, their CSS, and the indicator
  pixel art (flame, progress arrow, the new downward brew arrow + powder
  bar) moved out of screens.js (chest/furnace verbatim in behaviour —
  regression-proven through the real DOM); the factory binds sections to
  whichever container is open at event time.
- `src/ui/screens.js` Phase 18 — down to ~670 (was ~810 over the cap):
  keeps the panel/cursor/slot machinery, craft grids, equip row and
  open/close flow; new 'brewing' mode (`openBrewing`, the
  brewing-uninterested shift fallback via `routableInBrewing`, the
  activeBlockPos guard kind).
- `src/entities/items.js` Phase 18 — potion visuals: `getPotionCanvas`
  builds each potion's 16x16 canvas by scanline-filling the shipped
  bottle art's interior with the tinted liquid (slight depth shading;
  the glass shine stays on top), cached per potion off one shared
  bottle-art load; `itemVisualInfo` routes potions, and
  `createExtrudedItemMesh` builds their dropped/held slabs from the
  canvas (the atlas-sprite pattern, async).
- `src/ui/icons.js` Phase 18 — potion icons from the same canvases as
  data URLs (the chest-icon async pattern) — hotbar, screens and the HUD
  indicator all show the tinted bottle.
- `src/ui/hud.js` Phase 18 — the potion-effect indicator: top-right chips
  (tinted bottle icon + m:ss countdown) rebuilt only when the
  whole-second countdowns change.
- `src/main.js` Phase 18 — brewing + ender-eye systems wired: block
  listener, managers list, pause-gated ticks, `onUseBlock` routes the
  brewing stand, `onThrowEye`, the container close-guard 'brewing' kind,
  `__brewing`/`__enderEyes` dev handles.
- `docs/SPEC.md` Phase 18 — the blaze mob-table row updated to the
  rebalanced real values (5 fireball damage + brief fire, volley of 3
  then ~5s cooldown, visible wind-up) per the session's bug report.
- `src/dimensions/stronghold.js` — Phase 19: real stronghold generation
  around the Phase 18 `strongholdCenter` anchor. `StrongholdGenerator`:
  the cached seeded blueprint (11-block cells grown by the fortress.js
  FIFO walk — corridors, stairs shifting decks ±LEVEL_STEP within
  BASE_Y±LEVEL_RANGE, junction rooms, terminals alternating library/
  storage; dead-end junctions capped as rooms; every merge flush-height
  only, perpendicular same-height merges upgrading corridors to
  junctions), per-chunk emission behind a bounding-box early-out
  (order-independent — every intersecting chunk re-derives the same
  blueprint and writes only its own columns), per-block mossy/cracked
  weathering rolls, support piers under rooms/runs where caves cross,
  and the portal room: the 12-frame ring (5x5 minus corners) at deck+1
  around the sunken 3x3 lava pool, per-frame 10% pre-fill hashes,
  iron-bar wall niches, walkway torches — with `strongholdCenter`
  anchored to a WALKWAY offset (config ANCHOR) so the dig-straight-down
  arrival is safe. `blueprint()` exposes frames/portalCells/chests/
  bounds; `entryPoint()` for tooling; `lootFor(x,y,z)` deterministic
  chest loot. `createEndPortal` (same file): `fillFrame` flips
  FRAME→FRAME_EYE through the real right-click chain and, on the 12th
  eye, writes the 3x3 END_PORTAL interior; `update` reads the player's
  feet/midriff cells and travels on contact — dimension switch to 'end',
  arrival on the obsidian platform, prebuild before the next frame (the
  portals.js travel shape).
- `src/dimensions/end.js` — Phase 20 (rebuilt whole per the session
  brief; the Phase 19 island was reported far too small): `EndGenerator`
  (the nether.js interface): the ~110-block end-stone island — radial
  thickness taper, simplex-wobbled ragged coastline, gentle surface
  undulation that fades to a DEAD-FLAT plateau inside END.FLAT_RADIUS so
  the exit portal sits flush — floating over void (node census: 110x107
  blocks of surface, underside tapering from y~22); TEN obsidian pillars
  (`pillars()` — the deterministic layout shared with the dragon fight):
  ring radius ~33 with seeded angle jitter, radii 2-3, heights climbing
  END.PILLAR_MIN→MAX (40→70) around the ring from a seeded start, each
  rooted ROOT_DEPTH below the surface and capped with a BEDROCK crystal
  seat; the EXIT PORTAL fountain at the centre (`exitPortalCells()` /
  `fountainTop()`): bedrock base disc (d² ≤ 13), raised rim, the 20-cell
  portal well that stays AIR until the dragon dies, a 3-high central
  bedrock column with four wall torches; the 5x5 obsidian arrival
  platform with cleared headroom ON the island margin (config
  END.PLATFORM) so stepping off can never soft-lock over void. Still a
  pure function of (seed, x, z) — chunk order can never change the End;
  a second generator instance agrees exactly (node-verified).
- `src/entities/crystals.js` — NEW (Phase 20): the end crystals. One per
  pillar seat, built from END_CRYSTAL_MODEL on the real
  end_crystal_end_crystal.png (classic 64x32 unwrap shipped at 2x —
  layout verified against the sheet's alpha: glass regions ~34% opaque,
  core/base solid): the tilted glass cage spins about the vertical (YXZ
  pivot order), the core counter-spins at 0.55 scale, both bob over the
  bedrock seat. Each crystal carries a mob-shaped combat FACADE
  (entity.aabb/position/def/dead/removed/damage) so melee swings, arrows
  and explosion sweeps all reach it through combat's normal paths — ANY
  hit pops it: a real combat.explode blast (12 damage, radius 2 —
  obsidian and bedrock survive), the group hidden, dead thereafter.
  `nearestLiving` feeds the dragon's healing link; `raycast` and
  `blastTargets` merge into the main.js combat facade. Crystals are
  fight furniture, not Entities — no physics, no despawn, frozen with
  the fight outside the End.
- `src/entities/dragon.js` — Phase 20 (was the last stub): the Ender
  Dragon fight manager, `createDragonFight`. Everything lives under ONE
  fightRoot scene group whose visibility follows
  `dimensions.activeKey === 'end'` (synced first thing every update, so
  dimension switches never render the fight in the wrong world); update
  gates on the same key, so the whole fight — dragon position, crystal
  states, the open portal — freezes while the player is elsewhere and
  survives round trips. First End arrival initialises: crystals on the
  pillar seats + the dragon spawned circling (an arrival roar). The
  dragon is a KINEMATIC flyer (no voxel collision, vanilla): heading
  turns at DRAGON.TURN_RATE toward per-phase targets, banks into turns,
  pitches with climb; phases roll at the end of each circling leg —
  45% a STRAFING run (swoop at a point OVERSHOOT past the player at
  PASS_HEIGHT, wing-knockback pass: within WING.RANGE at speed,
  damagePlayer 5 with the standard shove, 1.2s cooldown), 25% a PERCH
  (swing wide, descend onto the fountain seat, face the player, the
  BREATH attack: 3s purple particle-cone bursts from the mouth with
  3-damage ticks gated by range/cone/line-of-sight, 4s cooldowns; leaves
  after 8-16s or 24 accumulated damage), else a fresh circling leg
  (random direction/height/duration). Damage: raycast returns per-part
  boxes — the head at FULL damage, three spine cubes + two tail cubes at
  BODY_DAMAGE_MULTIPLIER 0.25 (SPEC); while perched, hits from beyond
  PERCH.ARROW_RANGE (4.5) are PROJECTILES and deflect harmlessly
  (vanilla's perch arrow-immunity — melee can only land within reach,
  so the distance heuristic is exact in practice). Healing: the nearest
  living crystal within HEAL.RANGE feeds 3 health/s over a visible
  additive beam (one shared cylinder, crystal top → body centre);
  popping the feeder mid-drink stings the dragon 10. Death at 0 health:
  a 5.5s sequence — glide to a hover above the fountain, nose lifting,
  slow spin, NINE radiating light beams growing and wheeling, the body
  brightening white-hot, a terminal expanding flash — then the rig is
  removed and disposed, the exit-portal well fills with END_PORTAL
  blocks (writes happen in the End by construction — the fight only
  ticks there), and the dragon EGG spawns on the fountain column (a
  layered-box trophy, 10 stacked boxes in the vanilla silhouette, with
  a generated 16x16 speckled shell CanvasTexture in sRGB). Victory:
  standing in an active portal cell fires the injected onVictory
  edge-triggered (re-entry fires again; death-gated). Debug handles:
  `__dragonFight.state/health/damageDragon/crystals/dragon`.
- `src/entities/dragon_fx.js` — NEW (Phase 20, split out of dragon.js
  per the size cap at birth — dragon.js is ~780 with it): the fight's
  behaviour-free visual effects, all under the fight's scene group —
  the shared healing-beam cylinder (`updateHealBeam(from|null, to)`),
  the pooled additive breath particle cloud (`emitBreath`/`updateBreath`
  /`hideBreath`), the death light show (`startDeathShow` /
  `updateDeathShow(pos, t, dt)` — nine wheeling beams + the terminal
  flash — / `endDeathShow` disposing everything), and `spawnEgg(pos)`
  (the layered-box trophy with generated sRGB speckle art).
- `src/entities/models.js` Phase 20 — `DRAGON_MODEL`: the vanilla
  ModelDragon converted to this file's format (body 24x24x64 with three
  spine scales, 10x10x10 neck/tail segments with spikes, the 16px head
  with upper lip/nostrils/ears + separate hinged jaw, wing bone+membrane
  and wingtip per side, two-part legs front and rear) — with the group
  origin at the BODY CENTRE (it flies; dragon.js drives the skeleton),
  and the vanilla negative-texOffs trick for the zero-height wing
  membranes (top region lands at u=0: the membrane art with its ragged
  transparent edge — coverage-verified against the shipped sheet).
  `END_CRYSTAL_MODEL`: glass cage / core / base on the crystal sheet.
  Mirrored left-side parts flip U per the existing `mirror` flag.
- `src/ui/screens.js` Phase 20 — the VICTORY screen (the death screen's
  shape): a purple-tinted overlay, "Victory!" + completion text, a
  Return Home button firing the injected onVictoryReturn (main.js:
  switchTo('overworld') + stats.respawn(), inventory intact) and
  re-locking the pointer; `showVictory` (no-op while the death screen
  is up) + `isVictoryShown` (main.js isPaused reads it, so the world
  keeps running behind the overlay exactly like the death screen).
- `src/main.js` Phase 20 — the combat-target FACADE: `combatTargets`
  wraps the mob manager for createCombat's getMobs — `raycast` returns
  the nearest of a mob / a dragon part / a crystal (distance-compared
  via the exported rayAABB), `mobs` concatenates living-crystal facades
  onto the mob list for explosion sweeps; combat.js and fireballs.js are
  UNTOUCHED — melee, arrows, blasts and deflection all reach the fight
  through the paths that hit mobs, and the fight's raycast/blastTargets
  gate themselves to the End so nothing is hittable across dimensions.
  `createDragonFight` wired after the dimension system with the SHARED
  EndGenerator instance (the end def's makeGenerator returns the same
  one — the stronghold-blueprint pattern); `dragonFight.update` runs in
  the paused-gated block right after endPortal.update so arrival spawns
  the fight the same frame; `__dragonFight` dev handle; the TEST_CHEST
  block deleted (mandated), then restored by request in the follow-up
  with the End-fight kit (3 bows, 128 arrows, 5 golden apples added —
  see TEMPORARY).
- `src/world/terrain.js` Phase 19 — the stronghold pass runs LAST in
  `generateChunk` (structure writes win), exactly like the Nether's
  fortress pass; `world.generator.stronghold` is the shared instance
  (main.js reuses it for the end-portal runtime and chest loot).
- `src/world/emitters.js` Phase 19 — four new special emitters (and the
  shared `pushBox`/`pushLitQuad` small-box helpers, all lit flat by the
  block's own cell like the torch): the BREWING STAND's real model
  (stone base plate, 2px rod sampling the tile's rod column, three
  radiating DoubleSide arm panes carrying the tile's hanging-bottle art
  — replaces the garbled full-cube of the flat tile), IRON BARS as thin
  panes connecting toward solid/bars neighbours (half-panes join
  seamlessly across cells; a lone block renders a free-standing cross),
  the END PORTAL FRAME as the vanilla 13/16 box (side art's own 13px
  band, frame-top tile, END-stone-based; the EYE variant adds the raised
  4px eye box sampling the new tile 58 and emits light 3), and the END
  PORTAL interior as a fullbright animated sheet at 12/16 in the shared
  portal-swirl pass with world-continuous UVs. Dispatches in
  world/chunks.js; the four blocks went `faces: null` in the registry.
- `assets/block_atlas.png` — tile 58 `end_portal_frame_eye` generated in
  place (frame-top art + the ender-eye item art centred; all existing
  tiles verified byte-identical) — docs/ATLAS_MAP.md and render/atlas.js
  updated. iron_bars joined ATLAS_SPRITE_ITEMS (its item art is the
  tile; there is no assets/items sprite for it).
- `src/world/chests.js` Phase 19 — generated-chest discovery: the
  spawners.js chunk-scan pattern (`_chestScanned` flag, budgeted per
  frame via config CHESTS.SCAN_CHUNKS_PER_FRAME, cleared on the world.js
  unload paths) finds chests structures wrote into chunk data, creates
  their states and stocks them ONCE from the injected `lootFor(x,y,z)`
  (main.js wires the stronghold's). The lazy `chestAt` path routes
  through the same discovery, so opening an unscanned generated chest
  still loots correctly.
- `src/systems/brewing.js` Phase 19 — fuel loads EAGERLY: a blaze powder
  is consumed the moment the fuel slot holds one while the charge is
  empty (vanilla), so the powder bar fills immediately — visible
  feedback that the stand is live (it previously waited for a brewable
  batch, which read as dead in the session's bug report; the report's
  wart+bottles+powder case itself could NOT be reproduced — the machine,
  tick wiring, screen click path, drag path and shift-routing all brewed
  correctly in the live build under test).
- `src/player/fluid_actions.js` — NEW (the mandated interaction.js
  split): the bucket scoop/place + glass-bottle fill actions, moved
  verbatim; they share the interaction's live ray state through the
  factory (interaction.js is 765 lines now, back under the cap).
- `src/player/interaction.js` Phase 19 — the `onFillFrame` branch in the
  right-click chain (before the throw): an eye of ender used ON an empty
  frame fills it and consumes one; filled/absent frames fall through to
  the normal throw.
- `src/entities/spawning.js` Phase 19 — owns the spawn-profile machinery
  (moved from mobs.js, its natural home; mobs.js is 758 lines, under the
  cap): the overworld default pools, `setSpawnProfile`, and per-profile
  pool entries as names OR `{ name, weight }` — a dimension can override
  a type's spawnWeight without touching its overworld rarity (the
  Nether lists endermen at 200 vs the ghast's 100).
- `src/entities/registry.js` Phase 19 — enderman spawnWeight 20 → 60
  (the "could not find a single one" report: at 20 the hostile cap
  filled with cave regulars before an enderman ever rolled).
- `src/main.js` Phase 19 — the 'end' dimension def (END_SKY, enderman
  spawn table cap END.HOSTILE_CAP, EndGenerator), the Nether def's
  enderman entry (weight override, cap MOBS.NETHER_HOSTILE_CAP),
  `createEndPortal` wiring (+ its per-frame update), chest lootFor,
  `__stronghold`/`__endPortal` dev handles.
- `src/dimensions/portals.js` Phase 19 — the registry carries an 'end'
  list so every per-frame walk over the active dimension's portals is
  safe there (the End-travel crash the browser suite caught:
  registry['end'] was undefined and the game loop died on arrival), and
  `tryIgnite` refuses to light nether portals in the End (vanilla).
- `src/player/stats.js` Phase 19 — void damage: below STATS.VOID_DAMAGE_Y
  (-80) the player takes VOID_DAMAGE per tick until death (SPEC "falling
  into void kills"); unreachable outside the End (bedrock floors).
- `src/render/lighting.js` — unchanged; END_SKY simply carries the same
  fixed-sky fields NETHER_SKY does (SKY_DARKEN/SKY_TINT/AMBIENT_LIGHT).

Phase 19 verification: 83 node checks green against the real modules —
the stronghold suite (73: across 5 seeds the blueprint's SPEC distance
band, determinism, radius containment, exactly one portal room / 12
frames / 9 portal cells, at least one library and one storage room, the
piece budget and deck band, and cell-graph connectivity reaching every
piece; then over the real emitter on a mock chunk grid: byte-identical
emission under a reversed chunk order, all 12 frames with the pre-fill
hashes matching the blueprint, the 3x3 sealed lava pool, mossy/cracked/
plain brick censuses, bars/bookshelves/chests/torches present, full
BLOCK-LEVEL walkability — a step/jump BFS from the dig-down entry column
reaches every room interior, all 12 frames and every chest — the
structure top 24+ blocks under the lowest surface across the bounds, and
the REAL TerrainGenerator emitting the stronghold in its heart chunk),
plus brewing eager-fuel and End-island checks (10: powder charges the
stand immediately with no bottles and still brews/debits correctly;
island stone at the centre, void beyond the coast, the obsidian platform
with cleared headroom, deterministic chunks, the coast inside its band).
In headless Chromium (the local-three harness), 20 checks across two
suites, zero console errors throughout: the full loop end to end —
boot, the brewing stand rendering as its real model, teleport to the
stronghold entry (standing on real stone-brick floor), 12 frames + the
lava pool present in the live world, loot chests discovered by the scan
and holding items, the remaining 11 frames filled through the real
fillFrame path (the 12th was seed-pre-filled), the portal ACTIVE with
all 9 END_PORTAL cells placed, a second eye on a filled frame refused,
stepping into the portal travelling to the End and landing on the
obsidian platform, the island generated around it, the void killing the
player and respawn returning to the overworld, and the widened Nether
fog values live; and the spawn suite — the real spawn cycle at midnight
rolled 108 overworld hostiles including 15 endermen (~14%), and the
Nether profile produced endermen dominating ghasts 289:16 (the 1-block
enderman body fits where the ghast's 4-block box can't, on top of the
2:1 weights). Screenshots verify the look: the brewing stand's
rod/base/bottle-arm silhouette, the portal room's frame ring around the
glowing pool with a pre-filled eye, the ACTIVE purple portal sheet
inside the 12 eyes, the End island under the void sky from the obsidian
platform, and Nether terrain reading far into the red haze. The
End-travel crash the suite caught on its first run (the game loop dying
on arrival because portals.js iterated registry['end'] === undefined)
was fixed and re-verified — the whole suite re-ran green.

Phase 18 verification: 659 node checks green across four suites — the
fortress blueprint suite (561: 30 regions fully connected through
height-matched links, stairs in 29/30 with both directions represented,
containment, determinism, no dead-end crossings, no unassigned rooms,
spans to 296 blocks and straight bridges to 112), the fortress emission
suite (21: mock-world emission per chunk, walkability BFS from the heart
reaching spawners AND wart on foot across deck levels, censuses), the
Phase 18 core suite (63: the full potion/consumable registry, every SPEC
brew recipe, the BrewingStand machine — 20s operation timing at 60fps,
three-bottle batch, fuel loading rules, no-fuel/no-match/swap-restart
paths, gates and routing — stronghold determinism + the SPEC distance
band, enderman registry/model vs SPEC, blaze retune values, config
shape), and the effects suite (14: fire resistance blocking lava AND burn
ticks against a live synthetic world while the timers run down, strength
bonus, instant healing, igniteFire, water bottle inert, respawn clears).
The enderman unwrap regions were verified against the decoded 2-bit
sheet. In headless Chromium (the local-three harness), 75 checks across
six suites, zero console errors throughout: boot with all new systems
live; the brewing screen opened on a placed stand through onUseBlock
(title, sections, three bottle slots, powder bar, the downward arrow
filling), a real two-bottle awkward batch brewed by the ticking loop with
the screen closed, fire resistance brewed and then DRUNK through the real
held-button path (effect 180s, bottle returned, the HUD chip showing);
the REAL right-click chain under genuine pointer lock — a glass bottle
filling at a staged pool (source kept, one consumed from the stack) and
an eye of ender thrown (consumed, launched); the eye's signal point
matching the deterministic stronghold direction and every throw resolving
after fly+hover; the enderman staying passive under a 2.5s watch, aggroed
by an exact stare, closing in with the creepy head-lift measured on the
rig, blinking >4 blocks on a hit, hurt by water, and 24 kills paying
pearls inside the 0-1 band; the blaze volley cadence measured on GAME
time (3 shots 0.3s apart, 6.3s to the next volley, 5 damage +
fireSeconds 4 on every shot, disengaging when the player died); the
Nether ambient uniform at 9 and the region-(0,0) fortress found in the
REAL Nether (6 spawners, 60 grown wart — exactly the blueprint's census —
across a 300-block box); and the chest/furnace screens regression-proven
through the real DOM after the split (shift routing into input/fuel,
chest deposits, smelting with the screen closed). Screenshots verify the
look: the brewing screen mid-brew, the fire-resistance HUD chip, a
112-block bridge vanishing into the red fog, the keep interior, the
glowing lava sea against clearly visible netherrack, and the enderman's
tall silhouette against the dusk sky.

Phase 18's adversarial review (four independent lenses — fortress
generation, brewing/potions/screens, mobs/combat, and regressions +
session fidelity — each probing the real modules with its own node
repros over the full diff, every finding then handed to a dedicated
verifier told to REFUTE it) raised 8 findings, refuted 2 and confirmed 6
(two pairs were the same defect found independently by two lenses). The
three real defects were fixed and regression-tested:
- **Environmental damage aggroed the enderman at an innocent player and
  fired three teleports in one frame** (the one major finding, confirmed
  by two lenses with independent probes): the dodge-blink branch keyed
  off any health drop with no attribution, so the AI's OWN water-damage
  tick — applied earlier in the same call, before `lastHealth` was
  re-baselined — read as an attack: blink (water), blink again (dodge),
  `angry = true`, and with `chaseTimer` starting at 0 a third blink
  landing it 3-8 blocks from a bystander who had never looked at it,
  melee-ing for 7. Lava burn and suffocation (ticked in mobs.js AFTER
  the AI) did the same one frame later. SPEC is explicit — passive until
  looked at. The water branch now re-baselines `lastHealth` right after
  its own blink, the dodge branch no longer assigns blame (a player hit
  already sets `mob.provoked`, which is what anger reads), and anger
  resolves in ONE place that also charges `chaseTimer` so aggro reads as
  a stare-down rather than an instant materialisation. 17 node checks:
  one blink per water tick (was 3), passive through a 6s soak and through
  external lava/suffocation damage, still angered by a real hit and by
  the stare, never angered by 10s of being ignored.
- **The fortress crossing-upgrade path was unreachable dead code**: the
  new per-piece deck heights routed the merge check through
  `pieceEdgeY`, which returns null for a bridge/corridor's SIDE face —
  exactly the misaligned arrival the upgrade exists for — so the inner
  axis-mismatch test could never be true. Every perpendicular same-height
  arrival took the blocked path and capped a dead-end room against the
  bridge's flank instead of forming the T-junction Phase 17 built. The
  merge now compares a run's own deck height (faces still answer for
  rooms/crossings/stairs). A/B over 289 regions: flank-jammed dead-end
  rooms 42 -> 5 (the remainder is coincidental parallel-arm adjacency,
  no arrival event to upgrade), crossings 1463 -> 1499, connectivity and
  determinism unchanged.
- **A glass bottle with no water in reach shadowed the offhand**:
  `hasRightClickUse` returned true for it unconditionally, so a bottle in
  the main hand made right-click completely inert whenever no pool was on
  the crosshair — the offhand's food/bow never got the click. It now
  resolves the same water raycast the fill uses (the shears rule).
  Browser-verified: offhand bread eats through a held bottle with no
  water, and the bottle still wins the click once a pool is in reach.
Refuted: the creepy pose CAN clear on death (`e.dead` flips mid-AI when a
water tick kills), and the healing-potion gap is the documented
deliberate slice, not a defect. Accepted as documented rather than fixed:
glistering melon has no source (SPEC marks healing optional; the recipe
is registered and inert), and the two over-cap files carry mandated-split
notes. All suites re-run green after the fixes: 680 node checks (565
fortress + 21 emission + 63 core + 14 effects + 17 aggro) and 82 browser
checks, zero console errors.

Phase 17 (previous session) additions, one entry per file:
- `src/dimensions/fortress.js` — NEW: nether fortresses. One fortress per
  `NETHER.FORTRESS.REGION_CHUNKS`² (12² chunks = 192 blocks) region, always
  — the region-seeded BLUEPRINT (cached per region) grows from a central
  blaze-spawner room (the heart) by a bounded FIFO walk: straight
  bridge/corridor runs of 2-4 cells (CELL 8), crossings that branch,
  terminal rooms. Structural guarantees: every run ends in a room, merges
  into an existing piece (a misaligned merge upgrades that piece to a
  crossing so the junction genuinely joins), or branches at a crossing — no
  isolated fragments; rooms cut doorways toward every neighbour that
  connects back, so no sealed rooms; one deck height per fortress so decks
  meet flush; support piers (2x2 under every other run cell and every
  crossing, corners under rooms) descend through open air until ground, or
  three blocks into the lava sea. Terminals alternate wart room / blaze
  tower (heart guarantees >= 1 spawner; growth guarantees >= 1 terminal).
  Pieces: open bridges (6-wide deck, railings), corridors (walls with
  window slits every 3rd column, roofed), crossings (plus-shaped deck with
  railings ringing the unconnected sides), blaze towers (open-top, merlons,
  spawner on the floor centre), wart rooms (roofed, glowstone lamp in the
  ceiling centre, two 3x2 sunken soul-sand beds with grown wart).
  Everything derives from (seed, region) plus the owning chunk's own
  already-generated columns (piers), so generation order can never change
  the world; the fortress extent + origin jitter stays strictly inside its
  region, so a chunk consults exactly ONE region's blueprint. `heartOf(rx,
  rz)` is the tooling/test entry.
- `src/dimensions/nether.js` Phase 17 — the fortress pass runs LAST in
  generateChunk (structure writes win over soul sand/glowstone/quartz/leak
  decorations).
- `src/world/emitters.js` — NEW (the mandated chunks.js split, byte-
  identical A/B-verified over a synthetic world exercising every pass):
  the mesher's flattened per-block tables (IS_TRANSPARENT/OCCLUDES_AO/
  SELF_CULL/INSET/PASS/TILES, the lava family tables), the FACES geometry
  table with AO precomputation, the tileUV cache, and
  `createSpecialEmitters(ctx)` — the per-mesh torch/lava-flow/portal
  emitters moved verbatim, plus the NEW nether wart crop emitter: the
  vanilla crop model (four DoubleSide planes in a # arrangement at 4/16
  and 12/16) in the cutout pass, lit flat by the crop's own cell at full
  brightness; younger stages render shorter quads sampling the bottom band
  of the grown NETHER_WART_STAGE2 tile (only that stage's art ships).
- `src/world/chunks.js` Phase 17 — consumes the split (imports the tables,
  calls createSpecialEmitters per mesh, dispatches wart ids by
  WART_HEIGHT); down from exactly-at-cap ~800 to ~495. `Chunk` gains
  `_spawnerScanned` (the spawner discovery flag, cleared on the same
  world.js unload paths as `_fluidScanned`).
- `src/world/blocks.js` Phase 17 — NETHER_WART_0/1/2 (ids 65-67, appended):
  walk-through instant-break crops, `special: 'wart'`, stage 2 drops 2-4
  nether_wart, younger stages return the 1 planted; `WART_STAGE`/
  `WART_STAGE_BLOCKS`/`isWart` helpers and the `PLANTABLE` table
  (nether_wart -> stage-0 block on SOUL_SAND) the interaction placement
  path and active-hand gate consult.
- `src/world/spawners.js` — NEW: blaze spawner block entities (the chests.js
  state pattern). The SPAWNER block renders as the normal caged cutout cube
  (atlas tile 47); this system owns the spinning miniature blaze inside
  (createMobModel(blaze) scaled 0.4, spin easing between idle and active
  rates as the player comes and goes) and the spawning: with a player
  inside ACTIVATE_RANGE (16), every 8-20s roll it tries up to 8 cells
  within ±3.5 blocks (feet+head open, never in lava), spawning at most 2
  per cycle and none while 6 blazes already sit within 9 blocks. Fortress
  generation writes spawner blocks straight into chunk data (no block
  events), so spawners are DISCOVERED by scanning each newly meshed
  chunk's Uint8Array once (the fluids settle-scan pattern, budgeted 1
  chunk/frame; rescans after an unload find existing states by key).
  States follow their chunk's mesh visibility, freeze with unloaded
  chunks, swap per dimension, and tear down (no drops) when the block is
  broken.
- `src/world/wart.js` — NEW: the nether wart lifecycle. Planted stage-0/1
  warts register growth timers (WART.GROW_MIN/MAX 50-110s per stage, so
  ~2-4 minutes to full growth); expiry advances the stage through
  world.setBlock (remeshing + re-registration ride the normal listener
  chain); growth freezes in unloaded chunks (the universal rule); breaking
  the SOUL SAND under any wart pops the plant with its stage's registry
  drops (the torch support rule); dimension-swapped like every
  world-coordinate system.
- `src/entities/blaze.js` — NEW (the ghast.js injection pattern): blaze
  behaviour. Hovers on the flying entity model — floor probes hold it 1-3
  blocks up while idle on a slow drifting wander; a visible player inside
  ATTACK_RANGE (16) gets faced (yawTarget), the blaze climbs to float just
  above the player's eye line, holds its ring (drift in past 9, back off
  inside 4), and runs the SPEC firing cycle: 0.7s charge wind-up (the rod
  rings visibly spin 2.2x faster), a burst of THREE small fast fireballs
  0.3s apart (damage 6, size 0.4, speed 16, blockRadius 0 — no crater,
  damage radius 2), then a 3s cooldown. Line of sight gates STARTING a
  cycle (losing it lets the charge down), but a burst already begun always
  finishes — dodging behind cover eats the remaining fireballs on the wall
  (vanilla), and the cooldown charges at the end of every burst. The
  rod animation re-positions the twelve rods from BLAZE_RINGS (radii
  9/7/5px at 26/22/13px) each frame — three counter-rotating orbits with
  per-rod bobbing, spin phase accumulated in the AI so it freezes with
  unloaded chunks.
- `src/entities/skeleton.js` — NEW: skeletonAI + skeletonShoot moved
  VERBATIM out of mobs.js (the mandated split; the injection pattern —
  steerToward/playerTargetable/playerDistance injected). The draw/aim
  animation stays in mobs.js's biped animator, reading the same mob
  fields. Regression-tested: the 2s draw-and-release cadence measured
  unchanged.
- `src/entities/models.js` Phase 17 — `BLAZE_MODEL`/`BLAZE_RINGS`: the 8px
  head at pivot 24px (the vanilla rotation point) plus twelve 2x8x2 rods
  in three rings, rest positions derived from the ring parameters the
  animation also uses; every unwrap region verified inside blaze.png over
  >50% opaque art (the sheet is 4-bit palette — the test decoder grew
  PLTE/tRNS support).
- `src/entities/registry.js` Phase 17 — the blaze entry: SPEC stats (20hp,
  attackDamage = fireball 6, drops blaze_rod 0-1 — the vanilla roll; the
  spawner makes farming practical), `nether: true` AND spawnWeight 0 with
  no nether-def listing — blazes come ONLY from fortress spawner blocks,
  like vanilla; `flying`, 0.6x1.8 vanilla hitbox, minBrightness 0.9 (a
  creature of fire reads near-fullbright).
- `src/entities/mobs.js` Phase 17 — the skeleton AI dispatched into
  entities/skeleton.js and the blaze into entities/blaze.js; blaze state
  fields (blazeCharge/blazeBurst/blazeTimer/blazeSpin) on the mob record;
  the blaze animation dispatch. Down to ~760 (was ~840 over-cap).
- `src/systems/fireballs.js` Phase 17 — spawn() options for the blaze's
  small fireballs: `size` (render scale AND the deflection raycast hitbox
  — nearestOnRay is per-fireball now), `damageRadius`, `maxHardness`, all
  passed through to explode() on impact. Ghast fireballs unchanged by
  default.
- `src/systems/combat.js` Phase 17 — `explode` opts.maxHardness caps what a
  blast can break below the global MAX_BLAST_HARDNESS (ghast fireballs now
  pass 1.5: netherrack 0.4 breaks, nether brick 2.0 and cobble survive —
  the vanilla proportions, and fortresses survive a ghast siege);
  `sfx.flame` (the blaze's firing huff).
- `src/entities/ghast.js` Phase 17 — passes the new
  GHAST.FIREBALL.MAX_BLAST_HARDNESS through spawnFireball.
- `src/player/interaction.js` Phase 17 — the planting path in tryPlace: a
  held PLANTABLE item (nether wart) with no block id places its crop on
  the soil's TOP face only, into air only (never displacing a fluid, never
  sideways); `hasRightClickUse` counts plantables so the active-hand rule
  lets the main hand plant.
- `src/world/world.js` Phase 17 — both unload paths clear
  `_spawnerScanned` alongside `_fluidScanned`.
- `src/main.js` Phase 17 — spawners + wart systems wired: block listeners,
  the pause-gated update ticks, the dimension managers list, `__spawners`/
  `__wart` dev handles.
- config Phase 17 — `NETHER.FORTRESS` (region/cell/growth/geometry/pier
  tunables), `MOBS.BLAZE` (hover, ranges, the charge/burst/cooldown cycle,
  FIREBALL, rod-ring animation), `MOBS.GHAST.FIREBALL.MAX_BLAST_HARDNESS`,
  `SPAWNER` (activation, delays, attempts, caps, spin rates, scan pace),
  `WART` (growth roll), `SHAPES.WART` (crop plane inset, per-stage
  heights).

Phase 17 verification: 23 node checks against the real modules — 20
fortress regions all fully connected (BFS over mutually-connecting pieces)
with >= 1 blaze room and >= 1 wart room each, bounded to their regions;
blueprint + emission determinism across generator instances and reversed
chunk orders; every emitted spawner standing on brick with 2 air above and
every wart on soul sand (census: 4 spawners, 36 wart over one fortress); a
WALKABILITY BFS from the heart's floor reaching both a spawner and wart on
foot (1490 standable cells — doors and decks genuinely connect); the
emitter split proven byte-identical (old chunks.js from git HEAD vs new,
every attribute of every pass over a synthetic world with torches, flows,
a portal, water, leaves, cactus); the wart emitter's 4 crop quads at the
per-stage heights; every BLAZE_MODEL unwrap region inside the decoded
blaze.png over >50% opaque art; blaze registry vs SPEC; the mocked blaze
AI firing bursts of exactly 3 at the configured cadence with SPEC fireball
parameters, never STARTING a burst without line of sight (a begun burst
runs out through cover, then cools down), and hovering off floors;
the mocked skeleton cycle unchanged after the move; wart growth
0 -> 1 -> 2 on timers, frozen in unloaded chunks, soil-break pops with
stage drops; config shape. In headless Chromium, 17 checks, zero console
errors: boot; dimension switch + teleport to the region (0,0) fortress
heart; the fortress census live (3835 bricks, 4 spawners, 27 wart around
the heart); spawner states discovered by the chunk scan; the caged
miniature blaze spinning (rate ramped to 6 rad/s with the player near);
blazes spawning from the spawner (player nearby); an isolated blaze firing
bursts of exactly [3,3] through the real combat pipeline (damage 6, size
0.4) with the damage reaching the player; the heart room's brick intact
through the fireball fight (the maxHardness cap); 10 direct-spawned blazes
killed dropping 4 blaze rods as item entities; nether wart planted through
the REAL right-click path (aim at soul sand, held button, stack consumed)
and grown 0 -> 1 -> 2 by shortening the live timers; a generated wart room
found with grown wart; mining the soul sand popping the wart with a drop
through the listener chain; the overworld switch swapping out every
spawner/timer/blaze. Screenshots verify the look: the spawner cage with
the glowing mini blaze beside a live blaze (head + orbiting golden rod
rings against dark brick), a hovering blaze in a fortress gallery, the
wart-room beds glowing under the ceiling lamp, and the crenellated tower
silhouette in the red fog.

Phase 17's adversarial review (four independent lenses — fortress
generation, blaze combat + spawners, wart/planting/mesher split, and
regressions + session fidelity — each probing the real modules with its
own node repros over the full diff, findings verified before they
counted) confirmed and fixed five findings:
- **Planting at the world ceiling ate the item**: soul sand placeable at
  the top layer (y=319), the plant branch's air check passed on the
  out-of-range read and `setBlock` silently no-opped while `consume(1)`
  ran — the branch now carries the same vertical-range guard as regular
  placement.
- **A direct blaze fireball hit could never deal its SPEC 6** (typical
  3-5): the burst point was the player-AABB entry, and explode() measures
  falloff to MID-BODY — the surface-to-centre offset alone eats a sixth
  of the blaze's 2-block damage radius. Direct player hits now burst at
  the body centre, exactly the rule the mob-hit branch always used.
- **Direct-hit knockback then degenerated** (the blast centred ON the
  body has a zero radial direction, so square hits stopped shoving while
  near-misses still did): explode() takes an explicit knock direction
  now, and fireballs pass their flight line — shoved away from the
  shooter, as documented since Phase 13.
- **A burst abandoned on line-of-sight loss skipped its cooldown**, so a
  corner-peeking player faced a fresh burst per ~0.7s of exposure. The
  first fix (abort + charge the cooldown) then collapsed real fights to
  single-shot bursts under knockback LOS flicker — the shipped shape is
  the vanilla one: a begun burst always finishes (cover eats the
  remainder), the cooldown charges at every burst end, and only STARTING
  a cycle needs a clear shot.
- **~27% of crossings were dead-end balconies** (their queued
  continuations aborted on the piece budget or radius cap — a railed pad
  to nowhere, breaking the every-arm-ends-in-a-room guarantee): a
  deterministic post-growth pass caps every ≤1-link crossing as a
  terminal room. Census over 2,700 regions: zero dead ends, connectivity
  intact, and every fortress now carries >= 2 wart and >= 2 blaze rooms.
Everything else surveyed clean with probes: chunk-locality and blueprint
lifecycle (no post-emission mutation), 10,000-blueprint sealing/
connectivity sweeps, pier grounding and bedrock safety, region
containment (worst case 12 blocks inside the region border), the
skeleton move byte-fidelity, mobs.js declaration order, spawner index
maths/dimension swaps/leak paths/`_spawnerScanned` lifecycle, creeper
explosions untouched by the maxHardness plumbing, wart listener
reentrancy and both drop paths, the crop emitter's UV band maths and
culling interplay, config import safety, and the docs' line-count
claims. (Harness note: the burst-cadence browser check must group shots
by GAME time — wall-clock gaps stretch arbitrarily under SwiftShader,
the standing PROGRESS trap, and masqueraded as single-shot bursts twice
during the review.)

Phase 16 (previous session) additions, one entry per file:
- `src/dimensions/nether.js` — the REAL Nether generator, replacing the
  Phase 15 placeholder behind the same generateChunk/heightAt/biomeAt
  interface. One seeded 3D density field (world-aligned lattice every
  `NETHER.GEN.LATTICE_STEP` blocks, trilerped per cell — the caves.js
  discipline: the pure point query shares the lerp helpers and association
  order, so heightAt can never disagree with the fill) shaped by the
  `NETHER.GEN.SHAPE` [y, bias] profile: solid mass against the bedrock
  floor, an ocean-floor band, the huge open cavern band across the portal
  arrival heights (~75% open at y 56-90, cavern runs spanning whole
  regions), sealing again toward the ceiling. Where the field folds back
  positive inside the open band, netherrack masses hang in the air — the
  floating formations. Every open cell at/below `NETHER.LAVA_SEA_Y` (31)
  floods with lava (~23% of area at sea level — the oceans; shores animate
  via the normal fluids settle scan). On top: soul sand patches (2D mask
  regions; upward floor surfaces convert `DEPTH` layers — registry `slows`
  makes the crossing a slog), glowstone clusters (per-chunk PRNG; the
  anchor climbs its air pocket to the roof, then a downward-biased random
  walk grows a dangling blob, ~16 cells/chunk), nether quartz veins (the
  _placeVeins random-walk shape, netherrack only), and rare high wall
  leaks (a lava source with a drop below — pours on first sight). Bedrock:
  solid at y=0 AND y=128 with jagged hashed bands inside both. Generation
  ~1.5ms/chunk, byte-identical across generation orders (census-verified).
- `src/entities/ghast.js` — NEW (split per the ARCHITECTURE cap, the
  passive.js injection pattern): ghast behaviour. A gravity-free drifting
  wander (direction held 2.5-6s, re-rolled on expiry or wall hit; vertical
  probes push the drift up off floors/lava and down off ceilings), the
  fireball attack (a player visible within `GHAST.ATTACK_RANGE` gets faced
  — mob.yawTarget overrides the velocity-facing rule — and shot every 3s
  from the mouth, with the shriek), and the waving-tentacle animation.
- `src/systems/fireballs.js` — NEW (split per the ARCHITECTURE cap):
  ghast fireball projectiles. Straight-line flight (no gravity, vanilla),
  per-frame voxel raycast for blocks plus target test (ghast fireballs
  test the player; PLAYER-owned fireballs test mobs), exploding on the
  first hit with the fireball's own small blast radius; a mob hit blasts
  at the body centre so a deflected direct hit lands full damage on the
  ghast that fired it. Deflection (`deflect`): a melee swing reverses the
  ball along the player's look direction at `COMBAT.FIREBALL.
  DEFLECT_SPEED` and flips ownership. Rendered as three crossed quads
  sampling a generated fireball blotch (no fire_charge asset ships),
  fullbright. Frozen in unloaded chunks like every projectile; silent
  despawn after 20s of hitting nothing.
- `src/systems/combat.js` Phase 16 — `raycast` (the interaction bridge)
  now returns the nearer of the mob hit and a fireball in flight, the
  fireball wrapped `{ isFireball, fireball }`; `attack` on that wrapper
  deflects instead of damaging (the swing still resets the charge clock).
  `explode(centre, maxDamage, opts)` takes per-blast radii (ghast
  fireballs crater `blockRadius` 1.6 vs the creeper's 3; flash shell
  scales along). New sfx: the ghast shriek and the deflect thwack.
  `swapDimensionState` stores arrows AND fireballs per dimension (accepts
  the Phase 15 plain-array shape). The fireball machinery itself lives in
  systems/fireballs.js (deps injected — no import cycle).
- `src/entities/entity.js` Phase 16 — `def.flying` (the ghast): a living
  flyer approaches wish velocity on all three axes (`wishY` joins
  wishX/wishZ) and skips gravity entirely; fluids still register (a ghast
  dipping into lava burns) but don't change the control model; a DEAD
  flyer takes the normal gravity path, so corpses fall.
- `src/entities/registry.js` Phase 16 — the ghast entry: SPEC stats
  (10hp, gunpowder 0-2, damage = its explosion), `nether: true` (excluded
  from the overworld pools — spawns only where a dimension def lists it),
  `flying`, 4x4 box, `scale: 4` (model authored at 1 block like the
  vanilla renderer's 4.5x), `minBrightness` 0.35 so the pale bulk reads
  through the gloom.
- `src/entities/models.js` Phase 16 — `GHAST_MODEL`: the classic 64x32
  ghast unwrap (the shipped sheet is 2x resolution; UVs are normalised so
  texOffs stay in model pixels) — one 16³ body plus nine 2px tentacles in
  a 3x3 grid sharing the tentacle art at the sheet's top-left corner
  (exactly how the vanilla model overlays them), lengths from the vanilla
  8..14 range fixed per slot for determinism, hanging below the feet
  origin (visual only, like vanilla).
- `src/entities/mobs.js` Phase 16 — ghast state on the mob record
  (wanderTimer/wanderDir/yawTarget), the ghast AI + animation dispatched
  into entities/ghast.js, `yawTarget` override in the body-yaw ease,
  per-type model `scale` folded into the group scale (the creeper swell
  multiplies it), the dimension ambient floor + per-type `minBrightness`
  in the light tint, `useOnMob` guards fireball wrappers, and the spawn
  PROFILE plumbing: default pools exclude `nether: true` types;
  `setSpawnProfile({hostiles, passives, hostileCap, passiveCap,
  anyLight})` resolves a dimension def's table (dimensions.js applies it
  on every switch).
- `src/entities/spawning.js` Phase 16 — reads the profile via
  `getProfile()` (pools, caps, light rule): `anyLight` skips both light
  gates (the Nether spawns in any light — but never in unmeshed space),
  and wide types (the ghast's 4-block box) verify their whole spawn box
  is free of solids, chunk-loaded-gated so the check can never generate
  chunks synchronously.
- `src/render/lighting.js` Phase 16 — `uMinSkyLevel` joins
  CHUNK_LIGHT_UNIFORMS: a dimension-wide floor on the effective sky level
  applied in the fragment shader (`max(sky*15 - darken, uMinSkyLevel)`),
  written per frame — 0 on the normal cycle, `dimSky.AMBIENT_LIGHT` (6)
  under the Nether profile. `dayNight.ambientLight` getter exposes it for
  the mob tint. This is what makes the SPEC "constant dim red ambient"
  real under a bedrock ceiling where baked sky light is zero everywhere.
- `src/world/fluids.js` Phase 16 — `setTickSeconds(seconds|null)`: a
  per-dimension override of the lava spread tick;
  dimensions.js applies the def's `lavaTickSeconds` on every switch
  (Nether 0.75s — twice the overworld pace, vanilla).
- `src/dimensions/dimensions.js` Phase 16 — defs grew `spawn` (the
  dimension's spawn table -> mobs.setSpawnProfile) and `lavaTickSeconds`
  (-> fluids.setTickSeconds); createDimensions takes `fluids`.
- `src/dimensions/portals.js` Phase 16 — ceiling-aware linked-portal
  placement: in the Nether, `createLinkedPortal` spirals columns out from
  the scaled point (`PORTALS.NETHER_PLACE.SEARCH_RADIUS`) for the highest
  solid NON-LAVA floor with `CLEARANCE` air above it, strictly inside the
  bedrock shell — the old highest-solid-column rule would have built the
  return portal on TOP of the bedrock ceiling. If the whole area offers
  no ground (lava ocean, solid rock), a closed netherrack pocket is
  carved around the frame at the traveller's own height (clamped above
  the lava sea), floor flush with the bottom bar. travel() passes the
  departure y as the hint. The overworld path is unchanged.
- `src/world/chests.js` Phase 16 — THE CHEST LID FIX: the modern (1.15+)
  sheet stores the box unwrap's top/bottom slot pair SWAPPED relative to
  the classic layout (verified against the decoded pixels: the classic
  top slot at (u+d, v) holds the dark flat UNDERSIDE art, the classic
  bottom slot at (u+d+w, v) the wood-grain top art). The lid was
  rendering its dark underside on its top face — the session's bug
  report. appendBox now swaps the pair; the base top face gets the dark
  hollow interior (what an open chest reveals, vanilla) and the Phase 10
  bottom-face UV overwrite became obsolete and is gone.
- `src/ui/icons.js` Phase 16 — the chest icon's top face samples the
  wood-grain slot (28,0) to match.
- `src/main.js` Phase 16 — the nether def: real generator, spawning on
  with `spawn: { hostiles: ['ghast'], hostileCap: MOBS.GHAST.CAP,
  anyLight: true }`, `lavaTickSeconds`; fluids passed to dimensions.
- config Phase 16 — `NETHER` rebuilt: LAVA_SEA_Y, LAVA_TICK_SECONDS and
  the `GEN` block (lattice step, density scales/octaves, the SHAPE bias
  keyframes, bedrock jagged chances, SOUL_SAND / GLOWSTONE / QUARTZ /
  LAVA_LEAKS) replace PLACEHOLDER; `NETHER_SKY.AMBIENT_LIGHT`;
  `MOBS.GHAST` (cap, fly speeds, wander, probes, attack range, cooldown,
  FIREBALL speed/damage/radius); `COMBAT.FIREBALL` (size, deflect speed,
  despawn); `PORTALS.NETHER_PLACE`.

Phase 16 verification: 10 node checks against the real modules — ghast
registry vs SPEC, the overworld pools excluding it, every GHAST_MODEL
unwrap region inside the sheet and >50% opaque art (PNG-decoded), flying
entity holds altitude across 2s of steps / steers vertically / corpse
falls / zombies still fall, the spawner honouring a profile's pools+caps
(400 cycles: only ghasts, never past cap 2), soul sand measured at
WALK_SPEED x SLOW_BLOCK_FACTOR against a stone control, combat pure maths
regressions, config shape — plus the generator censuses over 144 chunks
(~1.5ms/chunk; 23% lava at sea level; y-band openness profile 0% at the
shells to ~80% mid-band; longest cavern runs spanning the whole region;
floating formations present on a 16-block sample grid; standable ground
in 68% of columns; glowstone ~16 cells/chunk; byte-identical regeneration
from a fresh generator; heightAt never disagreeing with chunk data at 200
random points). In headless Chromium, 23 checks, zero console errors:
boot; the chest-lid UVs sampling exactly the wood-grain slot in the live
geometry (plus a screenshot showing grain + rim from above); a portal
built, lit and travelled END TO END into the REAL Nether — arrival
standing on solid ground inside portal blocks at 5<y<122 (never the
ceiling top); uMinSkyLevel 6 and skyDarken 5 active; the arrival-area
census finding netherrack dominant plus lava ocean, soul sand, glowstone
and quartz, with bedrock at exactly y=0 and y=128; a direct-spawned ghast
drifting airborne and firing a real fireball (the player took damage
through the fight); the deflection path end to end (crosshair raycast
returns the wrapper, the swing flips ownership and reverses velocity); a
NATURAL ghast spawn inside the nether spawn table (and only ghasts ever
spawning there); the return trip through the arrival portal restoring the
overworld and clearing the ambient floor. Screenshots verify the look:
the corrected chest lid, the red-fogged netherrack caverns with glowstone
specks, the portal-side purple swirl with drifting particles.

Phase 15 (previous session) additions, one entry per file:
- `src/dimensions/portals.js` — the Nether portal, four parts:
  (1) **Pure frame detection** (node-tested): `detectFrame(getBlock, x, y,
  z)` from any candidate interior cell — falls to the bottom row, slides to
  the low end, walks the interior upward — accepting axis-aligned obsidian
  rectangles with full bottom/top bars and side columns, corners optional
  (excluded from validation entirely), interior from 2x3 (the SPEC 4x5
  outer minimum) up to `PORTALS.MAX_INTERIOR` 21, all-air inside.
  (2) **Lighting + break-down**: `tryIgnite(target)` lights the frame
  around the cell in front of the clicked face (interaction.js routes a
  flint-and-steel right click here; a successful light wears the tool 1);
  interiors fill with NETHER_PORTAL blocks and the portal registers in a
  per-dimension registry (kept HERE, not swapped — travel needs both sides
  at once; every portal in a run passes through lightFrame, so the registry
  is complete). Any frame or interior cell disturbed (mined obsidian,
  explosion, falling block) winks the whole portal out via the block
  listener; obsidian stays and can be re-lit.
  (3) **Travel**: standing in portal blocks (feet or eye cell) for
  `NETHER_STAND_SECONDS` 3 travels — coordinates divide by 8 entering the
  Nether and multiply by 8 leaving (SPEC); the destination reuses a
  registered portal within `LINK_SEARCH_RADIUS` 32 of the scaled point or
  builds a fresh minimum frame standing on local ground (the bottom bar
  replaces the surface row, so the player walks out flush) and lights it;
  arrival is inside the destination portal with an arrival hold (no
  re-trigger until the player steps out), velocity zeroed, fallDistance
  cleared, the CAMERA snapped to the arrival eye (the controller re-derives
  it next frame; without the snap, the rest of the travel frame streamed
  and rendered from the stale pre-travel position — for far-from-origin
  portals that unloaded the freshly prebuilt arrival meshes), and a
  synchronous `world.prebuild` so the player never lands in void.
  (4) **Particles + ambience**: a pooled THREE.Points cloud (additive
  purple sprites, per-particle drift/fade) respawning off active portal
  cells within range of the player, and the procedural WebAudio layer —
  proximity hum, ignition shimmer, travel whoosh (the combat synth
  pattern; no audio assets exist, every failure silent).
- `src/dimensions/dimensions.js` — NEW: the dimension system. ONE World
  instance (every system closed over it at boot); `switchTo(key)` swaps its
  backing store — chunk map, generator, scene group, streaming position
  (`world.swapState`) — and calls `swapDimensionState(stored)` on every
  entity manager (items, mobs, falling, combat arrows, fluids queue,
  furnace map, chest map). The swapped-out dimension keeps chunks, meshes
  (hidden scene group), entities and container state in memory, completely
  frozen, until it swaps back. Per-dimension defs carry the fixed-sky
  profile (nether: config NETHER_SKY via dayNight.setDimensionSky) and the
  natural-spawning flag (off in the placeholder Nether).
- `src/dimensions/nether.js` — the PLACEHOLDER Nether generator: flat
  netherrack (y 60..64) over bedrock (58..59), `biomeAt` 'nether', behind
  the same generateChunk/heightAt/biomeAt interface TerrainGenerator
  exposes. The real Nether replaces exactly this class next session.
- `src/world/world.js` Phase 15 — constructor takes an optional `generator`;
  `swapState(state)` exchanges chunks/generator/scene/streaming-position and
  returns the previous store (dimensions.js owns the stores).
- `src/world/fluids.js` Phase 15 — water meets lava (SPEC: obsidian on the
  portal critical path): `hardenOnWaterContact` — a lava cell with water
  above or beside becomes OBSIDIAN (source) or COBBLESTONE (flow/fall),
  immediately on any block change (placing a water bucket against lava
  hardens it the same frame — the setBlock listener chain lets the obsidian
  shell cascade along the whole contact face), first-thing in processCell,
  and via the settle scan for generated contacts (a waterfall pool reaching
  a lava leak). Water below lava does NOT harden it (vanilla). Conversions
  are real blocks (markModified true), unlike derived flow writes.
- `src/world/caves.js` Phase 15 — the mega-cavern pass, DISTINCT from the
  tunnel noise (the "caves are all narrow tunnels" report): a very-low-
  frequency 2D region mask (`CAVES.MEGA.REGION_*`) gates where they exist
  at all — ~9% of area, ~5 chambers per 1000x1000 blocks, uncommon but
  findable — and inside a region a low-frequency squashed 3D field carves
  where it exceeds a threshold that relaxes toward the region core and
  ramps unreachable at the band edges (y -52..26, always far below the
  surface; the ocean shield's colTop clamp already covers the band).
  Chambers measure 30-130 blocks across and up to 20+ tall (census:
  region max x-run 70, tallest interior column 22), stacked into multiple
  levels where the field folds; the existing lava rules flood their floors
  below y=10 (lakes below -54). Plus waterfall springs (`CAVES.WATERFALL`):
  rare water columns pouring from upper cavern walls into a small floor
  pool — water is still static, so the column IS the fall; per-chunk
  seeded PRNG (the roll drawn unconditionally so the stream stays aligned),
  in-chunk writes only, springs that never find a floor within MAX_FALL
  are skipped. Everything still a pure function of (seed, x, y, z) —
  re-verified byte-identical across generation orders.
- `src/world/noise.js` — NEW (split): the carver's seeded noise machinery
  (mulberry32, hashes, smoothstep/lerp/bilerp, 2D+3D simplex, fbm,
  Field3D) moved VERBATIM out of caves.js per the ARCHITECTURE cap — the
  mega pass would have pushed caves.js past it. A/B-verified zero output
  differences over 37k samples. terrain.js keeps its own 2D copy on
  purpose (independent testability, per its header).
- `src/world/chunks.js` Phase 15 — portal rendering: a PASS_PORTAL bucket
  whose material samples a GENERATED purple swirl canvas (no portal tile
  ships in the atlas; generated art is the established pattern), scrolled
  upward with a sideways wobble per un-paused frame
  (`chunkMaterials.scrollPortal`, config PORTALS.SWIRL). `emitPortal`
  renders each portal cell as the vanilla 4/16-thick slab — two DoubleSide
  quads at 6/16 and 10/16 across the thin axis, axis read from same-row
  portal neighbours (every interior cell has one; width >= 2), UVs in
  WORLD coordinates so one seamless swirl spans multi-cell and
  chunk-border portals. The material is deliberately unlit/un-patched —
  the portal is an emissive surface (registry light 11 lights its
  surroundings through the normal flood fill).
- `src/render/lighting.js` Phase 15 — `dayNight.setDimensionSky(profile)`:
  a fixed-sky override (config NETHER_SKY: fog colour/near/far, SKY_DARKEN
  5, red SKY_TINT) applied at the end of every update while set — the dome
  renders flat fog colour (exact horizon match, same no-tone-map reasoning
  as ever), sun/moon hide, baked skylight holds a constant dusk. The clock
  still advances underneath, so returning to the overworld lands at the
  right time of day; passing null restores the cycle and the SKY fog
  distances.
- `src/entities/registry.js` — NEW (split): the MOB_TYPES registry moved
  verbatim out of mobs.js — the mandated split the Phase 14 cap note
  required before mobs.js could grow again.
- `src/entities/mobs.js` Phase 15 — the skeleton shooting fix (the session
  report overriding Phase 14's "fixed" claim — the state machine WAS
  firing on a 2s cycle, but the aim pose held the arms permanently raised
  with a 7-degree wind-up nobody could see, and arrows spawned at the eye
  centre): the aim pose now follows the firing cycle — arms DOWN through
  the cooldown, raised and drawn over DRAW_SECONDS (string arm folding
  back 0.9 rad, bow arm lifting 0.25), released, lowered — and
  `skeletonShoot` fires from the BOW's world position (getWorldPosition
  refreshes ancestor matrices; eye fallback until the async mesh exists).
  Plus the dimension hooks: `swapDimensionState` (mobs stored hidden +
  frozen per dimension) and `setNaturalSpawning` (off in the placeholder
  Nether).
- `src/systems/combat.js` Phase 15 — arrow visibility (the "damage with no
  projectile" half of the report): `lightTintAt` floors at
  `COMBAT.ARROW.MIN_TINT` 0.45 — skeletons fire at night and underground,
  where the raw curve (falloff^11+ ≈ 0.09) rendered the arrow as an
  invisible black sliver on a black sky. Skeleton `ARROW_SPEED` eased 32
  -> 24 (config) so the shot reads as a projectile with a visible arc; the
  aim lead/lift maths compensate. `swapDimensionState` stores arrows per
  dimension and cancels any draw in progress.
- `src/player/interaction.js` Phase 15 — the right-click chain grows one
  link: mob use > bucket scoop > use block > **flint-and-steel ignite** >
  bucket place > armour equip. `onIgnite(target)` (main.js ->
  portals.tryIgnite) runs from either hand via the active-hand rule; only
  a successful ignition wears the tool (striking bare rock does nothing —
  there is still no free-standing fire block). Sneak+use still bypasses
  usable blocks first, so a frame built against a crafting table lights.
- `src/entities/items.js` / `src/entities/falling.js` /
  `src/systems/smelting.js` / `src/world/chests.js` Phase 15 — the
  `swapDimensionState` hooks: dropped items and mid-fall blocks swap their
  entity lists (meshes hidden, physics frozen); the furnace and chest maps
  swap entries in place (exported Map identity preserved) so a Nether
  furnace at (2, 65, 3) can never collide with an overworld one; stored
  furnaces freeze mid-burn and resume on return.
- `src/main.js` Phase 15 — per-dimension scene groups (a switch is one
  visibility flip), dimensions + portals wiring (portals.onBlockChanged on
  the listener list, onIgnite into interaction), death in the Nether
  respawns at the OVERWORLD spawn (switchTo before stats.respawn), the
  loop ticks portals.update and scrollPortal inside the pause gate, and
  the TEMPORARY test chest (see the heading above) placed after prebuild
  on a column whose surface is level with the player (leaves count as
  solid — a bare offset could sit it on a canopy).
- config Phase 15 — `PORTALS` grew MAX_INTERIOR / LINK_SEARCH_RADIUS /
  SWIRL / PARTICLES / AMBIENCE; `NETHER.PLACEHOLDER` (floor 64, bedrock
  58-59); `NETHER_SKY` grew SKY_DARKEN + SKY_TINT; `CAVES.MEGA` +
  `CAVES.WATERFALL`; `MOBS.SKELETON` ARROW_SPEED 24 and the readable
  DRAW_STRING_PULL 0.9 / DRAW_ARM_RAISE 0.25; `COMBAT.ARROW.MIN_TINT`;
  `TEST_CHEST` (temporary, above).

Phase 15 verification (zero console errors throughout): 26 node checks —
16 frame-detection (the SPEC 4x5 minimum found from every interior cell,
corners present and absent, z-axis frames, 1-wide/2-tall/oversized/broken
frames rejected, junk-inside rejected, open air terminates, cell counts)
and 10 obsidian (source -> obsidian beside and above water, flow ->
cobblestone, water below inert, the flow FRONT hardening as lava spreads
toward a pool with the source surviving, lava poured against water
hardening immediately, pools intact throughout) — plus the generation
censuses: mega-lattice sweep over 4096x4096 (9.2% gated area, ~5 chambers
per 1000x1000, top sizes 50-130 across / 20-52 tall), real-chunk census
(max x-run 70, tallest interior column 22, 1028 lava cells in the band,
waterfalls present, ~5.2ms/chunk generation, chunk-order byte-identical)
and the noise-split A/B (37k samples, zero differences). In headless
Chromium, 61 checks: boot (zero errors, overworld active, test chest
present with exactly the kit); the portal round trip END TO END (frame
built + lit via tryIgnite, portal blocks + registry, stand timer running
at 1.5s and travel at 3s, arrival INSIDE the linked portal on netherrack
with coordinates /8, arrival hold — 4 more seconds standing there does
NOT bounce back, step out + re-enter returns *8 to within 4 blocks of the
original portal which is REUSED not duplicated, breaking a frame block
clears the interior and deregisters); the far-from-origin trip (a portal
at x=800: camera snapped to the arrival eye, the arrival chunk meshed the
same frame — the stale-camera review finding); flint and steel through
the REAL input chain under real pointer lock (right press -> portal lit,
tool worn to 63); the skeleton cycle (4 raise-draw-release cycles in 9s,
drawTime ramping to 1.0, aimBlend oscillating 0 -> 1 -> 0 — arms
genuinely lower between shots, every arrow mesh visible with tint exactly
the 0.45 floor at midnight); the mega cavern entered in the live game (a
34-wide run with a 20-tall vault, 905 lava + 7 water cells in its region,
torch-lit screenshot); and dimension isolation (a dropped diamond, a cow
and a BURNING furnace stored away on switch — counts 0, models hidden,
furnace map empty; nether edits and drops invisible from the overworld
and vice versa; on return everything restored, the furnace having smelted
NOTHING while frozen and resuming on return). Screenshots verify the
look: the lit frame with the animated purple swirl and drifting particles
on open grass, the flat red-fog Nether with the linked portal standing on
netherrack, the skeleton mid-draw at night, the torch-lit cavern vault.

The Phase 15 review (a systematic pass over the full diff after the
feature suites were green) confirmed and fixed:
- **The travel frame streamed and rendered from the stale pre-travel
  camera** (the controller only re-derives the camera from the body on the
  next player.update, which runs BEFORE portals.update in the loop): for
  portals far from the origin, updateStreaming's unload pass disposed the
  freshly prebuilt arrival meshes and the frame rendered void. travel()
  now snaps the camera to the arrival eye before prebuilding; verified by
  the far-portal browser test above.
- **The test chest could sit on a tree canopy** (leaves are solid to
  getHighestSolidY): placement now searches nearby columns for a surface
  level with the player.
- **A portal spanning a chunk border seamed its swirl** (UVs were
  chunk-local): portal UVs are world-space now.
Everything else surveyed clean: the mesher's PASS_NONE culling rule
already handles portal neighbours (the Phase 10 fix), explosions already
spare portals (hardness null) and their frames (obsidian above the blast
cap), lava spread only fills air so it can never invade a portal, fluids
may not be placed into portal cells (not replaceable), the frame-fill
order can't self-destroy a lighting portal (registration follows the
fill), and the swap protocol preserves every exported collection's
identity.

Phase 14 verification (zero console errors throughout): 71 node checks —
15 core (the exact required food table incl. cooked-beats-raw and the
golden-apple/rotten-flesh flags; offhand swap/consume/replace/damage/
drainAll/equip/click semantics; EXHAUSTION_SCALE measured — 300 sprint
blocks leave hunger untouched, 600 drain it gently; poison accrues exactly
the vanilla 3.0 over 30s then expires, a control accrues none; the
keyframe table's exact phase seconds 600/90/420/90; registry stats/drops
vs SPEC incl. sheared-sheep dropsFor; the spawner's daylight-grass gate
proven on a synthetic world — grass+day spawns, night and stone never —
and far passives excluded from the cap) and 56 model checks (every box of
every passive model's six unwrap regions inside its sheet and overlapping
real opaque art via a PNG decoder — sparse vanilla art like chicken
stick-legs tolerated; model bounds vs the vanilla hitboxes; the baked
body roll; wool rig part-name parity). In headless Chromium: 26 passive
checks (spawn, overlay pivots, wander state machine entered by all four
with real movement, panic-flee at sprint speed after a hit, shear
once-only with 1-3 wool + hidden coat + inert on non-shears, sheared
kill = mutton no wool, cow kill = beef, egg laid, slow fall EXACTLY at
the 3 blocks/s cap, landed alive, far pig persists while a far zombie
despawns); 10 skeleton checks (bow group on the LEFT arm only, 7 arrows
in 14s with every gap 1.9-2.2s and a sampled ~1s wind-up before each,
60-kill drop census: 62 bone / 58 arrow / 6 empty — the empty rate is the
expected (1/3)^2 of the vanilla [0,2]x[0,2] table, confirming the
reported "no drops" was a legitimate roll); 14 offhand checks (swap, left
hand shows/hides the item, eat-from-offhand with a sword in main through
the real held-button path, main-hand use wins when it has one, offhand
placement with an empty main, offhand torch lights, screen slot +
preview canvas present); 10 armour checks (right-click + shift equip into
all four slots, the HUD bar, 3 -> exactly 1 through full iron on both
the API and a LIVE zombie bite, every piece wearing 1, the 28/60/80% set
values); the held-light probe (uniform 14 with a torch in either hand,
centre-screen ground 3.6x brighter at night) and the differential
no-remesh proof above; and the FULL EARLY GAME end to end through the
real interaction/crafting/smelting paths — punch a tree, planks/sticks/
table in the 2x2, place the table, wooden pickaxe + sword in the 3x3,
mine stone, stone pickaxe, find and mine iron ore (drop gated correctly
by tier), kill a cow with the sword and collect the beef, craft + place
the furnace, smelt the ingot, cook the beef, eat it (+8 hunger) via
hold-to-eat, and put down a night zombie — 22/22 checks. Screenshots
verify the look: the herd lined up (cow with nose/horns, woolly sheep +
bare sheared twin, pig with snout, chicken with wattle), the skeleton
mid-draw with the bow visible in its left hand, the held-torch light
pool at night vs the dark control, the inventory screen's preview
(neutral skin, armour ghosts, offhand slot) and the armoured/mouse-
follow variants.

Phase 14's adversarial review (five independent lenses — passives/spawning,
offhand/interaction/inventory, rendering/lighting, Phase 1-13 regressions,
session fidelity — each probing the real modules with its own node and
headless-Chromium repro scripts over the full diff; every finding
independently re-reproduced by a dedicated verifier before it counted)
raised 15 findings, refuted 4 and confirmed 11. All were fixed and
regression-checked (24 new browser checks in the fix suite):
- **Far passives regenerated their chunks every frame** (the one major
  finding): mobs.js's per-frame suffocation probe and the new wander probe
  call `world.getBlock` with no loaded-chunk guard. Before Phase 14 this
  was unreachable — every mob was hostile and despawned at 128 blocks,
  inside the 160-block data-keep radius — but never-despawning passives
  left behind by a travelling player sat in unloaded chunks, so each one
  synchronously regenerated its chunk (~6ms) on every frame after every
  streaming unload, forever. Mobs in unloaded chunks now freeze entirely
  (AI + fire + suffocation), exactly like dropped items and the physics
  step; verified: a cow 4000 blocks out keeps existing, builds no wander
  state, and its chunk stays unloaded.
- **Passives walked into surface lava**: the wander safety probe scanned
  the drop column from feet-1 downward, so a lava flow layered ON solid
  ground (a spill or spring — the shape fluids.js actually produces) read
  as safe floor. The probe now rejects lava at feet level first; verified
  against a staged flow with a clear-ground control.
- **A bow swapped away mid-draw still fired** (and skipped its durability):
  releaseDraw attributed wear by inspecting the CURRENT hand, so F-swapping
  (or switching slots) and releasing in the same frame fired an unworn
  shot — contradicting interaction.js's own "any break of the draw
  cancels" invariant, which only ran on frames where the button was held.
  The release now cancels unless the source hand still holds the bow.
- **Arrows in the offhand were invisible to the bow**: `hasArrowItem` and
  the consumption scanned only the main slot array, so the vanilla habit of
  keeping arrows in the offhand silently refused to draw. Both now see the
  offhand and consume from it FIRST (vanilla order).
- **The active-hand rule was static per item name**, so a main-hand item
  whose use *couldn't succeed* still blocked the offhand: food at full
  hunger, an arrowless bow, or shears with no sheep under the crosshair
  made right-click do nothing at all. `hasRightClickUse` is context-aware
  now (and resolves once per frame against that frame's mob raycast).
- **The skeleton's bow rendered fullbright**: it used the SHARED
  extruded-item material (the same instance as the player's held bow and
  every dropped bow) and was never registered for the per-mob tint — a
  glowing white bow on a near-invisible midnight skeleton. Each skeleton
  now clones the material (texture shared, colour owned); verified the bow
  tints to exactly the body's brightness while the player's own bow stays
  fullbright. The clone path also re-triggered the Phase 10 TDZ trap
  (`onReady` fires synchronously on a cache hit) — caught by the new
  regression test and fixed the way hand.js does it.
- Polish: the armour-plate CanvasTexture was missing `SRGBColorSpace`
  (washed-out plate shading against the sRGB-decoded skin beside it); the
  preview's mouse-follow sensitivity/clamp numbers moved into config
  (`UI.PLAYER_PREVIEW.MAX_TARGET_YAW/YAW_SENSITIVITY/PITCH_SENSITIVITY`)
  per the ARCHITECTURE constants rule; a stale `eating` doc comment.
- Two harness flakes the fidelity lens caught in the test suite itself
  (not the game): the sheep-removal check polled by TYPE NAME, so a
  naturally-spawned sheep at noon could keep it true forever (identity
  now), and the held-light remesh assertion compared absolute counts of
  ambient streaming noise (now a proportional bound against the
  empty-hand baseline — a per-step relight would multiply the count, not
  nudge it).
The four refuted claims: the preview's WebGL context is created lazily
enough to be harmless, `stats.canEat` is still consumed, the "Steve skin
if present" branch is correctly moot (no skin ships in assets), and the
mobs.js line count is a documented, deliberate deferral.

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

## Phase 21 deliberate slices

- Shaped blocks (stairs, slabs, fences, doors...) pass light freely
  (`opacity` 0, the transparent default). A slab roof does not darken the
  room under it and hostiles will not spawn there. The alternative — opacity
  15 — would render the block's own faces black, because the small-box
  emitters light themselves from their own cell (the same rule the torch,
  the brewing stand and the end portal frame have always used).
- Stairs have no upside-down variant and no inner/outer corner shapes; a
  stair is always bottom-half and straight. Slabs DO have both halves, and
  two of a kind stack into the full block.
- Fences/walls/gates connect to solid blocks, each other and gates — not to
  glass or other transparent blocks. Their collision is the post plus the
  arms they actually connect to, so a straight run is sealed but a lone post
  is only 4/16 wide (vanilla).
- A/* mob pathing treats any block with collision above its own cell
  (fences, walls, gates) as NOT standable and any shaped block as
  impassable, so mobs walk round slabs and stairs instead of over them.
  They still stand on them fine — the restriction is only on the integer
  path grid.
- Doors and trapdoors have no hinge side: a door's two states are the
  closed slab and the same slab given a quarter turn. No double doors, no
  redstone (out of scope), and mobs never open them.
- Beds do not render a pillow/blanket model or lay the player down: they
  are a 9/16 slab in wool + planks, and sleeping is a screen fade. There is
  no "leave the bed" position — the player never moves.
- Signs carry four lines of 15 characters, entered through a DOM panel (the
  established generated-UI pattern). Text is drawn in the browser's
  monospace font rather than the Minecraft font (none ships), renders on the
  FRONT face only, and — like every block entity here — does not survive a
  session (there is no world saving).
- Item frames hold one item, show no rotation states, and are not
  rotated by right-clicking a filled frame (that pops the item out instead).
- Flower pots take the sapling only, because the sapling is the only plant
  item in the game.
- Hoes are craftable and inert, as the brief asked; there is no tilled soil
  block and no crop but nether wart.
- The shield is negation, not vanilla's damage-scaling knockback rules: a
  frontal hit does nothing at all and costs 1 durability. It does not block
  explosions' block damage, does not have a cooldown after an axe hit (no
  axe-disable mechanic), and its guard drops the moment the button releases.
- Gold tools sit at wood's HARVEST level (vanilla) but keep their own
  12x speed — so a golden pickaxe mines stone faster than diamond does and
  still cannot harvest gold ore. That reads as a bug to anyone who does not
  know Minecraft; it is exactly right.
- Water flow: no water-source removal by flowing lava (vanilla makes stone),
  no vanilla "falling water spreads at full strength one level lower" edge
  cases beyond the landed-column rule lava already had, and no biome tint —
  the flow uses the still-water tile scrolled on its own repeating copy,
  since the atlas ships no water_flow tile.
- Both fluids share ONE per-tick update budget (FLUIDS.MAX_UPDATES_PER_TICK),
  so a busy waterfall cannot add its cost on top of a busy lava lake — the
  frame cost is one number whatever is flowing.
- The item-frame and sign meshes live in the scene, not in chunk meshes, so
  they do not take baked light (the chest/dropped-item rule).

---

## Partially built

- Phase 25 deliberate slices:
  - **Creative flight COLLIDES with terrain.** The brief's last creative
    bullet ("collision still applies normally when not flying") can be read
    as asking for noclip while flying; vanilla creative flight collides, and
    SPEC.md's whole standard is "convincingly like Minecraft", so that is
    what shipped. It is one flag — `CREATIVE.FLY_COLLIDES` — and setting it
    false gives the fly-through-walls reading with no other change.
  - Breaking a block in creative drops NOTHING (vanilla). The creative
    inventory is where blocks come from, so a drop would only be litter.
    Unbreakable blocks stay unbreakable: `miningPlan` only collapses the
    time for a block with a FINITE hardness, so bedrock and end portal
    frames are as safe in creative as in survival.
  - Creative armour still shows on the player preview and still counts for
    `armourPoints`, it just never wears. There is no damage to reduce.
  - The creative inventory has no armour or offhand slots and no crafting
    grid — the catalogue supplies finished items, and right-clicking a piece
    of armour in the world equips it exactly as it does in survival.
  - The search field is NOT auto-focused on open. E is both the open and the
    close key; a focused field would eat the closing press and the screen
    would look stuck. The foot hint says to click the box to search.
  - A creative player is ignored by hostiles but is not invisible: mobs
    still wander, burn in daylight and take damage. Passive mobs behave
    exactly as they do in survival.
  - Buckets still swap bucket <-> water_bucket in creative (the scoop path
    needs that swap to work at all); vanilla would keep both. Nothing is
    lost either way — the catalogue has all three buckets.
  - Switching to creative restores health, hunger and saturation to full and
    puts out any fire, so switching back to survival starts from a clean
    state instead of from the hit that made you switch. Switching the other
    way changes nothing.
  - There is no third mode (no spectator, no adventure, no hardcore) and no
    per-world default: the start screen asks every load, because the game
    has no world saving to remember an answer in.
- Phase 22 deliberate slices:
  - Particles are small textured/coloured CUBES, not vanilla's camera-facing
    quads. The brief asked for cubes; they tumble on a per-instance yaw+pitch
    so they don't read as a grid of flat squares.
  - Particle collision is a cheap axis-separated point test against a cell's
    collision boxes, and only for the kinds that ask for it (break debris,
    landing). Above PARTICLES.COLLIDE_MAX live it is skipped entirely — the
    cap is a frame-time guarantee, not a correctness one.
  - Particles are lit ONCE, at spawn, from `world.getLight` (the mobs.js
    rule). They don't relight as they drift or as night falls.
  - Particles are cleared on a dimension switch rather than stored (their
    coordinates mean nothing in another world) and are NOT frozen visually
    while the game is paused — the pool holds its last uploaded frame, which
    is what a paused game should look like.
  - There is no smoke from torches, no crit/enchant sparkle, no fire particle
    on a burning entity, and no vanilla "block landed on" dust. The brief's
    list is covered; these are not on it.
  - Sound is synthesised, so it is *evocative* rather than sampled: a stone
    footstep is a filtered noise transient over a short body tone, not a
    recording. Mob voices are one shape pitched by the mob's height rather
    than a per-mob timbre. There is no music.
  - The stereo pan is a StereoPannerNode driven by the camera's right vector
    (no HRTF, no PannerNode per voice — far cheaper and, for a blocky game,
    indistinguishable).
  - The looping ambience beds (water, lava, end portal) are built lazily and
    then run for the session at whatever gain the census sets, including 0.
    Starting and stopping them would click.
  - `AUDIO.MAX_VOICES` drops the overflow silently: past 24 concurrent
    one-shots a new sound simply doesn't play. Under the brief's worst case
    the compressor, not the cap, is what does the work.
  - The nether portal keeps its OWN particles and hum in
    dimensions/portals.js (Phase 15, still working); ambience.js deliberately
    skips NETHER_PORTAL so nothing is doubled. Only the context is shared.
  - "Level-up" has no XP system to hang on (this game has none): the chime
    plays on the one genuine milestone the game has, the victory, and softly
    on a golden apple.
  - Ender pearls hit BLOCKS only — they pass through mobs (vanilla damages
    them) — and they never spawn an endermite. A pearl thrown into open sky
    despawns after ENDER_PEARL.MAX_SECONDS with no teleport.
  - The eye of ender draws through terrain by turning its depth test off,
    so it also draws over the hand pass' worth of world in front of it. That
    is the point of the fix; there is no distance-based "x-ray only when
    occluded" refinement.
- No stub modules remain — entities/dragon.js, the last one, became the
  dragon fight in Phase 20. Every file in ARCHITECTURE.md's layout is
  real.
- Phase 20 deliberate slices:
  - No XP system exists in this game, so the dragon grants none (SPEC
    mentions XP on death; the assets/entity/experience_orb.png sheet
    ships unused). The dragon EGG is a decorative trophy mesh managed by
    the fight, not a block — it can't be mined or carried (vanilla's
    egg-teleport minigame is out of scope).
  - The dragon's wings are not hitboxes (head + spine + tail cubes are);
    SPEC only distinguishes head vs body. The breath attack fires only
    while perched (vanilla also spits fireballs while strafing — the
    strafing run's threat here is the wing knockback), and there is no
    lingering breath cloud.
  - Perch projectile-immunity is detected by HIT DISTANCE
    (DRAGON.PERCH.ARROW_RANGE = 4.5 > melee reach 3): a point-blank
    arrow counts as melee. Accepted — vanilla's rule forced through
    paths combat.js doesn't tag.
  - The dragon never breaks blocks it flies through (vanilla destroys
    most non-End blocks on contact) — it's a kinematic flyer above an
    island made of end stone/obsidian/bedrock, where vanilla's rule
    barely bites anyway.
  - Crystals have no iron-bar cages (SPEC omits them) and don't respawn;
    the fight state (crystals popped, dragon health, the open portal)
    lives for the session — there is no world saving (out of scope).
- Phase 19 deliberate slices:
  - The stronghold has no vanilla room variety beyond the SPEC list — no
    fountains, prison cells beyond the storage stock cell, or five-way
    crossings; junctions are plain torch-lit rooms. Stairs are 1-block
    steps (the fortress rule — no stair blocks exist). Doors are open
    3-wide arches (no door blocks in scope).
  - Portal-room frames are unbreakable and undroppable (vanilla); the
    interior END_PORTAL blocks only ever appear via activation (or the
    ~1e-12 all-prefilled seed roll, handled deterministically). The
    activation check runs on fill, not per frame — breaking blocks can't
    deactivate the portal (frames are unbreakable, so nothing can).
  - The end portal sheet reuses the nether portal's animated purple
    swirl material (fullbright, world-continuous UVs) rather than the
    vanilla starfield — a deliberate reuse, reads correctly in place.
  - ~~The End is the ISLAND only this phase~~ — Phase 20 rebuilt the
    island and added the pillars, crystals, exit portal fountain, the
    dragon and the victory trip home.
  - The eye-throw target stays the stronghold CENTRE column (the
    portal-room walkway anchor) at every distance — vanilla eyes lead to
    the stronghold START; ours lead to the portal room itself, which is
    kinder and the dig-down column is deliberately pool-safe.
  - Iron-bar panes connect to solid blocks and other bars only (not
    glass); their collision stays the full cell (the Phase 10 note).
    Bars/frames/the stand cast full-cell AO shadows no longer (they went
    `transparent` for culling) — the trade for real shapes.
  - Loot chests roll a fixed stronghold-flavoured table per position —
    no per-room-type tables (library chests would hold books in vanilla;
    ours already roll books at 40%).
  - Enderman Nether spawns use the standard ground rules (netherrack at
    any light) — no biome gating (there are no Nether biomes).
- Phase 18 deliberate slices:
  - Magma cream (the fire-resistance ingredient) is an occasional blaze
    drop (25%) — its vanilla sources (magma cubes, bartering) are out of
    scope. The healing potion's glistering melon has NO source yet (no
    melons, no gold-nugget crafting): the brew recipe is registered and
    inert, and SPEC marks healing optional.
  - Potions have no tooltips (this game has none) — the liquid colours
    distinguish them, so awkward is a murky violet instead of vanilla's
    water-blue. Splash/lingering/extended/II variants: none. The awkward
    bottle drinks like water (no effect), vanilla.
  - ~~The brewing stand still renders as its full atlas-tile cube~~ —
    Phase 19: the real box model (world/emitters.js). Its screen layout
    remains a simplified vanilla (no bubbling animation art).
  - ~~Fuel is debited per completed operation~~ — Phase 19: a powder is
    consumed (and the bar fills) the moment the slot holds one, vanilla;
    the charge still persists across interruptions.
  - The enderman never picks up blocks, has no idle sounds beyond the
    warp vwoop, and doesn't dodge arrows pre-hit (our arrows only test
    mobs; the post-hit blink covers the feel). ~~No End dimension yet~~ —
    Phase 19: endermen spawn in the Nether (commonly) and the End too,
    and the overworld night weight tripled. The stare uses
    the vanilla dot threshold but not the vanilla's helmet/pumpkin
    exemptions (no pumpkins in scope).
  - Eyes of ender fly toward the stronghold's true bearing from wherever
    thrown (even in the Nether, where vanilla's do nothing useful — the
    direction is still the overworld bearing; harmless, and the
    stronghold hunt is an overworld activity).
  - Fortress stairs are 1-block steps (no stair blocks exist): mobs walk
    them, the player jumps up them — the standard block-game staircase.
    Fortresses stay one blueprint per region (the sprawl now fills it);
    bridges don't cross over each other (one piece per cell column).
  - The blaze charge flare is a body tint pulse (no particle system);
    volley cadence and the burn are exact to the session values.
- Phase 17 deliberate slices:
  - Blazes are SPAWNER-ONLY (vanilla also natural-spawns them around
    fortresses); the spawner keeps the fight going, and rods farm fine.
  - Blazes count toward the Nether's hostile cap (GHAST.CAP 4), so a
    fortress fight suppresses natural ghast spawns until the blazes die
    or despawn — accepted pacing, self-healing (hostiles despawn at 128).
  - A blaze fireball's small blast (damage radius 2) hurts every mob in
    range — blazes can chip each other in a crossfire, like ghast blasts
    always could. No fire blocks: fireballs still ignite nothing (fire
    exists only as a status).
  - Fortresses are single-level (one deck height per fortress); vanilla
    stacks levels. Spawners drop nothing and give no XP (no XP system).
  - Only the grown wart texture ships; younger stages render shorter
    crop quads sampling the bottom band of the same art (reads as red
    sprouts). No trampling; a falling block landing in a wart cell
    overwrites it silently (unreachable in practice — the Nether
    generates no sand/gravel).
  - Wart growth timers are runtime-random (like sheep wool regrowth),
    not seeded — only world GENERATION is deterministic.
  - The spawner's discovery scan runs 1 chunk/frame — a spawner can
    take a second or two to grow its display after its chunk first
    meshes (spawning needs the player within 16 blocks anyway).
- Phase 16 deliberate slices:
  - ~~No nether fortresses yet~~ — Phase 17: fortresses, blazes and
    nether wart are in (see above).
  - Ghast fireballs can be deflected by melee only — arrows pass through
    them (vanilla lets arrows pop them; our arrows only test mobs).
    Fireball explosions use the standard explosion (no fire blocks — fire
    exists only as a status, as before).
  - Ghasts don't strafe away when hit and have no separate "shooting
    face" texture (only ghast_ghast.png ships; vanilla swaps to a
    red-eyed variant while firing).
  - The lava-ocean shores animate via the normal settle scan; the deep
    ocean interior is still static source blocks (exactly like overworld
    lakes). Nether lava spreads at the standard 3-block range — only the
    tick doubled (a wider range needs new flow-level block ids; deferred).
  - All dimensions still share the overworld chunk shape (16x384x16); the
    Nether's y 0..128 generates inside it. y>128 above the ceiling is
    empty and unreachable (bedrock is unbreakable; portals clamp below).
  - Linked-portal placement in the OVERWORLD still uses the highest solid
    column (an ocean-landing return portal builds on the sea floor); the
    Nether side got the ceiling-aware ground search this phase, and the
    link search is still Y-blind (vanilla is also crude here).
  - Portal blocks stop falling sand/gravel (they pop off as items, the
    torch rule) instead of letting them fall through like vanilla; mobs
    never use portals (nothing to travel to yet); items/arrows sitting in
    a portal don't travel either — only the player does.
  - The portal ambience hum keeps sounding through the Esc pause (one
    quiet loop; every other sound is a one-shot). The pause gate freezes
    the swirl/particles/timer correctly.
  - ~~Waterfall springs exist only inside mega caverns and water remains
    static everywhere~~ — Phase 21: water flows on the same automaton as
    lava (range 7, 0.25s tick, infinite-source rule). RIVERS remain the one
    unplaced SPEC world feature — they need a carver pass, not a fluid one.
  - Exiting lava in the Nether restores the OVERWORLD fog for one frame
    before the dimension override rewrites it (edge-triggered restore vs
    per-frame override — invisible in practice).
- Phase 14 deliberate slices:
  - Mobs (like items and arrows before them) FREEZE in unloaded chunks —
    a passive herd left 500 blocks behind holds its position and state
    until the player returns, rather than simulating. Anything new that
    reads the world per mob per frame must go inside that gate.
  - The held-torch light is render-time only: the SPAWN gates still read
    baked light, so holding a torch does not prevent hostile spawns around
    the player (only a placed torch does) — the documented tradeoff of the
    no-remeshing design. Dropped items/arrows/chests don't take the held
    tint (mobs do); their baked-light look was already the established
    slice.
  - Shift-clicking INTO the offhand slot isn't a route (vanilla doesn't
    either); F and direct clicks are. No HUD offhand slot next to the
    hotbar yet — the left hand IS the in-game indicator.
  - Sheep eat no grass (wool regrows on a timer); no breeding, no baby
    animals, no wheat/seed luring. Eggs don't throw or hatch.
  - The skeleton's bow doesn't tint with world light (its material is the
    shared extruded-item cache); it also never strafes, as before.
  - The player preview's armour is colour-coded overlay boxes, not the
    vanilla armour-layer textures (no armour sheets ship in assets).
- Phase 13 deliberate slices:
  - ~~The overworld hostile roster is complete. Still to come:
    passive herds~~ — Phase 14: the herds are in; ~~enderman, blaze,
    ghast~~ — Phase 16: the ghast is in (Nether). Still to come:
    enderman (End/overworld night), blaze (fortresses).
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
  - ~~Only lava flows. Water stays static~~ — Phase 21: both fluids run the
    one automaton. Lava meeting water has made obsidian/cobblestone since
    Phase 15.
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
- `ui/screens.js` has the inventory, crafting, chest, furnace, brewing,
  death and victory screens. The Phase 21 sign editor is deliberately NOT
  one of them — it is a small self-contained panel in world/signs.js, which
  owns signs end to end (state, art, entry). The brewing stand should
  reuse the Phase 10 container machinery (SlotContainer with slot gates +
  a screen mode with indicator art — the furnace is the template).
- Phase 8 deliberate slices:
  - ~~Crafting recipes only cover what the item set supports — no golden
    tools, no shield/ladder/door~~ — Phase 21 shipped all of them, plus
    hoes, shears, stairs/slabs/fences/gates/walls, trapdoors, beds, signs,
    bookshelves, item frames, flower pots, charcoal, stone bricks,
    sandstone and the four block forms.
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

The standing caveat Phases 23-26 recorded still bites: **framerate is
unmeasured** — Chromium in this sandbox has no GPU and runs the game at
11-17 fps under swiftshader whatever the settings, so the 60fps-at-1080p
target rests on measured GEOMETRY rather than a measured frame rate: the
LOD tiers hold the final r=25 ring to 5.58M triangles / 458 MB (measured;
full detail would be 10.00M / 820 MB — and roughly half the r=40 ring the
first Phase 27 cut shipped), far chunks carry no light arrays, frustum
culling draws ~a quarter of the ring per frame, the streamer costs an idle
frame nothing, and the post pipeline adds ~8 small screen-space passes
(the scene pass itself unchanged). If a real machine still disagrees, the
knobs are one config edit each: VIEW.DISTANCE_CHUNKS,
VIEW.LOD.DETAIL_CHUNKS (lower = cheaper), VISUAL.MSAA_SAMPLES,
VISUAL.POST_ENABLED. Also honest: the swiftshader
chunk-ring stall documented in Phase 25 (the streamer is frame-rate-bound
in this sandbox and never fills past ~50 meshed chunks) is unchanged and
made every Phase 26 screenshot a near-field one; the LOD/full-ring numbers
come from the node harness, which meshes the real ring without a GPU.

The five Phase 24 follow-up reports are all closed
and all measured (see the Phase 25 status entry): render distance raised
with the geometry and memory numbers written into config beside it; the
biome mix rebalanced to plains 40 / forest 23 / desert 19 / mountains 18 and
the coast/forest claim measured to be absent from the generator both before
and after; a new seed with an even spawn area; the mountain stone line
corrected from 60/38 to 91/8 grass/stone; and great caverns raised in RATE
until 67% of random cave cells are within 60 blocks of walking of a big
room. The one thing worth flagging is a CAVEAT on the word "verified"
rather than a break, and it is the same one Phase 24 recorded:

- **Framerate is unmeasured, again.** (And the follow-up's r=20 render
  distance makes the caveat bite harder: the choice was made on draw-call/
  triangle/memory arithmetic, measured, not on a real GPU. If a real
  machine disagrees, VIEW.DISTANCE_CHUNKS is one number with its own
  r=8/12/20 cost table written beside it.) The generation, geometry, memory,
  biome, cavern and mountain figures come from a headless harness driving
  the real generators and the real mesher, and every gameplay claim comes
  from the real game in Chromium — but Chromium in this sandbox has NO GPU
  and falls back to swiftshader, where the game runs at 2-10 fps whatever
  the settings. So the browser run measures correctness (block layout,
  reachability, screens, HUD state, mode gates, flight numbers) and NOT the
  60fps target. The render-distance decision was therefore made on the
  quantities that CAN be measured — 973 draw calls, 2.03M triangles and
  ~320 MB resident at r=12 — with r=8 left one line away in config.js for
  anyone whose machine disagrees. The same GPU-less environment is why the
  double-tap-space flight toggle had to be verified twice: with real key
  events at a viewport small enough to hold a workable frame rate (two
  presses 243ms apart, flight ON) and with synthetic events through the same
  listener (tap, tap -> flying; tap, tap -> grounded), because at 1280x720
  the software renderer delivers input once per ~500ms frame and no
  double-tap window would ever close.

- **The chunk ring does not fill in this sandbox — and it does not at r=8
  either.** Worth recording, because it looks exactly like a render-distance
  regression and is not one. In the GPU-less browser the game runs at
  5-17 fps, and `world.js` `_streamPass` spends a fixed 8 ms per FRAME
  nearest-first: near chunks stay dirty because `world/fluids.js` is still
  settling generated water (measured: 300-1600 setBlocks per 10 s, mostly
  water flow, declining but not to zero while new chunks keep arriving), one
  remesh costs ~9 ms, so at 5 fps the entire budget goes on remeshing the
  chunks already meshed and the ring never grows past ~72. A/B at the same
  viewport and the same 90 s warm-up: **r=12 gives 15.5 fps / 72 meshed /
  115 loaded; r=8 gives 17 fps / 72 meshed / 115 loaded** — identical, so the
  stall is frame-rate-bound, not distance-bound. At 60 fps the streamer gets
  twelve times the budget and the water churn is a rounding error against it.
  Nothing was changed here: the streaming budget and the fluid settle are
  both WORKING per this document, and the last session of a project is the
  wrong place to re-engineer a system on the evidence of a software
  renderer.

The two Phase 23 follow-up reports are closed — see
the Phase 24 status entry: the lava one was real (the settle scan grew the
generated pools; pools are contained basins now, measured), and the
deepslate one could not be reproduced against this code by ANY measurement,
including in the live browser game. On that one, worth stating plainly:

- **The deepslate report describes a world this code cannot generate.** At
  y=-13.6 this generator has produced 100.00% deepslate (with deepslate
  ores) in every measurement: three seeds in the node harness, and the
  actual running game in Chromium (9188/9188 non-air cells deepslate-family
  in y[-30,-10] at spawn). The strongest hypothesis is a STALE BUILD on the
  player's side — browsers cache ES modules and the atlas PNG hard, and a
  GitHub Pages deploy can lag a merge. If it recurs: hard-refresh
  (Ctrl+Shift+R), and check `TIME`/`CHUNKS` in the debug HUD plus
  `window.__BLOCK.DEEPSLATE` in the console — it is `163` on current code
  and `undefined` on anything older than Phase 23.

The one thing worth flagging for the next session is not a break but a
CAVEAT on what "verified" means here: the cavern, ore, lava and water numbers
come from a headless harness that drives the real `TerrainGenerator`, plus a
Chromium run of the real game. Chromium in this environment has no GPU, so
the browser run measures correctness (block layout, reachability, HUD sizes,
audio context state) and NOT framerate — the 60fps target is unmeasured this
phase. Chunk GENERATION cost was measured directly and is unchanged
(6.2 ms/chunk over a cavern, 6.5 ms on plain terrain).

Also honest about the previous record: the Phase 10 entry claiming lava
placement was fixed has been marked CORRECTED in place rather than deleted.
It was not a lie, it measured the wrong quantity — "zero lava at/above y=10"
while the actual complaint lived between -54 and 10. A census that cannot
fail the thing being reported is not evidence.

Worth recording honestly about two of them:
- The **water bucket** placement path tested GREEN in isolation again this
  phase (a bucket right-clicked at a plain floor has always worked). What
  reproduces the report is aiming at WATER: the block raycast skips fluids,
  so the click resolved to the floor under the pool or to nothing at all.
  Placement now runs its own fluid-aware ray and takes the fluid cell
  directly, which is also the vanilla rule.
- The **golden apple** was reported twice. The second report is the one the
  code now matches: ABSORPTION II (4 hearts), not vanilla's Absorption I
  (2). The first round's mechanism was verified working end to end through
  the real hold-to-eat path — the hearts DID render — so what changed is the
  amount, the row's per-frame visibility write, and four hearts being far
  harder to miss than two.
- The **held-item mirroring** report named blocks as well as items. Blocks
  were measured, not assumed: `entities/items.js`'s face/UV table is
  byte-identical to the mesher's in `world/emitters.js`, so a held mini-cube
  shows exactly what a placed block shows, and it was left alone. The
  mirroring was entirely in the SPRITE pose (SPRITE_TILT's ~180° yaw shows
  the slab's back face) and is fixed for everything that is not a tool.

---

## Deliberately not built

See the out-of-scope list in SPEC.md. Also deliberately deferred by design:
per-block data tables belong in `world/blocks.js` and per-mob tables in
`entities/mobs.js` (registries), not `config.js` — config holds global tunables.

---

## Notes for the next session

**There is no next session — Phase 27 was the last one, and the project is
complete.** What follows is kept as a maintainer's handbook: if anyone picks
this up again, these are the things that were expensive to learn.

### Phase 25 APIs

- `player/gamemode.js` is the third module singleton (with `particles` and
  `audio`). Import `gamemode`, ask it, don't pass it. Adding a creative rule
  means finding the ONE place that already owns that rule and gating it
  there; if you can't find such a place, the rule probably belongs to a
  system that doesn't exist yet.
- `body.flying` is a field, not a gamemode lookup, precisely so
  `player/body.js` stays node-constructible with a bare `{ getBlock }` world.
  Keep it that way.
- `ui/creative.js` exports `CREATIVE_TABS`; a new item is one string in one
  tab, but it must already resolve through `entities/items.js`
  `itemVisualInfo` or it renders as a blank tile. The scratch check that
  guards this walks every catalogue name against the block registry,
  `ATLAS_SPRITE_ITEMS`, the generated painters, the potion table and
  `assets/items/*.png`, and walks `systems/crafting.js` the other way to
  catch anything the catalogue forgot.
- `ui/screens.js` owns the E key for BOTH inventories. If a third screen ever
  wants E, put the routing there rather than adding another document-level
  listener that has to guess who else is open.

### The lessons this project kept re-learning

- **Measure the quantity the report is about.** Phase 10 measured "lava above
  y=10" while the complaint lived at y=-13. Phase 23 measured GENERATED lava
  and missed what the fluid settle scan then grew. Phase 24 measured a
  mountain's grass/stone RATIO and missed that almost all the stone came from
  one cause it could have separated. Phase 23 measured cavern SIZE and COUNT,
  both true, while the report was about how far you have to walk to find one.
  Four phases, one mistake: a census that cannot fail the thing being
  reported is not evidence. Before measuring, write down what number would
  make the reporter say "yes, that's it".
- **A correlation someone reports may not be in the code.** "Forest appears
  near water almost every time" measured at 26.2% coastal vs 26.1% inland —
  it was a property of one spawn area, not the generator. Saying so plainly,
  with the number, and then fixing the real nearby problem (coupled domain
  warps) is better than inventing a mechanism to remove.
- **Noise thresholds do not make rooms.** Three phases tried; see
  `world/caverns.js`'s header. Place structures; threshold textures.
- **sRGB vs linear bit this project three times** (particles, clouds, stars).
  Three.js stores material colours linear and converts on output.
- **The size cap is what kept this readable.** 25 phases, ~11k lines of
  source, and the largest file is 915 lines. Every split is recorded in
  ARCHITECTURE.md with the reason. `entities/dragon.js` (884) still carries
  its mandated rig cut, `world/emitters.js` (829) its small-box emitters and
  `world/blocks.js` (915) its lookups tail — those are the three to make
  before anything else lands in them.

### Running the dev harnesses

The game itself has no npm dependencies and loads three.js from the CDN via
the importmap in `index.html` — that is what ships. The harnesses need a
local three (this sandbox blocks unpkg.com) and Playwright, both installed
into a gitignored `node_modules`, plus a gitignored `test.html` whose
importmap points at the local copy. Serve the project root over HTTP
(`python3 -m http.server`) and drive `test.html`; `window.__*` handles are
exposed from main.js for everything, and `player.debugForceInput(true)`
unfreezes the loop without real pointer lock.

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
| 13 | Hostile roster (zombie / skeleton / creeper / spider: per-type AI, daylight burning, weighted spawning, vanilla box models); combat system (weapon damage with 1.9 cooldown scaling + falling crits, player bow with draw-scaled arrows, arrow projectiles both ways, creeper explosions with block destruction); armour (four equip slots, SPEC damage reduction, durability wear, HUD bar, death drops); first-person hand split into player/hand.js | Passive herds; enderman/blaze/ghast with their dimensions; skeleton bow render + shot pacing polish; mob-vs-mob combat beyond explosions |
| 14 | Passive herds (cow/pig/sheep/chicken): SPEC stats/drops, wander + panic-flee AI (entities/passive.js), daylight-grass spawning with the no-despawn cap rule (entities/spawning.js split), mobs frozen in unloaded chunks, models verified against the shipped temperate sheets (multi-box parts, wool overlay, quadruped body roll — entities/models.js), sheep shearing + wool regrowth, chicken eggs + slow fall; the exact vanilla food table audited + golden-apple/rotten-flesh (80% Hunger) rules; hunger pacing halved (EXHAUSTION_SCALE); real 20-min day/night phase timing (10/1.5/7/1.5); cave spawn pressure quartered + hostile cap halved; skeleton visible bow (left hand) + 2s draw-and-release cycle + drop census verified; inventory-screen 3D player preview (generated neutral skin, live armour overlays, mouse follow); offhand slot (F swap, left-hand first-person render, right-click active-hand fallback, offhand bow/bucket/food/armour); held-torch dynamic light level 14 from either hand (render-time per-fragment, verified zero remeshing); armour re-verified live; the full early game verified end to end; 5-lens adversarial review with all 11 confirmed findings fixed | Nether/End dimensions + their mobs, brewing, stronghold, dragon; breeding/luring; held-light spawn-gate interaction (render-only by design); water flow; rivers; the skeleton "fix" proved internal-state-only — the visible cycle landed in Phase 15 |
| 15 | Portal mechanics: obsidian frame detection (SPEC 4x5 minimum, corners optional, node-tested pure logic), flint-and-steel lighting with durability wear through the real right-click chain, animated generated-swirl portal blocks (world-space UVs, emissive light 11), purple portal particles + procedural hum/shimmer/whoosh, 3s stand-to-travel with 1:8 coordinate scaling, linked portal reuse within 32 blocks or creation flush on local ground, portal break-down via the block listener; the dimension system (dimensions/dimensions.js): one World whose backing store swaps, per-dimension scene groups, every entity manager swapping collections (items/mobs/falling/arrows/fluids/furnaces/chests — frozen + hidden while stored, furnaces provably not smelting), fixed dimension skies (setDimensionSky), Nether death respawning at the overworld spawn; the placeholder flat-netherrack Nether; water+lava -> obsidian/cobblestone (immediate on contact, fluids.js); the distinct mega-cavern pass + waterfall springs (world/noise.js split, byte-identical); the skeleton shooting fix (raise-draw-release cycle, bow-position arrows, MIN_TINT night visibility, visible arc at speed 24); MOB_TYPES -> entities/registry.js (mandated split); TEMPORARY test chest behind config TEST_CHEST; 26 node + 61 browser checks, review fixes (stale-camera travel frame, canopy chest, portal UV seam) | The real Nether generation + blazes/ghasts (placeholder replaced next session); nether portal ceiling-height placement niceties (ocean-floor return portals, Y-blind link search); mobs/items never travel portals; brewing, stronghold, End, dragon |
| 16 | The real Nether (dimensions/nether.js): shaped 3D density field between bedrock floor and the bedrock ceiling at 128 — huge open caverns, lava oceans at/below y=31, floating netherrack formations, soul sand patches (registry `slows`), glowstone ceiling clusters, quartz veins, rare wall lava leaks; ~1.5ms/chunk, byte-deterministic; the dimension ambient floor (`NETHER_SKY.AMBIENT_LIGHT` -> `uMinSkyLevel`) making "constant dim red" real under the ceiling; Nether lava tick halved (fluids.setTickSeconds per dimension); ceiling-aware linked-portal ground search + carved-pocket fallback (arrivals can't land on the ceiling); the ghast (entities/ghast.js + registry `flying`/`scale`/`minBrightness`, GHAST_MODEL from the real 2x sheet): gravity-free wander, fireballs at a visible player every 3s, melee deflection flipping ownership (systems/fireballs.js — combat raycast wraps fireballs, explode takes per-blast radii); per-dimension spawn tables (nether: ghasts only, any light, cap 4; overworld pools exclude `nether: true` types); the chest-lid fix (modern sheet's swapped top/bottom slots — model + icon); two cap splits (ghast.js, fireballs.js); 10 node + 23 browser checks, zero console errors | Nether fortresses + blazes + nether wart; arrows don't pop fireballs; ghast shooting-face texture; wider Nether lava range (needs new flow ids); brewing, stronghold, End, dragon |
| 17 | Nether fortresses (dimensions/fortress.js): a guaranteed fortress per 192-block region — region-seeded blueprints (heart blaze room, 6-wide bridge/corridor runs with railings/windows, crossings, terminal blaze towers with merlons and roofed wart rooms with glowstone lamps), fully connected with doorways, one deck height, support piers to ground/lava; deterministic per-chunk emission (fortress pass last). The blaze (entities/blaze.js + BLAZE_MODEL/BLAZE_RINGS): hovers, holds its ring, charge -> burst of 3 small fast fireballs (6 dmg, no crater) -> cooldown, drops blaze rods 0-1, spawner-only. Blaze spawner block entities (world/spawners.js): spinning caged mini blaze, proximity-gated timed spawn cycles with a nearby cap, fluids-style chunk-scan discovery of generated spawners. Nether wart (blocks 65-67 + world/wart.js + the emitters crop model): fortress gardens generate it grown, harvest drops 2-4, PLANTABLE replant on soul sand grows on timers, soil break pops. Fireball opts (size/damageRadius/maxHardness — ghast blasts spare nether brick). Two mandated cap splits: world/emitters.js (byte-identical A/B) and entities/skeleton.js (verbatim). 23 node + 17 browser checks, zero console errors | Blazes spawner-only (no natural fortress spawns); single-level fortresses; no fire blocks from fireballs; no spawner XP; wart stages reuse the grown art cropped; brewing, enderman, stronghold, End, dragon |
| 19 | The stronghold (dimensions/stronghold.js): seeded 11-block-cell blueprint grown from the portal room anchored at strongholdCenter (walkway-safe dig-down anchor), corridors/staircases/junctions/libraries/storage in weathered stone brick with iron bars, per-chunk order-independent emission as the overworld's last pass, support piers, deterministic loot chests via the new world/chests.js chunk-scan; the portal room (12-frame ring, 10% pre-filled, 3x3 lava pool, bar niches); the end portal (eye-on-frame filling through the real use chain, activation on the 12th eye, fall-in travel); the End island + obsidian arrival platform + END_SKY + endermen + void death (dimensions/end.js); emitters for the brewing stand's REAL model, iron-bar panes, the 13/16 frame (+eye box, atlas tile 58 generated) and the portal sheet; bug fixes: brewing verified end-to-end + eager fuel loading, enderman weight 20→60 + common in the Nether (2:1 override) + the End, Nether fog 8/72→20/140; mandated splits: player/fluid_actions.js out of interaction.js, spawn profiles out of mobs.js into spawning.js; the portals.js 'end' registry crash caught by the suite and fixed. 83 node + 20 browser checks, zero console errors | The End's pillars/crystals/exit portal/dragon/victory (Phase 20); combat.js still over the cap (arrow cut mandated); TEST_CHEST removal moved to the victory-screen session |
| 20 | **The finale — the game is feature complete.** The End rebuilt whole (dimensions/end.js): ~110-block island with a flat central plateau, 10 obsidian pillars (heights 40→70 climbing the ring, bedrock crystal seats), the inactive bedrock exit-portal fountain (base disc, rim, 20-cell well, torch-lit column), deterministic and shared with the fight via one EndGenerator instance. End crystals (entities/crystals.js): the real-sheet spinning cage/core/base display on every pillar, poppable by any hit through the combat facade, exploding for real. The Ender Dragon (entities/dragon.js + DRAGON_MODEL/END_CRYSTAL_MODEL in models.js, converted from the vanilla rigs with the wing-membrane texOffs trick): a kinematic banked flyer with driven bezier neck/tail chains, circling/strafing/perching phases, wing knockback, the perch breath cone, 200hp with head-only full damage (body 0.25x), perch projectile-immunity, crystal healing at 3/s over a visible beam with the feeder-pop sting, a 5.5s death sequence (glide to centre, nine wheeling light beams, white-out) that fills the exit portal and spawns the layered-box dragon egg. Victory (ui/screens.js): entering the active portal shows the victory screen; Return Home lands at the overworld spawn, inventory intact. Combat integration via the main.js combatTargets facade — combat.js untouched. TEST_CHEST removed (mandated; restored by request in the follow-up with an expanded End-fight kit). 25 node fight checks + 21 browser end-to-end checks green, zero console errors; screenshot-verified (island, dragon in flight, crystals, healing beam, perch, breath, death beams, active portal + egg, victory screen) | Polish only: combat.js arrow split (the standing cap mandate), stronghold room upgrades (Phase 19 report), sounds/rivers/water flow (SPEC "feel"), no XP/egg-block (documented deviations) |
| 18 | Brewing (systems/brewing.js + the ui/containers.js screens split): the 5-slot brewing stand (3 gated bottle slots / ingredient / blaze-powder fuel loaded 20 ops at a time), the SPEC potion table brewing all matching bottles per 20s operation, glass bottles filling at water sources, potions drunk through the hold path leaving their bottle, real effects in stats.js (fire resistance suppressing all lava/fire damage 3:00 — the run-critical one — strength +3 melee, instant healing) with a HUD countdown chip and tinted-bottle item art everywhere; the enderman (real 2.9-block model + jaw layer, exact-camera stare-to-aggro with the creepy head-lift, blink on hit / into dry ground out of water damage / to a distant target, ender pearls, rare overworld night spawns); eyes of ender flying to the DETERMINISTIC stronghold point (dimensions/stronghold.js, 1000-2000 blocks from spawn per seed), hovering, dropping back or shattering 20%; blazes retuned to real values (volley of 3, 5s cooldown, 5 dmg + 4s burn on direct hits, 1.2s wind-up with a body flare); fortresses grown to the real scale (384-block regions, ~100-piece blueprints to ~300 blocks, 112-block bridges, staircase galleries between deck levels, tall crenellated towers, an enclosed 3x3-room keep); the Nether brightened (ambient floor 9, warm red-orange fog). 659 node + 75 browser checks, zero console errors | Stronghold generation (must anchor to strongholdCenter), the End + dragon; glistering melon has no source (healing optional per SPEC); magma cream is a 25% blaze drop (vanilla sources out of scope); interaction.js (~806) and combat.js (~803) carry mandated-split notes |
| 21 | **Polish: the building set.** Gold tools + hoes in five tiers, the shield (raise to negate frontal melee/arrows/blasts), craftable shears (sheep AND leaf blocks). Stairs and slabs in five materials, fences, fence gates, cobblestone walls, ladders, doors, trapdoors, beds, signs, bookshelves, item frames, flower pots — every one a REAL SHAPE from ONE box table (`world/shapes.js` + `world/shape_tables.js`) that feeds both the mesher's new generic `emitShape` and the collision sweeps, so fences really are 1.5 tall and slabs really are half height. Ladders climb at the vanilla 2.35 b/s; doors/gates/trapdoors toggle; beds set spawn and skip the night; signs take four lines of text on placement. Charcoal from any log (fuel + torches), stone bricks, sandstone, the four block forms both ways, books from leather. The six reported bugs: water bucket placement hardened + regression-tested, the End fight's per-frame cost cut to ~0.1ms (preallocated hitboxes behind a ray reject, one shared crystal material, cached blast targets, chunk-local pillar tests), the purple boss bar, the dragon now GRIPPING the fountain with its head craned down, the island 102-118 across with vanilla 14-40 pillars (HEAL.RANGE 40->30), and WATER FLOW on the lava automaton with both fluids rendering at partial height on their own scrolling texture. Five ARCHITECTURE cuts: systems/arrows.js (mandated since Phase 17), player/placement.js, player/body.js, world/shapes.js + world/shape_tables.js. 88 automated checks green, zero console errors, screenshot-verified. | dragon.js (878) and blocks.js (908) over the cap with their cuts mandated; rivers; sounds; no upside-down/corner stairs, no door hinges, no sign font |
| 22 | **Polish: particles and sound.** `render/particles.js` — ONE pooled, capped, allocation-free particle simulation in TWO instanced draw calls (textured cubes cropped from a block's own atlas tile; flat coloured cubes), struct-of-arrays state, spawn-time light tint and distance cull, gated block collision, sRGB-decoded colours: block break/place, footstep scuffs and landing bursts tinted to the block underfoot, water splash + bubble trail, lava embers and pops, expanding explosion smoke/debris/flash, red damage hits, death puffs, pickup sparkles, end-portal swirls, enderman blink columns, torch and glowstone flicker. `systems/audio.js` — the WHOLE game's sound synthesised with the Web Audio API (no files): one context, layered 2-4 voice sounds, a bus compressor, distance falloff + stereo pan, a voice budget, per-material footstep/break/place/mining timbres, hurt/death, swing/hit, bow draw/release/impact, hiss/boom/shriek/crackle/warp, splash/bubble/lava pop, pickup, the victory chime, looping water/lava/portal ambience and underground cave tones; combat.js and portals.js gave up their private WebAudio for it. `systems/ambience.js` — footsteps/landing/splash/bubbles plus vanilla's randomDisplayTick. Measured 0.16ms/frame at 1900 particles, 0.25ms/frame for particles + ambience together in a busy scene, 0.30ms in the creeper-beside-lava worst case. The six reported bugs: the MAGENTA boss bar shown by ARRIVING in the End (not by the fight's first tick), water buckets placing through a fluid-aware ray (aiming at water used to no-op) with flow re-verified 7 cells/step-lower/fills/falls, golden apples granting Absorption II — 4 yellow hearts for 2:00 — plus 5s of Regeneration II, with a HUD row above the health hearts that empties first, and the potion-effect indicator shrunk to vanilla's small top-right icon + countdown, held non-tool items un-mirrored (blocks measured identical to the mesher and left alone), ender pearls as a real thrown projectile that teleports for 2.5 hearts, and thrown eyes of ender drawing through terrain. 50 automated browser checks green, zero console errors, screenshot-verified. | Rivers (the last unbuilt SPEC feature); dragon.js (878) and blocks.js (908) still over the cap with their mandated cuts; particles are cubes not billboards and are lit once at spawn; no music; no XP so "level-up" rides the victory |
| 23 | **Polish: deepslate and the underground.** Deepslate below y=0 (`world/terrain.js`), blended over the band to y=-8 by a per-block hash roll so the transition is speckled rather than a plane — hardness 3.0 (2x stone), dropping cobbled deepslate, with all five ores taking their deepslate variant in it (blocks 163-169, atlas 58-64) and cobbled deepslate accepted as a stone crafting material (furnace, brewing stand, the five stone tools). **GREAT CAVERNS** (`world/caverns.js` — new): the fourth attempt at big caves and the first that works, because it stops sampling noise and PLACES them — 224-block regions, 72% each, hashed centre/radii/height, a superellipsoid body (y exponent 3.2 = a room, not a lens) warped by a 3D field, a mid-level shelf slab for the ledges and drops, and two climbing connector bores into the tunnel network. Verified: 5 chambers per 512x512 (one per ~229 blocks), 32-56 across and 20-40 tall, 5/5 reachable by flood fill from open sky, 38x51x36 of open space measured in the running game. Lava above -54 rebuilt as placed pools (a few seeded sites per chunk flooding ≤8 floor cells below y=-12, plus rare wall springs) after the Phase 10 mask flooded whole cave floors: 464 → 27 cells per 100x100 columns. Underground water springs and puddles, waterfalls down cavern walls, gravel/clay banks beside them (clay's tile generated at boot, like the item art; the frame-with-eye tile moved to 69 since the new atlas overwrote 58). Ore distribution re-measured PER SOLID BLOCK inside each SPEC band — coal 3.49 / iron 3.15 / redstone 1.79 / gold 1.14 / diamond 0.67 per 1000 — and diamond is 1 per 572 at y-59..-50, about 6 exposed in 10 minutes of strip mining even at deepslate's doubled hardness. The three reported bugs: footsteps rebuilt as pure noise with halved decays and no sprint volume boost (the 150→90 Hz sine glide under every step WAS the "strange, unnatural" sprint noise), a `lowpass` on `tone()` taming every sawtooth/square voice, a dedicated landing sound; `audio.setPaused()` suspending the whole AudioContext on pause (verified running→suspended→running, sounds refused while paused); the potion indicator doubled to 48px with a 20px countdown. Two ARCHITECTURE cuts, one of them the long-mandated `world/fluid_families.js` out of blocks.js (901 now — under the cap for the first time since Phase 21). 69-module import smoke + 33 registry/crafting/fluid checks + the generation survey + a Chromium end-to-end run, zero console errors. | Rivers (the last unbuilt SPEC feature); `entities/dragon.js` (878) is now the only file over the cap, its rig cut still mandated; `world/caves.js` at 786 has no room left (ore/vein passes are its next cut); framerate UNMEASURED this phase (no GPU in the sandbox — generation cost was measured directly and is unchanged); the atlas's four new plant tiles (65-68) are unused, no ground plants were added |
| 24 | **Polish: terrain, sky and ground vegetation.** RIVERS (the last unbuilt SPEC feature): zero-contours of a low-frequency field press the heightmap below sea level (parabolic bed, eased banks, width varied along the run) so every channel is continuous and joins open water by construction — verified on a 768x768 surface map rendered from the real generator. Surface rules rewritten: beach sand only within reach of actual water, underwater floors sandy-then-dirt with gravel patches (riverbeds and beaches both), mountain bare stone only above a noise-jittered stone line or on ≥3-block cliff faces (measured 57% grass / 26% stone on mountain surfaces), domain-warped biome sampling (±34 blocks) + a wider dither band for irregular edges, tree density/height FIELDS for glades, thickets and groves, and occasional closed-basin surface lava pools in mountains/deserts. SKY: the vanilla blocky cloud deck at y=192 (one merged mesh, hashed blob pattern, period re-anchoring, steady -x drift, sRGB-correct day/night light), the sun rebuilt as a square core in a soft additive glow, the moon given the eight phases from generated textures (the cycle counts days now; sleeping advances the phase), a starfield wheeling on the sun's orbit fading through dusk/dawn on its own keyframe channel, and a keyframed skylight TINT (white noon / warm dawn-dusk / cool night) so terrain light agrees with the sky; fog stays horizon-matched. GROUND VEGETATION (atlas 65-68, finally used): short grass, dandelions, poppies, dead bushes as CROSS-PLANE blocks — a new mesher path (two DoubleSide X-quads, cutout pass, width-true diagonals, per-position nudge), no collision, no light attenuation, never culled; grass in per-biome noise patches, flowers rarer and clustered by colour, bushes on desert sand; instant break (seeds 1/8 from grass only), popped when their soil goes, placeable on grass/dirt, replaceable by blocks and buckets, flat sprite items. The TWO reported bugs: shallow lava was REAL — Phase 23 measured generated cells but the settle scan grew every open-rimmed pool into an apron; pools are now recessed erosion-verified basins (148 contained cells + 8 springs per 256x256, ZERO leak adjacencies). Deepslate was measured correct everywhere including the live browser game (9188/9188 deepslate-family cells at spawn depth; 100.00% purity below y=-9 across three seeds) — the report matches a stale cached build, with a console check recorded in Known broken. Splits: world/ores.js (caves.js's mandated vein cut, byte-identical streams), world/terrain_noise.js, world/plants.js, render/sky_fx.js. Generation 4.5 ms/chunk, meshing 13.9 vs 13.7 baseline, boots in Chromium with zero console errors, screenshot-verified through the full day cycle. | emitters.js (829) and blocks.js (915) over the cap with cuts mandated (small-box emitters; the lookups tail); dragon.js rig cut still outstanding; framerate unmeasured again (no GPU — generation/meshing measured directly instead); flowing water stops at plant cells instead of washing them away; the crack overlay and target outline are full-cube on plants (torch precedent); clouds are flat quads, not the fancy 4-thick boxes |
| 25 | **THE FINAL PHASE — survival and creative modes; the game is complete.** A START SCREEN on load offers Survival or Creative and holds the world frozen until one is chosen; Esc brings up a PAUSE MENU naming the current mode with a button to switch to the other; the mode shows as a small badge in the HUD corner. Switching is live and lossless because `player/gamemode.js` is a module singleton (the third, beside `particles` and `audio`) whose `set()` flips ONE flag: no reload, no regeneration, no teleport, inventory identical across the switch in both directions (verified by serialising it). Every creative rule is a single gate in the system that already owns it — `stats.damage` (invulnerable), `stats.gainExhaustion` (no hunger), `miningPlan` (instant break, no drops, unbreakables still unbreakable), `inventory.consume*`/`damage*` (infinite stacks, no tool wear), `mobs.playerTargetable` + the same in `dragon.js` (hostiles ignore you), `hud.updateHud` (no bars), `screens.js` (E routes elsewhere). CREATIVE FLIGHT (`body._stepFlight`): double-tap Space toggles, Space up, Shift down, sprint doubles it, 10.9 b/s measured against walking's 4.3, landing ends it, no fall damage, and the move still goes through the same swept collision as walking (`CREATIVE.FLY_COLLIDES`). CREATIVE INVENTORY (`ui/creative.js`): 188 entries over seven tabs with a search that spans all of them, click for a full stack / right-click for one / drag into a slot / drop outside to destroy, infinite by construction (every gesture builds a new stack, nothing is ever removed) — verified 0 blank icons and 0 craftable names missing. The TEST CHEST and its config flag are GONE; survival starts empty in an unmodified world. The five reported bugs: render distance 8 -> 12 chunks with fog to match and the geometry/memory numbers written into config (441 meshed / 973 draws / 2.03M tris / ~320 MB at r=12); biomes rebalanced to plains 40 / forest 23 / desert 19 / mountains 18 with moisture given its own domain warp (and the forest-hugs-coast claim measured to be absent from the generator, 26.0% vs 22.6%, and 26.2% vs 26.1% before any change); a new seed 2163 whose spawn area is 29/25/22/24 across the four biomes; the mountain stone line moved 108 -> 128 with STEEP_DROP 3 -> 4, taking mountains from 60% grass to 91%; great caverns raised in RATE (region 224 -> 128, chance 0.72 -> 0.88, 3 connectors) until 5.4% of all open cave air is big-room and 67% of random cave cells are within 60 blocks of walking of one, 6/6 reachable from open sky. THE FINAL PASS: a survival run from a fresh world to the victory screen driven through the game's own systems in Chromium, 16/16 green, plus a 30/30 mode harness, zero game console errors. Three new files, nothing over the size cap that was not already. | Nothing. The project is finished. The three standing ARCHITECTURE size cuts (`entities/dragon.js` rig, `world/emitters.js` small-box emitters, `world/blocks.js` lookups tail) are the only debt, and only bind if someone grows those files again. |
| 26 | **Polish: the visual and world pass; the game remains complete.** WORLD: plains made the clear majority biome (55.7% of land, measured over 2000x2000, vs forest 17.8 / desert 10.8 / mountains 15.6); the plains spawn GUARANTEED by a generator-side scan (`world/spawn_scan.js` — nearest large open plains disc wins, best-seen fallback, pure per seed; 12 seeds measured at 94-100% plains, 0% water) instead of seed luck; the stronghold moved to ~400 blocks from the SCANNED spawn (340-460 config, 348 measured, 12 frames + 3091 bricks censused at the anchored centre, eye target identical). RENDER: r=30 kept but tiered — beyond 14 chunks the mesher skips cross plants, culls leaf interiors and drops faces fronting sky-0 air (the enclosed cave network), cutting the ring 14.25M -> 6.87M tris and 1168 -> 563 MB (-52%), under the old r=20 full-detail cost; frustum culling fed by build-time bounding spheres. VISUAL (config VISUAL, all of it): a linear half-float post pipeline (`render/post_fx.js`) with depth-masked god rays at low sun, soft-thresholded warm/violet-detector bloom on lava/glowstone/torches/portals, and gentle grading (richer greens, warm sun, cool shadows); the water surface rippled, fresnel-reflective and sun-glinted (`render/water_fx.js`, render-only, still pass only); AO softened with a warm bounce + cool lean on shaded faces; dust motes in underground light shafts; and the GOLDEN HOUR (reference-image request): purple-to-gold sky keyframes at both day edges, a 3.4x soft sun halo, and a HAZE keyframe channel drowning distant terrain in warm atmosphere while midday keeps its clarity. BUG: clouds occlude the sun, moon and stars per pixel now (deck writes depth, celestials pinned to the far plane — a depth test alone fails below ~9° of sun elevation, where the deck is farther than the 820-block sun quad). A 20-agent adversarial review confirmed 15 findings, all fixed — including the unanchored stronghold early-out that would have kept the structure from ever generating, and the LOD gate erasing distant lava falls. Splits: `world/surface_rules.js` (terrain.js back under the cap, byte-identical A/B). Boots in Chromium with zero game console errors; screenshot-verified (noon, god rays, golden hour x3, cloud-clipped sun, night bloom, shaft dust, exaggerated-water proof). | Framerate unmeasured again (software GL sandbox — geometry measured in node instead); the swiftshader ring stall unchanged; the three standing size-cap debts (dragon rig, emitters small-boxes, blocks lookups) untouched. |
| 27 | **Render distance 40, smooth streaming, chat + /tp.** The view ring grew 30 -> 40 chunks (640 blocks) at -59% of full-detail cost: the LOD tiers hold the ring to 10.22M tris / 838 MB (measured; full detail would be 25.09M / 2058 MB), far chunks stopped storing their 98KB light arrays (~420 MB saved; every consumer lives inside the detail radius and handles null), and fog moved out to 460/680. Movement hitches attacked at the source (`world/world.js`): a completed no-work pass PARKS the streamer (an idle frame costs 0.0004 ms, measured, vs walking 6889 Map lookups), passes resume at the first incomplete offset instead of re-scanning the finished near region, LOD tier remeshes trickle at RETIER_PER_PASS 2 with hysteresis 3 so border crossings stop queueing arcs of remeshes, and the per-frame budget went 8 -> 6 ms. Node-verified: settle -> idle, edit -> wake -> re-settle in single-digit frames, a 10-chunk move re-tiers correctly. CHAT (`ui/chat.js`, the sign-editor pattern — game keeps running, pointer releases, relocks on close) opens on T or '/', with history recall; `systems/commands.js` (split out of main.js at birth — the wiring took main to 875, back to 802) ships `/tp <x> <z>` with a SAFE landing (surface; floated over deep water; a scanned interior spot under the Nether ceiling; refusal over the End void) and `/tp <x> <y> <z>` exact. Browser-verified end to end including a 4.7km teleport into ungenerated terrain, zero game console errors. FOLLOW-UP (same session, by request — "make clouds look realistic, not blocks. moon light should also good"): the blocky slab deck REPLACED with shader cumulus — a camera-following plane whose fragment grows soft puffs from 5-octave fbm (weather-gate grouping that modulates rather than empties, interior-steepened cores with feathered edges, sun-probed self-shading, silver linings, a faint higher cirrus veil; world-anchored pattern, wrapped drift; all knobs in config CLOUDS), drawn twice to keep the Phase 26 occlusion contract (depth-only core pass at -1.95, soft colour at -1.1); tuning swept in a node port of the shader math (COVER 0.66 = 40% visible / 25% solid / 0 empty vantages in 24). MOONLIGHT: a cool rim-windowed halo quad behind the moon, a moonlit dome wash via the sky shader's new glowBand uniform, night palette brightened to silver-blue (SKY_DARKEN 11 -> 10, NIGHT_SKY_TINT 0xa9bef2), and a moon glint lane on water (MOON_GLINT_LEVEL; main.js flips the water light to the moon after dark). SECOND FOLLOW-UP ("Cloud more realistic, plus make moon round"): cloud shapes domain-warped + edge-eroded (the curdled cauliflower rim; COVER retuned 0.66 -> 0.68 by node sweep), lighting gone PSEUDO-VOLUME — density-as-height dome normals with rotated-grid two-octave relief bumps (the un-rotated first cut read as a quilted blanket) lit by a real N.L against the sun/moon, cirrus skipping the taps via FLAT_SHEET; the look iterated in an offline node render of the exact shader math instead of browser cycles. The moon rebuilt ROUND: 128px AA disc, seeded maria + craters shared by all eight phases, soft elliptical terminator, limb darkening, earthshine dark side, linear-filtered; MOON_SIZE 95 -> 104 keeps the apparent diameter. Screenshot-verified at 1080p (day field, straight-up puff, sunset with the sun half-sunk behind a grey bank, round moon in halo, moonlit ground), zero game console errors. FINAL RETUNE ("render 25 chunks... wherever I'm standing, 25 chunk radius"): VIEW.DISTANCE_CHUNKS 40 -> 25 with fog rescaled to 288/425 — the 5025-chunk r=40 ring took minutes to fill after a move, the 1961-chunk r=25 ring fills ~2.5x faster so the promised radius actually holds; measured 5.58M tris / 458 MB with the LOD tiers (half the r=40 cost), and node-verified with the real World that the ring settles 1961/1961 at spawn, re-fills 1961/1961 after a 12-chunk move, parks idle and wakes on edits. THIRD CLOUD PASS (the reference image — fat distinct cotton cumulus): solid-core tuning (SOFTNESS 0.16, OPACITY 0.97, WARP 0.55, mild gate — every sampled vantage >= 38% cloud), contrast restored (DOME_GAIN 1.3, grey-lavender SHADE), and the horizon band opened up (FADE 780/1400, VIEW.FAR 1000 -> 1700 — the far plane was clipping the cloud plane); then, by request ("remove the layer of bad cloud"), the deck was cut to ONE visible layer — the field shrunken to its cores (dens^2, full dome shading), the raw-field base colour pass and the cirrus veil GONE, the depth-only occlusion pass kept on the raw field at CORE_ALPHA 0.60, and config CIRRUS/TOP_LIFT/CORE_SHADE removed with their consumers; then two dusk artifacts from live play fixed (CORE_ALPHA -> 0.90 so the depth cut can never bite a hard edge from the moon disc; the double-steepened density curve flattened to kill terraced edge banding); and finally, by request ("LIKE REAL LIFE... LIKE SHADERS"), the colour pass became a true VOLUMETRIC RAYMARCH — a THICKNESS-48 slab marched in STEPS jittered samples, density-as-height columns with rounded crowns and shaded flat bases, real sides visible from afar — with DRIFTING CLOUD SHADOWS on the terrain (a cheap 3-octave copy of the same field in the chunk shader, projected along the sun, dimming sky light only, synced to the sky's drift; VISUAL.CLOUD_SHADOW) and drift SPEED 1.3. The volumetric look was designed in an offline perspective raymarch of the exact shader math rather than browser cycles. | Framerate still unmeasurable in the sandbox (geometry measured in node instead); main.js at 812 sits just over the ~800 tilde — the beds block is its next cut; the swiftshader ring stall unchanged. |
