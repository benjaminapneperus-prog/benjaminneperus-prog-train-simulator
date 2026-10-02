// Procedural train audio (WebAudio, no samples).
export class TrainAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._whistle = null;
    const unlock = () => this._init();
    // Capture phase, so clicks on the voxel controls (which stop propagation)
    // still unlock audio on the very first interaction.
    for (const ev of ['pointerdown', 'touchstart', 'keydown', 'click']) addEventListener(ev, unlock, { capture: true, passive: true });
  }

  _init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().then(() => this.onStart?.());
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // continuous beds: steam hiss, wind, brake squeal
    this.hiss = this._loopNoise('bandpass', 3800, 0.6, 0);
    this.wind = this._loopNoise('lowpass', 420, 0.4, 0);
    this.roll = this._loopNoise('lowpass', 180, 0.8, 0);
    const sq = ctx.createOscillator();
    sq.type = 'triangle';
    sq.frequency.value = 2100;
    const sqg = ctx.createGain();
    sqg.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfog = ctx.createGain();
    lfog.gain.value = 60;
    lfo.connect(lfog).connect(sq.frequency);
    sq.connect(sqg).connect(this.master);
    sq.start(); lfo.start();
    this.squeal = sqg;
    const started = () => this.onStart?.();
    if (ctx.state === 'running') started();
    else ctx.resume().then(started).catch(() => {});
  }

  _loopNoise(type, freq, q, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { g, f };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  _burst({ type = 'bandpass', freq = 800, q = 1, dur = 0.2, gain = 0.3, attack = 0.005, when = 0, rate = 1 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  _tone(freq, dur, gain, type = 'sine', when = 0, attack = 0.005) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  chuff(strength) {
    if (!this.ready) return;
    const s = Math.max(0.08, Math.min(1, strength));
    this._burst({ type: 'bandpass', freq: 520 + Math.random() * 160, q: 0.9, dur: 0.16 + 0.16 * s, gain: 0.32 * s, attack: 0.006 });
    this._burst({ type: 'lowpass', freq: 220, q: 0.7, dur: 0.12, gain: 0.25 * s, attack: 0.004 });
  }

  railClick(vol = 1, when = 0) {
    if (!this.ready) return;
    this._burst({ type: 'bandpass', freq: 2600, q: 4, dur: 0.035, gain: 0.12 * vol, when, attack: 0.002 });
    this._tone(110 + Math.random() * 20, 0.06, 0.12 * vol, 'sine', when, 0.002);
  }

  notch() {
    if (!this.ready) return;
    this._burst({ type: 'bandpass', freq: 3200, q: 6, dur: 0.03, gain: 0.25, attack: 0.001 });
    this._tone(620, 0.05, 0.08, 'square', 0, 0.001);
  }

  chime() {
    if (!this.ready) return;
    this._tone(1046.5, 1.2, 0.12, 'sine', 0, 0.005);
    this._tone(1568, 1.4, 0.08, 'sine', 0.18, 0.005);
    this._tone(2093, 1.0, 0.05, 'sine', 0.36, 0.005);
  }

  whistle(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this._whistle) {
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.22, t + 0.09);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 3200;
      out.connect(lp).connect(this.master);
      const oscs = [];
      for (const [f, gv] of [[523.25, 0.5], [659.25, 0.38], [783.99, 0.3], [1046.5, 0.08]]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 0.96, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.5;
        const vg = ctx.createGain();
        vg.gain.value = f * 0.004;
        vib.connect(vg).connect(o.frequency);
        const g = ctx.createGain();
        g.gain.value = gv * 0.35;
        o.connect(g).connect(out);
        o.start(t); vib.start(t);
        oscs.push(o, vib);
      }
      // breath
      const n = ctx.createBufferSource();
      n.buffer = this.noise; n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1.2;
      const ng = ctx.createGain(); ng.gain.value = 0.12;
      n.connect(bp).connect(ng).connect(out);
      n.start(t);
      oscs.push(n);
      this._whistle = { out, oscs };
    } else if (!on && this._whistle) {
      const w = this._whistle;
      w.out.gain.cancelScheduledValues(t);
      w.out.gain.setValueAtTime(w.out.gain.value, t);
      w.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      for (const o of w.oscs) o.stop(t + 0.32);
      this._whistle = null;
    }
  }

  toot(duration = 0.7) {
    this.whistle(true);
    setTimeout(() => this.whistle(false), duration * 1000);
  }

  // continuous mix, called every frame
  update(dt, { speed, vmax, braking, idleSteam, alpine, night }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const sp = speed / vmax;
    this.hiss.g.gain.setTargetAtTime(0.02 + idleSteam * 0.07, t, 0.2);
    this.roll.g.gain.setTargetAtTime(0.14 * Math.min(1, sp * 1.4), t, 0.2);
    this.roll.f.frequency.setTargetAtTime(120 + sp * 260, t, 0.3);
    this.wind.g.gain.setTargetAtTime(0.03 + alpine * 0.06 + sp * 0.03, t, 0.5);
    this.squeal.gain.setTargetAtTime(braking && speed > 1.2 && speed < 9 ? 0.012 * Math.min(1, speed / 4) : 0, t, 0.08);
    // birdsong in the green valley by day
    if (!alpine && night < 0.5 && Math.random() < dt * 0.35) {
      const f = 2400 + Math.random() * 1800;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this._tone(f * (1 + i * 0.08), 0.08, 0.03, 'sine', i * 0.11, 0.01);
    }
  }
}
