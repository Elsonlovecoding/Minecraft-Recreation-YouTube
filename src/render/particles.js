// render/particles.js — Phase 22: the particle system. ONE pooled, capped
// simulation drawn in exactly TWO draw calls:
//
//   textured cubes  small cubes sampling a crop of a block's own atlas tile
//                   — break debris, footstep scuffs, landing bursts
//   flat cubes      untextured coloured cubes — smoke, embers, splashes,
//                   damage, death puffs, sparkles, portal swirls
//
// Both meshes read the SAME fixed-size pool (config PARTICLES.MAX). Nothing
// is allocated after init: a spawn past the cap recycles the oldest particle,
// so a creeper blast beside a lava lake with mobs dying costs a bounded,
// predictable amount of frame time. The per-particle state lives in flat
// typed arrays (struct-of-arrays) and the per-frame work is one linear pass
// that integrates and writes the instance attributes in the same loop.
//
// Rendering: an InstancedBufferGeometry over a unit cube plus a patched
// MeshBasicMaterial (the world/chunks.js pattern — patching rather than a
// raw ShaderMaterial keeps three's fog, colour-space and tone-mapping
// handling, so particles sit in the scene exactly like terrain does).
//
// Everything is reached through the module-level `particles` singleton so
// any system can emit without threading a dependency through its factory
// (the CHUNK_LIGHT_UNIFORMS pattern). Before init() every call is a no-op,
// which is what keeps the node test harnesses DOM-free.

import * as THREE from 'three';
import { PARTICLES, LIGHTING } from '../config.js';
import { faceTiles, hasCollision } from '../world/blocks.js';
import { getAtlasTexture, getUV, TILE } from './atlas.js';

const TAU = Math.PI * 2;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (range) => rand(range[0], range[1]);

// The renderer encodes linear -> sRGB on output, and three converts every
// material colour it is GIVEN the same way. Per-instance colours bypass that
// path, so the hex values in config (which are sRGB, like every other colour
// in this project) have to be decoded here or everything renders washed out
// — dark smoke came out pale grey until this went in. 256-entry table: the
// conversion runs once per spawned particle, never per frame.
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// Instance attribute layout, per particle:
//   aOffset  vec3  world position
//   aParams  vec3  size, yaw, pitch
//   aUvRect  vec3  atlas u0, v0, span (span 0 = flat colour)
//   aColor   vec4  rgb tint + alpha
function makeInstancedGeometry(max, textured) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = box.index;
  geometry.setAttribute('position', box.getAttribute('position'));
  geometry.setAttribute('normal', box.getAttribute('normal'));
  geometry.setAttribute('uv', box.getAttribute('uv'));
  const attr = (name, size) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, a);
    return a;
  };
  const buffers = {
    offset: attr('aOffset', 3),
    params: attr('aParams', 3),
    color: attr('aColor', 4),
    uvRect: textured ? attr('aUvRect', 3) : null,
  };
  geometry.instanceCount = 0;
  // The pool spans the whole world; culling it as one object would blink
  // every particle out whenever the (meaningless) shared bounds left view.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return { geometry, buffers };
}

// A MeshBasicMaterial that reads the per-instance attributes above. `map`
// (the block atlas) is only bound for the textured pass.
function makeMaterial(textured) {
  const material = new THREE.MeshBasicMaterial({
    map: textured ? getAtlasTexture() : null,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.FrontSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `
        attribute vec3 aOffset;
        attribute vec3 aParams;
        attribute vec4 aColor;
        ${textured ? 'attribute vec3 aUvRect;' : ''}
        varying vec4 vPColor;
        #include <common>
      `)
      .replace('#include <begin_vertex>', /* glsl */ `
        vec3 pScaled = position * aParams.x;
        float pcx = cos(aParams.z);
        float psx = sin(aParams.z);
        vec3 pPitched = vec3(
          pScaled.x,
          pScaled.y * pcx - pScaled.z * psx,
          pScaled.y * psx + pScaled.z * pcx
        );
        float pcy = cos(aParams.y);
        float psy = sin(aParams.y);
        vec3 transformed = vec3(
          pPitched.x * pcy + pPitched.z * psy,
          pPitched.y,
          -pPitched.x * psy + pPitched.z * pcy
        ) + aOffset;
        vPColor = aColor;
      `);
    if (textured) {
      // Override three's own uv transform with this instance's atlas crop.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvMapUv = aUvRect.xy + uv * aUvRect.z;',
      );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', 'varying vec4 vPColor;\n#include <common>')
      .replace('#include <color_fragment>', /* glsl */ `
        diffuseColor.rgb *= vPColor.rgb;
        diffuseColor.a *= vPColor.a;
        if (diffuseColor.a < 0.02) discard;
      `);
  };
  return material;
}

