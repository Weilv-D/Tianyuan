/** 职责：对局场景静态 HUD 的构建——顶栏导航/阶段条/商肆/器匣/操作列/朱印/羁绊轨/敌情/记事/战报，只建不改。 */
import Phaser from 'phaser';
import { REROLL_COST } from '../../core/config';
import { Bar, Button, FONT, enableScroll, makePanel } from '../../ui/kit';
import { ItemChip, ShopCard, TraitRow } from '../../ui/cards';
import { bakedImage, bakedTexture } from '../view/bake';
import { INK, GILT, CINNABAR, SPIRIT, PAPER, VOID, SHADE, TRAIT_TIER_COLOR_HEX, css } from '../view/palette';
import {
  ACT_BTN_H,
  ACT_BTN_W,
  ACT_X,
  ACT_Y,
  BENCH_W,
  BENCH_X,
  BENCH_Y,
  HEADER_H,
  ITEM_BAR_SLOTS,
  ITEM_BAR_W,
  ITEM_BAR_X,
  ITEM_BAR_Y,
  ITEM_COLS,
  ITEM_GAP,
  ITEM_ROWS,
  ITEM_SIZE,
  LOG_W,
  LOG_X,
  LOG_Y,
  NAV_GAP,
  NAV_X,
  PANEL_TITLE_H,
  PHASE_Y,
  REPORT_X,
  REPORT_Y,
  RAIL_X,
  RAIL_Y,
  SELL_SIZE,
  SELL_X,
  SELL_Y,
  SHOP_CH,
  SHOP_CW,
  SHOP_FOOT_Y,
  SHOP_GAP,
  SHOP_W,
  SHOP_X,
  SHOP_Y,
  UNLOAD_BTN_DY,
  H,
  W,
} from '../view/layout';
import { screenToWorld } from '../view/viewScale';
import { TRAIT_BY_ID } from '../../data/traits';
import { RAIL_VIEW, RAIL_VIEW_W } from '../view/hudLayout';
import type { GameScene } from '../scenes/GameScene';

/**
 * 夜宴 HUD。左轨羁绊、右栏敌情/八方/战报、中央大漆盘 + 盘下阶段条 + 底部牌铺。
 * 创建顺序由场景 create() 保持；产出的控件挂在本模块上，场景经 scene.hud.* 读取。
 */
export class HudPanels {
  // 顶栏
  roundText!: Phaser.GameObjects.Text;
  phaseText!: Phaser.GameObjects.Text;
  // 旧 timerText/timerBar（恒满假计时条）已移除：备战无倒计时，假仪表只生误导
  streakText!: Phaser.GameObjects.Text;
  streakLabel!: Phaser.GameObjects.Text;

  // 状态数值（顶栏 stats）
  goldText!: Phaser.GameObjects.Text;
  hpBar!: Bar;
  hpText!: Phaser.GameObjects.Text;
  levelText!: Phaser.GameObjects.Text;
  xpText!: Phaser.GameObjects.Text;
  xpBar!: Bar;
  boardCountText!: Phaser.GameObjects.Text;

  // 操作列 / 出售
  rerollBtn!: Button;
  levelBtn!: Button;
  undoBtn!: Button;
  /** 撤销可用金点（呼吸高亮，SceneRefresh 驱动） */
  undoDot!: Phaser.GameObjects.Graphics;
  private undoDotActive = false;
  lockBtn!: Button;
  sellRect!: Phaser.Geom.Rectangle;

  // 商店 / 器匣
  shopCards: ShopCard[] = [];
  private unloadBtn: Button | null = null;
  itemChips: ItemChip[] = [];
  itemHint!: Phaser.GameObjects.Text;
  /** 器匣溢出分页控件（仅溢出时可见，停在与「卸载」同带的中段空闲区） */
  private pagePrev: Button | null = null;
  private pageNext: Button | null = null;
  private pageText: Phaser.GameObjects.Text | null = null;

  // 侧栏
  traitContainer!: Phaser.GameObjects.Container;
  traitScroll: ReturnType<typeof enableScroll> | null = null;
  railFade: Phaser.GameObjects.Image | null = null;
  scoreContainer!: Phaser.GameObjects.Container;
  opponentText!: Phaser.GameObjects.Text;
  intelContainer!: Phaser.GameObjects.Container;
  logText!: Phaser.GameObjects.Text;
  reportText!: Phaser.GameObjects.Text;

