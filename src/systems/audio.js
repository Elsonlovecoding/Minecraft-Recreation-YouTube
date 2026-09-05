// systems/audio.js — Phase 22: the whole game's sound, synthesised with the
// Web Audio API. No audio files ship with this project and none are loaded:
// every footstep, swing, hiss and boom is built from oscillators and one
// shared noise buffer at play time.
//
// The shape of it:
//
//   ctx -> [voice graph] -> bus gain -> compressor -> master gain -> out
//
// Each SOUND is a LAYER of two to four voices — a body tone, a transient
// noise burst, sometimes a pitched click or a second detuned tone. Layering
// is what makes a stone footstep read as a boot on rock rather than a beep,
// and the bus compressor is what makes a creeper blast beside a lava lake
// with three mobs dying read as one satisfying thump rather than clipping
// mush.
//
// Positional sounds attenuate with distance from the listener (main.js
// pushes the camera every frame) and pan across the stereo field using the
// camera's right vector. A voice budget caps concurrency; past it the new
// sound is simply dropped, so no amount of on-screen chaos can stall the
// audio thread.
//
// Reached through the module-level `audio` singleton, like render/particles.js
// — every call before the first user gesture, and every call in a
// node/headless context with no AudioContext, is a silent no-op.

import { AUDIO } from '../config.js';

let ctx = null;
let noiseBuffer = null;
let bus = null;      // everything one-shot routes here (pre-compressor)
let master = null;
let failed = false;
// Phase 23 bug fix: the game freezes on Esc but the water ambience, the lava
// bed and the portal hum kept running, because a looping voice is a live
// graph node — nothing about pausing the game loop stops it. The whole
// context suspends instead. Every path that would otherwise resume a
// suspended context (playLayer, setLoop, dimensions/portals.js) goes through
// tryResume, which refuses while paused — otherwise the next sound the game
// tried to emit would un-suspend it behind the pause.
let paused = false;

// The shared AudioContext. Also used by dimensions/portals.js, which had its
// own before this module existed — one context for the whole game.
export function ensureAudio() {
  if (ctx || failed) return ctx;
  try {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) {
      failed = true;
      return null;
    }
    ctx = new AC();
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const comp = ctx.createDynamicsCompressor();
    const C = AUDIO.COMPRESSOR;
    comp.threshold.value = C.THRESHOLD;
    comp.knee.value = C.KNEE;
    comp.ratio.value = C.RATIO;
    comp.attack.value = C.ATTACK;
    comp.release.value = C.RELEASE;
    master = ctx.createGain();
    master.gain.value = AUDIO.MASTER_VOLUME;
    bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    failed = true;
  }
  return ctx;
}

// The white-noise source buffer (shared; portals.js reads it too).
export function getNoiseBuffer() {
  ensureAudio();
  return noiseBuffer;
}

// The node every sound should connect to — never ctx.destination, or it
// bypasses the compressor and the master volume.
export function audioBus() {
  ensureAudio();
  return bus ?? ctx?.destination ?? null;
}

// Resume the context if the browser has parked it (autoplay policy, tab
// switch) — but never while the game is paused. The ONE place any module
// resumes the context.
export function tryResume() {
  if (paused || !ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

// Is the game paused? Callers that build continuous graphs check this so
// they don't spin one up behind the pause overlay.
export function audioIsPaused() {
  return paused;
}

// ---------------------------------------------------------------------------
// Listener, distance and panning
// ---------------------------------------------------------------------------

const listener = { x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0 };
let voices = 0;
const lastPlayed = new Map(); // sound name -> ctx time, for the retrigger gap

// main.js calls this once per frame with the camera.
export function setListener(camera) {
  const p = camera.position;
  listener.x = p.x;
  listener.y = p.y;
  listener.z = p.z;
  // The camera's world right vector = column 0 of its world matrix.
  const e = camera.matrixWorld.elements;
  listener.rx = e[0];
  listener.ry = e[1];
  listener.rz = e[2];
}

// { gain, pan } for a world position, or null when it is out of earshot.
function spatial(x, y, z) {
  const dx = x - listener.x;
  const dy = y - listener.y;
  const dz = z - listener.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist >= AUDIO.HEARING_RANGE) return null;
  const gain = (1 - dist / AUDIO.HEARING_RANGE) ** AUDIO.ROLLOFF;
  if (dist < AUDIO.PAN_NEAR) return { gain, pan: 0 };
  const side = (dx * listener.rx + dy * listener.ry + dz * listener.rz) / dist;
  return { gain, pan: Math.max(-1, Math.min(1, side)) * AUDIO.PAN_WIDTH };
}

// ---------------------------------------------------------------------------
// Voice primitives — every sound in the catalogue is a layer of these
// ---------------------------------------------------------------------------

// A per-sound output stage: gain (for the envelope sum) into a stereo panner.
function makeOutput(pan) {
  const out = ctx.createGain();
  out.gain.value = 1;
  if (ctx.createStereoPanner && pan) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner);
    panner.connect(audioBus());
  } else {
    out.connect(audioBus());
  }
  return out;
}

