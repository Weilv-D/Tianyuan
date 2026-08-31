/**
 * 棋子卡片组件。
 *
 * 同一套视觉语言服务三种尺寸：棋盘格（站位）、备战席（待命）、商店卡（待购）。
 * 三处必须一眼看出是"同一个棋子的三种状态"，所以共用剪影、稀有度色、星级标记，
 * 只在信息密度上做减法 —— 棋盘上不需要名字，商店卡必须给出全部决策信息。
 */

import Phaser from 'phaser';
import { CHAMPION_BY_ID, formatSkillDesc } from '../data/champions';
import { ITEM_BY_ID } from '../data/items';
import { TRAIT_BY_ID } from '../data/traits';
import { GILT, INK, PAPER, RARITY_COLOR, SPIRIT, VOID, css } from '../render/view/palette';
import { SIL_ORIGIN_Y, silContentScale, silhouetteKey } from '../render/board/silhouetteFactory';
import { traitIconKey } from '../render/board/traitIcons';
import { itemIconKey } from '../render/board/itemIcons';
import { FONT, RADIUS } from './kit';
import { bakedTexture } from '../render/view/bake';
import type { UnitInstance } from '../game/state';
import type { Star } from '../core/types';

/** 底框烘焙图向外扩出的边距 —— 三星光环画在卡片边界之外 */
const CHROME_PAD = 8;
/** 单星烘焙图的留白，避免抗锯齿被裁掉 */
const STAR_TEX_PAD = 1;

/** 单颗星的烘焙图。按 (半径, 颜色) 复用，避免每张卡重画五角星多边形。 */
function starTexKey(scene: Phaser.Scene, r: number, color: number): string {
  const rr = Math.max(1, Math.round(r));
  const key = `star_${rr}_${color.toString(16)}`;
  const size = rr * 2 + STAR_TEX_PAD * 2;
  bakedTexture(scene, key, size, size, (g) => {
    drawStar(g, size / 2, size / 2, rr, color, 1);
  });
  return key;
}

/** 五角星。星级晋升感必须"肉眼可见"，用实星而非描边星。 */
export function drawStar(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number, alpha = 1): void {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.44;
    pts.push(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
  }
  g.fillStyle(color, alpha);
  g.fillPoints(
    (() => {
      const out: Phaser.Geom.Point[] = [];
      for (let i = 0; i < pts.length; i += 2) out.push(new Phaser.Geom.Point(pts[i], pts[i + 1]));
      return out;
    })(),
    true
  );
}

/**
 * 棋盘 / 备战席上的棋子。
 * 尺寸自适应：给一个 size，剪影按 0.82 的比例落在格子里，脚底对齐格子下沿。
 */
export class UnitPortrait extends Phaser.GameObjects.Container {
  private readonly sz: number;
  /** 底框 + 星级光环：烘焙图。形态只随 size/稀有度/星级变化，故按 key 复用 */
  private readonly chrome: Phaser.GameObjects.Image;
  /** 仅高亮时才画；平时是空的，不产生命令 */
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly sil: Phaser.GameObjects.Image;
  private readonly starRow: Phaser.GameObjects.Container;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly itemRow: Phaser.GameObjects.Container;
  private unit: UnitInstance | null = null;
  private highlighted = false;

  constructor(scene: Phaser.Scene, x: number, y: number, size: number) {
    super(scene, x, y);
    this.sz = size;
    // 底框、星级光环、实星全是"画一次就不变"的东西。
    // 原实现每个棋子卡 3 个 Graphics ≈ 310 条命令，屏上满编就是几千条，
    // 而它们只在买子 / 升星时才变。烤成纹理后每帧成本归零。
    this.chrome = scene.add.image(-CHROME_PAD, -CHROME_PAD, '__chrome').setOrigin(0).setVisible(false);
    this.bg = scene.add.graphics();
    this.sil = scene.add.image(size / 2, size, '').setVisible(false);
    this.starRow = scene.add.container(0, 0);
    this.nameText = scene.add
      .text(size / 2, size - 18, '', {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(PAPER[200]),
      })
      .setOrigin(0.5, 1);
    this.itemRow = scene.add.container(0, 0);
    this.add([this.chrome, this.bg, this.sil, this.starRow, this.nameText, this.itemRow]);
    this.redraw();
    scene.add.existing(this);
  }

