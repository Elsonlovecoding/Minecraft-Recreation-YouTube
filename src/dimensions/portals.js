// dimensions/portals.js — Phase 15: the Nether portal. Frame detection
// (valid obsidian rectangle, SPEC minimum 4x5 outer, corners optional),
// lighting with flint and steel (player/interaction.js routes the click
// here), the animated portal interior blocks (rendered by world/chunks.js),
// standing-in-the-portal travel with the 1:8 coordinate scaling, linked
// portal reuse/creation on the far side, portal break-down when the frame
// or interior is disturbed, and the purple particles + procedural ambience
// around active portals.
//
// The portal registry is per dimension and lives here (NOT swapped with the
// dimension managers — travel needs both sides at once). Every portal in a
// run passes through lightFrame, so the registry is complete; there is no
// world persistence to resurrect unknown portals.

import * as THREE from 'three';
import { PORTALS, NETHER, PLAYER, OVERWORLD, CHUNK } from '../config.js';
import { BLOCK, isSolid } from '../world/blocks.js';

// ---------------------------------------------------------------------------
// Pure frame detection (node-testable)
// ---------------------------------------------------------------------------

// Given any candidate interior cell (usually the cell in front of the face
// the player clicked with flint and steel), find the portal frame around
// it: an axis-aligned rectangle of obsidian — full bottom and top bars,
// full side columns, corners not required — enclosing an all-air interior
// of at least (MIN_WIDTH-2) x (MIN_HEIGHT-2) and at most MAX_INTERIOR each
// way. Returns { axis: 'x'|'z', x0, y0, z0, width, height } for the
// interior's minimum corner, or null.
export function detectFrame(getBlock, x, y, z) {
  if (getBlock(x, y, z) !== BLOCK.AIR) return null;
  return (
    detectFrameAxis(getBlock, x, y, z, 'x') ??
    detectFrameAxis(getBlock, x, y, z, 'z')
  );
}

function detectFrameAxis(getBlock, x, y, z, axis) {
  const dx = axis === 'x' ? 1 : 0;
  const dz = axis === 'x' ? 0 : 1;
  const MAXI = PORTALS.MAX_INTERIOR;
  const MINW = PORTALS.NETHER_FRAME_MIN_WIDTH - 2;   // interior spans
  const MINH = PORTALS.NETHER_FRAME_MIN_HEIGHT - 2;

  // Fall to the interior's bottom row, then slide to its low end.
  let by = y;
  let guard = MAXI + 1;
  while (guard-- > 0 && getBlock(x, by - 1, z) === BLOCK.AIR) by--;
  if (guard < 0) return null;
  let bx = x;
  let bz = z;
  guard = MAXI + 1;
  while (guard-- > 0 && getBlock(bx - dx, by, bz - dz) === BLOCK.AIR) {
    bx -= dx;
    bz -= dz;
  }
  if (guard < 0) return null;

  // Interior width: the air run along the bottom row, capped by obsidian.
  let width = 0;
  while (
    width <= MAXI &&
    getBlock(bx + dx * width, by, bz + dz * width) === BLOCK.AIR
  ) width++;
  if (width < MINW || width > MAXI) return null;
  if (getBlock(bx + dx * width, by, bz + dz * width) !== BLOCK.OBSIDIAN) return null;
  if (getBlock(bx - dx, by, bz - dz) !== BLOCK.OBSIDIAN) return null;

  // Bottom bar under every interior column.
  for (let i = 0; i < width; i++) {
    if (getBlock(bx + dx * i, by - 1, bz + dz * i) !== BLOCK.OBSIDIAN) return null;
  }

  // Rows upward: all-air interior walled by obsidian at both ends, until
  // the all-obsidian top bar closes the frame.
  let height = 0;
  let closed = false;
  while (height <= MAXI) {
    const ry = by + height;
    let allObsidian = true;
    let allAir = true;
    for (let i = 0; i < width; i++) {
      const id = getBlock(bx + dx * i, ry, bz + dz * i);
      if (id !== BLOCK.OBSIDIAN) allObsidian = false;
      if (id !== BLOCK.AIR) allAir = false;
    }
    if (allObsidian) {
      closed = true;
      break;
    }
    if (!allAir) return null; // something other than air inside the frame
    if (getBlock(bx - dx, ry, bz - dz) !== BLOCK.OBSIDIAN) return null;
    if (getBlock(bx + dx * width, ry, bz + dz * width) !== BLOCK.OBSIDIAN) return null;
    height++;
  }
  if (!closed || height < MINH || height > MAXI) return null;
  return { axis, x0: bx, y0: by, z0: bz, width, height };
}