// One oscillator voice with an ADSR-ish envelope and an optional pitch glide.
//
// `lowpass` (Phase 23) rounds the voice off at a corner frequency. A raw
// sawtooth or square has energy all the way up the spectrum and that is
// precisely what makes a synthesised sound read as SYNTHESISED — the buzz in
// the reported "harsh" hurt and hit sounds is the top two octaves of a
// sawtooth nothing was ever taking off. Rolling it away leaves the body of
// the tone, which is the part that carries the character.
function tone(out, t0, {
  type = 'sine', freq = 440, freqTo = null, seconds = 0.2, volume = 0.4,
  attack = 0.005, detune = 0, curve = 'exp', lowpass = null,
}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqTo !== null && freqTo !== freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + seconds);
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + attack);
  if (curve === 'linear') gain.gain.linearRampToValueAtTime(0.0001, t0 + seconds);
  else gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
  let head = osc;
  if (lowpass !== null) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    filter.Q.value = 0.7;
    osc.connect(filter);
    head = filter;
  }
  head.connect(gain);
  gain.connect(out);
  osc.start(t0);
  osc.stop(t0 + seconds + 0.02);
}

// One filtered noise voice — the transient half of nearly every sound.
function noise(out, t0, {
  seconds = 0.15, volume = 0.4, filterType = 'bandpass', frequency = 1200,
  freqTo = null, q = 1, attack = 0.003, curve = 'exp',
}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  // A random read offset keeps repeated hits from sounding identical.
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(frequency, t0);
  if (freqTo !== null && freqTo !== frequency) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t0 + seconds);
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + attack);
  if (curve === 'linear') gain.gain.linearRampToValueAtTime(0.0001, t0 + seconds);
  else gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  src.start(t0, Math.random() * 0.8);
  src.stop(t0 + seconds + 0.05);
}

// Play a LAYER: `parts` is a list of { kind: 'tone'|'noise', at?, ...opts }.
// `place` is { x, y, z } for a positional sound, or null for a UI sound.
// Returns false when the sound was dropped (out of earshot, budget, retrigger).
function playLayer(name, parts, { place = null, volume = 1, key = name } = {}) {
  if (volume <= 0.005 || paused) return false;
  const c = ensureAudio();
  if (!c) return false;
  let gain = volume;
  let pan = 0;
  if (place) {
    const s = spatial(place.x, place.y, place.z);
    if (!s) return false;
    gain *= s.gain;
    pan = s.pan;
    if (gain <= 0.005) return false;
  }
  const now = c.currentTime;
  const last = lastPlayed.get(key);
  if (last !== undefined && now - last < AUDIO.VOICE_MIN_GAP) return false;
  if (voices >= AUDIO.MAX_VOICES) return false;
  lastPlayed.set(key, now);
  voices++;
  let longest = 0;
  try {
    tryResume();
    const out = makeOutput(pan);
    out.gain.value = gain;
    for (const part of parts) {
      const t0 = now + (part.at ?? 0);
      longest = Math.max(longest, (part.at ?? 0) + (part.seconds ?? 0.2));
      if (part.kind === 'tone') tone(out, t0, part);
      else noise(out, t0, part);
    }
  } catch {
    // never let a sound failure touch gameplay
  }
  // Release the budget slot when the layer has finished sounding.
  setTimeout(() => { voices = Math.max(0, voices - 1); }, (longest + 0.15) * 1000);
  return true;
}

// ---------------------------------------------------------------------------
// Material groups — what a block sounds like underfoot and under a pickaxe
// ---------------------------------------------------------------------------