  setUnit(u: UnitInstance | null, team = 0): void {
    // 场景切换的瞬间可能被调用到已销毁的实例上，静默忽略比整局崩溃好
    if (!this.scene) return;
    this.unit = u;
    if (!u) {
      this.sil.setVisible(false);
      this.nameText.setText('');
      this.redraw();
      return;
    }
    const def = CHAMPION_BY_ID[u.defId];
    const key = silhouetteKey(u.defId, team, u.star);
    if (this.scene.textures.exists(key)) {
      this.sil.setTexture(key);
      // 按墨迹可见内容高缩放（不同原型在纹理里的占框差异大），脚底贴格子下沿留 4px。
      // 0.82/0.94 是"看得清"口径：旧 0.72/0.84 让棋子缩在格里，盘面读不清眉眼
      const scale = silContentScale(u.defId, u.star, this.sz * 0.82, this.sz * 0.94);
      this.sil.setScale(scale).setOrigin(0.5, SIL_ORIGIN_Y);
      this.sil.setPosition(this.sz / 2, this.sz - 4);
      this.sil.setVisible(true);
    } else {
      this.sil.setVisible(false);
    }
    this.nameText.setText(def ? def.name : '');
    this.redraw();
  }

  get current(): UnitInstance | null {
    return this.unit;
  }

  /**
   * 在卡片左上角显示已装备的东西。
   * 棋盘上的棋子只有 94px，图标必须小到不遮挡剪影，又大到能数清件数。
   */
  setItems(itemIds: readonly string[]): void {
    if (!this.scene) return;
    this.itemRow.removeAll(true);
    const n = Math.min(3, itemIds.length);
    if (n === 0) return;
    const size = Math.max(13, Math.round(this.sz * 0.22));
    const gap = 3;
    for (let i = 0; i < n; i++) {
      const key = itemIconKey(itemIds[i]);
      if (!this.scene.textures.exists(key)) continue;
      const img = this.scene.add.image(4 + i * (size + gap) + size / 2, 5 + size / 2, key);
      img.setDisplaySize(size, size);
      this.itemRow.add(img);
    }
  }

  setHighlight(v: boolean): void {
    this.highlighted = v;
    this.redraw();
  }

  redraw(): void {
    const g = this.bg;
    const s = this.sz;
    g.clear();
    this.starRow.removeAll(true);
    if (!this.unit) {
      this.chrome.setVisible(false);
      return;
    }

    const def = CHAMPION_BY_ID[this.unit.defId];
    const cost = def?.cost ?? 1;
    const col = RARITY_COLOR[cost];
    const star = this.unit.star;

    // 底框 + 星级光环：一张烘焙图搞定，形态只由 (尺寸, 稀有度, 星级) 决定。
    // 光环要画到卡片外，所以整体平移 CHROME_PAD 进正坐标 —— generateTexture 只从 (0,0) 截。
    const key = `chrome_${Math.round(s)}_${cost}_${star}`;
    const o = CHROME_PAD;
    bakedTexture(this.scene, key, s + o * 2, s + o * 2, (cg) => {
      // 三星：外圈鎏金光环 —— "大哥登场"的视觉宣告
      if (star >= 3) {
        cg.lineStyle(2.5, GILT.base, 0.75);
        cg.strokeRoundedRect(o - 3, o - 3, s + 6, s + 6, RADIUS + 3);
        cg.lineStyle(1, GILT.light, 0.4);
        cg.strokeRoundedRect(o - 6, o - 6, s + 12, s + 12, RADIUS + 6);
      } else if (star === 2) {
        cg.lineStyle(1.5, col, 0.4);
        cg.strokeRoundedRect(o - 2, o - 2, s + 4, s + 4, RADIUS + 2);
      }
      // 底：稀有度色的极淡填充 + 描边。越低费越朴素，五费自带存在感。
      cg.fillStyle(INK[700], 0.55);
      cg.fillRoundedRect(o + 1, o + 1, s - 2, s - 2, RADIUS);
      cg.fillStyle(col, 0.1 + cost * 0.02);
      cg.fillRoundedRect(o + 1, o + 1, s - 2, s - 2, RADIUS);
      cg.lineStyle(star >= 3 ? 2 : 1.4, col, star >= 3 ? 0.95 : 0.7);
      cg.strokeRoundedRect(o + 1, o + 1, s - 2, s - 2, RADIUS);
    });
    this.chrome.setTexture(key).setVisible(true);

    // 星级：底部居中实星，用烘焙好的单星贴图摆出来。
    // 星顶至多到 size-16，名字底边在 size-18 —— 各占底部一条带，互不相交
    const r = Math.min(7, Math.max(3, s * 0.055));
    const gap = r * 2.5;
    const totalW = (star - 1) * gap;
    const starKey = starTexKey(this.scene, r, star >= 3 ? GILT.light : PAPER[100]);
    for (let i = 0; i < star; i++) {
      const img = this.scene.add.image(
        s / 2 - totalW / 2 + i * gap,
        s - r - 2,
        starKey,
      );
      this.starRow.add(img);
    }

    if (this.highlighted) {
      g.lineStyle(2, GILT.light, 0.9);
      g.strokeRoundedRect(0, 0, s, s, RADIUS);
      g.fillStyle(GILT.base, 0.12);
      g.fillRoundedRect(0, 0, s, s, RADIUS);
    }
  }
}

