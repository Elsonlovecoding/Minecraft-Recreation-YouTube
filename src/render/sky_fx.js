// render/sky_fx.js — the Phase 24 sky furniture: the cloud layer, the night
// starfield, and the generated sun/moon textures (a round sun disc inside a
// soft atmospheric glow; the eight-phase round moon). Split out of
// render/lighting.js per the ARCHITECTURE size cap — lighting.js keeps the
// light propagation and the day/night CYCLE (which drives everything here);
// this module only builds the objects and exposes small update hooks.
//
// Colour-exactness contract (see the sky-dome comment in lighting.js): every
// material here is toneMapped: false, and everything that must melt into the
// sky rather than end against it is fog: false — the cloud deck sits far
// beyond FOG_FAR, where linear fog would erase it entirely.

import * as THREE from 'three';
import { CLOUDS, STARS, CELESTIAL } from '../config.js';
import { mulberry32 } from '../world/noise.js'; // the starfield's seeded RNG

// ---------------------------------------------------------------------------
// Celestial depth (Phase 26)
// ---------------------------------------------------------------------------

// Pins a material's geometry to the far plane in the vertex shader. The sun,
// moon and stars are "at infinity": ANY cloud fragment must occlude them. A
// plain depth test cannot guarantee that — the sun quad sits at
// CELESTIAL.DISTANCE (820), and a low sun's ray crosses the y=192 cloud deck
// ~125/sin(elevation) blocks out, which is FARTHER than 820 below ~9° of
// elevation: exactly the sunset case the "sun renders through clouds" report
// described. With gl_Position.z forced to w (minus an epsilon so the far
// clip keeps it), every depth-writing fragment in the scene wins against
// them, and the cloud deck (depthWrite, below) occludes per pixel.
export function forceFarDepth(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n\tgl_Position.z = gl_Position.w * 0.999999;',
    );
  };
}

// ---------------------------------------------------------------------------
// Clouds (Phase 27 follow-up — REALISTIC, by request; the blocky slab deck
// this file carried since Phase 24 is gone)
// ---------------------------------------------------------------------------
//
// VOLUMETRIC clouds: a camera-following trigger plane at CLOUDS.HEIGHT
// whose fragment shader RAYMARCHES the slab [HEIGHT, HEIGHT+THICKNESS]
// through one drifting 2D coverage field (domain-warped fbm inside a
// very-low-frequency weather gate, thin edges eroded by detail noise into
// the curdled cauliflower rim). The field is read as density-as-height
// columns — rounded crowns, softened flat bases — so clouds have real
// sides and their silhouettes change with the viewing angle; shading is a
// height gradient (shaded base to sunlit crown, uLit/uShade tracking the
// cycle) and thin parts catch a silver lining toward the sun (the moon
// after dark). The pattern lives in WORLD space (the plane follows the
// camera but the noise is sampled at world coordinates plus the drift
// offset), so flying never slides the sky. The terrain's drifting cloud
// shadows (lighting.js patchChunkMaterial) sample a cheap copy of this
// SAME field, synced through clouds.getDrift().
//
// THE OCCLUSION CONTRACT (Phase 26): the sun, moon and stars are pinned to
// the far plane and must vanish behind real cloud. Soft alpha and a single
// depth-writing pass cannot both hold — a rim fragment that writes depth
// blacks out the star behind an almost-invisible pixel. So the cumulus
// layer draws TWICE:
//   pass 1  DEPTH ONLY (renderOrder -1.95, colorWrite false): fragments
//           survive only where alpha >= CORE_ALPHA — dense cloud writes
//           depth, so the celestials behind it fail their depth test.
//   pass 2  COLOUR (renderOrder -1.1, no depth write), drawn AFTER the
//           stars (-1.5) and sun/moon (-1.2): the soft rims BLEND over
//           them, attenuating smoothly right up to the opaque core.
// Terrain still occludes both passes through the ordinary depth test.