// Derived from the block's registry NAME so no per-block table is needed
// (world/blocks.js is the block registry, not a sound registry).
export function blockSoundGroup(name) {
  if (!name) return 'stone';
  if (name.includes('water')) return 'water';
  if (name.includes('lava')) return 'lava';
  if (name.includes('grass') || name.includes('leaves') || name.includes('sapling') ||
      name.includes('wart') || name.includes('dandelion') || name.includes('poppy') ||
      name.includes('bush')) return 'grass'; // Phase 24: the cross plants
  if (name.includes('wool') || name === 'bed') return 'wool';
  if (name.includes('gravel')) return 'gravel';
  // Deepslate (Phase 23) before the generic stone fallback: it is denser and
  // tighter than stone and vanilla gives it its own sound group.
  if (name.includes('deepslate')) return 'deepslate';
  if (name.includes('sandstone')) return 'stone';
  if (name.includes('sand')) return 'sand'; // sand and soul sand
  if (name.includes('dirt') || name.includes('farmland') || name.includes('clay')) {
    return 'dirt';
  }
  if (name.includes('glass') || name.includes('glowstone')) return 'glass';
  if (name.includes('bars') || name.includes('iron_block') ||
      name.includes('gold_block')) return 'metal';
  if (name.includes('netherrack')) return 'netherrack';
  if (name.includes('log') || name.includes('plank') || name.includes('wood') ||
      name.includes('fence') || name.includes('door') || name.includes('sign') ||
      name.includes('ladder') || name.includes('bookshelf') ||
      name.includes('crafting_table') || name.includes('chest') ||
      name.includes('barrel')) return 'wood';
  return 'stone'; // stone, ore, brick, obsidian, bedrock, end stone...
}

// Per-group timbre. `body` is the low reference the thump is built around,
// `grit` the surface noise on top, `decay` the length of ONE footstep.
//
// Phase 23 halved every `decay`: the reported "strange, unnatural" sprint
// noise was footsteps 130-200ms long firing every ~230ms, so each step was
// still sounding when the next began and the run turned into a continuous
// warble instead of a series of taps. A real footstep is a transient — under
// 100ms — and the gap between them is as much of the sound as the taps are.
const MATERIAL = {
  stone:      { body: 150, grit: 1500, q: 1.2, filter: 'bandpass', decay: 0.070, bright: 1.0 },
  deepslate:  { body: 138, grit: 1250, q: 1.6, filter: 'bandpass', decay: 0.075, bright: 0.95 },
  dirt:       { body: 110, grit: 520,  q: 0.9, filter: 'lowpass',  decay: 0.065, bright: 0.8 },
  grass:      { body: 130, grit: 2300, q: 0.8, filter: 'bandpass', decay: 0.055, bright: 0.7 },
  sand:       { body: 95,  grit: 3600, q: 0.6, filter: 'highpass', decay: 0.085, bright: 0.7 },
  gravel:     { body: 120, grit: 1100, q: 1.6, filter: 'bandpass', decay: 0.080, bright: 0.9 },
  wood:       { body: 195, grit: 780,  q: 2.4, filter: 'bandpass', decay: 0.075, bright: 1.0 },
  wool:       { body: 90,  grit: 300,  q: 0.7, filter: 'lowpass',  decay: 0.055, bright: 0.55 },
  glass:      { body: 900, grit: 5200, q: 3.0, filter: 'highpass', decay: 0.085, bright: 1.1 },
  metal:      { body: 420, grit: 3000, q: 4.0, filter: 'bandpass', decay: 0.105, bright: 1.1 },
  netherrack: { body: 105, grit: 900,  q: 1.0, filter: 'lowpass',  decay: 0.070, bright: 0.85 },
  water:      { body: 260, grit: 1800, q: 0.8, filter: 'bandpass', decay: 0.110, bright: 0.8 },
  lava:       { body: 70,  grit: 400,  q: 0.9, filter: 'lowpass',  decay: 0.160, bright: 0.9 },
};

const materialOf = (group) => MATERIAL[group] ?? MATERIAL.stone;

// ---------------------------------------------------------------------------
// The sound catalogue
// ---------------------------------------------------------------------------

class Audio {
  constructor() {
    this.loops = new Map();
  }

