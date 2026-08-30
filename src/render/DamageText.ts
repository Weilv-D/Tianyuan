import Phaser from 'phaser';
import { DAMAGE_OUTLINE, GILT, MOON, PAPER, SHADE, CINNABAR, SPIRIT, VOID, css } from './palette';
import { FONT } from '../ui/kit';

export type DamageTier = 'normal' | 'crit' | 'skill' | 'true' | 'heal' | 'shield' | 'execute' | 'dot';

/**
 * 伤害飘字。
 *
 * 分级是"信息层级"的一部分 —— 玩家余光扫过就能判断局势烈度，不必逐个读数：
 *   普攻   20px 宣纸白   轻微上浮
 *   暴击   32px 朱砂亮   冲击缩放 + 轻微倾斜 + 描边
 *   技能   26px 夜蓝     带光晕
 *   真伤   26px 鎏金     穿透语义（无视护甲）
 *   治疗   22px 灵青     向下→向上，与伤害方向相反
 *   斩杀   38px 鎏金光   屏幕级演出
 */
export class DamageTextLayer {
  private readonly scene: Phaser.Scene;
  private readonly pool: Phaser.GameObjects.Text[] = [];
  private readonly active: Phaser.GameObjects.Text[] = [];
  /** 同帧同目标的飘字错峰，避免叠成一坨 */
  private lastAt = new Map<number, number>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  private take(): Phaser.GameObjects.Text {
    const t = this.pool.pop();
    if (t) return t.setVisible(true);
    return this.scene.add
      .text(0, 0, '', {
        fontFamily: FONT.num,
        fontSize: '20px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 1)
      .setDepth(70);
  }

  private give(t: Phaser.GameObjects.Text): void {
    t.setVisible(false);
    this.active.splice(this.active.indexOf(t), 1);
    this.pool.push(t);
  }

  spawn(x: number, y: number, amount: number, tier: DamageTier, prefix = ''): void {
    const cfg = STYLE[tier];
    const t = this.take();

    // 错峰：同一目标 120ms 内的飘字横向错开
    const now = this.scene.time.now;
    const key = Math.round(x) * 1000 + Math.round(y);
    const last = this.lastAt.get(key) ?? 0;
    const stacked = now - last < 110;
    this.lastAt.set(key, now);
    const jitter = stacked ? (Math.random() - 0.5) * 46 : (Math.random() - 0.5) * 12;

    t.setText(`${prefix}${Math.round(amount)}`);
    t.setStyle({ fontSize: `${cfg.size}px`, fontStyle: cfg.bold ? 'bold' : 'normal' });
    t.setColor(cfg.color);
    t.setStroke(cfg.stroke, cfg.strokeWidth);
    t.setShadow(cfg.glow ? 0 : 2, cfg.glow ? 0 : 2, css(SHADE), cfg.glow ? 0 : 6, true, true);
    t.setPosition(x + jitter, y - 46);
    t.setAlpha(1);
    t.setScale(cfg.pop);
    t.setRotation(stacked ? (Math.random() - 0.5) * 0.14 : 0);
    t.setDepth(cfg.depth);
    if (cfg.glow) t.setBlendMode(Phaser.BlendModes.ADD);
    else t.setBlendMode(Phaser.BlendModes.NORMAL);
    this.active.push(t);

    // 冲击 → 上浮 → 消散。暴击额外给一次"顿帧"式的停留
    this.scene.tweens.add({
      targets: t,
      scale: 1,
      duration: 90,
      ease: 'Back.easeOut',
    });
    this.scene.tweens.add({
      targets: t,
      y: y - 46 - cfg.rise,
      duration: cfg.life,
      ease: 'Cubic.easeOut',
    });
    this.scene.tweens.add({
      targets: t,
      alpha: 0,
      duration: cfg.life * 0.45,
      delay: cfg.life * (cfg.hold ? 0.62 : 0.45),
      ease: 'Quad.easeIn',
      onComplete: () => this.give(t),
    });
    if (cfg.shake) {
      this.scene.tweens.add({
        targets: t,
        x: t.x + (Math.random() - 0.5) * 10,
        duration: 60,
        yoyo: true,
        repeat: 1,
      });
    }
  }

  clear(): void {
    for (const t of [...this.active]) this.give(t);
    this.lastAt.clear();
  }
}

interface TierStyle {
  size: number;
  color: string;
  stroke: string;
  strokeWidth: number;
  bold: boolean;
  rise: number;
  life: number;
  pop: number;
  hold: boolean;
  glow: boolean;
  shake: boolean;
  depth: number;
}

const STYLE: Record<DamageTier, TierStyle> = {
  normal: {
    size: 20, color: css(PAPER[100]), stroke: css(DAMAGE_OUTLINE.normal), strokeWidth: 3, bold: true,
    rise: 34, life: 720, pop: 1.15, hold: false, glow: false, shake: false, depth: 70,
  },
  crit: {
    size: 32, color: css(CINNABAR.light), stroke: css(DAMAGE_OUTLINE.crit), strokeWidth: 5, bold: true,
    rise: 46, life: 900, pop: 1.7, hold: true, glow: true, shake: true, depth: 74,
  },
  skill: {
    size: 26, color: css(VOID.light), stroke: css(DAMAGE_OUTLINE.skill), strokeWidth: 4, bold: true,
    rise: 40, life: 820, pop: 1.35, hold: false, glow: false, shake: false, depth: 72,
  },
  true: {
    size: 26, color: css(GILT.light), stroke: css(DAMAGE_OUTLINE.true), strokeWidth: 4, bold: true,
    rise: 42, life: 860, pop: 1.4, hold: false, glow: false, shake: false, depth: 73,
  },
  heal: {
    size: 22, color: css(SPIRIT.light), stroke: css(DAMAGE_OUTLINE.heal), strokeWidth: 4, bold: true,
    rise: 40, life: 800, pop: 1.15, hold: false, glow: false, shake: false, depth: 71,
  },
  shield: {
    size: 20, color: css(MOON.light), stroke: css(DAMAGE_OUTLINE.shield), strokeWidth: 3, bold: true,
    rise: 34, life: 720, pop: 1.1, hold: false, glow: false, shake: false, depth: 70,
  },
  execute: {
    size: 36, color: css(GILT.glow), stroke: css(DAMAGE_OUTLINE.execute), strokeWidth: 6, bold: true,
    rise: 54, life: 1100, pop: 2.0, hold: true, glow: true, shake: true, depth: 76,
  },
  dot: {
    size: 16, color: css(CINNABAR.glow), stroke: css(DAMAGE_OUTLINE.dot), strokeWidth: 3, bold: false,
    rise: 26, life: 620, pop: 1.05, hold: false, glow: false, shake: false, depth: 68,
  },
};
