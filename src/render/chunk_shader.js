// render/chunk_shader.js — the chunk MATERIAL patch and the uniforms the
// day/night cycle drives it with. Split out of render/lighting.js per the
// ARCHITECTURE size cap (the long-mandated cut, made when the cycle grew a
// twilight pass) — moved VERBATIM; lighting.js keeps the light propagation
// and the day/night CYCLE that writes these uniforms every frame.
//
// What lives here: CHUNK_LIGHT_UNIFORMS (skylight darken/tint, torch tint,
// the held-torch point light, cloud shadows, wind, directional sun faces,
// mist), heldLightBrightness (the Phase 14 held-light falloff), and
// patchChunkMaterial — the onBeforeCompile patch that turns a stock
// MeshBasicMaterial into the unlit Minecraft-style chunk material: baked
// light x time of day, radial fog, block jitter, waving foliage, warm
// bounce / cool shade, cloud shade, sun-facing faces.

import * as THREE from 'three';
import {
  SKY, LIGHTING, VISUAL, CLOUDS, OVERWORLD,
} from '../config.js';

// ---------------------------------------------------------------------------
// Chunk material lighting (shader patch)
// ---------------------------------------------------------------------------

// Uniforms shared by every chunk material; the day/night cycle writes them
// once per frame and the whole world relights without any remeshing.
// uHeldLight* is the Phase 14 held-torch dynamic light: a point light that
// follows the player, applied per fragment at render time — the flood fill
// never sees it, so no chunk ever remeshes because the player moved.
export const CHUNK_LIGHT_UNIFORMS = {
  uSkyDarken: { value: 0 },                                   // 0 day .. 11 night
  uSkyTint: { value: new THREE.Color(1, 1, 1) },              // white -> moonlight
  uTorchTint: { value: new THREE.Color(LIGHTING.TORCH_TINT) },
  uLightFalloff: { value: LIGHTING.LIGHT_FALLOFF },
  uHeldLightPos: { value: new THREE.Vector3(0, -1e6, 0) },    // player eye
  uHeldLightLevel: { value: 0 },                              // 0 = off, torch 14
  uHeldLightTint: { value: new THREE.Color(LIGHTING.HELD_LIGHT_TINT) },
  // Phase 16: a dimension-wide floor on the effective SKY level (the
  // Nether's "constant dim red ambient" — under its bedrock ceiling the
  // baked sky light is zero everywhere, and without a floor enclosed
  // netherrack would render pitch black). 0 in the overworld.
  uMinSkyLevel: { value: 0 },
  // Phase 26 — the shadow feel (config VISUAL.SHADOW): daylight shadows
  // lean slightly cool and carry a faint warm ground bounce. Constants in
  // uniforms so the whole look stays one config edit away from neutral.
  uShadowCool: { value: new THREE.Color(VISUAL.SHADOW.COOL_COLOR) },
  uShadowCoolStrength: { value: VISUAL.SHADOW.COOL_STRENGTH },
  uBounceColor: { value: new THREE.Color(VISUAL.SHADOW.BOUNCE_COLOR) },
  uBounceStrength: { value: VISUAL.SHADOW.BOUNCE_STRENGTH },
  // Cloud SHADOWS drifting over the terrain (the "lively, like shaders"
  // pass): the chunk shader samples a cheap copy of the sky's cloud field
  // at the fragment's column projected along the sun, and dims the SKY
  // contribution only — torchlight and caves are untouched. The cycle
  // writes drift/slant/strength every frame; strength is 0 at night and
  // under the fixed-sky dimensions.
  uCloudShadow: { value: 0 },
  uCloudDrift: { value: new THREE.Vector2(0, 0) },
  uCloudSlant: { value: new THREE.Vector2(0, 0) },
  // Wind ("lively leaves"): the vertex stage displaces wave-weighted
  // vertices (leaves, cross-plant tops — a per-vertex attribute baked by
  // the mesher) through a world-space wind field. Time accumulates in the
  // cycle; amplitude is one config knob.
  uWindTime: { value: 0 },
  uWindAmp: { value: VISUAL.WIND.AMPLITUDE },
  // Directional sun/moon modelling (the shader look, config
  // VISUAL.SUNLIGHT): faces toward the light brighten, faces away fall
  // into shade, swinging with the sun through the day and handing over to
  // a fainter moon at night. The cycle writes both every frame; strength
  // is 0 under fixed dimension skies.
  uSunFace: { value: 0 },
  uSunFaceDir: { value: new THREE.Vector3(0, 1, 0) },
  // Dawn valley mist (final pass, config VISUAL.MIST): low ground
  // multiplies its radial fog depth up by (1 + uMist * heightFactor), so
  // valleys drown in horizon-coloured haze while hilltops stand clear.
  // The cycle raises it through a window around sunrise (fainter at dusk)
  // and holds it at 0 the rest of the day and in the fixed-sky dimensions.
  uMist: { value: 0 },
};