  // main.js: resume on the first gesture so the very first footstep sounds.
  unlock() {
    ensureAudio();
    tryResume();
  }

  // main.js calls this every frame with the pause state. Suspending the
  // AudioContext stops EVERYTHING at once — one-shots mid-flight, the looping
  // ambience beds, the portal hum — and resuming picks them all back up where
  // they were, which is exactly what pausing a game should sound like. Edge
  // triggered: suspend/resume are cheap but not free, and calling them every
  // frame would fight the browser.
  setPaused(next) {
    const want = !!next;
    if (want === paused) return;
    paused = want;
    // Don't CREATE a context just to suspend it — before the first sound
    // there is nothing playing to stop.
    const c = ctx;
    if (!c) return;
    try {
      if (want) c.suspend().catch(() => {});
      else c.resume().catch(() => {});
    } catch {
      // an audio failure must never touch gameplay
    }
  }

  setListener(camera) {
    if (camera) setListener(camera);
  }

  get available() {
    return !!ensureAudio();
  }

  // The AudioContext's own state ('running' | 'suspended' | 'closed'), or
  // null before there is one. Dev scaffolding: this is how a harness or the
  // console confirms that pausing really did stop the audio thread rather
  // than merely stopping new sounds from starting.
  get contextState() {
    return ctx ? ctx.state : null;
  }

  // --- movement -------------------------------------------------------------

  // A boot on a surface. TWO NOISE LAYERS AND NO OSCILLATOR: the body of the
  // step is low-passed noise, the surface is the material's own grit on top.
  //
  // Phase 22 built this the other way round — a 150 Hz sine gliding down to
  // 90 Hz at half the layer's volume — and a pitched glide is not what a boot
  // on rock sounds like; it is what a synthesiser sounds like. Every step
  // played the same two notes, so walking was a repeating musical figure and
  // sprinting (a step every ~230 ms) was the reported "strange, unnatural
  // noise". Noise has no pitch to repeat, and the per-step `p` spread is wide
  // enough that no two consecutive steps land in the same place.
  footstep(group, place, volume = 1) {
    const m = materialOf(group);
    const p = 0.82 + Math.random() * 0.36;
    return playLayer('step', [
      { kind: 'noise', filterType: 'lowpass', frequency: m.body * p * 2.4,
        seconds: m.decay, volume: 0.6, attack: 0.001 },
      { kind: 'noise', filterType: m.filter, frequency: m.grit * p, q: m.q,
        seconds: m.decay * 0.75, volume: 0.26 * m.bright, attack: 0.001 },
    ], { place, volume: volume * AUDIO.FOOTSTEP_VOLUME, key: `step:${group}` });
  }

  // Landing from a fall: the same materials, heavier and longer than a step.
  // Phase 22 reused footstep() at up to 1.8x volume for this, which just made
  // a footstep loud; a real landing is lower and rounder, not louder.
  land(group, place, volume = 1) {
    const m = materialOf(group);
    const p = 0.85 + Math.random() * 0.25;
    return playLayer('land', [
      { kind: 'noise', filterType: 'lowpass', frequency: m.body * p * 1.6,
        seconds: m.decay * 2.2, volume: 0.75, attack: 0.001 },
      { kind: 'noise', filterType: m.filter, frequency: m.grit * p * 0.85, q: m.q,
        seconds: m.decay * 1.4, volume: 0.3 * m.bright, attack: 0.002 },
    ], { place, volume: volume * AUDIO.LAND_VOLUME, key: 'land' });
  }

  // --- blocks ---------------------------------------------------------------

  breakBlock(group, place, volume = 1) {
    const m = materialOf(group);
    const p = 0.85 + Math.random() * 0.3;
    return playLayer('break', [
      { kind: 'noise', filterType: m.filter, frequency: m.grit * p * 1.3,
        freqTo: m.grit * p * 0.5, q: m.q, seconds: 0.20, volume: 0.6 * m.bright },
      // The block coming loose: a short low knock, rolled off so the
      // triangle's upper partials don't ring out as a note.
      { kind: 'tone', type: 'triangle', freq: m.body * p * 1.4,
        freqTo: m.body * p * 0.5, seconds: 0.12, volume: 0.26,
        lowpass: m.body * 4 },
      { kind: 'noise', at: 0.03, filterType: 'highpass', frequency: 2600 * p,
        seconds: 0.10, volume: 0.22 * m.bright },
      // The weight of the block dropping out: a low thud under the crumble,
      // so a break lands in the chest and not only in the ear.
      { kind: 'noise', filterType: 'lowpass', frequency: m.body * p * 1.1,
        seconds: 0.16, volume: 0.55, attack: 0.001 },
    ], { place, volume: volume * AUDIO.BREAK_VOLUME, key: `break:${group}` });
  }