  /** 羁绊全览浮层（nav「羁绊」开合） */
  private traitModal: Phaser.GameObjects.Container | null = null;
  private traitModalScroll: ReturnType<typeof enableScroll> | null = null;

  constructor(private scene: GameScene) {
    // 切场景时（如开着羁绊全览直接开战）：容器随场景销毁，但 scroll 的
    // 遮罩 Graphics 由 make.graphics(addToScene=false) 创建、不在显示列表，
    // 场景关闭不会回收 —— SHUTDOWN 统一销毁，否则每次重开泄漏一枚
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.traitScroll?.destroy();
      this.traitScroll = null;
      this.traitModalScroll?.destroy();
      this.traitModalScroll = null;
      this.traitModal = null;
    });
  }

  // ══════════════ 背景 ══════════════

  buildBackground(): void {
    // 夜色山海由 index.html 的 #bg 承担（透明画布），此处不再铺底
  }

  // ══════════════ 顶栏（样稿 header：导航 · 品牌 · 数值） ══════════════

  buildTopBar(): void {
    // header 底缘发丝线：墨线通栏 + 中央一段金线
    const hair = this.scene.add.graphics();
    hair.lineStyle(1, INK[600], 0.9);
    hair.lineBetween(48, HEADER_H, W - 48, HEADER_H);
    hair.lineStyle(1, GILT.base, 0.22);
    hair.lineBetween(W / 2 - 200, HEADER_H, W / 2 + 200, HEADER_H);

    // ── 左导航：楷/mono 双行 + 下划线 hover（样稿 .nl） ──
    const nav: [string, string, () => void][] = [
      ['图 鉴', 'Codex', () => this.scene.scene.start('Codex', { from: 'Game', match: this.scene.match })],
      ['羁 绊', 'Bonds', () => this.openTraitModal()],
      ['阵 容', 'Legion', () => this.scoutNextOpponent()],
    ];
    nav.forEach(([cn, en, onClick], i) => {
      const x = NAV_X + i * NAV_GAP;
      const c = this.scene.add.container(x, 26);
      const cnT = this.scene.add
        .text(0, 0, cn, { fontFamily: FONT.title, fontSize: '14px', color: css(PAPER[100]), letterSpacing: 4 })
        .setOrigin(0, 0);
      const enT = this.scene.add
        .text(0, 24, en, {
          fontFamily: FONT.mono,
          fontSize: '10px',
          color: css(INK[300]),
          letterSpacing: 3,
        })
        .setOrigin(0, 0)
        .setAlpha(0.85);
      // 悬停下划线：scaleX 展开而非重画（样稿 .nl::after）
      const underline = this.scene.add.graphics();
      underline.lineStyle(1, GILT.light, 0.95);
      underline.beginPath();
      underline.moveTo(0, 44);
      underline.lineTo(200, 44);
      underline.strokePath();
      underline.setScale(0.36, 1); // 200×0.36 = 72px 覆盖字宽
      underline.setAlpha(0);
      c.add([cnT, enT, underline]);
      c.setInteractive(new Phaser.Geom.Rectangle(0, -6, 88, 56), Phaser.Geom.Rectangle.Contains);
      c.on('pointerover', () => {
        enT.setColor(css(GILT.light));
        this.scene.tweens.add({ targets: underline, alpha: 1, scaleX: 0.36, duration: 260, ease: 'Quad.easeOut' });
        this.scene.input.setDefaultCursor('pointer');
      });
      c.on('pointerout', () => {
        enT.setColor(css(INK[300]));
        this.scene.tweens.add({ targets: underline, alpha: 0, duration: 200 });
        this.scene.input.setDefaultCursor('default');
      });
      c.on('pointerdown', () => this.scene.tweens.add({ targets: c, scale: 0.96, duration: 70, yoyo: true }));
      c.on('pointerup', () => {
        // 拖拽中第二指点 nav（切场景/开浮层）：拖拽会带着残影进新场景或遮罩背后，先让路
        if (this.scene.inputCtl.dragging) return;
        onClick();
      });
    });

    // ── 中央品牌：楷体 + 引线 + 英文微注（样稿 .brand） ──
    this.scene.add
      .text(W / 2, 22, '百 战 天 元', {
        fontFamily: FONT.kai,
        fontSize: '21px',
        color: css(PAPER[100]),
        letterSpacing: 10,
      })
      .setOrigin(0.5, 0);
    this.scene.add
      .text(W / 2, 54, 'NIGHT FEAST', {
        fontFamily: FONT.mono,
        fontSize: '9px',
        color: css(INK[300]),
        letterSpacing: 8,
      })
      .setOrigin(0.5, 0)
      .setAlpha(0.9);
    const brandLine = this.scene.add.graphics();
    brandLine.lineStyle(1, GILT.base, 0.3);
    brandLine.lineBetween(W / 2 - 104, 38, W / 2 - 70, 38);
    brandLine.lineBetween(W / 2 + 70, 38, W / 2 + 104, 38);

    // ── 右侧数值（样稿 .stats：mono 值 + 小注）：回合 / 来金 / 生命 / 等级 ──
    const stat = (rightX: number, labelText: string): Phaser.GameObjects.Text => {
      // 有动态小注的数值（来金）传空串，避免静态小注与动态小注同位重叠
      if (labelText) {
        this.scene.add
          .text(rightX - 24, 56, labelText, {
            fontFamily: FONT.body,
            fontSize: '10px',
            color: css(INK[300]),
            letterSpacing: 4,
          })
          .setOrigin(0.5, 0);
      }
      return this.scene.add.text(rightX, 22, '', { fontFamily: FONT.mono, fontSize: '17px', color: css(PAPER[100]) }).setOrigin(1, 0);
    };
    this.roundText = stat(W - 580, '回 合');
    this.goldText = stat(W - 470, '金');
    this.goldText.setColor(css(GILT.light));
    this.streakText = stat(W - 360, '');
    this.streakText.setColor(css(GILT.base));
    this.streakLabel = this.scene.add
      .text(W - 360 - 24, 56, '来 金', {
        fontFamily: FONT.body,
        fontSize: '10px',
        color: css(INK[300]),
        letterSpacing: 4,
      })
      .setOrigin(0.5, 0);
    this.hpText = stat(W - 250, '生 命');
    this.hpText.setColor(css(SPIRIT.base));
    this.levelText = stat(W - 140, '等 级');

    this.hpBar = new Bar(this.scene, W - 250 - 56, 80, 56, 3, SPIRIT.base);
    this.xpBar = new Bar(this.scene, W - 140 - 56, 80, 56, 3, VOID.base);
    this.xpText = this.scene.add
      .text(W - 140 - 64, 80, '', { fontFamily: FONT.mono, fontSize: '10px', color: css(INK[300]) })
      .setOrigin(1, 0.5);

    // 设置入口
    new Button(this.scene, W - 88, 26, '⚙', () => this.scene.openSettings(), { width: 40, height: 34 });
  }

  // ══════════════ 阶段条（盘下：— 备 战 — 开战 · 空格 00:30 —） ══════════════

  buildPhaseStrip(): void {
    const cx = W / 2;
    const line = this.scene.add.graphics();
    line.lineStyle(1, GILT.base, 0.25);
    // 左线右端收到 650：签条「备 战 席」左缘 666，此前 710 的末端正压签条上方，
    // 视觉上与签条撞成一团（右线无此问题，场上文无底框）
    line.lineBetween(cx - 380, PHASE_Y, cx - 310, PHASE_Y);
    line.lineBetween(cx + 290, PHASE_Y, cx + 420, PHASE_Y);

    this.phaseText = this.scene.add
      .text(cx - 150, PHASE_Y, '', {
        fontFamily: FONT.title,
        fontSize: '15px',
        color: css(PAPER[100]),
        letterSpacing: 7,
      })
      .setOrigin(0.5);

    new Button(this.scene, cx + 20, PHASE_Y - 12, '开 战 · 空格', () => this.scene.startBattlePhase(), {
      width: 140,
      height: 32,
      variant: 'primary',
      fontSize: 12,
    });
    // 备战无倒计时（玩家公测后裁决 —— 手动开战）。旧「准备就绪」文案 + 恒满计时条
    // 读作"正在计时"，是永不走针的假仪表，已移除；阶段语义由 phaseText 与开战按钮承担。
  }

  // ══════════════ 商肆（样稿 .scard 窄卡 × 5） ══════════════

  buildShop(): void {
    // 注脚放卡下一行：卡上方紧贴备战席框底，旧「卡上标题」压进框底带是备战区视觉混乱的一处根因
    // 行顶坐标走 SHOP_FOOT_Y（layout 单一真源）：13px@1.12 行高 ~19px，底缘收在 1080 之内。
    // 右注脚是常驻键位参考（非教程）：直购/撤销不在任何按钮文案上，设置页脚是全游戏唯一出处 —— 这里补上发现通道
    this.scene.add
      .text(SHOP_X, SHOP_FOOT_Y, '商 肆', {
        fontFamily: FONT.title,
        fontSize: '13px',
        color: css(PAPER[300]),
        letterSpacing: 4,
      })
      .setOrigin(0, 0);
    this.scene.add
      .text(SHOP_X + SHOP_W, SHOP_FOOT_Y, `刷新 ${REROLL_COST} 金 · 直购 1-5 · 撤销 Ctrl+Z`, {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(PAPER[400]),
      })
      .setOrigin(1, 0);

    for (let i = 0; i < 5; i++) {
      const card = new ShopCard(
        this.scene,
        SHOP_X + i * (SHOP_CW + SHOP_GAP),
        SHOP_Y,
        SHOP_CW,
        SHOP_CH,
        () => this.scene.onBuy(i)
      );
      card.setHotkey(i + 1);
      this.shopCards.push(card);
    }
  }

  // ══════════════ 器匣（2×5 网格） ══════════════

  buildItemBar(): void {
    const gw = ITEM_BAR_W;
    const gh = ITEM_ROWS * (ITEM_SIZE + ITEM_GAP) - ITEM_GAP;
    bakedImage(this.scene, ITEM_BAR_X - 10, ITEM_BAR_Y - 24, 'itemFrame_v3', gw + 20, gh + 34, (g) => {
      g.translateCanvas(-(ITEM_BAR_X - 10), -(ITEM_BAR_Y - 24));
      g.fillStyle(INK[900], 0.66);
      g.fillRect(ITEM_BAR_X - 8, ITEM_BAR_Y - 8, gw + 16, gh + 16);
      g.lineStyle(1, INK[500], 0.6);
      g.strokeRect(ITEM_BAR_X - 8, ITEM_BAR_Y - 8, gw + 16, gh + 16);
      // 界格签
      g.fillStyle(INK[900], 0.95);
      g.fillRect(ITEM_BAR_X - 8, ITEM_BAR_Y - 22, 70, 18);
      g.lineStyle(1, INK[500], 0.55);
      g.strokeRect(ITEM_BAR_X - 8, ITEM_BAR_Y - 22, 70, 18);
    });
    this.scene.add
      .text(ITEM_BAR_X + 27, ITEM_BAR_Y - 13, '器 匣', {
        fontFamily: FONT.title,
        fontSize: '13px',
        color: css(PAPER[300]),
        letterSpacing: 3,
      })
      .setOrigin(0.5);

    for (let i = 0; i < ITEM_BAR_SLOTS; i++) {
      const col = i % ITEM_COLS;
      const row = Math.floor(i / ITEM_COLS);
      const chip = new ItemChip(
        this.scene,
        ITEM_BAR_X + col * (ITEM_SIZE + ITEM_GAP),
        ITEM_BAR_Y + row * (ITEM_SIZE + ITEM_GAP),
        ITEM_SIZE,
        () => this.scene.onItemChipClick(i)
      );
      this.itemChips.push(chip);
    }

    // 卸载器（开局可用）：点选 → 点棋子 → 全身装备回器匣。
    // 挂器匣框顶上方的独立行（UNLOAD_BTN_DY），不叠框线——
    // 旧位 y-26 压在框顶线上，且按钮命中区（kit 外扩 5px）侵入首行格 5px。
    this.unloadBtn = new Button(
      this.scene,
      ITEM_BAR_X + ITEM_BAR_W - 84,
      ITEM_BAR_Y + UNLOAD_BTN_DY,
      '卸 载',
      () => this.scene.onToggleUnload(),
      { width: 84, height: 26 },
    );
    this.unloadBtn.setDepth(5);

    // 器匣溢出分页：系统回收按守恒口径允许器匣超过 10 格，超格资产此前
    // "一键装备摸得到、玩家摸不到"。控件停在与卸载钮同带的中段空闲区
    // （「器匣」签右缘与卸载钮左缘之间，命中区互不相触、不压框线）；
    // 仅在 items 超过一页时出现（setPageControls 驱动），初始隐藏。
    this.pagePrev = new Button(
      this.scene,
      ITEM_BAR_X + 80,
      ITEM_BAR_Y + UNLOAD_BTN_DY,
      '◀',
      () => this.scene.onItemPage(-1),
      { width: 26, height: 26, fontSize: 11 },
    );
    this.pagePrev.setVisible(false).setDepth(5);
    this.pageNext = new Button(
      this.scene,
      ITEM_BAR_X + 160,
      ITEM_BAR_Y + UNLOAD_BTN_DY,
      '▶',
      () => this.scene.onItemPage(1),
      { width: 26, height: 26, fontSize: 11 },
    );
    this.pageNext.setVisible(false).setDepth(5);
    this.pageText = this.scene.add
      .text(ITEM_BAR_X + 133, ITEM_BAR_Y + UNLOAD_BTN_DY + 13, '', {
        fontFamily: FONT.mono,
        fontSize: '11px',
        color: css(PAPER[400]),
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.itemHint = this.scene.add
      .text(ITEM_BAR_X - 8, ITEM_BAR_Y + gh + 22, '', {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(PAPER[400]),
        wordWrap: { useAdvancedWrap: true, width: gw + 16 },
        lineSpacing: 3,
      })
      .setOrigin(0, 0);
  }

  // ══════════════ 操作列（2×3） ══════════════

  buildActionBar(): void {
    const gx = ACT_X;
    const gy = ACT_Y;
    const step = ACT_BTN_W + 10;
    const rowStep = ACT_BTN_H + 10;
    this.rerollBtn = new Button(this.scene, gx, gy, `刷新 · D`, () => this.scene.onReroll(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
    });
    this.levelBtn = new Button(this.scene, gx + step, gy, `升级 · F`, () => this.scene.onBuyXp(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
      variant: 'primary',
    });
    new Button(this.scene, gx, gy + rowStep, '布阵 · E', () => this.scene.onAutoArrange(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
    });
    this.undoBtn = new Button(this.scene, gx + step, gy + rowStep, '撤销 · Z', () => this.scene.onUndo(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
    });
    // 撤销可用金点：有可撤销操作时点亮并呼吸（SceneRefresh 按 undoStack 长度驱动）
    this.undoDot = this.scene.add.graphics().setDepth(8);
    this.undoDotActive = false;
    new Button(this.scene, gx, gy + rowStep * 2, '一键装备', () => this.scene.onAutoEquip(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
    });
    this.lockBtn = new Button(this.scene, gx + step, gy + rowStep * 2, '锁定商店', () => this.scene.onToggleLock(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
    });
  }

  // ══════════════ 出售朱印（拖入出售） ══════════════

  buildSell(): void {
    bakedImage(this.scene, SELL_X, SELL_Y, 'sellSeal_v3', SELL_SIZE, SELL_SIZE, (g) => {
      g.fillStyle(CINNABAR.deep, 0.96);
      g.fillRect(0, 0, SELL_SIZE, SELL_SIZE);
      g.lineStyle(1.5, CINNABAR.light, 0.8);
      g.strokeRect(4, 4, SELL_SIZE - 8, SELL_SIZE - 8);
    });
    this.scene.add
      .text(SELL_X + SELL_SIZE / 2, SELL_Y + SELL_SIZE / 2, '出售', {
        fontFamily: FONT.kai,
        fontSize: '15px',
        color: css(PAPER[50]),
        letterSpacing: 5,
      })
      .setOrigin(0.5);
    // 朱印自带「出售」二字，操作自明 —— 不再加说明行（曾与操作列首行按钮叠压）
    this.sellRect = new Phaser.Geom.Rectangle(SELL_X, SELL_Y, SELL_SIZE, SELL_SIZE);
  }

  // ══════════════ 羁绊轨（左） ══════════════

  buildTraitRail(): void {
    // 竖排帽「羁 绊」：底缘（102+20+15=137）与首圆上缘（RAIL_Y−16=142）净距 5px
    ['羁', '绊'].forEach((ch, i) => {
      this.scene.add
        .text(RAIL_X, 102 + i * 20, ch, {
          fontFamily: FONT.kai,
          fontSize: '13px',
          color: css(PAPER[400]),
        })
        .setOrigin(0.5, 0);
    });
    this.traitContainer = this.scene.add.container(RAIL_X, RAIL_Y);
    // 视口一窗收全「徽章 40 + 右侧计数」；旧宽 48 只罩圆环，计数被遮罩裁成半截。
    // 几何真源 = RAIL_VIEW（hudLayout），SceneRefresh 的输入门消费同一组数
    this.traitScroll = enableScroll(
      this.scene,
      this.traitContainer,
      RAIL_VIEW.x,
      RAIL_VIEW.y,
      RAIL_VIEW.w,
      RAIL_VIEW.h,
      // 滚动即收悬停笺：笺按 pointerover 瞬间的行世界位贴附，滚动后与徽章脱钩
      () => this.scene.refresher.closeRailPopup(),
    );
    // 轨尾渐隐缘：内容超出视口时显示 —— "下面还有、滚轮可看"的常驻信号。
    // 17 族最坏情形溢出 88px，此前没有任何可滚提示，超出的族静默不可见。
    const FADE_H = 24;
    bakedTexture(this.scene, `railfade_v1_${RAIL_VIEW_W}x${FADE_H}`, RAIL_VIEW_W, FADE_H, (g) => {
      // 逐行扫描线：INK900 自下而上渐隐入夜 —— 与页面夜色底同色相，读作"沉入暗处"
      for (let row = 0; row < FADE_H; row++) {
        const t = row / (FADE_H - 1); // 0 顶（透明）→ 1 底（不透明）
        g.fillStyle(INK[900], 0.92 * t);
        g.fillRect(0, row, RAIL_VIEW_W, 1);
      }
    });
    this.railFade = this.scene.add
      .image(RAIL_VIEW.x, RAIL_VIEW.y + RAIL_VIEW.h - FADE_H, `railfade_v1_${RAIL_VIEW_W}x${FADE_H}`)
      .setOrigin(0, 0)
      .setDepth(3)
      .setVisible(false);
  }

  /** 轨尾渐隐缘开关（SceneRefresh.refreshTraits 按内容高度驱动） */
  setRailOverflow(overflow: boolean): void {
    this.railFade?.setVisible(overflow);
  }

  // ══════════════ 敌情（右上） ══════════════

  buildIntel(): void {
    this.scene.add
      .text(REPORT_X + 0, 140, '敌 情', {
        fontFamily: FONT.body,
        fontSize: '11px',
        color: css(INK[300]),
        letterSpacing: 4,
      })
      .setOrigin(0, 0);
    this.opponentText = this.scene.add
      .text(REPORT_X, 160, '', { fontFamily: FONT.title, fontSize: '14px', color: css(PAPER[100]), letterSpacing: 2 })
      .setOrigin(0, 0);
    this.intelContainer = this.scene.add.container(REPORT_X, 188);
  }

  // ══════════════ 八方诸侯（右中，紧凑行） ══════════════

  buildScoreboard(): void {
    this.scene.add
      .text(REPORT_X, 316, '八 方 诸 侯', {
        fontFamily: FONT.body,
        fontSize: '11px',
        color: css(INK[300]),
        letterSpacing: 4,
      })
      .setOrigin(0, 0);
    this.scoreContainer = this.scene.add.container(REPORT_X, 338);
  }

  // ══════════════ 记事（左下）/ 战报（右下） ══════════════

  buildLogPanel(): void {
    const hair = this.scene.add.graphics();
    hair.lineStyle(1, INK[500], 0.7);
    hair.lineBetween(LOG_X, LOG_Y, LOG_X + LOG_W, LOG_Y);
    this.scene.add
      .text(LOG_X, LOG_Y + 12, '对 局 记 事', {
        fontFamily: FONT.body,
        fontSize: '11px',
        color: css(INK[300]),
        letterSpacing: 4,
      })
      .setOrigin(0, 0);
    this.logText = this.scene.add
      .text(LOG_X, LOG_Y + 34, '', {
        fontFamily: FONT.body,
        fontSize: '13px',
        color: css(PAPER[300]),
        wordWrap: { useAdvancedWrap: true, width: LOG_W },
        lineSpacing: 4,
      })
      .setOrigin(0, 0);
  }

  buildReportPanel(): void {
    const hair = this.scene.add.graphics();
    hair.lineStyle(1, INK[500], 0.7);
    hair.lineBetween(REPORT_X, REPORT_Y, REPORT_X + 282, REPORT_Y);
    this.scene.add
      .text(REPORT_X, REPORT_Y + 12, '上 回 合 战 报', {
        fontFamily: FONT.body,
        fontSize: '11px',
        color: css(INK[300]),
        letterSpacing: 4,
      })
      .setOrigin(0, 0);
    this.reportText = this.scene.add
      .text(REPORT_X, REPORT_Y + 34, '', {
        fontFamily: FONT.body,
        fontSize: '13px',
        color: css(PAPER[300]),
        wordWrap: { useAdvancedWrap: true, width: 282 },
        lineSpacing: 5,
      })
      .setOrigin(0, 0);
  }

  // ══════════════ 场上计数（备战席签条同带右端） ══════════════

  buildBoardCount(): void {
    // 与「备 战 席」签同带两端分布：旧位（棋盘右缘下、y=BENCH_Y+32）撞进
    // 卸载按钮行——器匣上方那条窄带只够放一个东西。
    this.boardCountText = this.scene.add
      .text(BENCH_X + BENCH_W - 6, BENCH_Y - 13, '', {
        fontFamily: FONT.mono,
        fontSize: '12px',
        color: css(PAPER[400]),
      })
      .setOrigin(1, 0.5);
  }

  /** 卸载器按钮态（GameScene.onToggleUnload 驱动） */
  setUnloadMode(on: boolean): void {
    if (!this.unloadBtn) return;
    this.unloadBtn.setText(on ? '卸载中…' : '卸 载');
    this.unloadBtn.setAlpha(on ? 1 : 0.85);
  }

  /**
   * 器匣溢出分页控件态（SceneRefresh.refreshItems 按器匣总数驱动）。
   * page=null 表示无溢出：整套控件隐藏；溢出时按钮按页边界禁用。
   */
  setPageControls(page: number | null, pages: number): void {
    const prev = this.pagePrev;
    const next = this.pageNext;
    const label = this.pageText;
    const show = page !== null && pages > 1;
    prev?.setVisible(show);
    next?.setVisible(show);
    label?.setVisible(show);
    if (!show || page === null || !prev || !next || !label) return;
    prev.setDisabled(page <= 0);
    next.setDisabled(page >= pages - 1);
    label.setText(`${page + 1}/${pages}`);
  }

  /** 撤销可用金点：栈非空点亮呼吸，空栈熄灭 */
  setUndoAvailable(has: boolean): void {
    if (!this.undoDot || !this.undoBtn || this.undoDotActive === has) return;
    this.undoDotActive = has;
    this.scene.tweens.killTweensOf(this.undoDot);
    // 锚定撤销钮自身（操作列第二行第二枚）：此前 cy 漏加行距，金点画在了
    // 第一行升级钮的左上角 —— 玩家会误读成"可升级"的呼吸提示
    const cx = this.undoBtn.x + 6;
    const cy = this.undoBtn.y + 5;
    if (!has) {
      this.undoDot.clear();
      return;
    }
    this.undoDot.clear();
    this.undoDot.fillStyle(GILT.light, 1);
    this.undoDot.fillCircle(cx, cy, 3);
    this.scene.tweens.add({ targets: this.undoDot, alpha: { from: 0.45, to: 1 }, duration: 1400, yoyo: true, repeat: -1 });
  }

  // ══════════════ 羁绊全览浮层（nav「羁绊」） ══════════════

  openTraitModal(): void {
    if (this.traitModal) {
      this.closeTraitModal();
      return;
    }
    // 成员卡与全览同为羁绊信息浮层，不同时开（全览是遮罩模态，盖在成员卡上会叠）
    this.scene.traitMembers.close();
    const shade = this.scene.add.rectangle(0, 0, W, H, SHADE, 0.55).setOrigin(0).setDepth(560).setInteractive();
    const panelW = 640;
    const panelH = 720;
    const px = (W - panelW) / 2;
    const py = (H - panelH) / 2;
    const modal = makePanel(this.scene, px, py, panelW, panelH, { title: '羁 绊 全 览', accent: SPIRIT.base, alpha: 0.98 });
    modal.setDepth(561);
    // 遮罩点击关闭（点浮层本体不关）：shade 一直 setInteractive 却无响应，
    // 玩家本能的点空白处关闭从未生效。坐标换算走 screenToWorld —— 与
    // hitTest/enableScroll 同一真源，勿再手写 px/zoom。
    shade.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const { x: wx, y: wy } = screenToWorld(p.x, p.y, this.scene.cameras.main.zoom);
      if (wx < px || wx > px + panelW || wy < py || wy > py + panelH) this.openTraitModal();
    });

    const bodyX = px + 20;
    const bodyY = py + PANEL_TITLE_H + 8;
    const content = this.scene.add.container(bodyX, bodyY).setDepth(562);
    const traits = this.scene.match.traitsOf(this.scene.match.human.board);
    const countOf = new Map(traits.map((t) => [t.id, t] as const));
    // 计数口径注记：玩家对「差一张凑档」的疑问集中在口径上（备战席算不算、
    // 同名算几张）。档位全部可达（17 羁绊最高档 ≤ 各自 unique 棋子数）。
    const note = this.scene.add
      .text(0, 0, '计数只算场上棋子（备战席不计）；同名棋子只计一次。每档人数见各行「n/下一档」。', {
        fontFamily: FONT.body,
        fontSize: '11px',
        color: css(PAPER[400]),
        wordWrap: { width: panelW - 60 },
      })
      .setAlpha(0.9);
    content.add(note);
    let y = note.height + 6;
    for (const def of Object.values(TRAIT_BY_ID)) {
      const t = countOf.get(def.id);
      const count = t?.count ?? 0;
      const tier = t?.tier ?? -1;
      const nextBreak = def.breakpoints.find((b) => b > count) ?? def.breakpoints[def.breakpoints.length - 1];
      const color = tier >= 0 ? TRAIT_TIER_COLOR_HEX[Math.min(tier, 3)] : INK[500];
      const desc = tier >= 0 ? def.effectText[Math.min(tier, def.effectText.length - 1)] : def.description;
      const row = new TraitRow(this.scene, 0, y, panelW - 40);
      row.set(def.id, count, tier, nextBreak, color, desc);
      content.add(row);
      y += row.rowHeight + 8;
    }
    // 视口收到 600：底缘 828 与关闭键顶缘 850 之间留 22px，键不再贴住滚动区
    this.traitModalScroll = enableScroll(this.scene, content, bodyX, bodyY, panelW - 40, panelH - PANEL_TITLE_H - 80);
    this.traitModalScroll.setHeight(y);

    // Button 的 (x, y) 是左上角（bg origin 0），不是中心 —— 按"中心"传会把按键
    // 右移半个身位、底部溢出面板边框。这里换算成左上角：水平居中、底缘净距 10px。
    const close = new Button(
      this.scene,
      px + (panelW - 140) / 2,
      py + panelH - 30 - 20,
      '关 闭',
      () => this.closeTraitModal(),
      {
        width: 140,
        height: 40,
        variant: 'primary',
      },
    );
    close.setDepth(562);

    this.traitModal = this.scene.add.container(0, 0).setDepth(560);
    this.traitModal.add([shade, modal, content, close]);
  }

  closeTraitModal(): void {
    this.traitModalScroll?.destroy();
    this.traitModal?.destroy();
    this.traitModal = null;
    this.traitModalScroll = null;
  }

  /** 羁绊浮层是否打开（输入层用它守卫棋盘交互与 ESC 链） */
  get traitModalOpen(): boolean {
    return this.traitModal !== null;
  }

  /** nav「阵容」：直接侦查本轮对手（墨兽轮提示无可侦；墨影轮侦查出局阵容快照） */
  private scoutNextOpponent(): void {
    const pr = this.scene.match.pairings.find((x) => x.a === 0 || x.b === 0);
    if (!pr) {
      this.scene.showToast('开战后方可侦查');
      return;
    }
    if (pr.beast) {
      this.scene.showToast('墨兽轮 · 无阵可侦');
      return;
    }
    const other = pr.a === 0 ? pr.b : pr.a;
    if (other < 0) {
      // 墨影（奇数存活轮的落单对手）：阵容快照可侦查；轮空无对手
      if (pr.ghost >= 0) this.scene.pauseScout.showGhostBoard(pr);
      else this.scene.showToast('本轮轮空 · 无对手');
      return;
    }
    this.scene.pauseScout.showOpponentBoard(other);
  }
}
