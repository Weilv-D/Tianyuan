import Phaser from 'phaser';
import { CHAMPION_BY_ID } from '../data/champions';
import { silhouetteKey, SIL_ORIGIN_Y, silContentScale, BEAST_TEAM } from './silhouetteFactory';
import { itemIconKey } from './itemIcons';
import { ITEM_BY_ID } from '../data/items';
import { CINNABAR, GILT, INK, PAPER, RARITY_COLOR, SHADE, SPIRIT, TEAM_COLOR, TEAM_COLOR_DEEP, VOID } from './palette';
import { TEX } from './textures';

const STAR_SCALE = [0, 0.94, 1.0, 1.14];
const BAR_W = 40;

/**
 * 当前"我方"是哪一队。
 *
 * 这是个渲染层的全局，因为"我方的血条是青色、敌方是朱砂"这条规则
 * 与队号 0/1 无关，只与"观众是谁"有关。玩家永远打下半场（队号随配对而变），
 * 写死成 `team === 0 ? 青 : 朱` 会在玩家被分到 team 1 时把自家血条染成敌方色。
 */
let friendlyTeam: 0 | 1 = 0;

export function setFriendlyTeam(t: 0 | 1): void {
  friendlyTeam = t;
}

/**
 * 棋子的可视对象。
 *
 * 层级自下而上：地面投影 → 稀有度底座 → 剪影本体 → 三星光环 → 血蓝条 → 星级标记。
 * 所有"状态变化"都有过渡，没有生硬跳变。
 */
export class UnitView extends Phaser.GameObjects.Container {
  readonly defId: string;
  readonly team: number;
  readonly isBeast: boolean;
  star: number;
  cost: number;

  /** 我方（含"不是墨兽"这个条件 —— 墨兽永远不是我方） */
  private get friendly(): boolean {
    return this.team === friendlyTeam && !this.isBeast;
  }

  /**
   * 视角解析后的阵营侧：0 = 友（灵青）/ 1 = 敌（朱砂）。
   * 剪影与描边一律用它取色 —— 直接用原始队号会把 team 1 的玩家
   * 染成朱砂、敌人染成灵青，"边缘光负责是谁的人"就失效了。
   */
  private get side(): 0 | 1 {
    return this.friendly ? 0 : 1;
  }

  private readonly shadow: Phaser.GameObjects.Image;
  private readonly base: Phaser.GameObjects.Image;
  /** 剪影本体。注意不能命名为 body —— Container 上已有同名的物理体字段。 */
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly aura: Phaser.GameObjects.Image;
  private readonly crown: Phaser.GameObjects.Graphics;
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly itemRow: Phaser.GameObjects.Container;
  private readonly pips: Phaser.GameObjects.Graphics;
  private readonly castRing: Phaser.GameObjects.Graphics;

  // 位置插值
  private px: number;
  private py: number;
  private tx: number;
  private ty: number;
  private moveT = 0;
  private moveDur = 0;
  private bobbing = 0;

  // 状态
  private hp = 1;
  private maxHp = 1;
  private shield = 0;
  private mp = 0;
  private maxMp = 1;
  private dead = false;
  private selected = false;
  private flashT = 0;
  private castT = 0;
  private castTotal = 0;

