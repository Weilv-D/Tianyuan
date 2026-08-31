import Phaser from 'phaser';
import { CHAMPIONS, CHAMPION_BY_ID } from '../../data/champions';
import { TRAITS } from '../../data/traits';
import { ITEMS, ITEM_BY_ID } from '../../data/items';
import { audio } from '../../audio/AudioEngine';
import { Button, enableScroll, FONT, makePanel, type ScrollHandle } from '../../ui/kit';
import { ItemTooltip } from '../../ui/tooltip';
import { ItemChip, UnitDetailCard, UnitPortrait } from '../../ui/cards';
import { GILT, INK, PAPER, RARITY_COLOR, TRAIT_TIER_COLOR_HEX, css } from '../view/palette';
import { itemIconKey, bakeItemIcons } from '../board/itemIcons';
import { traitIconKey, bakeTraitIcons } from '../board/traitIcons';
import { bakeSilhouettes } from '../board/silhouetteFactory';
import { buildTextures, grainOverlay } from '../view/textures';
import { baseZoom } from '../view/viewScale';
import { H, W } from '../view/layout';

/**
 * 图鉴场景（离对局浏览）。
 *
 * 三册：棋子 / 羁绊 / 装备，外加装备合成表。
 * 此前 64 棋子的技能、17 羁绊的全部档位、22 件装备的效果与合成路径
 * 在 UI 层没有任何常驻出口，玩家只能在对局中撞见什么查什么。
 */

type CodexTab = 'champs' | 'traits' | 'items';

const BODY_X = 40;
const BODY_Y = 96;
const BODY_W = W - 80;
const BODY_H = H - BODY_Y - 40;

export class CodexScene extends Phaser.Scene {
  private contents: Record<CodexTab, Phaser.GameObjects.Container | null> = {
    champs: null,
    traits: null,
    items: null,
  };
  private scrolls: Record<CodexTab, ScrollHandle | null> = {
    champs: null,
    traits: null,
    items: null,
  };
  private tabBtns: Partial<Record<CodexTab, Button>> = {};
  private backTo: 'Menu' | 'Game' = 'Menu';
  private itemTip!: ItemTooltip;
  private detailCard: UnitDetailCard | null = null;

  constructor() {
    super({ key: 'Codex' });
  }

  create(data: { from?: 'Menu' | 'Game' }): void {
    baseZoom(this);
    // 从对局进入（nav「图鉴」）时返回对局（存档在 GameScene shutdown 时已落盘）
    this.backTo = data.from === 'Game' ? 'Game' : 'Menu';
    buildTextures(this);
    grainOverlay(this);
    bakeSilhouettes(this);
    bakeItemIcons(this);
    bakeTraitIcons(this);
    this.itemTip = new ItemTooltip(this, 460);
    this.detailCard = null;
    this.contents = { champs: null, traits: null, items: null };
    this.scrolls = { champs: null, traits: null, items: null };

    // 背景：夜色山海由 index.html 的 #bg 承担（透明画布），此处不再铺底

    this.add
      .text(56, 24, '图 鉴', { fontFamily: FONT.title, fontSize: '30px', color: css(PAPER[100]), letterSpacing: 6 })
      .setOrigin(0, 0);

    const tabs: [CodexTab, string][] = [
      ['champs', '棋 子'],
      ['traits', '羁 绊'],
      ['items', '装 备'],
    ];
    tabs.forEach(([id, label], i) => {
      const b = new Button(this, 260 + i * 150, 26, label, () => this.switchTab(id), {
        width: 130,
        height: 44,
        fontSize: 15,
      });
      this.tabBtns[id] = b;
    });

    new Button(this, W - 200, 26, '返 回', () => this.scene.start(this.backTo, {}), {
      width: 150,
      height: 44,
      variant: 'primary',
    });

    makePanel(this, BODY_X - 16, BODY_Y - 14, BODY_W + 32, BODY_H + 28, { alpha: 0.82 });
    this.buildChamps();
    this.buildTraits();
    this.buildItems();
    this.switchTab('champs');
  }

  private switchTab(tab: CodexTab): void {
    this.itemTip.hide();
    this.detailCard?.container.setVisible(false);
    for (const k of ['champs', 'traits', 'items'] as CodexTab[]) {
      this.contents[k]?.setVisible(k === tab);
    }
    for (const [k, b] of Object.entries(this.tabBtns)) {
      b?.setAlpha(k === tab ? 1 : 0.6);
    }
    audio.play('ui');
  }

