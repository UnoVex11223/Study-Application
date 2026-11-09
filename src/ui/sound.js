// Sounds, off unless turned on in Settings. All of them are synthesised with
// Web Audio when they play (no sound files), and kept quiet and short. The
// answers sound like a plucked string (a koto, more or less: Karplus–Strong
// synthesis, a burst of noise ringing in a short delay line), in a pentatonic
// scale so nothing ever clashes:
//   correct   two plucks rising a fifth
//   miss      one low, muted pluck that sinks a little: noted, not scolded
//   mastered  the scale run up, over a soft low bell (the mastery test)
//   level     three plucks up and a high shimmer (a new level)
//   page      a paper rustle when you log a chapter on the shelf
//   chime     a low bell when a session ends

let enabled = false;
let ctx = null;
let master = null;

export const setSounds = (on) => { enabled = Boolean(on); };

function audio() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** One sine partial with a quick attack and an exponential fade. */
function tone(c, { freq, at = 0, dur = 0.3, gain = 0.05, attack = 0.005, type = "sine" }) {
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuffer = null;
/** A burst of noise through a band-pass filter that sweeps down: paper moving. */
function rustle(c, { at = 0, dur = 0.2, gain = 0.09, from = 3200, to = 900 }) {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, Math.round(c.sampleRate * 0.4), c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuffer;
  f.type = "bandpass";
  f.Q.value = 0.9;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

const plucks = new Map();
/**
 * A plucked string: noise, softened, ringing in a delay line one period long
 * that averages neighbouring samples (so the highs die first, as on a real
 * string). damp < 1 shortens the ring; soft (0–1) takes the edge off the attack.
 */
function pluckBuffer(c, freq, { dur = 1.2, damp = 0.996, soft = 0.5 } = {}) {
  const key = `${freq}|${dur}|${damp}|${soft}|${c.sampleRate}`;
  if (plucks.has(key)) return plucks.get(key);
  const sr = c.sampleRate, n = Math.round(sr * dur), period = Math.max(2, Math.round(sr / freq));
  const buf = c.createBuffer(1, n, sr), d = buf.getChannelData(0), line = new Float32Array(period);
  let prev = 0;
  for (let i = 0; i < period; i++) { prev = prev * soft + (Math.random() * 2 - 1) * (1 - soft); line[i] = prev; }
  let peak = 0;
  for (let i = 0, j = 0; i < n; i++) {
    const cur = line[j], next = line[(j + 1) % period];
    d[i] = cur;
    peak = Math.max(peak, Math.abs(cur));
    line[j] = damp * 0.5 * (cur + next);
    j = (j + 1) % period;
  }
  if (peak > 0) for (let i = 0; i < n; i++) d[i] /= peak;
  plucks.set(key, buf);
  return buf;
}

/** Play a pluck, through a gentle low-pass so it sits warm rather than bright. */
function pluck(c, { freq, at = 0, gain = 0.12, dur = 1.2, damp = 0.996, soft = 0.5, cutoff = 4200, bend = 0 }) {
  const t = c.currentTime + at;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = pluckBuffer(c, freq, { dur, damp, soft });
  if (bend) { // a slight sag in pitch as it fades
    src.playbackRate.setValueAtTime(1, t);
    src.playbackRate.linearRampToValueAtTime(1 + bend, t + dur * 0.6);
  }
  f.type = "lowpass";
  f.frequency.value = cutoff;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

// D major pentatonic: D E F♯ A B.
const D4 = 293.66, E4 = 329.63, FS4 = 369.99, A4 = 440, B4 = 493.88, D5 = 587.33, E5 = 659.25, FS5 = 739.99, A5 = 880, D6 = 1174.66;

const SOUNDS = {
  correct: (c) => {
    pluck(c, { freq: D5, gain: 0.13, dur: 0.9 });
    pluck(c, { freq: A5, at: 0.09, gain: 0.11, dur: 1.1 });
  },
  miss: (c) => {
    pluck(c, { freq: A4 / 2, gain: 0.12, dur: 0.55, damp: 0.985, soft: 0.75, cutoff: 1400, bend: -0.03 });
    pluck(c, { freq: FS4 / 2, at: 0.11, gain: 0.08, dur: 0.6, damp: 0.985, soft: 0.75, cutoff: 1200, bend: -0.03 });
  },
  mastered: (c) => {
    [D4, E4, FS4, A4, B4, D5, E5, FS5, A5, D6].forEach((f, i) => pluck(c, { freq: f, at: i * 0.07, gain: 0.07 + i * 0.004, dur: 1.6 }));
    tone(c, { freq: D4 / 2, dur: 2.6, gain: 0.02, attack: 0.03 });
    tone(c, { freq: D5, at: 0.7, dur: 2.2, gain: 0.014, attack: 0.02 });
  },
  level: (c) => {
    [D5, FS5, A5].forEach((f, i) => pluck(c, { freq: f, at: i * 0.1, gain: 0.11, dur: 1.3 }));
    tone(c, { freq: D6 * 2, at: 0.3, dur: 1.4, gain: 0.006, attack: 0.04 });
    tone(c, { freq: A5 * 2, at: 0.36, dur: 1.2, gain: 0.005, attack: 0.04 });
  },
  page: (c) => {
    rustle(c, { dur: 0.17, gain: 0.07 });
    rustle(c, { at: 0.07, dur: 0.24, gain: 0.05, from: 2400, to: 600 });
  },
  chime: (c) => {
    // A soft major arpeggio with a faint, slightly sharp overtone on each note: a small bell.
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone(c, { freq: f, at: i * 0.085, dur: 1.8, gain: 0.034, attack: 0.008 });
      tone(c, { freq: f * 2.01, at: i * 0.085, dur: 0.7, gain: 0.008 });
    });
    tone(c, { freq: 261.63, dur: 2.2, gain: 0.018, attack: 0.02 });
  },
};

/** Play a sound if sounds are on (force: play anyway, for the preview in Settings). */
export function play(name, { force = false } = {}) {
  if ((!enabled && !force) || typeof window === "undefined" || !SOUNDS[name]) return;
  try { SOUNDS[name](audio()); } catch { /* no audio output */ }
}
