// ui/menus.js — Phase 25: the menus that frame a session. The save pass
// moved the old START SCREEN's job one screen earlier: the world-select
// title screen (ui/world_select.js) now picks the world AND its mode
// before init() even builds the generator, so this module keeps only the
// in-game pause menu (plus a chooseMode shim for the old harnesses).
//
//   PAUSE MENU     Esc mid-game. Says which mode is running and offers the
//                  other one. Switching is applied the moment the button is
//                  pressed — the world is frozen behind the overlay, so by
//                  the time play resumes the new mode is already in force,
//                  with no reload, nothing regenerated and nothing dropped.
//                  The inventory is untouched by design: gamemode.set only
//                  flips a flag (player/gamemode.js), so whatever the player
//                  is carrying carries straight over in both directions.
//
// The pause overlay is pointer-events: none EXCEPT for its panel, so clicking
// anywhere else still falls through to the canvas and resumes play — the
// click-to-play behaviour the game has had since Phase 5.

import { UI } from '../config.js';
import { gamemode, SURVIVAL, CREATIVE_MODE } from '../player/gamemode.js';

const CONTROLS_HINT =
  'WASD move · Space jump · Shift sneak · double-tap W (or Ctrl) sprint<br>' +
  'E inventory · 1-9 / scroll select · F offhand · mouse dig / place · F4 debug fly';

const CREATIVE_HINT =
  'Creative: double-tap Space to fly · Space up · Shift down<br>' +
  'E opens the creative inventory · blocks are infinite · nothing can hurt you';

export function createMenus({ canvas }) {
  const style = document.createElement('style');
  style.textContent = `
    /* Both menus own the screen while they are up, so the old click-to-play
       hint would only double them. */
    body.mc-menu-open #lock-hint { display: none; }
    .mc-menu {
      position: fixed; inset: 0; z-index: 25; display: none;
      flex-direction: column; align-items: center; justify-content: center;
      user-select: none;
    }
    #pause-menu {
      background: rgba(0, 0, 0, 0.55);
      pointer-events: none; /* clicks fall through to the canvas = resume */
    }
    .mc-menu h1 {
      color: #ffffff; font: bold 40px/1 monospace; margin: 0 0 6px;
      text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.65);
    }
    .mc-menu-sub {
      color: #c8c8c8; font: 14px/1.6 monospace; margin: 0 0 26px;
      text-align: center; text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.6);
    }
    .mc-menu-panel {
      pointer-events: auto;
      display: flex; flex-direction: column; align-items: center;
    }
    .mc-menu-row { display: flex; gap: 18px; }
    .mc-btn {
      font: bold 16px/1 monospace; color: #e8e8e8; background: #6f6f6f;
      padding: 14px 34px; cursor: pointer; min-width: 210px; text-align: center;
      border: 2px solid; border-color: #a8a8a8 #2f2f2f #2f2f2f #a8a8a8;
      box-shadow: 0 0 0 2px #000;
    }
    .mc-btn:hover { background: #7f8caf; color: #ffffa0; }
    .mc-btn-blurb {
      color: #b8b8b8; font: 11px/1.5 monospace; margin-top: 8px;
      max-width: 250px; text-align: center;
    }
    .mc-choice { display: flex; flex-direction: column; align-items: center; }
    #pause-mode {
      color: #ffd479; font: bold 15px/1 monospace; margin: 0 0 18px;
      text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.6);
    }
    .mc-menu-foot {
      color: #b4b4b4; font: 11px/1.7 monospace; margin-top: 22px;
      text-align: center; text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.7);
    }
  `;
  document.head.appendChild(style);

  // The start screen is GONE (see the header): mode is a property of the
  // world now, chosen at creation on the world-select screen. This shim
  // keeps the old harness entry point alive — it just applies a mode and
  // asks for pointer lock.
  function chooseMode(mode) {
    gamemode.set(mode);
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  }

  // --- the pause menu -------------------------------------------------------

  const pause = document.createElement('div');
  pause.className = 'mc-menu';
  pause.id = 'pause-menu';
  const pauseTitle = document.createElement('h1');
  pauseTitle.textContent = 'Game Paused';
  const pauseMode = document.createElement('p');
  pauseMode.id = 'pause-mode';
  const pausePanel = document.createElement('div');
  pausePanel.className = 'mc-menu-panel';
  const resumeBtn = document.createElement('button');
  resumeBtn.className = 'mc-btn';
  resumeBtn.id = 'pause-resume';
  resumeBtn.textContent = 'Back to Game';
  const switchBtn = document.createElement('button');
  switchBtn.className = 'mc-btn';
  switchBtn.id = 'pause-switch';
  switchBtn.style.marginTop = '12px';
  const pauseFoot = document.createElement('div');
  pauseFoot.className = 'mc-menu-foot';
  pausePanel.appendChild(resumeBtn);
  pausePanel.appendChild(switchBtn);
  pause.appendChild(pauseTitle);
  pause.appendChild(pauseMode);
  pause.appendChild(pausePanel);
  pause.appendChild(pauseFoot);
  document.body.appendChild(pause);

  resumeBtn.addEventListener('click', () => {
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  });

  // The switch itself. Applied here and now: the world is frozen behind this
  // overlay, so "immediately on unpause" and "immediately" are the same
  // moment — and the labels below update in place so the player can SEE it
  // took before they go back.
  switchBtn.addEventListener('click', () => {
    gamemode.toggle();
    syncPauseText();
  });

  function syncPauseText() {
    pauseMode.textContent = `Mode: ${gamemode.label}`;
    switchBtn.textContent = `Switch to ${gamemode.labelOf(gamemode.other)}`;
    pauseFoot.innerHTML = gamemode.creative ? CREATIVE_HINT : CONTROLS_HINT;
  }
  syncPauseText();
  gamemode.subscribe(syncPauseText);

  let pauseShown = false;

  function syncMenuClass() {
    document.body.classList.toggle('mc-menu-open', pauseShown);
  }

  // Called every frame from main.js with its own pause verdict (main.js
  // additionally gates on everLocked, so the fresh-boot "click to play"
  // moment shows the lock hint, not this).
  function setPaused(paused) {
    const want = !!paused && gamemode.chosen;
    if (want === pauseShown) return;
    pauseShown = want;
    pause.style.display = want ? 'flex' : 'none';
    if (want) syncPauseText();
    syncMenuClass();
  }

  return {
    setPaused,
    get pauseShown() {
      return pauseShown;
    },
    // Test/debug scaffolding: pick a mode without a real click.
    chooseMode,
  };
}