  placeBlock(group, place, volume = 1) {
    const m = materialOf(group);
    const p = 0.9 + Math.random() * 0.2;
    return playLayer('place', [
      // A block set down is a thud, not a note — same fix as the footstep.
      { kind: 'noise', filterType: 'lowpass', frequency: m.body * p * 2.6,
        seconds: 0.085, volume: 0.62, attack: 0.001 },
      { kind: 'noise', filterType: m.filter, frequency: m.grit * p, q: m.q,
        seconds: 0.07, volume: 0.3 * m.bright, attack: 0.001 },
    ], { place, volume: volume * AUDIO.PLACE_VOLUME, key: `place:${group}` });
  }

  // One tick of the mining loop — interaction.js repeats it while digging.
  // This one fires several times a second for as long as a block takes, so
  // it has to be the least intrusive sound in the game: the Phase 22 square
  // wave under it buzzed, and at four ticks a second the buzz was the sound.
  mineTick(group, place, volume = 1) {
    const m = materialOf(group);
    const p = 0.8 + Math.random() * 0.45;
    return playLayer('mine', [
      { kind: 'noise', filterType: m.filter, frequency: m.grit * p, q: m.q * 1.4,
        seconds: 0.07, volume: 0.5 * m.bright, attack: 0.001 },
      { kind: 'noise', filterType: 'lowpass', frequency: m.body * p * 2.2,
        seconds: 0.05, volume: 0.22, attack: 0.001 },
    ], { place, volume: volume * AUDIO.MINING_VOLUME, key: `mine:${group}` });
  }

  // --- combat ---------------------------------------------------------------

  swing(place, volume = 1) {
    return playLayer('swing', [
      { kind: 'noise', filterType: 'bandpass', frequency: 900, freqTo: 2600,
        q: 0.8, seconds: 0.16, volume: 0.5, attack: 0.02 },
    ], { place, volume: volume * AUDIO.SWING_VOLUME });
  }

  // The wooden thwack of a landed melee hit.
  hit(place, volume = 1) {
    return playLayer('hit', [
      // A bright click on the front edge, then the body of the thwack a
      // little lower than it was — the connect should be felt.
      { kind: 'noise', filterType: 'highpass', frequency: 2800, seconds: 0.025,
        volume: 0.4, attack: 0.0005 },
      { kind: 'noise', filterType: 'lowpass', frequency: 900, seconds: 0.09,
        volume: 0.7 },
      { kind: 'tone', type: 'triangle', freq: 190, freqTo: 85, seconds: 0.11,
        volume: 0.34, lowpass: 700 },
    ], { place, volume });
  }

  // A grunt: the player's own hurt sound is centred (place null). The
  // sawtooth is the vocal rasp — Phase 23 rolls it off at 900 Hz so it reads
  // as a voice rather than the buzz it was, and the sine underneath carries
  // the weight.
  playerHurt(volume = 1) {
    return playLayer('playerHurt', [
      { kind: 'tone', type: 'sawtooth', freq: 300, freqTo: 150, seconds: 0.24,
        volume: 0.26, attack: 0.012, lowpass: 900 },
      { kind: 'tone', type: 'sine', freq: 148, freqTo: 96, seconds: 0.28,
        volume: 0.42, attack: 0.012, detune: -12 },
      { kind: 'noise', filterType: 'bandpass', frequency: 700, q: 1.5,
        seconds: 0.13, volume: 0.22 },
    ], { volume: volume * AUDIO.HURT_VOLUME, key: 'playerHurt' });
  }

