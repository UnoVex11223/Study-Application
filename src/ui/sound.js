// Sounds, off unless turned on in Settings. All of them are synthesised with
// Web Audio when they play (no sound files), and kept quiet and short:
//   correct  a soft two-note tick when an answer comes back right
//   page     a paper rustle when you log a chapter on the shelf
//   chime    a low bell when a session ends

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

const SOUNDS = {
  correct: (c) => {
    tone(c, { freq: 1318.5, dur: 0.16, gain: 0.045 });            // E6
    tone(c, { freq: 1975.5, at: 0.05, dur: 0.22, gain: 0.03 });   // B6
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