  // ══════════════ 棋子册 ══════════════

  private buildChamps(): void {
    const c = this.add.container(BODY_X, BODY_Y);
    this.contents.champs = c;
    const cols = 12;
    const cw = Math.floor(BODY_W / cols); // ~153
    const chh = 168;
    let y = 0;
    for (let cost = 1; cost <= 5; cost++) {
      const group = CHAMPIONS.filter((d) => d.cost === cost);
      if (group.length === 0) continue;
      c.add(
        this.add
          .text(0, y, `${cost} 费 · ${group.length} 员`, {
            fontFamily: FONT.title,
            fontSize: '15px',
            color: css(RARITY_COLOR[cost]),
            letterSpacing: 2,
          })
          .setOrigin(0, 0)
      );
      y += 30;
      group.forEach((d, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const px = col * cw + 12;
        const py = y + row * chh;
        const p = new UnitPortrait(this, px, py, cw - 26);
        p.setUnit({ defId: d.id, star: 1, items: [], iid: -1 });
        p.setInteractive(new Phaser.Geom.Rectangle(0, 0, cw - 26, cw - 26), Phaser.Geom.Rectangle.Contains);
        p.on('pointerover', (pointer: Phaser.Input.Pointer) => {
          this.showChampDetail(d.id, pointer.x, pointer.y);
          this.input.setDefaultCursor('pointer');
        });
        p.on('pointerout', () => {
          this.detailCard?.container.setVisible(false);
          this.input.setDefaultCursor('default');
        });
        c.add(p);
      });
      y += Math.ceil(group.length / cols) * chh + 18;
    }
    this.scrolls.champs = enableScroll(this, c, BODY_X, BODY_Y, BODY_W, BODY_H);
    this.scrolls.champs.setHeight(y);
  }

  private showChampDetail(defId: string, px: number, py: number): void {
    const def = CHAMPION_BY_ID[defId];
    if (!def) return;
    this.detailCard ??= new UnitDetailCard(this, 300);
    this.detailCard.update({ defId, star: 1, items: [], iid: -1 }, 300, 284);
    const x = Math.min(px + 24, W - 320);
    const y = Math.min(py + 16, H - 300);
    this.detailCard.container.setPosition(x, y);
  }

  // ══════════════ 羁绊册 ══════════════

  private buildTraits(): void {
    const c = this.add.container(BODY_X + 8, BODY_Y + 6);
    this.contents.traits = c;
    let y = 0;
    for (const t of TRAITS) {
      const row = this.add.container(0, y);
      const g = this.add.graphics();
      g.fillStyle(INK[800], 0.6);
      g.fillRect(0, 0, BODY_W - 16, 106);
      g.lineStyle(1, INK[500], 0.7);
      g.strokeRect(0, 0, BODY_W - 16, 106);
      row.add(g);
      // 小篆徽章（未激活态）：羁绊册的视觉锚点，与对局内羁绊轨同语汇
      const icon = this.add.image(34, 30, traitIconKey(t.id, 0));
      icon.setDisplaySize(44, 44);
      row.add(icon);
      row.add(
        this.add
          .text(66, 8, t.name, { fontFamily: FONT.title, fontSize: '18px', color: css(PAPER[100]) })
          .setOrigin(0, 0)
      );
      row.add(
        this.add
          .text(66, 26, t.description, {
            fontFamily: FONT.body,
            fontSize: '13px',
            color: css(PAPER[500]),
            wordWrap: { width: BODY_W - 180 },
          })
          .setOrigin(0, 0)
      );
      // 档位标记：几档亮几格（与对局内羁绊行同语汇）
      for (let i = 0; i < t.breakpoints.length; i++) {
        g.fillStyle(TRAIT_TIER_COLOR_HEX[Math.min(i, 3)], 0.85);
        g.fillRect(66 + i * 22, 44, 16, 5);
      }
      t.breakpoints.forEach((bp, i) => {
        row.add(
          this.add
            .text(66, 56 + i * 16, `${bp} 人：${t.effectText[i]}`, {
              fontFamily: FONT.body,
              fontSize: '12px',
              color: css(i === t.breakpoints.length - 1 ? TRAIT_TIER_COLOR_HEX[Math.min(i, 3)] : PAPER[300]),
            })
            .setOrigin(0, 0)
        );
      });
      row.add(
        this.add
          .text(BODY_W - 30, 12, `${t.breakpoints.join(' / ')}`, {
            fontFamily: FONT.num,
            fontSize: '13px',
            color: css(GILT.base),
          })
          .setOrigin(1, 0)
      );
      c.add(row);
      y += 118;
    }
    this.scrolls.traits = enableScroll(this, c, BODY_X, BODY_Y, BODY_W, BODY_H);
    this.scrolls.traits.setHeight(y);
  }

