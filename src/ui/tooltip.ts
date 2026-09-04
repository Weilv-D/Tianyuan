import Phaser from 'phaser';
import { ITEM_BY_ID, combine } from '../data/items';
import { itemIconKey } from '../render/board/itemIcons';
import { GILT, INK, PAPER, css } from '../render/view/palette';
import { FONT } from './kit';

/**
 * 装备悬停提示卡。
 *
 * 此前装备名 / 效果 / 合成路径在整个 UI 层零消费 —— 器匣里只有图标，
 * 玩家没有任何途径知道手里拿的是什么。这张卡是装备信息的常驻出口：
 * 名 + 效果 +（组件）可合成去向 /（成品）合成来源。
 *
 * 复用纪律：内容只在物品变化时重建（悬停路径是热路径，逐移动重建是灾难），
 * 位置随指针走并做屏幕边界钳制。
 */
export class ItemTooltip {
  private card: Phaser.GameObjects.Container | null = null;
  private itemId: string | null = null;
  /** 合成预览态：拖组件悬停到另一组件上，预览 A + B → C */
  private combineA: string | null = null;
  private combineB: string | null = null;
  private cardW = 244;
  private cardH = 96;
  private readonly maxRight: number;
  private readonly maxBottom: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth = 450,
    viewW = 1920,
    viewH = 1080,
  ) {
    this.maxRight = viewW;
    this.maxBottom = viewH;
  }

  show(itemId: string, px: number, py: number): void {
    // 名单外 id：不显示上一件的旧卡（rebuild 对未知 id 早退后若照常 setVisible，
    // 悬停会弹出一个内容与指针所指完全无关的提示卡）
    if (!ITEM_BY_ID[itemId]) {
      this.hide();
      return;
    }
    if (!this.card || this.itemId !== itemId) this.rebuild(itemId);
    this.card?.setVisible(true);
    this.move(px, py);
  }

  /** 合成预览：A + B → C（拖组件悬停到另一组件且可合成时） */
  showCombine(a: string, b: string, px: number, py: number): void {
    const out = combine(a, b);
    if (!out) return;
    if (!this.combineA || this.combineA !== a || this.combineB !== b) this.rebuildCombine(a, b, out);
    this.card?.setVisible(true);
    this.move(px, py);
  }

  hide(): void {
    this.card?.setVisible(false);
  }

  move(px: number, py: number): void {
    if (!this.card) return;
    // 优先出现在指针右下；越界时翻到左侧 / 顶起
    const x = px + 24 + this.cardW > this.maxRight ? px - this.cardW - 18 : px + 24;
    const y = Phaser.Math.Clamp(py + 16, 12, Math.max(12, this.maxBottom - this.cardH - 12));
    this.card.setPosition(x, y);
  }

  destroy(): void {
    this.card?.destroy();
    this.card = null;
    this.itemId = null;
    this.combineA = null;
    this.combineB = null;
  }

  private rebuild(itemId: string): void {
    const def = ITEM_BY_ID[itemId];
    if (!def) return;
    this.destroy();
    this.itemId = itemId;
    const w = this.cardW;
    const c = this.scene.add.container(-999, -999).setDepth(this.depth);

    const nameColor = def.tier === 'combined' ? GILT.light : PAPER[100];
    let y = 0;

    // 首行：图标 + 名（成品鎏金、组件月白）。v1.9 放大：26→36 —— 提示卡
    // 是玩家读装备的唯一出口，图标必须与名字同权重
    const icon = this.scene.add
      .image(14, 12, itemIconKey(itemId))
      .setDisplaySize(36, 36)
      .setOrigin(0, 0);
    c.add(icon);
    c.add(
      this.scene.add
        .text(58, 15, def.name, { fontFamily: FONT.title, fontSize: '16px', color: css(nameColor) })
        .setOrigin(0, 0)
    );
    y = 52;

    const desc = this.scene.add
      .text(14, y, def.desc, {
        fontFamily: FONT.body,
        fontSize: '13px',
        color: css(PAPER[300]),
        wordWrap: { useAdvancedWrap: true, width: w - 28 },
      })
      .setOrigin(0, 0);
    c.add(desc);
    y += desc.height + 8;

    // 合成信息：成品给来源；组件在全配方（36/36）下与任意组件必有合成，
    // 逐一列出去向（8 条）只会淹没提示卡，改为一句话
    let recipeLine = '';
    if (def.tier === 'combined' && def.recipe) {
      const [a, b] = def.recipe;
      recipeLine = `由 ${ITEM_BY_ID[a]?.name ?? a} + ${ITEM_BY_ID[b]?.name ?? b} 合成`;
    } else if (def.tier === 'component') {
      recipeLine = '与任意组件拖到一起即可合成成品';
    }
    if (recipeLine) {
      const rec = this.scene.add
        .text(14, y, recipeLine, {
          fontFamily: FONT.body,
          fontSize: '13px',
          color: css(GILT.base),
          wordWrap: { useAdvancedWrap: true, width: w - 28 },
        })
        .setOrigin(0, 0);
      c.add(rec);
      y += rec.height + 8;
    }

    const h = Math.max(76, y + 6);
    this.cardH = h;
    const g = this.scene.add.graphics();
    g.fillStyle(INK[900], 0.97);
    g.fillRect(0, 0, w, h);
    const edge = def.tier === 'combined' ? GILT.base : INK[400];
    g.lineStyle(1.5, edge, 0.9);
    g.strokeRect(0, 0, w, h);
    g.fillStyle(edge, 0.7);
    g.fillRect(0, 0, w, 2);
    c.addAt(g, 0);
    this.card = c;
  }

  /** 合成预览卡：首行三枚图标 A + B → C，下接成品名/效果/来源。成品信息即决策信息。 */
  private rebuildCombine(a: string, b: string, out: string): void {
    const outDef = ITEM_BY_ID[out];
    if (!outDef) return;
    this.destroy();
    this.combineA = a;
    this.combineB = b;
    const w = this.cardW;
    const c = this.scene.add.container(-999, -999).setDepth(this.depth);
    let y = 12;

    const icon = (id: string, size: number): Phaser.GameObjects.Image =>
      this.scene.add.image(0, 0, itemIconKey(id)).setDisplaySize(size, size).setOrigin(0, 0);
    // 三图标共用一条视觉中线（MID）：散件 30px 与成装 36px 同心排布，符号与墨迹对齐
    const MID = y + 30;
    const aIcon = icon(a, 30);
    aIcon.setPosition(14, MID - 15);
    c.add(aIcon);
    // 文本框因 descent 补底比字形略高，中心再让 1px 才与图标墨迹对齐
    c.add(
      this.scene.add.text(50, MID + 1, '+', { fontFamily: FONT.body, fontSize: '14px', color: css(INK[300]) }).setOrigin(0.5)
    );
    const bIcon = icon(b, 30);
    bIcon.setPosition(66, MID - 15);
    c.add(bIcon);
    c.add(
      this.scene.add.text(102, MID + 1, '→', { fontFamily: FONT.body, fontSize: '14px', color: css(INK[300]) }).setOrigin(0.5)
    );
    const cIcon = icon(out, 36);
    cIcon.setPosition(122, MID - 18);
    c.add(cIcon);
    y += 50;

    c.add(
      this.scene.add
        .text(14, y, outDef.name, { fontFamily: FONT.title, fontSize: '16px', color: css(GILT.light) })
        .setOrigin(0, 0)
    );
    y += 28;

    const desc = this.scene.add
      .text(14, y, outDef.desc, {
        fontFamily: FONT.body,
        fontSize: '13px',
        color: css(PAPER[300]),
        wordWrap: { useAdvancedWrap: true, width: w - 28 },
      })
      .setOrigin(0, 0);
    c.add(desc);
    y += desc.height + 8;

    const rec = this.scene.add
      .text(14, y, `由 ${ITEM_BY_ID[a]?.name ?? a} + ${ITEM_BY_ID[b]?.name ?? b} 合成`, {
        fontFamily: FONT.body,
        fontSize: '13px',
        color: css(GILT.base),
        wordWrap: { useAdvancedWrap: true, width: w - 28 },
      })
      .setOrigin(0, 0);
    c.add(rec);
    y += rec.height + 8;

    const h = Math.max(96, y + 6);
    this.cardH = h;
    const g = this.scene.add.graphics();
    g.fillStyle(INK[900], 0.97);
    g.fillRect(0, 0, w, h);
    g.lineStyle(1.5, GILT.base, 0.9);
    g.strokeRect(0, 0, w, h);
    g.fillStyle(GILT.base, 0.7);
    g.fillRect(0, 0, w, 2);
    c.addAt(g, 0);
    this.card = c;
  }
}