const CLOUD_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Density + shading shared by both passes (via defines).
const CLOUD_FRAG = /* glsl */ `
  uniform vec2 uOffset;      // drift, in noise units (wrapped)
  uniform vec3 uLit;         // sunlit cloud colour (linear, day/night applied)
  uniform vec3 uShade;       // shaded underbelly colour (linear)
  uniform vec3 uSkyAmbient;  // the sky's own colour for the underbelly (linear)
  uniform vec3 uSunColor;    // light colour on lit faces (linear; gold at a low sun)
  uniform vec3 uSilverColor; // silver-lining tint (linear, sun-level scaled)
  uniform vec3 uSunDir;
  uniform float uLowSun;     // 1 with the sun on the horizon, 0 high or gone
  uniform float uCover;
  varying vec3 vWorld;

  float chash(vec2 c) {
    c = mod(c, 512.0);
    return fract(sin(dot(c, vec2(127.1, 311.7)) + CLOUD_SEED) * 43758.5453);
  }
  float cnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(chash(i), chash(i + vec2(1.0, 0.0)), u.x),
               mix(chash(i + vec2(0.0, 1.0)), chash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float cfbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 5; i++) {
      s += a * cnoise(p);
      p = p * 2.03 + 17.7;
      a *= 0.5;
    }
    return s * 1.032; // 5-octave sum renormalised toward 0..1 — the fifth
                      // octave is what keeps a puff's INTERIOR curdled
                      // (erosion only works the edges), and the dome
                      // normals turn it into dappled self-shading
  }
  // A three-octave fbm for the SHADOW taps below — the shape of a mass
  // without the warp/erosion detail, at a third of the cost.
  float cfbm3(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
      s += a * cnoise(p);
      p = p * 2.03 + 17.7;
      a *= 0.5;
    }
    return s * 1.143;
  }
  // The weather gate: the very-low-frequency field grouping the masses.
  // It MODULATES coverage rather than zeroing it — a low weather cell
  // thins the sky out, it never empties it entirely.
  float weatherGate(vec2 np) {
    return smoothstep(0.32, 0.70,
      cnoise(np * GATE_SCALE) * 0.65 + cnoise(np * GATE_SCALE * 2.63 + 41.3) * 0.35);
  }
  // Weak weather cells cap their crowns lower (TOWER); strong ones tower.
  // Applied to the marched HEIGHT only — coverage, and so the depth pass
  // that occludes the celestials, is untouched.
  float towerScale(float gate) { return mix(1.0 - TOWER, 1.0, gate); }
  // Cloud coverage 0..1 at a noise-space point: a domain-warped fbm body
  // thresholded inside the weather gate, its edges eroded by detail noise.
  // The VOLUME is built from this one 2D field: a column holds cloud from
  // the slab base up to fraction F of THICKNESS (density-as-height).
  float cloudDensityG(vec2 np, out float gate) {
    // Domain warp first — pure fbm puffs are round and samey; bending the
    // sample space gives every mass its own drawn-out, organic outline.
    np += (vec2(cnoise(np * 0.55 + 13.1), cnoise(np * 0.55 + 71.7)) - 0.5) * WARP;
    gate = weatherGate(np);
    float t = 1.0 - uCover * (0.62 + 0.38 * gate);
    float body = smoothstep(t, t + SOFTNESS, cfbm(np));
    // Cauliflower erosion: high-frequency detail eats at the THIN parts
    // (weighted by 1-body, so cores keep their mass) — the crisp curdled
    // rim real cumulus have, instead of one smooth blurred contour.
    float detail = cnoise(np * DETAIL_SCALE) * 0.65
                 + cnoise(np * DETAIL_SCALE * 2.13 + 7.7) * 0.35;
    // No extra interior steepening here: the visible pass squares the
    // field already, and stacking a second S-curve on top collapsed the
    // edge ramp into visible terraced bands ("clouds shouldn't look like
    // this" — the onion-ring contours in the dusk report).
    return clamp(body - (1.0 - body) * detail * EROSION, 0.0, 1.0);
  }
  float cloudDensity(vec2 np) {
    float g;
    return cloudDensityG(np, g);
  }
  // How lit a column is from the sun's side (the realism pass): compare
  // the cheap field here with the cheap field a little way TOWARD the
  // sun — more cloud that way means this point faces away from the light.
  // 0 = deep in the mass's own shadow, 1 = the sunward face.
  float sunSide(vec2 np, vec2 sunOff) {
    float g = weatherGate(np);
    float t = 1.0 - uCover * (0.62 + 0.38 * g);
    float here = smoothstep(t, t + SOFTNESS, cfbm3(np));
    float toward = smoothstep(t, t + SOFTNESS, cfbm3(np + sunOff));
    return clamp(0.5 + (here - toward) * 2.5, 0.0, 1.0);
  }
  // The vertical puff profile at a 3D point, given the column's coverage F:
  // cloud fills the slab from its base up to fraction F of THICKNESS, with
  // a rounded falloff at the puff's crown, a softened flat base, and thin
  // wisps kept optically thin.
  float profile(float F, float h) {
    float d = smoothstep(0.0, ROUND, F - h);   // rounded crown
    d *= smoothstep(0.0, 0.06, h + 0.02);      // soften the flat base
    d *= smoothstep(0.02, 0.3, F);             // wisps stay thin
    return d;
  }
  void main() {
    #ifdef DEPTH_PASS
      // Dense core only — this pass exists to occlude the celestials. It
      // stays 2D (the raw coverage at the base plane): with CORE_ALPHA at
      // 0.90 the cut only lands where the marched cloud above is visually
      // near-opaque, so a bright disc dims smoothly before it can bite.
      vec2 np = vWorld.xz * NOISE_SCALE + uOffset;
      float dens = cloudDensity(np);
      float dist = distance(vWorld.xz, cameraPosition.xz);
      float fade = 1.0 - smoothstep(FADE_START, FADE_END, dist);
      if (dens * OPACITY * fade < CORE_ALPHA) discard;
      gl_FragColor = vec4(0.0);
    #else
      // VOLUMETRIC clouds ("like real life, like shaders"): raymarch a
      // slab [BASE_H, BASE_H + THICK] through the drifting 2D field.
      // Real thickness is what a flat plane can never fake — sides seen
      // from afar, bright crowns, shaded flat bases, silhouettes that
      // change with the viewing angle as you move.
      vec3 ro = cameraPosition;
      vec3 rd = normalize(vWorld - ro);
      float ry = abs(rd.y) < 1e-4 ? (rd.y < 0.0 ? -1e-4 : 1e-4) : rd.y;
      float tA = (BASE_H - ro.y) / ry;
      float tB = (BASE_H + THICK - ro.y) / ry;
      float t0 = max(min(tA, tB), 0.0);
      float t1 = max(tA, tB);
      // Horizon fade keyed to the ENTRY distance; also cap the marched
      // span so grazing rays stay affordable.
      float distXZ = distance((ro + rd * t0).xz, ro.xz);
      float fade = 1.0 - smoothstep(FADE_START, FADE_END, distXZ);
      if (fade <= 0.001 || t1 <= t0) discard;
      t1 = min(t1, t0 + MAX_SPAN);
      float dt = (t1 - t0) / float(STEPS);
      // Per-pixel jitter on the start offset hides the step banding.
      float jit = chash(gl_FragCoord.xy * 0.6180339);
      // LIGHT DIRECTION (the realism pass): the sunward/shadow side of the
      // mass, from two cheap taps at the ray's entry and exit columns,
      // lerped along the march. The reach shrinks as the sun climbs — an
      // overhead sun shades sides less than a low one does.
      vec2 sunOff = normalize(uSunDir.xz + vec2(1e-5, 0.0))
        * (SHADOW_REACH * NOISE_SCALE * (1.0 - 0.6 * abs(uSunDir.y)));
      float lit0 = sunSide((ro + rd * t0).xz * NOISE_SCALE + uOffset, sunOff);
      float lit1 = sunSide((ro + rd * t1).xz * NOISE_SCALE + uOffset, sunOff);
      vec3 shadeCol = mix(uShade, uSkyAmbient, SKY_AMBIENT); // sky-lit bellies
      vec3 litCol = uLit * uSunColor;                        // gilded at a low sun
      vec3 baseWarm = litCol * 0.9;                          // lit from below
      // Side shading is a LOW-sun effect: an overhead sun lights crowns
      // and leaves the sides alike (the height gradient already carries
      // that), so its strength falls away as the sun climbs — at full
      // strength noon cumulus read as side-lit strips.
      float sideK = SELF_SHADOW * (1.0 - 0.75 * abs(uSunDir.y));
      float T = 1.0;      // transmittance
      vec3 acc = vec3(0.0);
      for (int i = 0; i < STEPS; i++) {
        float t = t0 + (float(i) + jit) * dt;
        vec3 p = ro + rd * t;
        float gate;
        float F = cloudDensityG(p.xz * NOISE_SCALE + uOffset, gate) * towerScale(gate);
        float h = clamp((p.y - BASE_H) / THICK, 0.0, 1.0);
        float d = profile(F, h);
        if (d < 0.004) continue;
        float a = 1.0 - exp(-d * DENSITY * dt);
        // Height gradient carries the base read (shaded flat bases, lit
        // crowns); the sun side lifts, the far side falls into the mass's
        // own shadow; a low sun warms the undersides from below; and the
        // Beer-powder term darkens the thin parts the way real cloud's
        // multiple scattering does — edges get definition, not glow.
        float lit = mix(lit0, lit1, (t - t0) / max(t1 - t0, 1e-3));
        float side = mix(1.0 - sideK, 1.0 + 0.3 * sideK, lit);
        vec3 cs = mix(shadeCol, litCol, mix(BOTTOM_LIT, 1.0, h)) * side;
        cs = mix(cs, baseWarm, uLowSun * BASE_WARM * (1.0 - h) * (1.0 - h));
        cs *= mix(1.0, 1.0 - exp(-d * POWDER), POWDER_MIX);
        acc += T * a * cs;
        T *= 1.0 - a;
        if (T < 0.03) break;
      }
      float alpha = (1.0 - T) * OPACITY * fade;
      if (alpha < 0.004) discard;
      vec3 col = acc / max(1.0 - T, 1e-4);
      // Forward scatter toward the sun (the moon at night — uSunDir flips
      // below the horizon): a tight silver lining on the thin parts and a
      // broad soft lobe over everything facing the light.
      float cosSun = max(dot(rd, uSunDir), 0.0);
      col += uSilverColor * pow(cosSun, SILVER_POWER) * T;
      col += uSilverColor * WIDE_SILVER * pow(cosSun, WIDE_SILVER_POWER);
      gl_FragColor = vec4(col, alpha);
    #endif
  }
`;

