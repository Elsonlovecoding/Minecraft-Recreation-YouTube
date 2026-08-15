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
// A noise-shaded cloud LAYER: a camera-following plane at CLOUDS.HEIGHT whose
// fragment shader grows soft cumulus from domain-warped fbm value noise — a
// very-low-frequency weather gate groups the masses with real clear sky
// between, detail noise erodes the thin edges into the curdled cauliflower
// rim, self-shading is PSEUDO-VOLUME (density read as the height of a dome,
// rotated relief bumps keeping the interior dappled, a real N.L against the
// 3D sun — the moon after dark), and thin edges catch a warm silver lining
// when they sit near a low sun. The pattern lives in WORLD space (the
// plane follows the camera but the noise is sampled at world coordinates
// plus the drift offset), so flying never slides the sky. The visible pass
// draws the field SHRUNKEN to its cores (dens^2) — the raw field's flat
// milky sheet and the old cirrus veil were cut by request; one bright
// compact-puff layer is the whole look now.
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
  uniform vec3 uSilverColor; // silver-lining tint (linear, sun-level scaled)
  uniform vec3 uSunDir;
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
  // Relief bumps for the dome normal: two octaves on a ROTATED grid —
  // bare value noise shows its axis-aligned lattice when it drives
  // lighting (the first cut of the bumps read as a quilted blanket).
  float crelief(vec2 p) {
    vec2 r = vec2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y);
    return cnoise(r * RELIEF_SCALE) * 0.65
         + cnoise(r.yx * RELIEF_SCALE * 2.3 + 31.7) * 0.35;
  }
  // Cloud density 0..1 at a noise-space point: a domain-warped fbm body
  // thresholded inside the weather gate, its edges eroded by detail noise.
  float cloudDensity(vec2 np) {
    // Domain warp first — pure fbm puffs are round and samey; bending the
    // sample space gives every mass its own drawn-out, organic outline.
    np += (vec2(cnoise(np * 0.55 + 13.1), cnoise(np * 0.55 + 71.7)) - 0.5) * WARP;
    // The gate MODULATES coverage rather than zeroing it — a low weather
    // cell thins the sky out, it never empties it entirely.
    float gate = smoothstep(0.32, 0.70,
      cnoise(np * GATE_SCALE) * 0.65 + cnoise(np * GATE_SCALE * 2.63 + 41.3) * 0.35);
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
  void main() {
    vec2 np = vWorld.xz * NOISE_SCALE + uOffset;
    float dens = cloudDensity(np);
    #ifndef DEPTH_PASS
      // The visible layer is the field shrunken toward its cores (dens^2):
      // compact bright puffs with real blue between them. The raw field's
      // colour pass painted a flat milky sheet at glancing angles and was
      // cut by request ("remove the layer of bad cloud") — the depth pass
      // below still occludes on the RAW field, with CORE_ALPHA raised so
      // the occluding core stays inside visibly solid cloud.
      dens = dens * dens;
    #endif
    // Horizon fade: thin out before the far-plane clip ever shows an edge.
    float dist = distance(vWorld.xz, cameraPosition.xz);
    float fade = 1.0 - smoothstep(FADE_START, FADE_END, dist);
    float alpha = dens * OPACITY * fade;
    #ifdef DEPTH_PASS
      // Dense core only — this pass exists to occlude the celestials.
      if (alpha < CORE_ALPHA) discard;
      gl_FragColor = vec4(0.0);
    #else
      if (alpha < 0.004) discard;
      // Pseudo-volume: treat density as the height of a dome and light it
      // with a real N.L against the 3D sun — sun-facing swells brighten,
      // the far sides fall into shade, which is what makes a flat plane
      // read as a field of solid puffs. (At night uSunDir is the moon.)
      // A high-frequency RELIEF term rides on top of the body height,
      // weighted by density so it lives on the cloud and not the clear
      // sky: the body ramp saturates to 1 inside a puff (gradient zero),
      // and without the bumps a big cloud shades only at its rim and
      // reads flat overhead. With them the interior stays dappled. The
      // gradient taps are squared like the centre — one consistent field.
      vec2 npR = np + vec2(NORMAL_EPS, 0.0);
      vec2 npF = np + vec2(0.0, NORMAL_EPS);
      float dR = cloudDensity(npR);
      dR *= dR;
      float dF = cloudDensity(npF);
      dF *= dF;
      float hC = dens + crelief(np) * RELIEF * dens;
      float hR = dR + crelief(npR) * RELIEF * dR;
      float hF = dF + crelief(npF) * RELIEF * dF;
      vec3 nrm = normalize(vec3((hC - hR) * DOME_GAIN, NORMAL_EPS,
                                (hC - hF) * DOME_GAIN));
      float ndl = clamp(dot(nrm, uSunDir), 0.0, 1.0);
      float lit = AMBIENT + (1.0 - AMBIENT) * ndl;
      // Thin cloud reads brighter (light passes through it).
      lit = clamp(lit + (1.0 - dens) * THIN_LIFT, 0.0, 1.0);
      vec3 col = mix(uShade, uLit, lit);
      // Silver lining: thin edges glow toward the sun's direction.
      vec3 viewDir = normalize(vWorld - cameraPosition);
      float rim = pow(max(dot(viewDir, uSunDir), 0.0), SILVER_POWER);
      col += uSilverColor * (rim * (1.0 - dens));
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
    uSilverColor: { value: new THREE.Color(0, 0, 0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
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
    NORMAL_EPS: C.NORMAL_EPS.toFixed(4),
    DOME_GAIN: C.DOME_GAIN.toFixed(4),
    RELIEF: C.RELIEF.toFixed(4),
    RELIEF_SCALE: C.RELIEF_SCALE.toFixed(4),
    AMBIENT: C.AMBIENT.toFixed(4),
    THIN_LIFT: C.THIN_LIFT.toFixed(4),
    SILVER_POWER: C.SILVER_POWER.toFixed(1),
    CLOUD_SEED: C.SEED.toFixed(4),
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
    setLight(sunLevel, horizonColor) {
      const b = C.NIGHT_BRIGHTNESS + (1 - C.NIGHT_BRIGHTNESS) * sunLevel;
      tinted.copy(horizonColor).convertLinearToSRGB();
      tinted.lerpColors(white, tinted, C.HORIZON_TINT);
      for (const m of mats) {
        m.uniforms.uLit.value.copy(litBase)
          .multiply(tinted).multiplyScalar(b).convertSRGBToLinear();
        m.uniforms.uShade.value.copy(shadeBase)
          .multiply(tinted).multiplyScalar(b).convertSRGBToLinear();
      }
    },
    // The sun feeds the self-shading direction and the silver lining —
    // strongest when the sun is LOW (the golden-hour look), fading to a
    // trace of moon-silver at night (the direction flips to the moon).
    setSun(sunDir, sunLevel) {
      const lowSun = THREE.MathUtils.clamp(1.6 - Math.abs(sunDir.y) * 4.0, 0.35, 1);
      silver.setRGB(1, 1, 1)
        .multiplyScalar(C.SILVER * lowSun * Math.max(0.12, sunLevel))
        .convertSRGBToLinear();
      for (const m of mats) {
        m.uniforms.uSunDir.value.copy(sunDir);
        if (sunDir.y < 0) m.uniforms.uSunDir.value.negate(); // the moon takes over
        m.uniforms.uSilverColor.value.copy(silver);
      }
    },
    setVisible(v) {
      group.visible = v;
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
  const positions = new Float32Array(S.COUNT * 3);
  for (let i = 0; i < S.COUNT; i++) {
    const y = rng() * 2 - 1; // uniform over the whole sphere
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    positions[i * 3] = Math.cos(a) * r * S.RADIUS;
    positions[i * 3 + 1] = y * S.RADIUS;
    positions[i * 3 + 2] = Math.sin(a) * r * S.RADIUS;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: S.SIZE,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  // Phase 26: stars sit at the far plane and depth-test, so the cloud deck
  // (which now writes depth, above) occludes them per pixel.
  forceFarDepth(material);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1.5; // after the dome AND the clouds, before sun/moon
  const group = new THREE.Group();
  group.add(points);
  sky.add(group);
  return {
    group,
    setAlpha(a) {
      material.opacity = a;
      points.visible = a > 0.002;
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
  const [gr, gg, gb] = hexRgb(CELESTIAL.SUN_GLOW_COLOR);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      const v = (y + 0.5) / W - 0.5;
      const d = Math.hypot(u, v);
      // Core: 1 inside the disc, easing to 0 over the soft band.
      const core = 1 - Math.min(1, Math.max(0, (d - coreR) / soft));
      // Glow: radial decay from the disc edge, multiplied by a smooth
      // window that is exactly 0 at the quad rim — no rim, no box. The
      // strength is config now (Phase 26 raised it for the reference's
      // big soft halo); the falloff relaxes as the quad grows so the halo
      // uses the room the larger SUN_GLOW_SCALE gives it.
      const fall = Math.exp(-Math.max(0, d - coreR) * (6.0 / (CELESTIAL.SUN_GLOW_SCALE / 2.6)));
      const window_ = Math.max(0, 1 - d / RIM);
      const glow = CELESTIAL.SUN_GLOW_STRENGTH * fall * window_ * window_;
      const a = Math.min(1, core + glow);
      const i = (y * W + x) * 4;
      const t = core; // blend the halo hue toward the core's white centre
      img.data[i] = Math.round(gr + (cr - gr) * t);
      img.data[i + 1] = Math.round(gg + (cg - gg) * t);
      img.data[i + 2] = Math.round(gb + (cb - gb) * t);
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
      const fall = Math.exp(-d * 5.5);
      const window_ = Math.max(0, 1 - d / 0.5);
      const a = CELESTIAL.MOON_GLOW_STRENGTH * fall * window_ * window_;
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
  for (let i = 0; i < 4; i++) {
    maria.push({ x: (rng() * 2 - 1) * 0.5, y: (rng() * 2 - 1) * 0.5,
                 r: 0.25 + rng() * 0.3, d: 0.07 + rng() * 0.07 });
  }
  const craters = [];
  for (let i = 0; i < 24; i++) {
    craters.push({ x: (rng() * 2 - 1) * 0.8, y: (rng() * 2 - 1) * 0.8,
                   r: 0.035 + rng() * 0.085, d: 0.1 + rng() * 0.15 });
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
        const limb = 0.9 + 0.1 * Math.sqrt(Math.max(0, 1 - (d / R) ** 2));
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