class ParticleSystem {
  constructor() {
    this.ready = false;
    this.live = 0;
    this.world = null;
    this.eye = new THREE.Vector3(0, 0, 0);
  }

  // main.js calls this once, after the atlas has loaded. `group` is the
  // scene (particles are world-space and dimension-agnostic: switching
  // dimensions clears them).
  init({ scene, world }) {
    if (this.ready) return;
    const max = PARTICLES.MAX;
    this.world = world;
    // Struct-of-arrays state. One linear pass touches all of it per frame.
    this.px = new Float32Array(max);
    this.py = new Float32Array(max);
    this.pz = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.vz = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.yaw = new Float32Array(max);
    this.pitch = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.r = new Float32Array(max);
    this.g = new Float32Array(max);
    this.b = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.u0 = new Float32Array(max);
    this.v0 = new Float32Array(max);
    this.uvSpan = new Float32Array(max);
    this.flags = new Uint8Array(max); // 1 collide, 2 shrink, 4 flicker

    const tex = makeInstancedGeometry(max, true);
    const flat = makeInstancedGeometry(max, false);
    this.texGeom = tex.geometry;
    this.texBuf = tex.buffers;
    this.flatGeom = flat.geometry;
    this.flatBuf = flat.buffers;
    this.texMesh = new THREE.Mesh(this.texGeom, makeMaterial(true));
    this.flatMesh = new THREE.Mesh(this.flatGeom, makeMaterial(false));
    for (const mesh of [this.texMesh, this.flatMesh]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.visible = false;
      scene.add(mesh);
    }
    this.ready = true;
  }

  // --- the pool -------------------------------------------------------------

  // Claim a slot. Past the cap the OLDEST particle (slot 0 after the
  // swap-remove compaction below is not strictly oldest, but it is the
  // longest-lived survivor) is recycled, so spawning never allocates and
  // never grows the frame cost.
  _claim() {
    if (this.live < PARTICLES.MAX) return this.live++;
    return 0;
  }

  // The one low-level spawn. Callers below shape it into an effect.
  _spawn(x, y, z, o) {
    if (!this.ready) return;
    const dx = x - this.eye.x;
    const dy = y - this.eye.y;
    const dz = z - this.eye.z;
    const cull = PARTICLES.CULL_DISTANCE;
    if (dx * dx + dy * dy + dz * dz > cull * cull) return;
    const i = this._claim();
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = o.vx ?? 0;
    this.vy[i] = o.vy ?? 0;
    this.vz[i] = o.vz ?? 0;
    const life = o.life ?? 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = o.size ?? 0.1;
    this.grav[i] = (o.gravity ?? 1) * PARTICLES.GRAVITY;
    this.drag[i] = o.drag ?? PARTICLES.DRAG;
    this.yaw[i] = Math.random() * TAU;
    this.pitch[i] = Math.random() * TAU;
    this.spin[i] = o.spin ?? rand(-4, 4);
    // `tint` is a LINEAR brightness multiplier (baked light); `color` is an
    // sRGB hex that has to be decoded first (see SRGB_TO_LINEAR above).
    const tint = o.tint ?? 1;
    const color = o.color ?? 0xffffff;
    this.r[i] = SRGB_TO_LINEAR[(color >> 16) & 0xff] * tint;
    this.g[i] = SRGB_TO_LINEAR[(color >> 8) & 0xff] * tint;
    this.b[i] = SRGB_TO_LINEAR[color & 0xff] * tint;
    this.alpha[i] = o.alpha ?? 1;
    this.u0[i] = o.u0 ?? 0;
    this.v0[i] = o.v0 ?? 0;
    this.uvSpan[i] = o.uvSpan ?? 0;
    this.flags[i] = (o.collide ? 1 : 0) | (o.shrink ? 2 : 0) | (o.flicker ? 4 : 0);
  }

