// ui/hud.js — HUD: crosshair, breath meter and (Phase 7) the hotbar — the
// inventory's first 9 slots with real item icons, stack counts, durability
// bars and the selected-slot highlight. Hearts and hunger arrive with the
// stats phase.

import { PLAYER, INVENTORY, UI } from '../config.js';
import { renderSlotContent } from './icons.js';

let breathRow = null;
let bubbles = [];
let slotEls = [];

export function initHud(inventory) {
  const iconPx = Math.round(UI.HOTBAR_SLOT_PX * UI.ICON_SCALE);
  const breathBottom = UI.HOTBAR_BOTTOM_PX + UI.HOTBAR_SLOT_PX + 16;
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
      position: fixed; left: 50%; bottom: ${breathBottom}px;
      transform: translateX(-50%);
      display: none; pointer-events: none; z-index: 5;
    }
    #hud-breath .bubble {
      display: inline-block; width: 12px; height: 12px; margin: 0 1px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #eaf6ff, #7db8e8 60%, #3d78b8);
      border: 1px solid rgba(20, 40, 80, 0.55);
    }
    #hud-hotbar {
      position: fixed; left: 50%; bottom: ${UI.HOTBAR_BOTTOM_PX}px;
      transform: translateX(-50%);
      display: flex; z-index: 5; pointer-events: none;
      background: rgba(12, 12, 12, 0.6);
      border: 2px solid rgba(0, 0, 0, 0.8);
      box-shadow: 0 0 0 2px rgba(190, 190, 190, 0.35);
    }
    .hud-slot {
      position: relative; box-sizing: border-box;
      width: ${UI.HOTBAR_SLOT_PX}px; height: ${UI.HOTBAR_SLOT_PX}px;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid;
      border-color: #2b2b2b rgba(255,255,255,0.28) rgba(255,255,255,0.28) #2b2b2b;
    }
    .hud-slot.selected::after {
      content: ''; position: absolute; inset: -5px;
      border: 3px solid #e8e8e8; border-radius: 2px;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(0,0,0,0.7);
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

  // --- hotbar
  const hotbar = document.createElement('div');
  hotbar.id = 'hud-hotbar';
  slotEls = [];
  for (let i = 0; i < INVENTORY.HOTBAR_SIZE; i++) {
    const slot = document.createElement('div');
    slot.className = 'hud-slot';
    hotbar.appendChild(slot);
    slotEls.push(slot);
  }
  document.body.appendChild(hotbar);

  const refresh = () => {
    for (let i = 0; i < slotEls.length; i++) {
      renderSlotContent(slotEls[i], inventory.get(i), iconPx);
      slotEls[i].classList.toggle('selected', i === inventory.selected);
    }
  };
  inventory.subscribe(refresh);
  refresh();
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
