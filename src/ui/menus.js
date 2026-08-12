// ui/menus.js — Phase 25: the two menus that frame a session.
//
//   START SCREEN   shown on load, before anything is playable: Survival or
//                  Creative. Nothing runs until one is picked (main.js's
//                  pause state already freezes the world whenever the
//                  pointer is unlocked, and this overlay is what keeps it
//                  unlocked), so the choice is genuinely made before the
//                  first frame of play.
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
    /* Nothing has begun yet behind the start screen, so the HUD has nothing
       to say — an empty hotbar and a full heart row under the title would
       only read as clutter. */
    body.mc-start-open #hud-hotbar, body.mc-start-open #hud-hearts,
    body.mc-start-open #hud-hunger, body.mc-start-open #hud-armour,
    body.mc-start-open #hud-absorb, body.mc-start-open #hud-breath,
    body.mc-start-open #hud-mode, body.mc-start-open #hud-crosshair,
    body.mc-start-open #hud-toast, body.mc-start-open #hud-effects {
      display: none !important;
    }
    .mc-menu {
      position: fixed; inset: 0; z-index: 25; display: none;
      flex-direction: column; align-items: center; justify-content: center;
      user-select: none;
    }
    #start-menu {
      background: linear-gradient(180deg, rgba(8, 12, 22, 0.92), rgba(4, 6, 12, 0.96));
    }
    #pause-menu {
      background: rgba(0, 0, 0, 0.55);
      pointer-events: none; /* clicks fall through to the canvas = resume */
    }
    .mc-menu h1 {
      color: #ffffff; font: bold 40px/1 monospace; margin: 0 0 6px;
      text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.65);
    }
    #start-menu h1 { font-size: 52px; margin-bottom: 10px; }
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

  // --- the start screen -----------------------------------------------------

  const start = document.createElement('div');
  start.className = 'mc-menu';
  start.id = 'start-menu';
  const startTitle = document.createElement('h1');
  startTitle.textContent = 'Minecraft';
  const startSub = document.createElement('p');
  startSub.className = 'mc-menu-sub';
  startSub.innerHTML = 'Choose how you want to play.<br>You can switch at any time from the pause menu.';
  const choices = document.createElement('div');
  choices.className = 'mc-menu-row mc-menu-panel';

  const makeChoice = (mode, label, blurb) => {
    const wrap = document.createElement('div');
    wrap.className = 'mc-choice';
    const btn = document.createElement('button');
    btn.className = 'mc-btn';
    btn.id = `start-${mode}`;
    btn.textContent = label;
    const note = document.createElement('div');
    note.className = 'mc-btn-blurb';
    note.textContent = blurb;
    btn.addEventListener('click', () => chooseMode(mode));
    wrap.appendChild(btn);
    wrap.appendChild(note);
    return wrap;
  };

  choices.appendChild(makeChoice(
    SURVIVAL, 'Survival',
    'Start with nothing. Gather, craft, mine, fight, and take on the Ender Dragon.',
  ));
  choices.appendChild(makeChoice(
    CREATIVE_MODE, 'Creative',
    'Fly, break anything instantly, and build with every block in the game.',
  ));
  const startFoot = document.createElement('div');
  startFoot.className = 'mc-menu-foot';
  startFoot.innerHTML = CONTROLS_HINT;
  start.appendChild(startTitle);
  start.appendChild(startSub);
  start.appendChild(choices);
  start.appendChild(startFoot);
  document.body.appendChild(start);

  let startShown = true;
  start.style.display = 'flex';
  document.body.classList.add('mc-menu-open');
  document.body.classList.add('mc-start-open');

  function chooseMode(mode) {
    if (!startShown) return;
    gamemode.set(mode);
    startShown = false;
    start.style.display = 'none';
    document.body.classList.remove('mc-start-open');
    syncMenuClass();
    // This runs inside a real click, so the lock request is allowed.
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
    document.body.classList.toggle('mc-menu-open', startShown || pauseShown);
  }

  // Called every frame from main.js with its own pause verdict. The pause
  // menu never shows over the start screen, and never before the player has
  // actually begun playing (the first-boot freeze is the start screen's).
  function setPaused(paused) {
    const want = !!paused && !startShown && gamemode.chosen;
    if (want === pauseShown) return;
    pauseShown = want;
    pause.style.display = want ? 'flex' : 'none';
    if (want) syncPauseText();
    syncMenuClass();
  }

  return {
    setPaused,
    get startShown() {
      return startShown;
    },
    get pauseShown() {
      return pauseShown;
    },
    // Test/debug scaffolding: pick a mode without a real click.
    chooseMode,
  };
}
