// ui/hud.js — HUD: hotbar, health hearts, hunger, crosshair. Phase 5 ships
// the crosshair and the breath (bubble) meter; hotbar/hearts/hunger arrive
// with the inventory and stats phases.

import { PLAYER } from '../config.js';

let breathRow = null;
let bubbles = [];

export function initHud() {
  const style = document.createElement('style');
  style.textContent = `
    #hud-crosshair {
      position: fixed; left: 50%; top: 50%; width: 18px; height: 18px;
      transform: translate(-50%, -50%); pointer-events: none; z-index: 5;
      mix-blend-mode: difference;
    }
    #hud-crosshair::before, #hud-crosshair::after {
      content: ''; position: absolute; background: #ddd;
    }
    #hud-crosshair::before { left: 8px; top: 0; width: 2px; height: 18px; }
    #hud-crosshair::after { left: 0; top: 8px; width: 18px; height: 2px; }
    #hud-breath {
      position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%);
      display: none; pointer-events: none; z-index: 5;
    }
    #hud-breath .bubble {
      display: inline-block; width: 12px; height: 12px; margin: 0 1px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #eaf6ff, #7db8e8 60%, #3d78b8);
      border: 1px solid rgba(20, 40, 80, 0.55);
    }
  `;
  document.head.appendChild(style);

  const crosshair = document.createElement('div');
  crosshair.id = 'hud-crosshair';
  // Only aim while actually playing — otherwise the crosshair draws over
  // the centred "Click to play" hint.
  crosshair.style.display = 'none';
  document.addEventListener('pointerlockchange', () => {
    crosshair.style.display = document.pointerLockElement ? 'block' : 'none';
  });
  document.body.appendChild(crosshair);

  breathRow = document.createElement('div');
  breathRow.id = 'hud-breath';
  bubbles = [];
  for (let i = 0; i < PLAYER.BREATH_BUBBLES; i++) {
    const b = document.createElement('span');
    b.className = 'bubble';
    breathRow.appendChild(b);
    bubbles.push(b);
  }
  document.body.appendChild(breathRow);
}

// Call once per frame with the player controller. The breath meter only
// shows while air is missing (underwater or just surfaced), like vanilla.
export function updateHud(player) {
  if (!breathRow) return;
  const frac = player.breath / player.maxBreath;
  breathRow.style.display = frac < 1 ? 'block' : 'none';
  if (frac >= 1) return;
  const shown = Math.ceil(frac * bubbles.length);
  for (let i = 0; i < bubbles.length; i++) {
    bubbles[i].style.visibility = i < shown ? 'visible' : 'hidden';
  }
}
