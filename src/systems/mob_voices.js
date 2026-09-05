// systems/mob_voices.js — every mob has a VOICE ("animals all have sound").
// Before this the only mob sound in the game was one generic hurt yelp; now
// each type calls out on its own random timer — the cow's moo, the pig's
// grunt pair, the sheep's bleat, the chicken's cluck run (and the odd
// bawk), the zombie's groan, the skeleton's bone rattle, the spider's hiss
// and skitter, the enderman's purr or vwoop, the ghast's cry, the blaze's
// breath — synthesised like every other sound in this project (no
// recordings), spatialised at the animal, distance-faded by the audio
// system's hearing range. Creepers stay silent between fuses, as in
// vanilla.
//
// Scheduling lives HERE, not in a per-type AI: the mob manager already
// walks every mob each frame, so it calls tick(mob, dt) for live mobs in
// loaded chunks (frozen/unloaded mobs never speak) and the timer rides on
// the mob record. A herd guard caps how many voices land per second so
// twelve sheep in a pen never chorus, and passives call more rarely and
// more softly at night (animals sleep). While the game is paused the
// manager isn't ticked and the audio layer refuses to play, so nothing
// leaks through the pause overlay. Every knob: config AUDIO.MOB_VOICES.

import { AUDIO } from '../config.js';
import { audio } from './audio.js';

const V = AUDIO.MOB_VOICES;
const rand = (a, b) => a + Math.random() * (b - a);

// --- recipes -----------------------------------------------------------------
// audio.js's own vocabulary: a layer is a list of tone/noise parts. `p` is
// this call's pitch multiplier — every animal rolls its own around the
// type's PITCH, so a field of sheep never sounds like one sheep on repeat.

function grunt(at, p) {
  return [
    { kind: 'noise', at, filterType: 'bandpass', frequency: 640 * p, freqTo: 360 * p,
      q: 2.6, seconds: 0.11, volume: 0.34, attack: 0.008 },
    { kind: 'tone', at, type: 'square', freq: 230 * p, freqTo: 150 * p, seconds: 0.12,
      volume: 0.13, attack: 0.008, lowpass: 900 * p },
  ];
}

function cluck(at, p) {
  return [
    { kind: 'tone', at, type: 'triangle', freq: 940 * p, freqTo: 600 * p, seconds: 0.075,
      volume: 0.2, attack: 0.004, lowpass: 2600 },
    { kind: 'noise', at, filterType: 'bandpass', frequency: 2300 * p, q: 5, seconds: 0.035,
      volume: 0.12, attack: 0.002 },
  ];
}

function tick_(at, p, freq = 3200, vol = 0.18) {
  return { kind: 'noise', at, filterType: 'bandpass', frequency: freq * p, q: 7,
    seconds: 0.028, volume: vol, attack: 0.002 };
}