  constructor(scene: Phaser.Scene, defId: string, team: number, star: number, x: number, y: number, isBeast = false) {
    super(scene, x, y);
    const entry = CHAMPION_BY_ID[defId];
    this.defId = defId;
    this.team = team;
    this.isBeast = isBeast;
    this.star = star;
    this.cost = entry?.cost ?? 1;
    this.px = x;
    this.py = y;
    this.tx = x;
    this.ty = y;

    const rarity = RARITY_COLOR[this.cost];

    // 投影：用灵光纹理压扁并染黑，比画椭圆更有"落在地上"的体积感
    this.shadow = scene.add.image(0, 0, TEX.glow).setTint(SHADE).setAlpha(0.5);
    this.shadow.setDisplaySize(46, 18);

    // 底座：六边形身份牌，稀有度色 + 阵营色描边
    this.base = scene.add.image(0, 0, TEX.hex).setTint(rarity).setAlpha(0.92);
    this.base.setDisplaySize(52, 52);
    this.base.setScale(this.base.scaleX, this.base.scaleY * 0.5);

    // 光环：4/5 费的"牌面"
    this.aura = scene.add.image(0, -26, TEX.ring).setTint(rarity).setAlpha(0);
    this.aura.setDisplaySize(118, 118);
    this.aura.setBlendMode(Phaser.BlendModes.ADD);

    this.sprite = scene.add
      .image(0, 0, silhouetteKey(defId, isBeast ? BEAST_TEAM : this.side, star))
      .setOrigin(0.5, SIL_ORIGIN_Y);
    // 内容归一：不同原型的墨迹占框差异大，按可见内容高统一体量，
    // 星级体量差仍由容器级 STAR_SCALE 表达
    this.sprite.setScale(silContentScale(defId, star, 54, 49));
    this.castRing = scene.add.graphics();
    this.crown = scene.add.graphics();
    this.bars = scene.add.graphics();
    this.pips = scene.add.graphics();
    // 装备图标挂在血条下方，最多三件
    this.itemRow = scene.add.container(0, 14);

    this.add([this.shadow, this.aura, this.base, this.sprite, this.castRing, this.crown, this.bars, this.pips, this.itemRow]);
    this.applyStarScale();
    this.drawPips();
    this.drawCrown(0);
    if (this.cost >= 4) {
      scene.tweens.add({
        targets: this.aura,
        alpha: this.cost >= 5 ? 0.5 : 0.3,
        duration: 700,
        ease: 'Sine.easeOut',
      });
    }
    scene.add.existing(this);
  }

  /**
   * 显示这个棋子身上的装备。
   *
   * 装备是"这局我打得怎么样"最直观的证据，也是对手威胁评估的第一手信息 ——
   * 看见对面 carry 身上三件鎏金成品，玩家立刻知道该集火谁。
   */
  setItems(itemIds: readonly string[]): void {
    this.itemRow.removeAll(true);
    const n = Math.min(3, itemIds.length);
    if (n === 0) return;
    const size = 13;
    const gap = 3;
    const totalW = n * size + (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      const id = itemIds[i];
      const key = itemIconKey(id);
      if (!this.scene.textures.exists(key)) continue;
      const img = this.scene.add.image(-totalW / 2 + i * (size + gap) + size / 2, 0, key);
      img.setDisplaySize(size, size);
      this.itemRow.add(img);
      // 成品加一圈鎏金底光，让"神装"在余光里也藏不住
      if (ITEM_BY_ID[id]?.tier === 'combined') {
        const g = this.scene.add.graphics();
        g.fillStyle(GILT.base, 0.22);
        g.fillRoundedRect(-totalW / 2 + i * (size + gap), -size / 2, size, size, 3);
        this.itemRow.addAt(g, 0);
      }
    }
  }

  private applyStarScale(): void {
    const s = STAR_SCALE[this.star] ?? 1;
    this.setScale(s);
  }

  // ── 位置 ──

  get logicX(): number {
    return this.tx;
  }
  get logicY(): number {
    return this.ty;
  }

  place(x: number, y: number): void {
    this.px = this.tx = x;
    this.py = this.ty = y;
    this.moveDur = 0;
    this.x = x;
    this.y = y;
  }

  /** 一次移动（走一格）。带轻微上下起伏，形成"步伐感"。 */
  hopTo(x: number, y: number, dur: number): void {
    this.px = this.x;
    this.py = this.y;
    this.tx = x;
    this.ty = y;
    this.moveT = 0;
    this.moveDur = Math.max(0.016, dur);
  }