  // Mob hurt: the same shape pitched by the mob's size (small = high).
  mobHurt(place, pitch = 1, volume = 1) {
    return playLayer('mobHurt', [
      { kind: 'tone', type: 'sawtooth', freq: 340 * pitch, freqTo: 170 * pitch,
        seconds: 0.20, volume: 0.26, attack: 0.01, lowpass: 1100 * pitch },
      { kind: 'tone', type: 'sine', freq: 168 * pitch, freqTo: 112 * pitch,
        seconds: 0.22, volume: 0.26, attack: 0.01 },
      { kind: 'noise', filterType: 'bandpass', frequency: 1100 * pitch, q: 1.2,
        seconds: 0.15, volume: 0.28 },
    ], { place, volume: volume * AUDIO.HURT_VOLUME, key: 'mobHurt' });
  }

  // Generic entry for another module's OWN recipes (systems/mob_voices.js
  // builds every mob's idle call from tone/noise parts): parts + options
  // straight through to the layer player, budget and spatialisation
  // included.
  layer(name, parts, opts) {
    return playLayer(name, parts, opts);
  }

  death(place, pitch = 1, volume = 1) {
    return playLayer('death', [
      { kind: 'tone', type: 'sawtooth', freq: 300 * pitch, freqTo: 70 * pitch,
        seconds: 0.6, volume: 0.28, attack: 0.015, lowpass: 850 * pitch },
      { kind: 'tone', type: 'sine', freq: 150 * pitch, freqTo: 48 * pitch,
        seconds: 0.65, volume: 0.38, attack: 0.012 },
      { kind: 'noise', at: 0.05, filterType: 'lowpass', frequency: 1400,
        freqTo: 260, seconds: 0.45, volume: 0.26 },
    ], { place, volume, key: 'death' });
  }

  // --- bow and arrows -------------------------------------------------------

  bowDraw(volume = 1) {
    return playLayer('bowDraw', [
      { kind: 'noise', filterType: 'bandpass', frequency: 480, freqTo: 900,
        q: 3, seconds: 0.35, volume: 0.4, attack: 0.06 },
      { kind: 'tone', type: 'triangle', freq: 180, freqTo: 260, seconds: 0.35,
        volume: 0.12 },
    ], { volume, key: 'bowDraw' });
  }

  bowRelease(volume = 1) {
    return playLayer('bowRelease', [
      { kind: 'noise', filterType: 'bandpass', frequency: 2200, freqTo: 700,
        q: 1.2, seconds: 0.2, volume: 0.6, attack: 0.002 },
      { kind: 'tone', type: 'triangle', freq: 640, freqTo: 200, seconds: 0.14,
        volume: 0.3 },
    ], { volume, key: 'bowRelease' });
  }

  arrowHit(place, volume = 1) {
    return playLayer('arrowHit', [
      { kind: 'noise', filterType: 'highpass', frequency: 2400, seconds: 0.09,
        volume: 0.55, attack: 0.001 },
      { kind: 'tone', type: 'triangle', freq: 380, freqTo: 160, seconds: 0.07,
        volume: 0.22, lowpass: 1200 },
    ], { place, volume, key: 'arrowHit' });
  }

  // --- mobs -----------------------------------------------------------------

  // The creeper's fuse: rising noise with a nervous wobble on top.
  hiss(place, volume = 1) {
    return playLayer('hiss', [
      { kind: 'noise', filterType: 'bandpass', frequency: 3200, freqTo: 6400,
        q: 0.7, seconds: 1.5, volume: 0.55, attack: 0.09 },
      { kind: 'noise', filterType: 'highpass', frequency: 5200, seconds: 1.4,
        volume: 0.2, attack: 0.2 },
    ], { place, volume, key: 'hiss' });
  }

  // The blast: a deep body, a mid crack and a long debris tail.
  explosion(place, volume = 1) {
    return playLayer('explosion', [
      { kind: 'noise', filterType: 'lowpass', frequency: 420, freqTo: 90,
        seconds: 1.1, volume: 0.95, attack: 0.004 },
      { kind: 'tone', type: 'sine', freq: 96, freqTo: 34, seconds: 0.8,
        volume: 0.7, attack: 0.003 },
      { kind: 'noise', at: 0.01, filterType: 'bandpass', frequency: 1800,
        freqTo: 300, q: 0.7, seconds: 0.45, volume: 0.5, attack: 0.002 },
      { kind: 'noise', at: 0.12, filterType: 'highpass', frequency: 1400,
        seconds: 1.3, volume: 0.22, attack: 0.15 },
    ], { place, volume, key: 'explosion' });
  }

