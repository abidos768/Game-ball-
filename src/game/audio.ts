/**
 * Procedural sound effects via Web Audio.
 *
 * No asset files: every sound is synthesised from oscillators at runtime, so
 * this adds a couple of KB to the bundle rather than a couple of hundred.
 *
 * Browsers (and the Android WebView) block audio until the first user
 * gesture, so the context is created lazily on the first play() call that
 * follows a tap.
 */

const MUTE_KEY = 'neon-cell-muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  muted = false;
}

export function audioContext(): AudioContext | null {
  return ensureContext();
}

export function masterBus(): GainNode | null {
  ensureContext();
  return master;
}

function ensureContext(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.25;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  // Autoplay policy can leave the context suspended until a gesture.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

type ToneOpts = {
  freq: number;
  toFreq?: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
};

function tone({ freq, toFreq, duration, type = 'square', gain = 1, delay = 0 }: ToneOpts) {
  const c = ensureContext();
  if (!c || !master) return;

  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (toFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), t0 + duration);
  }

  // Short attack, exponential decay — reads as a chiptune blip.
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(env);
  env.connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noise(duration: number, gain = 0.6) {
  const c = ensureContext();
  if (!c || !master) return;

  const frames = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Fade the noise out linearly so it reads as an impact, not a hiss.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const src = c.createBufferSource();
  const env = c.createGain();
  src.buffer = buffer;
  env.gain.value = gain;
  src.connect(env);
  env.connect(master);
  src.start();
}

export const sfx = {
  orb: () => tone({ freq: 660, toFreq: 990, duration: 0.07, gain: 0.5 }),
  speedOrb: () => tone({ freq: 880, toFreq: 1550, duration: 0.11, gain: 0.55 }),
  powerup: () => {
    tone({ freq: 523, duration: 0.08, gain: 0.5 });
    tone({ freq: 784, duration: 0.08, gain: 0.5, delay: 0.07 });
    tone({ freq: 1046, duration: 0.14, gain: 0.5, delay: 0.14 });
  },
  shoot: () => tone({ freq: 420, toFreq: 180, duration: 0.06, type: 'sawtooth', gain: 0.28 }),
  enemyKill: () => {
    tone({ freq: 300, toFreq: 90, duration: 0.16, type: 'sawtooth', gain: 0.45 });
    noise(0.1, 0.35);
  },
  bossKill: () => {
    tone({ freq: 220, toFreq: 55, duration: 0.4, type: 'sawtooth', gain: 0.6 });
    noise(0.35, 0.5);
  },
  hurt: () => tone({ freq: 200, toFreq: 70, duration: 0.2, type: 'triangle', gain: 0.6 }),
  levelUp: () => {
    tone({ freq: 659, duration: 0.09, gain: 0.5 });
    tone({ freq: 880, duration: 0.09, gain: 0.5, delay: 0.09 });
    tone({ freq: 1318, duration: 0.18, gain: 0.5, delay: 0.18 });
  },
  gameOver: () => {
    tone({ freq: 440, duration: 0.16, type: 'triangle', gain: 0.5 });
    tone({ freq: 330, duration: 0.16, type: 'triangle', gain: 0.5, delay: 0.16 });
    tone({ freq: 220, duration: 0.45, type: 'triangle', gain: 0.5, delay: 0.32 });
  },
  trophy: () => {
    tone({ freq: 784, duration: 0.08, gain: 0.45 });
    tone({ freq: 1046, duration: 0.08, gain: 0.45, delay: 0.08 });
    tone({ freq: 1318, duration: 0.22, gain: 0.45, delay: 0.16 });
  },
  click: () => tone({ freq: 540, duration: 0.045, gain: 0.35 }),
  purchase: () => {
    tone({ freq: 880, duration: 0.07, gain: 0.5 });
    tone({ freq: 1318, duration: 0.16, gain: 0.5, delay: 0.07 });
  },
};

export function isMuted() {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    // Storage unavailable — the setting just won't survive a restart.
  }
  if (master) master.gain.value = next ? 0 : 0.25;
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}