/**
 * 商店卡（样稿 .scard 窄卡语言，棋子照用本项目剪影）。
 *
 * 顶部 22px 稀有度刻线 → 棋子剪影 → 棋名 → 品阶 · 称号 → 羁绊 → mono 价签。
 * 买不起时整体压暗；悬停时整卡上浮 + 金线描边（样稿 hover 位移语言）。
 */
export class ShopCard extends Phaser.GameObjects.Container {
  private readonly cardW: number;
  private readonly cardH: number;
  private readonly baseY: number;
  private readonly bg: Phaser.GameObjects.Image;
  private readonly sil: Phaser.GameObjects.Image;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly costText: Phaser.GameObjects.Text;
  private readonly traitText: Phaser.GameObjects.Text;
  private defId: string | null = null;
  private affordable = true;
  private owned = false;
  private ownedTween: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, onClick: () => void) {
    super(scene, x, y);
    this.cardW = w;
    this.cardH = h;
    this.baseY = y;
    this.bg = scene.add.image(-1, -1, '__shop').setOrigin(0);
    this.sil = scene.add.image(w / 2, h - 62, '').setVisible(false);
    // 底部信息带只留决策三行：名 / 羁绊 / 价 —— 品阶由底框色表达，称号是冗余文字
    this.nameText = scene.add
      .text(w / 2, h - 54, '', { fontFamily: FONT.title, fontSize: '13px', color: css(PAPER[100]), letterSpacing: 4 })
      .setOrigin(0.5, 0);
    this.traitText = scene.add
      .text(w / 2, h - 35, '', { fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[300]) })
      .setOrigin(0.5, 0);
    this.costText = scene.add
      .text(w / 2, h - 17, '', { fontFamily: FONT.mono, fontSize: '12px', color: css(GILT.light) })
      .setOrigin(0.5, 0);
    this.add([this.bg, this.sil, this.nameText, this.traitText, this.costText]);
    this.setSize(w, h);
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    this.on('pointerover', () => {
      if (this.defId) scene.input.setDefaultCursor('pointer');
      scene.tweens.add({ targets: this, y: this.baseY - 8, duration: 320, ease: 'Quad.easeOut' });
      this.redraw(true);
    });
    this.on('pointerout', () => {
      scene.input.setDefaultCursor('default');
      scene.tweens.add({ targets: this, y: this.baseY, duration: 320, ease: 'Quad.easeOut' });
      this.redraw(false);
    });
    this.on('pointerdown', () => {
      if (!this.defId) return;
      // 买子动作发生在 pointerdown，反馈必须同帧可见：压卡 + 提亮
      this.setScale(0.96);
      scene.tweens.add({ targets: this, scale: 1, duration: 120, ease: 'Quad.easeOut' });
      onClick();
    });
    this.redraw(false);
    scene.add.existing(this);
  }

  setDef(defId: string | null): void {
    if (!this.scene) return;
    if (this.defId === defId) return; // 同卡不刷新：买不起状态走 setAffordable
    this.defId = defId;
    if (!defId) {
      this.setOwned(false);
      this.sil.setVisible(false);
      this.nameText.setText('');
      this.costText.setText('');
      this.traitText.setText('');
      this.redraw(false);
      return;
    }
    const def = CHAMPION_BY_ID[defId];
    if (!def) return;
    const key = silhouetteKey(defId, 0, 1); // 商店里永远是一星新兵的简笔剪影
    if (this.scene.textures.exists(key)) {
      this.sil.setTexture(key);
      // 按墨迹可见内容高缩放：所有卡片的棋子占卡面同一比例，不再随原型忽大忽小
      const scale = silContentScale(defId, 1, 62, this.cardW * 0.76);
      this.sil.setScale(scale).setOrigin(0.5, SIL_ORIGIN_Y);
      this.sil.setPosition(this.cardW / 2, this.cardH - 62);
      this.sil.setVisible(true);
    }
    this.nameText.setText(def.name);
    // 羁绊名：单行截断，宁可少字不可溢出
    const names = [...def.origins, ...def.classes]
      .map((t) => TRAIT_BY_ID[t]?.name ?? t)
      .join(' · ');
    this.traitText.setText(clipToWidth(this.traitText, names, this.cardW - 12));
    this.costText.setText(`${def.cost} 金`);
    this.redraw(false);
  }

  setAffordable(v: boolean): void {
    if (this.affordable === v) return;
    this.affordable = v;
    this.setAlpha(v ? 1 : 0.42);
  }

  /**
   * 场上/备战席已有同名棋子：金框高亮 + 呼吸脉冲。
   * 这是"买它 = 向合成推进/凑羁绊"的提示；脉冲打在底框贴图上，
   * 与悬停上浮（容器 y）分属不同属性，互不打断。
   */
  setOwned(v: boolean): void {
    if (this.owned === v) return;
    this.owned = v;
    this.ownedTween?.remove();
    this.ownedTween = null;
    this.bg.setAlpha(1);
    if (v && this.scene) {
      this.ownedTween = this.scene.tweens.add({
        targets: this.bg,
        alpha: { from: 1, to: 0.66 },
        duration: 460,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    if (this.defId) this.redraw(false);
  }

  override destroy(fromScene?: boolean): void {
    this.ownedTween?.remove();
    this.ownedTween = null;
    super.destroy(fromScene);
  }

  get def(): string | null {
    return this.defId;
  }

  private redraw(hover: boolean): void {
    const w = this.cardW;
    const h = this.cardH;
    const def = this.defId ? CHAMPION_BY_ID[this.defId] : null;
    const col = def ? RARITY_COLOR[def.cost] : INK[500];
    // 底板按（稀有度 × 悬停）烘焙：五费五种 × 两态共十余张，五张卡共用。
    // 悬停态要含 affordable：买不起的卡悬停不提亮，且不能和买得起时共用同一张贴图
    const hoverOn = hover && !!def && this.affordable;
    const key = `shopv3_${w}x${h}_${def?.cost ?? 0}_${hoverOn ? 1 : 0}_${this.owned ? 1 : 0}`;
    bakedTexture(this.scene!, key, w + 2, h + 2, (g) => {
      g.translateCanvas(1, 1);
      // 漆卡：半透漆底 + 淡金细框（样稿 .scard）
      g.fillStyle(INK[800], def ? 0.62 : 0.3);
      g.fillRect(0, 0, w, h);
      g.lineStyle(1, def ? GILT.base : INK[500], def ? 0.16 : 0.25);
      g.strokeRect(0, 0, w, h);
      if (def) {
        // 顶部稀有度通栏色带：满宽 3px —— 远看也认得出费用档位（旧 22px 短线太隐晦）
        g.fillStyle(col, 0.95);
        g.fillRect(0, 0, w, 3);
        g.fillStyle(col, 0.35);
        g.fillRect(0, 3, w, 1.5);
        // 剪影脚下的一道稀有度微染：站位的"地"，代替此前的占位圆碟
        g.fillStyle(col, 0.14);
        g.fillRect(w / 2 - 26, h - 64, 52, 2);
      }
      if (this.owned) {
        // 已有同名：双线金框 + 淡金内染，配合呼吸脉冲一眼可辨
        g.fillStyle(GILT.base, 0.09);
        g.fillRect(0, 0, w, h);
        g.lineStyle(2, GILT.light, 0.95);
        g.strokeRect(1, 1, w - 2, h - 2);
        g.lineStyle(1, GILT.base, 0.4);
        g.strokeRect(3.5, 3.5, w - 7, h - 7);
      }
      if (hoverOn) {
        g.fillStyle(PAPER[100], 0.05);
        g.fillRect(0, 0, w, h);
        g.lineStyle(1, GILT.light, 0.7);
        g.strokeRect(0, 0, w, h);
      }
    });
    this.bg.setTexture(key);
  }
}

/** 文本按像素宽截断（末端省略号） */
function clipToWidth(t: Phaser.GameObjects.Text, s: string, maxW: number): string {
  t.setText(s);
  while (t.width > maxW && t.text.length > 2) {
    t.setText(t.text.slice(0, -2).trimEnd() + '…');
  }
  return t.text;
}

/** 羁绊行：小篆徽章 + 名称 + 当前/下一档 + 档位色。行高随描述行数自适应，绝不压到下一行 */
export class TraitRow extends Phaser.GameObjects.Container {
  private readonly cardW: number;
  private readonly bg: Phaser.GameObjects.Image;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly countText: Phaser.GameObjects.Text;
  private readonly descText: Phaser.GameObjects.Text;
  /** 本行实际高度（含底部呼吸间距），排布方用它在纵轴上堆叠 */
  rowHeight = 46;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number) {
    super(scene, x, y);
    this.cardW = w;
    this.bg = scene.add.image(0, 0, '__trow').setOrigin(0);
    this.icon = scene.add.image(23, 21, '').setVisible(false).setDisplaySize(30, 30);
    this.nameText = scene.add.text(46, 4, '', { fontFamily: FONT.title, fontSize: '14px', color: css(PAPER[100]), letterSpacing: 1 }).setOrigin(0, 0);
    this.countText = scene.add.text(w - 8, 5, '', { fontFamily: FONT.num, fontSize: '12px', color: css(GILT.base) }).setOrigin(1, 0);
    this.descText = scene.add.text(46, 21, '', { fontFamily: FONT.body, fontSize: '13px', color: css(PAPER[400]), wordWrap: { useAdvancedWrap: true, width: w - 60 } }).setOrigin(0, 0);
    this.add([this.bg, this.icon, this.nameText, this.countText, this.descText]);
    scene.add.existing(this);
  }

  set(id: string, count: number, tier: number, nextBreak: number, tierColor: number, desc: string): void {
    const def = TRAIT_BY_ID[id];
    const active = tier >= 0;
    if (this.scene.textures.exists(traitIconKey(id, active ? Math.min(tier, 3) : 0))) {
      this.icon.setTexture(traitIconKey(id, active ? Math.min(tier, 3) : 0)).setVisible(true);
    }
    this.nameText.setText(def?.name ?? id);
    this.nameText.setColor(active ? css(tierColor) : css(INK[300]));
    this.countText.setText(`${count}/${nextBreak}`);
    this.countText.setColor(active ? css(tierColor) : css(PAPER[400]));
    this.descText.setText(desc);
    this.descText.setColor(active ? css(PAPER[300]) : css(INK[300]));

    // 描述最多两行：超出截断加省略号，宁可少一行字也不许压到下一行
    while (this.descText.height > 32 && this.descText.text.length > 4) {
      this.descText.setText(this.descText.text.slice(0, -2).trimEnd() + '…');
    }
    const h = Math.max(46, 21 + this.descText.height + 6);
    this.rowHeight = h;

    // 底板烘焙：形态只由（宽 × 高 × 激活 × 档位色）决定；档位语言由徽章金线表达
    const key = `trow_${this.cardW}x${h}_${active ? 1 : 0}_${tierColor.toString(16)}`;
    bakedTexture(this.scene!, key, this.cardW, h, (g) => {
      g.fillStyle(active ? INK[700] : INK[850], active ? 0.9 : 0.5);
      g.fillRoundedRect(0, 0, this.cardW, h, 6);
      if (active) {
        g.fillStyle(tierColor, 0.1);
        g.fillRoundedRect(0, 0, this.cardW, h, 6);
        g.lineStyle(1.2, tierColor, 0.6);
        g.strokeRoundedRect(0, 0, this.cardW, h, 6);
      }
    });
    this.bg.setTexture(key);
    this.setSize(this.cardW, h);
  }
}

/** 星级小标记，用于计分板与提示 */
export function starGlyph(star: Star): string {
  return star === 1 ? '★' : star === 2 ? '★★' : '★★★';
}

/**
 * 棋子悬停详情卡（复用式）。
 *
 * 首次悬停构建一次全部子对象；此后换棋子只做 setText / 换贴图，离开时隐藏而非销毁。
 * 悬停是热路径：鼠标扫过棋盘每换一枚棋子就销毁重建十余个 2× 分辨率文本，
 * 正是"指针移动不跟手"的直接来源之一。
 */
export class UnitDetailCard {
  readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Image;
  private readonly nameT: Phaser.GameObjects.Text;
  private readonly subT: Phaser.GameObjects.Text;
  private readonly costT: Phaser.GameObjects.Text;
  private readonly statT: Phaser.GameObjects.Text[] = [];
  private readonly itemsRow: Phaser.GameObjects.Container;
  private readonly traitT: Phaser.GameObjects.Text;
  private readonly skillT: Phaser.GameObjects.Text;
  private readonly descT: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, w: number) {
    this.container = scene.add.container(-999, -999).setDepth(400).setVisible(false);
    this.bg = scene.add.image(0, 0, '__dcard').setOrigin(0);
    this.container.add(this.bg);

    this.nameT = scene.add.text(14, 12, '', { fontFamily: FONT.title, fontSize: '22px', color: css(PAPER[100]) }).setOrigin(0, 0);
    this.subT = scene.add.text(14, 40, '', { fontFamily: FONT.body, fontSize: '13px', color: css(GILT.light) }).setOrigin(0, 0);
    this.costT = scene.add.text(w - 14, 14, '', { fontFamily: FONT.body, fontSize: '13px', color: css(PAPER[300]) }).setOrigin(1, 0);
    for (let i = 0; i < 4; i++) {
      const t = scene.add.text(14, 66 + i * 19, '', { fontFamily: FONT.body, fontSize: '13px', color: css(PAPER[300]) }).setOrigin(0, 0);
      this.statT.push(t);
    }
    this.itemsRow = scene.add.container(14, 148);
    this.traitT = scene.add.text(14, 172, '', { fontFamily: FONT.body, fontSize: '13px', color: css(SPIRIT.light) }).setOrigin(0, 0);
    this.skillT = scene.add.text(14, 194, '', { fontFamily: FONT.title, fontSize: '14px', color: css(VOID.light) }).setOrigin(0, 0);
    this.descT = scene.add
      .text(14, 214, '', { fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[400]), wordWrap: { useAdvancedWrap: true, width: w - 28 } })
      .setOrigin(0, 0);
    this.container.add([this.nameT, this.subT, this.costT, ...this.statT, this.itemsRow, this.traitT, this.skillT, this.descT]);
  }

  update(u: UnitInstance, w: number, h: number): void {
    const def = CHAMPION_BY_ID[u.defId];
    if (!def) {
      this.container.setVisible(false);
      return;
    }
    // 底框按稀有度烘焙：五种成本各一张，换棋子只是换贴图
    const key = `dcard_${def.cost}_${Math.round(w)}x${Math.round(h)}`;
    bakedTexture(this.container.scene!, key, w, h, (g) => {
      g.fillStyle(INK[900], 0.97);
      g.fillRect(0, 0, w, h);
      g.lineStyle(1.5, RARITY_COLOR[def.cost], 0.95);
      g.strokeRect(0, 0, w, h);
      g.fillStyle(RARITY_COLOR[def.cost], 0.85);
      g.fillRect(0, 0, w, 3);
    });
    this.bg.setTexture(key);

    this.nameT.setText(def.name);
    this.subT.setText(`${def.title}　${'★'.repeat(u.star)}`);
    this.costT.setText(`${def.cost} 费`);

    const s = def.base;
    const rows = [
      `生命 ${Math.round(s.hp * (u.star === 1 ? 1 : u.star === 2 ? 1.8 : 3.24))}`,
      `攻击 ${Math.round(s.atk * (u.star === 1 ? 1 : u.star === 2 ? 1.45 : 2.1))}　法强 ${Math.round(s.sp * (u.star === 1 ? 1 : u.star === 2 ? 1.45 : 2.1))}`,
      `护甲 ${s.armor}　魔抗 ${s.mr}`,
      `攻速 ${s.aspd.toFixed(2)}　射程 ${s.range}　法力 ${s.maxMp}`,
    ];
    rows.forEach((t, i) => {
      if (this.statT[i].text !== t) this.statT[i].setText(t);
    });

    // 已穿装备行：图标 + 名
    this.itemsRow.removeAll(true);
    let ix = 0;
    for (const iid of u.items.slice(0, 3)) {
      const idef = ITEM_BY_ID[iid];
      if (!idef) continue;
      if (this.container.scene?.textures.exists(itemIconKey(iid))) {
        this.itemsRow.add(
          this.container.scene.add.image(ix, 0, itemIconKey(iid)).setDisplaySize(16, 16).setOrigin(0, 0)
        );
        ix += 20;
      }
      const t = this.container.scene!.add
        .text(ix, 2, idef.name, { fontFamily: FONT.body, fontSize: '13px', color: css(GILT.light) })
        .setOrigin(0, 0);
      this.itemsRow.add(t);
      ix += t.width + 10;
    }

    this.traitT.setText([...def.origins, ...def.classes].map((t) => TRAIT_BY_ID[t]?.name ?? t).join(' · '));
    this.skillT.setText(def.skillSpec.name);
    this.descT.setText(formatSkillDesc(def.skillSpec.desc, def.skillSpec.params));
    this.container.setVisible(true);
  }
}

