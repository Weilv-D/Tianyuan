import Phaser from 'phaser';
import { CHAMPIONS, CHAMPION_BY_ID } from '../../data/champions';
import { TRAITS } from '../../data/traits';
import { ITEMS, ITEM_BY_ID } from '../../data/items';
import { audio } from '../../audio/AudioEngine';
import { Button, enableScroll, FONT, makePanel, resetCursorOnShutdown, type ScrollHandle } from '../../ui/kit';
import { ItemTooltip } from '../../ui/tooltip';
import { ItemChip, UnitDetailCard, UnitPortrait } from '../../ui/cards';
import { GILT, INK, PAPER, RARITY_COLOR, TRAIT_TIER_COLOR_HEX, css } from '../view/palette';
import { itemIconKey, bakeItemIcons } from '../board/itemIcons';
import { traitIconKey, bakeTraitIcons } from '../board/traitIcons';
import { bakeSilhouettes } from '../board/silhouetteFactory';
import { buildTextures, grainOverlay } from '../view/textures';
import { baseZoom, screenToWorld } from '../view/viewScale';
import { H, W } from '../view/layout';
import { fadeIn, fadeTo } from '../view/transition';

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

/** 羁绊册行高与行距（buildTraits/展开带重排共用同一常量） */
const TRAIT_ROW_H = 106;
const TRAIT_PITCH = 118;

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
  /** 返回时原样带回的载荷（对局引用 + 备战剩余秒数），让 GameScene 续跑而非重置 */
  private backData: Record<string, unknown> = {};
  private itemTip!: ItemTooltip;
  private detailCard: UnitDetailCard | null = null;

  /** 羁绊册每行的展开态（点击行展开成员网格；同时只展开一行） */
  private traitState: {
    id: string;
    count: number;
    row: Phaser.GameObjects.Container;
    band: Phaser.GameObjects.Container | null;
    bandH: number;
    hint: Phaser.GameObjects.Text;
  }[] = [];
  private expandedTraitId: string | null = null;

  constructor() {
    super({ key: 'Codex' });
  }

  create(data: { from?: 'Menu' | 'Game'; match?: unknown }): void {
    baseZoom(this);
    fadeIn(this);
    resetCursorOnShutdown(this);
    // 从对局进入（nav「图鉴」）时返回对局（存档在 GameScene shutdown 时已落盘）；
    // 对局引用原样带回。备战无倒计时（手动开战），无需带回剩余秒数
    this.backTo = data.from === 'Game' ? 'Game' : 'Menu';
    this.backData = data.from === 'Game' ? { match: data.match } : {};
    buildTextures(this);
    grainOverlay(this);
    bakeSilhouettes(this);
    bakeItemIcons(this);
    bakeTraitIcons(this);
    this.itemTip = new ItemTooltip(this, 460);
    this.detailCard = null;
    this.contents = { champs: null, traits: null, items: null };
    this.scrolls = { champs: null, traits: null, items: null };
    // 每次进入 create 都会重建三柄 scroll：SHUTDOWN 时统一销毁，
    // 否则不入显示列表的遮罩 Graphics 逐次累积（C3）。
    // backData 一并释放：从对局进入时它持有 live Match 强引用，
    // 停用中的图鉴场景不应在整局期间别名持有对局
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const k of ['champs', 'traits', 'items'] as CodexTab[]) {
        this.scrolls[k]?.destroy();
        this.scrolls[k] = null;
      }
      this.backData = {};
    });

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

    new Button(this, W - 200, 26, '返 回', () => fadeTo(this, this.backTo, this.backData), {
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
    this.collapseTraitBand(false); // 离开羁绊册时收起展开带，返回时保持整洁
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
          const { x, y } = screenToWorld(pointer.x, pointer.y, this.cameras.main.zoom);
          this.showChampDetail(d.id, x, y);
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
    this.traitState = [];
    this.expandedTraitId = null;
    TRAITS.forEach((t, i) => {
      const row = this.add.container(0, i * TRAIT_PITCH);
      const g = this.add.graphics();
      g.fillStyle(INK[800], 0.6);
      g.fillRect(0, 0, BODY_W - 16, TRAIT_ROW_H);
      g.lineStyle(1, INK[500], 0.7);
      g.strokeRect(0, 0, BODY_W - 16, TRAIT_ROW_H);
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
            wordWrap: { useAdvancedWrap: true, width: BODY_W - 180 },
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
      // 展开入口提示：右下角「成员 N · 点击展开」—— 行本身就是整行点击热区
      const memberCount = CHAMPIONS.filter((d) => d.origins.includes(t.id) || d.classes.includes(t.id)).length;
      const hint = this.add
        .text(BODY_W - 30, 82, `成员 ${memberCount} · 点击展开`, {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[400]),
        })
        .setOrigin(1, 0);
      row.add(hint);
      // 悬停可点信号：整行淡金底 + 光标（与对局内计分板行侦查入口同语汇）
      const hoverBg = this.add.graphics();
      hoverBg.fillStyle(GILT.base, 0.06);
      hoverBg.fillRect(0, 0, BODY_W - 16, TRAIT_ROW_H);
      hoverBg.setVisible(false);
      row.addAt(hoverBg, 0);
      row.setInteractive(new Phaser.Geom.Rectangle(0, 0, BODY_W - 16, TRAIT_ROW_H), Phaser.Geom.Rectangle.Contains);
      row.on('pointerover', () => {
        hoverBg.setVisible(true);
        this.input.setDefaultCursor('pointer');
      });
      row.on('pointerout', () => {
        hoverBg.setVisible(false);
        this.input.setDefaultCursor('default');
      });
      row.on('pointerup', () => this.toggleTraitBand(t.id));
      c.add(row);
      this.traitState.push({ id: t.id, count: memberCount, row, band: null, bandH: 0, hint });
    });
    this.scrolls.traits = enableScroll(this, c, BODY_X, BODY_Y, BODY_W, BODY_H);
    this.scrolls.traits.setHeight(TRAITS.length * TRAIT_PITCH - 12);
  }

  /** 点羁绊行展开/收起成员网格（同一时间只展开一行） */
  private toggleTraitBand(id: string): void {
    if (this.expandedTraitId === id) {
      this.collapseTraitBand();
      return;
    }
    if (this.expandedTraitId) this.collapseTraitBand(false);
    const state = this.traitState.find((s) => s.id === id);
    const def = TRAITS.find((t) => t.id === id);
    if (!state || !def || !this.contents.traits) return;
    const c = this.contents.traits;
    const idx = this.traitState.indexOf(state);
    const members = CHAMPIONS.filter((d) => d.origins.includes(id) || d.classes.includes(id)).sort(
      (a, b) => a.cost - b.cost || a.id.localeCompare(b.id)
    );
    // 网格：立绘 66 见方、格距 78，横向排满整行宽；职业族（最多 24 人）约两行
    const pitch = 78;
    const cols = Math.max(1, Math.floor((BODY_W - 16 - 20) / pitch));
    const gridRows = Math.max(1, Math.ceil(members.length / cols));
    const titleH = 26;
    const bandH = titleH + gridRows * pitch + 6;

    const band = this.add.container(8, (idx + 1) * TRAIT_PITCH);
    const bg = this.add.graphics();
    bg.fillStyle(INK[850], 0.72);
    bg.fillRect(0, 0, BODY_W - 32, bandH);
    bg.lineStyle(1, GILT.base, 0.22);
    bg.strokeRect(0, 0, BODY_W - 32, bandH);
    band.add(bg);
    band.add(
      this.add
        .text(10, 4, `成 员 · ${def.name}（${members.length}）`, {
          fontFamily: FONT.title,
          fontSize: '14px',
          color: css(PAPER[300]),
          letterSpacing: 2,
        })
        .setOrigin(0, 0)
    );
    members.forEach((d, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const p = new UnitPortrait(this, 10 + col * pitch, titleH + row * pitch, 66);
      p.setUnit({ defId: d.id, star: 1, items: [], iid: -1 });
      // 成员悬停沿用棋子册详情卡；点击卡内空白不触发行收起（band 是行的兄弟节点）
      p.setInteractive(new Phaser.Geom.Rectangle(0, 0, 66, 66), Phaser.Geom.Rectangle.Contains);
      p.on('pointerover', (pointer: Phaser.Input.Pointer) => {
        const { x, y } = screenToWorld(pointer.x, pointer.y, this.cameras.main.zoom);
        this.showChampDetail(d.id, x, y);
        this.input.setDefaultCursor('pointer');
      });
      p.on('pointerout', () => {
        this.detailCard?.container.setVisible(false);
        this.input.setDefaultCursor('default');
      });
      band.add(p);
    });
    c.add(band);
    state.band = band;
    state.bandH = bandH;
    this.expandedTraitId = id;
    state.hint.setText('收起成员 ▴');
    state.hint.setColor(css(GILT.light));
    this.reflowTraits(idx, bandH);
    audio.play('ui');
  }

  /** 收起当前展开行（切 tab 静默收起；点自身行/点另一行带音效由调用方决定） */
  private collapseTraitBand(playSound = true): void {
    const id = this.expandedTraitId;
    const state = id ? this.traitState.find((s) => s.id === id) : undefined;
    if (!id || !state) return;
    const idx = this.traitState.indexOf(state);
    state.band?.destroy();
    state.band = null;
    state.bandH = 0;
    state.hint.setText(`成员 ${state.count} · 点击展开`);
    state.hint.setColor(css(PAPER[400]));
    this.expandedTraitId = null;
    this.reflowTraits(idx, 0);
    if (playSound) audio.play('ui');
  }

  /** 展开/收起后重排行位置并刷新整册滚动高度：展开行之后的每行让出 bandH */
  private reflowTraits(bandIdx: number, bandH: number): void {
    if (!this.contents.traits) return;
    this.traitState.forEach((s, i) => {
      const dy = bandH > 0 && i > bandIdx ? bandH : 0;
      s.row.y = i * TRAIT_PITCH + dy;
    });
    const totalH = this.traitState.length * TRAIT_PITCH - 12 + bandH;
    this.scrolls.traits?.setHeight(totalH);
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
        // 格距随图标放大收紧（旧 96 是给 46 图标的疏排）
        const px = col * (chipSize + 64) + 4;
        const py = y + row * (chipSize + 34);
        const chip = new ItemChip(this, px, py, chipSize, () => undefined);
        chip.setItem(it.id);
        chip.on('pointerover', (pointer: Phaser.Input.Pointer) => {
          const { x, y } = screenToWorld(pointer.x, pointer.y, this.cameras.main.zoom);
          this.itemTip.show(it.id, x, y);
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
    // v1.9 全配方 36 件成品：格距按 4 列收排（格距 96 → 72），图 46→56 放大
    section('组 件', comps, 56, 4);
    section('成 品（神兵）', comb, 56, 4);

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
          row.add(this.add.image(x, 8, itemIconKey(id)).setDisplaySize(30, 30).setOrigin(0, 0));
        }
        row.add(
          this.add
            .text(x + 36, 12, ITEM_BY_ID[id]?.name ?? id, {
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
      row.on('pointerover', (pointer: Phaser.Input.Pointer) => {
        const { x, y } = screenToWorld(pointer.x, pointer.y, this.cameras.main.zoom);
        this.itemTip.show(it.id, x, y);
      });
      row.on('pointerout', () => this.itemTip.hide());
      c.add(row);
      y += 36;
    }

    this.scrolls.items = enableScroll(this, c, BODY_X, BODY_Y, BODY_W, BODY_H);
    this.scrolls.items.setHeight(y);
  }
}
