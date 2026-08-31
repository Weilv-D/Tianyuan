/**
 * 程序化音频引擎 · 夜宴室内乐。
 *
 * 全部声音由 WebAudio 实时合成，零音频文件、零加载等待。
 * 音乐语言：中国五声音阶（宫商角徵羽 = C D E G A）—— 与美术的东方语汇同源。
 *
 * 三条独立总线（BGM / SFX / UI），音量可分别调节并持久化。
 * 共享卷积混响、滤波压暗、声像摆位、乐句级调度与交叉淡入淡出。
 */

type Bus = 'bgm' | 'sfx' | 'ui';

/** 五声音阶（C 宫调），单位：半音相对 A4=440 */
const PENTATONIC = [0, 2, 4, 7, 9];
const ROOT_HZ = 130.81; // C3

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private volumes: Record<Bus, number> = { bgm: 0.5, sfx: 0.75, ui: 0.6 };
  private muted = false;

  private bgmTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private mood: 'prep' | 'battle' | 'final' | 'none' = 'none';
  private started = false;
  private visBound = false;
  private noiseBufCache = new Map<number, AudioBuffer>();

  private reverb: ConvolverNode | null = null;
  private reverbBuilt = false;

  /** 必须在用户手势后调用 */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 24;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    if (!this.visBound) {
      this.visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend();
        else {
          void this.ctx.resume();
          this.resyncBgm();
        }
      });
    }
    this.buses = {
      bgm: this.ctx.createGain(),
      sfx: this.ctx.createGain(),
      ui: this.ctx.createGain(),
    };
    for (const k of Object.keys(this.buses) as Bus[]) {
      this.buses[k].gain.value = this.volumes[k];
      this.buses[k].connect(this.master);
    }
    this.buildReverb();
    this.started = true;
  }

  get ready(): boolean {
    return this.started && !!this.ctx;
  }

  setVolume(bus: Bus, v: number): void {
    this.volumes[bus] = v;
    if (this.ctx) this.buses[bus].gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  getVolume(bus: Bus): number {
    return this.volumes[bus];
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  isMuted(): boolean {
    return this.muted;
  }

  // ── 混响 ──

  private buildReverb(): void {
    if (!this.ctx || this.reverbBuilt) return;
    try {
      const ctx = this.ctx;
      const dur = 1.8;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          const env = Math.pow(1 - t, 2.4);
          const n = Math.random() * 2 - 1;
          const low = Math.sin(i * 0.0017 * (ch === 0 ? 1 : 1.07)) * 0.15;
          d[i] = (n * 0.55 + low) * env * 0.42;
        }
      }
      const conv = ctx.createConvolver();
      conv.buffer = buf;
      conv.normalize = true;
      const wet = ctx.createGain();
      wet.gain.value = 0.14;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2800;
      lp.Q.value = 0.7;
      conv.connect(lp).connect(wet).connect(this.buses.bgm);
      this.reverb = conv;
      void wet;
      this.reverbBuilt = true;
    } catch {
      this.reverb = null;
    }
  }

  // ── 合成基元 ──

  private now(): number {
    return this.ctx!.currentTime;
  }

  private noiseBuffer(dur: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const cached = this.noiseBufCache.get(len);
    if (cached) return cached;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.noiseBufCache.size < 24) this.noiseBufCache.set(len, buf);
    return buf;
  }

  /** 把已成形的 Gain 输出接到总线，可选声像与混响发送 */
  private wireGain(g: GainNode, bus: Bus, pan: number, revSend: number): void {
    const ctx = this.ctx!;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      try {
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(panner).connect(this.buses[bus]);
      } catch {
        g.connect(this.buses[bus]);
      }
    } else {
      g.connect(this.buses[bus]);
    }
    if (revSend > 0 && this.reverb && bus === 'bgm') {
      const send = ctx.createGain();
      send.gain.value = revSend;
      g.connect(send).connect(this.reverb);
    }
  }

  private tone(
    bus: Bus,
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    when = 0,
    attack = 0.005,
    detune = 0,
    cutoff?: number,
    q?: number,
    pan?: number,
    revSend?: number,
  ): OscillatorNode {
    const ctx = this.ctx!;
    const t = this.now() + when;
    if (!Number.isFinite(freq) || !Number.isFinite(t) || freq <= 0 || dur <= 0) {
      return ctx.createOscillator();
    }
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (detune) osc.detune.setValueAtTime(detune, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    if (typeof cutoff === 'number' && Number.isFinite(cutoff) && cutoff > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff, t);
      f.Q.value = q ?? 0.7;
      osc.connect(f).connect(g);
      this.wireGain(g, bus, pan ?? 0, revSend ?? 0);
    } else {
      osc.connect(g);
      this.wireGain(g, bus, pan ?? 0, revSend ?? 0);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return osc;
  }

  private noise(
    bus: Bus,
    dur: number,
    gain: number,
    filterHz: number,
    q: number,
    when = 0,
    type: BiquadFilterType = 'bandpass',
    pan = 0,
    revSend = 0,
  ): void {
    const ctx = this.ctx!;
    const t = this.now() + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterHz, t);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    this.wireGain(g, bus, pan, revSend);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private sweep(
    bus: Bus,
    from: number,
    to: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    when = 0,
    pan = 0,
    revSend = 0,
  ): void {
    const ctx = this.ctx!;
    const t = this.now() + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    this.wireGain(g, bus, pan, revSend);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noteHz(degree: number, octave = 0): number {
    const d = Math.floor(degree);
    const semi = PENTATONIC[((d % 5) + 5) % 5] + 12 * (octave + Math.floor(d / 5));
    return ROOT_HZ * Math.pow(2, semi / 12);
  }

  // ── 音效 ──

  play(name: SfxName): void {
    if (!this.ready) return;
    const jitterPan = () => Math.random() * 0.36 - 0.18;
    switch (name) {
      case 'hit':
        this.tone('sfx', 150, 0.1, 'sine', 0.18, 0, 0.004, 0, 900, 0.8, jitterPan(), 0);
        this.noise('sfx', 0.07, 0.26, 900, 1.0, 0, 'bandpass', jitterPan(), 0);
        break;
      case 'crit':
        this.noise('sfx', 0.14, 0.42, 1800, 0.8, 0, 'bandpass', jitterPan(), 0);
        this.sweep('sfx', 520, 80, 0.22, 0.24, 'sawtooth', 0, jitterPan(), 0);
        this.tone('sfx', 70, 0.22, 'sine', 0.36, 0.02, 0.01, 0, 700, 0.7, jitterPan(), 0);
        this.tone('sfx', 880, 0.14, 'triangle', 0.09, 0.06, 0.005, 0, 2200, 0.6, jitterPan(), 0);
        break;
      case 'shoot':
        this.noise('sfx', 0.06, 0.2, 2800, 2.0, 0, 'highpass', jitterPan(), 0);
        this.sweep('sfx', 900, 340, 0.09, 0.11, 'triangle', 0, jitterPan(), 0);
        break;
      case 'cast':
        this.sweep('sfx', 220, 920, 0.38, 0.15, 'sine', 0, 0, 0);
        this.tone('sfx', 660, 0.36, 'triangle', 0.08, 0.02, 0.006, 0, 1600, 0.7, 0, 0);
        this.tone('sfx', 990, 0.32, 'sine', 0.045, 0.06, 0.008, 0, 2000, 0.6, 0, 0);
        break;
      case 'skillBig':
        this.sweep('sfx', 120, 1400, 0.52, 0.22, 'sawtooth', 0, 0, 0);
        this.noise('sfx', 0.42, 0.32, 900, 0.6, 0.08, 'bandpass', 0, 0);
        this.tone('sfx', 60, 0.58, 'sine', 0.38, 0.1, 0.02, 0, 600, 0.8, 0, 0);
        for (let i = 0; i < 4; i++) {
          const pan = i % 2 === 0 ? -0.22 : 0.22;
          this.tone('sfx', this.noteHz(i + 4, 1), 0.28, 'triangle', 0.09, 0.12 + i * 0.05, 0.006, 0, 2000, 0.6, pan, 0);
        }
        break;
      case 'heal':
        for (let i = 0; i < 3; i++) this.tone('sfx', this.noteHz(i + 2, 1), 0.52, 'sine', 0.11, i * 0.06, 0.01, 0, 2400, 0.6, (i - 1) * 0.18, 0);
        this.noise('sfx', 0.28, 0.07, 3400, 1.3, 0, 'highpass', 0, 0);
        break;
      case 'shield':
        this.tone('sfx', 320, 0.32, 'triangle', 0.14, 0, 0.008, 0, 1200, 0.7, -0.12, 0);
        this.tone('sfx', 480, 0.28, 'sine', 0.09, 0.03, 0.008, 0, 1600, 0.6, 0.12, 0);
        this.noise('sfx', 0.2, 0.09, 2200, 2, 0, 'highpass', 0, 0);
        break;
      case 'death':
        this.sweep('sfx', 340, 58, 0.58, 0.22, 'sawtooth', 0, 0, 0);
        this.noise('sfx', 0.4, 0.18, 520, 0.7, 0.05, 'bandpass', 0, 0);
        this.tone('sfx', 46, 0.52, 'sine', 0.28, 0.1, 0.02, 0, 500, 0.8, 0, 0);
        break;
      case 'star3':
        for (let i = 0; i < 6; i++) {
          const pan = i % 2 === 0 ? -0.18 : 0.18;
          this.tone('sfx', this.noteHz(i, 1), 0.52, 'triangle', 0.14, i * 0.075, 0.008, 0, 2600, 0.6, pan, 0);
          this.tone('sfx', this.noteHz(i, 2), 0.36, 'sine', 0.07, i * 0.075 + 0.02, 0.008, 0, 3000, 0.5, pan, 0);
        }
        this.noise('sfx', 0.9, 0.11, 4200, 1.2, 0.1, 'highpass', 0, 0);
        this.tone('sfx', 64, 1.0, 'sine', 0.32, 0.1, 0.02, 0, 900, 0.7, 0, 0);
        break;
      case 'levelup':
        for (let i = 0; i < 4; i++) {
          const pan = i % 2 === 0 ? -0.15 : 0.15;
          this.tone('sfx', this.noteHz(i, 1), 0.34, 'triangle', 0.13, i * 0.06, 0.006, 0, 2200, 0.6, pan, 0);
        }
        break;
      case 'coin':
        this.tone('ui', 1180, 0.1, 'sine', 0.15, 0, 0.004, 0, 3000, 0.6, -0.1, 0);
        this.tone('ui', 1760, 0.14, 'sine', 0.11, 0.035, 0.005, 0, 3200, 0.6, 0.1, 0);
        break;
      case 'ui':
        this.tone('ui', 520, 0.05, 'square', 0.045, 0, 0.003, 0, 1800, 0.7, 0, 0);
        this.noise('ui', 0.04, 0.045, 3000, 1.5, 0, 'highpass', 0, 0);
        break;
      case 'uiBig':
        this.tone('ui', 300, 0.14, 'triangle', 0.11, 0, 0.006, 0, 1400, 0.7, 0, 0);
        this.tone('ui', 600, 0.16, 'sine', 0.07, 0.04, 0.008, 0, 1800, 0.6, 0, 0);
        break;
      case 'warn':
        this.tone('ui', 180, 0.32, 'sawtooth', 0.12, 0, 0.01, 0, 900, 0.9, 0, 0);
        this.tone('ui', 118, 0.42, 'sine', 0.16, 0.1, 0.02, 0, 700, 0.7, 0, 0);
        break;
      case 'victory':
        for (let i = 0; i < 5; i++) {
          const pan = i % 2 === 0 ? -0.14 : 0.14;
          this.tone('sfx', this.noteHz(i, 1), 0.7, 'triangle', 0.14, i * 0.11, 0.01, 0, 2400, 0.6, pan, 0);
        }
        this.tone('sfx', this.noteHz(0, 2), 1.1, 'sine', 0.15, 0.55, 0.02, 0, 2200, 0.6, 0, 0);
        break;
      case 'defeat':
        for (let i = 4; i >= 0; i--) this.tone('sfx', this.noteHz(i, 0), 0.6, 'sine', 0.13, (4 - i) * 0.13, 0.012, 0, 1600, 0.6, 0, 0);
        this.tone('sfx', 54, 1.2, 'sine', 0.26, 0.5, 0.02, 0, 600, 0.8, 0, 0);
        break;
      default:
        break;
    }
  }

  // ── BGM ──

  startBgm(mood: 'prep' | 'battle' | 'final'): void {
    if (!this.ready) return;
    if (this.mood === mood && this.bgmTimer !== null) return;
    const prev = this.mood;
    this.mood = mood;
    if (prev !== 'none' && this.buses) {
      const now = this.now();
      const g = this.buses.bgm.gain;
      try {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(Math.max(0.0001, this.volumes.bgm * 0.18), now + 0.12);
        g.linearRampToValueAtTime(this.volumes.bgm, now + 0.7);
      } catch {}
    }
    if ((prev === 'prep' || prev === 'final') && mood === 'battle') {
      this.step = (Math.ceil(this.step / 8) * 8) % 64;
    } else if (prev === 'none') {
      this.step = 0;
    }
    this.nextNoteTime = this.now() + 0.12;
    if (this.bgmTimer !== null) window.clearInterval(this.bgmTimer);
    this.bgmTimer = window.setInterval(() => this.scheduleBgm(), 60);
  }

  stopBgm(): void {
    if (this.bgmTimer !== null) window.clearInterval(this.bgmTimer);
    this.bgmTimer = null;
    this.mood = 'none';
    if (this.ctx && this.buses) {
      try {
        const g = this.buses.bgm.gain;
        const now = this.now();
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0.0001, now + 0.22);
        window.setTimeout(() => {
          if (this.ctx && this.buses && this.mood === 'none') {
            try { g.setValueAtTime(this.volumes.bgm, this.ctx.currentTime); } catch {}
          }
        }, 240);
      } catch {}
    }
  }

  private resyncBgm(): void {
    if (!this.ctx || this.mood === 'none') return;
    this.nextNoteTime = Math.max(this.nextNoteTime, this.now() + 0.1);
  }

  private scheduleBgm(): void {
    if (!this.ctx || this.mood === 'none') return;
    const tempo = this.mood === 'prep' ? 0.5 : this.mood === 'battle' ? 0.32 : 0.26;
    this.resyncBgm();
    while (this.nextNoteTime < this.now() + 0.25) {
      const t = this.nextNoteTime - this.now();
      const s = this.step;
      const bar = Math.floor(s / 8);
      const beat = s % 8;
      const swing = this.mood === 'prep' && beat % 2 === 1 ? 0.018 : 0;

      if (this.mood === 'prep') {
        const chunk = Math.floor(bar / 2) % 4;
        const padRoots = [0, 3, 2, 0];
        const isChunkHead = bar % 2 === 0 && beat === 0;
        if (isChunkHead) {
          const f = this.noteHz(padRoots[chunk], -1);
          this.tone('bgm', f, 7.2, 'sine', 0.062, t, 0.9, 0, 560, 0.8, 0, 0.18);
          this.tone('bgm', f * 2, 3.6, 'sine', 0.018, t + 0.08, 0.9, 0, 900, 0.7, 0, 0.12);
        }
        if (beat % 2 === 0) {
          const prepMotifs: number[][] = [
            [0, 2, 4, 2],
            [0, 3, 2, 4],
            [2, 4, 5, 3],
            [1, 3, 4, 2],
          ];
          const motif = prepMotifs[chunk];
          const deg = motif[(beat / 2) % 4];
          const pan = beat % 4 === 0 ? -0.26 : 0.26;
          const isB = chunk === 2;
          this.pluck(this.noteHz(deg, 1), isB ? 0.092 : 0.078, t + swing, pan, 0.16);
          if (isB && beat === 0) this.pluck(this.noteHz(deg + 1, 1), 0.052, t + swing + 0.09, -pan * 0.6, 0.12);
          if (bar % 2 === 0 && beat % 4 === 0) this.pluck(this.noteHz(deg + 2, 1), 0.038, t + swing + 0.025, pan * 0.5, 0.1);
        }
        if (beat === 3 || beat === 7) this.noise('bgm', 0.04, 0.042, 5200, 1.1, t + swing, 'highpass', beat === 3 ? -0.08 : 0.08, 0.04);
        if (s % 16 === 8) {
          const f = this.noteHz((chunk + 1) % 4, 0);
          this.tone('bgm', f, 2.0, 'triangle', 0.022, t, 0.6, 0, 1200, 0.7, 0, 0.1);
        }
      } else {
        const isFinal = this.mood === 'final';
        if (beat === 0) this.drum(t + swing, 0.24, 1, 0);
        if (beat === 2) this.drum(t + swing, 0.14, 1.45, -0.1);
        if (beat === 4) {
          this.drum(t + swing, 0.22, 1, 0);
          this.drum(t + swing + 0.02, 0.15, 1.6, 0.12);
        }
        if (beat === 6) this.drum(t + swing, 0.095, 1.55, 0.08);
        if (beat % 2 === 1) {
          const hv = isFinal ? 0.052 : 0.038;
          this.noise('bgm', 0.035, hv, 7200, 1.0, t + swing, 'highpass', beat % 4 === 1 ? -0.12 : 0.12, 0.02);
        }
        if (isFinal && beat % 2 === 1) this.drum(t + swing + 0.06, 0.068, 2.35, 0);
        if (beat === 0) {
          const battleRoots = [0, 2, 3, 1, 0, 3, 2, 1];
          const r = battleRoots[bar % 8];
          this.bass(this.noteHz(r, -1), 2.2, isFinal ? 0.088 : 0.072, t + swing);
        }
        if (beat % 2 === 0) {
          const motifA = [0, 2, 4, 2, 3, 1, 4, 0];
          const motifB = [3, 1, 4, 0, 2, 3, 1, 2];
          const isCall = bar % 2 === 0;
          const motif = isCall ? motifA : motifB;
          const idx = (beat / 2) % 4;
          const globalIdx = (bar % 2) * 4 + idx;
          const deg = motif[globalIdx % 8];
          const pan = beat % 4 === 0 ? -0.3 : 0.3;
          this.pluck(this.noteHz(deg, 1), 0.076, t + swing, pan, isFinal ? 0.12 : 0.09);
          if (beat === 0 || beat === 4) this.pluck(this.noteHz(deg + 2, 1), 0.034, t + swing + 0.02, pan * 0.4, 0.07);
        }
        if (s % 16 === 0) this.tone('bgm', this.noteHz(0, 0), 2.4, 'sawtooth', 0.028, t, 0.8, 0, 1100, 0.8, 0, 0.08);
        if (isFinal && s % 32 === 24) {
          this.sweep('bgm', 55, 44, 2.2, 0.11, 'sine', t, 0, 0.06);
          this.tone('bgm', 44, 1.4, 'sine', 0.07, t + 0.2, 0.2, 0, 500, 0.8, 0, 0.04);
        }
        if (isFinal && s === 56) {
          const f = this.noteHz(0, 1);
          this.tone('bgm', f, 0.5, 'triangle', 0.14, t, 0.01, 0, 1800, 0.7, 0, 0.14);
          this.tone('bgm', f * 0.5, 0.8, 'sine', 0.18, t, 0.02, 0, 600, 0.8, 0, 0.1);
          this.noise('bgm', 0.16, 0.14, 1200, 0.9, t, 'bandpass', 0, 0.06);
        }
      }
      this.nextNoteTime += tempo;
      this.step = (s + 1) % 64;
    }
  }

  playPluck(freq: number): void {
    if (!this.ctx) return;
    const pan = Math.random() * 0.3 - 0.15;
    this.tone('sfx', freq, 0.52, 'triangle', 0.11, 0, 0.004, 0, 1600, 0.7, pan, 0);
    this.tone('sfx', freq * 2, 0.24, 'sine', 0.048, 0.005, 0.004, 0, 2200, 0.6, pan, 0);
    this.tone('sfx', freq * 3, 0.14, 'sine', 0.024, 0.01, 0.004, 0, 2600, 0.6, pan, 0);
  }

  private pluck(freq: number, gain: number, when: number, pan = 0, rev = 0.12): void {
    this.tone('bgm', freq, 0.92, 'triangle', gain, when, 0.004, 0, 2100, 0.65, pan, rev);
    this.tone('bgm', freq * 2, 0.42, 'sine', gain * 0.38, when + 0.005, 0.004, 0, 2600, 0.6, pan * 0.6, rev * 0.6);
    this.tone('bgm', freq * 3, 0.22, 'sine', gain * 0.16, when + 0.01, 0.004, 0, 3000, 0.5, pan * 0.4, rev * 0.4);
  }

  private bass(freq: number, dur: number, gain: number, when: number): void {
    this.tone('bgm', freq, dur, 'sine', gain, when, 0.06, 0, 580, 0.8, 0, 0.08);
    this.tone('bgm', freq * 2, dur * 0.45, 'triangle', gain * 0.22, when + 0.02, 0.04, 0, 900, 0.7, 0, 0.05);
  }

  private drum(when: number, gain: number, pitchMul = 1, pan = 0): void {
    const ctx = this.ctx!;
    const t = this.now() + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 * pitchMul, t);
    osc.frequency.exponentialRampToValueAtTime(46 * pitchMul, t + 0.16);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      try {
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        osc.connect(g).connect(panner).connect(this.buses.bgm);
        this.noise('bgm', 0.05, gain * 0.26, 1600, 1.2, when, 'highpass', pan, 0.02);
        osc.start(t);
        osc.stop(t + 0.3);
        return;
      } catch {}
    }
    osc.connect(g).connect(this.buses.bgm);
    osc.start(t);
    osc.stop(t + 0.3);
    this.noise('bgm', 0.05, gain * 0.26, 1600, 1.2, when, 'highpass', pan, 0.02);
  }
}

export type SfxName =
  | 'hit'
  | 'crit'
  | 'shoot'
  | 'cast'
  | 'skillBig'
  | 'heal'
  | 'shield'
  | 'death'
  | 'star3'
  | 'levelup'
  | 'coin'
  | 'ui'
  | 'uiBig'
  | 'warn'
  | 'victory'
  | 'defeat';

export const audio = new AudioEngine();
