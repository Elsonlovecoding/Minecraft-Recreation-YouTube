// ui/debug.js — debug overlay: fps, coords, chunk count (chunks later).

import { DEBUG } from '../config.js';

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

// Call once per frame with the frame delta (seconds) and the camera.
export function updateDebug(delta, camera) {
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
    `XYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}`;
}
