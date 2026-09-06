// render/post_fx.js — Phase 26: the post pipeline. The scene renders into a
// linear half-float target (depth attached), three small screen-space passes
// derive from it, and one composite draws to the canvas:
//
//   god rays   the sky's brightness around the sun's screen position,
//              radially blurred toward it — depth masks the source, so
//              terrain ridges and the depth-writing cloud deck carve real
//              shafts. Only when the sun is LOW (config elevation ramp);
//              noon casts none.
//   bloom      a soft-thresholded bright pass at quarter resolution,
//              gaussian-blurred and added back faintly. The threshold
//              follows the sun level (torches must halo at night without
//              daylight sand glowing), warm/violet emissive detectors pick
//              out lava/glowstone/torches and the portals, and sky pixels
//              are masked out entirely (the sun has its own glow).
//   grading    richer greens, warmer sunlight, cooler shadows — gentle.
//
// Colour management: three r160 renders into a RenderTarget with the shader
// output colour space forced to LINEAR and fog uniforms left in the working
// space (checked against the three source), so the whole pipeline runs
// linear and the fog-equals-horizon contract survives untouched; the
// composite applies the one linear->sRGB encode (plus a 1/255 dither, the
// sky dome's own banding trick) at the end. Tone mapping is disabled for
// render-target passes by three itself — renderer.js sets NoToneMapping so
// the hand overlay pass matches.
//
// Everything tunable lives in config.js VISUAL. With VISUAL.POST_ENABLED
// false main.js never constructs this and renders direct to canvas, exactly
// as Phase 25 did.

import * as THREE from 'three';
import { VISUAL } from '../config.js';

const LUMA = 'vec3(0.2126, 0.7152, 0.0722)';

// The depth value at/above which a fragment counts as SKY for the masks.
// Only two things are meant to qualify: the depth-cleared dome (1.0) and the
// far-plane-pinned celestials (sky_fx.js forceFarDepth writes z = w*0.999999
// => window depth 0.9999995). The 24-bit depth buffer steps at ~6e-8, so
// 0.999999 separates those cleanly from every scene-WRITTEN depth out to
// ~990 blocks — which matters: the review caught the first cut's 0.99995
// classifying everything past ~667 blocks as sky, exactly where a low sun's
// sight line crosses the y=192 cloud deck (~124/sin(elev) blocks out), so an
// overcast sunset still threw full shafts instead of the deck carving them.
const SKY_DEPTH = '0.999999';

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// God rays 1/2: the source mask — sky brightness in a window around the sun.
const RAY_MASK_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform vec2 uSunScreen;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    float depth = texture2D(tDepth, vUv).x;
    // Only the sky feeds the shafts; anything nearer occludes them —
    // terrain, entities, and the cloud deck (which writes depth).
    float sky = step(${SKY_DEPTH}, depth);
    vec3 c = texture2D(tScene, vUv).rgb;
    float lum = dot(c, ${LUMA});
    vec2 d = (vUv - uSunScreen) * vec2(uAspect, 1.0);
    float window_ = smoothstep(${VISUAL.GODRAYS.SUN_RADIUS.toFixed(3)}, 0.0, length(d));
    gl_FragColor = vec4(vec3(sky * lum * window_), 1.0);
  }
`;

// God rays 2/2: radial blur toward the sun (run PASSES times, compounding).
const RAY_BLUR_FRAG = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uSunScreen;
  varying vec2 vUv;
  void main() {
    vec2 delta = (uSunScreen - vUv)
      * (${VISUAL.GODRAYS.DENSITY.toFixed(3)} / ${VISUAL.GODRAYS.TAPS.toFixed(1)});
    vec2 uv = vUv;
    float sum = 0.0;
    float weight = 1.0;
    float total = 0.0;
    for (int i = 0; i < ${VISUAL.GODRAYS.TAPS}; i++) {
      sum += texture2D(tInput, uv).r * weight;
      total += weight;
      weight *= ${VISUAL.GODRAYS.DECAY.toFixed(3)};
      uv += delta;
    }
    gl_FragColor = vec4(vec3(sum / total), 1.0);
  }
`;

