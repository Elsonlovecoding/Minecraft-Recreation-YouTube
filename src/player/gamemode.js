// player/gamemode.js — Phase 25: SURVIVAL vs CREATIVE, the one place the
// game's mode lives.
//
// This is a module-level singleton, deliberately, on the render/particles.js
// and systems/audio.js pattern documented in ARCHITECTURE.md: anything that
// needs to know the mode imports `gamemode` and asks it. Threading a flag
// through a dozen factories would have meant touching every constructor
// signature in the project on the last session of the project, and every
// system that cares about the mode cares about ONE boolean.
//
// The whole of "creative mode" reduces to a handful of gates, each one a line
// in the system that already owns that rule — which is why there is no
// creative subsystem anywhere:
//
//   player/stats.js       damage/hunger/death do nothing         (invulnerable)
//   player/inventory.js   consume* and damage* are no-ops        (infinite, no wear)
//   player/interaction.js miningPlan returns time 0, drops false (instant break)
//   player/body.js        the flight integrator replaces gravity (flight)
//   entities/mobs.js      playerTargetable() is false            (mobs ignore you)
//   entities/dragon.js    the same gate                          (so does the dragon)
//   ui/hud.js             the health/hunger/armour rows hide     (no bars)
//   ui/screens.js         E opens ui/creative.js instead         (creative inventory)
//
// SWITCHING is live: `set()` swaps the flag and notifies subscribers, and
// nothing about the world, the inventory or the player's position is touched.
// main.js applies a switch when play resumes (the pause menu's button), which
// is what makes "no reload, no loss of world state, inventory kept" true by
// construction rather than by careful copying.

export const SURVIVAL = 'survival';
export const CREATIVE_MODE = 'creative';

const listeners = [];
let current = SURVIVAL;
// Set once the player has chosen on the start screen. Until then the game is
// paused behind that screen anyway; the flag lets main.js keep it paused.
let chosen = false;

export const gamemode = {
  get current() {
    return current;
  },

  get creative() {
    return current === CREATIVE_MODE;
  },

  get survival() {
    return current === SURVIVAL;
  },

  // Has the player picked a mode yet? False until the start screen resolves.
  get chosen() {
    return chosen;
  },

  // The mode NOT currently active — what the pause menu offers to switch to.
  get other() {
    return current === CREATIVE_MODE ? SURVIVAL : CREATIVE_MODE;
  },

  // Display name for the HUD badge and the menus.
  get label() {
    return current === CREATIVE_MODE ? 'Creative' : 'Survival';
  },

  labelOf(mode) {
    return mode === CREATIVE_MODE ? 'Creative' : 'Survival';
  },

  // Switch modes. Idempotent, and a no-op for an unknown name so a stray
  // call can never leave the game in a third state.
  set(mode) {
    if (mode !== SURVIVAL && mode !== CREATIVE_MODE) return;
    chosen = true;
    if (mode === current) return;
    current = mode;
    for (const fn of listeners) fn(current);
  },

  toggle() {
    this.set(this.other);
  },

  // Called by anything that must re-read the mode when it changes (the HUD
  // rows, the hand, the open screen). Fired on switch only — never on the
  // first choice from the start screen if it lands on the default, so
  // subscribers must render their initial state themselves.
  subscribe(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
};