  // The ghast's fireball shriek.
  shriek(place, volume = 1) {
    return playLayer('shriek', [
      { kind: 'tone', type: 'sawtooth', freq: 760, freqTo: 300, seconds: 0.7,
        volume: 0.24, attack: 0.05, lowpass: 2200 },
      { kind: 'noise', filterType: 'bandpass', frequency: 1000, freqTo: 2400,
        q: 1.4, seconds: 0.65, volume: 0.45, attack: 0.02 },
    ], { place, volume, key: 'shriek' });
  }

  // The blaze's fiery crackle (also its shots).
  flame(place, volume = 1) {
    return playLayer('flame', [
      { kind: 'noise', filterType: 'bandpass', frequency: 2600, freqTo: 1200,
        q: 0.9, seconds: 0.4, volume: 0.5, attack: 0.01 },
      { kind: 'noise', at: 0.06, filterType: 'highpass', frequency: 4200,
        seconds: 0.25, volume: 0.25 },
      { kind: 'tone', type: 'sawtooth', freq: 140, freqTo: 70, seconds: 0.3,
        volume: 0.16, attack: 0.02, lowpass: 420 },
    ], { place, volume, key: 'flame' });
  }

  // The enderman's teleport vwoop: a downward whoosh over a hollow tone.
  warp(place, volume = 1) {
    return playLayer('warp', [
      { kind: 'noise', filterType: 'bandpass', frequency: 1800, freqTo: 260,
        q: 3.5, seconds: 0.45, volume: 0.5, attack: 0.02 },
      { kind: 'tone', type: 'sine', freq: 520, freqTo: 90, seconds: 0.4,
        volume: 0.3 },
      { kind: 'tone', type: 'sine', freq: 780, freqTo: 130, seconds: 0.35,
        volume: 0.15, detune: 25 },
    ], { place, volume, key: 'warp' });
  }

  // An eye of ender shattering / glass breaking.
  shatter(place, volume = 1) {
    return playLayer('shatter', [
      { kind: 'noise', filterType: 'highpass', frequency: 3400, seconds: 0.22,
        volume: 0.6, attack: 0.001 },
      { kind: 'tone', type: 'triangle', freq: 2100, freqTo: 900, seconds: 0.14,
        volume: 0.25 },
    ], { place, volume, key: 'shatter' });
  }

  // A blocked hit / deflected fireball.
  deflect(place, volume = 1) {
    return playLayer('deflect', [
      { kind: 'noise', filterType: 'highpass', frequency: 1600, seconds: 0.14,
        volume: 0.55, attack: 0.002 },
      { kind: 'tone', type: 'triangle', freq: 700, freqTo: 320, seconds: 0.09,
        volume: 0.22, lowpass: 2400 },
    ], { place, volume, key: 'deflect' });
  }

  // --- water and fire events ------------------------------------------------

  splash(place, volume = 1) {
    return playLayer('splash', [
      { kind: 'noise', filterType: 'bandpass', frequency: 900, freqTo: 3200,
        q: 0.6, seconds: 0.4, volume: 0.6, attack: 0.004 },
      { kind: 'noise', at: 0.05, filterType: 'highpass', frequency: 3000,
        seconds: 0.35, volume: 0.3, attack: 0.05 },
    ], { place, volume, key: 'splash' });
  }

  bubble(place, volume = 1) {
    const p = 0.7 + Math.random() * 0.8;
    return playLayer('bubble', [
      { kind: 'tone', type: 'sine', freq: 500 * p, freqTo: 1400 * p,
        seconds: 0.09, volume: 0.35, attack: 0.004 },
    ], { place, volume, key: 'bubble' });
  }

  lavaPop(place, volume = 1) {
    return playLayer('lavaPop', [
      { kind: 'tone', type: 'sine', freq: 260, freqTo: 60, seconds: 0.22,
        volume: 0.5, attack: 0.003 },
      { kind: 'noise', filterType: 'lowpass', frequency: 700, seconds: 0.3,
        volume: 0.35 },
    ], { place, volume, key: 'lavaPop' });
  }

  fizz(place, volume = 1) {
    return playLayer('fizz', [
      { kind: 'noise', filterType: 'highpass', frequency: 4000, seconds: 0.6,
        volume: 0.5, attack: 0.005 },
    ], { place, volume, key: 'fizz' });
  }

