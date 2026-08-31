import Phaser from 'phaser';
import type { FxKind } from '../../core/events';
import { CINNABAR, GILT, MOON, PAPER, SPIRIT, VOID } from '../view/palette';
import { TEX } from '../view/textures';
import { CELL as BOARD_CELL } from './BoardView';
import { motion } from '../view/motion';

export interface FxRequest {
  kind: FxKind;
  x: number;
  y: number;
  tx?: number;
  ty?: number;
  radius?: number;
  tint?: number;
  params?: Record<string, number>;
}

/**
 * 特效层。
 *
 * 遵循「读得懂 → 看得爽 → 不糊屏」三原则：
 *  - 每个特效都有明确的**几何语义**（弧=斩击、环=范围、束=穿透、柱=召唤）
 *  - 一律走「蓄力预兆 → 释放主体 → 命中反馈 → 余韵消散」四段式
 *  - 关键帧不遮挡：大招主体一律用 ADD 混合且瞬时，不在棋盘上留下超过 400ms 的实色遮挡
 */
export class EffectsLayer {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Container;
  private readonly upper: Phaser.GameObjects.Container;
  /**
   * 不挂在 layer/upper 里的场景级特效对象（粒子发射器、地面法阵 graphics）。
   * clear() 必须连它们一起销毁，否则残留在下一场战斗里继续播。
   */
  private readonly strays = new Set<Phaser.GameObjects.GameObject>();
  private shakeAccum = 0;
  /** 代际计数：clear() 递增；迟到的延时回调据此自杀（C1） */
  private gen = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.layer = scene.add.container(0, 0).setDepth(20);
    this.upper = scene.add.container(0, 0).setDepth(60);
  }

  /** 登记一个场景级特效对象；对象自毁时自动出列 */
  private trackStray<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.strays.add(obj);
    obj.once('destroy', () => this.strays.delete(obj));
    return obj;
  }

  get shake(): number {
    const v = this.shakeAccum;
    this.shakeAccum = 0;
    return v;
  }

  private img(key: string, x: number, y: number, tint: number, additive = true): Phaser.GameObjects.Image {
    const im = this.scene.add.image(x, y, key).setTint(tint);
    if (additive) im.setBlendMode(Phaser.BlendModes.ADD);
    this.layer.add(im);
    return im;
  }

  private burst(x: number, y: number, count: number, tint: number, speed: number, scale = 0.18): void {
    const em = this.scene.add.particles(x, y, TEX.inkDot, {
      lifespan: 520,
      speed: { min: speed * 0.35, max: speed },
      angle: { min: 0, max: 360 },
      scale: { start: scale, end: 0 },
      alpha: { start: 0.95, end: 0 },
      tint,
      quantity: count,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD,
    });
    em.setDepth(25);
    em.explode(count);
    this.trackStray(em);
    this.scene.time.delayedCall(700, () => {
      if (em.active) em.destroy();
    });
  }

  play(r: FxRequest): void {
    switch (r.kind) {
      case 'impact':
        this.impact(r);
        break;
      case 'slash':
        this.slash(r);
        break;
      case 'pierce':
        this.pierce(r);
        break;
      case 'nova':
        this.nova(r);
        break;
      case 'burst':
        this.burstFx(r);
        break;
      case 'beam':
        this.beam(r);
        break;
      case 'castRing':
        this.castRing(r);
        break;
      case 'healWave':
        this.healWave(r);
        break;
      case 'shieldWall':
        this.shieldWall(r);
        break;
      case 'dashTrail':
        this.dashTrail(r);
        break;
      case 'summon':
        this.summon(r);
        break;
      case 'buffAura':
        this.buffAura(r);
        break;
      case 'debuffMark':
        this.debuffMark(r);
        break;
      case 'groundMark':
        this.groundMark(r);
        break;
      case 'burnTick':
        this.tick(r, CINNABAR.light);
        break;
      case 'bleedTick':
        this.tick(r, CINNABAR.base);
        break;
      default:
        break;
    }
  }

  // ── 命中反馈：一次打击的"句号" ──
  // 语言：白核（瞬）→ 阵营色柔光晕（涨）→ 冲击环（散）→ 墨花（炸）。
  // 每次命中带随机相位角，连续对拼不重样；暴击是同语言的放大 + 第二重追环。
  private impact(r: FxRequest): void {
    const crit = (r.params?.crit ?? 0) > 0;
    const hue = r.params?.hue ?? 0;
    const tint = hue === 2 ? VOID.light : hue === 3 ? GILT.light : crit ? CINNABAR.light : PAPER[100];
    const base = crit ? 1.3 : 1;
    const spin = Math.random() * Math.PI * 2;

    // 白核闪点：小而快，是"接触"的那一瞬
    const flash = this.img(TEX.glow, r.x, r.y, PAPER[50]);
    flash.setDisplaySize(14 * base, 14 * base).setAlpha(0.95);
    this.scene.tweens.add({
      targets: flash,
      displayWidth: 46 * base,
      displayHeight: 46 * base,
      alpha: 0,
      duration: crit ? 200 : 140,
      ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });

    // 阵营色柔光晕：垫在白核后面的体感层，负责"这一下有多大"
    const halo = this.img(TEX.glow, r.x, r.y, tint);
    halo.setDisplaySize(26 * base, 26 * base).setAlpha(0.55);
    this.scene.tweens.add({
      targets: halo,
      displayWidth: 88 * base,
      displayHeight: 88 * base,
      alpha: 0,
      duration: crit ? 300 : 210,
      ease: 'Quad.easeOut',
      onComplete: () => halo.destroy(),
    });

    // 冲击环：带随机旋向的细环，扩散时微微旋转
    const ring = this.img(TEX.ring, r.x, r.y, tint);
    ring.setDisplaySize(24 * base, 24 * base).setAlpha(0.85).setRotation(spin);
    this.scene.tweens.add({
      targets: ring,
      displayWidth: (crit ? 128 : 88) * base,
      displayHeight: (crit ? 128 : 88) * base,
      rotation: spin + (Math.random() < 0.5 ? -0.5 : 0.5),
      alpha: 0,
      duration: crit ? 340 : 240,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });

    // 墨点飞溅
    this.burst(r.x, r.y, crit ? 12 : 6, tint, crit ? 260 : 150, crit ? 0.24 : 0.16);

    // 六向墨花：随机起始角 + 飞行中自旋，给闪点"炸开"的方向感
    const petals = crit ? 8 : 6;
    for (let i = 0; i < petals; i++) {
      const a = spin + (i / petals) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const reach = (crit ? 66 : 46) * base + Math.random() * 14;
      const sp = this.img(TEX.spark, r.x + Math.cos(a) * 9, r.y + Math.sin(a) * 9, i % 2 ? tint : PAPER[100]);
      sp.setRotation(a).setDisplaySize(34 * base, 2.2).setAlpha(0.85);
      this.scene.tweens.add({
        targets: sp,
        x: r.x + Math.cos(a) * reach,
        y: r.y + Math.sin(a) * reach,
        rotation: a + 0.9,
        displayWidth: reach * 0.9,
        alpha: 0,
        duration: crit ? 260 : 190,
        ease: 'Cubic.easeOut',
        onComplete: () => sp.destroy(),
      });
    }

    // 暴击第二重冲击环：迟一拍追上去，双层扩散。
    // delayedCall 是场景级计时器，不随 layer 的子对象销毁而取消 ——
    // clear() 后 80ms 内重开战斗会让这只金环落进下一场（C1），
    // 必须校验代际；场景已关（Clock 之外的窗口期）同样放弃。
    if (crit) {
      const gen = this.gen;
      this.scene.time.delayedCall(80, () => {
        if (gen !== this.gen || !this.scene.scene || !this.scene.scene.isActive()) return;
        const ring2 = this.img(TEX.ring, r.x, r.y, GILT.light);
        ring2.setDisplaySize(40, 40).setAlpha(0.8).setRotation(spin);
        this.scene.tweens.add({
          targets: ring2,
          displayWidth: 164,
          displayHeight: 164,
          rotation: spin + 0.6,
          alpha: 0,
          duration: 320,
          ease: 'Quad.easeOut',
          onComplete: () => ring2.destroy(),
        });
      });
    }
    this.shakeAccum += crit ? 0.5 : 0.12;
  }

  // ── 近战斩击：交叉双弧 + 冲势速度线 ──
  private slash(r: FxRequest): void {
    const tx = r.tx ?? r.x;
    const ty = r.ty ?? r.y - 40;
    const ang = Math.atan2(ty - r.y, tx - r.x);
    const tint = r.tint ?? PAPER[100];
    const mx = (r.x + tx) / 2;
    const my = (r.y + ty) / 2 - 26;

    // 主弧
    const s = this.img(TEX.slash, mx, my, tint);
    s.setRotation(ang).setDisplaySize(150, 150).setAlpha(0);
    this.scene.tweens.add({
      targets: s,
      alpha: 0.95,
      duration: 70,
      yoyo: true,
      hold: 30,
      ease: 'Quad.easeOut',
      onComplete: () => s.destroy(),
    });
    this.scene.tweens.add({
      targets: s,
      displayWidth: 200,
      displayHeight: 200,
      duration: 200,
      ease: 'Cubic.easeOut',
    });

    // 副弧：反向 25° 交叉斩，迟 40ms 错拍
    const s2 = this.img(TEX.slash, mx, my, tint);
    s2.setRotation(ang - 0.45).setDisplaySize(112, 112).setAlpha(0);
    this.scene.time.delayedCall(40, () => {
      if (!s2.active) return;
      this.scene.tweens.add({
        targets: s2,
        alpha: 0.6,
        duration: 60,
        yoyo: true,
        hold: 20,
        ease: 'Quad.easeOut',
        onComplete: () => s2.destroy(),
      });
      this.scene.tweens.add({
        targets: s2,
        displayWidth: 152,
        displayHeight: 152,
        duration: 190,
        ease: 'Cubic.easeOut',
      });
    });

    // 冲势速度线：三道细线沿攻击方向掠过，制造"扑出去"的动量
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 14;
      const bx = r.x - Math.cos(ang) * 26 + Math.cos(ang + Math.PI / 2) * off;
      const by = r.y - 30 - Math.sin(ang) * 26 + Math.sin(ang + Math.PI / 2) * off;
      const line = this.img(TEX.spark, bx, by, PAPER[100]);
      line.setRotation(ang).setDisplaySize(44, 2.5).setAlpha(0.55);
      this.scene.tweens.add({
        targets: line,
        x: bx + Math.cos(ang) * 52,
        y: by + Math.sin(ang) * 52,
        alpha: 0,
        duration: 180,
        delay: i * 25,
        ease: 'Cubic.easeOut',
        onComplete: () => line.destroy(),
      });
    }
  }

  // ── 远程穿刺：光束 + 弹尾拖影 ──
  private pierce(r: FxRequest): void {
    const tx = r.tx ?? r.x;
    const ty = r.ty ?? r.y;
    const ang = Math.atan2(ty - r.y, tx - r.x);
    const dist = Math.hypot(tx - r.x, ty - r.y) || 40;
    const tint = r.tint ?? MOON.light;
    const s = this.img(TEX.spark, r.x, r.y - 30, tint);
    s.setRotation(ang).setDisplaySize(dist, 9).setAlpha(0.9);
    this.scene.tweens.add({
      targets: s,
      alpha: 0,
      displayHeight: 2,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => s.destroy(),
    });
    // 弹尾拖影：迟 60ms 的一道更细更淡的余线，拉出"射出去"的纵深
    const t2 = this.img(TEX.spark, r.x - Math.cos(ang) * 10, r.y - 30 - Math.sin(ang) * 10, tint);
    t2.setRotation(ang).setDisplaySize(dist * 0.66, 4.5).setAlpha(0.5);
    this.scene.tweens.add({
      targets: t2,
      alpha: 0,
      displayHeight: 1,
      duration: 230,
      delay: 60,
      ease: 'Quad.easeOut',
      onComplete: () => t2.destroy(),
    });
  }

  // ── 环爆：以自身为中心的冲击波 ──
  private nova(r: FxRequest): void {
    const rad = (r.radius ?? 1) * BOARD_CELL;
    const tint = r.params?.hue === 2 ? VOID.light : r.tint ?? CINNABAR.light;
    for (let i = 0; i < 2; i++) {
      const ring = this.img(TEX.ring, r.x, r.y, tint);
      ring.setDisplaySize(40, 40).setAlpha(0.95);
      this.scene.tweens.add({
        targets: ring,
        displayWidth: rad * (2.1 + i * 0.5),
        displayHeight: rad * (2.1 + i * 0.5),
        alpha: 0,
        duration: 420 + i * 160,
        delay: i * 90,
        ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy(),
      });
    }
    const core = this.img(TEX.glow, r.x, r.y, tint);
    core.setDisplaySize(rad * 0.6, rad * 0.6).setAlpha(0.6);
    this.scene.tweens.add({
      targets: core,
      displayWidth: rad * 2.2,
      displayHeight: rad * 2.2,
      alpha: 0,
      duration: 380,
      ease: 'Quad.easeOut',
      onComplete: () => core.destroy(),
    });
    this.burst(r.x, r.y, 16, tint, 380, 0.3);
    this.shakeAccum += r.radius && r.radius >= 2 ? 1.1 : 0.6;
  }

  // ── 范围爆发：落点先亮，再炸开 ──
  private burstFx(r: FxRequest): void {
    const rad = (r.radius ?? 1) * BOARD_CELL * 0.55;
    const tint = r.params?.hue === 2 ? VOID.light : r.tint ?? GILT.light;
    const ring = this.img(TEX.ring, r.x, r.y, tint);
    ring.setDisplaySize(rad * 0.4, rad * 0.4).setAlpha(0.9);
    this.scene.tweens.add({
      targets: ring,
      displayWidth: rad * 2.4,
      displayHeight: rad * 2.4,
      alpha: 0,
      duration: 400,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
    const core = this.img(TEX.glow, r.x, r.y, tint);
    core.setDisplaySize(rad * 0.3, rad * 0.3).setAlpha(0.85);
    this.scene.tweens.add({
      targets: core,
      displayWidth: rad * 1.8,
      displayHeight: rad * 1.8,
      alpha: 0,
      duration: 330,
      ease: 'Quad.easeOut',
      onComplete: () => core.destroy(),
    });
    this.burst(r.x, r.y, 14, tint, 320, 0.26);
    this.shakeAccum += 0.7;
  }

  // ── 光束：贯穿，尾部收束 ──
  private beam(r: FxRequest): void {
    const tx = r.tx ?? r.x;
    const ty = r.ty ?? r.y;
    const ang = Math.atan2(ty - r.y, tx - r.x);
    const dist = Math.hypot(tx - r.x, ty - r.y) || 200;
    const tint = r.params?.hue === 5 ? SPIRIT.light : r.tint ?? VOID.light;
    const mx = (r.x + tx) / 2;
    const my = ((r.y - 30) + ty) / 2;
    for (let i = 0; i < 2; i++) {
      const s = this.img(TEX.spark, mx, my, i === 0 ? tint : PAPER[50]);
      s.setRotation(ang)
        .setDisplaySize(dist * 1.1, i === 0 ? 34 : 12)
        .setAlpha(i === 0 ? 0.55 : 0.9);
      this.scene.tweens.add({
        targets: s,
        alpha: 0,
        displayHeight: i === 0 ? 8 : 2,
        duration: i === 0 ? 460 : 300,
        ease: 'Cubic.easeOut',
        onComplete: () => s.destroy(),
      });
    }
    this.burst(r.x, r.y - 30, 8, tint, 260, 0.2);
    this.shakeAccum += 0.8;
  }

  // ── 蓄力法阵：预兆，让玩家有 0.3 秒的心理准备 ──
  private castRing(r: FxRequest): void {
    const tint = r.tint ?? GILT.light;
    const ring = this.img(TEX.ring, r.x, r.y, tint);
    ring.setDisplaySize(150, 150).setAlpha(0.35);
    this.scene.tweens.add({
      targets: ring,
      displayWidth: 56,
      displayHeight: 56,
      alpha: 0.95,
      duration: 420,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.scene.tweens.add({
          targets: ring,
          alpha: 0,
          displayWidth: 190,
          displayHeight: 190,
          duration: 240,
          onComplete: () => ring.destroy(),
        });
      },
    });
  }

  // ── 治疗波纹：向上生长，语义与伤害完全相反 ──
  private healWave(r: FxRequest): void {
    const tint = SPIRIT.light;
    const ring = this.img(TEX.ring, r.x, r.y, tint);
    ring.setDisplaySize(30, 30).setAlpha(0.8);
    this.scene.tweens.add({
      targets: ring,
      displayWidth: 120,
      displayHeight: 120,
      y: r.y - 18,
      alpha: 0,
      duration: 620,
      ease: 'Sine.easeOut',
      onComplete: () => ring.destroy(),
    });
    const em = this.scene.add.particles(r.x, r.y, TEX.glow, {
      lifespan: 780,
      speedY: { min: -70, max: -34 },
      speedX: { min: -18, max: 18 },
      scale: { start: 0.12, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [SPIRIT.light, PAPER[50]],
      quantity: 8,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD,
    });
    em.setDepth(25);
    em.explode(8);
    this.trackStray(em);
    this.scene.time.delayedCall(900, () => {
      if (em.active) em.destroy();
    });
  }

  private shieldWall(r: FxRequest): void {
    const hex = this.img(TEX.hex, r.x, r.y - 26, MOON.light);
    hex.setDisplaySize(76, 88).setAlpha(0);
    this.scene.tweens.add({
      targets: hex,
      alpha: 0.7,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: hex,
          alpha: 0,
          duration: 900,
          delay: 600,
          onComplete: () => hex.destroy(),
        });
      },
    });
  }

  private dashTrail(r: FxRequest): void {
    const tx = r.tx ?? r.x;
    const ty = r.ty ?? r.y;
    const ang = Math.atan2(ty - r.y, tx - r.x);
    const dist = Math.hypot(tx - r.x, ty - r.y) || 40;
    const tint = r.tint ?? PAPER[200];
    const s = this.img(TEX.spark, (r.x + tx) / 2, (r.y + ty) / 2 - 26, tint);
    s.setRotation(ang).setDisplaySize(dist * 1.2, 40).setAlpha(0.55);
    this.scene.tweens.add({
      targets: s,
      alpha: 0,
      displayHeight: 6,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => s.destroy(),
    });
    this.burst(tx, ty - 20, 8, tint, 200, 0.18);
  }

  private summon(r: FxRequest): void {
    const tint = GILT.light;
    const pillar = this.img(TEX.glow, r.x, r.y - 40, tint);
    pillar.setDisplaySize(30, 130).setAlpha(0.9);
    this.scene.tweens.add({
      targets: pillar,
      displayWidth: 72,
      alpha: 0,
      duration: 620,
      ease: 'Cubic.easeOut',
      onComplete: () => pillar.destroy(),
    });
    const ring = this.img(TEX.ring, r.x, r.y, tint);
    ring.setDisplaySize(20, 20).setAlpha(0.95);
    this.scene.tweens.add({
      targets: ring,
      displayWidth: 150,
      displayHeight: 150,
      alpha: 0,
      duration: 540,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
    this.shakeAccum += 0.5;
  }

  private buffAura(r: FxRequest): void {
    const tint = r.params?.hue === 2 ? VOID.light : r.params?.hue === 1 ? GILT.light : SPIRIT.light;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const p = this.img(TEX.glow, r.x + Math.cos(a) * 6, r.y - 30 + Math.sin(a) * 6, tint);
      p.setDisplaySize(10, 10).setAlpha(0.9);
      this.scene.tweens.add({
        targets: p,
        x: r.x + Math.cos(a) * 42,
        y: r.y - 30 + Math.sin(a) * 42,
        alpha: 0,
        duration: 520,
        ease: 'Cubic.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  private debuffMark(r: FxRequest): void {
    const tint = VOID.base;
    const ring = this.img(TEX.ring, r.x, r.y - 34, tint);
    ring.setDisplaySize(90, 90).setAlpha(0.85);
    this.scene.tweens.add({
      targets: ring,
      displayWidth: 26,
      displayHeight: 26,
      alpha: 0,
      duration: 520,
      ease: 'Quad.easeIn',
      onComplete: () => ring.destroy(),
    });
  }

  /** 地面法阵：持续型区域，缓慢呼吸后消散 */
  private groundMark(r: FxRequest): void {
    const rad = (r.radius ?? 1) * BOARD_CELL * 0.62;
    const telegraph = (r.params?.telegraph ?? 0) > 0;
    const dur = (r.params?.dur ?? (telegraph ? 1.2 : 2.6)) * 1000;
    const tint = telegraph ? CINNABAR.light : r.tint ?? VOID.base;
    const g = this.trackStray(this.scene.add.graphics());
    g.setDepth(12);
    const draw = (alpha: number) => {
      if (!g.active) return;
      g.clear();
      g.lineStyle(1.3, tint, 0.85 * alpha);
      g.strokeEllipse(r.x, r.y, rad * 2, rad * 1.15);
      g.lineStyle(1, tint, 0.4 * alpha);
      g.strokeEllipse(r.x, r.y, rad * 1.6, rad * 0.92);
      g.fillStyle(tint, 0.09 * alpha);
      g.fillEllipse(r.x, r.y, rad * 2, rad * 1.15);
      if (telegraph) {
        g.lineStyle(1.3, CINNABAR.light, alpha);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          g.lineBetween(r.x + Math.cos(a) * rad * 0.5, r.y + Math.sin(a) * rad * 0.28, r.x + Math.cos(a) * rad, r.y + Math.sin(a) * rad * 0.57);
        }
      }
    };
    draw(0);
    this.scene.tweens.addCounter({
      from: 0,
      to: 100,
      duration: telegraph ? Math.min(300, dur) : 260,
      onUpdate: (tw) => draw((tw.getValue() ?? 0) / 100),
      onComplete: () => {
        this.scene.tweens.addCounter({
          from: 100,
          to: 0,
          duration: telegraph ? 200 : dur,
          delay: telegraph ? dur - 300 : 200,
          onUpdate: (tw) => draw((tw.getValue() ?? 0) / 100),
          onComplete: () => g.destroy(),
        });
      },
    });
  }

  private tick(r: FxRequest, tint: number): void {
    const p = this.img(TEX.glow, r.x + (Math.random() - 0.5) * 22, r.y - 20 - Math.random() * 34, tint);
    p.setDisplaySize(18, 18).setAlpha(0.9);
    this.scene.tweens.add({
      targets: p,
      y: p.y - 26,
      alpha: 0,
      displayWidth: 4,
      displayHeight: 4,
      duration: 620,
      ease: 'Quad.easeOut',
      onComplete: () => p.destroy(),
    });
  }

  /** 屏幕级的全屏演出（五费大招 / 三星星辰绽放） */
  fullscreenFlash(tint: number, strength = 1): void {
    if (motion.calm) return;
    const cam = this.scene.cameras.main;
    if (!cam) return;
    cam.flash(180 * strength, (tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff);
    this.shakeAccum += 1.4 * strength;
  }

  clear(): void {
    // 代际 +1：让还在飞行的延时回调（crit 第二环等）知道自己是上一场的
    this.gen++;
    // 先杀补间再移除（对齐 DamageTextLayer 范式）：补间的 onComplete 会
    // destroy 目标，若目标已被 removeAll(true) 销毁，就是对尸体发后事
    const children = [...this.layer.getAll(), ...this.upper.getAll()];
    if (children.length > 0) this.scene.tweens.killTweensOf(children);
    this.layer.removeAll(true);
    this.upper.removeAll(true);
    for (const s of [...this.strays]) s.destroy();
    this.strays.clear();
    this.shakeAccum = 0;
  }
}
