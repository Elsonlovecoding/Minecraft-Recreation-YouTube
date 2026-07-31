// ui/debug.js — debug overlay: fps, coords, chunk count (chunks later).
// Also Phase 2 console diagnostics for terrain data (profile, columns, census).

import { DEBUG, OVERWORLD, CHUNK } from '../config.js';
import { BLOCK, blockDef } from '../world/blocks.js';

let overlay = null;
let smoothedFps = 0;
let timeSinceUpdate = 0;

export function initDebug() {
  overlay = document.createElement('div');
  overlay.id = 'debug-overlay';
  overlay.style.cssText = [
    'position: fixed',
    'top: 8px',
    'left: 8px',
    'color: #fff',
    'background: rgba(0, 0, 0, 0.45)',
    'font: 12px/1.6 monospace',
    'padding: 6px 10px',
    'border-radius: 3px',
    'pointer-events: none',
    'white-space: pre',
    'z-index: 10',
  ].join(';');
  document.body.appendChild(overlay);
}

// Call once per frame with the frame delta (seconds), the camera, and
// optionally the world's streamStats() and the day fraction (0 sunrise,
// 0.25 noon, 0.5 sunset, 0.75 midnight) for the extra readouts.
export function updateDebug(delta, camera, stats = null, timeOfDay = null) {
  if (!overlay || delta <= 0) return;

  // Exponential moving average keeps the readout steady
  const instant = 1 / delta;
  smoothedFps = smoothedFps === 0 ? instant : smoothedFps * 0.95 + instant * 0.05;

  timeSinceUpdate += delta;
  if (timeSinceUpdate < DEBUG.HUD_UPDATE_INTERVAL) return;
  timeSinceUpdate = 0;

  const p = camera.position;
  overlay.textContent =
    `FPS ${Math.round(smoothedFps)}\n` +
    `XYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}` +
    (stats ? `\nCHUNKS ${stats.meshed} meshed / ${stats.loaded} loaded` : '') +
    (timeOfDay !== null ? `\nTIME ${timeOfDay.toFixed(3)} (${timeLabel(timeOfDay)})` : '');
}

function timeLabel(t) {
  if (t < 0.05 || t >= 0.95) return 'sunrise';
  if (t < 0.45) return 'day';
  if (t < 0.56) return 'sunset';
  return 'night';
}

// ---------------------------------------------------------------------------
// Terrain diagnostics (Phase 2: prove the data is right before rendering it)
// ---------------------------------------------------------------------------

const BIOME_LETTER = { plains: 'p', forest: 'f', desert: 'd', mountains: 'M' };

// ASCII side-view of the heightmap along a line of constant z:
// '#' terrain, '~' water, letters underneath mark the dominant biome.
export function logTerrainProfile(world, { x0 = -64, x1 = 64, z = 0 } = {}) {
  const xs = [];
  for (let x = x0; x <= x1; x++) xs.push(x);
  const heights = xs.map((x) => world.getHeight(x, z));
  const biomes = xs.map((x) => world.getBiome(x, z));

  const sea = OVERWORLD.SEA_LEVEL;
  const yTop = Math.max(...heights, sea) + 2;
  const yBot = Math.min(...heights, sea) - 3;
  const step = Math.max(1, Math.ceil((yTop - yBot) / 40));

  const lines = [];
  for (let y = yTop; y >= yBot; y -= step) {
    let row = '';
    for (let i = 0; i < xs.length; i++) {
      if (y <= heights[i]) row += '#';
      else if (y <= sea) row += '~';
      else row += ' ';
    }
    lines.push(String(y).padStart(4) + ' |' + row);
  }
  lines.push('     +' + '-'.repeat(xs.length));
  lines.push('      ' + biomes.map((b) => BIOME_LETTER[b]).join(''));
  console.log(
    `[terrain] height profile z=${z}, x=${x0}..${x1} ` +
    `(min ${Math.min(...heights)}, max ${Math.max(...heights)}, sea ${sea})\n` +
    lines.join('\n'),
  );
}

// Prints one column as run-length block spans from the top down.
export function logColumn(world, x, z) {
  const spans = [];
  let runId = null;
  let runTop = 0;
  for (let y = OVERWORLD.MIN_Y + CHUNK.HEIGHT - 1; y >= OVERWORLD.MIN_Y; y--) {
    const id = world.getBlock(x, y, z);
    if (id !== runId) {
      if (runId !== null && runId !== BLOCK.AIR) {
        const bottom = y + 1;
        spans.push(
          (runTop === bottom ? `y ${runTop}` : `y ${runTop}..${bottom}`) +
          ` ${blockDef(runId).name}`,
        );
      }
      runId = id;
      runTop = y;
    }
  }
  if (runId !== null && runId !== BLOCK.AIR) {
    spans.push(`y ${runTop}..${OVERWORLD.MIN_Y} ${blockDef(runId).name}`);
  }
  console.log(
    `[terrain] column x=${x} z=${z} biome=${world.getBiome(x, z)} ` +
    `height=${world.getHeight(x, z)}\n  ` + spans.join('\n  '),
  );
}

// Counts every non-air block across loaded chunks — a quick sanity check
// that water, trees, bedrock etc. actually exist in the data.
export function logBlockCensus(world) {
  const counts = new Map();
  world.forEachChunk((chunk) => {
    for (const id of chunk.blocks) {
      if (id !== BLOCK.AIR) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  });
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `  ${blockDef(id).name.padEnd(14)} ${n}`);
  console.log(
    `[terrain] block census over ${world.loadedChunkCount} chunks:\n` + rows.join('\n'),
  );
}
