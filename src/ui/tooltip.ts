import Phaser from 'phaser';
import { ITEMS, ITEM_BY_ID } from '../data/items';
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
    if (!this.card || this.itemId !== itemId) this.rebuild(itemId);
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

    // 首行：图标 + 名（成品鎏金、组件月白）
    const icon = this.scene.add
      .image(14, 14, itemIconKey(itemId))
      .setDisplaySize(26, 26)
      .setOrigin(0, 0);
    c.add(icon);
    c.add(
      this.scene.add
        .text(48, 15, def.name, { fontFamily: FONT.title, fontSize: '15px', color: css(nameColor) })
        .setOrigin(0, 0)
    );
    y = 44;

    const desc = this.scene.add
      .text(14, y, def.desc, {
        fontFamily: FONT.body,
        fontSize: '13px',
        color: css(PAPER[300]),
        wordWrap: { width: w - 28 },
      })
      .setOrigin(0, 0);
    c.add(desc);
    y += desc.height + 8;

    // 合成信息：成品给来源，组件给去向
    let recipeLine = '';
    if (def.tier === 'combined' && def.recipe) {
      const [a, b] = def.recipe;
      recipeLine = `由 ${ITEM_BY_ID[a]?.name ?? a} + ${ITEM_BY_ID[b]?.name ?? b} 合成`;
    } else if (def.tier === 'component') {
      const outs = ITEMS.filter((it) => it.tier === 'combined' && it.recipe?.includes(itemId)).map(
        (it) => it.name
      );
      if (outs.length > 0) recipeLine = `可合成 ${outs.join(' · ')}`;
    }
    if (recipeLine) {
      const rec = this.scene.add
        .text(14, y, recipeLine, {
          fontFamily: FONT.body,
          fontSize: '13px',
          color: css(GILT.base),
          wordWrap: { width: w - 28 },
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
}