const RECIPES = {
  // A low moo: a rounded sawtooth gliding down with its sub, a hint of the
  // upper formant, and a breath of noise under it.
  cow: (p) => [
    { kind: 'tone', type: 'sawtooth', freq: 138 * p, freqTo: 96 * p, seconds: 0.95,
      volume: 0.30, attack: 0.09, lowpass: 560 * p, detune: -6 },
    { kind: 'tone', type: 'sine', freq: 69 * p, freqTo: 48 * p, seconds: 0.95,
      volume: 0.24, attack: 0.10 },
    { kind: 'tone', type: 'triangle', freq: 276 * p, freqTo: 192 * p, seconds: 0.7,
      volume: 0.07, attack: 0.12, lowpass: 900 },
    { kind: 'noise', filterType: 'bandpass', frequency: 420, q: 1.6, seconds: 0.5,
      volume: 0.05, attack: 0.08 },
  ],
  // Two nasal grunts, the second a touch higher.
  pig: (p) => [...grunt(0, p), ...grunt(0.17, p * 1.07)],
  // A bleat: two sawtooths a few cents apart beat against each other (the
  // wobble), a square body under them, a puff of noise on the attack.
  sheep: (p) => [
    { kind: 'tone', type: 'sawtooth', freq: 290 * p, freqTo: 248 * p, seconds: 0.55,
      volume: 0.14, attack: 0.03, lowpass: 1300 * p, detune: 22 },
    { kind: 'tone', type: 'sawtooth', freq: 290 * p, freqTo: 248 * p, seconds: 0.55,
      volume: 0.14, attack: 0.03, lowpass: 1300 * p, detune: -22 },
    { kind: 'tone', type: 'square', freq: 145 * p, freqTo: 124 * p, seconds: 0.5,
      volume: 0.06, attack: 0.03, lowpass: 700 },
    { kind: 'noise', filterType: 'bandpass', frequency: 1400, q: 2, seconds: 0.12,
      volume: 0.06, attack: 0.01 },
  ],
  // A run of three clucks; one time in four, a rising bawk instead.
  chicken: (p) => (Math.random() < 0.25
    ? [
      { kind: 'tone', type: 'triangle', freq: 640 * p, freqTo: 1150 * p, seconds: 0.16,
        volume: 0.2, attack: 0.01, lowpass: 2800 },
      { kind: 'tone', at: 0.16, type: 'triangle', freq: 1100 * p, freqTo: 700 * p,
        seconds: 0.2, volume: 0.18, attack: 0.005, lowpass: 2600 },
      { kind: 'noise', filterType: 'bandpass', frequency: 2400 * p, q: 3, seconds: 0.3,
        volume: 0.08, attack: 0.01 },
    ]
    : [...cluck(0, p), ...cluck(0.13, p * 1.04), ...cluck(0.27, p * 0.97)]),
  // A long low groan with a second, shorter "uhh" behind it.
  zombie: (p) => [
    { kind: 'tone', type: 'sawtooth', freq: 112 * p, freqTo: 84 * p, seconds: 1.1,
      volume: 0.26, attack: 0.18, lowpass: 430 * p },
    { kind: 'tone', type: 'sine', freq: 56 * p, freqTo: 42 * p, seconds: 1.1,
      volume: 0.2, attack: 0.15 },
    { kind: 'noise', filterType: 'lowpass', frequency: 320, seconds: 0.9,
      volume: 0.1, attack: 0.2 },
    { kind: 'tone', at: 0.55, type: 'sawtooth', freq: 100 * p, freqTo: 78 * p,
      seconds: 0.5, volume: 0.14, attack: 0.1, lowpass: 400 * p },
  ],
  // Dry bone ticks in an uneven run, with one hollow knock.
  skeleton: (p) => [
    tick_(0, p), tick_(0.06, p * 1.1), tick_(0.11, p * 0.95), tick_(0.19, p),
    tick_(0.24, p * 1.05), tick_(0.33, p * 0.9),
    { kind: 'tone', at: 0.19, type: 'square', freq: 240 * p, freqTo: 170 * p,
      seconds: 0.12, volume: 0.06, attack: 0.004, lowpass: 1200 },
  ],
  // A hiss with three skittering ticks inside it.
  spider: (p) => [
    { kind: 'noise', filterType: 'highpass', frequency: 2600 * p, seconds: 0.55,
      volume: 0.2, attack: 0.06, curve: 'linear' },
    { kind: 'noise', filterType: 'bandpass', frequency: 1300 * p, q: 1.2, seconds: 0.4,
      volume: 0.09, attack: 0.04 },
    tick_(0.10, p, 4000, 0.08), tick_(0.18, p, 4000, 0.08), tick_(0.24, p, 4000, 0.08),
  ],
  // Half the time a low purr, half the time the teleport-ish vwoop.
  enderman: (p) => (Math.random() < 0.5
    ? [
      { kind: 'tone', type: 'sine', freq: 92 * p, freqTo: 70 * p, seconds: 0.8,
        volume: 0.18, attack: 0.2 },
      { kind: 'tone', type: 'square', freq: 46 * p, freqTo: 40 * p, seconds: 0.8,
        volume: 0.08, attack: 0.2, lowpass: 260 },
    ]
    : [
      { kind: 'tone', type: 'sawtooth', freq: 720 * p, freqTo: 170 * p, seconds: 0.36,
        volume: 0.12, attack: 0.02, lowpass: 1300 },
      { kind: 'tone', type: 'sine', freq: 360 * p, freqTo: 85 * p, seconds: 0.36,
        volume: 0.14, attack: 0.02 },
      { kind: 'noise', filterType: 'bandpass', frequency: 900, freqTo: 300, q: 2,
        seconds: 0.3, volume: 0.08, attack: 0.02 },
    ]),
  // A long falling cry — slow to bloom, slow to fade.
  ghast: (p) => [
    { kind: 'tone', type: 'sine', freq: 440 * p, freqTo: 300 * p, seconds: 1.7,
      volume: 0.2, attack: 0.45 },
    { kind: 'tone', type: 'triangle', freq: 880 * p, freqTo: 600 * p, seconds: 1.7,
      volume: 0.06, attack: 0.5, lowpass: 1500 },
    { kind: 'noise', filterType: 'bandpass', frequency: 520, q: 2, seconds: 1.3,
      volume: 0.06, attack: 0.4 },
  ],
  // A breath of fire: falling roar of noise with two crackles in it.
  blaze: (p) => [
    { kind: 'noise', filterType: 'bandpass', frequency: 980, freqTo: 380, q: 1,
      seconds: 0.8, volume: 0.2, attack: 0.25 },
    { kind: 'tone', type: 'sawtooth', freq: 165 * p, freqTo: 120 * p, seconds: 0.6,
      volume: 0.07, attack: 0.2, lowpass: 520 },
    { kind: 'noise', at: 0.3, filterType: 'highpass', frequency: 3000, seconds: 0.03,
      volume: 0.1, attack: 0.002 },
    { kind: 'noise', at: 0.5, filterType: 'highpass', frequency: 3000, seconds: 0.03,
      volume: 0.08, attack: 0.002 },
  ],
};