// Bloom 1/3: soft-thresholded bright pass with emissive detectors.
const BRIGHT_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    float depth = texture2D(tDepth, vUv).x;
    float sky = step(${SKY_DEPTH}, depth);
    // SANITISE before the blur. This pass is the choke point where ONE bad
    // pixel becomes a visible block: the separable gaussian below reaches
    // +-7 texels each way at quarter resolution, so a single NaN or inf
    // spreads into a 60x64 rectangle of the final image (it was showing up
    // as a black square on distant terrain). Comparisons against NaN are
    // always false, so greaterThanEqual doubles as the NaN test; the upper
    // bound catches +inf and keeps the half-float target in range.
    vec3 raw = texture2D(tScene, vUv).rgb;
    vec3 c = min(mix(vec3(0.0), raw, vec3(greaterThanEqual(raw, vec3(0.0)))), vec3(64.0));
    float lum = dot(c, ${LUMA});
    // Soft knee under the threshold, hard growth above it.
    float knee = ${VISUAL.BLOOM.SOFT_KNEE.toFixed(3)} * uThreshold + 1e-4;
    float soft = clamp(lum - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    float bright = max(soft, lum - uThreshold);
    // Emissive detectors: saturated-warm (lava, glowstone, torch flame) and
    // saturated-violet (the portals). Daylight terrain is near-neutral and
    // scores ~0 on both, which is what keeps the bloom on light sources.
    float warm = max(c.r - 0.55 * (c.g + c.b) - ${VISUAL.BLOOM.WARM_FLOOR.toFixed(3)}, 0.0);
    float violet = max(0.5 * (c.r + c.b) - c.g - ${VISUAL.BLOOM.VIOLET_FLOOR.toFixed(3)}, 0.0);
    float w = bright
      + ${VISUAL.BLOOM.WARM_BOOST.toFixed(3)} * warm * (0.25 + lum)
      + ${VISUAL.BLOOM.VIOLET_BOOST.toFixed(3)} * violet * (0.25 + lum);
    // The celestial discs ("moon sun more vibrant"): sky pixels stay out
    // of the bloom EXCEPT where their linear luminance climbs past what
    // the dome can reach — the additive sun disc lands well above 1, the
    // moon just over the knee, the brightest golden horizon under it.
    float hot = sky * clamp((lum - ${VISUAL.BLOOM.SKY_HOT_LUM.toFixed(3)})
      / ${VISUAL.BLOOM.SKY_HOT_RANGE.toFixed(3)}, 0.0, 1.0)
      * ${VISUAL.BLOOM.SKY_HOT_BOOST.toFixed(3)};
    gl_FragColor = vec4(c * (w * (1.0 - sky) + hot), 1.0);
  }