export function createClouds() {
  const C = CLOUDS;
  // RAW sRGB components (the numeric Color constructor never converts; a
  // setHex WOULD, under r160's colour management) — the per-frame maths
  // below runs in sRGB and converts to linear once, the deck's old rule.
  const hexToSrgb = (hex) => new THREE.Color(
    ((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255,
  );
  const litBase = hexToSrgb(C.LIT_COLOR);
  const shadeBase = hexToSrgb(C.SHADE_COLOR);
  const makeUniforms = () => ({
    uOffset: { value: new THREE.Vector2(0, 0) },
    uLit: { value: new THREE.Color(C.LIT_COLOR) },
    uShade: { value: new THREE.Color(C.SHADE_COLOR) },
    uSkyAmbient: { value: new THREE.Color(C.SHADE_COLOR) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSilverColor: { value: new THREE.Color(0, 0, 0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uLowSun: { value: 0 },
    uCover: { value: C.COVER },
  });
  const defines = (extra) => Object.assign({
    NOISE_SCALE: C.SCALE.toFixed(8),
    GATE_SCALE: C.GATE_SCALE.toFixed(5),
    SOFTNESS: C.SOFTNESS.toFixed(4),
    OPACITY: C.OPACITY.toFixed(4),
    CORE_ALPHA: C.CORE_ALPHA.toFixed(4),
    FADE_START: C.FADE_START.toFixed(1),
    FADE_END: C.FADE_END.toFixed(1),
    WARP: C.WARP.toFixed(4),
    DETAIL_SCALE: C.DETAIL_SCALE.toFixed(4),
    EROSION: C.EROSION.toFixed(4),
    BASE_H: C.HEIGHT.toFixed(1),
    THICK: C.THICKNESS.toFixed(1),
    ROUND: C.ROUND.toFixed(4),
    DENSITY: C.DENSITY.toFixed(5),
    STEPS: String(C.STEPS),
    BOTTOM_LIT: C.BOTTOM_LIT.toFixed(4),
    MAX_SPAN: C.MAX_SPAN.toFixed(1),
    SILVER_POWER: C.SILVER_POWER.toFixed(1),
    CLOUD_SEED: C.SEED.toFixed(4),
    // The realism pass
    SELF_SHADOW: C.SELF_SHADOW.toFixed(4),
    SHADOW_REACH: C.SHADOW_REACH.toFixed(2),
    POWDER: C.POWDER.toFixed(4),
    POWDER_MIX: C.POWDER_MIX.toFixed(4),
    SKY_AMBIENT: C.SKY_AMBIENT.toFixed(4),
    BASE_WARM: C.BASE_WARM.toFixed(4),
    WIDE_SILVER: C.WIDE_SILVER.toFixed(4),
    WIDE_SILVER_POWER: C.WIDE_SILVER_POWER.toFixed(2),
    TOWER: C.TOWER.toFixed(4),
  }, extra);
  const makeMaterial = (opts, extraDefines) => new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    uniforms: makeUniforms(),
    defines: defines(extraDefines),
    transparent: true,
    fog: false,
    toneMapped: false,
    side: THREE.DoubleSide, // the layer must read from creative flight too
    ...opts,
  });

  const geometry = new THREE.PlaneGeometry(C.PLANE_RADIUS * 2, C.PLANE_RADIUS * 2);
  geometry.rotateX(-Math.PI / 2); // horizontal

  // Pass 1 — the occluder. Colour never writes; depth only where dense.
  const depthMat = makeMaterial(
    { colorWrite: false, depthWrite: true },
    { DEPTH_PASS: 1 },
  );
  const depthMesh = new THREE.Mesh(geometry, depthMat);
  depthMesh.renderOrder = -1.95;

  // Pass 2 — the visible layer, after the stars and sun/moon: ONE bright
  // compact-puff pass (the base sheet and the cirrus veil were cut by
  // request — "remove the layer of bad cloud. Only the upper good layer").
  const colorMat = makeMaterial({ depthWrite: false });
  const colorMesh = new THREE.Mesh(geometry, colorMat);
  colorMesh.renderOrder = -1.1;

  const group = new THREE.Group();
  group.add(depthMesh);
  group.add(colorMesh);
  for (const m of [depthMesh, colorMesh]) m.frustumCulled = false;

  const mats = [depthMat, colorMat];
  // The drift wrap bounds float precision through arbitrarily long days.
  // It is NOT seamless: only cfbm's first octave shares the hash lattice's
  // 512 period — every scaled/rotated sampling (gate, higher octaves,
  // warp, detail, relief) lands elsewhere on the lattice after a wrap, so
  // the whole sky re-rolls to a fresh layout when one hits. That takes
  // ~17h of continuous play, both passes pop coherently (same drift, same
  // density code — occlusion holds), and clouds are weather, so the
  // once-a-real-day reshuffle is accepted rather than paying for a true
  // common period or a cross-fade.
  const NOISE_PERIOD = 512; // the hash lattice wrap (see chash)
  let drift = 0;
  const white = new THREE.Color(1, 1, 1);
  const tinted = new THREE.Color();
  const silver = new THREE.Color();
  const sunColor = new THREE.Color();
  const warm = new THREE.Color(C.SUN_WARM_COLOR); // linear (setHex-decoded)

  return {
    mesh: group,
    // The planes follow the camera; the PATTERN stays world-anchored
    // because the shader samples world position plus a bounded drift
    // offset (wrapped — see NOISE_PERIOD above).
    update(delta, focus) {
      drift = (drift + delta * C.SPEED * C.SCALE) % NOISE_PERIOD;
      depthMesh.position.set(focus.x, C.HEIGHT, focus.z);
      colorMesh.position.set(focus.x, C.HEIGHT, focus.z);
      depthMat.uniforms.uOffset.value.set(drift, 0);
      colorMat.uniforms.uOffset.value.set(drift, 0);
    },
    // Day/night: the lit/shade pair scales with the sun and blushes toward
    // the horizon colour at dawn/dusk. Maths in sRGB (the trap that bit the
    // old deck, the particles and the stars — three stores colours linear),
    // converted once at the end.
    // `skyMid` (linear, the dome's current mid colour) lights the shaded
    // undersides with the sky's own colour — blue by day, violet in the
    // blue hour, near-black at night.
    setLight(sunLevel, horizonColor, skyMid = null) {
      const b = C.NIGHT_BRIGHTNESS + (1 - C.NIGHT_BRIGHTNESS) * sunLevel;
      tinted.copy(horizonColor).convertLinearToSRGB();
      tinted.lerpColors(white, tinted, C.HORIZON_TINT);
      for (const m of mats) {
        m.uniforms.uLit.value.copy(litBase)
          .multiply(tinted).multiplyScalar(b).convertSRGBToLinear();
        // The SHADE takes no horizon tint: grey-blue x sunset gold came
        // out olive-brown, the "weird" sunset cloud. Shaded cloud is lit
        // by the sky overhead, so it takes the sky's mid colour instead
        // (uSkyAmbient, mixed in by SKY_AMBIENT) — violet at dusk, blue
        // at noon — and only the LIT faces warm toward the horizon.
        m.uniforms.uShade.value.copy(shadeBase)
          .multiplyScalar(b).convertSRGBToLinear();
        if (skyMid) m.uniforms.uSkyAmbient.value.copy(skyMid).multiplyScalar(1.15);
        else m.uniforms.uSkyAmbient.value.copy(m.uniforms.uShade.value);
      }
    },
    // The sun feeds the self-shading direction and the silver lining —
    // strongest when the sun is LOW (the golden-hour look), fading to a
    // trace of moon-silver at night (the direction flips to the moon).
    // The realism pass adds the light COLOUR on lit faces (white high,
    // gold-orange at the horizon) and the low-sun factor that warms the
    // bases from below — both gone once the sun is well under.
    setSun(sunDir, sunLevel) {
      const lowSun = THREE.MathUtils.clamp(1.6 - Math.abs(sunDir.y) * 4.0, 0.35, 1);
      silver.setRGB(1, 1, 1)
        .multiplyScalar(C.SILVER * lowSun * Math.max(0.12, sunLevel))
        .convertSRGBToLinear();
      const above = THREE.MathUtils.clamp((sunDir.y + 0.12) / 0.12, 0, 1);
      const low = THREE.MathUtils.clamp(1.6 - Math.abs(sunDir.y) * 4.0, 0, 1) * above;
      sunColor.copy(white).lerp(warm, low * C.SUN_WARMTH);
      for (const m of mats) {
        m.uniforms.uSunDir.value.copy(sunDir);
        if (sunDir.y < 0) m.uniforms.uSunDir.value.negate(); // the moon takes over
        m.uniforms.uSilverColor.value.copy(silver);
        m.uniforms.uSunColor.value.copy(sunColor);
        m.uniforms.uLowSun.value = low;
      }
    },
    setVisible(v) {
      group.visible = v;
    },
    // The drifting field's current offset (noise units) — the terrain's
    // cloud-shadow term samples the SAME field so shadows track the sky.
    getDrift() {
      return drift;
    },
  };
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

// A fixed hashed starfield on the celestial sphere, parented to the sky dome
// (which follows the camera) inside a group the cycle rotates with the sun's
// orbit angle — the stars wheel across the night like the real thing. The
// field covers the FULL sphere: the wheel turns 360° per day, so any band
// of empty sphere would sweep across the visible sky (the first cut seeded
// only the upper band and midnight showed a half-empty sky).
export function createStars(sky) {
  const S = STARS;
  const rng = mulberry32(S.SEED);
  // The real sky's trick (the "stars better" retune): stars are not one
  // flat sheet of identical white points. Two layers — a dense faint field
  // under a sparse bright one — and every star carries its own brightness
  // and a slight temperature colour: most white, the hot ones leaning
  // blue, the old ones leaning warm.
  const buildLayer = (count, size) => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const y = rng() * 2 - 1; // uniform over the whole sphere
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      positions[i * 3] = Math.cos(a) * r * S.RADIUS;
      positions[i * 3 + 1] = y * S.RADIUS;
      positions[i * 3 + 2] = Math.sin(a) * r * S.RADIUS;
      // Brightness spread (dim stars far outnumber bright ones — square
      // the roll) with a temperature lean on a third of them.
      const v = 0.35 + 0.65 * rng() * rng();
      let cr = v;
      let cg = v;
      let cb = v;
      const roll = rng();
      if (roll < 0.18) { cr *= 0.82; cg *= 0.9; }        // blue-white
      else if (roll < 0.34) { cb *= 0.78; cg *= 0.93; }  // warm white
      colors[i * 3] = cr;
      colors[i * 3 + 1] = cg;
      colors[i * 3 + 2] = cb;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending, // stars ADD light; overlaps glow
    });
    // Phase 26: stars sit at the far plane and depth-test, so the cloud
    // deck (which writes depth) occludes them per pixel.
    forceFarDepth(material);
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = -1.5; // after dome AND clouds, before sun/moon
    return { points, material };
  };
  const faint = buildLayer(S.COUNT, S.SIZE);
  const bright = buildLayer(S.BRIGHT_COUNT, S.BRIGHT_SIZE);
  const group = new THREE.Group();
  group.add(faint.points);
  group.add(bright.points);
  sky.add(group);
  return {
    group,
    setAlpha(a) {
      faint.material.opacity = a * 0.85;
      bright.material.opacity = a;
      faint.points.visible = a > 0.002;
      bright.points.visible = a > 0.002;
    },
    // The wheel: rotate with the sun's orbit angle around its own axis.
    setAngle(ang) {
      group.rotation.z = ang;
    },
  };
}

// ---------------------------------------------------------------------------
// Sun and moon textures
// ---------------------------------------------------------------------------

const hexRgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

// The sun: a bright ROUND disc with a soft radial glow — rendered additively
// so the halo melts into whatever sky is behind it. Two rules keep the quad
// invisible (the follow-up fix — "the sun shouldn't have that box around
// it", and it had one): the glow is WINDOWED so it reaches exactly zero
// before the quad rim (the old exponential still carried alpha ~16/255 at
// the edge, which additive blending drew as a faint square against the
// sky), and the texture filters LINEARLY (Nearest magnification turned the
// smooth gradient into visible stair-stepped blocks). The moon follows the
// same two rules now that it is a round disc.
export function createSunTexture() {
  const W = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = W;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, W);
  const coreR = 0.5 / CELESTIAL.SUN_GLOW_SCALE; // disc radius, uv units
  const soft = coreR * 0.22;                    // the disc edge's soft band
  const RIM = 0.5;                              // quad half-extent in uv
  const [cr, cg, cb] = hexRgb(CELESTIAL.SUN_CORE_COLOR);
  const [rr, rg, rb] = hexRgb(CELESTIAL.SUN_RIM_COLOR);
  const [ir, ig, ib] = hexRgb(CELESTIAL.SUN_INNER_COLOR);
  const [gr, gg, gb] = hexRgb(CELESTIAL.SUN_GLOW_COLOR);
  const smooth = (v) => v * v * (3 - 2 * v);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      const v = (y + 0.5) / W - 0.5;
      const d = Math.hypot(u, v);
      // Core: 1 inside the disc, easing to 0 over the soft band. The
      // vibrant sun grades from a white-hot centre to saturated gold at
      // the rim (a real disc is limb-darkened and reddened at the edge).
      const core = 1 - Math.min(1, Math.max(0, (d - coreR) / soft));
      const rimT = smooth(Math.min(1, Math.max(0, (d / coreR - 0.45) / 0.55)));
      // Corona, two radii: a tight bright inner ring hugging the disc and
      // the wide soft atmospheric halo. Both decay radially from the disc
      // edge and are multiplied by a smooth window that is exactly 0 at
      // the quad rim — no rim, no box. The wide falloff relaxes as the
      // quad grows so the halo uses the room SUN_GLOW_SCALE gives it.
      const out = Math.max(0, d - coreR);
      const inner = CELESTIAL.SUN_INNER_GLOW * Math.exp(-out * CELESTIAL.SUN_INNER_FALLOFF);
      const fall = Math.exp(-out * (6.0 / (CELESTIAL.SUN_GLOW_SCALE / 2.6)));
      const window_ = Math.max(0, 1 - d / RIM);
      const glow = CELESTIAL.SUN_GLOW_STRENGTH * fall * window_ * window_;
      const halo = Math.min(1, (inner + glow) * window_ * window_);
      const a = Math.min(1, core + halo);
      const i = (y * W + x) * 4;
      // Colour: inside the disc, centre -> rim; outside, the inner ring's
      // gold-orange fading to the wide halo's pale gold by their weights.
      const wIn = inner / Math.max(inner + glow, 1e-6);
      const hr = ir * wIn + gr * (1 - wIn);
      const hg = ig * wIn + gg * (1 - wIn);
      const hb = ib * wIn + gb * (1 - wIn);
      const dr = cr + (rr - cr) * rimT;
      const dg = cg + (rg - cg) * rimT;
      const db = cb + (rb - cb) * rimT;
      img.data[i] = Math.round(hr + (dr - hr) * core);
      img.data[i + 1] = Math.round(hg + (dg - hg) * core);
      img.data[i + 2] = Math.round(hb + (db - hb) * core);
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;   // a gradient, not pixel art
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

// The moon's halo (Phase 27 follow-up — "moon light should also good"): a
// soft cool radial glow on an additive quad behind the round moon disc,
// built by the sun-glow rules — windowed to exactly zero before the quad
// rim (no box) and linear-filtered (a gradient, not pixel art).
export function createMoonGlowTexture() {
  const W = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = W;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, W);
  const [gr, gg, gb] = [
    (CELESTIAL.MOON_GLOW_COLOR >> 16) & 255,
    (CELESTIAL.MOON_GLOW_COLOR >> 8) & 255,
    CELESTIAL.MOON_GLOW_COLOR & 255,
  ];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      const v = (y + 0.5) / W - 0.5;
      const d = Math.hypot(u, v);
      // The wide soft halo plus (the vibrancy pass) a tight bright ring
      // at the limb — the "shiny" moon; both windowed to zero at the rim.
      const discR = 0.5 / CELESTIAL.MOON_GLOW_SCALE;
      const fall = Math.exp(-d * 5.5);
      const inner = CELESTIAL.MOON_GLOW_INNER * Math.exp(-Math.max(0, d - discR) * 16);
      const window_ = Math.max(0, 1 - d / 0.5);
      const a = (CELESTIAL.MOON_GLOW_STRENGTH * fall + inner) * window_ * window_;
      const i = (y * W + x) * 4;
      img.data[i] = gr;
      img.data[i + 1] = gg;
      img.data[i + 2] = gb;
      img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

// The eight moon phases as separate textures — a ROUND moon now (the
// Phase 27 second follow-up; the vanilla pixel square is gone): an
// anti-aliased disc carrying maria and craters generated ONCE from a
// seeded RNG (every phase shows the same face, like the real thing), a
// soft elliptical terminator, and the unlit part left as faint cool
// earthshine. Phase 0 is full, waning through new (4) and waxing back.
// Linear-filtered — a round rim, not pixel art.
export function createMoonTextures() {
  const P = 128;
  const R = 0.94;          // disc radius in normalised (-1..1) coords
  const AA = 2.5 / (P / 2); // anti-alias band, ~2.5px
  const TERM = 0.09;        // terminator softness, normalised units
  const phases = [];
  const [lr, lg, lb] = hexRgb(CELESTIAL.MOON_LIT_COLOR);
  const smooth = (v) => v * v * (3 - 2 * v);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  // One moon, eight lightings: the surface features come from a fixed
  // seeded RNG OUTSIDE the phase loop.
  const rng = mulberry32(9241);
  const maria = [];
  const [md0, md1] = CELESTIAL.MOON_MARIA_DEPTH;
  const [cd0, cd1] = CELESTIAL.MOON_CRATER_DEPTH;
  for (let i = 0; i < 4; i++) {
    maria.push({ x: (rng() * 2 - 1) * 0.5, y: (rng() * 2 - 1) * 0.5,
                 r: 0.25 + rng() * 0.3, d: md0 + rng() * (md1 - md0) });
  }
  const craters = [];
  for (let i = 0; i < 24; i++) {
    craters.push({ x: (rng() * 2 - 1) * 0.8, y: (rng() * 2 - 1) * 0.8,
                   r: 0.035 + rng() * 0.085, d: cd0 + rng() * (cd1 - cd0) });
  }
  const surface = (xn, yn) => {
    let m = 1;
    for (const c of maria) {
      const dd = Math.hypot(xn - c.x, yn - c.y);
      if (dd < c.r) m -= c.d * smooth(1 - dd / c.r); // broad soft dark seas
    }
    for (const c of craters) {
      const dd = Math.hypot(xn - c.x, yn - c.y);
      if (dd < c.r) m -= c.d * (1 - (dd / c.r) ** 2); // small dished pits
    }
    return m;
  };
  for (let phase = 0; phase < CELESTIAL.MOON_PHASES; phase++) {
    const canvas = document.createElement('canvas');
    canvas.width = P;
    canvas.height = P;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(P, P);
    for (let y = 0; y < P; y++) {
      for (let x = 0; x < P; x++) {
        const xn = ((x + 0.5) / P) * 2 - 1;
        const yn = ((y + 0.5) / P) * 2 - 1;
        const d = Math.hypot(xn, yn);
        const i = (y * P + x) * 4;
        const cov = clamp01((R - d) / AA); // disc edge coverage
        if (cov <= 0) { img.data[i + 3] = 0; continue; }
        // The terminator: signed distance to the phase ellipse, eased over
        // TERM — real shadow edges on the moon are soft, not pixel steps.
        // The ellipse lives on the ACTUAL R-disc (semi-axes R.cos, R), so
        // crescent tips taper to points at the limb — the unit-disc bulge
        // of the old square moon left them truncated 4px short of the
        // poles (adversarial-review catch).
        const bulge = Math.sqrt(Math.max(0, R * R - yn * yn));
        let litAmt;
        if (phase === 0) litAmt = 1;
        else if (phase === 4) litAmt = 0;
        else if (phase < 4) {
          litAmt = clamp01((Math.cos((Math.PI * phase) / 4) * bulge - xn) / TERM + 0.5);
        } else {
          litAmt = clamp01((xn + Math.cos((Math.PI * (8 - phase)) / 4) * bulge) / TERM + 0.5);
        }
        // A hashed speckle keeps the face from reading as flat plastic.
        let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) | 0;
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
        const grain = 0.92 + ((h >>> 8) & 0xff) / 255 * 0.08;
        // Maria + craters + a whisper of limb darkening (the real moon is
        // nearly flat-lit; keep it subtle or the disc reads like a ball).
        const limb = CELESTIAL.MOON_LIMB
          + (1 - CELESTIAL.MOON_LIMB) * Math.sqrt(Math.max(0, 1 - (d / R) ** 2));
        const shade = surface(xn, yn) * grain * limb;
        // Earthshine: the unlit part is a faint cool grey-blue ghost.
        const er = 30 * (shade + 0.4);
        const eg = 35 * (shade + 0.4);
        const eb = 54 * (shade + 0.4);
        img.data[i] = Math.round(er + (lr * shade - er) * litAmt);
        img.data[i + 1] = Math.round(eg + (lg * shade - eg) * litAmt);
        img.data[i + 2] = Math.round(eb + (lb * shade - eb) * litAmt);
        img.data[i + 3] = Math.round(cov * 255 *
          (CELESTIAL.MOON_DARK_ALPHA + (1 - CELESTIAL.MOON_DARK_ALPHA) * litAmt));
      }
    }
    ctx.putImageData(img, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter; // a disc, not pixel art
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    phases.push(texture);
  }
  return phases;
}