/**
 * 装备栏里的一件装备。
 *
 * 成品与组件必须在余光里就能分辨 —— 成品带鎏金底光和内描边，组件只有石色描边。
 * 玩家扫一眼装备栏就该知道"我有几件能用的神装"。
 */
export class ItemChip extends Phaser.GameObjects.Container {
  private readonly chipSize: number;
  private readonly bg: Phaser.GameObjects.Image;
  private readonly img: Phaser.GameObjects.Image;
  private itemId: string | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, size: number, onClick: () => void) {
    super(scene, x, y);
    this.chipSize = size;
    this.bg = scene.add.image(-1, -1, '__ichip').setOrigin(0);
    this.img = scene.add.image(size / 2, size / 2, '').setVisible(false);
    this.add([this.bg, this.img]);
    this.setSize(size, size);
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, size, size), Phaser.Geom.Rectangle.Contains);
    this.on('pointerover', () => {
      if (this.itemId) scene.input.setDefaultCursor('pointer');
      this.redraw(true);
    });
    this.on('pointerout', () => {
      scene.input.setDefaultCursor('default');
      this.redraw(false);
    });
    this.on('pointerdown', () => {
      if (this.itemId) onClick();
    });
    this.redraw(false);
    scene.add.existing(this);
  }

  setItem(id: string | null): void {
    if (this.itemId === id && this.img.visible === !!id) return; // 同物不重刷
    this.itemId = id;
    if (!id) {
      this.img.setVisible(false);
      this.redraw(false);
      return;
    }
    const key = itemIconKey(id);
    if (this.scene.textures.exists(key)) {
      this.img.setTexture(key);
      this.img.setDisplaySize(this.chipSize - 12, this.chipSize - 12);
      this.img.setPosition(this.chipSize / 2, this.chipSize / 2);
      this.img.setVisible(true);
    }
    this.redraw(false);
  }

  get item(): string | null {
    return this.itemId;
  }

  private redraw(hover: boolean): void {
    const s = this.chipSize;
    const def = this.itemId ? ITEM_BY_ID[this.itemId] : null;
    const kind = !def ? 'e' : def.tier === 'combined' ? 'c' : 'p';
    // 底板按（尺寸 × 品类 × 悬停）烘焙，十格共用三张基础贴图
    const key = `ichip_${s}_${kind}_${hover ? 1 : 0}`;
    bakedTexture(this.scene!, key, s + 2, s + 2, (g) => {
      g.translateCanvas(1, 1);
      if (!def) {
        // 空格位：极淡的虚位，让玩家看得出"这里还能放"
        g.fillStyle(INK[850], 0.5);
        g.fillRoundedRect(0, 0, s, s, 6);
        g.lineStyle(1, INK[500], 0.4);
        g.strokeRoundedRect(0, 0, s, s, 6);
        return;
      }
      const tier = def.tier === 'combined' ? GILT.base : INK[400];
      g.fillStyle(INK[700], 0.92);
      g.fillRoundedRect(0, 0, s, s, 6);
      if (def.tier === 'combined') {
        g.fillStyle(GILT.base, 0.16);
        g.fillRoundedRect(0, 0, s, s, 6);
      }
      g.lineStyle(def.tier === 'combined' ? 1.8 : 1.2, tier, def.tier === 'combined' ? 0.95 : 0.7);
      g.strokeRoundedRect(0, 0, s, s, 6);
      if (hover) {
        g.fillStyle(PAPER[100], 0.1);
        g.fillRoundedRect(0, 0, s, s, 6);
        g.lineStyle(2, GILT.light, 0.85);
        g.strokeRoundedRect(0, 0, s, s, 6);
      }
    });
    this.bg.setTexture(key);
  }
}
