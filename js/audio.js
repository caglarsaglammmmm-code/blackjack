// Web Audio ile üretilen ince sesler ve titreşim. Harici dosya yok.

export class SoundBoard {
  constructor() {
    this.enabled = true;
    this.vibration = true;
    this.ctx = null;
    this.noise = null;
  }

  // Tarayıcılar sesi yalnızca kullanıcı dokunuşundan sonra başlatır.
  unlock() {
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const length = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  tone(freq, { at = 0, length = 0.2, gain = 0.15, type = 'sine', slide = 0 } = {}) {
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + length);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(amp).connect(this.master);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  hiss({ at = 0, length = 0.07, gain = 0.2, freq = 2400, q = 0.9 } = {}) {
    const t = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter).connect(amp).connect(this.master);
    src.start(t, Math.random() * 0.4, length + 0.02);
  }

  card() {
    if (!this.ready()) return;
    this.hiss({ length: 0.075, gain: 0.26, freq: 2100 });
    this.hiss({ at: 0.03, length: 0.03, gain: 0.12, freq: 900 });
  }

  flip() {
    if (!this.ready()) return;
    this.hiss({ length: 0.12, gain: 0.2, freq: 1500, q: 0.6 });
  }

  chip() {
    if (!this.ready()) return;
    this.tone(3100, { length: 0.05, gain: 0.07 });
    this.tone(4300, { at: 0.012, length: 0.06, gain: 0.05 });
    this.hiss({ length: 0.03, gain: 0.08, freq: 5200 });
  }

  tap() {
    if (!this.ready()) return;
    this.tone(1100, { length: 0.035, gain: 0.03 });
  }

  win() {
    if (!this.ready()) return;
    [659, 880, 1109].forEach((freq, i) => this.tone(freq, { at: i * 0.09, length: 0.42, gain: 0.08 }));
  }

  blackjack() {
    if (!this.ready()) return;
    [523, 659, 784, 1047, 1319].forEach((freq, i) => {
      this.tone(freq, { at: i * 0.085, length: 0.8, gain: 0.08 });
      this.tone(freq * 2, { at: i * 0.085, length: 0.4, gain: 0.02 });
    });
  }

  push() {
    if (!this.ready()) return;
    this.tone(587, { length: 0.26, gain: 0.05 });
    this.tone(587, { at: 0.12, length: 0.28, gain: 0.04 });
  }

  lose() {
    if (!this.ready()) return;
    this.tone(196, { length: 0.5, gain: 0.1, slide: 0.72 });
    this.tone(147, { at: 0.05, length: 0.55, gain: 0.06, slide: 0.8 });
  }

  bust() {
    if (!this.ready()) return;
    this.tone(120, { length: 0.3, gain: 0.16, slide: 0.6 });
    this.hiss({ length: 0.14, gain: 0.1, freq: 500 });
  }

  shuffle() {
    if (!this.ready()) return;
    for (let i = 0; i < 16; i += 1) {
      this.hiss({ at: i * 0.05, length: 0.035, gain: 0.1 + (i % 3) * 0.03, freq: 1800 + i * 90 });
    }
  }

  buzz(pattern) {
    if (this.vibration && typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Bazı tarayıcılar kullanıcı etkileşimi olmadan reddeder.
      }
    }
  }
}