// Interior cells of a detected frame as [{x, y, z}, ...].
export function frameInteriorCells(frame) {
  const dx = frame.axis === 'x' ? 1 : 0;
  const dz = frame.axis === 'x' ? 0 : 1;
  const cells = [];
  for (let h = 0; h < frame.height; h++) {
    for (let i = 0; i < frame.width; i++) {
      cells.push({
        x: frame.x0 + dx * i,
        y: frame.y0 + h,
        z: frame.z0 + dz * i,
      });
    }
  }
  return cells;
}

// Frame (obsidian) cells: bottom and top bars plus both side columns.
// Corners deliberately excluded — they are optional, so their state can
// never validate or invalidate a portal.
export function frameObsidianCells(frame) {
  const dx = frame.axis === 'x' ? 1 : 0;
  const dz = frame.axis === 'x' ? 0 : 1;
  const cells = [];
  for (let i = 0; i < frame.width; i++) {
    cells.push({ x: frame.x0 + dx * i, y: frame.y0 - 1, z: frame.z0 + dz * i });
    cells.push({
      x: frame.x0 + dx * i, y: frame.y0 + frame.height, z: frame.z0 + dz * i,
    });
  }
  for (let h = 0; h < frame.height; h++) {
    cells.push({ x: frame.x0 - dx, y: frame.y0 + h, z: frame.z0 - dz });
    cells.push({
      x: frame.x0 + dx * frame.width, y: frame.y0 + h, z: frame.z0 + dz * frame.width,
    });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Procedural ambience (WebAudio, failure-silent — the combat synth pattern)
// ---------------------------------------------------------------------------

let audioCtx = null;
let noiseBuffer = null;

function ensureAudio() {
  if (audioCtx !== null) return audioCtx;
  try {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

// A one-shot swept noise burst (ignition shimmer, travel whoosh).
function sweep({ seconds, volume, from, to }) {
  if (volume <= 0.01) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.5;
    const t = ctx.currentTime;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
    src.stop(t + seconds + 0.05);
  } catch {
    // never let a sound failure touch gameplay
  }
}

// ---------------------------------------------------------------------------
// The portal system
// ---------------------------------------------------------------------------

// `dimensions` is dimensions/dimensions.js (activeKey + switchTo); `world`
// is the single World instance whose guts the switch swaps; `player` the
// controller (body teleports on travel); `stats` gates travel while dead.
// `camera` is snapped to the arrival eye during travel — the controller
// only re-derives it from the body on the NEXT player.update, and the rest
// of this frame (chunk streaming, the render) must not run from the stale
// pre-travel position, which would unload the freshly prebuilt arrival
// meshes and draw one frame of void.
export function createPortals({ world, scene, player, stats, camera, dimensions }) {
  const getBlock = (x, y, z) => world.getBlock(x, y, z);
  // Phase 19: the End has a registry list too — every per-frame walk over
  // the active dimension's portals must stay safe there (the End travel
  // crash: registry['end'] was undefined). Nether portals still can't be
  // LIT in the End (tryIgnite gates), like vanilla.
  const registry = { overworld: [], nether: [], end: [] };
  let standTimer = 0;
  let arrivalHold = false; // no re-trigger until the player steps out
  let suppressListener = false;

  const keyOf = (c) => `${c.x},${c.y},${c.z}`;

  function register(dimKey, frame) {
    const interior = frameInteriorCells(frame);
    const entry = {
      ...frame,
      cellList: interior,
      cells: new Set(interior.map(keyOf)),
      frame: new Set(frameObsidianCells(frame).map(keyOf)),
    };
    registry[dimKey].push(entry);
    return entry;
  }

  // Fill a detected frame's interior with portal blocks and register it.
  function lightFrame(frame) {
    for (const c of frameInteriorCells(frame)) {
      world.setBlock(c.x, c.y, c.z, BLOCK.NETHER_PORTAL);
    }
    return register(dimensions.activeKey, frame);
  }

  // Flint-and-steel click on a block face (interaction.js): the cell in
  // front of the clicked face is the ignition point; a valid frame around
  // it lights. Returns true when a portal lit (the caller wears the tool).
  function tryIgnite(target) {
    if (!target) return false;
    // No nether portals light in the End (vanilla — the travel pair below
    // only links the overworld and the Nether).
    if (dimensions.activeKey === 'end') return false;
    const [fx, fy, fz] = target.face;
    if (fx === 0 && fy === 0 && fz === 0) return false;
    const frame = detectFrame(getBlock, target.x + fx, target.y + fy, target.z + fz);
    if (!frame) return false;
    lightFrame(frame);
    sweep({ seconds: 0.9, volume: 0.5, from: 300, to: 2400 }); // ignition shimmer
    return true;
  }

  // Any disturbed frame or interior cell breaks the whole portal (the
  // interior blocks wink out; obsidian stays to be re-lit). Only the
  // ACTIVE dimension can see block changes — frozen dimensions can't edit.
  function onBlockChanged(x, y, z, id) {
    if (suppressListener) return;
    const list = registry[dimensions.activeKey];
    const k = `${x},${y},${z}`;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (
        (p.frame.has(k) && id !== BLOCK.OBSIDIAN) ||
        (p.cells.has(k) && id !== BLOCK.NETHER_PORTAL)
      ) {
        suppressListener = true;
        for (const c of p.cellList) {
          if (world.getBlock(c.x, c.y, c.z) === BLOCK.NETHER_PORTAL) {
            world.setBlock(c.x, c.y, c.z, BLOCK.AIR);
          }
        }
        suppressListener = false;
        list.splice(i, 1);
      }
    }
  }

  // Nearest registered portal (horizontal distance to the interior's
  // centre) within LINK_SEARCH_RADIUS of the scaled arrival point.
  function nearestPortal(list, tx, tz) {
    let best = null;
    let bestD = PORTALS.LINK_SEARCH_RADIUS;
    for (const p of list) {
      const cx = p.x0 + (p.axis === 'x' ? p.width / 2 : 0.5);
      const cz = p.z0 + (p.axis === 'z' ? p.width / 2 : 0.5);
      const d = Math.hypot(cx - tx, cz - tz);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  // A standable Nether arrival column (Phase 16): the highest solid,
  // non-lava floor with CLEARANCE air cells above it, scanned strictly
  // inside the bedrock shell — the overworld rule (highest solid column)
  // would land on TOP of the ceiling. Lava floors fail isSolid, so an
  // ocean column reports nothing rather than a portal in the lava.
  function netherFloorY(x, z) {
    const P = PORTALS.NETHER_PLACE;
    for (let y = NETHER.CEILING_Y - 1 - P.CLEARANCE; y > NETHER.MIN_Y + 1; y--) {
      if (!isSolid(getBlock(x, y - 1, z))) continue;
      let clear = true;
      for (let d = 0; d < P.CLEARANCE; d++) {
        if (getBlock(x, y + d, z) !== BLOCK.AIR) {
          clear = false;
          break;
        }
      }
      if (clear) return y;
    }
    return null;
  }

  // Build the minimum 4x5 frame at the scaled arrival point in the ACTIVE
  // (destination) dimension, standing on the local ground — the bottom bar
  // replaces the surface row so the player walks out flush — and light it.
  // In the Nether (Phase 16) the ground is found by spiralling columns out
  // from the scaled point for real interior floor; if the area offers none
  // (a lava ocean, solid rock), a sheltered netherrack pocket is carved
  // around the frame at the traveller's own height, above the lava sea.
  function createLinkedPortal(axis, tx, tz, ty) {
    const dx = axis === 'x' ? 1 : 0;
    const dz = axis === 'x' ? 0 : 1;
    let by;
    if (dimensions.activeKey === 'nether') {
      let found = null;
      const R = PORTALS.NETHER_PLACE.SEARCH_RADIUS;
      outer: for (let r = 0; r <= R; r++) {
        for (let oz = -r; oz <= r; oz++) {
          for (let ox = -r; ox <= r; ox++) {
            if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
            const y = netherFloorY(tx + ox, tz + oz);
            if (y !== null) {
              found = { x: tx + ox, z: tz + oz, y };
              break outer;
            }
          }
        }
      }
      if (found) {
        tx = found.x;
        tz = found.z;
        by = found.y;
      } else {
        // No natural ground anywhere near: carve a closed netherrack
        // pocket (a little cave with a floor) and put the frame in it.
        by = Math.min(
          Math.max(Math.round(ty ?? NETHER.LAVA_SEA_Y + 8), NETHER.LAVA_SEA_Y + 3),
          NETHER.CEILING_Y - 10,
        );
        for (let i = -2; i <= 3; i++) {
          for (let c = -2; c <= 2; c++) {
            for (let r = -2; r <= 4; r++) {
              const cx = tx + dx * i + (1 - dx) * c;
              const cz = tz + dz * i + (1 - dz) * c;
              const cy = by + r;
              // Shell all around, plus a full floor at r = -1 flush with
              // the frame's bottom bar (the player steps out level).
              const solid =
                i === -2 || i === 3 || c === -2 || c === 2 ||
                r === -2 || r === 4 || r === -1;
              world.setBlock(cx, cy, cz, solid ? BLOCK.NETHERRACK : BLOCK.AIR);
            }
          }
        }
      }
    } else {
      const ground = world.getHighestSolidY(tx, tz);
      by = Math.min(
        Math.max(ground + 1, OVERWORLD.MIN_Y + 2),
        OVERWORLD.MIN_Y + CHUNK.HEIGHT - 6,
      );
    }
    for (let i = -1; i <= 2; i++) {
      for (let r = -1; r <= 3; r++) {
        const cx = tx + dx * i;
        const cy = by + r;
        const cz = tz + dz * i;
        if (i === -1 || i === 2 || r === -1 || r === 3) {
          world.setBlock(cx, cy, cz, BLOCK.OBSIDIAN);
        }
      }
    }
    const frame = { axis, x0: tx, y0: by, z0: tz, width: 2, height: 3 };
    return lightFrame(frame);
  }

  // The trip itself: scale coordinates (divide by 8 entering the Nether,
  // multiply by 8 leaving — SPEC), switch the live dimension, reuse a
  // registered portal near the arrival point or build a fresh linked one,
  // and step the player into it.
  function travel() {
    const fromKey = dimensions.activeKey;
    const destKey = fromKey === 'nether' ? 'overworld' : 'nether';
    const body = player.body;
    const p = body.position;
    const feet = {
      x: Math.floor(p.x), y: Math.floor(p.y + 0.05), z: Math.floor(p.z),
    };
    const source = registry[fromKey].find((e) => e.cells.has(keyOf(feet))) ??
      registry[fromKey][0] ?? null;
    const ratio = NETHER.COORD_RATIO;
    const tx = destKey === 'nether' ? Math.floor(p.x / ratio) : Math.floor(p.x * ratio);
    const tz = destKey === 'nether' ? Math.floor(p.z / ratio) : Math.floor(p.z * ratio);

    dimensions.switchTo(destKey);
    const dest = nearestPortal(registry[destKey], tx, tz) ??
      createLinkedPortal(source?.axis ?? 'x', tx, tz, p.y);

    // Arrive standing inside the destination portal's bottom row.
    p.x = dest.x0 + (dest.axis === 'x' ? dest.width / 2 : 0.5);
    p.y = dest.y0;
    p.z = dest.z0 + (dest.axis === 'z' ? dest.width / 2 : 0.5);
    body.velocity.x = 0;
    body.velocity.y = 0;
    body.velocity.z = 0;
    body.fallDistance = 0;
    camera.position.set(p.x, p.y + PLAYER.EYE_HEIGHT, p.z);
    arrivalHold = true;
    standTimer = 0;
    world.prebuild(p); // the arrival area meshes before the next frame
    sweep({
      seconds: 1.1, volume: PORTALS.AMBIENCE.WHOOSH_VOLUME, from: 1400, to: 140,
    });
  }

  // -------------------------------------------------------------------------
  // Particles + hum
  // -------------------------------------------------------------------------

  const P = PORTALS.PARTICLES;
  const particleTexture = (() => {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 16);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const particleGeometry = new THREE.BufferGeometry();
  const pPos = new Float32Array(P.COUNT * 3);
  const pCol = new Float32Array(P.COUNT * 3);
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const particlePoints = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      map: particleTexture,
      size: P.SIZE,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
    }),
  );
  particlePoints.frustumCulled = false;
  scene.add(particlePoints);
  const particles = [];
  for (let i = 0; i < P.COUNT; i++) {
    particles.push({ life: 0, maxLife: 1, x: 0, y: -1e6, z: 0, vx: 0, vy: 0, vz: 0 });
    pPos[i * 3 + 1] = -1e6;
  }
  let candidateCells = []; // active-dim portal cells near the player
  let candidateTimer = 0;

  function refreshCandidates() {
    candidateCells = [];
    const p = player.body.position;
    for (const entry of registry[dimensions.activeKey]) {
      for (const c of entry.cellList) {
        if (
          Math.abs(c.x + 0.5 - p.x) <= P.RANGE &&
          Math.abs(c.z + 0.5 - p.z) <= P.RANGE &&
          Math.abs(c.y + 0.5 - p.y) <= P.RANGE
        ) {
          candidateCells.push(c);
        }
      }
    }
  }

  function updateParticles(dt) {
    candidateTimer -= dt;
    if (candidateTimer <= 0) {
      candidateTimer = 0.5;
      refreshCandidates();
    }
    for (let i = 0; i < P.COUNT; i++) {
      const pt = particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        if (candidateCells.length === 0) {
          pPos[i * 3 + 1] = -1e6;
          continue;
        }
        const c = candidateCells[Math.floor(Math.random() * candidateCells.length)];
        pt.x = c.x + Math.random();
        pt.y = c.y + Math.random();
        pt.z = c.z + Math.random();
        pt.vx = (Math.random() * 2 - 1) * P.DRIFT_SPEED;
        pt.vy = (Math.random() * 2 - 1) * P.DRIFT_SPEED;
        pt.vz = (Math.random() * 2 - 1) * P.DRIFT_SPEED;
        pt.maxLife = P.LIFE_SECONDS * (0.5 + Math.random() * 0.5);
        pt.life = pt.maxLife;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.z += pt.vz * dt;
      pPos[i * 3] = pt.x;
      pPos[i * 3 + 1] = pt.y;
      pPos[i * 3 + 2] = pt.z;
      // Purple fading to black — invisible under additive blending.
      const f = Math.max(0, pt.life / pt.maxLife);
      pCol[i * 3] = 0.55 * f;
      pCol[i * 3 + 1] = 0.15 * f;
      pCol[i * 3 + 2] = 0.85 * f;
    }
    particleGeometry.attributes.position.needsUpdate = true;
    particleGeometry.attributes.color.needsUpdate = true;
  }

  // The low whispering hum near an active portal: a looping filtered noise
  // whose gain follows proximity. Created lazily; every failure is silent.
  let hum = null;

  function updateHum(dt) {
    const p = player.body.position;
    let nearest = Infinity;
    for (const c of candidateCells) {
      const d = Math.hypot(c.x + 0.5 - p.x, c.y + 0.5 - p.y, c.z + 0.5 - p.z);
      if (d < nearest) nearest = d;
    }
    const A = PORTALS.AMBIENCE;
    const volume = nearest > A.RANGE ? 0
      : A.VOLUME * (1 - nearest / A.RANGE);
    if (volume <= 0 && !hum) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      if (!hum) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 220;
        filter.Q.value = 6;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        src.start();
        hum = { gain, clock: 0 };
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      hum.clock += dt;
      const wobble = 0.8 + 0.2 * Math.sin(hum.clock * 1.7);
      hum.gain.gain.value = volume * wobble;
    } catch {
      hum = null;
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame update: the stand-in-portal timer and travel trigger
  // -------------------------------------------------------------------------

  function update(dt) {
    const body = player.body;
    const p = body.position;
    const inPortal =
      getBlock(Math.floor(p.x), Math.floor(p.y + 0.05), Math.floor(p.z)) ===
        BLOCK.NETHER_PORTAL ||
      getBlock(Math.floor(p.x), Math.floor(p.y + PLAYER.EYE_HEIGHT), Math.floor(p.z)) ===
        BLOCK.NETHER_PORTAL;

    if (inPortal && !stats.dead) {
      if (!arrivalHold) {
        standTimer += dt;
        if (standTimer >= PORTALS.NETHER_STAND_SECONDS) travel();
      }
    } else {
      standTimer = 0;
      arrivalHold = false;
    }

    updateParticles(dt);
    updateHum(dt);
  }

  return {
    update,
    tryIgnite,
    onBlockChanged,
    registry,   // read-only by convention (debug/tests)
    get standFraction() {
      return Math.min(1, standTimer / PORTALS.NETHER_STAND_SECONDS);
    },
  };
}
