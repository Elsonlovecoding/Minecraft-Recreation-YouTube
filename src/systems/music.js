// systems/music.js — the final pass: soft, peaceful background music in the
// spirit of Minecraft's own. ORIGINAL and generative — nothing here is a
// recording or a transcription of the game's soundtrack; like every other
// sound in this project (systems/audio.js) it is synthesised from
// oscillators at runtime. The piece is a weighted random walk, so it never
// repeats and never ends:
//
//   the pad      four-voice maj7/min7 chords breathing underneath — a slow
//                swell in, a long release out, wandering a progression
//                graph in C major (I vi IV V iii ii) that always resolves
//                somewhere gentle
//   the melody   a sparse felt-piano line over the C major pentatonic,
//                biased toward the current chord's tones, phrased 3-7
//                notes at a time with long silences between phrases
//
// Night thins it out: gaps stretch, the register drops, the whole bus
// softens — the piece keeps you company without ever asking for attention.
//
// Everything routes through audioBus() (the compressor + master volume),
// and the shared AudioContext is suspended by systems/audio.js while the
// game is paused, which freezes ctx.currentTime — the scheduler below
// simply stops advancing and picks up where it left off on resume.

import { AUDIO } from '../config.js';
import { ensureAudio, audioBus, audioIsPaused } from './audio.js';

const M = AUDIO.MUSIC;

// Semitones relative to C4. The pad voicings sit low (C2..E4), the melody
// wanders the pentatonic above them.
const CHORDS = {
  C: { notes: [-24, -12, -5, -1, 4], pcs: [0, 4, 7, 11] },   // Cmaj7
  Am: { notes: [-27, -15, -8, -5, 0], pcs: [9, 0, 4, 7] },   // Am7
  F: { notes: [-31, -19, -7, -3, 0], pcs: [5, 9, 0, 4] },    // Fmaj7
  G: { notes: [-29, -17, -5, -1, 2], pcs: [7, 11, 2, 4] },   // G6
  Em: { notes: [-32, -20, -8, -5, -1], pcs: [4, 7, 11, 2] }, // Em7
  Dm: { notes: [-34, -22, -10, -3, 0], pcs: [2, 5, 9, 0] },  // Dm7
};
// Where each chord likes to go — the walk that keeps the harmony moving
// without ever landing anywhere harsh.
const NEXT = {
  C: ['Am', 'F', 'Em', 'G', 'F'],
  Am: ['F', 'Dm', 'C', 'G'],
  F: ['C', 'G', 'Dm', 'Am'],
  G: ['C', 'Am', 'Em', 'C'],
  Em: ['Am', 'F', 'Am'],
  Dm: ['G', 'F', 'G'],
};
// The melody's home scale: C major pentatonic across two octaves plus the
// maj7 colour tone — the "peaceful" palette.
const SCALE = [0, 2, 4, 7, 9, 11, 12, 14, 16, 19, 21];

