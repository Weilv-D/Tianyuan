/**
 * 程序化音频引擎。
 *
 * 全部声音由 WebAudio 实时合成，零音频文件、零加载等待。
 * 音乐语言：中国五声音阶（宫商角徵羽 = C D E G A）—— 与美术的东方语汇同源。
 *
 * 三条独立总线（BGM / SFX / UI），音量可分别调节并持久化。
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

  /** 必须在用户手势后调用 */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    // 主总线限幅器：战斗加速时 hit/crit/death 叠发，没有峰值保护会削波爆音
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
    // 页面隐藏时挂起上下文：切后台再回来不做"补发几百个音符"的追帧
    if (!this.visBound) {
      this.visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) {
          void this.ctx.suspend();
        } else {
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

  // ══════════════════ 合成基元 ══════════════════

  private now(): number {
    return this.ctx!.currentTime;
  }

  private noiseBuffer(dur: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    // 按长度缓存：战斗里每 0.1s 一次的 hit/shoot 不该反复分配整段白噪声
    const cached = this.noiseBufCache.get(len);
    if (cached) return cached;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.noiseBufCache.size < 24) this.noiseBufCache.set(len, buf);
    return buf;
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
  ): OscillatorNode {
    const ctx = this.ctx!;
    const t = this.now() + when;
    // WebAudio 对非有限值直接抛 TypeError；BGM 调度循环里抛一次就会
    // 卡住 while 推进并在每个 tick 重抛 —— 宁可静默丢弃这一颗音
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
    osc.connect(g).connect(this.buses[bus]);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return osc;
  }

  private noise(bus: Bus, dur: number, gain: number, filterHz: number, q: number, when = 0, type: BiquadFilterType = 'bandpass'): void {
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
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private sweep(bus: Bus, from: number, to: number, dur: number, gain: number, type: OscillatorType = 'sine', when = 0): void {
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
    osc.connect(g).connect(this.buses[bus]);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noteHz(degree: number, octave = 0): number {
    // 度数必须是整数 —— 调度器里 s/6、s/12 这类表达式会给分数，
    // 分数下标从音阶表里取出 undefined，频率变 NaN
    const d = Math.floor(degree);
    const semi = PENTATONIC[((d % 5) + 5) % 5] + 12 * (octave + Math.floor(d / 5));
    return ROOT_HZ * Math.pow(2, semi / 12);
  }

  // ══════════════════ 音效 ══════════════════

  play(name: SfxName): void {
    if (!this.ready) return;
    switch (name) {
      case 'hit':
        // 短促闷响 + 少量高频"皮肉声"
        this.noise('sfx', 0.09, 0.34, 420, 1.1);
        this.tone('sfx', 150, 0.1, 'sine', 0.22);
        break;
      case 'crit':
        // 更亮、更长、带下坠的尾音
        this.noise('sfx', 0.16, 0.5, 1800, 0.8);
        this.sweep('sfx', 420, 90, 0.24, 0.3, 'sawtooth');
        this.tone('sfx', 70, 0.2, 'sine', 0.4);
        break;
      case 'shoot':
        this.noise('sfx', 0.07, 0.22, 2600, 2.2, 0, 'highpass');
        this.sweep('sfx', 900, 320, 0.1, 0.12, 'triangle');
        break;
      case 'cast':
        // 蓄力：上行扫频 + 泛音
        this.sweep('sfx', 220, 880, 0.34, 0.16, 'sine');
        this.tone('sfx', 660, 0.35, 'triangle', 0.09, 0.02);
        this.tone('sfx', 990, 0.3, 'sine', 0.05, 0.06);
        break;
      case 'skillBig':
        this.sweep('sfx', 120, 1400, 0.5, 0.26, 'sawtooth');
        this.noise('sfx', 0.42, 0.36, 900, 0.6, 0.08);
        this.tone('sfx', 60, 0.55, 'sine', 0.42, 0.1);
        // 五声琶音点缀
        for (let i = 0; i < 4; i++) this.tone('sfx', this.noteHz(i + 4, 1), 0.28, 'triangle', 0.1, 0.12 + i * 0.05);
        break;
      case 'heal':
        for (let i = 0; i < 3; i++) this.tone('sfx', this.noteHz(i + 2, 1), 0.5, 'sine', 0.12, i * 0.06);
        this.noise('sfx', 0.3, 0.08, 3200, 1.4, 0, 'highpass');
        break;
      case 'shield':
        this.tone('sfx', 320, 0.3, 'triangle', 0.16);
        this.tone('sfx', 480, 0.26, 'sine', 0.1, 0.03);
        this.noise('sfx', 0.2, 0.1, 2200, 2, 0, 'highpass');
        break;
      case 'death':
        this.sweep('sfx', 340, 60, 0.55, 0.24, 'sawtooth');
        this.noise('sfx', 0.4, 0.2, 500, 0.7, 0.05);
        this.tone('sfx', 48, 0.5, 'sine', 0.3, 0.1);
        break;
      case 'star3':
        // 三星登场：五声上行 + 鎏金般的高频闪烁
        for (let i = 0; i < 6; i++) {
          this.tone('sfx', this.noteHz(i, 1), 0.5, 'triangle', 0.16, i * 0.075);
          this.tone('sfx', this.noteHz(i, 2), 0.36, 'sine', 0.08, i * 0.075 + 0.02);
        }
        this.noise('sfx', 0.9, 0.12, 4200, 1.2, 0.1, 'highpass');
        this.tone('sfx', 65, 1.0, 'sine', 0.34, 0.1);
        break;
      case 'levelup':
        for (let i = 0; i < 4; i++) this.tone('sfx', this.noteHz(i, 1), 0.34, 'triangle', 0.14, i * 0.06);
        break;
      case 'coin':
        this.tone('ui', 1180, 0.1, 'sine', 0.16);
        this.tone('ui', 1760, 0.14, 'sine', 0.12, 0.035);
        break;
      case 'ui':
        this.tone('ui', 520, 0.05, 'square', 0.05);
        this.noise('ui', 0.04, 0.05, 3000, 1.5, 0, 'highpass');
        break;
      case 'uiBig':
        this.tone('ui', 300, 0.14, 'triangle', 0.12);
        this.tone('ui', 600, 0.16, 'sine', 0.08, 0.04);
        break;
      case 'warn':
        this.tone('ui', 180, 0.3, 'sawtooth', 0.14);
        this.tone('ui', 120, 0.4, 'sine', 0.18, 0.1);
        break;
      case 'victory':
        for (let i = 0; i < 5; i++) this.tone('sfx', this.noteHz(i, 1), 0.7, 'triangle', 0.15, i * 0.11);
        this.tone('sfx', this.noteHz(0, 2), 1.1, 'sine', 0.16, 0.55);
        break;
      case 'defeat':
        for (let i = 4; i >= 0; i--) this.tone('sfx', this.noteHz(i, 0), 0.6, 'sine', 0.14, (4 - i) * 0.13);
        this.tone('sfx', 55, 1.2, 'sine', 0.28, 0.5);
        break;
      default:
        break;
    }
  }

  // ══════════════════ BGM ══════════════════

  startBgm(mood: 'prep' | 'battle' | 'final'): void {
    if (!this.ready) return;
    if (this.mood === mood && this.bgmTimer !== null) return;
    this.mood = mood;
    this.step = 0;
    this.nextNoteTime = this.now() + 0.1;
    if (this.bgmTimer !== null) window.clearInterval(this.bgmTimer);
    this.bgmTimer = window.setInterval(() => this.scheduleBgm(), 60);
  }

  stopBgm(): void {
    if (this.bgmTimer !== null) window.clearInterval(this.bgmTimer);
    this.bgmTimer = null;
    this.mood = 'none';
  }

  /** 后台节流回来时把拍子重新对齐到现在，而不是把落后的时间一次性补完 */
  private resyncBgm(): void {
    if (!this.ctx || this.mood === 'none') return;
    this.nextNoteTime = Math.max(this.nextNoteTime, this.now() + 0.1);
  }

  /** 提前 250ms 排布乐句，避免 setInterval 抖动导致节奏不稳 */
  private scheduleBgm(): void {
    if (!this.ctx || this.mood === 'none') return;
    const tempo = this.mood === 'prep' ? 0.5 : this.mood === 'battle' ? 0.32 : 0.26;
    // 双保险：setInterval 被节流到秒级时，落后量一次补完会变成一声巨响
    this.resyncBgm();
    while (this.nextNoteTime < this.now() + 0.25) {
      const t = this.nextNoteTime - this.now();
      const s = this.step;
      if (this.mood === 'prep') {
        // 准备阶段：稀疏的古琴式拨弦 + 长音铺底
        if (s % 8 === 0) this.tone('bgm', this.noteHz(s / 8, 0), 2.4, 'sine', 0.055, t, 0.4);
        if (s % 6 === 2) this.pluck(this.noteHz(s / 6 + 2, 1), 0.09, t);
        if (s % 12 === 5) this.pluck(this.noteHz(s / 12 + 4, 1), 0.07, t);
        if (s % 16 === 0) this.tone('bgm', ROOT_HZ / 2, 3.2, 'sine', 0.07, t, 0.9);
      } else {
        // 战斗 / 决赛：鼓点 + 循环动机
        if (s % 4 === 0) this.drum(t, 0.24);
        if (s % 8 === 4) this.drum(t, 0.16, 1.6);
        if (this.mood === 'final' && s % 2 === 1) this.drum(t, 0.09, 2.4);
        const motif = [0, 2, 4, 2, 3, 1, 4, 0];
        if (s % 2 === 0) this.pluck(this.noteHz(motif[(s / 2) % 8], 1), 0.075, t);
        if (s % 16 === 0) this.tone('bgm', this.noteHz(0, 0), 2.6, 'sawtooth', 0.035, t, 0.8);
        if (this.mood === 'final' && s % 32 === 24) this.tone('bgm', 55, 1.6, 'sine', 0.16, t, 0.2);
      }
      this.nextNoteTime += tempo;
      this.step = (s + 1) % 64;
    }
  }

  /** 五声拨弦的公开入口（样稿 pluck）：走 sfx 总线的音效拨弦 */
  playPluck(freq: number): void {
    if (!this.ctx) return;
    this.tone('sfx', freq, 0.5, 'triangle', 0.12, 0, 0.004);
    this.tone('sfx', freq * 2, 0.22, 'sine', 0.05, 0.005, 0.004);
    this.tone('sfx', freq * 3, 0.12, 'sine', 0.025, 0.01, 0.004);
  }

  /** 古琴/琵琶式拨弦：基频 + 两个快速衰减的泛音 */
  private pluck(freq: number, gain: number, when: number): void {
    this.tone('bgm', freq, 0.9, 'triangle', gain, when, 0.004);
    this.tone('bgm', freq * 2, 0.4, 'sine', gain * 0.4, when + 0.005, 0.004);
    this.tone('bgm', freq * 3, 0.22, 'sine', gain * 0.18, when + 0.01, 0.004);
  }

  /** 鼓：低频下坠 + 一点噪声 */
  private drum(when: number, gain: number, pitchMul = 1): void {
    const ctx = this.ctx!;
    const t = this.now() + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 * pitchMul, t);
    osc.frequency.exponentialRampToValueAtTime(46 * pitchMul, t + 0.16);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(g).connect(this.buses.bgm);
    osc.start(t);
    osc.stop(t + 0.3);
    this.noise('bgm', 0.05, gain * 0.28, 1600, 1.2, when, 'highpass');
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
