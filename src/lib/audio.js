// Feedback sounds, synthesized with the Web Audio API.

export const playCorrect = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.type = "sine";
      const t = ctx.currentTime + i * 0.12;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.start(t); o.stop(t + 0.45);
    });
  } catch { /* audio unavailable */ }
};

export const playWrong = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[220, 0], [175, 0.18]].forEach(([freq, delay]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), d = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = (i * 2) / 256 - 1; curve[i] = (Math.PI + 80) * x / (Math.PI + 80 * Math.abs(x)); }
      d.curve = curve; o.connect(d); d.connect(g); g.connect(ctx.destination); o.type = "sawtooth";
      const t = ctx.currentTime + delay;
      o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.15);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.start(t); o.stop(t + 0.25);
    });
  } catch { /* audio unavailable */ }
};