  _remove(i) {
    const last = --this.live;
    if (i === last) return;
    const move = (a) => { a[i] = a[last]; };
    move(this.px); move(this.py); move(this.pz);
    move(this.vx); move(this.vy); move(this.vz);
    move(this.life); move(this.maxLife); move(this.size);
    move(this.grav); move(this.drag);
    move(this.yaw); move(this.pitch); move(this.spin);
    move(this.r); move(this.g); move(this.b); move(this.alpha);
    move(this.u0); move(this.v0); move(this.uvSpan);
    this.flags[i] = this.flags[last];
  }

  // A cell is solid for a particle only where a real collision box is, and
  // only while its chunk is loaded — reading an unloaded chunk would
  // regenerate it synchronously (the universal unloaded-chunk rule).
  _solidAt(x, y, z) {
    const world = this.world;
    if (!world) return false;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const cz = Math.floor(z);
    if (world.getChunkIfLoaded &&
      !world.getChunkIfLoaded(Math.floor(cx / 16), Math.floor(cz / 16))) return false;
    return hasCollision(world.getBlock(cx, cy, cz));
  }

  // Baked light at a point as a 0..1 brightness — particles are tinted by it
  // on SPAWN (never per frame), the entities/mobs.js rule.
  lightTint(x, y, z) {
    const world = this.world;
    if (!world?.getLight) return 1;
    const light = world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    if (!light) return 1;
    const level = Math.max(light.sky, light.block);
    return Math.max(0.25, LIGHTING.LIGHT_FALLOFF ** (15 - level));
  }

  // --- the per-frame pass ---------------------------------------------------

  // Integrates every live particle and writes both instance buffers in the
  // same loop. `eye` is the camera position (spawn culling + nothing else).
  update(dt, eye) {
    if (!this.ready) return;
    if (eye) this.eye.copy(eye);
    if (dt <= 0) {
      // Paused: keep whatever is on screen exactly where it is.
      return;
    }
    const collide = this.live <= PARTICLES.COLLIDE_MAX;
    const tex = this.texBuf;
    const flat = this.flatBuf;
    let nTex = 0;
    let nFlat = 0;
    for (let i = 0; i < this.live;) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this._remove(i);
        continue;
      }
      const damp = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= damp;
      this.vz[i] *= damp;
      this.vy[i] = this.vy[i] * damp - this.grav[i] * dt;
      const nx = this.px[i] + this.vx[i] * dt;
      const ny = this.py[i] + this.vy[i] * dt;
      const nz = this.pz[i] + this.vz[i] * dt;
      if ((this.flags[i] & 1) !== 0 && collide) {
        // Cheap axis-separated test: enough to stop debris sinking through
        // the floor and skating into walls, and it costs at most three
        // block lookups for the handful of particles that ask for it.
        if (this._solidAt(nx, this.py[i], this.pz[i])) this.vx[i] = 0;
        else this.px[i] = nx;
        if (this._solidAt(this.px[i], ny, this.pz[i])) {
          this.vy[i] = -this.vy[i] * PARTICLES.BOUNCE;
          this.vx[i] *= 0.6;
          this.vz[i] *= 0.6;
        } else this.py[i] = ny;
        if (this._solidAt(this.px[i], this.py[i], nz)) this.vz[i] = 0;
        else this.pz[i] = nz;
      } else {
        this.px[i] = nx;
        this.py[i] = ny;
        this.pz[i] = nz;
      }
      this.yaw[i] += this.spin[i] * dt;
      this.pitch[i] += this.spin[i] * 0.6 * dt;

