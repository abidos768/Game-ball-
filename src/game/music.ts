/**
 * Procedural background music.
 *
 * Nothing is downloaded or sampled: a lookahead scheduler walks a chord
 * progression and spawns short oscillator voices for a bass pulse, an
 * arpeggio and an off-beat pad. Tempo and brightness rise with the player's
 * level, so the track intensifies as a run goes on without needing stems.
 *
 * The scheduler runs on a 25ms timer and queues notes ~120ms ahead. Timing
 * comes from AudioContext.currentTime rather than the timer itself, so the
 * groove doesn't drift when the main thread is busy drawing frames.
 */

import { audioContext, masterBus } from './audio';

// A natural minor: dark enough to suit the arena, simple enough to loop.
const A = 220;
const SCALE = [0, 2, 3, 5, 7, 8, 10]; // semitone offsets

// i - VI - III - VII, the classic four-bar minor loop.
const PROGRESSION = [0, 5, 2, 6];

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12; // seconds

function midiToFreq(semitonesFromA: number) {
  return A * Math.pow(2, semitonesFromA / 12);
}

function degree(step: number) {
  const octave = Math.floor(step / SCALE.length);
  return SCALE[((step % SCALE.length) + SCALE.length) % SCALE.length] + octave * 12;
}

let timer: number | null = null;
let bus: GainNode | null = null;
let nextNoteTime = 0;
let step16 = 0;
let intensity = 1; // driven by the player's level

function ensureBus(): GainNode | null {
  const ctx = audioContext();
  const master = masterBus();
  if (!ctx || !master) return null;
  if (!bus) {
    bus = ctx.createGain();
    // Well under the SFX level: music should sit behind the gameplay, and
    // the two share the same master so muting kills both.
    bus.gain.value = 0.0;
    bus.connect(master);
  }
  return bus;
}

type VoiceOpts = {
  freq: number;
  time: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  detune?: number;
};

function voice({ freq, time, duration, type, gain, detune = 0 }: VoiceOpts) {
  const ctx = audioContext();
  const out = ensureBus();
  if (!ctx || !out) return;

  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  osc.detune.setValueAtTime(detune, time);

  // Opening the filter with intensity is what makes later levels feel urgent.
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(700 + intensity * 900, time);
  filter.Q.value = 6;

  env.gain.setValueAtTime(0.0001, time);
  env.gain.exponentialRampToValueAtTime(gain, time + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, time + duration);

  osc.connect(filter);
  filter.connect(env);
  env.connect(out);
  osc.start(time);
  osc.stop(time + duration + 0.03);
}

function scheduleStep(step: number, time: number) {
  const bar = Math.floor(step / 16) % PROGRESSION.length;
  const root = PROGRESSION[bar];
  const beat = step % 16;

  // Bass: root on the downbeat and the "and" of 3.
  if (beat === 0 || beat === 10) {
    voice({
      freq: midiToFreq(degree(root) - 12),
      time,
      duration: beat === 0 ? 0.42 : 0.26,
      type: 'triangle',
      gain: 0.22,
    });
  }

  // Arpeggio: root, third, fifth, octave across every other 16th.
  if (beat % 2 === 0) {
    const pattern = [0, 2, 4, 7, 4, 2];
    const note = degree(root + pattern[(step / 2) % pattern.length]);
    voice({
      freq: midiToFreq(note),
      time,
      duration: 0.16,
      type: 'square',
      gain: 0.055 + intensity * 0.02,
    });
  }

  // Pad: a detuned fifth on the off-beats, only once the run gets going.
  if (intensity > 1.3 && (beat === 4 || beat === 12)) {
    voice({
      freq: midiToFreq(degree(root + 4) + 12),
      time,
      duration: 0.5,
      type: 'sawtooth',
      gain: 0.028,
      detune: 8,
    });
  }
}

function tick() {
  const ctx = audioContext();
  if (!ctx) return;

  const bpm = Math.min(150, 96 + intensity * 9);
  const secondsPer16th = 60 / bpm / 4;

  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(step16, nextNoteTime);
    nextNoteTime += secondsPer16th;
    step16++;
  }
}

export function startMusic() {
  const ctx = audioContext();
  const out = ensureBus();
  if (!ctx || !out || timer !== null) return;

  step16 = 0;
  nextNoteTime = ctx.currentTime + 0.06;
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
  out.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 1.2); // fade in
  timer = window.setInterval(tick, LOOKAHEAD_MS);
}

export function stopMusic() {
  const ctx = audioContext();
  if (bus && ctx) {
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.5); // fade out
  }
  if (timer !== null) {
    // Let the fade finish before the scheduler stops feeding it.
    const handle = timer;
    timer = null;
    window.setTimeout(() => window.clearInterval(handle), 600);
  }
}

/** Level 1 is calm; by level ~10 the loop is faster and brighter. */
export function setMusicIntensity(level: number) {
  intensity = Math.max(1, Math.min(6, 1 + (level - 1) * 0.5));
}
