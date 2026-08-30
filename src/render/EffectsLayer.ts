import Phaser from 'phaser';
import type { FxKind } from '../core/events';
import { CINNABAR, GILT, MOON, PAPER, SPIRIT, VOID } from './palette';
import { TEX } from './textures';
import { CELL as BOARD_CELL } from './BoardView';

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
  private shakeAccum = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.layer = scene.add.container(0, 0).setDepth(20);
    this.upper = scene.add.container(0, 0).setDepth(60);
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
    this.scene.time.delayedCall(700, () => em.destroy());
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
  private impact(r: FxRequest): void {
    const crit = (r.params?.crit ?? 0) > 0;
    const hue = r.params?.hue ?? 0;
    const tint = hue === 2 ? VOID.light : hue === 3 ? GILT.light : crit ? CINNABAR.light : PAPER[100];
    const base = crit ? 1.35 : 1;

    // 核心闪点
    const flash = this.img(TEX.glow, r.x, r.y, tint);
    flash.setDisplaySize(20 * base, 20 * base).setAlpha(0.95);
    this.scene.tweens.add({
      targets: flash,
      displayWidth: 74 * base,
      displayHeight: 74 * base,
      alpha: 0,
      duration: crit ? 260 : 180,
      ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });

    // 冲击环
    const ring = this.img(TEX.ring, r.x, r.y, tint);
    ring.setDisplaySize(26 * base, 26 * base).setAlpha(0.9);
    this.scene.tweens.add({
      targets: ring,
      displayWidth: (crit ? 132 : 92) * base,
      displayHeight: (crit ? 132 : 92) * base,
      alpha: 0,
      duration: crit ? 340 : 240,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });

    // 墨点飞溅
    this.burst(r.x, r.y, crit ? 12 : 6, tint, crit ? 260 : 150, crit ? 0.24 : 0.16);
    this.shakeAccum += crit ? 0.5 : 0.12;
  }

  // ── 近战斩击：一条有方向的弧 ──
  private slash(r: FxRequest): void {
    const tx = r.tx ?? r.x;
    const ty = r.ty ?? r.y - 40;
    const ang = Math.atan2(ty - r.y, tx - r.x);
    const tint = r.tint ?? PAPER[100];
    const s = this.img(TEX.slash, (r.x + tx) / 2, (r.y + ty) / 2 - 26, tint);
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
      displayWidth: 190,
      displayHeight: 190,
      duration: 200,
      ease: 'Cubic.easeOut',
    });
  }

  // ── 远程穿刺：细长光束 ──
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
    this.scene.time.delayedCall(900, () => em.destroy());
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
    const g = this.scene.add.graphics();
    g.setDepth(12);
    const draw = (alpha: number) => {
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
    const cam = this.scene.cameras.main;
    if (!cam) return;
    cam.flash(180 * strength, (tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff);
    this.shakeAccum += 1.4 * strength;
  }

  clear(): void {
    this.layer.removeAll(true);
    this.upper.removeAll(true);
  }
}