export function createMobVoices() {
  let recent = []; // wall-clock seconds of the last few voices (the herd guard)

  return {
    // The type's hurt/death pitch scale (a cow's yelp is lower than the
    // body-height formula alone says; a skeleton's is drier and higher).
    pitchOf(mob) {
      return V.TYPES[mob.type.name]?.HURT_PITCH ?? 1;
    },
    // Once per frame per live mob in a loaded chunk. `night` softens and
    // spaces out the passives. Returns true when a voice actually played
    // (the harness counts these).
    tick(mob, dt, night = false) {
      const spec = V.TYPES[mob.type.name];
      if (!spec || !RECIPES[mob.type.name]) return false;
      if (mob.voiceTimer === undefined) {
        // Stagger the first call so a freshly loaded herd doesn't all
        // speak at once.
        mob.voiceTimer = rand(V.FIRST_CALL[0], V.FIRST_CALL[1]);
      }
      mob.voiceTimer -= dt;
      if (mob.voiceTimer > 0) return false;
      const sleepy = spec.PASSIVE && night;
      mob.voiceTimer = spec.MEAN * (sleepy ? V.NIGHT_INTERVAL : 1)
        * rand(V.JITTER[0], V.JITTER[1]);
      const now = performance.now() / 1000;
      recent = recent.filter((t) => now - t < V.BURST_WINDOW);
      if (recent.length >= V.BURST_CAP) return false;
      const e = mob.entity;
      const pos = e.position;
      const place = { x: pos.x, y: pos.y + e.def.height * 0.7, z: pos.z };
      const pitch = spec.PITCH * rand(1 - spec.SCATTER, 1 + spec.SCATTER);
      const volume = V.VOLUME * spec.VOLUME * (sleepy ? V.NIGHT_VOLUME : 1);
      const name = `voice:${mob.type.name}`;
      const played = audio.layer(name, RECIPES[mob.type.name](pitch), { place, volume, key: name });
      if (played) recent.push(now);
      return played;
    },
  };
}