      const frac = this.life[i] / this.maxLife[i];
      let a = this.alpha[i] * (frac > 0.4 ? 1 : frac / 0.4);
      if ((this.flags[i] & 4) !== 0) a *= 0.65 + 0.35 * Math.random();
      const size = (this.flags[i] & 2) !== 0
        ? this.size[i] * (0.35 + 0.65 * frac)
        : this.size[i];

      if (this.uvSpan[i] > 0) {
        const o3 = nTex * 3;
        tex.offset.array[o3] = this.px[i];
        tex.offset.array[o3 + 1] = this.py[i];
        tex.offset.array[o3 + 2] = this.pz[i];
        tex.params.array[o3] = size;
        tex.params.array[o3 + 1] = this.yaw[i];
        tex.params.array[o3 + 2] = this.pitch[i];
        tex.uvRect.array[o3] = this.u0[i];
        tex.uvRect.array[o3 + 1] = this.v0[i];
        tex.uvRect.array[o3 + 2] = this.uvSpan[i];
        const o4 = nTex * 4;
        tex.color.array[o4] = this.r[i];
        tex.color.array[o4 + 1] = this.g[i];
        tex.color.array[o4 + 2] = this.b[i];
        tex.color.array[o4 + 3] = a;
        nTex++;
      } else {
        const o3 = nFlat * 3;
        flat.offset.array[o3] = this.px[i];
        flat.offset.array[o3 + 1] = this.py[i];
        flat.offset.array[o3 + 2] = this.pz[i];
        flat.params.array[o3] = size;
        flat.params.array[o3 + 1] = this.yaw[i];
        flat.params.array[o3 + 2] = this.pitch[i];
        const o4 = nFlat * 4;
        flat.color.array[o4] = this.r[i];
        flat.color.array[o4 + 1] = this.g[i];
        flat.color.array[o4 + 2] = this.b[i];
        flat.color.array[o4 + 3] = a;
        nFlat++;
      }
      i++;
    }
    this._upload(this.texGeom, tex, nTex, this.texMesh);
    this._upload(this.flatGeom, flat, nFlat, this.flatMesh);
  }

  _upload(geometry, buffers, count, mesh) {
    geometry.instanceCount = count;
    mesh.visible = count > 0;
    if (count === 0) return;
    for (const key of ['offset', 'params', 'color', 'uvRect']) {
      const attr = buffers[key];
      if (!attr) continue;
      // Only the live prefix is dirty — never upload the whole pool.
      if (attr.clearUpdateRanges) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, count * attr.itemSize);
      } else if (attr.updateRange) {
        attr.updateRange.offset = 0;
        attr.updateRange.count = count * attr.itemSize;
      }
      attr.needsUpdate = true;
    }
  }

  // Dimension switches drop everything: particle coordinates mean nothing
  // in another world (the dimensions.js manager rule, simplified — there is
  // nothing worth storing).
  clear() {
    this.live = 0;
    if (!this.ready) return;
    this.texGeom.instanceCount = 0;
    this.flatGeom.instanceCount = 0;
    this.texMesh.visible = false;
    this.flatMesh.visible = false;
  }

  swapDimensionState() {
    this.clear();
    return null;
  }

  get count() {
    return this.live;
  }

  // --- textured emitters (block art) ---------------------------------------

  // A random crop of one of the block's faces, as an atlas uv rect.
  _blockCrop(blockId) {
    const tiles = faceTiles(blockId);
    if (!tiles) return null;
    const tile = tiles[2] ?? tiles[0]; // the top face reads best as debris
    const uv = getUV(tile);
    const span = (uv.u1 - uv.u0) * PARTICLES.ATLAS_CROP;
    return {
      u0: uv.u0 + Math.random() * (uv.u1 - uv.u0 - span),
      v0: uv.v0 + Math.random() * (uv.v1 - uv.v0 - span),
      span,
    };
  }

  // A burst of the block's own texture: breaking a block.
  blockBreak(x, y, z, blockId) {
    if (!this.ready) return;
    const C = PARTICLES.BREAK;
    const tint = this.lightTint(x + 0.5, y + 0.5, z + 0.5);
    for (let i = 0; i < C.COUNT; i++) {
      const crop = this._blockCrop(blockId);
      if (!crop) return;
      this._spawn(x + Math.random(), y + Math.random(), z + Math.random(), {
        vx: rand(-1, 1) * C.SPEED, vy: rand(0.2, 1) * C.SPEED, vz: rand(-1, 1) * C.SPEED,
        life: pick(C.LIFE), size: C.SIZE, gravity: C.GRAVITY, tint,
        u0: crop.u0, v0: crop.v0, uvSpan: crop.span, collide: true,
      });
    }
  }

  // A small puff at a freshly placed block (vanilla's place cloud).
  blockPlace(x, y, z, blockId) {
    if (!this.ready) return;
    const C = PARTICLES.PLACE;
    const tint = this.lightTint(x + 0.5, y + 0.5, z + 0.5);
    for (let i = 0; i < C.COUNT; i++) {
      const crop = this._blockCrop(blockId);
      if (!crop) return;
      this._spawn(x + Math.random(), y + rand(0, 0.4), z + Math.random(), {
        vx: rand(-1, 1) * C.SPEED, vy: rand(0.1, 0.8) * C.SPEED, vz: rand(-1, 1) * C.SPEED,
        life: pick(C.LIFE), size: C.SIZE, gravity: C.GRAVITY, tint,
        u0: crop.u0, v0: crop.v0, uvSpan: crop.span,
      });
    }
  }

  // Scuffs kicked up by a footstep, tinted to the block underfoot.
  footstep(x, y, z, blockId, sprinting) {
    if (!this.ready) return;
    const C = PARTICLES.STEP;
    const count = sprinting ? PARTICLES.SPRINT_STEP_COUNT : C.COUNT;
    const tint = this.lightTint(x, y + 0.5, z);
    for (let i = 0; i < count; i++) {
      const crop = this._blockCrop(blockId);
      if (!crop) return;
      this._spawn(x + rand(-0.25, 0.25), y + 0.06, z + rand(-0.25, 0.25), {
        vx: rand(-1, 1) * C.SPEED, vy: rand(0.3, 1) * C.SPEED, vz: rand(-1, 1) * C.SPEED,
        life: pick(C.LIFE), size: C.SIZE, gravity: C.GRAVITY, tint,
        u0: crop.u0, v0: crop.v0, uvSpan: crop.span,
      });
    }
  }

  // The bigger ring thrown out by landing from a fall.
  landing(x, y, z, blockId, fallBlocks) {
    if (!this.ready) return;
    const C = PARTICLES.LAND;
    const strength = Math.min(2.2, 0.6 + fallBlocks / 6);
    const tint = this.lightTint(x, y + 0.5, z);
    const count = Math.round(C.COUNT * Math.min(1.6, strength));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const speed = C.SPEED * strength * rand(0.4, 1);
      const crop = this._blockCrop(blockId);
      if (!crop) return;
      this._spawn(x + Math.cos(a) * 0.3, y + 0.06, z + Math.sin(a) * 0.3, {
        vx: Math.cos(a) * speed, vy: rand(0.2, 0.9) * speed, vz: Math.sin(a) * speed,
        life: pick(C.LIFE), size: C.SIZE, gravity: C.GRAVITY, tint,
        u0: crop.u0, v0: crop.v0, uvSpan: crop.span, collide: true,
      });
    }
  }

  // --- flat-colour emitters -------------------------------------------------

  splash(x, y, z, strength = 1) {
    const C = PARTICLES.SPLASH;
    const count = Math.round(C.COUNT * Math.min(2, strength));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const speed = C.SPEED * rand(0.25, 1) * Math.min(1.6, strength);
      this._spawn(x + Math.cos(a) * 0.25, y, z + Math.sin(a) * 0.25, {
        vx: Math.cos(a) * speed * 0.5, vy: rand(0.5, 1) * speed, vz: Math.sin(a) * speed * 0.5,
        life: pick(C.LIFE), size: C.SIZE, gravity: C.GRAVITY, color: C.COLOR, alpha: 0.85,
      });
    }
  }

  bubble(x, y, z) {
    const C = PARTICLES.BUBBLE;
    this._spawn(x + rand(-0.25, 0.25), y + rand(-0.2, 0.3), z + rand(-0.25, 0.25), {
      vy: C.RISE * rand(0.6, 1.4), life: pick(C.LIFE), size: C.SIZE,
      gravity: -0.05, drag: 0.4, color: C.COLOR, alpha: 0.8,
    });
  }

  ember(x, y, z) {
    const C = PARTICLES.EMBER;
    this._spawn(x + Math.random(), y + rand(0.9, 1.4), z + Math.random(), {
      vx: rand(-0.3, 0.3), vy: C.RISE * rand(0.4, 1.2), vz: rand(-0.3, 0.3),
      life: pick(C.LIFE), size: C.SIZE, gravity: -0.06, drag: 0.5,
      color: C.COLOR, flicker: true,
    });
  }

  lavaPop(x, y, z) {
    const C = PARTICLES.LAVA_POP;
    for (let i = 0; i < C.COUNT; i++) {
      this._spawn(x + Math.random(), y + 0.95, z + Math.random(), {
        vx: rand(-1, 1) * C.SPEED * 0.3, vy: rand(0.5, 1) * C.SPEED,
        vz: rand(-1, 1) * C.SPEED * 0.3,
        life: pick(C.LIFE), size: C.SIZE, gravity: C.GRAVITY, color: C.COLOR,
        flicker: true,
      });
    }
  }

  flame(x, y, z) {
    const C = PARTICLES.FLAME;
    this._spawn(x + rand(-0.06, 0.06), y + rand(0, 0.12), z + rand(-0.06, 0.06), {
      vy: C.RISE * rand(0.5, 1.4), life: pick(C.LIFE), size: C.SIZE,
      gravity: -0.04, drag: 0.9, color: C.COLOR, flicker: true, shrink: true,
    });
  }

  sparkle(x, y, z, color) {
    const C = PARTICLES.SPARKLE;
    this._spawn(x + rand(-0.45, 0.45), y + rand(-0.45, 0.45), z + rand(-0.45, 0.45), {
      vy: C.RISE * rand(-1, 1), life: pick(C.LIFE), size: C.SIZE,
      gravity: 0, drag: 1.2, color: color ?? C.COLOR, flicker: true,
    });
  }

  // Phase 26: an ambient dust mote — a tiny slow speck drifting down through
  // a shaft of light underground (systems/ambience.js finds the shafts).
  // Spawn-time light tint means a mote in the bright core of the shaft
  // glows while one at its edge dims, which is what sells the beam.
  dust(x, y, z) {
    const C = PARTICLES.DUST;
    this._spawn(x + Math.random(), y + Math.random(), z + Math.random(), {
      vx: rand(-C.DRIFT, C.DRIFT), vy: -C.SINK * rand(0.5, 1.4),
      vz: rand(-C.DRIFT, C.DRIFT),
      life: pick(C.LIFE), size: C.SIZE * rand(0.7, 1.3),
      gravity: 0, drag: 0.4, color: C.COLOR, flicker: true,
      tint: this.lightTint(x + 0.5, y + 0.5, z + 0.5),
    });
  }

  // --- the outdoor ambience (final pass) ------------------------------------

  // A leaf fluttering down from a canopy: a small crop of the leaf tile,
  // sinking slowly with sideways drift and a lazy tumble. Collides, so it
  // settles onto the ground for its last moments instead of clipping in.
  leaf(x, y, z) {
    const C = PARTICLES.LEAF;
    const uv = getUV(TILE.OAK_LEAVES);
    const span = (uv.u1 - uv.u0) * 0.35;
    this._spawn(x + Math.random(), y - 0.05, z + Math.random(), {
      vx: rand(-C.DRIFT, C.DRIFT), vy: -C.SINK * rand(0.6, 1.2),
      vz: rand(-C.DRIFT, C.DRIFT),
      life: pick(C.LIFE), size: C.SIZE * rand(0.8, 1.2),
      gravity: 0, drag: 0.25, spin: rand(-C.SPIN, C.SPIN),
      u0: uv.u0 + Math.random() * (uv.u1 - uv.u0 - span),
      v0: uv.v0 + Math.random() * (uv.v1 - uv.v0 - span),
      uvSpan: span, collide: true,
      tint: this.lightTint(x + 0.5, y + 0.5, z + 0.5),
    });
  }

  // A seed mote riding the daylight over open grass: a pale speck drifting
  // sideways, barely rising, catching the sun — the "pollen in the air"
  // that makes a meadow read as warm and ALIVE.
  seedMote(x, y, z) {
    const C = PARTICLES.SEED_MOTE;
    const a = Math.random() * TAU;
    this._spawn(x + Math.random(), y + rand(0.3, 1.8), z + Math.random(), {
      vx: Math.cos(a) * C.DRIFT * rand(0.4, 1),
      vy: C.RISE * rand(-0.5, 1.5),
      vz: Math.sin(a) * C.DRIFT * rand(0.4, 1),
      life: pick(C.LIFE), size: C.SIZE * rand(0.7, 1.4),
      gravity: 0, drag: 0.15, color: C.COLOR, flicker: true, alpha: 0.85,
    });
  }

  // A firefly over night grass: a warm green-gold point wandering slowly,
  // its light pulsing (the flicker flag). Full brightness on purpose — it
  // IS a light source, and the bloom pass turns the brightest frames into
  // a soft halo.
  firefly(x, y, z) {
    const C = PARTICLES.FIREFLY;
    const a = Math.random() * TAU;
    this._spawn(x + Math.random(), y + rand(0.5, 2.2), z + Math.random(), {
      vx: Math.cos(a) * C.DRIFT * rand(0.3, 1),
      vy: rand(-0.06, 0.09),
      vz: Math.sin(a) * C.DRIFT * rand(0.3, 1),
      life: pick(C.LIFE), size: C.SIZE * rand(0.8, 1.2),
      gravity: 0, drag: 0.35, color: C.COLOR, flicker: true,
    });
  }

  // Expanding smoke + debris: creepers, ghast fireballs, end crystals.
  explosion(x, y, z, radius = 3) {
    const C = PARTICLES.EXPLOSION;
    const S = PARTICLES.SMOKE;
    const scale = Math.max(0.5, radius / 3);
    for (let i = 0; i < Math.round(C.SMOKE * scale); i++) {
      const a = Math.random() * TAU;
      const t = Math.acos(rand(-1, 1));
      const speed = C.SPEED * rand(0.15, 1) * scale;
      this._spawn(x, y, z, {
        vx: Math.sin(t) * Math.cos(a) * speed,
        vy: Math.cos(t) * speed * 0.8 + 1.2,
        vz: Math.sin(t) * Math.sin(a) * speed,
        life: pick(S.LIFE) * scale, size: S.SIZE * rand(0.6, 1.5) * scale,
        gravity: -0.06, drag: 2.2, color: S.COLOR, alpha: 0.85, shrink: false,
      });
    }
    for (let i = 0; i < Math.round(C.DEBRIS * scale); i++) {
      const a = Math.random() * TAU;
      const t = Math.acos(rand(-1, 1));
      const speed = C.SPEED * rand(0.3, 1.3) * scale;
      this._spawn(x, y, z, {
        vx: Math.sin(t) * Math.cos(a) * speed,
        vy: Math.abs(Math.cos(t)) * speed,
        vz: Math.sin(t) * Math.sin(a) * speed,
        life: pick(C.DEBRIS_LIFE), size: C.DEBRIS_SIZE, gravity: 1,
        color: C.DEBRIS_COLOR, collide: true,
      });
    }
    // A bright core flash that fades fast — reads as the blast itself.
    for (let i = 0; i < 6; i++) {
      this._spawn(x, y, z, {
        life: 0.22, size: radius * rand(0.5, 1.1), gravity: 0, drag: 3,
        color: 0xffd9a0, alpha: 0.7, shrink: true,
      });
    }
  }

  // Red hit particles on the player or a mob.
  damage(x, y, z) {
    const C = PARTICLES.DAMAGE;
    for (let i = 0; i < C.COUNT; i++) {
      this._spawn(x + rand(-0.3, 0.3), y + rand(-0.3, 0.3), z + rand(-0.3, 0.3), {
        vx: rand(-1, 1) * C.SPEED, vy: rand(0, 1) * C.SPEED, vz: rand(-1, 1) * C.SPEED,
        life: pick(C.LIFE), size: C.SIZE, gravity: C.GRAVITY, color: C.COLOR,
      });
    }
  }

  // The puff any entity leaves when it dies.
  death(x, y, z, height = 1.6) {
    const C = PARTICLES.DEATH;
    for (let i = 0; i < C.COUNT; i++) {
      this._spawn(x + rand(-0.4, 0.4), y + Math.random() * height, z + rand(-0.4, 0.4), {
        vx: rand(-1, 1) * C.SPEED, vy: rand(0, 1) * C.SPEED, vz: rand(-1, 1) * C.SPEED,
        life: pick(C.LIFE), size: C.SIZE, gravity: C.GRAVITY, color: C.COLOR,
        alpha: 0.75, shrink: true, drag: 2.4,
      });
    }
  }

  pickup(x, y, z) {
    const C = PARTICLES.PICKUP;
    for (let i = 0; i < C.COUNT; i++) {
      this._spawn(x + rand(-0.2, 0.2), y + rand(-0.1, 0.3), z + rand(-0.2, 0.2), {
        vx: rand(-1, 1) * C.SPEED, vy: rand(0.2, 1) * C.SPEED, vz: rand(-1, 1) * C.SPEED,
        life: pick(C.LIFE), size: C.SIZE, gravity: -0.2, drag: 2, color: C.COLOR,
        flicker: true,
      });
    }
  }

  // The swirl around a portal block: particles drift inward on a spiral.
  portal(x, y, z, color) {
    const C = PARTICLES.PORTAL;
    const a = Math.random() * TAU;
    const r = C.RADIUS * rand(0.3, 1);
    this._spawn(x + 0.5 + Math.cos(a) * r, y + rand(0, 1.4), z + 0.5 + Math.sin(a) * r, {
      vx: -Math.cos(a) * r * 0.75, vy: rand(-0.3, 0.6), vz: -Math.sin(a) * r * 0.75,
      life: pick(C.LIFE), size: C.SIZE, gravity: 0, drag: 0.4,
      color: color ?? C.COLOR, flicker: true,
    });
  }

  // The enderman's teleport trail — a purple column at both ends of a blink.
  enderTrail(x, y, z, height = 2.9) {
    const C = PARTICLES.ENDER;
    for (let i = 0; i < C.COUNT; i++) {
      this._spawn(x + rand(-0.4, 0.4), y + Math.random() * height, z + rand(-0.4, 0.4), {
        vx: rand(-1, 1) * C.SPEED, vy: rand(-0.4, 1) * C.SPEED, vz: rand(-1, 1) * C.SPEED,
        life: pick(C.LIFE), size: C.SIZE, gravity: 0, drag: 1.6, color: C.COLOR,
        flicker: true,
      });
    }
  }
}

export const particles = new ParticleSystem();