  // ══════════════ 装备册 ══════════════

  private buildItems(): void {
    const c = this.add.container(BODY_X, BODY_Y);
    this.contents.items = c;
    let y = 0;

    const section = (label: string, list: typeof ITEMS, chipSize: number, cols: number) => {
      c.add(
        this.add
          .text(0, y, label, { fontFamily: FONT.title, fontSize: '15px', color: css(GILT.light), letterSpacing: 2 })
          .setOrigin(0, 0)
      );
      y += 30;
      list.forEach((it, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const px = col * (chipSize + 96) + 4;
        const py = y + row * (chipSize + 34);
        const chip = new ItemChip(this, px, py, chipSize, () => undefined);
        chip.setItem(it.id);
        chip.on('pointerover', (pointer: Phaser.Input.Pointer) => {
          this.itemTip.show(it.id, pointer.x, pointer.y);
          this.input.setDefaultCursor('pointer');
        });
        chip.on('pointerout', () => {
          this.itemTip.hide();
          this.input.setDefaultCursor('default');
        });
        c.add(chip);
        c.add(
          this.add
            .text(px + chipSize + 10, py + chipSize / 2 - 8, it.name, {
              fontFamily: FONT.body,
              fontSize: '13px',
              color: css(it.tier === 'combined' ? GILT.light : PAPER[200]),
            })
            .setOrigin(0, 0)
        );
      });
      y += Math.ceil(list.length / cols) * (chipSize + 34) + 22;
    };

    const comps = ITEMS.filter((i) => i.tier === 'component');
    const comb = ITEMS.filter((i) => i.tier === 'combined');
    section('组 件', comps, 46, 4);
    section('成 品（神兵）', comb, 46, 4);

    // 合成表：A + B → C
    c.add(
      this.add
        .text(0, y, '合 成 谱', { fontFamily: FONT.title, fontSize: '15px', color: css(GILT.light), letterSpacing: 2 })
        .setOrigin(0, 0)
    );
    y += 28;
    for (const it of comb) {
      if (!it.recipe) continue;
      const [a, b] = it.recipe;
      const row = this.add.container(0, y);
      const draw = (id: string, x: number) => {
        if (this.textures.exists(itemIconKey(id))) {
          row.add(this.add.image(x, 10, itemIconKey(id)).setDisplaySize(22, 22).setOrigin(0, 0));
        }
        row.add(
          this.add
            .text(x + 28, 12, ITEM_BY_ID[id]?.name ?? id, {
              fontFamily: FONT.body,
              fontSize: '13px',
              color: css(PAPER[200]),
            })
            .setOrigin(0, 0)
        );
      };
      draw(a, 0);
      row.add(this.add.text(112, 12, '＋', { fontFamily: FONT.body, fontSize: '13px', color: css(INK[300]) }).setOrigin(0, 0));
      draw(b, 130);
      row.add(this.add.text(242, 12, '→', { fontFamily: FONT.body, fontSize: '13px', color: css(INK[300]) }).setOrigin(0, 0));
      draw(it.id, 262);
      row.setInteractive(new Phaser.Geom.Rectangle(0, 0, 380, 34), Phaser.Geom.Rectangle.Contains);
      row.on('pointerover', (pointer: Phaser.Input.Pointer) => this.itemTip.show(it.id, pointer.x, pointer.y));
      row.on('pointerout', () => this.itemTip.hide());
      c.add(row);
      y += 36;
    }

    this.scrolls.items = enableScroll(this, c, BODY_X, BODY_Y, BODY_W, BODY_H);
    this.scrolls.items.setHeight(y);
  }
}