`;

// Bloom 2/3 + 3/3: separable gaussian (9-tap, linear-sampled weights).
const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uDirection; // (spread/w, 0) or (0, spread/h)
  varying vec2 vUv;
  void main() {
    vec3 sum = texture2D(tInput, vUv).rgb * 0.227027;
    vec2 o1 = uDirection * 1.3846154;
    vec2 o2 = uDirection * 3.2307692;
    sum += (texture2D(tInput, vUv + o1).rgb + texture2D(tInput, vUv - o1).rgb) * 0.3162162;
    sum += (texture2D(tInput, vUv + o2).rgb + texture2D(tInput, vUv - o2).rgb) * 0.0702703;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

// The composite: scene + bloom + rays, then the grade, then the sRGB encode.
const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform sampler2D tRays;
  uniform float uRayStrength;   // elevation/visibility ramp, computed per frame
  uniform vec3 uRayTint;
  uniform float uWarm;          // GRADING.WARMTH * sunLevel, per frame
  uniform float uSunBoost;      // sunLevel while the overworld sky is up —
                                // drives the DAYLIGHT POP below
  varying vec2 vUv;
  void main() {
    // Day exposure: sunlight lifts the whole frame a touch (linear space).
    vec3 col = texture2D(tScene, vUv).rgb
      * ${VISUAL.GRADING.EXPOSURE.toFixed(3)}
      * (1.0 + ${VISUAL.GRADING.DAY_EXPOSURE.toFixed(4)} * uSunBoost);
    col += texture2D(tBloom, vUv).rgb * ${VISUAL.BLOOM.STRENGTH.toFixed(3)};
    col += uRayTint * (texture2D(tRays, vUv).r * uRayStrength);

    // Highlight shoulder (the vibrancy pass): above the knee, values roll
    // off toward 1 instead of clipping, so the sun's disc, the bloom and a
    // bright golden horizon keep their gradation.
    col = max(col, 0.0);
    {
      const float knee = ${VISUAL.GRADING.SHOULDER_KNEE.toFixed(3)};
      vec3 over = max(col - knee, 0.0);
      col = min(col, knee) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));
    }

    // linear -> sRGB (the one encode; the whole pipeline above is linear)
    col = clamp(col, 0.0, 1.0);
    vec3 lo = col * 12.92;
    vec3 hi = 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055;
    col = mix(hi, lo, vec3(lessThanEqual(col, vec3(0.0031308))));

    // The grade (perceptual space): warm sunlight, saturation, richer
    // greens, cooler shadows. All strengths in config VISUAL.GRADING.
    // THE DAYLIGHT POP ("whenever sun is present, more vibrant"): with
    // the sun up, contrast takes a gentle S-curve and saturation climbs
    // — the shader-pack sunny-day look — easing back to the neutral
    // grade through dusk, night, caves-at-night and the fixed-sky
    // dimensions (uSunBoost 0).
    col = mix(col, col * col * (3.0 - 2.0 * col),
      ${VISUAL.GRADING.DAY_CONTRAST.toFixed(4)} * uSunBoost);
    col *= vec3(1.0 + uWarm, 1.0 + uWarm * 0.35, 1.0 - uWarm);
    float luma = dot(col, ${LUMA});
    // Vibrance, not plain saturation: the day push is weighted toward the
    // LESS saturated pixels, so grass and sky deepen while already-vivid
    // dirt, sand and flowers are spared from going neon.
    float satNow = max(max(col.r, col.g), col.b) - min(min(col.r, col.g), col.b);
    col = mix(vec3(luma), col,
      ${VISUAL.GRADING.SATURATION.toFixed(3)}
      + ${VISUAL.GRADING.DAY_VIBRANCE.toFixed(4)} * uSunBoost
        * (1.0 - ${VISUAL.GRADING.VIBRANCE_PROTECT.toFixed(3)} * satNow));
    float greenness = clamp((col.g - max(col.r, col.b)) * 2.5, 0.0, 1.0);
    col.g *= mix(1.0, ${VISUAL.GRADING.GREEN_GAIN.toFixed(3)}, greenness);
    // Blue-dominant pixels (sky, water, and the sky-coloured fog — keyed
    // on COLOUR, never depth, so the fog-equals-horizon match survives)
    // take their own gain by day, like foliage does.
    float blueness = clamp((col.b - max(col.r, col.g)) * 3.0, 0.0, 1.0);
    col = mix(vec3(luma), col,
      1.0 + ${VISUAL.GRADING.BLUE_GAIN.toFixed(3)} * blueness * uSunBoost);
    float shadow = pow(clamp(1.0 - luma, 0.0, 1.0), 2.0);
    col = mix(col, col * uCoolTint, ${VISUAL.GRADING.SHADOW_COOL.toFixed(3)} * shadow);

    // Vignette (the shader-pack frame): a gentle darkening toward the
    // corners that pulls the eye to the centre of the screen.
    float vig = distance(vUv, vec2(0.5)) * 1.4142;
    col *= 1.0 - ${VISUAL.GRADING.VIGNETTE.toFixed(4)} * smoothstep(0.55, 1.05, vig);

    // Output dither — the sky dome's own anti-banding trick, applied once
    // at the 8-bit boundary.
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5)
      * ${VISUAL.GRADING.DITHER.toFixed(6)};
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createPostPipeline({ renderer }) {
  const G = VISUAL.GODRAYS;

  // --- fullscreen pass machinery --------------------------------------------
  const passScene = new THREE.Scene();
  const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const passMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  passMesh.frustumCulled = false;
  passScene.add(passMesh);
  const runPass = (material, target) => {
    passMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(passScene, passCamera);
  };

  const makeMaterial = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });

  // --- render targets (sized lazily against the drawing buffer) ------------
  let sceneRT = null;
  let rayA = null;
  let rayB = null;
  let bloomA = null;
  let bloomB = null;
  let width = 0;
  let height = 0;

  function allocate(w, h) {
    width = w;
    height = h;
    for (const rt of [sceneRT, rayA, rayB, bloomA, bloomB]) rt?.dispose();
    const opts = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      samples: VISUAL.MSAA_SAMPLES, // keeps the canvas's old antialiasing
    };
    sceneRT = new THREE.WebGLRenderTarget(w, h, opts);
    sceneRT.depthTexture = new THREE.DepthTexture(w, h);
    // The derived passes draw fullscreen quads only — MSAA has nothing to
    // antialias there and would cost a resolve blit per pass, so the small
    // targets explicitly opt out of the scene target's samples.
    const small = { ...opts, depthBuffer: false, samples: 0 };
    const rw = Math.max(1, Math.floor(w / G.DOWNSCALE));
    const rh = Math.max(1, Math.floor(h / G.DOWNSCALE));
    rayA = new THREE.WebGLRenderTarget(rw, rh, small);
    rayB = new THREE.WebGLRenderTarget(rw, rh, small);
    const bw = Math.max(1, Math.floor(w / VISUAL.BLOOM.DOWNSCALE));
    const bh = Math.max(1, Math.floor(h / VISUAL.BLOOM.DOWNSCALE));
    bloomA = new THREE.WebGLRenderTarget(bw, bh, small);
    bloomB = new THREE.WebGLRenderTarget(bw, bh, small);
    rayMask.uniforms.tDepth.value = sceneRT.depthTexture;
    rayMask.uniforms.tScene.value = sceneRT.texture;
    bright.uniforms.tDepth.value = sceneRT.depthTexture;
    bright.uniforms.tScene.value = sceneRT.texture;
    composite.uniforms.tScene.value = sceneRT.texture;
  }

  // --- pass materials -------------------------------------------------------
  const rayMask = makeMaterial(RAY_MASK_FRAG, {
    tScene: { value: null },
    tDepth: { value: null },
    uSunScreen: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
  });
  const rayBlur = makeMaterial(RAY_BLUR_FRAG, {
    tInput: { value: null },
    uSunScreen: { value: rayMask.uniforms.uSunScreen.value },
  });
  const bright = makeMaterial(BRIGHT_FRAG, {
    tScene: { value: null },
    tDepth: { value: null },
    uThreshold: { value: VISUAL.BLOOM.THRESHOLD_DAY },
  });
  const blur = makeMaterial(BLUR_FRAG, {
    tInput: { value: null },
    uDirection: { value: new THREE.Vector2() },
  });
  const coolTint = new THREE.Color(VISUAL.GRADING.SHADOW_COOL_COLOR);
  coolTint.multiplyScalar(1 / (0.2126 * coolTint.r + 0.7152 * coolTint.g + 0.0722 * coolTint.b));
  const composite = makeMaterial(
    COMPOSITE_FRAG.replace(/uCoolTint/g,
      `vec3(${coolTint.r.toFixed(4)}, ${coolTint.g.toFixed(4)}, ${coolTint.b.toFixed(4)})`),
    {
      tScene: { value: null },
      tBloom: { value: null },
      tRays: { value: null },
      uRayStrength: { value: 0 },
      uRayTint: { value: new THREE.Color(G.TINT) },
      uWarm: { value: 0 },
      uSunBoost: { value: 0 },
    },
  );

  const bufferSize = new THREE.Vector2();
  const sunView = new THREE.Vector3();
  const camForward = new THREE.Vector3();

  // Renders one frame: scene into the pipeline, composite to the canvas.
  // state: { sunDir (world unit vector), sunLevel 0..1, skyActive } —
  // main.js reads all three off the day/night cycle each frame.
  function render(scene, camera, state) {
    renderer.getDrawingBufferSize(bufferSize);
    if (bufferSize.x !== width || bufferSize.y !== height) {
      allocate(bufferSize.x, bufferSize.y);
    }

    // 1. The scene, linear, with depth.
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);

    // 2. God rays — only with the overworld sky up and the sun low+visible.
    let rayStrength = 0;
    if (state.skyActive) {
      const elev = state.sunDir.y;
      const lowSun = THREE.MathUtils.clamp(
        (G.MAX_ELEVATION - elev) / (G.MAX_ELEVATION - G.FULL_ELEVATION), 0, 1,
      );
      const risen = THREE.MathUtils.clamp(
        (elev - G.RISE_START) / (G.RISE_FULL - G.RISE_START), 0, 1,
      );
      camera.getWorldDirection(camForward);
      const facing = THREE.MathUtils.clamp(
        (camForward.dot(state.sunDir) - G.FACING_START) /
          (G.FACING_FULL - G.FACING_START), 0, 1,
      );
      rayStrength = G.STRENGTH * lowSun * risen * facing * state.sunLevel;
    }
    if (rayStrength > 0.003) {
      sunView.copy(state.sunDir).multiplyScalar(10).add(camera.position).project(camera);
      rayMask.uniforms.uSunScreen.value.set(sunView.x * 0.5 + 0.5, sunView.y * 0.5 + 0.5);
      rayMask.uniforms.uAspect.value = width / height;
      runPass(rayMask, rayA);
      let src = rayA;
      let dst = rayB;
      for (let i = 0; i < G.PASSES; i++) {
        rayBlur.uniforms.tInput.value = src.texture;
        runPass(rayBlur, dst);
        [src, dst] = [dst, src];
      }
      composite.uniforms.tRays.value = src.texture;
    } else {
      composite.uniforms.tRays.value = rayB.texture; // stale is fine at 0 weight
    }
    composite.uniforms.uRayStrength.value = rayStrength;

    // 3. Bloom: bright pass, then one separable gaussian. The threshold
    // follows the sun ONLY under the overworld sky — the fixed-sky
    // dimensions are permanently dim, so they hold the night threshold
    // instead of swinging with the hidden overworld clock.
    bright.uniforms.uThreshold.value = THREE.MathUtils.lerp(
      VISUAL.BLOOM.THRESHOLD_NIGHT, VISUAL.BLOOM.THRESHOLD_DAY,
      state.skyActive ? state.sunLevel : 0,
    );
    runPass(bright, bloomA);
    const spread = VISUAL.BLOOM.BLUR_SPREAD;
    blur.uniforms.tInput.value = bloomA.texture;
    blur.uniforms.uDirection.value.set(spread / bloomA.width, 0);
    runPass(blur, bloomB);
    blur.uniforms.tInput.value = bloomB.texture;
    blur.uniforms.uDirection.value.set(0, spread / bloomA.height);
    runPass(blur, bloomA);
    composite.uniforms.tBloom.value = bloomA.texture;

    // 4. Composite + grade to the canvas.
    // The daylight pop fades with sun ELEVATION as well as sun level: at
    // golden hour the sky's own palette carries the mood, and the extra
    // warmth + vibrance piled on top of it turned everything yellow
    // ("mountains look all yellow" at sunset). Full strength with the sun
    // above POP_FULL_ELEVATION, gone by the horizon.
    const pop = state.skyActive
      ? state.sunLevel * THREE.MathUtils.smoothstep(
        state.sunDir.y, VISUAL.GRADING.POP_ZERO_ELEVATION, VISUAL.GRADING.POP_FULL_ELEVATION)
      : 0;
    composite.uniforms.uWarm.value = VISUAL.GRADING.WARMTH * pop;
    composite.uniforms.uSunBoost.value = pop;
    runPass(composite, null);
  }

  return { render };
}