const freq = (semi) => 261.6256 * 2 ** (semi / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function createMusic() {
  let ctx = null;
  let bus = null;        // music master (under the game bus)
  let padFilter = null;  // one shared lowpass keeps the pad soft
  let chordName = 'C';
  let chordEnd = 0;      // ctx time the current chord releases
  let nextNote = 0;      // ctx time of the next melody note
  let phraseLeft = 0;    // notes remaining in the current phrase
  let melodyDegree = 5;  // index into SCALE — the walk's position
  let lastGainSet = 0;
  let chordsPlayed = 0;  // debug counters (the harness asserts scheduling)
  let notesPlayed = 0;

  function build() {
    ctx = ensureAudio();
    const out = audioBus();
    if (!ctx || !out) return false;
    bus = ctx.createGain();
    bus.gain.value = 0; // fades up once scheduling starts
    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 720;
    padFilter.connect(bus);
    bus.connect(out);
    const t = ctx.currentTime;
    chordEnd = t + 0.5;             // first chord lands almost at once...
    nextNote = t + rand(4, 7);      // ...the melody waits a polite moment
    return true;
  }

  // One pad chord: every voice swells in over ~3.5s, holds, releases over
  // ~5s at the chord's end. Triangle bodies with a sine sub on the root.
  function playChord(name, at, seconds, level) {
    const chord = CHORDS[name];
    for (let i = 0; i < chord.notes.length; i++) {
      const semi = chord.notes[i];
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq(semi);
      osc.detune.value = rand(-4, 4);
      const g = ctx.createGain();
      const peak = level * (i === 0 ? 0.9 : 0.55) / chord.notes.length;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + rand(3, 4.5));
      g.gain.setValueAtTime(Math.max(peak, 0.0002), at + seconds);
      g.gain.exponentialRampToValueAtTime(0.0001, at + seconds + 5);
      osc.connect(g);
      g.connect(padFilter);
      osc.start(at);
      osc.stop(at + seconds + 5.5);
    }
  }

  // One melody note: the felt-piano voice — a sine body plus a quiet
  // triangle an octave up, fast attack, long exponential decay.
  function playNote(semi, at, level) {
    const decay = rand(2.6, 4.6);
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.value = freq(semi);
    body.detune.value = rand(-3, 3);
    const shimmer = ctx.createOscillator();
    shimmer.type = 'triangle';
    shimmer.frequency.value = freq(semi + 12);
    shimmer.detune.value = body.detune.value;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    const g = ctx.createGain();
    const gs = ctx.createGain();
    gs.gain.value = 0.22;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    body.connect(g);
    shimmer.connect(gs);
    gs.connect(g);
    g.connect(lp);
    lp.connect(bus);
    body.start(at);
    shimmer.start(at);
    body.stop(at + decay + 0.1);
    shimmer.stop(at + decay + 0.1);
  }

  // The melody walk: mostly steps of one or two scale degrees, the odd
  // leap, biased onto the current chord's tones so the line always agrees
  // with the pad underneath.
  function nextMelodySemi() {
    const step = Math.random() < 0.72
      ? pick([-1, 1, -2, 2])
      : pick([-4, -3, 3, 4]);
    melodyDegree = Math.max(0, Math.min(SCALE.length - 1, melodyDegree + step));
    let semi = SCALE[melodyDegree];
    if (Math.random() < 0.6) {
      // Snap to the nearest chord tone within two semitones.
      const pcs = CHORDS[chordName].pcs;
      for (const d of [0, 1, -1, 2, -2]) {
        if (pcs.includes(((semi + d) % 12 + 12) % 12)) { semi += d; break; }
      }
    }
    return semi;
  }

  // Called once per frame from main.js with the cycle's sun level.
  // Schedules roughly a second ahead; costs nothing when there is nothing
  // to schedule.
  function update(sunLevel = 1) {
    if (!ctx && !build()) return;
    if (audioIsPaused() || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const night = sunLevel < 0.25;
    const sparse = night ? M.NIGHT_SPARSE : 1;

    // The bus level breathes with the day (rare updates are plenty).
    if (now - lastGainSet > 1) {
      lastGainSet = now;
      bus.gain.setTargetAtTime(M.VOLUME * (night ? M.NIGHT_LEVEL : 1), now, 3);
    }

    // Harmony stream.
    if (chordEnd < now + 1) {
      chordName = pick(NEXT[chordName]);
      const hold = rand(M.CHORD_SECONDS[0], M.CHORD_SECONDS[1]) * sparse;
      const at = Math.max(chordEnd, now + 0.05);
      playChord(chordName, at, hold, M.PAD_LEVEL);
      chordsPlayed++;
      chordEnd = at + hold;
    }

    // Melody stream: phrases with long rests between them.
    if (nextNote < now + 1) {
      const at = Math.max(nextNote, now + 0.05);
      const semi = nextMelodySemi() - (night ? 12 : 0); // night sits lower
      playNote(semi, at, M.NOTE_LEVEL * rand(0.55, 1));
      notesPlayed++;
      if (phraseLeft <= 0) {
        phraseLeft = Math.round(rand(M.PHRASE_NOTES[0], M.PHRASE_NOTES[1]));
      }
      phraseLeft--;
      const gap = phraseLeft > 0
        ? rand(M.NOTE_GAP[0], M.NOTE_GAP[1])
        : rand(M.PHRASE_REST[0], M.PHRASE_REST[1]);
      nextNote = at + gap * sparse;
    }
  }

  // Debug/harness introspection: how much has actually been scheduled.
  function stats() {
    return {
      running: !!ctx && ctx.state === 'running',
      chords: chordsPlayed,
      notes: notesPlayed,
      chord: chordName,
    };
  }

  return { update, stats };
}
