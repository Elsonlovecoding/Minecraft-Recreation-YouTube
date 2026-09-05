// systems/music.js — soft, CHILL background music in the spirit of
// Minecraft's own. ORIGINAL and generative — nothing here is a recording
// or a transcription of the game's soundtrack; like every other sound in
// this project (systems/audio.js) it is synthesised from oscillators at
// runtime. The piece is a weighted random walk, so it never repeats and
// never ends:
//
//   the pad      six-voice maj9/min9 chords breathing underneath — a slow
//                swell in, a long release out, wandering a progression
//                graph in C major (I vi IV V iii ii) that always resolves
//                somewhere gentle; a tape-wobble LFO drifts every voice a
//                few cents and the lowpass breathes
//   the melody   a sparse felt-piano line over the C major pentatonic,
//                biased toward the current chord's tones, phrased 3-7
//                notes at a time with rests between phrases
//   the arp      (day) a soft electric-piano arpeggio climbing the chord
//                tones under some chords — the lo-fi motion that makes the
//                bed feel like it is going somewhere
//   the pulse    (day) a whisper of brushed hat, a muted thump and a soft
//                rim at 66 bpm with swing and random drop-outs — felt more
//                than heard
//   the texture  a warm vinyl bed: low-passed noise breathing slowly, with
//                the occasional crackle
//   the room     a generated-impulse convolver on the bus (a soft 2.6 s
//                hall) so everything sits back in the same space
//
// Night thins it out: the arp and pulse rest, gaps stretch, the register
// drops, the whole bus softens — the piece keeps you company without ever
// asking for attention. Every level and timing: config AUDIO.MUSIC.
//
// Everything routes through audioBus() (the compressor + master volume),
// and the shared AudioContext is suspended by systems/audio.js while the
// game is paused, which freezes ctx.currentTime — the schedulers below
// simply stop advancing and pick up where they left off on resume.

import { AUDIO } from '../config.js';
import { ensureAudio, audioBus, audioIsPaused, getNoiseBuffer } from './audio.js';

const M = AUDIO.MUSIC;

