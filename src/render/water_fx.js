// render/water_fx.js — Phase 26: the water surface. A patch layered ON TOP
// of the normal lit chunk material (render/lighting.js patchChunkMaterial —
// water keeps its baked light, texture and translucency exactly as before):
//
//   ripple   a gentle world-space wave displaces SURFACE vertices only
//            (identified by their authored height — RENDER.WATER_SURFACE_SINK
//            below the cell top). World-space and continuous, so adjacent
//            chunks displace shared vertices identically and the surface
//            stays watertight. Render-only: physics, raycasts and item
//            floating never see it.
//   normal   the same wave's analytic gradient perturbs the per-fragment
//            normal, so the reflection and glint shimmer with the ripple.
//   fresnel  a view-angle reflection mixes in what the water would mirror:
//            SKY COLOUR where the surface is open to the sky, easing toward
//            a dark terrain tone where the baked sky light says the water
//            sits under canopy or cliff — the brief's "suggestion of nearby
//            terrain" — plus a tight sun glint riding the ripple normals.
//
// All tunables in config.js VISUAL.WATER. The flowing-water pass keeps the
// plain patched material (it is animated by its scrolling texture and its
// cells sit at seven different heights — rippling those would tear seams).

import * as THREE from 'three';
import { VISUAL, RENDER, SKY, LIGHTING } from '../config.js';
import { patchChunkMaterial } from './lighting.js';

// Written once per frame by main.js (the CHUNK_LIGHT_UNIFORMS pattern):
// time, the current sky palette (fog colour IS the horizon by the day/night
// cycle's own contract), the sun's direction and how much sun is up.
export const WATER_UNIFORMS = {
  uWTime: { value: 0 },
  uWHorizon: { value: new THREE.Color(SKY.FOG_COLOR) },
  uWZenith: { value: new THREE.Color(SKY.ZENITH_COLOR) },
  uWSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uWSunLevel: { value: 1 },
};

// The wave: two diagonal sine octaves. GLSL and any JS consumer must agree,
// so the constants are injected as defines from config.
const W = VISUAL.WATER;

const WAVE_GLSL = /* glsl */ `
  #define WQ_S1 ${W.RIPPLE_SCALE.toFixed(4)}
  #define WQ_S2 ${W.RIPPLE_SCALE_2.toFixed(4)}
  #define WQ_T1 ${W.RIPPLE_SPEED.toFixed(4)}
  #define WQ_T2 ${W.RIPPLE_SPEED_2.toFixed(4)}
  float waterWave(vec2 p, float t) {
    return sin(p.x * WQ_S1 + t * WQ_T1) * sin(p.y * WQ_S1 * 0.83 - t * WQ_T1 * 0.9)
      + 0.5 * sin((p.x + p.y) * WQ_S2 - t * WQ_T2)
        * sin((p.x - p.y) * WQ_S2 * 0.71 + t * WQ_T2 * 0.77);
  }
  vec2 waterWaveGrad(vec2 p, float t) {
    float a1 = p.x * WQ_S1 + t * WQ_T1;
    float b1 = p.y * WQ_S1 * 0.83 - t * WQ_T1 * 0.9;
    float a2 = (p.x + p.y) * WQ_S2 - t * WQ_T2;
    float b2 = (p.x - p.y) * WQ_S2 * 0.71 + t * WQ_T2 * 0.77;
    vec2 g;
    g.x = WQ_S1 * cos(a1) * sin(b1)
      + 0.5 * (WQ_S2 * cos(a2) * sin(b2) + sin(a2) * WQ_S2 * 0.71 * cos(b2));
    g.y = WQ_S1 * 0.83 * sin(a1) * cos(b1)
      + 0.5 * (WQ_S2 * cos(a2) * sin(b2) - sin(a2) * WQ_S2 * 0.71 * cos(b2));
    return g;
  }
`;