  // --- items and progression ------------------------------------------------

  pickup(volume = 1) {
    const p = 0.95 + Math.random() * 0.25;
    return playLayer('pickup', [
      { kind: 'tone', type: 'triangle', freq: 620 * p, freqTo: 1150 * p,
        seconds: 0.09, volume: 0.5, attack: 0.003 },
      { kind: 'tone', type: 'sine', freq: 1240 * p, seconds: 0.06, volume: 0.2 },
    ], { volume: volume * AUDIO.PICKUP_VOLUME, key: 'pickup' });
  }

  // A rising chime — used for a real milestone (the dragon's death, victory).
  levelUp(volume = 1) {
    const root = 523.25; // C5
    return playLayer('levelUp', [
      { kind: 'tone', type: 'triangle', freq: root, seconds: 0.22, volume: 0.5 },
      { kind: 'tone', at: 0.11, type: 'triangle', freq: root * 1.26,
        seconds: 0.22, volume: 0.5 },
      { kind: 'tone', at: 0.22, type: 'triangle', freq: root * 1.5,
        seconds: 0.4, volume: 0.55 },
      { kind: 'tone', at: 0.22, type: 'sine', freq: root * 3,
        seconds: 0.45, volume: 0.2 },
    ], { volume: volume * AUDIO.LEVEL_UP_VOLUME, key: 'levelUp' });
  }

  eat(place, volume = 1) {
    return playLayer('eat', [
      { kind: 'noise', filterType: 'lowpass', frequency: 800, seconds: 0.14,
        volume: 0.45, attack: 0.01 },
    ], { place, volume, key: 'eat' });
  }

  // A distant echoing cave tone: two detuned sines with a very slow swell.
  caveTone(volume = 1) {
    const base = 90 + Math.random() * 130;
    return playLayer('cave', [
      { kind: 'tone', type: 'sine', freq: base, freqTo: base * 0.82,
        seconds: 3.4, volume: 0.5, attack: 1.1, curve: 'linear' },
      { kind: 'tone', type: 'sine', freq: base * 1.5, freqTo: base * 1.2,
        seconds: 3.0, volume: 0.22, attack: 1.3, detune: 14, curve: 'linear' },
      { kind: 'noise', filterType: 'bandpass', frequency: base * 4, q: 6,
        seconds: 3.2, volume: 0.12, attack: 1.2, curve: 'linear' },
    ], { volume: volume * AUDIO.CAVE.VOLUME, key: 'cave' });
  }

  // --- looping ambience -----------------------------------------------------

  // A named continuous bed whose gain is set every frame (0 = inaudible but
  // still running — cheaper and click-free versus start/stop churn).
  // `spec` builds the graph on first use: { filter, frequency, q, tone? }.
  setLoop(name, targetGain, spec) {
    if (paused) return;
    const c = ensureAudio();
    if (!c) return;
    let loop = this.loops.get(name);
    if (!loop) {
      if (targetGain <= 0.0005) return; // never build a silent loop
      try {
        const gain = c.createGain();
        gain.gain.value = 0;
        gain.connect(audioBus());
        const src = c.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;
        const filter = c.createBiquadFilter();
        filter.type = spec.filter ?? 'bandpass';
        filter.frequency.value = spec.frequency ?? 500;
        filter.Q.value = spec.q ?? 1;
        src.connect(filter);
        filter.connect(gain);
        src.start();
        let osc = null;
        if (spec.tone) {
          osc = c.createOscillator();
          osc.type = spec.tone.type ?? 'sine';
          osc.frequency.value = spec.tone.freq ?? 100;
          const oscGain = c.createGain();
          oscGain.gain.value = spec.tone.volume ?? 0.3;
          osc.connect(oscGain);
          oscGain.connect(gain);
          osc.start();
        }
        loop = { gain, filter, osc, clock: 0 };
        this.loops.set(name, loop);
      } catch {
        return;
      }
    }
    try {
      tryResume();
      loop.clock += 1 / 60;
      const wobble = 0.85 + 0.15 * Math.sin(loop.clock * (spec.wobbleHz ?? 0.9));
      loop.gain.gain.value = targetGain * wobble;
    } catch {
      this.loops.delete(name);
    }
  }
}

export const audio = new Audio();
