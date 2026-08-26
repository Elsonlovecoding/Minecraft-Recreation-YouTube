// ui/world_select.js — the title screen (the save pass). Shown before ANY
// game object exists: the world's seed, name, mode and saved state all have
// to be known before the generator is constructed, so unlike every other
// overlay this one gates init() itself — main.js awaits the promise this
// module returns and only then boots the world it names.
//
// Layout follows the real game's singleplayer flow: a list of saved worlds
// (most recently played first) each with Play and Delete, and a Create New
// World form — name, optional seed (numbers reproduce a world exactly,
// words hash, blank rolls random), and the mode picked at creation the way
// vanilla does it. Delete asks twice: the first click arms the button, the
// second commits (a saved world is hours of somebody's life).
//
// Harness scaffolding: window.__worldSelect exposes list/createAndPlay/play
// so the Playwright drivers can boot a deterministic world without DOM
// clicks (the chooseMode pattern, one screen earlier).

import { parseSeed } from '../systems/persistence.js';
import { SURVIVAL, CREATIVE_MODE } from '../player/gamemode.js';

const MODE_LABEL = { [SURVIVAL]: 'Survival', [CREATIVE_MODE]: 'Creative' };

export function showWorldSelect({ saves }) {
  const style = document.createElement('style');
  style.textContent = `
    body.mc-worldselect-open #lock-hint,
    body.mc-worldselect-open #hud-hotbar, body.mc-worldselect-open #hud-hearts,
    body.mc-worldselect-open #hud-hunger, body.mc-worldselect-open #hud-armour,
    body.mc-worldselect-open #hud-absorb, body.mc-worldselect-open #hud-breath,
    body.mc-worldselect-open #hud-mode, body.mc-worldselect-open #hud-crosshair,
    body.mc-worldselect-open #hud-toast, body.mc-worldselect-open #hud-effects {
      display: none !important;
    }
    #world-select {
      position: fixed; inset: 0; z-index: 30; display: flex;
      flex-direction: column; align-items: center; justify-content: center;
      background: linear-gradient(180deg, rgba(8, 12, 22, 0.94), rgba(4, 6, 12, 0.97));
      user-select: none; font-family: monospace;
    }
    #world-select h1 {
      color: #fff; font: bold 52px/1 monospace; margin: 0 0 6px;
      text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.65);
    }
    .ws-sub { color: #c8c8c8; font-size: 14px; margin: 0 0 22px;
      text-shadow: 2px 2px 0 rgba(0,0,0,0.6); }
    .ws-list {
      width: 460px; max-height: 260px; overflow-y: auto; margin-bottom: 18px;
      border: 2px solid #000; background: rgba(0, 0, 0, 0.35);
    }
    .ws-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .ws-row-info { flex: 1; min-width: 0; }
    .ws-row-name {
      color: #fff; font-weight: bold; font-size: 15px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .ws-row-meta { color: #9a9a9a; font-size: 11px; margin-top: 3px; }
    .ws-empty { color: #9a9a9a; font-size: 13px; padding: 16px; text-align: center; }
    .ws-btn {
      font: bold 13px/1 monospace; color: #e8e8e8; background: #6f6f6f;
      padding: 8px 14px; cursor: pointer; text-align: center;
      border: 2px solid; border-color: #a8a8a8 #2f2f2f #2f2f2f #a8a8a8;
    }
    .ws-btn:hover { background: #7f8caf; color: #ffffa0; }
    .ws-btn-danger:hover, .ws-btn.ws-armed { background: #a05050; color: #fff; }
    .ws-form {
      width: 460px; display: flex; flex-direction: column; gap: 10px;
      border: 2px solid #000; background: rgba(0, 0, 0, 0.35); padding: 14px;
    }
    .ws-form-title { color: #ffd479; font-weight: bold; font-size: 14px; }
    .ws-form input {
      font: 14px monospace; padding: 8px 10px; color: #fff;
      background: #1a1a1a; border: 2px solid #000; outline: none;
    }
    .ws-form input:focus { border-color: #7f8caf; }
    .ws-mode-row { display: flex; gap: 10px; }
    .ws-mode-row .ws-btn { flex: 1; }
    .ws-btn.ws-selected { background: #4a6a4a; color: #b8ffb8; }
    .ws-create { padding: 12px; font-size: 15px; }
    .ws-foot { color: #b4b4b4; font-size: 11px; margin-top: 18px;
      text-shadow: 1px 1px 0 rgba(0,0,0,0.7); }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'world-select';
  root.innerHTML = `
    <h1>Minecraft</h1>
    <p class="ws-sub">Singleplayer — choose a world, or create one.</p>
    <div class="ws-list" id="ws-list"></div>
    <div class="ws-form">
      <div class="ws-form-title">Create New World</div>
      <input id="ws-name" maxlength="32" placeholder="World name" value="New World">
      <input id="ws-seed" maxlength="32"
        placeholder="Seed (optional — blank for random)">
      <div class="ws-mode-row">
        <button class="ws-btn ws-selected" id="ws-mode-survival">Survival</button>
        <button class="ws-btn" id="ws-mode-creative">Creative</button>
      </div>
      <button class="ws-btn ws-create" id="ws-create">Create World</button>
    </div>
    <div class="ws-foot">Progress saves automatically — every 20 seconds,
      on pause, and when you leave the page.</div>
  `;
  document.body.appendChild(root);
  document.body.classList.add('mc-worldselect-open');

  const list = root.querySelector('#ws-list');
  const nameInput = root.querySelector('#ws-name');
  const seedInput = root.querySelector('#ws-seed');
  const survivalBtn = root.querySelector('#ws-mode-survival');
  const creativeBtn = root.querySelector('#ws-mode-creative');
  let mode = SURVIVAL;
  const syncModeButtons = () => {
    survivalBtn.classList.toggle('ws-selected', mode === SURVIVAL);
    creativeBtn.classList.toggle('ws-selected', mode === CREATIVE_MODE);
  };
  survivalBtn.addEventListener('click', () => { mode = SURVIVAL; syncModeButtons(); });
  creativeBtn.addEventListener('click', () => { mode = CREATIVE_MODE; syncModeButtons(); });

  let resolveChoice;
  const choice = new Promise((res) => { resolveChoice = res; });
  let done = false;

  function finish(result) {
    if (done) return;
    done = true;
    root.remove();
    document.body.classList.remove('mc-worldselect-open');
    resolveChoice(result);
  }

  async function play(id) {
    const data = await saves.loadWorld(id);
    if (!data) return; // vanished (deleted in another tab) — list refreshes
    finish({ record: data.record, data });
  }

  async function createAndPlay(name, chosenMode, seedText) {
    if (done) return null; // a second call must not create an orphan world
    const record = await saves.createWorld({
      name,
      mode: chosenMode,
      seed: parseSeed(seedText),
    });
    finish({ record, data: null }); // a new world has nothing saved yet
    return record;
  }

  async function refreshList() {
    const worlds = await saves.listWorlds();
    list.textContent = '';
    if (worlds.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ws-empty';
      empty.textContent = 'No worlds yet — create your first one below.';
      list.appendChild(empty);
      return;
    }
    for (const w of worlds) {
      const row = document.createElement('div');
      row.className = 'ws-row';
      const info = document.createElement('div');
      info.className = 'ws-row-info';
      const name = document.createElement('div');
      name.className = 'ws-row-name';
      name.textContent = w.name;
      const meta = document.createElement('div');
      meta.className = 'ws-row-meta';
      const played = w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : '—';
      meta.textContent = `${MODE_LABEL[w.mode] ?? w.mode} · seed ${w.seed} · ${played}`;
      info.appendChild(name);
      info.appendChild(meta);
      const playBtn = document.createElement('button');
      playBtn.className = 'ws-btn';
      playBtn.textContent = 'Play';
      playBtn.addEventListener('click', () => play(w.id));
      const delBtn = document.createElement('button');
      delBtn.className = 'ws-btn ws-btn-danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        if (!delBtn.classList.contains('ws-armed')) {
          delBtn.classList.add('ws-armed'); // first click arms...
          delBtn.textContent = 'Sure?';
          setTimeout(() => {
            delBtn.classList.remove('ws-armed');
            delBtn.textContent = 'Delete';
          }, 3000);
          return;
        }
        await saves.deleteWorld(w.id); // ...second click commits
        refreshList();
      });
      row.appendChild(info);
      row.appendChild(playBtn);
      row.appendChild(delBtn);
      list.appendChild(row);
    }
  }

  root.querySelector('#ws-create').addEventListener('click', () => {
    createAndPlay(nameInput.value, mode, seedInput.value);
  });

  refreshList();

  // Harness scaffolding (the __menus.chooseMode pattern, one screen earlier).
  window.__worldSelect = {
    list: () => saves.listWorlds(),
    play,
    createAndPlay,
  };

  return choice;
}

// The LOADING SCREEN ("immediate load"): shown the moment a world is
// chosen, while main.js builds the ENTIRE view ring at full CPU speed —
// the real game's "Generating world" moment. The bar is honest: its
// fraction is meshed chunks over the ring's true cell count.
export function showLoadingScreen(worldName) {
  const root = document.createElement('div');
  root.id = 'world-loading';
  root.innerHTML = `
    <style>
      #world-loading {
        position: fixed; inset: 0; z-index: 29; display: flex;
        flex-direction: column; align-items: center; justify-content: center;
        background: linear-gradient(180deg, rgba(8, 12, 22, 0.96), rgba(4, 6, 12, 0.98));
        font-family: monospace; user-select: none;
      }
      #world-loading h2 {
        color: #fff; font: bold 26px/1 monospace; margin: 0 0 8px;
        text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.65);
      }
      #wl-sub { color: #c8c8c8; font-size: 13px; margin: 0 0 26px; }
      #wl-bar-frame {
        width: 420px; height: 18px; border: 2px solid #000;
        background: #1a1a1a; box-shadow: 0 0 0 2px #4a4a4a;
      }
      #wl-bar {
        height: 100%; width: 0%; background: #3fb950;
        transition: width 0.15s linear;
      }
      #wl-pct { color: #9a9a9a; font-size: 12px; margin-top: 10px; }
    </style>
    <h2>Generating world</h2>
    <p id="wl-sub"></p>
    <div id="wl-bar-frame"><div id="wl-bar"></div></div>
    <div id="wl-pct">0%</div>
  `;
  root.querySelector('#wl-sub').textContent = worldName;
  document.body.appendChild(root);
  document.body.classList.add('mc-worldselect-open'); // keeps the HUD hidden
  const bar = root.querySelector('#wl-bar');
  const pct = root.querySelector('#wl-pct');
  return {
    setProgress(meshed, target) {
      const f = Math.min(1, meshed / Math.max(1, target));
      bar.style.width = (f * 100).toFixed(1) + '%';
      pct.textContent = `${(f * 100).toFixed(0)}% — ${meshed} / ${target} chunks`;
    },
    done() {
      root.remove();
      document.body.classList.remove('mc-worldselect-open');
    },
  };
}