  blinkTo(x: number, y: number, dur: number): void {
    this.px = this.x;
    this.py = this.y;
    this.tx = x;
    this.ty = y;
    this.moveT = 0;
    this.moveDur = Math.max(0.016, dur);
    // 突进：拉出一道残影
    const ghost = this.scene.add
      .image(this.x, this.y, silhouetteKey(this.defId, this.isBeast ? BEAST_TEAM : this.side, this.star))
      .setOrigin(0.5, SIL_ORIGIN_Y)
      .setScale(this.sprite.scaleX)
      .setTint(TEAM_COLOR[this.side] ?? SPIRIT.base)
      .setAlpha(0.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: ghost,
      alpha: 0,
      scaleX: this.scaleX * 1.25,
      scaleY: this.scaleY * 1.25,
      duration: 260,
      onComplete: () => ghost.destroy(),
    });
  }

  // ── 数值 ──

  syncBars(hp: number, maxHp: number, shield: number, mp: number, maxMp: number): void {
    this.hp = hp;
    this.maxHp = maxHp;
    this.shield = shield;
    this.mp = mp;
    this.maxMp = maxMp;
    this.drawBars();
    this.drawPips();
  }

  private drawBars(): void {
    const g = this.bars;
    g.clear();
    if (this.dead) return;
    const y = -78;
    const h = 4.5;
    const hpRatio = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    const shieldRatio = Phaser.Math.Clamp(this.shield / this.maxHp, 0, 1);

    // 底槽
    g.fillStyle(INK[900], 0.85);
    g.fillRoundedRect(-BAR_W / 2 - 1, y - 1, BAR_W + 2, h + 2, 2);
    g.fillStyle(INK[600], 1);
    g.fillRect(-BAR_W / 2, y, BAR_W, h);

    // 生命：友方灵青 → 敌方朱砂；残血转朱砂闪烁语义
    const low = hpRatio < 0.3;
    const hpColor = this.friendly ? (low ? CINNABAR.base : SPIRIT.base) : low ? CINNABAR.light : CINNABAR.base;
    g.fillStyle(hpColor, 1);
    g.fillRect(-BAR_W / 2, y, BAR_W * hpRatio, h);
    g.fillStyle(PAPER[50], 0.22);
    g.fillRect(-BAR_W / 2, y, BAR_W * hpRatio, 2);

    // 护盾：月白色覆盖在生命之上
    if (shieldRatio > 0) {
      g.fillStyle(PAPER[200], 0.92);
      g.fillRect(-BAR_W / 2, y, BAR_W * Math.min(1, shieldRatio), h);
      g.lineStyle(1, PAPER[50], 0.8);
      g.strokeRect(-BAR_W / 2, y, BAR_W * Math.min(1, shieldRatio), h);
    }

    // 外框
    g.lineStyle(1, INK[400], 0.9);
    g.strokeRect(-BAR_W / 2, y, BAR_W, h);

    // 法力：细条，满了会发光
    if (this.maxMp > 0 && this.maxMp < 1e6) {
      const my = y + h + 2;
      const mh = 3.5;
      const mpRatio = Phaser.Math.Clamp(this.mp / this.maxMp, 0, 1);
      g.fillStyle(INK[900], 0.85);
      g.fillRect(-BAR_W / 2 - 1, my - 1, BAR_W + 2, mh + 2);
      g.fillStyle(INK[700], 1);
      g.fillRect(-BAR_W / 2, my, BAR_W, mh);
      g.fillStyle(VOID.base, 1);
      g.fillRect(-BAR_W / 2, my, BAR_W * mpRatio, mh);
      if (mpRatio >= 1) {
        g.fillStyle(VOID.light, 0.9);
        g.fillRect(-BAR_W / 2, my, BAR_W, mh);
      }
    }
  }

  private drawPips(): void {
    const g = this.pips;
    g.clear();
    const y = -88;
    const size = 3.6;
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 10;
      const on = i < this.star;
      g.fillStyle(on ? GILT.light : INK[600], on ? 1 : 0.8);
      g.beginPath();
      g.moveTo(x, y - size);
      g.lineTo(x + size, y);
      g.lineTo(x, y + size);
      g.lineTo(x - size, y);
      g.closePath();
      g.fillPath();
      if (on) {
        g.lineStyle(0.8, GILT.deep, 0.9);
        g.strokePath();
      }
    }
  }

  /** 三星星冠：界格断环 + 四枚旋转方胜印 —— 直角体系里"圆"的表达方式 */
  private drawCrown(t: number): void {
    const g = this.crown;
    g.clear();
    if (this.star < 3 || this.dead) return;
    const cy = -30;
    // 断环：四段弧，段间留白，像界格钉出的圆
    const r = 26;
    g.lineStyle(1.8, GILT.base, 0.62);
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + 0.3;
      g.beginPath();
      g.arc(0, cy, r, a0, a0 + Math.PI / 2 - 0.6);
      g.strokePath();
    }
    // 四枚方胜印沿环缓转
    for (let i = 0; i < 4; i++) {
      const a = t * 0.85 + (i / 4) * Math.PI * 2;
      const x = Math.cos(a) * (r + 7);
      const y = cy + Math.sin(a) * (r + 6);
      const sz = 2.8;
      g.fillStyle(GILT.light, 0.95);
      g.beginPath();
      g.moveTo(x, y - sz);
      g.lineTo(x + sz, y);
      g.lineTo(x, y + sz);
      g.lineTo(x - sz, y);
      g.closePath();
      g.fillPath();
    }
    // 顶心主印：一枚实心方胜
    g.fillStyle(GILT.glow, 0.92);
    g.beginPath();
    g.moveTo(0, cy - 5);
    g.lineTo(5, cy);
    g.lineTo(0, cy + 5);
    g.lineTo(-5, cy);
    g.closePath();
    g.fillPath();
    g.lineStyle(0.8, GILT.deep, 0.9);
    g.strokePath();
  }

  // ── 演出 ──

  /** 攻击：前摇蓄势 → 命中前冲 → 回弹。打击感的节奏骨架。 */
  playAttack(dirX: number, dirY: number, windup: number): void {
    if (this.dead) return;
    const len = Math.hypot(dirX, dirY) || 1;
    const dx = (dirX / len) * 7.5;
    const dy = (dirY / len) * 7.5;
    this.scene.tweens.killTweensOf(this.sprite);
    this.scene.tweens.add({
      targets: this.sprite,
      x: -dx * 0.4,
      y: -dy * 0.4,
      duration: windup * 1000 * 0.7,
      ease: 'Quad.easeIn',
      yoyo: false,
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.sprite,
          x: dx * 1.6,
          y: dy * 1.6,
          duration: 90,
          ease: 'Quad.easeOut',
          onComplete: () => {
            this.scene.tweens.add({
              targets: this.sprite,
              x: 0,
              y: 0,
              duration: 170,
              ease: 'Back.easeOut',
            });
          },
        });
      },
    });
  }

  /** 受击：白闪 + 短促位移抖动 */
  playHit(fromX: number, fromY: number): void {
    if (this.dead) return;
    this.flashT = 0.14;
    this.sprite.setTintFill(0xffffff);
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    const kx = (dx / len) * 3.5;
    const ky = (dy / len) * 3.5;
    this.scene.tweens.killTweensOf(this.base);
    this.scene.tweens.add({
      targets: [this.base, this.sprite],
      x: kx,
      y: ky,
      duration: 55,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.base.setPosition(0, 0);
        this.sprite.setPosition(0, 0);
      },
    });
  }

  /** 吟唱：浮空 + 脚下法阵旋开 */
  playCast(windup: number): void {
    if (this.dead) return;
    this.castT = windup;
    this.castTotal = windup;
    const col = this.friendly ? SPIRIT.light : CINNABAR.light;
    this.scene.tweens.add({
      targets: this.sprite,
      y: -8,
      scaleX: this.sprite.scaleX * 1.06,
      scaleY: this.sprite.scaleY * 1.06,
      duration: windup * 1000,
      ease: 'Sine.easeInOut',
    });
    this.scene.tweens.add({
      targets: this.aura,
      alpha: 0.75,
      duration: windup * 1000 * 0.8,
      ease: 'Sine.easeIn',
    });
    void col;
  }

  /** 吟唱结束，恢复常态 */
  endCast(): void {
    this.castT = 0;
    this.scene.tweens.add({
      targets: this.sprite,
      y: 0,
      duration: 180,
      ease: 'Back.easeOut',
    });
    if (this.cost < 4) {
      this.scene.tweens.add({ targets: this.aura, alpha: 0, duration: 240 });
    }
  }

  /** 阵亡：墨迹溶解 + 倾覆，不是"啪"地消失 */
  playDeath(onDone?: () => void): void {
    if (this.dead) return;
    this.dead = true;
    this.bars.clear();
    this.pips.clear();
    this.crown.clear();
    this.castRing.clear();
    this.scene.tweens.killTweensOf(this.sprite);
    this.scene.tweens.killTweensOf(this.aura);
    this.scene.tweens.add({
      targets: [this.sprite, this.base, this.shadow],
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeIn',
    });
    this.scene.tweens.add({
      targets: this.sprite,
      y: 14,
      angle: this.friendly ? -16 : 16,
      scaleX: this.sprite.scaleX * 0.82,
      scaleY: this.sprite.scaleY * 0.86,
      duration: 420,
      ease: 'Quad.easeIn',
      onComplete: () => onDone?.(),
    });
    this.scene.tweens.add({ targets: this.aura, alpha: 0, duration: 200 });
  }

  setSelected(on: boolean): void {
    this.selected = on;
    this.base.setTint(on ? GILT.light : RARITY_COLOR[this.cost]);
    this.base.setAlpha(on ? 1 : 0.92);
  }

  isDead(): boolean {
    return this.dead;
  }

  // ── 每帧 ──

  override update(dt: number): void {
    // 位置插值
    if (this.moveDur > 0) {
      this.moveT += dt;
      const t = Phaser.Math.Clamp(this.moveT / this.moveDur, 0, 1);
      const e = Phaser.Math.Easing.Quadratic.InOut(t);
      this.x = Phaser.Math.Linear(this.px, this.tx, e);
      this.y = Phaser.Math.Linear(this.py, this.ty, e);
      if (t >= 1) {
        this.moveDur = 0;
        this.px = this.tx;
        this.py = this.ty;
      }
    }

    // 待机呼吸：错开相位，避免整队同频抖动
    if (!this.dead && this.moveDur <= 0) {
      this.bobbing += dt;
      const bob = Math.sin(this.bobbing * 2.1 + this.x * 0.02) * 1.1;
      if (this.castT <= 0) this.sprite.y = bob;
    }

    // 白闪衰减
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.sprite.clearTint();
    }

    // 吟唱法阵
    if (this.castT > 0) {
      this.castT -= dt;
      const p = 1 - Phaser.Math.Clamp(this.castT / this.castTotal, 0, 1);
      this.drawCastRing(p);
      if (this.castT <= 0) this.castRing.clear();
    }

    if (this.star >= 3 && !this.dead) this.drawCrown(this.bobbing);
    if (this.cost >= 4 && !this.dead) {
      this.aura.rotation += dt * (this.cost >= 5 ? 0.9 : 0.5);
    }
    if (this.selected && !this.dead) {
      this.base.setAlpha(0.92 + Math.sin(this.bobbing * 7) * 0.08);
    }
  }

  private drawCastRing(p: number): void {
    const g = this.castRing;
    g.clear();
    const col = this.friendly ? SPIRIT.light : CINNABAR.light;
    g.lineStyle(2.4, col, 0.85);
    g.beginPath();
    g.arc(0, 0, 36 * (1 - p * 0.42), 0, Math.PI * 2);
    g.strokePath();
    g.lineStyle(1.2, PAPER[100], 0.6);
    g.beginPath();
    g.arc(0, 0, 36 * (1 - p * 0.42) - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    g.strokePath();
    // 三方符文
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + p * 2.4;
      const r = 36 * (1 - p * 0.42);
      g.fillStyle(col, 0.9);
      g.fillCircle(Math.cos(a) * r, Math.sin(a) * r * 0.5, 2.3);
    }
  }

  override destroy(fromScene?: boolean): void {
    this.scene.tweens.killTweensOf(this.sprite);
    this.scene.tweens.killTweensOf(this.base);
    this.scene.tweens.killTweensOf(this.aura);
    super.destroy(fromScene);
  }
}

/** 队伍色（供外部复用） */
export const TEAM_DEEP = TEAM_COLOR_DEEP;