// Semitones relative to C4. The pad voicings sit low (C1..C5) with the
// ninth on top; `pcs` are the chord's pitch classes for the melody/arp.
const CHORDS = {
  C: { notes: [-24, -12, -5, -1, 4, 14], pcs: [0, 4, 7, 11, 2] },     // Cmaj9
  Am: { notes: [-27, -15, -8, -5, 0, 11], pcs: [9, 0, 4, 7, 11] },    // Am9
  F: { notes: [-31, -19, -7, -3, 0, 7], pcs: [5, 9, 0, 4, 7] },       // Fmaj9
  G: { notes: [-29, -17, -5, -1, 2, 9], pcs: [7, 11, 2, 4, 9] },      // G6/9
  Em: { notes: [-32, -20, -8, -5, -1, 14], pcs: [4, 7, 11, 2] },      // Em9
  Dm: { notes: [-34, -22, -10, -3, 0, 16], pcs: [2, 5, 9, 0, 4] },    // Dm9
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
  let dry = null;        // direct path into the bus
  let send = null;       // reverb send -> convolver -> wet -> bus
  let padFilter = null;  // one shared lowpass keeps the pad soft
  let wobble = null;     // tape-wobble LFO output (connects to detune params)
  let chordName = 'C';
  let chordEnd = 0;      // ctx time the current chord releases
  let nextNote = 0;      // ctx time of the next melody note
  let phraseLeft = 0;    // notes remaining in the current phrase
  let melodyDegree = 5;  // index into SCALE — the walk's position
  let pulseNext = 0;     // ctx time of the next eighth
  let pulseStep = 0;     // eighth index within the bar (0..7)
  let crackleNext = 0;
  let lastGainSet = 0;
  let chordsPlayed = 0;  // debug counters (the harness asserts scheduling)
  let notesPlayed = 0;
  let arpsPlayed = 0;
  let pulsesPlayed = 0;

  // A soft hall from a generated impulse: decaying stereo noise, one-pole
  // low-passed so the tail darkens the way a real room's does.
  function makeReverb() {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * M.REVERB_SECONDS);
    const ir = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let y = 0;
      const pre = Math.floor(sr * 0.02); // a touch of pre-delay
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const env = Math.exp(-t / (M.REVERB_SECONDS * 0.32)) * (1 - t / M.REVERB_SECONDS);
        y += 0.22 * ((Math.random() * 2 - 1) - y);
        d[i] = y * env;
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    return conv;
  }

  function build() {
    ctx = ensureAudio();
    const out = audioBus();
    if (!ctx || !out) return false;
    bus = ctx.createGain();
    bus.gain.value = 0; // fades up once scheduling starts
    bus.connect(out);
    dry = ctx.createGain();
    dry.connect(bus);
    // The room: send -> convolver -> wet -> bus (only the tail comes back).
    send = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = M.REVERB_WET;
    const conv = makeReverb();
    send.connect(conv);
    conv.connect(wet);
    wet.connect(bus);

    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = M.PAD_CUTOFF;
    padFilter.Q.value = 1.1;
    padFilter.connect(dry);
    const padSend = ctx.createGain();
    padSend.gain.value = 0.7;
    padFilter.connect(padSend);
    padSend.connect(send);
    // The pad lowpass breathes: a very slow LFO sweeps the cutoff.
    const breathe = ctx.createOscillator();
    breathe.frequency.value = M.PAD_BREATHE_HZ;
    const breatheAmt = ctx.createGain();
    breatheAmt.gain.value = M.PAD_BREATHE;
    breathe.connect(breatheAmt);
    breatheAmt.connect(padFilter.frequency);
    breathe.start();
    // Tape wobble: one LFO, its output added to every pad/arp oscillator's
    // detune (an AudioParam sums connected signals with its own value).
    const lfo = ctx.createOscillator();
    lfo.frequency.value = M.WOBBLE_HZ;
    wobble = ctx.createGain();
    wobble.gain.value = M.WOBBLE_CENTS;
    lfo.connect(wobble);
    lfo.start();
    startTexture();
    const t = ctx.currentTime;
    chordEnd = t + 0.5;             // first chord lands almost at once...
    nextNote = t + rand(4, 7);      // ...the melody waits a polite moment
    pulseNext = t + rand(6, 10);
    crackleNext = t + 1;
    return true;
  }

  // The vinyl bed: looping noise under a lowpass, its gain breathing on a
  // slow LFO. Lives as long as the context does.
  function startTexture() {
    if (M.TEXTURE_LEVEL <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1600;
    const g = ctx.createGain();
    g.gain.value = M.TEXTURE_LEVEL;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const depth = ctx.createGain();
    depth.gain.value = M.TEXTURE_LEVEL * 0.4;
    lfo.connect(depth);
    depth.connect(g.gain);
    src.connect(lp);
    lp.connect(g);
    g.connect(dry);
    src.start();
    lfo.start();
  }

  // One crackle: a few milliseconds of high-passed noise.
  function playCrackle(at) {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    const seconds = rand(0.004, 0.012);
    g.gain.setValueAtTime(M.CRACKLE_LEVEL * rand(0.3, 1), at);
    g.gain.linearRampToValueAtTime(0.0001, at + seconds);
    src.connect(hp);
    hp.connect(g);
    g.connect(dry);
    src.start(at, Math.random() * 0.8);
    src.stop(at + seconds + 0.01);
  }

  // One pad chord: every voice swells in over ~3.5s, holds, releases over
  // ~5s at the chord's end. Triangle bodies with a sine sub on the root,
  // the ninth a quiet sine on top; all riding the wobble.
  function playChord(name, at, seconds, level) {
    const chord = CHORDS[name];
    const n = chord.notes.length;
    for (let i = 0; i < n; i++) {
      const semi = chord.notes[i];
      const osc = ctx.createOscillator();
      osc.type = i === 0 || i === n - 1 ? 'sine' : 'triangle';
      osc.frequency.value = freq(semi);
      osc.detune.value = rand(-4, 4);
      wobble.connect(osc.detune);
      const g = ctx.createGain();
      const weight = i === 0 ? 0.9 : i === n - 1 ? 0.35 : 0.55;
      const peak = level * weight / (n - 1);
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
    lp.connect(dry);
    lp.connect(send);
    body.start(at);
    shimmer.start(at);
    body.stop(at + decay + 0.1);
    shimmer.stop(at + decay + 0.1);
  }

  // One arpeggio note: a soft electric piano — sine body, a second
  // harmonic, a tiny triangle click on the attack, short decay, wet.
  function playArpNote(semi, at, level) {
    const decay = rand(0.7, 1.1);
    const f = freq(semi);
    const parts = [
      ['sine', f, 1.0], ['sine', f * 2, 0.22], ['triangle', f, 0.12],
    ];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    for (const [type, hz, w] of parts) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz;
      wobble.connect(osc.detune);
      const pg = ctx.createGain();
      pg.gain.value = w;
      osc.connect(pg);
      pg.connect(g);
      osc.start(at);
      osc.stop(at + (type === 'triangle' ? 0.03 : decay + 0.05));
    }
    g.connect(lp);
    lp.connect(dry);
    lp.connect(send);
  }

  // The arpeggio under a chord: its tones climbing from C4, then the first
  // two again an octave up, one note per ARP_STEP, some resting.
  function scheduleArp(name, at, seconds) {
    const pcs = [...CHORDS[name].pcs].sort((a, b) => a - b);
    const seq = [...pcs, pcs[0] + 12, pcs[1] + 12];
    let t = at + rand(0.8, 2.0);
    let i = 0;
    while (t < at + seconds - 1) {
      if (Math.random() >= M.ARP_SKIP) {
        playArpNote(seq[i % seq.length], t, M.ARP_LEVEL * rand(0.6, 1));
        arpsPlayed++;
      }
      i++;
      t += rand(M.ARP_STEP[0], M.ARP_STEP[1]);
    }
  }

  // The pulse voices — brushed hat, muted thump, soft rim. Dry.
  function playHat(at, level) {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 6500;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(level, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    src.connect(bp);
    bp.connect(g);
    g.connect(dry);
    src.start(at, Math.random() * 0.8);
    src.stop(at + 0.06);
  }
  function playThump(at, level) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(64, at);
    osc.frequency.exponentialRampToValueAtTime(40, at + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(level, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(g);
    g.connect(dry);
    osc.start(at);
    osc.stop(at + 0.2);
  }
  function playRim(at, level) {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(level, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    src.connect(bp);
    bp.connect(g);
    g.connect(dry);
    src.start(at, Math.random() * 0.8);
    src.stop(at + 0.07);
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
    const dayParts = sunLevel > M.DAY_PARTS_ABOVE;
    const sparse = night ? M.NIGHT_SPARSE : 1;

    // The bus level breathes with the day (rare updates are plenty).
    if (now - lastGainSet > 1) {
      lastGainSet = now;
      bus.gain.setTargetAtTime(M.VOLUME * (night ? M.NIGHT_LEVEL : 1), now, 3);
    }

    // Harmony stream (+ the arpeggio that may ride the chord by day).
    if (chordEnd < now + 1) {
      chordName = pick(NEXT[chordName]);
      const hold = rand(M.CHORD_SECONDS[0], M.CHORD_SECONDS[1]) * sparse;
      const at = Math.max(chordEnd, now + 0.05);
      playChord(chordName, at, hold, M.PAD_LEVEL);
      chordsPlayed++;
      chordEnd = at + hold;
      if (dayParts && M.ARP_LEVEL > 0 && Math.random() < M.ARP_CHANCE) {
        scheduleArp(chordName, at, hold);
      }
    }

    // Melody stream: phrases with rests between them.
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

    // The pulse: swung eighths by day. Off at night — the clock simply
    // waits so it never plays catch-up when the sun comes back.
    if (M.PULSE_LEVEL > 0) {
      if (!dayParts) {
        pulseNext = Math.max(pulseNext, now + 0.5);
      } else if (pulseNext < now + 1) {
        const at = Math.max(pulseNext, now + 0.05);
        const beat = 60 / M.PULSE_BPM;
        const L = M.PULSE_LEVEL;
        if (Math.random() >= M.PULSE_DROP) playHat(at, 0.05 * L * rand(0.6, 1));
        if (pulseStep % 4 === 0 && Math.random() < 0.7) playThump(at, 0.1 * L);
        if (pulseStep % 4 === 2 && Math.random() < 0.5) playRim(at, 0.03 * L);
        pulsesPlayed++;
        // Swing: the on-beat eighth is long, the off-beat short.
        const dur = pulseStep % 2 === 0 ? beat * M.PULSE_SWING : beat * (1 - M.PULSE_SWING);
        pulseNext = at + dur;
        pulseStep = (pulseStep + 1) % 8;
      }
    }

    // Vinyl crackle: a Poisson trickle.
    if (M.CRACKLE_LEVEL > 0 && crackleNext < now + 1) {
      const at = Math.max(crackleNext, now + 0.02);
      playCrackle(at);
      crackleNext = at - Math.log(1 - Math.random()) / M.CRACKLES_PER_SECOND;
    }
  }

  // Debug/harness introspection: how much has actually been scheduled.
  function stats() {
    return {
      running: !!ctx && ctx.state === 'running',
      chords: chordsPlayed,
      notes: notesPlayed,
      arps: arpsPlayed,
      pulses: pulsesPlayed,
      chord: chordName,
    };
  }

  return { update, stats };
}