// The held light's brightness at `dist` blocks from the player — the same
// level-per-block falloff the shader computes, for JS consumers (the mob
// tint in entities/mobs.js). Returns 0..1.
export function heldLightBrightness(level, dist) {
  if (level <= 0) return 0;
  const l = Math.max(0, Math.min(15, level - dist));
  return LIGHTING.LIGHT_FALLOFF ** (15 - l);
}

// Turns a MeshBasicMaterial into a Minecraft-style lit chunk material. The
// mesher supplies a per-vertex `light` attribute: vec2(sky, block) light
// levels normalised to 0..1. Final brightness is
//   max(falloff^(15 - (sky*15 - skyDarken)) * skyTint,
//       falloff^(15 -  block*15)            * torchTint)
// multiplied into the vertex colour (which already carries per-face
// brightness x AO). Sky light dims with time of day; block light doesn't —
// torches hold their brightness through the night, exactly like the game.
export function patchChunkMaterial(material, { jitter = true } = {}) {
  material.toneMapped = false; // see the sky-dome comment: keeps fog exact
  // Per-block brightness jitter (config VISUAL.BLOCK_JITTER): every face is
  // scaled by a hash of the block coordinate BEHIND it, so a large stone or
  // dirt slope stops reading as one 16px tile stamped in a grid. The cell
  // comes from the derivative face normal (the meshes carry none); the mod
  // keeps the hash's sine argument small far from the origin, where the
  // classic fract(sin(dot)) hash otherwise dissolves into float noise.
  // Water opts out — a lake is ONE surface and per-block patches would
  // shatter its reflection.
  const jitterGlsl = !jitter ? '' : /* glsl */ `
          {
            vec3 jn = cross(dFdx(vHeldWorldPos), dFdy(vHeldWorldPos));
            float jl = length(jn);
            if (jl > 1e-7) {
              jn /= jl;
              if (!gl_FrontFacing) jn = -jn;
              vec3 jc = mod(floor(vHeldWorldPos - jn * 0.5), 289.0);
              float jh = fract(sin(dot(jc, vec3(127.1, 311.7, 74.7))) * 43758.5453);
              diffuseColor.rgb *= 1.0
                + ${VISUAL.BLOCK_JITTER.toFixed(4)} * (jh * 2.0 - 1.0);
            }
          }`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, CHUNK_LIGHT_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        'attribute vec2 light;\n'
        + 'attribute float wave;\n'
        + 'varying vec2 vLight;\n'
        + 'varying vec3 vHeldWorldPos;\n'
        + 'uniform float uWindTime;\n'
        + 'uniform float uWindAmp;\n'
        + 'uniform float uMist;\n'
        + '#include <common>')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        vLight = light;
        vHeldWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        // WIND (the "lively leaves" pass): wave-weighted vertices (leaves,
        // cross-plant tops) sway through a world-space field — several
        // incommensurate sines plus a slow travelling gust, so a canopy
        // ripples rather than rocking in one rhythm. World-space phase
        // keeps neighbouring blocks and chunks moving as one body.
        if (wave > 0.003) {
          vec3 wp = vHeldWorldPos;
          float t = uWindTime;
          float sway = sin(wp.x * 0.31 + wp.y * 0.13 + t * 1.9)
                     * cos(wp.z * 0.27 + t * 1.4) * 0.6
                     + sin((wp.x + wp.z) * 0.09 + t * 0.7) * 0.4;
          float gust = 0.66 + 0.34 * sin(wp.x * 0.021 + wp.z * 0.017 + t * 0.31);
          float amp = wave * uWindAmp * gust;
          transformed.x += sway * amp;
          transformed.z += cos(wp.x * 0.23 + wp.y * 0.11 + t * 1.1) * sway * amp * 0.8;
          transformed.y += sin(wp.z * 0.29 + wp.x * 0.07 + t * 1.6) * amp * 0.3;
          vHeldWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        }`)
      // RADIAL FOG ("make the far parts smooth, like a real render").
      // Stock three.js fogs by view-space Z (vFogDepth = -mvPosition.z),
      // which is a PLANE across the view: at FOV 70 a chunk in the corner
      // of a widescreen frame carries ~37% less fog depth than the same
      // chunk straight ahead, so turning the camera visibly un-fogged the
      // periphery and the world edge popped in and out of the haze. True
      // distance makes the fade a circle around the player — the exact
      // shape of the streaming ring it exists to hide. SKY.FOG_FAR sits
      // just inside the ring radius, so the outermost chunks dissolve
      // fully into sky in EVERY direction.
      .replace('#include <fog_vertex>', /* glsl */ `
        #ifdef USE_FOG
          vFogDepth = length(mvPosition.xyz);
          // Dawn valley mist (config VISUAL.MIST): below the mist top the
          // fog depth multiplies up, so low ground fades into the horizon
          // colour far sooner than its true distance — haze lying in the
          // valleys. uMist is 0 outside the dawn/dusk windows, making this
          // a single multiply-by-one the rest of the day.
          vFogDepth *= 1.0 + uMist * (1.0 - smoothstep(
            ${OVERWORLD.SEA_LEVEL.toFixed(1)},
            ${(OVERWORLD.SEA_LEVEL + VISUAL.MIST.TOP_ABOVE_SEA).toFixed(1)},
            vHeldWorldPos.y));
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        'varying vec2 vLight;\n'
        + 'varying vec3 vHeldWorldPos;\n'
        + 'uniform float uSkyDarken;\n'
        + 'uniform vec3 uSkyTint;\n'
        + 'uniform vec3 uTorchTint;\n'
        + 'uniform float uLightFalloff;\n'
        + 'uniform vec3 uHeldLightPos;\n'
        + 'uniform float uHeldLightLevel;\n'
        + 'uniform vec3 uHeldLightTint;\n'
        + 'uniform float uMinSkyLevel;\n'
        + 'uniform vec3 uShadowCool;\n'
        + 'uniform float uShadowCoolStrength;\n'
        + 'uniform vec3 uBounceColor;\n'
        + 'uniform float uBounceStrength;\n'
        + 'uniform float uCloudShadow;\n'
        + 'uniform vec2 uCloudDrift;\n'
        + 'uniform vec2 uCloudSlant;\n'
        + 'uniform float uSunFace;\n'
        + 'uniform vec3 uSunFaceDir;\n'
        // A cheap 3-octave copy of the sky's cloud field (same hash, same
        // seed, same gate/threshold layout — no warp or erosion; shadows
        // are blurry) so cloud shadows land under the clouds that cast
        // them and DRIFT with them. Constants baked from config at patch
        // time; ~5 noise evaluations per terrain fragment.
        + `float csHash(vec2 c) {
          c = mod(c, 512.0);
          return fract(sin(dot(c, vec2(127.1, 311.7)) + ${CLOUDS.SEED.toFixed(4)}) * 43758.5453);
        }
        float csNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u2 = f * f * (3.0 - 2.0 * f);
          return mix(mix(csHash(i), csHash(i + vec2(1.0, 0.0)), u2.x),
                     mix(csHash(i + vec2(0.0, 1.0)), csHash(i + vec2(1.0, 1.0)), u2.x), u2.y);
        }
        float csCloud(vec2 wxz) {
          vec2 np = (wxz + uCloudSlant) * ${CLOUDS.SCALE.toFixed(8)} + uCloudDrift;
          float gate = smoothstep(0.32, 0.70,
            csNoise(np * ${CLOUDS.GATE_SCALE.toFixed(5)}) * 0.65
            + csNoise(np * ${(CLOUDS.GATE_SCALE * 2.63).toFixed(5)} + 41.3) * 0.35);
          float t = 1.0 - ${CLOUDS.COVER.toFixed(4)} * (0.62 + 0.38 * gate);
          float f2 = (csNoise(np) * 0.5 + csNoise(np * 2.03 + 17.7) * 0.25
            + csNoise(np * 4.1209 + 53.6) * 0.125) * 1.14;
          return smoothstep(t, t + ${VISUAL.CLOUD_SHADOW.SOFTNESS.toFixed(4)}, f2);
        }
        `
        + '#include <common>')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        {
          // The baked light attribute, CLAMPED before anything raises a
          // power to it. vLight is a varying: on a triangle seen nearly
          // edge-on at long range the perspective divide is numerically
          // brutal and the interpolated value can land outside [0, 1].
          // Feed that to pow(0.8, 15 - 15 * L) and a value only slightly
          // over 1 is harmless, but a wild one makes the exponent hugely
          // NEGATIVE and the power overflows to +inf. That inf reached
          // the fragment colour, the bloom bright pass carried it, and
          // the separable blur — 5 taps reaching +-7 texels at quarter
          // resolution — smeared one bad pixel into an exact 60x64 BLACK
          // RECTANGLE on distant mountainsides (clamp() maps a non-finite
          // value to 0). Clamping the light here costs nothing and closes
          // the whole class: every term below is now finite by
          // construction.
          float light01 = clamp(vLight.x, 0.0, 1.0);
          float skyLevel = clamp(max(light01 * 15.0 - uSkyDarken, uMinSkyLevel), 0.0, 15.0);
          float blockLevel = clamp(vLight.y, 0.0, 1.0) * 15.0;
          vec3 skyLum = pow(uLightFalloff, 15.0 - skyLevel) * uSkyTint;
          // How open to the sky this column is — scales every outdoor
          // effect below so interiors and caves feel nothing.
          float openCol = pow(uLightFalloff, 15.0 - light01 * 15.0);
          // Drifting cloud shadows (see csCloud above): dim the sky's
          // contribution under cloud.
          if (uCloudShadow > 0.001) {
            skyLum *= 1.0 - uCloudShadow * openCol * csCloud(vHeldWorldPos.xz);
          }
          // DIRECTIONAL sun/moon modelling (the shader look): the flat
          // face normal comes from screen-space derivatives — the meshes
          // carry no normals — and faces toward the light brighten while
          // faces away fall into shade, swinging as the sun crosses the
          // sky. Wind-swayed leaves get gently varying normals for free,
          // so canopies shimmer as they move.
          if (uSunFace > 0.001) {
            // The cross product DEGENERATES on a face seen edge-on: both
            // screen derivatives then run along the same world line, so
            // the cross collapses toward zero and normalize() returns
            // inf/NaN — which blew the fragment out and bloom smeared it
            // into a lattice of glowing dots (the "yellow circle" seen
            // while sprint-jumping past tree trunks). Test the length
            // BEFORE dividing, and clamp the result: no valid normal
            // means no directional term for that pixel, never a blowout.
            vec3 cn = cross(dFdx(vHeldWorldPos), dFdy(vHeldWorldPos));
            float cl = length(cn);
            if (cl > 1e-7) {
              vec3 fn = cn / cl;
              if (!gl_FrontFacing) fn = -fn;
              float facing = clamp(dot(fn, uSunFaceDir), -1.0, 1.0);
              // ENERGY-NEUTRAL: the multiplier peaks at exactly 1.0 on a
              // fully sun-facing surface and only DARKENS from there, so
              // the modelling can never push a surface BRIGHTER than the
              // baked sky light. That matters beyond taste: brightening
              // warm surfaces (wood, dirt) nudged them over the bloom
              // pass's emissive detector, which then smeared them into a
              // lattice of glowing dots — the "yellow circle" flashing
              // past tree trunks while sprint-jumping. Contrast comes
              // from the shaded side, which is how the effect reads
              // anyway.
              float shade = facing > 0.0 ? facing : facing * 0.7;
              skyLum *= (1.0 + uSunFace * openCol * shade)
                      / (1.0 + uSunFace * openCol);
            }
          }
          vec3 blockLum = pow(uLightFalloff, 15.0 - blockLevel) * uTorchTint;
          // Held-torch dynamic light (Phase 14): one level lost per block of
          // euclidean distance from the player — the same falloff curve as
          // baked light, smooth instead of cell-quantised, and applied here
          // at render time so it costs zero remeshing as the player moves.
          float heldLevel = clamp(uHeldLightLevel - distance(vHeldWorldPos, uHeldLightPos), 0.0, 15.0);
          vec3 heldLum = pow(uLightFalloff, 15.0 - heldLevel) * uHeldLightTint;
          vec3 lum = max(max(skyLum, blockLum), heldLum);
          // Phase 26 — shadow feel, daylight only (config VISUAL.SHADOW).
          // "Shade" is the baked per-face brightness x AO in the vertex
          // colour: 0 on a full-lit top face, rising on sides, bottoms and
          // occluded corners. Those faces take a slight COOL lean (open-sky
          // shadow is blue-lit) and a small WARM additive bounce (sunlit
          // ground scatters light back up), both scaled by how much day is
          // overhead and by the column's sky access, so caves, the night
          // and the fixed-sky dimensions are untouched.
          #ifdef USE_COLOR
            // The vertex colour carries per-face shade x AO, and on grass,
            // plants and leaves it ALSO carries the column's foliage tint
            // multiplied in. Every tint is normalised to a brightest
            // channel of exactly 1.0 (config TERRAIN.FOLIAGE_TINT), so the
            // largest channel is still the untinted shade — max() recovers
            // it exactly and an untinted white vertex is unchanged.
            float shade = clamp(1.0 - max(vColor.r, max(vColor.g, vColor.b)), 0.0, 1.0);
            float dayF = clamp(1.0 - uSkyDarken / 11.0, 0.0, 1.0) *
              step(uMinSkyLevel, 0.5); // no bounce under a fixed dimension sky
            float openSky = openCol;
            lum = mix(lum, lum * uShadowCool, uShadowCoolStrength * shade * dayF);
            lum += uBounceColor * (uBounceStrength * shade * dayF * openSky);
          #endif
          diffuseColor.rgb *= lum;${jitterGlsl}
        }`);
  };
}

// ---------------------------------------------------------------------------
// Light propagation (flood fill, 15 levels)