// Layers the water surface behaviour onto an already-standard chunk
// material. Call INSTEAD of patchChunkMaterial for the still-water pass.
export function patchWaterMaterial(material) {
  patchChunkMaterial(material);
  const chunkPatch = material.onBeforeCompile;
  const sink = RENDER.WATER_SURFACE_SINK;
  material.onBeforeCompile = (shader) => {
    chunkPatch(shader);
    Object.assign(shader.uniforms, WATER_UNIFORMS);

    // --- vertex: ripple the surface, remember surface-ness -----------------
    // A vertex is "the surface" when its authored height is the sunken top
    // (cell top - WATER_SURFACE_SINK => fract(y) == 1 - sink). Column tops
    // buried under more water sit at integer heights and stay put, so the
    // merged body of a lake never opens a seam.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        `varying float vWSurf;\nuniform float uWTime;\n${WAVE_GLSL}\n#include <common>`)
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n'
        + `vWSurf = step(abs(fract(transformed.y) - ${(1 - sink).toFixed(4)}), 0.01);\n`
        + 'vec3 wWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n'
        + `transformed.y += vWSurf * ${W.RIPPLE_AMPLITUDE.toFixed(4)}`
        + ' * waterWave(wWorld.xz, uWTime);');

    // --- fragment: fresnel reflection + sun glint on surface fragments -----
    // Anchored on alphamap_fragment: in the meshbasic chain that sits AFTER
    // color_fragment (where the chunk patch multiplies the baked light in)
    // and BEFORE outgoingLight is derived from diffuseColor — the last spot
    // where writing diffuseColor.rgb still reaches the screen.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        'varying float vWSurf;\n'
        + 'uniform float uWTime;\n'
        + 'uniform vec3 uWHorizon;\n'
        + 'uniform vec3 uWZenith;\n'
        + 'uniform vec3 uWSunDir;\n'
        + 'uniform float uWSunLevel;\n'
        + `${WAVE_GLSL}\n#include <common>`)
      .replace('#include <alphamap_fragment>', /* glsl */ `
        if (vWSurf > 0.5) {
          vec2 grad = waterWaveGrad(vHeldWorldPos.xz, uWTime)
            * ${(W.RIPPLE_AMPLITUDE * W.NORMAL_STRENGTH).toFixed(5)};
          vec3 wN = normalize(vec3(-grad.x, 1.0, -grad.y));
          vec3 wV = normalize(cameraPosition - vHeldWorldPos);
          float fres = ${W.BASE_REFLECT.toFixed(3)}
            + (1.0 - ${W.BASE_REFLECT.toFixed(3)})
              * pow(1.0 - clamp(dot(wN, wV), 0.0, 1.0), ${W.FRESNEL_POWER.toFixed(1)});
          vec3 wR = reflect(-wV, wN);
          // What the surface mirrors: the sky gradient where the column is
          // open to the sky, a dark terrain tone under canopy or cliffs
          // (vLight.x is the baked sky access) — and night darkens both.
          vec3 skyCol = mix(uWHorizon, uWZenith, clamp(wR.y, 0.0, 1.0));
          float open = smoothstep(${W.SHADE_SKY_LIGHT.toFixed(2)},
            ${W.OPEN_SKY_LIGHT.toFixed(2)}, vLight.x);
          vec3 shadeCol = vec3(${new THREE.Color(W.SHADE_COLOR).toArray()
            .map((v) => v.toFixed(4)).join(', ')});
          float nightDim = ${W.NIGHT_REFLECT_FLOOR.toFixed(3)}
            + ${(1 - W.NIGHT_REFLECT_FLOOR).toFixed(3)} * uWSunLevel;
          vec3 reflCol = mix(shadeCol * nightDim, skyCol, open);
          diffuseColor.rgb = mix(diffuseColor.rgb, reflCol,
            fres * ${W.REFLECTION.toFixed(3)});
          // The sun glint: a tight specular sparkle riding the ripple.
          float glint = pow(clamp(dot(wR, uWSunDir), 0.0, 1.0),
            ${W.GLINT_POWER.toFixed(1)});
          diffuseColor.rgb += vec3(${new THREE.Color(W.GLINT_COLOR).toArray()
            .map((v) => v.toFixed(4)).join(', ')})
            * (glint * ${W.GLINT_STRENGTH.toFixed(3)} * uWSunLevel * open);
          // Grazing water reads a touch more solid (the mirror look).
          diffuseColor.a = min(1.0,
            diffuseColor.a + fres * ${W.OPACITY_BOOST.toFixed(3)});
        }
        #include <alphamap_fragment>`);
  };
}

// Advances the shared water clock and takes the frame's sky state. Called
// once per frame from main.js (delta 0 while paused, so the ripple freezes
// with everything else); the horizon comes from the scene fog, which the
// day/night cycle keeps matched to the horizon every frame.
export function updateWaterUniforms(delta, { fogColor, zenithColor, sunDir, sunLevel }) {
  WATER_UNIFORMS.uWTime.value += delta;
  if (fogColor) WATER_UNIFORMS.uWHorizon.value.copy(fogColor);
  if (zenithColor) WATER_UNIFORMS.uWZenith.value.copy(zenithColor);
  if (sunDir) WATER_UNIFORMS.uWSunDir.value.copy(sunDir);
  if (sunLevel !== undefined) WATER_UNIFORMS.uWSunLevel.value = sunLevel;
}
