// render/sky_fx.js — the Phase 24 sky furniture: the cloud layer, the night
// starfield, and the generated sun/moon textures (a square sun inside a soft
// atmospheric glow; the eight-phase square moon). Split out of
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
// fragment shader grows soft cumulus from fbm value noise — a very-low-
// frequency weather gate groups the masses with real clear sky between,
// fake self-shading comes from the density gradient probed toward the sun,
// and thin edges catch a warm silver lining when they sit near a low sun.
// A second, faint cirrus plane rides higher for depth. The pattern lives in
// WORLD space (the plane follows the camera but the noise is sampled at
// world coordinates plus the drift offset), so flying never slides the sky.
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
// Terrain still occludes both passes through the ordinary depth test, and
// the cirrus veil is colour-only — the sun showing THROUGH cirrus is the
// realistic read.

const CLOUD_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Density + shading shared by both passes and the cirrus (via defines).
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
    return s * 1.032; // 5-octave sum renormalised toward 0..1
  }
  // Cloud density 0..1 at a noise-space point: the fbm body thresholded
  // inside the weather gate.
  float cloudDensity(vec2 np) {
    // The gate MODULATES coverage rather than zeroing it — a low weather
    // cell thins the sky out, it never empties it entirely.
    float gate = smoothstep(0.30, 0.72,
      cnoise(np * GATE_SCALE) * 0.65 + cnoise(np * GATE_SCALE * 2.63 + 41.3) * 0.35);
    float t = 1.0 - uCover * (0.58 + 0.42 * gate);
    float body = smoothstep(t, t + SOFTNESS, cfbm(np));
    // Steepen the interior: cores saturate to solid cloud while the outer
    // ramp keeps its feathered edge — the puffy-cumulus read.
    return body * body * (3.0 - 2.0 * body);
  }
  void main() {
    vec2 np = vWorld.xz * NOISE_SCALE + uOffset;
    float dens = cloudDensity(np);
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
      // Self-shading: probe the density toward the sun — the lit side of a
      // puff is the side the gradient falls away from.
      vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-4));
      float toSun = cloudDensity(np + sunXZ * LIGHT_EPS);
      float lit = clamp(0.5 + (dens - toSun) * LIGHT_GAIN, 0.0, 1.0);
      // Thin cloud reads brighter (light passes through it).
      lit = clamp(lit + (1.0 - dens) * 0.35, 0.0, 1.0);
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
    LIGHT_EPS: C.LIGHT_EPS.toFixed(4),
    LIGHT_GAIN: C.LIGHT_GAIN.toFixed(4),
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

  // Pass 2 — the visible layer, after the stars and sun/moon.
  const colorMat = makeMaterial({ depthWrite: false });
  const colorMesh = new THREE.Mesh(geometry, colorMat);
  colorMesh.renderOrder = -1.1;

  // The cirrus veil: colour-only, its own scale/coverage, never occludes.
  const cirrusMat = makeMaterial({ depthWrite: false }, {
    NOISE_SCALE: C.CIRRUS.SCALE.toFixed(8),
    OPACITY: C.CIRRUS.OPACITY.toFixed(4),
    SOFTNESS: '0.34',
    CLOUD_SEED: (C.SEED + 111.1).toFixed(4),
  });
  cirrusMat.uniforms.uCover.value = C.CIRRUS.COVER;
  const cirrusMesh = new THREE.Mesh(geometry, cirrusMat);
  cirrusMesh.renderOrder = -1.12;

  const group = new THREE.Group();
  group.add(depthMesh);
  group.add(colorMesh);
  group.add(cirrusMesh);
  for (const m of [depthMesh, colorMesh, cirrusMesh]) m.frustumCulled = false;

  const mats = [depthMat, colorMat, cirrusMat];
  const NOISE_PERIOD = 512; // the hash lattice wrap (see chash)
  let drift = 0;
  let cirrusDrift = 0;
  const white = new THREE.Color(1, 1, 1);
  const tinted = new THREE.Color();
  const silver = new THREE.Color();

  return {
    mesh: group,
    // The planes follow the camera; the PATTERN stays world-anchored
    // because the shader samples world position plus a bounded drift
    // offset (wrapped at the noise lattice period, so precision holds
    // through arbitrarily long days).
    update(delta, focus) {
      drift = (drift + delta * C.SPEED * C.SCALE) % NOISE_PERIOD;
      cirrusDrift = (cirrusDrift + delta * C.CIRRUS.SPEED * C.CIRRUS.SCALE) % NOISE_PERIOD;
      depthMesh.position.set(focus.x, C.HEIGHT, focus.z);
      colorMesh.position.set(focus.x, C.HEIGHT, focus.z);
      cirrusMesh.position.set(focus.x, C.CIRRUS.HEIGHT, focus.z);
      depthMat.uniforms.uOffset.value.set(drift, 0);
      colorMat.uniforms.uOffset.value.set(drift, 0);
      cirrusMat.uniforms.uOffset.value.set(cirrusDrift, 0);
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

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

const hexRgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

// The sun: a bright ROUND disc with a soft radial glow — rendered additively
// so the halo melts into whatever sky is behind it. Two rules keep the quad
// invisible (the follow-up fix — "the sun shouldn't have that box around
// it", and it had one): the glow is WINDOWED so it reaches exactly zero
// before the quad rim (the old exponential still carried alpha ~16/255 at
// the edge, which additive blending drew as a faint square against the
// sky), and the texture filters LINEARLY (Nearest magnification turned the
// smooth gradient into visible stair-stepped blocks). The moon keeps its
// pixel-art Nearest filtering — that one is meant to look blocky.
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
// soft cool radial glow on an additive quad behind the pixel moon, built by
// the sun-glow rules — windowed to exactly zero before the quad rim (no
// box) and linear-filtered (a gradient, not pixel art).
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

// The eight moon phases as separate small textures — the vanilla square
// moon, its unlit part left as a faint disc. Phase 0 is full; the
// terminator is the classic ellipse, waning through new (4) and waxing back.
export function createMoonTextures() {
  const P = 32;
  const phases = [];
  const [lr, lg, lb] = hexRgb(CELESTIAL.MOON_LIT_COLOR);
  const darkAlpha = Math.round(CELESTIAL.MOON_DARK_ALPHA * 255);
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
        const bulge = Math.sqrt(Math.max(0, 1 - yn * yn));
        let lit;
        if (phase === 0) lit = true;
        else if (phase === 4) lit = false;
        else if (phase < 4) lit = xn < Math.cos((Math.PI * phase) / 4) * bulge;
        else lit = xn > -Math.cos((Math.PI * (8 - phase)) / 4) * bulge;
        // A hashed speckle keeps the face from reading as flat plastic.
        let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) | 0;
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
        const grain = 0.88 + ((h >>> 8) & 0xff) / 255 * 0.12;
        const i = (y * P + x) * 4;
        if (lit) {
          img.data[i] = Math.round(lr * grain);
          img.data[i + 1] = Math.round(lg * grain);
          img.data[i + 2] = Math.round(lb * grain);
          img.data[i + 3] = 255;
        } else {
          img.data[i] = 24;
          img.data[i + 1] = 28;
          img.data[i + 2] = 44;
          img.data[i + 3] = darkAlpha;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    phases.push(canvasTexture(canvas));
  }
  return phases;
}
